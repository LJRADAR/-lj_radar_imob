'use strict';

(function(){
  if(window.LJI_FRONTEND_QUALITY_GATES_V1)return;
  window.LJI_FRONTEND_QUALITY_GATES_V1=true;

  const MAX_PUBLICATION_DAYS=365;
  const MAX_FUTURE_MS=86400000;
  const COMMERCIAL_STATUSES=new Set(['approved','hot']);

  function verifiedPublication(o){
    const raw=o?.published_at||'';
    if(!raw)return false;
    const d=new Date(raw);
    if(Number.isNaN(d.getTime()))return false;
    const age=Date.now()-d.getTime();
    return age>=-MAX_FUTURE_MS && age<=MAX_PUBLICATION_DAYS*86400000;
  }

  function approvedOpportunity(o){
    const status=String(o?.status||'').toLowerCase();
    return Boolean(o?.is_current)
      && COMMERCIAL_STATUSES.has(status)
      && verifiedPublication(o);
  }

  // Match local: review, data ausente, last_seen/first_seen e histórico deixam de
  // ser substitutos para uma publicação real aprovada pelo backend.
  if(typeof ownerEligibleForMatch==='function'){
    ownerEligibleForMatch=function(o){
      if(!approvedOpportunity(o))return false;
      if(typeof dashboardLooksProfessional==='function'&&dashboardLooksProfessional(o))return false;
      if(typeof dashboardLooksGenericPage==='function'&&dashboardLooksGenericPage(o))return false;
      const url=String(typeof propertyUrl==='function'?propertyUrl(o)||'':'').toLowerCase();
      if(/rentola\.com|waa2\.com|achoumudou\.com|mgfimoveis\.com|proprietariodireto\.com\.br/.test(url))return false;
      return true;
    };
  }

  // Match remoto: exige status comercial aprovado/hot e data real do imóvel.
  // A intenção pode manter captured_at como recência enquanto a fonte social não
  // entrega published_at, mas review nunca vira match acionável.
  if(typeof matchFilteredRows==='function'){
    matchFilteredRows=function(applySource=true){
      const source=applySource?(document.getElementById('matchSourceFilter')?.value||''):'';
      const rows=Array.isArray(intentMatchesRemote)?intentMatchesRemote:[];
      return rows.filter(m=>{
        const sourceOk=!source||matchSourceName(m.opportunity_source)===source||matchSourceName(m.intent_source_name)===source;
        const status=String(m.radar_status||'').toLowerCase();
        if(!COMMERCIAL_STATUSES.has(status))return false;
        const opportunityRaw=m.opportunity_published_at||'';
        if(!opportunityRaw)return false;
        const d=new Date(opportunityRaw);
        if(Number.isNaN(d.getTime()))return false;
        const age=Date.now()-d.getTime();
        if(age < -MAX_FUTURE_MS || age > MAX_PUBLICATION_DAYS*86400000)return false;
        const intentRef=m.intent_published_at||m.intent_captured_at||'';
        const intentOk=typeof dateWithinDays==='function'?dateWithinDays(intentRef,MATCH_MAX_DAYS,true):true;
        return sourceOk&&intentOk;
      });
    };
  }

  // Top 3/prioridades: nunca completar os cards com registros em review.
  if(typeof dashboardTopEligible==='function'){
    dashboardTopEligible=function(o){
      return approvedOpportunity(o)
        && (typeof isDashboardCoreRegion!=='function'||isDashboardCoreRegion(o?.city))
        && (typeof dashboardLooksProfessional!=='function'||!dashboardLooksProfessional(o))
        && (typeof dashboardLooksGenericPage!=='function'||!dashboardLooksGenericPage(o));
    };
  }

  if(typeof dashTopTodayRows==='function'){
    dashTopTodayRows=function(){
      return (Array.isArray(owners)?owners:[])
        .filter(dashboardTopEligible)
        .slice()
        .sort((a,b)=>{
          const imageDiff=Number(propertyImageCandidates(b).length>0)-Number(propertyImageCandidates(a).length>0);
          if(imageDiff)return imageDiff;
          const scoreDiff=dashboardOpportunityRank(b)-dashboardOpportunityRank(a);
          if(scoreDiff)return scoreDiff;
          return (dashDate(b)?.getTime()||0)-(dashDate(a)?.getTime()||0);
        })
        .slice(0,3);
    };
  }

  // A grade/exportação do Dashboard também é área comercial: approved ou hot.
  if(typeof dashboardFilteredRows==='function'){
    const baseDashboardFilteredRows=dashboardFilteredRows;
    dashboardFilteredRows=function(){
      return baseDashboardFilteredRows().filter(approvedOpportunity);
    };
  }

  // Highlights e leads quentes são áreas acionáveis: reviews continuam no módulo
  // de revisão, mas não entram nesses atalhos comerciais.
  if(typeof renderDashboardHighlights==='function'){
    const baseHighlights=renderDashboardHighlights;
    renderDashboardHighlights=function(){
      const saved=owners;
      try{
        owners=saved.filter(o=>!o?.is_current||approvedOpportunity(o));
        return baseHighlights();
      }finally{ owners=saved; }
    };
  }

  if(typeof renderDashboardHotLeads==='function'){
    const baseHot=renderDashboardHotLeads;
    renderDashboardHotLeads=function(){
      const saved=owners;
      try{
        owners=saved.filter(o=>!o?.is_current||approvedOpportunity(o));
        return baseHot();
      }finally{ owners=saved; }
    };
  }

  // Central de Ação: reviews podem continuar existindo na base, mas não geram
  // tarefa comercial, prioridade, atribuição ou contato automaticamente.
  if(typeof buildActionCenter==='function'){
    const baseBuildActionCenter=buildActionCenter;
    buildActionCenter=function(){
      const saved=owners;
      try{
        owners=saved.filter(o=>!o?.is_current||approvedOpportunity(o));
        return baseBuildActionCenter();
      }finally{ owners=saved; }
    };
  }

  if(typeof renderActionCenter==='function'){
    const baseRenderActionCenter=renderActionCenter;
    renderActionCenter=function(){
      const saved=owners;
      try{
        owners=saved.filter(o=>!o?.is_current||approvedOpportunity(o));
        return baseRenderActionCenter();
      }finally{ owners=saved; }
    };
  }

  // Contatos: não chamar review de "ativo" e nunca usar last_seen/first_seen
  // como data de publicação. Histórico/review só reaparece quando solicitado.
  if(typeof contactCandidates==='function'){
    const baseContactCandidates=contactCandidates;
    contactCandidates=function(includeHistory=false){
      const rows=baseContactCandidates(includeHistory);
      const ownerById=new Map((Array.isArray(owners)?owners:[]).flatMap(o=>{
        const ids=[o?.opportunity_id,o?.id].filter(Boolean).map(String);
        return ids.map(id=>[id,o]);
      }));
      return rows.map(c=>{
        if(c?.db_kind!=='opportunity')return c;
        const o=ownerById.get(String(c?.db_id||''));
        if(!o)return {...c,isActive:false,operationalStatus:'review',published_at:''};
        const active=approvedOpportunity(o);
        return {
          ...c,
          published_at:o?.published_at||'',
          operationalStatus:o?.is_current===false?'historical':o?.status==='rejected'?'discarded':active?'active':'review',
          isActive:active
        };
      }).filter(c=>includeHistory||c?.db_kind!=='opportunity'||c.isActive);
    };
  }

  // Pipeline comercial: mantém won/lost históricos, mas só inclui oportunidade
  // corrente quando ela passou por todos os gates do backend.
  if(typeof pipelineEntities==='function'){
    const basePipeline=pipelineEntities;
    pipelineEntities=function(){
      const rows=basePipeline();
      const byId=new Map((Array.isArray(owners)?owners:[]).map(o=>[String(o?.opportunity_id||o?.id||''),o]));
      return rows.filter(x=>{
        if(x?.entityType!=='opportunity'||x?.historical)return true;
        const o=byId.get(String(x?.entityId||''));
        return approvedOpportunity(o);
      });
    };
  }

  // Relatórios financeiros/VGV devem considerar somente oportunidades comerciais.
  if(typeof renderReports==='function'){
    const baseReports=renderReports;
    renderReports=function(){
      const saved=owners;
      try{
        owners=saved.filter(o=>!o?.is_current||approvedOpportunity(o));
        return baseReports();
      }finally{ owners=saved; }
    };
  }

  if(typeof exportReportCSV==='function'){
    const baseExportReportCSV=exportReportCSV;
    exportReportCSV=function(){
      const saved=owners;
      try{
        owners=saved.filter(o=>!o?.is_current||approvedOpportunity(o));
        return baseExportReportCSV();
      }finally{ owners=saved; }
    };
  }

  // O Dashboard continua mostrando reviews para triagem, mas deixa explícito o
  // estado real da base e usa approved/hot nos elementos acionáveis.
  if(typeof renderDashboard==='function'){
    const baseDashboard=renderDashboard;
    renderDashboard=function(){
      const result=baseDashboard();
      const current=(Array.isArray(owners)?owners:[]).filter(o=>o?.is_current&&o?.status!=='rejected');
      const approved=current.filter(o=>String(o?.status||'').toLowerCase()==='approved'&&verifiedPublication(o));
      const hot=current.filter(o=>String(o?.status||'').toLowerCase()==='hot'&&verifiedPublication(o));
      const commercial=current.filter(approvedOpportunity);
      const review=current.filter(o=>String(o?.status||'').toLowerCase()==='review');
      const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v};
      set('mOwners',current.length);
      set('mUnassigned',commercial.filter(o=>!o?.handled_by_user_id).length);
      set('mOwnersMeta',`${approved.length} aprovada${approved.length===1?'':'s'} · ${hot.length} quente${hot.length===1?'':'s'} · ${review.length} em revisão · ${owners.length} no histórico`);
      set('dashCountLabel',`${commercial.length} comercial${commercial.length===1?'':'is'} · ${review.length} em revisão`);
      window.LJI_DASHBOARD_DIAGNOSTIC={
        ...(window.LJI_DASHBOARD_DIAGNOSTIC||{}),
        approved:approved.length,
        hot:hot.length,
        commercial:commercial.length,
        review:review.length,
        publicationGateDays:MAX_PUBLICATION_DAYS,
        frontendQualityGate:'approved_or_hot+real_published_at'
      };
      return result;
    };
  }

  async function refreshCollectorHealth(){
    const cfg=window.LJI_CONFIG||{};
    const banner=document.getElementById('collectorServerBanner');
    const title=document.getElementById('collectorServerStatus');
    const meta=document.getElementById('collectorServerMeta');
    if(!banner||!title||!meta||!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY)return;

    const base=String(cfg.SUPABASE_URL).replace(/\/+$/,'');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(`${base}/functions/v1/coletor-lj-v2`,{
        method:'POST',
        headers:{
          apikey:String(cfg.SUPABASE_ANON_KEY),
          'Content-Type':'application/json'
        },
        body:JSON.stringify({action:'health'}),
        signal:controller.signal
      });
      const data=await response.json().catch(()=>({}));
      window.LJI_COLLECTOR_HEALTH={...data,http_status:response.status,checked_at:new Date().toISOString()};
      banner.classList.remove('collector-ok','collector-error','collector-neutral');

      if(!response.ok||data?.ok!==true){
        banner.classList.add('collector-neutral');
        title.textContent='Coleta automática · status atual indisponível';
        meta.textContent='Não foi possível confirmar o health atual do coletor. O último run histórico não é tratado como prova de coleta ativa.';
        return;
      }

      if(data.collection_enabled===true){
        const ready=Array.isArray(data.ready_sources)?data.ready_sources.filter(Boolean):[];
        banner.classList.add('collector-ok');
        title.textContent='Coleta automática pronta';
        meta.textContent=`Source Router ${data.router_version||'online'} · fonte${ready.length===1?'':'s'} pronta${ready.length===1?'':'s'}: ${ready.length?ready.join(', '):'configurada'}.`;
        return;
      }

      const reasons=[];
      if(data.source_router_url_configured!==true)reasons.push('Source Router sem URL');
      if(data.router_auth_signing_configured!==true)reasons.push('assinatura interna não configurada');
      if(data.router_reachable===false)reasons.push('Source Router indisponível');
      if(Array.isArray(data.ready_sources)&&data.ready_sources.length===0)reasons.push('aguardando credenciais das fontes (Apify/Threads)');
      banner.classList.add('collector-neutral');
      title.textContent='Coleta automática pausada';
      meta.textContent=(reasons.length?reasons.join(' · '):'Nenhuma fonte está pronta para coleta.')+' A base existente permanece preservada.';
    }catch(e){
      window.LJI_COLLECTOR_HEALTH={ok:false,error:String(e?.message||e),checked_at:new Date().toISOString()};
      banner.classList.remove('collector-ok','collector-error');
      banner.classList.add('collector-neutral');
      title.textContent='Coleta automática · status atual indisponível';
      meta.textContent='O health atual não respondeu; o último run histórico não é tratado como prova de coleta ativa.';
    }finally{
      clearTimeout(timer);
    }
  }

  window.LJI_FRONTEND_QUALITY_GATES={
    version:'1.3.0',
    commercialStatuses:['approved','hot'],
    matchRequiresApprovedOrHot:true,
    matchRequiresRealPublishedAt:true,
    maxPublicationDays:MAX_PUBLICATION_DAYS,
    dashboardPrioritiesRequireCommercialStatus:true,
    collectorStatusUsesLiveHealth:true
  };

  setTimeout(()=>{
    try{renderMatches?.()}catch(e){console.error('Quality gate · matches:',e)}
    try{renderDashboard?.()}catch(e){console.error('Quality gate · dashboard:',e)}
    try{renderReports?.()}catch(e){console.error('Quality gate · reports:',e)}
    try{window.renderPipeline?.()}catch(e){console.error('Quality gate · pipeline:',e)}
    refreshCollectorHealth();
  },500);
  setTimeout(refreshCollectorHealth,4000);
  setInterval(refreshCollectorHealth,120000);
})();
