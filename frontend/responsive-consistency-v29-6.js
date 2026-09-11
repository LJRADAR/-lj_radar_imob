'use strict';
/* LJ Radar Imob — Desktop × Mobile consistency v29.6 */
(function(){
  const q=(s,r=document)=>r.querySelector(s), qa=(s,r=document)=>Array.from(r.querySelectorAll(s));

  function extractId(card,kind){
    const html=card.innerHTML||'';
    if(kind==='buyers') return html.match(/deleteBuyer\('([^']+)'\)/)?.[1]||'';
    if(kind==='owners') return html.match(/openPropertyMenu\(event,'([^']+)'\)/)?.[1]||html.match(/openRegistryForProperty\('([^']+)'\)/)?.[1]||'';
    return '';
  }

  function ensureLegacyMobile(kind,rootSel){
    const root=q(rootSel);if(!root)return;
    qa('.mobile-card-list .m-card',root).forEach(card=>{
      const id=extractId(card,kind);if(!id)return;
      card.classList.add('lji-mobile-gmail-card');card.dataset.gmailMobileKind=kind;card.dataset.gmailMobileId=id;
      if(!q(`[data-gmail-check="${kind}"]`,card)){
        const label=document.createElement('label');
        label.className='lji-mobile-gmail-check';
        label.title='Selecionar';
        label.innerHTML=`<input type="checkbox" data-gmail-check="${kind}" data-id="${id}"><span></span>`;
        card.prepend(label);
      }
      const tableInput=q(`${rootSel} tbody [data-gmail-check="${kind}"][data-id="${CSS.escape(id)}"]`);
      const mobileInput=q(`[data-gmail-check="${kind}"]`,card);
      if(tableInput&&mobileInput&&document.activeElement!==mobileInput) mobileInput.checked=tableInput.checked;
      card.classList.toggle('lji-row-selected',Boolean(mobileInput?.checked));
    });
  }

  function ensureV295Mobile(kind,rootSel){
    const root=q(rootSel);if(!root)return;
    const rows=qa('tbody tr[data-g295-kind]',root);
    const cards=qa('.mobile-card-list .m-card',root);
    cards.forEach((card,i)=>{
      const row=rows[i];const key=row?.dataset.g295Key;if(!key)return;
      card.classList.add('lji-mobile-gmail-card');card.dataset.g295Kind=kind;card.dataset.g295Key=key;
      if(!q(`[data-g295-check="${kind}"]`,card)){
        const label=document.createElement('label');label.className='lji-mobile-gmail-check';label.title='Selecionar';
        label.innerHTML=`<input type="checkbox" data-g295-check="${kind}" data-key="${key}"><span></span>`;card.prepend(label);
      }
      const src=q(`[data-g295-check="${kind}"]`,row),dst=q(`[data-g295-check="${kind}"]`,card);
      if(src&&dst&&document.activeElement!==dst)dst.checked=src.checked;
      card.classList.toggle('lji-row-selected',Boolean(dst?.checked));
    });
  }

  function labelToolbars(){
    qa('.lji-gmail-toolbar,.lji-gmail-toolbar-v295').forEach(bar=>{
      bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','Ações da lista');
      qa('button,select,input',bar).forEach(el=>{if(!el.getAttribute('aria-label')&&!el.title){const txt=(el.textContent||'').trim();if(txt)el.setAttribute('aria-label',txt)}});
    });
  }

  function fixMobileTables(){
    ['#tradeIntentsTable','#tradeMatchesTable','#registrySearchesTable','#opsDailyTable'].forEach(sel=>{
      const root=q(sel);if(root)root.classList.add('lji-mobile-scroll-safe');
    });
  }

  function run(){
    ensureLegacyMobile('buyers','#buyersTable');
    ensureLegacyMobile('owners','#ownersTable');
    ensureV295Mobile('deep','#deepSearchTable');
    ensureV295Mobile('companies','#companiesTable');
    ensureV295Mobile('discarded','#discardedTable');
    labelToolbars();fixMobileTables();
  }

  document.addEventListener('change',e=>{
    const mobile=e.target.closest('.lji-mobile-gmail-check input');if(!mobile)return;
    const card=mobile.closest('.lji-mobile-gmail-card');
    card?.classList.toggle('lji-row-selected',mobile.checked);
    setTimeout(run,20);
  });

  const mo=new MutationObserver(()=>{clearTimeout(mo._t);mo._t=setTimeout(run,70)});
  function init(){run();mo.observe(document.body,{subtree:true,childList:true});setInterval(run,1800)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
