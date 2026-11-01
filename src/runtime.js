// Runtime guards that must run before anything else is loaded.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`\nPolamPani needs Node.js 22.13 or newer. You have ${process.versions.node}.`);
  console.error('Install the current LTS from https://nodejs.org and run npm start again.\n');
  process.exit(1);
}

// Load .env if present (Node 21.7+ built-in, no dependency needed).
try {
  process.loadEnvFile(require('path').join(__dirname, '..', '.env'));
} catch { /* no .env file */ }

// Dates ("today", job days, weekdays) follow Indian Standard Time unless told otherwise,
// so a server hosted in UTC still agrees with farmers' phones after 6:30 pm IST.
if (!process.env.TZ) process.env.TZ = 'Asia/Kolkata';
