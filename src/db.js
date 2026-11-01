// SQLite storage using Node's built-in driver (no native build step).
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'polampani.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('farmer', 'worker')),
  name TEXT NOT NULL,
  phone TEXT,
  village TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  skills TEXT NOT NULL DEFAULT '[]',
  available INTEGER NOT NULL DEFAULT 1,
  available_days TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
  daily_wage INTEGER NOT NULL DEFAULT 500,
  radius_km REAL NOT NULL DEFAULT 20,
  rating REAL NOT NULL DEFAULT 4.0,
  jobs_done INTEGER NOT NULL DEFAULT 0,
  lang TEXT NOT NULL DEFAULT 'te',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farmer_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT,
  work_type TEXT NOT NULL,
  description TEXT,
  village TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL DEFAULT '07:00',
  workers_needed INTEGER NOT NULL,
  wage INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  notify_round INTEGER NOT NULL DEFAULT 0,
  last_dispatch_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  worker_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'accepted',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (job_id, worker_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  job_id INTEGER REFERENCES jobs(id),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  score REAL,
  features TEXT,
  responded TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_job ON notifications(job_id);
CREATE INDEX IF NOT EXISTS idx_assign_job ON assignments(job_id);
`);

const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);

function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function hydrateUser(u) {
  if (!u) return null;
  return {
    ...u,
    skills: JSON.parse(u.skills || '[]'),
    available_days: JSON.parse(u.available_days || '[]'),
    available: !!u.available,
  };
}

module.exports = { db, all, get, run, tx, hydrateUser, DB_PATH };
