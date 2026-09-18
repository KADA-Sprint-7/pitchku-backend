# Catatan teknis untuk kontributor

Berkas ini menampung hal-hal yang perlu diketahui saat menyentuh kode di repo
ini: kontrak data antar-repo, alasan di balik beberapa keputusan, dan langkah
deployment. Penjelasan produk ada di [README.md](README.md).

| Peran | Orang | Repo |
|---|---|---|
| Backend | Risfa | repo ini |
| AI Engine | Rifka | `pitchku-ai`, dipanggil lewat `src/services/ai.js` |
| Frontend | Daffa | `pitchku-frontend` |

Integrasi dikerjakan berurutan: backend dan AI disambungkan lebih dulu
(machine-to-machine), frontend menyusul setelah kontraknya stabil.

---

## ⚠️ Kontrak kanonik

`src/schemas/slide.js` adalah **satu-satunya sumber kebenaran** untuk bentuk
data slide. Berkas itu dipakai backend untuk validasi, dipakai frontend untuk
menggambar kanvas, dan dipakai `pitchku-ai` sebagai target keluaran.

**Setiap perubahan di berkas itu wajib diumumkan ke grup** — sekali diubah
sendirian, pekerjaan tiga orang ikut rusak tanpa ada tes yang menangkapnya.

Karena proyek ini memakai JavaScript, kontrak tersebut menjaga bentuk data saat
runtime tapi tidak memberi autocomplete di editor. Kalau Daffa membutuhkannya,
tipe bisa dibangkitkan dari `/openapi.json`.

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

Setup Supabase dan Google OAuth ada di **[docs/SETUP.md](docs/SETUP.md)**,
langkah demi langkah, lengkap dengan potongan kode yang dipakai frontend.

---

## Hubungan dengan pitchku-ai

AI berjalan di service terpisah, `pitchku-ai` (repo Rifka). Service itu
menyediakan satu endpoint, `POST /api/v1/decks/generate`, yang menerima
`{ business, goal }` dan membalas 10 slide berbentuk
`{ title, subtitle, content[], visual }`. Berkas `src/services/ai.js`
menjembatani endpoint tunggal itu dengan tiga tahap di README:

| Tahap | Sumber |
|---|---|
| Diagnosa | Aturan kata kunci di backend — pitchku-ai belum punya endpoint diagnosa |
| Kerangka | Satu deck dibuat di pitchku-ai, judul slide-nya dipakai sebagai kerangka. Deck lengkapnya disimpan di memori selama 1 jam |
| Isi | Deck dari tahap kerangka diubah ke bentuk editor. Kalau sudah tidak ada di memori (misalnya server baru restart), pitchku-ai dipanggil ulang dengan kerangka milik pengguna |

Layout tiap slide ditentukan dari format isinya: poin berpola `Label: isi`
menjadi kartu (`two_column`, `card_grid`, atau `metrics_grid` kalau labelnya
berupa angka), slide pertama menjadi sampul, dan slide terakhir yang memuat
kontak menjadi `contact_closing`. Supaya polanya konsisten, backend meminta
format itu secara eksplisit lewat field `goal`.

Pengetahuan bisnis per template disimpan di `TEMPLATE_INFO` pada
`src/services/ai.js` dan ikut dikirim sebagai bagian dari `goal`. Kalau ada
pemilik usaha yang bilang ada hal penting yang selalu terlewat, tambahkan ke
checklist di situ.

---

## Desain slide mengikuti frontend

Sebelumnya `pptx.js` punya desain sendiri (latar putih, judul berwarna primer),
sehingga berkas yang diunduh pengguna tampak berbeda dari yang mereka lihat di
editor. Sekarang desainnya bersumber dari satu tempat: **kanvas editor di
`pitchku-frontend`**, tepatnya `src/components/SlideEditor/SlideLayoutRenderer.jsx`
dan `SlideCanvas.jsx`.

Kanvas web berukuran tetap 960 x 540 px, sementara slide PPTX 16:9 berukuran
10 x 5.625 inci. Konversinya kebetulan bulat: **96 px = 1 inci** dan
**1 px = 0.75 pt**. Di `pptx.js` keduanya dibungkus menjadi dua fungsi kecil,
`px()` dan `pt()`, dan hampir semua angka layout ditulis dalam satuan px kanvas
supaya bisa dicocokkan langsung dengan kelas Tailwind di renderer.

Yang ikut disalin dari editor: latar `#070C15`, kartu `#0F1A2E` dengan border
`#1E293B`, badge "BAB 01 • COVER" di kiri atas, logo di kanan atas (tidak
muncul di slide sampul), bar footer berisi judul deck dan nomor slide, garis
aksen di atas tiap judul, serta enam layout dengan susunan yang sama.

Ada dua hal yang sengaja dibuat **tidak** persis sama:

