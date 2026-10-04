const path = require('path');
const dotenv = require('dotenv');

// Load environment variables once from backend/.env (allowing .env to override shell defaults in local dev)
dotenv.config({ path: path.resolve(__dirname, '.env'), override: true });

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

// List of required environment variables for the application
const requiredVariables = [
  'FRONTEND_URL',
  'BACKEND_URL',
  'SESSION_SECRET',
  'SPOTIFY_CLIENT_ID',
  'SPOTIFY_CLIENT_SECRET',
  'SPOTIFY_REDIRECT_URI',
  'YOUTUBE_CLIENT_ID',
  'YOUTUBE_CLIENT_SECRET',
  'YOUTUBE_REDIRECT_URI'
];

// DATABASE_URL is required in production for persistent session storage with connect-mongo
if (isProduction) {
  requiredVariables.push('DATABASE_URL');
}

const missingVariables = requiredVariables.filter((name) => {
  const value = process.env[name];
  return value === undefined || value === null || String(value).trim() === '';
});

if (missingVariables.length > 0) {
  console.error('FATAL: Missing required environment variable(s):');
  for (const name of missingVariables) {
    console.error(`  - ${name}`);
  }
  process.exit(1);
}

/**
 * Validated, typed configuration object.
 * All environment variables are accessed strictly through this export.
 */
const config = Object.freeze({
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv,
  isProduction,
  frontendUrl: (process.env.FRONTEND_URL || '').replace(/\/+$/, ''),
  backendUrl: (process.env.BACKEND_URL || '').replace(/\/+$/, ''),
  sessionSecret: process.env.SESSION_SECRET,
  spotify: Object.freeze({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI
  }),
  youtube: Object.freeze({
    clientId: process.env.YOUTUBE_CLIENT_ID,
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
    redirectUri: process.env.YOUTUBE_REDIRECT_URI
  }),
  databaseUrl: process.env.DATABASE_URL || ''
});

module.exports = config;
