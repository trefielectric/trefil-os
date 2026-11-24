-- Business data stays behind the same institutional permissions used by Equipo.
create schema if not exists inventory_hub;
revoke all on schema inventory_hub from public, anon, authenticated;

create table inventory_hub.sources (
  source text primary key check (source in ('wired','mastershop')),
  evidence text not null default 'pendiente',
  last_success timestamptz,
  last_attempt timestamptz,
  last_error text
);
insert into inventory_hub.sources(source) values ('wired'),('mastershop');

create table inventory_hub.offers (
  source text not null references inventory_hub.sources,
  external_id text not null,
  sku text,
  label text not null,
  variant text,
  unit text,
  reported numeric,
  active boolean not null default true,
  primary key (source,external_id)
);

-- A commercial offer, an imported historical item and a physical SKU are distinct entities.
create table inventory_hub.items (
  code text primary key,
  name text not null,
  base_unit text not null
);
create table inventory_hub.links (
  source text not null check(source in ('wired','mastershop','alegra')),
  external_id text not null,
  code text not null references inventory_hub.items,
  factor numeric not null check(factor>0 and factor<'Infinity'::numeric),
  actor uuid not null,
  verified_at timestamptz not null default now(),
  primary key(source,external_id)
);
create table inventory_hub.balances (
  code text not null references inventory_hub.items,
  warehouse text not null,
  physical numeric not null default 0,
  reserved numeric not null default 0,
  revision bigint not null default 0,
  check (physical>=0 and reserved between 0 and physical),
  primary key(code,warehouse)
);
create table inventory_hub.reservations (
  code text not null, warehouse text not null, document text not null,
  quantity numeric not null check(quantity>=0),
  primary key(code,warehouse,document),
  foreign key(code,warehouse) references inventory_hub.balances
);
create table inventory_hub.movements (
  request_id uuid primary key, code text not null, warehouse text not null,
  kind text not null check(kind in ('conteo','entrada','salida','reserva','liberacion','despacho','devolucion')),
  quantity numeric not null, document text not null, actor uuid not null,
  at_time timestamptz not null default now(),
  resulting_physical numeric not null, resulting_reserved numeric not null,
  revision bigint not null,
  unique(code,warehouse,kind,document),
  foreign key(code,warehouse) references inventory_hub.balances
);
alter table inventory_hub.sources enable row level security;
alter table inventory_hub.offers enable row level security;
alter table inventory_hub.items enable row level security;
alter table inventory_hub.links enable row level security;
alter table inventory_hub.balances enable row level security;
alter table inventory_hub.reservations enable row level security;
alter table inventory_hub.movements enable row level security;
revoke all on all tables in schema inventory_hub from public, anon, authenticated;

create view inventory_hub.catalog as
select o.source,o.external_id,o.sku,o.label,o.variant,o.unit,o.reported
from inventory_hub.offers o where o.active
union all
select 'alegra',p.source_code,p.reference,p.name,null::text,p.unit,null::numeric
from alegra.products p
where p.batch_id=(select b.id from alegra.import_batches b where b.status='completed'
                  order by b.completed_at desc,b.id desc limit 1);

create function inventory_hub.replace_snapshot(p_source text,p_evidence text,p_at timestamptz,p_rows jsonb)
returns integer language plpgsql set search_path='' as $$
declare previous inventory_hub.sources; n integer;
begin
  select * into strict previous from inventory_hub.sources where source=p_source for update;
  if p_at is null or jsonb_typeof(p_rows) is distinct from 'array' or p_evidence not in ('panel','api','directa') then
    raise exception 'Captura de inventario inválida.';
  end if;
  if previous.last_success>p_at or (p_evidence='panel' and previous.evidence='api') then
    return (select count(*) from inventory_hub.offers where source=p_source and active);
  end if;
  n:=jsonb_array_length(p_rows);
  if exists(select from jsonb_to_recordset(p_rows) r(id text,label text) where nullif(btrim(r.id),'') is null or nullif(btrim(r.label),'') is null)
     or n<>(select count(distinct r.id) from jsonb_to_recordset(p_rows) r(id text)) then
    raise exception 'La fuente entregó referencias incompletas o repetidas.';
  end if;
  insert into inventory_hub.offers(source,external_id,sku,label,variant,unit,reported,active)
    select p_source,r.id,r.sku,r.label,r.variant,r.unit,r.stock,true
    from jsonb_to_recordset(p_rows) r(id text,sku text,label text,variant text,unit text,stock numeric)
    on conflict(source,external_id) do update set sku=excluded.sku,label=excluded.label,variant=excluded.variant,
       unit=excluded.unit,reported=excluded.reported,active=true;
  update inventory_hub.offers o set active=false where o.source=p_source and o.active
    and not exists(select from jsonb_array_elements(p_rows) e where e->>'id'=o.external_id);
  update inventory_hub.sources set evidence=p_evidence,last_success=p_at,last_attempt=p_at,last_error=null where source=p_source;
  return n;
