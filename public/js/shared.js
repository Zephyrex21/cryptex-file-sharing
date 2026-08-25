// ═══════════════════════════════════════════════════════════════════════
// shared.js — preloader + navbar scroll state + theme toggle. Loaded by
// BOTH pages. Requires a <nav> element and a #themeBtn button in the HTML;
// #preloader is optional (silently no-ops if absent).
// ═══════════════════════════════════════════════════════════════════════
// ── Preloader ────────────────────────────────────────────────────────────
// Runs first, before anything else in this file, so it doesn't wait on the
// nav/theme setup below. MIN_MS avoids a flash-then-vanish on fast
// connections; the setTimeout fallback means it can never get stuck open
// even if the 'load' event is delayed for some reason.
(function(){
  const pre=document.getElementById('preloader');
  if(!pre)return;
  const MIN_MS=550,MAX_MS=2500,shownAt=Date.now();
  let dismissed=false;
  function dismiss(){
    if(dismissed)return;dismissed=true;
    const wait=Math.max(0,MIN_MS-(Date.now()-shownAt));
    setTimeout(()=>{
      pre.classList.add('hidden');
      document.body.style.overflow='';
      setTimeout(()=>pre.remove(),450);
    },wait);
  }
  document.body.style.overflow='hidden';
  window.addEventListener('load',dismiss);
  setTimeout(dismiss,MAX_MS);
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
