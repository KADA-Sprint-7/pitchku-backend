const { Router } = require("express");
const { BrandKit } = require("../schemas/slide");
const { requireAuth } = require("../lib/auth");

const brandKitRouter = Router();

brandKitRouter.get("/", requireAuth, async (req, res) => {
  const { data, error } = await req.db
    .from("brand_kits")
    .select("logo_url, primary_color, accent_color, font_family")
    .eq("user_id", req.userId)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });

  if (!data) {
    return res.json({
      logoUrl: null,
      primaryColor: "#0F4C81",
      accentColor: "#F2A007",
      fontFamily: "Inter",
    });
  }
  res.json({
    logoUrl: data.logo_url,
    primaryColor: data.primary_color,
    accentColor: data.accent_color,
    fontFamily: data.font_family,
  });
});

async function saveBrandKit(req, res) {
  const parsed = BrandKit.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Brand kit tidak valid",
      detail: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }
  const b = parsed.data;
  const { error } = await req.db.from("brand_kits").upsert(
    {
      user_id: req.userId,
      logo_url: b.logoUrl ?? null,
      primary_color: b.primaryColor,
      accent_color: b.accentColor,
      font_family: b.fontFamily,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) return res.status(500).json({ error: error.message });
  res.json(b);
}

brandKitRouter.put("/", requireAuth, saveBrandKit);
// saveBrandKitApi di frontend memakai POST.
brandKitRouter.post("/", requireAuth, saveBrandKit);

module.exports = { brandKitRouter };
