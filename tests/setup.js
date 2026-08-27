// Importing controllers/fileUpload.js creates a Supabase client as a
// module-level side effect (config/supabase.js), which throws if these
// aren't set — even though the tests here never actually call Supabase.
// Dummy values are enough since no real request is made.
process.env.SUPABASE_URL ||= "https://dummy.supabase.co";
process.env.SUPABASE_SERVICE_KEY ||= "dummy-key-for-tests";
