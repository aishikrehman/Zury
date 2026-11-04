const express = require('express');
const eventsController = require('../controllers/eventsController');
const contestController = require('../controllers/contestController');
const submissionController = require('../controllers/submissionController');
const wikiController = require('../controllers/eventWikiController');
const messageController = require('../controllers/messageController');
const trackingController = require('../controllers/trackingController');
const sessionController = require('../controllers/sessionController');
const reviewController = require('../controllers/reviewController');
const { takesEntries, EVENT_TYPES } = require('../events/eventTypes');
const { loadContest, loadSeriesEvent, loadSlugEvent, requirePermission, requireEventWide } = require('../middleware/permissions');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Some pages only exist for some event types.
const notFound = (res) => res.status(404).render('pages/404', { title: 'Page Not Found' });
const entriesOnly = (req, res, next) => (takesEntries(req.contest.type) ? next() : notFound(res));
const activityOnly = (req, res, next) => (EVENT_TYPES[req.contest.type].activity ? next() : notFound(res));

router.get('/events', eventsController.index);
router.get('/events/create', requirePermission('createEvent'), eventsController.createForm);
router.post('/events/create', requirePermission('createEvent'), eventsController.create);
router.get('/events/:group(active|upcoming|completed)', eventsController.index);
router.get('/submissions', requireAuth, submissionController.mine);
router.get('/review', requireAuth, reviewController.myQueue);

// Event pages. The same routes serve the whole event (/wam/2026, /contest/12)
// and one wiki's part of it (/wam/2026/bn); permissions follow the context.
const contest = express.Router({ mergeParams: true });

contest.get('/', contestController.show);
// Joining is a form button; opening /join directly goes to the event page with that button.
contest.get('/join', (req, res) => res.redirect(req.base));
contest.post('/join', requireAuth, contestController.join);
contest.post('/leave', requireAuth, contestController.leave);

contest.get('/config', requirePermission('editEvent', 'manageEvent'), contestController.config);
contest.post('/config', requirePermission('editEvent'), contestController.updateConfig);
contest.post('/status', requireEventWide('manageEvent'), contestController.changeStatus);
contest.post('/delete', requireEventWide('deleteEvent'), contestController.destroy);
contest.post('/move', requireEventWide('deleteEvent'), contestController.move);

// Wikis taking part. Requests are open to logged-in users; the rest is for global controllers.
contest.post('/wikis/request', requireAuth, wikiController.request);
contest.post('/wikis', requireEventWide('manageEvent'), wikiController.add);
contest.post('/wikis/:wikiId(\\d+)/:action(approve|pause|resume|remove)', requireEventWide('manageEvent'), wikiController.change);

// Per-role permission checks happen in the controller/service.
contest.get('/participants', requirePermission('manageParticipants', 'manageJury', 'manageEvent'), contestController.people);
contest.post('/members', requirePermission('manageParticipants', 'manageJury', 'manageEvent'), contestController.addMember);
contest.post('/members/:membershipId(\\d+)/remove', requirePermission('manageParticipants', 'manageJury', 'manageEvent'), contestController.removeMember);
contest.get('/message', requirePermission('sendNotifications'), messageController.form);
contest.post('/message', requirePermission('sendNotifications'), messageController.send);
contest.post('/blocks',requireEventWide('manageParticipants'), contestController.blockUser);
contest.post('/blocks/:blockId(\\d+)/lift', requireEventWide('manageParticipants'), contestController.unblockUser);
contest.post('/overrides', requireEventWide('manageEvent'), contestController.setOverride);
contest.post('/overrides/:overrideId(\\d+)/remove', requireEventWide('manageEvent'), contestController.removeOverride);

contest.get('/activity', requirePermission('manageEvent'), contestController.activity);
contest.get('/statistics', contestController.statistics);
contest.get('/tracking', trackingController.show);
contest.post('/tracking/refresh', requirePermission('manageEvent'), trackingController.refresh);

