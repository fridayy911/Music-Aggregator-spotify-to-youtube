const express = require('express');
const axios = require('axios');
const { getValidToken } = require('../services/tokenService');

const router = express.Router();

/**
 * Extracts a clear, user-friendly error explanation from either Spotify or YouTube API errors.
 */
function getApiErrorMessage(error, defaultMsg) {
  const url = error.config?.url || '';
  const status = error.response?.status;
  const errData = error.response?.data?.error;

  // Check if it's a Spotify error
  if (url.includes('spotify.com') || (errData && errData.status) || status === 403) {
    const spotifyStatus = errData?.status || status;
    const spotifyMsg = errData?.message || error.message;

    if (spotifyStatus === 403) {
      return "Spotify rejected access to this playlist (HTTP 403 Forbidden). Spotify only permits reading tracks for playlists that YOUR account created or collaborates on. If this is an editorial/algorithmic playlist (e.g., 'Discover Weekly', 'Top 50') or created by another user, Spotify restricts API access to it. Please select a playlist you personally created in your Spotify account, or ensure your account is added to 'Users and Access' in your Spotify Developer Dashboard.";
    }

    if (spotifyStatus === 404) {
      return 'Spotify playlist not found. Please verify the playlist still exists.';
    }

    return `Spotify error (${spotifyStatus}): ${spotifyMsg || defaultMsg}`;
  }

  // YouTube / Google Data API
  if (errData) {
    const firstError = (errData.errors && errData.errors[0]) || {};
    const reason = firstError.reason || '';
    const detailedMsg = firstError.message || errData.message;

    if (reason === 'youtubeSignupRequired') {
      return 'Your Google Account does not have an active YouTube channel yet. YouTube requires a channel to create and manage playlists. Please visit https://www.youtube.com, click your profile icon in the top right, select "Create a channel", and try transferring again.';
    }

    if (reason === 'accessNotConfigured' || (detailedMsg && detailedMsg.includes('has not been used in project'))) {
      return 'YouTube Data API v3 is not enabled in your Google Cloud Project. Please enable "YouTube Data API v3" in Google Cloud Console > APIs & Services > Library.';
    }

    if (reason === 'insufficientPermissions' || errData.status === 'PERMISSION_DENIED') {
      return 'Insufficient YouTube permissions. Please disconnect YouTube, reconnect, and ensure you check all permission boxes on the Google consent screen.';
    }

    if (reason === 'quotaExceeded' || reason === 'rateLimitExceeded') {
      return 'YouTube Data API quota exceeded for today.';
    }

    if (detailedMsg && detailedMsg !== 'Forbidden') {
      return detailedMsg;
    }

    if (reason) {
      return `YouTube error (${reason}): ${detailedMsg || defaultMsg}`;
    }
  }

  return error.message || defaultMsg;
}

/**
 * Checks if an axios error indicates a YouTube Data API quota exhaustion.
 */
function isYouTubeQuotaExceeded(error) {
  if (error.response?.status === 403) {
    const errorData = error.response.data?.error;
    const errors = errorData?.errors || [];
    const hasQuotaReason = errors.some(
      (e) => e.reason === 'quotaExceeded' || e.reason === 'rateLimitExceeded'
    );
    const message = (errorData?.message || '').toLowerCase();
    return hasQuotaReason || message.includes('quota') || errorData?.status === 'RESOURCE_EXHAUSTED';
  }
  return false;
}

/**
 * POST /api/playlist/transfer
 * Transfers a Spotify playlist to a YouTube playlist.
 *
 * Body:
 * {
 *   playlistId: string (required) - Spotify playlist ID
 *   playlistName?: string - Optional display name of playlist
 *   destinationPlaylistId?: string - Optional: YouTube playlist ID to resume transferring into
 *   startIndex?: number - Optional: Index of tracks to resume from
 * }
 */
