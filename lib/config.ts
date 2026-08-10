export const config = {
  session: {
    maxAgeSec: parseInt(process.env.SESSION_MAX_AGE_SEC ?? "") || 7 * 24 * 60 * 60,
    updateAgeSec: parseInt(process.env.SESSION_UPDATE_AGE_SEC ?? "") || 24 * 60 * 60,
  },
  rateLimit: {
    maxAttempts: parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS ?? "") || 5,
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "") || 15 * 60 * 1000,
  },
  pdf: {
    cacheDir: process.env.PDF_CACHE_DIR || "data/pdf-cache",
    cacheTtlMs: parseInt(process.env.PDF_CACHE_TTL_MS ?? "") || 10 * 60 * 1000,
    cacheMaxFiles: parseInt(process.env.PDF_CACHE_MAX_FILES ?? "") || 100,
  },
  bcrypt: {
    rounds: parseInt(process.env.BCRYPT_ROUNDS ?? "") || 10,
  },
  notifications: {
    cronSchedule: process.env.NOTIFY_CRON_SCHEDULE || "0 8 * * *",
  },
  logs: {
    // Nightly log rotation (<data>/logs/app.log -> app-<date>.log).
    rotateCronSchedule: process.env.LOG_ROTATE_CRON_SCHEDULE || "35 2 * * *",
    // Days to keep rotated log files; 0 disables pruning (keep all) — unlike
    // the other numeric settings above, 0 is a valid, meaningful value here,
    // so it can't use the `parseInt(...) || fallback` idiom (0 is falsy).
    maxKeepDays: (() => {
      const parsed = parseInt(process.env.LOG_MAX_KEEP_DAYS ?? "", 10);
      return Number.isFinite(parsed) ? parsed : 14;
    })(),
  },
} as const;
