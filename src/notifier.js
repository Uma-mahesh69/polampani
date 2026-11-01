// Notification hub: stores notifications, pushes them live over Server-Sent Events,
// and forwards them to an SMS gateway (any HTTP webhook) for workers without smartphones.
const { get, run } = require('./db');
const config = require('./config');
const { render } = require('./messages');

const clients = new Map(); // userId -> Set<res>

function subscribe(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
  return () => {
    const set = clients.get(userId);
    if (!set) return;
    set.delete(res);
    if (!set.size) clients.delete(userId);
  };
}

function send(res, payload) {
  try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch { /* client gone */ }
}

function push(userId, payload) {
  for (const res of clients.get(Number(userId)) || []) send(res, payload);
}

function broadcast(payload) {
  for (const set of clients.values()) for (const res of set) send(res, payload);
}

const connectedCount = () => clients.size;

function sms(user, text) {
  if (!user?.phone) return;
  if (config.SMS_WEBHOOK_URL) {
    fetch(config.SMS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: user.phone, name: user.name, message: text }),
    }).catch((e) => console.warn('[sms] webhook failed:', e.message));
  } else if (config.LOG_SMS) {
    console.log(`[sms] → ${user.phone} (${user.name}): ${text}`);
  }
}

function sendSms(phone, text) {
  sms({ phone, name: phone }, text);
}

function notify(userId, type, data = {}, { job_id = null, score = null, features = null, silent = false } = {}) {
  const user = get('SELECT id, name, phone, lang FROM users WHERE id = ?', userId);
  if (!user) return null;
  const r = run(
    'INSERT INTO notifications (user_id, job_id, type, data, message, score, features) VALUES (?, ?, ?, ?, ?, ?, ?)',
    userId, job_id, type, JSON.stringify(data), render(type, data, 'en'), score,
    features ? JSON.stringify(features) : null,
  );
  const n = get('SELECT * FROM notifications WHERE id = ?', Number(r.lastInsertRowid));
  n.data = data;
  if (!silent) {
    push(userId, { event: 'notification', notification: n });
    sms(user, render(type, data, user.lang));
  }
  return n;
}

module.exports = { subscribe, push, broadcast, notify, sendSms, connectedCount };