// Jury review, results and appeals.
contest.get('/review', entriesOnly, requireAuth, reviewController.window);
contest.post('/review/:submissionId(\\d+)', entriesOnly, requireAuth, reviewController.save);
contest.get('/assignments', entriesOnly, requirePermission('assignJury', 'manageAssignments'), reviewController.assignments);
contest.post('/assignments/distribute', entriesOnly, requirePermission('assignJury', 'manageAssignments'), reviewController.distribute);
contest.post('/assignments/add', entriesOnly, requirePermission('assignJury', 'manageAssignments'), reviewController.addAssignment);
contest.post('/assignments/:assignmentId(\\d+)/remove', entriesOnly, requirePermission('assignJury', 'manageAssignments'), reviewController.removeAssignment);
contest.post('/assignments/release/:jurorId(\\d+)', entriesOnly, requirePermission('assignJury', 'manageAssignments'), reviewController.releaseJuror);
contest.get('/results', reviewController.results);
contest.post('/results/publish', requireEventWide('publishResults'), reviewController.publish);
contest.post('/submissions/:submissionId(\\d+)/appeal', entriesOnly, requireAuth, reviewController.appeal);
contest.get('/appeals', requirePermission('reviewAppeal', 'manageAppeals'), reviewController.appealsList);
contest.post('/appeals/:appealId(\\d+)/:action(uphold|dismiss)', requirePermission('manageAppeals'), reviewController.resolve);

contest.get('/sessions', activityOnly, sessionController.index);
contest.post('/sessions', activityOnly, requirePermission('manageEvent'), sessionController.create);
contest.get('/sessions/certificate', activityOnly, requireAuth, sessionController.certificate);
contest.get('/sessions/:sessionId(\\d+)', activityOnly, sessionController.show);
contest.post('/sessions/:sessionId(\\d+)/register', activityOnly, requireAuth, sessionController.register);
contest.post('/sessions/:sessionId(\\d+)/cancel', activityOnly, requireAuth, sessionController.cancel);
contest.post('/sessions/:sessionId(\\d+)/attendance', activityOnly, requirePermission('manageEvent'), sessionController.attendance);
contest.post('/sessions/:sessionId(\\d+)/update', activityOnly, requirePermission('manageEvent'), sessionController.update);

contest.get('/submit', entriesOnly, requireAuth, submissionController.submitForm);
contest.post('/submit/preview', entriesOnly, requireAuth, submissionController.preview);
contest.post('/submit', entriesOnly, requireAuth, submissionController.submit);
contest.get('/submissions', entriesOnly, submissionController.index);
contest.get('/submissions/:submissionId(\\d+)', submissionController.show);
contest.post('/submissions/:submissionId(\\d+)/withdraw', requireAuth, submissionController.withdraw);
contest.post('/submissions/:submissionId(\\d+)/status', requirePermission('manageEvent'), submissionController.setStatus);
contest.post('/submissions/:submissionId(\\d+)/revalidate', requirePermission('manageEvent'), submissionController.revalidate);

router.use('/contest/:contestId(\\d+)', loadContest, contest);

// Series addresses go last so they never shadow app pages.
// No '*' here: Express 4 turns it into a wildcard that would swallow the wiki code.
const SLUG = '[a-z0-9][a-z0-9-]{0,79}';
// Runs the event pages only when the loader found an event at this address;
// otherwise the next kind of address gets a try.
const mount = (loader) => (req, res, next) => {
  req.contest = undefined;
  loader(req, res, (err) => {
    if (err) return next(err);
    if (!req.contest) return next();
    contest(req, res, next);
  });
};

router.get(`/:series(${SLUG})`, eventsController.series);
router.use(`/:series(${SLUG})/:edition(${SLUG})`, mount(loadSeriesEvent({ withWiki: false })));
router.use(`/:series(${SLUG})/:edition(${SLUG})/:code(${SLUG})`, mount(loadSeriesEvent({ withWiki: true })));
router.use(`/:slug(${SLUG})`, mount(loadSlugEvent({ withWiki: false })));
router.use(`/:slug(${SLUG})/:code(${SLUG})`, mount(loadSlugEvent({ withWiki: true })));

module.exports = router;
