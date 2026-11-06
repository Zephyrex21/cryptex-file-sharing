// ═══════════════════════════════════════════════════════════════════════
// home.js — nav section-scroll, the hero entrance (decrypt-in headline, scene
// start/stop, pointer tilt), scroll-reveal for Features/About, and a redirect
// shim for old ?token= links that pointed at the root domain before the app
// moved to /app. Homepage only (index.html).
//
// Animation rules this file follows, because they're what keeps the page smooth:
//  • only transform/opacity ever move (CSS does the moving — JS just flips classes);
//  • nothing here changes text or size while it animates, so nothing can re-flow;
//  • everything that loops is paused while off-screen or in a background tab;
//  • the intro waits for html.is-ready (set by shared.js as the loader lifts).
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

// ── Shared helpers ──────────────────────────────────────────────────────────
const REDUCE_MOTION=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ROOT=document.documentElement;
function whenReady(fn){
  if(ROOT.classList.contains('is-ready'))fn();
  else window.addEventListener('cryptex:ready',fn,{once:true});
}

// ── Hero headline: decrypt-in ───────────────────────────────────────────────
// Each character starts as a flickering hex glyph and resolves left → right into
// the real letter — the page's signature moment. The old version rewrote each
// line's text every frame in a different (monospace) font, so the headline — and
// the whole centred hero grid with it — re-flowed on every frame, then jumped
// again when the real font came back. This one can't move anything:
//   1. READ  — measure the exact width of every character in the real text
//              (kerning and letter-spacing included), before touching the DOM;
//   2. WRITE — replace the text with one fixed-width slot per character; a
//              scrambling glyph is drawn *over* its slot (CSS ::after), so no glyph
//              can change a width;
//   3. when everything has resolved, put the original text node back — the
//              layout is identical, so that swap is invisible too.
// The full text stays available to screen readers throughout (.sr-only copy).
const HEX='0123456789ABCDEF';
const randHex=()=>HEX[(Math.random()*HEX.length)|0];
function decryptHeadline(){
  const ids=['heroLine1','heroLineAES','heroLine2'];
  const els=ids.map(id=>document.getElementById(id)).filter(Boolean);
  if(!els.length||REDUCE_MOTION||document.hidden)return;

  // 1. READ (no DOM writes in this block)
  const range=document.createRange();
  const lines=els.map((el,li)=>{
    const node=el.firstChild;
    if(!node||node.nodeType!==3)return null;
    const text=node.data,widths=[];
    for(let i=0;i<text.length;i++){
      range.setStart(node,i);range.setEnd(node,i+1);
      widths.push(range.getBoundingClientRect().width);
    }
    return{el,text,widths,delay:li*130};
  }).filter(Boolean);
  if(!lines.length)return;

  // 2. WRITE
  const DURATION=950,slots=[];
  for(const line of lines){
    const sr=document.createElement('span');sr.className='sr-only';sr.textContent=line.text;
    const vis=document.createElement('span');vis.setAttribute('aria-hidden','true');
    let word=null,n=0;const mine=[];
    for(let i=0;i<line.text.length;i++){
      const ch=line.text[i];
      if(ch===' '){vis.append(document.createTextNode(' '));word=null;continue;}
      if(!word){word=document.createElement('span');word.className='dw';vis.append(word);}
      const s=document.createElement('span');
      s.className='dc scr';s.textContent=ch;
      s.style.width=line.widths[i]+'px';
      s.setAttribute('data-s',randHex());
      word.append(s);mine.push({el:s});n++;
    }
    mine.forEach((m,k)=>{m.at=line.delay+(k/Math.max(1,n-1))*DURATION*.66+Math.random()*DURATION*.2;m.done=false;});
    slots.push(...mine);
    line.el.textContent='';line.el.append(sr,vis);
  }

  // 3. Animate (updates at ~25fps: a cipher flicker doesn't need more, and it keeps the work tiny)
  const t0=performance.now();let last=0,remaining=slots.length;
  function tick(now){
    const t=now-t0;
    if(now-last>=40){
      last=now;
      for(const s of slots){
        if(s.done)continue;
        if(t>=s.at){s.done=true;s.el.classList.remove('scr');s.el.removeAttribute('data-s');remaining--;}
        else s.el.setAttribute('data-s',randHex());
      }
    }
    if(remaining>0&&!document.hidden)requestAnimationFrame(tick);
    else restore();
  }
  function restore(){for(const line of lines)line.el.textContent=line.text;}
  requestAnimationFrame(tick);
}
whenReady(()=>{
  // fonts are guaranteed loaded by now (the loader waits for them), so the widths we measure are final
  if(document.fonts&&document.fonts.status==='loading')document.fonts.ready.then(decryptHeadline);
  else decryptHeadline();
});

