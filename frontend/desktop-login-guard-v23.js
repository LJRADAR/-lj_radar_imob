'use strict';

/* LJ Radar Imob — Desktop login late-mount guard
   Corrige corrida entre app-auth.js e desktop-layout-v23.js: se o overlay de
   autenticação surgir ou for reconstruído depois do carregamento inicial,
   reaplica a composição desktop aprovada sem alterar autenticação ou regras. */
(function(){
  if(window.LJI_IS_MOBILE_DEVICE) return;

  let loading = false;
  let attempts = 0;
  let lastOverlay = null;

  function isDesktop(){
    return !window.LJI_IS_MOBILE_DEVICE && window.innerWidth >= 901;
  }

  function needsRepair(){
    if(!isDesktop()) return false;
    const overlay = document.querySelector('#ljiAuthOverlay');
    if(!overlay) return false;
    const hasApprovedShell = !!overlay.querySelector('.lji-login-shell');
    if(hasApprovedShell) return false;
    const hasLegacyCard = !!overlay.querySelector('.auth-card');
    return hasLegacyCard;
  }

  function reapply(){
    if(!needsRepair() || loading) return;
    const overlay = document.querySelector('#ljiAuthOverlay');
    if(!overlay) return;

    loading = true;
    attempts += 1;
    overlay.removeAttribute('data-v23-ready');
    delete overlay.dataset.v23Ready;

    const s = document.createElement('script');
    s.src = `desktop-layout-v23.js?v=20260908-login-guard-${attempts}`;
    s.async = false;
    s.dataset.ljiDesktopV23Late = String(attempts);
    s.onload = () => {
      loading = false;
      setTimeout(()=>{
        if(needsRepair() && attempts < 8) reapply();
      }, 120);
    };
    s.onerror = () => {
      loading = false;
      console.error('LJ Radar: falha ao reaplicar desktop-layout-v23.js no login.');
    };
    document.head.appendChild(s);
  }

  function inspect(){
    if(!isDesktop()) return;
    const overlay = document.querySelector('#ljiAuthOverlay');
    if(overlay && overlay !== lastOverlay){
      lastOverlay = overlay;
      attempts = 0;
    }
    if(needsRepair()) reapply();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', inspect, {once:true});
  }else{
    inspect();
  }

  window.addEventListener('load', ()=>{
    inspect();
    [100,300,700,1400,2600].forEach(ms=>setTimeout(inspect,ms));
  });

  const observer = new MutationObserver(()=>{
    if(!isDesktop()) return;
    clearTimeout(observer._t);
    observer._t = setTimeout(inspect, 30);
  });

  const startObserver = ()=>{
    const root = document.body || document.documentElement;
    if(root) observer.observe(root,{childList:true,subtree:true});
  };
  if(document.body) startObserver(); else document.addEventListener('DOMContentLoaded',startObserver,{once:true});

  window.addEventListener('resize', inspect);
})();
