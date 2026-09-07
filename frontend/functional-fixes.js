'use strict';

(function(){
  if(window.LJI_FUNCTIONAL_FIXES_V1)return;
  window.LJI_FUNCTIONAL_FIXES_V1=true;

  const notify=(msg)=>{try{window.toast?.(msg)}catch(_){console.log(msg)}};
  const cfg=()=>window.LJI_CONFIG||{};

  async function syncCommercialFixed(){
    const sb=window.LJI_BACKEND?.client;
    const workspaceId=cfg().WORKSPACE_ID;
    if(!sb||!workspaceId)return false;

    try{
      const [tradeRes,companyRes,settingsRes]=await Promise.all([
        sb.from('lji_trade_intents').select('*').eq('workspace_id',workspaceId).eq('status','active').order('created_at',{ascending:false}),
        sb.from('lji_company_demands').select('*').eq('workspace_id',workspaceId).eq('status','active').order('created_at',{ascending:false}),
        sb.from('lji_workspace_settings').select('*').eq('workspace_id',workspaceId).maybeSingle()
      ]);

      if(tradeRes.error)throw tradeRes.error;
      if(companyRes.error)throw companyRes.error;

      if(typeof tradeIntents!=='undefined'){
        tradeIntents=(tradeRes.data||[]).map(r=>({
          id:r.id,
          owner_id:r.owner_ref||'',
          desired_city:r.desired_city,
          desired_neighborhood:r.desired_neighborhood||'',
          desired_type:r.desired_type,
          budget_max:Number(r.budget_max||0),
          beds_min:Number(r.beds_min||0),
          parking_min:Number(r.parking_min||0),
          notes:r.notes||'',
          status:r.status,
          created_at:r.created_at
        }));
      }

      if(typeof companyDemands!=='undefined'){
        companyDemands=(companyRes.data||[]).map(r=>({
          id:r.id,
          name:r.name,
          city:r.city||'',
          type:r.property_type||'',
          budget:Number(r.budget_max||0),
          area_min:Number(r.area_min||0),
          floors_min:Number(r.floors_min||0),
          urgency:Number(r.urgency||2),
          source:r.source||'',
          contact:r.contact||'',
          notes:r.notes||'',
          status:r.status==='active'?'Ativa':r.status,
          created_at:r.created_at
        }));
      }

      if(!settingsRes.error&&settingsRes.data&&typeof commercialRules!=='undefined'){
        commercialRules={
          min_sale_price:Number(settingsRes.data.min_sale_price),
          min_rent_price:Number(settingsRes.data.min_rent_price),
          sale_commission_pct:Number(settingsRes.data.sale_commission_pct),
          extra_fee_pct:Number(settingsRes.data.extra_fee_pct)
        };
        window.commercialRules=commercialRules;
        try{fillCommercialRuleInputs?.()}catch(_){}
      }

      try{renderTrades?.()}catch(e){console.error('[functional-fixes] render trades:',e)}
      try{renderCompanies?.()}catch(e){console.error('[functional-fixes] render companies:',e)}
      try{refreshCitySelectors?.()}catch(_){}
      try{renderDashboard?.()}catch(_){}
      return true;
    }catch(e){
      console.error('[functional-fixes] commercial sync:',e);
      return false;
    }
  }

  window.addTradeIntent=async function(){
    const sb=window.LJI_BACKEND?.client,workspaceId=cfg().WORKSPACE_ID;
    const ownerRef=String(document.getElementById('tOwner')?.value||'');
    const budgetMax=Number(document.getElementById('tBudget')?.value||0);
    if(!ownerRef||!budgetMax){notify('Selecione o imóvel e informe o valor máximo.');return}
    if(!sb||!workspaceId){notify('Supabase indisponível.');return}

    const payload={
      workspace_id:workspaceId,
      owner_ref:ownerRef,
      desired_city:document.getElementById('tCity')?.value||'',
      desired_neighborhood:document.getElementById('tNeighborhood')?.value.trim()||null,
      desired_type:document.getElementById('tType')?.value||'',
      budget_max:budgetMax,
      beds_min:Number(document.getElementById('tBeds')?.value||0),
      parking_min:Number(document.getElementById('tParking')?.value||0),
      notes:document.getElementById('tNotes')?.value.trim()||'',
      status:'active'
    };

    const {error}=await sb.from('lji_trade_intents').insert(payload);
    if(error){console.error('[functional-fixes] save trade:',error);notify('Falha ao salvar permuta.');return}
    notify('Interesse de permuta salvo no Supabase.');
    await syncCommercialFixed();
  };

  window.deleteTradeIntent=async function(id){
    const sb=window.LJI_BACKEND?.client,workspaceId=cfg().WORKSPACE_ID;
    if(!sb||!workspaceId)return;
    const {error}=await sb.from('lji_trade_intents').update({status:'cancelled'}).eq('workspace_id',workspaceId).eq('id',id);
    if(error){console.error('[functional-fixes] delete trade:',error);notify('Falha ao excluir permuta.');return}
    await syncCommercialFixed();
  };

  window.addCompanyDemand=async function(){
    const sb=window.LJI_BACKEND?.client,workspaceId=cfg().WORKSPACE_ID;
    const name=document.getElementById('cName')?.value.trim()||'';
    const budgetMax=Number(document.getElementById('cBudget')?.value||0);
    if(!name||!budgetMax){notify('Informe empresa/grupo e orçamento.');return}
    if(!sb||!workspaceId){notify('Supabase indisponível.');return}

    const payload={
      workspace_id:workspaceId,
      name,
      city:document.getElementById('cCity')?.value.trim()||null,
      property_type:document.getElementById('cType')?.value||'',
      budget_max:budgetMax,
      area_min:Number(document.getElementById('cArea')?.value||0),
      floors_min:Number(document.getElementById('cFloors')?.value||0),
      urgency:Number(document.getElementById('cUrgency')?.value||2),
      source:document.getElementById('cSource')?.value||'',
      contact:document.getElementById('cContact')?.value.trim()||'',
      notes:document.getElementById('cNotes')?.value.trim()||'',
      status:'active'
    };

    const {error}=await sb.from('lji_company_demands').insert(payload);
    if(error){console.error('[functional-fixes] save company:',error);notify('Falha ao salvar demanda corporativa.');return}
    notify('Demanda corporativa salva no Supabase.');
    await syncCommercialFixed();
  };

  window.deleteCompanyDemand=async function(id){
    const sb=window.LJI_BACKEND?.client,workspaceId=cfg().WORKSPACE_ID;
    if(!sb||!workspaceId)return;
    const {error}=await sb.from('lji_company_demands').update({status:'cancelled'}).eq('workspace_id',workspaceId).eq('id',id);
    if(error){console.error('[functional-fixes] delete company:',error);notify('Falha ao excluir demanda.');return}
    await syncCommercialFixed();
  };

  let patchedTimer=null;

  const refresh=async()=>{
    if(document.hidden||!window.LJI_BACKEND?.client)return;
    const indicator=document.getElementById('autoRefreshStatus');
    try{
      const {data:{session}}=await window.LJI_BACKEND.client.auth.getSession();
      if(!session)return;
      if(indicator)indicator.textContent='Atualizando...';
      const jobs=[
        window.LJI_BACKEND.sync?.(),
        (typeof syncIntentions==='function'?syncIntentions():Promise.resolve()),
        window.LJI_BACKEND.syncAdmin?.(),
        window.LJI_BACKEND.syncDiscovery?.(),
        window.LJI_BACKEND.syncMetrics?.(),
        window.LJI_BACKEND.syncDiscarded?.(),
        syncCommercialFixed(),
        window.LJI_BACKEND.syncRegistry?.(),
        window.LJI_BACKEND.syncMatchAlerts?.(),
        window.loadLeadBlocklist?.()
      ];
      await Promise.allSettled(jobs);
      if(indicator){
        let count='';
        try{if(typeof owners!=='undefined'&&Array.isArray(owners))count=String(owners.length)}catch(_){}
        indicator.textContent=`Base ${count||'—'} · atualizada ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`;
        indicator.classList.remove('auto-refresh-error');
      }
    }catch(e){
      console.error('[functional-fixes] auto refresh:',e);
      if(indicator){indicator.textContent='Auto: falha';indicator.classList.add('auto-refresh-error')}
    }
  };

  function ensurePatchedAutoRefresh(){
    // app-backend inicia a própria rotina de refresh só depois do sync inicial.
    // Se ela nascer depois desta camada, substitui nosso timer. Este watchdog
    // detecta isso e reinstala a rotina corrigida; custo desprezível (15 s).
    if(window.LJI_AUTO_REFRESH_TIMER===patchedTimer&&patchedTimer)return;
    if(window.LJI_AUTO_REFRESH_TIMER){
      try{clearInterval(window.LJI_AUTO_REFRESH_TIMER)}catch(_){}
    }
    if(patchedTimer){
      try{clearInterval(patchedTimer)}catch(_){}
    }
    patchedTimer=setInterval(refresh,120000);
    window.LJI_AUTO_REFRESH_TIMER=patchedTimer;
  }

  function install(){
    if(!window.LJI_BACKEND){setTimeout(install,250);return}
    window.LJI_BACKEND.syncCommercial=syncCommercialFixed;
    ensurePatchedAutoRefresh();
    setTimeout(refresh,1000);
    window.LJI_FUNCTIONAL_REFRESH_WATCHDOG=setInterval(ensurePatchedAutoRefresh,15000);

    window.LJI_FUNCTIONAL_FIXES={
      version:'1.1.0',
      tradeSchema:'owner_ref',
      companySchema:'property_type+budget_max',
      commercialSyncPatched:true,
      autoRefreshUsesPatchedCommercialSync:true,
      autoRefreshRaceGuard:true
    };
  }

  install();
})();
