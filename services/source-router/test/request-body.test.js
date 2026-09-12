import test from 'node:test';
import assert from 'node:assert/strict';
import { readRawBody } from '../src/request-body.js';

test('readRawBody preserves bytes across arbitrary chunks', async () => {
  const req = (async function* () {
    yield Buffer.from([0xff, 0x00, 0x41]);
    yield Buffer.from([0xc3, 0xa9]);
  })();
  assert.deepEqual(await readRawBody(req, 10), Buffer.from([0xff, 0x00, 0x41, 0xc3, 0xa9]));
});

test('readRawBody rejects oversized requests before buffering all data', async () => {
  const req = (async function* () {
    yield Buffer.alloc(4);
    yield Buffer.alloc(7);
  })();
  await assert.rejects(readRawBody(req, 10), /request_too_large/);
});
