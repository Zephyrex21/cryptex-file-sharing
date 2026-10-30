// Optional global storage cap. This app has no accounts, so anyone can upload —
// without a ceiling, one script can fill the Supabase quota (free tier: 1 GB)
// and take uploads down for everybody. Set MAX_TOTAL_STORAGE_MB (e.g. 800 on the
// free tier) to enable; unset/0 = off, so nothing changes unless you opt in.
//
// The running total is cached for 30 s (one aggregate query per window, not one
// per upload) and bumped optimistically as uploads are admitted. It fails OPEN:
// a database hiccup here must not turn into refusing every upload.
const WINDOW_MS = 30_000;
let cache = { total: 0, at: 0 };

export const resetStorageQuotaCache = () => { cache = { total: 0, at: 0 }; };

export const hasStorageRoom = async (incomingBytes, FileModel, now = Date.now()) => {
  const capMb = Number(process.env.MAX_TOTAL_STORAGE_MB);
  if (!(capMb > 0)) return { ok: true };
  try {
    if (now - cache.at > WINDOW_MS) {
      const r = await FileModel.aggregate([{ $group: { _id: null, total: { $sum: "$fileSize" } } }]);
      cache = { total: r[0]?.total || 0, at: now };
    }
  } catch (e) {
    console.warn(`Storage quota check skipped: ${e.message}`);
    return { ok: true };
  }
  const ok = cache.total + incomingBytes <= capMb * 1024 * 1024;
  if (ok) cache.total += incomingBytes;
  return { ok, used: cache.total };
};
