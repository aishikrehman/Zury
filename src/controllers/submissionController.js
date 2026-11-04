const submissionService = require('../services/submissionService');
const membershipService = require('../services/membershipService');
const userDirectory = require('../services/userDirectoryService');
const { submissionWindow } = require('../services/submissionRules');
const { WikiApiError } = require('../wiki/wikiApi');
const { readTypeConfig, EVENT_TYPES } = require('../events/eventTypes');
const { effectiveFor } = require('../events/effective');
const { wikimediaBans } = require('../wiki/banCheck');
const reviewService = require('../services/reviewService');
const prisma = require('../config/prisma');

// Blocked from the event, or banned on Wikimedia (globally or on their wiki)?
async function assertAllowed(req, person) {
  if (await membershipService.isBlocked(req.contest.id, person.id)) {
    throw new SubmissionError(person.id === req.user.id ? "You've been blocked from this event." : `${person.username} is blocked from this event.`);
  }
  const m = await prisma.contestMembership.findFirst({ where: { contestId: req.contest.id, userId: person.id, role: 'participant', status: 'active' } });
  const bans = await wikimediaBans(person, m?.wiki || req.contextWiki?.wiki || req.contest.primaryWiki);
  if (bans.length) throw new SubmissionError(bans.join(' '));
}

const { SubmissionError } = submissionService;
const can = (req) => (p) => req.permissions.has(p);

// A multi-wiki event takes entries while any of its wikis does; each entry is then checked against its own wiki.
function eventWindow(req) {
  if (req.contextWiki || req.eventWikis.length < 2) return submissionWindow(req.effective.contest);
  const windows = req.eventWikis.map((w) => submissionWindow(effectiveFor(req.contest, req.eventSettings, w).contest));
  return windows.find((w) => w.open) || windows[0];
}

// Decides whose entries these are and whether they may be submitted now.
async function resolveSubmitter(req) {
  const { contest, settings, user } = req;
  const canOthers = req.permissions.has('submitOthersEntry');
  const window = eventWindow(req);
  if (!window.open && !canOthers) throw new SubmissionError(window.reason);

  const onBehalfName = typeof req.body.participant === 'string' ? req.body.participant.trim() : '';
  if (onBehalfName && canOthers) {
    const participant = await userDirectory.findOrImport(onBehalfName);
    if (!participant) throw new SubmissionError(`No Wikimedia user named “${onBehalfName}” was found.`);
    const roles = await membershipService.activeRoles(contest.id, participant.id);
    if (!roles.includes('participant')) throw new SubmissionError(`${participant.username} is not a participant in this event. Add them first.`);
    await assertAllowed(req, participant);
    return { participant, ensureParticipant: null };
  }

  await assertAllowed(req, user);
  const roles = await membershipService.activeRoles(contest.id, user.id);
  if (roles.includes('participant')) {
    if (!req.permissions.has('submitEntry')) throw new SubmissionError("You can't submit entries to this event.", 403);
    return { participant: user, ensureParticipant: null };
  }
  if (settings.registrationRequired) throw new SubmissionError('Join this event before submitting.');
  const eligibility = membershipService.checkEligibility({
    user,
    contest,
    settings,
    roles,
    participants: await membershipService.participantCount(contest.id),
  });
  if (!eligibility.eligible) throw new SubmissionError(eligibility.reasons.join(' '));
  return { participant: user, ensureParticipant: (tx) => membershipService.joinInTx(tx, { user, contest, wiki: req.contextWiki?.wiki || '' }), joinsNow: true };
}

function massAllowed(req) {
  return req.settings.massSubmissionEnabled || req.permissions.has('massSubmit');
}

function renderForm(req, res, { text = '', participant = '', items = null, error = null, status = 200 }) {
  res.status(status).render('pages/contest/submit', {
    title: `Submit — ${req.contest.title}`,
    text,
    participant,
    items,
    error,
    mass: massAllowed(req),
    canOthers: req.permissions.has('submitOthersEntry'),
    window: eventWindow(req),
    typeDef: EVENT_TYPES[req.contest.type],
    typeConfig: readTypeConfig(req.contest.type, req.settings.typeConfig),
    maxBatch: submissionService.MAX_BATCH,
  });
}

function submitForm(req, res) {
  renderForm(req, res, {});
}

async function handleSubmit(req, res, next, { confirm }) {
  const text = typeof req.body.entries === 'string' ? req.body.entries : '';
  const participantName = typeof req.body.participant === 'string' ? req.body.participant : '';
  try {
    if (submissionService.splitLines(text).length > 1 && !massAllowed(req)) {
      throw new SubmissionError('This event accepts one entry at a time.');
    }
    const who = await resolveSubmitter(req);
    const items = await submissionService.prepare({
      contest: req.contest,
      settings: req.eventSettings,
      participantId: who.participant.id,
      text,
      eventWikis: req.eventWikis,
      defaultWiki: req.contextWiki?.wiki,
      lateAllowed: req.permissions.has('submitOthersEntry'),
    });
    if (!confirm) return renderForm(req, res, { text, participant: participantName, items });

    const created = await submissionService.save({
      actor: req.user,
      contest: req.contest,
      settings: req.settings,
      participant: who.participant,
      items,
      ensureParticipant: who.ensureParticipant,
    });
    const skipped = items.length - created.length;
    req.flash(
      'success',
      `${created.length} entr${created.length === 1 ? 'y' : 'ies'} submitted${skipped ? `; ${skipped} skipped` : ''}${who.joinsNow ? '. You are now a participant' : ''}.`,
    );
    res.redirect(`${req.base}/submissions${who.participant.id === req.user.id ? '?mine=1' : ''}`);
  } catch (err) {
    if (err instanceof SubmissionError || err instanceof WikiApiError) {
      return renderForm(req, res, { text, participant: participantName, error: err.message, status: err.status === 403 ? 403 : 422 });
    }
    next(err);
  }
}

