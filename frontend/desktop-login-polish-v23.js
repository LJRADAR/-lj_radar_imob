'use strict';

/* LJ Radar Imob — Approved Login v30
   Reconstrói somente a apresentação do login com a identidade aprovada.
   Preserva IDs, listeners e autenticação existentes. */
(function(){
  const STYLE_ID='lji-approved-login-v30-style';
  const STYLE_HREF='./desktop-login-approved-v30.css?v=30.0.1';
  const LOGO='./lj-logo-compact.png?v=30.0.1';

  function q(sel,root=document){return root.querySelector(sel)}

  function ensureStyle(){
    if(document.getElementById(STYLE_ID)) return;
    const link=document.createElement('link');
    link.id=STYLE_ID;
    link.rel='stylesheet';
    link.href=STYLE_HREF;
    document.head.appendChild(link);
  }

  function ensureControls(card){
    const oldBrand=q('.auth-brand',card); if(oldBrand) oldBrand.hidden=true;
    const intro=card.querySelector(':scope > p'); if(intro) intro.hidden=true;

    const forgot=q('#ljiForgotPassword',card);
    if(forgot && !q('.lji-login-controls',card)){
      const controls=document.createElement('div');
      controls.className='lji-login-controls';
      controls.innerHTML='<label class="lji-remember"><input id="ljiRememberAccess" type="checkbox" checked><span></span><b>Lembrar acesso</b></label>';
      forgot.parentNode.insertBefore(controls,forgot);
      controls.appendChild(forgot);
    }

    const login=q('#ljiAuthLogin',card);
    if(login && !q('.lji-login-divider',card)){
      const divider=document.createElement('div');
      divider.className='lji-login-divider';
      divider.innerHTML='<span></span><b>ou</b><span></span>';
      login.insertAdjacentElement('afterend',divider);
      const req=document.createElement('button');
      req.type='button';
      req.className='lji-request-access';
      req.setAttribute('data-lji-request-access','1');
      req.textContent='Solicitar acesso';
      divider.insertAdjacentElement('afterend',req);
    }
  }

  function ensureCardBrand(card){
    q('.lji-approved-card-brand',card)?.remove();
    const brand=document.createElement('div');
    brand.className='lji-approved-card-brand';
    brand.innerHTML='<img src="'+LOGO+'" alt="LJ Radar Imob"><h2>Acesse sua conta</h2>';
    const firstField=q('.auth-field',card);
    if(firstField) card.insertBefore(brand,firstField); else card.prepend(brand);

    const info=q('.auth-info',card);
    if(info){
      if(!info.textContent.trim() || /administrador|suporte/i.test(info.textContent)) info.textContent='Acesso restrito aos usuários autorizados.';
      info.style.display='block';
    }
  }

  function ensureInteractive(overlay){
    const card=q('.auth-card',overlay);
    const email=q('#ljiAuthEmail',overlay);
    const pass=q('#ljiAuthPassword',overlay);
    const login=q('#ljiAuthLogin',overlay);
    [overlay,card,email,pass,login].filter(Boolean).forEach(el=>{el.removeAttribute('inert');el.style.pointerEvents='auto'});
    [email,pass].filter(Boolean).forEach(input=>{
      input.disabled=false;
      input.readOnly=false;
      input.removeAttribute('aria-disabled');
      input.style.userSelect='text';
      input.style.webkitUserSelect='text';
    });
  }

  function build(){
    ensureStyle();
    const overlay=q('#ljiAuthOverlay');
    if(!overlay) return;
    const card=q('.auth-card',overlay);
    if(!card) return;

    ensureControls(card);
    ensureCardBrand(card);

    const shell=document.createElement('div');
    shell.className='lji-approved-shell';

    const hero=document.createElement('section');
    hero.className='lji-approved-hero';
    hero.innerHTML=`
      <div class="lji-approved-brand">
        <img src="${LOGO}" alt="LJ Radar Imob">
        <p>Inteligência imobiliária para captação e oportunidades</p>
      </div>
      <div class="lji-approved-copy">
        <small>ANÁLISE · DADOS · OPERAÇÃO</small>
        <h1>Dados transformam<br>o mercado em<strong>oportunidades.</strong></h1>
        <p>Encontre imóveis, identifique proprietários, antecipe movimentos e aumente seus resultados com inteligência e tecnologia.</p>
      </div>
      <div class="lji-approved-features">
        <div class="lji-approved-feature"><i>▥</i><span><b>Mais Leads</b><em>dados reais e qualificados</em></span></div>
        <div class="lji-approved-feature"><i>↯</i><span><b>Mais Oportunidades</b><em>intenção antes do mercado</em></span></div>
        <div class="lji-approved-feature"><i>◎</i><span><b>Mais Resultados</b><em>decisão com inteligência</em></span></div>
      </div>
      <div class="lji-approved-hero-footer">LJ RADAR IMOB &nbsp; · &nbsp; Inteligência em cada movimento.</div>`;

    const side=document.createElement('section');
    side.className='lji-approved-login-side';
    side.innerHTML='<div class="lji-approved-locale"><b>Brasil</b><i></i><b>PT-BR</b></div><div class="lji-approved-cardwrap"></div><div class="lji-approved-side-footer">ANÁLISE · DADOS · OPERAÇÃO</div>';
    const wrap=q('.lji-approved-cardwrap',side);
    wrap.appendChild(card);

    const support=document.createElement('button');
    support.type='button';
    support.className='lji-approved-support';
    support.textContent='Falar com suporte';
    support.addEventListener('click',()=>{
      const info=q('.auth-info',card);
      if(info){info.textContent='Suporte LJ Radar Imob: fale com o administrador responsável pelo seu acesso.';info.style.display='block'}
    });
    wrap.appendChild(support);

    shell.append(hero,side);
    overlay.className='auth-overlay lji-approved-v30';
    overlay.dataset.approvedStatic='v30-approved-blue';
    overlay.replaceChildren(shell);
    ensureInteractive(overlay);
  }

  function apply(){try{build()}catch(err){console.error('LJ approved login v30',err)}}

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',apply,{once:true});
  else apply();
  window.addEventListener('load',apply,{once:true});
  [100,350,900,1800].forEach(ms=>setTimeout(apply,ms));
})();
