// ═══════════════════════════════════════════════════════════════════════
// shared.js — preloader + navbar scroll state + theme toggle. Loaded by
// BOTH pages. Requires a <nav> element and a #themeBtn button in the HTML;
// #preloader is optional (silently no-ops if absent).
// ═══════════════════════════════════════════════════════════════════════
// ── Preloader ────────────────────────────────────────────────────────────
// Dismisses only when the page is genuinely ready to be looked at: the load
// event has fired AND the web fonts are in (so the text the visitor sees the
// moment the loader lifts is already in its final typeface — no late swap that
// re-flows the hero). Then it adds html.is-ready, which is what starts the
// homepage's entrance choreography; that way the intro plays WHILE the loader
// fades, instead of finishing unseen behind it. MIN_MS stops a flash-then-vanish
// on fast connections; MAX_MS guarantees it can never get stuck open.
(function(){
  const root=document.documentElement;
  const pre=document.getElementById('preloader');
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let finished=false;
  function finish(){
    if(finished)return;finished=true;
    root.classList.add('is-ready');
    root.classList.remove('is-loading');
    window.dispatchEvent(new Event('cryptex:ready'));
    if(!pre)return;
    pre.classList.add('hidden');
    let removed=false;
    const remove=()=>{if(removed)return;removed=true;pre.remove();};
    pre.addEventListener('transitionend',e=>{if(e.target===pre&&e.propertyName==='opacity')remove();});
    setTimeout(remove,1100); // transitionend never fires if the tab is hidden — don't leak the node
  }
  if(!pre){root.classList.add('is-ready');return;}
  const MIN_MS=reduce?0:500,MAX_MS=3000,FONT_WAIT_MS=1800,shownAt=performance.now();
  root.classList.add('is-loading');
  const loaded=new Promise(res=>{
    if(document.readyState==='complete')res();else window.addEventListener('load',res,{once:true});
  });
  // Ask for the families explicitly: document.fonts.ready alone can resolve
  // before a font has even started loading.
  const fonts=(document.fonts&&document.fonts.load)
    ?Promise.race([
        Promise.all([document.fonts.load('1em Inter'),document.fonts.load('1em "JetBrains Mono"')]).catch(()=>{}),
        new Promise(res=>setTimeout(res,FONT_WAIT_MS))
      ])
    :Promise.resolve();
  Promise.all([loaded,fonts]).then(()=>{
    const wait=Math.max(0,MIN_MS-(performance.now()-shownAt));
    // two frames: let the final-font layout actually paint before the loader lifts
    setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(finish)),wait);
  });
  setTimeout(finish,MAX_MS);
})();
// ── Navbar scroll state ─────────────────────────────────────────────────────
(function(){
  const navEl=document.querySelector('nav');
  let ticking=false;
  window.addEventListener('scroll',()=>{
    if(ticking)return;ticking=true;
    requestAnimationFrame(()=>{navEl.classList.toggle('scrolled',window.scrollY>16);ticking=false;});
  },{passive:true});
})();
// ── Theme ──────────────────────────────────────────────────────────────────
const root=document.documentElement;
const sv=localStorage.getItem('cv-theme');
// Light is the default for everyone; only a choice made with the toggle (saved) overrides it.
if(sv)root.setAttribute('data-theme',sv);
document.getElementById('themeBtn').onclick=()=>{
  const n=root.getAttribute('data-theme')==='dark'?'light':'dark';
  root.setAttribute('data-theme',n);localStorage.setItem('cv-theme',n);
};

