const { Router } = require("express");
const { DeckInput } = require("../schemas/slide");
const { requireAuth } = require("../lib/auth");

const projectsRouter = Router();

/**
 * Frontend memakai "selesai", bukan "completed" (lihat migrasi 003).
 * Baris lama yang masih "completed" tetap dibaca sebagai selesai.
 */
const toFrontendStatus = (s) =>
  s === "selesai" || s === "completed" ? "selesai" : "draft";

/** JSON dengan urutan kunci tetap. jsonb di Postgres tidak menyimpan urutan kunci. */
function stableJson(value) {
  const walk = (v) => {
    if (Array.isArray(v)) return `[${v.map(walk).join(",")}]`;
    if (v && typeof v === "object") {
      return `{${Object.keys(v)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${walk(v[k])}`)
        .join(",")}}`;
    }
    return JSON.stringify(v);
  };
  return walk(JSON.parse(JSON.stringify(value ?? null)));
}

function badDeck(res, parsed) {
  return res.status(400).json({
    error: "Payload deck tidak valid",
    detail: parsed.error.issues
      .map((i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message)
      .join("; "),
  });
}

projectsRouter.get("/", requireAuth, async (req, res) => {
  // Versi terbaru ikut diambil supaya kartu di dashboard menampilkan jumlah
  // slide yang sebenarnya, bukan angka bawaan 8.
  const { data, error } = await req.db
    .from("projects")
    .select(
      "id, title, template_type, status, updated_at, deck_versions(version_number, slides:slides_json->slides)"
    )
    .order("updated_at", { ascending: false })
    .order("version_number", { referencedTable: "deck_versions", ascending: false })
    .limit(1, { referencedTable: "deck_versions" });

  if (error) return res.status(500).json({ error: error.message });
  res.json(
    (data ?? []).map((p) => {
      const slides = p.deck_versions?.[0]?.slides;
      return {
        id: p.id,
        title: p.title,
        templateType: p.template_type,
        status: toFrontendStatus(p.status),
        updatedAt: p.updated_at,
        slideCount: Array.isArray(slides) ? slides.length : 0,
      };
    })
  );
});

async function findProject(db, id) {
  const { data, error } = await db.from("projects").select("id").eq("id", id).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

projectsRouter.post("/", requireAuth, async (req, res) => {
  const parsed = DeckInput.safeParse(req.body);
  if (!parsed.success) return badDeck(res, parsed);
  const d = parsed.data;
  const db = req.db;

  try {
    // Frontend membuat UUID proyek sendiri (crypto.randomUUID) sejak wizard,
    // lalu langsung mengirimnya sebagai deckId. Jadi deckId yang belum ada di
    // database berarti proyek baru, bukan alamat yang salah. Kalau tidak dibuat
    // di sini, insert deck_versions di bawah ditolak RLS karena proyeknya tidak
    // ditemukan.
    let projectId = d.deckId;
    const exists = projectId ? await findProject(db, projectId) : false;

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

      if (error?.code === "23505") {
        // Dua kemungkinan. Frontend juga meng-upsert tabel projects langsung
        // dan autosave bisa berjalan bersamaan, jadi proyek milik pengguna
        // ini bisa saja baru dibuat sepersekian detik lalu. Kalau tidak
        // terlihat, RLS menyembunyikannya: id itu milik pengguna lain.
        if (!(await findProject(db, projectId))) {
          return res.status(409).json({ error: "deckId sudah dipakai proyek lain" });
        }
      } else if (error) {
        return res.status(500).json({ error: error.message });
      } else {
        projectId = data.id;
      }
    }

    // Brand kit ikut disimpan di dalam snapshot, supaya deck lama tidak
    // berubah tampilan waktu pengguna mengganti warna merek bulan depan.
    const snapshot = { brandKit: d.brandKit, slides: d.slides };

    // Editor menyimpan otomatis hampir di setiap perubahan, termasuk yang
    // tidak mengubah isi deck (misalnya status). Versi yang identik dengan
    // versi terakhir tidak dijadikan baris baru. Nomor versi bisa bentrok
    // kalau dua autosave datang bersamaan, jadi dicoba ulang.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: last, error: lastErr } = await db
        .from("deck_versions")
        .select("version_number, slides_json")
        .eq("project_id", projectId)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastErr) return res.status(500).json({ error: lastErr.message });

      if (last && stableJson(last.slides_json) === stableJson(snapshot)) {
        return res.json({ projectId, versionNumber: last.version_number, unchanged: true });
      }

      const versionNumber = (last?.version_number ?? 0) + 1;
      const { error: verErr } = await db.from("deck_versions").insert({
        project_id: projectId,
        version_number: versionNumber,
        slides_json: snapshot,
      });
      if (verErr?.code === "23505") continue;
      if (verErr) return res.status(500).json({ error: verErr.message });

      await db
        .from("projects")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", projectId);

      return res.status(201).json({ projectId, versionNumber });
    }

    return res.status(409).json({ error: "Deck sedang disimpan bersamaan, coba lagi" });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Gagal menyimpan proyek" });
  }
});

projectsRouter.get("/:id", requireAuth, async (req, res) => {
  const db = req.db;
  const { data: proj, error } = await db
    .from("projects")
    .select("id, title, template_type, status, updated_at")
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
    title: proj.title,
    status: toFrontendStatus(proj.status),
    updatedAt: proj.updated_at,
    brandKit: snap.brandKit ?? null,
    slides: snap.slides ?? [],
  });
});

// Dibalas 200 dengan JSON, bukan 204. fetchApi di frontend selalu memanggil
// response.json(), dan body kosong membuatnya melempar error sehingga
// penghapusan yang berhasil tampil sebagai gagal.
projectsRouter.delete("/:id", requireAuth, async (req, res) => {
  const { error } = await req.db.from("projects").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, id: req.params.id });
});

module.exports = { projectsRouter };
