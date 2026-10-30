# Cryptex — Testing Checklist

Everything built across this whole round of changes, organized so you can go
through it locally (`npm run dev`) and on the live Render deploy. Hard-refresh
(Ctrl+Shift+R) wherever you test — CSS/JS caching will otherwise show you
stale versions and make things look broken when they aren't.

## Automated tests

`npm test` runs 196 Vitest cases covering the security-critical logic that's
otherwise easy to silently break: magic-byte content verification (every
supported file type, plus mismatch/tampering cases), the SSRF protections in
`isSafeUrl` (private IPs, IPv6, cloud metadata address, mixed-resolution,
DNS-failure — all with `dns.lookup` mocked, so it needs no network access),
the encrypted-file business rules (`renameFile`/`setVisibility` rejecting
encrypted files, expiry-date math), and — new this round — that a private
item's token is required for mutations (rename/delete/visibility/folder
membership) exactly as it already was for reading it, while a public item
needs nothing at all (`tests/auth.test.js`, `tests/directAccessGuard.test.js`);
that moving a file out of a private folder needs *that* folder's token, and
that multi-document writes run inside transactions (`tests/folderMoves.test.js`,
`tests/deleteFileTx.test.js`); that every token-checking route actually has a
rate limiter wired on (`tests/routeLimiters.test.js` — this one would have
caught the "limiter on some routes, not others" gap); the 6-character token
format (`tests/token.test.js`); and the batched ZIP assembly keeping order,
name de-duplication, and its concurrency cap (`tests/zipHelper.test.js`); and the second-audit
critical fixes — linear-time link-preview parsing, no inline rendering of uploaded active content,
token-gated vault uploads, and hidden/rotating private storage paths (`tests/criticalFixes.test.js`), plus a real-HTTP multipart check of the multer 2 upgrade (`tests/multer2Compat.test.js`).

There's also an **optional website smoke test** in `e2e/` (`cd e2e && npm install
&& npm test`) that loads the real `app.html` + `app.js` into a DOM and drives the
actual UI against a fake API that enforces the real auth rules — see
`e2e/README.md`. It isn't part of `npm test` (it needs jsdom, kept out of the
main `package.json` on purpose).

Everything below this point is still a manual walkthrough in a real browser.

## Homepage (`/`)

- [ ] Hero headline scrambles then resolves on load ("Encrypted end-to-end.")
- [ ] Illustration: gentle float, mouse-parallax (desktop), orbiting dot, token
      text flickers every ~2s
- [ ] Illustration looks right in both light and dark theme
- [ ] Scroll down — navbar picks up a shadow/blur
- [ ] Nav has a new "Encryption" link between Features and About — scrolls
      to the new section and highlights correctly as you scroll past it
- [ ] Features, Encryption, and About sections all fade in as you scroll to them
- [ ] The "End-to-End Encryption" feature card (first in the grid) has a
      gradient border and a "Zero-Knowledge" badge, distinct from the rest
- [ ] Roadmap timeline shows a connecting line through the dots, ends with
      "End-to-End Encryption (AES-256-GCM)" marked done, right before the
      two future items
- [ ] "Open Vault" button (nav + hero) goes to `/app`
- [ ] Shrink to mobile width, open hamburger menu — should fade in, includes
      an "Open Vault" link and the new "🔐 Encryption" item
- [ ] Old-style shared link `yoursite.com/?token=SOMETOKEN` redirects to
      `/app?token=SOMETOKEN` and auto-loads it

## App page (`/app`)

- [ ] Search bar filters files by name
- [ ] Token bar: paste a token, hit enter or click — loads that item
- [ ] Drag a file over the upload zone — pulsing ring appears
- [ ] Drop 2-3 files at once — "X of Y" counter shows, shimmer on the bar,
      green checkmark on the last one
- [ ] Upload one of each new type: `.txt`, `.doc`, `.docx`, `.csv`, `.xlsx`,
      `.pptx`, `.ppt`, `.xml` — each should show the right colored badge/icon
      (cyan=doc, teal=sheet, orange=slide)
- [ ] "Docs" filter tab shows all of the above together
- [ ] Add a link via the link bar — paste a real URL (try one with good OG
      tags, e.g. a GitHub repo page) — should show title + preview image
- [ ] Add a link to a page with NO preview image — should fall back to the
      generic link icon, not break
- [ ] Try adding an obviously bad URL (`not a url`, `ftp://...`) — should
      show a clear error, not crash
