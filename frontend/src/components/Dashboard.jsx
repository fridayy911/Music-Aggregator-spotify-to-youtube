import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import '../styles/Dashboard.css';

function Dashboard() {
  const [authStatus, setAuthStatus] = useState({ spotify: false, youtube: false });
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [expiredBanners, setExpiredBanners] = useState({ spotify: false, youtube: false });
  const [statusNotice, setStatusNotice] = useState(null);

  const [playlists, setPlaylists] = useState([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);

  const [transferState, setTransferState] = useState({
    status: 'idle', // 'idle' | 'transferring' | 'completed' | 'quota_exceeded' | 'error'
    transferred: 0,
    total: 0,
    result: null,
    error: null
  });

  const [showUnmatched, setShowUnmatched] = useState(false);

  // Fetch authentication status from backend session (no tokens in frontend)
  const fetchAuthStatus = useCallback(async () => {
    try {
      setLoadingAuth(true);
      const res = await api.auth.getStatus();
      setAuthStatus(res.data);
    } catch (err) {
      console.error('Failed to fetch auth status:', err.message);
    } finally {
      setLoadingAuth(false);
    }
  }, []);

  // Fetch Spotify playlists with automatic pagination
  const fetchPlaylists = useCallback(async () => {
    if (!authStatus.spotify) return;
    try {
      setLoadingPlaylists(true);
      const res = await api.spotify.getPlaylists();
      setPlaylists(res.data || []);
      // Clear any previous expired banner if request succeeded
      setExpiredBanners((prev) => ({ ...prev, spotify: false }));
    } catch (err) {
      console.error('Error fetching playlists:', err.response?.data || err.message);
      if (err.response?.status === 401) {
        setAuthStatus((prev) => ({ ...prev, spotify: false }));
        setExpiredBanners((prev) => ({ ...prev, spotify: true }));
        setPlaylists([]);
      } else {
        setStatusNotice({ type: 'error', message: err.response?.data?.error || 'Failed to fetch playlists' });
      }
    } finally {
      setLoadingPlaylists(false);
    }
  }, [authStatus.spotify]);

  // Handle URL query parameters from OAuth callbacks and clean URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connectedParam = params.get('connected');
    const errorParam = params.get('error');

    if (connectedParam) {
      const providerName = connectedParam === 'spotify' ? 'Spotify' : 'YouTube Music';
      setStatusNotice({ type: 'success', message: `Successfully connected ${providerName}!` });
      setExpiredBanners((prev) => ({ ...prev, [connectedParam]: false }));
    }

    if (errorParam) {
      let msg = `Authentication failed: ${errorParam}`;
      if (errorParam === 'state_mismatch') {
        msg = 'Authentication rejected due to state mismatch (security validation).';
      }
      setStatusNotice({ type: 'error', message: msg });
    }

    if (connectedParam || errorParam) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    fetchAuthStatus();
  }, [fetchAuthStatus]);

  // Trigger playlist fetch whenever Spotify authentication becomes active
  useEffect(() => {
    if (authStatus.spotify) {
      fetchPlaylists();
    } else {
      setPlaylists([]);
      setSelectedPlaylist(null);
    }
  }, [authStatus.spotify, fetchPlaylists]);

  // Handle direct navigation to backend OAuth routes
  const handleConnect = (provider) => {
    window.location.href = api.auth.getLoginUrl(provider);
  };

  // Handle provider logout
  const handleDisconnect = async (provider) => {
    try {
      await api.auth.logout(provider);
      setAuthStatus((prev) => ({ ...prev, [provider]: false }));
      if (provider === 'spotify') {
        setPlaylists([]);
        setSelectedPlaylist(null);
      }
      setStatusNotice({
        type: 'info',
        message: `Disconnected ${provider === 'spotify' ? 'Spotify' : 'YouTube Music'}.`
      });
    } catch (err) {
      console.error(`Logout failed for ${provider}:`, err);
    }
  };

  // Execute transfer (or resume an existing transfer)
  const executeTransfer = async ({ destinationPlaylistId = null, startIndex = 0 } = {}) => {
    if (!selectedPlaylist) {
      setStatusNotice({ type: 'error', message: 'Please select a Spotify playlist first.' });
      return;
    }

    const totalTracks = selectedPlaylist.tracks?.total || selectedPlaylist.items?.total || 0;

    setTransferState({
      status: 'transferring',
      transferred: startIndex,
      total: totalTracks,
      result: null,
      error: null
    });
    setShowUnmatched(false);

    try {
      const response = await api.playlist.transfer({
        playlistId: selectedPlaylist.id,
        playlistName: selectedPlaylist.name,
        destinationPlaylistId,
        startIndex
      });

      const data = response.data;

      if (data.status === 'quota_exceeded') {
        setTransferState({
          status: 'quota_exceeded',
          transferred: data.transferredCount,
          total: data.total,
          result: data,
          error: null
        });
      } else {
        setTransferState({
          status: 'completed',
          transferred: data.transferredCount,
          total: data.total,
          result: data,
          error: null
        });
      }
    } catch (err) {
      console.error('Transfer error:', err.response?.data || err.message);

      if (err.response?.status === 401) {
        const prov = err.response?.data?.provider || 'youtube';
        setAuthStatus((prev) => ({ ...prev, [prov]: false }));
        setExpiredBanners((prev) => ({ ...prev, [prov]: true }));
        setTransferState({
          status: 'error',
          transferred: 0,
          total: 0,
          result: null,
          error: `${prov === 'spotify' ? 'Spotify' : 'YouTube'} session expired. Please reconnect.`
        });
      } else {
        const data = err.response?.data;
        let errorMessage = 'Transfer failed. Please check network or try again.';
        if (typeof data?.error === 'string') {
          errorMessage = data.error;
        } else if (typeof data?.message === 'string') {
          errorMessage = data.message;
        } else if (typeof data?.error?.message === 'string') {
          errorMessage = data.error.message;
        } else if (typeof err.message === 'string') {
          errorMessage = err.message;
        }

        setTransferState({
          status: 'error',
          transferred: 0,
          total: 0,
          result: null,
          error: errorMessage,
          details: data?.details || (typeof data === 'object' ? data : null)
        });
      }
    }
  };

  const handleStartTransfer = () => {
    executeTransfer({ destinationPlaylistId: null, startIndex: 0 });
  };

  const handleResumeTransfer = () => {
    if (!transferState.result) return;
    executeTransfer({
      destinationPlaylistId: transferState.result.destinationPlaylistId,
      startIndex: transferState.result.transferredCount || 0
    });
  };

  const handleResetTransfer = () => {
    setTransferState({
      status: 'idle',
      transferred: 0,
      total: 0,
      result: null,
      error: null
    });
    setShowUnmatched(false);
  };

  return (
    <div className="dashboard">
      <h1>🎵 Music Aggregator</h1>
      <p className="subtitle">Securely transfer your Spotify playlists to YouTube Music</p>

      {/* Status or Alert Notification */}
      {statusNotice && (
        <div className={`status-banner status-${statusNotice.type}`}>
          <span>{statusNotice.message}</span>
          <button className="banner-close-btn" onClick={() => setStatusNotice(null)}>×</button>
        </div>
      )}

      {/* Reconnect Banners when 401 occurs */}
      {expiredBanners.spotify && (
        <div className="session-expired-banner">
          <span>⚠️ Spotify session expired. Reconnect to access your playlists.</span>
          <a href={api.auth.getLoginUrl('spotify')} className="btn-reconnect">
            Reconnect Spotify
          </a>
        </div>
      )}

      {expiredBanners.youtube && (
        <div className="session-expired-banner">
          <span>⚠️ YouTube Music session expired. Reconnect to transfer playlists.</span>
          <a href={api.auth.getLoginUrl('youtube')} className="btn-reconnect">
            Reconnect YouTube
          </a>
        </div>
      )}

      {/* Auth Connections Section */}
      <div className="auth-section">
        {loadingAuth ? (
          <p className="loading-text">Checking authentication status...</p>
        ) : (
          <>
            <div className="provider-card">
              {!authStatus.spotify ? (
                <button onClick={() => handleConnect('spotify')} className="btn btn-spotify">
                  🎶 Connect Spotify
                </button>
              ) : (
                <div className="connected-group">
                  <span className="connected">✓ Spotify Connected</span>
                  <button onClick={() => handleDisconnect('spotify')} className="btn-disconnect">
                    Disconnect
                  </button>
                </div>
              )}
            </div>

            <div className="provider-card">
              {!authStatus.youtube ? (
                <button onClick={() => handleConnect('youtube')} className="btn btn-youtube">
                  ▶ Connect YouTube Music
                </button>
              ) : (
                <div className="connected-group">
                  <span className="connected">✓ YouTube Connected</span>
                  <button onClick={() => handleDisconnect('youtube')} className="btn-disconnect">
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Transfer In-Progress Screen */}
      {transferState.status === 'transferring' && (
        <div className="transfer-card in-progress">
          <h2>Transferring Playlist...</h2>
          <p className="transfer-subtitle">
            Matching tracks and creating YouTube playlist: <strong>{selectedPlaylist?.name}</strong>
          </p>
          <div className="progress-section">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: transferState.total > 0
                    ? `${Math.min(100, Math.round((transferState.transferred / transferState.total) * 100))}%`
                    : '50%'
                }}
              />
            </div>
            <p className="progress-counter">
              Transferred {transferState.transferred} of {transferState.total || '?'} tracks...
            </p>
          </div>
        </div>
      )}

      {/* Quota Exceeded Pause Screen */}
      {transferState.status === 'quota_exceeded' && transferState.result && (
        <div className="transfer-card quota-card">
          <h2>⏸️ Transfer Paused (YouTube Quota Limit)</h2>
          <p className="quota-explanation">
            YouTube Data API daily quota limit was reached. Your progress is saved!{' '}
            <strong>{transferState.result.transferredCount}</strong> tracks have been added to your YouTube playlist.
          </p>
          {transferState.result.destinationPlaylistId && (
            <p>
              <a
                href={`https://www.youtube.com/playlist?list=${transferState.result.destinationPlaylistId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="destination-link"
              >
                View Playlist on YouTube ↗
              </a>
            </p>
          )}

          <div className="card-actions">
            <button onClick={handleResumeTransfer} className="btn btn-resume">
              🔄 Resume Transfer
            </button>
            <button onClick={handleResetTransfer} className="btn btn-secondary">
              Transfer Another Playlist
            </button>
          </div>
        </div>
      )}

      {/* Transfer Completed Summary Screen */}
      {transferState.status === 'completed' && transferState.result && (
        <div className="transfer-card summary-card">
          <h2>🎉 Transfer Complete!</h2>
          <p className="summary-status">
            Successfully transferred <strong>{transferState.result.transferredCount}</strong> of{' '}
            <strong>{transferState.result.total}</strong> tracks.
          </p>

          {transferState.result.destinationPlaylistId && (
            <div className="link-wrapper">
              <a
                href={`https://www.youtube.com/playlist?list=${transferState.result.destinationPlaylistId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-view-playlist"
              >
                ▶ Open in YouTube Music / YouTube
              </a>
            </div>
          )}

          {/* Unmatched Tracks Accordion */}
          {transferState.result.failedTracks && transferState.result.failedTracks.length > 0 && (
            <div className="unmatched-section">
              <button
                className="accordion-toggle"
                onClick={() => setShowUnmatched((prev) => !prev)}
              >
                {showUnmatched ? '▼' : '▶'} Unmatched Tracks ({transferState.result.failedTracks.length})
              </button>
              {showUnmatched && (
                <div className="unmatched-list">
                  <p className="unmatched-description">
                    The following tracks could not be matched on YouTube:
                  </p>
                  <ul>
                    {transferState.result.failedTracks.map((item, idx) => (
                      <li key={idx} className="unmatched-item">
                        <span className="unmatched-title">"{item.track}"</span> by{' '}
                        <span className="unmatched-artist">{item.artist}</span>
                        {item.reason && item.reason !== 'not_found' && (
                          <span className="unmatched-reason"> ({item.reason})</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="card-actions">
            <button onClick={handleResetTransfer} className="btn btn-secondary">
              Transfer Another Playlist
            </button>
          </div>
        </div>
      )}

      {/* Transfer Error Screen */}
      {transferState.status === 'error' && (
        <div className="transfer-card error-card">
          <h2>⚠️ Transfer Failed</h2>
          <p className="error-message">
            {typeof transferState.error === 'string'
              ? transferState.error
              : JSON.stringify(transferState.error)}
          </p>
          {transferState.details && (
            <div className="error-details-box" style={{
              marginTop: '15px',
              padding: '12px 16px',
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '8px',
              textAlign: 'left',
              fontSize: '0.85rem'
            }}>
              <strong style={{ color: '#fca5a5', display: 'block', marginBottom: '6px' }}>Diagnostic Details:</strong>
              <pre style={{
                margin: 0,
                color: '#fee2e2',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: '160px',
                overflowY: 'auto'
              }}>
                {typeof transferState.details === 'string'
                  ? transferState.details
                  : JSON.stringify(transferState.details, null, 2)}
              </pre>
            </div>
          )}
          <div className="card-actions">
            <button onClick={handleStartTransfer} className="btn btn-resume">
              Retry Transfer
            </button>
            <button onClick={handleResetTransfer} className="btn btn-secondary">
              Back to Playlists
            </button>
          </div>
        </div>
      )}

      {/* Playlist Selection & Transfer Action (Visible when idle) */}
      {transferState.status === 'idle' && (
        <>
          {authStatus.spotify ? (
            <div className="playlist-section">
              <h2>Select a Spotify Playlist to Transfer</h2>
              {loadingPlaylists ? (
                <p className="loading-text">Loading your Spotify playlists...</p>
              ) : playlists.length > 0 ? (
                <div className="playlist-list">
                  {playlists.map((playlist) => {
                    const trackCount = playlist.tracks?.total || playlist.items?.total || 0;
                    const isSelected = selectedPlaylist?.id === playlist.id;
                    return (
                      <div
                        key={playlist.id}
                        className={`playlist-item ${isSelected ? 'selected' : ''}`}
                        onClick={() => setSelectedPlaylist(playlist)}
                      >
                        <h3>{playlist.name}</h3>
                        <p>
                          {trackCount} track{trackCount === 1 ? '' : 's'}
                          {playlist.owner?.display_name ? ` • by ${playlist.owner.display_name}` : ''}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="empty-notice">No playlists found in your Spotify account.</p>
              )}

              {selectedPlaylist && (
                <div className="action-area">
                  {!authStatus.youtube ? (
                    <div className="connect-prompt">
                      <p>Connect your YouTube Music account to transfer "{selectedPlaylist.name}"</p>
                      <button onClick={() => handleConnect('youtube')} className="btn btn-youtube">
                        ▶ Connect YouTube Music
                      </button>
                    </div>
                  ) : (
                    <button onClick={handleStartTransfer} className="btn btn-transfer">
                      🚀 Transfer "{selectedPlaylist.name}" to YouTube
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="welcome-prompt">
              <p>Connect your Spotify account above to view and transfer your playlists.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default Dashboard;
