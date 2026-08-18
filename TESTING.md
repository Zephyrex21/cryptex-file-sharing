# Cryptex — Testing Checklist

Everything built across this whole round of changes, organized so you can go
through it locally (`npm run dev`) and on the live Render deploy. Hard-refresh
(Ctrl+Shift+R) wherever you test — CSS/JS caching will otherwise show you
stale versions and make things look broken when they aren't.

## Homepage (`/`)

- [ ] Hero headline scrambles then resolves on load
- [ ] Illustration: gentle float, mouse-parallax (desktop), orbiting dot, token
      text flickers every ~2s
- [ ] Illustration looks right in both light and dark theme
- [ ] Scroll down — navbar picks up a shadow/blur
- [ ] Features and About sections fade in as you scroll to them
- [ ] Roadmap timeline shows a connecting line through the dots
- [ ] "Open Vault" button (nav + hero) goes to `/app`
- [ ] Shrink to mobile width, open hamburger menu — should fade in, includes
      an "Open Vault" link
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

## Mobile (resize browser or use a real phone)

- [ ] Upload progress bar doesn't overflow horizontally on a narrow screen
- [ ] Navbar collapses correctly on both pages
- [ ] Cards reflow to fewer columns, nothing overlaps

## Things I could NOT verify myself (no live browser or database in my sandbox)

- Actual visual rendering of anything — every animation/layout claim above
  is my best understanding of the code, not something I watched happen
- The full link-creation flow end-to-end against a real MongoDB
- Real-world OG-tag scraping against arbitrary sites (only tested against
  GitHub/npm, which are the only external domains reachable from where I
  work)

If anything on this list doesn't do what it says, that's the most useful
possible bug report you could give me — exact item + what actually happened.
