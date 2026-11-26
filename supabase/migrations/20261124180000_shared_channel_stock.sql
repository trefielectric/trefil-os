-- Each approved online reference uses the same counted dispatch warehouse in all channels.
create table inventory_hub.sales_warehouses (
  code text primary key, warehouse text not null, approved_by uuid not null,
  foreign key(code,warehouse) references inventory_hub.balances
);
create table inventory_hub.channel_orders (
  channel text not null references inventory_hub.sources(source),
  order_ref text not null, state text not null check(state in ('reserved','dispatched','cancelled')),
  lines jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(channel,order_ref)
);
create table inventory_hub.channel_order_lines (
  channel text not null, order_ref text not null, code text not null, warehouse text not null,
  quantity numeric not null check(quantity>0 and quantity<'Infinity'::numeric),
  primary key(channel,order_ref,code,warehouse),
  foreign key(channel,order_ref) references inventory_hub.channel_orders,
  foreign key(code,warehouse) references inventory_hub.balances
);
alter table inventory_hub.sales_warehouses enable row level security;
alter table inventory_hub.channel_orders enable row level security;
alter table inventory_hub.channel_order_lines enable row level security;
revoke all on inventory_hub.sales_warehouses,inventory_hub.channel_orders,inventory_hub.channel_order_lines from public,anon,authenticated;

