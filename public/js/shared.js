// ═══════════════════════════════════════════════════════════════════════
// shared.js — navbar scroll state + theme toggle. Loaded by BOTH pages.
// Requires a <nav> element and a #themeBtn button to exist in the HTML.
// ═══════════════════════════════════════════════════════════════════════
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
