<div align="center">

# PitchKu — Backend

**Pembuat presentasi bisnis ber-AI untuk UMKM Indonesia**

[![Express](https://img.shields.io/badge/Express_5-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com)
[![Node](https://img.shields.io/badge/Node_22-5FA04E?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Zod](https://img.shields.io/badge/Zod-3E67B1?style=for-the-badge&logo=zod&logoColor=white)](https://zod.dev)
[![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com)
[![Swagger](https://img.shields.io/badge/OpenAPI-85EA2D?style=for-the-badge&logo=swagger&logoColor=black)](https://swagger.io)

### [🖥️ Coba Aplikasinya](https://pitchku.vercel.app) · [📘 Dokumentasi API Interaktif](https://pitchku-backend-production.up.railway.app/docs)

*Dokumentasi API bisa langsung dicoba dari browser lewat tombol "Try it out"*

</div>

---

## Masalah yang dipecahkan

Pelaku UMKM jarang tahu dokumen apa yang sebenarnya mereka butuhkan.

Mereka tidak berpikir *"saya perlu company profile"*. Yang ada di kepala
mereka adalah *"saya mau produk saya masuk ke kafe"*.

Semua pembuat presentasi ber-AI yang ada sekarang menuntut pengguna sudah tahu
mau membuat apa: pilih template dulu, tulis prompt dulu. Bagi pemilik warung
atau produsen keripik rumahan, pertanyaan itu sendiri sudah jadi penghalang.

PitchKu membalik urutannya.

---

## Tiga tahap generasi

### Tahap 0 — Diagnosa

Pintu masuknya satu pertanyaan terbuka. Pengguna cukup menceritakan tujuannya
dengan bahasa sehari-hari, lalu **sistem yang menentukan** dokumen apa yang
cocok, beserta alasannya.

```
Pengguna:  "saya mau kopi saya masuk ke kafe-kafe di Jogja"
                          │
                          ▼
PitchKu:   Template "Penawaran Produk"
           Alasan  — kamu menawarkan produk ke pembeli grosir, jadi
                     yang mereka cari adalah harga satuan, MOQ,
                     margin reseller, dan izin edar
```

Diagnosa berjalan dari aturan kata kunci di backend, bukan dari LLM. Hasilnya
konsisten, instan, dan tidak memakan biaya token.

### Tahap 1 — Kerangka

Sistem menyusun 8–10 judul slide untuk **ditinjau pengguna sebelum isinya
dibuat**. Memperbaiki kerangka jauh lebih murah daripada mengulang satu deck
utuh, baik dari sisi waktu pengguna maupun biaya LLM.

### Tahap 2 — Isi

Konten lengkap disusun mengikuti kerangka yang sudah disunting pengguna, lalu
divalidasi terhadap skema kanonik sebelum dikirim ke editor.

---

## Yang membedakan PitchKu

| | Kenapa ini penting |
|---|---|
| **Diagnosa sebelum generasi** | Pengguna tidak perlu tahu istilah "company profile" atau "proposal kerja sama" untuk bisa memulai |
| **Pengetahuan bisnis UMKM tertanam di sistem** | Tiap template membawa checklist yang dikurasi: MOQ, margin reseller, kapasitas produksi, izin **PIRT / halal / BPOM**, skema bagi hasil. Generator umum tidak akan menanyakan hal-hal ini |
| **PPTX yang benar-benar bisa diedit** | Hasil unduhan berisi kotak teks dan shape asli PowerPoint, **bukan gambar**. Pemilik usaha bisa mengganti harga sendiri tanpa membuka PitchKu lagi |
| **Batas teks ditegakkan kode, bukan permintaan ke LLM** | Judul dibatasi 60 karakter oleh skema Zod. Judul yang kepanjangan ditolak, bukan sekadar "diminta jangan panjang" ke model — jadi teks tidak pernah meluber di layar proyeksi |
| **Warna merek dikoreksi untuk proyektor** | Warna gelap dicerahkan otomatis untuk teks kecil di atas latar gelap, karena PPTX diproyeksikan dan tidak bisa di-zoom seperti di layar laptop |

---

## Arsitektur

Tiga service terpisah yang berkomunikasi lewat REST:

```
┌──────────────────┐        Bearer JWT         ┌──────────────────────┐
│  pitchku-        │ ────────────────────────► │  pitchku-backend     │
│  frontend        │ ◄──────────────────────── │  (repo ini)          │
│                  │      JSON over HTTP       │                      │
│  Vite + React    │                           │  3 tahap generasi    │
│  Editor kanvas   │                           │  Mesin ekspor PPTX   │
│  16:9            │                           │  Brand kit, projects │
└──────────────────┘                           └───────┬──────────────┘
         │                                             │
         │ login langsung                              │ POST /decks/generate
         ▼                                             ▼
┌──────────────────┐                           ┌──────────────────────┐
│  Supabase Auth   │                           │  pitchku-ai          │
│  + Postgres RLS  │ ◄─────────────────────────│  Layanan LLM         │
└──────────────────┘   query membawa token     └──────────────────────┘
                       milik pengguna
```

**Keamanan lewat Row Level Security.** Backend tidak pernah memegang password,
termasuk pada alur Google OAuth. Frontend login langsung ke Supabase, lalu
mengirim `access_token` ke backend. Karena setiap query dijalankan memakai
token milik pengguna, pembatasan akses ditangani sepenuhnya oleh RLS di
database — backend tidak perlu mengecek `user_id` secara manual, sehingga
tidak mungkin lupa mengeceknya.

---

## Bukti terverifikasi

Hasil `npm run smoke`, dijalankan sebelum kode diserahkan:

| Yang diuji | Hasil |
|---|---|
| Ekspor PPTX 6 slide | Berhasil, ~133 KB, magic bytes ZIP valid |
| Judul 80 karakter | **Ditolak** skema — batas 60 ditegakkan di kode |
| Endpoint tanpa token / token asal-asalan | Sama-sama dibalas **401** |
| Endpoint terdokumentasi di Swagger | 8 endpoint, `/docs` merespons 200 |

Berkas `.pptx` hasilnya diekstrak dan diperiksa isinya satu per satu:

> ### 60 kotak teks native · 43 shape native · **0 gambar**

Angka terakhir itu yang paling menentukan. Nol gambar berarti tidak ada satu
pun slide yang ditempel sebagai screenshot — seluruh teksnya bisa diklik,
diseleksi, dan disunting langsung di PowerPoint. Ini syarat mutlak di FRD, dan
merupakan hal yang banyak generator presentasi ber-AI justru gagal penuhi.

Keenam slide juga dibuka di PowerPoint lalu diekspor menjadi PNG untuk
dibandingkan langsung dengan tampilan editor.

---

## Endpoint

| Method | Path | Fungsi |
|---|---|---|
| POST | `/api/generate/diagnose` | **Tahap 0** — tentukan dokumen yang dibutuhkan |
| POST | `/api/generate/outline` | **Tahap 1** — susun kerangka slide |
| POST | `/api/generate/slides` | **Tahap 2** — susun isi slide |
| POST | `/api/export/pptx` | Unduh berkas `.pptx` |
| GET | `/api/projects` | Daftar deck milik pengguna |
| POST | `/api/projects` | Simpan deck sebagai versi baru |
| GET | `/api/projects/:id` | Buka versi terbaru |
| DELETE | `/api/projects/:id` | Hapus deck |
| GET | `/api/brand-kit` | Ambil brand kit |
| POST / PUT | `/api/brand-kit` | Simpan warna dan logo |
| GET | `/health` | Cek server hidup |
| GET | `/docs` | Swagger UI |

Spesifikasi OpenAPI dibangkitkan otomatis dari skema Zod, jadi dokumentasi
tidak pernah basi terhadap kode. Bisa dicoba langsung di
**[/docs](https://pitchku-backend-production.up.railway.app/docs)**.

---

## Menjalankan di lokal

```bash
npm install
cp .env.example .env     # isi kredensialnya, lihat docs/SETUP.md
npm run dev
```

Lalu buka http://localhost:4000/docs

Untuk menguji cepat tanpa menyiapkan Supabase:

```bash
npm run smoke
```

Perintah itu memverifikasi seluruh endpoint sekaligus menghasilkan
`contoh-hasil.pptx` yang bisa langsung dibuka di PowerPoint.

---

## Rencana lanjutan

Beberapa hal sengaja ditahan agar alur inti — diagnosa, generasi, ekspor —
bisa diselesaikan dan diverifikasi lebih dulu.

| Rencana | Status sekarang |
|---|---|
| Endpoint unggah logo | Bucket penyimpanan sudah disiapkan di migrasi, endpointnya menyusul |
| Rate limit | Perlu ditambahkan sebelum dibuka ke publik, karena tiap panggilan LLM ada biayanya |
| Gambar stok Unsplash | Kata kunci gambar sudah dihasilkan AI per slide, tinggal menyambungkan ke API penyedia |
| Ekspor PDF | Frontend sudah menyediakan ekspor PDF di sisi klien, jadi versi server belum mendesak |
| Pengujian otomatis | Saat ini memakai smoke test menyeluruh yang dijalankan manual |

---

## Tim

| Peran | Orang | Repo |
|---|---|---|
| Backend | Risfa | repo ini |
| AI Engine | Rifka | [`pitchku-ai`](https://github.com/KADA-Sprint-7/pitchku-ai) |
| Frontend | Daffa | [`pitchku-frontend`](https://github.com/KADA-Sprint-7/pitchku-frontend) |

Catatan teknis untuk kontributor ada di **[CONTRIBUTING.md](CONTRIBUTING.md)** —
kontrak data antar-repo, cara sinkron dengan `pitchku-ai`, dan catatan
deployment.
