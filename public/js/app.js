// ═══════════════════════════════════════════════════════════════════════
// app.js — everything that makes the file/folder manager work: upload,
// search/filter/sort/view, rendering, modals, token access, toasts.
// App page only (app.html).
// ═══════════════════════════════════════════════════════════════════════
// BUG FIX 4: Use a relative URL so this works on localhost AND on Render/any deployment.
// Hardcoding http://localhost:3000 would break the moment you deploy.
const API='/api/files';
const FOLDERS_API='/api/folders';
let allFiles=[],curF='all',curS='newest',curV='grid',searchQ='';
let allFolders=[],curSection='files',curFolder=null,folderCtx=null,atfFileId=null,tokenModalFile=null,tokenModalFolder=null,folderSearchQ='';
let privRevealCtx={id:null,type:null}; // tracks which file/folder the privRevealModal is currently showing
// ── Search ─────────────────────────────────────────────────────────────────
document.getElementById('sInput').addEventListener('input',e=>{searchQ=e.target.value.trim();renderAll();});
document.getElementById('folderSearchInput').addEventListener('input',e=>{folderSearchQ=e.target.value.trim();renderFolders();});
document.getElementById('tInput').addEventListener('keydown',e=>{if(e.key==='Enter')accessByToken();});
document.getElementById('tokenModal').addEventListener('click',e=>{if(e.target===document.getElementById('tokenModal'))closeTokenModal();});
document.getElementById('privRevealModal').addEventListener('click',e=>{if(e.target===document.getElementById('privRevealModal'))document.getElementById('privRevealModal').classList.remove('open');});

// ── Filter ─────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  t.classList.add('active');curF=t.dataset.f;renderAll();
}));

// ── Sort ───────────────────────────────────────────────────────────────────
const sNames={newest:'Newest',oldest:'Oldest','name-az':'Name A→Z','name-za':'Name Z→A','size-desc':'Largest','size-asc':'Smallest'};
document.getElementById('sortBtn').addEventListener('click',e=>{e.stopPropagation();document.getElementById('sortMenu').classList.toggle('open');});
document.addEventListener('click',()=>document.getElementById('sortMenu').classList.remove('open'));
document.querySelectorAll('.sopt').forEach(o=>o.addEventListener('click',e=>{
  e.stopPropagation();
  document.querySelectorAll('.sopt').forEach(x=>x.classList.remove('active'));
  o.classList.add('active');curS=o.dataset.s;
  document.getElementById('sortLbl').textContent=sNames[curS];
  document.getElementById('sortMenu').classList.remove('open');renderAll();
}));

// ── View ───────────────────────────────────────────────────────────────────
document.querySelectorAll('.vtab').forEach(v=>v.addEventListener('click',()=>{
  document.querySelectorAll('.vtab').forEach(x=>x.classList.remove('active'));
  v.classList.add('active');curV=v.dataset.v;
  document.getElementById('fc').className=curV==='grid'?'grid':'list';renderAll();
}));

// ── Upload ─────────────────────────────────────────────────────────────────
const fInput=document.getElementById('fInput'),uzone=document.getElementById('uzone'),pickBtn=document.getElementById('pickBtn');

// ── First-time celebration ───────────────────────────────────────────────────
// A small confetti burst, reserved for the very FIRST successful upload and
// the very FIRST link added (tracked via localStorage) — not every action,
// since that would get old fast and stop feeling like anything. Lightweight,
// no canvas/library: a handful of absolutely-positioned divs animated with
// plain CSS. Respects reduced-motion by simply not firing.
function celebrate(originEl){
  if(!originEl)return;
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const rect=originEl.getBoundingClientRect();
  const cx=rect.left+rect.width/2,cy=rect.top+rect.height/2;
  const colors=['#7872F0','#A472F0','#4ADE80','#F0C040','#60A0F0','#F0529E'];
  for(let i=0;i<18;i++){
    const p=document.createElement('div');
    p.className='confetti-piece';
    const angle=Math.random()*Math.PI*2;
    const dist=50+Math.random()*90;
    p.style.setProperty('--tx',(Math.cos(angle)*dist)+'px');
    p.style.setProperty('--ty',(Math.sin(angle)*dist-50)+'px'); // biased upward
    p.style.setProperty('--rot',(Math.random()*360)+'deg');
    p.style.background=colors[i%colors.length];
    p.style.left=cx+'px';p.style.top=cy+'px';
    document.body.appendChild(p);
    setTimeout(()=>p.remove(),900);
  }
}
function celebrateIfFirstTime(key,originEl){
  if(localStorage.getItem(key))return;
  localStorage.setItem(key,'1');
  celebrate(originEl);
}
pickBtn.addEventListener('click',e=>{e.stopPropagation();fInput.click();});
uzone.addEventListener('click',e=>{if(!e.target.closest('#pickBtn'))fInput.click();});
fInput.addEventListener('change',()=>{[...fInput.files].forEach(doUpload);fInput.value='';});
document.addEventListener('dragover',e=>e.preventDefault());
uzone.addEventListener('dragenter',e=>{e.preventDefault();uzone.classList.add('drag-over');});
uzone.addEventListener('dragover',e=>e.preventDefault());
uzone.addEventListener('dragleave',e=>{if(!uzone.contains(e.relatedTarget))uzone.classList.remove('drag-over');});
uzone.addEventListener('drop',e=>{e.preventDefault();uzone.classList.remove('drag-over');[...e.dataTransfer.files].forEach(doUpload);});

function getLimit(m){return 50;} // flat 50MB cap for every file type
const ALLOWED=['image/jpeg','image/png','image/gif','image/webp','video/mp4','video/webm','video/ogg','video/quicktime','video/x-msvideo','application/pdf','application/zip','application/x-zip-compressed','text/plain','text/csv','application/xml','text/xml','application/msword','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation','text/x-python','application/x-ipynb+json','text/javascript','text/jsx','text/typescript','text/tsx','application/json','text/markdown','text/x-java','text/x-c','text/x-c++','text/x-c-header','text/x-c++-header','text/css','text/html','application/sql','text/yaml','application/x-sh'];

// Most OSes have no registered MIME type for these extensions, so
// file.type is often just an empty string for them — same reason the
// backend can't trust the raw browser-reported type either (see
// CODE_EXT_TO_MIME in controllers/fileUpload.js, which this mirrors).
const CODE_EXT_TO_MIME={
  '.py':'text/x-python','.ipynb':'application/x-ipynb+json',
  '.js':'text/javascript','.jsx':'text/jsx','.ts':'text/typescript','.tsx':'text/tsx',
  '.json':'application/json','.md':'text/markdown',
  '.java':'text/x-java','.c':'text/x-c','.cpp':'text/x-c++','.h':'text/x-c-header','.hpp':'text/x-c++-header',
  '.css':'text/css','.html':'text/html','.sql':'application/sql','.yml':'text/yaml','.yaml':'text/yaml','.sh':'application/x-sh',
};
// Re-wraps a File with a corrected .type when its extension is a known code
// file — File.type is read-only, so this constructs a new File rather than
// mutating the original. No-op (returns the same file) for everything else.
function normalizeCodeFileType(file){
  const dot=file.name.lastIndexOf('.');
  const ext=dot>0?file.name.slice(dot).toLowerCase():'';
  const canonical=CODE_EXT_TO_MIME[ext];
  if(!canonical||file.type===canonical)return file;
  return new File([file],file.name,{type:canonical});
}
let queue=[],busy=false,batchTotal=0;
function doUpload(f){
  f=normalizeCodeFileType(f);
  if(!ALLOWED.includes(f.type))return toast(`"${f.type}" not supported`,'error');
  if(f.size>getLimit(f.type)*1024*1024)return toast(`${f.name} exceeds ${getLimit(f.type)}MB`,'error');
  if(!queue.length&&!busy)batchTotal=0; // starting a fresh batch
  queue.push(f);batchTotal++;proc();
}
function proc(){
  if(busy||!queue.length)return;
  busy=true;const f=queue.shift();
  const pos=batchTotal-queue.length; // 1-indexed position of this file within the batch
  const pw=document.getElementById('prog'),pf=document.getElementById('pFill'),pn=document.getElementById('pName'),pp=document.getElementById('pPct'),ptr=pw.querySelector('.prog-track');
  pn.textContent=batchTotal>1?`${f.name} · ${pos} of ${batchTotal}`:f.name;
  pf.classList.remove('success');pf.style.width='0%';pp.textContent='0%';pw.classList.add('show');uzone.classList.add('busy');
  const fd=new FormData();fd.append('file',f);
  const xhr=new XMLHttpRequest();
  xhr.upload.onprogress=e=>{if(e.lengthComputable){const p=Math.round(e.loaded/e.total*100);pf.style.width=p+'%';pp.textContent=p+'%';}};
  xhr.onload=()=>{
    busy=false;
    if(xhr.status===201){
      pf.style.width='100%';pp.textContent='100%';toast(`${f.name} uploaded!`,'success');
      celebrateIfFirstTime('cv-first-upload',uzone);
      const isLast=queue.length===0;
      if(isLast){pf.classList.add('success');pp.textContent='✓ Done';ptr.classList.add('pop');}
      setTimeout(()=>{pw.classList.remove('show');uzone.classList.remove('busy');pf.classList.remove('success');ptr.classList.remove('pop');loadFiles();proc();},isLast?1000:750);
    }
    else{let m='Upload failed';try{m=JSON.parse(xhr.responseText).message||m;}catch{}toast(m,'error');pw.classList.remove('show');uzone.classList.remove('busy');proc();}
  };
  xhr.onerror=()=>{busy=false;toast('Server unreachable','error');pw.classList.remove('show');uzone.classList.remove('busy');proc();};
  xhr.open('POST',`${API}/upload`);xhr.send(fd);
}

