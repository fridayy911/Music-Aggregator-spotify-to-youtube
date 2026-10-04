const express = require('express');
const axios = require('axios');
const config = require('../config');

const router = express.Router();

// Generate YouTube Auth URL
router.get('/auth-url', (req, res) => {
  const scopes = [
    'https://www.googleapis.com/auth/youtube'
  ];
  
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${config.youtube.clientId}&redirect_uri=${encodeURIComponent(config.youtube.redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes.join(' '))}&access_type=offline&prompt=consent`;
  
  res.json({ authUrl });
});

module.exports = router;