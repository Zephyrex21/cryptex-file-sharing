# Cryptex - End-to-End Encrypted, Token-Based File Sharing

A secure file sharing platform built with the MERN stack and Supabase Storage — with an optional client-side, zero-knowledge encryption layer on top of its token-based sharing model.

Cryptex allows users to upload files, organize them into folders, generate unique share tokens, and control access through public/private visibility settings. File contents are stored in Supabase Storage while metadata is managed through MongoDB. Any upload can also be encrypted entirely in the browser before it's sent — in that mode, the server only ever stores ciphertext and never sees the decryption key.

[![Live Demo](https://img.shields.io/badge/Live-Demo-brightgreen?style=for-the-badge)](https://cryptex-file-sharing.onrender.com/)
[![CI](https://github.com/Zephyrex21/cryptex-file-sharing/actions/workflows/ci.yml/badge.svg)](https://github.com/Zephyrex21/cryptex-file-sharing/actions/workflows/ci.yml)


# Features

### 🔐 End-to-End Encryption (Zero-Knowledge)
- AES-256-GCM encryption performed entirely client-side via the Web Crypto API
- Content, filename, and MIME type are all encrypted — not just the bytes
- The decryption key is generated in the browser and only ever travels inside a URL **fragment** (`#key=...`), which browsers never send in HTTP requests — the server, its logs, and Supabase never see it
- Encrypted files are always private, can't be renamed (the name is ciphertext), and can't be made public
- **Trade-off, by design:** if a share link is lost, the file is permanently unrecoverable — there is no server-side reset, because there's nothing on the server that could reconstruct the key

### 🗝️ Encrypted Vaults (folder-level encryption)
- A folder can be created as an encrypted vault — every file added to it is encrypted under **one shared key**, generated once in the browser at vault creation
- One link (`?token=...#key=...`) unlocks the entire vault, rather than needing a separate key per file
- Each file still gets its own random IV even under the shared key — required for AES-GCM's safety guarantee regardless of key reuse
- Vaults are always private and can never be made public, enforced server-side
- Uploading into a vault and uploading a standalone encrypted file use the exact same client-side encryption code — only which key gets used differs
- Known limitation: an existing plaintext (or differently-encrypted) file can't be added into a vault after the fact — vault membership is decided at upload time, not by moving files in later

### File Management
- Upload files securely (with real magic-byte content verification for unencrypted uploads)
- Download files
- Preview supported files
- Rename files
- Delete files

### Folder Management
- Create folders
- Organize files into folders
- Rename folders
- Delete folders
- Download an entire folder as a ZIP

### Token-Based Sharing
- Short, easy-to-remember **6-character share token** (lowercase letters + digits, e.g. `k3x9a2`) generated for every file and folder — simple enough to read out loud or type from memory. Items shared before this change keep their original long tokens, which still work.
- Access shared content without exposing database IDs
- Expiring tokens, view limits, and one-click regeneration to rotate a leaked token
- The token box on the page forgives caps-lock and stray spaces

### My Shares (your own token history)
- A **My Shares** button in the top bar lists the tokens of the files and folders you made private (or encrypted) **from this browser** — so you can always get back to something you shared without having to remember or save the token yourself. One-click copy token / copy link / open / remove.
- It's stored **locally in your browser only** (`localStorage`): nothing is sent to the server, only you can see it, and it's cleared if you clear your browser cache/site data (the panel says so, too). Lose it and nothing is lost on the server — you just no longer have the reminder.
- For encrypted items it keeps the token only — **never the decryption key, and never the real filename** — so it doesn't weaken the zero-knowledge design. (Encrypted entries therefore have no "Copy link": the key lives only in the link you saved when you created it.)

### Visibility Controls
- Public files/folders
- Private files/folders
- Toggle visibility anytime (encrypted files are private-only — see above)

### Storage Architecture
- MongoDB stores metadata
- Supabase Storage stores actual files (ciphertext, for encrypted uploads)
- Express API handles uploads and access control

---

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/Zephyrex21/Cryptex_File_Sharing.git
cd cryptex
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file and add the required values.

### 4. Start Development Server

```bash
npm run dev
```

### 5. Start Production Server

```bash
npm start
```
---

## Environment Variables

Create a `.env` file in the root directory.

Example:

```env
# MongoDB Atlas URI
MONGO_URI=

# Supabase Project URL
SUPABASE_URL=

# Supabase Service Role Key
SUPABASE_SERVICE_KEY=

# Supabase Storage Bucket Name
SUPABASE_BUCKET=

# Backend Port
PORT=3000

# Optional — set to the number of reverse proxies in front of the app (1 on
# Render/Heroku/most PaaS). Without it, every visitor behind a proxy looks like
# the same IP, so the per-IP rate limits become one shared bucket. Leave unset
# when there is NO proxy (e.g. local dev): trusting X-Forwarded-For without one
# lets clients spoof their IP and sidestep the limiters. (If your host logs
# ERR_ERL_UNEXPECTED_X_FORWARDED_FOR, that's this setting telling you to set it.)
TRUST_PROXY=
```
---


## API Routes

### File Routes

| Method | Endpoint | Description |
|----------|----------|-------------|
| POST | `/api/files/upload` | Upload file |
| GET | `/api/files` | Get all files |
| GET | `/api/files/:id` | Get file details |
| GET | `/api/files/:id/download` | Download file |
| GET | `/api/files/:id/preview` | Preview file |
| PATCH | `/api/files/:id` | Rename file 🔒 |
| PATCH | `/api/files/:id/visibility` | Change visibility 🔒 |
| DELETE | `/api/files/:id` | Delete file 🔒 |
| GET | `/api/files/token/:token` | Access via token |

> 🔒 = open for a **public** file, no questions asked; for a **private** one, needs that file's own current, unexpired `?token=` (as a query param or an `X-Share-Token` header) — see "Security Considerations". There's no separate owner login: a private item's token *is* the permission.

> `POST /api/files/upload` accepts an optional encrypted-upload contract: multipart fields `encrypted=true`, `iv`, `encryptedName`, `encryptedNameIV`, `encryptedMimeType`, `encryptedMimeTypeIV` alongside `file` (sent as ciphertext, `application/octet-stream`). See `controllers/fileUpload.js` and `public/js/app.js` for the client/server contract.

---

### Folder Routes

| Method | Endpoint | Description |
|----------|----------|-------------|
| POST | `/api/folders` | Create folder |
| GET | `/api/folders` | Get folders |
| GET | `/api/folders/:id` | Folder details |
| PATCH | `/api/folders/:id` | Rename folder 🔒 |
| PATCH | `/api/folders/:id/visibility` | Change visibility 🔒 |
| DELETE | `/api/folders/:id` | Delete folder 🔒 |
| POST | `/api/folders/:id/files` | Add file to folder 🔒 |
| DELETE | `/api/folders/:id/files/:fileId` | Remove file from folder 🔒 |
| GET | `/api/folders/token/:token` | Access via token |

> Moving a file out of a private folder (`POST /api/folders/:id/files`) additionally needs that folder's token as `?sourceToken=` (or `X-Source-Token`), because the file is being removed from it.

> Same 🔒 rule as files, with one difference: a folder's own name/metadata is never encrypted (only what's *inside* a vault folder is, per-file), so a private folder's token is always required — there's no ciphertext-based bypass the way there is for an individual encrypted file.

---

## How It Works

**Standard upload:**
1. User uploads a file.
2. File is stored in Supabase Storage.
3. Metadata is stored in MongoDB.
4. A unique token is generated.
5. Users can share the token to provide access.
6. Visibility settings determine whether content appears publicly.

**Encrypted upload:**
1. User toggles "End-to-end encrypt" before uploading.
2. The browser generates a random AES-256-GCM key and encrypts the file's content, filename, and MIME type — nothing plaintext leaves the device.
3. Only ciphertext is uploaded and stored in Supabase; MongoDB stores ciphertext blobs for the name/type too, not the real values.
4. The file is forced private and given a token, same as above.
5. The share link is built as `.../app?token=<token>#key=<key>` — the `#key=` fragment is never transmitted to the server by the browser, so this is the only place the key exists outside the uploader's own session.
6. Whoever opens that link decrypts the file locally in their browser; the server is never asked to, and couldn't if it were.

---

## Security Considerations

This app has no login/user system — it's a personal, share-by-link drop box, not a walled garden. **"Public" means exactly that**: anyone who can reach the API can see, download, rename, delete, or re-share a public file/folder, the same way they can already see it in the gallery. That's a deliberate trade-off for a zero-friction personal tool, not an oversight — if you want a real access boundary around the whole app (not just private items), put it in front at the infra level (a reverse-proxy auth gate, an IP allowlist, a private network) rather than in the app itself.

- Sensitive credentials are stored in environment variables; the Supabase Service Role Key never leaves the server.
- **Private is the one thing that's actually gated — and now consistently.** A private, unencrypted file/folder needs its own current, unexpired share token (`?token=...` as a query param, or an `X-Share-Token` header) for *everything*: reading it, downloading it, AND renaming/deleting/re-sharing it. Previously the token was only checked on the share-link lookup — a private item's `_id` (handed out the moment anyone opened its link) worked forever on almost every other route, including rename and delete, with no check at all. Regenerating or expiring the token didn't help, because nothing downstream was looking at it. A file/folder's `_id` was never actually secret (it's returned alongside the token in several responses) — the token is what matters, and it's now checked everywhere the id is used.
- **A public item's mutations need no token at all** — same "public means public" rule as reading it. Specifically: going from public → private never needs a token (there isn't one yet), but anything touching an *already*-private item — including flipping it back to public — needs that item's current token, checked against the item's state as it exists right now in the database, not the state the request is trying to move it to. That specific ordering is what stops a stranger from quietly privatizing someone else's public file and keeping the new token for themselves.
- Encrypted files are an exception to the "private needs a token" rule above, but only for *reading* them: their content is ciphertext either way, so the server has nothing meaningful to gate — the client-side AES key is the real (and only) protection, exactly as the zero-knowledge design intends. Mutating an encrypted file (renaming — which is blocked outright since the name is encrypted too — or deleting/re-sharing it) still needs the token: being unreadable doesn't make deleting it a free action. A vault *folder's* own name/metadata is always plain text (only what's inside is per-file encrypted), so folders get no encrypted exception anywhere, read or write.
- Regenerating a share token immediately invalidates the old one everywhere it's checked, mutations included — not just the token-lookup route.
- **Short tokens are a deliberate trade-off.** A 6-character token (36⁶ ≈ 2.18 billion possibilities) is far easier to remember than the old 64-bit one, but weaker against guessing — so the rate limiting is doing real work. Every route that checks a token is limited: the lookups and every rename/delete/visibility/membership route at 30/min, the read-by-id routes (metadata/preview/download) at 60/min, ZIP downloads at 10/min. For something genuinely sensitive, use **encrypted** sharing (the AES key, not the token, is what protects the content) or set an expiry/view limit.
- **Set `TRUST_PROXY` when deployed behind a proxy** (see Environment Variables) — otherwise the per-IP limits above are shared by everyone.
- **Moving a file between folders needs permission on both ends.** Pulling a file out of a private folder requires that folder's token (`sourceToken`), not just the destination's — otherwise anyone who knew a file's id could silently rip it out of someone's private folder.
- Multi-document writes (move/remove a file from a folder, delete a folder, delete a file) run inside MongoDB transactions, so a failure partway through can't leave a file and its folder disagreeing. (Needs a replica set — MongoDB Atlas always is one.)
- Responses carry `Referrer-Policy: no-referrer` (share links contain the token in the URL) and `Strict-Transport-Security`.
- QR codes for share links are generated entirely client-side (see `public/js/vendor/qrcode.js`). This matters specifically for encrypted items, whose link includes the decryption key as a `#key=...` fragment — that fragment is never sent to any server, by anyone, for any reason, including rendering its own QR code.
- Uploaded file content is verified against its declared type using magic-byte signatures, not just the client-reported MIME type (see `verifyMagicBytes` in `controllers/fileUpload.js`).
- Unencrypted uploads get a best-effort malware pre-screen via VirusTotal's hash-lookup API — see `utils/malwareScan.js` for exactly what this does and doesn't catch (it's a known-hash lookup, not a full scan, and fails open if VirusTotal is unreachable or no API key is configured).
- **Encrypted uploads are zero-knowledge by construction**, not just policy: the AES key never appears in any request body, response, log line, or database row this server controls. This also means magic-byte content verification is skipped for encrypted uploads — the server has no plaintext to check, which is the expected cost of not being able to read the file at all.
- Known limitation: encryption happens at upload time only. There's currently no way to encrypt a file that's already been uploaded in plain — that would require downloading, encrypting, and re-uploading it, which isn't implemented yet.
- Known limitation: encrypted files are excluded from folder ZIP downloads (bulk decryption would need a folder-level key exchange, which is a separate future feature, not a silent omission).
- Known limitation: `controllers/linkPreview.js`'s SSRF guard re-validates the target IP on every redirect hop, but there's a narrow window between that check and the actual fetch where a DNS answer could theoretically change (DNS rebinding). Closing this fully needs pinning the validated IP for the actual connection instead of letting the HTTP client re-resolve it, which isn't implemented yet.
- Upload, folder/link creation, and the public gallery/listing endpoints are intentionally open to anyone — that's the "drop box" model this app is built around, not a gap in it.

---

## Author

Built by Saurabh Raj Shekhar using MERN Stack and Supabase Storage.

---

## License

This project is licensed under the ISC License.
