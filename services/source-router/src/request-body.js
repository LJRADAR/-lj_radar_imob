// Keep the signed bytes intact across arbitrary TCP chunk boundaries.
export async function readRawBody(req, maxBytes = 128000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error('request_too_large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size);
}
