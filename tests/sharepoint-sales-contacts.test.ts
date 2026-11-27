import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("El directorio de SharePoint exige permiso de Ventas y conserva la fila de origen", async () => {
  const db = new PGlite();
  const list = (search = "", status = "", offset = 0) => db.query<{ data: {
    total: number; rows: Array<{source_row: number; filename: string}>
  } }>("select public.sharepoint_sales_contacts_page($1,$2,$3) as data", [search,status,offset]);
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema plant_ops; grant usage on schema plant_ops to authenticated;
      create schema auth; create schema jornada; create schema workforce;
      create table plant_ops.document_imports(id uuid primary key, filename text);
      create table workforce.people(id uuid);
      create function workforce.require_person() returns workforce.people language sql as $$
        select p from workforce.people p limit 1 $$;
      create function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$;
      create function jornada.ready(uuid) returns boolean language sql as $$
        select current_setting('test.shift')='open' $$;
      create function workforce.has_permission(workforce.people,text) returns boolean language sql as $$
        select current_setting('test.permission')=$2 $$;
      insert into workforce.people values(gen_random_uuid());
      insert into plant_ops.document_imports values(gen_random_uuid(),'Libro de prueba.xlsx');`);
    await db.exec(await readFile(new URL("../supabase/migrations/20261127195848_sharepoint_contactos_ventas.sql",import.meta.url),"utf8"));
    await db.exec(`insert into plant_ops.sharepoint_sales_contacts
      select d.id,'Hoja 1',n,'Contacto '||n,'Ejemplo','','','','ACTIVO'
      from plant_ops.document_imports d cross join generate_series(1,42) n;
      set test.shift='closed'; set test.permission='sales_view'; set role anon;`);
    await assert.rejects(list(),/permission denied/);
    await db.exec("reset role; set role authenticated");
    await assert.rejects(list(),/jornada abierta/);
    await db.exec("set test.shift='open'; set test.permission='inventory_view'");
    await assert.rejects(list(),/acceso a Ventas/);
    await db.exec("set test.permission='sales_view'");
    await assert.rejects(db.query("select * from plant_ops.sharepoint_sales_contacts"), /permission denied/);
    const first = (await list()).rows[0].data;
    assert.equal(first.total,42); assert.equal(first.rows.length,30);
    assert.equal((await list("","ACTIVO",30)).rows[0].data.rows.length,12);
    const match = (await list("contacto 42","ACTIVO")).rows[0].data;
    assert.equal(match.total,1);
    assert.equal(match.rows[0].source_row,42);
    assert.equal(match.rows[0].filename,"Libro de prueba.xlsx");
    assert.equal((await list("","INACTIVA")).rows[0].data.total,0);
  } finally { await db.close(); }
});
