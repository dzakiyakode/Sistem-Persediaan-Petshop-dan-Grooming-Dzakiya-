# Petshop dan Grooming Dzakiya

Aplikasi persediaan dan pencatatan transaksi sederhana dengan frontend HTML/CSS/JavaScript, backend Node.js tanpa paket eksternal, dan Supabase Postgres.

## Struktur

- `frontend/` - antarmuka aplikasi.
- `backend/app.js` - server HTTP dan API yang memakai Supabase REST.
- `backend/schema.sql` - empat tabel, fungsi transaksi atomik, indeks, keamanan RLS, dan katalog awal.
- `docs/skema-database.md` - dokumentasi lengkap ERD, entitas, relasi, constraint, alur transaksi, dan akses database.

## ERD (4 entitas)

```mermaid
erDiagram
    CUSTOMERS ||--o{ TRANSACTIONS : melakukan
    TRANSACTIONS ||--|{ TRANSACTION_DETAILS : memiliki
    ITEMS ||--o{ TRANSACTION_DETAILS : dicatat_dalam

    CUSTOMERS {
        uuid id PK
        text name
        text phone UK
        timestamptz created_at
    }
    ITEMS {
        uuid id PK
        text name
        text type
        text category
        numeric price
        integer stock
        integer low_stock_threshold
    }
    TRANSACTIONS {
        uuid id PK
        uuid customer_id FK
        text kind
        numeric total
        timestamptz created_at
    }
    TRANSACTION_DETAILS {
        uuid id PK
        uuid transaction_id FK
        uuid item_id FK
        integer quantity
        numeric unit_price
        numeric line_total
    }
```

Produk dan layanan berada pada entitas `items`; kolom `type` membedakan keduanya. Transaksi penjualan otomatis mengurangi stok melalui fungsi Postgres yang berjalan atomik.

## Menjalankan Tanpa Node.js

1. Jalankan `backend/schema.sql` di Supabase SQL Editor.
2. URL dan publishable key sudah diatur di `frontend/app.js`.
3. Buka `frontend/index.html` langsung di browser. Frontend menghubungi Supabase REST API tanpa server lokal.

`backend/app.js` adalah opsi server Node terpisah dan tidak diperlukan untuk cara menjalankan statis ini. Tidak ada `package.json` maupun dependensi runtime.

**Peringatan:** skema saat ini menonaktifkan RLS dan memberi role `anon` akses baca/tulis ke data pelanggan, stok, transaksi, dan RPC. Siapa pun yang mendapat URL project dapat mengakses database. Aktifkan autentikasi dan kebijakan RLS sebelum memakai data produksi.
