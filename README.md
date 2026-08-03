# Paddle Bounce Idle

Game idle/incremental sederhana berbasis browser: jatuhkan bola ke papan,
biarkan memantul dan menabrak paddle di tiap sisi untuk menghasilkan uang
otomatis. Gunakan uang untuk membeli upgrade (tambah bola, naikkan profit,
tambah paddle, atau merge paddle).

Game ini adalah **single file HTML** (`index.html`) — tidak perlu build step,
bisa langsung dibuka di browser atau di-hosting sebagai static site (mis.
GitHub Pages).

## Fitur

- Progres otomatis tersimpan di perangkat (localStorage) — tidak perlu setup
  apapun, langsung jalan.
- **Cloud Save** opsional via [Supabase](https://supabase.com) agar progres
  bisa disambung di perangkat lain.
- **Leaderboard global** opsional (juga via Supabase), menampilkan peringkat
  pemain berdasarkan total uang yang pernah dihasilkan.

Jika kamu tidak mengonfigurasi Supabase, game tetap berjalan normal — hanya
tab "Cloud Save" dan "Leaderboard" akan menampilkan pesan bahwa fitur belum
aktif.

---

## 1. Setup Supabase (Cloud Save + Leaderboard)

### a. Buat project

1. Buka [supabase.com](https://supabase.com) → **Sign up / Sign in** → **New project**.
2. Isi nama project, password database (simpan baik-baik), pilih region
   terdekat, lalu klik **Create new project** (tunggu ~1-2 menit).

### b. Jalankan schema database

1. Di dashboard project, buka menu **SQL Editor** → **New query**.
2. Copy seluruh isi file [`supabase/schema.sql`](supabase/schema.sql) di
   folder ini, paste ke editor, lalu klik **Run**.
   Ini akan membuat tabel `profiles`, `saves`, `leaderboard` beserta aturan
   keamanan (Row Level Security) yang memastikan setiap pemain hanya bisa
   mengubah datanya sendiri, sementara leaderboard bisa dibaca siapa saja.

### c. Aktifkan Anonymous Sign-In

Game ini memakai login anonim (tanpa perlu email/password) supaya pemain
bisa langsung main, sambil tetap punya identitas unik untuk save & leaderboard.

1. Di dashboard, buka **Authentication** → **Sign In / Providers**.
2. Cari **Anonymous Sign-In** dan aktifkan (toggle **Enable**).
3. Simpan.

### d. Ambil URL & anon key

1. Buka **Project Settings** → **API**.
2. Salin nilai **Project URL** dan **anon public** key.
3. Buka `index.html`, cari blok berikut di bagian atas (dekat sebelum
   `<!-- Script Game Original -->`):

   ```html
   <script>
     window.SUPABASE_URL = "";
     window.SUPABASE_ANON_KEY = "";
   </script>
   ```

4. Isi dengan nilai kamu, misalnya:

   ```html
   <script>
     window.SUPABASE_URL = "https://xxxxxxxxxxxx.supabase.co";
     window.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....";
   </script>
   ```

5. Simpan file. Reload game — buka tab **Cloud Save** di menu Info (ikon `?`),
   set nama pemain, lalu klik **Simpan ke Cloud**. Cek tab **Leaderboard**
   untuk melihat skor tampil.

> **Catatan keamanan:** `anon key` memang didesain untuk dipakai di sisi
> browser (public), bukan rahasia seperti `service_role key`. Keamanan data
> tetap dijaga lewat Row Level Security yang sudah diatur di `schema.sql`.
> **Jangan pernah** menaruh `service_role key` di file yang di-publish ke
> GitHub.

### Bagaimana cara kerjanya?

- Saat pertama kali membuka tab Cloud Save, game membuat sesi **anonymous
  auth** di Supabase (satu UUID unik per browser/perangkat, disimpan otomatis
  oleh Supabase di localStorage).
- Skor leaderboard = **total uang yang pernah dihasilkan** sepanjang
  permainan (bukan saldo saat ini yang bisa berkurang karena dibelanjakan).
- Data save lengkap (uang, upgrade, posisi paddle, dll) disimpan sebagai JSON
  di tabel `saves`, hanya bisa dibaca/ditulis oleh pemiliknya sendiri.
- Autosave lokal berjalan terus-menerus; autosave ke cloud berjalan tiap 60
  detik selama pemain sudah mengatur nama.

---

## 2. Upload ke GitHub & mainkan online (GitHub Pages)

### a. Siapkan repo lokal

Buka terminal di folder project ini (`Bouncer/`), lalu jalankan:

```sh
git init
git add .
git commit -m "Initial commit: Paddle Bounce Idle"
```

### b. Buat repository di GitHub

1. Login ke [github.com](https://github.com).
2. Klik tombol **+** di pojok kanan atas → **New repository**.
3. Isi nama repo (mis. `paddle-bounce-idle`), biarkan **Public**, **jangan**
   centang "Add a README" (karena sudah ada), lalu klik **Create repository**.
4. GitHub akan menampilkan perintah `git remote add ...` — salin URL repo-nya
   (mis. `https://github.com/USERNAME/paddle-bounce-idle.git`).

### c. Push ke GitHub

```sh
git branch -M main
git remote add origin https://github.com/USERNAME/paddle-bounce-idle.git
git push -u origin main
```

Ganti `USERNAME` dan nama repo sesuai punyamu. Jika diminta login, gunakan
GitHub Desktop / Personal Access Token / GitHub CLI (`gh auth login`) sesuai
metode autentikasi yang kamu punya.

### d. Aktifkan GitHub Pages

1. Di halaman repo GitHub, buka **Settings** → **Pages**.
2. Pada **Source**, pilih **Deploy from a branch**.
3. Pilih branch **main** dan folder **/ (root)**, klik **Save**.
4. Tunggu 1-2 menit, lalu refresh halaman — akan muncul URL seperti:

   ```
   https://USERNAME.github.io/paddle-bounce-idle/
   ```

Game sudah bisa dimainkan siapa saja lewat URL tersebut. File utama sudah
bernama `index.html` sehingga otomatis terbuka sebagai halaman utama.

### e. Update selanjutnya

Setiap kali mengubah game, cukup:

```sh
git add .
git commit -m "Deskripsikan perubahan"
git push
```

GitHub Pages akan otomatis re-deploy setelah push ke branch `main`.

---

## Struktur file

```
index.html            <- game utama (HTML + CSS + JS, single file)
supabase/schema.sql   <- skema database untuk cloud save & leaderboard
README.md             <- dokumen ini
```