- [ ] "Links" filter tab shows only links
- [ ] Click a link card — opens the URL in a new tab
- [ ] Open every modal once (delete, properties, token access, make-private,
      add-to-folder, new folder) — confirm each pops in with animation
- [ ] Properties modal on a link shows Domain instead of Size, "Open Link"
      instead of "Download"
- [ ] Delete a file (undo toast) and a link — both should work, links
      shouldn't error trying to clean up a Supabase file that doesn't exist
- [ ] Create a folder, add a mix of files AND a link to it, download the
      folder as ZIP — link should be silently skipped, not break the zip
- [ ] Toggle a file/link private, copy its share token, open that token in
      a new incognito tab — should load correctly
- [ ] Theme toggle — persists across a page reload and across navigating
      between `/` and `/app`
- [ ] Hover file/folder cards — glow ring + lift
- [ ] Empty folder / no search results — icons should have a circular
      backdrop, not float bare

## End-to-end encryption (new)

- [ ] Toggle "🔒 End-to-end encrypt this upload" ON, upload an image — progress
      label shows "Encrypting…" then "Uploading…"
- [ ] On success, the "Encrypted & Uploaded 🔒🔑" reveal modal appears and a
      full link (`?token=...#key=...`) is auto-copied to the clipboard
- [ ] The encrypted file does NOT appear anywhere in the public gallery
- [ ] Open the copied link in a new incognito tab — the file should unlock
      automatically (no key prompt) and show its real name/type/size
- [ ] "Decrypt & Download" saves the file under its real original filename
- [ ] For an encrypted image/video/PDF, "Decrypt & Preview" opens it correctly
- [ ] Paste a WRONG key into an encrypted file's unlock prompt — should show
      "That key doesn't decrypt this file", not crash or silently fail
- [ ] Open the token (without the `#key=`) by itself — should show the
      locked "paste decryption key" prompt, not the real filename
- [ ] Try renaming an encrypted file — should be rejected (name is encrypted)
- [ ] Try making an encrypted file public — should be rejected server-side
      even if attempted directly against the API
- [ ] Drag-and-drop a file type outside the normal allowlist (e.g. `.exe`)
      WITH the encrypt toggle on — should be accepted (encrypted mode allows
      any type); same file WITHOUT the toggle should be rejected
- [ ] Put an encrypted file in a folder, download the folder as ZIP — the
      encrypted file should be silently excluded, not break the zip
- [ ] "Manage Sharing" → "Regenerate Token" on an encrypted file, then copy
      the link again — new token, same key, still decrypts correctly
- [ ] Refresh the page, then reopen "Manage Sharing" on that same encrypted
      file and click "Copy shareable link" — since the key was only ever
      in-memory, this should show "Decryption key isn't available in this
      session" rather than silently producing a broken link

## Bulk actions, self-destructing links, QR, pagination (new)