1. **Warna merek yang gelap dicerahkan** untuk teks kecil dan garis tipis di
   atas latar gelap (fungsi `onDark`). Primary `#0F4C81` di atas `#070C15`
   nyaris tidak terbaca, sedangkan PPTX sering diproyeksikan dan tidak bisa
   di-zoom seperti di aplikasi. Warna isian kartu dan badge tetap memakai
   warna aslinya.
2. **Gambar diunduh lebih dulu oleh backend** dengan batas waktu 6 detik dan
   ukuran 5 MB, lalu ditanam sebagai data URI. Kalau URL-nya mati, slide itu
   jatuh ke kotak placeholder gelap seperti di editor sehingga ekspor tetap
   berhasil.

Font mengikuti `brandKit.fontFamily` (default Inter), sama seperti di editor.
Inter bukan font bawaan Windows, jadi PowerPoint akan menggantinya sendiri
kalau pengguna belum memasangnya. Kotak teksnya sudah diberi ruang lebih supaya
pergantian font itu tidak membuat teks meluber.

**Kalau renderer di frontend berubah, `pptx.js` harus ikut menyesuaikan.** Belum
ada tes yang menangkap ketimpangan itu secara otomatis; cara tercepat memeriksa
masih `npm run smoke`, lalu buka `contoh-hasil.pptx` dan bandingkan dengan
editor.

---

## Cara auth bekerja

Backend tidak pernah memegang password pengguna, termasuk pada alur Google
OAuth.

1. Frontend login langsung ke Supabase
2. Supabase mengembalikan `access_token` berupa JWT
3. Frontend mengirimkannya ke backend lewat header `Authorization: Bearer <token>`
4. `requireAuth` memverifikasi token itu, lalu menyiapkan `req.db` yang membawanya

Karena setiap query dijalankan memakai token milik pengguna, pembatasan akses
ditangani sepenuhnya oleh Row Level Security. Backend tidak perlu mengecek
`user_id` secara manual — dan justru karena itu, tidak mungkin lupa
mengeceknya.

---

## Catatan deployment

FRD menyebut Vercel, tapi itu cocoknya untuk frontend. Express yang berdiri
sendiri kurang pas di serverless Vercel karena batas durasi eksekusinya
berisiko untuk proses generasi PPTX — lebih aman memakai platform yang
menjalankan proses biasa dan berumur panjang.

Kondisi saat ini:

| Komponen | Platform | Catatan |
|---|---|---|
| Frontend | Vercel | Hobby plan, gratis permanen untuk SPA statis |
| Backend (repo ini) | Railway | Hanya memakai kredit trial $5 — Railway tidak punya free tier |
| pitchku-ai | Railway | Sama, ikut berhenti kalau kredit habis |
| Database | Supabase | Free tier, tapi otomatis pause kalau 7 hari tidak dipakai |

Begitu kredit Railway habis, [render.yaml](render.yaml) di repo ini sudah siap
dipakai: hubungkan repo ke Render, isi env yang bertanda `sync: false`, selesai.
Free tier Render menidurkan service setelah 15 menit menganggur dan butuh 30-60
detik untuk bangun, dengan kuota 750 jam instance per bulan untuk seluruh akun.
Fly.io dan Heroku sudah tidak lagi menyediakan free tier untuk akun baru.

### Empat hal yang wajib diubah saat pindah platform

1. **`AI_SERVICE_URL`** sekarang memakai DNS privat Railway
   (`*.railway.internal`) yang tidak bisa dijangkau dari luar Railway. Ganti ke
   URL publik `https://`, tanpa garis miring di akhir.
2. **`PUBLIC_URL`** harus menunjuk domain backend yang baru, kalau tidak tombol
   "Try it out" di `/docs` akan menembak domain lama.
3. **`VITE_API_BASE_URL` di Vercel** harus ikut diganti, lalu frontend
   di-redeploy — Vite menanam nilai env saat build, bukan saat runtime.
4. **Rantai cold start** perlu diantisipasi: backend bangun dulu, lalu
   pitchku-ai, baru LLM bekerja. Sebelum demo, panggil `/health` di kedua
   service supaya keduanya sudah panas.

Dari sisi disk sudah aman: konversi PPTX sepenuhnya dilakukan di memori dengan
`outputType: "nodebuffer"`, jadi tidak ada berkas fisik yang ditulis ke server.
Yang perlu diawasi hanya batas waktu eksekusinya.

---

## Sebelum menyerahkan perubahan

```bash
npm run smoke
```

Perintah itu memverifikasi seluruh endpoint sekaligus menghasilkan
`contoh-hasil.pptx`. Kalau perubahanmu menyentuh `pptx.js`, buka berkas itu di
PowerPoint dan bandingkan dengan tampilan editor — belum ada tes otomatis yang
menangkap pergeseran layout.
