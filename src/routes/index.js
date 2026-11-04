const express = require('express');
const homeController = require('../controllers/homeController');
const authController = require('../controllers/authController');

const router = express.Router();

// Meta-Wiki returns users to the registered callback (the site root) with these params.
router.get('/', (req, res, next) => {
  if (req.query.oauth_verifier && req.query.oauth_token) return authController.callback(req, res, next);
  return homeController.index(req, res, next);
});
// There is no About page any more; old links go home.
router.get('/about', (req, res) => res.redirect(301, '/'));

module.exports = router;