- [ ] Click "Select" in the files toolbar — checkboxes appear on every card
- [ ] Select 2-3 files, floating toolbar slides up from the bottom showing the count
- [ ] "Move" opens the folder picker, adds all selected files to the chosen folder
- [ ] "Download ZIP" downloads a single .zip containing all selected files
- [ ] Select an encrypted file alongside normal ones, download ZIP — the encrypted one is silently excluded, others download fine
- [ ] "Delete" asks for confirmation, then removes all selected cards
- [ ] Switch between grid/list view while in select mode — stays in select mode, checkboxes carry over
- [ ] Click "Select" again (or the X in the toolbar) — exits select mode, toolbar hides
- [ ] Make a file private, set "5 views" as the limit, open its token link 5 times — 6th attempt shows "reached its view limit"
- [ ] Changing the view limit (or regenerating the token) resets the count — verify the status line updates
- [ ] Click "Show QR code" in the private-file panel — a scannable QR renders inline; scanning it with a phone opens the share link
- [ ] `GET /api/files?page=1&limit=5` returns a bounded page with `total`/`hasMore`; plain `GET /api/files` still returns everything (unchanged legacy behavior)
- [ ] Visit `/api-docs` — Swagger UI loads and lists all the routes

## Mobile (resize browser or use a real phone)

- [ ] Upload progress bar doesn't overflow horizontally on a narrow screen
- [ ] Navbar collapses correctly on both pages
- [ ] Cards reflow to fewer columns, nothing overlaps
- [ ] The 3-step encryption flow on the homepage stacks vertically with a
      rotated arrow between steps, rather than staying side-by-side

## 6-character tokens + My Shares (this round)

- [ ] Make a file private — the token shown is 6 characters (lowercase letters
      and digits), and the **Copy link** / **QR** buttons still work
- [ ] A one-time toast points you to **My Shares** the first time; it doesn't
      repeat on later shares
- [ ] Click the key icon in the top bar → **My Shares** lists that file with its
      token and today's date. The blue note at the top says it's *your own files,
      this browser only, only visible to you, cleared if you clear your cache*
