const express = require('express');
const eventsController = require('../controllers/eventsController');
const contestController = require('../controllers/contestController');
const submissionController = require('../controllers/submissionController');
const wikiController = require('../controllers/eventWikiController');
const { loadContest, loadSeriesEvent, requirePermission, requireEventWide } = require('../middleware/permissions');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/events', eventsController.index);
router.get('/events/create', requirePermission('createEvent'), eventsController.createForm);
router.post('/events/create', requirePermission('createEvent'), eventsController.create);
router.get('/events/:group(active|upcoming|completed)', eventsController.index);
router.get('/submissions', requireAuth, submissionController.mine);

// Event pages. The same routes serve the whole event (/wam/2026, /contest/12)
// and one wiki's part of it (/wam/2026/bn); permissions follow the context.
const contest = express.Router({ mergeParams: true });

contest.get('/', contestController.show);
contest.post('/join', requireAuth, contestController.join);
contest.post('/leave', requireAuth, contestController.leave);

contest.get('/config', requirePermission('editEvent', 'manageEvent'), contestController.config);
contest.post('/config', requirePermission('editEvent'), contestController.updateConfig);
contest.post('/status', requireEventWide('manageEvent'), contestController.changeStatus);
contest.post('/delete', requireEventWide('deleteEvent'), contestController.destroy);

// Wikis taking part. Requests are open to logged-in users; the rest is for global controllers.
contest.post('/wikis/request', requireAuth, wikiController.request);
contest.post('/wikis', requireEventWide('manageEvent'), wikiController.add);
contest.post('/wikis/:wikiId(\\d+)/:action(approve|pause|resume|remove)', requireEventWide('manageEvent'), wikiController.change);

// Per-role permission checks happen in the controller/service.
contest.get('/participants', requirePermission('manageParticipants', 'manageJury', 'manageEvent'), contestController.people);
contest.post('/members', requirePermission('manageParticipants', 'manageJury', 'manageEvent'), contestController.addMember);
contest.post('/members/:membershipId(\\d+)/remove', requirePermission('manageParticipants', 'manageJury', 'manageEvent'), contestController.removeMember);
contest.post('/overrides', requireEventWide('manageEvent'), contestController.setOverride);
contest.post('/overrides/:overrideId(\\d+)/remove', requireEventWide('manageEvent'), contestController.removeOverride);

contest.get('/activity', requirePermission('manageEvent'), contestController.activity);
contest.get('/statistics', contestController.statistics);

contest.get('/submit', requireAuth, submissionController.submitForm);
contest.post('/submit/preview', requireAuth, submissionController.preview);
contest.post('/submit', requireAuth, submissionController.submit);
contest.get('/submissions', submissionController.index);
contest.get('/submissions/:submissionId(\\d+)', submissionController.show);
contest.post('/submissions/:submissionId(\\d+)/withdraw', requireAuth, submissionController.withdraw);
contest.post('/submissions/:submissionId(\\d+)/status', requirePermission('manageEvent'), submissionController.setStatus);
contest.post('/submissions/:submissionId(\\d+)/revalidate', requirePermission('manageEvent'), submissionController.revalidate);

router.use('/contest/:contestId(\\d+)', loadContest, contest);

// Series addresses go last so they never shadow app pages.
// No '*' here: Express 4 turns it into a wildcard that would swallow the wiki code.
const SLUG = '[a-z0-9][a-z0-9-]{0,79}';
router.get(`/:series(${SLUG})`, eventsController.series);
router.use(`/:series(${SLUG})/:edition(${SLUG})`, loadSeriesEvent({ withWiki: false }), contest);
router.use(`/:series(${SLUG})/:edition(${SLUG})/:code(${SLUG})`, loadSeriesEvent({ withWiki: true }), contest);

module.exports = router;
