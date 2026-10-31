// One place that turns an unexpected exception into an API response.
//
// Controllers used to send `e.message` straight to the client on any failure,
// which leaks internals (Mongo cast errors quote the offending value and field
// paths, storage errors name buckets/paths, validation errors expose the
// schema). Clients now get a stable, generic message; the real error goes to
// the server log. A malformed id (Mongoose CastError) is the CALLER's mistake,
// so it's a 400, not a 500.
export const serverError = (res, e) => {
  if (e?.name === "CastError") return res.status(400).json({ message: "Invalid id" });
  if (e?.name === "ValidationError") return res.status(400).json({ message: "Invalid request" });
  console.error(e);
  return res.status(500).json({ message: "Something went wrong — please try again" });
};
