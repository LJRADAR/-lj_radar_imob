'use strict';

window.addEventListener('load',()=>{if(!window.LJI_CONFIG?.SUPABASE_URL){console.error('LJ Radar: lji-config.js ausente ou inválido');}});

window.LJI_COVERAGE_RULES = {
  commercial_regions: {
    grande_abc: ["Santo André","São Bernardo do Campo","São Caetano do Sul","Diadema"],
    sao_paulo: ["São Paulo — Centro","São Paulo — Zona Sul","São Paulo — Zona Leste","São Paulo — Zona Oeste","São Paulo — Zona Norte"]
  },
  quintoandar_acquisition: {
    mode: "all_eligible_cities",
    note: "Captação inicial de proprietários fora do QuintoAndar não deve ser limitada às regiões comerciais de Permutas/Leads."
  }
};

window.LJI_getSupabaseClient=function(){
  if(window.LJI_SUPABASE_CLIENT)return window.LJI_SUPABASE_CLIENT;
  const cfg=window.LJI_CONFIG||{};
  if(!window.supabase||!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY)return null;
  window.LJI_SUPABASE_CLIENT=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
  return window.LJI_SUPABASE_CLIENT;
};

function esc(v){ return String(v ?? '').replace(/[&<>'"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c])); }
let owners=[];
let buyers=[];
let matchAlerts=[];
let commercialRules={min_sale_price:200000,min_rent_price:1000,sale_commission_pct:1.25,extra_fee_pct:1.5};
window.commercialRules=commercialRules;
function fillCommercialRuleInputs(){
  const m={setMinSale:'min_sale_price',setMinRent:'min_rent_price',setSaleCommission:'sale_commission_pct',setExtraFee:'extra_fee_pct'};
  Object.entries(m).forEach(([id,key])=>{const el=document.getElementById(id);if(el)el.value=commercialRules[key]});
}



window.LJI_ADMIN_STATE = window.LJI_ADMIN_STATE || {members:[],collectorRuns:[],activities:[],pipelineEvents:[],security:[]};
let ownerTeamMembers=[];

function roleLabel(role){
  return ({super_admin:'CEO',gestor:'Gestora',corretor:'Corretora',viewer:'Consulta'}[role]||role||'Usuário');
}
function ownerHandlerControl(o){
  const currentRole=window.LJI_CURRENT_USER?.role||'';
  const canEdit=(currentRole==='super_admin'||currentRole==='gestor') && o.is_current && o.opportunity_id;
  const current=o.handled_by_user_id||'';
  if(!canEdit){
    return `<span class="handler-readonly">${esc(o.handled_by_name||(o.is_current?'Não tratado':'Histórico'))}</span>`;
  }
  const options=['<option value="">Não tratado</option>'].concat(
    ownerTeamMembers.filter(x=>x.is_active!==false).map(u=>`<option value="${esc(u.user_id)}" ${String(current)===String(u.user_id)?'selected':''}>${esc(u.name)} · ${esc(roleLabel(u.role))}</option>`)
  ).join('');
  return `<select class="handler-select" onchange="setOwnerHandler('${esc(o.opportunity_id)}',this.value)" title="Quem tratou este lead">${options}</select>
    ${o.handled_at?`<div class="handler-date">${new Date(o.handled_at).toLocaleDateString('pt-BR')}</div>`:''}`;
}
async function setOwnerHandler(ownerId,userId){
  const client=window.LJI_BACKEND?.client;
  if(!client){toast('Supabase indisponível.');return}
  const member=ownerTeamMembers.find(x=>String(x.user_id)===String(userId));
  const payload={
    handled_by_user_id:userId||null,
    handled_by_name:member?.name||null,
    handled_at:userId?new Date().toISOString():null
  };
  const {error}=await client.from('lji_opportunity_index').update(payload).eq('id',ownerId);
  if(error){console.error(error);toast('Não foi possível registrar quem tratou o lead.');return}
  try{
    const cfg=window.LJI_CONFIG||{};
    await client.from('lji_activity_log').insert({
      workspace_id:cfg.WORKSPACE_ID,
      event_type:'lead_handler_changed',
      entity_type:'opportunity',
      entity_id:String(ownerId),
      details:{handled_by_user_id:userId||null,handled_by_name:member?.name||null}
    });
  }catch(_){}
  toast(userId?`Lead atribuído a ${member?.name||'usuário'}.`:'Tratamento removido.');
  await window.LJI_BACKEND?.sync?.();
  await window.LJI_BACKEND?.syncAdmin?.();
}

function renderAdminUsers(){
  const state=window.LJI_ADMIN_STATE||{},rows=state.members||[],box=document.getElementById('adminUsersBody'),count=document.getElementById('adminUsersCount');
  if(count)count.textContent=`${rows.length} usuário${rows.length===1?'':'s'}`;if(!box)return;
  if(!rows.length){box.innerHTML='<div class="empty">Nenhum usuário encontrado.</div>';return}
  box.innerHTML=`<div class="user-permission-list">${rows.map(u=>{const modules=modulesFromPermissions(u.role,u.permissions),canEdit=window.LJI_CURRENT_USER?.role==='super_admin'&&u.role!=='super_admin';return `<button class="user-permission-card" type="button" ${canEdit?`onclick="openPermissionEditor('${esc(u.user_id)}')"`:''}><div class="user-permission-avatar">${esc((u.name||'U').split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase())}</div><div class="user-permission-main"><strong>${esc(u.name||'Usuário')}</strong><span>${esc(roleLabel(u.role))} · ${u.is_active?'Ativo':'Inativo'}</span><small>${u.role==='super_admin'?'Acesso total':modules.length+' tela(s) liberada(s)'}</small></div><div class="user-permission-action">${canEdit?'Editar telas ›':'Protegido'}</div></button>`}).join('')}</div>`;
}
async function updateMemberRole(userId,role){
  if(window.LJI_CURRENT_USER?.role!=='super_admin'){toast('Somente o CEO altera permissões.');return}
  const client=window.LJI_BACKEND?.client,cfg=window.LJI_CONFIG||{};
  const {error}=await client.from('lji_workspace_members').update({role}).eq('workspace_id',cfg.WORKSPACE_ID).eq('user_id',userId);
  if(error){console.error(error);toast('Falha ao alterar o perfil.');return}
  toast('Permissão atualizada.');
  await window.LJI_BACKEND?.syncAdmin?.();
}
async function toggleMemberActive(userId,isActive){
  if(window.LJI_CURRENT_USER?.role!=='super_admin'){toast('Somente o CEO altera usuários.');return}
  const client=window.LJI_BACKEND?.client,cfg=window.LJI_CONFIG||{};
  const {error}=await client.from('lji_workspace_members').update({is_active:isActive}).eq('workspace_id',cfg.WORKSPACE_ID).eq('user_id',userId);
  if(error){console.error(error);toast('Falha ao atualizar usuário.');return}
  toast(isActive?'Usuário ativado.':'Usuário desativado.');
  await window.LJI_BACKEND?.syncAdmin?.();
}
function renderHistory(){
  const state=window.LJI_ADMIN_STATE||{}, runs=state.collectorRuns||[], acts=state.activities||[], sec=state.security||[];
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v};
  set('histRunsCount',runs.length);
  set('histNewCount',runs.reduce((s,r)=>s+Number(r.total_new_results||0),0));
  set('histErrorCount',runs.reduce((s,r)=>s+Number(r.total_errors||0),0));
  set('histActivityCount',acts.length);

  const rbox=document.getElementById('collectorHistoryBody');
  if(rbox){
    if(!runs.length){rbox.innerHTML='<div class="empty">Nenhuma coleta registrada.</div>';}
    else{
      const tableRows=runs.map(r=>`<tr>
        <td>${new Date(r.created_at).toLocaleString('pt-BR')}</td>
        <td>${esc(r.city||'—')}</td><td>${esc(r.transaction_type==='rent'?'Locação':r.transaction_type==='sale'?'Venda':r.run_mode||'—')}</td>
        <td><span class="badge ${r.status==='completed'?'good':r.status==='failed'?'hot':'mid'}">${esc(r.status||'—')}</span></td>
        <td>${Number(r.total_raw_results||0)}</td><td>${Number(r.total_new_results||0)}</td><td>${Number(r.total_errors||0)}</td>
      </tr>`).join('');
      const cards=runs.map(r=>{
        const stCls=r.status==='completed'?'good':r.status==='failed'?'hot':'mid';
        const tipo=r.transaction_type==='rent'?'Locação':r.transaction_type==='sale'?'Venda':(r.run_mode||'—');
        return `<article class="m-card">
          <div class="m-card-top"><strong>${esc(r.city||'Coleta')}</strong><span class="badge ${stCls}">${esc(r.status||'—')}</span></div>
          <div class="m-card-meta">${esc(tipo)} · ${new Date(r.created_at).toLocaleString('pt-BR')}</div>
          <div class="m-card-specs">
            <span class="m-stat"><b>${Number(r.total_raw_results||0)}</b> resultados</span>
            <span class="m-stat"><b>${Number(r.total_new_results||0)}</b> novos</span>
            <span class="m-stat"><b>${Number(r.total_errors||0)}</b> erros</span>
          </div>
        </article>`;
      }).join('');
      rbox.innerHTML=`<div class="desktop-table-wrap"><table><thead><tr><th>Data</th><th>Cidade</th><th>Tipo</th><th>Status</th><th>Resultados</th><th>Novos</th><th>Erros</th></tr></thead><tbody>${tableRows}</tbody></table></div><div class="mobile-card-list">${cards}</div>`;
    }
  }

  const abox=document.getElementById('activityHistoryBody');
  if(abox)abox.innerHTML=acts.length?`<div class="mobile-card-list history-card-list">${acts.map(a=>`<article class="m-card history-event-card"><div class="m-card-top"><strong>${esc(a.event_type||'Atividade')}</strong><time class="small">${new Date(a.created_at).toLocaleString('pt-BR')}</time></div><div class="m-card-meta">${esc(a.entity_type||'')} ${a.entity_id?('· '+esc(a.entity_id)):''}</div></article>`).join('')}</div>`:'<div class="empty">Nenhuma atividade registrada.</div>';

  const sbox=document.getElementById('securityHistoryBody');
  if(sbox)sbox.innerHTML=sec.length?`<div class="mobile-card-list history-card-list">${sec.map(a=>`<article class="m-card history-event-card"><div class="m-card-top"><strong>${esc(a.event_type||'Evento')}</strong><time class="small">${new Date(a.created_at).toLocaleString('pt-BR')}</time></div><div class="m-card-meta">${esc(a.description||'')}</div></article>`).join('')}</div>`:'<div class="empty">Nenhum evento de segurança disponível.</div>';
}


let discardedCandidates=[];
function discardedStatusLabel(s){
  const v=String(s||'').toLowerCase();
  if(v==='rejected') return 'Descartado';
  if(v==='found_on_quintoandar') return 'Encontrado no QuintoAndar';
  if(v==='inconclusive') return 'Inconclusivo';
  if(v==='no_public_match_found') return 'Sem correspondência pública';
  return s||'Não aprovado';
}
function filteredDiscarded(){
  const search=(document.getElementById('discardedSearch')?.value||'').toLowerCase().trim();const category=document.getElementById('discardedCategory')?.value||'';
  const all=Array.isArray(discardedCandidates)?discardedCandidates:[];return all.filter(r=>(!category||r.category===category) && (!search||[r.title,r.city,r.source_name,r.reason,r.status].join(' ').toLowerCase().includes(search)));
}
function discardedExportRows(){return filteredDiscarded().map(r=>({'Imóvel':r.title||'Sem título','Cidade':r.city||'','Classificação':r.category||'','Status':discardedStatusLabel(r.status),'Fonte':r.source_name||'Fonte pública','Data':r.published_at?new Date(r.published_at).toLocaleDateString('pt-BR'):'Data não informada','Motivo':r.reason||'','Link original':r.source_url||''}))}
function exportDiscardedExcel(){const rows=discardedExportRows();if(!rows.length){toast('Nenhum registro no filtro atual.');return}saveWorkbook(rows,`LJ-Radar-Imob-Descartados-${new Date().toISOString().slice(0,10)}.xlsx`)}
function exportDiscardedPdf(){exportRowsPdf(discardedExportRows(),'LJ Radar Imob — Descartados / não aprovados',`LJ-Radar-Imob-Descartados-${new Date().toISOString().slice(0,10)}.pdf`)}
function renderDiscarded(){
  const all=Array.isArray(discardedCandidates)?discardedCandidates:[];
  const rows=filteredDiscarded();
  const count=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v};
  count('dTotal',all.length);
  count('dRejected',all.filter(r=>r.category==='Descartado na coleta').length);
  count('dNotApproved',all.filter(r=>r.category==='Não aprovado após verificação').length);
  count('dWithLink',all.filter(r=>r.source_url).length);
  const nav=document.getElementById('discardedNavCount'); if(nav)nav.textContent=all.length?String(all.length):'';
  const box=document.getElementById('discardedTable'); if(!box)return;
  if(!rows.length){box.innerHTML='<div class="empty">Nenhum registro real com estes filtros.</div>';return}
  const tableRows=rows.map(r=>`<tr>
    <td><strong>${esc(r.title||'Sem título')}</strong></td>
    <td>${esc(r.city||'—')}</td>
    <td><span class="discarded-category ${r.category==='Descartado na coleta'?'cat-rejected':'cat-review'}">${esc(r.category||'')}</span></td>
    <td>${esc(discardedStatusLabel(r.status))}</td>
    <td>${esc(r.source_name||'Fonte pública')}</td>
    <td>${r.published_at?new Date(r.published_at).toLocaleDateString('pt-BR'):'Data não informada'}</td>
    <td class="discarded-reason">${esc(r.reason||'—')}</td>
    <td>${safeHttpUrl(r.source_url)?`<a class="source-action" href="${esc(safeHttpUrl(r.source_url))}" target="_blank" rel="noopener noreferrer">Abrir anúncio ↗</a>`:'<span class="small">Link não informado</span>'}</td>
  </tr>`).join('');
  const cards=rows.map(r=>{
    const url=safeHttpUrl(r.source_url);
    const catCls=r.category==='Descartado na coleta'?'cat-rejected':'cat-review';
    return `<article class="m-card m-card-muted">
      <div class="m-card-top"><strong>${esc(r.title||'Sem título')}</strong><span class="discarded-category ${catCls}">${esc(r.category||'')}</span></div>
      <div class="m-card-meta">${esc(r.city||'—')} · ${esc(r.source_name||'Fonte pública')}</div>
      <div class="m-card-row"><span class="badge mid">${esc(discardedStatusLabel(r.status))}</span> <span class="small">${r.published_at?new Date(r.published_at).toLocaleDateString('pt-BR'):'Data não informada'}</span></div>
      <div class="m-card-row discarded-reason">${esc(r.reason||'—')}</div>
      <div class="m-card-actions">${url?`<a class="source-action" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Abrir anúncio ↗</a>`:'<span class="small">Link não informado</span>'}</div>
    </article>`;
  }).join('');
  box.innerHTML=`<div class="sel-bar" id="selBarWa" hidden><strong id="selCountWa">0 leads selecionados</strong><div class="sel-bar-actions"><button class="secondary" onclick="ljiClearSelection('Wa')">Limpar seleção</button><button class="lead-discard lead-discard-bulk" onclick="discardSelectedLeads('Wa')">Descartar selecionados</button></div></div><div class="desktop-table-wrap"><table class="discarded-table"><thead><tr><th>Imóvel / anúncio</th><th>Cidade</th><th>Classificação</th><th>Status</th><th>Fonte</th><th>Data</th><th>Motivo</th><th>Link original</th></tr></thead><tbody>${tableRows}</tbody></table></div><div class="mobile-card-list">${cards}</div>`;
}


let operationMetrics=[];
function opDayLabel(day){
  const d=new Date(String(day)+'T12:00:00');
  return Number.isNaN(d.getTime())?String(day):d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
}
function opSum(key){return operationMetrics.reduce((s,r)=>s+Number(r[key]||0),0)}
function operationBarChart(rows,series){
  if(!rows.length)return '<div class="empty">Sem dados para o período.</div>';
  const max=Math.max(1,...rows.flatMap(r=>series.map(s=>Number(r[s.key]||0))));
  const legend=`<div class="ops-legend">${series.map(s=>`<span><i class="${s.cls}"></i>${esc(s.label)}</span>`).join('')}</div>`;
  const cols=rows.map(r=>`<div class="ops-day">
    <div class="ops-bars">${series.map(s=>{const v=Number(r[s.key]||0);const h=v?Math.max(5,Math.round(v/max*100)):0;return `<div class="ops-bar ${s.cls}" style="height:${h}%" title="${esc(s.label)}: ${v}"><b>${v||''}</b></div>`}).join('')}</div>
    <span>${opDayLabel(r.day)}</span>
  </div>`).join('');
  return `${legend}<div class="ops-chart-body" style="--ops-days:${Math.max(1,rows.length)}">${cols}</div>`;
}
function renderOperationMetrics(){
  const rows=operationMetrics||[];
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v};
  const whatsappHistory=collectWhatsAppLeads().filter(x=>x.contactState==='whatsapp').length;
  set('gWhatsAppHistory',whatsappHistory);
  set('gNewResults',opSum('new_results'));set('gIntentions',opSum('intentions'));set('gOpportunities',opSum('opportunities'));set('gRuns',opSum('collector_runs'));set('gErrors',opSum('errors'));
  const dash=document.getElementById('dashboardOpsChart');
  if(dash){dash.classList.remove('ops-chart-empty');dash.classList.add('ops-chart-compact');dash.innerHTML=operationBarChart(rows,[{key:'intentions',label:'Intenções',cls:'series-intentions'},{key:'new_results',label:'Novos resultados',cls:'series-results'},{key:'opportunities',label:'Oportunidades',cls:'series-opportunities'}]);}
  const capture=document.getElementById('captureOpsChart');
  if(capture)capture.innerHTML=operationBarChart(rows,[{key:'intentions',label:'Intenções captadas',cls:'series-intentions'},{key:'new_results',label:'Novos resultados',cls:'series-results'}]);
  const pipeline=document.getElementById('pipelineOpsChart');
  if(pipeline)pipeline.innerHTML=operationBarChart(rows,[{key:'opportunities',label:'Oportunidades sincronizadas',cls:'series-opportunities'},{key:'collector_runs',label:'Coletas',cls:'series-runs'}]);
  const table=document.getElementById('opsDailyTable');
  if(table)table.innerHTML=rows.length?`<table class="ops-daily-table"><thead><tr><th>Data</th><th>Novos resultados</th><th>Intenções</th><th>Oportunidades</th><th>Coletas</th><th>Erros</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${opDayLabel(r.day)}</strong></td><td>${Number(r.new_results||0)}</td><td>${Number(r.intentions||0)}</td><td>${Number(r.opportunities||0)}</td><td>${Number(r.collector_runs||0)}</td><td>${Number(r.errors||0)}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">Sem dados para o período.</div>';
}
function ensureChartLinks(){
  document.querySelectorAll('.page:not(#dashboard):not(#charts) .top').forEach(top=>{
    if(top.querySelector('.charts-shortcut'))return;
    const b=document.createElement('button');b.className='secondary charts-shortcut';b.textContent='Gráficos ↗';b.onclick=()=>go('charts');
    // Vai para dentro de .top-actions, junto dos demais botões. Anexado direto
    // no .top ele virava irmão do título e quebrava o alinhamento da barra.
    const actions=top.querySelector('.top-actions');
    if(actions)actions.appendChild(b);else top.appendChild(b);
  });
}


let discoveredLeads=[];
let sourceProfiles=[];
let excelImportRows=[];
let registrySearches=[];
const MODULE_DEFS=[
  ['para-quinto-andar','Leads 5ºAndar'],['dashboard','Dashboard'],['action-center','Central de Ação'],['pipeline','Pipeline Comercial'],['sales-inbox','Inbox Comercial'],['whatsapp-leads','Leads com WhatsApp'],['intentions','Radar de Intenção'],['matches','Match Engine'],['trades','Permutas'],['buyers','Demandas de compradores'],['owners','Proprietários'],['registry','Pesquisa Registral'],['contact-check','Verificação de Contato'],['discarded','Descartados / não aprovados'],['deep-search','Captação de proprietários'],['companies','Empresas'],['history','Histórico'],['reports','Relatórios'],['charts','Gráficos da operação'],['settings','Configurações']
];
function defaultModulesForRole(role){
  const map={
    super_admin:MODULE_DEFS.map(x=>x[0]).concat(['imports','users-admin']),
    gestor:['para-quinto-andar','dashboard','action-center','pipeline','charts','deep-search','owners','registry','whatsapp-leads','contact-check','discarded','buyers','intentions','matches','trades','companies','history','reports','settings'],
    corretor:['para-quinto-andar','dashboard','action-center','pipeline','charts','deep-search','owners','registry','whatsapp-leads','contact-check','discarded','buyers','intentions','matches','trades'],
    viewer:['dashboard','action-center','pipeline','sales-inbox','charts']
  };
  return map[role]||map.viewer;
}
function modulesFromPermissions(role,p){
  if(role==='super_admin')return defaultModulesForRole(role);
  if(p&&Array.isArray(p.modules)&&p.modules.length){
    const modules=[...p.modules];
    // v22.38: Central de Ação e Pipeline são extensões operacionais do Dashboard.
    // Usuários já existentes com permissão customizada para Dashboard recebem as novas telas
    // sem exigir alteração manual no registro de permissões.
    if(modules.includes('dashboard')&&!modules.includes('action-center'))modules.push('action-center');
    if(modules.includes('dashboard')&&!modules.includes('pipeline'))modules.push('pipeline');
    return modules;
  }
  return defaultModulesForRole(role);
}
function safeHttpUrl(value){
  try{const url=new URL(String(value||'').trim());return (url.protocol==='http:'||url.protocol==='https:')?url.href:''}catch(_){return''}
}
function safeImageUrl(value){ return safeHttpUrl(value); }
function safeTel(value){
  const d=phoneDigits(value);
  return d?`tel:+55${d}`:'';
}
function sourceClass(source){const s=String(source||'').toLowerCase();if(s.includes('olx'))return'olx';if(s.includes('facebook'))return'facebook';if(s.includes('propriet'))return'direct';if(s.includes('imovelweb'))return'imovelweb';return'other'}
function sourceBadge(source,url){const safe=safeHttpUrl(url);return `<a class="source-badge source-${sourceClass(source)}" ${safe?`href="${esc(safe)}" target="_blank" rel="noopener noreferrer"`:''}>${esc(source||'Fonte')}</a>`}
function phoneDigits(v){
  let d=String(v||'').replace(/\D/g,'');
  if((d.length===12||d.length===13)&&d.startsWith('55'))d=d.slice(2);
  return (d.length===10||d.length===11)?d:'';
}
function whatsappFrom(v){
  const s=String(v||'').trim();
  if(/^https?:\/\//i.test(s)){
    try{const u=new URL(s);const host=u.hostname.toLowerCase();if(host==='wa.me'||host==='whatsapp.com'||host.endsWith('.whatsapp.com'))return u.href;return''}catch(_){return''}
  }
  const d=phoneDigits(s);
  return d.length===11&&d[2]==='9'?`https://wa.me/55${d}`:'';
}
function loosePhone(v){
  const s=String(v||'');
  const m=s.match(/(?:\+?55[\s.-]*)?(?:\(?\d{2}\)?[\s.-]*)9?\d{4}[\s.-]?\d{4}/);
  return m?phoneDigits(m[0]):'';
}
function contactStatusLabel(o){
  const st=String(o?.contact_status||'').toLowerCase();
  if(st==='hidden_on_olx')return 'Telefone oculto na OLX';
  if(st==='public_on_source'||st==='public_on_result')return 'Contato público';
  if(st==='not_public')return 'Sem número público';
  return '';
}
function contactHtml(o){
  const parts=[];
  const phone=phoneDigits(o.contact_phone||'');
  const wa=whatsappFrom(o.whatsapp_url||phone);
  if(wa)parts.push(`<a class="contact-btn whatsapp" href="${esc(wa)}" target="_blank" rel="noopener noreferrer">WhatsApp ↗</a>`);
  if(phone)parts.push(`<a class="contact-btn phone" href="tel:+55${esc(phone)}">${esc(o.contact_phone||phone)}</a>`);
  const st=String(o.contact_status||'').toLowerCase();
  if(!parts.length&&st==='hidden_on_olx'){
    parts.push('<span class="contact-hidden-olx">Telefone oculto na OLX · abrir anúncio</span>');
  }else if(!parts.length&&/telefone verificado/i.test(String(o.contact_method||'')+' '+String(o.contact_note||''))){
    parts.push('<span class="contact-verified-no-number">Telefone verificado · número não exposto</span>');
  }else if(!parts.length&&o.contact_method){
    parts.push(`<span class="contact-method">${esc(o.contact_method)}</span>`);
  }
  return parts.join('')||'<span class="small">Contato não exposto</span>';
}
function renderSourceCoverage(){
  const box=document.getElementById('sourceCoverage');if(!box)return;
  const names=['Facebook Grupos Públicos','Facebook Marketplace','Web aberta com contato','Facebook público','Web pública','OLX Imóveis'];
  box.innerHTML=names.map(name=>{
    const p=sourceProfiles.find(x=>String(x.name).toLowerCase()===name.toLowerCase());
    const n=discoveredLeads.filter(x=>String(x.source).toLowerCase()===name.toLowerCase()).length + owners.filter(x=>String(x.source).toLowerCase()===name.toLowerCase()).length;
    const fb=name==='Facebook Marketplace'||name==='Facebook Grupos Públicos';
    const secondary=name==='OLX Imóveis';
    return `<div class="source-card"><div class="source-card-top">${sourceBadge(name)}<span class="source-state ${p?.source_active!==false?'on':'off'}">${p?.source_active!==false?'Ativa':'Inativa'}</span></div><strong>${n}</strong><span>lead(s) visíveis</span><small>${secondary?'Fonte secundária: usada quando não há contato melhor em fontes abertas.':fb&&n===0?'Busca somente conteúdo público/indexado; grupos fechados não são acessados.':p?.last_query_at?'Última coleta: '+new Date(p.last_query_at).toLocaleString('pt-BR'):'Fonte configurada para coleta.'}</small></div>`;
  }).join('');
}
function populateDiscoveryFilters(){
  const sf=document.getElementById('deepSourceFilter'),cf=document.getElementById('deepCityFilter');if(!sf||!cf)return;
  const sCur=sf.value,cCur=cf.value;
  sf.innerHTML='<option value="">Todas as fontes</option>'+[...new Set(discoveredLeads.map(x=>x.source).filter(Boolean))].sort().map(x=>`<option>${esc(x)}</option>`).join('');
  cf.innerHTML='<option value="">Todas as cidades</option>'+[...new Set(discoveredLeads.map(x=>x.city).filter(Boolean))].sort().map(x=>`<option>${esc(x)}</option>`).join('');
  sf.value=sCur;cf.value=cCur;
}
function filteredDiscoveredLeads(){
  const q=(document.getElementById('deepSearchInput')?.value||'').toLowerCase(),src=document.getElementById('deepSourceFilter')?.value||'',city=document.getElementById('deepCityFilter')?.value||'',direct=document.getElementById('deepOwnerFilter')?.value||'',contact=document.getElementById('deepContactFilter')?.value||'';
  return discoveredLeads.filter(x=>{
    const phone=phoneDigits(x.contact_verified_phone||x.contact_phone||'');const wa=whatsappFrom(x.whatsapp_url||phone);
    const contactOk=!contact||(contact==='whatsapp'&&!!wa)||(contact==='phone'&&!!phone)||(contact==='hidden'&&!phone&&!wa);
    const status=registryNorm(x.status),sourceName=registryNorm(x.source);
    const excluded=['rejected','discarded','not_approved','cancelled'].includes(status)||dashboardLooksProfessional(x)||Boolean(x.area_risk||x.risk_area||x.closed_community)||sourceName==='proprietario direto';
    return !excluded&&(!q||[x.title,x.city,x.neighborhood,x.source,x.contact_method,x.contact_phone].join(' ').toLowerCase().includes(q))&&(!src||x.source===src)&&(!city||x.city===city)&&(!direct||x.owner_direct)&&contactOk;
  });
}
function renderDeepSearch(){
  renderSourceCoverage();populateDiscoveryFilters();
  const rows=filteredDiscoveredLeads();
  const count=document.getElementById('deepCount');if(count)count.textContent=`${rows.length} lead${rows.length===1?'':'s'}`;
  const box=document.getElementById('deepSearchTable');if(!box)return;
  if(!rows.length){box.innerHTML='<div class="empty">Nenhum lead descoberto com estes filtros.</div>';return}
  const tableRows=rows.map(x=>{
    const sourceUrl=safeHttpUrl(x.source_url);
    return `<tr><td><strong>${esc(x.title)}</strong><br><span class="small">${esc(x.property_type||'Residencial')} · ${Number(x.area||0)||'—'} m² · ${Number(x.bedrooms||0)||'—'} dorm. · ${Number(x.parking||0)||'—'} vagas</span></td><td>${esc(x.city||'—')}<br><span class="small">${esc(x.neighborhood||'')}${x.address?'<br>'+esc(x.address):''}${x.cep?' · '+esc(x.cep):''}</span></td><td>${money(x.price)}</td><td>${sourceBadge(x.source,sourceUrl)}${x.owner_direct?'<span class="direct-owner-flag">Proprietário direto</span>':''}</td><td>${contactHtml(x)}${x.contact_note?`<div class="contact-note">${esc(x.contact_note)}</div>`:''}</td><td>${x.published_at?new Date(x.published_at).toLocaleDateString('pt-BR'):'Data não informada'}</td><td>${qaStatusHtml(x.quinto_status||'pending',x.quinto_match_url||'')}</td><td><span class="badge ${x.quinto_status==='found_on_quintoandar'?'bad':'mid'}">${x.quinto_status==='found_on_quintoandar'?'Descartar':esc(x.status||'Em análise')}</span></td><td>${sourceUrl?`<a class="source-action" href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">Abrir anúncio ↗</a>`:'<span class="source-missing">Link inválido</span>'}</td></tr>`;
  }).join('');
  const cards=rows.map(x=>{
    const sourceUrl=safeHttpUrl(x.source_url);
    const specs=[x.property_type||'Residencial',Number(x.area||0)?`${x.area} m²`:'',Number(x.bedrooms||0)?`${x.bedrooms} dorm.`:'',Number(x.parking||0)?`${x.parking} vagas`:''].filter(Boolean).join(' · ');
    return `<article class="m-card">
      <div class="m-card-top"><strong>${esc(x.title||'Lead')}</strong><span class="badge ${x.quinto_status==='found_on_quintoandar'?'bad':'mid'}">${x.quinto_status==='found_on_quintoandar'?'No QA':esc(x.status||'Em análise')}</span></div>
      <div class="m-card-meta">${esc(x.city||'—')}${x.neighborhood?' · '+esc(x.neighborhood):''}</div>
      <div class="m-card-price">${money(x.price)}</div>
      <div class="m-card-specs">${esc(specs)}</div>
      <div class="m-card-row">${sourceBadge(x.source,sourceUrl)}${x.owner_direct?'<span class="direct-owner-flag">Direto</span>':''}</div>
      <div class="m-card-row">${contactHtml(x)}</div>
      <div class="m-card-actions">${sourceUrl?`<a class="source-action" href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">Abrir anúncio ↗</a>`:''}${qaStatusHtml(x.quinto_status||'pending',x.quinto_match_url||'')}</div>
    </article>`;
  }).join('');
  box.innerHTML=`<div class="desktop-table-wrap"><table class="deep-table"><thead><tr><th>Imóvel</th><th>Cidade</th><th>Valor</th><th>Origem</th><th>Contato</th><th>Data</th><th>QuintoAndar</th><th>Status</th><th>Link</th></tr></thead><tbody>${tableRows}</tbody></table></div><div class="mobile-card-list">${cards}</div>`;
}
function filteredOwners(){
  const q=(document.getElementById('ownerSearch')?.value||'').toLowerCase(),city=document.getElementById('ownerCity')?.value||'',hist=document.getElementById('ownerHistoryFilter')?.value||'';
  return owners.filter(o=>(!q||(o.title+' '+o.city+' '+o.source).toLowerCase().includes(q))&&(!city||o.city===city)&&(!hist||(hist==='current'?o.is_current:!o.is_current)));
}
function xlsxAvailable(){if(!window.XLSX){toast('Biblioteca Excel não carregou. Verifique a internet e tente novamente.');return false}return true}
function ownerRowsForExcel(rows){return rows.map(o=>({'Imóvel':o.title,'Cidade':o.city,'Bairro':o.neighborhood||'','Endereço':o.address||'','CEP':o.cep||'','Tipo':o.type,'Modalidade':o.transaction_type==='rent'?'Locação':'Venda','Valor':Number(o.price||0),'Área m²':Number(o.area||0),'Quartos':Number(o.beds||0),'Vagas':Number(o.parking||0),'Origem':o.source,'Data de publicação':o.published_at?new Date(o.published_at).toLocaleDateString('pt-BR'):'Data não informada','Status':o.is_current?(ownerStatusMeta(o.status,o.quinto_status).label):'Histórico','Tratado por':o.handled_by_name||'','Contato':o.contact_name||'','Telefone':o.contact_phone||'','WhatsApp':o.whatsapp_url||'','Canal de contato':o.contact_method||'','Link original':propertyUrl(o)||''}))}
function saveWorkbook(rows,name){
  if(!xlsxAvailable()||!rows.length)return;
  const ws=XLSX.utils.json_to_sheet(rows);ws['!autofilter']={ref:ws['!ref']};
  Object.keys(ws).forEach(a=>{if(a[0]==='!')return;const c=ws[a];if(typeof c?.v==='string'&&/^https?:\/\//i.test(c.v))c.l={Target:c.v,Tooltip:'Abrir link'};});
  ws['!cols']=Object.keys(rows[0]||{}).map((k,i)=>({wch:Math.min(60,Math.max(12,Math.max(k.length,...rows.slice(0,80).map(r=>String(r[k]??'').length))+2))}));
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Leads');XLSX.writeFile(wb,name)
}
function pdfAvailable(){return Boolean(window.jspdf?.jsPDF);}
function exportRowsPdf(rows,title,file){
  if(!rows.length){toast('Nenhum registro para exportar.');return}
  if(!pdfAvailable()){toast('Biblioteca PDF não carregou. Tente novamente.');return}
  const {jsPDF}=window.jspdf;const keys=Object.keys(rows[0]);const landscape=keys.length>5;const doc=new jsPDF({orientation:landscape?'landscape':'portrait',unit:'mm',format:'a4'});
  doc.setFontSize(15);doc.text(title,14,14);doc.setFontSize(8);doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')} · ${rows.length} registro(s)`,14,20);
  const body=rows.map(r=>keys.map(k=>String(r[k]??'')));
  doc.autoTable({head:[keys],body,startY:25,styles:{fontSize:6.3,cellPadding:1.5,overflow:'linebreak'},headStyles:{fontSize:6.5},margin:{left:8,right:8},horizontalPageBreak:true});
  doc.save(file);
}
function exportOwnersExcel(){const rows=filteredOwners();if(!rows.length){toast('Nenhum lead no filtro atual.');return}saveWorkbook(ownerRowsForExcel(rows),`LJ-Radar-Imob-Leads-${new Date().toISOString().slice(0,10)}.xlsx`)}
function exportOwnersPdf(){const rows=filteredOwners();exportRowsPdf(ownerRowsForExcel(rows),'LJ Radar Imob — Proprietários',`LJ-Radar-Imob-Proprietarios-${new Date().toISOString().slice(0,10)}.pdf`)}
function discoveryRowsForExcel(rows=filteredDiscoveredLeads()){return rows.map(x=>({
'Imóvel':x.title,'Cidade':x.city,'Bairro':x.neighborhood||'','Endereço':x.address||'','CEP':x.cep||'',
'Tipo':x.property_type||'','Modalidade':x.transaction_type==='rent'?'Locação':'Venda','Valor':Number(x.price||0),
'Área m²':Number(x.area||0),'Quartos':Number(x.bedrooms||0),'Vagas':Number(x.parking||0),'Origem':x.source,
'Proprietário direto':x.owner_direct?'Sim':'Não',
'Data de publicação':x.published_at?new Date(x.published_at).toLocaleDateString('pt-BR'):'Data não informada',
'QuintoAndar':qaStatusMeta(x.quinto_status||'pending').label,'Confiança QA':x.quinto_confidence??'',
'Link correspondência QA':x.quinto_status==='found_on_quintoandar'?(x.quinto_match_url||''):'',
'Contato':x.contact_name||'','Telefone':x.contact_phone||'','WhatsApp':whatsappFrom(x.whatsapp_url||x.contact_phone)||'',
'Status do contato':contactStatusLabel(x),'Canal de contato':x.contact_method||'','Observação contato':x.contact_note||'',
'Link original':x.source_url
}))}
function exportDiscoveryExcel(){const rows=filteredDiscoveredLeads();if(!rows.length){toast('Nenhum lead no filtro atual.');return}saveWorkbook(discoveryRowsForExcel(rows),`LJ-Radar-Imob-Busca-Profunda-${new Date().toISOString().slice(0,10)}.xlsx`)}
function exportDiscoveryPdf(){exportRowsPdf(discoveryRowsForExcel(filteredDiscoveredLeads()),'LJ Radar Imob — Busca Profunda',`LJ-Radar-Imob-Busca-Profunda-${new Date().toISOString().slice(0,10)}.pdf`)}
function normalizeExcelKey(k){return String(k||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')}
function excelVal(row,aliases){const map={};Object.keys(row).forEach(k=>map[normalizeExcelKey(k)]=row[k]);for(const a of aliases){const v=map[normalizeExcelKey(a)];if(v!==undefined&&v!==null&&String(v).trim()!=='')return v}return ''}
function parseMoney(v){if(typeof v==='number')return v;let s=String(v||'').replace(/R\$/gi,'').replace(/\s/g,'');if(s.includes(',')&&s.includes('.'))s=s.replace(/\./g,'').replace(',','.');else if(s.includes(','))s=s.replace(',','.');return Number(s.replace(/[^0-9.-]/g,''))||0}
function parseExcelDate(v){if(!v)return null;if(v instanceof Date)return v.toISOString();if(typeof v==='number'&&window.XLSX){const d=XLSX.SSF.parse_date_code(v);if(d)return new Date(d.y,d.m-1,d.d).toISOString()}const d=new Date(v);return Number.isNaN(d.getTime())?null:d.toISOString()}
function normalizeExcelRow(r){const rawUrl=String(excelVal(r,['link','url','link_original','source_url'])||'').trim();const rawWa=String(excelVal(r,['whatsapp','whatsapp_url'])||'').trim();return {source:String(excelVal(r,['origem','fonte','source'])||'Excel').trim(),source_url:safeHttpUrl(rawUrl),title:String(excelVal(r,['imovel','titulo','title'])||'').trim(),city:String(excelVal(r,['cidade','city'])||'').trim(),neighborhood:String(excelVal(r,['bairro','neighborhood'])||'').trim(),address:String(excelVal(r,['endereco','logradouro','rua','address'])||'').trim(),cep:String(excelVal(r,['cep','zip','codigo_postal','postal_code'])||'').trim(),property_type:String(excelVal(r,['tipo','tipo_imovel','property_type'])||'Apartamento').trim(),transaction_type:/alug|loca|rent/i.test(String(excelVal(r,['modalidade','transacao','transaction_type'])||''))?'rent':'sale',price:parseMoney(excelVal(r,['valor','preco','price'])),area:parseMoney(excelVal(r,['area','area_m2'])),bedrooms:Number(excelVal(r,['quartos','dormitorios','bedrooms'])||0),parking:Number(excelVal(r,['vagas','parking'])||0),published_at:parseExcelDate(excelVal(r,['data_de_publicacao','data_publicacao','data','published_at'])),contact_name:String(excelVal(r,['contato','nome_contato','contact_name'])||'').trim(),contact_phone:String(excelVal(r,['telefone','phone','contact_phone'])||'').trim(),whatsapp_url:whatsappFrom(rawWa),contact_method:String(excelVal(r,['canal_de_contato','canal_contato','contact_method'])||'').trim(),owner_direct:/sim|yes|true|direto|propriet/i.test(String(excelVal(r,['proprietario_direto','owner_direct'])||'')),status:'review'} }
function commercialImportRow(x){
  const t=normalizePlain(`${x?.property_type||''} ${x?.title||''}`);
  return /\b(comercial|sala comercial|galpao|loja|escritorio|terreno|predio comercial|ponto comercial)\b/.test(t);
}
async function previewExcelImport(file){
  if(!file||!xlsxAvailable())return;
  try{
    const buf=await file.arrayBuffer(),wb=XLSX.read(buf,{type:'array',cellDates:true}),ws=wb.Sheets[wb.SheetNames[0]],
      raw=XLSX.utils.sheet_to_json(ws,{defval:''}),normalized=raw.map(normalizeExcelRow),
      validBase=normalized.filter(x=>x.title&&x.source_url),
      commercialSkipped=validBase.filter(commercialImportRow).length,
      invalidSkipped=normalized.length-validBase.length;
    excelImportRows=validBase.filter(x=>!commercialImportRow(x));
    const sum=document.getElementById('excelImportSummary');
    if(sum)sum.textContent=`${excelImportRows.length} residencial(is) válida(s) · ${commercialSkipped} comercial(is) descartado(s) · ${invalidSkipped} sem título/link.`;
    const box=document.getElementById('excelImportPreview');
    if(box)box.innerHTML=excelImportRows.slice(0,8).map(x=>`<div class="excel-preview-row"><strong>${esc(x.title)}</strong><span>${esc(x.city)} · ${esc(x.source)} · ${money(x.price)}</span></div>`).join('')+(excelImportRows.length>8?`<div class="small">+ ${excelImportRows.length-8} linha(s)</div>`:'');
    const btn=document.getElementById('excelImportBtn');if(btn)btn.disabled=!excelImportRows.length;
  }catch(e){console.error(e);toast('Não foi possível ler o Excel.')}
}
function clearExcelImport(){excelImportRows=[];const f=document.getElementById('excelFileInput');if(f)f.value='';const b=document.getElementById('excelImportPreview');if(b)b.innerHTML='';const s=document.getElementById('excelImportSummary');if(s)s.textContent='Nenhum arquivo selecionado.';const btn=document.getElementById('excelImportBtn');if(btn)btn.disabled=true}
async function confirmExcelImport(){const client=window.LJI_BACKEND?.client,cfg=window.LJI_CONFIG||{};if(!client||!excelImportRows.length)return;const payload=excelImportRows.map(x=>({...x,workspace_id:cfg.WORKSPACE_ID,query_context:'Importado por Excel',discovered_at:new Date().toISOString()}));const {error}=await client.from('lji_discovered_leads').upsert(payload,{onConflict:'workspace_id,source_url'});if(error){console.error(error);toast('Erro ao importar o Excel.');return}toast(`${payload.length} lead(s) importado(s).`);clearExcelImport();await window.LJI_BACKEND?.syncDiscovery?.();go('deep-search')}
function downloadExcelTemplate(){if(!xlsxAvailable())return;const rows=[{'Imóvel':'TÍTULO DO IMÓVEL','Cidade':'','Bairro':'Centro','Tipo':'Apartamento','Modalidade':'Venda','Valor':450000,'Área m²':80,'Quartos':2,'Vagas':1,'Origem':'','Proprietário direto':'Sim','Data de publicação':'','Contato':'','Telefone':'','WhatsApp':'','Canal de contato':'OLX chat','Link original':''}];saveWorkbook(rows,'LJ-Radar-Imob-Modelo-Importacao.xlsx')}
function openPermissionEditor(userId){
  if(window.LJI_CURRENT_USER?.role!=='super_admin')return;
  const u=(window.LJI_ADMIN_STATE?.members||[]).find(x=>String(x.user_id)===String(userId));if(!u)return;
  const current=modulesFromPermissions(u.role,u.permissions);
  const box=document.getElementById('permissionEditor');if(!box)return;
  box.classList.remove('hidden');
  box.innerHTML=`<div class="permission-panel"><div class="permission-head"><div><h2>${esc(u.name)}</h2><span>${esc(roleLabel(u.role))}</span></div><button class="permission-close" onclick="document.getElementById('permissionEditor').classList.add('hidden')">×</button></div>${u.role==='super_admin'?'<div class="notice">O CEO mantém acesso total.</div>':`<div class="permission-grid">${MODULE_DEFS.map(([key,label])=>`<label><input type="checkbox" value="${key}" ${current.includes(key)?'checked':''}> <span>${esc(label)}</span></label>`).join('')}</div><div class="permission-actions"><button class="secondary" onclick="resetUserPermissions('${esc(u.user_id)}','${esc(u.role)}')">Restaurar padrão do perfil</button><button class="primary" onclick="saveUserPermissions('${esc(u.user_id)}')">Salvar telas</button></div>`}</div>`;
}
async function saveUserPermissions(userId){const box=document.getElementById('permissionEditor'),client=window.LJI_BACKEND?.client,cfg=window.LJI_CONFIG||{};if(!box||!client)return;const modules=[...box.querySelectorAll('input[type=checkbox]:checked')].map(x=>x.value);const {error}=await client.from('lji_workspace_members').update({permissions:{modules}}).eq('workspace_id',cfg.WORKSPACE_ID).eq('user_id',userId);if(error){console.error(error);toast('Falha ao salvar permissões.');return}toast('Telas do usuário atualizadas.');await window.LJI_BACKEND?.syncAdmin?.();box.classList.add('hidden')}
async function resetUserPermissions(userId,role){const client=window.LJI_BACKEND?.client,cfg=window.LJI_CONFIG||{};if(!client)return;const {error}=await client.from('lji_workspace_members').update({permissions:{modules:defaultModulesForRole(role)}}).eq('workspace_id',cfg.WORKSPACE_ID).eq('user_id',userId);if(error){toast('Falha ao restaurar.');return}toast('Permissões restauradas.');await window.LJI_BACKEND?.syncAdmin?.();openPermissionEditor(userId)}

function saveOwners(){}
function saveBuyers(){}

function ownerStatusMeta(status,quintoStatus){
  const s=String(status||'').toLowerCase().trim();
  const q=String(quintoStatus||'').toLowerCase().trim();
  if(q==='found_on_quintoandar') return {label:'Já no QuintoAndar',cls:'status-qa'};
  if(s==='approved'||s==='aprovado') return {label:'Aprovado',cls:'status-approved'};
  if(s==='hot'||s==='quente'||s==='priority'||s==='prioridade') return {label:'Quente 🔥',cls:'status-hot'};
  if(s==='review'||s==='revisar') return {label:'Revisar',cls:'status-review'};
  if(s==='rejected'||s==='discarded'||s==='descartado') return {label:'Descartado',cls:'status-rejected'};
  if(s==='pending'||s==='pendente') return {label:'Pendente',cls:'status-pending'};
  return {label:status||'Pendente',cls:'status-pending'};
}
function formatPublishedDate(v){
  if(!v) return 'Data não informada';
  const d=new Date(v);
  if(Number.isNaN(d.getTime())) return 'Data não informada';
  return 'Publicado em '+d.toLocaleDateString('pt-BR');
}

function money(n){return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0}).format(Number(n)||0)}
let LJI_TOAST_TIMER=null;
function toast(msg){
  const t=document.getElementById('toast');if(!t)return;
  t.textContent=String(msg||'');t.classList.add('show');
  if(LJI_TOAST_TIMER)clearTimeout(LJI_TOAST_TIMER);
  const ms=Math.max(2800,Math.min(5200,2200+String(msg||'').length*35));
  LJI_TOAST_TIMER=setTimeout(()=>t.classList.remove('show'),ms);
}
let ljiPageHistory=[];
function currentLjiPage(){const p=[...document.querySelectorAll('.page')].find(x=>!x.classList.contains('hidden'));return p?.id||'dashboard'}
function syncMobileNavActive(pageId){
  const map={
    dashboard:'dashboard',
    'whatsapp-leads':'whatsapp-leads',
    intentions:'intentions',
    matches:'matches'
  };
  const primary=map[pageId]||null;
  document.querySelectorAll('.mobile-bottom-nav button').forEach(btn=>{
    const onclick=btn.getAttribute('onclick')||'';
    let match=false;
    if(primary==='dashboard' && onclick.includes("mobileGo('dashboard')")) match=true;
    else if(primary==='whatsapp-leads' && onclick.includes("mobileGo('whatsapp-leads')")) match=true;
    else if(primary==='intentions' && onclick.includes("mobileGo('intentions')")) match=true;
    else if(primary==='matches' && onclick.includes("mobileGo('matches')")) match=true;
    else if(!primary && onclick.includes('toggleMobileMenu')) match=true;
    btn.classList.toggle('is-active',match);
    btn.classList.toggle('active',match);
  });
}
function go(id,opts={}){
  const target=document.getElementById(id);if(!target)return;
  const current=currentLjiPage();
  if(!opts.fromBack && current && current!==id) ljiPageHistory.push(current);
  document.querySelectorAll('.page').forEach(p=>p.classList.add('hidden'));target.classList.remove('hidden');
  document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===id));
  syncMobileNavActive(id);
  toggleMobileMenu(false);
  renderAll();ensureBackButtons();
  try{window.scrollTo({top:0,behavior:'smooth'})}catch(e){window.scrollTo(0,0)}
}
function goBackLji(){
  let id=null;while(ljiPageHistory.length && !id){const candidate=ljiPageHistory.pop();if(candidate&&candidate!==currentLjiPage()&&document.getElementById(candidate))id=candidate}
  go(id||'dashboard',{fromBack:true});
}
function ensureBackButtons(){
  document.querySelectorAll('.page:not(#dashboard) .top').forEach(top=>{
    if(top.querySelector('.back-shortcut'))return;
    const b=document.createElement('button');b.className='secondary back-shortcut';b.type='button';b.innerHTML='← Voltar';b.onclick=goBackLji;
    const actions=top.querySelector('.top-actions');
    if(actions)actions.insertBefore(b,actions.firstChild);else top.appendChild(b);
  });
}


window.LJI_USER_PREFS=window.LJI_USER_PREFS||{dashboard:{},notifications:{}};
async function preferenceClient(){return window.LJI_BACKEND?.client||window.LJI_getSupabaseClient?.()||null}
async function saveDashboardPreferencePatch(patch){
 const client=await preferenceClient(),u=window.LJI_CURRENT_USER;if(!client||!u?.id)return false;
 const merged={...(window.LJI_USER_PREFS.dashboard||{}),...patch};
 const {error}=await client.from('lj_v2_user_preferences').upsert({user_id:u.id,dashboard_preferences:merged},{onConflict:'user_id'});
 if(error){console.error(error);return false}window.LJI_USER_PREFS.dashboard=merged;return true;
}
async function saveNotificationPreferences(){
 const client=await preferenceClient(),u=window.LJI_CURRENT_USER;if(!client||!u?.id)return false;
 const prefs={};document.querySelectorAll('[data-notification-key]').forEach(el=>prefs[el.dataset.notificationKey]=el.classList.contains('on'));
 const {error}=await client.from('lj_v2_user_preferences').upsert({user_id:u.id,notification_preferences:prefs},{onConflict:'user_id'});
 if(error){console.error(error);toast('Falha ao salvar alertas.');return false}window.LJI_USER_PREFS.notifications=prefs;toast('Preferências salvas no Supabase.');return true;
}
async function toggleNotificationPreference(el){el.classList.toggle('on');await saveNotificationPreferences()}
async function LJI_loadUserPreferences(){
 const client=await preferenceClient(),u=window.LJI_CURRENT_USER;if(!client||!u?.id)return;
 const {data,error}=await client.from('lj_v2_user_preferences').select('dashboard_preferences,notification_preferences').eq('user_id',u.id).maybeSingle();
 if(error){console.error('Preferências:',error);return}
 const dash=data?.dashboard_preferences||{},noti=data?.notification_preferences||{};window.LJI_USER_PREFS={dashboard:dash,notifications:noti};
 if(dash.ui_theme)applyTheme(dash.ui_theme,true);
 document.querySelectorAll('[data-notification-key]').forEach(el=>el.classList.toggle('on',noti[el.dataset.notificationKey]===true));
 const last=document.getElementById('backupLastAt');if(last&&dash.last_backup_at)last.textContent=new Date(dash.last_backup_at).toLocaleString('pt-BR');
}
window.LJI_loadUserPreferences=LJI_loadUserPreferences;
async function saveThemePreference(){const theme=document.body.dataset.theme||'champagne';if(await saveDashboardPreferencePatch({ui_theme:theme}))toast('Tema salvo no seu usuário.') ;else toast('Não foi possível salvar o tema.')}
async function saveAccountSettings(){
 const client=await preferenceClient(),name=document.getElementById('accountName')?.value?.trim();if(!client||!name){toast('Informe um nome válido.');return}
 const {data,error}=await client.rpc('lji_update_my_profile',{p_display_name:name});if(error||data!==true){console.error(error);toast('Falha ao atualizar nome.');return}
 try{await client.auth.updateUser({data:{display_name:name}})}catch(e){}
 if(window.LJI_CURRENT_USER)window.LJI_CURRENT_USER.name=name;
 const ne=document.getElementById('currentUserName');if(ne)ne.textContent=name;
 const av=document.getElementById('currentUserAvatar');if(av)av.textContent=name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();
 toast('Nome atualizado no Supabase.');
}
async function signOutOtherSessions(){
 const client=await preferenceClient();if(!client)return;
 if(!confirm('Encerrar as outras sessões deste usuário?'))return;
 const {error}=await client.auth.signOut({scope:'others'});if(error){console.error(error);toast('Não foi possível encerrar outras sessões.');return}toast('Outras sessões encerradas.');
}
async function createWorkspaceBackup(){
 const payload={product:'LJ Radar Imob',version:'22.38.0',created_at:new Date().toISOString(),workspace_id:(window.LJI_CONFIG||{}).WORKSPACE_ID,user:window.LJI_CURRENT_USER?{id:window.LJI_CURRENT_USER.id,email:window.LJI_CURRENT_USER.email,role:window.LJI_CURRENT_USER.role}:null,data:{owners,buyers,buyerIntentions,discoveredLeads,tradeIntents,companyDemands,admin:window.LJI_ADMIN_STATE||{}}};
 const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`LJ-Radar-Imob-snapshot-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
 const now=new Date().toISOString();await saveDashboardPreferencePatch({last_backup_at:now});const last=document.getElementById('backupLastAt');if(last)last.textContent=new Date(now).toLocaleString('pt-BR');toast('Snapshot operacional exportado.');
}
function mobileGo(page){
  try{
    page=String(page||'').trim();
    if(!page){console.warn('mobileGo: página vazia');return}
    const btn=document.querySelector(`.nav button[data-page="${page}"]`);
    if(btn?.classList.contains('role-hidden')){toast('Seu perfil não possui acesso a esta tela.');return}
    toggleMobileMenu(false);
    if(page==='settings'){openSettingsPanel();return}
    const target=document.getElementById(page);
    if(!target){toast('Tela não encontrada: '+page);console.warn('mobileGo: sem seção #'+page);return}
    go(page);
  }catch(e){
    console.error('mobileGo',e);
    toast('Não foi possível abrir esta tela.');
  }
}
function toggleMobileMenu(force){
  const sheet=document.getElementById('mobileMoreSheet'),grid=document.getElementById('mobileMenuGrid');
  if(!sheet||!grid)return;
  const open=typeof force==='boolean'?force:sheet.classList.contains('hidden');
  if(open){
    const excluded=new Set(['dashboard','whatsapp-leads','intentions','matches']);
    const current=currentLjiPage();
    const items=[...document.querySelectorAll('.nav button[data-page]')]
      .filter(b=>!b.classList.contains('role-hidden')&&!excluded.has(b.dataset.page));
    grid.innerHTML=items.map(b=>{
      const page=b.dataset.page;
      const label=(b.textContent||'').replace(/\s+\d+\s*$/,'').replace(/\s+/g,' ').trim();
      const isPri=b.classList.contains('nav-priority');
      const isCur=page===current;
      const cls=[isPri?'mobile-menu-priority':'',isCur?'active':''].filter(Boolean).join(' ');
      return `<button type="button" class="${cls}" data-mobile-page="${esc(page)}">${esc(label)}</button>`;
    }).join('');
    if(!items.length){
      grid.innerHTML='<div class="empty" style="grid-column:1/-1;padding:18px;text-align:center">Nenhuma tela adicional disponível para o seu perfil.</div>';
    }
    sheet.classList.remove('hidden');
    document.body.style.overflow='hidden';
  }else{
    sheet.classList.add('hidden');
    document.body.style.overflow='';
  }
}
window.mobileGo=mobileGo;
window.toggleMobileMenu=toggleMobileMenu;
window.go=go;
function openSettingsPanel(tab){
  document.getElementById('settingsOverlay')?.classList.add('open');
  document.getElementById('settings')?.classList.add('open');
  document.body.classList.add('settings-panel-open');
  if(typeof safeRenderAll==='function')safeRenderAll();
  if(tab){
    const btn=document.querySelector(`.settings-nav button[data-setting="${tab}"]`);
    if(btn && !btn.classList.contains('role-hidden')) btn.click();
  }
}
function closeSettingsPanel(){
  document.getElementById('settingsOverlay')?.classList.remove('open');
  document.getElementById('settings')?.classList.remove('open');
  document.body.classList.remove('settings-panel-open');
}
window.openSettingsPanel=openSettingsPanel;
window.closeSettingsPanel=closeSettingsPanel;
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeSettingsPanel()}});
function openSettingsTab(tab){
  if(tab==='users'){ go('users-admin'); return; }
  if(tab==='data'){ go('history'); return; }
  openSettingsPanel(tab);
}
function syncAccountSettings(){
  const u=window.LJI_CURRENT_USER||{};
  const name=document.getElementById('accountName');
  const role=document.getElementById('accountRole');
  const email=document.getElementById('accountEmail');
  if(name) name.value=u.name||'';
  if(role) role.value=({super_admin:'CEO',gestor:'Gestora',corretor:'Corretora'}[u.role]||u.role||'');
  if(email) email.value=u.email||'';
}
document.querySelectorAll('.nav button').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.page==='settings'){openSettingsPanel();return}go(b.dataset.page)}));
document.querySelectorAll('.settings-nav button').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.settings-nav button').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.setting-section').forEach(s=>s.classList.remove('active'));document.getElementById(b.dataset.setting).classList.add('active')}));
try{syncMobileNavActive(currentLjiPage())}catch(e){}
window.addEventListener('load',()=>{try{syncMobileNavActive(currentLjiPage())}catch(e){}});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    const sheet=document.getElementById('mobileMoreSheet');
    if(sheet && !sheet.classList.contains('hidden')) toggleMobileMenu(false);
  }
});
/* Mobile menu: clique nos itens do sheet (data-mobile-page) */
document.addEventListener('click',function(e){
  const item=e.target.closest('[data-mobile-page]');
  if(item){
    e.preventDefault();
    e.stopPropagation();
    mobileGo(item.getAttribute('data-mobile-page'));
    return;
  }
  /* Nota: os botões da .mobile-bottom-nav já têm onclick="mobileGo(...)" ou
     onclick="toggleMobileMenu()" no próprio HTML — não duplicar aqui,
     senão cada toque disparava a navegação duas vezes seguidas. */
});

function applyTheme(name,silent=false){
 const validThemes=['champagne','emerald','dark','graphite'];
 if(!validThemes.includes(name)) name='champagne';
 document.body.dataset.theme=name;
 document.documentElement.dataset.theme=name;
 document.documentElement.style.colorScheme=name==='dark'?'dark':'light';
 localStorage.setItem('lji_theme',name);
 document.querySelectorAll('[data-theme-card]').forEach(x=>x.classList.toggle('active',x.dataset.themeCard===name));
 let themeMeta=document.querySelector('meta[name="theme-color"]');
 if(!themeMeta){themeMeta=document.createElement('meta');themeMeta.name='theme-color';document.head.appendChild(themeMeta)}
 themeMeta.content={champagne:'#f8f6f2',emerald:'#f1f8f5',dark:'#0f1318',graphite:'#eef1f4'}[name];
 if(!silent)toast('Tema '+({champagne:'Champagne',emerald:'Esmeralda',dark:'Dark Mode',graphite:'Grafite'}[name])+' aplicado.');
}
applyTheme(localStorage.getItem('lji_theme')||'champagne',true);

function addBuyer(){
 const name=document.getElementById('bName').value.trim(),budget=Number(document.getElementById('bBudget').value);
 if(!name||!budget){toast('Preencha nome e orçamento.');return}
 buyers.unshift({
  id:Date.now(),name,city:document.getElementById('bCity').value,neighborhood:document.getElementById('bNeighborhood')?.value.trim()||'',type:document.getElementById('bType').value,transaction_type:document.getElementById('bTransactionType')?.value||'sale',budget,
  beds:Number(document.getElementById('bBeds').value||0),parking:Number(document.getElementById('bParking').value||0),
  area_min:Number(document.getElementById('bArea').value||0),urgency:Number(document.getElementById('bUrgency').value),
  source:document.getElementById('bSource').value,contact:document.getElementById('bContact').value.trim()
 });
 saveBuyers();renderAll();toast('Comprador salvo e cruzado.')
}
async function deleteBuyer(id){
 const client=window.LJI_BACKEND?.client,cfg=window.LJI_CONFIG||{};
 if(!client){toast('Supabase indisponível.');return}
 const {error}=await client.from('lji_buyers').update({status:'inactive'}).eq('workspace_id',cfg.WORKSPACE_ID).eq('id',id);
 if(error){console.error(error);toast('Falha ao arquivar comprador.');return}
 toast('Comprador arquivado.');await window.LJI_BACKEND?.sync?.();
}

const MATCH_MAX_DAYS=365;
function matchNorm(v){return normalizePlain(v)}
function matchType(v){
 const n=matchNorm(v);
 if(!n||['imovel','qualquer','todos','residencial'].includes(n))return'';
 if(['apartamento','apto','apartment'].includes(n))return'apartamento';
 if(['casa','sobrado','house','home'].includes(n))return'casa';
 if(n.includes('studio'))return'studio';
 if(n.includes('kitnet')||n.includes('flat'))return'kitnet';
 if(n.includes('cobertura')||n.includes('penthouse'))return'cobertura';
 return n;
}
function matchTransaction(v){
 const n=matchNorm(v);
 if(!n)return'';
 if(/\b(both|ambos|ambas|compra e locacao|venda e locacao|comprar ou alugar)\b/.test(n))return'both';
 if(/\b(rent|aluguel|alugar|locacao|locar)\b/.test(n))return'rent';
 if(/\b(sale|venda|vender|compra|comprar)\b/.test(n))return'sale';
 return'';
}
function matchCityKey(v){
 const n=matchNorm(v);
 if(!n)return'';
 if(/^(abc|grande abc|regiao do abc|abc paulista)$/.test(n))return'abc';
 if(n.includes('santo andre'))return'santo andre';
 if(n.includes('sao bernardo'))return'sao bernardo do campo';
 if(n.includes('sao caetano'))return'sao caetano do sul';
 if(n==='diadema'||n.includes(' diadema'))return'diadema';
 if(n==='sao paulo'||n.startsWith('sao paulo zona ')||n.startsWith('sao paulo centro')||n==='centro de sao paulo'||n==='centro sao paulo'||n.startsWith('zona ')&&n.includes('sao paulo'))return'sao paulo';
 return n;
}
function matchCity(a,b){
 const x=matchCityKey(a),y=matchCityKey(b);
 if(!x||!y)return null;
 if(x===y)return true;
 const abc=new Set(['santo andre','sao bernardo do campo','sao caetano do sul','diadema']);
 if(x==='abc'&&abc.has(y))return true;
 if(y==='abc'&&abc.has(x))return true;
 return false;
}
function matchNeighborhoodNorm(v){
 return ` ${matchNorm(v)} `
   .replace(/\bjd\b/g,'jardim').replace(/\bvl\b/g,'vila').replace(/\bpq\b/g,'parque')
   .replace(/\bsta\b/g,'santa').replace(/\bsto\b/g,'santo').replace(/\bcentro de\b/g,'centro ')
   .replace(/\s+/g,' ').trim();
}
function matchNeighborhood(a,b){
 const x=matchNeighborhoodNorm(a),y=matchNeighborhoodNorm(b);
 if(!x||!y)return null;
 if(x===y)return 1;
 if(x.startsWith(y)||y.startsWith(x)||x.includes(y)||y.includes(x))return .8;
 const xt=new Set(x.split(' ').filter(t=>t.length>2)),yt=new Set(y.split(' ').filter(t=>t.length>2));
 const common=[...xt].filter(t=>yt.has(t)).length,den=Math.max(xt.size,yt.size,1);
 return common/den>=.6?.65:0;
}
function scoreMatch(b,o){
 const buyerTx=matchTransaction(b.transaction_type),ownerTx=matchTransaction(o.transaction_type);
 if(buyerTx&&buyerTx!=='both'&&ownerTx&&buyerTx!==ownerTx)return 0;
 const city=matchCity(b.city,o.city);
 if(city===false)return 0;
 const spRegionFit=buyerSpRegionFit(b.city,o.neighborhood);
 if(spRegionFit===false)return 0;
 const bt=matchType(b.type),ot=matchType(o.type);
 if(bt&&ot&&bt!==ot)return 0;

 let s=0;
 if(buyerTx==='both')s+=10;
 else if(buyerTx&&ownerTx&&buyerTx===ownerTx)s+=15;
 if(city===true)s+=spRegionFit===null&&canonicalBuyerRegion(b.city).startsWith('São Paulo —')?20:30;
 if(spRegionFit===true)s+=8;

 if(b.neighborhood){
   const nb=matchNeighborhood(b.neighborhood,o.neighborhood);
   if(nb===1)s+=18;
   else if(nb>=.6)s+=12;
   else if(nb===0)s-=12;
 }

 if(bt&&ot&&bt===ot)s+=20;
 const budget=Number(b.budget||0),price=Number(o.price||0);
 if(budget>0&&price>0){
   if(price<=budget)s+=25;
   else{
     const over=(price-budget)/budget;
     if(over<=.05)s+=12;
     else if(over<=.08)s+=6;
     else return 0;
   }
 }
 const bedsNeed=Number(b.beds)||0,parkingNeed=Number(b.parking)||0,areaNeed=Number(b.area_min)||0;
 if(bedsNeed>0&&(Number(o.beds)||0)>=bedsNeed)s+=10;
 if(parkingNeed>0&&(Number(o.parking)||0)>=parkingNeed)s+=8;
 if(areaNeed>0&&(Number(o.area)||0)>=areaNeed)s+=10;
 s+=Number(b.urgency)===3?7:Number(b.urgency)===2?5:3;
 if(['quente','hot'].includes(matchNorm(o.status)))s+=3;
 return Math.max(0,Math.min(100,s))
}
function dateWithinDays(raw,maxDays=MATCH_MAX_DAYS,allowMissing=true){
 if(!raw)return allowMissing;
 const d=new Date(raw);if(Number.isNaN(d.getTime()))return allowMissing;
 const age=Date.now()-d.getTime();
 if(age<0)return true;
 return age<=maxDays*86400000;
}
function ownerEligibleForMatch(o){
 if(o?.is_current===false)return false;
 if(o?.status==='rejected')return false;
 if(dashboardLooksProfessional(o)||dashboardLooksGenericPage(o))return false;
 const url=String(propertyUrl(o)||'').toLowerCase();
 if(/rentola\.com|waa2\.com|achoumudou\.com|mgfimoveis\.com|proprietariodireto\.com\.br/.test(url))return false;
 const reference=o?.published_at||o?.last_seen_at||o?.first_seen_at||o?.created_at||o?.captured_at||'';
 return dateWithinDays(reference,MATCH_MAX_DAYS,true);
}
function allMatches(){
 const out=[];
 buyers.filter(b=>String(b?.status||'active')!=='inactive').forEach(b=>owners.forEach(o=>{
   if(!ownerEligibleForMatch(o))return;
   const score=scoreMatch(b,o);
   if(score>=60)out.push({buyer:b,owner:o,score,engine:'manual'});
 }));
 return out.sort((a,b)=>b.score-a.score)
}
function filteredLocalMatches(applySource=true){
 const source=applySource?(document.getElementById('matchSourceFilter')?.value||''):'';
 return allMatches().filter(m=>!source||matchSourceName(m.owner?.source)===source);
}
function groupLocalMatches(rows=filteredLocalMatches()){
 const map=new Map();
 rows.forEach(m=>{
   const key=String(m.buyer?.id||m.buyer?.name||'');
   if(!key)return;
   if(!map.has(key))map.set(key,{key,buyer:m.buyer,items:[]});
   map.get(key).items.push(m);
 });
 return [...map.values()].map(g=>{
   g.items.sort((a,b)=>b.score-a.score);
   g.best=Number(g.items[0]?.score||0);
   return g;
 }).sort((a,b)=>b.best-a.best||String(a.buyer?.name||'').localeCompare(String(b.buyer?.name||''),'pt-BR'));
}

function inferResidentialType(o){
  const blob=(String(o?.title||'')+' '+String(o?.source_url||o?.url||'')).toLowerCase();
  if(blob.includes('casa')||blob.includes('sobrado'))return 'Casa';
  if(blob.includes('studio'))return 'Studio';
  if(blob.includes('kitnet'))return 'Kitnet';
  return 'Apartamento';
}
function ownerDisplayDate(o){
  const raw=o.published_at||'';
  if(!raw)return 'Data não informada';
  const d=new Date(raw);if(Number.isNaN(d.getTime()))return String(raw);
  return `Publicado em ${d.toLocaleDateString('pt-BR')}`;
}
const RI_DIGITAL_URL='https://www.ridigital.org.br/';
const REGISTRY_MUNICIPAL_SOURCES={
  'santo andre':'https://siga.santoandre.sp.gov.br/',
  'sao bernardo do campo':'https://saobernardo.sp.gov.br/web/sbc/certidoes',
  'sao caetano do sul':'https://atendefacil.saocaetanodosul.sp.gov.br/Portal/Servicos/Detalhe/296',
  'diadema':'https://eprocesso.diadema.sp.gov.br/atendimento/servico-info/116'
};
function registryNorm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim()}
function registryStatusMeta(status,row){
  if(status==='draft'&&/endereco validado automaticamente/i.test(registryNorm(row?.notes)))return ['Endereço localizado','good'];
  return ({draft:['Rascunho','mid'],registry_identified:['Cartório identificado','good'],certificate_requested:['Certidão solicitada','mid'],confirmed:['Titular confirmado','good'],review:['Revisar','hot'],not_found:['Não localizado','mid']}[status]||['Rascunho','mid']);
}
function openRiDigital(){window.open(RI_DIGITAL_URL,'_blank','noopener')}
function municipalRegistryUrl(city){return REGISTRY_MUNICIPAL_SOURCES[registryNorm(city)]||''}
function openMunicipalRegistrySupport(){
  const city=document.getElementById('rCity')?.value||'';const url=municipalRegistryUrl(city);
  if(!url){toast('Ainda não há atalho municipal oficial cadastrado para esta cidade. Use o RI Digital como fonte registral principal.');return}
  window.open(url,'_blank','noopener');
}
function updateRegistrySourceHint(){
  const city=document.getElementById('rCity')?.value||'';const hint=document.getElementById('registrySourceHint');if(!hint)return;
  const municipal=municipalRegistryUrl(city);
  hint.innerHTML=municipal?`A busca automática validará o endereço em <b>${esc(city)}</b>. O cadastro municipal poderá aparecer como apoio, sem substituir a matrícula ou certidão.`:'A busca automática valida a localização com uma base pública de CEP. Nenhum proprietário será inventado quando a titularidade oficial não estiver disponível.';
}
function registrySetField(id,value){const el=document.getElementById(id);if(el&&value!=null)el.value=String(value)}
function registryCepDigits(v){return String(v||'').replace(/\D/g,'')}
function registryAddressParts(raw){
  const value=String(raw||'').trim();
  const comma=value.indexOf(',');
  if(comma>0)return {street:value.slice(0,comma).trim(),suffix:value.slice(comma+1).trim()};
  const numbered=value.match(/^(.*?)(?:\s+)(\d+[a-zA-Z]?(?:\s+.*)?)$/);
  return numbered?{street:numbered[1].trim(),suffix:numbered[2].trim()}:{street:value,suffix:''};
}
function registrySetResult(kind,html){
  const box=document.getElementById('registryLookupResult');if(!box)return;
  box.className=`registry-lookup-result registry-lookup-${kind}`;
  box.innerHTML=html;
}
function registrySetBusy(busy){
  const btn=document.getElementById('registrySearchButton');if(!btn)return;
  btn.disabled=busy;btn.textContent=busy?'Buscando endereço...':'Buscar automaticamente';
}
async function registryFetchJson(url){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetch(url,{headers:{Accept:'application/json'},signal:controller.signal});
    if(!response.ok)throw new Error(`A fonte de endereço respondeu ${response.status}.`);
    return await response.json();
  }finally{clearTimeout(timer)}
}
function registryPickAddress(rows,street,city,state){
  const wanted=registryNorm(street),wantedCity=registryNorm(city),wantedState=registryNorm(state);
  return (Array.isArray(rows)?rows:[]).map(row=>{
    const got=registryNorm(row.logradouro),gotCity=registryNorm(row.localidade),gotState=registryNorm(row.uf);let score=0;
    if(got===wanted)score+=100;else if(got.startsWith(wanted)||wanted.startsWith(got))score+=70;else if(got.includes(wanted)||wanted.includes(got))score+=45;
    if(gotCity===wantedCity)score+=25;if(gotState===wantedState)score+=15;
    return {row,score};
  }).sort((a,b)=>b.score-a.score)[0]?.row||null;
}
async function lookupRegistryAddress(){
  const rawAddress=document.getElementById('rAddress')?.value.trim()||'';
  const rawCity=document.getElementById('rCity')?.value.trim()||'';
  const rawState=(document.getElementById('rState')?.value||'').trim().toUpperCase();
  const cep=registryCepDigits(document.getElementById('rCep')?.value||'');
  let data=null,parts=registryAddressParts(rawAddress);
  if(cep){
    if(cep.length!==8)throw new Error('Digite um CEP válido com 8 números.');
    data=await registryFetchJson(`https://viacep.com.br/ws/${cep}/json/`);
    if(data?.erro)throw new Error('CEP não localizado na base pública.');
  }else{
    if(!parts.street||parts.street.length<3||!rawCity||rawState.length!==2)throw new Error('Informe o CEP ou preencha endereço, cidade e UF.');
    const url=`https://viacep.com.br/ws/${encodeURIComponent(rawState)}/${encodeURIComponent(rawCity)}/${encodeURIComponent(parts.street)}/json/`;
    const rows=await registryFetchJson(url);
    data=registryPickAddress(rows,parts.street,rawCity,rawState);
    if(!data)throw new Error('Endereço não localizado. Confira rua, cidade e UF.');
  }
  if(!parts.suffix&&rawAddress&&data.logradouro&&registryNorm(rawAddress)!==registryNorm(data.logradouro))parts=registryAddressParts(rawAddress);
  const address=data.logradouro?`${data.logradouro}${parts.suffix?', '+parts.suffix:''}`:(rawAddress||`CEP ${data.cep||cep}`);
  const result={address,city:data.localidade||rawCity,state:(data.uf||rawState).toUpperCase(),cep:data.cep||cep,neighborhood:data.bairro||'',ibge:data.ibge||'',ddd:data.ddd||'',source:'ViaCEP'};
  registrySetField('rAddress',result.address);registrySetField('rCity',result.city);registrySetField('rState',result.state);registrySetField('rCep',result.cep);updateRegistrySourceHint();
  return result;
}
async function persistRegistryLookup(result){
  const client=window.LJI_BACKEND?.client,cfg=window.LJI_CONFIG||{};
  if(!client||!cfg.WORKSPACE_ID)return {saved:false,message:'Endereço localizado, mas a sessão do banco está indisponível e o resultado não foi salvo.'};
  const userNotes=document.getElementById('rNotes')?.value.trim()||'';
  const existing=(registrySearches||[]).find(row=>registryNorm(row.address)===registryNorm(result.address)&&registryNorm(row.city)===registryNorm(result.city));
  const autoNote=`Endereço validado automaticamente via ViaCEP${result.ibge?' · IBGE '+result.ibge:''}${result.ddd?' · DDD '+result.ddd:''}.${existing?.status==='confirmed'?' Titularidade oficial já confirmada.':' Titularidade oficial pendente.'}`;
  const previousNotes=userNotes||existing?.notes||'';
  const notes=/endereco validado automaticamente/i.test(registryNorm(previousNotes))?previousNotes:[previousNotes,autoNote].filter(Boolean).join(' | ');
  const common={address:result.address,city:result.city,state_code:result.state,cep:result.cep||null,municipal_registration:document.getElementById('rMunicipalRegistration')?.value.trim()||existing?.municipal_registration||null,registry_number:document.getElementById('rRegistryNumber')?.value.trim()||existing?.registry_number||null,registry_office:document.getElementById('rRegistryOffice')?.value.trim()||existing?.registry_office||null,notes,updated_at:new Date().toISOString()};
  let error=null;
  if(existing){
    ({error}=await client.from('lji_registry_searches').update(common).eq('workspace_id',cfg.WORKSPACE_ID).eq('id',existing.id));
  }else{
    const payload={...common,workspace_id:cfg.WORKSPACE_ID,status:'draft',official_source:'ViaCEP · RI Digital / ONR',official_source_url:RI_DIGITAL_URL,created_by:window.LJI_CURRENT_USER?.id||null};
    ({error}=await client.from('lji_registry_searches').insert(payload));
  }
  if(error){console.error('Pesquisa registral automática:',error);return {saved:false,message:'Endereço localizado, mas não foi possível registrar o resultado no histórico.'}}
  await window.LJI_BACKEND?.syncRegistry?.();
  return {saved:true,message:existing?'Pesquisa existente atualizada.':'Resultado salvo no histórico.',ownerName:existing?.official_owner_name||'',evidence:existing?.evidence_reference||''};
}
function renderRegistryLookupResult(result,persisted){
  const municipal=municipalRegistryUrl(result.city);
  const ownerHtml=persisted.ownerName?`<b>${esc(persisted.ownerName)}</b>${persisted.evidence?`<small>Referência: ${esc(persisted.evidence)}</small>`:''}`:'<b class="registry-pending">Aguardando evidência oficial</b>';
  const warning=persisted.ownerName?'Titularidade já confirmada por evidência oficial registrada no Radar.':'O endereço foi encontrado. O nome do proprietário não é público nessa consulta e não será inventado.';
  registrySetResult('success',`<div class="registry-lookup-head"><span class="registry-lookup-check">✓</span><div><strong>Endereço localizado</strong><small>${esc(persisted.message)}</small></div></div>
    <div class="registry-lookup-grid"><div><span>Endereço</span><b>${esc(result.address)}</b></div><div><span>Bairro</span><b>${esc(result.neighborhood||'Não informado pela fonte')}</b></div><div><span>Cidade / UF</span><b>${esc(result.city)} / ${esc(result.state)}</b></div><div><span>CEP</span><b>${esc(result.cep||'Não informado')}</b></div><div><span>Fonte da localização</span><b>ViaCEP · consulta pública</b></div><div><span>Titular registral</span>${ownerHtml}</div></div>
    <div class="registry-lookup-warning"><strong>Importante:</strong> ${esc(warning)}</div>
    <div class="registry-lookup-actions"><button class="secondary" onclick="openRiDigital()">Validar titular no RI Digital ↗</button>${municipal?'<button class="secondary" onclick="openMunicipalRegistrySupport()">Abrir apoio municipal ↗</button>':''}</div>`);
}
let registryAutocompleteTimer=null,registryAutocompleteToken=0,registrySuggestionItems=[],registrySuggestionActiveIndex=-1,registryHideSuggestionsTimer=null;
function onRegistryAddressInput(){
  clearTimeout(registryAutocompleteTimer);
  const box=document.getElementById('rAddressSuggestions');
  const rawAddress=document.getElementById('rAddress')?.value||'';
  const parts=registryAddressParts(rawAddress);
  const city=document.getElementById('rCity')?.value.trim()||'';
  const state=(document.getElementById('rState')?.value||'').trim().toUpperCase();
  if(!parts.street||parts.street.length<3||!city||state.length!==2){
    hideRegistrySuggestions();
    return;
  }
  if(box){box.classList.remove('hidden');box.innerHTML='<div class="registry-address-suggestion-empty">Buscando ruas...</div>'}
  registryAutocompleteTimer=setTimeout(()=>fetchRegistryAddressSuggestions(parts.street,city,state),350);
}
async function fetchRegistryAddressSuggestions(street,city,state){
  const token=++registryAutocompleteToken;
  const box=document.getElementById('rAddressSuggestions');
  try{
    const url=`https://viacep.com.br/ws/${encodeURIComponent(state)}/${encodeURIComponent(city)}/${encodeURIComponent(street)}/json/`;
    const rows=await registryFetchJson(url);
    if(token!==registryAutocompleteToken)return; // resposta antiga, ignorar
    const list=Array.isArray(rows)?rows:[];
    const seen=new Set();
    registrySuggestionItems=list.filter(row=>{
      const key=registryNorm(row.logradouro)+'|'+registryNorm(row.bairro);
      if(!row.logradouro||seen.has(key))return false;
      seen.add(key);return true;
    }).slice(0,8);
    registrySuggestionActiveIndex=-1;
    renderRegistrySuggestions();
  }catch(e){
    if(token!==registryAutocompleteToken)return;
    registrySuggestionItems=[];
    if(box){box.innerHTML='<div class="registry-address-suggestion-empty">Não foi possível buscar sugestões agora.</div>'}
  }
}
function renderRegistrySuggestions(){
  const box=document.getElementById('rAddressSuggestions');if(!box)return;
  if(!registrySuggestionItems.length){
    box.innerHTML='<div class="registry-address-suggestion-empty">Nenhuma rua correspondente encontrada.</div>';
    box.classList.remove('hidden');
    return;
  }
  box.innerHTML=registrySuggestionItems.map((row,idx)=>
    `<div class="registry-address-suggestion${idx===registrySuggestionActiveIndex?' active':''}" data-idx="${idx}" onmousedown="event.preventDefault();selectRegistrySuggestion(${idx})">`+
    `<strong>${esc(row.logradouro)}</strong>`+
    `<span>${esc(row.bairro||'')}${row.bairro?' · ':''}${esc(row.localidade||'')}/${esc(row.uf||'')}${row.cep?' · CEP '+esc(row.cep):''}</span>`+
    `</div>`
  ).join('');
  box.classList.remove('hidden');
}
function selectRegistrySuggestion(idx){
  const row=registrySuggestionItems[idx];if(!row)return;
  const parts=registryAddressParts(document.getElementById('rAddress')?.value||'');
  registrySetField('rAddress',row.logradouro+(parts.suffix?', '+parts.suffix:''));
  registrySetField('rCity',row.localidade||'');
  registrySetField('rState',(row.uf||'').toUpperCase());
  updateRegistrySourceHint();
  hideRegistrySuggestions();
  document.getElementById('rNotes')?.focus?.()||document.getElementById('rAddress')?.focus();
}
function hideRegistrySuggestions(){
  clearTimeout(registryAutocompleteTimer);
  registrySuggestionItems=[];registrySuggestionActiveIndex=-1;
  const box=document.getElementById('rAddressSuggestions');
  if(box){box.classList.add('hidden');box.innerHTML=''}
}
function scheduleHideRegistrySuggestions(){
  // Pequeno atraso pra permitir o clique (mousedown) na sugestão antes do blur fechar a lista.
  clearTimeout(registryHideSuggestionsTimer);
  registryHideSuggestionsTimer=setTimeout(hideRegistrySuggestions,150);
}
function onRegistryAddressKeydown(event){
  const box=document.getElementById('rAddressSuggestions');
  const open=box&&!box.classList.contains('hidden')&&registrySuggestionItems.length;
  if(event.key==='Enter'){
    if(open&&registrySuggestionActiveIndex>=0){
      event.preventDefault();
      selectRegistrySuggestion(registrySuggestionActiveIndex);
      return;
    }
    event.preventDefault();hideRegistrySuggestions();runRegistrySearch();return;
  }
  if(!open)return;
  if(event.key==='ArrowDown'){event.preventDefault();registrySuggestionActiveIndex=Math.min(registrySuggestionActiveIndex+1,registrySuggestionItems.length-1);renderRegistrySuggestions();}
  else if(event.key==='ArrowUp'){event.preventDefault();registrySuggestionActiveIndex=Math.max(registrySuggestionActiveIndex-1,0);renderRegistrySuggestions();}
  else if(event.key==='Escape'){hideRegistrySuggestions();}
}
async function runRegistrySearch(){
  registrySetBusy(true);
  registrySetResult('loading','<strong>Localizando o endereço...</strong><span>Consultando a base pública de CEP e validando os dados informados.</span>');
  try{
    const result=await lookupRegistryAddress();
    const persisted=await persistRegistryLookup(result);
    renderRegistryLookupResult(result,persisted);
    toast('Endereço localizado automaticamente.');
  }catch(error){
    const message=error?.name==='AbortError'?'A consulta demorou demais. Tente novamente.':(error?.message||'Não foi possível localizar o endereço.');
    registrySetResult('error',`<strong>Busca não concluída</strong><span>${esc(message)}</span>`);toast(message);
  }finally{registrySetBusy(false)}
}
function clearRegistryForm(){
  ['rAddress','rCity','rCep','rMunicipalRegistration','rRegistryNumber','rRegistryOffice','rNotes'].forEach(id=>{const e=document.getElementById(id);if(e)e.value=''});
  const uf=document.getElementById('rState');if(uf)uf.value='SP';
  const result=document.getElementById('registryLookupResult');if(result){result.className='registry-lookup-result hidden';result.innerHTML=''}
  updateRegistrySourceHint();hideRegistrySuggestions();document.getElementById('rAddress')?.focus();
}
async function saveRegistrySearch(){return runRegistrySearch()}
async function setRegistrySearchStatus(id,status){
  const client=window.LJI_BACKEND?.client,cfg=window.LJI_CONFIG||{};if(!client)return;
  const patch={status,updated_at:new Date().toISOString()};
  const {error}=await client.from('lji_registry_searches').update(patch).eq('workspace_id',cfg.WORKSPACE_ID).eq('id',id);if(error){console.error(error);toast('Falha ao atualizar a pesquisa.');return}
  await window.LJI_BACKEND?.syncRegistry?.();
}
async function confirmRegistryOwner(id){
  const client=window.LJI_BACKEND?.client,cfg=window.LJI_CONFIG||{};if(!client)return;
  const row=registrySearches.find(x=>String(x.id)===String(id));if(!row)return;
  const owner=prompt('Nome do titular exatamente como consta na matrícula/certidão:',row.official_owner_name||'');if(!owner?.trim())return;
  const ref=prompt('Referência oficial (nº da matrícula, certidão, protocolo ou código do documento):',row.evidence_reference||row.registry_number||'');if(!ref?.trim()){toast('Para confirmar o titular é obrigatório registrar a referência oficial.');return}
  const reg=prompt('Número da matrícula (se constar no documento):',row.registry_number||'')||row.registry_number||null;
  const patch={official_owner_name:owner.trim(),evidence_reference:ref.trim(),registry_number:reg?.trim()||null,status:'confirmed',confirmed_by:window.LJI_CURRENT_USER?.id||null,confirmed_at:new Date().toISOString(),evidence_date:new Date().toISOString().slice(0,10),updated_at:new Date().toISOString()};
  const {error}=await client.from('lji_registry_searches').update(patch).eq('workspace_id',cfg.WORKSPACE_ID).eq('id',id);if(error){console.error(error);toast('Falha ao confirmar titular.');return}
  toast('Titular registral confirmado com referência oficial.');await window.LJI_BACKEND?.syncRegistry?.();
}
function openRegistryForProperty(id){
  const o=(window.owners||owners||[]).find(x=>String(x.id)===String(id));if(!o)return;
  go('registry');
  setTimeout(()=>{
    const set=(field,value)=>{const e=document.getElementById(field);if(e)e.value=value||''};
    set('rAddress',o.address||o.title||'');set('rCity',o.city||'');set('rState','SP');set('rCep',o.cep||'');set('rNotes',`Origem no Radar: ${o.title||'Imóvel'}${propertyUrl(o)?' · '+propertyUrl(o):''}`);updateRegistrySourceHint();
    document.getElementById('rAddress')?.focus();
  },60);
}
function registryFilteredRows(){
  const q=(document.getElementById('registrySearchFilter')?.value||'').toLowerCase(),status=document.getElementById('registryStatusFilter')?.value||'';
  return (registrySearches||[]).filter(r=>(!status||r.status===status)&&(!q||[r.address,r.city,r.registry_number,r.official_owner_name,r.registry_office].join(' ').toLowerCase().includes(q)));
}
function renderRegistrySearches(){
  const rows=registryFilteredRows();const count=document.getElementById('registryCount');if(count)count.textContent=registrySearches.length;
  const box=document.getElementById('registrySearchesTable');if(!box)return;
  if(!rows.length){box.innerHTML='<div class="empty">Nenhuma pesquisa registral salva.</div>';return}
  box.innerHTML=`<div class="registry-list">${rows.map(r=>{const [label,cls]=registryStatusMeta(r.status,r),mun=municipalRegistryUrl(r.city);return `<article class="registry-row">
    <div class="registry-row-main"><div class="registry-row-title"><strong>${esc(r.address)}</strong><span class="badge ${cls}">${esc(label)}</span></div><span>${esc(r.city)} / ${esc(r.state_code)}${r.cep?' · CEP '+esc(r.cep):''}</span><small>${r.registry_office?'Cartório: '+esc(r.registry_office)+' · ':''}${r.registry_number?'Matrícula '+esc(r.registry_number):'Matrícula não informada'}</small>${r.official_owner_name?`<div class="registry-owner-confirmed"><b>Titular registral:</b> ${esc(r.official_owner_name)}<small>Referência: ${esc(r.evidence_reference||'')}</small></div>`:''}</div>
    <div class="registry-row-actions"><a href="${RI_DIGITAL_URL}" target="_blank" rel="noopener noreferrer">RI Digital ↗</a>${mun?`<a href="${esc(mun)}" target="_blank" rel="noopener noreferrer">Apoio municipal ↗</a>`:''}${r.status!=='certificate_requested'&&r.status!=='confirmed'?`<button onclick="setRegistrySearchStatus('${esc(r.id)}','certificate_requested')">Marcar certidão solicitada</button>`:''}${r.status!=='confirmed'?`<button class="registry-confirm" onclick="confirmRegistryOwner('${esc(r.id)}')">Confirmar titular</button>`:''}</div>
  </article>`}).join('')}</div>`;
}
function renderOwners(){
 const q=(document.getElementById('ownerSearch')?.value||'').toLowerCase(),city=document.getElementById('ownerCity')?.value||'',hist=document.getElementById('ownerHistoryFilter')?.value||'';
 const rows=owners.filter(o=>(!q||(o.title+' '+o.city+' '+o.source).toLowerCase().includes(q))&&(!city||o.city===city)&&(!hist||(hist==='current'?o.is_current:!o.is_current)));
 const box=document.getElementById('ownersTable');
 if(!box)return;
 if(!rows.length){box.innerHTML='<div class="empty">Nenhum imóvel real encontrado.</div>';return}
 const tableRows=rows.map(o=>{
   const url=propertyUrl(o), st=o.is_current?ownerStatusMeta(o.status,o.quinto_status):{label:'Histórico preservado',cls:'status-history'};
   return `<tr class="${o.is_current?'':'owner-archived-row'}">
    <td><strong>${propertyMenuHtml(o)}</strong><br><span class="small">${ownerDisplayDate(o)}</span></td>
    <td>${esc(o.city)}</td><td>${esc(money(o.price))}</td>
    <td>${esc(o.beds)} dorm · ${esc(o.parking)} vagas · ${esc(o.area)} m²</td>
    <td>${sourceBadge(o.source,url)}</td>
    <td>${contactHtml(o)}</td>
    <td><span class="owner-status ${st.cls}">${esc(st.label)}</span></td>
    <td>${ownerHandlerControl(o)}</td>
    <td><div class="owner-actions">${url?`<a class="source-action" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Abrir anúncio ↗</a>`:`<span class="source-missing">Link não informado</span>`}<button class="owner-registry" type="button" onclick="openRegistryForProperty('${esc(o.id)}')" title="Pesquisar titular registral">Titularidade</button>${o.is_current?`<button class="owner-more" type="button" onclick="openPropertyMenu(event,'${esc(o.id)}')" title="Mais ações">⋯</button>`:''}</div></td>
   </tr>`;
 }).join('');
 const cards=rows.map(o=>{
   const url=propertyUrl(o), st=o.is_current?ownerStatusMeta(o.status,o.quinto_status):{label:'Histórico',cls:'status-history'};
   return `<article class="m-card ${o.is_current?'':'m-card-muted'}">
     <div class="m-card-top"><strong>${esc(o.title||'Imóvel')}</strong><span class="owner-status ${st.cls}">${esc(st.label)}</span></div>
     <div class="m-card-meta">${esc(o.city||'—')} · ${esc(o.beds||0)} dorm · ${esc(o.parking||0)} vagas · ${esc(o.area||0)} m²</div>
     <div class="m-card-price">${money(o.price)}</div>
     <div class="m-card-row">${sourceBadge(o.source,url)}</div>
     <div class="m-card-row">${contactHtml(o)}</div>
     <div class="m-card-row m-card-handler">${ownerHandlerControl(o)}</div>
     <div class="m-card-actions">
       ${url?`<a class="source-action" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Abrir ↗</a>`:''}
       <button class="owner-registry" type="button" onclick="openRegistryForProperty('${esc(o.id)}')">Titularidade</button>
       ${o.is_current?`<button class="owner-more" type="button" onclick="openPropertyMenu(event,'${esc(o.id)}')">⋯</button>`:''}
     </div>
   </article>`;
 }).join('');
 box.innerHTML=`<div class="desktop-table-wrap"><table class="owners-pro-table"><thead><tr><th>Imóvel</th><th>Cidade</th><th>Valor</th><th>Perfil</th><th>Origem</th><th>Contato</th><th>Situação</th><th>Tratado por</th><th>Ações</th></tr></thead><tbody>${tableRows}</tbody></table></div><div class="mobile-card-list">${cards}</div>`;
}
function renderBuyers(){
 const matchedBuyerIds=new Set(allMatches().map(m=>String(m.buyer?.id||m.buyer?.name||'')));
 const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=String(v)};
 set('bTotal',buyers.length);
 set('bWithContact',buyers.filter(b=>String(b.contact||'').trim()).length);
 set('bMatched',matchedBuyerIds.size);
 const box=document.getElementById('buyersTable');if(!box)return;
 if(!buyers.length){box.innerHTML='<div class="empty">Nenhuma demanda de comprador cadastrada.</div>';return}
 const tableRows=buyers.map(b=>`<tr><td><strong>${esc(b.name)}</strong><br><span class="small">${esc(b.contact||'')}</span></td><td>${esc(b.type)} · ${esc(b.city)}${b.neighborhood?' · '+esc(b.neighborhood):''} <span class="badge mid">${b.transaction_type==='rent'?'Locação':b.transaction_type==='both'?'Compra e locação':'Compra'}</span><br><span class="small">${esc(b.beds)}+ dorm · ${esc(b.parking)}+ vagas${Number(b.area_min||0)?' · '+esc(b.area_min)+'+ m²':''}</span></td><td>${esc(money(b.budget))}</td><td><span class="badge ${b.urgency===3?'hot':b.urgency===2?'good':'mid'}">${b.urgency===3?'Alta':b.urgency===2?'Média':'Baixa'}</span></td><td>${esc(b.source)}</td><td><button class="danger" onclick="deleteBuyer('${esc(b.id)}')">Excluir</button></td></tr>`).join('');
 const cards=buyers.map(b=>{
   const urg=b.urgency===3?'Alta':b.urgency===2?'Média':'Baixa';
   const urgCls=b.urgency===3?'hot':b.urgency===2?'good':'mid';
   const mode=b.transaction_type==='rent'?'Locação':b.transaction_type==='both'?'Compra e locação':'Compra';
   return `<article class="m-card">
     <div class="m-card-top"><strong>${esc(b.name||'Comprador')}</strong><span class="badge ${urgCls}">${urg}</span></div>
     <div class="m-card-meta">${esc(b.type||'')} · ${esc(b.city||'')}${b.neighborhood?' · '+esc(b.neighborhood):''}</div>
     <div class="m-card-price">${money(b.budget)}</div>
     <div class="m-card-specs"><span class="badge mid">${esc(mode)}</span> ${esc(b.beds||0)}+ dorm · ${esc(b.parking||0)}+ vagas${Number(b.area_min||0)?' · '+esc(b.area_min)+'+ m²':''}</div>
     <div class="m-card-row small">${esc(b.contact||'Sem contato')} · ${esc(b.source||'')}</div>
     <div class="m-card-actions"><button class="danger" type="button" onclick="deleteBuyer('${esc(b.id)}')">Excluir</button></div>
   </article>`;
 }).join('');
 box.innerHTML=`<div class="desktop-table-wrap"><table><thead><tr><th>Comprador</th><th>Demanda</th><th>Orçamento</th><th>Urgência</th><th>Origem</th><th></th></tr></thead><tbody>${tableRows}</tbody></table></div><div class="mobile-card-list">${cards}</div>`;
}
function buyersExportRows(){return buyers.map(b=>({'Comprador':b.name,'Cidade / região':b.city,'Bairro desejado':b.neighborhood||'','Tipo':b.type,'Modalidade':b.transaction_type==='rent'?'Locação':b.transaction_type==='both'?'Compra e locação':'Compra','Orçamento':Number(b.budget||0),'Quartos mín.':Number(b.beds||0),'Vagas mín.':Number(b.parking||0),'Área mín. m²':Number(b.area_min||0),'Urgência':b.urgency===3?'Alta':b.urgency===2?'Média':'Baixa','Origem':b.source||'','Contato':b.contact||'','WhatsApp':whatsappFrom(loosePhone(b.contact)||''),'Link origem':b.source_url||''}))}
function exportBuyersExcel(){const rows=buyersExportRows();if(!rows.length){toast('Nenhum comprador.');return}saveWorkbook(rows,`LJ-Radar-Imob-Compradores-${new Date().toISOString().slice(0,10)}.xlsx`)}
function exportBuyersPdf(){exportRowsPdf(buyersExportRows(),'LJ Radar Imob — Compradores',`LJ-Radar-Imob-Compradores-${new Date().toISOString().slice(0,10)}.pdf`)}

function matchOwnerFor(m){
  return owners.find(o=>String(o.id)===String(m.opportunity_id))
    || owners.find(o=>m.opportunity_source_url && propertyUrl(o)===m.opportunity_source_url)
    || owners.find(o=>String(o.title||'').trim().toLowerCase()===String(m.opportunity_title||'').trim().toLowerCase());
}
function matchPropertyCell(m,compact=false){
  const o=matchOwnerFor(m);
  const image=safeImageUrl(o?.image_url)||'';
  const title=m.opportunity_title||o?.title||'Imóvel';
  const city=m.opportunity_city||o?.city||'';
  const price=m.opportunity_price||o?.price||0;
  const beds=Number(m.opportunity_bedrooms||o?.beds||0);
  const parking=Number(m.opportunity_parking||o?.parking||0);
  const qa=m.quinto_status||o?.quinto_status||'';
  return `<div class="match-property-card ${compact?'compact':''}">
    <div class="match-property-image">${image?`<img src="${esc(image)}" alt="${esc(title)}" loading="lazy" onerror="this.style.display='none';this.parentElement.classList.add('image-missing')">`:'<span>Sem foto</span>'}</div>
    <div><strong>${esc(title)}</strong><span>${esc(city)}${price?' · '+money(price):''}${beds?' · '+beds+' dorm.':''}${parking?' · '+parking+' vagas':''}${compact&&qa?' · QA: '+esc(qa):''}</span></div>
  </div>`;
}

function effectiveMatchScores(){
  const remoteScores=groupIntentMatches(matchFilteredRows(false)).map(g=>Number(g.best||0));
  const manualScores=groupLocalMatches(filteredLocalMatches(false)).map(g=>Number(g.best||0));
  return [...remoteScores,...manualScores];
}
async function refreshMatchEngine(){
  const btn=document.getElementById('matchRefreshBtn');
  try{
    if(btn){btn.disabled=true;btn.textContent='Atualizando...';}
    if(window.LJI_BACKEND?.client){
      await Promise.allSettled([
        window.LJI_BACKEND?.sync?.(),
        syncIntentions()
      ]);
      renderMatches();
      const remoteCount=groupIntentMatches(matchFilteredRows(false)).length;
      const manualCount=groupLocalMatches(filteredLocalMatches(false)).length;
      toast(`${remoteCount} intenção(ões) pública(s) + ${manualCount} demanda(s) cadastrada(s) com match.`);
    }else{
      renderMatches();
      toast('Sem sessão do Supabase. Exibindo somente o que já está carregado.');
    }
  }catch(e){
    console.error(e);
    renderMatches();
    toast('Atualização parcial: os matches já carregados foram preservados.');
  }finally{
    if(btn){btn.disabled=false;btn.textContent='Atualizar matches';}
  }
}
function matchPersonKey(m){
  const src=String(m.intent_source_url||'').trim().toLowerCase();
  const name=String(m.person_name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  const tx=String(m.transaction_type||'');
  if(src)return `${src}|${name}|${tx}`;
  return name?`${name}|${tx}`:String(m.intent_id||'');
}

function matchDateLabel(v,fallback=''){
  const raw=v||fallback||'';
  if(!raw)return 'Data não informada';
  const d=new Date(raw);
  if(Number.isNaN(d.getTime()))return 'Data não informada';
  return d.toLocaleDateString('pt-BR');
}
function matchSourceName(v){
  const s=String(v||'').trim();
  if(!s)return 'Web pública';
  return s.replace(/^www\./,'');
}
function matchFilteredRows(applySource=true){
  const source=applySource?(document.getElementById('matchSourceFilter')?.value||''):'';
  const rows=Array.isArray(intentMatchesRemote)?intentMatchesRemote:[];
  return rows.filter(m=>{
    const sourceOk=!source||matchSourceName(m.opportunity_source)===source||matchSourceName(m.intent_source_name)===source;
    const opportunityRef=m.opportunity_published_at||m.opportunity_created_at||'';
    const intentRef=m.intent_published_at||m.intent_captured_at||'';
    const opportunityOk=dateWithinDays(opportunityRef,MATCH_MAX_DAYS,true);
    const intentOk=dateWithinDays(intentRef,MATCH_MAX_DAYS,true);
    return sourceOk&&opportunityOk&&intentOk;
  });
}
function refreshMatchSourceFilter(){
  const el=document.getElementById('matchSourceFilter'); if(!el)return;
  const current=el.value;
  const remoteNames=(Array.isArray(intentMatchesRemote)?intentMatchesRemote:[]).flatMap(m=>[matchSourceName(m.intent_source_name),matchSourceName(m.opportunity_source)]);
  const localNames=allMatches().map(m=>matchSourceName(m.owner?.source));
  const names=[...new Set([...remoteNames,...localNames].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  el.innerHTML='<option value="">Todas as fontes</option>'+names.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');
  if(names.includes(current))el.value=current;
}

function groupIntentMatches(rows=Array.isArray(intentMatchesRemote)?intentMatchesRemote:[]){
  const map=new Map();
  rows.forEach(m=>{
    const key=matchPersonKey(m);
    if(!key)return;
    if(!map.has(key))map.set(key,{key,base:m,items:[],seen:new Set(),regions:new Set(),intentIds:new Set()});
    const g=map.get(key);
    if(m.region)g.regions.add(String(m.region));
    if(m.intent_id)g.intentIds.add(String(m.intent_id));
    const pkey=String(m.opportunity_id||m.opportunity_source_url||m.opportunity_title||'');
    if(pkey&&!g.seen.has(pkey)){g.seen.add(pkey);g.items.push(m)}
    if(Number(m.match_score||0)>Number(g.base.match_score||0))g.base=m;
  });
  return [...map.values()].map(g=>{
    g.items.sort((a,b)=>Number(b.match_score||0)-Number(a.match_score||0));
    g.best=Number(g.items[0]?.match_score||0);
    g.regionList=[...g.regions];
    return g;
  }).sort((a,b)=>b.best-a.best||String(a.base.person_name||'').localeCompare(String(b.base.person_name||'')));
}
function matchIntentRecord(m){return buyerIntentions.find(i=>String(i.id||'')===String(m.intent_id||''))||buyerIntentions.find(i=>i.source_url&&m.intent_source_url&&i.source_url===m.intent_source_url)||null}
function matchContact(m){const i=matchIntentRecord(m);return i?intentPublicContact(i):null}
function matchFitLabel(m){const fit=String(m.budget_fit||'');return fit==='within_budget'?'Dentro do orçamento':fit==='stretch_8pct'?'Até 8% acima':'Orçamento não informado'}
function groupedMatchesHtml(groups,compact=false){
  return `<div class="match-groups ${compact?'match-compact':''}">${groups.map(g=>{
    const m=g.base,c=matchContact(m),budget=m.budget_max?money(m.budget_max):'Não informado',
      regions=(g.regionList||[m.region]).filter(Boolean).join(' · '),
      intentSource=matchSourceName(m.intent_source_name),
      intentDate=m.intent_published_at?matchDateLabel(m.intent_published_at):'data não informada';
    return `<article class="match-group">
    <div class="match-group-head">
      <div class="match-person"><div class="match-person-avatar">${esc((m.person_name||'?').trim().charAt(0).toUpperCase())}</div><div><strong>${esc(m.person_name||'Interessado')} <span class="match-count">${g.items.length} imóvel${g.items.length===1?'':'is'}</span></strong><span>${esc(regions||'Região não informada')}</span><span class="match-origin-line"><b>${esc(intentSource)}</b> · ${esc(intentDate)}</span></div></div>
      <div class="match-demand"><strong>${esc(m.transaction_type==='rent'?'Alugar':'Comprar')} ${esc(m.desired_property_type||'Imóvel')}</strong><span>Até ${esc(budget)}${Number(m.bedrooms_min||0)?' · '+m.bedrooms_min+'+ dorm.':''}${Number(m.parking_min||0)?' · '+m.parking_min+'+ vagas':''}${Number(m.area_min||0)?' · '+m.area_min+'+ m²':''}</span></div>
      <div class="match-group-actions">${c?.whatsapp?`<a class="wa-ready" href="${esc(c.whatsapp)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>`:''}${safeHttpUrl(m.intent_source_url)?`<a href="${esc(safeHttpUrl(m.intent_source_url))}" target="_blank" rel="noopener noreferrer">Ver intenção ↗</a>`:''}</div>
    </div>
    <div class="match-property-list">${g.items.map(x=>{
      const src=matchSourceName(x.opportunity_source), dt=x.opportunity_published_at?matchDateLabel(x.opportunity_published_at):'data não informada';
      return `<div class="match-property-row">
      <span class="match-score ${Number(x.match_score)>=85?'match-hot':Number(x.match_score)>=70?'match-high':'match-mid'}">${Number(x.match_score)>=85?'🔥 ':''}${Number(x.match_score)}%</span>
      <div class="match-property-info">${matchPropertyCell(x,true)}<span class="match-origin-line"><b>${esc(src)}</b> · ${esc(dt)}</span></div>
      <div class="match-price"><strong>${esc(x.opportunity_price?money(x.opportunity_price):'—')}</strong><span>${esc(matchFitLabel(x))}</span></div>
      <div class="match-source-actions">${safeHttpUrl(x.opportunity_source_url)?`<a href="${esc(safeHttpUrl(x.opportunity_source_url))}" target="_blank" rel="noopener noreferrer">Ver imóvel ↗</a>`:'<span>Sem link</span>'}</div>
    </div>`}).join('')}</div>
  </article>`}).join('')}</div>`;
}
function matchExportRows(){
 const remoteRows=groupIntentMatches(matchFilteredRows()).map(g=>{const m=g.base,c=matchContact(m);return {
  'Origem do match':'Intenção pública',
  'Interessado':m.person_name||'Interessado',
  'Região':(g.regionList||[m.region]).filter(Boolean).join(' | '),
  'Procura':`${m.transaction_type==='rent'?'Alugar':'Comprar'} ${m.desired_property_type||'Imóvel'}`,
  'Orçamento':Number(m.budget_max||0),
  'Fonte da intenção':matchSourceName(m.intent_source_name),
  'Data da intenção':m.intent_published_at?matchDateLabel(m.intent_published_at):'data não informada',
  'Melhor score':g.best,
  'Imóveis compatíveis':g.items.length,
  'Lista de imóveis':g.items.map(x=>`${x.opportunity_title||'Imóvel'} (${x.opportunity_price?money(x.opportunity_price):'—'} · ${x.match_score}% · ${matchSourceName(x.opportunity_source)} · ${(x.opportunity_published_at?matchDateLabel(x.opportunity_published_at):'data não informada')})`).join(' | '),
  'WhatsApp':c?.whatsapp||'',
  'Link intenção':m.intent_source_url||'',
  'Links imóveis':g.items.map(x=>x.opportunity_source_url||'').filter(Boolean).join(' | ')
 }});
 const manualRows=groupLocalMatches().map(g=>{const b=g.buyer,d=loosePhone(b.contact||'');return {
  'Origem do match':'Demanda cadastrada',
  'Interessado':b.name||'Comprador',
  'Região':[b.neighborhood,b.city].filter(Boolean).join(' · '),
  'Procura':`${matchTransaction(b.transaction_type)==='rent'?'Alugar':matchTransaction(b.transaction_type)==='both'?'Comprar ou alugar':'Comprar'} ${b.type||'Imóvel'}`,
  'Orçamento':Number(b.budget||0),
  'Fonte da intenção':b.source||'Cadastro manual',
  'Data da intenção':b.published_at?matchDateLabel(b.published_at):'data não informada',
  'Melhor score':g.best,
  'Imóveis compatíveis':g.items.length,
  'Lista de imóveis':g.items.map(x=>`${x.owner?.title||'Imóvel'} (${x.owner?.price?money(x.owner.price):'—'} · ${x.score}% · ${matchSourceName(x.owner?.source)})`).join(' | '),
  'WhatsApp':whatsappFrom(d)||'',
  'Link intenção':b.source_url||'',
  'Links imóveis':g.items.map(x=>propertyUrl(x.owner)||'').filter(Boolean).join(' | ')
 }});
 return [...remoteRows,...manualRows];
}
function exportMatchesExcel(){const rows=matchExportRows();if(!rows.length){toast('Nenhum match real para exportar.');return}saveWorkbook(rows,`LJ-Radar-Imob-Matches-${new Date().toISOString().slice(0,10)}.xlsx`)}
function exportMatchesPdf(){exportRowsPdf(matchExportRows(),'LJ Radar Imob — Matches agrupados',`LJ-Radar-Imob-Matches-${new Date().toISOString().slice(0,10)}.pdf`)}
function localMatchesHtml(groups){
 return `<div class="match-groups">${groups.map(g=>{
   const b=g.buyer,d=loosePhone(b.contact||''),wa=whatsappFrom(d),tx=matchTransaction(b.transaction_type);
   return `<article class="match-group">
    <div class="match-group-head">
      <div class="match-person"><div class="match-person-avatar">${esc((b.name||'?').charAt(0).toUpperCase())}</div><div><strong>${esc(b.name||'Comprador')} <span class="match-count">${g.items.length} imóvel${g.items.length===1?'':'is'}</span></strong><span>${esc([b.neighborhood,b.city].filter(Boolean).join(' · ')||'Região não informada')}</span><span class="match-origin-line"><b>Demanda cadastrada</b> · ${esc(b.source||'Cadastro manual')}</span></div></div>
      <div class="match-demand"><strong>${esc(tx==='rent'?'Alugar':tx==='both'?'Comprar ou alugar':'Comprar')} ${esc(b.type||'Imóvel')}</strong><span>Até ${esc(money(b.budget))}${Number(b.beds||0)?' · '+b.beds+'+ dorm.':''}${Number(b.parking||0)?' · '+b.parking+'+ vagas':''}${Number(b.area_min||0)?' · '+b.area_min+'+ m²':''}</span></div>
      <div class="match-group-actions">${wa?`<a class="wa-ready" href="${esc(wa)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>`:''}${safeHttpUrl(b.source_url)?`<a href="${esc(safeHttpUrl(b.source_url))}" target="_blank" rel="noopener noreferrer">Ver origem ↗</a>`:''}</div>
    </div>
    <div class="match-property-list">${g.items.map(m=>`<div class="match-property-row">
      <span class="match-score ${m.score>=85?'match-hot':m.score>=70?'match-high':'match-mid'}">${m.score>=85?'🔥 ':''}${m.score}%</span>
      <div class="match-property-info"><strong>${propertyMenuHtml(m.owner)}</strong><span>${esc([m.owner.neighborhood,m.owner.city].filter(Boolean).join(' · '))} · ${esc(m.owner.beds||0)} dorm · ${esc(m.owner.parking||0)} vagas</span><span class="match-origin-line"><b>${esc(matchSourceName(m.owner.source))}</b> · ${esc(ownerDisplayDate(m.owner))}</span></div>
      <div class="match-price"><strong>${esc(money(m.owner.price))}</strong></div>
      <div class="match-fit"></div>
      ${propertyUrl(m.owner)?`<a href="${esc(propertyUrl(m.owner))}" target="_blank" rel="noopener noreferrer">Abrir imóvel ↗</a>`:''}
    </div>`).join('')}</div>
   </article>`;
 }).join('')}</div>`;
}
function renderMatches(){
 refreshMatchSourceFilter();
 const remoteGroups=groupIntentMatches(matchFilteredRows());
 const localGroups=groupLocalMatches();
 const scores=[...remoteGroups.map(g=>Number(g.best||0)),...localGroups.map(g=>Number(g.best||0))];
 const total=scores.length,hot=scores.filter(s=>s>=85).length,high=scores.filter(s=>s>=70&&s<85).length,mid=scores.filter(s=>s>=60&&s<70).length;
 const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v};set('mtotal',total);set('mhot',hot);set('mhigh',high);set('mmid',mid);
 const box=document.getElementById('matchesTable');if(!box)return;

 const sections=[];
 if(remoteGroups.length){
   sections.push(`<div class="match-real-head"><div><strong>${remoteGroups.length} intenção(ões) pública(s) com matches</strong><span>Match calculado no Supabase. Data de publicação ausente não elimina o registro; usamos a data de captura/criação para a janela operacional de ${MATCH_MAX_DAYS} dias.</span></div><span class="match-live-dot"><i></i> Supabase</span></div>${groupedMatchesHtml(remoteGroups)}`);
 }
 if(localGroups.length){
   sections.push(`<div class="match-real-head match-manual-head"><div><strong>${localGroups.length} demanda(s) cadastrada(s) com matches</strong><span>Compradores cadastrados no LJ Radar também participam do Match Engine. Score normalizado por modalidade, cidade, bairro, tipo, orçamento e requisitos.</span></div><span class="match-live-dot"><i></i> LJ Radar</span></div>${localMatchesHtml(localGroups)}`);
 }
 if(sections.length){
   box.innerHTML=sections.join('');
   return;
 }
 box.innerHTML='<div class="empty">Nenhum match compatível encontrado com os dados atuais. O Match Engine está sincronizado; cadastre/atualize compradores ou aguarde novas oportunidades reais.</div>';
}
let dashTransaction='';
function setDashTx(btn,tx){
  dashTransaction=tx;
  document.querySelectorAll('[data-dashtx]').forEach(x=>x.classList.toggle('active',x===btn));
  renderDashboard();
}
function dashDate(o){
  const raw=o.published_at||o.activity_date||o.last_seen_at||o.first_seen_at||o.created_at||o.captured_at||'';
  const d=new Date(raw); return Number.isNaN(d.getTime())?null:d;
}
function dashRegionName(city){
  return String(city||'').trim();
}
function dashboardOpportunityRank(o){
  const c=ownerContact(o);
  const d=dashDate(o);
  const ageHours=d?Math.max(0,(Date.now()-d.getTime())/36e5):999;
  let score=0;
  if(o?.is_current)score+=32;
  if(propertyImageCandidates(o).length)score+=18;
  if(isDashboardCoreRegion(o?.city))score+=14;
  if(c.wa)score+=18;else if(c.phone)score+=10;
  if(!o?.handled_by_user_id)score+=8;
  if(String(o?.quinto_status||'')==='no_public_match_found')score+=4;
  if(Number(o?.price||0)>0)score+=4;
  score+=Math.max(0,8-Math.min(8,Math.round(ageHours/6)));
  return Math.max(0,Math.min(100,score));
}
function isDashboardCoreRegion(city){
  const n=normalizePlain(city||'');
  return n.includes('santo andre')||n.includes('sao bernardo')||n.includes('sao caetano')||n.includes('diadema')||n==='sao paulo'||n.includes('sao paulo ');
}
function dashboardLooksProfessional(o){
  const text=normalizePlain([o?.title,o?.contact_name,o?.source].filter(Boolean).join(' '));
  if(/(imobiliaria|negocios imobiliarios|corretor|corretora|creci|remax|re max)/.test(text))return true;
  // Portais/agregadores de imobiliárias — o texto do anúncio raramente denuncia isso (o "Cód.: 1225"
  // é típico de agência, não de dono direto), então travamos direto pelo domínio de origem.
  const url=String(propertyUrl(o)||'').toLowerCase();
  if(/rentola\.com|waa2\.com|achoumudou\.com|mgfimoveis\.com/.test(url))return true;
  if(/\bcod\s*\d{2,6}\b/.test(normalizePlain(o?.title||'')))return true;
  return false;
}
function dashboardLooksGenericPage(o){
  const title=normalizePlain(o?.title||'');
  const url=String(propertyUrl(o)||'').toLowerCase();
  if(/(anuncio gratis de imoveis|aluguel de apto direto com o proprietario a aluguel|aluguel de casa direto com proprietario a aluguel)/.test(title))return true;
  if(/\/alugar\/(?:casa|apartamento)?\/?$/.test(url))return true;
  // "Classificados <cidade>" no título é página de grupo/agregador postando vários imóveis de
  // terceiros, não um único proprietário — mesmo sinal que o Rentola, só que via Facebook.
  if(/^classificados\b/.test(title))return true;
  return false;
}
function dashboardTopEligible(o){
  return Boolean(o?.is_current)&&o?.status!=='rejected'&&isDashboardCoreRegion(o?.city)&&!dashboardLooksProfessional(o)&&!dashboardLooksGenericPage(o);
}
function dashTopTodayRows(){
  const all=(Array.isArray(owners)?owners:[]);
  const current=all.filter(o=>o?.is_current);
  let source=current.filter(dashboardTopEligible);

  // Se a limpeza rígida deixar menos de 3, completa somente com imóveis
  // atuais da área principal, ainda excluindo profissional explícito.
  if(source.length<3){
    const supplement=current.filter(o=>o?.status!=='rejected'&&isDashboardCoreRegion(o?.city)&&!dashboardLooksProfessional(o)&&!source.includes(o));
    source=[...source,...supplement];
  }

  return source
    .slice()
    .sort((a,b)=>{
      const imageDiff=Number(propertyImageCandidates(b).length>0)-Number(propertyImageCandidates(a).length>0);
      if(imageDiff)return imageDiff;
      const scoreDiff=dashboardOpportunityRank(b)-dashboardOpportunityRank(a);
      if(scoreDiff)return scoreDiff;
      return (dashDate(b)?.getTime()||0)-(dashDate(a)?.getTime()||0);
    })
    .slice(0,3);
}
function propertyImageCandidates(o){
  const out=[];const push=v=>{const s=safeImageUrl(v);if(s&&!out.includes(s))out.push(s)};
  push(o?.image_url);
  [o?.image_urls,o?.images,o?.photos].forEach(arr=>{if(Array.isArray(arr))arr.forEach(x=>push(typeof x==='string'?x:(x?.url||x?.src||x?.image_url)))});
  return out.slice(0,8);
}
function dashboardGlobalSearch(){
  const q=String(document.getElementById('dashGlobalSearch')?.value||'').trim();if(!q)return;
  go('owners');const input=document.getElementById('ownerSearch');if(input){input.value=q;renderOwners()}
}
window.dashboardGlobalSearch=dashboardGlobalSearch;
function startDashTopCarousel(){
  if(window.LJI_DASH_TOP_CAROUSEL)clearInterval(window.LJI_DASH_TOP_CAROUSEL);
  window.LJI_DASH_TOP_CAROUSEL=setInterval(()=>{
    document.querySelectorAll('.dash-top-media[data-images-count]').forEach(media=>{
      const count=Number(media.dataset.imagesCount||0);if(count<2)return;
      const card=Number(media.dataset.card||0),set=window.LJI_DASH_TOP_IMAGESETS?.[card]||[];if(set.length<2)return;
      const img=media.querySelector('img');if(!img)return;
      const next=(Number(media.dataset.imageIndex||0)+1)%set.length;media.dataset.imageIndex=String(next);img.src=set[next];
      media.querySelectorAll('.dash-image-dot').forEach((d,i)=>d.classList.toggle('active',i===next));
    });
  },4800);
}
function renderDashTop3(rows){
  const box=document.getElementById('dashTop3'); if(!box)return;
  let safeRows=Array.isArray(rows)?rows.filter(Boolean):[];
  if(!safeRows.length){
    safeRows=(Array.isArray(owners)?owners:[])
      .filter(dashboardTopEligible)
      .sort((a,b)=>(dashDate(b)?.getTime()||0)-(dashDate(a)?.getTime()||0))
      .slice(0,3);
  }
  if(!safeRows.length){box.innerHTML='<div class="empty">Nenhuma oportunidade atual disponível na base.</div>';return}
  rows=safeRows;
  window.LJI_DASH_TOP_IMAGESETS={};
  box.innerHTML=rows.map((o,idx)=>{
    const url=propertyUrl(o),c=ownerContact(o),tx=String(o.transaction_type||'sale').toLowerCase()==='rent'?'LOCAÇÃO':'VENDA',score=dashboardOpportunityRank(o);
    const images=propertyImageCandidates(o);window.LJI_DASH_TOP_IMAGESETS[idx]=images;
    const media=images.length?`<div class="dash-top-media has-real-image" data-card="${idx}" data-images-count="${images.length}" data-image-index="0"><div class="dash-top-image-placeholder">Imagem do imóvel</div><img src="${esc(images[0])}" alt="${esc(o.title||'Imóvel')}" loading="lazy" onerror="this.style.display='none';this.parentElement.classList.remove('has-real-image')"><span class="dash-top-number">0${idx+1}</span>${images.length>1?`<div class="dash-image-dots">${images.map((_,i)=>`<i class="dash-image-dot ${i===0?'active':''}"></i>`).join('')}</div>`:''}</div>`:`<div class="dash-top-media" data-card="${idx}" data-images-count="0"><div class="dash-top-image-placeholder"><span>⌂</span><b>Imagem não disponível na fonte</b></div><span class="dash-top-number">0${idx+1}</span></div>`;
    return `<article class="dash-top-card-modern rank-${idx+1}">${media}<div class="dash-top-content">
      <div class="dash-top-title-row"><h3>${propertyMenuHtml(o)}</h3><div class="dash-score-ring" style="--score:${score}"><strong>${score}</strong><small>score</small></div></div>
      <div class="dash-top-location">⌖ ${esc(o.neighborhood?o.neighborhood+', ':'')}${esc(o.city||'')}</div>
      <div class="dash-top-specs">${Number(o.area||0)?`<span>▣ ${esc(o.area)} m²</span>`:''}${Number(o.beds||0)?`<span>▤ ${esc(o.beds)} dorm.</span>`:''}${Number(o.parking||0)?`<span>▥ ${esc(o.parking)} vagas</span>`:''}</div>
      <div class="dash-top-price">${money(o.price||0)}</div>
      <div class="dash-top-source"><span>${esc(o.source||'Fonte pública')}</span><b>${esc(tx)}</b></div>
      <div class="dash-top-actions-modern">${url?`<a class="details" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Ver detalhes</a>`:'<button class="details" type="button" disabled>Sem link</button>'}${c.wa?`<a class="contact" href="${esc(c.wa)}" target="_blank" rel="noopener noreferrer">◉ Contatar</a>`:c.phone?`<a class="contact" href="tel:+55${esc(c.phone)}">☎ Ligar</a>`:`<button class="contact muted" type="button" onclick="go('contact-check')">Verificar contato</button>`}</div>
    </div></article>`;
  }).join('');
  startDashTopCarousel();
}
function renderDashboardHighlights(){
  const box=document.getElementById('dashboardOpsHighlights');if(!box)return;
  const current=(Array.isArray(owners)?owners:[]).filter(o=>o?.is_current);
  const todayStart=new Date();todayStart.setHours(0,0,0,0);
  const tomorrow=new Date(todayStart);tomorrow.setDate(tomorrow.getDate()+1);
  const newToday=(Array.isArray(owners)?owners:[]).filter(o=>{
    const d=new Date(o?.first_seen_at||o?.created_at||o?.captured_at||'');
    return !Number.isNaN(d.getTime())&&d>=todayStart&&d<tomorrow;
  }).length;
  const withWa=current.filter(o=>ownerContact(o).wa).length;
  const withPhone=current.filter(o=>ownerContact(o).phone).length;
  const unassigned=current.filter(o=>!o?.handled_by_user_id).length;
  const top=dashTopTodayRows()[0];
  box.innerHTML=`<div class="dash-summary-metric"><span>Novos hoje</span><strong>${newToday}</strong></div><div class="dash-summary-metric"><span>WhatsApp pronto</span><strong>${withWa}</strong></div><div class="dash-summary-metric"><span>Sem responsável</span><strong>${unassigned}</strong></div><div class="dash-summary-line"><b>Contato disponível</b><span>${withPhone} oportunidade(s) atuais</span></div><div class="dash-summary-line"><b>Prioridade nº 1</b><span>${esc(top?.title||'Sem prioridade no momento')}</span></div>`;
}
function renderDashboardHotLeads(){
  const box=document.getElementById('dashboardHotLeads');if(!box)return;
  const hot=(Array.isArray(owners)?owners:[])
    .filter(o=>o?.is_current&&o?.status!=='rejected'&&ownerContact(o).phone&&!dashboardLooksProfessional(o))
    .sort((a,b)=>dashboardOpportunityRank(b)-dashboardOpportunityRank(a))
    .slice(0,5);
  box.innerHTML=hot.length?hot.map(o=>{const c=ownerContact(o);const initials=String(o.contact_name||o.title||'IM').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();return `<div class="dash-hot-row"><div class="dash-hot-avatar">${esc(initials)}</div><div><strong>${esc(o.contact_name||o.title||'Oportunidade')}</strong><span>${esc(o.city||'')} · ${esc(o.type||'Imóvel')}</span></div>${c.wa?`<a href="${esc(c.wa)}" target="_blank" rel="noopener noreferrer">◉</a>`:`<a href="tel:+55${esc(c.phone)}">☎</a>`}</div>`}).join(''):'<div class="empty">Nenhum lead atual com telefone confiável disponível.</div>';
}
function dashboardFilteredRows(){
  const region=document.getElementById('dashRegion')?.value||'',sort=document.getElementById('dashSort')?.value||'recent';
  let rows=owners.filter(o=>{const tx=String(o.transaction_type||o.transaction||'').toLowerCase();return o?.is_current&&o?.status!=='rejected'&&!dashboardLooksProfessional(o)&&(!dashTransaction||tx===dashTransaction||(!tx&&dashTransaction==='sale'))&&(!region||dashRegionName(o.city)===region)});
  if(sort==='price_desc')rows.sort((a,b)=>Number(b.price||0)-Number(a.price||0));else if(sort==='price_asc')rows.sort((a,b)=>Number(a.price||0)-Number(b.price||0));else rows.sort((a,b)=>(dashDate(b)?.getTime()||0)-(dashDate(a)?.getTime()||0));return rows;
}
function exportDashboardExcel(){const rows=dashboardFilteredRows();if(!rows.length){toast('Nenhuma oportunidade neste filtro.');return}saveWorkbook(ownerRowsForExcel(rows),`LJ-Radar-Imob-Dashboard-${new Date().toISOString().slice(0,10)}.xlsx`)}
function exportDashboardPdf(){exportRowsPdf(ownerRowsForExcel(dashboardFilteredRows()),'LJ Radar Imob — Oportunidades do Dashboard',`LJ-Radar-Imob-Dashboard-${new Date().toISOString().slice(0,10)}.pdf`)}
function renderDashboard(){
  const ms=effectiveMatchScores().map(score=>({score}));
  const now=new Date();
  const currentOwners=owners.filter(o=>o.is_current);
  const todayStart=new Date(now);todayStart.setHours(0,0,0,0);
  const tomorrowStart=new Date(todayStart);tomorrowStart.setDate(tomorrowStart.getDate()+1);
  const last7=currentOwners.filter(o=>{
    const raw=o.first_seen_at||o.created_at||o.captured_at||'';
    const d=new Date(raw);
    return !Number.isNaN(d.getTime()) && d>=todayStart && d<tomorrowStart;
  }).length;
  const priority=ms.filter(x=>Number(x.score||0)>=85).length;
  const unassigned=currentOwners.filter(o=>!o.handled_by_user_id).length;
  const avg=ms.length?Math.round(ms.reduce((s,m)=>s+Number(m.score||0),0)/ms.length):0;

  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v};
  set('mOwners',currentOwners.length);set('mNew7',last7);set('mPriority',priority);set('mUnassigned',unassigned);set('mAvgScore',avg);set('mOwnersMeta',`${owners.length} no histórico total · atuais em destaque`);
  set('mMatches',ms.length);set('mHot',ms.filter(x=>x.score>=85).length);set('mIntentions',(window.buyerIntentions||buyerIntentions||[]).length);

  const rows=dashboardFilteredRows();
  let topTodayRows=[];
  try{
    topTodayRows=dashTopTodayRows();
  }catch(e){
    console.error('Falha no ranking do Top 3:',e);
    topTodayRows=currentOwners.filter(dashboardTopEligible).slice().sort((a,b)=>(dashDate(b)?.getTime()||0)-(dashDate(a)?.getTime()||0)).slice(0,3);
  }
  const nowHour=new Date().getHours(),greet=nowHour<12?'Bom dia':nowHour<18?'Boa tarde':'Boa noite';
  set('dashGreetingText',greet);set('dashTodayDate',new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'}));

  set('dashCountLabel',`${rows.length} oportunidade${rows.length===1?'':'s'}`);
  try{renderDashTop3(topTodayRows)}catch(e){console.error('Top 3 dashboard',e)}
  try{renderDashboardHighlights()}catch(e){console.error('Resumo dashboard',e)}
  try{renderDashboardHotLeads()}catch(e){console.error('Hot leads dashboard',e)}
  window.LJI_DASHBOARD_DIAGNOSTIC={
    history:owners.length,
    current:currentOwners.length,
    top3:topTodayRows.length,
    currentWithImage:currentOwners.filter(o=>propertyImageCandidates(o).length).length,
    currentWithPhone:currentOwners.filter(o=>ownerContact(o).phone).length,
    syncedAt:new Date().toISOString()
  };

  const list=document.getElementById('dashOwners');
  if(list) list.innerHTML=rows.slice(0,5).map(o=>{
    const url=propertyUrl(o);
    const c=ownerContact(o);
    const wa=c.wa;
    const tx=String(o.transaction_type||'sale').toLowerCase()==='rent'?'LOCAÇÃO':'VENDA';
    return `<div class="dash-owner-card">
      <div class="dash-owner-thumb ${safeImageUrl(o.image_url)?'has-image':''}">
        ${safeImageUrl(o.image_url)?`<img src="${esc(safeImageUrl(o.image_url))}" alt="${esc(o.title||'Imóvel')}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove();this.parentElement.classList.remove('has-image');this.parentElement.textContent='${esc(tx)}'">`:`${esc(tx)}`}
        <span class="dash-owner-tx">${esc(tx)}</span>
      </div>
      <div>
        <div class="dash-owner-title">${propertyMenuHtml(o)}</div>
        <div class="dash-owner-meta">${esc(o.city||'')} · ${esc(o.type||'Imóvel')} · ${Number(o.area||0)?esc(o.area)+' m² · ':''}${Number(o.beds||0)?esc(o.beds)+' dorm. · ':''}${Number(o.parking||0)?esc(o.parking)+' vagas':''}</div>
        <div class="dash-owner-tags">
          <span class="direct">${esc(o.is_current?ownerStatusMeta(o.status,o.quinto_status).label:'Histórico')}</span>
          <span class="source">${esc(o.source||'Fonte pública')}</span>
        </div>
      </div>
      <div class="dash-owner-actions">
        <div class="dash-owner-price">${money(o.price||0)}</div>
        ${wa?`<a href="${esc(wa)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>`:''}
        ${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Abrir link ↗</a>`:''}
      </div>
    </div>`;
  }).join('')||'<div class="empty">Nenhuma oportunidade real com estes filtros.</div>';

  const intentions=(window.buyerIntentions||buyerIntentions||[]);
  const activities=[];
  rows.slice(0,3).forEach(o=>activities.push({icon:'⌂',title:'Imóvel sincronizado',text:o.title||'Imóvel',date:dashDate(o)}));
  intentions.slice(0,2).forEach(i=>activities.push({icon:'◎',title:'Intenção captada',text:i.person_name||i.title||'Interessado',date:new Date(i.captured_at||i.published_at||'')}));
  activities.sort((a,b)=>(b.date?.getTime()||0)-(a.date?.getTime()||0));
  const act=document.getElementById('dashActivities');
  if(act) act.innerHTML=activities.slice(0,5).map(a=>`<div class="dash-activity"><div class="dash-activity-icon">${a.icon}</div><div><strong>${esc(a.title)}</strong><span>${esc(a.text)}</span></div><time>${a.date&&!Number.isNaN(a.date.getTime())?a.date.toLocaleDateString('pt-BR'):'—'}</time></div>`).join('')||'<div class="empty">Nenhuma atividade real registrada.</div>';

  const counts={};
  currentOwners.forEach(o=>{const r=dashRegionName(o.city)||'Não informado';counts[r]=(counts[r]||0)+1});
  const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,5), max=Math.max(1,...top.map(x=>x[1]));
  const reg=document.getElementById('dashRegions');
  if(reg) reg.innerHTML=top.map(([r,n])=>`<div class="dash-region"><label>${esc(r)}</label><div class="dash-region-track"><i style="width:${Math.round(n/max*100)}%"></i></div><span>${n}</span></div>`).join('')||'<div class="empty">Sem distribuição disponível.</div>';

  setTimeout(()=>window.LJI_renderRealOpportunityChart?.(),0);
}
// ========================
// LJ INTELLIGENCE — MÓDULOS COMERCIAIS
// ========================
let tradeIntents=[];
let companyDemands=[];

function saveTradeIntents(){}
function saveCompanyDemands(){}

function populateTradeOwners(){
  const el=document.getElementById('tOwner'); if(!el)return;
  const current=el.value;
  el.innerHTML=owners.map(o=>`<option value="${esc(o.id)}">${esc(o.title)} — ${esc(o.city)} — ${esc(money(o.price))}</option>`).join('');
  if(current) el.value=current;
}
async function addTradeIntent(){
  const client=window.LJI_BACKEND?.client,cfg=window.LJI_CONFIG||{};
  const owner_id=String(document.getElementById('tOwner')?.value||'');
  const budget_max=Number(document.getElementById('tBudget')?.value||0);
  if(!owner_id||!budget_max){toast('Selecione o imóvel e informe o valor máximo.');return}
  if(!client){toast('Supabase indisponível.');return}
  const payload={workspace_id:cfg.WORKSPACE_ID,owner_id:owner_id,desired_city:document.getElementById('tCity').value,desired_neighborhood:document.getElementById('tNeighborhood')?.value.trim()||null,desired_type:document.getElementById('tType').value,budget_max,beds_min:Number(document.getElementById('tBeds').value||0),parking_min:Number(document.getElementById('tParking').value||0),notes:document.getElementById('tNotes').value.trim(),status:'active'};
  const {error}=await client.from('lji_trade_intents').insert(payload);
  if(error){console.error(error);toast('Falha ao salvar permuta.');return}
  toast('Interesse salvo no Supabase.');await window.LJI_BACKEND?.syncCommercial?.();
}
async function deleteTradeIntent(id){
 const client=window.LJI_BACKEND?.client,cfg=window.LJI_CONFIG||{};if(!client)return;
 const {error}=await client.from('lji_trade_intents').update({status:'cancelled'}).eq('workspace_id',cfg.WORKSPACE_ID).eq('id',id);
 if(error){console.error(error);toast('Falha ao excluir permuta.');return}await window.LJI_BACKEND?.syncCommercial?.();
}
function tradeScore(i,c){
 const city=matchCity(i.desired_city,c.city);
 if(city===false)return 0;
 const spRegionFit=buyerSpRegionFit(i.desired_city,c.neighborhood);
 if(spRegionFit===false)return 0;
 let s=0;
 if(city===true)s+=spRegionFit===null&&canonicalBuyerRegion(i.desired_city).startsWith('São Paulo —')?20:35;
 if(spRegionFit===true)s+=8;
 if(i.desired_neighborhood){
   const nb=matchNeighborhood(i.desired_neighborhood,c.neighborhood);
   if(nb===1)s+=18;
   else if(nb>=.6)s+=12;
   else if(nb===0)s-=12;
 }
 if(matchType(c.type)===matchType(i.desired_type))s+=20;
 if(c.price<=i.budget_max)s+=25;
 else if(i.budget_max&&(c.price-i.budget_max)/i.budget_max<=.08)s+=10;
 if((c.beds||0)>=i.beds_min)s+=10;
 if((c.parking||0)>=i.parking_min)s+=10;
 return Math.max(0,Math.min(100,s))
}
function allTradeMatches(){
  const active=(tradeIntents||[]).filter(intent=>intent.status==='active'),out=[];
  active.forEach(intent=>{
    const offered=(owners||[]).find(owner=>String(owner.id)===String(intent.owner_id));
    if(!offered||!ownerEligibleForMatch(offered))return;
    (owners||[]).forEach(candidate=>{
      if(String(candidate.id)===String(offered.id)||!ownerEligibleForMatch(candidate))return;
      const score=tradeScore(intent,candidate);if(score<60)return;
      const reverse=active.some(other=>String(other.owner_id)===String(candidate.id)&&tradeScore(other,offered)>=60);
      out.push({intent,offered,candidate,score,bidirectional:reverse});
    });
  });
  return out.sort((a,b)=>Number(b.bidirectional)-Number(a.bidirectional)||b.score-a.score);
}
function renderTrades(){
  populateTradeOwners();
  const matches=allTradeMatches(), active=tradeIntents.filter(x=>x.status==='active');
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v};
  set('tIntents',active.length); set('tMatches',matches.length);
  set('tBi',matches.filter(x=>x.bidirectional).length); set('tHot',matches.filter(x=>x.score>=85).length);
  set('tradeNavCount',active.length);
  const intents=document.getElementById('tradeIntentsTable');
  if(intents) intents.innerHTML=active.length?`<table><thead><tr><th>Imóvel oferecido</th><th>Busca</th><th>Limite</th><th>Observações</th><th></th></tr></thead><tbody>${active.map(i=>{const o=owners.find(x=>String(x.id)===String(i.owner_id));return `<tr><td><strong>${esc(o?.title||'Imóvel removido')}</strong><br><span class="small">${esc(o?.city||'')}</span></td><td>${esc(i.desired_type)} · ${esc(i.desired_city)}<br><span class="small">${esc(i.beds_min)}+ dorm · ${esc(i.parking_min)}+ vagas</span></td><td>${money(i.budget_max)}</td><td>${esc(i.notes||'—')}</td><td><button class="danger" onclick="deleteTradeIntent('${esc(i.id)}')">Excluir</button></td></tr>`}).join('')}</tbody></table>`:'<div class="empty">Nenhum interesse de permuta cadastrado.</div>';
  const table=document.getElementById('tradeMatchesTable');
  if(table) table.innerHTML=matches.length?`<table><thead><tr><th>Score</th><th>Oferece</th><th>Recebe</th><th>Tipo de oportunidade</th></tr></thead><tbody>${matches.map(m=>`<tr><td><span class="badge ${m.score>=85?'hot':m.score>=70?'good':'mid'}">${m.score>=85?'🔥 ':''}${m.score}%</span></td><td><strong>${propertyMenuHtml(m.offered)}</strong><br><span class="small">${esc(m.offered.city)} · ${money(m.offered.price)}</span></td><td><strong>${propertyMenuHtml(m.candidate)}</strong><br><span class="small">${esc(m.candidate.city)} · ${money(m.candidate.price)}</span></td><td><span class="badge ${m.bidirectional?'hot':'good'}">${m.bidirectional?'🔁 Bidirecional':'Compatível'}</span></td></tr>`).join('')}</tbody></table>`:'<div class="empty">Sem matches ainda. Cadastre interesses de permuta.</div>';
}

async function addCompanyDemand(){
  const client=window.LJI_BACKEND?.client,cfg=window.LJI_CONFIG||{};
  const name=document.getElementById('cName')?.value.trim();
  const budget=Number(document.getElementById('cBudget')?.value||0);
  if(!name||!budget){toast('Informe empresa/grupo e orçamento.');return}
  if(!client){toast('Supabase indisponível.');return}
  const payload={workspace_id:cfg.WORKSPACE_ID,name,city:document.getElementById('cCity').value.trim(),type:document.getElementById('cType').value,budget,area_min:Number(document.getElementById('cArea').value||0),floors_min:Number(document.getElementById('cFloors').value||0),urgency:Number(document.getElementById('cUrgency').value||2),source:document.getElementById('cSource').value,contact:document.getElementById('cContact').value.trim(),notes:document.getElementById('cNotes').value.trim(),status:'active'};
  const {error}=await client.from('lji_company_demands').insert(payload);
  if(error){console.error(error);toast('Falha ao salvar demanda corporativa.');return}
  toast('Demanda corporativa salva no Supabase.');await window.LJI_BACKEND?.syncCommercial?.();
}
async function deleteCompanyDemand(id){
 const client=window.LJI_BACKEND?.client,cfg=window.LJI_CONFIG||{};if(!client)return;
 const {error}=await client.from('lji_company_demands').update({status:'cancelled'}).eq('workspace_id',cfg.WORKSPACE_ID).eq('id',id);
 if(error){console.error(error);toast('Falha ao excluir demanda.');return}await window.LJI_BACKEND?.syncCommercial?.();
}
function companyScore(c,o){
  let s=0;
  const city=(c.city||'').toLowerCase(), ocity=(o.city||'').toLowerCase();
  if(!city || ocity.includes(city) || city.includes(ocity))s+=30;
  if(o.price<=c.budget)s+=35;
  else if(c.budget && (o.price-c.budget)/c.budget<=.10)s+=15;
  if(!c.area_min || Number(o.area||0)>=c.area_min)s+=20;
  if((c.type||'').toLowerCase().includes((o.type||'').toLowerCase()) || (o.type||'').toLowerCase().includes((c.type||'').toLowerCase()))s+=15;
  return Math.min(100,s);
}
function allCompanyMatches(){
  const out=[];
  companyDemands.filter(c=>c.status==='Ativa').forEach(c=>owners.forEach(o=>{
    if(!o?.is_commercial)return;
    const score=companyScore(c,o); if(score>=60)out.push({company:c,owner:o,score});
  }));
  return out.sort((a,b)=>b.score-a.score);
}
function renderCompanies(){
  const active=companyDemands.filter(x=>x.status==='Ativa'), matches=allCompanyMatches();
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v};
  set('cTotal',active.length);set('cUrgent',active.filter(x=>x.urgency===3).length);
  set('cBudgetTotal',money(active.reduce((s,x)=>s+x.budget,0)));set('cMatches',matches.length);
  const table=document.getElementById('companiesTable');
  if(table){
    if(!active.length){table.innerHTML='<div class="empty">Nenhuma demanda corporativa cadastrada.</div>';}
    else{
      const tableRows=active.map(c=>`<tr><td><strong>${esc(c.name)}</strong><br><span class="small">${esc(c.contact||'Sem contato')}</span></td><td>${esc(c.type)} · ${esc(c.city||'Região aberta')}<br><span class="small">${c.area_min?esc(c.area_min)+' m² mín. · ':''}${c.floors_min?esc(c.floors_min)+' andares mín. · ':''}${esc(c.notes||'')}</span></td><td>${money(c.budget)}</td><td><span class="badge ${c.urgency===3?'hot':c.urgency===2?'good':'mid'}">${c.urgency===3?'Alta':c.urgency===2?'Média':'Baixa'}</span></td><td>${esc(c.source)}</td><td><button class="danger" onclick="deleteCompanyDemand('${esc(c.id)}')">Excluir</button></td></tr>`).join('');
      const cards=active.map(c=>{
        const urg=c.urgency===3?'Alta':c.urgency===2?'Média':'Baixa';
        const urgCls=c.urgency===3?'hot':c.urgency===2?'good':'mid';
        const specs=[c.area_min?`${c.area_min} m² mín.`:'' ,c.floors_min?`${c.floors_min} andares mín.`:''].filter(Boolean).join(' · ');
        return `<article class="m-card">
          <div class="m-card-top"><strong>${esc(c.name||'Empresa')}</strong><span class="badge ${urgCls}">${urg}</span></div>
          <div class="m-card-meta">${esc(c.type||'')} · ${esc(c.city||'Região aberta')}</div>
          <div class="m-card-price">${money(c.budget)}</div>
          <div class="m-card-specs">${esc(specs||'Sem requisitos extras')}</div>
          <div class="m-card-row small">${esc(c.contact||'Sem contato')} · ${esc(c.source||'')}</div>
          ${c.notes?`<div class="m-card-row small">${esc(c.notes)}</div>`:''}
          <div class="m-card-actions"><button class="danger" type="button" onclick="deleteCompanyDemand('${esc(c.id)}')">Excluir</button></div>
        </article>`;
      }).join('');
      table.innerHTML=`<div class="desktop-table-wrap"><table><thead><tr><th>Empresa / grupo</th><th>Demanda</th><th>Orçamento</th><th>Urgência</th><th>Origem</th><th></th></tr></thead><tbody>${tableRows}</tbody></table></div><div class="mobile-card-list">${cards}</div>`;
    }
  }
  const mt=document.getElementById('companyMatchesTable');
  if(mt){
    if(!matches.length){mt.innerHTML='<div class="empty">Nenhum imóvel comercial real disponível na base para cruzamento.</div>';}
    else{
      const tableRows=matches.map(m=>`<tr><td><span class="badge ${m.score>=85?'hot':m.score>=70?'good':'mid'}">${m.score}%</span></td><td><strong>${esc(m.company.name)}</strong><br><span class="small">${esc(m.company.city||'Região aberta')}</span></td><td><strong>${propertyMenuHtml(m.owner)}</strong><br><span class="small">${esc(m.owner.city)}</span></td><td>${money(m.owner.price)}</td><td>${esc(m.owner.area||0)} m²</td></tr>`).join('');
      const cards=matches.map(m=>{
        const scoreCls=m.score>=85?'hot':m.score>=70?'good':'mid';
        return `<article class="m-card">
          <div class="m-card-top"><strong>${esc(m.company.name||'Empresa')}</strong><span class="badge ${scoreCls}">${m.score}%</span></div>
          <div class="m-card-meta">${esc(m.company.city||'Região aberta')}</div>
          <div class="m-card-row"><strong>${esc(m.owner.title||'Imóvel')}</strong></div>
          <div class="m-card-meta">${esc(m.owner.city||'')} · ${esc(m.owner.area||0)} m²</div>
          <div class="m-card-price">${money(m.owner.price)}</div>
        </article>`;
      }).join('');
      mt.innerHTML=`<div class="desktop-table-wrap"><table><thead><tr><th>Score</th><th>Empresa</th><th>Imóvel</th><th>Preço</th><th>Área</th></tr></thead><tbody>${tableRows}</tbody></table></div><div class="mobile-card-list">${cards}</div>`;
    }
  }
}

function tradeExportRows(){const matches=allTradeMatches();return tradeIntents.filter(i=>i.status==='active').map(i=>{const o=owners.find(x=>String(x.id)===String(i.owner_id)),ms=matches.filter(m=>String(m.offered.id)===String(i.owner_id));return {'Imóvel oferecido':o?.title||'','Cidade oferta':o?.city||'','Busca':`${i.desired_type} · ${i.desired_city}`,'Valor máximo':Number(i.budget_max||0),'Quartos mín.':Number(i.beds_min||0),'Vagas mín.':Number(i.parking_min||0),'Matches':ms.length,'Melhor score':ms.length?Math.max(...ms.map(x=>x.score)):0,'Observações':i.notes||'','Link oferta':o?propertyUrl(o)||'':''}})}
function exportTradesExcel(){const rows=tradeExportRows();if(!rows.length){toast('Nenhuma permuta ativa.');return}saveWorkbook(rows,`LJ-Radar-Imob-Permutas-${new Date().toISOString().slice(0,10)}.xlsx`)}
function exportTradesPdf(){exportRowsPdf(tradeExportRows(),'LJ Radar Imob — Permutas',`LJ-Radar-Imob-Permutas-${new Date().toISOString().slice(0,10)}.pdf`)}
function companyExportRows(){const matches=allCompanyMatches();return companyDemands.filter(c=>c.status==='Ativa').map(c=>{const ms=matches.filter(m=>String(m.company.id)===String(c.id));const d=loosePhone(c.contact);return {'Empresa / grupo':c.name,'Região':c.city||'Região aberta','Tipo':c.type,'Orçamento':Number(c.budget||0),'Área mínima':Number(c.area_min||0),'Andares mín.':Number(c.floors_min||0),'Urgência':c.urgency===3?'Alta':c.urgency===2?'Média':'Baixa','Origem':c.source||'','Contato':c.contact||'','WhatsApp':whatsappFrom(d),'Matches':ms.length,'Melhor score':ms.length?Math.max(...ms.map(x=>x.score)):0,'Observações':c.notes||''}})}
function exportCompaniesExcel(){const rows=companyExportRows();if(!rows.length){toast('Nenhuma demanda corporativa ativa.');return}saveWorkbook(rows,`LJ-Radar-Imob-Empresas-${new Date().toISOString().slice(0,10)}.xlsx`)}
function exportCompaniesPdf(){exportRowsPdf(companyExportRows(),'LJ Radar Imob — Empresas / Expansão',`LJ-Radar-Imob-Empresas-${new Date().toISOString().slice(0,10)}.pdf`)}

function renderReports(){
  const matches=effectiveMatchScores().map(score=>({score})), tradeMatches=allTradeMatches(), corpMatches=allCompanyMatches();
  const currentOwners=owners.filter(o=>o?.is_current&&o?.status!=='rejected');
  const vgv=currentOwners.reduce((s,o)=>s+Number(o.price||0),0), ticket=currentOwners.length?vgv/currentOwners.length:0;
  const commission=vgv*0.0125;
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v};
  set('rVgv',money(vgv));set('rTicket',money(ticket));set('rHot',matches.filter(x=>x.score>=85).length);set('rCommission',money(commission));

  const bySource={}; currentOwners.forEach(o=>bySource[o.source||'Sem origem']=(bySource[o.source||'Sem origem']||0)+1);
  const src=document.getElementById('rSources');
  if(src)src.innerHTML=Object.entries(bySource).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="setting-row"><div><strong>${esc(k)}</strong><span>${v} lead(s)</span></div><div style="width:140px"><div class="progress"><span style="width:${currentOwners.length?Math.round(v/currentOwners.length*100):0}%"></span></div></div></div>`).join('')||'<div class="empty">Sem dados.</div>';

  const funnel=[
    ['Proprietários / imóveis atuais',currentOwners.length,'owners'],
    ['Intenções reais',buyerIntentions.length,'intentions'],
    ['Matches validados',matches.length,'matches'],
    ['Matches quentes (85%+)',matches.filter(x=>x.score>=85).length,'matches'],
    ['Permutas',tradeMatches.length,'trades'],
    ['Demandas corporativas',companyDemands.length,'companies'],
    ['Matches corporativos',corpMatches.length,'companies']
  ];
  const f=document.getElementById('rFunnel');
  if(f)f.innerHTML=funnel.map(([k,v,page])=>`<button class="report-funnel-link" onclick="go('${page}')">
    <span><strong>${k}</strong><small>Clique para abrir o módulo</small></span>
    <span class="report-funnel-count">${v}</span><b>›</b>
  </button>`).join('');

  const executive=document.getElementById('rExecutive');
  if(executive) executive.innerHTML=`<div class="notice"><strong>Leitura comercial real:</strong> ${currentOwners.length} imóvel(is) atual(is), ${buyerIntentions.length} intenção(ões) ativa(s), ${matches.length} match(es) validado(s) e ${matches.filter(x=>x.score>=85).length} match(es) quente(s). VGV atual: ${money(vgv)}. Comissão potencial estimada em 1,25%: ${money(commission)}.</div>`;
}
function exportReportCSV(){
  const rows=[
    ['Indicador','Valor'],
    ['Proprietários',owners.length],['Intenções reais',buyerIntentions.length],['Matches validados',effectiveMatchScores().length],
    ['Matches quentes',effectiveMatchScores().filter(x=>x>=85).length],['Permutas',allTradeMatches().length],
    ['Permutas bidirecionais',allTradeMatches().filter(x=>x.bidirectional).length],
    ['Demandas corporativas',companyDemands.length],['Matches corporativos',allCompanyMatches().length],
    ['VGV atual',owners.filter(o=>o?.is_current).reduce((s,o)=>s+Number(o.price||0),0)]
  ];
  const csv=rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(';')).join('\n');
  const blob=new Blob(["\ufeff"+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='lj-intelligence-relatorio.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);
}


// ========================
// RADAR DE INTENÇÃO — PRODUÇÃO REAL / SUPABASE
// ========================
let buyerIntentions = [];
let intentMatchesRemote = [];
let intentSyncMeta = {enriched:0};

function normalizeIntentRegion(v){ return String(v||'').trim(); }
function formatDateBR(v){
  if(!v) return 'Data não informada';
  const d=new Date(v); if(Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'});
}
function publicationRaw(item){
  return item?.published_at || item?.raw_snapshot?.search_date || item?.raw_snapshot?.serper?.date || '';
}
function publicationLabel(item){
  const raw=publicationRaw(item);
  if(!raw)return 'data não informada';
  const d=new Date(raw);
  if(!Number.isNaN(d.getTime()))return d.toLocaleDateString('pt-BR');
  return String(raw).trim() || 'data não informada';
}
function publicationValue(raw){
  if(!raw)return 'data não informada';
  const d=new Date(raw);
  return Number.isNaN(d.getTime())?String(raw):d.toLocaleDateString('pt-BR');
}
function intentSourceMenu(i){
  const url=safeHttpUrl(i.source_url);
  const safeTitle=esc(i.person_name||i.title||'Intenção');
  return `<span class="property-link-wrap"><strong>${safeTitle}</strong>${url?`<span class="small"> · <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">fonte ↗</a></span>`:''}</span>`;
}
function cleanIntentText(v){ return String(v||'').replace(/\s+/g,' ').trim(); }
function intentWantedLocation(i){
  const t=cleanIntentText(i.intent_text);
  let m=t.match(/na regi[aã]o de:\s*(.{2,150}?)(?=\s+Criado\b|\s+Em torno de:|\s+Contato\b|\s+\d+ ofertas?\b)/i);
  if(m?.[1]) return m[1].replace(/\s*[.]+\s*$/,'').trim();
  m=t.match(/no bairro\s+(.{2,70}?)\s+em\s+([A-Za-zÀ-ÿ .'-]{2,45})\s*-\s*([A-Z]{2})\b/i);
  if(m) return `${m[1].trim()} · ${m[2].trim()} - ${m[3]}`;
  return i.region||i.city||'Região não informada';
}
function intentWantedType(i){
  const t=cleanIntentText(i.intent_text);
  const m=t.match(/quer\s+(?:comprar|alugar)\s+(?:um|uma)?\s*([A-Za-zÀ-ÿçÇãõÃÕ ]{2,35}?)(?=\s+(?:na regi[aã]o|no bairro|em\s+[A-ZÀ-Ú]))/i);
  if(m?.[1]){
    const x=m[1].trim().replace(/^(um|uma)\s+/i,'');
    if(x.length<=28) return x.charAt(0).toUpperCase()+x.slice(1);
  }
  return i.property_type||'Imóvel';
}
function intentPublicContact(i){
  const direct=cleanIntentText(i.contact);
  const text=`${direct} ${cleanIntentText(i.intent_text)}`;
  const patterns=[
    /(?:whats(?:app)?|zap|telefone|celular|contato(?:\s+com\s+[A-Za-zÀ-ÿ ]{1,40})?)\s*[:\-]?\s*(\+?55\s*)?(\(?\d{2}\)?[\s.-]*)?(9?\d{4}[\s.-]?\d{4})/ig,
    /(?:whats(?:app)?|zap|telefone|celular|contato)\D{0,35}(\d{8,11})/ig
  ];
  for(const rx of patterns){
    const m=rx.exec(text); if(!m) continue;
    const raw=m[0].replace(/^(?:whats(?:app)?|zap|telefone|celular|contato(?:\s+com\s+[A-Za-zÀ-ÿ ]{1,40})?)\s*[:\-]?\s*/i,'').trim();
    let digits=raw.replace(/\D/g,'');
    if((digits.length===12||digits.length===13)&&digits.startsWith('55')) digits=digits.slice(2);
    if(digits.length>=8&&digits.length<=11){
      const full=digits.length===11&&digits[2]==='9';
      return {raw,digits,full,whatsapp:full?`https://wa.me/55${digits}`:''};
    }
  }
  return null;
}
function intentRole(i){return i?.intent_role||i?.raw_snapshot?.intent_role||'buyer';}
function intentActionLabel(i){
  const seller=intentRole(i)==='seller';
  if(seller)return i.transaction_type==='rent'?'Alugar meu imóvel':'Vender';
  return i.transaction_type==='rent'?'Alugar':'Comprar';
}
function intentValueLabel(i){return intentRole(i)==='seller'?(i.transaction_type==='rent'?'Valor do aluguel':'Valor pretendido'):'Orçamento';}
function setIntentRoleFilter(v){const e=document.getElementById('intentRoleFilter');if(e)e.value=v;renderIntentions();document.getElementById('intentionsTable')?.scrollIntoView({behavior:'smooth',block:'start'});}
function setIntentStatus(v){ const e=document.getElementById('intentStatusFilter'); if(e)e.value=v; renderIntentions(); document.getElementById('intentionsTable')?.scrollIntoView({behavior:'smooth',block:'start'}); }
function setIntentBudgetFilter(){ const e=document.getElementById('intentBudgetOnly'); if(e)e.value=e.value==='1'?'0':'1'; renderIntentions(); document.getElementById('intentionsTable')?.scrollIntoView({behavior:'smooth',block:'start'}); }
function setIntentContactFilter(){ const e=document.getElementById('intentContactOnly'); if(e)e.value=e.value==='1'?'0':'1'; renderIntentions(); document.getElementById('intentionsTable')?.scrollIntoView({behavior:'smooth',block:'start'}); }
function renderIntentions(){
  const q=(document.getElementById('intentSearch')?.value||'').toLowerCase();
  const region=document.getElementById('intentRegionFilter')?.value||'';
  const min=Number(document.getElementById('intentMinScore')?.value||0);
  const statusFilter=document.getElementById('intentStatusFilter')?.value??'active';
  const roleFilter=document.getElementById('intentRoleFilter')?.value||'';
  const budgetOnly=document.getElementById('intentBudgetOnly')?.value==='1';
  const contactOnly=document.getElementById('intentContactOnly')?.value==='1';

  const enriched=buyerIntentions.map(i=>({
    ...i,
    _location:intentWantedLocation(i),
    _type:intentWantedType(i),
    _contact:intentPublicContact(i)
  }));
  const rows=enriched.filter(i=>{
    const active=i.status==='active';
    const statusOk=statusFilter==='' || (statusFilter==='active'&&active) || (statusFilter==='history'&&!active);
    const blob=[i.person_name,i.title,i._location,i._type,i.source_name].join(' ').toLowerCase();
    return statusOk && (!roleFilter||intentRole(i)===roleFilter) && (!q||blob.includes(q)) && (!region||i.region===region||i._location.includes(region)) && Number(i.intent_score||0)>=min && (!budgetOnly||Number(i.budget_max||0)>0) && (!contactOnly||Boolean(i._contact));
  });

  const activeRows=enriched.filter(i=>i.status==='active');
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v};
  set('iTotal',activeRows.length);
  set('iHot',activeRows.filter(x=>intentRole(x)==='seller').length);
  set('iEnriched',activeRows.filter(x=>Boolean(x._contact)).length);
  set('iMatches',groupIntentMatches(intentMatchesRemote).length);

  const budgetToggle=document.getElementById('intentBudgetOnly');
  const contactToggle=document.getElementById('intentContactOnly');
  const box=document.getElementById('intentionsTable');
  if(box) box.innerHTML=`<div class="intent-list-meta"><span><strong>${rows.length}</strong> resultado(s)</span>${budgetOnly?'<button onclick="setIntentBudgetFilter()">Orçamento ×</button>':''}${contactOnly?'<button onclick="setIntentContactFilter()">Contato ×</button>':''}</div>`+(rows.length?`<div class="intent-compact-list">${rows.map(i=>{
    const c=i._contact;
    const specs=[Number(i.bedrooms_min||0)?`${i.bedrooms_min}+ dorm.`:'',Number(i.parking_min||0)?`${i.parking_min}+ vagas`:''].filter(Boolean).join(' · ');
    return `<article class="intent-compact-card">
      <div class="intent-person"><div class="intent-avatar">${esc((i.person_name||'?').trim().charAt(0).toUpperCase())}</div><div>${intentSourceMenu(i)}<span>${esc(i.source_name||'Fonte pública')} · ${esc(publicationLabel(i))}</span></div></div>
      <div class="intent-wants"><strong>${esc(intentActionLabel(i))} ${esc(i._type)}</strong><span>${intentRole(i)==='seller'?'<b class="seller-intent-tag">Proprietário</b> · ':''}${specs||'Perfil aberto'}</span></div>
      <div class="intent-location"><small>${intentRole(i)==='seller'?'Local do imóvel':'Região'}</small><strong>${esc(i._location)}</strong></div>
      <div class="intent-budget"><small>${esc(intentValueLabel(i))}</small><strong>${Number(i.budget_max||0)?esc(money(i.budget_max)):'Não informado'}</strong></div>
      <div class="intent-contact"><small>Contato</small>${c?(c.whatsapp?`<a class="intent-whatsapp" href="${esc(c.whatsapp)}" target="_blank" rel="noopener noreferrer">WhatsApp ↗</a>`:`<strong>${esc(c.raw)}</strong><span>DDD não informado</span>`):(i.raw_snapshot?.contact_verified?'<span>Celular verificado · número não exposto</span>':'<span>Via fonte</span>')}</div>
      <div class="intent-score"><span class="badge ${Number(i.intent_score)>=80?'hot':Number(i.intent_score)>=60?'good':'mid'}">${Number(i.intent_score||0)}%</span>${i.status==='active'?'<small>Ativa</small>':'<small>Histórico</small>'}</div>
      <div class="intent-action">${safeHttpUrl(i.source_url)?`<a class="source-action" href="${esc(safeHttpUrl(i.source_url))}" target="_blank" rel="noopener noreferrer">Abrir origem ↗</a>`:'<span class="small">Sem link</span>'}</div>
    </article>`;
  }).join('')}</div>`:'<div class="empty">Nenhuma intenção real encontrada com estes filtros.</div>');

  const mt=document.getElementById('intentMatchesTable');
  const groups=groupIntentMatches(intentMatchesRemote);
  if(mt) mt.innerHTML=groups.length?groupedMatchesHtml(groups,true):'<div class="empty">Nenhum match validado pelo Match Engine neste momento.</div>';
}
function filteredIntentionsExport(){
  const q=(document.getElementById('intentSearch')?.value||'').toLowerCase(),region=document.getElementById('intentRegionFilter')?.value||'',min=Number(document.getElementById('intentMinScore')?.value||0),statusFilter=document.getElementById('intentStatusFilter')?.value??'active',roleFilter=document.getElementById('intentRoleFilter')?.value||'',budgetOnly=document.getElementById('intentBudgetOnly')?.value==='1',contactOnly=document.getElementById('intentContactOnly')?.value==='1';
  return buyerIntentions.map(i=>({...i,_location:intentWantedLocation(i),_type:intentWantedType(i),_contact:intentPublicContact(i)})).filter(i=>{const active=i.status==='active',statusOk=statusFilter===''||(statusFilter==='active'&&active)||(statusFilter==='history'&&!active),blob=[i.person_name,i.title,i._location,i._type,i.source_name].join(' ').toLowerCase();return statusOk&&(!roleFilter||intentRole(i)===roleFilter)&&(!q||blob.includes(q))&&(!region||i.region===region||i._location.includes(region))&&Number(i.intent_score||0)>=min&&(!budgetOnly||Number(i.budget_max||0)>0)&&(!contactOnly||Boolean(i._contact));});
}
function intentionExportRows(){return filteredIntentionsExport().map(i=>({'Perfil':intentRole(i)==='seller'?'Proprietário':'Interessado','Pessoa / publicação':i.person_name||i.title||'','Intenção':intentActionLabel(i),'Tipo':i._type,'Região / local do imóvel':i._location,'Valor / orçamento':Number(i.budget_max||0),'Quartos':Number(i.bedrooms_min||0),'Vagas':Number(i.parking_min||0),'Score':Number(i.intent_score||0),'Status':i.status==='active'?'Ativa':'Histórico','Telefone':i._contact?.digits||'','WhatsApp':i._contact?.whatsapp||'','Fonte':i.source_name||'','Data de publicação':publicationLabel(i),'Link origem':i.source_url||''}))}
function exportIntentionsExcel(){const rows=intentionExportRows();if(!rows.length){toast('Nenhuma intenção no filtro atual.');return}saveWorkbook(rows,`LJ-Radar-Imob-Intencoes-${new Date().toISOString().slice(0,10)}.xlsx`)}
function exportIntentionsPdf(){exportRowsPdf(intentionExportRows(),'LJ Radar Imob — Radar de Intenção',`LJ-Radar-Imob-Intencoes-${new Date().toISOString().slice(0,10)}.pdf`)}

async function syncIntentions(){
  const sb=window.LJI_BACKEND?.client;
  const cfg=window.LJI_CONFIG||{};
  const status=document.getElementById('intentCollectorStatus');

  if(!sb){
    if(status)status.textContent='Offline / sem sessão: aguardando conexão com o Supabase.';
    return;
  }

  if(status)status.textContent='Sincronizando intenções e matches reais...';

  let intentRes=null,matchRes=null;
  try{
    [intentRes,matchRes]=await Promise.all([
      sb.from('lji_buyer_intents').select('*').eq('workspace_id',cfg.WORKSPACE_ID).order('captured_at',{ascending:false}).limit(1000),
      sb.from('lji_match_engine_review').select('*').eq('workspace_id',cfg.WORKSPACE_ID).order('match_score',{ascending:false}).limit(250)
    ]);
    // Compatibilidade: builds antigos ainda podem não ter a view unificada.
    if(matchRes?.error){
      console.warn('Match Engine unificado indisponível; tentando view legada.',matchRes.error);
      matchRes=await sb.from('lji_intent_match_review').select('*').eq('workspace_id',cfg.WORKSPACE_ID).order('match_score',{ascending:false}).limit(250);
    }
  }catch(e){
    console.error('Radar de Intenção · erro de transporte:',e);
    if(status)status.textContent='Falha de conexão ao consultar intenções. Demandas cadastradas continuam disponíveis no Match Engine.';
    try{renderMatches()}catch(_){}
    return;
  }

  // Falha isolada nas intenções públicas não derruba o Match Engine manual.
  if(intentRes?.error){
    console.error('Radar de Intenção · buyer_intents:',intentRes.error);
    if(status)status.textContent='Falha ao ler intenções públicas. Demandas cadastradas preservadas.';
  }else{
    buyerIntentions=Array.isArray(intentRes?.data)?intentRes.data:[];
  }
  if(matchRes?.error){
    console.error('Radar de Intenção · matches:',matchRes.error);
    intentMatchesRemote=[];
  }else{
    intentMatchesRemote=Array.isArray(matchRes?.data)?matchRes.data:[];
  }

  intentSyncMeta.enriched=buyerIntentions.filter(i=>Boolean(i.raw_snapshot?.profile_parser_version)||i.raw_snapshot?.profile_fetch_status==='ok').length;

  const activeCount=buyerIntentions.filter(i=>i.status==='active').length;
  const withPhone=buyerIntentions.filter(i=>phoneDigitsNorm(i.contact||'').length>=8).length;
  const activeWithPhone=buyerIntentions.filter(i=>i.status==='active'&&phoneDigitsNorm(i.contact||'').length>=8).length;

  window.LJI_INTENT_SYNC_DIAGNOSTIC={
    loaded:buyerIntentions.length,
    active:activeCount,
    withPhone,
    activeWithPhone,
    matches:intentMatchesRemote.length,
    syncedAt:new Date().toISOString()
  };

  const safeIntentRender=(name,fn)=>{
    try{fn()}catch(e){
      console.error(`Radar de Intenção · render ${name}:`,e);
      if(window.LJI_RUNTIME_WARNINGS)window.LJI_RUNTIME_WARNINGS.push({step:`render ${name}`,message:String(e?.message||e),at:new Date().toISOString()});
    }
  };

  // WhatsApp primeiro: mesmo que outra tela tenha bug, os contatos aparecem.
  safeIntentRender('Cidades e filtros',()=>{refreshCitySelectors();refreshIntentNeighborhoodOptions()});
  safeIntentRender('Leads e WhatsApp',()=>renderWhatsAppLeads());
  safeIntentRender('Verificação de Contato',()=>renderContactCheck());
  safeIntentRender('Radar de Intenção',()=>renderIntentions());
  safeIntentRender('Matches',()=>renderMatches());
  safeIntentRender('Dashboard',()=>renderDashboard());
  safeIntentRender('Pipeline',()=>renderPipeline());
  safeIntentRender('Relatórios',()=>renderReports());

  const banner=document.getElementById('intentProductionBanner');
  if(banner){
    const rejected=buyerIntentions.filter(i=>i.status==='rejected_quality').length;
    banner.innerHTML=`<strong>Radar real.</strong> ${activeCount} intenção(ões) ativa(s) · ${buyerIntentions.filter(i=>i.status==='active'&&intentRole(i)==='seller').length} proprietário(s) querendo vender/alugar · ${rejected} filtrada(s) · ${groupIntentMatches(matchFilteredRows(false)).length} intenção(ões) pública(s) + ${groupLocalMatches(filteredLocalMatches(false)).length} demanda(s) cadastrada(s) com match.`;
  }

  if(status)status.textContent=`Atualizado agora · ${activeCount} ativas · ${activeWithPhone} ativa(s) com telefone · ${withPhone} contato(s) preservado(s) no histórico.`;
}
async function runIntentCollector(){
  const sb=window.LJI_BACKEND?.client;
  const status=document.getElementById('intentCollectorStatus');
  if(!sb){ if(status)status.textContent='Faça login para rodar a coleta real.'; return null; }
  const selected=document.getElementById('iTransaction').value;
  const [intent_role,transaction_type]=selected.split(':');
  const body={
    region:document.getElementById('iRegion').value,
    transaction_type,
    intent_role,
    neighborhood:document.getElementById('iNeighborhood')?.value.trim()||'',
    property_type:document.getElementById('iType')?.value||'',
    extra:document.getElementById('iExtra')?.value.trim()||''
  };
  if(status)status.textContent='Coletando sinais públicos reais...';
  const {data,error}=await sb.functions.invoke('radar-intencao-lj-v1',{body});
  if(error) throw error;
  return data;
}

async function runIntentEnricher(){
  const sb=window.LJI_BACKEND?.client;
  if(!sb) return null;
  let total=0, remaining=1, loops=0, last=null;
  while(remaining>0 && loops<4){
    const {data,error}=await sb.functions.invoke('enriquecedor-intencao-lj-v1',{body:{limit:50}});
    if(error) throw error;
    last=data||{};
    total+=Number(last.enriched||0);
    remaining=Number(last.remaining||0);
    loops++;
    if(!Number(last.selected||0))break;
  }
  return {enriched:total,remaining,last};
}

async function runIntentPipeline(){
  const btn=document.getElementById('intentRunBtn');
  const status=document.getElementById('intentCollectorStatus');
  try{
    btn.disabled=true;btn.textContent='Radar rodando...';
    const collect=await runIntentCollector();
    const reports=Array.isArray(collect?.report)?collect.report:[];
    const queryCount=reports.reduce((s,r)=>s+Number(r.queries||0),0);
    const searchErrors=reports.reduce((s,r)=>s+Number(r.search_errors||0),0);
    if(queryCount>0&&searchErrors>=queryCount){
      if(status)status.textContent='Busca externa indisponível nesta execução. Nenhum resultado fictício foi criado; os dados existentes foram preservados.';
      await syncIntentions();
      return;
    }
    if(status)status.textContent=reports.some(r=>r.intent_role==='seller')?'Coleta de proprietários concluída. Sincronizando leads acionáveis...':'Coleta concluída. Enriquecendo perfis individuais...';
    const enrich=await runIntentEnricher();
    await syncIntentions();
    const saved=(collect?.report||[]).reduce((s,r)=>s+Number(r.saved||0),0);
    if(status){const ownersFound=(collect?.report||[]).reduce((s,r)=>s+Number(r.owner_leads_synced||0),0);status.textContent=`Radar concluído: ${saved} intenção(ões) processada(s) · ${ownersFound} lead(s) de proprietário sincronizado(s) · ${Number(enrich?.enriched||0)} perfil(is) enriquecido(s) · ${groupIntentMatches(intentMatchesRemote).length} comprador(es) com match(es).`;}
  }catch(e){
    console.error(e);
    if(status)status.textContent='O Radar retornou erro. A tela foi mantida sem dados simulados.';
  }finally{
    if(btn){btn.disabled=false;btn.textContent='Rodar Radar completo';}
  }
}

// ========================
// VERIFICAÇÃO DE CONTATO — reconcilia somente dados já capturados.
// ========================
function normalizePlain(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim()}
function cepDigits(v){return String(v||'').replace(/\D/g,'')}
function phoneDigitsNorm(v){let d=String(v||'').replace(/\D/g,'');if((d.length===12||d.length===13)&&d.startsWith('55'))d=d.slice(2);return d}
function nameTokens(v){return normalizePlain(v).split(' ').filter(t=>t.length>=3)}
function nameSimilarity(a,b){const ta=nameTokens(a),tb=nameTokens(b);if(!ta.length||!tb.length)return 0;const setB=new Set(tb);return ta.filter(t=>setB.has(t)).length/Math.max(ta.length,tb.length)}
// DDDs que existem no Brasil. Sem esta checagem, número extraído errado do texto
// (ex.: "1046574206", DDD 10 inexistente) passava a valer como telefone e
// agrupava dezenas de anúncios sem relação num único lead.
const LJI_DDD_VALIDOS=new Set([11,12,13,14,15,16,17,18,19,21,22,24,27,28,31,32,33,34,35,37,38,
 41,42,43,44,45,46,47,48,49,51,53,54,55,61,62,63,64,65,66,67,68,69,
 71,73,74,75,77,79,81,82,83,84,85,86,87,88,89,91,92,93,94,95,96,97,98,99]);
function ljiPhoneValido(d){
 const n=String(d||'').replace(/\D/g,'');
 if(n.length!==10&&n.length!==11)return false;
 if(!LJI_DDD_VALIDOS.has(Number(n.slice(0,2))))return false;
 const assinante=n.slice(2);
 // Celular tem 9 dígitos começando em 9; fixo tem 8 começando em 2-5.
 if(assinante.length===9&&assinante[0]!=='9')return false;
 if(assinante.length===8&&!/^[2-5]/.test(assinante))return false;
 // Sequência repetida (0000000000, 1111111111) é lixo de extração.
 if(/^(\d)\1+$/.test(n))return false;
 return true;
}
window.ljiPhoneValido=ljiPhoneValido;
function phoneSetOf(c){
 const out=new Set(),p1=phoneDigitsNorm(c.phone);
 if(ljiPhoneValido(p1))out.add(p1);
 const waMatch=String(c.whatsapp||'').match(/(\d{8,13})/);
 if(waMatch){const d=phoneDigitsNorm(waMatch[1]);if(ljiPhoneValido(d))out.add(d)}
 return Array.from(out)
}
function contactCandidates(includeHistory=false){
 const fromOwners=(owners||[]).map(o=>({
  key:'owner-'+o.id,db_kind:'opportunity',db_id:o.opportunity_id||o.id,kind:'Proprietários',title:o.title,name:o.contact_name||'',
  city:o.city||'',neighborhood:o.neighborhood||'',address:o.address||'',cep:o.cep||'',phone:o.contact_verified_phone||o.contact_phone||'',
  whatsapp:o.whatsapp_url||'',source:o.source||'Radar',published_at:o.published_at||o.last_seen_at||o.first_seen_at||'',
  url:propertyUrl(o)||'',qaStatus:o.quinto_status||'',qaMatchUrl:o.quinto_match_url||'',verified_at:o.contact_verified_at||'',
  operationalStatus:o.is_current===false?'historical':o.status==='rejected'?'discarded':'active',isActive:o.is_current!==false&&o.status!=='rejected'
 }));
 const fromDiscovered=(discoveredLeads||[]).map((x,i)=>{
  const st=String(x.status||'active').toLowerCase();
  const active=!['rejected','discarded','inactive','expired'].some(k=>st.includes(k));
  return {
   key:'lead-'+(x.id||i),db_kind:'lead',db_id:x.id||'',kind:'Busca Profunda',title:x.title,name:x.contact_name||'',city:x.city||'',
   neighborhood:x.neighborhood||'',address:x.address||'',cep:x.cep||'',phone:x.contact_verified_phone||x.contact_phone||'',whatsapp:x.whatsapp_url||'',
   source:x.source||'Busca Profunda',published_at:x.published_at||'',url:x.source_url||'',qaStatus:x.quinto_status||'',qaMatchUrl:x.quinto_match_url||'',
   verified_at:x.contact_verified_at||'',operationalStatus:st||'active',isActive:active
  };
 });
 const intentSource=(buyerIntentions||[]).filter(i=>{
  if(i.status==='active')return true;
  if(!includeHistory)return false;
  return phoneDigitsNorm(i.contact||'').length>=8;
 });
 const fromIntentions=intentSource.map((i,idx)=>({
  key:'intent-'+(i.id||idx),db_kind:'intent',db_id:i.id||'',kind:'Radar de Intenção',title:i.person_name||i.title||'',name:i.person_name||'',
  city:i.city||i.region||'',neighborhood:i.neighborhood||'',address:i.address||'',cep:i.cep||'',phone:i.contact||'',whatsapp:'',
  source:i.source_name||'Web pública',published_at:publicationRaw(i),url:i.source_url||'',qaStatus:intentRole(i)==='seller'?'pending':'not_applicable',qaMatchUrl:'',
  operationalStatus:i.status||'active',isActive:i.status==='active'
 }));
 const all=[...fromOwners,...fromDiscovered,...fromIntentions];
 return all.filter(c=>{
  if(!includeHistory&&!c.isActive)return false;
  if(includeHistory&&!c.isActive&&!phoneSetOf(c).length)return false;
  return c.name||c.title||c.phone||c.whatsapp;
 });
}
function candidatesMatch(a,b){if(phoneSetOf(a).some(p=>phoneSetOf(b).includes(p)))return true;const cepA=cepDigits(a.cep),cepB=cepDigits(b.cep),sameCep=cepA.length===8&&cepA===cepB,addrA=normalizePlain(a.address),addrB=normalizePlain(b.address),sameAddress=addrA&&addrB&&(addrA===addrB||addrA.includes(addrB)||addrB.includes(addrA)),nameSim=nameSimilarity(a.name,b.name);if((sameCep||sameAddress)&&nameSim>=.4)return true;const sameCity=normalizePlain(a.city)&&normalizePlain(a.city)===normalizePlain(b.city),sameNeighborhood=normalizePlain(a.neighborhood)&&normalizePlain(a.neighborhood)===normalizePlain(b.neighborhood);return Boolean(sameCity&&sameNeighborhood&&nameSim>=.6)}
function buildGroupSummary(members){
 const phoneTally=new Map();
 members.forEach(m=>phoneSetOf(m).forEach(d=>{
  if(!phoneTally.has(d))phoneTally.set(d,{digits:d,count:0,sources:new Set(),lastSeen:'',raw:m.phone||m.whatsapp||d,verified:false});
  const t=phoneTally.get(d);t.count++;t.sources.add(m.source||'—');
  if(m.verified_at&&phoneDigitsNorm(m.phone)===d)t.verified=true;
  if(m.published_at&&(!t.lastSeen||m.published_at>t.lastSeen)){t.lastSeen=m.published_at;if(m.phone)t.raw=m.phone}
 }));
 const phones=Array.from(phoneTally.values()).map(p=>({...p,sources:Array.from(p.sources),isMobile:p.digits.length===11&&p.digits[2]==='9'}))
  .sort((a,b)=>(Number(b.verified)-Number(a.verified))*100+(b.count*10+b.sources.length*5+(b.isMobile?2:0))-(a.count*10+a.sources.length*5+(a.isMobile?2:0)));
 let status='sem_contato';
 if(phones.some(p=>p.verified))status='verificado_manual';
 else if(phones.length===1)status=phones[0].sources.length>1?'confirmado':'unico';
 else if(phones.length>1)status=(phones[0].count>phones[1].count||phones[0].sources.length>phones[1].sources.length)?'confirmado':'conflito';
 const operationalStatuses=[...new Set(members.map(m=>m.operationalStatus).filter(Boolean))];
 const isActive=members.some(m=>m.isActive);
 return {
  id:members.map(m=>m.key).join('|'),members,phones,best:phones[0]||null,status,isActive,
  operationalStatuses,
  name:members.find(m=>m.name)?.name||'',title:members.find(m=>m.title)?.title||'',city:members.find(m=>m.city)?.city||'',
  neighborhood:members.find(m=>m.neighborhood)?.neighborhood||'',address:members.find(m=>m.address)?.address||'',cep:members.find(m=>m.cep)?.cep||''
 };
}
function buildContactGroups(includeHistory=false){
 const cands=contactCandidates(includeHistory),n=cands.length,parent=Array.from({length:n},(_,i)=>i);
 function find(x){return parent[x]===x?x:(parent[x]=find(parent[x]))}
 function union(a,b){const ra=find(a),rb=find(b);if(ra!==rb)parent[ra]=rb}
 for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)if(candidatesMatch(cands[i],cands[j]))union(i,j);
 const map=new Map();
 cands.forEach((c,i)=>{const r=find(i);if(!map.has(r))map.set(r,[]);map.get(r).push(c)});
 return Array.from(map.values()).map(buildGroupSummary)
}
window.LJI_CONTACT_OVERRIDES=window.LJI_CONTACT_OVERRIDES||{};
function contactOverrides(){return window.LJI_CONTACT_OVERRIDES}
function setContactOverride(groupId,digits){window.LJI_CONTACT_OVERRIDES[groupId]=digits;renderContactCheck()}
async function confirmContactManually(groupId){
 const g=buildContactGroups().find(x=>x.id===groupId);
 if(!g||!g.best?.digits){toast('Não há telefone para confirmar.');return}
 const client=window.LJI_BACKEND?.client;if(!client){toast('Faça login para confirmar o telefone.');return}
 const note=prompt('Observação da confirmação (opcional):','Ligação realizada e número confirmado.');if(note===null)return;
 const targets=g.members.filter(m=>['opportunity','lead'].includes(m.db_kind)&&m.db_id);
 if(!targets.length){toast('Este contato não possui registro persistente editável.');return}
 let ok=0;
 for(const m of targets){
  const {data,error}=await client.rpc('lji_confirm_contact',{p_kind:m.db_kind,p_id:m.db_id,p_phone:g.best.digits,p_note:note});
  if(!error&&data===true)ok++;
 }
 if(ok){toast(`Telefone confirmado em ${ok} registro(s).`);await window.LJI_BACKEND?.sync?.();await window.LJI_BACKEND?.syncDiscovery?.();renderContactCheck();renderWhatsAppLeads()}
 else toast('Não foi possível salvar a confirmação.');
}
async function lookupCnpj(){
  const el=document.getElementById('rCnpjLookupInput'),out=document.getElementById('rCnpjLookupResult');
  const cnpj=String(el?.value||'').replace(/\D/g,'');
  if(!out)return;
  out.classList.remove('hidden');
  if(cnpj.length!==14){out.textContent='Digite um CNPJ válido (14 dígitos).';return}
  out.textContent='Consultando Receita Federal (BrasilAPI)...';
  try{
    const res=await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
    if(!res.ok){out.textContent=res.status===404?'CNPJ não encontrado na Receita Federal.':'Falha na consulta, tente novamente em instantes.';return}
    const d=await res.json();
    const socios=(d.qsa||[]).map(s=>esc(s.nome_socio||'')).filter(Boolean).slice(0,5).join(', ');
    out.innerHTML=`<strong>${esc(d.razao_social||d.nome_fantasia||'—')}</strong>${d.nome_fantasia&&d.razao_social&&d.nome_fantasia!==d.razao_social?' · '+esc(d.nome_fantasia):''}<br>
      <span class="small">Situação: ${esc(d.descricao_situacao_cadastral||'—')} · Porte: ${esc(d.descricao_porte||'—')}</span><br>
      <span class="small">${esc(d.logradouro||'')}${d.numero?', '+esc(d.numero):''} ${esc(d.bairro||'')} · ${esc(d.municipio||'')}/${esc(d.uf||'')}</span>
      ${socios?`<br><span class="small">Sócios: ${socios}</span>`:''}
      <br><span class="small">Fonte: Receita Federal via BrasilAPI · dado público, gratuito.</span>`;
  }catch(e){out.textContent='Falha ao consultar (verifique sua conexão).'}
}
window.lookupCnpj=lookupCnpj;
async function lookupCep(){const el=document.getElementById('cepLookupInput'),out=document.getElementById('cepLookupResult'),cep=cepDigits(el?.value);if(cep.length!==8){if(out)out.textContent='Digite um CEP válido (8 dígitos).';return}if(out)out.textContent='Consultando...';try{const res=await fetch(`https://viacep.com.br/ws/${cep}/json/`),data=await res.json();if(data.erro){if(out)out.textContent='CEP não encontrado.';return}if(out)out.innerHTML=`${esc(data.logradouro||'')}${data.logradouro?' — ':''}${esc(data.bairro||'')} · ${esc(data.localidade||'')}/${esc(data.uf||'')}`}catch(e){if(out)out.textContent='Falha ao consultar o CEP (verifique sua conexão).'}}
function filteredContactGroups(){const q=(document.getElementById('contactCheckSearch')?.value||'').toLowerCase(),statusFilter=document.getElementById('contactCheckStatus')?.value||'',overrides=contactOverrides();return buildContactGroups().map(g=>{const ov=overrides[g.id];if(ov){const found=g.phones.find(p=>p.digits===ov);if(found)return {...g,best:{...found,overridden:true}}}return g}).filter(g=>{if(statusFilter&&g.status!==statusFilter)return false;if(q&&!([g.name,g.title,g.city,g.neighborhood,g.address,g.best?.digits].join(' ').toLowerCase().includes(q)))return false;return true}).sort((a,b)=>({verificado_manual:0,conflito:1,confirmado:2,unico:3,sem_contato:4}[a.status]??9)-({verificado_manual:0,conflito:1,confirmado:2,unico:3,sem_contato:4}[b.status]??9))}
function contactCheckExportRows(){return filteredContactGroups().map(g=>({'Lead':g.name||g.title||'','Cidade':g.city||'','Bairro':g.neighborhood||'','Endereço':g.address||'','CEP':g.cep||'','Status':g.status,'Telefone confiável':g.best?.digits||'','WhatsApp':g.best?.isMobile?`https://wa.me/55${g.best.digits}`:'','Ocorrências':g.members.length,'Fontes':g.members.map(m=>m.source).filter(Boolean).join(' | '),'Links':g.members.map(m=>m.url).filter(Boolean).join(' | ')}))}
function exportContactCheckExcel(){const rows=contactCheckExportRows();if(!rows.length){toast('Nenhum contato cruzado no filtro atual.');return}saveWorkbook(rows,`LJ-Radar-Imob-Verificacao-Contato-${new Date().toISOString().slice(0,10)}.xlsx`)}
function exportContactCheckPdf(){exportRowsPdf(contactCheckExportRows(),'LJ Radar Imob — Verificação de Contato',`LJ-Radar-Imob-Verificacao-Contato-${new Date().toISOString().slice(0,10)}.pdf`)}
function renderContactCheck(){
 const box=document.getElementById('contactCheckTable');if(!box)return;
 const all=buildContactGroups(),filtered=filteredContactGroups(),set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v};
 set('ccTotal',all.length);set('ccConfirmados',all.filter(g=>g.status==='confirmado'||g.status==='verificado_manual').length);set('ccConflitos',all.filter(g=>g.status==='conflito').length);
 if(!filtered.length){box.innerHTML='<div class="card"><div class="empty">Nenhum contato encontrado com os filtros atuais.</div></div>';return}
 box.innerHTML=filtered.map(g=>{
  const badge=g.status==='verificado_manual'?'<span class="badge good">✅ Confirmado manualmente</span>':
   g.status==='confirmado'?'<span class="badge good">✔ Confirmado por várias fontes</span>':
   g.status==='conflito'?'<span class="badge hot">⚠ Conflito — revisar números</span>':
   g.status==='sem_contato'?'<span class="badge mid">Sem contato · revisar</span>':'<span class="badge mid">Registro único</span>';
  const best=g.best?`<a class="contact-btn phone" href="tel:+55${esc(g.best.digits)}">${esc(g.best.raw||g.best.digits)}</a>${g.best.isMobile?` <a class="contact-btn whatsapp" href="https://wa.me/55${esc(g.best.digits)}" target="_blank" rel="noopener noreferrer">WhatsApp ↗</a>`:''}`:'<span class="small">Sem telefone capturado</span>';
  const loc=[g.neighborhood,g.city].filter(Boolean).join(' — ')||'Localização não informada';
  const addr=(g.address||g.cep)?`<div class="small">${esc(g.address||'')}${g.address&&g.cep?' · ':''}${esc(g.cep||'')}</div>`:'';
  const options=g.phones.length>1?`<div class="small" style="margin-top:6px">Outras opções: ${g.phones.map(ph=>`<button class="secondary" style="margin:2px" onclick="setContactOverride('${g.id}','${ph.digits}')">${esc(ph.raw||ph.digits)} (${ph.sources.length} fonte${ph.sources.length===1?'':'s'})</button>`).join(' ')}</div>`:'';
  const confirm=g.best&&g.status!=='verificado_manual'?`<button class="contact-confirm-btn" onclick="confirmContactManually('${g.id}')">✓ Confirmar telefone</button>`:'';
  const list=g.members.map(m=>{const u=safeHttpUrl(m.url);return `<li>${esc(m.kind)} · ${esc(m.source||'—')}${u?` · <a href="${esc(u)}" target="_blank" rel="noopener noreferrer">abrir origem ↗</a>`:''}</li>`}).join('');
  return `<div class="card" style="margin-bottom:12px"><div class="section-head"><h3>${esc(g.name||g.title||'Lead sem nome')}</h3>${badge}</div><div class="small">${esc(loc)}</div>${addr}<div class="contact-check-actions">${best}${confirm}</div>${options}<details style="margin-top:8px"><summary class="small">${g.members.length} ocorrência(s) interligada(s)</summary><ul class="small">${list}</ul></details></div>`;
 }).join('')
}
function qaStatusMeta(status){
  const s=String(status||'').toLowerCase();
  if(s==='no_public_match_found')return {label:'Fora do QuintoAndar',cls:'qa-outside'};
  if(s==='found_on_quintoandar')return {label:'Já está no QuintoAndar',cls:'qa-found'};
  if(s==='inconclusive')return {label:'Verificação inconclusiva',cls:'qa-review'};
  if(s==='not_applicable')return {label:'Não se aplica · procura',cls:'qa-na'};
  return {label:'Aguardando checagem',cls:'qa-pending'};
}
function qaStatusHtml(status,url=''){
  const m=qaStatusMeta(status),safe=safeHttpUrl(url);
  const confirmed=String(status||'').toLowerCase()==='found_on_quintoandar';
  return `<span class="qa-pill ${m.cls}">${esc(m.label)}</span>${confirmed&&safe?`<a class="qa-link" href="${esc(safe)}" target="_blank" rel="noopener noreferrer">Ver mesmo imóvel ↗</a>`:''}${!confirmed&&String(status||'').toLowerCase()==='inconclusive'?`<small class="qa-unproven">Sem identidade comprovada</small>`:''}`;
}
function resolveGroupQa(g){
  const statuses=[...(g.qaStatuses||[])];
  const hasOffer=[...(g.modules||[])].some(m=>m==='Proprietários'||m==='Busca Profunda');
  if(!hasOffer)return 'not_applicable';
  if(statuses.includes('found_on_quintoandar'))return 'found_on_quintoandar';
  if(statuses.includes('no_public_match_found'))return 'no_public_match_found';
  if(statuses.includes('inconclusive'))return 'inconclusive';
  return 'pending';
}
function operationalLeadStatusLabel(statuses,isActive){
 if(isActive)return 'Ativo';
 const s=(statuses||[]).map(x=>String(x||'').toLowerCase());
 if(s.some(x=>x==='rejected_risk_area'))return 'Descartado · área de risco';
 if(s.some(x=>x==='rejected_wrong_region'))return 'Descartado · fora da região';
 if(s.some(x=>x==='rejected_quality'))return 'Descartado · baixa qualidade';
 if(s.some(x=>x==='inactive_source'))return 'Histórico · fonte desativada';
 if(s.some(x=>x==='inactive_supply_source'))return 'Histórico · fonte incompatível';
 if(s.some(x=>x==='expired_age'))return 'Expirado';
 if(s.some(x=>x.includes('rejected')))return 'Descartado';
 return 'Histórico';
}
function collectWhatsAppLeads(){
 return buildContactGroups(true).map(g=>{
  const best=g.best||null,phone=best?.digits||'',whatsapp=best?.isMobile?`https://wa.me/55${phone}`:'',
   modules=[...new Set(g.members.map(m=>m.kind).filter(Boolean))],sources=[...new Set(g.members.map(m=>m.source).filter(Boolean))],
   urls=[...new Set(g.members.map(m=>m.url).filter(Boolean))],subjects=[...new Set(g.members.map(m=>m.title).filter(Boolean))],
   regions=[...new Set(g.members.map(m=>m.city).filter(Boolean))],qaStatuses=[...new Set(g.members.map(m=>m.qaStatus).filter(Boolean))],
   qaUrls=[...new Set(g.members.filter(m=>m.qaStatus==='found_on_quintoandar').map(m=>m.qaMatchUrl).filter(Boolean))],
   hasOffer=modules.some(m=>m==='Proprietários'||m==='Busca Profunda'),
   qaStatus=!hasOffer?'not_applicable':qaStatuses.includes('found_on_quintoandar')?'found_on_quintoandar':qaStatuses.includes('no_public_match_found')?'no_public_match_found':qaStatuses.includes('inconclusive')?'inconclusive':'pending',
   contactState=whatsapp?'whatsapp':phone?'phone':'missing',
   leadState=g.isActive?'active':'historical',
   leadStatusLabel=operationalLeadStatusLabel(g.operationalStatuses,g.isActive);
  return {id:g.id,name:g.name||g.title||'Lead',module:modules.join(' + '),moduleList:modules,subject:subjects.slice(0,3).join(' | '),region:regions.join(' | '),
   source:sources.join(' + '),sourceUrls:urls,phone,whatsapp,date:g.members.map(m=>m.published_at).filter(Boolean).sort().reverse()[0]||'',
   qaStatus,qaMatchUrl:qaUrls[0]||'',contactState,verified:g.status==='verificado_manual',
   leadState,leadStatusLabel,operationalStatuses:g.operationalStatuses||[]};
 }).filter(x=>!ljiIsDiscarded(x)&&!ljiLooksProfessional(x)).sort((a,b)=>{
  if(a.leadState!==b.leadState)return a.leadState==='active'?-1:1;
  return (new Date(b.date).getTime()||0)-(new Date(a.date).getTime()||0)
 })
}
function whatsAppLeadRelevance(x){
  let score=0;
  if(x.leadState==='active')score+=30;
  if(x.contactState==='whatsapp')score+=22;else if(x.contactState==='phone')score+=12;
  if(x.verified)score+=14;
  if(isDashboardCoreRegion(x.region))score+=10;
  if(x.qaStatus==='no_public_match_found')score+=6;
  const d=x.date?new Date(x.date):null,ageHours=d&&!isNaN(d.getTime())?Math.max(0,(Date.now()-d.getTime())/36e5):999;
  score+=Math.max(0,18-Math.min(18,Math.round(ageHours/6)));
  return score;
}
function filteredWhatsAppLeads(){
 const q=(document.getElementById('waSearch')?.value||'').toLowerCase(),
  mod=document.getElementById('waModuleFilter')?.value||'',
  qa=document.getElementById('waQaFilter')?.value||'',
  contact=document.getElementById('waContactFilter')?.value||'',
  leadState=document.getElementById('waLeadStatusFilter')?.value||'',
  sortBy=document.getElementById('waSortFilter')?.value||'recent';
 const rows=collectWhatsAppLeads().filter(x=>
  (!mod||x.moduleList.includes(mod))&&(!qa||x.qaStatus===qa)&&(!contact||x.contactState===contact)&&(!leadState||x.leadState===leadState)&&
  (!q||[x.name,x.subject,x.region,x.source,x.phone,x.leadStatusLabel,qaStatusMeta(x.qaStatus).label].join(' ').toLowerCase().includes(q))
 );
 if(sortBy==='relevant')return rows.sort((a,b)=>whatsAppLeadRelevance(b)-whatsAppLeadRelevance(a));
 return rows;
}
function whatsappExportRows(){return filteredWhatsAppLeads().map(x=>({
 'Status operacional':x.leadStatusLabel,'Módulo(s)':x.module,'Lead':x.name,'Imóvel / procura':x.subject,'Região':x.region,'Origem':x.source,
 'Telefone':x.phone,'WhatsApp':x.whatsapp,'Status contato':x.contactState==='whatsapp'?'WhatsApp disponível':x.contactState==='phone'?'Telefone sem WhatsApp':'Sem contato · revisar',
 'Confirmado manualmente':x.verified?'Sim':'Não','Data de publicação':publicationValue(x.date),'QuintoAndar':qaStatusMeta(x.qaStatus).label,
 'Link correspondência QuintoAndar':x.qaStatus==='found_on_quintoandar'?(x.qaMatchUrl||''):'','Links de origem':x.sourceUrls.join(' | ')
}))}
function exportWhatsAppExcel(){const rows=whatsappExportRows();if(!rows.length){toast('Nenhum lead com WhatsApp neste filtro.');return}saveWorkbook(rows,`LJ-Radar-Imob-Leads-WhatsApp-${new Date().toISOString().slice(0,10)}.xlsx`)}
function exportWhatsAppPdf(){exportRowsPdf(whatsappExportRows(),'LJ Radar Imob — Leads com WhatsApp',`LJ-Radar-Imob-Leads-WhatsApp-${new Date().toISOString().slice(0,10)}.pdf`)}
// Marcadores de anunciante profissional. "Leads 5ºAndar" existe para captar
// PROPRIETÁRIO; corretor, imobiliária e incorporadora não servem ao propósito
// da tela e só consomem tempo de quem vai ligar.
const LJI_PRO_MARKERS=/\b(imobiliaria|corretor|corretora|creci|incorporadora|incorporacoes|construtora|empreendimentos|consultoria imobiliari|negocios imobiliari|assessoria imobiliari|imoveis ltda|perfeito imoveis|w invest)\b/;

// Texto de divulgação profissional: hashtag de marketing imobiliário, chamada de
// engajamento e crédito de produção. Proprietário anunciando o próprio imóvel
// não escreve assim.
const LJI_MARKETING_MARKERS=/(#(?:vendadeimoveis|dicasdeimoveis|venderrapido|imobiliaria|casaavenda|dicasdevenda|marketingimobiliario|corretordeimoveis|imoveisavenda)|assiste ate o final|arrasta pra cima|link na bio|chama no direct|marque um amigo|reportagem e captacao|edicao:\s*@|quer vender sua casa rapido)/;

// "Cobertura" também é cobertura de bolo; "planta" também é planta de jardim.
// Sem esta checagem, receita e post de decoração entram como imóvel.
const LJI_FOOD_MARKERS=/\b(receita|ingredientes|xicara|xicaras|colher de sopa|colheres|fermento em po|leite condensado|creme de leite|acucar|manteiga|assar|forno preaquecido|bata o acucar|despeje|massa homogenea|leve ao forno)\b/;

function ljiLooksFoodOrOffTopic(txt){
 const hits=(txt.match(LJI_FOOD_MARKERS)||[]).length;
 // Um termo isolado pode ser coincidência ("apartamento com forno embutido").
 // Três ou mais indicam que o texto é, de fato, uma receita.
 return hits>=3;
}

// Título no plural ("Apartamentos para alugar", "Casas de vila", "Kitnets...")
// é catálogo/portal, não uma pessoa anunciando o próprio imóvel — dono nunca
// descreve o que tem para oferecer no plural logo no início do título.
const LJI_PLURAL_CATALOG=/^(apartamentos|casas|kitnets|im[oó]veis|coberturas|sobrados|studios)\s+(para|à|a|de|no|na|em|dispon[ií]veis)/i;

// "| NomeDaMarca" no fim do título, ou dois ou mais "|" no texto encadeando
// ofertas diferentes — assinatura de página de portal/agregador.
const LJI_TITLE_BRAND_SUFFIX=/\|\s*[A-ZÀ-Ú][\wÀ-ú&]+\s*$/;
function ljiChainedListings(txt){return (String(txt||'').match(/\|/g)||[]).length>=2}

// Código/referência interna de anúncio ("CÓDIGO: 13797", "REF: 19999") — só
// imobiliária/CRM usa isso; proprietário não numera o próprio anúncio.
const LJI_LISTING_CODE=/\b(c[oó]digo|cod\.?|ref\.?|refer[eê]ncia)\s*:?\s*\d{3,}\b/i;

// Texto publicitário genérico de imobiliária/IA — cada frase isolada pode
// aparecer num post de dono também, mas duas ou mais juntas são a marca
// registrada de copy templada, não de gente descrevendo o próprio imóvel.
const LJI_AD_COPY_MARKERS=/(excelente custo-beneficio|distribuicao dos ambientes|garantindo qualidade de vida|representando uma oportunidade|oferecendo praticidade e conforto|ideal para quem busca|nao perca essa oportunidade|agende sua visita|interessados podem entrar em contato|pronto para morar|localizacao privilegiada|excelente localizacao|otima localizacao|conheca este imovel|entre em contato conosco|solicite mais informacoes)/g;
function ljiLooksLikeAdCopy(txt){return ((txt.match(LJI_AD_COPY_MARKERS)||[]).length)>=2}

// Lista negra manual: nomes que você marcar como lead ruim.
// Editável em Configurações → nomes bloqueados (ou aqui, um por linha).
let LJI_NOMES_BLOQUEADOS=[];
function ljiCarregarNomesBloqueados(){
 try{const v=window.LJI_CONFIG?.BLOCKED_NAMES;if(Array.isArray(v))LJI_NOMES_BLOQUEADOS=v.map(n=>normalizePlain(n)).filter(Boolean)}catch(e){}
}
function ljiNomeBloqueado(nome){
 if(!LJI_NOMES_BLOQUEADOS.length)return false;
 const n=normalizePlain(nome||'');
 return LJI_NOMES_BLOQUEADOS.some(b=>b&&n.includes(b));
}
// Páginas de categoria/busca de portal — não são anúncio de uma unidade.
const LJI_CATALOG_MARKERS=/(imoveis-seo|\/blog\/|\/busca|\/search|\/categoria|apartamentos (?:a venda|para alugar|ate)|imoveis que aceitam|kitnets \/ lofts|fale conosco)/;
function ljiLooksProfessional(x){
 const nomeOriginal=String(x.name||'');
 const txt=[x.name,x.subject,x.source,(x.sourceUrls||[]).join(' ')].join(' ')
   .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 return LJI_PRO_MARKERS.test(txt)
     || LJI_CATALOG_MARKERS.test(txt)
     || LJI_MARKETING_MARKERS.test(txt)
     || LJI_LISTING_CODE.test(txt)
     || LJI_PLURAL_CATALOG.test(nomeOriginal.trim())
     || LJI_TITLE_BRAND_SUFFIX.test(nomeOriginal.trim())
     || ljiChainedListings(x.name)||ljiChainedListings(x.subject)
     || ljiLooksLikeAdCopy(txt)
     || ljiLooksFoodOrOffTopic(txt)
     || ljiNomeBloqueado(x.name);
}
// Blocos de texto muito longos (post inteiro do Instagram) estouravam a largura
// da tabela. Mostra um resumo; o texto completo fica no title e na exportação.
function ljiResumo(txt,limite=220){
 const t=String(txt||'').replace(/\s+/g,' ').trim();
 if(!t)return '—';
 return t.length<=limite?t:t.slice(0,limite).replace(/\s+\S*$/,'')+'…';
}
function ljiCelulaTexto(txt){
 const t=String(txt||'').replace(/\s+/g,' ').trim();
 if(!t)return '—';
 return `<span class="cell-clamp" title="${esc(t)}">${esc(ljiResumo(t))}</span>`;
}
function collectParaQuintoAndarLeads(){
 return collectWhatsAppLeads().filter(x=>x.leadState==='active'&&x.qaStatus==='no_public_match_found'&&!ljiLooksProfessional(x))
  .sort((a,b)=>{
   const rank=v=>v==='whatsapp'?0:v==='phone'?1:2,r=rank(a.contactState)-rank(b.contactState);
   if(r)return r;
   return (new Date(b.date).getTime()||0)-(new Date(a.date).getTime()||0);
  });
}
function filteredParaQuintoAndarLeads(){
 const q=(document.getElementById('pqaSearch')?.value||'').toLowerCase(),
  contact=document.getElementById('pqaContactFilter')?.value||'';
 return collectParaQuintoAndarLeads().filter(x=>
  (!contact||x.contactState===contact)&&
  (!q||[x.name,x.subject,x.region,x.source,x.phone].join(' ').toLowerCase().includes(q))
 );
}
function pqaFilterByContact(state){
 const sel=document.getElementById('pqaContactFilter');
 if(!sel)return;
 // Clicar de novo no mesmo card limpa o filtro.
 sel.value=(sel.value===state&&state)?'':state;
 renderParaQuintoAndar();
 document.getElementById('paraQuintoAndarTable')?.scrollIntoView({behavior:'smooth',block:'start'});
}
window.pqaFilterByContact=pqaFilterByContact;
function paraQuintoAndarSeenIds(){try{return new Set(JSON.parse(localStorage.getItem('lji_para_qa_seen')||'[]'))}catch(e){return new Set()}}
function markParaQuintoAndarSeen(){
 const ids=collectParaQuintoAndarLeads().map(x=>x.id).filter(Boolean);
 localStorage.setItem('lji_para_qa_seen',JSON.stringify(ids));
 renderParaQuintoAndar();
}
window.markParaQuintoAndarSeen=markParaQuintoAndarSeen;
function paraQuintoAndarExportRows(){return filteredParaQuintoAndarLeads().map(x=>({
 'Lead':x.name,'Imóvel / procura':x.subject,'Região':x.region,'Origem':x.source,'Telefone':x.phone,'WhatsApp':x.whatsapp,
 'Status contato':x.contactState==='whatsapp'?'WhatsApp disponível':x.contactState==='phone'?'Telefone sem WhatsApp':'Sem contato · revisar',
 'Data de publicação':publicationValue(x.date),'Links de origem':x.sourceUrls.join(' | ')
}))}
function exportParaQuintoAndarExcel(){const rows=paraQuintoAndarExportRows();if(!rows.length){toast('Nenhum lead fora do QuintoAndar neste filtro.');return}saveWorkbook(rows,`LJ-Radar-Imob-Para-QuintoAndar-${new Date().toISOString().slice(0,10)}.xlsx`)}
function exportParaQuintoAndarPdf(){exportRowsPdf(paraQuintoAndarExportRows(),'LJ Radar Imob — Para o QuintoAndar',`LJ-Radar-Imob-Para-QuintoAndar-${new Date().toISOString().slice(0,10)}.pdf`)}
function renderParaQuintoAndar(){
 const all=collectParaQuintoAndarLeads(),rows=filteredParaQuintoAndarLeads(),set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v};
 const seen=paraQuintoAndarSeenIds(),novos=all.filter(x=>x.id&&!seen.has(x.id));
 set('pqaTotal',all.length);
 set('pqaWhatsapp',all.filter(x=>x.contactState==='whatsapp').length);
 set('pqaPhone',all.filter(x=>x.contactState==='phone').length);
 set('pqaMissing',all.filter(x=>x.contactState==='missing').length);
 const activeContact=document.getElementById('pqaContactFilter')?.value||'';
 document.querySelectorAll('#para-quinto-andar .kpi-clickable').forEach(card=>{
  const target=(card.getAttribute('onclick')||'').match(/pqaFilterByContact\('([^']*)'\)/);
  card.classList.toggle('is-active',Boolean(target)&&target[1]===activeContact);
 });
 const nav=document.getElementById('paraQaNavCount');if(nav)nav.textContent=novos.length?String(novos.length):'';
 const mtQa=document.getElementById('mtQaBadge');if(mtQa){mtQa.textContent=novos.length?String(novos.length):'';mtQa.classList.toggle('show',novos.length>0)}
 const mt=document.getElementById('mtQaBadge');if(mt){mt.textContent=novos.length?String(novos.length):'';mt.classList.toggle('show',novos.length>0)}
 const banner=document.getElementById('paraQaBanner');
 if(banner){
  if(novos.length){banner.classList.remove('is-empty');banner.textContent=`${novos.length} lead${novos.length===1?'':'s'} novo${novos.length===1?'':'s'} fora do QuintoAndar desde a última visita.`;}
  else{banner.classList.add('is-empty');banner.textContent='Nenhum lead novo desde a última visita.';}
 }
 const box=document.getElementById('paraQuintoAndarTable');if(!box)return;
 if(!rows.length){box.innerHTML='<div class="empty">Nenhum imóvel fora do QuintoAndar neste filtro.</div>';return}
 box.innerHTML=`<div class="sel-bar" id="selBarPqa" hidden><strong id="selCountPqa">0 leads selecionados</strong><div class="sel-bar-actions"><button class="secondary" onclick="ljiClearSelection('Pqa')">Limpar seleção</button><button class="lead-discard lead-discard-bulk" onclick="discardSelectedLeads('Pqa')">Descartar selecionados</button></div></div><table><thead><tr><th class="sel-col"><input type="checkbox" id="selAllPqa" onchange="ljiToggleAll('Pqa',this.checked)" title="Selecionar todos"></th><th>Lead</th><th>Imóvel / procura</th><th>Região</th><th>Origem</th><th>Data</th><th>Contato</th><th>Origem do anúncio</th><th></th></tr></thead><tbody>${rows.map(x=>{
  const isNew=x.id&&!seen.has(x.id);
  return `<tr class="${isNew?'para-qa-priority':''}">
   <td class="sel-col"><input type="checkbox" class="lead-check" data-scope="Pqa" data-lead-id="${esc(x.id)}" onchange="ljiUpdateSelectionBar('Pqa')"></td>
   <td><strong class="cell-clamp cell-clamp-name" title="${esc(x.name)}">${esc(ljiResumo(x.name,90))}</strong>${isNew?' <span class="badge hot">Novo</span>':''}</td>
   <td>${ljiCelulaTexto(x.subject)}</td><td>${ljiCelulaTexto(x.region)}</td><td>${esc(x.source||'—')}</td>
   <td><span class="publication-date">${esc(publicationValue(x.date))}</span></td>
   <td>${x.whatsapp?`<a class="wa-ready" href="${esc(x.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>`:x.phone?`<a class="contact-btn phone" href="tel:+55${esc(x.phone)}">Ligar</a>`:'<span class="contact-needs-review">Sem contato · buscar</span>'}</td>
   <td>${x.sourceUrls.length?x.sourceUrls.map((u,i)=>`<a class="source-action" href="${esc(u)}" target="_blank" rel="noopener">Origem ${i+1} ↗</a>`).join(' '):'—'}</td>
   <td><button class="lead-discard" title="Descartar — não volta a aparecer" onclick="discardLead('${esc(x.id)}')">Descartar</button></td>
  </tr>`;
 }).join('')}</tbody></table>`;
}
function renderWhatsAppLeads(){
 const all=collectWhatsAppLeads(),rows=filteredWhatsAppLeads(),set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v};
 const ready=all.filter(x=>x.leadState==='active'&&x.contactState==='whatsapp');
 const historicalWithContact=all.filter(x=>x.leadState==='historical'&&(x.contactState==='whatsapp'||x.contactState==='phone'));
 set('waTotal',ready.length);
 set('waOwners',ready.filter(x=>x.moduleList.some(m=>m==='Proprietários'||m==='Busca Profunda')).length);
 set('waIntentions',ready.filter(x=>x.moduleList.includes('Radar de Intenção')).length);
 set('waOutsideQa',all.filter(x=>x.leadState==='active'&&x.qaStatus==='no_public_match_found').length);
 set('waHistoricalCount',historicalWithContact.length);
 set('waIntentLoaded',(buyerIntentions||[]).length);
 set('waIntentPhoneCount',(buyerIntentions||[]).filter(i=>phoneDigitsNorm(i.contact||'').length>=8).length);
 set('gWhatsAppHistory',all.filter(x=>x.contactState==='whatsapp').length);
 const nav=document.getElementById('whatsappNavCount');if(nav)nav.textContent=String(ready.length);
 const mtWa=document.getElementById('mtWaBadge');if(mtWa){mtWa.textContent=ready.length?String(ready.length):'';mtWa.classList.toggle('show',ready.length>0)}
 const box=document.getElementById('whatsappLeadsTable');if(!box)return;
 if(!rows.length){box.innerHTML='<div class="empty">Nenhum lead neste filtro.</div>';return}
 const contactCell=x=>{
   if(x.leadState==='active'){
     if(x.whatsapp) return `<a class="wa-ready" href="${esc(x.whatsapp)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>`;
     if(x.phone) return `<a class="contact-btn phone" href="tel:+55${esc(x.phone)}">Ligar</a>`;
     return '<span class="contact-needs-review">Sem contato · revisar</span>';
   }
   if(x.operationalStatuses.includes('rejected_risk_area')) return '<span class="historical-only-label">Histórico · área de risco</span>';
   if(x.whatsapp) return `<a class="wa-history-ready" href="${esc(x.whatsapp)}" target="_blank" rel="noopener noreferrer">WhatsApp · histórico</a>`;
   if(x.phone) return `<a class="contact-btn phone" href="tel:+55${esc(x.phone)}">Ligar · histórico</a>`;
   return '<span class="historical-only-label">Histórico</span>';
 };
 const sourceLinks=x=>{
   const urls=x.sourceUrls.map(safeHttpUrl).filter(Boolean);
   return urls.length?urls.map((u,i)=>`<a class="source-action" href="${esc(u)}" target="_blank" rel="noopener noreferrer">Origem ${i+1} ↗</a>`).join(' '):'—';
 };
 const tableRows=rows.map(x=>`<tr class="${x.leadState==='historical'?'historical-contact-row':''}">
  <td class="sel-col"><input type="checkbox" class="lead-check" data-scope="Wa" data-lead-id="${esc(x.id)}" onchange="ljiUpdateSelectionBar('Wa')"></td>
  <td>${x.leadState==='active'?'<span class="badge good">Ativo</span>':`<span class="badge mid">${esc(x.leadStatusLabel)}</span>`}</td>
  <td><strong class="cell-clamp cell-clamp-name" title="${esc(x.name)}">${esc(ljiResumo(x.name,90))}</strong>${x.verified?'<br><span class="manual-verified">✓ confirmado</span>':''}</td>
  <td><span class="badge good">${esc(x.module)}</span></td>
  <td>${ljiCelulaTexto(x.subject)}</td><td>${ljiCelulaTexto(x.region)}</td><td>${esc(x.source||'—')}</td>
  <td>${x.phone?`<span class="wa-phone">${esc(x.phone)}</span>`:'<span class="contact-needs-review">Sem número</span>'}</td>
  <td><span class="publication-date">${esc(publicationValue(x.date))}</span></td><td>${qaStatusHtml(x.qaStatus,x.qaMatchUrl)}</td>
  <td>${contactCell(x)}</td>
  <td>${sourceLinks(x)}</td>
  <td><button class="lead-discard" title="Descartar — não volta a aparecer" onclick="discardLead('${esc(x.id)}')">Descartar</button></td>
 </tr>`).join('');
 const cards=rows.map(x=>`<article class="m-card ${x.leadState==='historical'?'m-card-muted':''}">
   <div class="m-card-top">
     <strong>${esc(x.name||'Lead')}${x.verified?' <span class="manual-verified">✓</span>':''}</strong>
     ${x.leadState==='active'?'<span class="badge good">Ativo</span>':`<span class="badge mid">${esc(x.leadStatusLabel||'Histórico')}</span>`}
   </div>
   <div class="m-card-meta">${esc(x.subject||'—')}</div>
   <div class="m-card-specs"><span class="badge good">${esc(x.module||'')}</span> ${esc(x.region||'')} · ${esc(x.source||'')}</div>
   <div class="m-card-row">${x.phone?`<span class="wa-phone">${esc(x.phone)}</span>`:'<span class="contact-needs-review">Sem número</span>'} · <span class="publication-date">${esc(publicationValue(x.date))}</span></div>
   <div class="m-card-row">${qaStatusHtml(x.qaStatus,x.qaMatchUrl)}</div>
   <div class="m-card-actions m-card-actions-primary">${contactCell(x)} ${sourceLinks(x)}</div>
   <div class="m-card-actions m-card-select">
     <label class="sel-label"><input type="checkbox" class="lead-check" data-scope="Wa" data-lead-id="${esc(x.id)}" onchange="ljiUpdateSelectionBar('Wa')"> Selecionar</label>
     <button class="lead-discard" onclick="discardLead('${esc(x.id)}')">Descartar</button>
   </div>
 </article>`).join('');
 box.innerHTML=`<div class="desktop-table-wrap"><table><thead><tr><th class="sel-col"><input type="checkbox" id="selAllWa" onchange="ljiToggleAll('Wa',this.checked)" title="Selecionar todos"></th><th>Status</th><th>Lead</th><th>Módulo(s)</th><th>Imóvel / procura</th><th>Região</th><th>Origem</th><th>Telefone</th><th>Data de publicação</th><th>QuintoAndar</th><th>Contato</th><th>Fonte</th><th></th></tr></thead><tbody>${tableRows}</tbody></table></div><div class="mobile-card-list">${cards}</div>`;
}

const LJI_BUYER_NEIGHBORHOODS={
 'Santo André':['Centro','Bairro Jardim','Campestre','Vila Assunção','Vila Bastos','Utinga','Parque das Nações','Vila Pires','Vila Gilda','Vila Valparaíso','Casa Branca','Camilópolis'],
 'São Bernardo do Campo':['Centro','Rudge Ramos','Nova Petrópolis','Baeta Neves','Assunção','Demarchi','Paulicéia','Anchieta','Jardim do Mar','Independência','Planalto','Taboão'],
 'São Caetano do Sul':['Centro','Barcelona','Santa Paula','Santo Antônio','Cerâmica','Olímpico','Nova Gerty','Fundação','Oswaldo Cruz','Boa Vista','Prosperidade','Mauá'],
 'Diadema':['Centro','Eldorado','Serraria','Piraporinha','Conceição','Casa Grande','Campanário','Canhema','Taboão','Vila Nogueira'],
 'São Paulo — Centro':['Centro','Sé','República','Bela Vista','Consolação','Liberdade','Cambuci','Santa Cecília','Bom Retiro','Brás','Pari','Aclimação','Higienópolis'],
 'São Paulo — Zona Sul':['Moema','Vila Mariana','Saúde','Jabaquara','Campo Belo','Brooklin','Santo Amaro','Chácara Santo Antônio','Interlagos','Ipiranga','Sacomã','Vila Clementino','Morumbi','Campo Limpo'],
 'São Paulo — Zona Leste':['Tatuapé','Mooca','Vila Prudente','Penha','Carrão','Itaquera','Vila Formosa','São Mateus','Vila Matilde','Anália Franco','Aricanduva','Belém'],
 'São Paulo — Zona Oeste':['Pinheiros','Perdizes','Lapa','Pompeia','Vila Madalena','Alto de Pinheiros','Butantã','Vila Romana','Jaguaré','Sumaré','Barra Funda'],
 'São Paulo — Zona Norte':['Santana','Tucuruvi','Vila Guilherme','Casa Verde','Mandaqui','Parada Inglesa','Jardim São Paulo','Jaçanã','Tremembé','Limão','Imirim','Vila Maria']
};
const LJI_SP_NEIGHBORHOOD_REGION=new Map(Object.entries(LJI_BUYER_NEIGHBORHOODS)
 .filter(([region])=>region.startsWith('São Paulo —'))
 .flatMap(([region,items])=>items.map(n=>[matchNeighborhoodNorm(n),region])));
function canonicalBuyerRegion(v){
 const n=matchNorm(v);
 if(!n)return'';
 if(n.includes('santo andre'))return'Santo André';
 if(n.includes('sao bernardo'))return'São Bernardo do Campo';
 if(n.includes('sao caetano'))return'São Caetano do Sul';
 if(n==='diadema'||n.includes(' diadema'))return'Diadema';
 if(n.includes('sao paulo')){
  if(n.includes('centro'))return'São Paulo — Centro';
  if(n.includes('zona sul'))return'São Paulo — Zona Sul';
  if(n.includes('zona leste'))return'São Paulo — Zona Leste';
  if(n.includes('zona oeste'))return'São Paulo — Zona Oeste';
  if(n.includes('zona norte'))return'São Paulo — Zona Norte';
 }
 return String(v||'').trim();
}
function buyerSpRegionFit(buyerCity,ownerNeighborhood){
 const region=canonicalBuyerRegion(buyerCity);
 if(!region.startsWith('São Paulo —')||!ownerNeighborhood)return null;
 const n=matchNeighborhoodNorm(ownerNeighborhood);
 let ownerRegion=LJI_SP_NEIGHBORHOOD_REGION.get(n)||'';
 if(!ownerRegion){
   for(const [neighborhood,r] of LJI_SP_NEIGHBORHOOD_REGION.entries()){
     if(n.includes(neighborhood)||neighborhood.includes(n)){ownerRegion=r;break}
   }
 }
 return ownerRegion?ownerRegion===region:null;
}
function refreshIntentNeighborhoodOptions(){
 const list=document.getElementById('ljiIntentNeighborhoodOptions');if(!list)return;
 const region=canonicalBuyerRegion(document.getElementById('iRegion')?.value||'');
 const values=[...(LJI_BUYER_NEIGHBORHOODS[region]||[])];
 list.innerHTML=values.filter(Boolean).sort((a,b)=>a.localeCompare(b,'pt-BR')).map(n=>`<option value="${esc(n)}"></option>`).join('');
}
function refreshBuyerNeighborhoodOptions(){
 const list=document.getElementById('ljiBuyerNeighborhoodOptions');if(!list)return;
 const city=document.getElementById('bCity')?.value||'';
 const region=canonicalBuyerRegion(city);
 const values=[...(LJI_BUYER_NEIGHBORHOODS[region]||[])];
 const add=v=>{const s=String(v||'').trim();if(s&&!values.some(x=>matchNeighborhoodNorm(x)===matchNeighborhoodNorm(s)))values.push(s)};
 (owners||[]).forEach(o=>{if(!city||matchCity(city,o.city)!==false)add(o.neighborhood)});
 (buyers||[]).forEach(b=>{if(!city||matchCity(city,b.city)!==false)add(b.neighborhood)});
 list.innerHTML=values.filter(Boolean).sort((a,b)=>a.localeCompare(b,'pt-BR')).map(n=>`<option value="${esc(n)}"></option>`).join('');
}
function knownOperationalCities(){
 const base=[
  'Santo André','São Bernardo do Campo','São Caetano do Sul','Diadema',
  'São Paulo — Centro','São Paulo — Zona Sul','São Paulo — Zona Leste','São Paulo — Zona Oeste','São Paulo — Zona Norte'
 ];
 const values=[...base];
 const push=v=>{const s=String(v||'').trim();if(s)values.push(s)};
 (owners||[]).forEach(x=>push(x.city));
 (buyers||[]).forEach(x=>push(x.city));
 (discoveredLeads||[]).forEach(x=>push(x.city));
 (buyerIntentions||[]).forEach(x=>{push(x.city);push(x.region)});
 (companyDemands||[]).forEach(x=>push(x.city));
 return [...new Set(values)].sort((a,b)=>a.localeCompare(b,'pt-BR'));
}
function refillCitySelect(id,placeholder){
 const el=document.getElementById(id);if(!el)return;
 const current=el.value;
 const cities=knownOperationalCities();
 el.innerHTML=`<option value="">${esc(placeholder)}</option>`+cities.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
 if(current&&cities.includes(current))el.value=current;
}
function refreshCitySelectors(){
 const cities=knownOperationalCities();
 const list=document.getElementById('ljiCityOptions');
 if(list)list.innerHTML=cities.map(c=>`<option value="${esc(c)}"></option>`).join('');
 refillCitySelect('ownerCity','Todas as regiões');
 refillCitySelect('dashRegion','Todas as regiões');
 refillCitySelect('intentRegionFilter','Todas as regiões');
 refreshBuyerNeighborhoodOptions();
}

function setIntegrationBadge(id,text,cls='mid'){
 const el=document.getElementById(id);if(!el)return;
 el.textContent=text;el.className=`badge ${cls}`;
}
function renderIntegrationStatus(){
 const backendStatus=String(document.getElementById('backendStatus')?.textContent||'');
 const hasSupabase=Boolean(window.LJI_BACKEND?.client);
 setIntegrationBadge('integrationSupabase',hasSupabase?'Conectado':backendStatus.includes('Falha')?'Falha':'Aguardando',hasSupabase?'good':backendStatus.includes('Falha')?'hot':'mid');

 const host=location.hostname||'';
 const hostDetail=document.getElementById('integrationHostingDetail');
 if(host.endsWith('.workers.dev')){
   setIntegrationBadge('integrationHosting','Cloudflare ativo','good');
   if(hostDetail)hostDetail.textContent='Cloudflare Workers · '+host;
 }else if(host.includes('netlify')){
   setIntegrationBadge('integrationHosting','Netlify ativo','good');
   if(hostDetail)hostDetail.textContent='Netlify · '+host;
 }else if(host&&host!=='localhost'){
   setIntegrationBadge('integrationHosting','Produção ativa','good');
   if(hostDetail)hostDetail.textContent='Domínio atual · '+host;
 }else{
   setIntegrationBadge('integrationHosting','Local','mid');
   if(hostDetail)hostDetail.textContent='Ambiente local';
 }

 const runs=window.LJI_ADMIN_STATE?.collectorRuns||[];
 const run=runs[0]||null;
 const searchDetail=document.getElementById('integrationSearchDetail');
 if(run){
   const when=run.created_at?new Date(run.created_at).toLocaleString('pt-BR'):'data não informada';
   if(run.status==='completed'){
     setIntegrationBadge('integrationSearch','Operacional','good');
   }else if(run.status==='partial'){
     setIntegrationBadge('integrationSearch','Parcial','mid');
   }else if(run.status==='failed'){
     setIntegrationBadge('integrationSearch','Falha externa','hot');
   }else{
     setIntegrationBadge('integrationSearch',String(run.status||'Aguardando'),'mid');
   }
   if(searchDetail)searchDetail.textContent=`Última execução ${when} · ${Number(run.total_new_results||0)} novo(s) · ${Number(run.total_errors||0)} erro(s)`;
 }else{
   setIntegrationBadge('integrationSearch','Sem execução','mid');
   if(searchDetail)searchDetail.textContent='Nenhuma execução real carregada nesta sessão';
 }

 const enriched=Number(intentSyncMeta?.enriched||0);
 setIntegrationBadge('integrationAi',enriched>0?'Backend ativo':'Não verificado',enriched>0?'good':'mid');

 const checked=document.getElementById('integrationCheckedAt');
 if(checked)checked.textContent='Atualizado '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
}

/* ==========================================================
   v22.37 — CENTRAL DE AÇÃO / NEXT BEST ACTION
   Usa somente dados reais já carregados no workspace.
   Não cria lead fictício e não depende de tabela nova.
   ========================================================== */
let actionCenterCache=[];
function actionHoursSince(value){
  if(!value)return null;
  const d=new Date(value);if(Number.isNaN(d.getTime()))return null;
  return Math.max(0,(Date.now()-d.getTime())/36e5);
}
function actionAgeLabel(value){
  const h=actionHoursSince(value);
  if(h===null)return 'data não informada';
  if(h<1)return `visto há ${Math.max(1,Math.round(h*60))} min`;
  if(h<24)return `visto há ${Math.round(h)}h`;
  const days=Math.floor(h/24);return `visto há ${days} dia${days===1?'':'s'}`;
}
function actionPriorityMeta(score){
  const n=Number(score||0);
  if(n>=90)return {key:'urgent',label:'Urgente',cls:'urgent'};
  if(n>=80)return {key:'high',label:'Alta',cls:'high'};
  return {key:'normal',label:'Normal',cls:'normal'};
}
function actionOwnerRefDate(o){return o?.last_seen_at||o?.published_at||o?.activity_date||o?.first_seen_at||o?.created_at||''}
function buildActionCenter(){
  const rows=[];
  const matchGroups=groupIntentMatches(matchFilteredRows(false));
  matchGroups.forEach(g=>{
    const m=g.base||{},best=Number(g.best||0);if(best<70)return;
    const contact=matchContact(m),when=m.intent_published_at||m.intent_captured_at||m.created_at||'';
    const age=actionHoursSince(when);
    let score=Math.min(100,best+(contact?.whatsapp?5:contact?.digits?2:0)+(age!==null&&age<=6?3:0));
    const p=actionPriorityMeta(score);
    const region=(g.regionList||[m.region]).filter(Boolean).join(' · ')||'Região não informada';
    const who=m.person_name||m.title||'Interessado';
    const propertyCount=g.items.length;
    const action=contact?.whatsapp?'Contatar comprador agora':contact?.digits?'Ligar para o interessado':'Abrir match e localizar contato';
    rows.push({
      id:`match:${matchPersonKey(m)}`,type:'match',priority:p.key,priorityLabel:p.label,priorityCls:p.cls,score,
      title:who,subtitle:`${m.transaction_type==='rent'?'Quer alugar':'Quer comprar'} ${m.desired_property_type||'imóvel'} · ${region}`,
      reason:`Match ${best}% · ${propertyCount} imóvel${propertyCount===1?'':'is'} compatível${propertyCount===1?'':'is'}${contact?.whatsapp?' · WhatsApp disponível':contact?.digits?' · telefone disponível':' · contato ainda não confirmado'}`,
      freshness:actionAgeLabel(when),source:matchSourceName(m.intent_source_name),actionLabel:action,
      primaryHref:contact?.whatsapp||'',primaryTel:!contact?.whatsapp&&contact?.digits?`tel:+55${contact.digits}`:'',primaryGo:contact?.whatsapp||contact?.digits?'':'matches',secondaryGo:'matches'
    });
  });

  const current=(Array.isArray(owners)?owners:[]).filter(o=>o?.is_current&&o?.status!=='rejected'&&!dashboardLooksProfessional(o)&&!dashboardLooksGenericPage(o));
  current.forEach(o=>{
    const contact=ownerContact(o),when=actionOwnerRefDate(o),age=actionHoursSince(when),rank=dashboardOpportunityRank(o);
    let type='',actionLabel='',reason='',primaryGo='',primaryHref='',primaryTel='',score=rank;
    if(!o.handled_by_user_id){
      type='assignment';actionLabel='Atribuir responsável';score=Math.min(100,rank+5);
      reason=`Oportunidade atual sem responsável${contact.wa?' · WhatsApp disponível':contact.phone?' · telefone disponível':''}`;
      primaryGo='owners';
    }else if(age!==null&&age>=24){
      type='revalidate';actionLabel=contact.wa?'Revalidar pelo WhatsApp':contact.phone?'Ligar e revalidar':'Revalidar disponibilidade';score=Math.min(100,Math.max(72,rank+(age>=72?8:4)));
      reason=`Último sinal confirmado ${actionAgeLabel(when).replace('visto ','')} · confirmar se o imóvel continua disponível`;
      if(contact.wa)primaryHref=contact.wa;else if(contact.phone)primaryTel=`tel:+55${contact.phone}`;else primaryGo='owners';
    }else if(!contact.phone&&rank>=68){
      type='verify';actionLabel='Verificar contato';score=Math.min(100,Math.max(70,rank));
      reason='Oportunidade atual com bom potencial, mas sem telefone/WhatsApp validado';primaryGo='contact-check';
    }else if(contact.phone&&(o.status==='hot'||rank>=82)){
      type='contact';actionLabel=contact.wa?'Contatar proprietário agora':'Ligar para o proprietário';score=Math.min(100,rank+(o.status==='hot'?6:0));
      reason=`Score operacional ${rank}${o.status==='hot'?' · marcado como quente':''}${contact.verified?' · contato confirmado':''}`;
      if(contact.wa)primaryHref=contact.wa;else primaryTel=`tel:+55${contact.phone}`;
    }else return;
    const p=actionPriorityMeta(score);
    rows.push({
      id:`owner:${o.id}`,ownerId:o.id,type,priority:p.key,priorityLabel:p.label,priorityCls:p.cls,score,
      title:o.contact_name||o.title||'Oportunidade',subtitle:`${o.title||'Imóvel'} · ${o.neighborhood?o.neighborhood+', ':''}${o.city||'Região não informada'}`,
      reason,freshness:actionAgeLabel(when),source:o.source||'Radar',actionLabel,primaryHref,primaryTel,primaryGo,secondaryGo:'owners'
    });
  });

  // Uma mesma oportunidade de proprietário recebe apenas a ação operacional mais importante.
  // Matches permanecem separados porque representam demanda/comprador diferente.
  const dedup=new Map();
  rows.forEach(r=>{
    const k=r.id;
    const prev=dedup.get(k);if(!prev||Number(r.score)>Number(prev.score))dedup.set(k,r);
  });
  return [...dedup.values()].sort((a,b)=>Number(b.score)-Number(a.score)||String(a.title).localeCompare(String(b.title),'pt-BR'));
}
function filteredActionCenter(){
  const q=(document.getElementById('actionSearch')?.value||'').toLowerCase().trim();
  const type=document.getElementById('actionTypeFilter')?.value||'';
  const priority=document.getElementById('actionPriorityFilter')?.value||'';
  return actionCenterCache.filter(a=>(!type||a.type===type)&&(!priority||a.priority===priority)&&(!q||[a.title,a.subtitle,a.reason,a.source,a.actionLabel].join(' ').toLowerCase().includes(q)));
}
function actionPrimaryHtml(a){
  if(a.primaryHref)return `<a class="action-primary" href="${esc(safeHttpUrl(a.primaryHref)||a.primaryHref)}" target="_blank" rel="noopener noreferrer">${esc(a.actionLabel)} →</a>`;
  if(a.primaryTel)return `<a class="action-primary" href="${esc(a.primaryTel)}">${esc(a.actionLabel)} →</a>`;
  if(a.primaryGo)return `<button class="action-primary" type="button" onclick="openActionDestination('${esc(a.primaryGo)}','${esc(a.ownerId||'')}')">${esc(a.actionLabel)} →</button>`;
  return `<button class="action-primary" type="button" onclick="go('${esc(a.secondaryGo||'dashboard')}')">${esc(a.actionLabel)} →</button>`;
}
function openActionDestination(page,ownerId){
  go(page);
  if(page==='owners'&&ownerId){
    const o=(owners||[]).find(x=>String(x.id)===String(ownerId));
    const input=document.getElementById('ownerSearch');
    if(input&&o){input.value=o.title||o.contact_name||o.city||'';renderOwners()}
  }
}
window.openActionDestination=openActionDestination;
function renderActionCenter(){
  actionCenterCache=buildActionCenter();
  const rows=filteredActionCenter();
  const all=actionCenterCache;
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v};
  const urgent=all.filter(a=>a.priority==='urgent').length;
  const high=all.filter(a=>a.score>=80).length;
  const unassigned=(owners||[]).filter(o=>o?.is_current&&o?.status!=='rejected'&&!o?.handled_by_user_id).length;
  const revalidate=all.filter(a=>a.type==='revalidate').length;
  set('acUrgent',urgent);set('acHigh',high);set('acUnassigned',unassigned);set('acRevalidate',revalidate);set('actionCenterCount',rows.length);set('dashActionCount',urgent||high||all.length);
  const nav=document.getElementById('actionCenterNavCount');if(nav)nav.textContent=urgent?String(urgent):high?String(high):all.length?String(all.length):'';
  const headline=document.getElementById('actionCenterHeadline'),sub=document.getElementById('actionCenterSubline');
  if(headline)headline.textContent=urgent?`${urgent} ação${urgent===1?'':'ões'} urgente${urgent===1?'':'s'} merece${urgent===1?'':'m'} atenção agora`:all.length?`${all.length} próxima${all.length===1?'':'s'} ação${all.length===1?'':'ões'} ordenada${all.length===1?'':'s'} pelo Radar`:'Nenhuma ação crítica neste momento';
  if(sub)sub.textContent=all.length?'A prioridade considera match, contato, recência, responsável e qualidade operacional.':'A base carregada não gerou pendências prioritárias agora.';
  const box=document.getElementById('actionCenterList');if(!box)return;
  if(!rows.length){box.innerHTML='<div class="empty">Nenhuma ação real corresponde a estes filtros.</div>';return}
  box.innerHTML=rows.map(a=>`<article class="action-row action-${esc(a.priorityCls)}">
    <div class="action-score"><strong>${Math.round(Number(a.score||0))}</strong><span>score</span></div>
    <div class="action-main">
      <div class="action-title-line"><span class="action-priority ${esc(a.priorityCls)}">${esc(a.priorityLabel)}</span><strong>${esc(a.title)}</strong></div>
      <div class="action-subtitle">${esc(a.subtitle)}</div>
      <div class="action-reason"><b>Por quê:</b> ${esc(a.reason)}</div>
      <div class="action-meta"><span>${esc(a.freshness)}</span><span>${esc(a.source||'Radar')}</span></div>
    </div>
    <div class="action-actions">${actionPrimaryHtml(a)}${a.secondaryGo?`<button class="action-secondary" type="button" onclick="openActionDestination('${esc(a.secondaryGo)}','${esc(a.ownerId||'')}')">Ver contexto</button>`:''}</div>
  </article>`).join('');
}
async function refreshActionCenterNow(){
  const headline=document.getElementById('actionCenterHeadline');if(headline)headline.textContent='Atualizando dados reais do Radar...';
  try{
    await Promise.allSettled([window.LJI_BACKEND?.sync?.(),window.syncIntentions?.()]);
    renderActionCenter();toast('Central de Ação atualizada.');
  }catch(e){console.error(e);renderActionCenter();toast('Atualização parcial; dados carregados foram preservados.');}
}
window.renderActionCenter=renderActionCenter;
window.refreshActionCenterNow=refreshActionCenterNow;

/* =========================================================
   v22.38 — PIPELINE COMERCIAL
   Persistência sem tabela nova: cada mudança de etapa é gravada
   em lji_activity_log como pipeline_stage_changed.
   ========================================================= */
const LJI_PIPELINE_STAGES=[
  {key:'new',label:'Novo',short:'Novo'},
  {key:'validated',label:'Validado',short:'Validado'},
  {key:'contacted',label:'Contatado',short:'Contatado'},
  {key:'replied',label:'Respondeu',short:'Respondeu'},
  {key:'qualified',label:'Qualificado',short:'Qualificado'},
  {key:'visit_scheduled',label:'Visita agendada',short:'Visita ag.'},
  {key:'visit_done',label:'Visita realizada',short:'Visita feita'},
  {key:'proposal',label:'Proposta',short:'Proposta'},
  {key:'negotiation',label:'Negociação',short:'Negociação'},
  {key:'won',label:'Ganho',short:'Ganho'},
  {key:'lost',label:'Perdido',short:'Perdido'}
];
function pipelineStageMeta(key){return LJI_PIPELINE_STAGES.find(x=>x.key===key)||LJI_PIPELINE_STAGES[0]}
function pipelineKey(type,id){return `${String(type||'lead')}:${String(id||'')}`}
function pipelineEvents(){return Array.isArray(window.LJI_ADMIN_STATE?.pipelineEvents)?window.LJI_ADMIN_STATE.pipelineEvents:[]}
function pipelineLatestMap(){
  const m=new Map();
  [...pipelineEvents()].filter(e=>e.event_type==='pipeline_stage_changed').sort((a,b)=>(new Date(b.created_at).getTime()||0)-(new Date(a.created_at).getTime()||0)).forEach(e=>{
    const k=pipelineKey(e.entity_type,e.entity_id);if(!m.has(k))m.set(k,e);
  });
  return m;
}
function pipelineLeadStage(entityType,entityId){return pipelineLatestMap().get(pipelineKey(entityType,entityId))?.details?.new_stage||'new'}
function pipelineBuyerContact(b){
  const raw=b?.contact||'',d=phoneDigits(raw);
  return {digits:d,whatsapp:whatsappFrom(raw)};
}
// Mesmo texto que corrige "Leads e WhatsApp"/"Leads 5ºAndar" — aqui aplicado
// direto nas fontes cruas (owners, buyerIntentions) porque a Central de Ação
// lê essas listas sem passar pelo pipeline já filtrado.
function ljiPipelineLooksProfessional(o){
 if(!o)return false;
 if(o.advertiser_classification==='broker')return true; // classificação que o próprio backend já fez
 const txt=[o.title,o.contact_name,o.description,o.person_name,o.source,o.source_name].filter(Boolean).join(' ')
   .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 return LJI_PRO_MARKERS.test(txt)||LJI_CATALOG_MARKERS.test(txt)||LJI_MARKETING_MARKERS.test(txt)||ljiLooksFoodOrOffTopic(txt);
}
function pipelineEntities(){
  const latest=pipelineLatestMap(),rows=[];
  (owners||[]).filter(o=>o?.is_current&&o?.status!=='rejected'&&!ljiPipelineLooksProfessional(o)).forEach(o=>{
    const id=o.opportunity_id||o.id;if(!id)return;
    const c=ownerContact(o),event=latest.get(pipelineKey('opportunity',id));
    rows.push({entityType:'opportunity',entityId:String(id),leadType:'Proprietário',title:o.contact_name||o.title||'Oportunidade',subtitle:o.title||'Imóvel',region:[o.neighborhood,o.city].filter(Boolean).join(' · ')||'Região não informada',source:o.source||'Radar',score:Number(dashboardOpportunityRank(o)||0),value:Number(o.price||0),contactHref:c.wa||'',contactTel:!c.wa&&c.phone?`tel:+55${c.phone}`:'',handledByName:o.handled_by_name||'',handledByUserId:o.handled_by_user_id||'',refDate:actionOwnerRefDate(o),stage:event?.details?.new_stage||'new',stageEvent:event,contextPage:'owners'});
  });
  (buyerIntentions||[]).filter(i=>i?.status==='active'&&!ljiPipelineLooksProfessional(i)).forEach(i=>{
    if(!i.id)return;const c=intentPublicContact(i),event=latest.get(pipelineKey('buyer_intent',i.id));
    rows.push({entityType:'buyer_intent',entityId:String(i.id),leadType:intentRole(i)==='seller'?'Intenção de proprietário':'Comprador captado',title:i.person_name||i.title||'Intenção',subtitle:`${intentActionLabel(i)} ${intentWantedType(i)}`,region:intentWantedLocation(i),source:i.source_name||'Radar de Intenção',score:Number(i.intent_score||0),value:Number(i.budget_max||0),contactHref:c?.whatsapp||'',contactTel:!c?.whatsapp&&c?.digits?`tel:+55${c.digits}`:'',handledByName:event?.details?.handled_by_name||'',handledByUserId:event?.details?.handled_by_user_id||'',refDate:i.published_at||i.captured_at||i.created_at||'',stage:event?.details?.new_stage||'new',stageEvent:event,contextPage:'intentions'});
  });
  (buyers||[]).forEach(b=>{
    if(!b.id)return;const c=pipelineBuyerContact(b),event=latest.get(pipelineKey('buyer',b.id));
    rows.push({entityType:'buyer',entityId:String(b.id),leadType:'Comprador cadastrado',title:b.name||'Comprador',subtitle:`Procura ${b.type||'imóvel'} · ${b.transaction_type==='rent'?'locação':'venda'}`,region:[b.neighborhood,b.city].filter(Boolean).join(' · ')||'Região não informada',source:b.source||'Cadastro interno',score:Math.min(100,45+Number(b.urgency||0)*10),value:Number(b.budget||0),contactHref:c.whatsapp||'',contactTel:!c.whatsapp&&c.digits?`tel:+55${c.digits}`:'',handledByName:event?.details?.handled_by_name||'',handledByUserId:event?.details?.handled_by_user_id||'',refDate:b.published_at||'',stage:event?.details?.new_stage||'new',stageEvent:event,contextPage:'buyers'});
  });
  // Negócios ganhos/perdidos não somem do histórico mesmo se a origem deixar de estar ativa.
  const existing=new Set(rows.map(x=>pipelineKey(x.entityType,x.entityId)));
  latest.forEach((e,k)=>{
    const d=e.details||{},stage=d.new_stage;if(existing.has(k)||!['won','lost'].includes(stage))return;
    rows.push({entityType:e.entity_type,entityId:String(e.entity_id||''),leadType:d.lead_type||'Lead',title:d.title||'Lead histórico',subtitle:d.subtitle||'Registro comercial',region:d.region||'Região não informada',source:d.source||'Histórico',score:Number(d.score||0),value:Number(d.value||0),contactHref:'',contactTel:'',handledByName:d.handled_by_name||'',handledByUserId:d.handled_by_user_id||'',refDate:e.created_at||'',stage,stageEvent:e,contextPage:'history',historical:true});
  });
  return rows;
}
function pipelineCommercialIntel(x){
  // Score explicável: usa somente sinais reais já existentes no registro e no histórico comercial.
  let score=Math.max(0,Math.min(100,Number(x.score||0)));
  const reasons=[];
  if(x.contactHref||x.contactTel){score+=12;reasons.push('contato disponível')}else{score-=15;reasons.push('sem contato validado')}
  if(x.handledByUserId){score+=5;reasons.push('responsável definido')}
  const stageBoost={new:0,validated:5,contacted:8,replied:14,qualified:20,visit_scheduled:24,visit_done:27,proposal:31,negotiation:35,won:40,lost:-40};
  score+=stageBoost[x.stage]||0;
  const ageDays=x.refDate?Math.max(0,(Date.now()-new Date(x.refDate).getTime())/86400000):null;
  if(ageDays!==null&&Number.isFinite(ageDays)){if(ageDays<=7){score+=8;reasons.push('recente')}else if(ageDays>90){score-=10;reasons.push('registro antigo')}}
  score=Math.round(Math.max(0,Math.min(100,score)));
  let action='Revisar dados e definir próximo passo';
  if(x.stage==='won')action='Fechamento concluído · manter histórico';
  else if(x.stage==='lost')action='Perdido · manter motivo e histórico';
  else if(!x.contactHref&&!x.contactTel)action='Localizar e validar um contato direto';
  else if(['new','validated'].includes(x.stage))action='Fazer primeiro contato agora';
  else if(x.stage==='contacted')action='Cobrar resposta e registrar retorno';
  else if(x.stage==='replied')action='Qualificar orçamento, prazo e requisitos';
  else if(x.stage==='qualified')action='Apresentar melhores matches e propor visita';
  else if(x.stage==='visit_scheduled')action='Confirmar visita e preparar argumentos';
  else if(x.stage==='visit_done')action='Pedir feedback e avançar para proposta';
  else if(x.stage==='proposal')action='Acompanhar proposta e objeções';
  else if(x.stage==='negotiation')action='Priorizar fechamento e registrar condição final';
  const priority=score>=80?'high':score>=60?'medium':'low';
  return {score,priority,action,reasons:reasons.slice(0,3)};
}
function pipelineFollowUpIntel(x){
  const events=pipelineEntityEvents(x.entityType,x.entityId);
  const last=events.find(e=>['sales_contact_logged','pipeline_stage_changed','sales_note_added'].includes(e.event_type));
  const base=last?.created_at||x.refDate||'';
  const days=base?Math.max(0,Math.floor((Date.now()-new Date(base).getTime())/86400000)):null;
  if(['won','lost'].includes(x.stage))return {due:false,level:'closed',days,message:'Sem follow-up pendente',script:''};
  const cadence={new:0,validated:0,contacted:2,replied:1,qualified:2,visit_scheduled:1,visit_done:1,proposal:1,negotiation:1};
  const limit=cadence[x.stage]??3;
  const due=days===null?true:days>=limit;
  const overdue=days===null?0:Math.max(0,days-limit);
  let message=due?'Follow-up necessário':'Acompanhamento em dia';
  if(due&&overdue>0)message=`Follow-up atrasado ${overdue} dia${overdue===1?'':'s'}`;
  const scripts={
    new:'Olá! Vi seu interesse e quero entender melhor o que você procura. Posso te fazer duas perguntas rápidas?',
    validated:'Olá! Separei seu contato para avançarmos. Ainda faz sentido conversar sobre essa oportunidade?',
    contacted:'Olá! Retomando nosso contato para não deixar sua busca parada. Posso te ajudar a avançar?',
    replied:'Obrigado pelo retorno. Para eu filtrar as melhores opções, qual faixa de valor e prazo você considera hoje?',
    qualified:'Encontrei opções compatíveis com o que você procura. Quer que eu te apresente as melhores agora?',
    visit_scheduled:'Olá! Confirmando nossa visita. Está tudo certo com o horário combinado?',
    visit_done:'Quero saber sua impressão sobre a visita. O que mais pesou positiva ou negativamente para você?',
    proposal:'Olá! Estou acompanhando sua proposta. Há algum ponto que precisamos ajustar para avançar?',
    negotiation:'Estamos na fase final. Qual condição falta resolver para conseguirmos fechar?'
  };
  return {due,level:due?(overdue>=3?'critical':'due'):'ok',days,overdue,message,script:scripts[x.stage]||'Olá! Retomando nosso contato para definirmos o próximo passo.'};
}
function copyPipelineFollowUp(type,id){
  const lead=pipelineEntities().find(x=>x.entityType===type&&String(x.entityId)===String(id));if(!lead)return;
  const f=pipelineFollowUpIntel(lead);if(!f.script)return;
  navigator.clipboard?.writeText(f.script).then(()=>toast('Mensagem de follow-up copiada.')).catch(()=>toast(f.script));
}
window.copyPipelineFollowUp=copyPipelineFollowUp;
function filteredPipelineEntities(){
  const q=(document.getElementById('pipelineSearch')?.value||'').toLowerCase().trim();
  const type=document.getElementById('pipelineTypeFilter')?.value||'';
  const stage=document.getElementById('pipelineStageFilter')?.value||'';
  const ownerFilter=document.getElementById('pipelineOwnerFilter')?.value||'';
  const priorityFilter=document.getElementById('pipelinePriorityFilter')?.value||'';
  const me=String(window.LJI_CURRENT_USER?.id||'');
  return pipelineEntities().filter(x=>{const intel=pipelineCommercialIntel(x);return (!type||x.entityType===type)&&(!stage||x.stage===stage)&&(!priorityFilter||intel.priority===priorityFilter)&&(!ownerFilter||(ownerFilter==='mine'&&me&&String(x.handledByUserId)===me)||(ownerFilter==='unassigned'&&!x.handledByUserId))&&(!q||[x.title,x.subtitle,x.region,x.source,x.leadType,x.handledByName].join(' ').toLowerCase().includes(q))});
}

function pipelineEntityEvents(type,id){
  return pipelineEvents().filter(e=>String(e.entity_type)===String(type)&&String(e.entity_id)===String(id)).sort((a,b)=>(new Date(b.created_at).getTime()||0)-(new Date(a.created_at).getTime()||0));
}
function pipelineEventLabel(e){
  if(e.event_type==='pipeline_stage_changed')return `Etapa: ${pipelineStageMeta(e.details?.old_stage).label} → ${pipelineStageMeta(e.details?.new_stage).label}`;
  if(e.event_type==='sales_note_added')return 'Nota comercial';
  if(e.event_type==='sales_contact_logged')return `Contato registrado${e.details?.channel?' · '+e.details.channel:''}`;
  if(e.event_type==='sales_agent_draft')return 'Abordagem do Agente Comercial';
  return e.event_type||'Atividade';
}
function pipeline360Html(lead){
  const intel=pipelineCommercialIntel(lead),events=pipelineEntityEvents(lead.entityType,lead.entityId);
  const priority=intel.priority==='high'?'Alta':intel.priority==='medium'?'Média':'Baixa';
  const timeline=events.length?events.map(e=>`<div class="sales360-event"><div><b>${esc(pipelineEventLabel(e))}</b><span>${esc(fmtDateTime(e.created_at))}</span></div>${e.details?.note?`<p>${esc(e.details.note)}</p>`:''}${e.details?.analysis_summary?`<p>${esc(e.details.analysis_summary)}</p>`:''}${e.details?.recommended_action?`<p><b>Próxima ação:</b> ${esc(e.details.recommended_action)}</p>`:''}${e.details?.loss_reason?`<p>Motivo da perda: ${esc(e.details.loss_reason)}</p>`:''}<small>${esc(e.details?.changed_by_name||e.details?.author_name||'Equipe LJ')}</small></div>`).join(''):'<div class="empty">Ainda não há memória comercial registrada para este lead.</div>';
  return `<div class="sales360-grid"><section><div class="sales360-hero"><span>${esc(lead.leadType)}</span><h2>${esc(lead.title)}</h2><p>${esc(lead.subtitle)} · ${esc(lead.region)}</p></div><div class="sales360-facts"><div><span>Score comercial</span><b>${intel.score}/100</b></div><div><span>Prioridade</span><b>${priority}</b></div><div><span>Etapa</span><b>${esc(pipelineStageMeta(lead.stage).label)}</b></div><div><span>Responsável</span><b>${esc(lead.handledByName||'Não atribuído')}</b></div></div><div class="pipeline-intel"><div class="pipeline-intel-head"><b>Próxima melhor ação</b><span>${intel.score}</span></div><div class="pipeline-intel-action">${esc(intel.action)}</div><div class="pipeline-intel-reason">${esc(intel.reasons.join(' · '))}</div></div><div class="sales360-compose"><textarea id="sales360Note" maxlength="1200" placeholder="Registre o que aconteceu: necessidade, objeção, condição, próximo passo..."></textarea><div><select id="sales360Channel"><option value="Nota">Nota interna</option><option value="WhatsApp">WhatsApp</option><option value="Ligação">Ligação</option><option value="E-mail">E-mail</option><option value="Visita">Visita</option></select><button class="primary" onclick="saveSales360Activity('${esc(lead.entityType)}','${esc(lead.entityId)}')">Salvar na memória</button></div></div></section><section><div class="section-head"><div><h3>Memória comercial</h3><span class="small">Histórico real e permanente do atendimento</span></div><span class="badge good">${events.length}</span></div><div class="sales360-timeline">${timeline}</div></section></div>`;
}
function openLead360(type,id){
  const lead=pipelineEntities().find(x=>x.entityType===type&&String(x.entityId)===String(id));if(!lead){toast('Lead não encontrado.');return}
  let modal=document.getElementById('sales360Modal');if(!modal){modal=document.createElement('div');modal.id='sales360Modal';modal.className='sales360-modal hidden';modal.innerHTML='<div class="sales360-shell"><button class="sales360-close" onclick="closeLead360()" aria-label="Fechar">×</button><div id="sales360Body"></div></div>';document.body.appendChild(modal);modal.addEventListener('click',e=>{if(e.target===modal)closeLead360()});}
  modal.dataset.type=type;modal.dataset.id=id;document.getElementById('sales360Body').innerHTML=pipeline360Html(lead);modal.classList.remove('hidden');document.body.style.overflow='hidden';
}
function closeLead360(){const m=document.getElementById('sales360Modal');if(m)m.classList.add('hidden');document.body.style.overflow='';}
async function saveSales360Activity(type,id){
  const note=document.getElementById('sales360Note')?.value.trim()||'',channel=document.getElementById('sales360Channel')?.value||'Nota';if(!note){toast('Escreva o registro comercial antes de salvar.');return}
  const lead=pipelineEntities().find(x=>x.entityType===type&&String(x.entityId)===String(id));if(!lead)return;
  const client=window.LJI_BACKEND?.client,cfg=window.LJI_CONFIG||{},u=window.LJI_CURRENT_USER||{};if(!client){toast('Supabase indisponível. Nada foi salvo.');return}
  const eventType=channel==='Nota'?'sales_note_added':'sales_contact_logged',details={note,channel,lead_type:lead.leadType,title:lead.title,stage:lead.stage,author_name:u.name||u.email||null};
  const payload={workspace_id:cfg.WORKSPACE_ID,user_id:u.id||null,event_type:eventType,entity_type:type,entity_id:String(id),details};const {error}=await client.from('lji_activity_log').insert(payload);if(error){console.error(error);toast('Não foi possível salvar a memória no Supabase.');return}
  const data={...payload,id:`sales-memory-${Date.now()}`,created_at:new Date().toISOString()};window.LJI_ADMIN_STATE=window.LJI_ADMIN_STATE||{};window.LJI_ADMIN_STATE.pipelineEvents=[data,...(window.LJI_ADMIN_STATE.pipelineEvents||[])];window.LJI_ADMIN_STATE.activities=[data,...(window.LJI_ADMIN_STATE.activities||[])].slice(0,100);toast('Memória comercial salva.');openLead360(type,id);renderPipeline();renderHistory();
}
window.openLead360=openLead360;window.closeLead360=closeLead360;window.saveSales360Activity=saveSales360Activity;

function pipelineStageOptions(current){return LJI_PIPELINE_STAGES.map(s=>`<option value="${esc(s.key)}" ${s.key===current?'selected':''}>${esc(s.label)}</option>`).join('')}
function pipelineContextButton(x){return `<button type="button" class="pipeline-context" onclick="openLead360('${esc(x.entityType)}','${esc(x.entityId)}')">Lead 360°</button>`}
function pipelineContactButton(x){
  if(x.contactHref)return `<a class="pipeline-contact" href="${esc(safeHttpUrl(x.contactHref)||x.contactHref)}" target="_blank" rel="noopener noreferrer">WhatsApp ↗</a>`;
  if(x.contactTel)return `<a class="pipeline-contact" href="${esc(x.contactTel)}">Ligar</a>`;
  return '<span class="pipeline-no-contact">Sem contato validado</span>';
}
function pipelineCardHtml(x){
  const event=x.stageEvent,changed=event?.created_at?`Etapa alterada ${actionAgeLabel(event.created_at).replace('visto ','')}`:'Etapa ainda não registrada';
  const loss=x.stage==='lost'&&event?.details?.loss_reason?`<div class="pipeline-loss"><b>Motivo:</b> ${esc(event.details.loss_reason)}</div>`:'';
  const owner=x.handledByName?esc(x.handledByName):'Sem responsável';
  const intel=pipelineCommercialIntel(x),priorityLabel=intel.priority==='high'?'ALTA':intel.priority==='medium'?'MÉDIA':'BAIXA';
  const intelBox=`<div class="pipeline-intel"><div class="pipeline-intel-head"><b>Próxima melhor ação</b><span>${priorityLabel} · ${intel.score}</span></div><div class="pipeline-intel-action">${esc(intel.action)}</div><div class="pipeline-intel-reason">${esc(intel.reasons.length?intel.reasons.join(' · '):'score baseado nos dados disponíveis')}</div></div>`;
  const follow=pipelineFollowUpIntel(x),followBox=!['won','lost'].includes(x.stage)?`<div class="pipeline-followup pipeline-followup-${follow.level}"><div><b>${esc(follow.message)}</b><small>${follow.days===null?'Sem interação registrada':`Última movimentação há ${follow.days} dia${follow.days===1?'':'s'}`}</small></div>${follow.due?`<button type="button" onclick="copyPipelineFollowUp('${esc(x.entityType)}','${esc(x.entityId)}')">Copiar abordagem</button>`:''}</div>`:'';
  return `<article class="pipeline-card pipeline-priority-${intel.priority} ${x.stage==='won'?'pipeline-card-won':x.stage==='lost'?'pipeline-card-lost':''}">
    <div class="pipeline-card-head"><span class="pipeline-type">${esc(x.leadType)}</span><span class="pipeline-score">${intel.score}</span></div>
    <strong class="pipeline-card-title">${esc(x.title)}</strong>
    <span class="pipeline-card-sub">${esc(x.subtitle)}</span>
    <div class="pipeline-card-meta"><span>${esc(x.region)}</span><span>${esc(x.source)}</span>${x.value?`<span>${esc(money(x.value))}</span>`:''}</div>
    ${loss}
    ${intelBox}
    ${followBox}
    <div class="pipeline-owner">${esc(owner)}</div>
    <div class="pipeline-stage-change"><select aria-label="Etapa comercial" onchange="setPipelineStage('${esc(x.entityType)}','${esc(x.entityId)}',this.value,this)">${pipelineStageOptions(x.stage)}</select><small>${esc(changed)}</small></div>
    <div class="pipeline-card-actions">${pipelineContactButton(x)}${pipelineContextButton(x)}</div>
  </article>`;
}
function renderPipeline(){
  const all=pipelineEntities(),filtered=filteredPipelineEntities();
  const open=all.filter(x=>!['won','lost'].includes(x.stage)).length;
  const toContact=all.filter(x=>['new','validated'].includes(x.stage)).length;
  const negotiating=all.filter(x=>['proposal','negotiation'].includes(x.stage)).length;
  const won=all.filter(x=>x.stage==='won').length;
  const highPriority=all.filter(x=>!['won','lost'].includes(x.stage)&&pipelineCommercialIntel(x).score>=80).length;
  const followDue=all.filter(x=>pipelineFollowUpIntel(x).due).length;
  renderSalesActionQueue();
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v};
  set('pipeOpen',open);set('pipeToContact',toContact);set('pipeNegotiating',negotiating);set('pipeHighPriority',highPriority);set('pipeWon',won);
  const nav=document.getElementById('pipelineNavCount');if(nav)nav.textContent=open?String(open):'';
  const upd=document.getElementById('pipelineUpdatedAt');if(upd)upd.textContent=`${pipelineEvents().length} movimentação(ões) · ${followDue} follow-up(s) pendente(s)`;
  const board=document.getElementById('pipelineBoard');if(!board)return;
  board.innerHTML=LJI_PIPELINE_STAGES.map(st=>{
    const rows=filtered.filter(x=>x.stage===st.key);
    return `<section class="pipeline-column pipeline-stage-${esc(st.key)}"><div class="pipeline-column-head"><div><strong>${esc(st.label)}</strong><span>${rows.length}</span></div><small>${rows.length?`${rows.length} lead${rows.length===1?'':'s'}`:'Sem leads'}</small></div><div class="pipeline-column-body">${rows.length?rows.map(pipelineCardHtml).join(''):'<div class="pipeline-empty">Nenhum lead</div>'}</div></section>`;
  }).join('');
}
async function setPipelineStage(entityType,entityId,newStage,selectEl){
  if(!LJI_PIPELINE_STAGES.some(s=>s.key===newStage)){renderPipeline();return}
  const rows=pipelineEntities(),lead=rows.find(x=>x.entityType===entityType&&String(x.entityId)===String(entityId));
  if(!lead){toast('Lead não encontrado na base atual.');renderPipeline();return}
  const oldStage=lead.stage||'new';if(oldStage===newStage)return;
  let lossReason='';
  if(newStage==='lost'){
    lossReason=prompt('Motivo da perda (obrigatório):','')?.trim()||'';
    if(!lossReason){toast('A etapa Perdido exige um motivo.');if(selectEl)selectEl.value=oldStage;return}
  }
  const client=window.LJI_BACKEND?.client,cfg=window.LJI_CONFIG||{},u=window.LJI_CURRENT_USER||{};
  if(!client){toast('Supabase indisponível. A etapa não foi alterada.');if(selectEl)selectEl.value=oldStage;return}
  const details={old_stage:oldStage,new_stage:newStage,loss_reason:lossReason||null,lead_type:lead.leadType,title:lead.title,subtitle:lead.subtitle,region:lead.region,source:lead.source,score:Number(lead.score||0),value:Number(lead.value||0),handled_by_name:lead.handledByName||null,handled_by_user_id:lead.handledByUserId||null,changed_by_name:u.name||u.email||null};
  const payload={workspace_id:cfg.WORKSPACE_ID,user_id:u.id||null,event_type:'pipeline_stage_changed',entity_type:entityType,entity_id:String(entityId),details};
  const createdAt=new Date().toISOString();
  const {error}=await client.from('lji_activity_log').insert(payload);
  if(error){console.error(error);toast('Não foi possível salvar a etapa no Supabase.');if(selectEl)selectEl.value=oldStage;return}
  const data={...payload,id:`pipeline-local-${Date.now()}`,created_at:createdAt};
  window.LJI_ADMIN_STATE=window.LJI_ADMIN_STATE||{};
  window.LJI_ADMIN_STATE.pipelineEvents=[data,...(window.LJI_ADMIN_STATE.pipelineEvents||[])];
  window.LJI_ADMIN_STATE.activities=[data,...(window.LJI_ADMIN_STATE.activities||[])].slice(0,100);
  toast(`${pipelineStageMeta(oldStage).label} → ${pipelineStageMeta(newStage).label}`);
  renderPipeline();renderHistory();renderActionCenter();
}
function openPipelineContext(type,id){
  const lead=pipelineEntities().find(x=>x.entityType===type&&String(x.entityId)===String(id));
  const page=lead?.contextPage||(type==='opportunity'?'owners':type==='buyer_intent'?'intentions':type==='buyer'?'buyers':'history');
  go(page);
  if(type==='opportunity'&&lead){const input=document.getElementById('ownerSearch');if(input){input.value=lead.title||lead.region||'';renderOwners()}}
  if(type==='buyer_intent'&&lead){const input=document.getElementById('intentSearch');if(input){input.value=lead.title||'';renderIntentions()}}
}
async function refreshPipelineNow(){
  const upd=document.getElementById('pipelineUpdatedAt');if(upd)upd.textContent='Sincronizando pipeline...';
  try{await Promise.allSettled([window.LJI_BACKEND?.sync?.(),window.LJI_BACKEND?.syncAdmin?.(),window.syncIntentions?.()]);renderPipeline();toast('Pipeline atualizado.')}catch(e){console.error(e);renderPipeline();toast('Atualização parcial; dados preservados.');}
}
window.renderPipeline=renderPipeline;
window.setPipelineStage=setPipelineStage;
window.openPipelineContext=openPipelineContext;
window.refreshPipelineNow=refreshPipelineNow;

function renderAll(){
 const renders=[
  ['Leads 5ºAndar',renderParaQuintoAndar],['Cidades e filtros',refreshCitySelectors],['Captação de proprietários',renderDeepSearch],['Proprietários',renderOwners],['Pesquisa Registral',renderRegistrySearches],['Leads e WhatsApp',renderWhatsAppLeads],['Verificação de Contato',renderContactCheck],['Descartados',renderDiscarded],['Demandas de compradores',renderBuyers],['Radar de Intenção',renderIntentions],['Match Engine',renderMatches],['Dashboard',renderDashboard],['Central de Ação',renderActionCenter],['Pipeline Comercial',renderPipeline],['Inbox Comercial',renderSalesInbox],['Permutas',renderTrades],['Empresas',renderCompanies],['Relatórios',renderReports],['Usuários',renderAdminUsers],['Histórico',renderHistory],['Gráficos',renderOperationMetrics],['Integrações',renderIntegrationStatus],['Alertas de match',updateAlertsBell],['Links de gráficos',ensureChartLinks]
 ];
 renders.forEach(([name,fn])=>{try{fn()}catch(error){
  window.LJI_RUNTIME_WARNINGS=window.LJI_RUNTIME_WARNINGS||[];
  window.LJI_RUNTIME_WARNINGS.push({step:`render ${name}`,message:String(error?.message||error||'erro'),at:new Date().toISOString()});
  console.error(`[LJ Radar] render ${name}:`,error);
 }});
}
renderAll()

function propertyUrl(o){
 return safeHttpUrl(o?.source_url || o?.url || o?.link || o?.original_url || o?.listing_url || '');
}
function copyPropertyLink(id){
 const url=propertyUrlById(id);if(!url){toast('Link original indisponível.');return}
 navigator.clipboard?.writeText(url);toast('Link copiado.');
}
function ownerContact(o){
 const phone=phoneDigits(o?.contact_verified_phone||o?.contact_phone||'');
 const wa=whatsappFrom(o?.whatsapp_url||phone);
 return {phone,wa,verified:Boolean(o?.contact_verified_at)};
}
function propertyMenuHtml(o){
 const url=propertyUrl(o),title=esc(o?.title||'Imóvel');
 return `<span class="property-link-wrap">
  ${url?`<a class="property-link-trigger" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${title}</a>`:`<span style="font-weight:800">${title}</span>`}
  <button type="button" class="property-more-btn" onclick="openPropertyMenu(event,'${esc(o?.id)}')" title="Mais ações">⋯</button>
 </span>`;
}
function propertyUrlById(id){
  const o=(window.owners||owners||[]).find(x=>String(x.id)===String(id));
  return propertyUrl(o);
}
function openPropertyMenu(ev,id){
 ev.preventDefault();ev.stopPropagation();
 const o=(window.owners||owners||[]).find(x=>String(x.id)===String(id));if(!o)return;
 let pop=document.getElementById('propertyPopover');
 if(!pop){pop=document.createElement('div');pop.id='propertyPopover';pop.className='property-popover';document.body.appendChild(pop)}
 const url=propertyUrl(o),c=ownerContact(o);
 const canPrioritize=['super_admin','gestor'].includes(window.LJI_CURRENT_USER?.role||'')&&o.opportunity_id&&o.is_current;
 pop.innerHTML=`<div class="pop-title">${esc(o.title||'Imóvel')}</div>
  ${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">↗ Abrir anúncio original</a>`:`<button onclick="toast('Este imóvel ainda não tem link de origem cadastrado.')">↗ Link original indisponível</button>`}
  ${c.wa?`<a href="${esc(c.wa)}" target="_blank" rel="noopener noreferrer">◉ WhatsApp do proprietário${c.verified?' · confirmado':''}</a>`:''}
  ${c.phone?`<a href="tel:+55${esc(c.phone)}">☎ Ligar para proprietário</a>`:''}
  <button onclick="document.getElementById('propertyPopover')?.classList.remove('open');openRegistryForProperty('${esc(o.id)}')">⌂ Pesquisa registral / titularidade</button>
  ${url?`<button onclick="copyPropertyLink('${esc(o.id)}')">⧉ Copiar link</button>`:''}
  ${canPrioritize?(o.status==='hot'?`<button onclick="setOwnerRadarStatus('${esc(o.opportunity_id)}','approved')">🔥 Remover prioridade</button>`:`<button onclick="setOwnerRadarStatus('${esc(o.opportunity_id)}','hot')">🔥 Marcar quente</button>`):''}
  ${canPrioritize?`<button class="danger" onclick="if(confirm('Descartar este imóvel? Ele some das telas gerais.'))setOwnerRadarStatus('${esc(o.opportunity_id)}','rejected')">🗑 Descartar este imóvel</button>`:''}`;
 const r=ev.currentTarget.getBoundingClientRect();
 pop.style.left=Math.min(r.left,window.innerWidth-320)+'px';
 pop.style.top=Math.min(r.bottom+8,window.innerHeight-220)+'px';
 pop.classList.add('open');
}
function alertRowHtml(a){
  const i=a.lji_buyer_intents||{},o=a.lji_opportunity_index||{};
  const who=i.person_name||i.title||(i.intent_role==='seller'?'Proprietário':'Interessado');
  const wa=i.contact&&String(i.contact).length>=10?`https://wa.me/55${String(i.contact).replace(/\D/g,'')}`:'';
  return `<div class="alert-row ${a.alert_status==='new'?'is-new':''}">
    <div class="alert-row-top"><span class="badge ${a.match_score>=90?'hot':'good'}">${a.match_score}%</span>${a.alert_status==='new'?'<span class="alert-new-tag">Novo</span>':''}</div>
    <div class="alert-row-body">
      <div><strong>${esc(who)}</strong> — ${esc(i.transaction_type==='rent'?'quer alugar':'quer comprar')} ${esc(i.property_type||'imóvel')} em ${esc(i.region||'—')}${i.budget_max?' até '+money(i.budget_max):''}</div>
      <div class="small">Combina com: <strong>${esc(o.title||'Imóvel')}</strong> — ${esc(o.city||'')} · ${money(o.price||0)}</div>
    </div>
    <div class="alert-row-actions">
      ${wa?`<a href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>`:''}
      ${o.source_url?`<a href="${esc(o.source_url)}" target="_blank" rel="noopener">Abrir imóvel ↗</a>`:''}
      ${a.alert_status==='new'?`<button onclick="markAlertSeen('${a.id}')">Marcar visto</button>`:''}
      <button class="danger" onclick="dismissAlert('${a.id}')">Dispensar</button>
    </div>
  </div>`;
}
function updateAlertsBell(){
  const badge=document.getElementById('alertsBellCount');
  const unseen=matchAlerts.filter(a=>a.alert_status==='new').length;
  if(badge)badge.textContent=unseen?String(unseen):'';
}
async function markAlertSeen(id){
  const client=window.LJI_BACKEND?.client;if(!client)return;
  await client.from('lji_match_alerts').update({alert_status:'seen'}).eq('id',id).eq('workspace_id',window.LJI_CONFIG?.WORKSPACE_ID);
  await window.LJI_BACKEND?.syncMatchAlerts?.();
  openAlertsPanel(null,true);
}
async function dismissAlert(id){
  const client=window.LJI_BACKEND?.client;if(!client)return;
  await client.from('lji_match_alerts').update({alert_status:'dismissed'}).eq('id',id).eq('workspace_id',window.LJI_CONFIG?.WORKSPACE_ID);
  await window.LJI_BACKEND?.syncMatchAlerts?.();
  openAlertsPanel(null,true);
}
async function markAllAlertsSeen(){
  const client=window.LJI_BACKEND?.client;if(!client)return;
  const ids=matchAlerts.filter(a=>a.alert_status==='new').map(a=>a.id);
  if(!ids.length)return;
  await client.from('lji_match_alerts').update({alert_status:'seen'}).in('id',ids).eq('workspace_id',window.LJI_CONFIG?.WORKSPACE_ID);
  await window.LJI_BACKEND?.syncMatchAlerts?.();
  openAlertsPanel(null,true);
}
function openAlertsPanel(ev,keepOpen){
  ev?.preventDefault();ev?.stopPropagation();
  let pop=document.getElementById('alertsPopover');
  if(!pop){pop=document.createElement('div');pop.id='alertsPopover';pop.className='alerts-popover';document.body.appendChild(pop);pop.addEventListener('click',e=>e.stopPropagation())}
  const unseen=matchAlerts.filter(a=>a.alert_status==='new').length;
  pop.innerHTML=`<div class="alerts-popover-head"><strong>Alertas de match</strong>${unseen?`<button onclick="markAllAlertsSeen()">Marcar todos vistos</button>`:''}</div>
    <div class="alerts-popover-list">${matchAlerts.length?matchAlerts.map(alertRowHtml).join(''):'<div class="empty">Nenhum match ainda. Assim que o Match Engine encontrar um, aparece aqui.</div>'}</div>`;
  const btn=document.getElementById('alertsBellBtn');
  if(btn && !keepOpen){
    const r=btn.getBoundingClientRect();
    pop.style.left=Math.min(r.left,window.innerWidth-380)+'px';
    pop.style.top=Math.min(r.bottom+8,window.innerHeight-80)+'px';
  }
  pop.classList.add('open');
}
document.addEventListener('click',()=>document.getElementById('alertsPopover')?.classList.remove('open'));
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.getElementById('alertsPopover')?.classList.remove('open')});
async function setOwnerRadarStatus(opportunityId,status){
 const client=window.LJI_BACKEND?.client;
 if(!client){toast('Supabase indisponível.');return}
 const {error}=await client.from('lji_opportunity_index').update({radar_status:status,updated_at:new Date().toISOString()}).eq('id',opportunityId);
 if(error){console.error(error);toast('Não foi possível atualizar o status.');return}
 const o=(window.owners||owners||[]).find(x=>String(x.opportunity_id)===String(opportunityId));
 if(o)o.status=status;
 document.getElementById('propertyPopover')?.classList.remove('open');
 renderAll();
 toast(status==='hot'?'Marcado como quente 🔥 — prioridade no Match Engine.':status==='rejected'?'Imóvel descartado — não aparece mais nas telas gerais.':'Prioridade removida, volta pra aprovado normal.');
}
window.setOwnerRadarStatus=setOwnerRadarStatus;
document.addEventListener('click',()=>document.getElementById('propertyPopover')?.classList.remove('open'));
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.getElementById('propertyPopover')?.classList.remove('open')});

(function(){
  let timer=null;
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible' && window.LJI_BACKEND?.client){
      window.LJI_BACKEND.sync?.();
      window.syncIntentions?.();
    }
  });
  window.addEventListener('load',()=>{
    timer=setInterval(()=>{
      if(document.visibilityState==='visible' && window.LJI_BACKEND?.client){
        window.LJI_BACKEND.sync?.();
        window.syncIntentions?.();
      }
    },300000);
  });
})();

(function(){
  const ROLE_LABELS={
    super_admin:'CEO',
    gestor:'Gestora',
    corretor:'Corretora'
  };
  const PERMISSIONS={
    super_admin:['dashboard','action-center','pipeline','charts','deep-search','owners','whatsapp-leads','contact-check','discarded','buyers','intentions','matches','trades','companies','imports','history','users-admin','reports','settings'],
    gestor:['dashboard','action-center','pipeline','charts','deep-search','owners','whatsapp-leads','contact-check','discarded','buyers','intentions','matches','trades','companies','history','reports','settings'],
    corretor:['dashboard','action-center','pipeline','charts','deep-search','owners','whatsapp-leads','contact-check','discarded','buyers','intentions','matches','trades']
  };

  function normalizeRole(r){
    r=String(r||'').toLowerCase();
    if(r==='manager') return 'gestor';
    if(r==='broker') return 'corretor';
    return r;
  }
  function initials(name){
    return String(name||'U').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();
  }
  function applyRoleUI(email,rawRole,permissions,preferredName){
    const role=normalizeRole(rawRole);
    const name=preferredName || (email?String(email).split('@')[0]:'Usuário');
    const allowed=modulesFromPermissions(role,permissions);

    const avatar=document.getElementById('currentUserAvatar');
    const nameEl=document.getElementById('currentUserName');
    const roleEl=document.getElementById('currentUserRole');
    if(avatar)avatar.textContent=initials(name);
    if(nameEl)nameEl.textContent=name;
    if(roleEl)roleEl.textContent=ROLE_LABELS[role]||role||'Usuário';

    document.querySelectorAll('.nav button[data-page]').forEach(btn=>{
      const page=btn.dataset.page;
      btn.classList.toggle('role-hidden',!allowed.includes(page));
    });

    document.querySelectorAll('.role-admin-only').forEach(el=>{
      el.classList.toggle('role-hidden',role!=='super_admin');
    });

    // Gestora acessa Configurações operacionais, mas não administração de usuários/segurança.
    if(role==='gestor'){
      document.querySelectorAll('[data-setting="users"],[data-setting="security"]').forEach(el=>el.classList.add('role-hidden'));
    }

    // Corretora não entra em Configurações/Relatórios/Empresas.
    if(role==='corretor'){
      document.querySelectorAll('[data-page="settings"],[data-page="reports"],[data-page="companies"]').forEach(el=>el.classList.add('role-hidden'));
    }

    document.body.dataset.userRole=role;
    window.LJI_CURRENT_USER={email,name,role,permissions};
    setTimeout(()=>window.syncAccountSettings?.(),0);
  }

  window.LJI_applyRoleUI=applyRoleUI;
})();

(function(){
  window.LJI_renderRealOpportunityChart=function(){
    try{
      const rows=(window.owners||owners||[]).filter(Boolean);
      const line=document.getElementById('opportunityChartLine');
      const area=document.getElementById('opportunityChartArea');
      if(!line||!area)return;
      const now=new Date(), bins=Array(12).fill(0);
      rows.forEach(o=>{
        const raw=o.published_at||o.created_at||o.captured_at;
        if(!raw)return;
        const d=new Date(raw); if(Number.isNaN(d.getTime()))return;
        const days=(now-d)/(86400000);
        if(days<0||days>30)return;
        const ix=Math.min(11,Math.max(0,11-Math.floor(days/2.6)));
        bins[ix]++;
      });
      const max=Math.max(1,...bins);
      const pts=bins.map((v,i)=>{
        const x=55+(780*i/11), y=240-(190*v/max);
        return [x.toFixed(1),y.toFixed(1)];
      });
      line.setAttribute('d','M'+pts.map(p=>p.join(',')).join(' L'));
      area.setAttribute('d','M'+pts.map(p=>p.join(',')).join(' L')+' L835,240 L55,240 Z');
    }catch(e){}
  };
  const old=window.renderDashboard;
  if(typeof old==='function'){
    window.renderDashboard=function(){const r=old.apply(this,arguments);setTimeout(window.LJI_renderRealOpportunityChart,0);return r}
  }
})();

(function(){
  function renderRolePanel(){
    const panel=document.getElementById('roleSpecificPanel');
    const title=document.getElementById('rolePanelTitle');
    const body=document.getElementById('rolePanelBody');
    if(!panel||!title||!body)return;
    const role=window.LJI_CURRENT_USER?.role||document.body.dataset.userRole||'';
    if(role==='super_admin'){
      title.textContent='Painel do CEO';
      body.innerHTML=
        '<div class="role-line"><span>Visão consolidada da operação</span><span class="role-ok">ATIVA</span></div>'+
        '<div class="role-line"><span>Usuários e permissões</span><span class="role-gold">Controle total</span></div>'+
        '<div class="role-line"><span>Regras comerciais e cobertura</span><span class="role-gold">Administrável</span></div>'+
        '<div class="role-line"><span>Integrações, segurança e logs</span><span class="role-gold">Administrável</span></div>';
    }else if(role==='gestor'){
      title.textContent='Painel da Gestora';
      body.innerHTML=
        '<div class="role-line"><span>Operação comercial</span><span class="role-ok">Completa</span></div>'+
        '<div class="role-line"><span>Radar de Intenção e Matches</span><span class="role-gold">Ilimitado</span></div>'+
        '<div class="role-line"><span>Distribuição e acompanhamento</span><span class="role-gold">Ativo</span></div>'+
        '<div class="role-line"><span>Administração de usuários</span><span>Restrita ao CEO</span></div>';
    }else{
      title.textContent='Painel da Corretora';
      body.innerHTML=
        '<div class="role-line"><span>Leads atribuídos</span><span class="role-ok">Disponíveis</span></div>'+
        '<div class="role-line"><span>Proprietários, compradores e matches</span><span class="role-gold">Operacional</span></div>'+
        '<div class="role-line"><span>WhatsApp, ligação e link original</span><span class="role-gold">Ativo</span></div>'+
        '<div class="role-line"><span>Administração da plataforma</span><span>Sem acesso</span></div>';
    }
  }
  const old=window.LJI_applyRoleUI;
  if(typeof old==='function'){
    window.LJI_applyRoleUI=function(email,role,permissions,preferredName){
      old(email,role,permissions,preferredName);
      setTimeout(renderRolePanel,0);
    }
  }
  window.LJI_renderRolePanel=renderRolePanel;
  window.addEventListener('load',()=>setTimeout(renderRolePanel,300));
})();

document.addEventListener('click',function(e){
  const btn=e.target.closest('[data-password-target]');
  if(!btn)return;
  const input=document.getElementById(btn.dataset.passwordTarget);
  if(!input)return;
  const showing=input.type==='text';
  input.type=showing?'password':'text';
  btn.textContent=showing?'Mostrar':'Ocultar';
  btn.setAttribute('aria-label',showing?'Mostrar senha':'Ocultar senha');
});

document.getElementById('rCity')?.addEventListener('input',updateRegistrySourceHint);


/* =========================================================
   v22.42 — LJ SALES · FILA DE EXECUÇÃO COMERCIAL
   Aprovação humana obrigatória. Sem envio automático nesta versão.
   ========================================================= */
function salesQueueHours(){
  let v={start:'09:00',end:'19:00'};try{v=JSON.parse(localStorage.getItem('lji_sales_queue_hours')||'null')||v}catch(e){}
  return {start:v.start||'09:00',end:v.end||'19:00'};
}
function saveSalesQueueHours(){
  const start=document.getElementById('salesQueueStart')?.value||'09:00',end=document.getElementById('salesQueueEnd')?.value||'19:00';
  localStorage.setItem('lji_sales_queue_hours',JSON.stringify({start,end}));toast('Horário comercial salvo.');renderSalesActionQueue();
}
function salesActionLatestMap(){
  const m=new Map(),types=['sales_action_queued','sales_action_approved','sales_action_completed','sales_action_cancelled'];
  [...pipelineEvents()].filter(e=>types.includes(e.event_type)).sort((a,b)=>(new Date(b.created_at).getTime()||0)-(new Date(a.created_at).getTime()||0)).forEach(e=>{const k=pipelineKey(e.entity_type,e.entity_id);if(!m.has(k))m.set(k,e)});return m;
}
function salesActionStatus(e){return !e?'suggested':e.event_type.replace('sales_action_','')}
async function persistSalesAction(lead,eventType,extra={}){
  const client=window.LJI_BACKEND?.client,cfg=window.LJI_CONFIG||{},u=window.LJI_CURRENT_USER||{};if(!client){toast('Supabase indisponível. A ação não foi registrada.');return false}
  const f=pipelineFollowUpIntel(lead),intel=pipelineCommercialIntel(lead),details={lead_type:lead.leadType,title:lead.title,stage:lead.stage,script:f.script,score:intel.score,priority:intel.priority,action:intel.action,author_name:u.name||u.email||null,...extra};
  const payload={workspace_id:cfg.WORKSPACE_ID,user_id:u.id||null,event_type:eventType,entity_type:lead.entityType,entity_id:String(lead.entityId),details};
  const {error}=await client.from('lji_activity_log').insert(payload);if(error){console.error(error);toast('Não foi possível registrar a ação no Supabase.');return false}
  const data={...payload,id:`sales-action-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,created_at:new Date().toISOString()};window.LJI_ADMIN_STATE=window.LJI_ADMIN_STATE||{};window.LJI_ADMIN_STATE.pipelineEvents=[data,...(window.LJI_ADMIN_STATE.pipelineEvents||[])];return true;
}
async function prepareSalesActionQueue(){
  const latest=salesActionLatestMap(),due=pipelineEntities().filter(x=>pipelineFollowUpIntel(x).due&&!['won','lost'].includes(x.stage));let created=0;
  for(const lead of due){const st=salesActionStatus(latest.get(pipelineKey(lead.entityType,lead.entityId)));if(['approved','completed','queued'].includes(st))continue;if(await persistSalesAction(lead,'sales_action_queued',{queue_reason:pipelineFollowUpIntel(lead).message}))created++}
  toast(created?`${created} ação(ões) preparada(s) para aprovação.`:'Fila já está atualizada.');renderPipeline();
}
async function approveSalesAction(type,id){const lead=pipelineEntities().find(x=>x.entityType===type&&String(x.entityId)===String(id));if(!lead)return;if(await persistSalesAction(lead,'sales_action_approved',{approved:true})) {toast('Ação aprovada.');renderPipeline()}}
async function completeSalesAction(type,id){const lead=pipelineEntities().find(x=>x.entityType===type&&String(x.entityId)===String(id));if(!lead)return;if(await persistSalesAction(lead,'sales_action_completed',{completed:true})) {toast('Ação concluída e registrada.');renderPipeline()}}
async function cancelSalesAction(type,id){const lead=pipelineEntities().find(x=>x.entityType===type&&String(x.entityId)===String(id));if(!lead)return;if(await persistSalesAction(lead,'sales_action_cancelled',{cancelled:true})) {toast('Ação cancelada.');renderPipeline()}}
function copySalesQueueMessage(type,id){const lead=pipelineEntities().find(x=>x.entityType===type&&String(x.entityId)===String(id));if(!lead)return;const t=pipelineFollowUpIntel(lead).script||'';navigator.clipboard?.writeText(t).then(()=>toast('Abordagem copiada.')).catch(()=>toast(t))}
function renderSalesActionQueue(){
  const root=document.getElementById('salesActionQueue');if(!root)return;const h=salesQueueHours(),a=document.getElementById('salesQueueStart'),b=document.getElementById('salesQueueEnd');if(a&&document.activeElement!==a)a.value=h.start;if(b&&document.activeElement!==b)b.value=h.end;
  const latest=salesActionLatestMap(),rows=pipelineEntities().filter(x=>{const e=latest.get(pipelineKey(x.entityType,x.entityId));return e&&['queued','approved'].includes(salesActionStatus(e))&&!['won','lost'].includes(x.stage)}).map(x=>({lead:x,event:latest.get(pipelineKey(x.entityType,x.entityId))}));
  const count=document.getElementById('salesQueueCount');if(count)count.textContent=String(rows.length);if(!rows.length){root.innerHTML='<div class="empty">Nenhuma ação aguardando aprovação ou execução.</div>';return}
  rows.sort((x,y)=>pipelineCommercialIntel(y.lead).score-pipelineCommercialIntel(x.lead).score);root.innerHTML=rows.map(({lead,event})=>{const st=salesActionStatus(event),f=pipelineFollowUpIntel(lead),label=st==='approved'?'Aprovada':'Aguardando aprovação';return `<div class="sales-queue-row sales-queue-${esc(st)}"><div><span class="sales-queue-status">${esc(label)}</span><small>${esc(pipelineStageMeta(lead.stage).label)}</small></div><div><strong>${esc(lead.title)}</strong><small>${esc(lead.region)} · score ${pipelineCommercialIntel(lead).score}</small></div><div class="sales-queue-message">${esc(f.script)}</div><div class="sales-queue-actions">${st==='queued'?`<button class="primary" onclick="approveSalesAction('${esc(lead.entityType)}','${esc(lead.entityId)}')">Aprovar</button>`:`<button class="primary" onclick="completeSalesAction('${esc(lead.entityType)}','${esc(lead.entityId)}')">Concluir</button>`}<button class="secondary" onclick="copySalesQueueMessage('${esc(lead.entityType)}','${esc(lead.entityId)}')">Copiar</button><button class="secondary" onclick="cancelSalesAction('${esc(lead.entityType)}','${esc(lead.entityId)}')">Cancelar</button></div></div>`}).join('');
}
Object.assign(window,{prepareSalesActionQueue,approveSalesAction,completeSalesAction,cancelSalesAction,copySalesQueueMessage,renderSalesActionQueue,saveSalesQueueHours});

/* =========================================================
   v22.43 — LJ SALES · AGENTE COMERCIAL CONTEXTUAL
   Usa somente contexto real local + memória comercial.
   Nenhuma chave LLM é exposta no frontend; envio segue com aprovação humana.
   ========================================================= */
function salesAgentLeadKey(x){return `${x.entityType}::${x.entityId}`}
function salesAgentSelectedLead(){
  const key=document.getElementById('salesAgentLead')?.value||'';
  return pipelineEntities().find(x=>salesAgentLeadKey(x)===key)||null;
}
function salesAgentRecentMemory(lead){
  return pipelineEntityEvents(lead.entityType,lead.entityId).filter(e=>['sales_contact_logged','sales_note_added','pipeline_stage_changed'].includes(e.event_type)).slice(0,6);
}
function salesAgentLastNote(lead){
  const e=salesAgentRecentMemory(lead).find(x=>String(x.details?.note||'').trim());return String(e?.details?.note||'').trim();
}
function salesAgentObjection(text){
  const t=String(text||'').toLowerCase();
  if(/caro|preço|preco|valor|orçamento|orcamento/.test(t))return 'preço/condição';
  if(/financi|crédito|credito|entrada/.test(t))return 'financiamento';
  if(/local|bairro|região|regiao|distante/.test(t))return 'localização';
  if(/pensar|depois|agora não|agora nao|sem pressa/.test(t))return 'timing';
  if(/cônjuge|conjuge|esposa|marido|família|familia/.test(t))return 'decisão compartilhada';
  return '';
}
function renderSalesAgentContext(){
  const lead=salesAgentSelectedLead(),root=document.getElementById('salesAgentContext'),result=document.getElementById('salesAgentResult');if(result)result.classList.add('hidden');if(!root)return;
  if(!lead){root.innerHTML='<div class="empty">Selecione um lead para o agente analisar o histórico comercial real.</div>';return}
  const intel=pipelineCommercialIntel(lead),mem=salesAgentRecentMemory(lead),last=salesAgentLastNote(lead),obj=salesAgentObjection(last);
  root.innerHTML=`<div class="sales-agent-facts"><div><span>Lead</span><b>${esc(lead.title)}</b></div><div><span>Etapa</span><b>${esc(pipelineStageMeta(lead.stage).label)}</b></div><div><span>Score</span><b>${intel.score}/100</b></div><div><span>Memória</span><b>${mem.length} evento${mem.length===1?'':'s'}</b></div></div><div class="sales-agent-read"><b>Leitura comercial</b><p>${esc(intel.action)}</p>${last?`<small>Último registro: ${esc(last)}</small>`:'<small>Sem nota comercial textual registrada.</small>'}${obj?`<span>Possível objeção detectada: ${esc(obj)}</span>`:''}</div>`;
}
function salesAgentDraftFor(lead,goal){
  const first=String(lead.title||'').trim().split(/\s+/)[0]||'Olá',stage=lead.stage,region=lead.region&&lead.region!=='Região não informada'?lead.region:'',last=salesAgentLastNote(lead),obj=salesAgentObjection(last),follow=pipelineFollowUpIntel(lead),intel=pipelineCommercialIntel(lead);
  const hi=`Olá${first && !/^(lead|oportunidade|comprador|intenção)$/i.test(first)?`, ${first}`:''}!`;
  let body='';
  if(goal==='reengage') body=`Quero retomar nosso contato${region?` sobre sua busca em ${region}`:''}. Separei o próximo passo para avançarmos sem perder tempo. Ainda faz sentido para você seguir com isso agora?`;
  else if(goal==='qualify') body=`Para eu filtrar somente opções que realmente façam sentido, posso confirmar três pontos: faixa de investimento, região prioritária e prazo em que pretende fechar?`;
  else if(goal==='visit') body=`Pelo que já alinhamos, o melhor próximo passo é uma visita. Posso te passar duas opções de horário para você escolher a mais conveniente?`;
  else if(goal==='proposal') body=`Estamos em um ponto em que vale avançar objetivamente nas condições. Posso organizar a proposta com os pontos que já alinhamos e te enviar para validação?`;
  else if(goal==='objection'&&obj==='preço/condição') body=`Entendi o ponto sobre valor. Antes de descartarmos, quero comparar condição, aderência e alternativas equivalentes para ver se existe uma negociação que realmente faça sentido para você. Posso fazer essa comparação?`;
  else if(goal==='objection'&&obj==='financiamento') body=`Entendi a questão do financiamento. Podemos separar a decisão do imóvel da estrutura de pagamento e verificar uma condição viável antes de avançar. Quer que eu organize os próximos pontos necessários?`;
  else if(goal==='objection'&&obj==='localização') body=`Entendi a preocupação com localização. Posso restringir a busca ao que realmente atende sua rotina e comparar apenas alternativas equivalentes na região que você considera ideal.`;
  else if(goal==='objection'&&obj==='timing') body=`Sem problema. Para não ficar te pressionando, posso deixar o acompanhamento no momento certo e retomar quando houver uma oportunidade realmente aderente ao que você procura.`;
  else if(goal==='objection') body=`Quero entender exatamente o que está impedindo o avanço agora. Se você me disser o principal ponto de dúvida, eu consigo tratar isso objetivamente e evitar te mandar opções que não façam sentido.`;
  else body=follow.script||`${intel.action} Posso avançar com isso para você?`;
  return `${hi} ${body}`.replace(/\s+/g,' ').trim();
}
function refreshSalesAgentLeadOptions(){
  const sel=document.getElementById('salesAgentLead');if(!sel)return;const old=sel.value,rows=pipelineEntities().filter(x=>!['won','lost'].includes(x.stage)).sort((a,b)=>pipelineCommercialIntel(b).score-pipelineCommercialIntel(a).score);
  sel.innerHTML='<option value="">Selecione um lead real...</option>'+rows.map(x=>`<option value="${esc(salesAgentLeadKey(x))}">${esc(x.title)} · ${esc(pipelineStageMeta(x.stage).label)} · ${pipelineCommercialIntel(x).score}</option>`).join('');if(rows.some(x=>salesAgentLeadKey(x)===old))sel.value=old;
}
async function generateSalesAgentDraft(){
  const lead=salesAgentSelectedLead();if(!lead){toast('Selecione um lead real.');return}
  const goal=document.getElementById('salesAgentGoal')?.value||'next',mem=salesAgentRecentMemory(lead),confidence=document.getElementById('salesAgentConfidence'),btn=document.querySelector('.sales-agent-controls button.primary');
  if(btn){btn.disabled=true;btn.textContent='Analisando com IA...'}
  try{
    const client=window.LJI_BACKEND?.client,cfg=window.LJI_CONFIG||{},intel=pipelineCommercialIntel(lead),follow=pipelineFollowUpIntel(lead);
    if(!client)throw new Error('Supabase indisponível');
    const payload={workspace_id:cfg.WORKSPACE_ID,goal,lead:{entity_type:lead.entityType,entity_id:String(lead.entityId),lead_type:lead.leadType,title:lead.title,region:lead.region,stage:lead.stage,score:intel.score,priority:intel.priority,next_action:intel.action,followup_script:follow.script},memory:mem.map(e=>({event_type:e.event_type,created_at:e.created_at,details:e.details||{}}))};
    const {data,error}=await client.functions.invoke('lji-sales-agent-v1',{body:payload});
    if(error)throw error;
    const draft=String(data?.draft||'').trim();if(!draft)throw new Error('Resposta vazia do agente');
    document.getElementById('salesAgentDraft').value=draft;document.getElementById('salesAgentResult')?.classList.remove('hidden');
    if(confidence)confidence.textContent=`IA Claude · ${data?.confidence||'contextual'}`;
    const mode=document.getElementById('salesAgentMode');if(mode)mode.textContent='Claude IA';
    window.LJI_LAST_SALES_AGENT_META={engine:data?.engine||'claude_server',reasoning_summary:data?.reasoning_summary||'',recommended_action:data?.recommended_action||''};
  }catch(err){
    console.warn('Agente IA indisponível; usando fallback contextual.',err);
    const draft=salesAgentDraftFor(lead,goal);document.getElementById('salesAgentDraft').value=draft;document.getElementById('salesAgentResult')?.classList.remove('hidden');
    if(confidence)confidence.textContent=mem.length>=2?'Fallback · contexto forte':mem.length?'Fallback · contexto parcial':'Fallback · contexto limitado';
    const mode=document.getElementById('salesAgentMode');if(mode)mode.textContent='Fallback local';toast('IA server-side indisponível. Usei o motor contextual seguro.');
    window.LJI_LAST_SALES_AGENT_META={engine:'contextual_fallback'};
  }finally{if(btn){btn.disabled=false;btn.textContent='Gerar com IA'}}
}
function copySalesAgentDraft(){const t=document.getElementById('salesAgentDraft')?.value.trim();if(!t)return;navigator.clipboard?.writeText(t).then(()=>toast('Abordagem do agente copiada.')).catch(()=>toast(t))}
async function persistSalesAgentEvent(lead,eventType,details){
  const client=window.LJI_BACKEND?.client,cfg=window.LJI_CONFIG||{},u=window.LJI_CURRENT_USER||{};if(!client){toast('Supabase indisponível.');return false}const payload={workspace_id:cfg.WORKSPACE_ID,user_id:u.id||null,event_type:eventType,entity_type:lead.entityType,entity_id:String(lead.entityId),details:{lead_type:lead.leadType,title:lead.title,stage:lead.stage,author_name:u.name||u.email||null,...details}};const {error}=await client.from('lji_activity_log').insert(payload);if(error){console.error(error);toast('Não foi possível registrar no Supabase.');return false}const data={...payload,id:`sales-agent-${Date.now()}`,created_at:new Date().toISOString()};window.LJI_ADMIN_STATE.pipelineEvents=[data,...(window.LJI_ADMIN_STATE.pipelineEvents||[])];return true;
}
async function saveSalesAgentDraft(){const lead=salesAgentSelectedLead(),draft=document.getElementById('salesAgentDraft')?.value.trim();if(!lead||!draft)return;if(await persistSalesAgentEvent(lead,'sales_agent_draft',{note:draft,goal:document.getElementById('salesAgentGoal')?.value||'next',engine:window.LJI_LAST_SALES_AGENT_META?.engine||'contextual_fallback',reasoning_summary:window.LJI_LAST_SALES_AGENT_META?.reasoning_summary||null,recommended_action:window.LJI_LAST_SALES_AGENT_META?.recommended_action||null})){toast('Abordagem salva na memória comercial.');renderPipeline();renderSalesAgentContext()}}
async function queueSalesAgentDraft(){const lead=salesAgentSelectedLead(),draft=document.getElementById('salesAgentDraft')?.value.trim();if(!lead||!draft)return;if(await persistSalesAction(lead,'sales_action_queued',{script:draft,agent_generated:true,queue_reason:'Agente Comercial'})){toast('Abordagem enviada para aprovação na fila.');renderPipeline()}}
const _renderPipelineV2243=renderPipeline;renderPipeline=function(){_renderPipelineV2243();refreshSalesAgentLeadOptions();renderSalesActionQueue()};
window.renderPipeline=renderPipeline;
Object.assign(window,{renderSalesAgentContext,generateSalesAgentDraft,copySalesAgentDraft,saveSalesAgentDraft,queueSalesAgentDraft,refreshSalesAgentLeadOptions});


/* ==========================================================
   v22.45 — INBOX COMERCIAL + WHATSAPP CLOUD API
   Fonte única: eventos reais persistidos em lji_activity_log.
   Nenhuma conversa demonstrativa é criada no frontend.
   ========================================================== */
window.LJI_SALES_INBOX_SELECTED='';
function salesInboxEvents(){return (window.LJI_ADMIN_STATE?.pipelineEvents||[]).filter(e=>['whatsapp_message_received','whatsapp_message_sent','whatsapp_message_failed'].includes(e.event_type))}
function salesInboxPhone(e){return String(e?.details?.phone||e?.details?.from||e?.details?.to||'').replace(/\D/g,'')}
function salesInboxThreads(){const map=new Map();salesInboxEvents().forEach(e=>{const phone=salesInboxPhone(e);if(!phone)return;const cur=map.get(phone)||{phone,events:[],name:e.details?.contact_name||''};cur.events.push(e);if(e.details?.contact_name)cur.name=e.details.contact_name;map.set(phone,cur)});return [...map.values()].map(t=>({...t,events:t.events.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)),last:t.events[t.events.length-1]})).sort((a,b)=>new Date(b.last.created_at)-new Date(a.last.created_at))}
function renderSalesInbox(){
 const threads=salesInboxThreads(),q=(document.getElementById('inboxSearch')?.value||'').toLowerCase().trim(),dir=document.getElementById('inboxDirection')?.value||'';
 const visible=threads.filter(t=>!q||[t.name,t.phone,...t.events.map(e=>e.details?.text||'')].join(' ').toLowerCase().includes(q));
 const unread=salesInboxEvents().filter(e=>e.event_type==='whatsapp_message_received'&&!e.details?.read_at).length;
 const pending=(window.LJI_ADMIN_STATE?.pipelineEvents||[]).filter(e=>e.event_type==='sales_action_approved').length-(window.LJI_ADMIN_STATE?.pipelineEvents||[]).filter(e=>['sales_action_completed','sales_action_cancelled'].includes(e.event_type)).length;
 const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v};set('inboxThreads',threads.length);set('inboxUnread',unread);set('inboxPending',Math.max(0,pending));set('inboxChannel',salesInboxEvents().length?'Ativo':'Aguardando');set('salesInboxNavCount',unread||'');set('inboxUpdatedAt',`Atualizado ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`);
 const box=document.getElementById('salesInboxThreads');if(box)box.innerHTML=visible.length?visible.map(t=>`<button class="sales-inbox-thread ${window.LJI_SALES_INBOX_SELECTED===t.phone?'active':''}" onclick="openSalesInboxThread('${esc(t.phone)}')"><strong>${esc(t.name||('+'+t.phone))}</strong><span>${esc(t.last?.details?.text||t.last?.event_type||'Mensagem')}</span><small>${new Date(t.last.created_at).toLocaleString('pt-BR')}</small></button>`).join(''):'<div class="empty">Nenhuma conversa real registrada pelo webhook.</div>';
 if(window.LJI_SALES_INBOX_SELECTED)openSalesInboxThread(window.LJI_SALES_INBOX_SELECTED,dir);
}
function openSalesInboxThread(phone,forcedDir){window.LJI_SALES_INBOX_SELECTED=String(phone);const t=salesInboxThreads().find(x=>x.phone===String(phone));if(!t)return;const dir=forcedDir??(document.getElementById('inboxDirection')?.value||'');const events=t.events.filter(e=>!dir||(dir==='inbound'?e.event_type==='whatsapp_message_received':e.event_type!=='whatsapp_message_received'));const sel=document.getElementById('salesInboxSelected');if(sel)sel.textContent=`${t.name||'Contato'} · +${t.phone}`;const box=document.getElementById('salesInboxMessages');if(box)box.innerHTML=events.length?events.map(e=>`<div class="sales-inbox-message ${e.event_type==='whatsapp_message_received'?'inbound':'outbound'}"><span>${esc(e.details?.text||'[mensagem sem texto]')}</span><small>${new Date(e.created_at).toLocaleString('pt-BR')} · ${e.event_type==='whatsapp_message_failed'?'falha':e.event_type==='whatsapp_message_received'?'recebida':'enviada'}</small></div>`).join(''):'<div class="empty">Nenhuma mensagem neste filtro.</div>';document.getElementById('salesInboxComposer')?.classList.remove('hidden');renderSalesInboxThreadsOnly()}
function renderSalesInboxThreadsOnly(){const box=document.getElementById('salesInboxThreads');if(!box)return;const q=(document.getElementById('inboxSearch')?.value||'').toLowerCase().trim();const visible=salesInboxThreads().filter(t=>!q||[t.name,t.phone,...t.events.map(e=>e.details?.text||'')].join(' ').toLowerCase().includes(q));box.innerHTML=visible.length?visible.map(t=>`<button class="sales-inbox-thread ${window.LJI_SALES_INBOX_SELECTED===t.phone?'active':''}" onclick="openSalesInboxThread('${esc(t.phone)}')"><strong>${esc(t.name||('+'+t.phone))}</strong><span>${esc(t.last?.details?.text||t.last?.event_type||'Mensagem')}</span><small>${new Date(t.last.created_at).toLocaleString('pt-BR')}</small></button>`).join(''):'<div class="empty">Nenhuma conversa real registrada pelo webhook.</div>'}
async function refreshSalesInbox(){try{await window.LJI_BACKEND?.syncAdmin?.();renderSalesInbox();toast('Inbox atualizado.')}catch(e){console.error(e);toast('Falha ao atualizar Inbox.')}}
function inboxLeadByPhone(){const phone=window.LJI_SALES_INBOX_SELECTED;if(!phone)return null;return pipelineEntities().find(x=>{const p=String(x.contactHref||x.contactTel||'').replace(/\D/g,'');return p&&phone.endsWith(p.slice(-10))})||null}
async function draftInboxWithAgent(){const lead=inboxLeadByPhone();if(!lead){toast('Contato ainda não está vinculado a um lead do Pipeline.');return}go('pipeline');setTimeout(()=>{const sel=document.getElementById('salesAgentLead');if(sel){sel.value=pipelineKey(lead.entityType,lead.entityId);renderSalesAgentContext();document.getElementById('salesAgentGoal').value='next';generateSalesAgentDraft()}},80)}
async function sendApprovedWhatsApp(){const phone=window.LJI_SALES_INBOX_SELECTED,text=document.getElementById('salesInboxDraft')?.value.trim();if(!phone||!text){toast('Selecione uma conversa e escreva a resposta.');return}const client=window.LJI_BACKEND?.client;if(!client){toast('Supabase não conectado.');return}if(!confirm('Enviar esta mensagem pelo WhatsApp oficial?'))return;try{const {data,error}=await client.functions.invoke('lji-whatsapp-send-v1',{body:{workspace_id:window.LJI_CONFIG?.WORKSPACE_ID||'',to:phone,text}});if(error)throw error;if(!data?.ok)throw new Error(data?.error||'Falha no envio');document.getElementById('salesInboxDraft').value='';toast('Mensagem enviada pelo WhatsApp oficial.');await refreshSalesInbox()}catch(e){console.error(e);toast('WhatsApp oficial ainda não configurado ou envio recusado.')}}
window.renderSalesInbox=renderSalesInbox;window.openSalesInboxThread=openSalesInboxThread;window.refreshSalesInbox=refreshSalesInbox;window.draftInboxWithAgent=draftInboxWithAgent;window.sendApprovedWhatsApp=sendApprovedWhatsApp;

/* ==========================================================
   v22.46 — INBOX INTELIGENTE + VÍNCULO PERSISTENTE + SCORE VIVO
   Mensagem real -> lead real -> memória -> análise -> próxima ação.
   Nada é enviado automaticamente.
   ========================================================== */
function ljiInboxPhone(v){return String(v||'').replace(/\D/g,'')}
function ljiInboxSamePhone(a,b){const x=ljiInboxPhone(a),y=ljiInboxPhone(b);if(!x||!y)return false;const n=Math.min(10,x.length,y.length);return n>=8&&x.slice(-n)===y.slice(-n)}
function ljiInboxLeadPhone(lead){return ljiInboxPhone(lead?.contactHref||lead?.contactTel||'')}
function ljiInboxLinkEvent(phone){
  return [...pipelineEvents()].filter(e=>e.event_type==='whatsapp_lead_linked'&&ljiInboxSamePhone(e.details?.phone,phone)).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0]||null;
}
function ljiInboxLinkedLead(phone){
  const link=ljiInboxLinkEvent(phone);
  if(link){const lead=pipelineEntities().find(x=>x.entityType===link.entity_type&&String(x.entityId)===String(link.entity_id));if(lead)return lead}
  const matches=pipelineEntities().filter(x=>ljiInboxSamePhone(ljiInboxLeadPhone(x),phone));
  return matches.length===1?matches[0]:null;
}
function ljiInboxAnalysis(phone,lead){
  return [...pipelineEvents()].filter(e=>e.event_type==='sales_inbox_analysis'&&ljiInboxSamePhone(e.details?.phone,phone)&&(!lead||(e.entity_type===lead.entityType&&String(e.entity_id)===String(lead.entityId)))).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0]||null;
}
function ljiInboxAnalysisForLead(lead){
  return [...pipelineEvents()].filter(e=>e.event_type==='sales_inbox_analysis'&&e.entity_type===lead.entityType&&String(e.entity_id)===String(lead.entityId)).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0]||null;
}
function ljiInboxReadAt(phone){
  const e=[...pipelineEvents()].filter(x=>x.event_type==='whatsapp_thread_read'&&ljiInboxSamePhone(x.details?.phone||x.entity_id,phone)).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];return e?.created_at||'';
}
function ljiInboxUnreadForThread(t){const readAt=ljiInboxReadAt(t.phone);const ts=readAt?new Date(readAt).getTime():0;return t.events.filter(e=>e.event_type==='whatsapp_message_received'&&new Date(e.created_at).getTime()>ts).length}
function ljiInboxPriorityLabel(v){v=String(v||'').toLowerCase();return v==='alta'||v==='high'?'Alta':v==='baixa'||v==='low'?'Baixa':'Média'}
function ljiInboxIntentLabel(v){v=String(v||'').toLowerCase();if(v==='alta'||v==='high')return'Alta intenção';if(v==='baixa'||v==='low')return'Baixa intenção';return'Média intenção'}

const _pipelineCommercialIntelV2245=pipelineCommercialIntel;
pipelineCommercialIntel=function(x){
  const out=_pipelineCommercialIntelV2245(x),a=ljiInboxAnalysisForLead(x),d=a?.details||{};
  if(a){
    const delta=Math.max(-20,Math.min(20,Number(d.score_delta||0)));out.score=Math.max(0,Math.min(100,Math.round(out.score+delta)));
    if(d.intent_level)out.reasons=[`WhatsApp: ${ljiInboxIntentLabel(d.intent_level).toLowerCase()}`,...(out.reasons||[])].slice(0,3);
    if(d.recommended_action&&!['won','lost'].includes(x.stage))out.action=String(d.recommended_action).slice(0,220);
    out.priority=out.score>=80?'high':out.score>=60?'medium':'low';
  }
  return out;
};

const _pipelineEventLabelV2245=pipelineEventLabel;
pipelineEventLabel=function(e){
  if(e.event_type==='sales_inbox_analysis')return 'Análise IA da conversa';
  if(e.event_type==='whatsapp_lead_linked')return 'WhatsApp vinculado ao lead';
  if(e.event_type==='whatsapp_thread_read')return 'Conversa visualizada';
  return _pipelineEventLabelV2245(e);
};

salesAgentRecentMemory=function(lead){
  return pipelineEntityEvents(lead.entityType,lead.entityId).filter(e=>['sales_contact_logged','sales_note_added','pipeline_stage_changed','sales_inbox_analysis'].includes(e.event_type)).slice(0,10);
};

function ljiRenderInboxThreadsList(threads,q){
  const box=document.getElementById('salesInboxThreads');if(!box)return;
  const visible=threads.filter(t=>!q||[t.name,t.phone,...t.events.map(e=>e.details?.text||'')].join(' ').toLowerCase().includes(q));
  box.innerHTML=visible.length?visible.map(t=>{const lead=ljiInboxLinkedLead(t.phone),a=ljiInboxAnalysis(t.phone,lead),unread=ljiInboxUnreadForThread(t);return `<button class="sales-inbox-thread ${window.LJI_SALES_INBOX_SELECTED===t.phone?'active':''}" onclick="openSalesInboxThread('${esc(t.phone)}')"><div class="sales-inbox-thread-top"><strong>${esc(t.name||('+'+t.phone))}</strong>${unread?`<b class="inbox-unread-pill">${unread}</b>`:''}</div><span>${esc(t.last?.details?.text||t.last?.event_type||'Mensagem')}</span><small>${lead?`Vinculado: ${esc(lead.title)}`:'Não vinculado'}${a?.details?.intent_level?` · ${esc(ljiInboxIntentLabel(a.details.intent_level))}`:''}</small><small>${new Date(t.last.created_at).toLocaleString('pt-BR')}</small></button>`}).join(''):'<div class="empty">Nenhuma conversa real registrada pelo webhook.</div>';
}

renderSalesInbox=function(){
  const threads=salesInboxThreads(),q=(document.getElementById('inboxSearch')?.value||'').toLowerCase().trim();
  const unread=threads.reduce((n,t)=>n+ljiInboxUnreadForThread(t),0);
  const pending=(window.LJI_ADMIN_STATE?.pipelineEvents||[]).filter(e=>e.event_type==='sales_action_approved').length-(window.LJI_ADMIN_STATE?.pipelineEvents||[]).filter(e=>['sales_action_completed','sales_action_cancelled'].includes(e.event_type)).length;
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v};set('inboxThreads',threads.length);set('inboxUnread',unread);set('inboxPending',Math.max(0,pending));set('inboxChannel',salesInboxEvents().length?'Ativo':'Aguardando');set('salesInboxNavCount',unread||'');set('inboxUpdatedAt',`Atualizado ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`);
  ljiRenderInboxThreadsList(threads,q);
  if(window.LJI_SALES_INBOX_SELECTED)openSalesInboxThread(window.LJI_SALES_INBOX_SELECTED,document.getElementById('inboxDirection')?.value||'',true);
};
renderSalesInboxThreadsOnly=function(){ljiRenderInboxThreadsList(salesInboxThreads(),(document.getElementById('inboxSearch')?.value||'').toLowerCase().trim())};

function ljiInboxLinkOptions(phone){
  const sel=document.getElementById('salesInboxLeadLink');if(!sel)return;const linked=ljiInboxLinkedLead(phone),rows=pipelineEntities().filter(x=>!['won','lost'].includes(x.stage)).sort((a,b)=>pipelineCommercialIntel(b).score-pipelineCommercialIntel(a).score);
  sel.innerHTML='<option value="">Vincular a um lead real...</option>'+rows.map(x=>`<option value="${esc(pipelineKey(x.entityType,x.entityId))}" ${linked&&x.entityType===linked.entityType&&String(x.entityId)===String(linked.entityId)?'selected':''}>${esc(x.title)} · ${esc(x.leadType)} · ${pipelineCommercialIntel(x).score}</option>`).join('');
}
function ljiInboxIntelligenceHtml(phone){
  const lead=ljiInboxLinkedLead(phone),a=ljiInboxAnalysis(phone,lead),d=a?.details||{};
  if(!lead)return `<div class="inbox-intel-state"><div><b>Lead não vinculado</b><span>O telefone ainda não corresponde de forma única a um lead do Pipeline.</span></div><span class="badge">Ação necessária</span></div>`;
  const intel=pipelineCommercialIntel(lead);
  if(!a)return `<div class="inbox-intel-state"><div><b>${esc(lead.title)}</b><span>${esc(lead.leadType)} · ${esc(pipelineStageMeta(lead.stage).label)} · score ${intel.score}/100</span></div><span class="badge good">Vinculado</span></div><div class="inbox-intel-action"><b>Próxima ação atual</b><span>${esc(intel.action)}</span></div>`;
  return `<div class="inbox-intel-state"><div><b>${esc(lead.title)}</b><span>${esc(lead.leadType)} · ${esc(pipelineStageMeta(lead.stage).label)} · score vivo ${intel.score}/100</span></div><span class="badge good">${esc(d.engine?.startsWith('anthropic:')?'Claude IA':'Análise local')}</span></div><div class="inbox-intel-grid"><div><span>Intenção</span><b>${esc(ljiInboxPriorityLabel(d.intent_level))}</b></div><div><span>Objeção</span><b>${esc(d.objection||'Nenhuma clara')}</b></div><div><span>Delta de score</span><b>${Number(d.score_delta||0)>0?'+':''}${esc(String(d.score_delta||0))}</b></div><div><span>Confiança</span><b>${esc(d.confidence||'parcial')}</b></div></div>${d.analysis_summary?`<div class="inbox-intel-action"><b>Leitura da conversa</b><span>${esc(d.analysis_summary)}</span></div>`:''}${d.recommended_action?`<div class="inbox-intel-action"><b>Próxima melhor ação</b><span>${esc(d.recommended_action)}</span></div>`:''}`;
}
async function ljiMarkInboxThreadRead(phone){
  const t=salesInboxThreads().find(x=>x.phone===String(phone));if(!t)return;const readAt=ljiInboxReadAt(phone),lastInbound=[...t.events].reverse().find(e=>e.event_type==='whatsapp_message_received');if(!lastInbound||readAt&&new Date(readAt)>=new Date(lastInbound.created_at))return;
  const client=window.LJI_BACKEND?.client,cfg=window.LJI_CONFIG||{},u=window.LJI_CURRENT_USER||{};if(!client)return;const payload={workspace_id:cfg.WORKSPACE_ID,user_id:u.id||null,event_type:'whatsapp_thread_read',entity_type:'whatsapp',entity_id:String(phone),details:{phone,read_through:lastInbound.created_at,author_name:u.name||u.email||null}};const {error}=await client.from('lji_activity_log').insert(payload);if(!error){const data={...payload,id:`wa-read-${Date.now()}`,created_at:new Date().toISOString()};window.LJI_ADMIN_STATE.pipelineEvents=[data,...(window.LJI_ADMIN_STATE.pipelineEvents||[])];renderSalesInboxThreadsOnly();const unread=salesInboxThreads().reduce((n,x)=>n+ljiInboxUnreadForThread(x),0);const el=document.getElementById('inboxUnread');if(el)el.textContent=unread;const nav=document.getElementById('salesInboxNavCount');if(nav)nav.textContent=unread||''}}
openSalesInboxThread=async function(phone,forcedDir='',skipRead=false){
  window.LJI_SALES_INBOX_SELECTED=String(phone);const t=salesInboxThreads().find(x=>x.phone===String(phone));if(!t)return;const dir=forcedDir??(document.getElementById('inboxDirection')?.value||'');const events=t.events.filter(e=>!dir||(dir==='inbound'?e.event_type==='whatsapp_message_received':e.event_type!=='whatsapp_message_received'));
  const lead=ljiInboxLinkedLead(phone),sel=document.getElementById('salesInboxSelected');if(sel)sel.textContent=`${t.name||'Contato'} · +${t.phone}${lead?' · '+lead.title:''}`;
  const box=document.getElementById('salesInboxMessages');if(box){box.innerHTML=events.length?events.map(e=>`<div class="sales-inbox-message ${e.event_type==='whatsapp_message_received'?'inbound':'outbound'}"><span>${esc(e.details?.text||'[mensagem sem texto]')}</span><small>${new Date(e.created_at).toLocaleString('pt-BR')} · ${e.event_type==='whatsapp_message_failed'?'falha':e.event_type==='whatsapp_message_received'?'recebida':'enviada'}</small></div>`).join(''):'<div class="empty">Nenhuma mensagem neste filtro.</div>';box.scrollTop=box.scrollHeight}
  const intel=document.getElementById('salesInboxIntelligence');if(intel)intel.innerHTML=ljiInboxIntelligenceHtml(phone);document.getElementById('salesInboxComposer')?.classList.remove('hidden');ljiInboxLinkOptions(phone);renderSalesInboxThreadsOnly();if(!skipRead)await ljiMarkInboxThreadRead(phone);
};

inboxLeadByPhone=function(){return window.LJI_SALES_INBOX_SELECTED?ljiInboxLinkedLead(window.LJI_SALES_INBOX_SELECTED):null};
async function manualLinkInboxLead(){
  const phone=window.LJI_SALES_INBOX_SELECTED,key=document.getElementById('salesInboxLeadLink')?.value||'';if(!phone||!key){toast('Selecione a conversa e o lead.');return}const pos=key.indexOf(':'),type=key.slice(0,pos),id=key.slice(pos+1),lead=pipelineEntities().find(x=>x.entityType===type&&String(x.entityId)===String(id));if(!lead)return;
  const client=window.LJI_BACKEND?.client,cfg=window.LJI_CONFIG||{},u=window.LJI_CURRENT_USER||{};if(!client){toast('Supabase indisponível.');return}const payload={workspace_id:cfg.WORKSPACE_ID,user_id:u.id||null,event_type:'whatsapp_lead_linked',entity_type:type,entity_id:String(id),details:{phone,lead_type:lead.leadType,title:lead.title,link_method:'manual',author_name:u.name||u.email||null}};const {error}=await client.from('lji_activity_log').insert(payload);if(error){console.error(error);toast('Não foi possível vincular o lead.');return}const data={...payload,id:`wa-link-${Date.now()}`,created_at:new Date().toISOString()};window.LJI_ADMIN_STATE.pipelineEvents=[data,...(window.LJI_ADMIN_STATE.pipelineEvents||[])];toast('Conversa vinculada ao Lead 360°.');await openSalesInboxThread(phone,'',true);
}
async function analyzeSalesInboxThread(){
  const phone=window.LJI_SALES_INBOX_SELECTED,lead=inboxLeadByPhone();if(!phone){toast('Selecione uma conversa.');return}if(!lead){toast('Vincule a conversa a um lead antes da análise.');return}const client=window.LJI_BACKEND?.client;if(!client){toast('Supabase indisponível.');return}
  const btn=[...document.querySelectorAll('.sales-inbox-linkbar button')].find(x=>x.textContent.includes('Analisar'));if(btn){btn.disabled=true;btn.textContent='Analisando...'}
  try{const intel=pipelineCommercialIntel(lead),{data,error}=await client.functions.invoke('lji-sales-inbox-analyze-v1',{body:{workspace_id:window.LJI_CONFIG?.WORKSPACE_ID||'',phone,lead:{entity_type:lead.entityType,entity_id:String(lead.entityId),lead_type:lead.leadType,title:lead.title,region:lead.region,stage:lead.stage,score:intel.score}}});if(error)throw error;if(!data?.ok)throw new Error(data?.error||'Falha na análise');await window.LJI_BACKEND?.syncAdmin?.();renderPipeline();renderSalesInbox();await openSalesInboxThread(phone,'',true);toast(data?.engine?.startsWith('anthropic:')?'Conversa analisada com Claude.':'Conversa analisada pelo fallback seguro.')}catch(e){console.error(e);toast('Função de análise ainda não publicada ou indisponível.')}finally{if(btn){btn.disabled=false;btn.textContent='Analisar com IA'}}
}
draftInboxWithAgent=async function(){const lead=inboxLeadByPhone();if(!lead){toast('Contato ainda não está vinculado a um lead do Pipeline.');return}const a=ljiInboxAnalysis(window.LJI_SALES_INBOX_SELECTED,lead);go('pipeline');setTimeout(()=>{const sel=document.getElementById('salesAgentLead');if(sel){sel.value=pipelineKey(lead.entityType,lead.entityId);renderSalesAgentContext();const goal=document.getElementById('salesAgentGoal');if(goal)goal.value=a?.details?.objection?'objection':lead.stage==='replied'?'qualify':lead.stage==='qualified'?'visit':['proposal','negotiation'].includes(lead.stage)?'proposal':'next';generateSalesAgentDraft()}},80)};
sendApprovedWhatsApp=async function(){const phone=window.LJI_SALES_INBOX_SELECTED,text=document.getElementById('salesInboxDraft')?.value.trim(),lead=inboxLeadByPhone();if(!phone||!text){toast('Selecione uma conversa e escreva a resposta.');return}const client=window.LJI_BACKEND?.client;if(!client){toast('Supabase não conectado.');return}if(!confirm('Enviar esta mensagem pelo WhatsApp oficial?'))return;try{const {data,error}=await client.functions.invoke('lji-whatsapp-send-v1',{body:{workspace_id:window.LJI_CONFIG?.WORKSPACE_ID||'',to:phone,text,entity_type:lead?.entityType||null,entity_id:lead?String(lead.entityId):null}});if(error)throw error;if(!data?.ok)throw new Error(data?.error||'Falha no envio');document.getElementById('salesInboxDraft').value='';toast('Mensagem enviada pelo WhatsApp oficial.');await refreshSalesInbox();await openSalesInboxThread(phone,'',true)}catch(e){console.error(e);toast('WhatsApp oficial ainda não configurado ou envio recusado.')}};

Object.assign(window,{manualLinkInboxLead,analyzeSalesInboxThread,renderSalesInbox,openSalesInboxThread,draftInboxWithAgent,sendApprovedWhatsApp});
try{renderSalesInbox();renderPipeline()}catch(e){console.error('v22.46 init',e)}

/* ==========================================================
   v22.47 — MATCH COMERCIAL AUTOMÁTICO
   Conversa real -> critérios explícitos -> demanda -> imóveis reais.
   Campos ausentes nunca são inventados; o perfil cadastrado só complementa
   o cruzamento quando já existe como dado real no LJ Radar.
   ========================================================== */
function ljiConversationMatchEvent(phone,lead){
  return [...pipelineEvents()].filter(e=>e.event_type==='sales_match_profile'&&ljiInboxSamePhone(e.details?.phone,phone)&&(!lead||(e.entity_type===lead.entityType&&String(e.entity_id)===String(lead.entityId)))).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0]||null;
}
function ljiConversationMatchProfile(phone,lead){return ljiConversationMatchEvent(phone,lead)?.details?.profile||null}
function ljiMatchProfileBase(lead){
  if(!lead)return null;
  if(lead.entityType==='buyer'){
    const b=buyers.find(x=>String(x.id)===String(lead.entityId));
    if(!b)return null;
    return {name:b.name||lead.title,city:b.city||'',neighborhood:b.neighborhood||'',type:b.type||'',transaction_type:b.transaction_type||'',budget:Number(b.budget||0),beds:Number(b.beds||0),parking:Number(b.parking||0),area_min:Number(b.area_min||0),urgency:Number(b.urgency||2),contact:b.contact||'',source:b.source||'Cadastro interno'};
  }
  if(lead.entityType==='buyer_intent'){
    const i=buyerIntentions.find(x=>String(x.id)===String(lead.entityId));
    if(!i||intentRole(i)==='seller')return null;
    return {name:i.person_name||i.title||lead.title,city:i.city||i.region||'',neighborhood:i.neighborhood||'',type:i.property_type||intentWantedType(i)||'',transaction_type:i.transaction_type||'',budget:Number(i.budget_max||0),beds:Number(i.bedrooms_min||0),parking:Number(i.parking_min||0),area_min:Number(i.area_min||0),urgency:Number(i.urgency||2),contact:i.contact||'',source:i.source_name||'Radar de Intenção'};
  }
  return null;
}
function ljiMatchBuyerFromConversation(phone,lead){
  const p=ljiConversationMatchProfile(phone,lead)||{},base=ljiMatchProfileBase(lead)||{};
  if(String(p.intent_role||'').toLowerCase()==='seller')return null;
  const explicit=(k)=>p[k]!==null&&p[k]!==undefined&&String(p[k]).trim()!=='';
  return {
    name:base.name||lead?.title||'Comprador',
    city:explicit('city')?p.city:(base.city||''),
    neighborhood:explicit('neighborhood')?p.neighborhood:(base.neighborhood||''),
    type:explicit('property_type')?p.property_type:(base.type||''),
    transaction_type:explicit('transaction_type')?p.transaction_type:(base.transaction_type||''),
    budget:explicit('budget_max')?Number(p.budget_max||0):Number(base.budget||0),
    beds:explicit('bedrooms_min')?Number(p.bedrooms_min||0):Number(base.beds||0),
    parking:explicit('parking_min')?Number(p.parking_min||0):Number(base.parking||0),
    area_min:explicit('area_min')?Number(p.area_min||0):Number(base.area_min||0),
    urgency:explicit('urgency')?Number(p.urgency||2):Number(base.urgency||2),
    contact:base.contact||'',source:'WhatsApp + LJ Sales'
  };
}
function ljiConversationAutoMatches(phone,lead){
  const b=ljiMatchBuyerFromConversation(phone,lead);if(!b)return [];
  return owners.filter(ownerEligibleForMatch).map(o=>({owner:o,score:scoreMatch(b,o)})).filter(x=>x.score>=60).sort((a,b)=>b.score-a.score).slice(0,5);
}
function ljiProfileCriterionChips(p){
  if(!p)return '';
  const out=[];
  if(p.transaction_type)out.push(p.transaction_type==='rent'?'Locação':p.transaction_type==='both'?'Compra ou locação':'Compra');
  if(p.city)out.push(p.city);if(p.neighborhood)out.push(p.neighborhood);if(p.property_type)out.push(p.property_type);
  if(Number(p.budget_max||0)>0)out.push(`até ${money(Number(p.budget_max))}`);if(Number(p.bedrooms_min||0)>0)out.push(`${p.bedrooms_min}+ dorm.`);if(Number(p.parking_min||0)>0)out.push(`${p.parking_min}+ vagas`);if(Number(p.area_min||0)>0)out.push(`${p.area_min}+ m²`);
  return out.map(x=>`<span>${esc(x)}</span>`).join('');
}
function ljiConversationMatchHtml(phone,lead){
  if(!lead)return '';
  const ev=ljiConversationMatchEvent(phone,lead),p=ev?.details?.profile||null;
  if(!ev)return `<div class="inbox-match-profile"><div class="inbox-match-profile-head"><div><b>Match Comercial</b><span>Ainda não extraímos critérios de busca desta conversa.</span></div><span class="badge">Aguardando</span></div></div>`;
  const chips=ljiProfileCriterionChips(p),matches=ljiConversationAutoMatches(phone,lead),engine=String(ev.details?.engine||'');
  if(String(p?.intent_role||'').toLowerCase()==='seller')return `<div class="inbox-match-profile"><div class="inbox-match-profile-head"><div><b>Match Comercial</b><span>A conversa foi classificada como oferta/proprietário, não como busca de comprador.</span></div><span class="badge mid">Sem busca</span></div></div>`;
  return `<div class="inbox-match-profile"><div class="inbox-match-profile-head"><div><b>Match Comercial</b><span>${esc(p?.summary||'Critérios extraídos somente do que foi informado pelo cliente.')}</span></div><span class="badge good">${esc(engine.startsWith('anthropic:')?'Claude':'Extração local')}</span></div>${chips?`<div class="inbox-match-criteria">${chips}</div>`:'<div class="small">Nenhum critério objetivo foi dito ainda; os dados cadastrados do comprador podem continuar sendo usados no cruzamento.</div>'}${matches.length?`<div class="inbox-auto-matches">${matches.map(m=>`<div class="inbox-auto-match"><div class="inbox-auto-match-score">${m.score}%</div><div><strong>${esc(m.owner.title||'Imóvel')}</strong><small>${esc([m.owner.neighborhood,m.owner.city].filter(Boolean).join(' · ')||'Região não informada')} · ${esc(money(m.owner.price||0))}</small></div>${propertyUrl(m.owner)?`<a href="${esc(propertyUrl(m.owner))}" target="_blank" rel="noopener noreferrer">Abrir ↗</a>`:'<span></span>'}</div>`).join('')}</div>`:'<div class="small" style="margin-top:8px">Nenhum imóvel real atingiu 60% de aderência com os dados atuais.</div>'}</div>`;
}
const _ljiInboxIntelligenceHtmlV2246=ljiInboxIntelligenceHtml;
ljiInboxIntelligenceHtml=function(phone){const lead=ljiInboxLinkedLead(phone);return _ljiInboxIntelligenceHtmlV2246(phone)+ljiConversationMatchHtml(phone,lead)};

const _pipelineEventLabelV2246=pipelineEventLabel;
pipelineEventLabel=function(e){if(e.event_type==='sales_match_profile')return 'Critérios de busca extraídos da conversa';return _pipelineEventLabelV2246(e)};

salesAgentRecentMemory=function(lead){
  return pipelineEntityEvents(lead.entityType,lead.entityId).filter(e=>['sales_contact_logged','sales_note_added','pipeline_stage_changed','sales_inbox_analysis','sales_match_profile'].includes(e.event_type)).slice(0,12);
};

async function runSalesConversationMatch(silent=false){
  const phone=window.LJI_SALES_INBOX_SELECTED,lead=inboxLeadByPhone();if(!phone){if(!silent)toast('Selecione uma conversa.');return false}if(!lead){if(!silent)toast('Vincule a conversa a um lead antes do Match Comercial.');return false}
  const client=window.LJI_BACKEND?.client;if(!client){if(!silent)toast('Supabase indisponível.');return false}
  const btn=[...document.querySelectorAll('.sales-inbox-linkbar button')].find(x=>x.textContent.includes('Extrair busca'));
  if(btn){btn.disabled=true;btn.textContent='Cruzando...'}
  try{
    const base=ljiMatchProfileBase(lead),{data,error}=await client.functions.invoke('lji-sales-match-profile-v1',{body:{workspace_id:window.LJI_CONFIG?.WORKSPACE_ID||'',phone,lead:{entity_type:lead.entityType,entity_id:String(lead.entityId),lead_type:lead.leadType,title:lead.title,region:lead.region,existing_profile:base}}});
    if(error)throw error;if(!data?.ok)throw new Error(data?.error||'Falha no Match Comercial');
    await window.LJI_BACKEND?.sync?.();await window.LJI_BACKEND?.syncAdmin?.();try{await syncIntentions()}catch(e){}
    renderPipeline();renderMatches();renderSalesInbox();await openSalesInboxThread(phone,'',true);
    if(!silent){const n=ljiConversationAutoMatches(phone,ljiInboxLinkedLead(phone)).length;toast(n?`Critérios extraídos · ${n} match(es) real(is) no topo.`:'Critérios extraídos · nenhum match ≥ 60% agora.');}
    return true;
  }catch(e){console.error(e);if(!silent)toast('Função do Match Comercial ainda não publicada ou indisponível.');return false}
  finally{if(btn){btn.disabled=false;btn.textContent='Extrair busca + Match'}}
}
Object.assign(window,{runSalesConversationMatch});
try{if(window.LJI_SALES_INBOX_SELECTED)openSalesInboxThread(window.LJI_SALES_INBOX_SELECTED,'',true)}catch(e){console.error('v22.47 init',e)}

/* ============================================================
   CAPTURA MANUAL DE LINK  (v22.48)

   O usuário cola o link de um post/anúncio (Facebook, Instagram,
   OLX, Threads, X, Telegram, TikTok, YouTube ou web aberta) e ele
   percorre o MESMO pipeline das capturas automáticas:
   descoberta -> enriquecimento -> verificação QuintoAndar -> lead.

   Existe porque a Meta descontinuou a API de Grupos em abril/2024:
   posts de grupo não são alcançáveis por robô, só manualmente.
   ============================================================ */
function manualCaptureShow(suffix,tone,html){
 const box=document.getElementById(`manualCaptureResult${suffix}`);
 if(!box)return;
 box.className=`manual-capture-result tone-${tone}`;
 box.innerHTML=html;
 box.hidden=false;
}

function manualCaptureDetails(d){
 if(!d)return '';
 const money=v=>typeof v==='number'&&isFinite(v)?v.toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0}):null;
 const bits=[
  d.platform?['Origem',d.platform]:null,
  d.city?['Cidade',d.city]:null,
  d.transaction_type?['Modalidade',d.transaction_type==='rent'?'Locação':'Venda']:null,
  d.property_type?['Tipo',d.property_type]:null,
  d.neighborhood?['Bairro',d.neighborhood]:null,
  money(d.price)?['Valor',money(d.price)]:null,
  d.bedrooms?['Quartos',String(d.bedrooms)]:null,
  d.area_m2?['Área',`${d.area_m2} m²`]:null,
  d.advertiser?['Anunciante',d.advertiser]:null,
  d.classification_label?['Classificação',d.classification_label]:null,
  money(d.estimated_sale_commission)?['Comissão estimada',money(d.estimated_sale_commission)]:null
 ].filter(Boolean);
 const chips=bits.map(([k,v])=>`<span class="mc-chip"><b>${esc(k)}:</b> ${esc(v)}</span>`).join('');
 const wa=d.whatsapp_link?`<a class="mc-wa" href="${esc(d.whatsapp_link)}" target="_blank" rel="noopener">Abrir WhatsApp do proprietário</a>`:'';
 return `${chips?`<div class="mc-chips">${chips}</div>`:''}${wa}`;
}

async function runManualCapture(suffix){
 const input=document.getElementById(`manualCaptureUrl${suffix}`),
       citySel=document.getElementById(`manualCaptureCity${suffix}`),
       btn=document.getElementById(`manualCaptureBtn${suffix}`),
       url=(input?.value||'').trim();
 if(!url){toast('Cole um link primeiro.');input?.focus();return}
 const client=window.LJI_BACKEND?.client;
 if(!client){toast('Supabase não conectado.');return}

 if(btn){btn.disabled=true;btn.textContent='Capturando...'}
 manualCaptureShow(suffix,'working','Abrindo a página, extraindo os dados e verificando no QuintoAndar...');

 try{
  const body={url};
  if(citySel?.value)body.city=citySel.value;
  const {data,error}=await client.functions.invoke('lji-manual-capture-v1',{body});
  // O invoke trata HTTP 4xx como erro, mas o corpo da resposta traz a
  // explicação em português; por isso ela é lida do contexto do erro.
  let payload=data;
  if(error&&!payload){
   try{payload=await error.context?.json?.()}catch(_){payload=null}
  }
  if(!payload)throw error||new Error('Sem resposta da função de captura.');

  const detalhes=manualCaptureDetails(payload.detected);

  if(payload.ok===false){
   manualCaptureShow(suffix,'error',`<strong>Não deu para capturar.</strong> ${esc(payload.message||payload.error||'Erro desconhecido.')}${detalhes}`);
   return;
  }

  manualCaptureShow(suffix,payload.outcome==='oportunidade_criada'?'ok':'warn',
   `<strong>${esc(payload.message||'Processado.')}</strong>${detalhes}`);

  if(payload.outcome==='oportunidade_criada'||payload.outcome==='buyer_intent'){
   if(input)input.value='';
   if(citySel)citySel.value='';
   await window.LJI_BACKEND?.syncAdmin?.();
   renderAll();
  }
 }catch(e){
  console.error('[captura manual]',e);
  manualCaptureShow(suffix,'error','<strong>Falha na captura.</strong> Verifique sua conexão e tente de novo. Se persistir, o link pode ser de uma página que exige login.');
 }finally{
  if(btn){btn.disabled=false;btn.textContent='Capturar'}
 }
}
window.runManualCapture=runManualCapture;

/* ============================================================
   LIXEIRA DE LEADS  (v22.49)

   A tela "Descartados" que já existia mostra o que a COLETA rejeitou
   automaticamente. Isto aqui é outra coisa: o que a PESSOA mandou para
   a lixeira.

   A chave gravada é o telefone e as URLs de origem — não o id do
   agrupamento, que é recalculado a cada sincronização. Assim, se a
   mesma pessoa reaparecer por outra busca, continua fora.
   ============================================================ */
let ljiBlocklist={phones:new Set(),urls:new Set()};

function ljiNormalizeUrlKey(u){
 try{
  const url=new URL(String(u));
  url.hash='';url.search='';
  url.hostname=url.hostname.toLowerCase().replace(/^www\./,'');
  return url.toString().replace(/\/+$/,'');
 }catch(e){return String(u||'').trim()}
}

async function loadLeadBlocklist(){
 ljiCarregarNomesBloqueados();
 const client=window.LJI_BACKEND?.client;
 if(!client)return;
 try{
  const {data,error}=await client.from('lji_lead_blocklist').select('key_type,key_value');
  if(error)throw error;
  const phones=new Set(),urls=new Set();
  (data||[]).forEach(r=>{(r.key_type==='phone'?phones:urls).add(String(r.key_value))});
  ljiBlocklist={phones,urls};
 }catch(e){console.warn('[lixeira] não foi possível carregar',e)}
}
window.loadLeadBlocklist=loadLeadBlocklist;

function ljiIsDiscarded(x){
 if(!x)return false;
 if(x.phone&&ljiBlocklist.phones.has(String(x.phone)))return true;
 return (x.sourceUrls||[]).some(u=>ljiBlocklist.urls.has(ljiNormalizeUrlKey(u)));
}

// Descarta um ou vários leads na mesma operação. Grava telefone e URLs de cada
// um; o id do agrupamento não serve porque é recalculado a cada sincronização.
async function ljiDiscardLeads(leads,motivo){
 const client=window.LJI_BACKEND?.client;
 if(!client){toast('Faça login para descartar.');return false}
 const linhas=[],vistos=new Set();
 for(const lead of leads){
  const add=(tipo,valor)=>{
   const chave=tipo+'|'+valor;
   if(!valor||vistos.has(chave))return;
   vistos.add(chave);
   linhas.push({key_type:tipo,key_value:valor,workspace_id:window.LJI_CONFIG?.WORKSPACE_ID,lead_name:lead.name,reason:motivo||null});
  };
  if(lead.phone)add('phone',String(lead.phone));
  (lead.sourceUrls||[]).forEach(u=>add('url',ljiNormalizeUrlKey(u)));
 }
 if(!linhas.length){toast('Nenhum dos leads tem telefone ou link para registrar na lixeira.');return false}
 try{
  const {error}=await client.from('lji_lead_blocklist')
   .upsert(linhas,{onConflict:'workspace_id,key_type,key_value',ignoreDuplicates:true});
  if(error)throw error;
  linhas.forEach(l=>{(l.key_type==='phone'?ljiBlocklist.phones:ljiBlocklist.urls).add(l.key_value)});
  return true;
 }catch(e){
  console.error('[lixeira]',e);
  toast('Não consegui descartar. Tente de novo.');
  return false;
 }
}

async function discardLead(id){
 const lead=collectWhatsAppLeads().find(x=>x.id===id);
 if(!lead){toast('Lead não encontrado.');return}
 const motivo=prompt(`Descartar "${lead.name}"?\n\nEle não voltará a aparecer, mesmo se for capturado de novo.\nMotivo (opcional):`,'Não é proprietário');
 if(motivo===null)return;
 if(await ljiDiscardLeads([lead],motivo)){toast('Lead descartado. Não voltará a aparecer.');renderAll()}
}
window.discardLead=discardLead;

/* ---- Seleção múltipla ------------------------------------------------- */
function ljiSelectedIds(scope){
 return [...document.querySelectorAll(`.lead-check[data-scope="${scope}"]:checked`)].map(c=>c.dataset.leadId);
}
function ljiUpdateSelectionBar(scope){
 const ids=ljiSelectedIds(scope),
       bar=document.getElementById(`selBar${scope}`),
       label=document.getElementById(`selCount${scope}`),
       master=document.getElementById(`selAll${scope}`),
       todas=document.querySelectorAll(`.lead-check[data-scope="${scope}"]`);
 if(label)label.textContent=ids.length===1?'1 lead selecionado':`${ids.length} leads selecionados`;
 if(bar)bar.hidden=ids.length===0;
 if(master){
  master.checked=todas.length>0&&ids.length===todas.length;
  master.indeterminate=ids.length>0&&ids.length<todas.length;
 }
}
window.ljiUpdateSelectionBar=ljiUpdateSelectionBar;

function ljiToggleAll(scope,marcado){
 document.querySelectorAll(`.lead-check[data-scope="${scope}"]`).forEach(c=>{c.checked=marcado});
 ljiUpdateSelectionBar(scope);
}
window.ljiToggleAll=ljiToggleAll;

function ljiClearSelection(scope){ljiToggleAll(scope,false)}
window.ljiClearSelection=ljiClearSelection;

async function discardSelectedLeads(scope){
 const ids=new Set(ljiSelectedIds(scope));
 if(!ids.size){toast('Selecione ao menos um lead.');return}
 const leads=collectWhatsAppLeads().filter(x=>ids.has(x.id));
 if(!leads.length){toast('Não encontrei os leads selecionados.');return}
 const amostra=leads.slice(0,5).map(l=>`• ${l.name}`).join('\n'),
       resto=leads.length>5?`\n… e mais ${leads.length-5}`:'';
 const motivo=prompt(`Descartar ${leads.length} lead${leads.length===1?'':'s'}?\n\n${amostra}${resto}\n\nEles não voltarão a aparecer, mesmo se forem capturados de novo.\nMotivo (opcional):`,'Não é proprietário');
 if(motivo===null)return;
 if(await ljiDiscardLeads(leads,motivo)){
  toast(`${leads.length} lead${leads.length===1?'':'s'} descartado${leads.length===1?'':'s'}.`);
  renderAll();
 }
}
window.discardSelectedLeads=discardSelectedLeads;

async function restoreDiscardedLeads(){
 const client=window.LJI_BACKEND?.client;
 if(!client){toast('Faça login primeiro.');return}
 const total=ljiBlocklist.phones.size+ljiBlocklist.urls.size;
 if(!total){toast('A lixeira está vazia.');return}
 if(!confirm(`Restaurar tudo o que está na lixeira (${total} registro${total===1?'':'s'})?\n\nOs leads voltarão a aparecer nas listas.`))return;
 try{
  const {error}=await client.from('lji_lead_blocklist').delete().not('id','is',null);
  if(error)throw error;
  ljiBlocklist={phones:new Set(),urls:new Set()};
  toast('Lixeira esvaziada.');
  renderAll();
 }catch(e){
  console.error('[lixeira]',e);
  toast('Não consegui restaurar. Talvez só quem descartou possa fazer isso.');
 }
}
window.restoreDiscardedLeads=restoreDiscardedLeads;
