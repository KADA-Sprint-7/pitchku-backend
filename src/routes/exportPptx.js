const { Router } = require("express");
const { DeckPayload } = require("../schemas/slide");
const { renderPptx, buildFileName } = require("../services/pptx");
const { requireAuth } = require("../lib/auth");

const exportRouter = Router();

exportRouter.post("/pptx", requireAuth, async (req, res) => {
  const parsed = DeckPayload.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Payload deck tidak lolos skema",
      detail: parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    });
  }

  const { slides, brandKit, businessName, template } = parsed.data;
  try {
    const buf = await renderPptx({ slides, brandKit, businessName });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${buildFileName(businessName, template)}"`
    );
    res.setHeader("Content-Length", String(buf.length));
    res.end(buf);
  } catch (e) {
    res.status(500).json({ error: "Ekspor PPTX gagal", detail: e?.message });
  }
});

module.exports = { exportRouter };
