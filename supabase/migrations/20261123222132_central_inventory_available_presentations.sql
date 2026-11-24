-- Compare commercial presentations to counted, unreserved physical stock.
create or replace function inventory_hub.comparison(p_source text,p_search text,p_page integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare board jsonb; augmented jsonb;
begin
  board:=inventory_hub.snapshot(p_source,p_search,p_page);
  if p_source='fisico' then return board; end if;
  select coalesce(jsonb_agg(entry || jsonb_build_object('available_presentations',
    case when entry->>'source' in ('wired','mastershop') then floor(saldo.available / nullif((entry->>'factor')::numeric,0)) end)
    order by ord),'[]') into augmented
  from jsonb_array_elements(board->'items') with ordinality as items(entry,ord)
  left join lateral (
    select sum(b.physical-b.reserved) as available from inventory_hub.balances b
    where b.code=entry->>'code' and b.revision>0
  ) saldo on true;
  return jsonb_set(board,'{items}',augmented);
end $$;
revoke all on function inventory_hub.comparison(text,text,integer) from public,anon,authenticated;
grant execute on function inventory_hub.comparison(text,text,integer) to authenticated;
create or replace function public.central_inventory(p_source text default 'todos',p_search text default '',p_page integer default 1)
returns jsonb language sql security invoker set search_path='' as $$ select inventory_hub.comparison(p_source,p_search,p_page) $$;
revoke all on function public.central_inventory(text,text,integer) from public,anon;
grant execute on function public.central_inventory(text,text,integer) to authenticated;