end $$;

create function inventory_hub.snapshot(p_source text,p_search text,p_page integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor workforce.people:=workforce.require_person(); cnt integer; rows jsonb; term text:=left(btrim(coalesce(p_search,'')),120);
begin
  if not workforce.has_permission(actor,'inventory_view') then raise exception 'Se requiere permiso para consultar inventarios.' using errcode='42501'; end if;
  if p_source is null or p_source not in ('todos','wired','mastershop','alegra','fisico') or p_page is null or p_page not between 1 and 100000 then raise exception 'Filtro inválido.'; end if;
  if p_source='fisico' then
    select count(*) into cnt from inventory_hub.items i where concat_ws(' ',i.code,i.name) ilike '%'||term||'%';
    select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.code),'[]') into rows from (
      select i.code,i.name as label,i.base_unit,coalesce((select jsonb_agg(jsonb_build_object('warehouse',b.warehouse,
        'physical',b.physical,'reserved',b.reserved,'available',b.physical-b.reserved,'revision',b.revision) order by b.warehouse)
        from inventory_hub.balances b where b.code=i.code and b.revision>0),'[]') as balances
      from inventory_hub.items i where concat_ws(' ',i.code,i.name) ilike '%'||term||'%'
      order by i.name,i.code limit 40 offset (p_page-1)*40) x;
  else
    with selected as materialized (
      select c.*,l.code,l.factor,i.base_unit from inventory_hub.catalog c
      left join inventory_hub.links l using(source,external_id)
      left join inventory_hub.items i on i.code=l.code
      where (p_source='todos' or c.source=p_source) and concat_ws(' ',c.label,c.variant,c.sku,c.external_id,l.code) ilike '%'||term||'%'
    ) select (select count(*) from selected),
      coalesce((select jsonb_agg(to_jsonb(x) order by x.label,x.source,x.external_id) from (
        select * from selected order by label,source,external_id limit 40 offset (p_page-1)*40)x),'[]') into cnt,rows;
  end if;
  return jsonb_build_object('items',rows,'total',cnt,'page',p_page,'page_size',40,
    'sources',(select coalesce(jsonb_agg(to_jsonb(x) order by x.source),'[]') from (
      select c.source,count(*) as total,count(l.code) as linked from inventory_hub.catalog c
      left join inventory_hub.links l using(source,external_id) group by c.source)x),
    'feeds',(select jsonb_agg(to_jsonb(f) order by f.source) from inventory_hub.sources f),
    'approve',workforce.has_permission(actor,'inventory_approve'),
    'register',workforce.has_permission(actor,'inventory_register'));
end $$;

create function inventory_hub.verify_link(p_source text,p_id text,p_code text,p_name text,p_unit text,p_factor numeric) returns void
language plpgsql security definer set search_path='' as $$
declare actor workforce.people:=workforce.require_person(); item inventory_hub.items; link inventory_hub.links;
begin
  if not workforce.has_permission(actor,'inventory_approve') then raise exception 'Se requiere aprobación de inventario.' using errcode='42501'; end if;
  p_code:=upper(btrim(p_code)); p_unit:=lower(btrim(p_unit));p_name:=btrim(p_name);
  if coalesce(length(p_code),0) not between 1 and 80 or coalesce(length(p_name),0) not between 1 and 200
    or coalesce(length(p_unit),0) not between 1 and 40 or p_factor is null or not(p_factor>0 and p_factor<'Infinity'::numeric)
    or not exists(select 1 from inventory_hub.catalog where source=p_source and external_id=p_id)
  then raise exception 'Revisa la referencia, la unidad base y el factor de conversión.'; end if;
  insert into inventory_hub.items(code,name,base_unit) values(p_code,p_name,p_unit) on conflict do nothing;
  select * into strict item from inventory_hub.items where code=p_code;
  if item.base_unit<>p_unit or lower(item.name)<>lower(p_name) then raise exception 'Ese código físico ya tiene otra descripción o unidad.'; end if;
  insert into inventory_hub.links(source,external_id,code,factor,actor)
    values(p_source,p_id,p_code,p_factor,actor.id) on conflict do nothing;
  select * into strict link from inventory_hub.links where source=p_source and external_id=p_id;
  if link.code<>p_code or link.factor<>p_factor then raise exception 'La referencia ya tiene otra equivalencia aprobada.'; end if;
end $$;

