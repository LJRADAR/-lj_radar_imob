'use strict';

/* LJ Radar Imob — Desktop UI v23
   Camada de composição visual. Não altera regras de negócio, RLS, coleta ou dados. */
(function(){
  const DESKTOP_MIN = 901;
  const logoSrc = './lj-logo-compact.png?v=23.0.0';

  function isDesktop(){ return window.innerWidth >= DESKTOP_MIN; }
  function q(sel, root=document){ return root.querySelector(sel); }
  function qa(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }

  function setDesktopClasses(){
    if(!isDesktop()) return;
    document.documentElement.classList.add('lji-desktop-v23');
    document.body?.classList.add('lji-layout-v23');
  }

  function metallicPing(){
    try{
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if(!AudioCtx) return;
      const ctx = metallicPing.ctx || (metallicPing.ctx = new AudioCtx());
      if(ctx.state === 'suspended') ctx.resume().catch(()=>{});
      const now = ctx.currentTime;
      const out = ctx.createGain();
      out.gain.setValueAtTime(0.0001, now);
      out.gain.exponentialRampToValueAtTime(0.08, now + 0.012);
      out.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      out.connect(ctx.destination);
      [520, 910, 1430].forEach((hz, i)=>{
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = i === 0 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(hz, now);
        osc.frequency.exponentialRampToValueAtTime(hz * (i === 2 ? 0.82 : 1.04), now + 0.22);
        gain.gain.setValueAtTime(i === 0 ? 0.45 : 0.22, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
        osc.connect(gain); gain.connect(out);
        osc.start(now + i * 0.008); osc.stop(now + 0.29);
      });
    }catch(_){ }
  }

  function buildLogin(){
    if(!isDesktop()) return;
    const overlay = q('#ljiAuthOverlay');
    if(!overlay || overlay.dataset.v23Ready === '1') return;
    const card = q('.auth-card', overlay);
    if(!card) return;

    overlay.dataset.v23Ready = '1';
    overlay.classList.add('lji-login-v23');

    const brandOld = q('.auth-brand', card);
    const introOld = card.querySelector(':scope > p');
    if(brandOld) brandOld.hidden = true;
    if(introOld) introOld.hidden = true;

    const forgot = q('#ljiForgotPassword', card);
    let controls = q('.lji-login-controls', card);
    if(!controls && forgot){
      controls = document.createElement('div');
      controls.className = 'lji-login-controls';
      controls.innerHTML = '<label class="lji-remember"><input id="ljiRememberAccess" type="checkbox" checked><span></span><b>Lembrar acesso</b></label>';
      forgot.parentNode.insertBefore(controls, forgot);
      controls.appendChild(forgot);
    }

    const loginBtn = q('#ljiAuthLogin', card);
    if(loginBtn && !q('.lji-login-divider', card)){
      const divider = document.createElement('div');
      divider.className = 'lji-login-divider';
      divider.innerHTML = '<span></span><b>ou</b><span></span>';
      loginBtn.insertAdjacentElement('afterend', divider);

      const request = document.createElement('button');
      request.type = 'button';
      request.className = 'lji-request-access';
      request.textContent = 'Solicitar acesso';
      divider.insertAdjacentElement('afterend', request);
      request.addEventListener('click', ()=>{
        const info = q('.auth-info', card);
        if(info){
          info.textContent = 'Solicite a liberação ao administrador do workspace LJ Radar Imob.';
          info.classList.add('lji-auth-info-visible');
        }
      });
    }

    const shell = document.createElement('div');
    shell.className = 'lji-login-shell';

    const left = document.createElement('section');
    left.className = 'lji-login-left';
    left.innerHTML = `
      <div class="lji-login-edge-copy"><i></i><span>MAIS MERCADO</span><span>MAIS OPORTUNIDADES</span><span>MAIS RESULTADOS</span></div>
      <div class="lji-login-left-inner">
        <div class="lji-login-brand" aria-label="LJ Radar Imob">
          <img class="lji-login-logo" src="${logoSrc}" alt="LJ Radar Imob">
          <h1>LJ Radar Imob</h1>
          <p>Inteligência imobiliária para captação e oportunidades.</p>
        </div>
      </div>
      <div class="lji-login-footer">LJ Radar Imob &nbsp; © 2026</div>`;
    q('.lji-login-left-inner', left).appendChild(card);

    const support = document.createElement('button');
    support.type = 'button';
    support.className = 'lji-login-support';
    support.textContent = '◉  Falar com suporte';
    support.addEventListener('click', ()=>{
      const info = q('.auth-info', card);
      if(info){
        info.textContent = 'Suporte LJ Radar Imob: fale com o administrador responsável pelo seu acesso.';
        info.classList.add('lji-auth-info-visible');
      }
    });
    q('.lji-login-left-inner', left).appendChild(support);

    const hero = document.createElement('section');
    hero.className = 'lji-login-hero';
    hero.innerHTML = `
      <div class="lji-login-lang"><span>Brasil⌄</span><i></i><span>PT⌄</span></div>
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
      <div class="lji-login-feature-list"><span>▥ &nbsp; Leads qualificados</span><span>◎ &nbsp; Análise de mercado</span><span>♢ &nbsp; Alertas em tempo real</span><span>↗ &nbsp; Vantagem competitiva</span></div>
      <blockquote>“Dados transformam<br>o mercado em oportunidades.”</blockquote>
      <div class="lji-login-bottom-words">DADOS <b>·</b> PESSOAS <b>·</b> OPORTUNIDADES <b>·</b> RESULTADOS</div>`;

    overlay.replaceChildren(shell);
    shell.append(left, hero);

    const radar = q('.lji-login-hero-radar', hero);
    let lastPing = 0;
    const ping = ()=>{
      const now = Date.now();
      if(now - lastPing < 650) return;
      lastPing = now;
      metallicPing();
    };
    radar?.addEventListener('pointerenter', ping);
    radar?.addEventListener('pointerdown', ping);
  }

  function buildSidebarBrand(){
    if(!isDesktop()) return;
    const sidebar = q('.sidebar');
    if(!sidebar || q('.lji-desktop-brand', sidebar)) return;
    const brand = document.createElement('div');
    brand.className = 'lji-desktop-brand';
    brand.innerHTML = `<img class="lji-desktop-brand-logo" src="${logoSrc}" alt="LJ Radar Imob"><span><strong>LJ Radar Imob</strong><small>INTELIGÊNCIA IMOBILIÁRIA</small></span>`;
    sidebar.insertBefore(brand, sidebar.firstChild);
  }

  function buildDashboardProfile(){
    if(!isDesktop()) return;
    const right = q('#dashboard .dash-command-right');
    if(!right || q('.lji-dash-profile', right)) return;
    const profile = document.createElement('button');
    profile.type = 'button';
    profile.className = 'lji-dash-profile';
    profile.onclick = ()=>window.openSettingsPanel?.();
    profile.innerHTML = '<span class="lji-profile-avatar">JC</span><span><strong>Júlio César</strong><small>CEO · LJ Radar Imob</small></span><i>⌄</i>';
    right.appendChild(profile);

    const sync = ()=>{
      const name = q('#currentUserName')?.textContent?.trim() || 'Júlio César';
      const role = q('#currentUserRole')?.textContent?.trim() || 'CEO';
      const strong = q('strong', profile), small = q('small', profile), avatar = q('.lji-profile-avatar', profile);
      if(strong) strong.textContent = name;
      if(small) small.textContent = `${role} · LJ Radar Imob`;
      if(avatar) avatar.textContent = name.split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase() || 'JC';
    };
    sync();
    const target = q('.sidebar-user');
    if(target) new MutationObserver(sync).observe(target,{subtree:true,characterData:true,childList:true});
  }

  function liveNumber(id, fallback='0'){
    const text = q(id)?.textContent?.trim();
    return text && text !== '—' ? text : fallback;
  }

  function extractLeadPreview(){
    const rows = qa('#deepSearchTable table tbody tr').slice(0,5);
    if(!rows.length) return '<div class="lji-inbox-empty">Nenhum lead aguardando revisão nesta visualização.</div>';
    return rows.map((tr, idx)=>{
      const cells = qa('td', tr).map(td=>td.textContent.replace(/\s+/g,' ').trim()).filter(Boolean);
      const lead = cells[0] || `Lead ${idx+1}`;
      const detail = cells[1] || cells[2] || 'Origem pública';
      const meta = cells.slice(2,5).join(' · ') || 'Aguardando análise';
      return `<div><span>□</span><b>${escapeHtml(lead).slice(0,80)}</b><em>${escapeHtml(detail).slice(0,100)}</em><small>${escapeHtml(meta).slice(0,90)}</small></div>`;
    }).join('');
  }

  function escapeHtml(v){
    return String(v??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function buildDashboardOverview(){
    if(!isDesktop()) return;
    const dashboard = q('#dashboard');
    if(!dashboard || q('.lji-dashboard-overview', dashboard)) return;
    const anchor = q('.dash-kpis-modern', dashboard) || q('.dash-action-center-banner', dashboard) || dashboard.firstElementChild;
    const wrap = document.createElement('section');
    wrap.className = 'lji-dashboard-overview';
    wrap.innerHTML = `
      <article class="lji-overview-card">
        <header><div><span class="ico">✉</span><span><strong>Caixa de Entrada de Leads</strong><small>Leads captados para triagem, no estilo Gmail</small></span></div><button type="button" data-go="deep-search">Ver todos →</button></header>
        <div class="lji-inbox-toolbar"><button data-go="deep-search">Mover para Qualificados</button><button data-go="deep-search">A revisar</button><button data-go="discarded">Rejeitar</button><button data-go="deep-search">Exportar Excel</button></div>
        <div class="lji-inbox-preview"></div>
      </article>
      <div class="lji-overview-side">
        <article class="lji-mini-module"><header><span class="ico">⌁</span><strong>Match Engine</strong><button data-go="matches">Ver todos →</button></header><p>Conectando compradores, intenções e imóveis reais.</p><div><span>Matches atuais</span><b data-live="matches">0</b></div><div><span>Prioridades</span><b data-live="priority">0</b></div></article>
        <article class="lji-mini-module"><header><span class="ico">⇄</span><strong>Permutas</strong><button data-go="trades">Ver todas →</button></header><p>Oportunidades de troca e compatibilidade bidirecional.</p><div><span>Matches de permuta</span><b data-live="trades">0</b></div><div><span>Interesses</span><b data-live="tradeIntents">0</b></div></article>
      </div>`;
    anchor.insertAdjacentElement('afterend', wrap);
    qa('[data-go]', wrap).forEach(btn=>btn.addEventListener('click',()=>window.go?.(btn.dataset.go)));

    const refresh = ()=>{
      const preview = q('.lji-inbox-preview', wrap);
      if(preview) preview.innerHTML = extractLeadPreview();
      const map = {
        matches: '#mMatches',
        priority: '#mPriority',
        trades: '#tMatches',
        tradeIntents: '#tIntents'
      };
      Object.entries(map).forEach(([key, id])=>{
        const el = q(`[data-live="${key}"]`, wrap);
        if(el) el.textContent = liveNumber(id);
      });
    };
    refresh();
    setInterval(refresh, 5000);
  }

  function apply(){
    if(!isDesktop()) return;
    setDesktopClasses();
    buildLogin();
    buildSidebarBrand();
    buildDashboardProfile();
    buildDashboardOverview();
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, {once:true});
  else apply();
  window.addEventListener('load', apply, {once:true});
  window.addEventListener('resize', ()=>{ if(isDesktop()) apply(); });
})();
