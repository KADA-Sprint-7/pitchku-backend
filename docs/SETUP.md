# Setup Supabase + Google OAuth

Panduan ini dikerjakan sekali oleh **Risfa (backend)**, hasilnya dipakai bersama.
Bagian terakhir adalah kode untuk **Daffa (frontend)**.

---

## 1. Bikin proyek Supabase

1. Buka https://supabase.com, daftar pakai akun GitHub
2. **New project**
   - Name: `pitchku`
   - Database Password: bikin yang kuat, **simpan di password manager** — tidak bisa dilihat lagi nanti
   - Region: **Southeast Asia (Singapore)** — paling dekat ke Indonesia
3. Tunggu sekitar dua menit sampai proyeknya siap

## 2. Ambil kredensial

**Project Settings** (ikon gerigi) > **API**

| Yang dicopy | Taruh di `.env` sebagai |
|---|---|
| Project URL | `SUPABASE_URL` |
| `anon` `public` key | `SUPABASE_ANON_KEY` |
| `service_role` `secret` key | `SUPABASE_SERVICE_ROLE_KEY` |

> `service_role` key melewati semua Row Level Security. Cuma boleh ada di
> backend. Jangan pernah dikirim ke frontend, jangan di-commit, jangan
> ditempel di grup WhatsApp.

## 3. Bikin tabelnya

**SQL Editor** > **New query** > tempel seluruh isi
`supabase/migrations/001_init.sql` > **Run**

Kalau berhasil, cek **Table Editor**. Harus ada 5 tabel: `profiles`,
`brand_kits`, `projects`, `deck_versions`, `generation_logs`.

Cek juga **Authentication** > **Policies** — tiap tabel harus punya policy.
Kalau ada tabel bertanda "RLS not enabled", berarti SQL-nya belum jalan penuh.

## 4. Aktifkan login email/password

**Authentication** > **Sign In / Providers** > **Email**

- Enable: **on**
- **Confirm email: matikan dulu** selama development, biar tidak perlu
  buka email tiap bikin akun tes. Nyalakan lagi sebelum UAT.

---

## 5. Google OAuth

Bagian ini yang paling banyak langkahnya. Butuh dua tab: Google Cloud
Console dan Supabase.

### 5a. Ambil URL callback dari Supabase

**Authentication** > **Sign In / Providers** > **Google**

Di bagian bawah ada **Callback URL (for OAuth)**, bentuknya seperti:

```
https://xxxxxxxx.supabase.co/auth/v1/callback
```

Copy dulu, sebentar lagi dipakai.

### 5b. Bikin OAuth Client di Google Cloud

1. Buka https://console.cloud.google.com
2. **Select a project** > **New Project** > nama `PitchKu` > Create
3. Menu kiri > **APIs & Services** > **OAuth consent screen**
   - User Type: **External** > Create
   - App name: `PitchKu`
   - User support email: email kamu
   - Developer contact: email kamu
   - Save and Continue sampai selesai
   - Scopes tidak perlu diubah, default sudah cukup
4. Masih di consent screen, cari **Audience** atau **Test users**
   - Selama masih mode Testing, **hanya email yang terdaftar di sini yang
     bisa login.** Tambahkan email kamu, Daffa, Rifka, dan email penguji
     UMKM nanti. Ini sumber error paling sering: sudah benar semua tapi
     login gagal karena emailnya belum didaftarkan.
5. **APIs & Services** > **Credentials** > **Create Credentials** >
   **OAuth client ID**
   - Application type: **Web application**
   - Name: `PitchKu Web`
   - **Authorized redirect URIs** > Add URI > tempel callback URL dari
     langkah 5a
   - Create
6. Muncul **Client ID** dan **Client Secret**. Copy keduanya.

### 5c. Masukkan ke Supabase

Balik ke **Authentication** > **Sign In / Providers** > **Google**

- Enable Sign in with Google: **on**
- Client ID: tempel
- Client Secret: tempel
- **Save**

### 5d. Atur redirect setelah login

**Authentication** > **URL Configuration**

- Site URL: `http://localhost:3000`
- Redirect URLs, tambahkan:
  ```
  http://localhost:3000/**
  ```
  Nanti sebelum rilis, tambahkan juga alamat produksinya.

### Kalau Google OAuth gagal

