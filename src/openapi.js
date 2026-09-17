const {
  OpenApiGeneratorV3,
  OpenAPIRegistry,
} = require("@asteasolutions/zod-to-openapi");
const {
  z,
  BrandKit,
  BusinessContext,
  DeckPayload,
  ErrorBody,
  OutlineItem,
  Slide,
  TemplateId,
  NeedInput,
  Diagnosis,
} = require("./schemas/slide");
const { env } = require("./env");

const registry = new OpenAPIRegistry();

const bearer = registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description:
    "Access token dari Supabase Auth. Frontend login langsung ke Supabase, " +
    "lalu kirim token-nya di header Authorization.",
});

const auth = [{ [bearer.name]: [] }];

const json = (schema) => ({
  content: { "application/json": { schema } },
});

/* ---------------- Health ---------------- */

registry.registerPath({
  method: "get",
  path: "/health",
  tags: ["Sistem"],
  summary: "Cek server hidup",
  responses: {
    200: {
      description: "Server sehat",
      ...json(z.object({ ok: z.literal(true), version: z.string() })),
    },
  },
});

/* ---------------- Brand Kit ---------------- */

registry.registerPath({
  method: "get",
  path: "/api/brand-kit",
  tags: ["Brand Kit"],
  summary: "Ambil brand kit milik pengguna",
  security: auth,
  responses: {
    200: { description: "Brand kit aktif", ...json(BrandKit) },
    401: { description: "Belum login", ...json(ErrorBody) },
  },
});

registry.registerPath({
  method: "put",
  path: "/api/brand-kit",
  tags: ["Brand Kit"],
  summary: "Simpan warna dan logo",
  description:
    "Satu pengguna hanya punya satu brand kit. Tabel brand_kits diberi " +
    "UNIQUE (user_id) supaya tidak ada baris ganda tanpa penanda mana yang aktif.",
  security: auth,
  request: { body: json(BrandKit) },
  responses: {
    200: { description: "Tersimpan", ...json(BrandKit) },
    400: { description: "Warna bukan HEX 6 digit", ...json(ErrorBody) },
    401: { description: "Belum login", ...json(ErrorBody) },
  },
});


/* ---------------- Tahap 0: diagnosa ---------------- */

registry.registerPath({
  method: "post",
  path: "/api/generate/diagnose",
  tags: ["Generasi AI"],
  summary: "Tahap 0 — cari tahu dokumen apa yang dibutuhkan pengguna",
  description:
    "Pintu masuk untuk pengguna yang belum tahu dokumen apa yang dia perlukan. " +
    "Pengguna cukup menulis satu kalimat tentang apa yang sedang dia butuhkan, " +
    "lalu sistem menyarankan salah satu dari empat template beserta alasannya " +
    "dan daftar hal yang perlu dia siapkan.\n\n" +
    "Ini pembeda utama PitchKu: tools presentasi lain menuntut pengguna sudah " +
    "tahu mau bikin apa.",
  security: auth,
  request: { body: json(NeedInput) },
  responses: {
    200: {
      description: "Saran dokumen",
      ...json(
        Diagnosis.extend({
          usage: z.object({
            promptTokens: z.number(),
            completionTokens: z.number(),
            estimatedCostUsd: z.number(),
            model: z.string().nullable().openapi({
              description:
                "Model yang benar-benar menjawab, dilaporkan oleh pitchku-ai",
            }),
          }),
          attempts: z.number(),
        })
      ),
    },
    400: { description: "Kebutuhan terlalu singkat", ...json(ErrorBody) },
    401: { description: "Belum login", ...json(ErrorBody) },
    502: { description: "LLM gagal setelah 3 percobaan", ...json(ErrorBody) },
  },
});

/* ---------------- Generate ---------------- */

