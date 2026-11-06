const express = require('express');
const eventsController = require('../controllers/eventsController');
const contestController = require('../controllers/contestController');
const submissionController = require('../controllers/submissionController');
const wikiController = require('../controllers/eventWikiController');
const fountainController = require('../controllers/fountainController');
const messageController = require('../controllers/messageController');
const trackingController = require('../controllers/trackingController');
const sessionController = require('../controllers/sessionController');
const reviewController = require('../controllers/reviewController');
const { takesEntries, EVENT_TYPES } = require('../events/eventTypes');
const { loadContest, eventAddresses, requirePermission, requireEventWide } = require('../middleware/permissions');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
// Making series is for people who may create events.
const requireCreate = (req, res, next) => {
  if (req.permissions.has('createEvent')) return next();
  const err = new Error("You don't have permission to do that.");
  err.status = 403;
  next(err);
};

// Some pages only exist for some event types.
const notFound = (res) => res.status(404).render('pages/404', { title: 'Page Not Found' });
const entriesOnly = (req, res, next) => (takesEntries(req.contest.type) ? next() : notFound(res));
const activityOnly = (req, res, next) => (EVENT_TYPES[req.contest.type].activity ? next() : notFound(res));

router.get('/events', eventsController.index);
router.get('/events/create', requirePermission('createEvent'), eventsController.createForm);
router.post('/events/create', requirePermission('createEvent'), eventsController.create);
// Fountain imports, series and editions: stewards, global sysops, local admins and superusers.
router.get('/events/import', requirePermission('importEvents'), fountainController.importForm);
router.post('/events/import', requirePermission('importEvents'), fountainController.importEvent);
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
contest.post('/structure/:action(move|copy)', requirePermission('manageEvent'), contestController.structure);
contest.post('/inline', requirePermission('editEvent'), contestController.inlineUpdate);
contest.post('/config/follow', requirePermission('editEvent'), contestController.followSetting);
contest.post('/status', requireEventWide('manageEvent'), contestController.changeStatus);
contest.post('/delete', requireEventWide('deleteEvent'), contestController.destroy);
contest.get('/export/:dataset([a-z]+).:format([a-z]+)', requirePermission('manageEvent', 'exportData'), contestController.exportData);
// Removing anything is for superusers and Zury administrators (deleteEvent).
contest.post('/data/clear/:what([a-z]+)', requireEventWide('deleteEvent'), contestController.clearData);
contest.post('/move', requireEventWide('deleteEvent'), contestController.move);

// Wikis taking part. Requests are open to logged-in users; the rest is for global controllers.
contest.post('/wikis/request', requireAuth, wikiController.request);
contest.post('/wikis', requireEventWide('manageEvent'), wikiController.add);
contest.post('/fountain', requirePermission('importEvents'), fountainController.link);
contest.post('/fountain/:wikiId(\\d+)/:action(sync)', requireEventWide('manageEvent'), fountainController.sync);
contest.post('/fountain/:wikiId(\\d+)/:action(unlink)', requirePermission('importEvents'), fountainController.unlink);
contest.post('/wikis/:wikiId(\\d+)/:action(approve|pause|resume)', requireEventWide('manageEvent'), wikiController.change);
contest.post('/wikis/:wikiId(\\d+)/:action(remove)', requireEventWide('deleteEvent'), wikiController.change);

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
contest.post('/review/bulk', entriesOnly, requireAuth, reviewController.bulkSave);
contest.get('/review/entries', entriesOnly, requireAuth, reviewController.entries);
contest.post('/review/:submissionId(\\d+)', entriesOnly, requireAuth, reviewController.save);
contest.get('/assignments', entriesOnly, requirePermission('assignJury', 'manageAssignments'), reviewController.assignments);
contest.post('/assignments/distribute', entriesOnly, requirePermission('assignJury', 'manageAssignments'), reviewController.distribute);
contest.post('/assignments/reassign', entriesOnly, requirePermission('assignJury', 'manageAssignments'), reviewController.reassignInactive);
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
// Superusers delete a single entry, or a single review (the entry is then decided again).
contest.post('/submissions/:submissionId(\\d+)/delete', requireEventWide('deleteAnything'), submissionController.destroy);
contest.post('/submissions/:submissionId(\\d+)/reviews/:reviewId(\\d+)/delete', requireEventWide('deleteAnything'), submissionController.destroyReview);
contest.post('/submissions/:submissionId(\\d+)/status', requirePermission('manageEvent'), submissionController.setStatus);
contest.post('/submissions/:submissionId(\\d+)/revalidate', requirePermission('manageEvent'), submissionController.revalidate);

router.use('/contest/:contestId(\\d+)', loadContest, contest);

// Series addresses go last so they never shadow app pages.
// No '*' here: Express 4 turns it into a wildcard that would swallow the wiki code.
const SLUG = '[a-z0-9][a-z0-9-]{0,79}';
// Making series: stewards, global sysops, local admins and superusers. One series is run by its
// organizers (a role on the series; the controller checks it); deleting one: superusers and Zury administrators.
router.get('/series', requirePermission('importEvents'), eventsController.manageSeries);
router.get('/series/new', requirePermission('importEvents'), eventsController.seriesForm);
router.post(`/series/:series(${SLUG})/:action(update)`, requireAuth, eventsController.seriesAction);
router.post(`/series/:series(${SLUG})/:action(delete)`, requirePermission('deleteAnyEvent'), eventsController.seriesAction);
router.get(`/series/:series(${SLUG})`, requireAuth, eventsController.manageOneSeries);
router.get(`/series/:series(${SLUG})/:edition(${SLUG})`, eventsController.manageEdition);
router.post('/series', requirePermission('importEvents'), eventsController.createSeries);
router.post(`/series/:series(${SLUG})/first-edition`, requireAuth, eventsController.firstEdition);
router.post(`/series/:series(${SLUG})/people`, requireAuth, eventsController.grantRole);
router.post(`/series/:series(${SLUG})/people/:id(\\d+)/remove`, requireAuth, eventsController.revokeRole);
router.post(`/series/:series(${SLUG})/settings`, requireAuth, eventsController.setLevelSetting);
router.post(`/series/:series(${SLUG})/settings/:id(\\d+)/remove`, requireAuth, eventsController.removeLevelSetting);
// Adding events to an edition from its page: from Fountain (importers only).
router.post(`/series/:series(${SLUG})/:edition(${SLUG})/fountain`, requirePermission('importEvents'), eventsController.editionFountain);
router.post(`/series/:series(${SLUG})/:action(archive|unarchive)`, requireAuth, eventsController.levelAction);
router.post(`/series/:series(${SLUG})/:edition(${SLUG})/:action(update|copy|archive|unarchive|delete)`, requireAuth, eventsController.levelAction);
router.post(`/:series(${SLUG})/next-edition`, requireAuth, eventsController.nextEdition);
router.get(`/:series(${SLUG})`, eventsController.series);
// An edition's own page, when the name under the series is an edition.
router.get(`/:series(${SLUG})/:edition(${SLUG})`, eventsController.editionPage);
// Every event address (/events/<slug>, /<series>/<slug>, /<series>/<edition>/<slug>, each
// with an optional /<wiki code> and a page), looked up by the event's stored address.
router.use(eventAddresses(contest));

module.exports = router;
