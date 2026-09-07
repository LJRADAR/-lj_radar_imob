export const config = {
  port: Number(process.env.PORT || 10000),
  authVerifierUrl: String(process.env.LJI_SOURCE_ROUTER_AUTH_URL || '').trim(),
  threadsToken: String(process.env.THREADS_ACCESS_TOKEN || '').trim(),
  requestTimeoutMs: Math.max(3000, Math.min(20000, Number(process.env.SOURCE_REQUEST_TIMEOUT_MS || 9000))),
};
