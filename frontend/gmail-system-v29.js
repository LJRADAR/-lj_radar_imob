'use strict';
/* LJ Radar Imob — Gmail operational layer v29.4 */
(function(){
  const PAGE_IDS=['capture-center','qualified-leads','buyers','owners','whatsapp-leads','para-quinto-andar','deep-search','discarded','intentions','matches','trades','pipeline','sales-inbox','companies'];
  const q=(s,r=document)=>r.querySelector(s), qa=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const selected={buyers:new Set(),owners:new Set()};
  let busy=false;

  function sb(){try{return window.LJI_getSupabaseClient?.()||window.LJI_BACKEND?.client||null}catch(_){return null}}
  function ws(){try{return window.LJI_CONFIG?.WORKSPACE_ID||localStorage.getItem('lji_workspace_id')||null}catch(_){return null}}
  function toast(msg){try{window.toast?.(msg)}catch(_){}}

  function markPages(){PAGE_IDS.forEach(id=>q('#'+id)?.classList.add('lji-gmail-page'));}

  function extractId(row,kind){
    const html=row.innerHTML||'';
    if(kind==='buyers') return html.match(/deleteBuyer\('([^']+)'\)/)?.[1]||'';
    if(kind==='owners') return html.match(/openPropertyMenu\(event,'([^']+)'\)/)?.[1]||'';
    return '';
  }

  function toolbar(kind,root){
    const id='ljiGmailToolbar-'+kind;
    let bar=q('#'+id);if(bar)return bar;
    bar=document.createElement('div');bar.id=id;bar.className='lji-gmail-toolbar';
    const isBuyer=kind==='buyers';
    bar.innerHTML=`<label class="lji-gmail-check" title="Selecionar todos"><input type="checkbox" data-gmail-all="${kind}"></label>
      <button type="button" data-gmail-refresh="${kind}">↻ Atualizar</button>
      <button type="button" data-gmail-archive="${kind}" disabled>${isBuyer?'Arquivar':'Remover prioridade'}</button>
      <button type="button" class="lji-gmail-danger" data-gmail-trash="${kind}" disabled>${isBuyer?'Lixeira':'Descartar'}</button>
      <span class="lji-gmail-count" data-gmail-count="${kind}">0 selecionados</span>`;
    root.parentElement?.insertBefore(bar,root);return bar;
  }

  function enhanceRows(kind){
    const root=q(kind==='buyers'?'#buyersTable':'#ownersTable');if(!root)return;
    const table=q('table',root);if(!table)return;
    toolbar(kind,root);
    const head=q('thead tr',table);
    if(head&&!q('[data-gmail-head]',head)){const th=document.createElement('th');th.className='lji-gmail-check';th.dataset.gmailHead=kind;th.innerHTML=`<input type="checkbox" data-gmail-all="${kind}">`;head.prepend(th)}
    qa('tbody tr',table).forEach(row=>{
      const id=extractId(row,kind);if(!id)return;row.dataset.gmailId=id;
      if(!q('[data-gmail-row]',row)){const td=document.createElement('td');td.className='lji-gmail-check';td.dataset.gmailRow=kind;td.innerHTML=`<input type="checkbox" data-gmail-check="${kind}" data-id="${id}">`;row.prepend(td)}
      const checked=selected[kind].has(id),input=q('[data-gmail-check]',row);if(input)input.checked=checked;row.classList.toggle('lji-row-selected',checked);
    });
    updateBar(kind);
  }

  function updateBar(kind){
    const n=selected[kind].size,count=q(`[data-gmail-count="${kind}"]`);if(count)count.textContent=`${n} selecionado${n===1?'':'s'}`;
    qa(`[data-gmail-archive="${kind}"],[data-gmail-trash="${kind}"]`).forEach(b=>b.disabled=busy||n===0);
    const rows=qa(`#${kind==='buyers'?'buyersTable':'ownersTable'} tbody tr[data-gmail-id]`);
    qa(`[data-gmail-all="${kind}"]`).forEach(all=>{all.checked=rows.length>0&&rows.every(r=>selected[kind].has(r.dataset.gmailId));all.indeterminate=n>0&&!all.checked});
  }

  async function buyerAction(action){
    const client=sb(),workspace=ws(),ids=[...selected.buyers];if(!client||!workspace||!ids.length)return;
    busy=true;updateBar('buyers');
    try{
      const status=action==='trash'?'trash':'inactive';
      const {error}=await client.from('lji_buyers').update({status}).eq('workspace_id',workspace).in('id',ids);if(error)throw error;
      selected.buyers.clear();toast(action==='trash'?'Compradores enviados para a lixeira.':'Compradores arquivados.');await window.LJI_BACKEND?.sync?.();
    }catch(e){console.error('Gmail buyers bulk:',e);toast('Não foi possível concluir a ação em lote.')}finally{busy=false;setTimeout(()=>enhanceRows('buyers'),80)}
  }

  async function ownerAction(action){
    const ids=[...selected.owners];if(!ids.length)return;
    busy=true;updateBar('owners');
    try{
      for(const opportunityId of ids){
        if(action==='trash') await window.setOwnerRadarStatus?.(opportunityId,'rejected');
        else await window.setOwnerRadarStatus?.(opportunityId,'approved');
      }
      selected.owners.clear();toast(action==='trash'?'Proprietários descartados.':'Prioridade removida.');await window.LJI_BACKEND?.sync?.();
    }catch(e){console.error('Gmail owners bulk:',e);toast('Não foi possível concluir a ação em lote.')}finally{busy=false;setTimeout(()=>enhanceRows('owners'),100)}
  }

  document.addEventListener('change',e=>{
    const c=e.target.closest('[data-gmail-check]');if(c){const kind=c.dataset.gmailCheck,id=c.dataset.id;c.checked?selected[kind].add(id):selected[kind].delete(id);c.closest('tr')?.classList.toggle('lji-row-selected',c.checked);updateBar(kind);return}
    const all=e.target.closest('[data-gmail-all]');if(all){const kind=all.dataset.gmailAll;qa(`#${kind==='buyers'?'buyersTable':'ownersTable'} tbody tr[data-gmail-id]`).forEach(r=>{all.checked?selected[kind].add(r.dataset.gmailId):selected[kind].delete(r.dataset.gmailId)});enhanceRows(kind)}
  });
  document.addEventListener('click',e=>{
    const refresh=e.target.closest('[data-gmail-refresh]');if(refresh){window.LJI_BACKEND?.sync?.();return}
    const a=e.target.closest('[data-gmail-archive]');if(a){a.dataset.gmailArchive==='buyers'?buyerAction('archive'):ownerAction('archive');return}
    const t=e.target.closest('[data-gmail-trash]');if(t){if(!confirm('Mover os itens selecionados?'))return;t.dataset.gmailTrash==='buyers'?buyerAction('trash'):ownerAction('trash')}
  });

  function run(){markPages();enhanceRows('buyers');enhanceRows('owners');}
  const observer=new MutationObserver(()=>{clearTimeout(observer._t);observer._t=setTimeout(run,60)});
  function init(){run();observer.observe(document.body,{subtree:true,childList:true});setInterval(run,1800)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