router.post('/transfer', async (req, res) => {
  let spotifyToken;
  let youtubeToken;

  // Retrieve authenticated tokens from session with automatic refresh
  try {
    spotifyToken = await getValidToken(req, 'spotify');
  } catch (err) {
    return res.status(err.statusCode || 401).json({
      error: 'Spotify authentication required. Please connect your Spotify account.',
      provider: 'spotify',
      reconnectRequired: true
    });
  }

  try {
    youtubeToken = await getValidToken(req, 'youtube');
  } catch (err) {
    return res.status(err.statusCode || 401).json({
      error: 'YouTube authentication required. Please connect your YouTube account.',
      provider: 'youtube',
      reconnectRequired: true
    });
  }

  const { playlistId, playlistName, destinationPlaylistId: existingDestinationId, startIndex = 0 } = req.body;

  if (!playlistId) {
    return res.status(400).json({ error: 'playlistId is required' });
  }

  try {
    // 1. Fetch source playlist metadata and check ownership
    let sourceTitle = playlistName || 'Playlist';
    let playlistOwner = null;
    let playlistMeta = null;

    try {
      const metaRes = await axios.get(`https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}`, {
        headers: { Authorization: `Bearer ${spotifyToken}` }
      });
      playlistMeta = metaRes.data;
      if (playlistMeta?.name) sourceTitle = playlistMeta.name;
      playlistOwner = playlistMeta?.owner;
    } catch (metaErr) {
      console.warn('Could not fetch playlist metadata from Spotify:', metaErr.response?.data || metaErr.message);
    }

    // Check currently authenticated Spotify user
    let currentUser = null;
    try {
      const meRes = await axios.get('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${spotifyToken}` }
      });
      currentUser = meRes.data;
    } catch (meErr) {
      console.warn('Could not fetch current Spotify profile:', meErr.response?.data || meErr.message);
    }

    // Verify ownership: Spotify API forbids accessing track contents of third-party or algorithmic playlists
    if (playlistOwner && currentUser && playlistOwner.id && currentUser.id) {
      if (playlistOwner.id !== currentUser.id) {
        const ownerName = playlistOwner.display_name || playlistOwner.id;
        const currentName = currentUser.display_name || currentUser.id;
        return res.status(403).json({
          error: `Spotify restricts reading track lists from playlists you did not create. This playlist was created by "${ownerName}", but you are authenticated as "${currentName}". Spotify's Web API only returns track contents for playlists that you personally created or collaborate on. Please select a playlist you created in your Spotify account.`,
          provider: 'spotify',
          reason: 'not_playlist_owner',
          details: {
            playlistOwner: ownerName,
            currentUser: currentName
          }
        });
      }
    }

    // 2. Fetch all tracks from Spotify playlist (paginated)
    const allTracks = [];

    // First check if the playlist object already included the initial tracks
    const initialTracksObj = playlistMeta?.tracks || playlistMeta?.items;
    let nextTracksUrl = null;

    if (initialTracksObj?.items && Array.isArray(initialTracksObj.items) && initialTracksObj.items.length > 0) {
      for (const item of initialTracksObj.items) {
        const trackObj = item?.track || item?.item;
        if (trackObj && trackObj.name) {
          allTracks.push({
            id: trackObj.id,
            name: trackObj.name,
            artist: (trackObj.artists || []).map((a) => a.name).join(', ') || 'Unknown Artist'
          });
        }
      }
      nextTracksUrl = initialTracksObj.next;
    } else {
      nextTracksUrl = `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/items?limit=50`;
    }

    while (nextTracksUrl) {
      let pageRes;
      try {
        pageRes = await axios.get(nextTracksUrl, {
          headers: { Authorization: `Bearer ${spotifyToken}` }
        });
      } catch (spotifyErr) {
        if (spotifyErr.response?.status === 404 && nextTracksUrl.includes('/items')) {
          try {
            pageRes = await axios.get(nextTracksUrl.replace('/items', '/tracks'), {
              headers: { Authorization: `Bearer ${spotifyToken}` }
            });
          } catch (tracksErr) {
            console.error('Spotify API error fetching tracks fallback:', tracksErr.response?.data || tracksErr.message);
            const userMsg = getApiErrorMessage(tracksErr, 'Failed to fetch tracks from Spotify');
            return res.status(tracksErr.response?.status || 403).json({
              error: userMsg,
              provider: 'spotify',
              reason: 'spotify_tracks_error',
              details: tracksErr.response?.data?.error || tracksErr.response?.data || null
            });
          }
        } else {
          console.error('Spotify API error fetching playlist items:', spotifyErr.response?.data || spotifyErr.message);
          const userMsg = getApiErrorMessage(spotifyErr, 'Failed to fetch playlist items from Spotify');
          return res.status(spotifyErr.response?.status || 403).json({
            error: userMsg,
            provider: 'spotify',
            reason: spotifyErr.response?.status === 403 ? 'spotify_forbidden' : 'spotify_fetch_error',
            details: spotifyErr.response?.data?.error || spotifyErr.response?.data || null
          });
        }
      }

      const items = pageRes.data.items || [];
      for (const item of items) {
        const trackObj = item?.track || item?.item;
        if (trackObj && trackObj.name) {
          allTracks.push({
            id: trackObj.id,
            name: trackObj.name,
            artist: (trackObj.artists || []).map((a) => a.name).join(', ') || 'Unknown Artist'
          });
        }
      }

      nextTracksUrl = pageRes.data.next;
    }

    if (allTracks.length === 0) {
      return res.status(400).json({ error: 'Source playlist contains no tracks.' });
    }

    // 3. Create or reuse YouTube destination playlist
    let destinationPlaylistId = existingDestinationId;

    if (!destinationPlaylistId) {
      try {
        const createRes = await axios.post(
          'https://www.googleapis.com/youtube/v3/playlists?part=snippet,status',
          {
            snippet: {
              title: `${sourceTitle} (Imported)`,
              description: `Imported from Spotify playlist "${sourceTitle}" via Music Aggregator.`
            },
            status: {
              privacyStatus: 'private'
            }
          },
          {
            headers: {
              Authorization: `Bearer ${youtubeToken}`,
              'Content-Type': 'application/json'
            }
          }
        );

        destinationPlaylistId = createRes.data?.id;
      } catch (createErr) {
        if (isYouTubeQuotaExceeded(createErr)) {
          return res.status(200).json({
            status: 'quota_exceeded',
            sourcePlaylist: { id: playlistId, name: sourceTitle },
            destinationPlaylistId: null,
            total: allTracks.length,
            transferredCount: 0,
            transferred: 0,
            remainingTracks: allTracks,
            failedTracks: [],
            failed: [],
            message: 'YouTube API daily quota exceeded while attempting to create the destination playlist.'
          });
        }

        console.error('Error creating YouTube playlist:', createErr.response?.data || createErr.message);
        const userMsg = getApiErrorMessage(createErr, 'Failed to create YouTube destination playlist');
        return res.status(createErr.response?.status || 500).json({
          error: userMsg,
          provider: 'youtube',
          reason: createErr.response?.data?.error?.errors?.[0]?.reason || null,
          details: createErr.response?.data?.error || null
        });
      }
    }

    // 4. Iterate over tracks and add to YouTube playlist
    const transferredTracks = [];
    const failedTracks = [];
    const tracksToProcess = allTracks.slice(startIndex);

    for (let i = 0; i < tracksToProcess.length; i++) {
      const track = tracksToProcess[i];
      const currentIndex = startIndex + i;

      try {
        // Search YouTube for "<track name> <artist name>"
        const searchQuery = `${track.name} ${track.artist}`.trim();
        const searchRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
          headers: { Authorization: `Bearer ${youtubeToken}` },
          params: {
            part: 'snippet',
            q: searchQuery,
            type: 'video',
            maxResults: 1
          }
        });

        const items = searchRes.data?.items || [];
        const videoId = items[0]?.id?.videoId;

        if (!videoId) {
          failedTracks.push({
            track: track.name,
            artist: track.artist,
            reason: 'not_found'
          });
          continue;
        }

        // Insert video into destination playlist
        await axios.post(
          'https://www.googleapis.com/youtube/v3/playlistItems?part=snippet',
          {
            snippet: {
              playlistId: destinationPlaylistId,
              resourceId: {
                kind: 'youtube#video',
                videoId
              }
            }
          },
          {
            headers: {
              Authorization: `Bearer ${youtubeToken}`,
              'Content-Type': 'application/json'
            }
          }
        );

        transferredTracks.push({
          track: track.name,
          artist: track.artist,
          youtubeVideoId: videoId
        });
      } catch (trackErr) {
        if (isYouTubeQuotaExceeded(trackErr)) {
          console.warn(`YouTube quota exceeded at track index ${currentIndex} ("${track.name}")`);
          const remainingTracks = allTracks.slice(currentIndex);

          return res.status(200).json({
            status: 'quota_exceeded',
            sourcePlaylist: { id: playlistId, name: sourceTitle },
            destinationPlaylistId,
            total: allTracks.length,
            transferredCount: startIndex + transferredTracks.length,
            transferred: startIndex + transferredTracks.length,
            remainingTracks,
            failedTracks,
            failed: failedTracks,
            nextStartIndex: currentIndex,
            message: `YouTube API quota reached. Successfully transferred ${startIndex + transferredTracks.length} tracks. Transfer can be resumed later.`
          });
        }

        console.error(`Error processing track "${track.name}":`, trackErr.response?.data || trackErr.message);
        failedTracks.push({
          track: track.name,
          artist: track.artist,
          reason: getApiErrorMessage(trackErr, 'insert_error')
        });
      }
    }

    const totalTransferred = startIndex + transferredTracks.length;

    return res.json({
      status: 'completed',
      sourcePlaylist: { id: playlistId, name: sourceTitle },
      destinationPlaylistId,
      total: allTracks.length,
      transferredCount: totalTransferred,
      transferred: totalTransferred,
      remainingTracks: [],
      failedTracks,
      failed: failedTracks,
      message: `Transfer complete! Transferred ${totalTransferred} of ${allTracks.length} tracks to YouTube.`
    });
  } catch (error) {
    console.error('Playlist transfer error:', error.response?.data || error.message);
    const userMsg = getApiErrorMessage(error, 'Playlist transfer failed');
    const isSpotify = error.config?.url?.includes('spotify.com') || !!error.response?.data?.error?.status;
    res.status(error.response?.status || 500).json({
      error: userMsg,
      provider: isSpotify ? 'spotify' : 'youtube',
      reason: error.response?.data?.error?.errors?.[0]?.reason || error.response?.data?.error?.status || null,
      details: error.response?.data?.error || null
    });
  }
});

module.exports = router;
