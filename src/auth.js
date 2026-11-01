// Phone + OTP authentication with stateless HMAC-signed tokens.
const crypto = require('crypto');
const { get, run, hydrateUser, kvGet, kvSet } = require('./db');
const config = require('./config');
const { HttpError } = require('./errors');

let secret = config.SESSION_SECRET;
function getSecret() {
  if (!secret) {
    secret = kvGet('session_secret');
    if (!secret) {
      secret = crypto.randomBytes(32).toString('hex');
      kvSet('session_secret', secret);
    }
  }
  return secret;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const hmac = (data) => crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');

function sign(payload, ttlSeconds = config.TOKEN_TTL_DAYS * 86400) {
  const body = b64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  return `${body}.${hmac(body)}`;
}

function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = hmac(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

// Accepts "9876543210", "+91 98765 43210", "09876543210" and returns "+919876543210".
function normalizePhone(input) {
  let d = String(input || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}

const hashCode = (phone, code) => crypto.createHash('sha256').update(`${phone}:${code}:${getSecret()}`).digest('hex');
const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

function requestOtp(rawPhone) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new HttpError(400, 'Enter a valid 10-digit Indian mobile number');
  const existing = get('SELECT * FROM otps WHERE phone = ?', phone);
  const windowFresh = existing && existing.window_start > sqlTime(Date.now() - 15 * 60 * 1000);
  if (windowFresh && existing.sent_count >= 5) throw new HttpError(429, 'Too many codes requested. Try again in 15 minutes.');
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const expires = sqlTime(Date.now() + config.OTP_TTL_MIN * 60 * 1000);
  run(
    `INSERT INTO otps (phone, code_hash, expires_at, attempts, sent_count, window_start)
     VALUES (?, ?, ?, 0, 1, datetime('now'))
     ON CONFLICT(phone) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0,
       sent_count = CASE WHEN ? THEN otps.sent_count + 1 ELSE 1 END,
       window_start = CASE WHEN ? THEN otps.window_start ELSE datetime('now') END`,
    phone, hashCode(phone, code), expires, windowFresh ? 1 : 0, windowFresh ? 1 : 0,
  );
  return { phone, code };
}

function verifyOtp(rawPhone, code) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new HttpError(400, 'Enter a valid 10-digit Indian mobile number');
  const row = get('SELECT * FROM otps WHERE phone = ?', phone);
  if (!row) throw new HttpError(400, 'Request a login code first');
  if (row.expires_at < sqlTime(Date.now())) throw new HttpError(400, 'This code has expired. Request a new one.');
  if (row.attempts >= 5) throw new HttpError(429, 'Too many wrong attempts. Request a new code.');
  if (hashCode(phone, String(code || '').trim()) !== row.code_hash) {
    run('UPDATE otps SET attempts = attempts + 1 WHERE phone = ?', phone);
    throw new HttpError(400, 'That code is not correct. Check the SMS and try again.');
  }
  run('DELETE FROM otps WHERE phone = ?', phone);
  const user = hydrateUser(get('SELECT * FROM users WHERE phone = ?', phone));
  if (user) {
    run('UPDATE users SET verified = 1 WHERE id = ?', user.id);
    return { token: sign({ uid: user.id }), user: { ...user, verified: true } };
  }
  return { signup_token: sign({ phone, signup: true }, 30 * 60), phone };
}

function tokenFrom(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return req.query?.token || null;
}

// Attaches req.user when a valid session token is present.
function authenticate(req, _res, next) {
  const payload = verify(tokenFrom(req));
  req.auth = payload;
  req.user = payload?.uid ? hydrateUser(get('SELECT * FROM users WHERE id = ?', payload.uid)) : null;
  next();
}

const requireUser = (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Please log in to continue')));
const requireRole = (role) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Please log in to continue'));
  if (req.user.role !== role) return next(new HttpError(403, `Only ${role}s can do this`));
  return next();
};

module.exports = { sign, verify, normalizePhone, requestOtp, verifyOtp, authenticate, requireUser, requireRole };
