require('./runtime');

const path = require('path');

const bool = (v, dflt) => (v == null || v === '' ? dflt : !['0', 'false', 'no', 'off'].includes(String(v).toLowerCase()));

module.exports = {
  PORT: Number(process.env.PORT || 3000),
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'polampani.db'),
  // Demo mode exposes one-tap demo accounts and returns OTP codes in the API response
  // (there is no SMS gateway during a hackathon). Turn it off in production.
  DEMO_MODE: bool(process.env.DEMO_MODE, true),
  SESSION_SECRET: process.env.SESSION_SECRET || null,
  TOKEN_TTL_DAYS: Number(process.env.TOKEN_TTL_DAYS || 30),
  OTP_TTL_MIN: 10,
  ESCALATE_AFTER_MIN: Number(process.env.ESCALATE_AFTER_MIN || 10),
  // Gemini API (free tier from Google AI Studio).
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || null,
  GEMINI_MODEL: (() => {
    const m = process.env.GEMINI_MODEL;
    // Map retired 2.0/legacy models to the current gemini-3.8-flash recommended by AI Studio
    if (!m || m.startsWith('gemini-2.') || m.startsWith('gemini-1.')) return 'gemini-3.8-flash';
    return m;
  })(),
  // Fallback: any OpenAI-compatible server (e.g. Ollama with an open-weights model).
  LLM_BASE_URL: process.env.LLM_BASE_URL || null,
  LLM_MODEL: process.env.LLM_MODEL || 'llama3.2',
  LLM_API_KEY: process.env.LLM_API_KEY || null,
  LLM_TIMEOUT_MS: Number(process.env.LLM_TIMEOUT_MS || 15000),
  SMS_WEBHOOK_URL: process.env.SMS_WEBHOOK_URL || null,
  LOG_SMS: bool(process.env.LOG_SMS, false),
  WEATHER: bool(process.env.WEATHER, true),
  REPO_URL: 'https://github.com/Uma-mahesh69/polampani',
};
