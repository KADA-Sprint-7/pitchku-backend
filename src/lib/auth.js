const { createClient } = require("@supabase/supabase-js");
const { env } = require("../env");
const { userClient } = require("./supabase");

/**
 * CARA AUTH BEKERJA
 *
 * Backend tidak pernah memegang password, termasuk untuk Google OAuth.
 *
 *  1. Frontend (Daffa) login langsung ke Supabase pakai @supabase/supabase-js
 *  2. Supabase mengembalikan access_token berupa JWT
 *  3. Frontend kirim ke backend: Authorization: Bearer <token>
 *  4. Middleware ini memverifikasi token lalu menyiapkan req.db
 *
 * Google OAuth tidak butuh kode tambahan di backend. Alurnya sama;
 * yang beda hanya cara frontend mendapatkan token.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Token tidak ada" });

  const anon = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await anon.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ error: "Token tidak valid atau kedaluwarsa" });
  }

  req.userId = data.user.id;
  req.userEmail = data.user.email ?? null;
  req.accessToken = token;
  req.db = userClient(token);
  next();
}

module.exports = { requireAuth };
