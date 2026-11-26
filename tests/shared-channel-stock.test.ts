import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";

test("Trefi abastece dos canales, asigna la última unidad una vez y conserva las salidas", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
   create role anon; create role authenticated; create role service_role;
   create schema workforce; create table workforce.people (id uuid, access_role text);
   insert into workforce.people values ('10000000-0000-4000-8000-000000000001','admin');
   create function workforce.require_person() returns workforce.people language sql as $$select p from workforce.people p limit 1$$;
   create function workforce.has_permission(workforce.people,text) returns boolean language sql as $$select $1.access_role='admin'$$;
   create schema alegra;create table alegra.import_batches(id integer,status text,completed_at timestamptz);
   create table alegra.products(batch_id integer,source_code text,reference text,name text,unit text);
  `);
    for (const name of [
      "20261123214937_central_inventory_ledger",
      "20261123222132_central_inventory_available_presentations",
      "20261124180000_shared_channel_stock",
    ]) {
      await db.exec(
        await readFile(
          new URL("../supabase/migrations/" + name + ".sql", import.meta.url),
          "utf8",
        ),
      );
    }
    async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
      const { rows } = await db.query<{ v: T }>(sql, params);
      return rows[0].v;
    }
    const stock = (ch: string, id: string) =>
      one<Record<string, number | null>>(
        "select public.channel_inventory_stock($1,$2::jsonb) v",
        [ch, JSON.stringify([id])],
      );
    const sale = (
      ch: string,
      order: string,
      action: string,
      lines: { id: string; quantity: number }[] = [],
    ) =>
      one<string>(
        "select public.channel_inventory_sale($1,$2,$3,$4::jsonb) v",
        [ch, order, action, JSON.stringify(lines)],
      );
    const web = [{ id: "v:web-rollo", quantity: 1 }],
      shop = [{ id: "109:azul", quantity: 1 }];
    const setRole = (
      role: "authenticated" | "service_role" | "none" | "anon",
    ) => db.exec("set role " + role);
    for (const [channel, offers] of [
      ["wired", ["v:web-rollo", "p:pack", "p:sin-conteo"]],
      ["mastershop", ["109:azul"]],
    ] as const) {
      await db.query(
        "select inventory_hub.replace_snapshot($1,'directa',now(),$2::jsonb)",
        [
          channel,
          JSON.stringify(offers.map((id) => ({ id, label: id, stock: 99 }))),
        ],
      );
    }
    await setRole("authenticated");
    for (const [ch, id, sku, factor] of [
      ["wired", "v:web-rollo", "R1", 1],
      ["wired", "p:pack", "R1", 2],
      ["wired", "p:sin-conteo", "R2", 1],
      ["mastershop", "109:azul", "R1", 1],
    ]) {
      await db.query(
        "select public.central_inventory_link($1,$2,$3,$3,'rollo',$4)",
        [ch, id, sku, factor],
      );
    }
    await assert.rejects(stock("wired", "v:web-rollo"), /permission denied/);
    await setRole("service_role");
    assert.deepEqual(await stock("wired", "v:web-rollo"), {
      "v:web-rollo": null,
    });
    assert.deepEqual(await stock("wired", "inexistente"), {
      inexistente: null,
    });
    await setRole("authenticated");
    const opening = randomUUID();
    const publish = () =>
      db.query(
        "select public.central_inventory_publish_count('R1','DESPACHO','conteo',1,'ACTA APERTURA',0,$1)",
        [opening],
      );
    await publish();
    await publish();
    await db.query(
      "select public.central_inventory_record('R1','INSPECCIÓN','conteo',30,'ACTA DEVUELTOS',0,$1)",
      [randomUUID()],
    );
    await setRole("service_role");
    assert.deepEqual(await stock("mastershop", "109:azul"), { "109:azul": 1 });
    assert.deepEqual(await stock("wired", "v:web-rollo"), { "v:web-rollo": 1 });
    assert.deepEqual(await stock("wired", "p:pack"), { "p:pack": 0 });
    await assert.rejects(
      sale("wired", "SIN-MAPEAR", "reserve", [
        ...web,
        { id: "p:sin-conteo", quantity: 1 },
      ]),
      /conteo publicado/,
    );
    await assert.rejects(
      sale("wired", "INVALIDA", "reserve", [
        { id: "v:web-rollo", quantity: -1 },
      ]),
      /inválidas/,
    );
    const version = () =>
      one<string>("select public.channel_inventory_version('wired') v");
    const before = await version();
    const attempts = await Promise.allSettled([
      sale("wired", "WEB-1", "reserve", web),
      sale("mastershop", "MS-1", "reserve", shop),
    ]);
    assert.equal(attempts.filter((x) => x.status === "fulfilled").length, 1);
    assert.match(
      String(attempts.find((x) => x.status === "rejected")?.reason),
      /insuficiente/,
    );
    assert.notEqual(await version(), before);
    const webWon = attempts[0].status === "fulfilled";
    const winner = webWon ? ["wired", "WEB-1"] : ["mastershop", "MS-1"];
    const winLines = webWon ? web : shop;
    assert.equal(
      await sale(winner[0], winner[1], "reserve", winLines),
      "reserved",
    );
    await assert.rejects(
      sale(winner[0], winner[1], "reserve", [{ ...winLines[0], quantity: 2 }]),
      /otras cantidades/,
    );
    assert.deepEqual(await stock("wired", "v:web-rollo"), { "v:web-rollo": 0 });
    assert.deepEqual(await stock("mastershop", "109:azul"), { "109:azul": 0 });
    assert.equal(await sale(winner[0], winner[1], "cancel"), "cancelled");
    assert.equal(await sale(winner[0], winner[1], "cancel"), "cancelled");
    assert.deepEqual(await stock("mastershop", "109:azul"), { "109:azul": 1 });
    await sale("mastershop", "MS-2", "reserve", shop);
    await sale("mastershop", "MS-2", "dispatch");
    await sale("mastershop", "MS-2", "dispatch");
    await assert.rejects(sale("mastershop", "MS-2", "cancel"), /no permite/);
    await setRole("none");
    const physical = await db.query(
      "select physical::int,reserved::int from inventory_hub.balances where code='R1' and warehouse='DESPACHO'",
    );
    assert.deepEqual(physical.rows, [{ physical: 0, reserved: 0 }]);
    const movements = await one<number>(
      "select count(*)::int v from inventory_hub.movements where kind='despacho'",
    );
    assert.equal(movements, 1);
    await setRole("authenticated");
    await db.query(
      "select public.central_inventory_record('R1','DESPACHO','entrada',6,'PRODUCCION-2',5,$1)",
      [randomUUID()],
    );
    await setRole("service_role");
    assert.deepEqual(await stock("wired", "p:pack"), { "p:pack": 3 });
    await sale("wired", "MIXTO", "reserve", [
      { id: "p:pack", quantity: 2 },
      { id: "v:web-rollo", quantity: 1 },
    ]);
    assert.deepEqual(await stock("mastershop", "109:azul"), { "109:azul": 1 });
    await setRole("anon");
    await assert.rejects(
      sale("wired", "SIN-PERMISO", "reserve", web),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
