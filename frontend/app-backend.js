'use strict';

(function(){
  const cfg = window.LJI_CONFIG || {MODE:"local"};
  let sb = null;

  const runtimeWarnings=[];
  function noteRuntimeWarning(step,error){
    runtimeWarnings.push({step,message:String(error?.message||error||'erro'),at:new Date().toISOString()});
    window.LJI_RUNTIME_WARNINGS=runtimeWarnings;
    console.error(`[LJ Radar] ${step}:`,error);
  }
  function safeRenderAll(){
    const renders=[
      ['Cidades e filtros',()=>refreshCitySelectors()],
      ['Busca Profunda',()=>renderDeepSearch()],
      ['Proprietários',()=>renderOwners()],
      ['Pesquisa Registral',()=>renderRegistrySearches()],
      ['Leads e WhatsApp',()=>renderWhatsAppLeads()],
      ['Verificação de Contato',()=>renderContactCheck()],
      ['Descartados',()=>renderDiscarded()],
      ['Compradores',()=>renderBuyers()],
      ['Radar de Intenção',()=>renderIntentions()],
      ['Matches',()=>renderMatches()],
      ['Dashboard',()=>renderDashboard()],
      ['Permutas',()=>renderTrades()],
      ['Empresas',()=>renderCompanies()],
      ['Relatórios',()=>renderReports()],
      ['Usuários',()=>renderAdminUsers()],
      ['Histórico',()=>renderHistory()],
      ['Gráficos',()=>renderOperationMetrics()],
      ['Integrações',()=>renderIntegrationStatus()],
      ['Links de gráficos',()=>ensureChartLinks()]
    ];
    renders.forEach(([name,fn])=>{try{fn()}catch(e){noteRuntimeWarning(`render ${name}`,e)}});
  }
  function withTimeout(promise,ms,label='operação'){
    let timer;
    const timeout=new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error(`${label}: tempo limite de ${Math.round(ms/1000)}s excedido`)),ms);
    });
    return Promise.race([Promise.resolve(promise),timeout]).finally(()=>clearTimeout(timer));
  }
  async function safeSyncStep(name,fn,timeoutMs=15000){
    try{
      await withTimeout(fn(),timeoutMs,name);
      return true;
    }catch(e){
      noteRuntimeWarning(name,e);
      return false;
    }
  }

  function roleLabelRuntime(role){
    return role==='super_admin'?'CEO':role==='gestor'?'Gestora':role==='corretor'?'Corretora':'Usuário';
  }
  function fallbackUserName(email,preferred){
    if(preferred)return preferred;
    return email?String(email).split('@')[0]:'Usuário';
  }
  function renderUserIdentity(session,member,preferredName){
    const email=session?.user?.email||'';
    const name=fallbackUserName(email,preferredName);
    const role=member?.role||'';
    const initials=String(name||'U').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();
    const nameEl=document.getElementById('currentUserName'),roleEl=document.getElementById('currentUserRole'),avatar=document.getElementById('currentUserAvatar');
    if(nameEl)nameEl.textContent=name;if(roleEl)roleEl.textContent=roleLabelRuntime(role);if(avatar)avatar.textContent=initials||'U';
    const greetingName=document.getElementById('dashGreetingName');
    if(greetingName)greetingName.textContent=name;
    window.LJI_CURRENT_USER={...(window.LJI_CURRENT_USER||{}),id:session?.user?.id||window.LJI_CURRENT_USER?.id||'',email,name,role,permissions:member?.permissions||window.LJI_CURRENT_USER?.permissions||{}};
    return name;
  }
  function updateBaseSyncStatus(label){const el=document.getElementById('autoRefreshStatus');if(el)el.textContent=label;}
  function updateOperationState(label,state='neutral'){
    const strong=document.getElementById('operationStateLabel'),wrap=document.getElementById('dashOnlineState');
    if(strong)strong.textContent=label;
    if(wrap){wrap.classList.remove('state-ok','state-warning','state-error');if(state==='ok')wrap.classList.add('state-ok');else if(state==='warning')wrap.classList.add('state-warning');else if(state==='error')wrap.classList.add('state-error');}
    const connected=document.getElementById('dashConnectedState'),connectedLabel=document.getElementById('dashConnectedLabel');
    if(connected){connected.classList.remove('state-ok','state-warning','state-error');if(state==='ok')connected.classList.add('state-ok');else if(state==='warning')connected.classList.add('state-warning');else if(state==='error')connected.classList.add('state-error');}
    if(connectedLabel)connectedLabel.textContent=state==='error'?'Falha':state==='warning'?'Atenção':'Conectado';
  }

  async function initBackend(){
    const status=document.getElementById('backendStatus');
    if(!cfg||cfg.MODE!=='supabase'||!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY||!cfg.WORKSPACE_ID){
      if(status)status.textContent='Modo local';
      return;
    }

    try{
      sb=window.LJI_getSupabaseClient();
      if(!sb)throw new Error('Supabase client indisponível');
      const {data:{session},error:sessionError}=await withTimeout(sb.auth.getSession(),10000,'sessão Supabase');
      if(sessionError)throw sessionError;

      if(!session){
        if(status)status.textContent='Supabase conectado · login necessário';
        updateOperationState('Login necessário','warning');
        return;
      }

      const {data:member,error:memberError}=await withTimeout(
        sb.from('lji_workspace_members')
          .select('role,is_active,permissions')
          .eq('workspace_id',cfg.WORKSPACE_ID)
          .eq('user_id',session.user.id)
          .eq('is_active',true)
          .maybeSingle(),
        12000,
        'permissões do workspace'
      );

      if(memberError)throw memberError;
      if(!member){
        if(status)status.textContent='Usuário sem acesso ao workspace';
        updateOperationState('Usuário sem acesso','error');
        await sb.auth.signOut();
        window.location.reload();
        return;
      }

      document.getElementById('ljiAuthOverlay')?.classList.add('hidden');

      let persistedName=renderUserIdentity(session,member,session.user.user_metadata?.display_name||'');
      try{
        const {data:profile,error:profileError}=await sb.from('lj_v2_user_profiles').select('display_name').eq('user_id',session.user.id).maybeSingle();
        if(profileError)noteRuntimeWarning('perfil do usuário',profileError);
        if(profile?.display_name)persistedName=profile.display_name;
      }catch(e){noteRuntimeWarning('perfil do usuário',e)}
      renderUserIdentity(session,member,persistedName);
      try{window.LJI_applyRoleUI?.(session.user.email,member.role,member.permissions,persistedName)}catch(e){noteRuntimeWarning('UI do perfil',e)}
      renderUserIdentity(session,member,persistedName);
      try{await window.LJI_loadUserPreferences?.()}catch(e){noteRuntimeWarning('preferências',e)}

      const roleLabel=member.role==='super_admin'?'CEO':member.role==='gestor'?'Gestora':'Corretora';
      if(status)status.textContent='Supabase conectado · '+roleLabel;
      updateOperationState('Base conectada','ok');

      // Um erro isolado de tela/módulo não derruba mais toda a conexão.
      await safeSyncStep('sincronização principal',syncFromSupabase);
      await safeSyncStep('Radar de Intenção',syncIntentions);
      await safeSyncStep('administração/histórico',syncAdminData);
      await safeSyncStep('descartados',syncDiscardedData);
      await safeSyncStep('Busca Profunda',syncDiscoveryData);
      await safeSyncStep('Permutas e Empresas',syncCommercialModules);
      await safeSyncStep('Pesquisa Registral',syncRegistrySearches);
      await safeSyncStep('gráficos',syncOperationMetrics);

      try{patchWriters()}catch(e){noteRuntimeWarning('patch de gravação',e)}
      try{ensureChartLinks()}catch(e){noteRuntimeWarning('links de gráficos',e)}
      try{ensureBackButtons()}catch(e){noteRuntimeWarning('botões voltar',e)}
      try{safeRenderAll()}catch(e){noteRuntimeWarning('render final',e)}
      try{renderIntegrationStatus()}catch(e){noteRuntimeWarning('status integrações',e)}

      if(status)status.textContent='Supabase conectado · '+roleLabel;
    }catch(e){
      console.error('LJ Radar Imob conexão backend:',e);
      if(status)status.textContent='Falha de conexão com Supabase';
      updateOperationState('Falha no Supabase','error');
    }
  }

  async function syncFromSupabase(){
    if(!sb) return;

    const [{data: buyersRemote, error: buyersErr}, historyRes] = await Promise.all([
      sb.from('lji_buyers')
        .select('*')
        .eq('workspace_id', cfg.WORKSPACE_ID)
        .eq('status','active')
        .order('created_at',{ascending:false}),
      sb.rpc('lji_get_opportunity_history',{p_workspace:cfg.WORKSPACE_ID})
    ]);

    if(!buyersErr && Array.isArray(buyersRemote)){
      buyers = buyersRemote.map(b=>({
        id:b.id,name:b.name,city:b.city||'',neighborhood:b.neighborhood||'',type:b.property_type||'Apartamento',transaction_type:b.transaction_type||'sale',budget:Number(b.budget_max||0),beds:Number(b.bedrooms_min||0),parking:Number(b.parking_min||0),area_min:Number(b.area_min||0),urgency:Number(b.urgency||2),source:b.source||'',contact:b.contact||'',source_url:b.source_url||'',published_at:b.published_at||''
      }));
    }

    if(!historyRes.error && Array.isArray(historyRes.data)){
      owners = historyRes.data
        .filter(o=>!o.is_commercial)
        .map(o=>({
          id:o.opportunity_id||('hist-'+o.id),
          history_id:o.id,
          opportunity_id:o.opportunity_id||'',
          title:o.title||'Imóvel sem título',
          city:o.city||'',
          neighborhood:o.neighborhood||'',
          address:o.address||'',
          cep:o.cep||o.postal_code||'',
          type:o.property_type||inferResidentialType(o),
          transaction_type:o.transaction_type||'sale',
          price:Number(o.price||0),
          beds:Number(o.bedrooms||0),
          parking:Number(o.parking||0),
          area:Number(o.area||0),
          status:o.radar_status||'Histórico',
          source:o.source||'Radar',
          published_at:o.published_at||'',
          first_seen_at:o.first_seen_at||'',
          last_seen_at:o.last_seen_at||'',
          activity_date:o.published_at||o.last_seen_at||o.first_seen_at||'',
          quinto_status:o.quinto_status||'',
          handled_by_user_id:o.handled_by_user_id||'',
          handled_by_name:o.handled_by_name||'',
          handled_at:o.handled_at||'',
          image_url:o.image_url||'',
          contact_name:o.contact_name||'',
          contact_phone:o.contact_phone||'',
          whatsapp_url:o.whatsapp_url||'',
          contact_method:o.contact_method||'',
          contact_verified_at:o.contact_verified_at||'',
          contact_verified_by:o.contact_verified_by||'',
          contact_verified_phone:o.contact_verified_phone||'',
          contact_verification_note:o.contact_verification_note||'',
          is_current:o.is_current===true,
          archived_at:o.archived_at||'',
          origin_table:o.origin_table||'',
          url:o.source_url||''
        }))
        .sort((a,b)=>(new Date(b.activity_date).getTime()||0)-(new Date(a.activity_date).getTime()||0));
    }else if(historyRes.error){
      console.error('Histórico de imóveis:',historyRes.error);
    }

    updateBaseSyncStatus(`Base ${owners.length} · atualizada ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`);
    safeRenderAll();
    // Reforço pós-sincronização: os widgets comerciais do Dashboard precisam
    // usar a base já preenchida, e nunca o estado vazio inicial.
    setTimeout(()=>{try{renderDashboard()}catch(e){console.error('Dashboard pós-sync:',e)}},60);
  }


  async function syncAdminData(){
    if(!sb) return;
    try{
      const [{data:members,error:membersErr},{data:profiles,error:profilesErr},{data:runs,error:runsErr},{data:activities,error:activityErr},{data:pipelineEvents,error:pipelineErr}] = await Promise.all([
        sb.from('lji_workspace_members').select('user_id,role,is_active,permissions,created_at').eq('workspace_id',cfg.WORKSPACE_ID).order('created_at',{ascending:true}),
        sb.from('lj_profiles').select('user_id,full_name,role,active'),
        sb.from('lj_v2_collector_runs').select('id,workspace_id,run_mode,status,city,transaction_type,total_raw_results,total_new_results,total_errors,created_at,started_at,finished_at').eq('workspace_id',cfg.WORKSPACE_ID).order('created_at',{ascending:false}).limit(100),
        sb.from('lji_activity_log').select('id,user_id,event_type,entity_type,entity_id,details,created_at').eq('workspace_id',cfg.WORKSPACE_ID).order('created_at',{ascending:false}).limit(100),
        sb.from('lji_activity_log').select('id,user_id,event_type,entity_type,entity_id,details,created_at').eq('workspace_id',cfg.WORKSPACE_ID).in('event_type',['pipeline_stage_changed','sales_note_added','sales_contact_logged','sales_action_queued','sales_action_approved','sales_action_completed','sales_action_cancelled','sales_agent_draft','whatsapp_message_received','whatsapp_message_sent','whatsapp_message_failed','whatsapp_lead_linked','sales_inbox_analysis','sales_match_profile','whatsapp_thread_read']).order('created_at',{ascending:false}).limit(3000)
      ]);
      let security=[];
      if(window.LJI_CURRENT_USER?.role==='super_admin'){
        const secRes=await sb.from('lj_v2_security_audit').select('id,event_type,target_entity,description,created_at').order('created_at',{ascending:false}).limit(100);
        if(!secRes.error && Array.isArray(secRes.data)) security=secRes.data;
      }
      const profileMap=new Map((profilesErr?[]:(profiles||[])).map(p=>[String(p.user_id),p]));
      const joined=(membersErr?[]:(members||[])).map(m=>{
        const p=profileMap.get(String(m.user_id))||{};
        return {...m,name:p.full_name||('Usuário '+String(m.user_id).slice(0,8))};
      });
      window.LJI_ADMIN_STATE={
        members:joined,
        collectorRuns:runsErr?[]:(runs||[]),
        activities:activityErr?[]:(activities||[]),
        pipelineEvents:pipelineErr?[]:(pipelineEvents||[]),
        security
      };
      ownerTeamMembers=joined;
      renderAdminUsers();
      renderHistory();
      renderOwners();
      try{window.renderPipeline?.()}catch(e){console.error('Pipeline:',e)}
      refreshCitySelectors();
      renderIntegrationStatus();
    }catch(e){
      console.error('Admin/history sync:',e);
    }
  }


  async function syncDiscardedData(){
    if(!sb) return;
    try{
      const {data,error}=await sb.rpc('lji_get_discarded_candidates');
      if(error) throw error;
      discardedCandidates=Array.isArray(data)?data:[];
      renderDiscarded();
    }catch(e){
      console.error('Descartados / não aprovados:',e);
      discardedCandidates=[];
      renderDiscarded();
    }
  }


  async function syncOperationMetrics(){
    if(!sb)return;
    try{
      const end=new Date().toISOString().slice(0,10);
      const {data,error}=await sb.rpc('lji_operation_metrics',{p_workspace:cfg.WORKSPACE_ID,p_start:'2026-08-20',p_end:end});
      if(error)throw error;
      operationMetrics=Array.isArray(data)?data:[];
      renderOperationMetrics();
    }catch(e){console.error('Gráficos da operação:',e);operationMetrics=[];renderOperationMetrics()}
  }


  async function updateCollectorServerBanner(run,error){
    const banner=document.getElementById('collectorServerBanner'),title=document.getElementById('collectorServerStatus'),meta=document.getElementById('collectorServerMeta');
    if(!banner||!title||!meta)return;
    banner.classList.remove('collector-ok','collector-error','collector-neutral');
    if(error||!run){
      banner.classList.add('collector-neutral');
      title.textContent='Coletor servidor V2 · status indisponível';
      meta.textContent='A interface não conseguiu consultar a última execução.';
      return;
    }
    const when=run.created_at?new Date(run.created_at).toLocaleString('pt-BR'):'data não informada';
    if(run.status==='completed'||run.status==='partial'){
      banner.classList.add('collector-ok');
      title.textContent=run.status==='completed'?'Coletor servidor V2 ativo':'Coletor servidor V2 · execução parcial';
      meta.textContent=`Última execução ${when} · ${Number(run.total_new_results||0)} novo(s) · ${Number(run.total_errors||0)} erro(s).`;
    }else if(run.status==='failed'){
      banner.classList.add('collector-error');
      title.textContent='Coletor pausado por falha externa';
      meta.textContent=`Última execução ${when} falhou${run.error_message?' · '+String(run.error_message).slice(0,140):''}. A base existente permanece preservada.`;
    }else{
      banner.classList.add('collector-neutral');
      title.textContent=`Coletor servidor V2 · ${run.status||'aguardando'}`;
      meta.textContent=`Última atualização: ${when}.`;
    }
  }

  async function runContactCapture(){
    const client=window.LJI_BACKEND?.client;
    const btn=document.getElementById('contactCaptureBtn');
    const status=document.getElementById('contactCaptureStatus');
    if(!client){
      if(status)status.textContent='Faça login para executar a captação.';
      return;
    }
    const city=document.getElementById('contactCaptureCity')?.value?.trim()||'';
    const state=(document.getElementById('contactCaptureState')?.value||'').trim().toUpperCase();
    const transaction_type=document.getElementById('contactCaptureTx')?.value||'sale';
    const property_type=document.getElementById('contactCaptureType')?.value||null;
    if(!city||state.length!==2){
      if(status)status.textContent='Informe cidade e UF.';
      return;
    }
    try{
      if(btn){btn.disabled=true;btn.textContent='Captando...'}
      if(status)status.textContent='Buscando proprietário + contato público em Facebook, Marketplace e web aberta...';
      const {data,error}=await client.functions.invoke('captador-contato-publico-lj-v1',{
        body:{
          action:'capture',
          workspace_id:(window.LJI_CONFIG||{}).WORKSPACE_ID,
          city,
          state_code:state,
          transaction_type,
          property_type,
          query_limit:2,
          results_per_query:10
        }
      });
      if(error){
        console.error('Captação com contato:',error);
        if(status)status.textContent='Busca externa indisponível nesta execução; nenhum lead fictício foi criado.';
        return;
      }
      if(data?.error){
        if(status)status.textContent=`Captação não concluída: ${String(data.error).replace(/_/g,' ')}.`;
        return;
      }
      const r=data?.report||{};
      await window.LJI_BACKEND?.syncDiscovery?.();
      renderWhatsAppLeads();
      if(status)status.textContent=`Concluído: ${Number(r.saved||0)} lead(s) salvo(s) · ${Number(r.with_phone||0)} com telefone público · ${Number(r.rejected_professional||0)} profissional(is) descartado(s).`;
    }catch(e){
      console.error(e);
      if(status)status.textContent='Falha na captação direcionada. Nenhum dado fictício foi criado.';
    }finally{
      if(btn){btn.disabled=false;btn.textContent='Captar com contato'}
    }
  }
  window.runContactCapture=runContactCapture;

  async function syncRegistrySearches(){
    if(!sb)return;
    try{
      const {data,error}=await sb.from('lji_registry_searches').select('*').eq('workspace_id',cfg.WORKSPACE_ID).order('created_at',{ascending:false});
      if(error){console.error('Pesquisa Registral:',error);return}
      registrySearches=(data||[]);
      renderRegistrySearches();
    }catch(e){console.error('Pesquisa Registral:',e)}
  }

  async function syncCommercialModules(){
    if(!sb)return;
    try{
      const [tradeRes,companyRes,settingsRes]=await Promise.all([
        sb.from('lji_trade_intents').select('*').eq('workspace_id',cfg.WORKSPACE_ID).eq('status','active').order('created_at',{ascending:false}),
        sb.from('lji_company_demands').select('*').eq('workspace_id',cfg.WORKSPACE_ID).eq('status','active').order('created_at',{ascending:false}),
        sb.from('lji_workspace_settings').select('*').eq('workspace_id',cfg.WORKSPACE_ID).maybeSingle()
      ]);
      if(!tradeRes.error)tradeIntents=(tradeRes.data||[]).map(r=>({id:r.id,owner_id:r.owner_id,desired_city:r.desired_city,desired_neighborhood:r.desired_neighborhood||'',desired_type:r.desired_type,budget_max:Number(r.budget_max||0),beds_min:Number(r.beds_min||0),parking_min:Number(r.parking_min||0),notes:r.notes||'',status:r.status,created_at:r.created_at}));
      if(!companyRes.error)companyDemands=(companyRes.data||[]).map(r=>({id:r.id,name:r.name,city:r.city||'',type:r.type,budget:Number(r.budget||0),area_min:Number(r.area_min||0),floors_min:Number(r.floors_min||0),urgency:Number(r.urgency||2),source:r.source||'',contact:r.contact||'',notes:r.notes||'',status:r.status==='active'?'Ativa':r.status,created_at:r.created_at}));
      if(!settingsRes.error&&settingsRes.data){
        commercialRules={min_sale_price:Number(settingsRes.data.min_sale_price),min_rent_price:Number(settingsRes.data.min_rent_price),sale_commission_pct:Number(settingsRes.data.sale_commission_pct),extra_fee_pct:Number(settingsRes.data.extra_fee_pct)};
        window.commercialRules=commercialRules;
        if(typeof fillCommercialRuleInputs==='function')fillCommercialRuleInputs();
      }
      if(tradeRes.error)console.error('Permutas:',tradeRes.error);
      if(companyRes.error)console.error('Empresas:',companyRes.error);
      if(settingsRes.error)console.error('Regras comerciais:',settingsRes.error);
      renderTrades();renderCompanies();refreshCitySelectors();
      if(typeof renderDashboard==='function')renderDashboard();
    }catch(e){console.error('Módulos comerciais:',e)}
  }
  async function saveCommercialRules(){
    if(!sb){toast('Supabase indisponível.');return}
    const payload={
      workspace_id:cfg.WORKSPACE_ID,
      min_sale_price:Number(document.getElementById('setMinSale')?.value||0),
      min_rent_price:Number(document.getElementById('setMinRent')?.value||0),
      sale_commission_pct:Number(document.getElementById('setSaleCommission')?.value||0),
      extra_fee_pct:Number(document.getElementById('setExtraFee')?.value||0),
      updated_at:new Date().toISOString()
    };
    const {error}=await sb.from('lji_workspace_settings').upsert(payload,{onConflict:'workspace_id'});
    if(error){console.error(error);toast('Não foi possível salvar as regras.');return}
    commercialRules={min_sale_price:payload.min_sale_price,min_rent_price:payload.min_rent_price,sale_commission_pct:payload.sale_commission_pct,extra_fee_pct:payload.extra_fee_pct};
    window.commercialRules=commercialRules;
    if(typeof renderDashboard==='function')renderDashboard();
    toast('Regras comerciais salvas — já valem no KPI de receita estimada do Dashboard.');
  }
  window.saveCommercialRules=saveCommercialRules;
  async function syncMatchAlerts(){
    if(!sb)return;
    try{
      const {data,error}=await sb.from('lji_match_alerts')
        .select('*, lji_buyer_intents(person_name,title,region,transaction_type,intent_role,budget_max,property_type,contact), lji_opportunity_index(title,city,price,transaction_type,source_url)')
        .eq('workspace_id',cfg.WORKSPACE_ID)
        .neq('alert_status','dismissed')
        .order('first_seen_at',{ascending:false})
        .limit(50);
      if(error)throw error;
      matchAlerts=Array.isArray(data)?data:[];
      if(typeof updateAlertsBell==='function')updateAlertsBell();
    }catch(e){console.error('Alertas de match:',e)}
  }

  async function syncDiscoveryData(){
    if(!sb)return;
    try{
      const [leadRes,sourceRes,profileRes,runRes]=await Promise.all([
        sb.from('lji_discovered_leads').select('*').eq('workspace_id',cfg.WORKSPACE_ID).order('published_at',{ascending:false,nullsFirst:false}).order('discovered_at',{ascending:false}),
        sb.from('lj_v2_sources').select('id,name,domain,source_type,priority_tier,is_active'),
        sb.from('lj_v2_collector_source_profiles').select('source_id,is_active,total_queries,total_results,total_new_results,total_approved_leads,last_query_at'),
        sb.from('lj_v2_collector_runs').select('status,workspace_id,created_at,total_new_results,total_errors,total_queries,error_message').eq('workspace_id',cfg.WORKSPACE_ID).order('created_at',{ascending:false}).limit(1).maybeSingle()
      ]);
      discoveredLeads=leadRes.error?[]:(leadRes.data||[]);
      const profiles=new Map((profileRes.error?[]:(profileRes.data||[])).map(p=>[String(p.source_id),p]));
      sourceProfiles=(sourceRes.error?[]:(sourceRes.data||[])).map(s=>({...s,...(profiles.get(String(s.id))||{}),source_active:s.is_active}));
      updateCollectorServerBanner(runRes.data,runRes.error);
      renderDeepSearch();
      refreshCitySelectors();
      renderIntegrationStatus();
    }catch(e){console.error('Busca Profunda:',e);discoveredLeads=[];updateCollectorServerBanner(null,e);renderDeepSearch()}
  }

  function patchWriters(){
    const originalAddBuyer = window.addBuyer;
    window.addBuyer = async function(){
      const name=document.getElementById('bName').value.trim();
      const budget=Number(document.getElementById('bBudget').value);
      if(!name||!budget){toast('Preencha nome e orçamento.');return}

      const payload = {
        workspace_id: cfg.WORKSPACE_ID,
        name,
        city: document.getElementById('bCity').value,
        neighborhood: document.getElementById('bNeighborhood')?.value.trim() || '',
        property_type: document.getElementById('bType').value,
        transaction_type: document.getElementById('bTransactionType')?.value || 'sale',
        budget_max: budget,
        bedrooms_min: Number(document.getElementById('bBeds').value||0),
        parking_min: Number(document.getElementById('bParking').value||0),
        area_min: Number(document.getElementById('bArea').value||0),
        urgency: Number(document.getElementById('bUrgency').value),
        source: document.getElementById('bSource').value,
        contact: document.getElementById('bContact').value.trim(),
        status:'active'
      };

      const {error} = await sb.from('lji_buyers').insert(payload);
      if(error){
        console.error(error);
        toast('Falha ao salvar no Supabase. Nenhum comprador local foi criado.');
        return;
      }

      toast('Comprador salvo no Supabase. Buscando oportunidades...');
      await syncFromSupabase();

      try{
        let region=typeof canonicalBuyerRegion==='function'?canonicalBuyerRegion(payload.city):payload.city;
        if(region==='São Paulo' && payload.neighborhood && typeof LJI_SP_NEIGHBORHOOD_REGION!=='undefined'){
          region=LJI_SP_NEIGHBORHOOD_REGION.get(matchNeighborhoodNorm(payload.neighborhood))||region;
        }
        const supported=['Santo André','São Bernardo do Campo','São Caetano do Sul','Diadema','São Paulo — Centro','São Paulo — Zona Sul','São Paulo — Zona Leste','São Paulo — Zona Oeste','São Paulo — Zona Norte'];
        if(supported.includes(region)){
          const txs=payload.transaction_type==='both'?['sale','rent']:[payload.transaction_type];
          const calls=txs.map(transaction_type=>sb.functions.invoke('radar-intencao-lj-v1',{body:{
            workspace_id:cfg.WORKSPACE_ID,region,transaction_type,intent_role:'buyer',
            neighborhood:payload.neighborhood||'',property_type:payload.property_type||''
          }}));
          const results=await Promise.allSettled(calls);
          const ok=results.filter(r=>r.status==='fulfilled'&&!r.value?.error).length;
          await syncIntentions();
          toast(ok?`Comprador salvo · busca direcionada executada (${ok}).`:'Comprador salvo · busca externa sem resultado nesta tentativa.');
        }else{
          toast('Comprador salvo e cruzado com a base atual.');
        }
      }catch(e){
        console.error('Busca automática do comprador:',e);
        toast('Comprador salvo. A busca automática será tentada novamente pelo Radar.');
      }
    };
  }


  async function verifyOpenLeadsNow(){
    if(!sb){toast('Supabase não conectado.');return}
    try{
      toast('Verificando leads abertos no QuintoAndar...');
      const {data,error}=await sb.functions.invoke('verificar-leads-abertos-lj-v1',{body:{workspace_id:cfg.WORKSPACE_ID,limit:20}});
      if(error)throw error;
      await syncDiscoveryData();
      renderWhatsAppLeads();
      toast(`QuintoAndar: ${data?.checked||0} verificado(s) · ${data?.outside_quintoandar||0} fora · ${data?.found_on_quintoandar||0} já no QA · ${data?.inconclusive||0} inconclusivo(s).`);
    }catch(e){console.error(e);toast('Falha ao verificar QuintoAndar agora. O verificador automático continuará rodando.')}
  }
  window.verifyOpenLeadsNow=verifyOpenLeadsNow;

  window.LJI_BACKEND = {
    get client(){ return sb; },
    sync: syncFromSupabase,
    syncAdmin: syncAdminData,
    syncDiscarded: syncDiscardedData,
    syncDiscovery: syncDiscoveryData,
    syncCommercial: syncCommercialModules,
    syncRegistry: syncRegistrySearches,
    syncMatchAlerts: syncMatchAlerts,
    verifyOpenLeads: verifyOpenLeadsNow,
    syncMetrics: syncOperationMetrics,
    mode: cfg.MODE || 'local'
  };

  function startAutoRefresh(){
    if(window.LJI_AUTO_REFRESH_TIMER)clearInterval(window.LJI_AUTO_REFRESH_TIMER);

    const refresh=async()=>{
      if(document.hidden||!sb)return;
      try{
        const {data:{session}}=await sb.auth.getSession();
        if(!session)return;

        const indicator=document.getElementById('autoRefreshStatus');
        if(indicator)indicator.textContent='Atualizando...';

        const jobs=[syncFromSupabase(),syncIntentions(),syncAdminData(),syncDiscoveryData(),syncOperationMetrics(),syncDiscardedData(),syncCommercialModules(),syncRegistrySearches(),syncMatchAlerts(),(window.loadLeadBlocklist?window.loadLeadBlocklist():Promise.resolve())];
        await Promise.allSettled(jobs);
        if(indicator){
          indicator.textContent=`Base ${owners.length} · atualizada ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`;
          indicator.classList.remove('auto-refresh-error');
        }
      }catch(e){
        console.error('Auto atualização LJ Radar:',e);
        const indicator=document.getElementById('autoRefreshStatus');
        if(indicator){
          indicator.textContent='Auto: falha';
          indicator.classList.add('auto-refresh-error');
        }
      }
    };

    // Primeira atualização curta após o login, depois a cada 2 minutos.
    setTimeout(refresh,15000);
    window.LJI_AUTO_REFRESH_TIMER=setInterval(refresh,120000);
  }

  initBackend().finally(()=>startAutoRefresh());
})();
