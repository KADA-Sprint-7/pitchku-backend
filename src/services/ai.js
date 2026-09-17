const crypto = require("crypto");
const { env } = require("../env");
const { z, LIMITS, TEMPLATE_IDS, OutlineItem, Slide, Diagnosis } = require("../schemas/slide");

/**
 * KLIEN pitchku-ai
 *
 * pitchku-ai (repo Rifka, di-deploy terpisah) menyediakan satu endpoint:
 *
 *   POST /api/v1/decks/generate   { business: { name, ... }, goal }
 *   -> { title, type, language, slides: [{ title, subtitle, content[], visual }] }
 *
 * Frontend memanggil tiga tahap dengan bentuk slide kanonik di
 * schemas/slide.js. Berkas ini menjembatani keduanya tanpa mengubah
 * pitchku-ai maupun frontend:
 *
 *  - outline:  satu deck dibuat di pitchku-ai, judul slide-nya jadi kerangka.
 *              Deck lengkapnya disimpan sementara di memori.
 *  - slides:   deck tadi diubah ke bentuk yang digambar editor
 *              (SlideLayoutRenderer.jsx), mengikuti kerangka yang sudah
 *              disunting pengguna. Kalau tidak ada di memori (misalnya server
 *              baru restart), pitchku-ai dipanggil sekali lagi.
 *  - diagnose: pitchku-ai belum punya endpoint ini, jadi memakai aturan kata
 *              kunci. Bentuk balasannya tetap Diagnosis yang dibaca frontend.
 */

/* ------------------------------------------------------------------ */
/* Panduan isi per template                                            */
/*                                                                     */
/* Dikirim ke pitchku-ai sebagai bagian dari goal, dan dipakai diagnosa. */
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
    keywords: ["profil", "perkenalkan", "memperkenalkan", "kenalan", "company", "perusahaan", "portofolio", "kredibilitas", "tentang usaha"],
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
    keywords: ["jual", "tawarkan", "menawarkan", "penawaran", "reseller", "distributor", "grosir", "toko", "kafe", "cafe", "supermarket", "minimarket", "harga", "masuk ke", "produk"],
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
    keywords: ["kerja sama", "kerjasama", "kemitraan", "mitra", "investor", "modal", "bagi hasil", "franchise", "waralaba", "titip jual", "kolaborasi", "sponsor"],
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
    keywords: ["laporan", "lapor", "keuangan", "omzet", "omset", "kinerja", "evaluasi", "capaian", "pencapaian", "pertanggungjawaban", "hibah", "pemberi dana"],
  },
};

const str = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const cut = (v, max) => str(v).slice(0, max);

/** Nama model yang dicatat di generation_logs. pitchku-ai tidak melaporkan token. */
const usageOf = (model) => ({ promptTokens: 0, completionTokens: 0, model });

/* ------------------------------------------------------------------ */
/* Pemanggilan pitchku-ai                                              */
/* ------------------------------------------------------------------ */

function buildGoal(ctx, outline) {
  const info = TEMPLATE_INFO[ctx.template];
  const lines = [
    `Buat dokumen "${info?.label ?? ctx.template}" yang ditujukan kepada ${ctx.audience || "calon mitra usaha"}.`,
    info ? `Dokumen ini dipakai untuk ${info.when}.` : "",
    info ? `Pastikan memuat: ${info.checklist.join("; ")}.` : "",
  ];
  if (outline?.length) {
    lines.push(
      "",
      "Ikuti kerangka yang sudah disetujui pemilik usaha, dengan urutan yang sama:",
      ...outline.map((o, i) => `${i + 1}. ${o.title}${o.objective ? " - " + o.objective : ""}`)
    );
  }
  lines.push(
    "",
    "Aturan tambahan dari editor PitchKu:",
    `- judul slide maksimal ${LIMITS.title} karakter, subtitle maksimal ${LIMITS.subtitle} karakter`,
    `- maksimal ${LIMITS.bulletCount} poin content per slide, tiap poin maksimal ${LIMITS.bullet} karakter`,
    `- untuk daftar produk, keunggulan, angka, atau kontak, tulis tiap poin dengan format "Label: isi", label maksimal ${LIMITS.cardHeader} karakter`,
    '- slide terakhir berisi ajakan dan kontak dari materi dengan format seperti "WhatsApp: 0812...", jangan mengarang nomor atau alamat',
    "- pakai angka nyata dari materi, jangan mengarang angka atau harga"
  );
  return lines.filter((l, i, all) => l !== "" || all[i - 1] !== "").join("\n");
}

