import { boot, db, mkFile, mkFolder, PROJECT } from "./harness.mjs";
import fs from "fs";
import path from "path";

let pass = 0, fail = 0; const failures = [];
const ok = (cond, name, extra = "") => { if (cond) { pass++; console.log("  ✓", name); } else { fail++; failures.push(name); console.log("  ✗", name, extra); } };
const section = (t) => console.log("\n" + t);
const reset = () => { db.files.clear(); db.folders.clear(); db.log.length = 0; };
const TOKEN_RE = /^[0-9a-z]{6}$/;
const shares = (S) => JSON.parse(S.w.localStorage.getItem("cv-my-shares") || "[]");
const toastText = (S) => S.$$("#toasts .toast").map((t) => t.textContent).join(" | ");
const hit = (re) => db.log.filter((l) => re.test(l));

// ───────────────────────── S0: boot ─────────────────────────
section("S0  Page boots cleanly and renders");
reset();
const A = mkFile({ originalName: "report.pdf", fileType: "application/pdf" });
const B = mkFile({ originalName: "notes.txt", fileType: "text/plain" });
const F1 = mkFolder({ name: "Docs" });
const P1 = mkFolder({ name: "Secret stash", visibility: "private" });
const C = mkFile({ originalName: "hidden-in-private.png", folderId: P1._id }); P1.files.push(C._id);
let S = await boot();
ok(S.errors.length === 0, "no uncaught JS errors on load", S.errors.join(" // "));
ok(S.$("#badge").textContent.includes("2 files"), "gallery shows the 2 public files (file inside a private folder stays hidden)", S.$("#badge").textContent);
ok(!!S.$("#mySharesBtn"), "My Shares button is in the nav bar");
const note = S.$("#mySharesModal .ms-note").textContent;
ok(/your own files and folders/i.test(note) && /this browser only/i.test(note) && /only to you/i.test(note) && /cache/i.test(note), "privacy note present: own files only / this browser only / only visible to you / cleared with cache", note);

// ───────────────────────── S1: make private -> 6-char token -> My Shares ─────────────────────────
section("S1  Making a file private: 6-char token + saved to My Shares");
await S.ev(`toggleVis('${A._id}','public')`); await S.tick(40);
ok(db.files.get(A._id).visibility === "private", "server marked file private");
const tokA = db.files.get(A._id).shareToken;
ok(TOKEN_RE.test(tokA), `token is 6 lowercase-alnum chars (${tokA})`);
ok(S.$("#privRevealModal").classList.contains("open"), "reveal modal opened");
ok(S.$("#prm-token").textContent === tokA, "reveal modal shows the token");
let sh = shares(S);
ok(sh.length === 1 && sh[0].id === A._id && sh[0].token === tokA && sh[0].name === "report.pdf" && sh[0].type === "file" && sh[0].encrypted === false, "saved to localStorage with id/name/token/type", JSON.stringify(sh));
ok(/My Shares/.test(toastText(S)), "one-time hint toast explains where to find it");
ok(S.w.localStorage.getItem("cv-shares-hint") === "1", "hint flag stored so it only shows once");
ok(!S.$$("#gallery .card, #fc .card").some((c) => c.id === `card-${A._id}`), "file no longer in the public gallery");