- [ ] **Copy token**, **Copy link**, **Open** (opens the file's token view), and
      **✕** (removes it from the list only — the file itself is untouched) all work
- [ ] Regenerate the token → the list shows the NEW token without you doing anything
- [ ] Make the file public again, or delete it → it disappears from the list
- [ ] Upload an encrypted file / create a vault → listed as **Encrypted**, with
      NO "Copy link" button and a note that the key isn't stored; the vault shows
      its name but an encrypted file only shows as "Encrypted file"
- [ ] Open DevTools → Application → Local Storage: `cv-my-shares` contains tokens
      and names but **no `#key=` / decryption key anywhere**
- [ ] Clear site data → My Shares is empty (as the note promises) — and the file
      is still reachable with the token you copied earlier
- [ ] Type a token in the "Access a private file" box in CAPITALS with spaces
      around it — it still opens
- [ ] An older item that still has a long 16-character token keeps working
- [ ] Delete a private file/folder from its token view, and delete a file inside
      an unlocked vault — works (this used to fail silently with a 403 after the
      undo window)
- [ ] Move a file out of a private folder you have open into a public folder —
      works. (A stranger with only the file's id can't: `POST` to
      `/api/folders/<any>/files` without the source folder's token is a 403)
- [ ] A filename with an apostrophe or `&` (e.g. `Rayan's notes & stuff.pdf`)
      displays exactly like that — no stray backslash

## Access-control fixes (previous round)

There's no owner login/key anymore — "public" items are openly manageable by
anyone, and "private" items are gated by their own share token for
everything, reading and mutating alike. See README → Security Considerations
for the full reasoning.

- [ ] Rename/delete/change visibility on a PUBLIC file or folder from the
      gallery, with no special setup — just works, no prompts, no 401s
- [ ] Make a file private, then (still in the same browser tab/session where
      you have it open) rename it / change its expiry or max-views / make it
      public again — all still work, because the app already has that file's
      token in local state from when you made it private
- [ ] Make a file private, copy its share link, open the link in a private/
      incognito window — download and preview both work with just the link
- [ ] In that same incognito window, try hitting the file's plain `/api/
      files/:id` or `/:id/download` URL with the `?token=...` chopped off —
      fails (403): a private item's `_id` alone is not enough
- [ ] In that incognito window — i.e. with only the share link, no "owner"
      context at all — try PATCH/DELETE on that same file's `:id` with no
      token: fails (403). With the file's own `?token=...` appended: succeeds.
      This is the main thing this round changed — the recipient of a share
      link, not just "the owner", can manage what they were given access to
- [ ] Regenerate a private file's token, then try the OLD share link, OR the
      old token on a PATCH/DELETE call — both should fail now (previously,
      the old link's `_id` kept working forever even after "revoking" it)
- [ ] Set a private folder's link to expire in 1 minute, wait, then try
      opening the folder directly by clicking into it from a place that still
      has the old link cached — should be rejected as expired
- [ ] Try to flip a PRIVATE file back to public using only its `_id` (no
      token) — fails (403); this is the "stranger can't hijack your private
      file" case, not just "can't read it"
- [ ] Open the "Show QR code" panel for a private/encrypted file, then check
      your browser's Network tab — there should be NO request to `/api/qr`
      (or anywhere else) when the QR renders; it's drawn entirely in-page

## Things I could NOT verify myself (no live browser or database in my sandbox)

- Actual visual rendering of anything — every animation/layout claim above
  is my best understanding of the code, not something I watched happen
- The full link-creation flow end-to-end against a real MongoDB
- Real-world OG-tag scraping against arbitrary sites (only tested against
  GitHub/npm, which are the only external domains reachable from where I
  work)
- The actual Web Crypto encrypt/decrypt round-trip against a real browser —
  I verified the logic by reading it carefully and syntax-checked every file
  with `node --check`, but I have no browser in this sandbox to click through
  it myself. Test this section first.
- The access-control and My Shares checklists above, in a *real browser*. What I
  did verify: the unit tests run the actual controller functions, and the `e2e/`
  smoke test runs the real page + real `app.js` in a DOM against a fake API that
  uses the real auth rules (66 checks, and I confirmed it fails when I put the
  bugs back). What that can't tell you: how it looks and feels, and anything
  involving a real MongoDB or Supabase.
- **MongoDB transactions against a real database.** The move/remove/delete code
  now uses `session.withTransaction()`. Unit tests prove the right writes happen
  inside it and that it's skipped on early exits, but I had no live MongoDB here.
  Atlas is a replica set so transactions are supported; a *standalone* local
  `mongod` is not and will error on folder moves/deletes — use Atlas or a
  single-node replica set for local dev.
- **The new database indexes.** Mongoose builds them on first start. On a large
  existing collection that's a one-time background cost; on a personal-sized one
  you won't notice. Worth a glance at your Atlas "Indexes" tab afterwards.
- **`TRUST_PROXY` on your actual host.** I can't see your deployment. If you're
  behind Render/Heroku/etc. and don't set it, every visitor shares one rate-limit
  bucket (you'd see "Too many requests" far sooner than expected).
- Two things I deliberately left alone: uploads still buffer the whole file in
  RAM before sending it to storage (`multer.memoryStorage()`, 50 MB cap) —
  changing that means re-plumbing the upload pipeline, which is a bigger and
  riskier change than the problem justifies for a personal app, but a handful of
  simultaneous 50 MB uploads on a small instance could run it out of memory.
- One thing I deliberately did NOT fix: `controllers/linkPreview.js`'s SSRF
  guard has a narrow DNS-rebinding gap (documented in the README) — the
  check and the actual fetch each resolve DNS independently, so there's a
  small race window a very well-timed attacker with control of their own DNS
  could in theory exploit. Closing it properly means pinning the validated
  IP for the real connection instead of a second independent lookup, which
  is more invasive than I wanted to do to a working, tested module without
  being able to browser-test the result. Flagging it here rather than
  quietly leaving it out.

If anything on this list doesn't do what it says, that's the most useful
possible bug report you could give me — exact item + what actually happened.
