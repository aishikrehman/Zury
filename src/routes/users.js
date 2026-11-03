const express = require('express');
const userController = require('../controllers/userController');

const router = express.Router();

router.get('/users/:username', userController.showProfile);

module.exports = router;
