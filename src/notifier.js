// Notification hub: stores notifications, pushes them live over Server-Sent Events,
// and forwards them to an SMS gateway (any HTTP webhook) for workers without smartphones.
const { get, run } = require('./db');

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

function sms(userId, message) {
  const u = get('SELECT name, phone FROM users WHERE id = ?', userId);
  if (!u || !u.phone) return;
  if (process.env.SMS_WEBHOOK_URL) {
    fetch(process.env.SMS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: u.phone, name: u.name, message }),
    }).catch((e) => console.warn('[sms] webhook failed:', e.message));
  } else if (process.env.LOG_SMS) {
    console.log(`[sms] → ${u.phone} (${u.name}): ${message}`);
  }
}

function notify(userId, { type, job_id = null, message, score = null, features = null }) {
  const r = run(
    'INSERT INTO notifications (user_id, job_id, type, message, score, features) VALUES (?, ?, ?, ?, ?, ?)',
    userId, job_id, type, message, score, features ? JSON.stringify(features) : null,
  );
  const n = get('SELECT * FROM notifications WHERE id = ?', Number(r.lastInsertRowid));
  push(userId, { event: 'notification', notification: n });
  sms(userId, message);
  return n;
}

module.exports = { subscribe, push, broadcast, notify };
