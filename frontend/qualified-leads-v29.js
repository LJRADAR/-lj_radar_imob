'use strict';

/* LJ Radar Imob — Leads Qualificados v29.3
   Área separada, baseada apenas em lji_discovered_leads.status='qualified'. */
(function(){
  const PAGE='qualified-leads';
  const TABLE='lji_discovered_leads';
  const q=(s,r=document)=>r.querySelector(s);
  const qa=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let rows=[],selected=new Set(),query='',loading=false,lastError='';

  function db(){try{return window.LJI_getSupabaseClient?.()||null;}catch(_){return null;}}
  function workspace(){try{return window.LJI_CONFIG?.WORKSPACE_ID||localStorage.getItem('lji_workspace_id')||null;}catch(_){return null;}}
  function fmtMoney(v){const n=Number(v);return Number.isFinite(n)&&n>0?n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):'—';}
  function fmtDate(v){const d=v?new Date(v):null;return d&&!Number.isNaN(d.getTime())?d.toLocaleDateString('pt-BR'):'—';}

  function mountNav(){
    const nav=q('.sidebar .nav');if(!nav||q('[data-page="'+PAGE+'"]',nav))return;
    const btn=document.createElement('button');btn.className='nav-priority';btn.dataset.page=PAGE;
    btn.innerHTML='<svg class="nav-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/><path d="M4 4h16v16H4z"/></svg>Leads Qualificados <span id="qualifiedLeadsNavCount" class="nav-count nav-count-gold"></span>';
    const anchor=q('[data-page="capture-center"]',nav)||q('[data-page="action-center"]',nav);anchor?.insertAdjacentElement('afterend',btn);
    btn.addEventListener('click',openPage);
  }

  function mountPage(){
    const main=q('main');if(!main||q('#'+PAGE))return;
    const sec=document.createElement('section');sec.id=PAGE;sec.className='page hidden lji-capture-center';
    sec.innerHTML=`<div class="lji-cap-head"><div><span class="lji-cap-kicker">OPERAÇÃO</span><h1>Leads Qualificados</h1><p>Leads aprovados para tratamento comercial e envio ao corretor parceiro.</p></div><div class="lji-cap-head-actions"><button type="button" class="secondary" data-q-refresh>Atualizar</button><button type="button" class="primary" data-q-export>Exportar Excel</button></div></div><div class="lji-cap-layout"><aside class="lji-cap-folders"><button class="active"><span>✓</span><b>Qualificados</b><em data-q-count></em></button></aside><section class="lji-cap-mailbox"><div class="lji-cap-toolbar"><label class="lji-cap-selectall" title="Selecionar todos"><input type="checkbox" data-q-selectall><span></span></label><button type="button" title="Atualizar" data-q-refresh>↻</button><button type="button" data-q-move="review">Mover para revisão</button><button type="button" data-q-move="archived">Arquivar</button><button type="button" data-q-move="trash">Lixeira</button><div class="lji-cap-search"><span>⌕</span><input type="search" placeholder="Pesquisar qualificados" data-q-search></div><span class="lji-cap-selection" data-q-selection>0 selecionados</span></div><div class="lji-cap-list" data-q-list></div></section></div>`;
    main.appendChild(sec);bind(sec);render();
  }

  async function load(){
    const sb=db(),ws=workspace();if(!sb||!ws)return;
    loading=true;lastError='';render();
    try{
      const {data,error}=await sb.from(TABLE).select('*').eq('workspace_id',ws).eq('status','qualified').order('updated_at',{ascending:false}).limit(2000);
      if(error)throw error;rows=Array.isArray(data)?data:[];
    }catch(e){lastError=String(e?.message||e||'Falha ao carregar');console.error('Leads Qualificados:',e);}finally{loading=false;selected.clear();render();}
  }

  function filtered(){
    const term=query.trim().toLowerCase();if(!term)return rows;
    return rows.filter(r=>[r.title,r.city,r.neighborhood,r.contact_name,r.contact_phone,r.source,r.transaction_type,r.property_type].some(v=>String(v||'').toLowerCase().includes(term)));
  }

  function render(){
    const list=q('[data-q-list]');if(!list)return;
    const visible=filtered();
    const badge=q('#qualifiedLeadsNavCount');if(badge)badge.textContent=rows.length||'';
    const count=q('[data-q-count]');if(count)count.textContent=rows.length||'';
    const sel=q('[data-q-selection]');if(sel)sel.textContent=loading?'Sincronizando…':`${selected.size} selecionado${selected.size===1?'':'s'}`;
    const all=q('[data-q-selectall]');if(all){all.checked=visible.length>0&&visible.every(r=>selected.has(String(r.id)));all.indeterminate=selected.size>0&&!all.checked;}
    qa('[data-q-move]').forEach(b=>b.disabled=selected.size===0);
    if(loading&&!rows.length){list.innerHTML='<div class="lji-cap-empty"><span>↻</span><strong>Atualizando qualificados</strong><p>Sincronizando registros reais.</p></div>';return;}
    if(!visible.length){list.innerHTML=`<div class="lji-cap-empty"><span>✓</span><strong>Nenhum lead qualificado</strong><p>${lastError?'Não foi possível sincronizar agora.':'Qualifique registros na Central de Captação para que apareçam aqui.'}</p></div>`;return;}
    list.innerHTML=visible.map(r=>`<article class="lji-cap-row ${selected.has(String(r.id))?'selected':''}" data-q-row="${esc(r.id)}"><label class="lji-cap-check"><input type="checkbox" data-q-check="${esc(r.id)}" ${selected.has(String(r.id))?'checked':''}><span></span></label><button class="lji-cap-star" type="button" title="Qualificado">★</button><div class="lji-cap-main"><div class="lji-cap-title"><strong>${esc(r.title||'Lead sem título')}</strong><span>${esc([r.neighborhood,r.city,r.transaction_type==='rent'?'Aluguel':r.transaction_type==='sale'?'Venda':''].filter(Boolean).join(' · '))}</span></div><p>${esc([r.contact_name,r.contact_phone,r.source].filter(Boolean).join(' · ')||r.query_context||'Aguardando dados de contato.')}</p></div><div class="lji-cap-meta"><b>${esc(fmtMoney(r.price))}</b><time>${esc(fmtDate(r.published_at||r.discovered_at))}</time></div></article>`).join('');
  }

  async function move(to){
    const sb=db(),ws=workspace(),ids=[...selected];if(!sb||!ws||!ids.length)return;
    const {error}=await sb.from(TABLE).update({status:to,updated_at:new Date().toISOString()}).eq('workspace_id',ws).in('id',ids);
    if(error){lastError=String(error.message||error);render();return;}
    rows=rows.filter(r=>!selected.has(String(r.id)));selected.clear();render();
    window.LJI_CAPTURE_CENTER?.refresh?.();
  }

  function exportExcel(){
    if(!rows.length)return;
    if(!window.XLSX){lastError='Biblioteca de Excel indisponível';render();return;}
    const data=rows.map(r=>({
      'Lead':r.title||'',
      'Nome/Contato':r.contact_name||'',
      'Telefone':r.contact_phone||'',
      'WhatsApp':r.whatsapp_url||'',
      'Cidade':r.city||'',
      'Bairro':r.neighborhood||'',
      'Tipo de imóvel':r.property_type||'',
      'Operação':r.transaction_type==='rent'?'Aluguel':r.transaction_type==='sale'?'Venda':r.transaction_type||'',
      'Preço':r.price||'',
      'Fonte':r.source||'',
      'Publicado em':r.published_at||'',
      'Link original':r.source_url||'',
      'Proprietário direto':r.owner_direct?'Sim':'Não'
    }));
    const ws=XLSX.utils.json_to_sheet(data),wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'Leads Qualificados');
    XLSX.writeFile(wb,`LJ_Radar_Leads_Qualificados_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  function bind(root){
    root.addEventListener('click',e=>{if(e.target.closest('[data-q-refresh]'))void load();const m=e.target.closest('[data-q-move]');if(m)void move(m.dataset.qMove);if(e.target.closest('[data-q-export]'))exportExcel();});
    root.addEventListener('change',e=>{const c=e.target.closest('[data-q-check]');if(c){c.checked?selected.add(c.dataset.qCheck):selected.delete(c.dataset.qCheck);render();return;}if(e.target.matches('[data-q-selectall]')){filtered().forEach(r=>e.target.checked?selected.add(String(r.id)):selected.delete(String(r.id)));render();}});
    q('[data-q-search]',root)?.addEventListener('input',e=>{query=e.target.value;selected.clear();render();});
  }

  function openPage(){mountPage();qa('main > .page').forEach(p=>p.classList.toggle('hidden',p.id!==PAGE));qa('.sidebar .nav button[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===PAGE));document.body.classList.remove('mobile-menu-open');void load();}
  function installMobile(){const grid=q('#mobileMenuGrid');if(!grid||q('[data-mobile-page="'+PAGE+'"]',grid))return;const b=document.createElement('button');b.type='button';b.dataset.mobilePage=PAGE;b.innerHTML='<span>✓</span><b>Leads Qualificados</b><i>›</i>';b.addEventListener('click',openPage);grid.prepend(b);}
  function init(){mountNav();mountPage();installMobile();document.addEventListener('click',e=>{const b=e.target.closest('.sidebar .nav button[data-page]');if(b&&b.dataset.page!==PAGE)q('#'+PAGE)?.classList.add('hidden');});setTimeout(()=>void load(),1500);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,200));else setTimeout(init,200);
})();
