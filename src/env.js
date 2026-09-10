require("dotenv/config");

function need(key) {
  const v = process.env[key];
  if (!v) throw new Error(`Env ${key} belum diisi. Lihat .env.example`);
  return v;
}

const env = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  supabaseUrl: need("SUPABASE_URL"),
  supabaseAnonKey: need("SUPABASE_ANON_KEY"),
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  llmApiKey: process.env.LLM_API_KEY ?? "",
  llmModel: process.env.LLM_MODEL ?? "claude-sonnet-4-6",
  unsplashKey: process.env.UNSPLASH_ACCESS_KEY ?? "",
};

module.exports = { env };
