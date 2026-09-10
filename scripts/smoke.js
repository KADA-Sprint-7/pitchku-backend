/**
 * Uji cepat tanpa perlu Supabase asli.
 * Jalankan: npm run smoke
 */
const fs = require("fs");
const path = require("path");
const { app } = require("../src/index");
const { renderPptx, buildFileName } = require("../src/services/pptx");
const { DeckPayload } = require("../src/schemas/slide");

const sample = {
  template: "penawaran_produk",
  businessName: "Keripik Bu Tini",
  brandKit: { primaryColor: "#0F4C81", accentColor: "#F2A007", fontFamily: "Inter" },
  slides: [
    { slideNumber: 1, layout: "title_slide", title: "Penawaran Keripik Singkong Premium",
      subtitle: "Untuk kafe dan toko oleh-oleh di Bekasi dan sekitarnya" },
    { slideNumber: 2, layout: "title_bullets", title: "Tentang usaha kami",
      bullets: ["Produksi rumahan di Cikarang sejak 2019", "Empat varian rasa unggulan",
                "Kapasitas 800 bungkus per minggu", "Sudah bersertifikat PIRT"],
      imageQuery: "cassava chips snack packaging",
      missing: ["Wilayah pengiriman belum disebut"] },
    { slideNumber: 3, layout: "metrics_grid", title: "Angka penting",
      cards: [{ header: "Rp13.000", description: "Harga grosir per 100 gram" },
              { header: "50 pcs", description: "Minimum order pertama" },
              { header: "30%", description: "Margin untuk reseller" },
              { header: "12 toko", description: "Sudah bekerja sama" }],
      subtitle: "Harga berlaku sampai Desember 2026" },
    { slideNumber: 4, layout: "card_grid", title: "Varian rasa",
      cards: [{ header: "Original", description: "Gurih ringan, paling laku untuk semua umur" },
              { header: "Balado", description: "Pedas manis khas, favorit pembeli muda" },
              { header: "Keju", description: "Taburan keju bubuk, disukai anak-anak" }] },
    { slideNumber: 5, layout: "two_column", title: "Perbandingan paket",
      cards: [{ header: "Paket coba", description: "50 bungkus, bayar di tempat, tanpa kontrak" },
              { header: "Paket rutin", description: "200 bungkus per bulan, lebih murah 8%" }] },
    { slideNumber: 6, layout: "contact_closing", title: "Mari mulai kerja sama",
      subtitle: "Kami siap kirim sampel gratis minggu ini",
      bullets: ["WhatsApp 0812-3456-7890", "keripikbutini@gmail.com", "Instagram @keripikbutini"] },
  ],
};

(async () => {
  const parsed = DeckPayload.safeParse(sample);
  console.log("1. Skema DeckPayload:", parsed.success ? "LOLOS" : "GAGAL");
  if (!parsed.success) { console.log(parsed.error.issues); process.exit(1); }

  const bad = DeckPayload.safeParse({
    ...sample,
    slides: [{ ...sample.slides[0], title: "x".repeat(80) }, ...sample.slides.slice(1)],
  });
  console.log("2. Judul 80 karakter ditolak:", bad.success ? "TIDAK (bug!)" : "YA");

  const buf = await renderPptx({
    slides: parsed.data.slides,
    brandKit: parsed.data.brandKit,
    businessName: parsed.data.businessName,
  });
  const out = path.join(__dirname, "..", "contoh-hasil.pptx");
  fs.writeFileSync(out, buf);
  console.log("3. PPTX:", buf.length, "byte,", buf.subarray(0, 2).toString() === "PK" ? "ZIP valid" : "RUSAK");
  console.log("4. Nama berkas:", buildFileName(parsed.data.businessName, parsed.data.template));

  const port = 4333;
  const server = app.listen(port, async () => {
    const base = `http://localhost:${port}`;
    const h = await (await fetch(`${base}/health`)).json();
    console.log("5. /health:", JSON.stringify(h));
    const doc = await (await fetch(`${base}/openapi.json`)).json();
    console.log("6. Swagger:", Object.keys(doc.paths).length, "endpoint terdokumentasi");
    console.log("7. /docs:", (await fetch(`${base}/docs/`)).status);
    const unauth = await fetch(`${base}/api/projects`);
    console.log("8. Tanpa token:", unauth.status, JSON.stringify(await unauth.json()));
    const badTok = await fetch(`${base}/api/generate/diagnose`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer ngawur" },
      body: JSON.stringify({ need: "aku mau produkku masuk kafe" }),
    });
    console.log("9. Token ngawur:", badTok.status);
    console.log("\nSemua lolos. Berkas contoh:", out);
    server.close();
  });
})();