// ── Scenes: start when first seen, pause whenever they can't be ─────────────
// The hero/feature visuals loop forever. While they're scrolled away — or the tab
// is in the background (IntersectionObserver alone doesn't catch that) — their
// animations are paused. `is-visible` (set once) releases the entrance sequence;
// `is-playing` (toggles) gates every loop. The hero waits for the loader too, so
// its entrance isn't wasted behind it.
function watchScene(el,{waitForReady=false}={}){
  if(!el)return;
  let visible=false,ready=!waitForReady||ROOT.classList.contains('is-ready');
  const apply=()=>{
    const play=visible&&ready&&!document.hidden;
    if(play)el.classList.add('is-visible');
    el.classList.toggle('is-playing',play);
  };
  const io=new IntersectionObserver(entries=>{
    visible=entries[entries.length-1].isIntersecting;apply();
  },{rootMargin:'60px 0px',threshold:.02});
  io.observe(el);
  document.addEventListener('visibilitychange',apply);
  if(!ready)window.addEventListener('cryptex:ready',()=>{ready=true;apply();},{once:true});
}
watchScene(document.getElementById('vsScene'),{waitForReady:true});
watchScene(document.getElementById('fsScene'));
watchScene(document.getElementById('encSteps'));   // encryption flow loops pause off-screen
watchScene(document.getElementById('encCallout'));

// ── Hero scene: gentle pointer tilt ─────────────────────────────────────────
// Eases the card cluster a few degrees toward the cursor. The rAF loop only runs
// while the cursor is moving or the tilt is still settling, then stops completely
// (no idle per-frame work), and it only sets CSS variables — the tilt itself is a
// compositor transform. Skipped on touch devices and with reduced motion.
(function(){
  const hero=document.getElementById('home'),scene=document.getElementById('vsScene'),tilt=document.getElementById('vsTilt');
  if(!hero||!scene||!tilt||REDUCE_MOTION)return;
  if(!window.matchMedia('(hover: hover) and (pointer: fine)').matches)return;
  const MAX_DEG=4.2;
  let tx=0,ty=0,cx=0,cy=0,raf=0;
  function loop(){
    cx+=(tx-cx)*.085;cy+=(ty-cy)*.085;
    tilt.style.setProperty('--ry',(cx*MAX_DEG).toFixed(3)+'deg');
    tilt.style.setProperty('--rx',(-cy*MAX_DEG).toFixed(3)+'deg');
    raf=(Math.abs(tx-cx)>.002||Math.abs(ty-cy)>.002)?requestAnimationFrame(loop):0;
  }
  const kick=()=>{if(!raf)raf=requestAnimationFrame(loop);};
  hero.addEventListener('pointermove',e=>{
    if(!scene.classList.contains('is-playing'))return;
    const r=scene.getBoundingClientRect();
    tx=Math.max(-1,Math.min(1,((e.clientX-r.left)/r.width-.5)*2));
    ty=Math.max(-1,Math.min(1,((e.clientY-r.top)/r.height-.5)*2));
    kick();
  },{passive:true});
  hero.addEventListener('pointerleave',()=>{tx=0;ty=0;kick();});
})();

