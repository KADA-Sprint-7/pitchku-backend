const { env } = require("../env");
const {
  z,
  LIMITS,
  OutlineItem,
  Slide,
  Diagnosis,
} = require("../schemas/slide");

/* ------------------------------------------------------------------ */
/* Panggilan provider — dipisah supaya mudah ditukar                   */
/* ------------------------------------------------------------------ */

async function callLLM(system, user, maxTokens = 4096) {
  if (!env.llmApiKey) throw new Error("LLM_API_KEY belum diisi");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.llmApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.llmModel,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return {
    text,
    usage: {
      promptTokens: data.usage?.input_tokens ?? 0,
      completionTokens: data.usage?.output_tokens ?? 0,
    },
  };
}

function parseJson(raw) {
  const cleaned = raw
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  return JSON.parse(cleaned);
}

const JSON_ONLY =
  "Anda perancang dokumen bisnis untuk UMKM Indonesia. " +
  "Jawab HANYA dengan JSON valid, tanpa penjelasan dan tanpa penanda blok kode.";

/**
 * Menjalankan panggilan LLM lalu memvalidasi hasilnya dengan Zod.
 * Kalau tidak lolos skema, ulangi maksimal 2 kali (total 3 percobaan).
 * Ini FR-03.4 di FRD.
 */
async function withRetry(schema, system, user, maxTokens) {
  let usage = { promptTokens: 0, completionTokens: 0 };
  let lastError = "";

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await callLLM(system, user, maxTokens);
      usage = {
        promptTokens: usage.promptTokens + r.usage.promptTokens,
        completionTokens: usage.completionTokens + r.usage.completionTokens,
      };
      const value = schema.parse(parseJson(r.text));
      return { value, usage, attempts: attempt };
    } catch (e) {
      lastError = e?.message ?? String(e);
    }
  }
  const err = new Error(`Gagal setelah 3 percobaan. ${lastError}`);
  err.usage = usage;
  throw err;
}

/* ------------------------------------------------------------------ */
/* Panduan isi per template                                            */
/*                                                                     */
/* Ini pengetahuan bisnis yang tidak dimiliki tools presentasi global.  */
/* Dipakai di tiga tempat: diagnosa, generasi isi, dan deteksi          */
/* informasi yang kurang.                                              */
/* ------------------------------------------------------------------ */

const TEMPLATE_INFO = {
  company_profile: {
    label: "Profil Usaha",
    when: "memperkenalkan usaha ke pihak yang belum mengenal, tanpa menawarkan sesuatu yang spesifik",
    checklist: [
      "bidang usaha dan sejak kapan berdiri",
      "produk atau layanan utama",
      "keunggulan dibanding pesaing sejenis",
      "cakupan wilayah atau jumlah pelanggan",
      "kontak dan cara memesan",
    ],
  },
  penawaran_produk: {
    label: "Penawaran Produk",
    when: "menawarkan produk ke toko, reseller, distributor, atau pembeli grosir",
    checklist: [
      "daftar produk dan harga satuan",
      "minimum order (MOQ)",
      "margin atau harga khusus reseller",
      "kapasitas produksi per periode",
      "izin usaha atau sertifikasi (PIRT, halal, BPOM)",
      "cara pengiriman dan syarat pembayaran",
    ],
  },
  proposal_kerjasama: {
    label: "Proposal Kerja Sama",
    when: "mengajak pihak lain berkolaborasi, titip jual, franchise, atau kemitraan jangka panjang",
    checklist: [
      "bentuk kerja sama yang diajukan",
      "apa yang disediakan pengaju",
      "apa yang diharapkan dari mitra",
      "pembagian hasil atau skema komersial",
      "jangka waktu dan langkah berikutnya",
    ],
  },
  laporan_ringkas: {
    label: "Laporan Ringkas",
    when: "melaporkan hasil ke pemodal, mitra, atau pemberi dana",
    checklist: [
      "periode yang dilaporkan",
      "angka penjualan atau capaian utama",
      "perbandingan dengan periode sebelumnya",
      "kendala yang dihadapi",
      "rencana periode berikutnya",
    ],
  },
};

function checklistOf(template) {
  return TEMPLATE_INFO[template]?.checklist ?? [];
}

/* ------------------------------------------------------------------ */
/* TAHAP 0 — Diagnosa kebutuhan                                        */
/* ------------------------------------------------------------------ */

async function diagnoseNeed(need) {
  const catalog = Object.entries(TEMPLATE_INFO)
    .map(([id, t]) => `- ${id} (${t.label}): dipakai saat ${t.when}`)
    .join("\n");

  const user = `Seorang pemilik usaha kecil di Indonesia menulis kebutuhannya:

"${need}"

Dokumen yang bisa dibuat PitchKu hanya empat ini:
${catalog}

Tugas Anda: tentukan dokumen mana yang paling dia butuhkan, dan jelaskan
alasannya dengan bahasa yang dipahami pemilik warung — bukan bahasa konsultan.

Kalau kebutuhannya jelas di luar empat itu (misalnya minta brosur, katalog,
konten Instagram, atau logo), set supported = false, recommended = null, dan
isi fallbackMessage dengan saran terdekat yang tetap membantu.

Isi askFor dengan hal-hal yang perlu dia siapkan untuk dokumen itu, ditulis
sebagai pertanyaan singkat berbahasa Indonesia yang ramah, maksimal 6 butir.

Balas JSON:
{"supported":true,"recommended":"penawaran_produk","reason":"...","alternatives":[{"template":"company_profile","reason":"..."}],"askFor":["..."],"fallbackMessage":"..."}`;

  const { value, usage, attempts } = await withRetry(
    Diagnosis,
    JSON_ONLY,
    user,
    1500
  );
  return { diagnosis: value, usage, attempts };
}

