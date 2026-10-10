import crypto from "crypto";

// ── Share token generation ───────────────────────────────────────────────────
// Was a 16-character hex string (64 bits) — cryptographically strong, but
// nobody can read one out loud or recall it a minute later. Switched to a
// 6-character token drawn from a 36-character alphabet (0-9, lowercase a-z):
// 36^6 ≈ 2.18 billion possible values. Lowercase-only avoids the "is that a
// capital I or a lowercase l" confusion a mixed-case token would introduce,
// which matters more than raw entropy for something meant to be typed from
// memory or read over a call.
//
// That's a real, deliberate trade-off against the rate limiting every token-
// checking route already has (30 attempts/minute, shared per IP) — brute-
// forcing a single token end-to-end from one source is still well into
// "months, not minutes" territory, but it's not the 64-bit-strength margin
// the old token had. Fine for a personal share link; worth knowing if this
// is ever used for something more sensitive than it is today.
//
// Existing tokens already in the database (16 hex chars) are untouched and
// keep working exactly as before — this only applies going forward, to
// newly-created items or ones that have their token explicitly regenerated.
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const TOKEN_LENGTH = 6;

export const generateToken = (length = TOKEN_LENGTH) => {
  let token = "";
  for (let i = 0; i < length; i++) {
    // crypto.randomInt is uniformly distributed (unlike `randomBytes() %
    // alphabet.length`, which would very slightly favor some characters)
    // and still backed by the OS CSPRNG.
    token += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return token;
};
