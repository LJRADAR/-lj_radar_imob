'use strict';

/* LJ Radar Imob — Desktop login late-mount guard
   Corrige corrida entre app-auth.js e desktop-layout-v23.js e aplica o
   background oficial aprovado do login em desktop e mobile. */
(function(){
  // Background oficial do login: Rio/Corcovado + prédios, sem a ponte antiga.
  // Fica centralizado como camada visual e mantém os overlays azul/branco já existentes.
  if(!document.querySelector('style[data-lji-login-bg-v26]')){
    const style = document.createElement('style');
    style.dataset.ljiLoginBgV26 = '1';
    style.textContent = `
      .lji-login-hero{
        background-image:
          linear-gradient(90deg,rgba(250,253,255,.94) 0%,rgba(234,243,253,.57) 36%,rgba(28,74,136,.22) 100%),
          linear-gradient(180deg,rgba(238,246,255,.11),rgba(8,39,91,.20)),
          url('https://images.unsplash.com/photo-1608378963517-1c47051c7415?auto=format&fit=crop&w=2400&q=85') !important;
        background-position:center center!important;
        background-size:cover!important;
        background-repeat:no-repeat!important;
      }
      @media (max-width:900px){
        .lji-m-login-hero{
          background-image:
            linear-gradient(180deg,rgba(223,238,255,.10) 0%,rgba(13,47,101,.32) 100%),
            linear-gradient(90deg,rgba(255,255,255,.16),rgba(255,255,255,.03)),
            url('https://images.unsplash.com/photo-1608378963517-1c47051c7415?auto=format&fit=crop&w=1600&q=85') !important;
          background-position:center 42%!important;
          background-size:cover!important;
          background-repeat:no-repeat!important;
        }
      }
    `;
    document.head.appendChild(style);
  }

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
