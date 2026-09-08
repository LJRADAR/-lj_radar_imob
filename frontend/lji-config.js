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

// Identidade visual aprovada em 08/09/2026.
// Desktop v23/v24 e Mobile v25 são camadas isoladas para preservar a operação existente.
(function loadApprovedLayouts(){
  if (!document.querySelector('link[data-lji-desktop-v23]')) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'desktop-layout-v23.css?v=20260908-1';
    css.dataset.ljiDesktopV23 = '1';
    document.head.appendChild(css);
  }
  if (!document.querySelector('link[data-lji-desktop-v23-hotfix]')) {
    const cssFix = document.createElement('link');
    cssFix.rel = 'stylesheet';
    cssFix.href = 'desktop-layout-v23-hotfix.css?v=20260908-1';
    cssFix.dataset.ljiDesktopV23Hotfix = '1';
    document.head.appendChild(cssFix);
  }
  if (!document.querySelector('link[data-lji-desktop-login-polish-v23]')) {
    const cssPolish = document.createElement('link');
    cssPolish.rel = 'stylesheet';
    cssPolish.href = 'desktop-login-polish-v23.css?v=20260908-4';
    cssPolish.dataset.ljiDesktopLoginPolishV23 = '1';
    document.head.appendChild(cssPolish);
  }
  if (!document.querySelector('link[data-lji-dashboard-v24]')) {
    const dashCss = document.createElement('link');
    dashCss.rel = 'stylesheet';
    dashCss.href = 'dashboard-v24.css?v=20260908-1';
    dashCss.dataset.ljiDashboardV24 = '1';
    document.head.appendChild(dashCss);
  }
  if (!document.querySelector('link[data-lji-mobile-v25]')) {
    const mobileCss = document.createElement('link');
    mobileCss.rel = 'stylesheet';
    mobileCss.href = 'mobile-v25.css?v=20260908-1';
    mobileCss.dataset.ljiMobileV25 = '1';
    document.head.appendChild(mobileCss);
  }
  if (!document.querySelector('script[data-lji-desktop-v23]')) {
    const ui = document.createElement('script');
    ui.src = 'desktop-layout-v23.js?v=20260908-1';
    ui.async = false;
    ui.dataset.ljiDesktopV23 = '1';
    ui.onerror = () => console.error('LJ Radar: desktop-layout-v23.js não carregou.');
    document.head.appendChild(ui);
  }
  if (!document.querySelector('script[data-lji-desktop-logo-v23]')) {
    const logo = document.createElement('script');
    logo.src = 'desktop-logo-v23.js?v=20260908-2';
    logo.async = false;
    logo.dataset.ljiDesktopLogoV23 = '1';
    logo.onerror = () => console.error('LJ Radar: desktop-logo-v23.js não carregou.');
    document.head.appendChild(logo);
  }
  if (!document.querySelector('script[data-lji-desktop-login-polish-v23]')) {
    const polish = document.createElement('script');
    polish.src = 'desktop-login-polish-v23.js?v=20260908-4';
    polish.async = false;
    polish.dataset.ljiDesktopLoginPolishV23 = '1';
    polish.onerror = () => console.error('LJ Radar: desktop-login-polish-v23.js não carregou.');
    document.head.appendChild(polish);
  }
  if (!document.querySelector('script[data-lji-dashboard-v24]')) {
    const dash = document.createElement('script');
    dash.src = 'dashboard-v24.js?v=20260908-1';
    dash.async = false;
    dash.dataset.ljiDashboardV24 = '1';
    dash.onerror = () => console.error('LJ Radar: dashboard-v24.js não carregou.');
    document.head.appendChild(dash);
  }
  if (!document.querySelector('script[data-lji-mobile-v25]')) {
    const mobile = document.createElement('script');
    mobile.src = 'mobile-v25.js?v=20260908-1';
    mobile.async = false;
    mobile.dataset.ljiMobileV25 = '1';
    mobile.onerror = () => console.error('LJ Radar: mobile-v25.js não carregou.');
    document.head.appendChild(mobile);
  }
})();

// Camadas pequenas e isoladas carregadas depois que app-core.js/app-backend.js
// já definiram as funções. Evita reescrever o arquivo principal e reduz regressão.
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
