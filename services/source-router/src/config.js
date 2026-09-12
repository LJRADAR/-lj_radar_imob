const clamp = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

const csv = (value) => String(value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const apifyTimeoutSecs = clamp(process.env.APIFY_TIMEOUT_SECS, 35, 10, 40);

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
    quinto: String(process.env.APIFY_TASK_QUINTO || '').trim(),
  },
  apifyFacebookGroupUrls: csv(process.env.APIFY_FACEBOOK_GROUP_URLS),
  apifyOlxTasks: {
    'São Caetano do Sul': String(process.env.APIFY_TASK_OLX_SCS || '').trim(),
    'Santo André': String(process.env.APIFY_TASK_OLX_SA || '').trim(),
    'São Bernardo do Campo': String(process.env.APIFY_TASK_OLX_SBC || '').trim(),
    'Diadema': String(process.env.APIFY_TASK_OLX_DIA || '').trim(),
    'São Paulo Centro Expandido': String(process.env.APIFY_TASK_OLX_CENTRO || '').trim(),
    'São Paulo Zona Sul': String(process.env.APIFY_TASK_OLX_ZS || '').trim(),
    'São Paulo Zona Leste': String(process.env.APIFY_TASK_OLX_ZL || '').trim(),
    'São Paulo Zona Oeste': String(process.env.APIFY_TASK_OLX_ZO || '').trim(),
    'São Paulo Zona Norte': String(process.env.APIFY_TASK_OLX_ZN || '').trim(),
  },
  apifyMaxChargeUsd: clamp(process.env.APIFY_MAX_CHARGE_USD, 0.25, 0.01, 5),
  apifyTimeoutSecs,
  requestTimeoutMs: Math.max(apifyTimeoutSecs * 1000 + 10000, clamp(process.env.SOURCE_REQUEST_TIMEOUT_MS, 50000, 3000, 60000)),
};