registry.registerPath({
  method: "post",
  path: "/api/generate/outline",
  tags: ["Generasi AI"],
  summary: "Tahap 1 — susun kerangka slide",
  description:
    "Panggilan LLM pertama. Menghasilkan 8-10 judul slide untuk ditinjau " +
    "pengguna sebelum isi dibuat. Memperbaiki di tahap ini jauh lebih murah " +
    "daripada mengulang seluruh deck.",
  security: auth,
  request: { body: json(BusinessContext) },
  responses: {
    200: {
      description: "Kerangka berhasil",
      ...json(
        z.object({
          outline: z.array(OutlineItem),
          usage: z.object({
            promptTokens: z.number(),
            completionTokens: z.number(),
            estimatedCostUsd: z.number(),
            model: z.string().nullable().openapi({
              description:
                "Model yang benar-benar menjawab, dilaporkan oleh pitchku-ai",
            }),
          }),
          attempts: z.number().openapi({ description: "1 berarti tanpa retry" }),
        })
      ),
    },
    400: { description: "Materi mentah kurang dari 50 karakter", ...json(ErrorBody) },
    401: { description: "Belum login", ...json(ErrorBody) },
    502: { description: "LLM gagal setelah 3 percobaan", ...json(ErrorBody) },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/generate/slides",
  tags: ["Generasi AI"],
  summary: "Tahap 2 — isi konten slide",
  description:
    "Panggilan LLM kedua. Hasilnya divalidasi terhadap skema kanonik; " +
    "kalau gagal, otomatis diulang maksimal 2 kali. Setiap slide juga membawa " +
    'field "missing" berisi hal yang lazim wajib ada di jenis dokumen ini ' +
    "tapi belum disebut pengguna.",
  security: auth,
  request: {
    body: json(
      z.object({
        context: BusinessContext,
        outline: z.array(OutlineItem).min(3).max(12),
      })
    ),
  },
  responses: {
    200: {
      description: "Slide berhasil",
      ...json(
        z.object({
          slides: z.array(Slide),
          usage: z.object({
            promptTokens: z.number(),
            completionTokens: z.number(),
            estimatedCostUsd: z.number(),
            model: z.string().nullable().openapi({
              description:
                "Model yang benar-benar menjawab, dilaporkan oleh pitchku-ai",
            }),
          }),
          attempts: z.number(),
        })
      ),
    },
    401: { description: "Belum login", ...json(ErrorBody) },
    502: { description: "LLM gagal setelah 3 percobaan", ...json(ErrorBody) },
  },
});

/* ---------------- Projects ---------------- */

registry.registerPath({
  method: "get",
  path: "/api/projects",
  tags: ["Proyek"],
  summary: "Daftar deck milik pengguna",
  security: auth,
  responses: {
    200: {
      description: "Daftar proyek",
      ...json(
        z.array(
          z.object({
            id: z.string().uuid(),
            title: z.string(),
            templateType: TemplateId,
            status: z.enum(["draft", "completed"]),
            updatedAt: z.string(),
          })
        )
      ),
    },
    401: { description: "Belum login", ...json(ErrorBody) },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/projects",
  tags: ["Proyek"],
  summary: "Simpan deck sebagai versi baru",
  security: auth,
  request: { body: json(DeckPayload) },
  responses: {
    201: {
      description: "Tersimpan",
      ...json(z.object({ projectId: z.string().uuid(), versionNumber: z.number() })),
    },
    401: { description: "Belum login", ...json(ErrorBody) },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/projects/{id}",
  tags: ["Proyek"],
  summary: "Buka deck versi terbaru",
  security: auth,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Isi deck", ...json(DeckPayload) },
    401: { description: "Belum login", ...json(ErrorBody) },
    404: { description: "Tidak ditemukan atau bukan milik Anda", ...json(ErrorBody) },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/projects/{id}",
  tags: ["Proyek"],
  summary: "Hapus deck",
  security: auth,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    204: { description: "Terhapus" },
    401: { description: "Belum login", ...json(ErrorBody) },
    404: { description: "Tidak ditemukan", ...json(ErrorBody) },
  },
});

/* ---------------- Export ---------------- */

registry.registerPath({
  method: "post",
  path: "/api/export/pptx",
  tags: ["Ekspor"],
  summary: "Ekspor ke PowerPoint yang bisa disunting",
  description:
    "Mengembalikan berkas .pptx. Teks jadi objek teks native dan kartu jadi " +
    "shape native, BUKAN gambar tempelan — ini syarat mutlak dari FRD. " +
    "Konversi murni di memori tanpa menulis berkas fisik ke disk server. " +
    "Desain slide mengikuti kanvas editor di pitchku-frontend (tema gelap, " +
    "badge bab, footer judul deck dan nomor slide).",
  security: auth,
  request: { body: json(DeckPayload) },
  responses: {
    200: {
      description: "Berkas PPTX",
      content: {
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
          schema: z.string().openapi({ type: "string", format: "binary" }),
        },
      },
      headers: z.object({
        "Content-Disposition": z.string().openapi({
          example: 'attachment; filename="Keripik_Bu_Tini_penawaran_produk_20260909.pptx"',
        }),
      }),
    },
    400: { description: "Payload tidak lolos skema", ...json(ErrorBody) },
    401: { description: "Belum login", ...json(ErrorBody) },
  },
});

function buildOpenApiDoc() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: "3.0.0",
    info: {
      version: "0.1.0",
      title: "PitchKu API",
      description:
        "Backend PitchKu — pembuat presentasi bisnis untuk UMKM Indonesia.\n\n" +
        "Autentikasi: frontend login langsung ke Supabase Auth (email/password " +
        "atau Google OAuth), lalu mengirim access_token ke backend sebagai " +
        "Bearer token. Backend tidak pernah memegang password.\n\n" +
        "Semua query database memakai token pengguna, jadi Row Level Security " +
        "Supabase yang menjamin pengguna hanya bisa mengakses deck miliknya.",
    },
    // Tombol "Try it out" di Swagger memakai server pertama. Tanpa PUBLIC_URL,
    // /docs di Render akan menembak localhost milik pengunjung, bukan API ini.
    servers: [
      ...(env.publicUrl
        ? [{ url: env.publicUrl, description: "Production" }]
        : []),
      { url: `http://localhost:${env.port}`, description: "Lokal" },
    ],
    tags: [
      { name: "Sistem" },
      { name: "Brand Kit" },
      { name: "Generasi AI" },
      { name: "Proyek" },
      { name: "Ekspor" },
    ],
  });
}

module.exports = { registry, buildOpenApiDoc };
