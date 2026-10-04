const express = require('express');

const router = express.Router();

/**
 * Returns current connection status for both providers.
 * Checked by frontend on load to determine whether user is logged in.
 */
router.get('/status', (req, res) => {
  const spotifyConnected = Boolean(req.session?.tokens?.spotify?.accessToken);
  const youtubeConnected = Boolean(req.session?.tokens?.youtube?.accessToken);

  res.json({
    spotify: spotifyConnected,
    youtube: youtubeConnected
  });
});

/**
 * Logs out of a specific provider by removing its tokens from the session.
 */
router.post('/logout/:provider', (req, res) => {
  const { provider } = req.params;

  if (provider !== 'spotify' && provider !== 'youtube') {
    return res.status(400).json({ error: 'Invalid provider. Must be spotify or youtube.' });
  }

  if (req.session?.tokens && req.session.tokens[provider]) {
    delete req.session.tokens[provider];
  }

  req.session.save((err) => {
    if (err) {
      console.error(`Error saving session on logout for ${provider}:`, err.message);
      return res.status(500).json({ error: 'Failed to complete logout' });
    }
    res.json({ success: true, provider, connected: false });
  });
});

module.exports = router;
