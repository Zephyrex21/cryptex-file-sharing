# Cryptex — Testing Checklist

Everything built across this whole round of changes, organized so you can go
through it locally (`npm run dev`) and on the live Render deploy. Hard-refresh
(Ctrl+Shift+R) wherever you test — CSS/JS caching will otherwise show you
stale versions and make things look broken when they aren't.

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

## Mobile (resize browser or use a real phone)

- [ ] Upload progress bar doesn't overflow horizontally on a narrow screen
- [ ] Navbar collapses correctly on both pages
- [ ] Cards reflow to fewer columns, nothing overlaps
- [ ] The 3-step encryption flow on the homepage stacks vertically with a
      rotated arrow between steps, rather than staying side-by-side

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

If anything on this list doesn't do what it says, that's the most useful
possible bug report you could give me — exact item + what actually happened.
