'use strict';

/* LJ Radar Imob — Coleta controlada da Central de Captação v29.2
   A interface não expõe o provedor técnico. A coleta só roda por ação explícita do usuário. */
(function(){
  const q=(s,r=document)=>r.querySelector(s);
  let running=false;

  function client(){try{return window.LJI_getSupabaseClient?.()||null;}catch(_){return null;}}
  function workspace(){try{return window.LJI_CONFIG?.WORKSPACE_ID||localStorage.getItem('lji_workspace_id')||null;}catch(_){return null;}}

  function ensureStatus(host){
    let el=q('[data-cap-collector-status]',host);
    if(el)return el;
    el=document.createElement('span');
    el.dataset.capCollectorStatus='1';
    el.style.cssText='font-size:12px;color:var(--muted,#64748b);margin-right:8px;white-space:nowrap';
    host.prepend(el);
    return el;
  }

  async function runCollection(button){
    if(running)return;
    const sb=client(),ws=workspace();
    const host=button.closest('.lji-cap-head-actions')||button.parentElement;
    const status=ensureStatus(host);
    if(!sb||!ws){status.textContent='Conexão indisponível';return;}

    running=true;button.disabled=true;button.textContent='Buscando…';status.textContent='Coleta controlada em andamento';
    try{
      const {data,error}=await sb.functions.invoke('coletor-lj-v2',{
        body:{
          action:'collect',
          workspace_id:ws,
          source:'facebook',
          state_code:'SP',
          city:'São Paulo Centro Expandido',
          transaction_type:'sale',
          property_type_code:null,
          results_per_query:10,
          query_limit:2
        }
      });
      if(error)throw error;
      if(!data?.ok)throw new Error(data?.error||'collection_failed');

      const c=data.counters||{};
      status.textContent=`${Number(c.qualified_results||0)} recebidos · ${Number(c.new_results||0)} novos`;
      await window.LJI_CAPTURE_CENTER?.refresh?.();
      window.dispatchEvent(new CustomEvent('lji:capture-collection-complete',{detail:data}));
    }catch(e){
      console.error('Central de Captação: coleta',e);
      const msg=String(e?.message||e||'Falha na coleta');
      status.textContent=msg.includes('collector_disabled')?'Coletor pausado':msg.includes('authentication')?'Sem permissão para coletar':'Falha na coleta';
    }finally{
      running=false;button.disabled=false;button.textContent='Buscar novos';
    }
  }

  function mount(){
    const host=q('#capture-center .lji-cap-head-actions');
    if(!host||q('[data-cap-collect-now]',host))return false;
    const btn=document.createElement('button');
    btn.type='button';btn.className='primary';btn.dataset.capCollectNow='1';btn.textContent='Buscar novos';
    btn.title='Executar uma coleta controlada e atualizar a Central de Captação';
    btn.addEventListener('click',()=>void runCollection(btn));
    host.appendChild(btn);ensureStatus(host);return true;
  }

  const timer=setInterval(()=>{if(mount())clearInterval(timer);},300);
  setTimeout(()=>clearInterval(timer),15000);
  document.addEventListener('click',e=>{if(e.target.closest('[data-page="capture-center"]'))setTimeout(mount,100);});
})();
