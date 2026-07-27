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
} as const;
