const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const config = require('../config');

const router = express.Router();

/**
 * SPOTIFY OAUTH FLOW
 */

// Step 1: Redirect to Spotify authorization screen
router.get('/spotify/login', (req, res) => {
  // Generate a cryptographically secure random state parameter to mitigate CSRF attacks
  const state = crypto.randomBytes(16).toString('hex');
  req.session.spotifyState = state;

  const scopes = [
    'playlist-read-private',
    'playlist-read-collaborative',
    'user-read-private',
    'user-library-read'
  ].join(' ');
  const params = new URLSearchParams({
    client_id: config.spotify.clientId,
    response_type: 'code',
    redirect_uri: config.spotify.redirectUri,
    scope: scopes,
    show_dialog: 'true', // Forces Spotify to prompt and issue tokens with newly added scopes
    state
  });

  req.session.save((err) => {
    if (err) {
      console.error('Session save error during Spotify login:', err.message);
      return res.redirect(`${config.frontendUrl}?error=session_error`);
    }
    res.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
  });
});

// Step 2: Handle Spotify authorization callback
router.get('/spotify/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.error('Spotify OAuth error returned:', error);
    return res.redirect(`${config.frontendUrl}?error=${encodeURIComponent(error)}`);
  }

  // Validate state parameter to protect against CSRF and login injection
  if (!state || !req.session.spotifyState || state !== req.session.spotifyState) {
    console.error('Spotify OAuth state mismatch. Expected:', req.session.spotifyState ? '[set]' : '[unset]');
    delete req.session.spotifyState;
    return res.status(403).redirect(`${config.frontendUrl}?error=state_mismatch`);
  }

  delete req.session.spotifyState;

  if (!code) {
    return res.redirect(`${config.frontendUrl}?error=missing_code`);
  }

  try {
    const basicAuth = Buffer.from(
      `${config.spotify.clientId}:${config.spotify.clientSecret}`
    ).toString('base64');

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.spotify.redirectUri
    });

    const response = await axios.post('https://accounts.spotify.com/api/token', params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`
      }
    });

    if (!req.session.tokens) {
      req.session.tokens = {};
    }

    // Store tokens securely in server-side session. Tokens never touch frontend URLs or localStorage.
    req.session.tokens.spotify = {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresAt: Date.now() + (response.data.expires_in * 1000)
    };

    req.session.save((err) => {
      if (err) {
        console.error('Session save error after Spotify token exchange:', err.message);
        return res.redirect(`${config.frontendUrl}?error=session_error`);
      }
      res.redirect(`${config.frontendUrl}?connected=spotify`);
    });
  } catch (tokenErr) {
    console.error('Spotify token exchange failed:', tokenErr.response?.data || tokenErr.message);
    res.redirect(`${config.frontendUrl}?error=auth_failed`);
  }
});

/**
 * YOUTUBE / GOOGLE OAUTH FLOW
 */

// Step 1: Redirect to Google authorization screen
router.get('/youtube/login', (req, res) => {
  // Generate a cryptographically secure random state parameter
  const state = crypto.randomBytes(16).toString('hex');
  req.session.youtubeState = state;

  const scopes = [
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.force-ssl'
  ].join(' ');
  const params = new URLSearchParams({
    client_id: config.youtube.clientId,
    redirect_uri: config.youtube.redirectUri,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline', // Essential for receiving a refresh_token from Google
    prompt: 'consent',      // Force consent screen to ensure refresh_token is re-issued
    state
  });

  req.session.save((err) => {
    if (err) {
      console.error('Session save error during YouTube login:', err.message);
      return res.redirect(`${config.frontendUrl}?error=session_error`);
    }
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });
});

// Step 2: Handle YouTube authorization callback
router.get('/youtube/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.error('YouTube OAuth error returned:', error);
    return res.redirect(`${config.frontendUrl}?error=${encodeURIComponent(error)}`);
  }

  // Validate state parameter to protect against CSRF
  if (!state || !req.session.youtubeState || state !== req.session.youtubeState) {
    console.error('YouTube OAuth state mismatch. Expected:', req.session.youtubeState ? '[set]' : '[unset]');
    delete req.session.youtubeState;
    return res.status(403).redirect(`${config.frontendUrl}?error=state_mismatch`);
  }

  delete req.session.youtubeState;

  if (!code) {
    return res.redirect(`${config.frontendUrl}?error=missing_code`);
  }

  try {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.youtube.clientId,
      client_secret: config.youtube.clientSecret,
      redirect_uri: config.youtube.redirectUri
    });

    const response = await axios.post('https://oauth2.googleapis.com/token', params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    if (!req.session.tokens) {
      req.session.tokens = {};
    }

    // Store tokens securely in server-side session
    req.session.tokens.youtube = {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresAt: Date.now() + (response.data.expires_in * 1000)
    };

    req.session.save((err) => {
      if (err) {
        console.error('Session save error after YouTube token exchange:', err.message);
        return res.redirect(`${config.frontendUrl}?error=session_error`);
      }
      res.redirect(`${config.frontendUrl}?connected=youtube`);
    });
  } catch (tokenErr) {
    console.error('YouTube token exchange failed:', tokenErr.response?.data || tokenErr.message);
    res.redirect(`${config.frontendUrl}?error=auth_failed`);
  }
});

module.exports = router;
