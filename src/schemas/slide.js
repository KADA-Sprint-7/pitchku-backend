const { z } = require("zod");
const { extendZodWithOpenApi } = require("@asteasolutions/zod-to-openapi");

extendZodWithOpenApi(z);

/**
 * KONTRAK KANONIK SLIDE
 *
 * Satu-satunya sumber kebenaran untuk bentuk data slide.
 * Frontend (Daffa), mesin AI (Rifka), dan mesin ekspor (Risfa) mengacu ke sini.
 *
 * Setiap perubahan di berkas ini WAJIB diumumkan ke grup.
 */

const LIMITS = {
  title: 60,
  subtitle: 120,
  bullet: 90,
  bulletCount: 5,
  cardHeader: 30,
  cardDesc: 80,
  cardCount: 4,
};

const TEMPLATE_IDS = [
  "company_profile",
  "penawaran_produk",
  "proposal_kerjasama",
  "laporan_ringkas",
];

const LAYOUT_IDS = [
  "title_slide",
  "title_bullets",
  "two_column",
  "metrics_grid",
  "card_grid",
  "contact_closing",
];

const HEX = /^#([A-Fa-f0-9]{6})$/;

const TemplateId = z.enum(TEMPLATE_IDS).openapi({
  description: "Jenis presentasi bisnis",
  example: "penawaran_produk",
});

const LayoutId = z.enum(LAYOUT_IDS).openapi({
  description: "Tata letak slide. Wajib salah satu dari enam ini.",
  example: "title_bullets",
});

const BrandKit = z
  .object({
    logoUrl: z.string().url().nullish(),
    primaryColor: z.string().regex(HEX).openapi({ example: "#0F4C81" }),
    accentColor: z.string().regex(HEX).openapi({ example: "#F2A007" }),
    fontFamily: z.string().max(50).default("Inter"),
  })
  .openapi("BrandKit");

const Card = z
  .object({
    header: z.string().max(LIMITS.cardHeader),
    description: z.string().max(LIMITS.cardDesc),
  })
  .openapi("Card");

const Slide = z
  .object({
    slideNumber: z.number().int().positive(),
    layout: LayoutId,
    title: z.string().max(LIMITS.title),
    subtitle: z.string().max(LIMITS.subtitle).optional(),
    bullets: z
      .array(z.string().max(LIMITS.bullet))
      .max(LIMITS.bulletCount)
      .optional(),
    cards: z.array(Card).max(LIMITS.cardCount).optional(),
    imageUrl: z.string().url().optional(),
    imageQuery: z.string().max(80).optional(),
    /**
     * Hal yang lazim wajib ada di jenis dokumen ini tapi belum disebut
     * pengguna. Ditampilkan sebagai saran di editor.
     */
    missing: z.array(z.string().max(120)).max(4).optional(),
  })
  .openapi("Slide");

const DeckPayload = z
  .object({
    deckId: z.string().uuid().optional(),
    template: TemplateId,
    businessName: z.string().min(2).max(150),
    brandKit: BrandKit,
    slides: z.array(Slide).min(3).max(12),
  })
  .openapi("DeckPayload");

const OutlineItem = z
  .object({
    title: z.string().max(LIMITS.title),
    objective: z.string().max(160),
  })
  .openapi("OutlineItem");

const BusinessContext = z
  .object({
    template: TemplateId,
    businessName: z.string().min(2).max(150),
    audience: z.string().max(150).optional(),
    brief: z
      .string()
      .min(50, "Materi mentah minimal 50 karakter")
      .max(2000, "Materi mentah maksimal 2.000 karakter"),
  })
  .openapi("BusinessContext");

/* ------------------------------------------------------------------ */
/* TAHAP 0 — Diagnosa kebutuhan (ide Rifka)                            */
/*                                                                     */
/* Pengguna UMKM sering tidak tahu dokumen apa yang dia butuhkan.       */
/* Alih-alih menyuruh memilih template, tanya satu hal terbuka:         */
/* "lagi butuh apa hari ini?" lalu sistem yang menyarankan.             */
/* ------------------------------------------------------------------ */

const NeedInput = z
  .object({
    need: z
      .string()
      .min(10, "Ceritakan sedikit lebih panjang, minimal 10 karakter")
      .max(500)
      .openapi({ example: "aku pengen keripikku bisa masuk ke kafe-kafe" }),
  })
  .openapi("NeedInput");

const Diagnosis = z
  .object({
    supported: z.boolean().openapi({
      description:
        "false kalau kebutuhannya di luar 4 template yang ada, mis. minta brosur atau katalog",
    }),
    recommended: TemplateId.nullable(),
    reason: z.string().max(300).openapi({
      description: "Penjelasan singkat bahasa Indonesia, ditujukan ke pemilik usaha",
      example:
        "Untuk masuk ke kafe, yang dibutuhkan penawaran produk: harga grosir, minimum order, dan margin mereka.",
    }),
    alternatives: z
      .array(z.object({ template: TemplateId, reason: z.string().max(200) }))
      .max(2),
    askFor: z
      .array(z.string().max(120))
      .max(6)
      .openapi({
        description:
          "Hal yang perlu pengguna siapkan untuk dokumen ini. Dipakai frontend sebagai panduan formulir.",
      }),
    fallbackMessage: z.string().max(300).optional().openapi({
      description: "Diisi hanya kalau supported = false",
    }),
  })
  .openapi("Diagnosis");

const ErrorBody = z
  .object({ error: z.string(), detail: z.string().optional() })
  .openapi("Error");

module.exports = {
  LIMITS,
  TEMPLATE_IDS,
  LAYOUT_IDS,
  TemplateId,
  LayoutId,
  BrandKit,
  Card,
  Slide,
  DeckPayload,
  OutlineItem,
  BusinessContext,
  NeedInput,
  Diagnosis,
  ErrorBody,
  z,
};
