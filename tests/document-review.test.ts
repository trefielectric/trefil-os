import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("Solo el titular puede descargar y decidir sobre los originales de una carpeta importada", async () => {
  const db = new PGlite();
  const owner = randomUUID(), other = randomUUID(), batch = randomUUID(), file = randomUUID();
  try {
    await db.exec(`create role authenticated; create role anon;
      create schema plant_ops; grant usage on schema plant_ops to authenticated;
      create schema workforce; create table workforce.people (id uuid primary key);
      create function workforce.require_person() returns workforce.people language sql as
      $$ select p from workforce.people p where p.id=current_setting('test.person')::uuid $$;
      create table plant_ops.access (person uuid, profile text);`);
    await db.exec(await readFile(new URL("../supabase/migrations/20261124173900_sharepoint_folder_review.sql", import.meta.url),"utf8"));
    await db.query("insert into workforce.people values ($1),($2)",[owner,other]);
    await db.query("insert into plant_ops.access values ($1,'CREADOR'),($2,'GERENTE')",[owner,other]);
    await db.query("insert into plant_ops.document_batches (id,drive_id,folder_id,folder_path,manifest_hash) values ($1,'drive','folder','Carpeta de prueba',repeat('a',64))",[batch]);
    await db.query("insert into plant_ops.document_imports (id,batch_id,source_item,filename,source_url,source_modified,description,content,sha256_hex) values ($1,$2,'item','ejemplo.pdf','https://example.test',now(),'Texto',decode('7654','hex'),encode(sha256(decode('7654','hex')),'hex'))",[file,batch]);
    await db.exec("set role anon");
    await assert.rejects(db.query("select public.document_reviews()"), /permission denied/);
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('test.person',$1,false)",[other]);
    await assert.rejects(db.query("select public.document_reviews()"), /titular/);
    await assert.rejects(db.query("select public.imported_document($1)",[file]), /titular/);
    await assert.rejects(db.query("select public.review_document_folder($1,'aprobado','')",[batch]), /titular/);
    await db.query("select set_config('test.person',$1,false)",[owner]);
    await assert.rejects(db.query("select content from plant_ops.document_imports"), /permission denied/);
    const listing = await db.query<{ list: { status: string; files: unknown[] }[] }>("select public.document_reviews() list");
    assert.equal(listing.rows[0].list[0].status,"pendiente");
    assert.equal(listing.rows[0].list[0].files.length,1);
    const original = await db.query<{ b64: string }>("select public.imported_document($1) b64",[file]);
    assert.equal(Buffer.from(original.rows[0].b64,"base64").toString("hex"),"7654");
    await assert.rejects(db.query("select public.review_document_folder($1,'requiere ajustes',' ')",[batch]), /Describe/);
    for (let attempt=0; attempt<2; attempt++) await db.query("select public.review_document_folder($1,'aprobado','Revisado')",[batch]);
    await assert.rejects(db.query("select public.review_document_folder($1,'requiere ajustes','Modificar')",[batch]), /ya tiene/);
    await db.exec("reset role");
    const result = await db.query<{ reviewed_by: string }>("select reviewed_by from plant_ops.document_batches where id=$1",[batch]);
    assert.equal(result.rows[0].reviewed_by,owner);
  } finally {
    await db.close();
  }
});
