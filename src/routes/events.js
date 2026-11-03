const express = require('express');
const eventsController = require('../controllers/eventsController');
const contestController = require('../controllers/contestController');
const { loadContest, requirePermission } = require('../middleware/permissions');

const router = express.Router();

router.get('/events', eventsController.index);
router.get('/events/:group(active|upcoming|completed)', eventsController.index);

router.get('/contest/:contestId', loadContest, contestController.show);
router.get('/contest/:contestId/config', loadContest, requirePermission('manageEvent'), contestController.config);
router.get(
  '/contest/:contestId/participants',
  loadContest,
  requirePermission('manageParticipants'),
  contestController.participants,
);

module.exports = router;
