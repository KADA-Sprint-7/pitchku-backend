const { Router } = require("express");
const { z, BusinessContext, OutlineItem, NeedInput } = require("../schemas/slide");
const {
  diagnoseNeed,
  generateOutline,
  generateSlides,
  estimateCost,
} = require("../services/ai");
const { requireAuth } = require("../lib/auth");
const { adminClient } = require("../lib/supabase");
const { env } = require("../env");

const generateRouter = Router();

async function logGeneration(row) {
  try {
    await adminClient().from("generation_logs").insert({
      project_id: row.projectId ?? null,
      stage: row.stage,
      // Label dari services/ai.js: LLM_MODEL untuk panggilan pitchku-ai,
      // atau "aturan-kata-kunci" untuk diagnosa.
      model_name: String(row.model ?? env.llmModel).slice(0, 50),
      prompt_tokens: row.promptTokens ?? 0,
      completion_tokens: row.completionTokens ?? 0,
      duration_ms: row.durationMs,
      estimated_cost_usd: row.cost ?? 0,
      status: row.status,
      error_message: row.error ?? null,
    });
  } catch {
    // Logging gagal tidak boleh menjatuhkan permintaan pengguna.
  }
}

function badRequest(res, parsed) {
  return res.status(400).json({
    error: "Permintaan tidak valid",
    detail: parsed.error.issues
      .map((i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message)
      .join("; "),
  });
}

/**
 * TAHAP 0 — Diagnosa kebutuhan
 *
 * Pintu masuk untuk pengguna yang belum tahu dokumen apa yang dia butuhkan.
 * Satu pertanyaan terbuka, sistem yang menyarankan.
 */
generateRouter.post("/diagnose", requireAuth, async (req, res) => {
  const parsed = NeedInput.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed);

  const t0 = Date.now();
  try {
    const { diagnosis, usage, attempts } = await diagnoseNeed(parsed.data.need);
    const cost = estimateCost(usage);
    await logGeneration({
      stage: "diagnose",
      ...usage,
      durationMs: Date.now() - t0,
      cost,
      status: attempts > 1 ? "retry" : "success",
    });
    res.json({
      ...diagnosis,
      usage: { ...usage, estimatedCostUsd: Number(cost.toFixed(6)) },
      attempts,
    });
  } catch (e) {
    await logGeneration({
      stage: "diagnose",
      // Token yang sudah terbakar di pitchku-ai walau hasilnya gagal.
      // Kuota tetap habis, jadi tetap dicatat.
      ...(e?.usage ?? {}),
      cost: estimateCost(e?.usage),
      durationMs: Date.now() - t0,
      status: "failed",
      error: e?.message,
    });
    res.status(502).json({ error: "Diagnosa gagal", detail: e?.message });
  }
});

/** TAHAP 1 — Kerangka slide */
generateRouter.post("/outline", requireAuth, async (req, res) => {
  const parsed = BusinessContext.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed);

  const t0 = Date.now();
  try {
    const { outline, usage, attempts } = await generateOutline(parsed.data);
    const cost = estimateCost(usage);
    await logGeneration({
      stage: "outline",
      ...usage,
      durationMs: Date.now() - t0,
      cost,
      status: attempts > 1 ? "retry" : "success",
    });
    res.json({
      outline,
      usage: { ...usage, estimatedCostUsd: Number(cost.toFixed(6)) },
      attempts,
    });
  } catch (e) {
    await logGeneration({
      stage: "outline",
      ...(e?.usage ?? {}),
      cost: estimateCost(e?.usage),
      durationMs: Date.now() - t0,
      status: "failed",
      error: e?.message,
    });
    res.status(502).json({ error: "Kerangka gagal dibuat", detail: e?.message });
  }
});

const SlidesBody = z.object({
  context: BusinessContext,
  // Kerangka sudah disunting pengguna di halaman outline: slide boleh
  // ditambah atau dihapus, dan tujuan slide tidak dibatasi panjangnya di
  // sana. Dipotong ke batas kontrak, bukan ditolak.
  outline: z.preprocess(
    (items) =>
      Array.isArray(items)
        ? items.map((o) => ({
            title: String(o?.title ?? "").slice(0, 60),
            objective: String(o?.objective ?? "").slice(0, 160),
          }))
        : items,
    z.array(OutlineItem).min(1).max(15)
  ),
});

/** TAHAP 2 — Isi slide */
generateRouter.post("/slides", requireAuth, async (req, res) => {
  const parsed = SlidesBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed);

  const t0 = Date.now();
  try {
    const { slides, usage, attempts } = await generateSlides(
      parsed.data.context,
      parsed.data.outline
    );
    const cost = estimateCost(usage);
    await logGeneration({
      stage: "content",
      ...usage,
      durationMs: Date.now() - t0,
      cost,
      status: attempts > 1 ? "retry" : "success",
    });
    res.json({
      slides,
      usage: { ...usage, estimatedCostUsd: Number(cost.toFixed(6)) },
      attempts,
    });
  } catch (e) {
    await logGeneration({
      stage: "content",
      ...(e?.usage ?? {}),
      cost: estimateCost(e?.usage),
      durationMs: Date.now() - t0,
      status: "failed",
      error: e?.message,
    });
    res.status(502).json({ error: "Isi slide gagal dibuat", detail: e?.message });
  }
});

module.exports = { generateRouter };
