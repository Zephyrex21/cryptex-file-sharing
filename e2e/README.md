# Cryptex end-to-end smoke test

Loads the **real** `public/app.html` + `public/js/*.js` into a DOM (jsdom) and
drives the actual UI flows against an in-memory fake API. The fake API doesn't
re-implement the access rules — it calls the project's **real**
`middleware/auth.js` and `utils/token.js`, so if the UI ever sends a request the
real server would reject (a missing share token, say), this fake rejects it too.

It covers: page boot (no JS errors), making files/folders private (6-char tokens),
My Shares (save / copy / open / remove / clear, and that it never stores keys or
real names of encrypted items), expiry/max-views/regenerate, typing a token by
hand, deleting/renaming private items from their modals, moving files out of a
private folder, display escaping, client-side QR, and a static check that every
inline `onclick` target is a real function.

```bash
cd e2e
npm install      # installs jsdom here only — your root package.json is untouched
npm test
```

What it can't do: it isn't a real browser (no layout/CSS/visual checks) and there's
no real MongoDB/Supabase behind it, so it checks request/response *contracts*, not
storage. Treat it as a fast regression net, and still click through
`TESTING.md` in a real browser before shipping.