/* ------------------------------------------------------------------ */
/* TAHAP 1 — Kerangka slide                                            */
/* ------------------------------------------------------------------ */

const OutlineArray = z.array(OutlineItem).min(5).max(10);

async function generateOutline(ctx) {
  const checklist = checklistOf(ctx.template);
  const user = `Buat kerangka presentasi jenis "${ctx.template}".

Nama usaha: ${ctx.businessName}
Ditujukan kepada: ${ctx.audience || "calon mitra usaha"}
Materi mentah dari pemilik usaha:
${ctx.brief}

Dokumen jenis ini lazimnya memuat:
${checklist.map((c) => `- ${c}`).join("\n")}

Buat 8 sampai 10 slide. Slide pertama wajib sampul, slide terakhir wajib
penutup berisi kontak.
Judul memakai bahasa Indonesia yang wajar dipakai pelaku usaha kecil,
bukan jargon korporat.
Judul maksimal ${LIMITS.title} karakter.

Balas JSON array:
[{"title":"...","objective":"satu kalimat tujuan slide"}]`;

  const { value, usage, attempts } = await withRetry(
    OutlineArray,
    JSON_ONLY,
    user,
    2000
  );
  return { outline: value, usage, attempts };
}

/* ------------------------------------------------------------------ */
/* TAHAP 2 — Isi slide                                                 */
/* ------------------------------------------------------------------ */

const SlideArray = z.array(Slide.omit({ slideNumber: true })).min(3).max(12);

async function generateSlides(ctx, outline) {
  const checklist = checklistOf(ctx.template);
  const user = `Isi konten setiap slide untuk usaha "${ctx.businessName}".

Ditujukan kepada: ${ctx.audience || "calon mitra usaha"}
Materi mentah:
${ctx.brief}

Kerangka yang sudah disetujui pemilik usaha:
${outline.map((o, i) => `${i + 1}. ${o.title}${o.objective ? " — " + o.objective : ""}`).join("\n")}

Pilih layout tiap slide dari daftar ini saja:
- title_slide (hanya slide pertama; title + subtitle)
- title_bullets (title + 3-5 bullets + imageQuery)
- two_column (title + tepat 2 cards untuk perbandingan)
- metrics_grid (title + 3-4 cards; header berisi ANGKA singkat seperti "150+" atau "Rp25rb", description berisi labelnya)
- card_grid (title + tepat 3 cards untuk daftar produk, layanan, atau tim)
- contact_closing (hanya slide terakhir; title + subtitle + bullets berisi kontak)

BATAS KARAKTER WAJIB:
title <= ${LIMITS.title}
subtitle <= ${LIMITS.subtitle}
bullets: maksimal ${LIMITS.bulletCount} butir, tiap butir <= ${LIMITS.bullet}
cards: maksimal ${LIMITS.cardCount}, header <= ${LIMITS.cardHeader}, description <= ${LIMITS.cardDesc}

Dokumen jenis ini lazimnya memuat:
${checklist.map((c) => `- ${c}`).join("\n")}

Untuk setiap slide, isi juga field "missing": hal dari daftar di atas yang
RELEVAN dengan slide itu tapi TIDAK ADA di materi mentah pengguna. Tulis
sebagai saran singkat berbahasa Indonesia, misalnya "Margin reseller belum
disebut". Kalau tidak ada yang kurang, kosongkan array-nya.

Bahasa Indonesia yang lugas dan konkret. Pakai angka nyata dari materi mentah;
JANGAN mengarang angka yang tidak disebut pengguna.
imageQuery ditulis bahasa Inggris, 2-4 kata.

Balas JSON array:
[{"layout":"...","title":"...","subtitle":"...","bullets":["..."],"cards":[{"header":"...","description":"..."}],"imageQuery":"...","missing":["..."]}]`;

  const { value, usage, attempts } = await withRetry(
    SlideArray,
    JSON_ONLY,
    user,
    6000
  );
  const slides = value.map((s, i) => ({ ...s, slideNumber: i + 1 }));
  return { slides, usage, attempts };
}

/* ------------------------------------------------------------------ */
/* Estimasi biaya                                                      */
/* ------------------------------------------------------------------ */

const PRICE_IN_PER_TOKEN = 3 / 1_000_000;
const PRICE_OUT_PER_TOKEN = 15 / 1_000_000;

function estimateCost(u) {
  return (
    u.promptTokens * PRICE_IN_PER_TOKEN +
    u.completionTokens * PRICE_OUT_PER_TOKEN
  );
}

module.exports = {
  diagnoseNeed,
  generateOutline,
  generateSlides,
  estimateCost,
  TEMPLATE_INFO,
  checklistOf,
};
