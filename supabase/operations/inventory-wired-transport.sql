create schema if not exists inventory_hub;
revoke all on schema inventory_hub from public, anon, authenticated;
create extension if not exists postgres_fdw with schema extensions;
create server if not exists wired_inventory_source foreign data wrapper postgres_fdw
 options (host 'db.klfomayggscumxevsfgp.supabase.co', port '5432', dbname 'postgres',
          sslmode 'verify-full', sslrootcert '/etc/ssl/certs/postgres/ca.crt', connect_timeout '5', fetch_size '200');
revoke all on foreign server wired_inventory_source from public, anon, authenticated;
create foreign table if not exists inventory_hub.wired_offers (
 source_id text, sku text, product_name text, variant_name text, unit text,
 reported_stock numeric, updated_at timestamptz
) server wired_inventory_source options (schema_name 'trefil_exchange', table_name 'offers', updatable 'false');
