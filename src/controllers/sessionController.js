const sessionService = require('../services/sessionService');
const membershipService = require('../services/membershipService');
const { readTypeConfig } = require('../events/eventTypes');
const { defaultWikiFor } = require('./contestController');

const { SessionError } = sessionService;
const handled = (err) => err instanceof SessionError || err instanceof membershipService.MembershipError;
const certificateAfter = (req) => readTypeConfig(req.contest.type, req.settings.typeConfig).minSessionsForCertificate || 0;

async function index(req, res, next, { form = {}, errors = {}, status = 200 } = {}) {
  try {
    const canManage = req.permissions.has('manageEvent');
    const [sessions, summary] = await Promise.all([
      sessionService.list(req.contest.id, { wiki: req.wikiScope?.wiki, userId: req.user?.id }),
      sessionService.attendanceSummary(req.contest.id, certificateAfter(req)),
    ]);
    res.status(status).render('pages/contest/sessions', {
      title: `Sessions — ${req.contest.title}`,
      sessions,
      summary: canManage ? summary : summary.filter((s) => s.userId === req.user?.id),
      certificateAfter: certificateAfter(req),
      canManage,
      form: { mode: 'offline', status: 'open', ...form },
      errors,
      modes: sessionService.MODES,
      statuses: sessionService.STATUSES,
    });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  const { errors, data } = sessionService.parse(req.body, req.effective.contest.timezone);
  if (Object.keys(errors).length) return index(req, res, next, { form: req.body, errors, status: 422 });
  try {
    await sessionService.create({ actorId: req.user.id, contest: req.contest, data, wiki: req.wikiScope?.wiki || '' });
    req.flash('success', `Session “${data.title}” added.`);
    res.redirect(`${req.base}/sessions`);
  } catch (err) {
    next(err);
  }
}

async function load(req, res) {
  const session = await sessionService.find(req.contest.id, Number(req.params.sessionId));
  if (!session || (req.wikiScope && session.wiki && session.wiki !== req.wikiScope.wiki)) {
    res.status(404).render('pages/404', { title: 'Session Not Found' });
    return null;
  }
  return session;
}

async function show(req, res, next) {
  try {
    const session = await load(req, res);
    if (!session) return;
    res.render('pages/contest/session', {
      title: `${session.title} — ${req.contest.title}`,
      session,
      mine: session.attendances.find((a) => a.userId === req.user?.id)?.status || null,
      canManage: req.permissions.has('manageEvent'),
      modes: sessionService.MODES,
      statuses: sessionService.STATUSES,
      attendanceLabels: sessionService.ATTENDANCE,
    });
  } catch (err) {
    next(err);
  }
}

// Wraps an action on one session: flash the result, go back to the session.
function action(fn) {
  return async (req, res, next) => {
    try {
      const session = await load(req, res);
      if (!session) return;
      req.flash('success', await fn(req, session));
    } catch (err) {
      if (!handled(err)) return next(err);
      req.flash('danger', err.message);
    }
    res.redirect(`${req.base}/sessions/${req.params.sessionId}`);
  };
}

const register = action(async (req, session) => {
  const status = await sessionService.register({ user: req.user, contest: req.contest, settings: req.settings, session, wiki: defaultWikiFor(req, req.body.wiki) });
  return status === 'waitlisted' ? "The session is full; you're on the waiting list." : "You're registered.";
});

const cancel = action(async (req, session) => {
  await sessionService.cancel({ user: req.user, contest: req.contest, session });
  return 'Registration cancelled.';
});

const attendance = action(async (req, session) => {
  const n = await sessionService.recordAttendance({ actorId: req.user.id, contest: req.contest, session, present: [].concat(req.body.present || []) });
  return `Attendance saved: ${n} attended.`;
});

const update = action(async (req, session) => {
  const data = {};
  if (sessionService.STATUSES[req.body.status]) data.status = req.body.status;
  if (typeof req.body.report === 'string') data.report = req.body.report.trim().slice(0, 10000);
  await sessionService.update({ actorId: req.user.id, contest: req.contest, session, data });
  return 'Session updated.';
});

async function certificate(req, res, next) {
  try {
    const min = certificateAfter(req);
    const row = (await sessionService.attendanceSummary(req.contest.id, min)).find((s) => s.userId === req.user.id);
    if (!row?.certified) {
      req.flash('danger', min ? `Attend ${min} session${min === 1 ? '' : 's'} to earn the certificate.` : 'This event has no certificate.');
      return res.redirect(`${req.base}/sessions`);
    }
    res.render('pages/contest/certificate', { title: `Certificate — ${req.contest.title}`, layout: false, person: req.user, attended: row.attended });
  } catch (err) {
    next(err);
  }
}

module.exports = { index: (req, res, next) => index(req, res, next), create, show, register, cancel, attendance, update, certificate };
