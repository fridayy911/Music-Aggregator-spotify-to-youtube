const express = require('express');
const cors = require('cors');
const session = require('express-session');
const config = require('./config');

const app = express();

// Trust reverse proxy in production (e.g. Heroku, Cloud Run, nginx) for secure cookies
if (config.isProduction) {
  app.set('trust proxy', 1);
}

// CORS configuration - only allow requests from configured frontend URL
app.use(cors({
  origin: config.frontendUrl,
  credentials: true
}));

app.use(express.json());

// Express session setup:
// In development, uses MemoryStore (convenient, no external dependencies).
// In production, configure connect-mongo using config.databaseUrl to persist across restarts.
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: config.isProduction ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

app.get('/', (req, res) => {
  res.json({ message: 'Welcome to Music Aggregator Backend!' });
});

app.get('/test', (req, res) => {
  res.json({ message: 'Backend is working!' });
});

// OAuth initiation and callback routes: /auth/spotify/* and /auth/youtube/*
app.use('/auth', require('./routes/auth'));

// Auth session status and logout: /api/auth/status and /api/auth/logout/:provider
app.use('/api/auth', require('./routes/authApi'));

// Provider data routes
app.use('/api/spotify', require('./routes/spotify'));
app.use('/api/youtube', require('./routes/youtube'));
app.use('/api/playlist', require('./routes/playlist'));

app.listen(config.port, () => {
  console.log(`✓ Server running on ${config.backendUrl}`);
});