// ── Add Link ─────────────────────────────────────────────────────────────────
// Fetching the preview (title/image) server-side takes a couple seconds, so
// this gives clear "in progress" feedback rather than leaving the button
// looking clickable while a request is in flight.
async function addLink(){
  const input=document.getElementById('linkInput'),btn=document.getElementById('linkAddBtn');
  const url=input.value.trim();
  if(!url)return;
  let parsed;
  try{parsed=new URL(url);}catch{return toast('That doesn\'t look like a valid URL','error');}
  if(!['http:','https:'].includes(parsed.protocol))return toast('Only http and https links are supported','error');

  const origLabel=btn.innerHTML;
  btn.disabled=true;input.disabled=true;
  btn.innerHTML='<svg viewBox="0 0 24 24" style="animation:spin .8s linear infinite"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>Adding…';
  try{
    const res=await fetch(`${API}/link`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({url:parsed.toString()}),
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.message||'Could not add that link');
    toast('Link added!','success');
    celebrateIfFirstTime('cv-first-link',document.getElementById('linkAddBtn'));
    input.value='';
    loadFiles();
  }catch(err){
    toast(err.message||'Could not add that link','error');
  }finally{
    btn.disabled=false;input.disabled=false;btn.innerHTML=origLabel;
  }
}
document.getElementById('linkAddBtn').addEventListener('click',addLink);
document.getElementById('linkInput').addEventListener('keydown',e=>{if(e.key==='Enter')addLink();});

// ── Paste to create a file ──────────────────────────────────────────────────
// Paste plain text anywhere on the page (not focused in a text field) and it
// becomes a .txt file — handy for sharing a snippet or note without saving
// it to disk first. Pasting an actual file (e.g. a copied screenshot) works
// the same way and uploads it directly. Both route through the normal
// doUpload() queue, so validation/progress/batch-counter all apply for free.
document.addEventListener('paste',(e)=>{
  const tag=e.target.tagName;
  if(tag==='INPUT'||tag==='TEXTAREA'||e.target.isContentEditable)return;
  const cd=e.clipboardData;
  if(!cd)return;

  if(cd.files&&cd.files.length>0){
    e.preventDefault();
    [...cd.files].forEach(doUpload);
    return;
  }

  const text=cd.getData('text/plain');
  if(text&&text.trim()){
    e.preventDefault();
    const d=new Date();
    const stamp=d.toLocaleDateString('en',{month:'short',day:'numeric'})+' '+d.toLocaleTimeString('en',{hour:'numeric',minute:'2-digit'});
    doUpload(new File([text],`Pasted text — ${stamp}.txt`,{type:'text/plain'}));
  }
});

// ── Load ───────────────────────────────────────────────────────────────────
async function loadFiles(){
  const btn=document.getElementById('rfBtn');btn.classList.add('spin');
  try{
    const res=await fetch(API);if(!res.ok)throw new Error();
    const data=await res.json();allFiles=data.files||[];
    renderAll();
    document.getElementById('badge').textContent=`${allFiles.length} file${allFiles.length!==1?'s':''}`;
  }catch{toast('Cannot reach server','error');}
  finally{btn.classList.remove('spin');}
}
function getDisplay(){
  // Never render private files in the gallery — they only exist in allFiles
  // temporarily for preview/download after a makeFilePublic call.
  let f=[...allFiles].filter(x=>(x.visibility||'public')!=='private');
  if(curF==='image')f=f.filter(x=>x.fileType?.startsWith('image/'));
  else if(curF==='video')f=f.filter(x=>x.fileType?.startsWith('video/'));
  else if(curF==='pdf')f=f.filter(x=>x.fileType==='application/pdf');
  else if(curF==='zip')f=f.filter(x=>x.fileType?.includes('zip'));
  else if(curF==='doc')f=f.filter(x=>isDoc(x.fileType)||isSheet(x.fileType)||isSlide(x.fileType));
  else if(curF==='code')f=f.filter(x=>isCode(x.fileType));
  else if(curF==='link')f=f.filter(x=>x.fileType==='text/x-url');
  if(searchQ){const q=searchQ.toLowerCase();f=f.filter(x=>x.originalName.toLowerCase().includes(q));}
  switch(curS){
    case 'newest':f.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));break;
    case 'oldest':f.sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));break;
    case 'name-az':f.sort((a,b)=>a.originalName.localeCompare(b.originalName));break;
    case 'name-za':f.sort((a,b)=>b.originalName.localeCompare(a.originalName));break;
    case 'size-desc':f.sort((a,b)=>(b.fileSize||0)-(a.fileSize||0));break;
    case 'size-asc':f.sort((a,b)=>(a.fileSize||0)-(b.fileSize||0));break;
  }
  return f;
}
function renderAll(){
  const files=getDisplay();
  document.getElementById('reslbl').textContent=(searchQ||curF!=='all')?`${files.length} result${files.length!==1?'s':''}` :'';
  const c=document.getElementById('fc');
  if(!files.length){c.innerHTML=`<div class="empty"><div class="eico"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M3 15v4c0 1.1.9 2 2 2h14a2 2 0 002-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div><h3>${searchQ?'No results':'Nothing here yet'}</h3><p>${searchQ?'Try a different search term':'Upload your first file above'}</p></div>`;return;}
  c.innerHTML='';
  files.forEach((f,i)=>c.appendChild(curV==='grid'?mkGrid(f,i):mkList(f,i)));
}