const preview = (req, res, next) => handleSubmit(req, res, next, { confirm: false });
const submit = (req, res, next) => handleSubmit(req, res, next, { confirm: true });

async function index(req, res, next) {
  try {
    const filters = {
      status: submissionService.STATUSES.includes(req.query.status) ? req.query.status : '',
      q: typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '',
      mine: req.query.mine === '1',
      sort: Object.keys(submissionService.SORTS).includes(req.query.sort) && (req.query.sort !== 'words' || req.settings.wordCountEnabled) ? req.query.sort : 'submitted',
      dir: req.query.dir === 'asc' ? 'asc' : 'desc',
      participant: Number.parseInt(req.query.participant, 10) || null,
    };
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    // Anonymous events don't let visitors pick out one person's entries.
    const showNames = !req.settings.anonymousParticipants || req.permissions.has('viewAllSubmissions');
    if (!showNames) filters.participant = null;
    const result = await submissionService.list({ contestId: req.contest.id, user: req.user, can: can(req), wiki: req.wikiScope?.wiki, page, ...filters });
    res.render('pages/contest/submissions', {
      title: `Submissions — ${req.contest.title}`,
      result,
      filters,
      showNames,
      statuses: submissionService.STATUSES,
      // The wiki under each title only helps when entries come from several wikis.
      showWiki: !req.wikiScope && (req.eventWikis || []).length > 1,
      reviewWikis: reviewWikis(req),
      marks: require('../services/reviewService').markScheme(req.eventSettings),
      juryOn: !!req.settings.juryReviewEnabled,
      withdrawable: submissionService.WITHDRAWABLE,
      back: req.originalUrl,
    });
  } catch (err) {
    next(err);
  }
}

// Wikis whose entries this person may review here: null means all, [] none.
function reviewWikis(req) {
  try {
    return require('./reviewController').judgedWikis(req);
  } catch {
    return [];
  }
}

// After an action from the list, go back to the same list page (only within this event).
function backTo(req, fallback) {
  const back = typeof req.body.back === 'string' ? req.body.back : '';
  return back.startsWith(`${req.base}/`) && !back.startsWith('//') && !/[\r\n]/.test(back) ? back : fallback;
}

async function load(req) {
  const id = Number(req.params.submissionId);
  return submissionService.findVisible({ contestId: req.contest.id, id, user: req.user, can: can(req), wiki: req.wikiScope?.wiki });
}

async function show(req, res, next) {
  try {
    const submission = await load(req);
    if (!submission) return res.status(404).render('pages/404', { title: 'Submission Not Found' });
    const isOwner = req.user?.id === submission.participantId;
    res.render('pages/contest/submission', {
      title: `${submission.title} — ${req.contest.title}`,
      submission,
      meta: JSON.parse(submission.metadata),
      validation: JSON.parse(submission.validation),
      isOwner,
      canWithdraw: isOwner && submissionService.WITHDRAWABLE.includes(submission.status),
      canAppeal: reviewService.canAppeal({ submission, contest: req.effective.contest, settings: req.settings, user: req.user }),
      // Jury verdicts: for the jury and organizers, and for the participant once results are out.
      reviews:
        req.permissions.has('reviewEvent') || (isOwner && req.contest.resultsPublishedAt)
          ? await prisma.review.findMany({ where: { submissionId: submission.id }, include: { juror: { select: { username: true } } }, orderBy: { createdAt: 'asc' } })
          : [],
      showName: isOwner || !req.settings.anonymousParticipants || req.permissions.has('viewAllSubmissions'),
      statuses: submissionService.STATUSES,
    });
  } catch (err) {
    next(err);
  }
}

function action(fn, successMessage) {
  return async (req, res, next) => {
    try {
      const submission = await load(req);
      if (!submission) return res.status(404).render('pages/404', { title: 'Submission Not Found' });
      await fn(req, submission);
      req.flash('success', successMessage);
    } catch (err) {
      if (!(err instanceof SubmissionError || err instanceof WikiApiError)) return next(err);
      if (err.status === 403) return next(err);
      req.flash('danger', err.message);
    }
    res.redirect(backTo(req, `${req.base}/submissions/${req.params.submissionId}`));
  };
}

const withdraw = action((req, s) => submissionService.withdraw({ actor: req.user, submission: s, contestId: req.contest.id }), 'Entry withdrawn.');
const setStatus = action(
  (req, s) => submissionService.changeStatus({ actor: req.user, submission: s, contestId: req.contest.id, status: req.body.status, note: req.body.note }),
  'Status updated.',
);
const revalidate = action(
  (req, s) => submissionService.revalidate({ actor: req.user, submission: s, contest: req.contest, settings: req.eventSettings, eventWikis: req.eventWikis }),
  'Entry checked again.',
);

async function mine(req, res, next) {
  try {
    res.render('pages/submissions/mine', { title: 'My submissions — Zury', submissions: await submissionService.listMine(req.user.id) });
  } catch (err) {
    next(err);
  }
}

module.exports = { submitForm, preview, submit, index, show, withdraw, setStatus, revalidate, mine };
