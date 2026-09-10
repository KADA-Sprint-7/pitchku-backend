# PitchKu Backend

API untuk PitchKu — pembuat presentasi bisnis untuk UMKM Indonesia.

**Stack:** Express + JavaScript + Zod + Supabase + pptxgenjs
**Dokumentasi API:** Swagger UI di `/docs`, dibangkitkan otomatis dari skema Zod

| Peran | Orang | Repo |
|---|---|---|
| Backend | Risfa | repo ini |
| AI Engine | Rifka | `src/services/ai.js` di repo ini |
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
| PUT | `/api/brand-kit` | Simpan warna dan logo |
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

**Tahap 2 — Isi.** Konten lengkap, divalidasi terhadap skema kanonik, retry
otomatis maksimal 2 kali kalau JSON-nya tidak lolos.

Setiap slide juga membawa field `missing`: hal yang lazim wajib ada di jenis
dokumen itu tapi belum disebut pengguna. Frontend menampilkannya sebagai saran,
misalnya "Margin reseller belum disebut".

Pengetahuan bisnis per template ada di `TEMPLATE_INFO` di `src/services/ai.js`.
Itu satu tempat yang paling layak diperbaiki setelah UAT — kalau pemilik usaha
bilang ada hal penting yang selalu terlewat, tambahkan ke checklist di situ.

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
- Ekspor PPTX 6 slide berhasil, ~108 KB, magic bytes ZIP valid
- 8 endpoint terdokumentasi di Swagger, `/docs` merespons 200
- Endpoint tanpa token dan dengan token ngawur sama-sama 401

Berkas hasilnya juga dibongkar dan diperiksa isinya: **11 objek teks native,
17 shape native, 0 gambar**. Ini bukti syarat mutlak FRD terpenuhi — slide
bukan gambar tempelan, teksnya bisa diklik dan disunting di PowerPoint.

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
