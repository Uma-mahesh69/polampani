// SQLite storage using Node's built-in driver (no native build step).
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { DB_PATH } = require('./config');

const SCHEMA_VERSION = 2;

if (DB_PATH !== ':memory:') fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');

const SCHEMA = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('farmer', 'worker')),
  name TEXT NOT NULL,
  phone TEXT UNIQUE,
  village TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  skills TEXT NOT NULL DEFAULT '[]',
  available INTEGER NOT NULL DEFAULT 1,
  available_days TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
  daily_wage INTEGER NOT NULL DEFAULT 500,
  radius_km REAL NOT NULL DEFAULT 20,
  rating REAL NOT NULL DEFAULT 4.0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  jobs_done INTEGER NOT NULL DEFAULT 0,
  no_shows INTEGER NOT NULL DEFAULT 0,
  upi_id TEXT,
  about TEXT,
  lang TEXT NOT NULL DEFAULT 'te',
  verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farmer_id INTEGER NOT NULL REFERENCES users(id),
  work_type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  village TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  duration_days INTEGER NOT NULL DEFAULT 1,
  start_time TEXT NOT NULL DEFAULT '07:00',
  workers_needed INTEGER NOT NULL,
  wage INTEGER NOT NULL,
  facilities TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'filled', 'completed', 'cancelled')),
  notify_round INTEGER NOT NULL DEFAULT 0,
  last_dispatch_at TEXT,
  filled_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  cancel_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  worker_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'withdrawn', 'completed', 'no_show', 'cancelled')),
  checked_in_at TEXT,
  farmer_rating INTEGER,
  farmer_review TEXT,
  worker_rating INTEGER,
  amount INTEGER,
  paid INTEGER NOT NULL DEFAULT 0,
  paid_at TEXT,
  pay_method TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (job_id, worker_id)
);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  job_id INTEGER REFERENCES jobs(id),
  type TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  message TEXT NOT NULL,
  score REAL,
  features TEXT,
  responded TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  type TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE otps (
  phone TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 1,
  window_start TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE INDEX idx_users_role ON users(role, available);
CREATE INDEX idx_jobs_status ON jobs(status, date);
CREATE INDEX idx_jobs_farmer ON jobs(farmer_id);
CREATE INDEX idx_assign_job ON assignments(job_id);
CREATE INDEX idx_assign_worker ON assignments(worker_id, status);
CREATE INDEX idx_notif_user ON notifications(user_id, id);
CREATE INDEX idx_notif_job ON notifications(job_id, type);
CREATE INDEX idx_events_job ON job_events(job_id);
`;

function migrate() {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version === SCHEMA_VERSION) return;
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  if (tables.length) {
    // Databases from the v1 prototype only ever held seeded demo data, so we rebuild them.
    console.warn(`[db] Upgrading demo database from schema v${version} to v${SCHEMA_VERSION} (rebuilding).`);
    db.exec('PRAGMA foreign_keys = OFF');
    for (const t of tables) db.exec(`DROP TABLE IF EXISTS "${t.name}"`);
    db.exec('PRAGMA foreign_keys = ON');
  }
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}
migrate();

const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);

let depth = 0;
function tx(fn) {
  if (depth > 0) return fn();
  depth += 1;
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depth -= 1;
  }
}

const parseJSON = (s, dflt) => {
  try { return s ? JSON.parse(s) : dflt; } catch { return dflt; }
};

function hydrateUser(u) {
  if (!u) return null;
  return {
    ...u,
    skills: parseJSON(u.skills, []),
    available_days: parseJSON(u.available_days, []),
    available: !!u.available,
    verified: !!u.verified,
  };
}

const kvGet = (key) => get('SELECT value FROM kv WHERE key = ?', key)?.value ?? null;
const kvSet = (key, value) => run(
  'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value,
);

module.exports = { db, all, get, run, tx, hydrateUser, parseJSON, kvGet, kvSet, SCHEMA_VERSION };
