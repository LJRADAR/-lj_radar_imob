'use strict';

/* LJ Radar Imob — Mobile v25
   Layout mobile completo aprovado em 08/09/2026.
   Camada visual isolada: preserva autenticação, páginas, dados, RLS e regras existentes. */
(function(){
  const MAX=900;
  const logo='./lj-logo-compact.png?v=25.0.0';
  const q=(s,r=document)=>r.querySelector(s);
  const qa=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const isMobile=()=>window.innerWidth<=MAX;
  const read=(sel,fallback='0')=>{
    const v=q(sel)?.textContent?.replace(/\s+/g,' ')?.trim();
    return v&&v!=='—'?v:fallback;
  };
  const go=(page)=>{try{window.mobileGo?window.mobileGo(page):window.go?.(page);}catch(_){}};

  const pages={
    dashboard:'Dashboard', 'sales-inbox':'Caixa de Entrada', intentions:'Radar de Intenção', pipeline:'Leads Qualificados', trades:'Permutas', matches:'Matchs Imobiliários', owners:'Proprietários', buyers:'Compradores', 'para-quinto-andar':'Quinto Andar', 'whatsapp-leads':'Leads com WhatsApp', history:'Histórico', discarded:'Descartados', reports:'Relatórios', settings:'Configurações', 'action-center':'Central de Ação', registry:'Pesquisa Registral', 'contact-check':'Verificação de Contato', 'deep-search':'Captação de Proprietários', imports:'Importação', companies:'Empresas', charts:'Gráficos', 'users-admin':'Usuários'
  };
  const pageIcons={dashboard:'⌂','sales-inbox':'✉',intentions:'◎',pipeline:'▥',trades:'⇄',matches:'⌁',owners:'♙',buyers:'♧','para-quinto-andar':'▣','whatsapp-leads':'◉',history:'↶',discarded:'⌫',reports:'▥',settings:'⚙','action-center':'⚡',registry:'⌕','contact-check':'✓','deep-search':'⌖',imports:'⇩',companies:'▤',charts:'▥','users-admin':'♚'};

  function metallicPing(){
    try{
      const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
      const ctx=metallicPing.ctx||(metallicPing.ctx=new AC());
      if(ctx.state==='suspended')ctx.resume().catch(()=>{});
      const now=ctx.currentTime,out=ctx.createGain(),filter=ctx.createBiquadFilter();
      filter.type='bandpass';filter.frequency.setValueAtTime(1500,now);filter.Q.value=1.7;
      out.gain.setValueAtTime(.0001,now);out.gain.exponentialRampToValueAtTime(.055,now+.012);out.gain.exponentialRampToValueAtTime(.0001,now+.27);
      filter.connect(out);out.connect(ctx.destination);
      [440,830,1560].forEach((hz,i)=>{const o=ctx.createOscillator(),g=ctx.createGain();o.type=i?'sine':'triangle';o.frequency.setValueAtTime(hz,now);o.frequency.exponentialRampToValueAtTime(hz*(i===2?.9:1.06),now+.22);g.gain.setValueAtTime(i?0.16:0.3,now);g.gain.exponentialRampToValueAtTime(.0001,now+.25);o.connect(g);g.connect(filter);o.start(now+i*.006);o.stop(now+.28);});
    }catch(_){ }
  }

  function buildLogin(){
    if(!isMobile())return;
    const overlay=q('#ljiAuthOverlay');
    if(!overlay||overlay.dataset.mobileV25==='1')return;
    const card=q('.auth-card',overlay);if(!card)return;
    overlay.dataset.mobileV25='1';overlay.classList.add('lji-mobile-login-v25');

    q('.auth-brand',card)?.setAttribute('hidden','hidden');
    const intro=card.querySelector(':scope > p');if(intro)intro.hidden=true;

    if(!q('.lji-m-brand',card)){
      const brand=document.createElement('div');brand.className='lji-m-brand';
      brand.innerHTML=`<img src="${logo}" alt="LJ Radar Imob"><p>Inteligência imobiliária para captação e oportunidades.</p>`;
      card.prepend(brand);
    }

    const forgot=q('#ljiForgotPassword',card);
    if(forgot&&!q('.lji-m-login-controls',card)){
      const controls=document.createElement('div');controls.className='lji-m-login-controls';
      controls.innerHTML='<label><input id="ljiMobileRemember" type="checkbox" checked><span></span><b>Lembrar acesso</b></label>';
      forgot.parentNode.insertBefore(controls,forgot);controls.appendChild(forgot);
    }

    const login=q('#ljiAuthLogin',card);
    if(login&&!q('.lji-m-divider',card)){
      const divider=document.createElement('div');divider.className='lji-m-divider';divider.innerHTML='<i></i><b>ou</b><i></i>';
      login.insertAdjacentElement('afterend',divider);
      const req=document.createElement('button');req.type='button';req.className='lji-m-request';req.innerHTML='<span>♙</span> Solicitar acesso';
      divider.insertAdjacentElement('afterend',req);
      req.addEventListener('click',()=>{const info=q('.auth-info',card);if(info){info.textContent='Solicite a liberação ao administrador do workspace LJ Radar Imob.';info.style.display='block';}});
    }

    const shell=document.createElement('div');shell.className='lji-m-login-shell';
    const hero=document.createElement('section');hero.className='lji-m-login-hero';
    hero.innerHTML=`<div class="lji-m-login-locale"><b>Brasil</b><i></i><b>PT-BR</b></div><div class="lji-m-login-copy"><small>ANÁLISE · DADOS · OPERAÇÃO</small><h1>O mercado imobiliário com <strong>mais inteligência.</strong></h1><p>ENCONTRE IMÓVEIS · IDENTIFIQUE OPORTUNIDADES · ANTECIPE MOVIMENTOS.</p></div><div class="lji-m-radar"><i></i><i></i><i></i><b></b></div>`;
    const wrap=document.createElement('section');wrap.className='lji-m-login-cardwrap';
    const support=document.createElement('button');support.type='button';support.className='lji-m-support';support.textContent='◉  Falar com suporte';
    support.addEventListener('click',()=>{const info=q('.auth-info',card);if(info){info.textContent='Suporte LJ Radar Imob: fale com o administrador responsável pelo seu acesso.';info.style.display='block';}});
    wrap.append(card,support);
    shell.append(hero,wrap);overlay.replaceChildren(shell);
    let last=0;q('.lji-m-radar',hero)?.addEventListener('pointerenter',()=>{if(Date.now()-last>650){last=Date.now();metallicPing();}});
  }

  function currentPage(){
    const known=Object.keys(pages);
    return known.find(id=>{const el=q('#'+id);return el&&!el.classList.contains('hidden')&&(getComputedStyle(el).display!=='none');})||'dashboard';
  }

  function buildAppBar(){
    if(!isMobile()||q('.lji-mobile-appbar'))return;
    const bar=document.createElement('header');bar.className='lji-mobile-appbar';
    bar.innerHTML=`<button class="brand" type="button" data-go="dashboard"><img src="${logo}" alt="LJ"><span><strong>LJ Radar Imob</strong><small id="ljiMPageTitle">Dashboard</small></span></button><div class="actions"><button class="alert" type="button" title="Alertas">♢<b id="ljiMAlertCount"></b></button><button class="profile" type="button" title="Perfil"><span id="ljiMAvatar">JC</span></button><button class="menu" type="button" title="Menu">☰</button></div>`;
    document.body.appendChild(bar);
    q('[data-go]',bar).addEventListener('click',()=>go('dashboard'));
    q('.profile',bar).addEventListener('click',()=>window.openSettingsPanel?.('account'));
    q('.menu',bar).addEventListener('click',()=>window.toggleMobileMenu?.());
    q('.alert',bar).addEventListener('click',()=>go('action-center'));
  }

  function tuneBottomNav(){
    if(!isMobile())return;
    const nav=q('.mobile-bottom-nav');if(!nav)return;
    const buttons=qa('button',nav);if(buttons.length<5)return;
    const defs=[['dashboard','⌂','Início'],['sales-inbox','✉','Caixa'],['intentions','◎','Radar'],['matches','⌁','Match'],['__more__','☰','Mais']];
    buttons.forEach((b,i)=>{const [page,ic,label]=defs[i];b.dataset.mobileGo=page;b.innerHTML=`<span>${ic}</span><b>${label}</b>`;b.classList.toggle('mobile-nav-home',i===0);b.classList.toggle('mobile-nav-inbox',i===1);b.classList.toggle('mobile-nav-radar',i===2);b.classList.toggle('mobile-nav-match',i===3);if(page==='__more__')b.setAttribute('onclick','toggleMobileMenu()');else b.setAttribute('onclick',`mobileGo('${page}')`);});
  }

  function enhanceMoreSheet(){
    const sheet=q('#mobileMoreSheet'),grid=q('#mobileMenuGrid');if(!sheet||!grid)return;
    const decorate=()=>{
      qa('button[data-mobile-page]',grid).forEach(b=>{if(b.dataset.v25==='1')return;b.dataset.v25='1';const p=b.dataset.mobilePage;const label=pages[p]||b.textContent.trim();b.innerHTML=`<span>${pageIcons[p]||'•'}</span><b>${esc(label)}</b><i>›</i>`;});
      const head=q('.mobile-more-head',sheet);if(head&&!q('.lji-m-sheet-brand',head)){const brand=document.createElement('div');brand.className='lji-m-sheet-brand';brand.innerHTML=`<img src="${logo}" alt="LJ"><span><strong>LJ Radar Imob</strong><small>Todos os módulos</small></span>`;head.prepend(brand);const oldStrong=head.querySelector(':scope > strong');if(oldStrong)oldStrong.remove();}
    };
    new MutationObserver(decorate).observe(grid,{childList:true,subtree:true});decorate();
  }

  function leadRows(){
    let rows=qa('#deepSearchTable tbody tr');if(!rows.length)rows=qa('#deepSearchTable table tr').slice(1);
    return rows.slice(0,6).map((tr,i)=>{const cells=qa('td',tr).map(td=>td.textContent.replace(/\s+/g,' ').trim()).filter(Boolean);const raw=cells.join(' · ');return {lead:cells[0]||`Lead ${i+1}`,detail:cells[1]||cells[2]||'Aguardando análise',source:/facebook/i.test(raw)?'Facebook':/apify/i.test(raw)?'Apify':/quinto/i.test(raw)?'Quinto Andar':/olx/i.test(raw)?'OLX':/radar|intenção/i.test(raw)?'Radar':'Coleta',region:cells.find(x=>/São Paulo|Santo André|São Bernardo|São Caetano|Diadema|Zona|ABC|SP\b/i.test(x))||'Região não informada',contact:(raw.match(/(?:\+?55\s*)?\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4}/)||[])[0]||(/whatsapp/i.test(raw)?'WhatsApp':'—'),type:/permuta/i.test(raw)?'Permuta':/alug|loca/i.test(raw)?'Locação':/compra|procura/i.test(raw)?'Compra':/vend/i.test(raw)?'Venda':'Lead'};});
  }

  function opportunities(){
    const src=q('#dashTop3');if(!src)return[];
    return Array.from(src.children).filter(x=>!x.classList.contains('empty')).slice(0,3).map((el,i)=>{const txt=el.textContent.replace(/\s+/g,' ').trim();const img=q('img',el)?.src||'';const price=(txt.match(/R\$\s?[\d\.]+(?:,\d{2})?/i)||[])[0]||'';return {title:(q('h3',el)?.textContent||q('strong',el)?.textContent||['Oportunidade 1','Oportunidade 2','Oportunidade 3'][i]).trim(),price,img,raw:txt};});
  }

  function buildDashboard(){
    if(!isMobile())return;
    const page=q('#dashboard');if(!page||q('.lji-mobile-dashboard',page))return;
    page.classList.add('lji-mobile-dashboard-host');
    const root=document.createElement('div');root.className='lji-mobile-dashboard';
    root.innerHTML=`
      <section class="lji-m-greeting"><div><small id="ljiMGreeting">Bom dia</small><h1><span id="ljiMName">Júlio César</span> <i>👋</i></h1><p>Inteligência imobiliária para captação e oportunidades.</p></div><button type="button" data-go="settings">⚙</button></section>
      <section class="lji-m-kpis">
        <button data-go="owners"><span>⌂</span><small>Imóveis na base</small><strong data-k="owners">0</strong></button>
        <button data-go="matches"><span>✦</span><small>Leads quentes</small><strong data-k="hot">0</strong></button>
        <button data-go="trades"><span>⇄</span><small>Permutas</small><strong data-k="trades">0</strong></button>
        <button data-go="whatsapp-leads"><span class="wa">◉</span><small>WhatsApp</small><strong data-k="wa">0</strong></button>
      </section>
      <section class="lji-m-quick"><button data-go="sales-inbox"><span>✉</span><b>Caixa de Entrada</b></button><button data-go="intentions"><span>◎</span><b>Radar</b></button><button data-go="matches"><span>⌁</span><b>Matchs</b></button><button data-go="trades"><span>⇄</span><b>Permutas</b></button></section>
      <article class="lji-m-card lji-m-inbox"><header><div><span class="icon">✉</span><span><h2>Caixa de Entrada</h2><p>Leads captados de todos os canais.</p></span></div><button data-go="sales-inbox">Ver todos</button></header><div class="actions"><button data-go="pipeline">Qualificar</button><button data-go="sales-inbox">A revisar</button><button data-go="discarded" class="danger">Descartar</button></div><div class="body"></div></article>
      <article class="lji-m-card lji-m-radar-card"><header><div><span class="icon">◎</span><span><h2>Radar de Intenção</h2><p>Antecipe movimentos do mercado.</p></span></div><button data-go="intentions">Abrir</button></header><div class="viz"><i></i><i></i><i></i><b></b><span><strong data-k="intent">0</strong><small>intenções monitoradas</small></span></div></article>
      <article class="lji-m-card lji-m-opps"><header><div><span class="icon">✦</span><span><h2>3 Melhores Oportunidades</h2><p>Selecionadas pela inteligência do Radar.</p></span></div><button data-go="deep-search">Ver todas</button></header><div class="body"></div></article>
      <div class="lji-m-two">
        <article class="lji-m-card mini"><header><div><span class="icon">⌁</span><span><h2>Matchs</h2><p>Compatibilidades atuais</p></span></div></header><strong class="big" data-k="matches">0</strong><button data-go="matches">Abrir Match Engine →</button></article>
        <article class="lji-m-card mini"><header><div><span class="icon">⇄</span><span><h2>Permutas</h2><p>Oportunidades de troca</p></span></div></header><strong class="big" data-k="trades2">0</strong><button data-go="trades">Abrir Permutas →</button></article>
      </div>
      <article class="lji-m-card lji-m-funnel"><header><div><span class="icon">▥</span><span><h2>Leads Qualificados</h2><p>Funil da operação</p></span></div><button data-go="pipeline">Relatório</button></header><div><span><strong data-f="contact">—</strong><small>Em contato</small></span><span><strong data-f="review">—</strong><small>A revisar</small></span><span><strong data-f="qualified">—</strong><small>Qualificados</small></span><span><strong data-f="quinto">—</strong><small>Quinto Andar</small></span></div></article>
      <section class="lji-m-modules"><h2>Todos os módulos</h2><div></div></section>`;
    page.prepend(root);
    qa('[data-go]',root).forEach(b=>b.addEventListener('click',()=>go(b.dataset.go)));
    const grid=q('.lji-m-modules>div',root);
    Object.entries(pages).filter(([p])=>!['dashboard','settings'].includes(p)).forEach(([p,label])=>{const b=document.createElement('button');b.type='button';b.dataset.go=p;b.innerHTML=`<span>${pageIcons[p]||'•'}</span><b>${label}</b><i>›</i>`;b.addEventListener('click',()=>go(p));grid.appendChild(b);});
    refreshDashboard();
  }

  function renderInbox(){
    const body=q('.lji-m-inbox .body');if(!body)return;const rows=leadRows();
    if(!rows.length){body.innerHTML='<div class="empty">Aguardando coleta de novos leads.</div>';return;}
    body.innerHTML=rows.map((r,i)=>`<button class="row ${i%2?'':'tint'}" type="button" data-open="deep-search"><label><input type="checkbox" onclick="event.stopPropagation()"><span></span></label><span class="main"><strong>${esc(r.lead).slice(0,48)}</strong><small>${esc(r.region).slice(0,42)} · ${esc(r.type)}</small></span><span class="source">${esc(r.source)}</span><i>›</i></button>`).join('');
    qa('[data-open]',body).forEach(b=>b.addEventListener('click',()=>go(b.dataset.open)));
  }

  function renderOpps(){
    const body=q('.lji-m-opps .body');if(!body)return;const opps=opportunities();
    if(!opps.length){body.innerHTML='<div class="empty">Aguardando oportunidades qualificadas.</div>';return;}
    body.innerHTML=opps.map((o,i)=>`<button type="button" data-open="deep-search"><span class="photo" ${o.img?`style="background-image:url('${esc(o.img)}')"`:''}></span><span><small>Oportunidade ${i+1}</small><strong>${esc(o.title).slice(0,42)}</strong><b>${esc(o.price)||'Valor não informado'}</b></span><i>›</i></button>`).join('');
    qa('[data-open]',body).forEach(b=>b.addEventListener('click',()=>go(b.dataset.open)));
  }

  function refreshIdentity(){
    const name=q('#currentUserName')?.textContent?.trim()||window.LJI_CURRENT_USER?.name||'Júlio César';
    const role=q('#currentUserRole')?.textContent?.trim()||window.LJI_CURRENT_USER?.role||'CEO';
    const initials=name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'JC';
    ['#ljiMName'].forEach(s=>{const e=q(s);if(e)e.textContent=name;});
    const av=q('#ljiMAvatar');if(av)av.textContent=initials;
    const hour=new Date().getHours(),g=hour<12?'Bom dia':hour<18?'Boa tarde':'Boa noite';const ge=q('#ljiMGreeting');if(ge)ge.textContent=g;
    const pt=q('#ljiMPageTitle');if(pt)pt.textContent=pages[currentPage()]||'LJ Radar Imob';
    const ac=q('#alertsBellCount')?.textContent?.trim()||'';const badge=q('#ljiMAlertCount');if(badge){badge.textContent=ac;badge.hidden=!ac;}
    document.documentElement.style.setProperty('--lji-mobile-user-role',`"${String(role).replace(/"/g,'')}"`);
  }

  function refreshDashboard(){
    if(!isMobile())return;
    const map={owners:read('#mOwners','0'),hot:read('#mHot',read('#mPriority','0')),trades:read('#tMatches',read('#tIntents','0')),wa:read('#waTotal','0'),intent:read('#iTotal',read('#mIntentions','0')),matches:read('#mtotal',read('#mMatches','0')),trades2:read('#tMatches',read('#tIntents','0'))};
    Object.entries(map).forEach(([k,v])=>qa(`[data-k="${k}"]`).forEach(e=>e.textContent=v));
    const funnel={contact:read('#pipeToContact','—'),review:read('#salesQueueCount',read('#pipeOpen','—')),qualified:read('#pipeNegotiating','—'),quinto:read('#pqaTotal','—')};
    Object.entries(funnel).forEach(([k,v])=>qa(`[data-f="${k}"]`).forEach(e=>e.textContent=v));
    renderInbox();renderOpps();refreshIdentity();
  }

  function syncActive(){
    if(!isMobile())return;const p=currentPage();
    qa('.mobile-bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.mobileGo===p));
    refreshIdentity();
  }

  function apply(){
    if(!isMobile())return;
    document.documentElement.classList.add('lji-mobile-v25');document.body?.classList.add('lji-mobile-v25');
    buildLogin();buildAppBar();tuneBottomNav();enhanceMoreSheet();buildDashboard();syncActive();refreshDashboard();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
  window.addEventListener('load',()=>{apply();setTimeout(apply,500);});
  window.addEventListener('resize',()=>{if(isMobile())apply();});
  document.addEventListener('click',e=>{if(isMobile()&&e.target.closest('[data-page],[data-mobile-page],[data-mobile-go]'))setTimeout(syncActive,80);});
  const observer=new MutationObserver(()=>{if(isMobile()){syncActive();refreshIdentity();}});
  window.addEventListener('load',()=>{const main=q('main');if(main)observer.observe(main,{subtree:true,attributes:true,attributeFilter:['class']});});
  setInterval(()=>{if(isMobile()&&!document.hidden)refreshDashboard();},6000);
})();
