'use strict';
(function(){
  const src='./lj-logo-vector.svg?v=23.0.1';
  function apply(){
    document.querySelectorAll('.lji-login-logo,.lji-desktop-brand-logo').forEach(img=>{
      if(img.getAttribute('src')!==src) img.setAttribute('src',src);
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',apply,{once:true});
  else apply();
  window.addEventListener('load',apply,{once:true});
  const mo=new MutationObserver(apply);
  mo.observe(document.documentElement,{childList:true,subtree:true});
})();
