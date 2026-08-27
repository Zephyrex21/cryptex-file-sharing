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
- Unique share token generated for every file and folder
- Access shared content without exposing database IDs
- Easy and secure sharing mechanism
- Expiring tokens, with one-click regeneration to rotate a leaked token

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
| PATCH | `/api/files/:id` | Rename file |
| PATCH | `/api/files/:id/visibility` | Change visibility |
| DELETE | `/api/files/:id` | Delete file |
| GET | `/api/files/token/:token` | Access via token |

> `POST /api/files/upload` accepts an optional encrypted-upload contract: multipart fields `encrypted=true`, `iv`, `encryptedName`, `encryptedNameIV`, `encryptedMimeType`, `encryptedMimeTypeIV` alongside `file` (sent as ciphertext, `application/octet-stream`). See `controllers/fileUpload.js` and `public/js/app.js` for the client/server contract.

---

### Folder Routes

| Method | Endpoint | Description |
|----------|----------|-------------|
| POST | `/api/folders` | Create folder |
| GET | `/api/folders` | Get folders |
| GET | `/api/folders/:id` | Folder details |
| PATCH | `/api/folders/:id` | Rename folder |
| PATCH | `/api/folders/:id/visibility` | Change visibility |
| DELETE | `/api/folders/:id` | Delete folder |
| POST | `/api/folders/:id/files` | Add file to folder |
| DELETE | `/api/folders/:id/files/:fileId` | Remove file from folder |
| GET | `/api/folders/token/:token` | Access via token |

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

- Sensitive credentials are stored in environment variables.
- Database IDs are never exposed for sharing.
- Supabase Service Role Key remains server-side.
- Private files can only be accessed through their token.
- Uploaded file content is verified against its declared type using magic-byte signatures, not just the client-reported MIME type (see `verifyMagicBytes` in `controllers/fileUpload.js`).
- Unencrypted uploads get a best-effort malware pre-screen via VirusTotal's hash-lookup API — see `utils/malwareScan.js` for exactly what this does and doesn't catch (it's a known-hash lookup, not a full scan, and fails open if VirusTotal is unreachable or no API key is configured).
- **Encrypted uploads are zero-knowledge by construction**, not just policy: the AES key never appears in any request body, response, log line, or database row this server controls. This also means magic-byte content verification is skipped for encrypted uploads — the server has no plaintext to check, which is the expected cost of not being able to read the file at all.
- Known limitation: encryption happens at upload time only. There's currently no way to encrypt a file that's already been uploaded in plain — that would require downloading, encrypting, and re-uploading it, which isn't implemented yet.
- Known limitation: encrypted files are excluded from folder ZIP downloads (bulk decryption would need a folder-level key exchange, which is a separate future feature, not a silent omission).

---

## Author

Built by Saurabh Raj Shekhar using MERN Stack and Supabase Storage.

---

## License

This project is licensed under the ISC License.
