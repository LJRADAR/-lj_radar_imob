'use strict';

/* LJ Radar Imob — Approved layout bootstrap v26.2
   Carrega a identidade visual aprovada somente depois que a autenticação/base DOM
   estiverem disponíveis. Evita a corrida entre app-auth.js e as camadas visuais
   no Render/Cloudflare sem alterar autenticação, RLS, dados ou regras de negócio. */
(function(){
  const BUILD = '20260909-1';
  let running = false;
  let sequence = 0;
  let observerTimer = null;

  function isRealMobile(){
    if (typeof window.LJI_IS_MOBILE_DEVICE === 'boolean') return window.LJI_IS_MOBILE_DEVICE;
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
  }

  function addCss(href, key, media){
    if (document.querySelector(`link[data-${key}]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${href}?v=${BUILD}`;
    link.dataset[key.replace(/^lji-/, '').replace(/-([a-z])/g,(_,c)=>c.toUpperCase())] = '1';
    link.setAttribute(`data-${key}`, '1');
    if (media) link.media = media;
    document.head.appendChild(link);
  }

  function loadFresh(src, key){
    return new Promise((resolve)=>{
      const s = document.createElement('script');
      s.src = `${src}?v=${BUILD}-${++sequence}`;
      s.async = false;
      s.setAttribute(`data-${key}`, String(sequence));
      s.onload = () => resolve(true);
      s.onerror = () => {
        console.error(`LJ Radar: falha ao carregar ${src}`);
        resolve(false);
      };
      document.head.appendChild(s);
    });
  }

  function hasLegacyDesktopLogin(){
    const overlay = document.querySelector('#ljiAuthOverlay');
    if (!overlay) return false;
    return !!overlay.querySelector('.auth-card') && !overlay.querySelector('.lji-login-shell');
  }

  function hasLegacyMobileLogin(){
    const overlay = document.querySelector('#ljiAuthOverlay');
    if (!overlay) return false;
    return !!overlay.querySelector('.auth-card') && !overlay.querySelector('.lji-m-login-shell');
  }

  async function applyDesktop(){
    const overlay = document.querySelector('#ljiAuthOverlay');
    if (!overlay) return false;

    addCss('./desktop-layout-v23.css','lji-bootstrap-desktop-css');
    addCss('./desktop-layout-v23-hotfix.css','lji-bootstrap-desktop-hotfix-css');
    addCss('./desktop-login-polish-v23.css','lji-bootstrap-desktop-polish-css');
    addCss('./dashboard-v24.css','lji-bootstrap-dashboard-css');

    if (hasLegacyDesktopLogin()) {
      overlay.removeAttribute('data-v23-ready');
      delete overlay.dataset.v23Ready;
      overlay.classList.remove('lji-mobile-login-v25');
      overlay.removeAttribute('data-mobile-v25');
    }

    await loadFresh('./desktop-layout-v23.js','lji-bootstrap-desktop-layout');
    await loadFresh('./desktop-logo-v23.js','lji-bootstrap-desktop-logo');
    await loadFresh('./desktop-login-polish-v23.js','lji-bootstrap-desktop-polish');
    await loadFresh('./dashboard-v24.js','lji-bootstrap-dashboard');
    return !!document.querySelector('#ljiAuthOverlay .lji-login-shell') || document.querySelector('#ljiAuthOverlay')?.classList.contains('hidden');
  }

  async function applyMobile(){
    const overlay = document.querySelector('#ljiAuthOverlay');
    if (!overlay) return false;

    addCss('./mobile-v25.css','lji-bootstrap-mobile-css');

    if (hasLegacyMobileLogin()) {
      overlay.removeAttribute('data-mobile-v25');
      delete overlay.dataset.mobileV25;
      overlay.classList.remove('lji-login-v23');
      overlay.removeAttribute('data-v23-ready');
    }

    await loadFresh('./mobile-v25.js','lji-bootstrap-mobile-layout');
    return !!document.querySelector('#ljiAuthOverlay .lji-m-login-shell') || document.querySelector('#ljiAuthOverlay')?.classList.contains('hidden');
  }

  async function ensureApprovedLayout(){
    if (running) return;
    const overlay = document.querySelector('#ljiAuthOverlay');
    if (!overlay) return;

    const mobile = isRealMobile();
    const alreadyOk = mobile
      ? !!overlay.querySelector('.lji-m-login-shell')
      : !!overlay.querySelector('.lji-login-shell');
    if (alreadyOk || overlay.classList.contains('hidden')) return;

    running = true;
    try {
      if (mobile) await applyMobile();
      else await applyDesktop();
    } finally {
      running = false;
    }
  }

  function scheduleEnsure(delay=0){
    clearTimeout(observerTimer);
    observerTimer = setTimeout(()=>ensureApprovedLayout(), delay);
  }

  function start(){
    scheduleEnsure(0);
    [80,180,400,800,1500,2800].forEach(ms=>setTimeout(()=>scheduleEnsure(0),ms));

    const root = document.body || document.documentElement;
    if (root) {
      const observer = new MutationObserver(()=>scheduleEnsure(30));
      observer.observe(root,{childList:true,subtree:true});
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
  window.addEventListener('load', ()=>scheduleEnsure(0));
})();
