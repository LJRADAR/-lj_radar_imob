'use strict';

(function(){
  if(window.LJI_FRONTEND_ACCESS_CONTRACT_V1)return;
  window.LJI_FRONTEND_ACCESS_CONTRACT_V1=true;

  const cfg=()=>window.LJI_CONFIG||{};
  const client=()=>window.LJI_BACKEND?.client||window.LJI_getSupabaseClient?.()||null;
  const notify=(msg)=>{ try{window.toast?.(msg)}catch(_){console.log(msg)} };

  async function persistAlertStatus(ids,status){
    const sb=client(),workspaceId=cfg().WORKSPACE_ID;
    if(!sb||!workspaceId){notify('Supabase indisponível. O alerta não foi alterado.');return false}
    if(!Array.isArray(ids)||!ids.length)return true;
    let q=sb.from('lji_match_alerts').update({alert_status:status}).eq('workspace_id',workspaceId);
    q=ids.length===1?q.eq('id',ids[0]):q.in('id',ids);
    const {error}=await q;
    if(error){
      console.error('[access-contract] Match alerts:',error);
      notify('Não foi possível salvar o status do alerta.');
      return false;
    }
    try{await window.LJI_BACKEND?.syncMatchAlerts?.()}catch(e){console.error('[access-contract] sync alerts:',e)}
    return true;
  }

  window.markAlertSeen=async function(id){
    if(await persistAlertStatus([id],'seen')){
      try{window.openAlertsPanel?.(null,true)}catch(_){}
    }
  };

  window.dismissAlert=async function(id){
    if(await persistAlertStatus([id],'dismissed')){
      try{window.openAlertsPanel?.(null,true)}catch(_){}
    }
  };

  window.markAllAlertsSeen=async function(){
    let rows=[];
    try{if(typeof matchAlerts!=='undefined'&&Array.isArray(matchAlerts))rows=matchAlerts}catch(_){}
    const ids=rows.filter(a=>a?.alert_status==='new'&&a?.id).map(a=>a.id);
    if(!ids.length)return;
    if(await persistAlertStatus(ids,'seen')){
      try{window.openAlertsPanel?.(null,true)}catch(_){}
    }
  };

  window.restoreDiscardedLeads=async function(){
    const sb=client(),workspaceId=cfg().WORKSPACE_ID,user=window.LJI_CURRENT_USER||{};
    if(!sb||!workspaceId){notify('Faça login primeiro.');return}

    let total=0;
    try{
      if(typeof ljiBlocklist!=='undefined')total=(ljiBlocklist?.phones?.size||0)+(ljiBlocklist?.urls?.size||0);
    }catch(_){}
    if(!total){notify('A lixeira está vazia.');return}

    const isAdmin=['super_admin','gestor'].includes(user.role||'');
    const message=isAdmin
      ? `Restaurar tudo o que está na lixeira (${total} registro${total===1?'':'s'})?\n\nOs leads voltarão a aparecer nas listas.`
      : `Restaurar os descartes feitos por você?\n\nDescartes de outros usuários do workspace serão preservados.`;
    if(!window.confirm(message))return;

    try{
      let q=sb.from('lji_lead_blocklist').delete().eq('workspace_id',workspaceId);
      if(!isAdmin){
        if(!user.id){notify('Usuário não identificado. Nada foi alterado.');return}
        q=q.eq('created_by',user.id);
      }
      const {data,error}=await q.select('id');
      if(error)throw error;

      try{await window.loadLeadBlocklist?.()}catch(e){console.error('[access-contract] reload blocklist:',e)}
      try{window.renderAll?.()}catch(_){}

      const removed=Array.isArray(data)?data.length:0;
      if(isAdmin)notify(`Lixeira restaurada${removed?` · ${removed} registro${removed===1?'':'s'}`:''}.`);
      else notify(removed?'Seus descartes foram restaurados.':'Nenhum descarte seu precisava ser restaurado.');
    }catch(e){
      console.error('[access-contract] blocklist restore:',e);
      notify('Não foi possível restaurar a lixeira. Nenhum estado local foi apagado.');
    }
  };

  window.LJI_ACCESS_CONTRACT={
    version:'1.0.0',
    audited_at:'2026-09-07',
    alertStatusPersistence:'workspace_member_column_update',
    blocklistRestore:'workspace_scoped_role_aware',
    silentPermissionFailures:false
  };
})();