// ── Helpers ────────────────────────────────────────────────────────────────
const isImg=m=>m?.startsWith('image/');
const isVid=m=>m?.startsWith('video/');
const isPdf=m=>m==='application/pdf';
const isZip=m=>m?.includes('zip');
const isDoc=m=>m==='text/plain'||m==='application/xml'||m==='text/xml'||m==='application/msword'||m==='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const isSheet=m=>m==='text/csv'||m==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const isSlide=m=>m==='application/vnd.ms-powerpoint'||m==='application/vnd.openxmlformats-officedocument.presentationml.presentation';
const isCode=m=>['text/x-python','application/x-ipynb+json','text/javascript','text/jsx','text/typescript','text/tsx','application/json','text/markdown','text/x-java','text/x-c','text/x-c++','text/x-c-header','text/x-c++-header','text/css','text/html','application/sql','text/yaml','application/x-sh'].includes(m);
function tc(m){if(isImg(m))return'img';if(isVid(m))return'vid';if(isPdf(m))return'pdf';if(isZip(m))return'zip';if(isDoc(m))return'doc';if(isSheet(m))return'sheet';if(isSlide(m))return'slide';if(isCode(m))return'code';if(isLink(m))return'link';return'file';}
function tl(m){
  if(isImg(m)){const map={'image/jpeg':'JPG','image/png':'PNG','image/gif':'GIF','image/webp':'WEBP'};return map[m]||'IMG';}
  if(isVid(m)){const map={'video/mp4':'MP4','video/webm':'WEBM','video/ogg':'OGV','video/quicktime':'MOV','video/x-msvideo':'AVI'};return map[m]||'VID';}
  if(isPdf(m))return'PDF';if(isZip(m))return'ZIP';
  if(isDoc(m)){const map={'text/plain':'TXT','application/xml':'XML','text/xml':'XML','application/msword':'DOC','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'DOCX'};return map[m]||'DOC';}
  if(isSheet(m)){const map={'text/csv':'CSV','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'XLSX'};return map[m]||'SHEET';}
  if(isSlide(m)){const map={'application/vnd.ms-powerpoint':'PPT','application/vnd.openxmlformats-officedocument.presentationml.presentation':'PPTX'};return map[m]||'PPT';}
  if(isCode(m)){const map={'text/x-python':'PY','application/x-ipynb+json':'IPYNB','text/javascript':'JS','text/jsx':'JSX','text/typescript':'TS','text/tsx':'TSX','application/json':'JSON','text/markdown':'MD','text/x-java':'JAVA','text/x-c':'C','text/x-c++':'CPP','text/x-c-header':'H','text/x-c++-header':'HPP','text/css':'CSS','text/html':'HTML','application/sql':'SQL','text/yaml':'YAML','application/x-sh':'SH'};return map[m]||'CODE';}
  if(isLink(m))return'LINK';
  return'FILE';
}
function typeHuman(m){if(isImg(m))return tl(m)+' Image';if(isVid(m))return tl(m)+' Video';if(isPdf(m))return'PDF Document';if(isZip(m))return'ZIP Archive';if(isDoc(m))return tl(m)==='TXT'?'Text File':tl(m)==='XML'?'XML File':'Word Document';if(isSheet(m))return tl(m)==='CSV'?'CSV Spreadsheet':'Excel Spreadsheet';if(isSlide(m))return'PowerPoint Presentation';if(isCode(m))return tl(m)+' File';if(isLink(m))return'Link';return'File';}
function mkThumb(f){
  if(isImg(f.fileType))return`<img src="${f.fileUrl||f.cloudinaryUrl}" alt="" loading="lazy">`;
  if(isVid(f.fileType))return`<div class="fph fph-vid"><div class="play-ring"><svg viewBox="0 0 16 16"><polygon points="4,2 14,8 4,14" fill="white"/></svg></div><span class="fph-lbl">${tl(f.fileType)}</span></div>`;
  if(isPdf(f.fileType))return`<div class="fph fph-pdf"><div class="fph-icon"><svg viewBox="0 0 56 56" fill="none"><rect x="8" y="4" width="30" height="40" rx="4" fill="white" fill-opacity=".92"/><rect x="28" y="4" width="10" height="12" rx="2" fill="#E84040" fill-opacity=".7"/><rect x="12" y="20" width="20" height="2.5" rx="1.25" fill="#E84040" fill-opacity=".5"/><rect x="12" y="26" width="16" height="2.5" rx="1.25" fill="#E84040" fill-opacity=".4"/><rect x="12" y="32" width="18" height="2.5" rx="1.25" fill="#E84040" fill-opacity=".3"/><rect x="30" y="38" width="18" height="14" rx="3" fill="#E84040"/><text x="39" y="48" font-family="Inter,Arial" font-size="7" font-weight="800" fill="white" text-anchor="middle">PDF</text></svg></div><span class="fph-lbl">PDF</span></div>`;
  if(isZip(f.fileType))return`<div class="fph fph-zip"><div class="fph-icon"><svg viewBox="0 0 56 56" fill="none"><rect x="6" y="18" width="44" height="30" rx="4" fill="white" fill-opacity=".9"/><rect x="6" y="18" width="44" height="11" rx="4" fill="#E8A020" fill-opacity=".85"/><rect x="22" y="10" width="12" height="16" rx="3" fill="#E8A020" fill-opacity=".7"/><rect x="24" y="29" width="8" height="3" rx="1.5" fill="#E8A020" fill-opacity=".55"/><rect x="24" y="34" width="8" height="3" rx="1.5" fill="#E8A020" fill-opacity=".45"/><rect x="24" y="39" width="8" height="3" rx="1.5" fill="#E8A020" fill-opacity=".35"/></svg></div><span class="fph-lbl">ZIP</span></div>`;
  if(isDoc(f.fileType))return`<div class="fph fph-doc"><div class="fph-icon"><svg viewBox="0 0 56 56" fill="none"><rect x="10" y="4" width="36" height="48" rx="4" fill="white" fill-opacity=".92"/><rect x="16" y="14" width="24" height="3" rx="1.5" fill="#0EA5D4" fill-opacity=".6"/><rect x="16" y="22" width="24" height="3" rx="1.5" fill="#0EA5D4" fill-opacity=".5"/><rect x="16" y="30" width="18" height="3" rx="1.5" fill="#0EA5D4" fill-opacity=".4"/><rect x="16" y="38" width="20" height="3" rx="1.5" fill="#0EA5D4" fill-opacity=".3"/></svg></div><span class="fph-lbl">${tl(f.fileType)}</span></div>`;
  if(isSheet(f.fileType))return`<div class="fph fph-sheet"><div class="fph-icon"><svg viewBox="0 0 56 56" fill="none"><rect x="8" y="8" width="40" height="40" rx="4" fill="white" fill-opacity=".92"/><rect x="8" y="8" width="40" height="10" rx="4" fill="#0D9488" fill-opacity=".8"/><line x1="21" y1="18" x2="21" y2="48" stroke="#0D9488" stroke-opacity=".35" stroke-width="2"/><line x1="35" y1="18" x2="35" y2="48" stroke="#0D9488" stroke-opacity=".35" stroke-width="2"/><line x1="8" y1="28" x2="48" y2="28" stroke="#0D9488" stroke-opacity=".35" stroke-width="2"/><line x1="8" y1="38" x2="48" y2="38" stroke="#0D9488" stroke-opacity=".35" stroke-width="2"/></svg></div><span class="fph-lbl">${tl(f.fileType)}</span></div>`;
  if(isSlide(f.fileType))return`<div class="fph fph-slide"><div class="fph-icon"><svg viewBox="0 0 56 56" fill="none"><rect x="4" y="12" width="48" height="32" rx="4" fill="white" fill-opacity=".92"/><rect x="10" y="30" width="6" height="8" rx="1.5" fill="#E8642D" fill-opacity=".6"/><rect x="19" y="24" width="6" height="14" rx="1.5" fill="#E8642D" fill-opacity=".75"/><rect x="28" y="18" width="6" height="20" rx="1.5" fill="#E8642D" fill-opacity=".9"/><circle cx="42" cy="22" r="5" fill="#E8642D" fill-opacity=".4"/></svg></div><span class="fph-lbl">PPTX</span></div>`;
  if(isCode(f.fileType))return`<div class="fph fph-code"><div class="fph-icon"><svg viewBox="0 0 56 56" fill="none"><rect x="6" y="8" width="44" height="40" rx="6" fill="white" fill-opacity=".92"/><path d="M20 22l-6 6 6 6" stroke="#65A30D" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M36 22l6 6-6 6" stroke="#65A30D" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><line x1="31" y1="18" x2="25" y2="38" stroke="#65A30D" stroke-opacity=".55" stroke-width="2.5" stroke-linecap="round"/></svg></div><span class="fph-lbl">${tl(f.fileType)}</span></div>`;
  return`<div class="fph fph-file"><div class="fph-icon"><svg viewBox="0 0 48 48" fill="none"><path d="M10 8h20l10 10v22a2 2 0 01-2 2H10a2 2 0 01-2-2V10a2 2 0 012-2z" fill="white" fill-opacity=".6"/></svg></div><span class="fph-lbl">${tl(f.fileType)}</span></div>`;
}
function mkLThumb(f){
  if(isImg(f.fileType))return`<img src="${f.fileUrl||f.cloudinaryUrl}" alt="" loading="lazy">`;
  const col=isVid(f.fileType)?'lph-vid':isPdf(f.fileType)?'lph-pdf':isZip(f.fileType)?'lph-zip':isDoc(f.fileType)?'lph-doc':isSheet(f.fileType)?'lph-sheet':isSlide(f.fileType)?'lph-slide':isCode(f.fileType)?'lph-code':'lph-file';
  const sc=isVid(f.fileType)?'rgba(255,255,255,.7)':isPdf(f.fileType)?'var(--red)':isZip(f.fileType)?'var(--ylw)':isDoc(f.fileType)?'var(--cyn)':isSheet(f.fileType)?'var(--tel)':isSlide(f.fileType)?'var(--org)':isCode(f.fileType)?'var(--cod)':'var(--t3)';
  const icons={vid:`<polygon points="4,3 13,8 4,13" fill="${sc}"/>`,pdf:`<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="${sc}" fill="none"/><polyline points="14 2 14 8 20 8" stroke="${sc}" fill="none"/>`,zip:`<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="${sc}" fill="none"/><polyline points="7 10 12 15 17 10" stroke="${sc}" fill="none"/><line x1="12" y1="15" x2="12" y2="3" stroke="${sc}"/>`,doc:`<path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" stroke="${sc}" fill="none"/><polyline points="13 2 13 9 20 9" stroke="${sc}" fill="none"/><line x1="8" y1="13" x2="16" y2="13" stroke="${sc}"/><line x1="8" y1="17" x2="16" y2="17" stroke="${sc}"/>`,sheet:`<rect x="3" y="4" width="18" height="16" rx="2" stroke="${sc}" fill="none"/><line x1="3" y1="10" x2="21" y2="10" stroke="${sc}"/><line x1="9" y1="10" x2="9" y2="20" stroke="${sc}"/><line x1="15" y1="10" x2="15" y2="20" stroke="${sc}"/>`,slide:`<rect x="2" y="5" width="20" height="13" rx="2" stroke="${sc}" fill="none"/><line x1="8" y1="21" x2="16" y2="21" stroke="${sc}"/><line x1="12" y1="18" x2="12" y2="21" stroke="${sc}"/>`,code:`<polyline points="9 8 5 12 9 16" stroke="${sc}" fill="none"/><polyline points="15 8 19 12 15 16" stroke="${sc}" fill="none"/>`,file:`<path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" stroke="${sc}" fill="none"/><polyline points="13 2 13 9 20 9" stroke="${sc}" fill="none"/>`};
  const k=isVid(f.fileType)?'vid':isPdf(f.fileType)?'pdf':isZip(f.fileType)?'zip':isDoc(f.fileType)?'doc':isSheet(f.fileType)?'sheet':isSlide(f.fileType)?'slide':isCode(f.fileType)?'code':'file';
  return`<div class="lfph ${col}"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8">${icons[k]}</svg></div>`;
}

const isLink=m=>m==='text/x-url';
function mkActionsGrid(f,v,primaryBtn){
  return`<div class="cact-row">
    ${primaryBtn}
    <button class="cact" title="Copy Token" onclick="copyToken('${f.shareToken||''}')"><svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg></button>
    <button class="cact" title="Properties" onclick="showProp('${f._id}')"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></button>
    <button class="cact" title="Rename" onclick="renameFilePr('${f._id}','${esc(f.originalName)}')"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
    <div class="cact-sep"></div>
    <button class="cact cact-vis-${v==='public'?'pub':'priv'}" id="visBtn-${f._id}" title="${v==='public'?'Make private':'Click to make public'}" onclick="toggleVis('${f._id}','${v}')">${v==='public'?'<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>':'<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>'}</button>
    <button class="cact" title="${(folderCtx||f.folderId)?'Remove from folder':'Add to folder'}" onclick="${(folderCtx||f.folderId)?`removeFromFolder('${folderCtx||f.folderId}','${f._id}')`:`showAtf('${f._id}')`}"><svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></button>
    <button class="cact cact-del" title="Delete" onclick="delFile('${f._id}','${esc(f.originalName)}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg></button>
  </div>`;
}
function mkActionsList(f,v,primaryBtn){
  return`<div class="lacts">
    ${primaryBtn}
    <button class="lact la-tok" title="Copy Token" onclick="copyToken('${f.shareToken||''}')"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg></button>
    <button class="lact" title="Properties" onclick="showProp('${f._id}')"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></button>
    <button class="lact" title="Rename" onclick="renameFilePr('${f._id}','${esc(f.originalName)}')"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
    <button class="lact la-vis-${v==='public'?'pub':'priv'}" id="visBtn-${f._id}" title="${v==='public'?'Public — click to make private':'Private — click to make public'}" onclick="toggleVis('${f._id}','${v}')">${v==='public'?'<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>':'<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>'}</button>
    <button class="lact ${(folderCtx||f.folderId)?'la-rmfolder':'la-folder'}" title="${(folderCtx||f.folderId)?'Remove from folder':'Add to folder'}" onclick="${(folderCtx||f.folderId)?`removeFromFolder('${folderCtx||f.folderId}','${f._id}')`:`showAtf('${f._id}')`}"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></button>
    <button class="lact la-del" title="Delete" onclick="delFile('${f._id}','${esc(f.originalName)}')"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg></button>
  </div>`;
}
const DL_BTN_GRID=(f)=>`<button class="cact" title="Download" onclick="dlFile('${f._id}','${esc(f.originalName)}')"><svg viewBox="0 0 24 24"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0018 9h-1.26A8 8 0 103 16.29"/></svg></button>`;
const OPEN_BTN_GRID=(f)=>`<button class="cact" title="Open Link" onclick="window.open('${esc(f.linkUrl)}','_blank','noopener')"><svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>`;
const DL_BTN_LIST=(f)=>`<button class="lact la-dl" title="Download" onclick="dlFile('${f._id}','${esc(f.originalName)}')"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/></svg></button>`;
const OPEN_BTN_LIST=(f)=>`<button class="lact la-dl" title="Open Link" onclick="window.open('${esc(f.linkUrl)}','_blank','noopener')"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>`;

function mkGrid(f,i){
  const type=tc(f.fileType),label=tl(f.fileType);
  const d=document.createElement('div');
  const v=f.visibility||'public';
  d.className='fcard';d.id=`card-${f._id}`;d.style.animationDelay=`${i*.05}s`;
  if(isLink(f.fileType)){
    d.innerHTML=`
      <div class="cthumb clink-thumb" onclick="window.open('${esc(f.linkUrl)}','_blank','noopener')" style="cursor:pointer">
        ${isRecent(f.createdAt)?'<span class="new-badge">NEW</span>':''}
        ${f.linkImage?`<img src="${esc(f.linkImage)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`:''}
        <div class="clink-fallback" style="${f.linkImage?'display:none':'display:flex'}"><svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg></div>
        <span class="thbadge tb-link">LINK</span>
      </div>
      <div class="cbody">
        <div class="cname" title="${esc(f.originalName)}">${esc(f.originalName)}</div>
        <div class="cmeta"><span class="tpill tp-link">LINK</span><span class="dot"></span><span>${esc(f.linkDomain||'')}</span><span class="dot"></span><span>${fmtDt(f.createdAt)}</span><span class="dot"></span><span class="vis-badge vis-${v==='public'?'pub':'priv'}">${v==='public'?'Public':'Private'}</span></div>
        ${mkActionsGrid(f,v,OPEN_BTN_GRID(f))}
      </div>`;
    return d;
  }
  const canP=isImg(f.fileType)||isVid(f.fileType)||isPdf(f.fileType);
  d.innerHTML=`
    <div class="cthumb" onclick="${canP?`openPrev('${f._id}')`:''}" style="cursor:${canP?'pointer':'default'}">
      ${isRecent(f.createdAt)?'<span class="new-badge">NEW</span>':''}
      ${mkThumb(f)}
      ${canP?`<div class="cover"><span>${esc(stripExt(f.originalName))}</span></div>`:''}
      <span class="thbadge tb-${type}">${label}</span>
    </div>
    <div class="cbody">
      <div class="cname" title="${esc(f.originalName)}">${esc(stripExt(f.originalName))}</div>
      <div class="cmeta"><span class="tpill tp-${type}">${label}</span><span class="dot"></span><span>${fmtSz(f.fileSize)}</span><span class="dot"></span><span>${fmtDt(f.createdAt)}</span><span class="dot"></span><span class="vis-badge vis-${v==='public'?'pub':'priv'}">${v==='public'?'Public':'Private'}</span></div>
      ${mkActionsGrid(f,v,DL_BTN_GRID(f))}
    </div>`;
  return d;
}
function mkList(f,i){
  const type=tc(f.fileType),label=tl(f.fileType);
  const d=document.createElement('div');
  const v=f.visibility||'public';
  d.className='fcard';d.id=`card-${f._id}`;d.style.animationDelay=`${i*.04}s`;
  if(isLink(f.fileType)){
    d.innerHTML=`
      <div class="lrow">
        <div class="lthumb llink-thumb" onclick="window.open('${esc(f.linkUrl)}','_blank','noopener')" style="cursor:pointer">${f.linkImage?`<img src="${esc(f.linkImage)}" alt="" loading="lazy" onerror="this.style.display='none'">`:`<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>`}</div>
        <div class="linfo">
          <div class="lname" title="${esc(f.originalName)}">${esc(f.originalName)}${isRecent(f.createdAt)?'<span class="new-badge-list">NEW</span>':''}</div>
          <div class="lmeta"><span class="tpill tp-link">LINK</span><span>${esc(f.linkDomain||'')}</span><span>·</span><span>${fmtDt(f.createdAt)}</span><span class="vis-badge vis-${v==='public'?'pub':'priv'}">${v==='public'?'Public':'Private'}</span></div>
        </div>
        ${mkActionsList(f,v,OPEN_BTN_LIST(f))}
      </div>`;
    return d;
  }
  const canP=isImg(f.fileType)||isVid(f.fileType)||isPdf(f.fileType);
  d.innerHTML=`
    <div class="lrow">
      <div class="lthumb" onclick="${canP?`openPrev('${f._id}')`:''}" style="cursor:${canP?'pointer':'default'}">${mkLThumb(f)}</div>
      <div class="linfo">
        <div class="lname" title="${esc(f.originalName)}">${esc(stripExt(f.originalName))}${isRecent(f.createdAt)?'<span class="new-badge-list">NEW</span>':''}</div>
        <div class="lmeta"><span class="tpill tp-${type}">${label}</span><span>${fmtSz(f.fileSize)}</span><span>·</span><span>${fmtDt(f.createdAt)}</span><span class="vis-badge vis-${v==='public'?'pub':'priv'}">${v==='public'?'Public':'Private'}</span></div>
      </div>
      ${mkActionsList(f,v,DL_BTN_LIST(f))}
    </div>`;
  return d;
}

// ── PREVIEW ────────────────────────────────────────────────────────────────
// PDF: opens our /preview endpoint in a new browser tab (native PDF viewer)
// Image/Video: opens inline lightbox
function openPrev(id){
  // Falls back to tokenModalFile so private files can be previewed from the token modal
  // without being pushed into allFiles (which would make them appear in the gallery).
  const f=allFiles.find(x=>x._id===id)||(tokenModalFile&&tokenModalFile._id===id?tokenModalFile:null);
  if(!f)return;
  if(isPdf(f.fileType)){
    // BUG FIX 2: DO NOT open f.cloudinaryUrl directly for PDFs.
    // Reason: PDFs are stored as Cloudinary "raw" type. The URL has no .pdf extension
    // (since the public_id stripped it), so the browser has no way to know it's a PDF
    // and just downloads it as a nameless file with no extension.
    //
    // The /preview backend endpoint fetches from Cloudinary and serves the bytes back
    // with Content-Type: application/pdf + Content-Disposition: inline — so the
    // browser opens it in its native PDF viewer instead of downloading it.
    window.open(`${API}/${f._id}/preview`, '_blank');
    return;
  }
  // Image or Video — lightbox
  const img=document.getElementById('lbImg'),vid=document.getElementById('lbVid'),info=document.getElementById('lbInfo');
  img.style.display='none';vid.style.display='none';img.src='';vid.src='';
  const src=f.fileUrl||f.cloudinaryUrl;
  if(isImg(f.fileType)){img.src=src;img.style.display='block';}
  else if(isVid(f.fileType)){vid.src=src;vid.style.display='block';}
  else return;
  info.textContent=`${stripExt(f.originalName)} · ${tl(f.fileType)} · ${fmtSz(f.fileSize)}`;
  document.getElementById('lb').classList.add('open');document.body.style.overflow='hidden';
}
function closeLB(){
  document.getElementById('lb').classList.remove('open');document.body.style.overflow='';
  const vid=document.getElementById('lbVid');vid.pause();vid.src='';
  setTimeout(()=>document.getElementById('lbImg').src='',250);
}
function lbClick(e){if(e.target===document.getElementById('lb'))closeLB();}

// ── DOWNLOAD — use backend /download endpoint for ALL file types ─────────
// BUG FIX 3: The old fl_attachment Cloudinary URL trick only works for
// image/video resource types. For raw resources (PDFs, ZIPs), Cloudinary
// silently ignores the fl_attachment transformation — so the file would be
// served inline (or not at all) with no filename and no extension.
//
// The /download endpoint handles ALL types correctly: it fetches from Cloudinary
// and serves the bytes with Content-Disposition: attachment; filename="original.pdf"
// so the browser always downloads it with the correct filename and extension.
function dlFile(id,name){
  const a=document.createElement('a');
  a.href=`${API}/${id}/download`;
  a.download=name;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  toast(`Downloading ${name}…`,'info');
}

// ── DELETE ─────────────────────────────────────────────────────────────────
let pendingId=null;
function delFile(id,name){pendingId=id;document.getElementById('delFname').textContent=stripExt(name)||'This file';document.getElementById('delModal').classList.add('open');}
document.getElementById('delCancel').onclick=()=>{pendingId=null;document.getElementById('delModal').classList.remove('open');};
document.getElementById('delConfirm').onclick=()=>{
  if(!pendingId)return;
  const id=pendingId;const fname=document.getElementById('delFname').textContent||'File';
  pendingId=null;document.getElementById('delModal').classList.remove('open');
  const card=document.getElementById(`card-${id}`);
  // Capture full objects BEFORE removing so Undo can restore them exactly as they were.
  const fileObj=allFiles.find(f=>f._id===id);
  const folderFileObj=curFolder?(curFolder.files||[]).find(f=>f._id===id):null;
  // Optimistic removal — nothing is sent to the server yet. The actual DELETE
  // only fires if the undo window expires without the user clicking Undo.
  allFiles=allFiles.filter(f=>f._id!==id);
  if(curFolder)curFolder.files=(curFolder.files||[]).filter(f=>f._id!==id);
  if(card){card.style.animation='delOut .3s var(--ease) forwards';setTimeout(()=>{card.remove();renderAll();document.getElementById('badge').textContent=`${allFiles.length} file${allFiles.length!==1?'s':''}`;},320);}
  toastUndo(`"${fname}" deleted`,
    async()=>{ // window expired — commit the real delete now
      try{
        const res=await fetch(`${API}/${id}`,{method:'DELETE'});
        if(!res.ok){const d=await res.json().catch(()=>({}));throw new Error(d.message||'Failed');}
      }catch(e){toast(e.message||'Delete failed','error');}
    },
    ()=>{ // user clicked Undo — nothing was ever sent to the server, just restore the UI
      if(fileObj)allFiles.unshift(fileObj);
      if(folderFileObj&&curFolder)curFolder.files=[folderFileObj,...(curFolder.files||[])];
      renderAll();
      if(curFolder)renderFolders();
      document.getElementById('badge').textContent=`${allFiles.length} file${allFiles.length!==1?'s':''}`;
      toast('Restored','success');
    }
  );
};
document.getElementById('delModal').addEventListener('click',e=>{if(e.target===document.getElementById('delModal')){pendingId=null;document.getElementById('delModal').classList.remove('open');}});

// ── Generic Rename modal — replaces window.prompt() for both file and folder
// rename, reusing the create-folder modal's markup/styling (same shape: a
// title + single text input + cancel/confirm).
let renameCallback=null;
function openRename(title,currentValue,onConfirm){
  document.getElementById('renameTitle').textContent=title;
  const input=document.getElementById('renameInput');
  input.value=currentValue;
  renameCallback=onConfirm;
  document.getElementById('renameModal').classList.add('open');
  setTimeout(()=>{input.focus();input.select();},60);
}
function closeRename(){document.getElementById('renameModal').classList.remove('open');renameCallback=null;}
function submitRename(){
  const val=document.getElementById('renameInput').value.trim();
  const cb=renameCallback;
  closeRename();
  if(val&&cb)cb(val);
}
document.getElementById('renameModal').addEventListener('click',e=>{if(e.target===document.getElementById('renameModal'))closeRename();});

// ── Generic Confirm modal (folder delete) — replaces window.confirm(),
// reusing the file-delete modal's markup/styling as a second, independent
// instance. Deliberately NOT sharing pendingId/state with the file-delete
// flow above — folder deletion has different semantics (no undo).
let folderDelCallback=null;
function openFolderDelConfirm(name,onConfirm){
  document.getElementById('folderDelName').textContent=name||'This folder';
  folderDelCallback=onConfirm;
  document.getElementById('folderDelModal').classList.add('open');
}
function closeFolderDelConfirm(){document.getElementById('folderDelModal').classList.remove('open');folderDelCallback=null;}
document.getElementById('folderDelCancel').onclick=closeFolderDelConfirm;
document.getElementById('folderDelConfirmBtn').onclick=()=>{
  const cb=folderDelCallback;
  closeFolderDelConfirm();
  if(cb)cb();
};
document.getElementById('folderDelModal').addEventListener('click',e=>{if(e.target===document.getElementById('folderDelModal'))closeFolderDelConfirm();});

// ── PROPERTIES — user-friendly info only, no Cloudinary details ────────────
function showProp(id){
  const f=allFiles.find(x=>x._id===id);if(!f)return;
  const type=tc(f.fileType);
  const icons={
    img:`<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    vid:`<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`,
    pdf:`<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
    zip:`<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    doc:`<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>`,
    sheet:`<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="9" y1="10" x2="9" y2="20"/><line x1="15" y1="10" x2="15" y2="20"/></svg>`,
    slide:`<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="13" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="18" x2="12" y2="21"/></svg>`,
    code:`<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
    link:`<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>`,
    file:`<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`
  };
  document.getElementById('propIcon').className=`prop-ficon fi-${type}`;
  document.getElementById('propIcon').innerHTML=icons[type]||icons.file;
  document.getElementById('propFname').textContent=f.originalName;
  document.getElementById('propFkind').textContent=typeHuman(f.fileType);
  const propDl=document.getElementById('propDl');
  if(isLink(f.fileType)){
    document.getElementById('propRows').innerHTML=`
      <div class="prop-row"><span class="prop-key">Type</span><span class="prop-val">${typeHuman(f.fileType)}</span></div>
      <div class="prop-row"><span class="prop-key">Domain</span><span class="prop-val">${esc(f.linkDomain||'')}</span></div>
      <div class="prop-row"><span class="prop-key">Added</span><span class="prop-val">${f.createdAt?new Date(f.createdAt).toLocaleString('en',{dateStyle:'medium',timeStyle:'short'}):'-'}</span></div>
    `;
    propDl.textContent='↗ Open Link';
    propDl.onclick=()=>{window.open(f.linkUrl,'_blank','noopener');closeProp();};
  }else{
    // Only show user-relevant info — no Cloudinary internals
    document.getElementById('propRows').innerHTML=`
      <div class="prop-row"><span class="prop-key">Type</span><span class="prop-val">${typeHuman(f.fileType)}</span></div>
      <div class="prop-row"><span class="prop-key">Size</span><span class="prop-val">${fmtSz(f.fileSize)}</span></div>
      <div class="prop-row"><span class="prop-key">Uploaded</span><span class="prop-val">${f.createdAt?new Date(f.createdAt).toLocaleString('en',{dateStyle:'medium',timeStyle:'short'}):'-'}</span></div>
    `;
    propDl.textContent='⬇ Download';
    propDl.onclick=()=>{dlFile(f._id,f.originalName);closeProp();};
  }
  document.getElementById('propModal').classList.add('open');
}
function closeProp(){document.getElementById('propModal').classList.remove('open');}
document.getElementById('propModal').addEventListener('click',e=>{if(e.target===document.getElementById('propModal'))closeProp();});

document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeLB();closeProp();document.getElementById('delModal').classList.remove('open');closeTokenModal();closeAtf();closeCreateFolder();closeRename();closeFolderDelConfirm();closeShortcuts();}});

// ── Keyboard shortcuts ───────────────────────────────────────────────────────
// Ignored while typing in any input/textarea (except Escape, handled above)
// so shortcuts never hijack normal typing.
const SHORTCUT_KEYS={
  '/':()=>{document.getElementById('sInput').focus();},
  'u':()=>fInput.click(),
  'n':()=>showCreateFolder(),
  'l':()=>document.getElementById('linkInput').focus(),
  't':()=>document.getElementById('tInput')?.focus(),
  '?':()=>toggleShortcuts(),
};
document.addEventListener('keydown',e=>{
  const tag=e.target.tagName;
  if(tag==='INPUT'||tag==='TEXTAREA'||e.target.isContentEditable)return;
  if(e.metaKey||e.ctrlKey||e.altKey)return; // don't intercept browser shortcuts
  const handler=SHORTCUT_KEYS[e.key];
  if(handler){e.preventDefault();handler();}
});
function toggleShortcuts(){document.getElementById('shortcutsModal').classList.toggle('open');}
function closeShortcuts(){document.getElementById('shortcutsModal').classList.remove('open');}
document.getElementById('shortcutsModal')?.addEventListener('click',e=>{if(e.target===document.getElementById('shortcutsModal'))closeShortcuts();});

// ── Toast ──────────────────────────────────────────────────────────────────
function toast(msg,type='info'){
  const el=document.createElement('div');el.className=`toast ${type}`;
  el.style.setProperty('--toast-dur','2800ms');
  el.innerHTML=`<span class="td"></span>${msg}`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(()=>{el.classList.add('out');setTimeout(()=>el.remove(),220);},2800);
}
// Like toast(), but holds an action open for a window before committing it —
// used for soft-delete: nothing destructive happens until the timer expires.
function toastUndo(msg,onExpire,onUndo,duration=5000){
  const el=document.createElement('div');el.className='toast info';
  el.style.setProperty('--toast-dur',duration+'ms');
  const btnId='u'+Math.random().toString(36).slice(2,9);
  el.innerHTML=`<span class="td"></span>${msg}<button class="toast-undo-btn" id="${btnId}">Undo</button>`;
  document.getElementById('toasts').appendChild(el);
  let settled=false;
  const timer=setTimeout(()=>{
    if(settled)return;settled=true;
    el.classList.add('out');setTimeout(()=>el.remove(),220);
    onExpire();
  },duration);
  document.getElementById(btnId).onclick=()=>{
    if(settled)return;settled=true;clearTimeout(timer);
    el.classList.add('out');setTimeout(()=>el.remove(),220);
    onUndo();
  };
}
function fmtSz(b){if(!b)return'–';if(b<1024)return b+'B';if(b<1048576)return(b/1024).toFixed(1)+'KB';return(b/1048576).toFixed(1)+'MB'}
function fmtDt(d){if(!d)return'';return new Date(d).toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric'})}
function esc(s){return(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;').replace(/</g,'&lt;')}
function isRecent(d){return d&&(Date.now()-new Date(d).getTime())<10*60*1000;} // uploaded in the last 10 minutes
// Display-only helpers — the real filename (with extension) is always kept
// for downloads/storage; only what's SHOWN to the user drops the extension.
function getExt(name){if(!name)return'';const i=name.lastIndexOf('.');return i>0?name.slice(i):'';}
function stripExt(name){if(!name)return name;const i=name.lastIndexOf('.');return i>0?name.slice(0,i):name;}

async function accessByToken(){
  const input=document.getElementById('tInput');
  const btn=document.getElementById('tBtn');
  const token=input.value.trim();
  if(!token)return toast('Paste a token first','error');
  btn.textContent='…';btn.disabled=true;
  try{
    let res=await fetch(`${API}/token/${token}`);
    if(res.ok){const d=await res.json();input.value='';openTokenModal(d.file,'file');return;}
    res=await fetch(`${FOLDERS_API}/token/${token}`);
    if(res.ok){const d=await res.json();input.value='';openTokenModal(d.folder,'folder');return;}
    toast('No file or folder found for this token','error');
  }catch{toast('Network error — check your connection','error');}
  finally{btn.textContent='Access →';btn.disabled=false;}
}
function openTokenModal(data,kind){
  const hd=document.getElementById('tmodalHead');
  const bd=document.getElementById('tmodalBody');
  const ft=document.getElementById('tmodalFoot');
  if(kind==='file'){
    const f=data;
    const t=tc(f.fileType);
    const canP=isImg(f.fileType)||isVid(f.fileType)||isPdf(f.fileType);
    const bgMap={img:'var(--blus)',vid:'rgba(0,0,0,.07)',pdf:'var(--reds)',zip:'var(--ylws)',doc:'var(--cyns)',sheet:'var(--tels)',slide:'var(--orgs)',code:'var(--cods)',link:'var(--pnks)',file:'var(--bg2)'};
    const stMap={img:'var(--blu)',vid:'var(--t2)',pdf:'var(--red)',zip:'var(--ylw)',doc:'var(--cyn)',sheet:'var(--tel)',slide:'var(--org)',code:'var(--cod)',link:'var(--pnk)',file:'var(--t3)'};
    const svgMap={
      img:`<svg viewBox="0 0 24 24" fill="none" stroke="${stMap[t]}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
      vid:`<svg viewBox="0 0 24 24" fill="none" stroke="${stMap[t]}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`,
      pdf:`<svg viewBox="0 0 24 24" fill="none" stroke="${stMap[t]}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
      zip:`<svg viewBox="0 0 24 24" fill="none" stroke="${stMap[t]}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
      doc:`<svg viewBox="0 0 24 24" fill="none" stroke="${stMap[t]}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>`,
      sheet:`<svg viewBox="0 0 24 24" fill="none" stroke="${stMap[t]}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="9" y1="10" x2="9" y2="20"/><line x1="15" y1="10" x2="15" y2="20"/></svg>`,
      slide:`<svg viewBox="0 0 24 24" fill="none" stroke="${stMap[t]}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="13" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="18" x2="12" y2="21"/></svg>`,
      code:`<svg viewBox="0 0 24 24" fill="none" stroke="${stMap[t]}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
      link:`<svg viewBox="0 0 24 24" fill="none" stroke="${stMap[t]}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>`,
      file:`<svg viewBox="0 0 24 24" fill="none" stroke="${stMap[t]}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`
    };
    const v=f.visibility||'public';
    hd.innerHTML=`<div class="tmodal-ico" style="background:${bgMap[t]||bgMap.file}">${svgMap[t]||svgMap.file}</div><div class="tmodal-head-info"><div class="tmodal-title" title="${esc(f.originalName)}">${esc(stripExt(f.originalName))}</div><div class="tmodal-sub">${typeHuman(f.fileType)}<span class="vis-badge vis-${v==='public'?'pub':'priv'}">${v==='public'?'Public':'Private'}</span></div></div>`;
    bd.innerHTML=isLink(f.fileType)
      ?`<div class="prop-row"><span class="prop-key">Domain</span><span class="prop-val">${esc(f.linkDomain||'')}</span></div><div class="prop-row"><span class="prop-key">Type</span><span class="prop-val">${typeHuman(f.fileType)}</span></div><div class="prop-row"><span class="prop-key">Added</span><span class="prop-val">${f.createdAt?new Date(f.createdAt).toLocaleString('en',{dateStyle:'medium',timeStyle:'short'}):'-'}</span></div>`
      :`<div class="prop-row"><span class="prop-key">Size</span><span class="prop-val">${fmtSz(f.fileSize)}</span></div><div class="prop-row"><span class="prop-key">Type</span><span class="prop-val">${typeHuman(f.fileType)}</span></div><div class="prop-row"><span class="prop-key">Uploaded</span><span class="prop-val">${f.createdAt?new Date(f.createdAt).toLocaleString('en',{dateStyle:'medium',timeStyle:'short'}):'-'}</span></div>`;
    const primaryTmodBtn=isLink(f.fileType)
      ?`<button class="tmod-act tmod-dl" title="Open Link" onclick="window.open('${esc(f.linkUrl)}','_blank','noopener')"><svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>`
      :`<button class="tmod-act tmod-dl" title="Download" onclick="dlFile('${f._id}','${esc(f.originalName)}')"><svg viewBox="0 0 24 24"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0018 9h-1.26A8 8 0 103 16.29"/></svg></button>`;
    ft.innerHTML=`${primaryTmodBtn}${f.visibility==='private'?`<button class="tmod-act" title="Manage Sharing" onclick="openSharePanel('file')"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 10v6M4.22 4.22l4.24 4.24m7.08 7.08l4.24 4.24M1 12h6m10 0h6M4.22 19.78l4.24-4.24m7.08-7.08l4.24-4.24"/></svg></button><div class="tmod-sep"></div><button class="tmod-act tmod-pub" title="Make Public" onclick="makeFilePublic('${f._id}')"><svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 019.9-1"/></svg></button><button class="tmod-act tmod-del" title="Delete File" onclick="delFileFromModal('${f._id}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg></button>`:''}` ;
    // Store in tokenModalFile so openPrev can access private file data without polluting allFiles
    tokenModalFile=f;
  }else{
    const folder=data;
    // Defensive filter: backend populate match already excludes private files,
    // but we filter again here in case of any stale cached data.
    const files=(folder.files||[]).filter(x=>(x.visibility||'public')!=='private');
    hd.innerHTML=`<div class="tmodal-ico" style="background:var(--ylws)"><svg viewBox="0 0 24 24" fill="none" stroke="var(--ylw)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></div><div class="tmodal-head-info"><div class="tmodal-title">${esc(folder.name)}</div><div class="tmodal-sub">${files.length} file${files.length!==1?'s':''}<span class="vis-badge vis-${folder.visibility==='public'?'pub':'priv'}">${folder.visibility==='public'?'Public':'Private'}</span></div></div>`;
    bd.innerHTML=files.length
      ?`<div class="tmodal-file-list">${files.map(f=>`<div class="tmodal-file-row"><span class="tmodal-file-name" title="${esc(f.originalName)}">${esc(stripExt(f.originalName))}</span><span class="tmodal-file-meta">${isLink(f.fileType)?esc(f.linkDomain||'Link'):fmtSz(f.fileSize)}</span><button class="tmodal-dl-btn" onclick="${isLink(f.fileType)?`window.open('${esc(f.linkUrl)}','_blank','noopener')`:`dlFile('${f._id}','${esc(f.originalName)}')`}" title="${isLink(f.fileType)?'Open Link':'Download'}">${isLink(f.fileType)?`<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`:`<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/></svg>`}</button></div>`).join('')}</div>`
      :`<div style="text-align:center;padding:24px;color:var(--t3);font-size:14px">This folder is empty</div>`;
    ft.innerHTML=`${files.length?`<button class="tmod-act" title="Download All as ZIP" onclick="downloadFolderZipFromModal()"><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>`:''}${folder.visibility==='private'?`<button class="tmod-act" title="Manage Sharing" onclick="openSharePanel('folder')"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 10v6M4.22 4.22l4.24 4.24m7.08 7.08l4.24 4.24M1 12h6m10 0h6M4.22 19.78l4.24-4.24m7.08-7.08l4.24-4.24"/></svg></button><div class="tmod-sep"></div><button class="tmod-act tmod-pub" title="Make Folder Public" onclick="makeFolderPublic('${folder._id}')"><svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 019.9-1"/></svg></button><button class="tmod-act tmod-del" title="Delete Folder" onclick="delFolderFromModal('${folder._id}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg></button>`:''}`;
    tokenModalFolder=folder; // store so delFolderFromModal can read folder name
  }
  document.getElementById('tokenModal').classList.add('open');
}
// Opens the same reveal-style panel used right after going private, but on-demand —
// reads from tokenModalFile/tokenModalFolder (already populated by openTokenModal),
// so it always reflects the CURRENT token + expiry, not a stale snapshot.
function fmtExpiryStatus(expiresAt){
  if(!expiresAt)return'Never';
  const diff=new Date(expiresAt)-new Date();
  if(diff<=0)return'Expired';
  const hrs=diff/3600000;
  return hrs<24?`${Math.round(hrs)}h left`:`${Math.round(hrs/24)}d left`;
}
function openSharePanel(type){
  const item=type==='folder'?tokenModalFolder:tokenModalFile;
  if(!item)return;
  // Close the Token Modal first — otherwise it stacks underneath privRevealModal
  // (double backdrop, confusing to dismiss). `item` is already captured above.
  document.getElementById('tokenModal').classList.remove('open');
  tokenModalFile=null;tokenModalFolder=null;
  privRevealCtx={id:item._id,type};
  document.getElementById('prm-title').textContent=type==='folder'?'Manage Folder Sharing':'Manage File Sharing';
  document.getElementById('prm-sub').textContent="Update this token\'s expiry, or share it again";
  document.getElementById('prm-token').textContent=item.shareToken||'';
  document.getElementById('prm-expiry-status').textContent=fmtExpiryStatus(item.tokenExpiresAt);
  document.getElementById('privRevealModal').classList.add('open');
}
function downloadFolderZipFromModal(){
  if(!tokenModalFolder)return;
  const id=tokenModalFolder._id;
  const url=tokenModalFolder.visibility==='private'
    ?`${FOLDERS_API}/${id}/zip?token=${tokenModalFolder.shareToken}`
    :`${FOLDERS_API}/${id}/zip`;
  const a=document.createElement('a');a.href=url;document.body.appendChild(a);a.click();document.body.removeChild(a);
  toast('Preparing ZIP…','info');
}
function closeTokenModal(){
  document.getElementById('tokenModal').classList.remove('open');
  tokenModalFile=null;
  tokenModalFolder=null;
}
// ── Section switching ──────────────────────────────────────────────────────
function switchSection(sec){
  curSection=sec;
  document.getElementById('filesSection').style.display=sec==='files'?'':'none';
  document.getElementById('foldersSection').style.display=sec==='folders'?'':'none';
  document.getElementById('tab-files').classList.toggle('active',sec==='files');
  document.getElementById('tab-folders').classList.toggle('active',sec==='folders');
  if(sec==='folders')loadFolders();
  if(sec==='files'){curFolder=null;folderCtx=null;}
}
// ── Load + render folders ─────────────────────────────────────────────────
async function loadFolders(){
  try{
    const res=await fetch(FOLDERS_API);
    if(!res.ok)throw new Error();
    const d=await res.json();
    allFolders=d.folders;
    renderFolders();
  }catch{toast('Could not load folders','error');}
}
function renderFolders(){
  const grid=document.getElementById('folderGrid');
  const crumb=document.getElementById('folderCrumb');
  const btnNew=document.getElementById('btnNewFolder');
  const searchInput=document.getElementById('folderSearchInput');
  const btnZip=document.getElementById('btnDownloadAllZip');
  if(curFolder){
    // Defensive filter: backend already excludes private files via populate match,
    // but we filter again here in case of any stale cached data.
    const files=(curFolder.files||[]).filter(x=>(x.visibility||'public')!=='private');
    crumb.innerHTML=`<button class="crumb-back" onclick="backToFolders()"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg></button><span class="crumb-sep">Folders</span><span style="color:var(--t3);margin:0 4px">/</span><span>${esc(curFolder.name)}</span>`;
    btnNew.style.display='none';
    searchInput.style.display='none'; // searching folder names doesn't apply once you're inside one
    btnZip.style.display=files.length?'':'none';
    folderCtx=curFolder._id;
    if(!files.length){
      grid.className='';
      grid.innerHTML=`<div class="folder-empty"><div class="empty-ico"><svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></div><p>This folder is empty.<br>Add files from the <strong>Files</strong> tab.</p></div>`;
    }else{
      grid.className=curV==='grid'?'grid':'list';
      grid.innerHTML='';
      files.forEach((f,i)=>grid.appendChild(curV==='grid'?mkGrid(f,i):mkList(f,i)));
    }
  }else{
    crumb.textContent='All Folders';
    btnNew.style.display='';
    searchInput.style.display='';
    btnZip.style.display='none';
    folderCtx=null;
    const q=folderSearchQ.toLowerCase();
    const visibleFolders=q?allFolders.filter(f=>f.name.toLowerCase().includes(q)):allFolders;
    if(!allFolders.length){
      grid.className='';
      grid.innerHTML=`<div class="folder-empty"><div class="empty-ico"><svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></div><p>No folders yet.<br>Hit <strong>+ New Folder</strong> to create one.</p></div>`;
    }else if(!visibleFolders.length){
      grid.className='';
      grid.innerHTML=`<div class="folder-empty"><div class="empty-ico"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div><p>No folders match "${esc(folderSearchQ)}".</p></div>`;
    }else{
      grid.className='fol-grid';
      grid.innerHTML='';
      visibleFolders.forEach((f,i)=>grid.appendChild(mkFolderCard(f,i)));
    }
  }
}
function downloadCurFolderZip(){
  if(!curFolder)return;
  const url=curFolder.visibility==='private'
    ?`${FOLDERS_API}/${curFolder._id}/zip?token=${curFolder.shareToken}`
    :`${FOLDERS_API}/${curFolder._id}/zip`;
  const a=document.createElement('a');a.href=url;document.body.appendChild(a);a.click();document.body.removeChild(a);
  toast('Preparing ZIP…','info');
}
function mkFolderCard(f,i){
  const cnt=f.fileCount!==undefined?f.fileCount:(f.files?f.files.length:0);
  const d=document.createElement('div');
  d.className='fol-card';d.id=`folder-${f._id}`;d.style.animationDelay=`${i*.05}s`;
  d.innerHTML=`
    <div class="fol-top">
      <div class="fol-ico-wrap">
        <div class="fol-ico"><svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></div>
        ${cnt>0?`<span class="fol-count">${cnt>99?'99+':cnt}</span>`:''}
      </div>
      <div class="fol-info">
        <div class="fol-name">${esc(f.name)}</div>
        <div class="fol-meta"><span>${cnt} file${cnt!==1?'s':''}</span><span class="vis-badge vis-${f.visibility==='public'?'pub':'priv'}">${f.visibility==='public'?'Public':'Private'}</span></div>
      </div>
    </div>
    <div class="cact-row" style="padding:8px 14px 12px">
      <button class="cact" title="Open folder" onclick="openFolder('${f._id}')"><svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></button>
      <button class="cact" title="Copy Token" onclick="copyToken('${f.shareToken||''}')"><svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg></button>
      <button class="cact" title="Rename" onclick="renameFolderPr('${f._id}','${esc(f.name)}')"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
      <div class="cact-sep"></div>
      <button class="cact cact-vis-${f.visibility==='public'?'pub':'priv'}" title="${f.visibility==='public'?'Make private':'Click to make public'}" onclick="toggleFolderVis('${f._id}','${f.visibility||'public'}')">${f.visibility==='public'?'<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>':'<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>'}</button>
      <button class="cact cact-del" title="Delete folder" onclick="delFolderConfirm('${f._id}','${esc(f.name)}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg></button>
    </div>`;
  return d;
}
async function openFolder(id){
  try{
    // Pass shareToken so backend allows owner access to private folders
    const meta=allFolders.find(f=>f._id===id);
    const url=meta?.shareToken?`${FOLDERS_API}/${id}?token=${meta.shareToken}`:`${FOLDERS_API}/${id}`;
    const res=await fetch(url);
    if(!res.ok)throw new Error();
    const d=await res.json();
    curFolder=d.folder;
    renderFolders();
  }catch{toast('Could not open folder','error');}
}
function backToFolders(){curFolder=null;folderCtx=null;renderFolders();}
// ── Create folder ─────────────────────────────────────────────────────────
function showCreateFolder(){
  document.getElementById('cfModal').classList.add('open');
  setTimeout(()=>document.getElementById('cfInput').focus(),60);
}
function closeCreateFolder(){
  document.getElementById('cfModal').classList.remove('open');
  document.getElementById('cfInput').value='';
}
async function submitCreateFolder(){
  const name=document.getElementById('cfInput').value.trim();
  if(!name)return toast('Enter a folder name','error');
  const btn=document.getElementById('cfSubmit');
  btn.textContent='…';btn.disabled=true;
  try{
    const res=await fetch(FOLDERS_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
    if(!res.ok)throw new Error();
    const d=await res.json();
    allFolders.unshift(d.folder);
    closeCreateFolder();
    renderFolders();
    toast(`"${name}" created!`,'success');
  }catch{toast('Failed to create folder','error');}
  finally{btn.textContent='Create';btn.disabled=false;}
}
// ── Rename + delete folder ────────────────────────────────────────────────
async function renameFolderPr(id,currentName){
  openRename('Rename Folder',currentName,async(name)=>{
    if(name===currentName)return;
    try{
      const res=await fetch(`${FOLDERS_API}/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
      if(!res.ok)throw new Error();
      const f=allFolders.find(x=>x._id===id);if(f)f.name=name;
      if(curFolder&&curFolder._id===id)curFolder.name=name;
      renderFolders();toast('Renamed!','success');
    }catch{toast('Rename failed','error');}
  });
}
async function delFolderConfirm(id,name){
  openFolderDelConfirm(name,async()=>{
    try{
      const res=await fetch(`${FOLDERS_API}/${id}`,{method:'DELETE'});
      if(!res.ok)throw new Error();
      allFolders=allFolders.filter(f=>f._id!==id);
      if(curFolder&&curFolder._id===id){curFolder=null;folderCtx=null;}
      renderFolders();
      // Reload files: deleted folder's files had folderId set; they now need to
      // re-appear in the gallery (backend already set their folderId to null).
      await loadFiles();
      toast('Folder deleted','success');
    }catch{toast('Delete failed','error');}
  });
}
// ── Remove from folder (when in folder detail view) ───────────────────────
async function removeFromFolder(folderId,fileId){
  try{
    const res=await fetch(`${FOLDERS_API}/${folderId}/files/${fileId}`,{method:'DELETE'});
    if(!res.ok)throw new Error();
    const file=allFiles.find(f=>f._id===fileId);if(file)file.folderId=null;
    if(curFolder&&curFolder._id===folderId)curFolder.files=curFolder.files.filter(f=>f._id!==fileId);
    const folder=allFolders.find(f=>f._id===folderId);
    if(folder&&folder.fileCount>0)folder.fileCount--;
    renderFolders();toast('Removed from folder','success');
  }catch{toast('Failed to remove','error');}
}
// ── ATF modal (Add to Folder picker) ─────────────────────────────────────
async function showAtf(fileId){
  atfFileId=fileId;
  if(!allFolders.length){
    try{const res=await fetch(FOLDERS_API);if(res.ok){const d=await res.json();allFolders=d.folders;}}catch{}
  }
  renderAtf();
  document.getElementById('atfModal').classList.add('open');
}
function closeAtf(){document.getElementById('atfModal').classList.remove('open');atfFileId=null;}
document.getElementById('atfModal').addEventListener('click',e=>{if(e.target===document.getElementById('atfModal'))closeAtf();});
document.getElementById('cfModal').addEventListener('click',e=>{if(e.target===document.getElementById('cfModal'))closeCreateFolder();});
function renderAtf(){
  const body=document.getElementById('atfBody');
  const file=allFiles.find(f=>f._id===atfFileId);
  if(!allFolders.length){
    body.innerHTML=`<div class="atf-empty">No folders yet.<br>Create one first from the <strong>Folders</strong> tab.</div>`;
    return;
  }
  body.innerHTML=allFolders.map(folder=>{
    const inThis=file&&file.folderId&&file.folderId===folder._id;
    const cnt=folder.fileCount!==undefined?folder.fileCount:(folder.files?folder.files.length:0);
    const btn=inThis
      ?`<button class="atf-item-btn atf-btn-rm" onclick="doRemoveFromFolder('${folder._id}')">Remove</button>`
      :`<button class="atf-item-btn atf-btn-add" onclick="doAddToFolder('${folder._id}')">Add</button>`;
    return`<div class="atf-item"><div class="atf-item-ico"><svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></div><div class="atf-item-info"><div class="atf-item-name">${esc(folder.name)}</div><div class="atf-item-count">${cnt} file${cnt!==1?'s':''}</div></div>${btn}</div>`;
  }).join('');
}
async function doAddToFolder(folderId){
  const fileId=atfFileId;
  try{
    const res=await fetch(`${FOLDERS_API}/${folderId}/files`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fileId})});
    if(!res.ok)throw new Error();
    const file=allFiles.find(f=>f._id===fileId);if(file)file.folderId=folderId;
    const folder=allFolders.find(f=>f._id===folderId);
    if(folder)folder.fileCount=(folder.fileCount||0)+1;
    closeAtf();reRenderCard(fileId);toast('Added to folder!','success');
  }catch{toast('Failed to add','error');}
}
async function doRemoveFromFolder(folderId){
  const fileId=atfFileId;
  try{
    const res=await fetch(`${FOLDERS_API}/${folderId}/files/${fileId}`,{method:'DELETE'});
    if(!res.ok)throw new Error();
    const file=allFiles.find(f=>f._id===fileId);if(file)file.folderId=null;
    const folder=allFolders.find(f=>f._id===folderId);
    if(folder&&folder.fileCount>0)folder.fileCount--;
    closeAtf();reRenderCard(fileId);toast('Removed from folder','success');
  }catch{toast('Failed to remove','error');}
}
function reRenderCard(id){
  const f=allFiles.find(x=>x._id===id);if(!f)return;
  const old=document.getElementById(`card-${id}`);if(!old)return;
  const card=curV==='grid'?mkGrid(f,0):mkList(f,0);
  card.style.animation='none';
  old.replaceWith(card);
}
async function copyToken(token){
  if(!token)return toast('Token not available — try refreshing','error');
  try{
    await navigator.clipboard.writeText(token);
    toast('Token copied to clipboard ✓','success');
  }catch{
    const ta=document.createElement('textarea');
    ta.value=token;ta.style.cssText='position:fixed;left:-9999px;opacity:0';
    document.body.appendChild(ta);ta.select();
    try{document.execCommand('copy');toast('Token copied ✓','success');}
    catch{toast('Token: '+token,'info');}
    document.body.removeChild(ta);
  }
}
async function toggleVis(id,currentVis){
  if(currentVis!=='public')return;
  try{
    const res=await fetch(`${API}/${id}/visibility`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({visibility:'private'})});
    if(!res.ok)throw new Error('Server error: '+res.status);
    const d=await res.json();
    // Use the token from the SERVER response — this is the authoritative token
    // stored in MongoDB, not a potentially stale value from the frontend state.
    const token=d.file?.shareToken||'';
    if(!token){toast('Token missing — contact support','error');return;}
    // Remove from allFiles so it never re-renders in the gallery
    allFiles=allFiles.filter(x=>x._id!==id);
    const card=document.getElementById(`card-${id}`);
    if(card){card.style.animation='delOut .3s var(--ease) forwards';setTimeout(()=>{card.remove();const n=allFiles.length;document.getElementById('badge').textContent=`${n} file${n!==1?'s':''}`;},320);}
    // Show token reveal popup + auto-copy
    privRevealCtx={id,type:'file'};
    document.getElementById('prm-title').textContent='File is now Private 🔒';
    document.getElementById('prm-sub').textContent="Save this token — it\'s the only way to access this file";
    document.getElementById('prm-token').textContent=token;
    document.getElementById('prm-expiry-status').textContent='Never';
    document.getElementById('privRevealModal').classList.add('open');
    try{await navigator.clipboard.writeText(token);}catch{/* user can copy manually */}
  }catch(e){toast(e.message||'Failed to update visibility','error');}
}

function copyPrivToken(){
  const token=document.getElementById('prm-token').textContent;
  if(!token)return;
  navigator.clipboard.writeText(token).then(()=>toast('Token copied ✓','success')).catch(()=>toast('Token: '+token,'info'));
}
function fmtExpiry(minutes){
  if(!minutes||minutes<=0)return'never';
  if(minutes<60)return`${minutes}m`;
  if(minutes<1440)return`${Math.round(minutes/60)}h`;
  return`${Math.round(minutes/1440)}d`;
}
async function setPrivExpiry(minutes){
  if(!privRevealCtx.id)return;
  const apiBase=privRevealCtx.type==='folder'?FOLDERS_API:API;
  try{
    const res=await fetch(`${apiBase}/${privRevealCtx.id}/visibility`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({visibility:'private',expiresIn:minutes})});
    if(!res.ok)throw new Error();
    const d=await res.json();
    const newExpiry=(d.file||d.folder)?.tokenExpiresAt??null;
    // Defensive: keep any still-cached references in sync, in case some future
    // code path reads them without a fresh fetch first.
    if(tokenModalFile&&tokenModalFile._id===privRevealCtx.id)tokenModalFile.tokenExpiresAt=newExpiry;
    if(tokenModalFolder&&tokenModalFolder._id===privRevealCtx.id)tokenModalFolder.tokenExpiresAt=newExpiry;
    if(curFolder&&curFolder._id===privRevealCtx.id)curFolder.tokenExpiresAt=newExpiry;
    document.getElementById('prm-expiry-status').textContent=minutes>0?`${fmtExpiry(minutes)} left`:'Never';
    toast(minutes>0?`Token now expires in ${fmtExpiry(minutes)}`:'Token will never expire','success');
  }catch{toast('Failed to update expiry','error');}
}
async function regenPrivToken(){
  if(!privRevealCtx.id)return;
  const apiBase=privRevealCtx.type==='folder'?FOLDERS_API:API;
  try{
    const res=await fetch(`${apiBase}/${privRevealCtx.id}/visibility`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({visibility:'private',regenerateToken:true})});
    if(!res.ok)throw new Error();
    const d=await res.json();
    const item=d.file||d.folder;
    if(!item?.shareToken){toast('Server did not return a new token','error');return;}
    document.getElementById('prm-token').textContent=item.shareToken;
    // Defensive: keep any still-cached references in sync, in case some future
    // code path reads them without a fresh fetch first.
    if(tokenModalFile&&tokenModalFile._id===privRevealCtx.id)tokenModalFile.shareToken=item.shareToken;
    if(tokenModalFolder&&tokenModalFolder._id===privRevealCtx.id)tokenModalFolder.shareToken=item.shareToken;
    if(curFolder&&curFolder._id===privRevealCtx.id)curFolder.shareToken=item.shareToken;
    try{await navigator.clipboard.writeText(item.shareToken);}catch{}
    toast('New token generated & copied — the old one no longer works','success');
  }catch{toast('Failed to regenerate token','error');}
}
function copyPrivLink(){
  const token=document.getElementById('prm-token').textContent;
  if(!token)return;
  const link=`${window.location.origin}${window.location.pathname}?token=${token}`;
  navigator.clipboard.writeText(link).then(()=>toast('Link copied ✓ — opening it auto-fills the token','success')).catch(()=>toast('Link: '+link,'info'));
}
async function toggleFolderVis(id,currentVis){
  if(currentVis!=='public')return;
  try{
    const res=await fetch(`${FOLDERS_API}/${id}/visibility`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({visibility:'private'})});
    if(!res.ok)throw new Error('Server error: '+res.status);
    const d=await res.json();
    const token=d.folder?.shareToken||'';
    if(!token){toast('Token missing — contact support','error');return;}
    allFolders=allFolders.filter(x=>x._id!==id);
    if(curFolder&&curFolder._id===id){curFolder=null;folderCtx=null;}
    // Also remove this folder's files from the gallery immediately
    allFiles=allFiles.filter(f=>!f.folderId||f.folderId.toString()!==id);
    renderFolders();renderAll();
    privRevealCtx={id,type:'folder'};
    document.getElementById('prm-title').textContent='Folder is now Private 🔒';
    document.getElementById('prm-sub').textContent="Save this token — it\'s the only way to access this folder";
    document.getElementById('prm-token').textContent=token;
    document.getElementById('prm-expiry-status').textContent='Never';
    document.getElementById('privRevealModal').classList.add('open');
    try{await navigator.clipboard.writeText(token);}catch{/* user can copy manually */}
  }catch(e){toast(e.message||'Failed to update folder visibility','error');}
}

// ── Private file / folder management (called from token modal) ───────────
// Delete a private file — uses existing delModal for confirmation UX
function delFileFromModal(id){
  const name=tokenModalFile?.originalName||'This file';
  closeTokenModal(); // clears both tokenModalFile and tokenModalFolder
  setTimeout(()=>delFile(id,name),150);
}
// Restore a private file to public — adds it back to allFiles and re-renders gallery
async function renameFilePr(id,currentName){
  // The extension is preserved silently — the user only ever sees/types the base name.
  const ext=getExt(currentName);
  const base=stripExt(currentName);
  openRename('Rename File',base,async(newBase)=>{
    if(newBase===base)return;
    const fullName=newBase+ext;
    try{
      const res=await fetch(`${API}/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:fullName})});
      if(!res.ok)throw new Error();
      const f1=allFiles.find(x=>x._id===id);if(f1)f1.originalName=fullName;
      if(curFolder){const f2=(curFolder.files||[]).find(x=>x._id===id);if(f2)f2.originalName=fullName;}
      renderAll();
      if(curFolder)renderFolders();
      toast('Renamed!','success');
    }catch{toast('Rename failed','error');}
  });
}
async function makeFilePublic(id){
  try{
    const res=await fetch(`${API}/${id}/visibility`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({visibility:'public'})});
    if(!res.ok)throw new Error();
    // Use loadFiles() — the server is the single source of truth.
    // This correctly handles the edge case where the file's parent folder is private
    // (getAllFiles would exclude it; manual allFiles.unshift would wrongly show it).
    closeTokenModal();
    toast('File is now public ✓','success');
    await loadFiles();
  }catch{toast('Failed to make public','error');}
}
// Delete a folder from token modal — files inside stay in vault, just unlinked
function delFolderFromModal(id){
  const name=tokenModalFolder?.name||'This folder';
  closeTokenModal();
  setTimeout(()=>delFolderConfirm(id,name),150);
}
// Restore a private folder to public — reloads the folders list
async function makeFolderPublic(id){
  try{
    const res=await fetch(`${FOLDERS_API}/${id}/visibility`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({visibility:'public'})});
    if(!res.ok)throw new Error();
    closeTokenModal();
    // Reload both: folders list + gallery (folder's files now need to appear)
    await Promise.all([loadFolders(),loadFiles()]);
    toast('Folder is now public ✓','success');
  }catch{toast('Failed to make folder public','error');}
}

loadFiles();

// ── Token deep-link: ?token=XXXX in the URL auto-fills and triggers access ──
// Generated by "Copy shareable link" in the private-reveal popup — same token
// system underneath, just a convenience so the recipient doesn't have to
// manually copy-paste the raw token into the input box.
(function(){
  const t=new URLSearchParams(window.location.search).get('token');
  if(!t)return;
  const input=document.getElementById('tInput');
  if(input)input.value=t;
  setTimeout(()=>accessByToken(),350);
})();
