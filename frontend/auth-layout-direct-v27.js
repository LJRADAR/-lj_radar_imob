'use strict';

/* LJ Radar Imob — Auth layout direct v27
   Fonte única de verdade para a tela de login aprovada.
   Executa depois do app-auth.js e transforma o overlay legado sem tocar na autenticação. */
(function(){
  const logo = './lj-logo-compact.png?v=27.0.0';
  const q = (s,r=document)=>r.querySelector(s);

  function isMobile(){
    try{
      if(window.LJI_IS_MOBILE_DEVICE === true) return true;
      const ua = navigator.userAgent || '';
      return /Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(ua);
    }catch(_){ return false; }
  }

  function prepareCard(card){
    const brandOld=q('.auth-brand',card); if(brandOld) brandOld.hidden=true;
    const intro=card.querySelector(':scope > p'); if(intro) intro.hidden=true;
    const forgot=q('#ljiForgotPassword',card);
    if(forgot && !q('.lji-login-controls,.lji-m-login-controls',card)){
      const controls=document.createElement('div');
      controls.className=isMobile()?'lji-m-login-controls':'lji-login-controls';
      if(isMobile()){
        controls.innerHTML='<label><input id="ljiMobileRemember" type="checkbox" checked><span></span><b>Lembrar acesso</b></label>';
      }else{
        controls.innerHTML='<label class="lji-remember"><input id="ljiRememberAccess" type="checkbox" checked><span></span><b>Lembrar acesso</b></label>';
      }
      forgot.parentNode.insertBefore(controls,forgot);
      controls.appendChild(forgot);
    }
    const login=q('#ljiAuthLogin',card);
    if(login && !q('.lji-login-divider,.lji-m-divider',card)){
      const divider=document.createElement('div');
      divider.className=isMobile()?'lji-m-divider':'lji-login-divider';
      divider.innerHTML=isMobile()?'<i></i><b>ou</b><i></i>':'<span></span><b>ou</b><span></span>';
      login.insertAdjacentElement('afterend',divider);
      const req=document.createElement('button');
      req.type='button';
      req.className=isMobile()?'lji-m-request':'lji-request-access';
      req.innerHTML=isMobile()?'<span>♙</span> Solicitar acesso':'Solicitar acesso';
      divider.insertAdjacentElement('afterend',req);
      req.addEventListener('click',()=>{
        const info=q('.auth-info',card);
        if(info){
          info.textContent='Solicite a liberação ao administrador do workspace LJ Radar Imob.';
          info.classList.add('lji-auth-info-visible');
          info.style.display='block';
        }
      });
    }
  }

  function buildDesktop(overlay,card){
    if(q('.lji-login-shell',overlay)) return true;
    document.documentElement.classList.add('lji-desktop-v23');
    document.body?.classList.add('lji-layout-v23');
    prepareCard(card);
    overlay.classList.remove('lji-mobile-login-v25');
    overlay.classList.add('lji-login-v23');
    overlay.dataset.v23Ready='1';
    overlay.dataset.directV27='desktop';

    const shell=document.createElement('div'); shell.className='lji-login-shell';
    const left=document.createElement('section'); left.className='lji-login-left';
    left.innerHTML=`
      <div class="lji-login-edge-copy"><i></i><span>MAIS MERCADO</span><span>MAIS OPORTUNIDADES</span><span>MAIS RESULTADOS</span></div>
      <div class="lji-login-left-inner">
        <div class="lji-login-brand" aria-label="LJ Radar Imob">
          <img class="lji-login-logo" src="${logo}" alt="LJ Radar Imob">
          <p>Inteligência imobiliária para captação e oportunidades.</p>
        </div>
      </div>
      <div class="lji-login-footer">LJ Radar Imob &nbsp; © 2026</div>`;
    q('.lji-login-left-inner',left).appendChild(card);
    const support=document.createElement('button');
    support.type='button'; support.className='lji-login-support'; support.textContent='◉  Falar com suporte';
    q('.lji-login-left-inner',left).appendChild(support);

    const hero=document.createElement('section'); hero.className='lji-login-hero';
    hero.innerHTML=`
      <div class="lji-login-lang"><span>Brasil</span><i></i><span>PT-BR</span></div>
      <div class="lji-login-hero-copy">
        <small>ANÁLISE &nbsp; · &nbsp; DADOS &nbsp; · &nbsp; OPERAÇÃO</small>
        <h2>O mercado<br>imobiliário com<br><strong>mais inteligência.</strong></h2>
        <em></em>
        <p>ENCONTRE IMÓVEIS.<br>IDENTIFIQUE OPORTUNIDADES.<br>ANTECIPE MOVIMENTOS.</p>
      </div>
      <div class="lji-login-hero-radar" role="img" aria-label="Radar LJ"><span class="ring r1"></span><span class="ring r2"></span><span class="ring r3"></span><span class="beam"></span><b></b></div>
      <div class="lji-login-float lji-float-a"><strong>Apartamento</strong><span>Oportunidade detectada</span></div>
      <div class="lji-login-float lji-float-b"><strong>Casa</strong><span>Alto potencial</span></div>
      <div class="lji-login-float lji-float-c"><strong>Terreno</strong><span>Novo sinal no mercado</span></div>
      <blockquote>“Dados transformam<br>o mercado em oportunidades.”</blockquote>
      <div class="lji-login-bottom-words">DADOS <b>·</b> PESSOAS <b>·</b> OPORTUNIDADES <b>·</b> RESULTADOS</div>`;

    overlay.replaceChildren(shell); shell.append(left,hero);
    return true;
  }

  function buildMobile(overlay,card){
    if(q('.lji-m-login-shell',overlay)) return true;
    prepareCard(card);
    overlay.classList.remove('lji-login-v23');
    overlay.classList.add('lji-mobile-login-v25');
    overlay.dataset.mobileV25='1';
    overlay.dataset.directV27='mobile';

    if(!q('.lji-m-brand',card)){
      const brand=document.createElement('div'); brand.className='lji-m-brand';
      brand.innerHTML=`<img src="${logo}" alt="LJ Radar Imob"><p>Inteligência imobiliária para captação e oportunidades.</p>`;
      card.prepend(brand);
    }

    const shell=document.createElement('div'); shell.className='lji-m-login-shell';
    const hero=document.createElement('section'); hero.className='lji-m-login-hero';
    hero.innerHTML=`<div class="lji-m-login-locale"><b>Brasil</b><i></i><b>PT-BR</b></div><div class="lji-m-login-copy"><small>ANÁLISE · DADOS · OPERAÇÃO</small><h1>O mercado imobiliário com <strong>mais inteligência.</strong></h1><p>ENCONTRE IMÓVEIS · IDENTIFIQUE OPORTUNIDADES · ANTECIPE MOVIMENTOS.</p></div><div class="lji-m-radar"><i></i><i></i><i></i><b></b></div>`;
    const wrap=document.createElement('section'); wrap.className='lji-m-login-cardwrap';
    const support=document.createElement('button'); support.type='button'; support.className='lji-m-support'; support.textContent='◉  Falar com suporte';
    wrap.append(card,support); shell.append(hero,wrap); overlay.replaceChildren(shell);
    return true;
  }

  function apply(){
    const overlay=q('#ljiAuthOverlay');
    const card=overlay && q('.auth-card',overlay);
    if(!overlay || !card) return false;
    return isMobile()?buildMobile(overlay,card):buildDesktop(overlay,card);
  }

  window.LJI_FORCE_APPROVED_AUTH_LAYOUT=apply;
  apply();
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',apply,{once:true});
  window.addEventListener('load',apply);
  [50,150,350,700,1200,2200,4000].forEach(ms=>setTimeout(apply,ms));
  const obs=new MutationObserver(()=>{ clearTimeout(obs._t); obs._t=setTimeout(apply,20); });
  const start=()=>{ const root=document.body||document.documentElement; if(root) obs.observe(root,{childList:true,subtree:true}); };
  if(document.body) start(); else document.addEventListener('DOMContentLoaded',start,{once:true});
})();
