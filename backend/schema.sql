-- Petshop dan Grooming Dzakiya
-- Four entities: customers, items, transactions, transaction_details.

create extension if not exists pgcrypto;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('product', 'service')),
  category text not null default 'Umum',
  price numeric(12, 2) not null check (price >= 0),
  stock integer not null default 0 check (stock >= 0),
  low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  created_at timestamptz not null default now(),
  check (type = 'product' or stock = 0)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  kind text not null check (kind in ('sale', 'grooming')),
  total numeric(12, 2) not null default 0 check (total >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.transaction_details (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  item_id uuid not null references public.items(id),
  quantity integer not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  line_total numeric(12, 2) not null check (line_total >= 0)
);

create index if not exists transactions_created_at_idx on public.transactions (created_at desc);
create index if not exists transaction_details_transaction_id_idx on public.transaction_details (transaction_id);

alter table public.customers disable row level security;
alter table public.items disable row level security;
alter table public.transactions disable row level security;
alter table public.transaction_details disable row level security;

grant usage on schema public to anon;
grant select, insert, update, delete on public.customers, public.items, public.transactions, public.transaction_details to anon;

create or replace function public.create_transaction(
  p_customer_name text,
  p_customer_phone text,
  p_kind text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  customer_uuid uuid;
  transaction_uuid uuid;
  item_row public.items%rowtype;
  line jsonb;
  line_quantity integer;
  calculated_total numeric(12, 2) := 0;
begin
  if nullif(trim(p_customer_name), '') is null then
    raise exception 'Nama pelanggan wajib diisi';
  end if;

  if p_kind not in ('sale', 'grooming') then
    raise exception 'Jenis transaksi tidak valid';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Transaksi harus memiliki minimal satu item';
  end if;

  if nullif(trim(p_customer_phone), '') is null then
    select id into customer_uuid
    from public.customers
    where lower(name) = lower(trim(p_customer_name))
    order by created_at
    limit 1;

    if customer_uuid is null then
      insert into public.customers (name) values (trim(p_customer_name)) returning id into customer_uuid;
    end if;
  else
    insert into public.customers (name, phone)
    values (trim(p_customer_name), trim(p_customer_phone))
    on conflict (phone) do update set name = excluded.name
    returning id into customer_uuid;
  end if;

  insert into public.transactions (customer_id, kind)
  values (customer_uuid, p_kind)
  returning id into transaction_uuid;

  for line in select value from jsonb_array_elements(p_items)
  loop
    line_quantity := (line->>'quantity')::integer;
    if line_quantity < 1 then
      raise exception 'Jumlah item minimal 1';
    end if;

    select * into item_row
    from public.items
    where id = (line->>'itemId')::uuid
    for update;

    if not found then
      raise exception 'Produk atau layanan tidak ditemukan';
    end if;

    if (p_kind = 'sale' and item_row.type <> 'product')
      or (p_kind = 'grooming' and item_row.type <> 'service') then
      raise exception 'Jenis item tidak sesuai dengan transaksi';
    end if;

    if item_row.type = 'product' and item_row.stock < line_quantity then
      raise exception 'Stok % tidak mencukupi (tersedia %)', item_row.name, item_row.stock;
    end if;

    insert into public.transaction_details (transaction_id, item_id, quantity, unit_price, line_total)
    values (
      transaction_uuid,
      item_row.id,
      line_quantity,
      item_row.price,
      item_row.price * line_quantity
    );

    calculated_total := calculated_total + item_row.price * line_quantity;

    if item_row.type = 'product' then
      update public.items set stock = stock - line_quantity where id = item_row.id;
    end if;
  end loop;

  update public.transactions set total = calculated_total where id = transaction_uuid;

  return jsonb_build_object('id', transaction_uuid, 'total', calculated_total);
end;
$$;

revoke all on function public.create_transaction(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_transaction(text, text, text, jsonb) to anon, service_role;

insert into public.items (name, type, category, price, stock, low_stock_threshold)
select sample.name, sample.type, sample.category, sample.price, sample.stock, sample.low_stock_threshold
from (values
  ('Makanan Kucing Premium 1 kg', 'product', 'Makanan', 68000, 18, 5),
  ('Pasir Gumpal Lavender 5 L', 'product', 'Kebersihan', 42000, 3, 5),
  ('Mainan Bola Kucing', 'product', 'Aksesori', 15000, 12, 4),
  ('Grooming Mandi & Blow', 'service', 'Grooming', 85000, 0, 0),
  ('Potong Kuku', 'service', 'Grooming', 25000, 0, 0)
) as sample(name, type, category, price, stock, low_stock_threshold)
where not exists (
  select 1 from public.items existing where existing.name = sample.name
);

insert into public.customers (name)
select sample.name
from (values
  ('Alya Kirana Putri'),
  ('Bima Aditya Pratama'),
  ('Citra Maharani'),
  ('Daffa Ramadhan'),
  ('Intan Permata Sari'),
  ('Nanda Puspita'),
  ('Rizky Akbar Nugraha'),
  ('Siti Aulia Rahma'),
  ('Raka Wibowo'),
  ('Zahra Nurfadila')
) as sample(name)
where not exists (
  select 1 from public.customers existing where lower(existing.name) = lower(sample.name)
);
