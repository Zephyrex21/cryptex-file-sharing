import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

// Cryptex only uses Supabase *Storage* (upload, download, move, remove, signed
// URLs) over plain HTTPS. It never opens a Realtime channel.
//
// supabase-js nevertheless builds a RealtimeClient eagerly, and on Node < 22
// (no native WebSocket) current versions throw right here, at construction time
// — which takes down the whole server and every test that imports this file
// ("Node.js 20 detected without native WebSocket support"). Passing an explicit
// transport skips that environment detection altogether. The stub is never
// instantiated unless someone actually tries to open a Realtime channel, and
// then it fails loudly with an explanation instead of an obscure Node-version error.
class RealtimeNotEnabled {
  constructor() {
    throw new Error(
      "Supabase Realtime is not enabled in this app. Cryptex only uses Storage; " +
        "to use Realtime, install `ws` and pass it as `realtime.transport` in config/supabase.js."
    );
  }
}

// Using the service_role key (NOT anon key) so server-side uploads
// bypass Supabase Row Level Security completely. Never expose this key
// to the browser — it lives only in your .env on the server.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { realtime: { transport: RealtimeNotEnabled } }
);

export default supabase;
