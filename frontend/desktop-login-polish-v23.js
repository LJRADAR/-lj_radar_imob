'use strict';

/* LJ Radar Imob — Login polish v23
   Ajusta somente apresentação da tela de login desktop. */
(function(){
  function polish(){
    const lang = document.querySelector('.lji-login-lang');
    if(lang){
      const spans = lang.querySelectorAll('span');
      if(spans[0]){
        spans[0].textContent = 'Brasil';
        spans[0].title = 'Mercado atual: Brasil';
      }
      if(spans[1]){
        spans[1].textContent = 'PT-BR';
        spans[1].title = 'Idioma atual: Português (Brasil)';
      }
    }

    document.querySelectorAll('.lji-login-float').forEach((card, index)=>{
      if(card.querySelector('.lji-float-thumb')) return;
      const strong = card.querySelector('strong');
      const text = Array.from(card.children).find(el=>el.tagName === 'SPAN');
      if(!strong || !text) return;

      const thumb = document.createElement('span');
      thumb.className = 'lji-float-thumb';
      thumb.setAttribute('aria-hidden','true');
      thumb.title = 'Imagem ilustrativa da interface de oportunidades';

      const copy = document.createElement('span');
      copy.className = 'lji-float-copy';
      copy.append(strong, text);
      card.replaceChildren(thumb, copy);
      card.setAttribute('data-visual-card', String(index + 1));
    });
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', polish, {once:true});
  else polish();
  window.addEventListener('load', polish, {once:true});
  const observer = new MutationObserver(polish);
  observer.observe(document.documentElement,{childList:true,subtree:true});
})();
