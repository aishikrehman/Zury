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
  const rules = require('../services/participationService').read(req.settings).rules;
  const staff = req.permissions.has('submitOthersEntry') || req.permissions.has('manageEvent') || (req.scope.eventRoles || []).includes('jury');
  const canOthers = rules.onBehalf === 'anyone' ? !!req.user : rules.onBehalf === 'staff' ? staff : req.permissions.has('deleteAnything');
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
  const rule = require('../services/participationService').read(req.settings).rules.mass;
  if (rule === 'off') return req.permissions.has('massSubmit');
  if (rule === 'reviewers') return (req.scope.eventRoles || []).includes('jury') || req.permissions.has('manageEvent') || req.permissions.has('massSubmit');
  return true;
}
function massAllowedOld(req) {
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
    // The event's texts on the talk page and the article, with the submitter's login (in the background).
    const tcx = readTypeConfig(req.contest.type, req.settings.typeConfig);
    const talkText = tcx.talkText || (tcx.entryTemplateOnTalk !== false ? tcx.entryTemplate : '');
    const articleText = tcx.articleText || (tcx.entryTemplateOnTalk === false ? tcx.entryTemplate : '');
    if ((talkText || articleText) && req.session.wikimediaToken && who.participant.id === req.user.id) {
      const ets = require('../services/eventTextService');
      const summary = ets.summaryFor({ settings: req.settings, contest: req.contest, url: `${req.protocol}://${req.get('host')}${req.base}` });
      const token = req.session.wikimediaToken;
      setImmediate(async () => { for (const sub of created) await ets.addTexts({ token, submission: sub, talkText, articleText, summary }).catch((e) => console.warn('event texts:', e.message)); });
    }
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
    const tc = readTypeConfig(req.contest.type, req.settings.typeConfig);
    const staffView = req.permissions.has('manageEvent') || (req.scope.eventRoles || []).includes('jury');
    res.locals.showReviewers = staffView || require('../services/participationService').read(req.settings).rules.reviewerNames === 'yes';
    const templateLink = (s) => (tc.entryTemplate ? require('../wiki/wikiUrls').templateEditUrl({ wiki: s.wiki, title: s.title, namespace: s.entryType === 'article' ? 0 : -1 }, tc.entryTemplate, tc.entryTemplateOnTalk !== false) : null);
    const reviewService = require('../services/reviewService');
    res.render('pages/contest/submissions', {
      templateLink,
      canWithdraw: (s) => req.user?.id === s.participantId && submissionService.WITHDRAWABLE.includes(s.status) && ['participant', 'both'].includes(require('../services/participationService').read(req.settings).rules.withdraw),
      canAppealRow: (s) => reviewService.canAppeal({ submission: s, contest: req.effective.contest, settings: req.settings, user: req.user }),
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
    const tc2 = readTypeConfig(req.contest.type, req.settings.typeConfig);
    res.render('pages/contest/submission', {
      templateLink: tc2.entryTemplate ? require('../wiki/wikiUrls').templateEditUrl({ wiki: submission.wiki, title: submission.title, namespace: submission.entryType === 'article' ? 0 : -1 }, tc2.entryTemplate, tc2.entryTemplateOnTalk !== false) : null,
      templateOnTalk: tc2.entryTemplateOnTalk !== false,
      follow: submission.entryType === 'article' ? [['talk', tc2.talkText || (tc2.entryTemplateOnTalk !== false ? tc2.entryTemplate : '')], ['article', tc2.articleText || (tc2.entryTemplateOnTalk === false ? tc2.entryTemplate : '')]].filter((x) => x[1]).map(([where, text]) => ({ where, text, url: require('../wiki/wikiUrls').followEditUrl(submission, where) })) : [],
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
    res.redirect(backTo(req, `${req.base}/submissions`));
  };
}

const withdraw = action(async (req, s) => {
  const rule = require('../services/participationService').read(req.settings).rules.withdraw;
  const own = s.participantId === req.user.id;
  const staff = req.permissions.has('manageEvent') || (req.scope.eventRoles || []).includes('jury');
  const ok = (own && ['participant', 'both'].includes(rule)) || (staff && ['reviewers', 'both'].includes(rule)) || req.permissions.has('deleteAnything');
  if (!ok) throw new SubmissionError('Entries cannot be removed in this event.', 403);
  return own ? submissionService.withdraw({ actor: req.user, submission: s, contestId: req.contest.id }) : submissionService.changeStatus({ actor: req.user, submission: s, contestId: req.contest.id, status: 'withdrawn', note: 'Removed by a reviewer' });
}, 'Entry withdrawn.');
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
    const filters = {
      status: submissionService.STATUSES.includes(req.query.status) ? req.query.status : '',
      contestId: Number.parseInt(req.query.event, 10) || null,
      q: typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '',
      sort: Object.keys(submissionService.MINE_SORTS).includes(req.query.sort) ? req.query.sort : 'newest',
    };
    res.render('pages/submissions/mine', {
      title: 'My submissions — Zury',
      mine: await submissionService.listMine(req.user.id, filters),
      filters,
      statuses: submissionService.STATUSES,
      withdrawable: submissionService.WITHDRAWABLE,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { submitForm, preview, submit, index, show, withdraw, setStatus, revalidate, mine };

// Superusers: delete one entry for good (its reviews, assignments and history go with it).
async function destroy(req, res, next) {
  try {
    const s = await prisma.submission.findFirst({ where: { id: Number(req.params.submissionId), contestId: req.contest.id } });
    if (!s) return res.redirect(`${req.base}/submissions`);
    await prisma.submission.delete({ where: { id: s.id } });
    await require('../services/auditService').record({ actorId: req.user.id, contestId: req.contest.id, action: 'submission.deleted', entityType: 'Submission', entityId: s.id, details: { title: s.title, wiki: s.wiki, participantId: s.participantId } });
    req.flash('success', req.t('Entry deleted.'));
    res.redirect(`${req.base}/submissions`);
  } catch (err) {
    next(err);
  }
}

// Superusers: delete one review; the entry is decided again from the reviews left.
async function destroyReview(req, res, next) {
  try {
    const review = require('../services/reviewService');
    const r = await prisma.review.findFirst({ where: { id: Number(req.params.reviewId), submissionId: Number(req.params.submissionId), contestId: req.contest.id }, include: { juror: { select: { username: true } } } });
    if (r) {
      await prisma.review.delete({ where: { id: r.id } });
      const s = await prisma.submission.findUnique({ where: { id: r.submissionId } });
      const left = await prisma.review.findMany({ where: { submissionId: r.submissionId }, orderBy: { createdAt: 'asc' } });
      const next = left.length ? review.decide(left, req.eventSettings) : { status: 'pending', score: null };
      if (['pending', 'validated', 'under_review', 'approved', 'rejected'].includes(s.status)) await prisma.submission.update({ where: { id: s.id }, data: { status: next.status, score: next.score } });
      await require('../services/auditService').record({ actorId: req.user.id, contestId: req.contest.id, action: 'review.deleted', entityType: 'Submission', entityId: s.id, details: { title: s.title, juror: r.juror.username, decision: r.decision } });
      req.flash('success', req.t('Review deleted; the entry was decided again.'));
    }
    res.redirect(`${req.base}/submissions`);
  } catch (err) {
    next(err);
  }
}
module.exports.destroy = destroy;
module.exports.destroyReview = destroyReview;

// Review tools: the entry becomes the page as it is now (revision and word count).
async function useLatest(req, res, next) {
  try {
    const s = await prisma.submission.findFirst({ where: { id: Number(req.params.submissionId), contestId: req.contest.id } });
    if (!s) return next();
    const staff = req.permissions.has('manageEvent') || (req.scope.eventRoles || []).includes('jury');
    if (!staff) { const e = new Error("You don't have permission to do that."); e.status = 403; return next(e); }
    await submissionService.repin(s);
    if (req.get('X-Requested-With') === 'fetch') return res.json({ ok: true });
    req.flash('success', req.t('The entry is now the latest revision.'));
  } catch (err) {
    return next(err);
  }
  res.redirect(backTo(req, `${req.base}/review?entry=${req.params.submissionId}`));
}

// One button: every entry checked again (in the background), and Fountain wikis brought up to date.
async function revalidateAll(req, res, next) {
  try {
    const list = await prisma.submission.findMany({ where: { contestId: req.contest.id, status: { in: ['pending', 'validated', 'invalid'] } }, take: 2000 });
    const fountain = req.eventWikis.filter((w) => w.fountainCode);
    const actor = req.user; const contest = req.contest; const settings = req.eventSettings; const eventWikis = req.eventWikis;
    setImmediate(async () => {
      for (const w of fountain) await require('../services/fountainService').sync(w, { actorId: actor.id }).catch(() => null);
      for (const s of list) await submissionService.revalidate({ actor, submission: s, contest, settings, eventWikis }).catch(() => null);
    });
    req.flash('success', req.t('Checking {n} entries again; reload in a minute to see them.', { n: list.length }));
  } catch (err) {
    return next(err);
  }
  res.redirect(backTo(req, `${req.base}/submissions`));
}

// Several entries removed from the event at once (ticked in the list).
async function removeMany(req, res, next) {
  try {
    const ids = [].concat(req.body.ids || []).map(Number).filter(Number.isInteger).slice(0, 500);
    const rows = await prisma.submission.findMany({ where: { contestId: req.contest.id, id: { in: ids }, status: { not: 'withdrawn' } } });
    for (const s of rows) await submissionService.changeStatus({ actor: req.user, submission: s, contestId: req.contest.id, status: 'withdrawn', note: 'Removed by an organizer' });
    if (req.get('X-Requested-With') === 'fetch') return res.json({ ok: true, n: rows.length });
    req.flash('success', req.t('{n} entries removed.', { n: rows.length }));
  } catch (err) {
    return next(err);
  }
  res.redirect(backTo(req, `${req.base}/submissions`));
}
module.exports.useLatest = useLatest;
module.exports.revalidateAll = revalidateAll;
module.exports.removeMany = removeMany;

async function bulkDeleteReviews(req, res, next) {
  try {
    const review = require('../services/reviewService');
    const ids = [].concat(req.body.ids || []).map(Number).filter(Number.isInteger).slice(0, 500);
    const higher = req.permissions.has('manageEvent') || req.permissions.has('deleteAnything');
    const where = { contestId: req.contest.id, submissionId: { in: ids }, ...(higher ? {} : { jurorId: req.user.id }) };
    const gone = await prisma.review.findMany({ where, select: { submissionId: true } });
    await prisma.review.deleteMany({ where });
    for (const id of new Set(gone.map((g) => g.submissionId))) {
      const s = await prisma.submission.findUnique({ where: { id } });
      const left = await prisma.review.findMany({ where: { submissionId: id }, orderBy: { createdAt: 'asc' } });
      const next = left.length ? review.decide(left, req.eventSettings) : { status: 'pending', score: null };
      if (['pending', 'validated', 'under_review', 'approved', 'rejected'].includes(s.status)) await prisma.submission.update({ where: { id }, data: { status: next.status, score: next.score } });
    }
    req.flash('success', req.t('{n} reviews deleted.', { n: gone.length }));
  } catch (err) {
    return next(err);
  }
  res.redirect(backTo(req, `${req.base}/submissions`));
}
module.exports.bulkDeleteReviews = bulkDeleteReviews;
