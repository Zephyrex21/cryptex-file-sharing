// ═══════════════════════════════════════════════════════════════════════
// home.js — nav section-scroll, hero decrypt animation, scroll-reveal
// for Features/About, and a redirect shim for old ?token= links that
// pointed at the root domain before the app moved to /app.
// Homepage only (index.html).
// ═══════════════════════════════════════════════════════════════════════

// ── Legacy token-link redirect ──────────────────────────────────────────
// Old shared links looked like cryptex-file-sharing.onrender.com/?token=xxx
// (back when the app lived at the root). Now that token access lives on
// /app, forward transparently so nobody's old link silently breaks.
(function(){
  const t=new URLSearchParams(window.location.search).get('token');
  if(t) window.location.replace('/app'+window.location.search);
})();

// ── Nav scroll (renamed to navTo to avoid conflict with window.scrollTo) ──
function navTo(id){
  document.getElementById(id)?.scrollIntoView({behavior:'smooth'});
  setActiveNav(id);
}
function setActiveNav(id){
  ['home','features','encryption','about'].forEach(s=>{
    const el=document.getElementById(`nl-${s}`);
    if(el) el.classList.toggle('active', s===id);
  });
}
// Auto-update active nav on scroll
const secObserver=new IntersectionObserver(entries=>{
  entries.forEach(e=>{if(e.isIntersecting)setActiveNav(e.target.id);});
},{threshold:.4,rootMargin:'-60px 0px 0px 0px'});
['home','features','encryption','about'].forEach(id=>{const el=document.getElementById(id);if(el)secObserver.observe(el);});
document.getElementById('hamBtn').onclick=()=>document.getElementById('mobMenu').classList.toggle('open');
function closeMob(){document.getElementById('mobMenu').classList.remove('open');}
// ── Hero decrypt-in animation ───────────────────────────────────────────────
// Scrambles each line's characters, then resolves into the real text — a
// one-time signature moment on load. Respects prefers-reduced-motion.
function scrambleReveal(el,duration=750){
  const finalText=el.textContent;
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const len=finalText.length;
  const start=performance.now();
  el.classList.add('scrambling');
  function frame(now){
    const t=Math.min(1,(now-start)/duration);
    let out='';
    for(let i=0;i<len;i++){
      const ch=finalText[i];
      if(ch===' '||ch==='.'||ch==='-'){out+=ch;continue;}
      // characters resolve left-to-right, staggered — later chars lock in later
      const revealAt=(i/len)*0.7;
      out+= t>=revealAt+0.25 ? ch : chars[Math.floor(Math.random()*chars.length)];
    }
    el.textContent=out;
    if(t<1)requestAnimationFrame(frame);
    else{el.textContent=finalText;el.classList.remove('scrambling');}
  }
  requestAnimationFrame(frame);
}
(function(){
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const l1=document.getElementById('heroLine1'),lAes=document.getElementById('heroLineAES'),l2=document.getElementById('heroLine2');
  if(!l1||!l2)return;
  if(reduce)return; // leave text exactly as rendered, no animation
  scrambleReveal(l1,700);
  if(lAes)scrambleReveal(lAes,700);
  setTimeout(()=>scrambleReveal(l2,700),120);
})();

// ── Hero illustration: token flicker ────────────────────────────────────────
// The token text on the front card briefly re-scrambles one character every
// couple seconds, then resolves back — reads as a live cipher feed rather
// than static decoration. Subtle on purpose: one character, not the whole
// string, so it never competes with the headline for attention.
(function(){
  const el=document.getElementById('illoToken');
  if(!el)return;
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const base=el.textContent;
  const chars='0123456789ABCDEF';
  setInterval(()=>{
    const pos=Math.floor(Math.random()*base.length);
    const scrambled=base.split('');
    scrambled[pos]=chars[Math.floor(Math.random()*chars.length)];
    el.textContent=scrambled.join('');
    setTimeout(()=>{el.textContent=base;},180);
  },2200);
})();

// Mouse-parallax ("magnetic hover") on the hero illustration was removed —
// the illustration still floats gently via the CSS illoFloat animation on
// .illo-layer, it just no longer tracks the cursor.

// ── Typewriter effect for static section headings ───────────────────────────
// Types each line's real text back in, one character at a time, with a
// blinking-cursor class toggled per line while it's active. The text is
// captured from the DOM itself (not hardcoded here), so this works for any
// heading with .tw-line spans without needing to duplicate copy in JS.
function typewriterLines(lineEls,speed=32){
  let li=0;
  function typeNextLine(){
    if(li>=lineEls.length)return;
    const el=lineEls[li];
    const full=el.textContent;
    el.textContent='';
    el.classList.add('tw-typing');
    let ci=0;
    (function typeChar(){
      el.textContent=full.slice(0,ci);
      ci++;
      if(ci<=full.length)setTimeout(typeChar,speed);
      else{el.classList.remove('tw-typing');li++;typeNextLine();}
    })();
  }
  typeNextLine();
}

// ── Scroll-triggered reveal (Features / About) ──────────────────────────────
// Each element fades/lifts in once, the first time it enters the viewport.
// Grouped per-section so stagger timing restarts at 0 for each section rather
// than accumulating one long delay across the whole page. Section headings
// (.sec-title) additionally get the typewriter effect above, triggered by
// this same first-intersection moment.
(function(){
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const groups=[
    document.querySelectorAll('#features .reveal'),
    document.querySelectorAll('#encryption .reveal'),
    document.querySelectorAll('#about .about-wrap > div:first-child .reveal'),
    document.querySelectorAll('#about .rm-list .reveal')
  ];
  if(reduce){groups.forEach(g=>g.forEach(el=>el.classList.add('revealed')));return;}
  const io=new IntersectionObserver((entries)=>{
    entries.forEach(entry=>{
      if(entry.isIntersecting){
        entry.target.classList.add('revealed');
        if(entry.target.classList.contains('sec-title')){
          const lines=entry.target.querySelectorAll('.tw-line');
          if(lines.length)typewriterLines(Array.from(lines));
        }
        io.unobserve(entry.target);
      }
    });
  },{threshold:.15,rootMargin:'0px 0px -60px 0px'});
  groups.forEach(list=>{
    list.forEach((el,i)=>{el.style.transitionDelay=Math.min(i*60,420)+'ms';io.observe(el);});
  });
})();
