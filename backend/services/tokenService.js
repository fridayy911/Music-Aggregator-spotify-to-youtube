const axios = require('axios');
const config = require('../config');

// 5-minute safety buffer before token expiration to refresh proactively
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Returns a valid access token for the given provider ('spotify' or 'youtube').
 * If the access token is missing or expired/expiring within 5 minutes, it refreshes
 * the token using the refresh_token. If refresh fails, it cleans up session state
 * and throws an error with statusCode = 401.
 *
 * @param {import('express').Request} req
 * @param {'spotify' | 'youtube'} provider
 * @returns {Promise<string>} Valid access token
 */
async function getValidToken(req, provider) {
  if (!req.session || !req.session.tokens || !req.session.tokens[provider]) {
    const error = new Error(`No active session found for ${provider}. Please connect your account.`);
    error.statusCode = 401;
    throw error;
  }

  const tokenData = req.session.tokens[provider];
  if (!tokenData.accessToken) {
    const error = new Error(`No access token for ${provider}. Please re-authenticate.`);
    error.statusCode = 401;
    throw error;
  }

  const now = Date.now();
  const expiresAt = tokenData.expiresAt || 0;
  const isExpiring = now >= (expiresAt - REFRESH_BUFFER_MS);

  // If token is still fresh, return it directly
  if (!isExpiring) {
    return tokenData.accessToken;
  }

  // If token is expiring and no refresh token exists, clear session and throw 401
  if (!tokenData.refreshToken) {
    delete req.session.tokens[provider];
    const error = new Error(`Session expired for ${provider} and no refresh token is available.`);
    error.statusCode = 401;
    throw error;
  }

  // Refresh token with the provider
  try {
    if (provider === 'spotify') {
      const basicAuth = Buffer.from(
        `${config.spotify.clientId}:${config.spotify.clientSecret}`
      ).toString('base64');

      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokenData.refreshToken
      });

      const response = await axios.post('https://accounts.spotify.com/api/token', params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basicAuth}`
        }
      });

      tokenData.accessToken = response.data.access_token;
      tokenData.expiresAt = Date.now() + (response.data.expires_in * 1000);
      if (response.data.refresh_token) {
        tokenData.refreshToken = response.data.refresh_token;
      }
    } else if (provider === 'youtube') {
      const params = new URLSearchParams({
        client_id: config.youtube.clientId,
        client_secret: config.youtube.clientSecret,
        refresh_token: tokenData.refreshToken,
        grant_type: 'refresh_token'
      });

      const response = await axios.post('https://oauth2.googleapis.com/token', params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      tokenData.accessToken = response.data.access_token;
      tokenData.expiresAt = Date.now() + (response.data.expires_in * 1000);
      if (response.data.refresh_token) {
        tokenData.refreshToken = response.data.refresh_token;
      }
    } else {
      const error = new Error(`Unknown provider: ${provider}`);
      error.statusCode = 400;
      throw error;
    }

    // Save session after token update
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    return tokenData.accessToken;
  } catch (refreshErr) {
    // If refresh fails, clear the provider token from session
    if (req.session.tokens && req.session.tokens[provider]) {
      delete req.session.tokens[provider];
      await new Promise((resolve) => req.session.save(() => resolve()));
    }

    const error = new Error(`Token refresh failed for ${provider}. Please reconnect.`);
    error.statusCode = 401;
    throw error;
  }
}

/**
 * Middleware factory requiring a valid token for a given provider.
 * Extracts a fresh access token and attaches it to req.providerToken.
 * Returns HTTP 401 with reconnect prompt if unavailable or refresh fails.
 *
 * @param {'spotify' | 'youtube'} provider
 */
function requireProvider(provider) {
  return async (req, res, next) => {
    try {
      const token = await getValidToken(req, provider);
      req.providerToken = token;
      next();
    } catch (err) {
      return res.status(err.statusCode || 401).json({
        error: err.message,
        reconnectRequired: true,
        provider
      });
    }
  };
}

module.exports = {
  getValidToken,
  requireProvider
};