create function inventory_hub.publish_count(p_code text,p_warehouse text,p_kind text,p_qty numeric,p_document text,p_revision bigint,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare staff workforce.people:=workforce.require_person(); result jsonb; existing text;
begin
  if not workforce.has_permission(staff,'inventory_approve') or p_kind is distinct from 'conteo' then
    raise exception 'Se requiere un conteo aprobado para publicar esta bodega.' using errcode='42501';
  end if;
  result:=inventory_hub.record(p_code,p_warehouse,p_kind,p_qty,p_document,p_revision,p_request);
  p_code:=result->>'code'; p_warehouse:=result->>'warehouse';
  insert into inventory_hub.sales_warehouses(code,warehouse,approved_by) values(p_code,p_warehouse,staff.id)
    on conflict(code) do nothing;
  select warehouse into strict existing from inventory_hub.sales_warehouses where code=p_code;
  if existing<>p_warehouse then raise exception 'La referencia ya tiene una bodega de despacho para estos canales.'; end if;
  return result;
end $$;
create function public.central_inventory_publish_count(p_code text,p_warehouse text,p_kind text,p_qty numeric,p_document text,p_revision bigint,p_request uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select inventory_hub.publish_count(p_code,p_warehouse,p_kind,p_qty,p_document,p_revision,p_request)
$$;
revoke all on function inventory_hub.publish_count(text,text,text,numeric,text,bigint,uuid),
 public.central_inventory_publish_count(text,text,text,numeric,text,bigint,uuid) from public,anon,authenticated;
grant execute on function inventory_hub.publish_count(text,text,text,numeric,text,bigint,uuid),
 public.central_inventory_publish_count(text,text,text,numeric,text,bigint,uuid) to authenticated;

-- Balances outside the explicitly approved dispatch warehouse are never promised online.
create view inventory_hub.channel_stock as
  select l.source as channel,l.external_id,l.code,l.factor,w.warehouse,
    case when w.warehouse is not null and b.revision>0 then floor((b.physical-b.reserved)/l.factor) end as available
  from inventory_hub.links l join inventory_hub.offers o on o.source=l.source and o.external_id=l.external_id and o.active
  left join inventory_hub.sales_warehouses w on w.code=l.code
  left join inventory_hub.balances b on (b.code,b.warehouse)=(w.code,w.warehouse);
revoke all on inventory_hub.channel_stock from public,anon,authenticated;

create function inventory_hub.read_stock(p_channel text,p_ids jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if p_channel is null or p_channel not in ('wired','mastershop') or jsonb_typeof(p_ids) is distinct from 'array' then
    raise exception 'Solicitud de disponibilidad inválida.';
  end if;
  if jsonb_array_length(p_ids) not between 1 and 500 or exists(
    select from jsonb_array_elements(p_ids) v where jsonb_typeof(v)<>'string' or length(v#>>'{}') not between 1 and 200
  ) then raise exception 'Referencias de consulta inválidas.'; end if;
  select jsonb_object_agg(ids.id,s.available) into result from (select distinct value as id from jsonb_array_elements_text(p_ids)) ids
  left join inventory_hub.channel_stock s on s.channel=p_channel and s.external_id=ids.id;
  return result;
end $$;

-- Order lines are immutable after reservation. Locks use a consistent code/warehouse order.
-- System operations keep a channel and order in the audit trail rather than inventing a person's identity.
alter table inventory_hub.movements add column order_channel text references inventory_hub.sources,
  alter column actor drop not null,
  add check(actor is not null or order_channel is not null);
create function inventory_hub.channel_sale(p_channel text,p_order text,p_action text,p_lines jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare prior inventory_hub.channel_orders; canonical jsonb; known integer; alloc record; balance inventory_hub.balances;
  target_state text; document_id text; movement_kind text; reserved_delta numeric; physical_delta numeric;
begin
  if p_channel is null or p_channel not in ('wired','mastershop') or p_order is null
    or length(p_order) not between 1 and 110 or p_order<>btrim(p_order) or p_order ~ '[[:cntrl:]]'
    or p_action is null or p_action not in ('reserve','dispatch','cancel') then raise exception 'Pedido o acción inválidos.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('channel-order:'||p_channel||':'||p_order,0));
  select * into prior from inventory_hub.channel_orders where channel=p_channel and order_ref=p_order for update;
  document_id:='CANAL/'||p_channel||'/'||p_order;
  if p_action='reserve' then
    if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Líneas de pedido inválidas.'; end if;
    if jsonb_array_length(p_lines) not between 1 and 100 or exists(
      select from jsonb_array_elements(p_lines) e where jsonb_typeof(e) is distinct from 'object'
      or jsonb_typeof(e->'id') is distinct from 'string' or length(e->>'id') not between 1 and 200
      or jsonb_typeof(e->'quantity') is distinct from 'number' or (e->>'quantity') !~ '^[1-9][0-9]{0,5}$'
    ) then raise exception 'Líneas de pedido inválidas.'; end if;
    select jsonb_agg(jsonb_build_object('id',id,'quantity',q) order by id) into canonical from
      (select e->>'id' id,sum((e->>'quantity')::integer) q from jsonb_array_elements(p_lines)e group by 1) x;
    if prior.state is not null then
      if prior.lines<>canonical then raise exception 'Ese pedido ya tiene otras cantidades o referencias.'; end if;
      if prior.state='cancelled' then raise exception 'El pedido está cancelado.'; end if;
      return prior.state;
    end if;
    insert into inventory_hub.channel_orders(channel,order_ref,state,lines) values(p_channel,p_order,'reserved',canonical);
    with mapped as materialized (
      select l.id,l.quantity*s.factor units,s.code,s.warehouse from jsonb_to_recordset(canonical) l(id text,quantity numeric)
      join inventory_hub.channel_stock s on s.channel=p_channel and s.external_id=l.id and s.available is not null
    ), inserted as (
      insert into inventory_hub.channel_order_lines(channel,order_ref,code,warehouse,quantity)
      select p_channel,p_order,code,warehouse,sum(units) from mapped group by code,warehouse returning code
    ) select count(*) into known from mapped;
    if known<>jsonb_array_length(canonical) then raise exception 'Referencia sin equivalencia o conteo publicado.'; end if;
    target_state:='reserved'; movement_kind:='reserva';
  else
    if prior.state is null then
      if p_action='cancel' then
        insert into inventory_hub.channel_orders(channel,order_ref,state,lines) values(p_channel,p_order,'cancelled','[]');
        return 'cancelled';
      end if;
      raise exception 'La reserva del pedido no existe.';
    end if;
    target_state:=case when p_action='dispatch' then 'dispatched' else 'cancelled' end;
    if prior.state=target_state then return prior.state; end if;
    if prior.state<>'reserved' then raise exception 'El estado del pedido no permite esta acción.'; end if;
    movement_kind:=case when p_action='dispatch' then 'despacho' else 'liberacion' end;
  end if;
  for alloc in select a.* from inventory_hub.channel_order_lines a where a.channel=p_channel and a.order_ref=p_order
    order by a.code,a.warehouse loop
    select * into strict balance from inventory_hub.balances where code=alloc.code and warehouse=alloc.warehouse for update;
    reserved_delta:=case when p_action='reserve' then alloc.quantity else -alloc.quantity end;
    physical_delta:=case when p_action='dispatch' then -alloc.quantity else 0 end;
    if p_action='reserve' and alloc.quantity>balance.physical-balance.reserved then raise exception 'Disponibilidad insuficiente.'; end if;
    update inventory_hub.balances set physical=physical+physical_delta,reserved=reserved+reserved_delta,revision=revision+1
      where code=alloc.code and warehouse=alloc.warehouse returning * into balance;
    insert into inventory_hub.movements(request_id,code,warehouse,kind,quantity,document,actor,at_time,resulting_physical,resulting_reserved,revision,order_channel)
      values(gen_random_uuid(),alloc.code,alloc.warehouse,movement_kind,alloc.quantity,document_id,null,now(),balance.physical,balance.reserved,balance.revision,p_channel);
  end loop;
  update inventory_hub.channel_orders set state=target_state,updated_at=now() where channel=p_channel and order_ref=p_order;
  return target_state;
end $$;
create function public.channel_inventory_stock(p_channel text,p_ids jsonb) returns jsonb language sql security invoker set search_path='' as $$
  select inventory_hub.read_stock(p_channel,p_ids)
$$;
create function public.channel_inventory_sale(p_channel text,p_order text,p_action text,p_lines jsonb default '[]') returns text language sql security invoker set search_path='' as $$
  select inventory_hub.channel_sale(p_channel,p_order,p_action,p_lines)
$$;
revoke all on function inventory_hub.read_stock(text,jsonb),inventory_hub.channel_sale(text,text,text,jsonb),
 public.channel_inventory_stock(text,jsonb),public.channel_inventory_sale(text,text,text,jsonb) from public,anon,authenticated;
grant usage on schema inventory_hub to service_role;
grant execute on function inventory_hub.read_stock(text,jsonb),inventory_hub.channel_sale(text,text,text,jsonb),
 public.channel_inventory_stock(text,jsonb),public.channel_inventory_sale(text,text,text,jsonb) to service_role;

create function inventory_hub.published_snapshot(p_source text,p_search text,p_page integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare board jsonb:=inventory_hub.comparison(p_source,p_search,p_page); result jsonb;
begin
  select coalesce(jsonb_agg(entry|| jsonb_build_object('sales_warehouse',w.warehouse,'channel_available',s.available)
    order by n),'[]') into result from jsonb_array_elements(board->'items') with ordinality e(entry,n)
    left join inventory_hub.sales_warehouses w on w.code=entry->>'code'
    left join inventory_hub.channel_stock s on s.channel=entry->>'source' and s.external_id=entry->>'external_id';
  return jsonb_set(board,'{items}',result);
end $$;
revoke all on function inventory_hub.published_snapshot(text,text,integer) from public,anon,authenticated;
grant execute on function inventory_hub.published_snapshot(text,text,integer) to authenticated;
-- Show where the online quantity comes from; the comparison with raw reports remains visible.
create or replace function public.central_inventory(p_source text default 'todos',p_search text default '',p_page integer default 1)
returns jsonb language sql security invoker set search_path='' as $$
  select inventory_hub.published_snapshot(p_source,p_search,p_page)
$$;

create function inventory_hub.order_status(p_channel text,p_order text) returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('state',o.state,'lines',o.lines) from inventory_hub.channel_orders o
 where o.channel=p_channel and o.order_ref=p_order
$$;
create function public.channel_inventory_status(p_channel text,p_order text) returns jsonb
language sql security invoker set search_path='' as $$select inventory_hub.order_status(p_channel,p_order)$$;
revoke all on function inventory_hub.order_status(text,text),public.channel_inventory_status(text,text) from public,anon,authenticated;
grant execute on function inventory_hub.order_status(text,text),public.channel_inventory_status(text,text) to service_role;

-- A public page can learn that availability changed without learning catalog, order or customer data.
create function inventory_hub.stock_version(p_channel text) returns text
language sql stable security definer set search_path='' as $$
 select md5(coalesce(jsonb_agg(jsonb_build_array(external_id,available) order by external_id)::text,'[]'))
 from inventory_hub.channel_stock where channel=p_channel
$$;
create function public.channel_inventory_version(p_channel text) returns text
language sql stable security invoker set search_path='' as $$select inventory_hub.stock_version(p_channel)$$;
revoke all on function inventory_hub.stock_version(text),public.channel_inventory_version(text) from public,anon,authenticated;
grant execute on function inventory_hub.stock_version(text),public.channel_inventory_version(text) to service_role;
