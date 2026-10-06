'use strict';

const express        = require('express');
const router         = express.Router();
const AuthController = require('../controllers/authController');

// POST /api/auth/register-device
router.post('/register-device', AuthController.registerDevice);

module.exports = router;
