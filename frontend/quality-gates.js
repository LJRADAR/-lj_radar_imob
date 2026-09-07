'use strict';

(function(){
  if(window.LJI_FRONTEND_QUALITY_GATES_V1)return;
  window.LJI_FRONTEND_QUALITY_GATES_V1=true;

  const MAX_PUBLICATION_DAYS=365;
  const MAX_FUTURE_MS=86400000;

  function verifiedPublication(o){
    const raw=o?.published_at||'';
    if(!raw)return false;
    const d=new Date(raw);
    if(Number.isNaN(d.getTime()))return false;
    const age=Date.now()-d.getTime();
    return age>=-MAX_FUTURE_MS && age<=MAX_PUBLICATION_DAYS*86400000;
  }

  function approvedOpportunity(o){
    return Boolean(o?.is_current)
      && String(o?.status||'').toLowerCase()==='approved'
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

  // Match remoto: o imóvel precisa ter data real e válida. A intenção pode manter
  // captured_at como recência enquanto a fonte social não entrega published_at,
  // mas nunca promovemos um imóvel sem publicação comprovada.
  if(typeof matchFilteredRows==='function'){
    matchFilteredRows=function(applySource=true){
      const source=applySource?(document.getElementById('matchSourceFilter')?.value||''):'';
      const rows=Array.isArray(intentMatchesRemote)?intentMatchesRemote:[];
      return rows.filter(m=>{
        const sourceOk=!source||matchSourceName(m.opportunity_source)===source||matchSourceName(m.intent_source_name)===source;
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

  // Relatórios financeiros/VGV devem considerar somente oportunidades aprovadas.
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
  // estado real da base e usa somente aprovados nos elementos de prioridade.
  if(typeof renderDashboard==='function'){
    const baseDashboard=renderDashboard;
    renderDashboard=function(){
      const result=baseDashboard();
      const current=(Array.isArray(owners)?owners:[]).filter(o=>o?.is_current&&o?.status!=='rejected');
      const approved=current.filter(approvedOpportunity);
      const review=current.filter(o=>String(o?.status||'').toLowerCase()==='review');
      const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v};
      set('mOwners',current.length);
      set('mUnassigned',approved.filter(o=>!o?.handled_by_user_id).length);
      set('mOwnersMeta',`${approved.length} aprovada${approved.length===1?'':'s'} · ${review.length} em revisão · ${owners.length} no histórico`);
      set('dashCountLabel',`${approved.length} aprovada${approved.length===1?'':'s'} · ${review.length} em revisão`);
      window.LJI_DASHBOARD_DIAGNOSTIC={
        ...(window.LJI_DASHBOARD_DIAGNOSTIC||{}),
        approved:approved.length,
        review:review.length,
        publicationGateDays:MAX_PUBLICATION_DAYS,
        frontendQualityGate:'approved+real_published_at'
      };
      return result;
    };
  }

  window.LJI_FRONTEND_QUALITY_GATES={
    version:'1.0.0',
    matchRequiresApproved:true,
    matchRequiresRealPublishedAt:true,
    maxPublicationDays:MAX_PUBLICATION_DAYS,
    dashboardPrioritiesRequireApproved:true
  };

  setTimeout(()=>{
    try{renderMatches?.()}catch(e){console.error('Quality gate · matches:',e)}
    try{renderDashboard?.()}catch(e){console.error('Quality gate · dashboard:',e)}
    try{renderReports?.()}catch(e){console.error('Quality gate · reports:',e)}
    try{window.renderPipeline?.()}catch(e){console.error('Quality gate · pipeline:',e)}
  },0);
})();
