const API = 'https://api.apify.com/v2';
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const token = String(process.env.APIFY_TOKEN || '').trim();

const PROFILES = [
  {
    key: 'olx',
    envKey: 'APIFY_TASK_OLX',
    actorRef: 'solidcode~olx-brazil-scraper',
    taskName: 'lji-olx-pilot',
    title: 'LJ Radar — OLX pilot',
    description: 'Controlled LJ Radar OLX pilot. São Caetano first; runtime input is overridden by Source Router.',
    options: { build: 'latest', timeoutSecs: 40, maxItems: 30, maxTotalChargeUsd: 0.25, restartOnError: false },
    input: {
      searchUrls: ['https://www.olx.com.br/imoveis/venda/estado-sp/sao-paulo-e-regiao/sao-caetano-do-sul'],
      maxResults: 10,
      sortBy: 'Newest First',
      enrichDetails: true,
      includeBusinessOnly: false,
    },
  },
  {
    key: 'quinto',
    envKey: 'APIFY_TASK_QUINTO',
    actorRef: 'solidcode~quintoandar-scraper',
    taskName: 'lji-quinto-verifier',
    title: 'LJ Radar — QuintoAndar verifier',
    description: 'Positive-match-only QuintoAndar verifier for LJ Radar. Empty results never prove absence.',
    options: { build: 'latest', timeoutSecs: 40, maxItems: 25, maxTotalChargeUsd: 0.25, restartOnError: false },
    input: {
      operation: 'buy',
      location: 'São Caetano do Sul, SP',
      propertyType: 'any',
      bedrooms: [],
      includePhotos: false,
      maxResults: 10,
    },
  },
];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

async function api(path, init = {}) {
  if (!token) throw new Error('APIFY_TOKEN_missing');
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
    throw new Error(`${path}: ${detail}`);
  }
  return payload?.data ?? payload;
}

async function resolveActor(actorRef) {
  const data = await api(`/actors/${encodeURIComponent(actorRef)}`);
  if (!data?.id) throw new Error(`actor_not_found:${actorRef}`);
  return data;
}

async function listTasks() {
  const data = await api('/actor-tasks?limit=1000&desc=1');
  return Array.isArray(data?.items) ? data.items : [];
}

async function upsertTask(profile, actor, existingTasks) {
  const existing = existingTasks.find((row) => row?.name === profile.taskName);
  const body = {
    actId: actor.id,
    name: profile.taskName,
    title: profile.title,
    description: profile.description,
    options: profile.options,
    input: profile.input,
  };

  if (dryRun) {
    return {
      action: existing ? 'would_update' : 'would_create',
      key: profile.key,
      env_key: profile.envKey,
      actor: profile.actorRef,
      task_name: profile.taskName,
      task_id: existing?.id || null,
      options: profile.options,
      input: profile.input,
    };
  }

  if (existing) {
    if (existing.actId && existing.actId !== actor.id) {
      throw new Error(`task_name_conflict:${profile.taskName}:existing_actor_mismatch`);
    }
    const updated = await api(`/actor-tasks/${encodeURIComponent(existing.id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    return { action: 'updated', key: profile.key, env_key: profile.envKey, actor: profile.actorRef, task_name: profile.taskName, task_id: updated.id };
  }

  const created = await api('/actor-tasks', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return { action: 'created', key: profile.key, env_key: profile.envKey, actor: profile.actorRef, task_name: profile.taskName, task_id: created.id };
}

async function main() {
  if (dryRun && !token) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      note: 'No Apify API calls were made. Set APIFY_TOKEN and run without --dry-run to create/update tasks.',
      profiles: PROFILES.map(({ key, envKey, actorRef, taskName, options, input }) => ({ key, env_key: envKey, actor: actorRef, task_name: taskName, options, input })),
    }, null, 2));
    return;
  }

  if (!token) throw new Error('APIFY_TOKEN_missing');

  const existingTasks = await listTasks();
  const results = [];
  for (const profile of PROFILES) {
    const actor = await resolveActor(profile.actorRef);
    results.push(await upsertTask(profile, actor, existingTasks));
  }

  const renderEnv = Object.fromEntries(results.filter((row) => row.task_id).map((row) => [row.env_key, row.task_id]));
  console.log(JSON.stringify({
    ok: true,
    dry_run: dryRun,
    results,
    render_env: renderEnv,
    next: dryRun ? 'Set APIFY_TOKEN and run again without --dry-run.' : 'Set APIFY_TOKEN plus the returned APIFY_TASK_* IDs in Render; keep collection cron disabled until São Caetano pilot passes.',
  }, null, 2));
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
