const { Router } = require("express");
const { DeckInput } = require("../schemas/slide");
const { renderPptx, buildFileName } = require("../services/pptx");
const { requireAuth } = require("../lib/auth");

const exportRouter = Router();

exportRouter.post("/pptx", requireAuth, async (req, res) => {
  const parsed = DeckInput.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Payload deck tidak lolos skema",
      detail: parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    });
  }

  const { deckId, slides, brandKit, businessName, template } = parsed.data;
  let { deckTitle } = parsed.data;

  // Footer kanvas editor memakai judul proyek (bisa di-rename di header
  // editor), tapi frontend tidak mengirim deckTitle. Judul itu diambil dari
  // tabel projects, yang di-upsert frontend setiap kali proyek berubah.
  if (!deckTitle && deckId) {
    try {
      const { data } = await req.db
        .from("projects")
        .select("title")
        .eq("id", deckId)
        .maybeSingle();
      deckTitle = data?.title ?? undefined;
    } catch {
      // Judul footer bukan alasan untuk menggagalkan ekspor.
    }
  }

  try {
    const buf = await renderPptx({ slides, brandKit, businessName, deckTitle });
    const fileName = buildFileName(businessName, template);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );
    // Header HTTP hanya boleh latin1. Nama usaha dengan huruf di luar itu
    // membuat setHeader melempar dan seluruh ekspor gagal 500.
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName.replace(/[^\x20-\x7E]/g, "_")}"; ` +
        `filename*=UTF-8''${encodeURIComponent(fileName)}`
    );
    res.setHeader("Content-Length", String(buf.length));
    res.end(buf);
  } catch (e) {
    res.status(500).json({ error: "Ekspor PPTX gagal", detail: e?.message });
  }
});

module.exports = { exportRouter };
