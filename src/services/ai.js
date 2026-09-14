const { env } = require("../env");
const { z, OutlineItem, Slide, Diagnosis } = require("../schemas/slide");

/**
 * KLIEN pitchku-ai
 *
 * Semua prompt, percobaan ulang, dan pemilihan model tinggal di repo
 * pitchku-ai. Backend hanya memanggil tiga tahap, memvalidasi ulang
 * hasilnya terhadap kontrak kanonik, lalu menomori slide.
 *
 * Kenapa divalidasi dua kali? pitchku-ai memvalidasi terhadap cerminan
 * kontrak (src/contract/pitchku.contract.js). Kalau cerminan itu suatu saat
 * tertinggal dari schemas/slide.js, validasi di sini yang menangkapnya -
 * jadi data yang tidak sesuai kontrak tidak pernah sampai ke database
 * atau ke mesin ekspor PPTX.
 */

async function callAI(stage, body) {
  const headers = { "content-type": "application/json" };

  // Kunci antar-service. Tanpa ini pitchku-ai menolak dengan 401 -
  // kecuali INTERNAL_API_KEY di sana juga kosong (mode development).
  if (env.internalApiKey) headers["x-internal-key"] = env.internalApiKey;

  let res;
  try {
    res = await fetch(`${env.aiServiceUrl}/api/v1/generate/${stage}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(env.aiTimeoutMs),
    });
  } catch (e) {
    // Paling sering: pitchku-ai sedang bangun dari tidur di Render free tier.
    const reason =
      e?.name === "TimeoutError"
        ? `tidak menjawab dalam ${env.aiTimeoutMs / 1000} detik`
        : e?.message;
    throw new Error(`Layanan AI tidak bisa dihubungi (${reason})`);
  }

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    const error = new Error(
      payload?.detail ?? payload?.error ?? `pitchku-ai membalas ${res.status}`
    );
    // pitchku-ai menyertakan token yang sudah terpakai walau gagal.
    // Kuota tetap terbakar, jadi tetap dicatat.
    error.usage = payload?.usage;
    error.attempts = payload?.attempts;
    throw error;
  }

  return payload;
}

/** Bentuk usage yang dijamin ada, supaya pemanggil tidak perlu cek null. */
function usageOf(payload) {
  return {
    promptTokens: payload?.usage?.promptTokens ?? 0,
    completionTokens: payload?.usage?.completionTokens ?? 0,
    model: payload?.usage?.model ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* TAHAP 0 - Diagnosa kebutuhan                                        */
/* ------------------------------------------------------------------ */

async function diagnoseNeed(need) {
  const t0 = Date.now();
  const payload = await callAI("diagnose", { need });

  return {
    diagnosis: Diagnosis.parse(payload.diagnosis),
    usage: usageOf(payload),
    attempts: payload.attempts ?? 1,
    durationMs: Date.now() - t0,
  };
}

/* ------------------------------------------------------------------ */
/* TAHAP 1 - Kerangka slide                                            */
/* ------------------------------------------------------------------ */

const OutlineArray = z.array(OutlineItem).min(5).max(10);

async function generateOutline(ctx) {
  const payload = await callAI("outline", {
    template: ctx.template,
    businessName: ctx.businessName,
    brief: ctx.brief,
    audience: ctx.audience,
  });

  return {
    outline: OutlineArray.parse(payload.outline),
    usage: usageOf(payload),
    attempts: payload.attempts ?? 1,
  };
}

/* ------------------------------------------------------------------ */
/* TAHAP 2 - Isi slide                                                 */
/* ------------------------------------------------------------------ */

const SlideDraftArray = z.array(Slide.omit({ slideNumber: true })).min(3).max(12);

async function generateSlides(ctx, outline) {
  const payload = await callAI("slides", {
    context: {
      template: ctx.template,
      businessName: ctx.businessName,
      brief: ctx.brief,
      audience: ctx.audience,
    },
    outline,
  });

  const drafts = SlideDraftArray.parse(payload.slides);

  return {
    // Nomor slide ditentukan di sini, bukan oleh model. Urutan array
    // adalah satu-satunya sumber kebenaran.
    slides: drafts.map((s, i) => ({ ...s, slideNumber: i + 1 })),
    usage: usageOf(payload),
    attempts: payload.attempts ?? 1,
  };
}

/* ------------------------------------------------------------------ */
/* Estimasi biaya                                                      */
/* ------------------------------------------------------------------ */

/**
 * Nol selama memakai free tier Gemini. Kalau nanti pindah ke model berbayar,
 * isi LLM_PRICE_INPUT_PER_1M dan LLM_PRICE_OUTPUT_PER_1M supaya
 * generation_logs.estimated_cost_usd ikut terisi tanpa ubah kode.
 */
function estimateCost(usage) {
  const input = (usage?.promptTokens ?? 0) * (env.pricePerMillionInput / 1e6);
  const output = (usage?.completionTokens ?? 0) * (env.pricePerMillionOutput / 1e6);
  return input + output;
}

module.exports = {
  diagnoseNeed,
  generateOutline,
  generateSlides,
  estimateCost,
};
