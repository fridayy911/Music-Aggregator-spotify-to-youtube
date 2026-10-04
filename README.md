# 🎵 Music Aggregator

A full-stack web application to securely transfer playlists from Spotify to YouTube Music.

## ✨ Features & Architecture

- **Session-Based OAuth Authentication**: Express session with `httpOnly` secure cookies. Provider tokens (`access_token`, `refresh_token`, and `expires_at`) reside strictly on the server and are never exposed to browser `localStorage`, client bundles, query strings, or API responses.
- **CSRF Protection**: All OAuth flows utilize cryptographically secure random `state` parameters generated and verified per session.
- **Proactive Token Refresh**: Backend automatically checks token expiration before API calls (with a 5-minute pre-expiration buffer) and refreshes tokens automatically without interrupting user flow. Expired sessions gracefully return HTTP 401 with reconnect prompts.
- **Paginated Spotify Library**: Loads the complete library of user playlists beyond the default 20-item limit.
- **Resilient Transfer Pipeline**:
  - Automatically creates a new YouTube playlist (`<Title> (Imported)`).
  - Searches YouTube for matching tracks (`<Track Name> <Artist Name>`) and adds them to the playlist.
  - Gracefully tracks unmatched tracks (`{ reason: "not_found" }`) in an expandable summary without crashing the transfer.
  - Detects YouTube Data API quota exhaustion (`403 quotaExceeded`), preserves transfer state, and supports one-click resumption using the existing playlist ID.

---

## 🚀 Local Development Setup

### Prerequisites
- Node.js (v18+)
- npm

### 1. Configure Backend Environment
Copy the example environment file and fill in your OAuth credentials:
```bash
cp backend/.env.example backend/.env
```
Edit `backend/.env`:
```env
PORT=5000
FRONTEND_URL=http://127.0.0.1:3000
BACKEND_URL=http://127.0.0.1:5000
SESSION_SECRET=your_super_secret_session_key_here

SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:5000/auth/spotify/callback

YOUTUBE_CLIENT_ID=your_youtube_client_id
YOUTUBE_CLIENT_SECRET=your_youtube_client_secret
YOUTUBE_REDIRECT_URI=http://127.0.0.1:5000/auth/youtube/callback
```
> **Note on Origins**: Always use `127.0.0.1` consistently for both frontend (`http://127.0.0.1:3000`) and backend (`http://127.0.0.1:5000`) to ensure session cookies are treated as same-site.

### 2. Configure Frontend Environment
Copy the frontend environment template:
```bash
cp frontend/.env.example frontend/.env.development
```
`frontend/.env.development` contains:
```env
REACT_APP_API_URL=http://127.0.0.1:5000
HOST=127.0.0.1
PORT=3000
```

### 3. Install & Start Applications

**Backend:**
```bash
cd backend
npm install
npm run dev
# Server will run on http://127.0.0.1:5000
```

**Frontend:**
```bash
cd frontend
npm install
npm start
# App will open at http://127.0.0.1:3000
```

---

## 🔑 OAuth Provider Registration

### 1. Spotify Developer Dashboard
1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Log in and create an app.
3. In App Settings, add the following **Redirect URI**:
   - `http://127.0.0.1:5000/auth/spotify/callback`
4. Copy the **Client ID** and **Client Secret** into `backend/.env`.

### 2. Google Cloud Console (YouTube Data API v3)
1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project.
3. Enable the **YouTube Data API v3** in *APIs & Services > Library*.
4. Configure the **OAuth Consent Screen** (External, add test user emails).
5. In *APIs & Services > Credentials*, create **OAuth 2.0 Client IDs** (Web application).
6. Under **Authorized redirect URIs**, add:
   - `http://127.0.0.1:5000/auth/youtube/callback`
7. Copy the **Client ID** and **Client Secret** into `backend/.env`.

---

## 🧪 Manual End-to-End Verification Guide

1. **Verify Authentication & CSRF Protection**:
   - Open `http://127.0.0.1:3000`. The dashboard displays connection status for both Spotify and YouTube.
   - Click **Connect Spotify**. Verify browser redirects to `https://accounts.spotify.com/authorize` with a unique `state` parameter.
   - Authorize Spotify; verify redirect to `http://127.0.0.1:5000/auth/spotify/callback`, which sets a secure cookie and redirects back to `http://127.0.0.1:3000?connected=spotify`.
   - Notice that the URL immediately cleans itself and the badge turns green: `✓ Spotify Connected`.
   - Click **Connect YouTube Music**. Verify Google consent screen redirects to `http://127.0.0.1:5000/auth/youtube/callback` and returns with `✓ YouTube Connected`.
2. **Verify Playlist Listing & Pagination**:
   - Spotify playlists are automatically fetched and displayed as interactive cards.
   - Accounts with more than 20 playlists load all playlists seamlessly through automatic pagination.
3. **Execute Playlist Transfer**:
   - Click on any playlist card to select it.
   - Click **🚀 Transfer "[Playlist Name]" to YouTube**.
   - Watch the active progress counter (`Transferred X of Y tracks...`) and progress bar update.
4. **Inspect Transfer Summary**:
   - Upon completion, the summary card presents:
     - Direct button linking to the newly created YouTube playlist (`https://www.youtube.com/playlist?list=...`).
     - Count of successfully transferred tracks.
     - An expandable **Unmatched Tracks** accordion detailing any songs not found on YouTube.
5. **Verify Quota Handling & Resume**:
   - If YouTube Data API quota is reached during a large transfer, the UI automatically transitions to the pause screen:
     - Shows the number of tracks transferred so far and a link to view the partial YouTube playlist.
     - Displays a **🔄 Resume Transfer** button. Clicking this button sends `destinationPlaylistId` and `startIndex` back to `/api/playlist/transfer` to resume without duplicating songs.
