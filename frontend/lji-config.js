'use strict';

const LJI_STORED_WORKSPACE_ID = (() => {
  try { return window.localStorage.getItem('lji_workspace_id') || null; }
  catch (_) { return null; }
})();

window.LJI_CONFIG = {
  SUPABASE_URL: "https://aeuclswrxtqpcsexiobs.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_mqF90I1TCJlwdJVp53a0lg_nHxJVdwv",
  WORKSPACE_ID: LJI_STORED_WORKSPACE_ID,
  MODE: "supabase",
  BLOCKED_NAMES: []
};

const LJI_IS_MOBILE_DEVICE = (() => {
  try {
    const ua = navigator.userAgent || '';
    const uaDataMobile = navigator.userAgentData?.mobile === true;
    const mobileUA = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(ua);
    const touchTablet = navigator.maxTouchPoints > 0
      && window.matchMedia?.('(pointer: coarse)').matches
      && Math.min(window.screen?.width || 9999, window.screen?.height || 9999) <= 1024;
    return Boolean(uaDataMobile || mobileUA || touchTablet);
  } catch (_) { return false; }
})();
window.LJI_IS_MOBILE_DEVICE = LJI_IS_MOBILE_DEVICE;

/* O login v31 é montado exclusivamente pelo index.html. Nenhum builder legado
   pode reconstruir ou estilizar #ljiAuthOverlay depois do boot. */
if (!window.LJI_LOGIN_LAYOUT_OWNER) {
  window.LJI_LOGIN_LAYOUT_OWNER = 'app-default';
}

/* Camadas operacionais isoladas. Não alteram o layout de autenticação. */
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