// ── Command palette (Ctrl/⌘ + K) ─────────────────────────────────────────────
// One engine for both pages. Each page registers its own commands through
// window.CryptexPalette.register({commands, dynamic}). The overlay DOM is built
// lazily on first open, so it costs nothing until it is used.
//   commands: [{group,label,keywords,icon,kbd,sub,searchOnly,run}]
//   dynamic : (query) => items that are already filtered (files, folders, token)
(function(){
  const IS_MAC=/Mac|iPhone|iPad|iPod/i.test(navigator.platform||navigator.userAgent||'');
  document.querySelectorAll('.cmdk-mod').forEach(el=>{el.textContent=IS_MAC?'⌘':'Ctrl';});

  const svg=(p)=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+p+'</svg>';
  const ICONS={
    search:svg('<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>'),
    upload:svg('<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>'),
    lock:svg('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>'),
    link:svg('<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>'),
    key:svg('<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.78 7.78 5.5 5.5 0 017.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>'),
    folder:svg('<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>'),
    folderPlus:svg('<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/><path d="M12 11v6M9 14h6"/>'),
    file:svg('<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/>'),
    image:svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>'),
    video:svg('<rect x="2" y="5" width="14" height="14" rx="2"/><path d="M22 8l-6 4 6 4z"/>'),
    code:svg('<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>'),
    archive:svg('<path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/>'),
    home:svg('<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M9 22V12h6v10"/>'),
    sparkle:svg('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 17l.7 1.8L21.5 19.5l-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z"/>'),
    shield:svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
    info:svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'),
    theme:svg('<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>'),
    github:svg('<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22"/>'),
    refresh:svg('<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>'),
    check:svg('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>'),
    book:svg('<path d="M4 19.5A2.5 2.5 0 016.5 17H20V2H6.5A2.5 2.5 0 004 4.5z"/><path d="M4 19.5A2.5 2.5 0 006.5 22H20v-5"/>')
  };

  let commands=[],dynamic=null,onOpen=null,root=null,input=null,list=null,shown=[],active=0,prevFocus=null,isOpen=false,closeTimer=0;

  const esc=(s)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Wrap the first match of each query word in <mark>, escaping everything else.
  function hl(text,tokens){
    const low=text.toLowerCase(),spans=[];
    tokens.forEach(t=>{const i=low.indexOf(t);if(i>=0)spans.push([i,i+t.length]);});
    if(!spans.length)return esc(text);
    spans.sort((a,b)=>a[0]-b[0]);
    let out='',pos=0;
    spans.forEach(([s,e])=>{if(s<pos)return;out+=esc(text.slice(pos,s))+'<mark>'+esc(text.slice(s,e))+'</mark>';pos=e;});
    return out+esc(text.slice(pos));
  }
  // Label hits outrank keyword-only hits, and earlier/word-start hits outrank mid-word ones.
  function score(label,keywords,tokens){
    const lab=label.toLowerCase(),kw=(keywords||'').toLowerCase();
    let s=0;
    for(const t of tokens){
      const li=lab.indexOf(t);
      if(li>=0){s+=li===0?6:(/[\s\-_.]/.test(lab[li-1])?5:4);continue;}
      if(kw.indexOf(t)>=0){s+=1;continue;}
      return -1;
    }
    return s;
  }
  function collect(q){
    const tokens=q.toLowerCase().split(/\s+/).filter(Boolean);
    const entries=[];
    commands.forEach((c,idx)=>{
      if(!tokens.length){if(!c.searchOnly)entries.push({c,s:0,idx});return;}
      const s=score(c.label,c.keywords,tokens);
      if(s>=0)entries.push({c,s,idx});
    });
    if(dynamic&&q.trim()){
      try{
        (dynamic(q.trim())||[]).forEach((c,i)=>{
          const s=tokens.length?score(c.label,'',tokens):0; // already matched by the page; score only orders them
          entries.push({c,s:Math.max(s,0),idx:1000+i});
        });
      }catch(e){console.error(e);}
    }
    // group; while searching, the group holding the best match comes first
    const map=new Map();
    entries.forEach(e=>{
      const g=e.c.group;
      if(!map.has(g))map.set(g,{name:g,items:[],best:-1,first:map.size});
      const o=map.get(g);o.items.push(e);if(e.s>o.best)o.best=e.s;
    });
    let groups=[...map.values()];
    if(tokens.length)groups.sort((a,b)=>b.best-a.best||a.first-b.first);
    groups.forEach(g=>g.items.sort((a,b)=>tokens.length?(b.s-a.s||a.idx-b.idx):a.idx-b.idx));
    groups=groups.map(g=>({name:g.name,items:g.items.map(e=>e.c)}));
    return {flat:groups.flatMap(g=>g.items),groups,tokens};
  }

  function build(){
    root=document.createElement('div');
    root.className='cmdk';
    root.hidden=true;
    root.innerHTML=
      '<div class="cmdk-box" role="dialog" aria-modal="true" aria-label="Command menu">'+
        '<div class="cmdk-top">'+ICONS.search+
          '<input class="cmdk-input" type="text" role="combobox" aria-expanded="true" aria-controls="cmdkList" aria-autocomplete="list" placeholder="Search actions, files, folders…" autocomplete="off" autocapitalize="off" spellcheck="false">'+
          '<kbd class="cmdk-esc">esc</kbd></div>'+
        '<div class="cmdk-list" id="cmdkList" role="listbox"></div>'+
        '<div class="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd>navigate</span><span><kbd>↵</kbd>select</span><span><kbd>esc</kbd>close</span></div>'+
      '</div>';
    document.body.appendChild(root);
    input=root.querySelector('.cmdk-input');
    list=root.querySelector('.cmdk-list');
    root.addEventListener('mousedown',e=>{if(e.target===root){e.preventDefault();close();}});
    list.addEventListener('mousedown',e=>e.preventDefault()); // keep focus in the input
    list.addEventListener('click',e=>{const el=e.target.closest('.cmdk-item');if(el)run(shown[+el.dataset.i]);});
    list.addEventListener('mousemove',e=>{const el=e.target.closest('.cmdk-item');if(el&&+el.dataset.i!==active)setActive(+el.dataset.i,false);});
    input.addEventListener('input',()=>{active=0;render();});
  }

  function render(){
    const {flat,groups,tokens}=collect(input.value);
    shown=flat;
    if(!flat.length){
      list.innerHTML='<div class="cmdk-empty">'+ICONS.search+'<b>No results</b><span>Nothing matches “'+esc(input.value.trim())+'”. Try a file name, a section or a token.</span></div>';
      input.removeAttribute('aria-activedescendant');
      return;
    }
    let html='',i=0;
    groups.forEach(g=>{
      html+='<div class="cmdk-group" role="presentation">'+esc(g.name)+'</div>';
      g.items.forEach(c=>{
        html+='<div class="cmdk-item" role="option" id="cmdk-opt-'+i+'" data-i="'+i+'" aria-selected="false">'+
          '<span class="cmdk-ico">'+(ICONS[c.icon]||c.icon||ICONS.sparkle)+'</span>'+
          '<span class="cmdk-lbl">'+hl(c.label,tokens)+'</span>'+
          (c.sub?'<span class="cmdk-sub">'+esc(c.sub)+'</span>':'')+
          '<span class="cmdk-kbds">'+(c.kbd||[]).map(k=>'<kbd>'+esc(k)+'</kbd>').join('')+'</span>'+
          '<span class="cmdk-enter" aria-hidden="true">↵</span></div>';
        i++;
      });
    });
    list.innerHTML=html;
    setActive(Math.min(active,flat.length-1),true);
  }

  function setActive(i,scroll){
    active=i;
    list.querySelectorAll('.cmdk-item').forEach(el=>{
      const on=+el.dataset.i===i;
      el.classList.toggle('active',on);
      el.setAttribute('aria-selected',on?'true':'false');
      if(on){
        input.setAttribute('aria-activedescendant',el.id);
        if(scroll&&el.scrollIntoView)el.scrollIntoView({block:'nearest'});
      }
    });
  }

  function open(){
    if(isOpen)return;
    if(!root)build();
    clearTimeout(closeTimer);
    prevFocus=document.activeElement;
    isOpen=true;active=0;
    input.value='';
    root.hidden=false;
    render();
    if(onOpen){try{onOpen();}catch(e){console.error(e);}}
    document.documentElement.classList.add('cmdk-open');
    void root.offsetWidth; // let the start state paint so the entrance can transition
    root.classList.add('open');
    input.focus();
  }
  function close(){
    if(!isOpen)return;
    isOpen=false;
    root.classList.remove('open');
    document.documentElement.classList.remove('cmdk-open');
    closeTimer=setTimeout(()=>{if(!isOpen)root.hidden=true;},180);
    if(document.activeElement===input)input.blur(); // never leave focus parked in the hidden field (hotkeys ignore inputs)
    if(prevFocus&&prevFocus!==document.body&&document.contains(prevFocus)&&prevFocus.focus)prevFocus.focus();
    prevFocus=null;
  }
  function run(c){
    if(!c)return;
    close();
    try{c.run();}catch(e){console.error(e);}
  }

  document.addEventListener('keydown',e=>{
    if((e.metaKey||e.ctrlKey)&&!e.altKey&&!e.shiftKey&&(e.key||'').toLowerCase()==='k'){
      e.preventDefault();e.stopImmediatePropagation();
      isOpen?close():open();
      return;
    }
    if(!isOpen||e.isComposing)return;
    const n=shown.length;
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();}
    else if(e.key==='ArrowDown'){e.preventDefault();if(n)setActive((active+1)%n,true);}
    else if(e.key==='ArrowUp'){e.preventDefault();if(n)setActive((active-1+n)%n,true);}
    else if(e.key==='Home'&&n){e.preventDefault();setActive(0,true);}
    else if(e.key==='End'&&n){e.preventDefault();setActive(n-1,true);}
    else if(e.key==='Enter'){e.preventDefault();run(shown[active]);}
    else if(e.key==='Tab'){e.preventDefault();}
  },true);
  document.addEventListener('click',e=>{if(e.target.closest&&e.target.closest('[data-cmdk-open]')){e.preventDefault();open();}});

  window.CryptexPalette={
    icons:ICONS,
    open,close,
    isMac:IS_MAC,
    register(cfg){commands=cfg.commands||[];dynamic=cfg.dynamic||null;onOpen=cfg.onOpen||null;},
    refresh(){if(isOpen)render();}
  };
})();
