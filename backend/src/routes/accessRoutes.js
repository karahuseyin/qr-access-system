'use strict';

const express           = require('express');
const router            = express.Router();
const AccessController  = require('../controllers/accessController');

// POST /api/access/verify
router.post('/verify', AccessController.verify);

module.exports = router;
