const LJI_STORED_WORKSPACE_ID = (() => {
  try {
    return window.localStorage.getItem('lji_workspace_id') || null;
  } catch (_) {
    return null;
  }
})();

window.LJI_CONFIG = {
  SUPABASE_URL: "https://aeuclswrxtqpcsexiobs.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_mqF90I1TCJlwdJVp53a0lg_nHxJVdwv",
  // Resolvido e validado em runtime pelo app-auth.js a partir de lji_workspace_members.
  WORKSPACE_ID: LJI_STORED_WORKSPACE_ID,
  MODE: "supabase",
  // Lista negra de leads ruins. Acrescente um nome por linha, entre aspas.
  // Casa por trecho: "RRDA" já bloqueia "RRDA IMOBILIARIA".
  BLOCKED_NAMES: [
    // "Nome do corretor",
    // "Nome da imobiliária"
  ]
};

// Camada pequena e isolada que alinha Match/Dashboard/Pipeline aos gates do backend.
// É carregada somente depois que app-core.js/app-backend.js já definiram as funções,
// evitando reescrever o arquivo principal e reduzindo risco de regressão.
window.addEventListener('load', () => {
  if (document.querySelector('script[data-lji-quality-gates]')) return;
  const script = document.createElement('script');
  script.src = 'quality-gates.js?v=20260907-1';
  script.async = true;
  script.dataset.ljiQualityGates = '1';
  script.onerror = () => console.error('LJ Radar: quality-gates.js não carregou.');
  document.head.appendChild(script);
});
