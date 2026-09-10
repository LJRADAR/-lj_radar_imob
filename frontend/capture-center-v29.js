'use strict';

/* LJ Radar Imob — Central de Captação v29.1
   Área operacional própria para entradas de captação.
   Nenhum dado fictício é criado. Registros só aparecem quando recebidos de fonte real. */
(function(){
  const PAGE='capture-center';
  const STORAGE='lji_capture_center_v29';
  const TABLE='lji_discovered_leads';
  const q=(s,r=document)=>r.querySelector(s);
  const qa=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const folders={inbox:'Entrada',review:'Em revisão',qualified:'Qualificados',archived:'Arquivados',trash:'Lixeira'};
  let state={folder:'inbox',query:'',selected:new Set(),rows:[],syncing:false,lastError:''};

  function readStored(){try{const raw=JSON.parse(localStorage.getItem(STORAGE)||'{}');if(Array.isArray(raw.rows))state.rows=raw.rows.filter(Boolean);if(raw.folder&&folders[raw.folder])state.folder=raw.folder;}catch(_){}}
  function save(){try{localStorage.setItem(STORAGE,JSON.stringify({rows:state.rows,folder:state.folder}));}catch(_){}}
  function db(){try{return window.LJI_getSupabaseClient?.()||null;}catch(_){return null;}}
  function workspace(){return window.LJI_CONFIG?.WORKSPACE_ID||localStorage.getItem('lji_workspace_id')||null;}
  function uid(row){return String(row.id||row.source_item_id||row.source_url||row.url||'');}
  function folderFromStatus(status){const s=String(status||'').toLowerCase();return folders[s]?s:(s==='discarded'||s==='deleted'?'trash':s==='active'?'inbox':'review');}
  function normalizeRow(row){
    const id=uid(row);if(!id)return null;
    return {...row,id,folder:folders[row.folder]?row.folder:folderFromStatus(row.status),captured_at:row.captured_at||row.discovered_at||row.created_at||new Date().toISOString(),updated_at:row.updated_at||new Date().toISOString(),deleted_at:row.deleted_at||null,deleted_by:row.deleted_by||null,archived_at:row.archived_at||null,history:Array.isArray(row.history)?row.history:[]};
  }
  function actorName(){return window.LJI_CURRENT_USER?.name||window.LJI_CURRENT_USER?.email||'Usuário';}
  function log(row,action,from,to){row.history=Array.isArray(row.history)?row.history:[];row.history.unshift({action,from,to,at:new Date().toISOString(),by:actorName()});row.updated_at=new Date().toISOString();}

  async function syncFromDb(){
    const client=db(),ws=workspace();if(!client||!ws)return false;
    state.syncing=true;state.lastError='';renderToolbar();
    try{
      const {data,error}=await client.from(TABLE).select('*').eq('workspace_id',ws).order('discovered_at',{ascending:false}).limit(1000);
      if(error)throw error;
      state.rows=(Array.isArray(data)?data:[]).map(normalizeRow).filter(Boolean);
      save();render();return true;
    }catch(e){state.lastError=String(e?.message||e||'Falha ao sincronizar');console.error('Central de Captação:',e);render();return false;}
    finally{state.syncing=false;renderToolbar();}
  }

  async function persistStatus(rows,to){
    const client=db(),ws=workspace();if(!client||!ws||!rows.length)return false;
    const ids=rows.map(r=>r.id).filter(Boolean);if(!ids.length)return false;
    const {error}=await client.from(TABLE).update({status:to,updated_at:new Date().toISOString()}).eq('workspace_id',ws).in('id',ids);
    if(error)throw error;
    return true;
  }

  function mountNav(){
    const nav=q('.sidebar .nav');if(!nav||q('[data-page="'+PAGE+'"]',nav))return;
    const btn=document.createElement('button');btn.className='nav-priority lji-capture-nav';btn.dataset.page=PAGE;
    btn.innerHTML='<svg class="nav-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="M4 9h16"/><path d="M9 4v5"/></svg>Central de Captação <span id="captureCenterNavCount" class="nav-count"></span>';
    const anchor=q('[data-page="action-center"]',nav)||q('[data-page="dashboard"]',nav);anchor?.insertAdjacentElement('afterend',btn);btn.addEventListener('click',openPage);
  }

  function mountPage(){
    const main=q('main');if(!main||q('#'+PAGE))return;
    const sec=document.createElement('section');sec.id=PAGE;sec.className='page hidden lji-capture-center';
    sec.innerHTML=`<div class="lji-cap-head"><div><span class="lji-cap-kicker">OPERAÇÃO</span><h1>Central de Captação</h1><p>Entradas reais ficam aqui para revisão antes de seguirem para a base principal.</p></div><div class="lji-cap-head-actions"><button type="button" class="secondary" data-cap-refresh>Atualizar</button></div></div><div class="lji-cap-layout"><aside class="lji-cap-folders" aria-label="Pastas da Central de Captação"></aside><section class="lji-cap-mailbox"><div class="lji-cap-toolbar"><label class="lji-cap-selectall" title="Selecionar todos"><input type="checkbox" data-cap-selectall><span></span></label><button type="button" title="Atualizar" data-cap-refresh>↻</button><button type="button" title="Mover" data-cap-action="move">Mover</button><button type="button" title="Arquivar" data-cap-action="archive">Arquivar</button><button type="button" title="Enviar para lixeira" data-cap-action="trash">Lixeira</button><button type="button" title="Restaurar" data-cap-action="restore">Restaurar</button><div class="lji-cap-search"><span>⌕</span><input type="search" placeholder="Pesquisar na captação" data-cap-search></div><span class="lji-cap-selection" data-cap-selection>0 selecionados</span></div><div class="lji-cap-move-menu" data-cap-move-menu hidden><button data-cap-move="inbox">Entrada</button><button data-cap-move="review">Em revisão</button><button data-cap-move="qualified">Qualificados</button><button data-cap-move="archived">Arquivados</button></div><div class="lji-cap-list" data-cap-list></div></section></div>`;
    main.appendChild(sec);bind(sec);render();
  }

  function openPage(){mountPage();qa('main > .page').forEach(p=>p.classList.toggle('hidden',p.id!==PAGE));qa('.sidebar .nav button[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===PAGE));document.body.classList.remove('mobile-menu-open');render();void syncFromDb();}
  function visibleRows(){const term=state.query.trim().toLowerCase();return state.rows.filter(r=>r.folder===state.folder).filter(r=>!term||[r.title,r.description,r.city,r.neighborhood,r.seller_nickname,r.contact_name,r.contact_phone,r.source_name,r.source].some(v=>String(v||'').toLowerCase().includes(term))).sort((a,b)=>(new Date(b.captured_at).getTime()||0)-(new Date(a.captured_at).getTime()||0));}
  function folderCounts(){return Object.keys(folders).reduce((acc,key)=>{acc[key]=state.rows.filter(r=>r.folder===key).length;return acc;},{});}
  function renderFolders(){const root=q('.lji-cap-folders');if(!root)return;const counts=folderCounts();root.innerHTML=Object.entries(folders).map(([key,label])=>`<button type="button" data-cap-folder="${key}" class="${state.folder===key?'active':''}"><span>${key==='inbox'?'✉':key==='review'?'◷':key==='qualified'?'✓':key==='archived'?'▣':'⌫'}</span><b>${label}</b><em>${counts[key]||''}</em></button>`).join('');}
  function rowSubtitle(r){const loc=[r.neighborhood,r.city].filter(Boolean).join(' · ');const tx=r.transaction_type==='rent'?'Aluguel':r.transaction_type==='sale'?'Venda':(r.transaction_type||'');return [loc,tx].filter(Boolean).join(' · ')||'Aguardando classificação';}
  function renderList(){
    const root=q('[data-cap-list]');if(!root)return;const rows=visibleRows();
    if(state.syncing&&!rows.length){root.innerHTML='<div class="lji-cap-empty"><span>↻</span><strong>Atualizando captação</strong><p>Sincronizando registros reais da base.</p></div>';return;}
    if(!rows.length){root.innerHTML='<div class="lji-cap-empty"><span>✉</span><strong>Nenhum item nesta pasta</strong><p>'+(state.lastError?'Não foi possível sincronizar agora.':'Aguardando coleta real ou movimentação de registros.')+'</p></div>';return;}
    root.innerHTML=rows.map(r=>{const selected=state.selected.has(r.id);const contact=r.attributes?.whatsapp||r.attributes?.phone||r.whatsapp_url||r.contact_phone||'';return `<article class="lji-cap-row ${selected?'selected':''}" data-cap-row="${esc(r.id)}"><label class="lji-cap-check"><input type="checkbox" data-cap-check="${esc(r.id)}" ${selected?'checked':''}><span></span></label><button class="lji-cap-star" type="button" title="Marcar">☆</button><div class="lji-cap-main"><div class="lji-cap-title"><strong>${esc(r.title||r.description?.slice(0,90)||'Entrada sem título')}</strong><span>${esc(rowSubtitle(r))}</span></div><p>${esc(r.description||r.query_context||'Sem descrição disponível.')}</p></div><div class="lji-cap-meta">${contact?'<b>Contato</b>':''}<time>${new Date(r.captured_at).toLocaleDateString('pt-BR')}</time></div></article>`;}).join('');
  }
  function renderToolbar(){const count=state.selected.size;const text=q('[data-cap-selection]');if(text)text.textContent=state.syncing?'Sincronizando…':count+' selecionado'+(count===1?'':'s');const all=q('[data-cap-selectall]'),rows=visibleRows();if(all){all.checked=rows.length>0&&rows.every(r=>state.selected.has(r.id));all.indeterminate=count>0&&!all.checked;}qa('[data-cap-action]').forEach(b=>{const a=b.dataset.capAction;b.disabled=count===0||(state.folder==='trash'&&['archive','trash'].includes(a))||(state.folder!=='trash'&&a==='restore');});const navCount=q('#captureCenterNavCount'),inbox=state.rows.filter(r=>r.folder==='inbox').length;if(navCount)navCount.textContent=inbox||'';}
  function render(){renderFolders();renderList();renderToolbar();}
  function selectedRows(){return state.rows.filter(r=>state.selected.has(r.id));}

  async function moveSelected(to,action='moved'){
    if(!folders[to]||!state.selected.size)return;
    const rows=selectedRows(),snapshot=rows.map(r=>({r,folder:r.folder,deleted_at:r.deleted_at,deleted_by:r.deleted_by,archived_at:r.archived_at,status:r.status}));
    rows.forEach(r=>{const from=r.folder;r.folder=to;r.status=to;if(to==='trash'){r.deleted_at=new Date().toISOString();r.deleted_by=actorName();}else if(from==='trash'){r.deleted_at=null;r.deleted_by=null;}if(to==='archived')r.archived_at=new Date().toISOString();else if(from==='archived')r.archived_at=null;log(r,action,from,to);});
    state.selected.clear();save();render();
    try{await persistStatus(rows,to);window.dispatchEvent(new CustomEvent('lji:capture-updated',{detail:{action,to,ids:rows.map(r=>r.id)}}));}
    catch(e){snapshot.forEach(s=>Object.assign(s.r,{folder:s.folder,deleted_at:s.deleted_at,deleted_by:s.deleted_by,archived_at:s.archived_at,status:s.status}));state.lastError=String(e?.message||e);save();render();console.error('Central de Captação: movimentação não persistida',e);}
  }

  function bind(root){
    root.addEventListener('click',e=>{const folder=e.target.closest('[data-cap-folder]');if(folder){state.folder=folder.dataset.capFolder;state.selected.clear();save();render();return;}if(e.target.closest('[data-cap-refresh]')){void syncFromDb();window.dispatchEvent(new CustomEvent('lji:capture-refresh-requested'));return;}const move=e.target.closest('[data-cap-action="move"]');if(move){const menu=q('[data-cap-move-menu]');if(menu)menu.hidden=!menu.hidden;return;}const dest=e.target.closest('[data-cap-move]');if(dest){void moveSelected(dest.dataset.capMove);const menu=q('[data-cap-move-menu]');if(menu)menu.hidden=true;return;}const action=e.target.closest('[data-cap-action]')?.dataset.capAction;if(action==='archive')void moveSelected('archived','archived');if(action==='trash')void moveSelected('trash','trashed');if(action==='restore')void moveSelected('inbox','restored');});
    root.addEventListener('change',e=>{const check=e.target.closest('[data-cap-check]');if(check){check.checked?state.selected.add(check.dataset.capCheck):state.selected.delete(check.dataset.capCheck);renderToolbar();check.closest('.lji-cap-row')?.classList.toggle('selected',check.checked);return;}if(e.target.matches('[data-cap-selectall]')){visibleRows().forEach(r=>e.target.checked?state.selected.add(r.id):state.selected.delete(r.id));render();}});
    q('[data-cap-search]',root)?.addEventListener('input',e=>{state.query=e.target.value;state.selected.clear();render();});
  }

  function ingest(rows,{replace=false}={}){const incoming=(Array.isArray(rows)?rows:[]).map(normalizeRow).filter(Boolean);if(replace)state.rows=incoming;else{const map=new Map(state.rows.map(r=>[r.id,r]));incoming.forEach(r=>{const old=map.get(r.id);map.set(r.id,old?{...old,...r,folder:old.folder,history:old.history,deleted_at:old.deleted_at,deleted_by:old.deleted_by,archived_at:old.archived_at}:r);});state.rows=[...map.values()];}save();render();}
  function installMobileEntry(){const grid=q('#mobileMenuGrid');if(!grid||q('[data-mobile-page="'+PAGE+'"]',grid))return;const b=document.createElement('button');b.type='button';b.dataset.mobilePage=PAGE;b.innerHTML='<span>✉</span><b>Central de Captação</b><i>›</i>';b.addEventListener('click',openPage);grid.prepend(b);}
  function init(){readStored();mountNav();mountPage();installMobileEntry();document.addEventListener('click',e=>{const b=e.target.closest('.sidebar .nav button[data-page]');if(b&&b.dataset.page!==PAGE)q('#'+PAGE)?.classList.add('hidden');});window.LJI_CAPTURE_CENTER={open:openPage,ingest,refresh:syncFromDb,getState:()=>({folder:state.folder,rows:[...state.rows]})};window.addEventListener('lji:capture-data',e=>ingest(e.detail?.rows||e.detail||[],{replace:!!e.detail?.replace}));setTimeout(()=>void syncFromDb(),1200);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,150));else setTimeout(init,150);
})();
