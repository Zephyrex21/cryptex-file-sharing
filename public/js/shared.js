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
if(sv)root.setAttribute('data-theme',sv);
else if(window.matchMedia('(prefers-color-scheme:dark)').matches)root.setAttribute('data-theme','dark');
document.getElementById('themeBtn').onclick=()=>{
  const n=root.getAttribute('data-theme')==='dark'?'light':'dark';
  root.setAttribute('data-theme',n);localStorage.setItem('cv-theme',n);
};
