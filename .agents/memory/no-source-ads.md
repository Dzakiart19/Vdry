---
name: No Source Ads Rule
description: Syarat mutlak saat menambah platform baru — tidak boleh ada iklan dari web sumber yang muncul ke user.
---

## Rule
Platform baru wajib proxy video sebagai MP4/m3u8 langsung dari CDN ke browser user via backend Vidorey. Tidak boleh ada halaman embed, iframe, atau script milik situs sumber yang di-load di browser user.

**Why:** Semua embed host pihak ketiga (putarvid, filemoon, dood, dsb.) menyuntikkan script iklan mereka sendiri ke dalam halaman embed. Kalau embed-nya di-load di browser user, iklan itu ikut tampil — bertentangan dengan desain Vidorey yang hanya menampilkan iklan Adsterra milik sendiri.

**How to apply:**
1. Sebelum mulai build platform baru, curl setiap lapisan chain video dari server (bukan browser). Chain harus bisa di-resolve sampai ke URL MP4 atau m3u8 yang bisa diproxy langsung.
2. Jika salah satu lapisan chain memblokir server request (403, SPA < 2KB tanpa konten, atau butuh JS-rendering) → platform **tidak feasible**, jangan diimplementasikan.
3. Yang dikirim ke frontend hanya URL `/proxy/pN/...` milik backend sendiri — bukan URL CDN asli, bukan URL embed.

## Contoh yang BENAR (P1–P6)
- P1: server scrape `embed.php` → MP4 URL → `/proxy/stream/:id` (user hanya lihat proxy kita)
- P2: server fetch putarvid → decode PackerJS → m3u8 → `/proxy/rb/seg` (user tidak tahu putarvid ada)
- P3: server resolve bysezejataos/streamhls → AES decrypt → m3u8 → `/proxy/yb/seg`
- P4: server scrape post HTML → extract MP4 URL → `/proxy/bk/stream/:slug`
- P5: server scrape `__NEXT_DATA__` → HLS URL → `/proxy/tp/seg` (tidak ada iframe tik.porn)
- P6: server call `api.reddclips.com` JSON → MP4 hash → `/proxy/rc/stream/:hash` (tidak ada embed)

## Contoh yang SALAH (bokepbarat.cc — rejected)
bokepbarat.cc → vid.pemersatu.link → config JSON → embed URLs (dood.li, filemoon, doodporn).
Semua provider embed memblokir server request atau SPA tanpa API terbuka → tidak bisa di-resolve → tidak feasible.