| Gejala | Penyebab tersering |
|---|---|
| `redirect_uri_mismatch` | URI di Google Cloud tidak sama persis dengan callback Supabase. Cek trailing slash. |
| `Access blocked: app not verified` | Email belum didaftarkan sebagai Test user (langkah 5.4) |
| Login sukses tapi balik ke halaman kosong | Redirect URL belum didaftarkan di URL Configuration |
| Login sukses tapi `profiles` kosong | Trigger `on_auth_user_created` belum jalan. Jalankan ulang migrasi. |

---

## 6. Backend tidak perlu kode tambahan untuk OAuth

Ini sering disalahpahami, jadi ditulis jelas:

**Google OAuth ditangani sepenuhnya oleh Supabase dan frontend.** Backend
hanya menerima Bearer token dan memverifikasinya. Alurnya identik baik
pengguna login pakai email/password atau Google — `requireAuth` di
`src/lib/auth.js` tidak perlu diubah sama sekali.

Backend tidak pernah melihat password dan tidak pernah bicara dengan Google.

---

## 7. Kode untuk frontend (Daffa)

```bash
npm install @supabase/supabase-js
```

`lib/supabase.js`:

```js
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
```

Frontend cukup pakai `anon` key. Jangan pakai `service_role`.

### Login

```js
// Email + password
await supabase.auth.signUp({ email, password });
await supabase.auth.signInWithPassword({ email, password });

// Google
await supabase.auth.signInWithOAuth({
  provider: "google",
  options: { redirectTo: `${location.origin}/dashboard` },
});

// Keluar
await supabase.auth.signOut();
```

### Memanggil backend

Setiap permintaan ke backend wajib membawa token:

```js
const API = process.env.NEXT_PUBLIC_API_URL; // http://localhost:4000

async function api(path, body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Belum login");

  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}
```

### Alur lengkap dari sisi frontend

```js
// Tahap 0 — pengguna belum tahu butuh apa
const d = await api("/api/generate/diagnose", {
  need: "aku pengen keripikku bisa masuk ke kafe-kafe",
});
// d.recommended  -> "penawaran_produk"
// d.reason       -> penjelasan untuk ditampilkan ke pengguna
// d.askFor       -> dipakai sebagai panduan/placeholder formulir
// d.supported    -> kalau false, tampilkan d.fallbackMessage

// Tahap 1 — kerangka
const ctx = {
  template: d.recommended,
  businessName: "Keripik Bu Tini",
  audience: "Pemilik kafe di Bekasi",
  brief: "...minimal 50 karakter...",
};
const { outline } = await api("/api/generate/outline", ctx);

// pengguna menyunting outline di UI, lalu:

// Tahap 2 — isi slide
const { slides } = await api("/api/generate/slides", { context: ctx, outline });

// Unduh PPTX (respons berupa berkas, bukan JSON)
const { data: { session } } = await supabase.auth.getSession();
const res = await fetch(`${API}/api/export/pptx`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
  },
  body: JSON.stringify({
    template: ctx.template,
    businessName: ctx.businessName,
    // Opsional. Dipakai di footer tiap slide, sama seperti footer kanvas
    // editor. Kalau kosong, footer memakai businessName.
    deckTitle: "Penawaran Keripik Bu Tini 2026",
    brandKit: { primaryColor: "#0F4C81", accentColor: "#F2A007" },
    slides,
  }),
});
const blob = await res.blob();
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = "presentasi.pptx";
a.click();
URL.revokeObjectURL(url);
```

`.env.local` untuk frontend:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
NEXT_PUBLIC_API_URL=http://localhost:4000
```

---

## 8. Uji tanpa frontend (untuk fase machine-to-machine)

Karena FE menyusul, cara paling cepat dapat token asli:

1. Buat akun tes lewat **Authentication** > **Users** > **Add user**
2. Ambil token pakai `curl`:

```bash
curl -X POST 'https://xxxxxxxx.supabase.co/auth/v1/token?grant_type=password' \
  -H "apikey: <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email":"tes@contoh.com","password":"rahasia123"}'
```

3. Copy `access_token` dari responsnya
4. Buka `http://localhost:4000/docs`, klik **Authorize**, tempel token
5. Semua endpoint sekarang bisa dicoba langsung dari Swagger

Ini yang bikin Swagger berguna untuk fase machine-to-machine: Rifka bisa
menguji promptnya lewat UI tanpa perlu menunggu halaman dari Daffa.
