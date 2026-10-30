// Opt-in cleanup of private files whose share token expired long ago.
//
// Expiry used to strand data: an expired private file couldn't be touched, so
// its bytes sat in storage forever. Owners can now delete it themselves (an
// expired-but-current token still authorizes DELETE). For items nobody comes
// back to, set PURGE_EXPIRED_AFTER_DAYS=N and this job deletes private files
// that expired more than N days ago. OFF unless that env var is set — it never
// deletes anything by default.
//
// Storage is removed FIRST and the DB row only if that succeeded, so a storage
// failure is simply retried on the next run instead of orphaning bytes.
export const purgeExpiredPrivateFiles = async ({ File, Folder, supabase, bucket, olderThanDays, now = new Date(), batch = 100 }) => {
  const cutoff = new Date(now.getTime() - olderThanDays * 86_400_000);
  const docs = await File.find({
    visibility: "private",
    tokenExpiresAt: { $ne: null, $lt: cutoff },
  }).limit(batch);

  let purged = 0, failed = 0;
  for (const f of docs) {
    try {
      const storagePath = f.filePath || f.cloudinaryId;
      if (storagePath) {
        const { error } = await supabase.storage.from(bucket).remove([storagePath]);
        if (error) throw new Error(error.message);
      }
      if (f.folderId) await Folder.findByIdAndUpdate(f.folderId, { $pull: { files: f._id } });
      await f.deleteOne();
      purged++;
    } catch (e) {
      failed++;
      console.warn(`Expired-file purge skipped ${f._id}: ${e.message}`);
    }
  }
  return { purged, failed };
};
