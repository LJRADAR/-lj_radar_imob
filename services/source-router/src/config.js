export const config = {
  port: Number(process.env.PORT || 10000),
  routerToken: String(process.env.LJI_SOURCE_ROUTER_TOKEN || '').trim(),
  mercadoLivreToken: String(process.env.MERCADOLIVRE_ACCESS_TOKEN || '').trim(),
  requestTimeoutMs: Math.max(3000, Math.min(20000, Number(process.env.SOURCE_REQUEST_TIMEOUT_MS || 9000))),
};