// ───────────────────────── S2: My Shares panel ─────────────────────────
section("S2  My Shares panel UI");
S.$("#privRevealModal").classList.remove("open");
await S.ev("openMyShares()");
ok(S.$("#mySharesModal").classList.contains("open"), "modal opens");
ok(S.$$("#msBody .ms-item").length === 1, "lists the saved item");
ok(S.$("#msBody .ms-name").textContent === "report.pdf" && S.$("#msBody .ms-token").textContent === tokA, "shows name + token");
ok(S.$("#msFoot").style.display === "flex", "Clear-list footer visible when there are items");
S.$$("#msBody .ms-btn")[0].click(); await S.tick(10);
ok(S.clip.text === tokA, "Copy token → clipboard has the token", S.clip.text);
S.$$("#msBody .ms-btn")[1].click(); await S.tick(10);
ok(S.clip.text === `http://localhost:3000/app?token=${tokA}`, "Copy link → full ?token= link", S.clip.text);
S.w.document.dispatchEvent(new S.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
ok(!S.$("#mySharesModal").classList.contains("open"), "Escape closes it");
await S.ev("openMyShares()");
S.$("#mySharesModal").dispatchEvent(new S.w.MouseEvent("click", { bubbles: true }));
ok(!S.$("#mySharesModal").classList.contains("open"), "clicking the backdrop closes it");

// ───────────────────────── S3: private-item settings use the token ─────────────────────────
section("S3  Expiry / max-views / regenerate on a private file (token must ride along)");
db.log.length = 0;
await S.ev(`privRevealCtx={id:'${A._id}',type:'file',encrypted:false};document.getElementById('prm-token').textContent='${tokA}';`);
await S.ev(`setPrivMaxViews(5)`); await S.tick(40);
ok(hit(new RegExp(`PATCH /api/files/${A._id}/visibility\\?token=${tokA}`)).length === 1, "max-views request carried ?token=");
ok(db.files.get(A._id).maxViews === 5, "server applied max views = 5");
await S.ev(`setPrivExpiry(60)`); await S.tick(40);
ok(db.files.get(A._id).tokenExpiresAt !== null, "server applied expiry");
await S.ev(`regenPrivToken()`); await S.tick(60);
const tokA2 = db.files.get(A._id).shareToken;
ok(tokA2 !== tokA && TOKEN_RE.test(tokA2), `regenerated to a NEW 6-char token (${tokA} → ${tokA2})`);
ok(S.$("#prm-token").textContent === tokA2, "reveal modal updated to the new token");
ok(shares(S)[0].token === tokA2, "My Shares entry refreshed to the new token", JSON.stringify(shares(S)));

// ───────────────────────── S4: access by typed token ─────────────────────────
section("S4  Typing a token by hand (caps/spaces forgiven)");
db.log.length = 0;
S.$("#tInput").value = `  ${tokA2.toUpperCase()}  `;
await S.ev("accessByToken()"); await S.tick(60);
ok(hit(new RegExp(`GET /api/files/token/${tokA2}$`)).length === 1, "sent the trimmed, lowercased token");
ok(S.$("#tokenModal")?.classList.contains("open") || /report\.pdf/.test(S.$("#tmodalHead")?.textContent || ""), "token modal opened for the file");

// ───────────────────────── S5: delete a private file from its modal (regression) ─────────────────────────
section("S5  Delete a private file from its token modal  (was broken: lost its token)");
db.log.length = 0;
await S.ev(`delFileFromModal('${A._id}')`); await S.tick(250);
S.$("#delConfirm").click(); await S.tick(150);
ok(hit(new RegExp(`DELETE /api/files/${A._id}\\?token=${tokA2}`)).length === 1, "DELETE carried the file's token", db.log.join(" | "));
ok(!db.files.has(A._id), "file actually deleted on the server");
ok(!shares(S).some((x) => x.id === A._id), "removed from My Shares");

// ───────────────────────── S6: make public again removes it from My Shares ─────────────────────────
section("S6  Private → public again");
await S.ev(`toggleVis('${B._id}','public')`); await S.tick(40);
const tokB = db.files.get(B._id).shareToken;
ok(shares(S).some((x) => x.id === B._id), "private file tracked");
await S.ev(`openTokenModal(${JSON.stringify(db.files.get(B._id))},'file')`); await S.tick(20);
db.log.length = 0;
await S.ev(`makeFilePublic('${B._id}')`); await S.tick(60);
ok(hit(new RegExp(`PATCH /api/files/${B._id}/visibility\\?token=${tokB}`)).length === 1, "make-public request carried the token");
ok(db.files.get(B._id).visibility === "public", "file is public again");
ok(!shares(S).some((x) => x.id === B._id), "removed from My Shares (nothing secret left to remember)");

// ───────────────────────── S7: folders ─────────────────────────
section("S7  Private folder lifecycle (make private → rename → delete from modal)");
await S.ev(`toggleFolderVis('${F1._id}','public')`); await S.tick(60);
const tokF = db.folders.get(F1._id).shareToken;
ok(TOKEN_RE.test(tokF) && db.folders.get(F1._id).visibility === "private", `folder private with 6-char token (${tokF})`);
ok(shares(S).some((x) => x.id === F1._id && x.type === "folder" && x.name === "Docs" && x.token === tokF), "folder saved to My Shares");
await S.ev("closeTokenModal()"); S.$("#privRevealModal").classList.remove("open");
await S.ev(`openTokenModal(${JSON.stringify({ ...db.folders.get(F1._id), files: [] })},'folder')`); await S.tick(20);
db.log.length = 0;
await S.ev(`renameFolderPr('${F1._id}','Docs')`); S.$("#renameInput").value = "Docs v2"; await S.ev("submitRename()"); await S.tick(60);
ok(hit(new RegExp(`PATCH /api/folders/${F1._id}\\?token=${tokF}`)).length === 1, "rename carried the folder token");
ok(db.folders.get(F1._id).name === "Docs v2", "private folder renamed");
db.log.length = 0;
await S.ev(`delFolderFromModal('${F1._id}')`); await S.tick(250);
S.$("#folderDelConfirmBtn").click(); await S.tick(80);
ok(hit(new RegExp(`DELETE /api/folders/${F1._id}\\?token=${tokF}`)).length === 1, "folder DELETE carried the token  (was broken: modal closed first)", db.log.join(" | "));
ok(!db.folders.has(F1._id) && !shares(S).some((x) => x.id === F1._id), "folder deleted and removed from My Shares");

// ───────────────────────── S8: moving files between folders ─────────────────────────
section("S8  Moving a file OUT of a private folder (the critical-bug fix, through the real UI)");
reset(); S = await boot();
const PUB = mkFolder({ name: "Public box" });
const PRIV = mkFolder({ name: "Private box", visibility: "private" });
const M = mkFile({ originalName: "moveme.png", folderId: PRIV._id }); PRIV.files.push(M._id);
await S.ev(`loadFolders()`); await S.tick(30);
// attacker, no tokens at all, straight at the API:
const atk = await S.w.fetch(`/api/folders/${PUB._id}/files`, { method: "POST", body: JSON.stringify({ fileId: M._id }) });
ok(atk.status === 403 && db.files.get(M._id).folderId === PRIV._id, "anonymous attempt to pull the file out of the private folder → 403, file stays put");
// legit owner: has the private folder open via its token
await S.ev(`openTokenModal(${JSON.stringify(folderView0(PRIV))},'folder')`); await S.tick(20);
await S.ev(`atfFileId='${M._id}'`);
db.log.length = 0;
await S.ev(`doAddToFolder('${PUB._id}')`); await S.tick(80);
const mv = hit(/POST \/api\/folders\/.+\/files/)[0] || "";
ok(mv.includes(`sourceToken=${PRIV.shareToken}`), "UI sent the SOURCE folder's token as sourceToken", mv);
ok(db.files.get(M._id).folderId === PUB._id && PUB.files.includes(M._id) && !PRIV.files.includes(M._id), "move succeeded for the legitimate token holder");
function folderView0(f) { return { ...f, files: f.files.map((i) => db.files.get(i)).filter(Boolean) }; }

// ───────────────────────── S9: encrypted vault never stores keys/names in My Shares ─────────────────────────
section("S9  Encrypted vault: My Shares keeps the token but never the key or real names");
reset(); S = await boot();
let created = false;
// create the vault the way the UI does: POST /folders {encrypted:true}, then reveal
const r = await S.w.fetch("/api/folders", { method: "POST", body: JSON.stringify({ name: "My Vault", encrypted: true }) });
const vault = (await r.json()).folder; created = !!vault;
await S.ev(`(async()=>{const k=await genAesKey();const b64=await exportKeyB64url(k);encKeyCache.set('${vault._id}',b64);window.__k=b64;openEncryptedFolderRevealModal(${JSON.stringify(vault)});})()`); await S.tick(80);
const raw = S.w.localStorage.getItem("cv-my-shares") || "";
ok(created && shares(S).some((x) => x.id === vault._id && x.encrypted === true && x.type === "folder" && x.name === "My Vault" && x.token === vault.shareToken), "vault saved (encrypted flag, token, vault name)");
const keyStr = await S.ev("window.__k");
ok(typeof keyStr === "string" && keyStr.length > 20 && !raw.includes(keyStr), "the AES key is NOT in localStorage");
await S.ev("openMyShares()");
ok(!S.$$("#msBody .ms-btn").some((b) => b.textContent === "Copy link"), "no 'Copy link' offered for encrypted items (it would be missing its key)");
ok(/decryption key isn't stored here/i.test(S.$("#msBody").textContent), "tells the user the key isn't stored");
await S.ev(`openEncryptedRevealModal(${JSON.stringify({ _id: "e".repeat(24), shareToken: "zzzzzz", encrypted: true, originalName: "SECRET-real-name.pdf" })})`);
ok(shares(S).find((x) => x.id === "e".repeat(24))?.name === "Encrypted file" && !(S.w.localStorage.getItem("cv-my-shares")).includes("SECRET-real-name"), "encrypted FILE saved under a generic label — real name never written");

// ───────────────────────── S10: housekeeping ─────────────────────────
section("S10 Remove one / clear all / empty state / tampered storage");
await S.ev("removeShareAt(0)"); await S.tick(5);
ok(shares(S).length === 1, "remove-one works");
await S.ev("clearMyShares()");
ok(shares(S).length === 0 && /Nothing saved yet/.test(S.$("#msBody").textContent) && S.$("#msFoot").style.display === "none", "clear-all → empty state, footer hidden");
S.w.localStorage.setItem("cv-my-shares", "{not json");
ok((await S.ev("loadShares().length")) === 0, "corrupt storage doesn't crash — treated as empty");
S.w.localStorage.setItem("cv-my-shares", JSON.stringify([{ id: "x", token: "abc123", name: "<img src=x onerror=window.__pwn=1>", type: "file", createdAt: 1 }, null, { nope: 1 }]));
await S.ev("openMyShares()");
ok(S.$$("#msBody .ms-item").length === 1 && !S.$("#msBody img") && S.w.__pwn === undefined, "hostile/garbage entries: junk skipped, HTML in a name is shown as text, never executed");

// ───────────────────────── S11: names display correctly (escH) ─────────────────────────
section("S11 Display escaping: apostrophes/&/HTML in names");
reset(); mkFile({ originalName: "Rayan's notes & <b>stuff</b>.pdf", fileType: "application/pdf" });
S = await boot();
const cname = S.$$(".cname, .tmodal-title-lg, [class*=cname]").map((e) => e.textContent).join("|");
ok(cname.includes("Rayan's notes & <b>stuff</b>") && !cname.includes("\\'"), "name shows literally — no stray backslash before the apostrophe, no injected <b>", cname);
ok(!S.$("#fc b") && !S.$("#fc strong"), "no HTML injected into the gallery");

// ───────────────────────── S12: QR is client-side ─────────────────────────
section("S12 QR code for a share link never touches the network");
reset(); const Q = mkFile({ originalName: "q.png" }); S = await boot();
await S.ev(`toggleVis('${Q._id}','public')`); await S.tick(40); db.log.length = 0;
await S.ev("togglePrivQr()"); await S.tick(20);
ok(S.$("#prm-qr-img").getAttribute("src")?.startsWith("data:image"), "QR rendered as an inline data: image");
ok(hit(/qr/i).length === 0, "no request to /api/qr (or anywhere) while rendering it");

// ───────────────────────── S14: private media goes through the token route ─────────────────────────
section("S14 Private files carry no storage URL — media loads via the token-checked preview route");
reset(); S = await boot();
const m14 = JSON.parse(await S.ev(`JSON.stringify({
  pub: mediaSrc({_id:'a'.repeat(24),fileUrl:'https://storage.test/x.png',visibility:'public'}),
  priv: mediaSrc({_id:'b'.repeat(24),shareToken:'abc123',visibility:'private'}),
  thumb: mkThumb({_id:'b'.repeat(24),shareToken:'abc123',visibility:'private',fileType:'image/png'}),
})`));
ok(m14.pub === "https://storage.test/x.png", "public files keep their direct URL (gallery unchanged)");
ok(/\/b{24}\/preview\?token=abc123$/.test(m14.priv), "private file → /preview?token=… (no storage URL needed)", m14.priv);
ok(m14.thumb.includes("/preview?token=abc123") && !m14.thumb.includes("undefined"), "private image thumbnail uses the preview route, never 'undefined'");

// ───────────────────────── S15: vault modal ─────────────────────────
section("S15 Vault modal: lists its files, a foreign file can't lock it, a wrong key is still rejected");
reset(); S = await boot();
const v15 = JSON.parse(await S.ev(`(async()=>{
  const k=await genAesKey(), ks=await exportKeyB64url(k);
  const other=await genAesKey(), os=await exportKeyB64url(other);
  const mk=async(key,name)=>{const a=await encryptString(key,name),b=await encryptString(key,'text/plain');
    return {_id:'f'+name,visibility:'private',encrypted:true,fileType:'application/octet-stream',fileSize:10,originalName:'Encrypted file',shareToken:'abc123',
      encryptedName:a.cipherB64,encryptedNameIV:a.ivB64,encryptedMimeType:b.cipherB64,encryptedMimeTypeIV:b.ivB64,createdAt:new Date().toISOString()};};
  const vault=(files)=>({_id:'v1',name:'V',encrypted:true,visibility:'private',shareToken:'tok123',files});
  const body=()=>document.getElementById('tmodalBody').innerHTML;
  const res={};
  await renderUnlockedVaultModal(vault([await mk(k,'one.txt'),await mk(k,'two.txt')]),ks);
  res.clean=body();
  await renderUnlockedVaultModal(vault([await mk(k,'one.txt'),await mk(other,'JUNK.txt'),await mk(k,'two.txt')]),ks);
  res.poisoned=body();
  try{await renderUnlockedVaultModal(vault([await mk(other,'a.txt'),await mk(other,'b.txt')]),ks);res.wrong='rendered';}catch(e){res.wrong='threw';}
  return JSON.stringify(res);
})()`));
ok(v15.clean.includes('title="one.txt"') && v15.clean.includes('title="two.txt"') && !/vault is empty/i.test(v15.clean), "a vault with 2 encrypted files shows both (was: 'This vault is empty')");
ok(v15.poisoned.includes('title="one.txt"') && v15.poisoned.includes('title="two.txt"') && !v15.poisoned.includes("JUNK") && /1 file in this vault couldn't be decrypted/.test(v15.poisoned), "one foreign/poisoned file is skipped with a notice — the rest still open");
ok(v15.wrong === "threw", "if NOTHING decrypts, the key is still reported wrong");

// uploading into a vault whose token the client doesn't hold must stop before encrypting/sending
db.log.length = 0;
await S.ev(`(async()=>{await uploadEncrypted({name:'x.txt',type:'text/plain',size:1,arrayBuffer:async()=>new ArrayBuffer(1)},1,{pw:{classList:{remove(){}}},pf:{},pn:{},pp:{},ptr:{}},'ffffffffffffffffffffffff')})()`);
await S.tick(10);
ok(/token isn't available/i.test(toastText(S)) && hit(/upload/).length === 0, "vault upload without a known vault token is refused client-side, nothing sent");

// ───────────────────────── S16: folder removal sends the file's own token for PRIVATE files ─────────────────────────
section("S16 Removing a private file from a folder sends its own token; public files send none");
reset(); S = await boot();
const u16 = JSON.parse(await S.ev(`(()=>{
  allFiles.push({_id:'p'.repeat(24),visibility:'private',shareToken:'filetok1'},{_id:'q'.repeat(24),visibility:'public',shareToken:'pubtok1'});
  return JSON.stringify({
    priv: withFileTokenParam('/api/folders/F/files/x?token=foldtok',  'p'.repeat(24)),
    pub:  withFileTokenParam('/api/folders/F/files/y?token=foldtok',  'q'.repeat(24)),
    unknown: withFileTokenParam('/api/folders/F/files/z?token=foldtok','z'.repeat(24)),
  });
})()`));
ok(u16.priv.endsWith("?token=foldtok&fileToken=filetok1"), "private file → ?token=<folder>&fileToken=<file>", u16.priv);
ok(u16.pub === "/api/folders/F/files/y?token=foldtok" && u16.unknown === "/api/folders/F/files/z?token=foldtok", "public / unknown files → URL unchanged");

// ───────────────────────── S17: Properties for a file that only lives inside a token-opened folder ─────────────────────────
section("S17 Properties works for files inside a token-opened folder (not just the gallery)");
reset(); S = await boot();
const p17 = await S.ev(`(()=>{
  tokenModalFolder={_id:'fo',name:'F',files:[{_id:'z'.repeat(24),originalName:'inside.png',fileType:'image/png',fileSize:10,visibility:'public',createdAt:new Date().toISOString()}]};
  showProp('z'.repeat(24));
  return document.getElementById('propFname').textContent;
})()`);
ok(p17 === "inside.png", "showProp finds a file that is only inside the open folder", p17);

// ───────────────────────── S18: decryption key is scrubbed from the address bar once used ─────────────────────────
section("S18 The #key is removed from the URL after it has been used; the token and other hashes are left alone");
reset(); S = await boot();
await S.ev(`history.replaceState(null,'','/app?token=abc123#key=SECRETKEY')`);
await S.ev(`scrubKeyFromUrl()`);
const u18 = JSON.parse(await S.ev(`JSON.stringify({h:location.hash,s:location.search})`));
ok(u18.h === "" && u18.s === "?token=abc123", "key fragment gone, ?token= kept", JSON.stringify(u18));
await S.ev(`history.replaceState(null,'','/app#other=1')`);
await S.ev(`scrubKeyFromUrl()`);
ok((await S.ev(`location.hash`)) === "#other=1", "an unrelated fragment is untouched");

// ───────────────────────── S19: opening from My Shares doesn't spend a view ─────────────────────────
section("S19 My Shares → Open uses the by-id route (no view spent); exhausted/expired items still show the proper message path");
reset(); S = await boot();
const f19 = mkFile({ visibility: "private", shareToken: "abc123", maxViews: 3, viewCount: 0, fileUrl: undefined });
await S.ev(`saveShare({id:'${f19._id}',type:'file',name:'x',token:'abc123',encrypted:false})`);
db.log.length = 0;
await S.ev(`openShare(0)`); await S.tick(20);
ok(hit(new RegExp(`/api/files/${f19._id}\\?token=abc123`)).length >= 1, "opened via GET /api/files/:id?token=");
ok(hit(/\/token\//).length === 0, "no /token/ lookup (that is what spends a view)");
ok(db.files.get(f19._id).viewCount === 0, "viewCount untouched on the server", String(db.files.get(f19._id).viewCount));
db.files.get(f19._id).viewCount = 3;
db.log.length = 0;
await S.ev(`openShare(0)`); await S.tick(20);
ok(hit(/\/token\/abc123/).length >= 1, "views already used up → falls back to the normal token lookup (shows the limit message)");

// ───────────────────────── S20: the vault stays selectable after the folder list reloads ─────────────────────────
section("S20 A vault you hold the key for stays in the upload dropdown after loadFolders() replaces the public list");
reset(); S = await boot();
const v20 = JSON.parse(await S.ev(`(()=>{
  const v={_id:'v1',name:'My Vault',encrypted:true,visibility:'private',shareToken:'tok123',files:[]};
  allFolders=[v]; rememberItem(v); encKeyCache.set('v1','KEY');
  encKeyCache.set('file-not-a-folder','KEY2'); // standalone encrypted file keys live in the same cache
  refreshVaultSelect(); const before=[...document.getElementById('vaultSelect').options].map(o=>o.textContent);
  allFolders=[]; // what loadFolders() does: replaces the list with the PUBLIC folders only
  refreshVaultSelect(); const after=[...document.getElementById('vaultSelect').options].map(o=>o.textContent);
  return JSON.stringify({before,after});
})()`));
ok(v20.before.length === 2 && v20.after.length === 2 && v20.after[1] === "My Vault", "vault option survives the reload; file keys don't create phantom options", JSON.stringify(v20));

// ───────────────────────── S21: encrypted size limit accounts for the GCM tag ─────────────────────────
section("S21 Size limit: plain files up to exactly 50 MB; encrypted files 16 bytes less (AES-GCM tag)");
reset(); S = await boot();
const MB50 = 50 * 1024 * 1024;
const r21 = JSON.parse(await S.ev(`(()=>{
  proc=()=>{}; // we only care whether the file is accepted into the queue
  const chk=(enc,size,type)=>{document.getElementById('encToggle').checked=enc;queue.length=0;doUpload({name:'f.bin',type,size});return queue.length;};
  return JSON.stringify({
    plainAtLimit:   chk(false,${MB50},'image/png'),
    plainOver:      chk(false,${MB50}+1,'image/png'),
    encAtLimit:     chk(true,${MB50}-16,'application/octet-stream'),
    encJustOver:    chk(true,${MB50}-15,'application/octet-stream'),
  });
})()`));
ok(r21.plainAtLimit === 1 && r21.plainOver === 0, "plain: exactly 50 MB accepted, 1 byte over refused", JSON.stringify(r21));
ok(r21.encAtLimit === 1 && r21.encJustOver === 0, "encrypted: 50 MB − 16 B accepted, one byte more refused (ciphertext would exceed the server cap)", JSON.stringify(r21));
ok(/exceeds 50MB/.test(toastText(S)), "refusal says so");

// ───────────────────────── S22: truncated gallery is announced ─────────────────────────
section("S22 When the server caps the gallery response, the UI says so");
reset(); S = await boot();
await S.ev(`(async()=>{ const real=fetch; fetch=async(u,o)=>String(u).endsWith('/api/files')?{ok:true,json:async()=>({files:[],truncated:true})}:real(u,o); await loadFiles(); })()`);
await S.tick(10);
ok(/Showing the newest/.test(toastText(S)), "toast: Showing the newest N files");

// ───────────────────────── S13: every inline handler resolves ─────────────────────────
section("S13 Static check: every inline onclick/onkeydown target is a real function");
reset(); mkFile(); mkFolder(); S = await boot();
const html = S.w.document.documentElement.outerHTML;
const src = fs.readFileSync(path.join(PROJECT, "public/js/app.js"), "utf8");
const names = new Set();
for (const m of (html + src).matchAll(/on(?:click|change|input|keydown|keyup|submit)=\\?"(?:[^"\\]|\\.)*?"/g))
  for (const f of m[0].matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) names.add(f[1]);
const skip = new Set(["if", "return", "event", "this", "document", "window", "stopPropagation", "toggle", "remove", "add", "stopImmediatePropagation"]);
const missing = [...names].filter((n) => !skip.has(n)).filter((n) => { try { return S.w.eval(`typeof ${n}`) !== "function"; } catch { return true; } });
ok(missing.length === 0, `all ${names.size} referenced handlers exist`, "MISSING: " + missing.join(", "));
ok(S.errors.length === 0, "still no uncaught JS errors after all of the above", S.errors.join(" // "));

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) { console.log("FAILED:\n - " + failures.join("\n - ")); process.exit(1); }
