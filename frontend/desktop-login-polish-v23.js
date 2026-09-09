'use strict';

/* LJ Radar Imob — Login polish v23
   Ajusta somente apresentação e interação da tela de login desktop. */
(function(){
  let audioCtx = null;
  let lastPingAt = 0;

  function getAudioCtx(){
    try{
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if(!AudioCtx) return null;
      audioCtx = audioCtx || new AudioCtx();
      if(audioCtx.state === 'suspended') audioCtx.resume().catch(()=>{});
      return audioCtx;
    }catch(_){ return null; }
  }

  function futuristicMetalPing(){
    const nowMs = Date.now();
    if(nowMs - lastPingAt < 420) return;
    lastPingAt = nowMs;
    const ctx = getAudioCtx();
    if(!ctx) return;
    try{
      const now = ctx.currentTime;
      const master = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1450, now);
      filter.Q.setValueAtTime(2.1, now);
      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(0.075, now + 0.012);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
      filter.connect(master);
      master.connect(ctx.destination);

      [390, 760, 1260, 2010].forEach((hz, i)=>{
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = i % 2 === 0 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(hz, now);
        osc.frequency.exponentialRampToValueAtTime(hz * (i < 2 ? 1.08 : 0.92), now + 0.26);
        gain.gain.setValueAtTime(i === 0 ? 0.26 : 0.16, now + i * 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.30);
        osc.connect(gain);
        gain.connect(filter);
        osc.start(now + i * 0.006);
        osc.stop(now + 0.32);
      });
    }catch(_){ }
  }

  function unlockAudio(){ getAudioCtx(); }
  document.addEventListener('pointerdown', unlockAudio, {once:true, passive:true});
  document.addEventListener('keydown', unlockAudio, {once:true});

  function pointInside(rect,x,y){
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function clearInputBlocker(input){
    if(!input || typeof document.elementFromPoint !== 'function') return;
    const rect = input.getBoundingClientRect();
    if(!rect.width || !rect.height) return;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    for(let i=0;i<5;i++){
      const top = document.elementFromPoint(x,y);
      if(!top || top === input || input.contains(top)) return;
      if(top.contains(input)) return;
      const overlay = document.querySelector('#ljiAuthOverlay');
      if(!overlay || !overlay.contains(top)) return;
      if(top.matches('input,button,a,label,.auth-field,.password-input-wrap,.auth-card,.lji-login-left-inner,.lji-login-left,.lji-login-shell')) return;
      top.style.pointerEvents = 'none';
      top.dataset.ljiPointerBlockerDisabled = '1';
    }
  }

  function ensureLoginInteractive(){
    const overlay = document.querySelector('#ljiAuthOverlay');
    if(!overlay || overlay.classList.contains('hidden')) return;
    const card = overlay.querySelector('.auth-card');
    const email = overlay.querySelector('#ljiAuthEmail');
    const pass = overlay.querySelector('#ljiAuthPassword');
    const login = overlay.querySelector('#ljiAuthLogin');
    const forgot = overlay.querySelector('#ljiForgotPassword');
    if(!card || !email || !pass || !login) return;

    [overlay, card, email, pass, login, forgot].filter(Boolean).forEach(el=>{
      el.removeAttribute('inert');
      el.style.pointerEvents = 'auto';
    });
    [email,pass].forEach(input=>{
      input.disabled = false;
      input.readOnly = false;
      input.removeAttribute('aria-disabled');
      input.removeAttribute('tabindex');
      input.style.userSelect = 'text';
      input.style.webkitUserSelect = 'text';
      input.style.cursor = 'text';
      clearInputBlocker(input);
    });
    if(login.dataset.ljiForceEnabled !== '1'){
      login.dataset.ljiForceEnabled = '1';
      if(login.textContent.trim() === 'Entrar') login.disabled = false;
    }

    if(overlay.dataset.ljiInteractionBridge !== '1'){
      overlay.dataset.ljiInteractionBridge = '1';
      overlay.addEventListener('pointerdown', function(e){
        const controls = [email,pass];
        for(const input of controls){
          const r = input.getBoundingClientRect();
          if(pointInside(r,e.clientX,e.clientY) && e.target !== input){
            e.preventDefault();
            e.stopPropagation();
            input.focus({preventScroll:true});
            return;
          }
        }
        const rLogin = login.getBoundingClientRect();
        if(pointInside(rLogin,e.clientX,e.clientY) && e.target !== login){
          e.preventDefault();
          e.stopPropagation();
          login.click();
          return;
        }
        if(forgot){
          const rForgot = forgot.getBoundingClientRect();
          if(pointInside(rForgot,e.clientX,e.clientY) && e.target !== forgot){
            e.preventDefault();
            e.stopPropagation();
            forgot.click();
          }
        }
      }, true);
    }
  }

  function polish(){
    const lang = document.querySelector('.lji-login-lang');
    if(lang){
      const spans = lang.querySelectorAll('span');
      if(spans[0]){
        spans[0].textContent = 'Brasil';
        spans[0].title = 'Mercado atual: Brasil';
      }
      if(spans[1]){
        spans[1].textContent = 'PT-BR';
        spans[1].title = 'Idioma atual: Português (Brasil)';
      }
    }

    const brand = document.querySelector('.lji-login-brand');
    if(brand){
      const h1 = brand.querySelector('h1');
      if(h1) h1.remove();
    }

    const cardMeta = [
      {price:'R$ 1.200.000', cls:'apt'},
      {price:'R$ 890.000', cls:'house'},
      {price:'R$ 450.000', cls:'land'}
    ];

    document.querySelectorAll('.lji-login-float').forEach((card, index)=>{
      const meta = cardMeta[index] || cardMeta[0];
      if(!card.querySelector('.lji-float-thumb')){
        const strong = card.querySelector('strong');
        const text = Array.from(card.children).find(el=>el.tagName === 'SPAN');
        if(!strong || !text) return;

        const thumb = document.createElement('span');
        thumb.className = `lji-float-thumb lji-thumb-${meta.cls}`;
        thumb.setAttribute('aria-hidden','true');
        thumb.title = 'Imagem ilustrativa da oportunidade';

        const copy = document.createElement('span');
        copy.className = 'lji-float-copy';
        const price = document.createElement('b');
        price.className = 'lji-float-price';
        price.textContent = meta.price;
        const arrow = document.createElement('i');
        arrow.className = 'lji-float-arrow';
        arrow.textContent = '›';
        copy.append(strong, price, text);
        card.replaceChildren(thumb, copy, arrow);
        card.setAttribute('data-visual-card', String(index + 1));
      }

      if(card.dataset.soundBound !== '1'){
        card.dataset.soundBound = '1';
        card.addEventListener('pointerenter', futuristicMetalPing);
        card.addEventListener('pointerdown', futuristicMetalPing);
      }
    });

    const radar = document.querySelector('.lji-login-hero-radar');
    if(radar && radar.dataset.polishSoundBound !== '1'){
      radar.dataset.polishSoundBound = '1';
      radar.addEventListener('pointerenter', futuristicMetalPing);
    }

    ensureLoginInteractive();
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', polish, {once:true});
  else polish();
  window.addEventListener('load', polish, {once:true});
  [50,180,500,1200].forEach(ms=>setTimeout(polish,ms));
  const observer = new MutationObserver(polish);
  observer.observe(document.documentElement,{childList:true,subtree:true});
})();