// ── Section headings: line-mask rise ────────────────────────────────────────
// Wrap each .tw-line's text so CSS can slide it up out of a clipping mask (see
// "Section headings" in home.css). This replaces the old per-character typewriter,
// which mutated the heading text on every keystroke and re-flowed everything below.
document.querySelectorAll('.sec-title .tw-line').forEach((line,i)=>{
  const inner=document.createElement('span');
  inner.className='tw-in';
  inner.style.setProperty('--l',[...line.parentElement.querySelectorAll('.tw-line')].indexOf(line));
  while(line.firstChild)inner.append(line.firstChild);
  line.append(inner);
});

// ── Scroll-triggered reveal (Features / About) ──────────────────────────────
// Each element fades/lifts in once, the first time it enters the viewport.
// Grouped per-section so stagger timing restarts at 0 for each section rather
// than accumulating one long delay across the whole page.
(function(){
  const groups=[
    document.querySelectorAll('#features .reveal'),
    document.querySelectorAll('#encryption .reveal'),
    document.querySelectorAll('#about .about-wrap > div:first-child .reveal'),
    document.querySelectorAll('#about .faq-list .reveal')
  ];
  if(REDUCE_MOTION){groups.forEach(g=>g.forEach(el=>el.classList.add('revealed')));return;}
  const io=new IntersectionObserver((entries)=>{
    entries.forEach(entry=>{
      if(entry.isIntersecting){entry.target.classList.add('revealed');io.unobserve(entry.target);}
    });
  },{threshold:.15,rootMargin:'0px 0px -60px 0px'});
  groups.forEach(list=>{
    list.forEach((el,i)=>{el.style.transitionDelay=Math.min(i*70,420)+'ms';io.observe(el);});
  });
})();

// ── Feature rows: per-row spotlight that follows the pointer ──────────────────
// The glow is one absolutely-positioned element moved with a transform (no layout,
// no repaint of the row). Touch devices have no hover, so they skip it entirely.
(function(){
  if(REDUCE_MOTION||!window.matchMedia('(hover:hover)').matches)return;
  document.querySelectorAll('.feat-row').forEach(row=>{
    const glow=document.createElement('span');
    glow.className='feat-glow';glow.setAttribute('aria-hidden','true');
    row.prepend(glow);
    row.addEventListener('pointermove',e=>{
      const r=row.getBoundingClientRect();
      row.style.setProperty('--mx',(e.clientX-r.left)+'px');
      row.style.setProperty('--my',(e.clientY-r.top)+'px');
    });
  });
})();

// ── Command palette (Ctrl/⌘+K) ───────────────────────────────────────────────
(function(){
  const P=window.CryptexPalette;
  if(!P)return;
  const go=(id)=>()=>navTo(id);
  const commands=[
    {group:'Sections',label:'Home',keywords:'top start hero',icon:'home',run:go('home')},
    {group:'Sections',label:'Features',keywords:'token private anonymous folders dark mode',icon:'sparkle',run:go('features')},
    {group:'Sections',label:'How the encryption works',keywords:'zero-knowledge aes gcm key fragment ciphertext',icon:'lock',run:go('encryption')},
    {group:'Sections',label:'About & FAQ',keywords:'questions help answers',icon:'info',run:go('about')},
    {group:'Vault',label:'Open Vault',keywords:'app upload start share files',icon:'folder',run:()=>{location.href='/app';}},
    {group:'Vault',label:'API documentation',keywords:'docs openapi swagger rest',icon:'book',run:()=>window.open('/api-docs','_blank','noopener')},
    {group:'More',label:'Toggle light / dark theme',keywords:'appearance mode',icon:'theme',run:()=>document.getElementById('themeBtn')?.click()},
    {group:'More',label:'View source on GitHub',keywords:'repo code',icon:'github',run:()=>window.open('https://github.com/Zephyrex21/cryptex-file-sharing','_blank','noopener')}
  ];
  const dynamic=(q)=>/^[a-z0-9]{6}$/i.test(q)?[{
    group:'Token',label:'Open token “'+q.toLowerCase()+'” in the Vault',icon:'key',
    run:()=>{location.href='/app?token='+encodeURIComponent(q.toLowerCase());}
  }]:[];
  P.register({commands,dynamic});
})();
