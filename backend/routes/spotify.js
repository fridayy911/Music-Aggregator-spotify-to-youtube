const express = require('express');
const axios = require('axios');
const config = require('../config');
const { requireProvider } = require('../services/tokenService');

const router = express.Router();

/**
 * Generate Spotify Auth URL (legacy helper, prefer /auth/spotify/login)
 */
router.get('/auth-url', (req, res) => {
  const scopes = 'playlist-read-private playlist-read-collaborative';
  const authUrl = `https://accounts.spotify.com/authorize?client_id=${config.spotify.clientId}&response_type=code&redirect_uri=${encodeURIComponent(config.spotify.redirectUri)}&scope=${encodeURIComponent(scopes)}`;
  
  res.json({ authUrl });
});

/**
 * Fetch all Spotify playlists for the authenticated user with automatic pagination.
 * Loops through next page URLs until all playlists are retrieved (supporting > 20 playlists).
 */
router.get('/playlists', requireProvider('spotify'), async (req, res) => {
  const token = req.providerToken;

  try {
    const allPlaylists = [];
    let nextUrl = 'https://api.spotify.com/v1/me/playlists?limit=50';

    while (nextUrl) {
      const response = await axios.get(nextUrl, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      const items = response.data.items || [];
      allPlaylists.push(...items);

      nextUrl = response.data.next;
    }

    res.json(allPlaylists);
  } catch (error) {
    console.error('Spotify playlists error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.error?.message || 'Failed to fetch playlists'
    });
  }
});

/**
 * Fetch all tracks from a specific Spotify playlist with automatic pagination.
 * Uses /items (modern Spotify API) with fallback to /tracks.
 */
router.get('/playlists/:id/tracks', requireProvider('spotify'), async (req, res) => {
  const token = req.providerToken;
  const { id } = req.params;

  try {
    const tracks = [];
    let nextUrl = `https://api.spotify.com/v1/playlists/${encodeURIComponent(id)}/items?limit=50&additional_types=track`;

    while (nextUrl) {
      let response;
      try {
        response = await axios.get(nextUrl, {
          headers: { Authorization: `Bearer ${token}` }
        });
      } catch (itemsErr) {
        if (itemsErr.response?.status === 404 && nextUrl.includes('/items')) {
          response = await axios.get(nextUrl.replace('/items', '/tracks'), {
            headers: { Authorization: `Bearer ${token}` }
          });
        } else {
          throw itemsErr;
        }
      }

      const items = response.data.items || [];
      for (const item of items) {
        const trackObj = item?.track || item?.item;
        if (trackObj && trackObj.name) {
          tracks.push({
            id: trackObj.id,
            name: trackObj.name,
            artist: (trackObj.artists || []).map((a) => a.name).join(', ') || 'Unknown Artist',
            durationMs: trackObj.duration_ms
          });
        }
      }

      nextUrl = response.data.next;
    }

    res.json({ tracks, total: tracks.length });
  } catch (error) {
    console.error(`Spotify fetch tracks error for playlist ${id}:`, error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.error?.message || 'Failed to fetch playlist tracks'
    });
  }
});

module.exports = router;