create function inventory_hub.record(p_code text,p_warehouse text,p_kind text,p_qty numeric,p_document text,p_revision bigint,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor workforce.people:=workforce.require_person(); b inventory_hub.balances; old inventory_hub.movements;
        booked numeric:=0; delta_booked numeric:=0;
begin
  if not workforce.has_permission(actor,case when p_kind='conteo' then 'inventory_approve' else 'inventory_register' end)
  then raise exception 'Tu rol no permite registrar esta operación.' using errcode='42501'; end if;
  p_code:=upper(btrim(p_code)); p_warehouse:=upper(btrim(p_warehouse)); p_document:=upper(btrim(p_document));
  if p_kind is null or p_kind not in ('conteo','entrada','salida','reserva','liberacion','despacho','devolucion') or p_request is null
    or coalesce(length(p_warehouse),0) not between 1 and 100 or coalesce(length(p_document),0) not between 1 and 160
    or p_qty is null or not(p_qty>=0 and p_qty<'Infinity'::numeric) or (p_qty=0 and p_kind<>'conteo') or p_revision is null then raise exception 'Revisa la bodega, el documento y la cantidad.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
  insert into inventory_hub.balances(code,warehouse) values(p_code,p_warehouse) on conflict do nothing;
  select * into strict b from inventory_hub.balances where code=p_code and warehouse=p_warehouse for update;
  select * into old from inventory_hub.movements where request_id=p_request
    or (code=p_code and warehouse=p_warehouse and kind=p_kind and document=p_document) order by (request_id=p_request) desc limit 1;
  if found then
    if (old.code,old.warehouse,old.kind,old.quantity,old.document) is distinct from (p_code,p_warehouse,p_kind,p_qty,p_document)
      then raise exception 'La solicitud ya se usó para otra operación.'; end if;
    return to_jsonb(old);
  end if;
  if b.revision<>p_revision then raise exception 'El saldo cambió. Actualiza el inventario antes de registrar.' using errcode='40001'; end if;
  if b.revision=0 and p_kind<>'conteo' then raise exception 'Registra primero el conteo físico de apertura.'; end if;
  case p_kind
    when 'conteo' then b.physical:=p_qty;
    when 'entrada','devolucion' then b.physical:=b.physical+p_qty;
    when 'salida' then b.physical:=b.physical-p_qty;
    when 'reserva' then delta_booked:=p_qty;
    when 'liberacion' then delta_booked:=-p_qty;
    when 'despacho' then delta_booked:=-p_qty; b.physical:=b.physical-p_qty;
  end case;
  if delta_booked<>0 then
    select quantity into booked from inventory_hub.reservations where code=p_code and warehouse=p_warehouse and document=p_document;
    booked:=coalesce(booked,0)+delta_booked;
    if booked<0 then raise exception 'La reserva de ese documento es insuficiente.'; end if;
    b.reserved:=b.reserved+delta_booked;
    insert into inventory_hub.reservations(code,warehouse,document,quantity) values(p_code,p_warehouse,p_document,booked)
      on conflict(code,warehouse,document) do update set quantity=excluded.quantity;
  end if;
  if b.physical<b.reserved or b.reserved<0 then raise exception 'La operación supera el disponible de la bodega.'; end if;
  update inventory_hub.balances set physical=b.physical,reserved=b.reserved,revision=b.revision+1
    where code=p_code and warehouse=p_warehouse;
  insert into inventory_hub.movements values(p_request,p_code,p_warehouse,p_kind,p_qty,p_document,actor.id,now(),b.physical,b.reserved,b.revision+1)
    returning * into old;
  return to_jsonb(old);
end $$;

revoke all on all functions in schema inventory_hub from public,anon,authenticated;
grant usage on schema inventory_hub to authenticated;
grant execute on function inventory_hub.snapshot(text,text,integer),inventory_hub.verify_link(text,text,text,text,text,numeric),
 inventory_hub.record(text,text,text,numeric,text,bigint,uuid) to authenticated;
create function public.central_inventory(p_source text default 'todos',p_search text default '',p_page integer default 1)
returns jsonb language sql security invoker set search_path='' as $$select inventory_hub.snapshot(p_source,p_search,p_page)$$;
create function public.central_inventory_link(p_source text,p_id text,p_code text,p_name text,p_unit text,p_factor numeric)
returns void language sql security invoker set search_path='' as $$select inventory_hub.verify_link(p_source,p_id,p_code,p_name,p_unit,p_factor)$$;
create function public.central_inventory_record(p_code text,p_warehouse text,p_kind text,p_qty numeric,p_document text,p_revision bigint,p_request uuid)
returns jsonb language sql security invoker set search_path='' as $$select inventory_hub.record(p_code,p_warehouse,p_kind,p_qty,p_document,p_revision,p_request)$$;
revoke all on function public.central_inventory(text,text,integer),public.central_inventory_link(text,text,text,text,text,numeric),
 public.central_inventory_record(text,text,text,numeric,text,bigint,uuid) from public,anon;
grant execute on function public.central_inventory(text,text,integer),public.central_inventory_link(text,text,text,text,text,numeric),
 public.central_inventory_record(text,text,text,numeric,text,bigint,uuid) to authenticated;
