const express = require('express');
const demoController = require('../controllers/demoController');

const router = express.Router();

router.get('/demo', demoController.index);
router.post('/demo/login', demoController.login);

module.exports = router;
