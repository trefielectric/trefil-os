-- Managed Supabase setup. Credentials live in Vault or the private server mapping.
create extension if not exists http with schema extensions;
create extension if not exists pg_cron;
create or replace function inventory_hub.refresh_wired() returns integer
language plpgsql set search_path='' as $$
declare captured timestamptz:=clock_timestamp(); batch jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('trefil:feed:wired',0)) then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',source_id,'sku',sku,'label',product_name,'variant',variant_name,'unit',unit,'stock',reported_stock)), '[]') into batch from inventory_hub.wired_offers;
  return inventory_hub.replace_snapshot('wired','directa',captured,batch);
exception when others then
  update inventory_hub.sources set last_attempt=clock_timestamp(),last_error='No se completó la lectura de Wired. Se conserva la última lectura.' where source='wired'; return null;
end $$;

-- Keep this API bound to the Wired Colombia shop across credential rotations.
alter table inventory_hub.sources add column if not exists account_id text;
alter table inventory_hub.sources add column if not exists product_count integer;
create or replace function inventory_hub.refresh_mastershop() returns integer
language plpgsql set search_path='' as $$
declare
  key_value text; response extensions.http_response; payload jsonb; page_data jsonb;
  products jsonb:='[]'; rows_to_store jsonb; page_no integer:=1; total integer; expected integer;
  captured timestamptz:=clock_timestamp(); owner_id text; previous inventory_hub.sources;
  message text:='Mastershop devolvió una respuesta incompleta. Se conserva la lectura anterior.';
begin
  if not pg_try_advisory_xact_lock(hashtextextended('trefil:feed:mastershop',0)) then return null; end if;
  select * into strict previous from inventory_hub.sources where source='mastershop' for update;
  select decrypted_secret into key_value from vault.decrypted_secrets where name='mastershop_wired_api_key';
  if nullif(trim(key_value),'') is null then
    update inventory_hub.sources set last_attempt=clock_timestamp(),last_error='Pendiente de llave de Wired Colombia en Vault.' where source='mastershop';
    return null;
  end if;
  perform set_config('http.curlopt_timeout_ms','10000',true);
  perform set_config('http.curlopt_connecttimeout_ms','3500',true);
  loop
    select * into response from extensions.http(('GET','https://prod.api.mastershop.com/api/products?page='||page_no||'&limit=20',
      array[extensions.http_header('ms-api-key',btrim(key_value)),extensions.http_header('Accept','application/json')],null,null)::extensions.http_request);
    if response.status<>200 then
      message:=format('Mastershop respondió HTTP %s. Se conserva la última lectura.',response.status);
      raise data_exception;
    end if;
    payload:=response.content::jsonb;
    if jsonb_typeof(payload->'data')='object' and not(payload?'results') then payload:=payload->'data'; end if;
    page_data:=payload->'results';
    total:=coalesce(payload#>>'{resultsCount,totalProducts}',payload->>'totalProducts')::integer;
    if jsonb_typeof(page_data) is distinct from 'array' or total is null or total<0 then raise data_exception; end if;
    if page_no=1 then expected:=total; end if;
    if total<>expected then raise data_exception; end if;
    products:=products||page_data;
    exit when jsonb_array_length(page_data)<20 or jsonb_array_length(products)>=expected;
    page_no:=page_no+1;
    if page_no>500 then raise data_exception; end if;
  end loop;
  if expected<>jsonb_array_length(products) or expected<>(select count(distinct p->>'idProduct') from jsonb_array_elements(products) p)
    or exists (select from jsonb_array_elements(products) p where nullif(p#>>'{productOwner,idBusiness}','') is null
      or nullif(btrim(p->>'name'),'') is null or (p->>'stockTotal')::numeric is null
      or jsonb_typeof(coalesce(p->'variation','[]'::jsonb)) is distinct from 'array')
  then raise data_exception; end if;
  select min(p#>>'{productOwner,idBusiness}') into owner_id from jsonb_array_elements(products) p;
  if exists(select from jsonb_array_elements(products) p where p#>>'{productOwner,idBusiness}'<>owner_id)
    or (owner_id is not null and previous.account_id is not null and owner_id<>previous.account_id)
    or (previous.account_id is null and exists(select from inventory_hub.offers where source='mastershop' and active)
      and not exists(select from jsonb_array_elements(products) p join inventory_hub.offers o
        on o.source='mastershop' and o.active and split_part(o.external_id,'/',1)=p->>'idProduct'))
  then
    message:='La cuenta de Mastershop no coincide con el catálogo de Wired Colombia.';
    raise data_exception;
  end if;
  if exists(select from jsonb_array_elements(products) p cross join jsonb_array_elements(p->'variation') v
    where nullif(v->>'idVariant','') is null or v->>'idProduct' is distinct from p->>'idProduct'
      or coalesce(v->>'isEnable','') not in ('0','1','false','true') or (v->>'stock')::numeric is null)
  then raise data_exception; end if;
  with all_products as (select p from jsonb_array_elements(products) p),
  enabled as (select p,v from all_products cross join lateral jsonb_array_elements(p->'variation') v
              where v->>'isEnable' in ('1','true')),
  offers as (
    select p->>'idProduct' as id,nullif(p->>'sku','') as sku,p->>'name' as label,null::text as variant,
      case when jsonb_array_length(coalesce(p->'variation','[]'::jsonb))>0 then null else (p->>'stockTotal')::numeric end as stock
    from all_products a where not exists(select from enabled e where e.p->>'idProduct'=a.p->>'idProduct')
    union all
    select (p->>'idProduct')||'/'||(v->>'idVariant'),nullif(v->>'sku',''),p->>'name',
      coalesce(nullif(btrim(v->>'name'),''),'Variante '||(v->>'idVariant')),(v->>'stock')::numeric from enabled)
  select coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('unit','unds.')),'[]') into rows_to_store from offers o;
  perform inventory_hub.replace_snapshot('mastershop','api',captured,rows_to_store);
  update inventory_hub.sources set product_count=expected,account_id=coalesce(account_id,owner_id) where source='mastershop';
  return expected;
exception when others then
  update inventory_hub.sources set last_attempt=clock_timestamp(),last_error=message where source='mastershop';
  return null;
end $$;
revoke all on function inventory_hub.refresh_mastershop() from public,anon,authenticated;
revoke all on function inventory_hub.refresh_wired(),inventory_hub.refresh_mastershop() from public,anon,authenticated;
select cron.schedule('trefil_inventario_wired','*/5 * * * *','select inventory_hub.refresh_wired()');
select cron.schedule('trefil_inventario_mastershop','2,17,32,47 * * * *','select inventory_hub.refresh_mastershop()');
