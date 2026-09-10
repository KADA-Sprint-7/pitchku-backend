const { createClient } = require("@supabase/supabase-js");
const { env } = require("../env");

/**
 * Klien per-permintaan yang membawa JWT pengguna.
 * Dengan token pengguna, semua query otomatis tunduk pada Row Level Security,
 * jadi backend tidak perlu (dan tidak bisa lupa) mengecek user_id manual.
 */
function userClient(accessToken) {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Hanya untuk pekerjaan sistem (mis. tulis generation_logs). Melewati RLS. */
function adminClient() {
  if (!env.supabaseServiceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY belum diisi");
  }
  return createClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

module.exports = { userClient, adminClient };
