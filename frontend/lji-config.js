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

// Detecta dispositivo móvel de verdade. Não usa apenas window.innerWidth,
// porque zoom/escala do Windows e janelas estreitas podem reduzir o viewport CSS
// de um desktop e ativar o layout mobile indevidamente.
const LJI_IS_MOBILE_DEVICE = (() => {
  try {
    const ua = navigator.userAgent || '';
    const uaDataMobile = navigator.userAgentData?.mobile === true;
    const mobileUA = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(ua);
    const touchTablet = navigator.maxTouchPoints > 0
      && window.matchMedia?.('(pointer: coarse)').matches
      && Math.min(window.screen?.width || 9999, window.screen?.height || 9999) <= 1024;
    return Boolean(uaDataMobile || mobileUA || touchTablet);
  } catch (_) {
    return false;
  }
})();
window.LJI_IS_MOBILE_DEVICE = LJI_IS_MOBILE_DEVICE;

/*
 * IMPORTANTE — v30.0.3
 * O login aprovado é montado exclusivamente por frontend/index.html.
 * NÃO carregar aqui nenhuma camada visual de autenticação antiga.
 *
 * Antes, este arquivo reinjetava em runtime:
 * - desktop-layout-v23.js
 * - desktop-login-guard-v23.js
 * - desktop-login-polish-v23.js
 * - mobile-v25.js (incluindo builder de login)
 * - approved-layout-bootstrap-v26.js
 *
 * Essas reinjeções reconstruíam #ljiAuthOverlay depois do primeiro paint e eram
 * a causa direta da alternância/pisca-pisca entre o login aprovado e o legado.
 * O index atual é a única autoridade da composição visual de autenticação.
 */
window.LJI_LOGIN_LAYOUT_OWNER = 'index-v30';

// Camadas funcionais pequenas e isoladas, sem responsabilidade pelo layout do login.
window.addEventListener('load', () => {
  if (!document.querySelector('script[data-lji-quality-gates]')) {
    const quality = document.createElement('script');
    quality.src = 'quality-gates.js?v=20260907-3';
    quality.async = true;
    quality.dataset.ljiQualityGates = '1';
    quality.onerror = () => console.error('LJ Radar: quality-gates.js não carregou.');
    document.head.appendChild(quality);
  }

  if (!document.querySelector('script[data-lji-access-contract]')) {
    const access = document.createElement('script');
    access.src = 'access-contract.js?v=20260907-1';
    access.async = true;
    access.dataset.ljiAccessContract = '1';
    access.onerror = () => console.error('LJ Radar: access-contract.js não carregou.');
    document.head.appendChild(access);
  }

  if (!document.querySelector('script[data-lji-functional-fixes]')) {
    const fixes = document.createElement('script');
    fixes.src = 'functional-fixes.js?v=20260907-2';
    fixes.async = true;
    fixes.dataset.ljiFunctionalFixes = '1';
    fixes.onerror = () => console.error('LJ Radar: functional-fixes.js não carregou.');
    document.head.appendChild(fixes);
  }
});
