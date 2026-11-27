import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import type { Jornada, ControlMember } from "../src/lib/jornada";

test("Módulo 00 verifica revisión, alcance, herencia, cronometraje, cierres y alertas", async () => {
  const db = new PGlite();
  const pa = randomUUID(),
    pb = randomUUID(),
    pc = randomUUID(),
    ua = randomUUID(),
    ub = randomUUID(),
    uc = randomUUID();
  async function run(sql: string, args: unknown[] = []) {
    return (await db.query(sql, args)).rows;
  }
  async function as(id: string) {
    await db.exec("reset role");
    await run("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  }
  async function snapshot() {
    return (
      (await run("select public.jornada_snapshot() s"))[0] as { s: Jornada }
    ).s;
  }
  async function call(
    op: string,
    payload: Record<string, unknown>,
    key = randomUUID(),
  ) {
    await run("select public.jornada_command($1,$2::jsonb,$3)", [
      op,
      JSON.stringify(payload),
      key,
    ]);
  }
  async function review() {
    const s = await snapshot();
    await call("review", {
      shift: s.shift!.id,
      tasks: s.tasks.map((t) => t.id),
      reviewed: true,
      new_plan: s.tasks.some((t) => !t.carried) ? "confirmed" : "none",
    });
  }
  try {
    await db.exec(`create schema auth;create role anon;create role authenticated;create role service_role;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{"aal":"aal1"}'::jsonb $$;
    grant usage on schema auth to anon,authenticated,service_role;
    create schema private;create table public.organization_members(user_id uuid,organization_id uuid,active boolean,role_code text,all_locations boolean,location_ids uuid[]);
    create table public.profiles(id uuid,active boolean);create schema plant_ops;create table plant_ops.access(person uuid primary key,profile text);`);
    for (const file of [
      "20261111140836_workforce",
      "20261111144203_cedula_identity",
      "20261111153246_workforce_roles_permissions",
      "20261111164415_developer_mcp_access",
      "20261117135745_workforce_member_profiles",
      "20261117144544_simplify_team_admin_access",
      "20261117185415_workforce_admin_credentials_and_removal",
      "20261127145504_usuario_jornada",
      "20261127150100_usuario_jornada_gateway",
    ])
      await db.exec(
        await readFile(
          new URL("../supabase/migrations/" + file + ".sql", import.meta.url),
          "utf8",
        ),
      );
    let n = 0;
    for (const [person, user, role] of [
      [pa, ua, "admin"],
      [pb, ub, "employee"],
      [pc, uc, "employee"],
    ]) {
      ++n;
      await run("insert into auth.users values($1,$2,now())", [
        user,
        n + "@example.invalid",
      ]);
      await run(
        "insert into workforce.people(id,user_id,identifier_hash,identifier_last_four,full_name,job_title,area,access_role) values($1,$2,$3,'1111',$4,'Operador','Planta',$5)",
        [person, user, String(n).repeat(64), "Persona " + n, role],
      );
    }
    await run(
      "insert into plant_ops.access values($1,'CREADOR'),($2,'GERENTE')",
      [pa, pc],
    );
    await db.exec(
      "update jornada.monitor set launch=now()-interval '3 days',last_day=jornada.day_of(now())-1",
    );
    await as(ua);
    const gate = async () => {
      await run(
        "select set_config('request.path','/rpc/plant_workspace',false)",
      );
      await run("select jornada.check_request()");
    };
    await assert.rejects(gate, /confirma/);
    const request = randomUUID();
    await call("open", {}, request);
    await call("open", {}, request);
    const opened = await snapshot(),
      shift = opened.shift!.id;
    assert.equal(opened.ready, false);
    await call("task", {
      shift,
      person: pa,
      title: "Conciliar cuentas",
      estimate: 1,
    });
    await assert.rejects(
      call("review", { shift, tasks: [], reviewed: true, new_plan: "none" }),
      /Actualiza/,
    );
    await review();
    await gate();
    assert.equal((await snapshot()).ready, true);
    await call("task", {
      shift,
      person: pb,
      title: "Control asignado",
      estimate: 1,
    });
    const task = (await snapshot()).tasks[0].id;
    await call("start", { shift, task });
    await call("pause", { shift, task });
    await call("start", { shift, task });
    await db.exec("reset role");
    await run(
      "update jornada.intervals set started=started-interval '65 seconds' where task=$1 and stopped is null",
      [task],
    );
    await as(ua);
    await assert.rejects(call("close", { shift, reasons: {} }), /pendiente/);
    await assert.rejects(
      call("close", {
        shift,
        reasons: { [task]: { unfinished: "Falta un extracto" } },
      }),
      /excedido/,
    );
    assert.equal((await snapshot()).tasks[0].running, true);
    await call("finish", { shift, task });
    await assert.rejects(call("close", { shift, reasons: {} }), /excedido/);
    await call("close", {
      shift,
      reasons: { [task]: { excess: "Se conciliaron tres cuentas" } },
    });
    assert.equal((await snapshot()).last_close!.summary.done, 1);
    await assert.rejects(gate, /confirma/);
    await as(ub);
    await call("open", {});
    const b = (await snapshot()).shift!.id;
    await assert.rejects(call("close", { shift, reasons: {} }), /Actualiza/);
    await assert.rejects(
      call("task", { shift: b, person: pa, title: "Fuera de alcance" }),
      /asignar/,
    );
    await review();
    await assert.rejects(
      run("select public.jornada_control(current_date)"),
      /Sin acceso/,
    );
    await assert.rejects(
      run("select public.jornada_history($1)", [task]),
      /Sin acceso/,
    );
    const own = (await snapshot()).tasks[0];
    assert.equal(own.assigned_by, pa);
    await call("start", { shift: b, task: own.id });
    await db.exec("reset role");
    await run(
      "update jornada.intervals set started=started-interval '70 seconds' where task=$1",
      [own.id],
    );
    await run(
      "update workforce.shifts set arrived_at=arrived_at-interval '1 day', scheduled_end=now()-interval '17 minutes',scheduled_start=now()-interval '1 day 16 minutes' where id=$1",
      [b],
    );
    await run(
      "update workforce.tasks set scheduled_on=scheduled_on-1 where id=$1",
      [own.id],
    );
    await db.exec("select jornada.refresh_alerts()");
    await as(ub);
    assert.equal((await snapshot()).ready, false);
    await assert.rejects(call("open", {}), /abierta/);
    await assert.rejects(call("close", { shift: b }), /anterior/);
    const late = {
      shift: b,
      late_reason: "Olvidé registrar la salida",
      reasons: {
        [own.id]: {
          unfinished: "Falta la última entrega",
          excess: "Se revisó el lote completo",
        },
      },
    };
    await call("close", late);
    await call("open", {});
    const c = await snapshot();
    assert.equal(c.tasks[0].id, own.id);
    assert.equal(c.tasks[0].carried, true);
    assert.ok(c.tasks[0].seconds > 60);
    assert.equal(c.tasks[0].shift_seconds, 0);
    await review();
    await assert.rejects(
      run("select public.workforce_mark_shift('departure',$1)", [c.shift!.id]),
      /Mi jornada/,
    );
    await as(uc);
    await call("open", {});
    await review();
    const controls = (
      await run(
        "select public.jornada_control(jornada_date) s from (select (now() at time zone 'America/Bogota')::date-1 jornada_date) x",
      )
    )[0] as { s: ControlMember[] };
    const member = controls.s.find((v) => v.id === pb)!;
    assert.equal(member.alerts.length, 2);
    assert.ok(member.alerts.every((v) => !!v.resolved));
    assert.equal(member.shifts[0].summary!.unfinished, 1);
    const nowPlan = await snapshot();
    await call("task", {
      shift: nowPlan.shift!.id,
      person: pa,
      title: "Asignada por gerente",
    });
    await assert.rejects(
      call("absence", { person: pb, day: nowPlan.today, kind: "Vacaciones" }),
      /permiso/,
    );
    await as(ua);
    await call("open", {});
    await review();
    await call("absence", {
      person: pb,
      day: nowPlan.today,
      kind: "Vacaciones",
    });
    await as(ub);
    assert.equal((await snapshot()).exception, "Vacaciones");
    await db.exec("reset role");
    const pd = randomUUID(),
      ud = randomUUID();
    await run(
      "insert into auth.users values($1,'scope@example.invalid',now())",
      [ud],
    );
    await run(
      "insert into workforce.people(id,user_id,supervisor_id,identifier_hash,identifier_last_four,full_name,job_title,area,access_role) values($1,$2,$3,$4,'4444','Colaborador cuatro','Operador','Planta','employee')",
      [pd, ud, pb, "d".repeat(64)],
    );
    for (const code of ["tasks_assign", "tasks_view_team"])
      await run(
        "insert into workforce.person_permission_overrides(person_id,permission_code,granted,updated_by) values($1,$2,true,$3)",
        [pb, code, pa],
      );
    await as(ub);
    await call("task", {
      shift: c.shift!.id,
      person: pd,
      title: "Actividad del equipo",
    });
    await assert.rejects(
      call("task", { shift: c.shift!.id, person: pc, title: "Otro equipo" }),
      /asignar/,
    );
    const scoped = (
      await run("select public.jornada_control($1) s", [c.today])
    )[0] as { s: ControlMember[] };
    assert.deepEqual(scoped.s.map((p) => p.id).sort(), [pb, pd].sort());
    assert.ok(scoped.s.every((p) => p.shifts.length === 0));
    await db.exec("reset role");
    const yesterday = (await run("select jornada.day_of(now())-1 d"))[0] as {
      d: string;
    };
    for (const person of [pd, pc, pa]) {
      await run(
        "insert into workforce.availability(person_id,weekday,start_time,end_time,slot_order,updated_by) values($1,extract(isodow from $2::date),'07:00','16:00',0,$3)",
        [person, yesterday.d, pa],
      );
    }
    await run(
      "insert into jornada.absences(person,day,kind,approved_by) values($1,$2,'Permiso',$3)",
      [pc, yesterday.d, pa],
    );
    await db.exec(
      "select jornada.refresh_alerts();select jornada.refresh_alerts()",
    );
    const alerts = (await run(
      "select person,kind,triggered-scheduled as delta from jornada.alerts where day=$1 and person in ($2,$3)",
      [yesterday.d, pd, pc],
    )) as { person: string; kind: string }[];
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].person, pd);
    assert.equal(alerts[0].kind, "apertura");
    await as(uc);
    const inbox = (await snapshot()).notifications;
    const alert = inbox.find((z) => z.person === pd)!;
    assert.ok(alert);
    await call("read_alert", { person: pd, day: alert.day, kind: alert.kind });
    assert.ok(!(await snapshot()).notifications.some((z) => z.person === pd));
    await as(ua);
    assert.ok((await snapshot()).notifications.some((z) => z.person === pd));
    await as(ub);
    assert.equal((await snapshot()).notifications.length, 0);
    await db.exec("reset role;set role anon");
    await assert.rejects(
      run("select public.jornada_snapshot()"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
