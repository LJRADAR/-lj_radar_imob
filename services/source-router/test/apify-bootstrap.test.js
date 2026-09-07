import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, '../scripts/bootstrap-apify.mjs');

test('Apify bootstrap dry-run needs no token and makes no external call', () => {
  const env = { ...process.env };
  delete env.APIFY_TOKEN;
  const result = spawnSync(process.execPath, [script, '--dry-run'], {
    env,
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.dry_run, true);
  assert.equal(payload.profiles.length, 2);
  assert.deepEqual(payload.profiles.map((row) => row.env_key).sort(), ['APIFY_TASK_OLX', 'APIFY_TASK_QUINTO']);
  assert.ok(payload.profiles.every((row) => row.options.maxTotalChargeUsd === 0.25));
});
