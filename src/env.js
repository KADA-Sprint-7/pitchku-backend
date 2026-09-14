require("dotenv/config");

/**
 * Menerima beberapa nama sekaligus, memakai yang pertama terisi.
 *
 * Supabase mengganti nama kunci API-nya: proyek baru sekarang diberi
 * sb_publishable_... dan sb_secret_... dengan label PUBLISHABLE dan SECRET,
 * sementara proyek lama memakai ANON dan SERVICE_ROLE. Keduanya dipasang
 * di slot yang sama di @supabase/supabase-js, jadi dua-duanya diterima
 * daripada memaksa anggota tim menyalin ulang .env mereka.
 */
function need(...keys) {
  for (const key of keys) {
    if (process.env[key]) return process.env[key];
  }
  throw new Error(`Env ${keys.join(" atau ")} belum diisi. Lihat .env.example`);
}

function optional(...keys) {
  for (const key of keys) {
    if (process.env[key]) return process.env[key];
  }
  return "";
}

/**
 * need() sengaja melempar saat modul dimuat, bukan saat permintaan masuk.
 * Di Render itu berarti deploy langsung gagal dengan pesan jelas di log,
 * bukan service yang naik lalu balas 500 ke setiap pengguna.
 */
const env = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",

  /** URL publik backend ini. Dipakai Swagger di /docs. Kosong = lokal saja. */
  publicUrl: (process.env.PUBLIC_URL ?? "").replace(/\/$/, ""),

  supabaseUrl: need("SUPABASE_URL"),
  supabaseAnonKey: need("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY"),
  supabaseServiceKey: optional("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"),

  /* ---- pitchku-ai ---- */

  aiServiceUrl: (process.env.AI_SERVICE_URL ?? "http://localhost:4001").replace(
    /\/$/,
    ""
  ),

  /** Kunci bersama dengan INTERNAL_API_KEY di pitchku-ai. */
  internalApiKey: process.env.INTERNAL_API_KEY ?? "",

  /**
   * Harus lebih longgar daripada AI_TIMEOUT_MS x 3 di pitchku-ai, karena
   * di sana satu permintaan bisa dicoba sampai tiga kali. Kalau lebih ketat,
   * backend menyerah sementara pitchku-ai masih bekerja - token terbakar
   * tanpa hasil. Lihat DEPLOY.md soal batas waktu di Render.
   */
  aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 150000),

  /** Dipakai sebagai label log kalau pitchku-ai tidak menyebut nama model. */
  llmModel: process.env.LLM_MODEL ?? "gemini-2.0-flash",

  /** Nol = free tier. Lihat estimateCost() di services/ai.js. */
  pricePerMillionInput: Number(process.env.LLM_PRICE_INPUT_PER_1M ?? 0),
  pricePerMillionOutput: Number(process.env.LLM_PRICE_OUTPUT_PER_1M ?? 0),

  unsplashKey: process.env.UNSPLASH_ACCESS_KEY ?? "",
};

module.exports = { env };
