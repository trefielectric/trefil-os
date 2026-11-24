-- Imported folders stay private to the active owner, including after review.
create table plant_ops.document_batches (
  id uuid primary key default gen_random_uuid(),
  drive_id text not null, folder_id text not null, folder_path text not null,
  manifest_hash text not null check (manifest_hash ~ '^[a-f0-9]{64}$'),
  imported_at timestamptz not null default now(),
  status text not null default 'pendiente' check (status in ('pendiente','aprobado','requiere ajustes')),
  reviewed_by uuid references workforce.people(id),
  reviewed_at timestamptz, review_note text not null default '',
  unique(drive_id,folder_id,manifest_hash),
  check ((status='pendiente' and reviewed_by is null and reviewed_at is null)
      or (status<>'pendiente' and reviewed_by is not null and reviewed_at is not null))
);
create table plant_ops.document_imports (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references plant_ops.document_batches,
  source_item text not null, filename text not null, source_url text not null,
  source_modified timestamptz not null, description text not null,
  content bytea not null check (octet_length(content)>0),
  sha256_hex text not null check (sha256_hex=encode(sha256(content),'hex')),
  unique (batch_id,source_item)
);
alter table plant_ops.document_batches enable row level security;
alter table plant_ops.document_imports enable row level security;
revoke all on plant_ops.document_batches, plant_ops.document_imports from public, anon, authenticated;

create function plant_ops.require_document_reviewer() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare actor workforce.people:=workforce.require_person();
begin
 if not exists(select from plant_ops.access where person=actor.id and profile='CREADOR') then
   raise exception 'La revisión de las importaciones corresponde al administrador titular.' using errcode='42501';
 end if;
 return actor.id;
end $$;

create function plant_ops.document_reviews() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform plant_ops.require_document_reviewer();
 return coalesce((select jsonb_agg(jsonb_build_object(
    'id',b.id,'path',b.folder_path,'imported',b.imported_at,'status',b.status,'note',b.review_note,
    'reviewed',b.reviewed_at,'files',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',d.id,'name',d.filename,'description',d.description,'source',d.source_url,
      'size',octet_length(d.content)) order by d.filename),'[]') from plant_ops.document_imports d where d.batch_id=b.id)
   ) order by b.imported_at desc) from plant_ops.document_batches b),'[]');
end $$;

create function plant_ops.imported_document(item uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare result text;
begin
 perform plant_ops.require_document_reviewer();
 select encode(content,'base64') into strict result from plant_ops.document_imports where id=item;
 return result;
end $$;

create function plant_ops.review_document_folder(item uuid, decision text, note text) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=plant_ops.require_document_reviewer(); current_batch plant_ops.document_batches;
begin
 if decision is null or decision not in ('aprobado','requiere ajustes') or length(coalesce(note,''))>1500 then
   raise exception 'Revisa la decisión y la longitud de la observación.';
 end if;
 if decision='requiere ajustes' and btrim(coalesce(note,''))='' then raise exception 'Describe el ajuste que necesitas.'; end if;
 select * into strict current_batch from plant_ops.document_batches where id=item for update;
 if current_batch.status<>'pendiente' then
   if current_batch.status=decision and current_batch.reviewed_by=actor and current_batch.review_note=btrim(coalesce(note,'')) then return; end if;
   raise exception 'El apartado ya tiene una decisión registrada.';
 end if;
 update plant_ops.document_batches set status=decision, reviewed_by=actor, reviewed_at=now(), review_note=btrim(coalesce(note,'')) where id=item;
end $$;
create function public.document_reviews() returns jsonb language sql stable security invoker set search_path='' as $$select plant_ops.document_reviews()$$;
create function public.imported_document(item uuid) returns text language sql stable security invoker set search_path='' as $$select plant_ops.imported_document(item)$$;
create function public.review_document_folder(item uuid,decision text,note text) returns void language sql security invoker set search_path='' as $$select plant_ops.review_document_folder(item,decision,note)$$;
revoke all on function plant_ops.require_document_reviewer(),plant_ops.document_reviews(),plant_ops.imported_document(uuid),plant_ops.review_document_folder(uuid,text,text),public.document_reviews(),public.imported_document(uuid),public.review_document_folder(uuid,text,text) from public,anon,authenticated;
grant execute on function plant_ops.document_reviews(),plant_ops.imported_document(uuid),plant_ops.review_document_folder(uuid,text,text),public.document_reviews(),public.imported_document(uuid),public.review_document_folder(uuid,text,text) to authenticated;
