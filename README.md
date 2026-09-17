# PitchKu Backend

API untuk PitchKu — pembuat presentasi bisnis untuk UMKM Indonesia.

**Stack:** Express + JavaScript + Zod + Supabase + pptxgenjs
**Dokumentasi API:** Swagger UI di `/docs`, dibangkitkan otomatis dari skema Zod

| Peran | Orang | Repo |
|---|---|---|
| Backend | Risfa | repo ini |
| AI Engine | Rifka | `pitchku-ai`, dipanggil lewat `src/services/ai.js` |
| Frontend | Daffa | `pitchku-frontend` |

Urutan integrasi: backend + AI dulu (machine-to-machine), frontend menyusul.

---

## Jalanin lokal

```bash
npm install
cp .env.example .env     # isi kredensialnya, lihat docs/SETUP.md
npm run dev
```

Buka http://localhost:4000/docs

Uji cepat tanpa Supabase asli:

```bash
npm run smoke
```

Menghasilkan `contoh-hasil.pptx` dan memverifikasi semua endpoint.

## Setup Supabase & Google OAuth

Lihat **[docs/SETUP.md](docs/SETUP.md)** — langkah demi langkah, termasuk
kode yang perlu Daffa pakai di frontend.

---

## Endpoint

| Method | Path | Fungsi |
|---|---|---|
| GET | `/health` | Cek server hidup |
| GET | `/docs` | Swagger UI |
| GET | `/openapi.json` | Spesifikasi OpenAPI mentah |
| POST | `/api/generate/diagnose` | **Tahap 0** — cari tahu dokumen apa yang dibutuhkan |
| POST | `/api/generate/outline` | **Tahap 1** — kerangka slide |
| POST | `/api/generate/slides` | **Tahap 2** — isi slide |
| GET | `/api/brand-kit` | Ambil brand kit |
| POST / PUT | `/api/brand-kit` | Simpan warna dan logo |
| GET | `/api/projects` | Daftar deck |
| POST | `/api/projects` | Simpan deck sebagai versi baru |
| GET | `/api/projects/:id` | Buka versi terbaru |
| DELETE | `/api/projects/:id` | Hapus deck |
| POST | `/api/export/pptx` | Unduh berkas .pptx |

---

## Tiga tahap generasi

Alur aslinya dua tahap. Tahap 0 ditambahkan dari ide Rifka.

**Tahap 0 — Diagnosa.** Pengguna UMKM sering tidak tahu dokumen apa yang dia
butuhkan. Dia tidak berpikir "saya perlu company profile", dia berpikir "saya
mau produk saya masuk ke kafe". Jadi pintu masuknya satu pertanyaan terbuka,
lalu sistem yang menyarankan template beserta alasannya.

Ini pembeda utama PitchKu. Tools presentasi lain menuntut pengguna sudah tahu
mau bikin apa.

**Tahap 1 — Kerangka.** 8-10 judul slide untuk ditinjau pengguna sebelum isi
dibuat. Memperbaiki di tahap ini jauh lebih murah daripada mengulang seluruh
deck.

**Tahap 2 — Isi.** Konten lengkap mengikuti kerangka yang sudah disunting
pengguna, divalidasi terhadap skema kanonik.

### Hubungan dengan pitchku-ai

AI berjalan di service terpisah, `pitchku-ai` (repo Rifka), yang menyediakan
satu endpoint: `POST /api/v1/decks/generate` dengan body `{ business, goal }`,
membalas 10 slide berbentuk `{ title, subtitle, content[], visual }`.
`src/services/ai.js` menjembatani endpoint itu dengan tiga tahap di atas:

| Tahap | Sumber |
|---|---|
| Diagnosa | Aturan kata kunci di backend. pitchku-ai belum punya endpoint diagnosa. |
| Kerangka | Satu deck dibuat di pitchku-ai; judul slide-nya jadi kerangka. Deck disimpan di memori selama 1 jam. |
| Isi | Deck dari tahap kerangka diubah ke bentuk editor. Kalau tidak ada di memori (server restart), pitchku-ai dipanggil lagi dengan kerangka pengguna. |

Layout dipilih dari isi slide: poin berformat `Label: isi` jadi kartu
(`two_column`, `card_grid`, atau `metrics_grid` kalau labelnya angka), slide
pertama jadi sampul, dan slide terakhir berisi kontak jadi `contact_closing`.
Supaya itu terjadi, backend meminta format tersebut lewat field `goal`.

Pengetahuan bisnis per template ada di `TEMPLATE_INFO` di `src/services/ai.js`,
dikirim ke pitchku-ai sebagai bagian dari `goal`. Kalau pemilik usaha bilang
ada hal penting yang selalu terlewat, tambahkan ke checklist di situ.

---

## Struktur

```
src/
├── index.js              server + Swagger
├── env.js                validasi env
├── openapi.js            definisi endpoint untuk Swagger
├── schemas/slide.js      KONTRAK KANONIK — jangan diubah sendirian
├── lib/
│   ├── supabase.js       klien per-permintaan (RLS) & admin
│   └── auth.js           middleware Bearer token
├── services/
│   ├── ai.js             tiga tahap generasi + checklist template  [Rifka]
│   └── pptx.js           mesin ekspor, koordinat inci 6 layout     [Risfa]
│                         desainnya mengikuti kanvas editor di
│                         pitchku-frontend, lihat catatan di bawah
└── routes/
    ├── generate.js
    ├── brandKit.js
    ├── projects.js
    └── exportPptx.js
```

`src/schemas/slide.js` adalah satu-satunya sumber kebenaran bentuk data slide.
Setiap perubahan di berkas itu wajib diumumkan ke grup — menyentuh pekerjaan
tiga orang sekaligus.

