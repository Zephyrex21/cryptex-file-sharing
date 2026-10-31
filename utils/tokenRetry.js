// Share tokens are short (6 chars, see utils/token.js) and enforced unique by a
// DB index, so two items can — rarely, but increasingly often as the library
// grows — draw the same token. That used to surface as a 500 on upload / link /
// folder creation (after the file was already stored). A duplicate-key error on
// `shareToken` just means "pick another token", so retry with a fresh one.
//
// `fn` MUST generate its token inside the call (so each attempt gets a new one).
// Any other error — including a duplicate on some other field — is rethrown at
// once; after `attempts` genuine collisions in a row the last error is thrown.
export const isTokenCollision = (e) =>
  e?.code === 11000 && (e.keyPattern?.shareToken !== undefined || /shareToken/.test(e.message || ""));

export const withTokenRetry = async (fn, attempts = 5) => {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!isTokenCollision(e)) throw e;
      last = e;
    }
  }
  throw last;
};
