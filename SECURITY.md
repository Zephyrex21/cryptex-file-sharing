# Cryptex — security model

This is what the end-to-end encryption does and does **not** protect, written to be checked rather than
believed. Every claim marked ✔ is covered by an automated test you can run (`npm test`, `cd e2e && npm test`).

## How it works
- The browser generates a random **AES-256-GCM** key (Web Crypto, `crypto.subtle.generateKey`), encrypts the file,
  its name and its MIME type (each with its **own random 96-bit IV**) and uploads only ciphertext + IVs.
- The key travels only inside the share link's **`#fragment`** — browsers never send the fragment in an HTTP
  request, so it is absent from the server, its logs, Supabase, proxies and `Referer` headers
  (`Referrer-Policy: no-referrer` is also set).
- After a key has been used, the app removes it from the address bar (`history.replaceState`).
- There is no key escrow and no reset. **Lose the link, lose the file.**

## What is protected (✔ = tested)
| Threat | Result |
|---|---|
| Server / database / Supabase storage compromised, or a curious operator | Sees ciphertext only. ✔ no server code reads a key; no model can hold one |
| Network observer, server access logs, reverse proxies | Key is never in a URL path/query, header or body ✔ (e2e key canary S24) |
| Ciphertext, name or IV modified in storage | Detected: GCM authentication fails, nothing is returned ✔ |
| Wrong or guessed key | Decrypts nothing. 256-bit keys are not guessable ✔ |
| Same plaintext uploaded twice / IV reuse | Fresh IV every time; 20,000 encryptions, zero repeats ✔ |
| Key persisted in the browser | Never in localStorage / sessionStorage / cookies ✔ ("My Shares" stores only the token) |
| Key sent to a third party by the QR code | QR is rendered locally ✔ |
| Legacy `/?token=…#key=…` links | Redirect now keeps the fragment ✔ (it used to drop the key) |

## What is NOT protected (read this)
1. **A malicious or hacked *web server* can serve modified JavaScript** that reads the key in your browser. This is
   inherent to any web-based E2EE tool. The code is open source; for high-stakes use, run your own instance.
2. **XSS in the app = key theft.** The current CSP sets `frame-ancestors`, `object-src`, `base-uri`, `form-action`
   but **no `script-src`**, because the UI still uses inline `onclick` handlers. All user-visible decrypted text is
   escaped, but a `script-src` policy would be a second line of defence. *Planned: remove inline handlers, add CSP.*
3. **Whoever has the full link has the file.** The key *is* the capability. Send the link over a channel you trust;
   chat apps, email, clipboard managers and browser history may keep copies. There is no per-recipient revocation —
   delete the file to revoke.
4. **Ciphertext of encrypted files is downloadable by anyone who knows the file id** (the token does not gate it).
   Confidentiality rests entirely on the key. Size and upload time are visible to the server.
5. **Integrity of *which* ciphertext goes with *which* name is not bound** (tracked in `tests/cryptoAudit.test.js`).
   A party who can write the database could swap two files' encrypted names, or substitute one file's ciphertext for
   another *within the same vault/key*. They cannot read or forge content. *Planned: AAD-bound format v2.*
6. Endpoint malware, shoulder-surfing and screenshots are out of scope.
7. **A passphrase on top of the link** (so link-alone is not enough) is not implemented yet.

## Reporting
Please open a private security advisory on the GitHub repository rather than a public issue.