Karena pakai JavaScript, kontrak ini menjaga bentuk data saat runtime tapi
tidak memberi autocomplete di editor. Daffa bisa membangkitkan tipe dari
`/openapi.json` kalau butuh.

---

## Desain slide mengikuti frontend

Dulu `pptx.js` punya desainnya sendiri (latar putih, judul warna primer), jadi
berkas unduhan kelihatan seperti presentasi lain dari yang dilihat pengguna di
editor. Sekarang sumber desainnya satu: **kanvas editor di `pitchku-frontend`**,
yaitu `src/components/SlideEditor/SlideLayoutRenderer.jsx` dan `SlideCanvas.jsx`.

Kanvas web itu berukuran tetap 960 x 540 px dan slide PPTX 16:9 berukuran
10 x 5.625 inci, jadi konversinya bulat: **96 px = 1 inci**, **1 px = 0.75 pt**.
Di `pptx.js` konversi itu jadi dua fungsi kecil, `px()` dan `pt()`, dan hampir
semua angka layout ditulis dalam satuan px kanvas supaya bisa dicocokkan
langsung dengan kelas Tailwind di renderer.

Yang ikut disalin: latar `#070C15`, kartu `#0F1A2E` dengan border `#1E293B`,
badge "BAB 01 • COVER" di kiri atas, logo di kanan atas (tidak muncul di
cover), bar footer berisi judul deck dan nomor slide, garis aksen di atas tiap
judul, serta enam layout dengan susunan yang sama.

Ada dua hal yang sengaja **tidak** persis sama:

1. **Warna merek yang gelap dicerahkan** untuk teks kecil dan garis tipis di
   atas latar gelap (fungsi `onDark`). Primary `#0F4C81` di atas `#070C15`
   nyaris tidak terbaca, dan PPTX sering diproyeksikan, tidak bisa di-zoom
   seperti di aplikasi. Warna isian kartu dan badge tetap memakai warna asli.
2. **Gambar diambil lebih dulu** oleh backend dengan batas waktu 6 detik dan
   ukuran 5 MB, lalu ditanam sebagai data URI. Kalau URL-nya mati, slide itu
   jatuh ke kotak placeholder gelap seperti di editor, dan ekspor tetap jadi.

Font memakai `brandKit.fontFamily` (default Inter) seperti di editor. Inter
bukan font bawaan Windows, jadi kalau pengguna belum memasangnya PowerPoint
akan menggantinya sendiri — kotak teksnya sudah dikasih ruang lebih supaya
pergantian font itu tidak bikin teks meluber.

Kalau renderer di frontend berubah, `pptx.js` harus ikut diubah. Tidak ada tes
yang menangkap ini otomatis; cara cek tercepat masih `npm run smoke` lalu buka
`contoh-hasil.pptx` dan bandingkan dengan editor.

---

## Cara auth bekerja

Backend tidak pernah memegang password, termasuk untuk Google OAuth.

1. Frontend login langsung ke Supabase
2. Supabase mengembalikan `access_token` (JWT)
3. Frontend kirim ke backend: `Authorization: Bearer <token>`
4. `requireAuth` memverifikasi token, lalu menyiapkan `req.db` yang membawa
   token itu

Karena setiap query pakai token pengguna, Row Level Security yang menjamin
seseorang hanya bisa mengakses deck miliknya. Backend tidak perlu mengecek
`user_id` manual, dan tidak bisa lupa mengeceknya.

---

## Yang sudah diverifikasi

Hasil `npm run smoke` sebelum kode ini diserahkan:

- Skema `DeckPayload` lolos untuk payload 6 slide
- Judul 80 karakter **ditolak** skema (batas 60 ditegakkan, bukan cuma diminta ke LLM)
- Ekspor PPTX 6 slide berhasil, ~133 KB, magic bytes ZIP valid
- 8 endpoint terdokumentasi di Swagger, `/docs` merespons 200
- Endpoint tanpa token dan dengan token ngawur sama-sama 401

Berkas hasilnya juga dibongkar dan diperiksa isinya: **60 kotak teks native,
43 shape native, 0 gambar**. Ini bukti syarat mutlak FRD terpenuhi — slide
bukan gambar tempelan, teksnya bisa diklik dan disunting di PowerPoint.

Keenam slide juga dibuka di PowerPoint dan diekspor jadi PNG untuk
dibandingkan dengan tampilan editor.

---

## Yang belum dikerjakan

| Belum ada | Catatan |
|---|---|
| Endpoint unggah logo | Bucket `logos` sudah dibuat di migrasi, endpointnya belum |
| Gambar stok Unsplash | `imageQuery` sudah dihasilkan AI, pemanggilan API belum |
| Ekspor PDF | Butuh Puppeteer atau Playwright |
| `project_id` di log | Sekarang selalu `null` karena proyek belum ada saat generate. Perlu diputuskan: buat proyek dulu, atau tambal log setelahnya. |
| Rate limit | Panggilan LLM berbiaya. Penting sebelum dibuka ke publik. |
| Testing otomatis | Baru ada smoke test manual |

## Catatan deployment

FRD menyebut Vercel, tapi itu untuk frontend Next.js. Untuk Express terpisah,
serverless Vercel punya batas durasi yang berisiko untuk generasi PPTX.
Lebih aman ke Railway, Render, atau Fly.io yang jalan sebagai proses biasa.

Dari sisi disk sudah aman: konversi PPTX murni di memori pakai
`outputType: "nodebuffer"`, tidak menulis berkas fisik ke server. Yang perlu
diawasi cuma batas waktu eksekusinya.