async function requestDeck(ctx, outline) {
  const headers = { "content-type": "application/json" };
  // pitchku-ai saat ini tidak memeriksa kunci ini; dikirim supaya tetap
  // jalan kalau nanti pagar antar-service dipasang di sana.
  if (env.internalApiKey) headers["x-internal-key"] = env.internalApiKey;

  let res;
  try {
    res = await fetch(`${env.aiServiceUrl}/api/v1/decks/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        business: {
          name: ctx.businessName,
          documentType: TEMPLATE_INFO[ctx.template]?.label ?? ctx.template,
          audience: ctx.audience || "calon mitra usaha",
          description: ctx.brief,
        },
        goal: buildGoal(ctx, outline),
      }),
      signal: AbortSignal.timeout(env.aiTimeoutMs),
    });
  } catch (e) {
    const reason =
      e?.name === "TimeoutError" ? `tidak menjawab dalam ${env.aiTimeoutMs / 1000} detik` : e?.message;
    throw new Error(`Layanan AI tidak bisa dihubungi (${reason})`);
  }

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = payload?.detail ?? payload?.error;
    throw new Error(`pitchku-ai membalas ${res.status}${detail ? `: ${String(detail).slice(0, 300)}` : ""}`);
  }

  const slides = (Array.isArray(payload?.slides) ? payload.slides : []).map((s) => ({
    title: str(s?.title),
    subtitle: str(s?.subtitle),
    content: (Array.isArray(s?.content) ? s.content : [s?.content]).map(str).filter(Boolean),
    visualType: str(s?.visual?.type).toLowerCase(),
    visualDescription: str(s?.visual?.description),
  }));
  if (slides.length === 0) throw new Error("pitchku-ai tidak mengembalikan slide");
  return slides;
}

/* ------------------------------------------------------------------ */
/* Deck sementara di memori                                            */
/*                                                                     */
/* Tahap outline dan slides dipanggil terpisah oleh frontend dengan      */
/* konteks yang sama. Tanpa ini pitchku-ai membuat deck dua kali, dan    */
/* isi slide bisa tidak cocok dengan kerangka yang ditinjau pengguna.    */
/* ------------------------------------------------------------------ */

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 100;
const deckCache = new Map();

const keyOf = (ctx) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify([ctx.template, ctx.businessName, ctx.audience ?? "", ctx.brief]))
    .digest("hex");

function remember(ctx, slides) {
  const key = keyOf(ctx);
  deckCache.delete(key);
  deckCache.set(key, { slides, at: Date.now() });
  while (deckCache.size > CACHE_MAX) deckCache.delete(deckCache.keys().next().value);
}

function recall(ctx) {
  const key = keyOf(ctx);
  const hit = deckCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.slides;
  deckCache.delete(key);
  return null;
}

/* ------------------------------------------------------------------ */
/* Slide pitchku-ai -> slide editor                                    */
/* ------------------------------------------------------------------ */

const IMAGE_VISUALS = new Set(["stock_image", "illustration"]);
const NUMBERISH = /^(rp\s?)?[\d.,]+\s?(%|\+|x|rb|ribu|jt|juta|k|m)?\+?$/i;

function cardOf(line) {
  const m = /^([^:]{1,30}):\s*(.+)$/.exec(line);
  return m ? { header: m[1].trim(), description: cut(m[2], LIMITS.cardDesc) } : null;
}

/**
 * Memilih layout dari isi slide. Poin berformat "Label: isi" digambar editor
 * sebagai kartu; slide terakhir yang berisi kartu jadi penutup berisi kontak,
 * karena contact_closing di editor membaca cards, bukan bullets.
 */
function toEditorSlide(raw, index, total, title) {
  const subtitle = cut(raw.subtitle, LIMITS.subtitle) || undefined;
  const base = {
    title: cut(title || raw.title, LIMITS.title),
    subtitle,
    imageQuery:
      IMAGE_VISUALS.has(raw.visualType) && raw.visualDescription
        ? cut(raw.visualDescription, 80)
        : undefined,
  };

  if (index === 0) {
    return { ...base, layout: "title_slide", subtitle: subtitle ?? (cut(raw.content[0], LIMITS.subtitle) || undefined) };
  }

  const cards = raw.content.map(cardOf);
  if (cards.length >= 2 && cards.every(Boolean)) {
    if (index === total - 1) {
      return { ...base, layout: "contact_closing", cards: cards.slice(0, LIMITS.cardCount) };
    }
    if (cards.length === 2) return { ...base, layout: "two_column", cards };
    const numeric = cards.every((c) => NUMBERISH.test(c.header));
    return {
      ...base,
      layout: numeric ? "metrics_grid" : "card_grid",
      cards: cards.slice(0, LIMITS.cardCount),
    };
  }

  return {
    ...base,
    layout: "title_bullets",
    bullets: raw.content.slice(0, LIMITS.bulletCount).map((l) => cut(l, LIMITS.bullet)),
  };
}

const titleKey = (t) => cut(t, LIMITS.title).toLowerCase().replace(/\s+/g, " ");

/* ------------------------------------------------------------------ */
/* TAHAP 0 — Diagnosa kebutuhan (aturan kata kunci)                    */
/* ------------------------------------------------------------------ */

async function diagnoseNeed(need) {
  const text = ` ${str(need).toLowerCase()} `;
  const scored = TEMPLATE_IDS.map((id) => ({
    id,
    score: TEMPLATE_INFO[id].keywords.filter((k) => text.includes(k)).length,
  })).sort((a, b) => b.score - a.score);

  // Tanpa petunjuk sama sekali, penawaran produk paling sering dibutuhkan
  // UMKM - sama dengan tebakan cadangan di frontend.
  const recommended = scored[0].score > 0 ? scored[0].id : "penawaran_produk";
  const info = TEMPLATE_INFO[recommended];
  const others = scored.filter((s) => s.id !== recommended && s.score > 0).slice(0, 2);
  const alternatives = (others.length ? others.map((s) => s.id) : [recommended === "company_profile" ? "penawaran_produk" : "company_profile"])
    .map((id) => ({ template: id, reason: cut(`Bisa juga ${TEMPLATE_INFO[id].label} kalau tujuannya ${TEMPLATE_INFO[id].when}.`, 200) }));

  const diagnosis = Diagnosis.parse({
    supported: true,
    recommended,
    reason: cut(`${info.label} paling cocok untuk ${info.when}.`, 300),
    alternatives,
    askFor: info.checklist.map((c) => cut(c.charAt(0).toUpperCase() + c.slice(1), 120)),
  });
  return { diagnosis, usage: usageOf("aturan-kata-kunci"), attempts: 1 };
}

/* ------------------------------------------------------------------ */
/* TAHAP 1 — Kerangka slide                                            */
/* ------------------------------------------------------------------ */

async function generateOutline(ctx) {
  // Selalu deck baru: membuat ulang kerangka berarti pengguna ingin hasil lain.
  const slides = await requestDeck(ctx);
  remember(ctx, slides);
  const outline = slides.slice(0, 10).map((s, i) => ({
    title: cut(s.title, LIMITS.title) || `Slide ${i + 1}`,
    objective: cut(s.subtitle || s.content[0], 160),
  }));
  return {
    outline: z.array(OutlineItem).min(1).parse(outline),
    usage: usageOf(env.llmModel),
    attempts: 1,
  };
}

/* ------------------------------------------------------------------ */
/* TAHAP 2 — Isi slide                                                 */
/* ------------------------------------------------------------------ */

async function generateSlides(ctx, outline) {
  let deck = recall(ctx);
  const fromCache = Boolean(deck);
  if (!deck) {
    deck = await requestDeck(ctx, outline);
    remember(ctx, deck);
  }

  // Pengguna bisa menyunting, menghapus, atau menambah slide di halaman
  // kerangka. Slide dicocokkan dulu lewat judul yang tidak diubah, lalu
  // lewat posisi. Slide tambahan pengguna yang tidak punya pasangan dibuat
  // dari judul dan tujuannya saja.
  const total = outline.length;
  const assigned = new Array(total).fill(undefined);
  const used = new Set();
  const byTitle = new Map();
  deck.forEach((s, i) => {
    if (!byTitle.has(titleKey(s.title))) byTitle.set(titleKey(s.title), i);
  });
  outline.forEach((item, i) => {
    const idx = byTitle.get(titleKey(item.title));
    if (idx !== undefined && !used.has(idx)) {
      assigned[i] = idx;
      used.add(idx);
    }
  });
  outline.forEach((_item, i) => {
    if (assigned[i] === undefined && i < deck.length && !used.has(i)) {
      assigned[i] = i;
      used.add(i);
    }
  });

  const slides = outline.map((item, i) => {
    const slide =
      assigned[i] !== undefined
        ? toEditorSlide(deck[assigned[i]], i, total, item.title)
        : i === 0
          ? { layout: "title_slide", title: cut(item.title, LIMITS.title), subtitle: cut(item.objective, LIMITS.subtitle) || undefined }
          : { layout: "title_bullets", title: cut(item.title, LIMITS.title), bullets: item.objective ? [cut(item.objective, LIMITS.bullet)] : [] };
    return { ...slide, slideNumber: i + 1 };
  });

  return {
    slides: z.array(Slide).min(1).parse(slides),
    usage: usageOf(fromCache ? `${env.llmModel} (cache)` : env.llmModel),
    attempts: 1,
  };
}

/* ------------------------------------------------------------------ */
/* Estimasi biaya                                                      */
/* ------------------------------------------------------------------ */

/**
 * pitchku-ai tidak melaporkan jumlah token, jadi selalu nol untuk sekarang.
 * Kalau nanti dilaporkan, isi LLM_PRICE_INPUT_PER_1M dan
 * LLM_PRICE_OUTPUT_PER_1M supaya generation_logs.estimated_cost_usd terisi.
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
  TEMPLATE_INFO,
  // Diekspor untuk pengujian.
  toEditorSlide,
  buildGoal,
};
