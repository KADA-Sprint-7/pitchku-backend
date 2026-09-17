const { Router } = require("express");
const { DeckPayload } = require("../schemas/slide");
const { requireAuth } = require("../lib/auth");

const projectsRouter = Router();

projectsRouter.get("/", requireAuth, async (req, res) => {
  const { data, error } = await req.db
    .from("projects")
    .select("id, title, template_type, status, updated_at")
    .order("updated_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(
    (data ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      templateType: p.template_type,
      status: p.status,
      updatedAt: p.updated_at,
    }))
  );
});

projectsRouter.post("/", requireAuth, async (req, res) => {
  const parsed = DeckPayload.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Payload deck tidak valid",
      detail: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }
  const d = parsed.data;
  const db = req.db;

  // Frontend membuat UUID proyek sendiri (crypto.randomUUID) sejak wizard,
  // lalu langsung mengirimnya sebagai deckId. Jadi deckId yang belum ada di
  // database berarti proyek baru, bukan alamat yang salah. Kalau tidak dibuat
  // di sini, insert deck_versions di bawah ditolak RLS karena proyeknya tidak
  // ditemukan.
  let projectId = d.deckId;
  let exists = false;
  if (projectId) {
    const { data, error } = await db
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    exists = Boolean(data);
  }

  if (!exists) {
    const { data, error } = await db
      .from("projects")
      .insert({
        ...(projectId && { id: projectId }),
        user_id: req.userId,
        title: d.businessName,
        template_type: d.template,
        status: "draft",
      })
      .select("id")
      .single();
    // RLS menyembunyikan proyek milik orang lain dari select di atas, jadi
    // deckId milik pengguna lain baru ketahuan di sini sebagai primary key
    // yang bentrok.
    if (error?.code === "23505") {
      return res.status(409).json({ error: "deckId sudah dipakai proyek lain" });
    }
    if (error) return res.status(500).json({ error: error.message });
    projectId = data.id;
  }

  const { data: last } = await db
    .from("deck_versions")
    .select("version_number")
    .eq("project_id", projectId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const versionNumber = (last?.version_number ?? 0) + 1;

  // Brand kit ikut disimpan di dalam snapshot, supaya deck lama tidak
  // berubah tampilan waktu pengguna mengganti warna merek bulan depan.
  const { error: verErr } = await db.from("deck_versions").insert({
    project_id: projectId,
    version_number: versionNumber,
    slides_json: { brandKit: d.brandKit, slides: d.slides },
  });
  if (verErr) return res.status(500).json({ error: verErr.message });

  await db
    .from("projects")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", projectId);

  res.status(201).json({ projectId, versionNumber });
});

projectsRouter.get("/:id", requireAuth, async (req, res) => {
  const db = req.db;
  const { data: proj, error } = await db
    .from("projects")
    .select("id, title, template_type")
    .eq("id", req.params.id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!proj) return res.status(404).json({ error: "Proyek tidak ditemukan" });

  const { data: ver } = await db
    .from("deck_versions")
    .select("slides_json")
    .eq("project_id", proj.id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const snap = ver?.slides_json ?? {};
  res.json({
    deckId: proj.id,
    template: proj.template_type,
    businessName: proj.title,
    brandKit: snap.brandKit ?? null,
    slides: snap.slides ?? [],
  });
});

projectsRouter.delete("/:id", requireAuth, async (req, res) => {
  const { error } = await req.db.from("projects").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).end();
});

module.exports = { projectsRouter };
