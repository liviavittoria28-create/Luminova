/* Navegação compartilhada LUMINOVA: acessível, responsiva e sem alterar autenticação. */
(() => {
  'use strict';
  const links = [
    ['geral.html','⌂','Geral'],
    ['comunidades.html','◈','Comunidades'],
    ['chats.html','✉','Chats'],
    ['perfil.html','◎','Meu perfil']
  ];
  const current = location.pathname.split('/').pop() || 'perfil.html';
  const sidebar = document.querySelector('.ln-profile-sidebar, .sidebar');
  const makeNav = () => {
    const nav = document.createElement('nav');
    nav.className = 'lumi-shared-nav';
    nav.setAttribute('aria-label','Navegação principal');
    links.forEach(([href,icon,label]) => {
      const a=document.createElement('a'); a.href=href; a.className='lumi-shared-nav-link';
      if(current===href || (current==='comunidade-detalhe.html' && href==='comunidades.html')) a.setAttribute('aria-current','page');
      const glyph=document.createElement('span'); glyph.className='lumi-nav-glyph'; glyph.setAttribute('aria-hidden','true'); glyph.textContent=icon;
      const text=document.createElement('span'); text.textContent=label;
      a.append(glyph,text); nav.append(a);
    });
    return nav;
  };
  if (sidebar) {
    // Harmoniza os destinos, preservando a estrutura e os elementos já usados pelos scripts de cada página.
    const existing=sidebar.querySelector('.main-nav');
    if(existing){
      const existingLabels=[...existing.querySelectorAll('a')].map(a=>(a.textContent||'').trim().toLowerCase());
      if(!existingLabels.some(x=>x.includes('chats'))) {
        const a=document.createElement('a'); a.href='chats.html'; a.className='nav-link'; a.innerHTML='<span aria-hidden="true">✉</span><span class="nav-text">Chats</span>'; existing.append(a);
      }
      existing.querySelectorAll('a').forEach(a=>{
        const label=(a.textContent||'').trim().toLowerCase();
        if(label.includes('mentor matching') || /mentor-matching/i.test(a.getAttribute('href')||'')){a.href='chats.html';a.innerHTML='<span aria-hidden="true">✉</span><span class="nav-text">Chats</span>';}
      });
    }
    let toggle=sidebar.querySelector('.lumi-mobile-menu-toggle');
    if(!toggle){
      toggle=document.createElement('button'); toggle.type='button'; toggle.className='lumi-mobile-menu-toggle';
      toggle.textContent='☰ Menu'; toggle.setAttribute('aria-expanded','false'); toggle.setAttribute('aria-label','Abrir menu de navegação');
      sidebar.prepend(toggle);
      toggle.addEventListener('click',()=>{const open=sidebar.classList.toggle('lumi-sidebar-open');toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'Fechar menu de navegação':'Abrir menu de navegação');});
      sidebar.querySelectorAll('a[href]').forEach(a=>a.addEventListener('click',()=>{sidebar.classList.remove('lumi-sidebar-open');toggle.setAttribute('aria-expanded','false');}));
    }
  } else if(current==='chats.html') {
    const page=document.querySelector('.chat-page');
    if(page){
      const nav=document.createElement('nav'); nav.className='lumi-chat-mobile-nav'; nav.setAttribute('aria-label','Navegação principal');
      links.forEach(([href,icon,label])=>{const a=document.createElement('a');a.href=href;a.textContent=`${icon} ${label}`;if(current===href)a.setAttribute('aria-current','page');nav.append(a);});
      page.prepend(nav);
    }
  }
})();
