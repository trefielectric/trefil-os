-- Searchable company archive. All source-specific values are imported privately.
create table plant_ops.archive_documents (
 source_key text primary key,
 folder_path text not null, filename text not null, area text not null, period text not null default '',
 bytes bigint not null check (bytes >= 0), source_url text not null,
 archive_url text, original_copy uuid references plant_ops.document_imports(id),
 sha256_hex text check(sha256_hex is null or sha256_hex ~ '^[0-9a-f]{64}$'),
 source_hash text, changed_at timestamptz, note text not null default '',
 state text not null check(state in ('incorporado','vinculado','pendiente')),
 check(state<>'incorporado' or archive_url is not null or original_copy is not null),
 check(source_url ~ '^https://trefielectric(-my)?[.]sharepoint[.]com/'),
 check(archive_url is null or archive_url ~ '^https://trefielectric(-my)?[.]sharepoint[.]com/')
);
alter table plant_ops.archive_documents enable row level security;
revoke all on plant_ops.archive_documents from public,anon,authenticated;
create index archive_documents_section on plant_ops.archive_documents(state,area,period);
create function plant_ops.archive_search(term text, section text, stage text, position_from int) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform plant_ops.require_document_reviewer();
 if position_from is null or position_from<0 then raise exception 'Página inválida.'; end if;
 return (with filtered as (
   select * from plant_ops.archive_documents d where (section='' or d.area=section)
     and (stage='' or d.state=stage) and (term='' or strpos(lower(d.filename || ' ' || d.folder_path || ' ' || d.period),lower(left(term,180)))>0)
 ), page as (select * from filtered order by folder_path,filename,source_key limit 40 offset position_from)
 select jsonb_build_object('total',(select count(*) from filtered),
  'areas',(select coalesce(jsonb_agg(a order by a),'[]') from (select distinct area a from plant_ops.archive_documents) s),
  'counts',(select coalesce(jsonb_object_agg(st,n),'{}') from (select state st,count(*) n from plant_ops.archive_documents group by state) s),
  'files',(select coalesce(jsonb_agg(jsonb_build_object('id',source_key,'folder',folder_path,'name',filename,'area',area,'period',period,'bytes',bytes,
      'source',source_url,'archive',archive_url,'copy',original_copy,'state',state,'note',note) order by folder_path,filename,source_key),'[]') from page)));
end $$;
create function public.archive_search(term text, section text, stage text, position_from int)
returns jsonb language sql stable security invoker set search_path='' as $$ select plant_ops.archive_search(term,section,stage,position_from) $$;
revoke all on function public.archive_search(text,text,text,int),plant_ops.archive_search(text,text,text,int) from public,anon,authenticated;
grant execute on function public.archive_search(text,text,text,int),plant_ops.archive_search(text,text,text,int) to authenticated;
