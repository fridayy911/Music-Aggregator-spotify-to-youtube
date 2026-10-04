import axios from 'axios';

// Note: Nothing in a React bundle is secret. All REACT_APP_* variables are embedded at build time into the client JS bundle.
const baseURL = process.env.REACT_APP_API_URL;

if (!baseURL && process.env.NODE_ENV !== 'production') {
  throw new Error(
    'REACT_APP_API_URL is missing. Please set REACT_APP_API_URL in frontend/.env.development (e.g. http://127.0.0.1:5000).'
  );
}

// Create an axios instance that communicates with backend using session cookies
const API = axios.create({
  baseURL,
  withCredentials: true
});

const api = {
  client: API,
  getBaseURL: () => baseURL,

  // AUTH FUNCTIONS
  auth: {
    // Check if session has active Spotify/YouTube connections
    getStatus: () => API.get('/api/auth/status'),
    // Disconnect / logout provider
    logout: (provider) => API.post(`/api/auth/logout/${provider}`),
    // Direct navigation URL for OAuth login
    getLoginUrl: (provider) => `${baseURL}/auth/${provider}/login`
  },

  // SPOTIFY FUNCTIONS
  spotify: {
    // Get all user playlists with pagination
    getPlaylists: () => API.get('/api/spotify/playlists'),
    // Get tracks for a playlist
    getTracks: (playlistId) => API.get(`/api/spotify/playlists/${encodeURIComponent(playlistId)}/tracks`)
  },

  // PLAYLIST TRANSFER FUNCTIONS
  playlist: {
    // Transfer playlist from Spotify to YouTube (or resume an existing transfer)
    transfer: (data) => API.post('/api/playlist/transfer', data)
  }
};

export default api;
