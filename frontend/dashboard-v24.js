'use strict';

/* LJ Radar Imob — Dashboard Desktop v24
   Cockpit visual aprovado em 08/09/2026.
   Camada isolada: preserva páginas, regras, RLS e módulos existentes. */
(function(){
  const MIN = 901;
  const logo = './lj-logo-compact.png?v=24.0.0';
  const q = (s,r=document)=>r.querySelector(s);
  const qa = (s,r=document)=>Array.from(r.querySelectorAll(s));
  const esc = (v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const text = (sel, fallback='0')=>{
    const v=q(sel)?.textContent?.replace(/\s+/g,' ')?.trim();
    return v && v !== '—' ? v : fallback;
  };
  const go = (page)=>{ try{ window.go?.(page); }catch(_){} };
  const isDesktop=()=>window.innerWidth>=MIN;

  const icons={
    dashboard:'⌂', inbox:'✉', radar:'◎', qualified:'▥', trades:'⇄', matches:'⌁', owners:'♙', buyers:'♧', quinto:'▣', whatsapp:'◉', history:'↶', discarded:'⌫', reports:'▥', settings:'⚙'
  };

  const mainNav=[
    ['dashboard','Dashboard','dashboard'],
    ['sales-inbox','Caixa de Entrada','inbox'],
    ['intentions','Radar de Intenção','radar'],
    ['pipeline','Leads Qualificados','qualified'],
    ['trades','Permutas','trades'],
    ['matches','Matchs Imobiliários','matches'],
    ['owners','Proprietários','owners'],
    ['buyers','Compradores','buyers'],
    ['para-quinto-andar','Quinto Andar','quinto'],
    ['whatsapp-leads','Leads com WhatsApp','whatsapp'],
    ['history','Histórico','history'],
    ['discarded','Descartados','discarded'],
    ['reports','Relatórios','reports'],
    ['settings','Configurações','settings']
  ];

  const moreNav=[
    ['action-center','Central de Ação'],['registry','Pesquisa Registral'],['contact-check','Verificação de Contato'],['deep-search','Captação de proprietários'],['imports','Importação técnica'],['companies','Empresas'],['charts','Gráficos da operação'],['users-admin','Usuários e permissões']
  ];

  function buildSidebar(){
    if(!isDesktop()) return;
    const sidebar=q('.sidebar');
    if(!sidebar || q('.lji-v24-sidebar',sidebar)) return;
    sidebar.classList.add('lji-v24-sidebar-host');
    const shell=document.createElement('div');
    shell.className='lji-v24-sidebar';
    shell.innerHTML=`
      <div class="lji-v24-sidebrand"><img src="${logo}" alt="LJ Radar Imob"></div>
      <nav class="lji-v24-mainnav"></nav>
      <details class="lji-v24-more"><summary><span>⋯</span> Mais ferramentas</summary><div></div></details>
      <div class="lji-v24-sideart"><span>MAIS MERCADO</span><span>MAIS OPORTUNIDADES</span><span>MAIS RESULTADOS</span></div>
      <button class="lji-v24-signout" type="button">Sair</button>`;
    const nav=q('.lji-v24-mainnav',shell);
    mainNav.forEach(([page,label,key])=>{
      const b=document.createElement('button');
      b.type='button'; b.dataset.page=page;
      b.innerHTML=`<span class="nji">${icons[key]||'•'}</span><span>${label}</span><b class="lji-v24-navcount"></b>`;
      b.addEventListener('click',()=>go(page));
      nav.appendChild(b);
    });
    const more=q('.lji-v24-more > div',shell);
    moreNav.forEach(([page,label])=>{
      const b=document.createElement('button'); b.type='button'; b.dataset.page=page; b.textContent=label; b.addEventListener('click',()=>go(page)); more.appendChild(b);
    });
    q('.lji-v24-signout',shell)?.addEventListener('click',()=>window.LJI_BACKEND?.client?.auth.signOut().then(()=>location.reload()));
    sidebar.insertBefore(shell,sidebar.firstChild);
    syncSidebar();
  }

  function syncSidebar(){
    const shell=q('.lji-v24-sidebar'); if(!shell) return;
    const active=q('.sidebar > .nav button.active')?.dataset?.page || (q('#dashboard:not(.hidden)')?'dashboard':'');
    qa('.lji-v24-mainnav button',shell).forEach(b=>b.classList.toggle('active',b.dataset.page===active));
    const counts={
      'sales-inbox':text('#salesInboxNavCount',''), pipeline:text('#pipelineNavCount',''), trades:text('#tradeNavCount',''), matches:text('#mtMatchesBadge',''),
      'para-quinto-andar':text('#paraQaNavCount',''), 'whatsapp-leads':text('#whatsappNavCount',''), discarded:text('#discardedNavCount','')
    };
    Object.entries(counts).forEach(([p,v])=>{const el=q(`.lji-v24-mainnav button[data-page="${p}"] .lji-v24-navcount`,shell); if(el){el.textContent=v;el.hidden=!v;}});
  }

  function leadRows(){
    let rows=qa('#deepSearchTable tbody tr');
    if(!rows.length) rows=qa('#deepSearchTable table tr').slice(1);
    return rows.slice(0,5).map((tr,i)=>{
      const cells=qa('td',tr).map(td=>td.textContent.replace(/\s+/g,' ').trim()).filter(Boolean);
      const raw=cells.join(' · ');
      const source=/facebook/i.test(raw)?'Facebook':/apify/i.test(raw)?'Apify':/quinto/i.test(raw)?'Quinto Andar':/olx/i.test(raw)?'OLX':/radar|intenção/i.test(raw)?'Radar':'Coleta';
      const contact=(raw.match(/(?:\+?55\s*)?\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4}/)||[])[0] || (/whatsapp/i.test(raw)?'WhatsApp':'—');
      const lead=cells[0]||`Lead ${i+1}`;
      const detail=cells[1]||cells[2]||'Aguardando análise';
      const region=cells.find(x=>/São Paulo|Santo André|São Bernardo|São Caetano|Diadema|Zona|ABC|SP\b/i.test(x))||'Região não informada';
      const type=/permuta/i.test(raw)?'Permuta':/alug|loca/i.test(raw)?'Locação':/compra|procura/i.test(raw)?'Compra':/vend/i.test(raw)?'Venda':'Lead';
      return {lead,detail,source,region,type,contact,status:'Novo'};
    });
  }

  function renderInbox(root){
    const body=q('.lji-v24-inbox-body',root); if(!body) return;
    const rows=leadRows();
    if(!rows.length){body.innerHTML='<div class="lji-v24-empty">Aguardando coleta de novos leads.</div>';return;}
    body.innerHTML=rows.map((r,i)=>`<div class="lji-v24-inbox-row ${i%2?'':'tint'}">
      <label><input type="checkbox" class="lji-v24-lead-check"><span></span></label>
      <div class="lead"><strong>${esc(r.lead).slice(0,60)}</strong><small>${esc(r.detail).slice(0,70)}</small></div>
      <div><span class="source">${esc(r.source)}</span></div>
      <div><strong>${esc(r.region).slice(0,38)}</strong></div>
      <div>${esc(r.type)}</div>
      <div class="contact">${esc(r.contact)}</div>
      <div><span class="status">${esc(r.status)}</span></div>
      <div class="received">Agora</div>
      <button type="button" class="dots" title="Abrir lead">•••</button>
    </div>`).join('');
    qa('.dots',body).forEach(b=>b.addEventListener('click',()=>go('deep-search')));
  }

  function previewRows(container,sourceSelector,emptyText,limit=4){
    const src=q(sourceSelector);
    if(!container) return;
    const rows=src?qa('tbody tr',src).slice(0,limit):[];
    if(!rows.length){container.innerHTML=`<div class="lji-v24-mini-empty">${emptyText}</div>`;return;}
    container.innerHTML=rows.map((tr,i)=>{
      const c=qa('td',tr).map(td=>td.textContent.replace(/\s+/g,' ').trim()).filter(Boolean);
      return `<div class="lji-v24-person"><span class="avatar">${String(c[0]||'L').trim().charAt(0).toUpperCase()}</span><span><strong>${esc(c[0]||`Registro ${i+1}`).slice(0,34)}</strong><small>${esc(c[1]||c[2]||'Compatibilidade registrada').slice(0,58)}</small></span><b>${esc((c.find(x=>/%/.test(x))||'')).slice(0,5)}</b></div>`;
    }).join('');
  }

  function cloneTop3(root){
    const dst=q('.lji-v24-top3-grid',root), src=q('#dashTop3'); if(!dst) return;
    if(src && src.children.length && !src.querySelector('.empty')) dst.innerHTML=src.innerHTML;
    else dst.innerHTML='<div class="lji-v24-mini-empty">Aguardando oportunidades qualificadas.</div>';
  }

  function renderRadar(root){
    const box=q('.lji-v24-radarviz',root); if(!box) return;
    const intentions=text('#mIntentions','0');
    box.innerHTML=`<div class="ring a"></div><div class="ring b"></div><div class="ring c"></div><div class="center"></div>
      <i class="pin p1"></i><i class="pin p2"></i><i class="pin p3"></i><i class="pin p4"></i>
      <div class="radar-meta"><b>${esc(intentions)}</b><span>intenções monitoradas</span></div>`;
  }

  function buildDashboard(){
    if(!isDesktop()) return;
    const page=q('#dashboard');
    if(!page || q('.lji-v24-dashboard',page)) return;
    page.classList.add('lji-v24-dashboard-host');
    const root=document.createElement('div');
    root.className='lji-v24-dashboard';
    root.innerHTML=`
      <header class="lji-v24-top">
        <div class="hello"><h1><span id="ljiV24Greeting">Bom dia</span>, <strong id="ljiV24Name">Júlio César</strong> <i>👋</i></h1><p>Inteligência imobiliária para captação e oportunidades.</p></div>
        <div class="search"><span>⌕</span><input id="ljiV24Search" placeholder="Buscar imóveis, leads, proprietários, cidades..."><kbd>⌘ K</kbd></div>
        <button class="bell" type="button" title="Alertas">♧<b id="ljiV24BellCount"></b></button>
        <button class="profile" type="button"><span class="avatar" id="ljiV24Avatar">JC</span><span><strong id="ljiV24ProfileName">Júlio César</strong><small id="ljiV24Role">CEO · LJ Radar Imob</small></span><i>⌄</i></button>
        <div class="locale"><b>Brasil</b><span>⌄</span><i></i><b>PT</b><span>⌄</span></div>
      </header>

      <section class="lji-v24-kpis">
        <button data-go="owners"><span class="ic house">⌂</span><span><small>Imóveis na base</small><strong data-kpi="owners">0</strong><em>histórico preservado</em></span></button>
        <button data-go="matches"><span class="ic hot">✦</span><span><small>Leads quentes</small><strong data-kpi="hot">0</strong><em>prioridades atuais</em></span></button>
        <button data-go="trades"><span class="ic trade">⇄</span><span><small>Permutas</small><strong data-kpi="trades">0</strong><em>matches de troca</em></span></button>
        <button data-go="whatsapp-leads"><span class="ic wa">◉</span><span><small>Com WhatsApp</small><strong data-kpi="wa">0</strong><em>contatos disponíveis</em></span></button>
        <blockquote>“Dados transformam<br>o mercado em oportunidades.”</blockquote>
      </section>

      <div class="lji-v24-mainrow">
        <article class="lji-v24-inbox cardx">
          <header><div class="title"><span>✉</span><span><h2>Caixa de Entrada de Leads</h2><p>Seus leads captados de todos os canais em um só lugar.</p></span></div><div class="fresh"><i></i><b data-live="inboxToday">0</b> novos leads hoje <button data-go="sales-inbox">Ver todos →</button></div></header>
          <div class="lji-v24-inbox-toolbar"><label><input id="ljiV24CheckAll" type="checkbox"><span></span></label><button data-go="pipeline" class="primary">» Mover para Qualificados</button><button data-go="sales-inbox">◉ A revisar</button><button data-go="discarded" class="danger">⌫ Descartar</button><button data-go="deep-search" class="excel">▣ Exportar Excel</button><button data-go="sales-inbox" class="filters">▽ Filtros</button></div>
          <div class="lji-v24-inbox-head"><span></span><span>Lead</span><span>Origem</span><span>Cidade / Região</span><span>Tipo</span><span>Contato</span><span>Status</span><span>Recebido</span><span></span></div>
          <div class="lji-v24-inbox-body"></div>
        </article>

        <aside class="lji-v24-rightstack">
          <article class="cardx mini"><header><div><span class="blueic">⌁</span><span><h3>Matchs Imobiliários</h3><p>Conectando compradores aos imóveis ideais.</p></span></div><button data-go="matches">Ver todos →</button></header><div class="lji-v24-matchlist"></div></article>
          <article class="cardx mini"><header><div><span class="blueic">⇄</span><span><h3>Permutas em destaque</h3><p>Oportunidades de permuta com alto potencial.</p></span></div><button data-go="trades">Ver todas →</button></header><div class="lji-v24-tradelist"></div></article>
          <article class="cardx mini qualified"><header><div><span class="blueic">▥</span><span><h3>Leads Qualificados</h3><p>Acompanhe seu funil de conversão.</p></span></div><button data-go="pipeline">Ver relatório →</button></header><div class="lji-v24-funnel">
            <span><b data-funnel="contact">—</b><small>Em contato</small></span><span><b data-funnel="review">—</b><small>A revisar</small></span><span><b data-funnel="qualified">—</b><small>Qualificados</small></span><span><b data-funnel="quinto">—</b><small>No Quinto Andar</small></span><span><b>—</b><small>Exportados</small></span>
          </div></article>
        </aside>
      </div>

      <div class="lji-v24-bottomrow">
        <article class="cardx radarcard"><header><div><span class="blueic">◎</span><span><h3>Radar de Intenção</h3><p>Identifique oportunidades antes que o mercado se mova.</p></span></div><button data-go="intentions">Ver mapa completo →</button></header><div class="lji-v24-radarviz"></div><button class="radar-open" data-go="intentions">Explorar no mapa →</button></article>
        <article class="cardx opportunities"><header><div><span class="trophy">✦</span><span><h3>3 Melhores Oportunidades</h3><p>Selecionadas por IA com maior potencial de negócio.</p></span></div><button data-go="owners">Ver todas →</button></header><div class="lji-v24-top3-grid"></div></article>
      </div>`;
    page.insertBefore(root,page.firstChild);
    qa('[data-go]',root).forEach(b=>b.addEventListener('click',()=>go(b.dataset.go)));
    q('.profile',root)?.addEventListener('click',()=>window.openSettingsPanel?.());
    q('.bell',root)?.addEventListener('click',(e)=>window.openAlertsPanel?.(e));
    q('#ljiV24Search',root)?.addEventListener('keydown',e=>{if(e.key==='Enter'){const old=q('#dashGlobalSearch'); if(old)old.value=e.target.value; window.dashboardGlobalSearch?.();}});
    q('#ljiV24CheckAll',root)?.addEventListener('change',e=>qa('.lji-v24-lead-check',root).forEach(c=>c.checked=e.target.checked));
    renderRadar(root); renderInbox(root); syncDashboard();
  }

  function syncDashboard(){
    const root=q('.lji-v24-dashboard'); if(!root) return;
    const name=text('#currentUserName','Júlio César'), role=text('#currentUserRole','CEO');
    const greeting=text('#dashGreetingText','Bom dia');
    const avatar=name.split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()||'JC';
    const set=(sel,v)=>{const el=q(sel,root); if(el)el.textContent=v;};
    set('#ljiV24Name',name); set('#ljiV24ProfileName',name); set('#ljiV24Role',`${role} · LJ Radar Imob`); set('#ljiV24Avatar',avatar); set('#ljiV24Greeting',greeting);
    set('[data-kpi="owners"]',text('#mOwners','0')); set('[data-kpi="hot"]',text('#mPriority',text('#mHot','0'))); set('[data-kpi="trades"]',text('#tMatches','0')); set('[data-kpi="wa"]',text('#whatsappNavCount','0'));
    set('[data-live="inboxToday"]',text('#mNew7','0'));
    set('#ljiV24BellCount',text('#alertsBellCount',''));
    set('[data-funnel="contact"]',text('#inboxThreads','—')); set('[data-funnel="review"]',text('#inboxPending','—')); set('[data-funnel="qualified"]',text('#pipelineNavCount','—')); set('[data-funnel="quinto"]',text('#paraQaNavCount','—'));
    renderInbox(root);
    previewRows(q('.lji-v24-matchlist',root),'#matchesTable','Aguardando matches imobiliários.');
    previewRows(q('.lji-v24-tradelist',root),'#tradeMatchesTable','Aguardando permutas qualificadas.',2);
    cloneTop3(root);
    syncSidebar();
  }

  function apply(){
    if(!isDesktop()) return;
    document.documentElement.classList.add('lji-v24');
    document.body?.classList.add('lji-v24-body');
    buildSidebar(); buildDashboard(); syncDashboard();
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',apply,{once:true}); else apply();
  window.addEventListener('load',apply,{once:true});
  window.addEventListener('resize',()=>{if(isDesktop())apply();});
  setInterval(()=>{if(isDesktop())syncDashboard();},4000);
  const obs=new MutationObserver(()=>{if(isDesktop()){buildSidebar();buildDashboard();}});
  obs.observe(document.documentElement,{childList:true,subtree:true});
})();
