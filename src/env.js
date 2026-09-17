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

  /*
   * optional() dipakai, bukan `??`. Baris kosong seperti "AI_TIMEOUT_MS=" di
   * .env menghasilkan string kosong, dan Number("") = 0 membuat setiap
   * panggilan AI langsung dibatalkan.
   */

  /** Alamat service pitchku-ai, tanpa garis miring di akhir. */
  aiServiceUrl: (optional("AI_SERVICE_URL") || "http://localhost:4001").replace(/\/$/, ""),

  /** Dikirim sebagai x-internal-key. pitchku-ai saat ini belum memeriksanya. */
  internalApiKey: optional("INTERNAL_API_KEY"),

  /**
   * Satu deck dibuat dalam satu panggilan ke /api/v1/decks/generate, dan
   * model lokal lewat Ollama bisa butuh beberapa menit untuk 10 slide.
   */
  aiTimeoutMs: Number(optional("AI_TIMEOUT_MS")) || 180000,

  /** Label model di generation_logs. pitchku-ai tidak menyebut model yang dipakai. */
  llmModel: optional("LLM_MODEL") || "pitchku-ai",

  /** Nol = free tier. Lihat estimateCost() di services/ai.js. */
  pricePerMillionInput: Number(process.env.LLM_PRICE_INPUT_PER_1M ?? 0),
  pricePerMillionOutput: Number(process.env.LLM_PRICE_OUTPUT_PER_1M ?? 0),

  unsplashKey: process.env.UNSPLASH_ACCESS_KEY ?? "",
};

module.exports = { env };
