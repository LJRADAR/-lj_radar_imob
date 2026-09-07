const clamp = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

export const config = {
  port: Number(process.env.PORT || 10000),
  authVerifierUrl: String(process.env.LJI_SOURCE_ROUTER_AUTH_URL || '').trim(),
  threadsToken: String(process.env.THREADS_ACCESS_TOKEN || '').trim(),
  apifyToken: String(process.env.APIFY_TOKEN || '').trim(),
  apifyTasks: {
    olx: String(process.env.APIFY_TASK_OLX || '').trim(),
    instagram: String(process.env.APIFY_TASK_INSTAGRAM || '').trim(),
    facebook: String(process.env.APIFY_TASK_FACEBOOK || '').trim(),
    telegram: String(process.env.APIFY_TASK_TELEGRAM || '').trim(),
  },
  apifyMaxChargeUsd: clamp(process.env.APIFY_MAX_CHARGE_USD, 0.25, 0.01, 5),
  apifyTimeoutSecs: clamp(process.env.APIFY_TIMEOUT_SECS, 35, 10, 40),
  requestTimeoutMs: Math.max(3000, Math.min(45000, Number(process.env.SOURCE_REQUEST_TIMEOUT_MS || 40000))),
};
