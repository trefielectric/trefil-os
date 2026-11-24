import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

test("El inventario conserva procedencia, saldos físicos, permisos e idempotencia", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema workforce;
      create table workforce.people(id uuid, access_role text);
      insert into workforce.people values ('10000000-0000-4000-8000-000000000001','admin');
      create function workforce.require_person() returns workforce.people language sql as $$ select p from workforce.people p limit 1 $$;
      create function workforce.has_permission(workforce.people,text) returns boolean language sql as $$ select true $$;
      create schema alegra;
      create table alegra.import_batches(id integer,status text,completed_at timestamptz);
      create table alegra.products(batch_id integer,source_code text,reference text,name text,unit text);
      insert into alegra.import_batches values(1,'completed',now());
      insert into alegra.products values(1,'A1','SKU1','Cable histórico','metro');
    `);
    const path =
      "../supabase/migrations/20261123214937_central_inventory_ledger.sql";
    await db.exec(await readFile(new URL(path, import.meta.url), "utf8"));
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20261123222132_central_inventory_available_presentations.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec("set role anon");
    await assert.rejects(
      db.query("select public.central_inventory()"),
      /permission denied/,
    );
    await db.exec("reset role");
    const capture = (rows: object[]) =>
      db.query(
        "select inventory_hub.replace_snapshot('wired','directa',clock_timestamp(),$1::jsonb)",
        [JSON.stringify(rows)],
      );
    const observed = {
      id: "p:1",
      sku: "SKU1",
      label: "Cable de prueba",
      stock: 74,
      unit: "rollo",
    };
    await capture([observed]);
    await assert.rejects(capture([observed, observed]), /repetidas/);
    await db.exec("set role authenticated");
    type Capture = {
      total: number;
      items: {
        reported: number | null;
        available_presentations: number | null;
        code: string | null;
        balances: { physical: number; reserved: number; available: number }[];
      }[];
    };
    const snapshot = async (source: string) =>
      (
        await db.query<{ result: Capture }>(
          "select public.central_inventory($1,'',1) result",
          [source],
        )
      ).rows[0].result;
    assert.equal((await snapshot("todos")).total, 2);
    assert.equal((await snapshot("alegra")).items[0].reported, null);
    assert.equal((await snapshot("wired")).items[0].reported, 74);
    assert.equal((await snapshot("fisico")).total, 0);
    assert.equal(
      (await snapshot("wired")).items[0].available_presentations,
      null,
    );
    await assert.rejects(
      db.query("select * from inventory_hub.movements"),
      /permission denied/,
    );
    await db.query(
      "select public.central_inventory_link('wired','p:1','C-1','Cable de prueba','metro',100)",
    );
    await assert.rejects(
      db.query(
        "select public.central_inventory_link('wired','p:1','C-1','Cable de prueba','metro',1)",
      ),
      /otra equivalencia/,
    );
    assert.deepEqual((await snapshot("fisico")).items[0].balances, []);
    const move = (
      kind: string,
      qty: number,
      doc: string,
      rev: number,
      request = randomUUID(),
    ) =>
      db.query(
        "select public.central_inventory_record('C-1','bodega', $1,$2,$3,$4,$5)",
        [kind, qty, doc, rev, request],
      );
    await assert.rejects(
      move("entrada", 10, "ENT-1", 0),
      /conteo físico de apertura/,
    );
    await move("conteo", 100, "ACTA-1", 0);
    const reservation = randomUUID();
    await move("reserva", 25, "PED-1", 1, reservation);
    await move("reserva", 25, "PED-1", 1, reservation);
    await move("reserva", 25, "PED-1", 1);
    await assert.rejects(
      move("reserva", 26, "PED-1", 1, reservation),
      /otra operación/,
    );
    await assert.rejects(move("salida", 1, "SAL-1", 1), /saldo cambió/);
    await assert.rejects(move("despacho", 5, "OTRO-PED", 2), /insuficiente/);
    await assert.rejects(
      move("salida", 76, "SAL-2", 2),
      /supera el disponible/,
    );
    await move("despacho", 25, "PED-1", 2);
    const balance = (await snapshot("fisico")).items[0].balances[0];
    assert.equal(balance.physical, 75);
    assert.equal(balance.available, 75);
    assert.equal(balance.reserved, 0);
    assert.equal((await snapshot("wired")).items[0].available_presentations, 0);
    assert.equal((await snapshot("wired")).items[0].reported, 74);
  } finally {
    await db.close();
  }
});
