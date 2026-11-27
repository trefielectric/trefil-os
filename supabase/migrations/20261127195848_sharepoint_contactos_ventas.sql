-- Rows retain their original position and refer to an immutable private workbook.
create table plant_ops.sharepoint_sales_contacts (
  source_document uuid not null references plant_ops.document_imports(id),
  sheet text not null check (btrim(sheet) <> ''),
  source_row integer not null check (source_row > 0),
  given_names text not null,
  surnames text not null,
  document_number text not null,
  phone text not null,
  address text not null,
  source_status text not null,
  check (btrim(given_names || surnames) <> ''),
  primary key (source_document, sheet, source_row)
);
alter table plant_ops.sharepoint_sales_contacts enable row level security;
revoke all on plant_ops.sharepoint_sales_contacts from public, anon, authenticated;

create function plant_ops.sharepoint_sales_contacts_page(search_term text, status_filter text, start_at integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  actor workforce.people := workforce.require_person();
  term text := lower(btrim(coalesce(search_term, '')));
begin
  if nullif(auth.jwt()->>'client_id','') is not null or not jornada.ready(actor.id)
    or not workforce.has_permission(actor,'sales_view') then
    raise exception 'Se requiere una jornada abierta y acceso a Ventas.' using errcode='42501';
  end if;
  if length(term)>180 or start_at is null or start_at<0 or status_filter is null
    or status_filter not in ('','ACTIVO','INACTIVA') then
    raise exception 'Revisa los filtros del directorio.' using errcode='22023';
  end if;
  return (
    with filtered as (
      select c.*, d.filename from plant_ops.sharepoint_sales_contacts c
      join plant_ops.document_imports d on d.id=c.source_document
      where (status_filter='' or c.source_status=status_filter)
        and (term='' or strpos(lower(concat_ws(' ',nullif(c.given_names,''),nullif(c.surnames,''))),term)>0
          or strpos(c.document_number,term)>0 or strpos(c.phone,term)>0)
    ), page as (
      select * from filtered order by filename collate "C",source_document,sheet collate "C",source_row
      limit 30 offset start_at
    )
    select jsonb_build_object('total',(select count(*) from filtered),'rows', coalesce((
      select jsonb_agg(to_jsonb(page) order by filename collate "C",source_document,sheet collate "C",source_row) from page
    ),'[]'::jsonb))
  );
end $$;
create function public.sharepoint_sales_contacts_page(search_term text, status_filter text, start_at integer)
returns jsonb language sql stable security invoker set search_path='' as $$
  select plant_ops.sharepoint_sales_contacts_page(search_term,status_filter,start_at)
$$;
revoke all on function public.sharepoint_sales_contacts_page(text,text,integer),
  plant_ops.sharepoint_sales_contacts_page(text,text,integer) from public,anon,authenticated;
grant execute on function public.sharepoint_sales_contacts_page(text,text,integer),
  plant_ops.sharepoint_sales_contacts_page(text,text,integer) to authenticated;
