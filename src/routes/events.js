const express = require('express');
const eventsController = require('../controllers/eventsController');
const contestController = require('../controllers/contestController');
const submissionController = require('../controllers/submissionController');
const { loadContest, requirePermission } = require('../middleware/permissions');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/events', eventsController.index);
router.get('/events/create', requirePermission('createEvent'), eventsController.createForm);
router.post('/events/create', requirePermission('createEvent'), eventsController.create);
router.get('/events/:group(active|upcoming|completed)', eventsController.index);
router.get('/submissions', requireAuth, submissionController.mine);

const contest = express.Router({ mergeParams: true });
contest.use(loadContest);

contest.get('/', contestController.show);
contest.post('/join', requireAuth, contestController.join);
contest.post('/leave', requireAuth, contestController.leave);

contest.get('/config', requirePermission('editEvent', 'manageEvent'), contestController.config);
contest.post('/config', requirePermission('editEvent'), contestController.updateConfig);
contest.post('/status', requirePermission('manageEvent'), contestController.changeStatus);
contest.post('/delete', requirePermission('deleteEvent'), contestController.destroy);

// Per-role permission checks happen in the controller/service.
contest.get('/participants', requirePermission('manageParticipants', 'manageJury', 'manageEvent'), contestController.people);
contest.post('/members', requirePermission('manageParticipants', 'manageJury', 'manageEvent'), contestController.addMember);
contest.post('/members/:membershipId(\\d+)/remove', requirePermission('manageParticipants', 'manageJury', 'manageEvent'), contestController.removeMember);
contest.post('/overrides', requirePermission('manageEvent'), contestController.setOverride);
contest.post('/overrides/:overrideId(\\d+)/remove', requirePermission('manageEvent'), contestController.removeOverride);

contest.get('/activity', requirePermission('manageEvent'), contestController.activity);

contest.get('/submit', requireAuth, submissionController.submitForm);
contest.post('/submit/preview', requireAuth, submissionController.preview);
contest.post('/submit', requireAuth, submissionController.submit);
contest.get('/submissions', submissionController.index);
contest.get('/submissions/:submissionId(\\d+)', submissionController.show);
contest.post('/submissions/:submissionId(\\d+)/withdraw', requireAuth, submissionController.withdraw);
contest.post('/submissions/:submissionId(\\d+)/status', requirePermission('manageEvent'), submissionController.setStatus);
contest.post('/submissions/:submissionId(\\d+)/revalidate', requirePermission('manageEvent'), submissionController.revalidate);

router.use('/contest/:contestId(\\d+)', contest);

module.exports = router;
