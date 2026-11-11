import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  workDuration,
  type Shift,
  type WorkforceDay,
} from "../src/lib/workforce";

const uuid = (suffix: number) =>
  "a0000000-0000-4000-8000-" + String(suffix).padStart(12, "0");
const admin = uuid(1);
const coordinator = uuid(2);
const worker = uuid(3);
const other = uuid(4);
const pending = uuid(5);
const directoryId = (identity: string) => "b" + identity.slice(1);

test("Equipo: verified activation, team boundaries and server-owned attendance", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth;
      create role anon;
      create role authenticated;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      create function auth.jwt() returns jsonb language sql stable as $$
        select jsonb_build_object('aal',current_setting('request.jwt.claim.aal',true))
      $$;
      grant usage on schema auth to anon,authenticated;
    `);
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20261111140836_workforce.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    for (const [identity, role, supervisor] of [
      [admin, "admin", null],
      [coordinator, "supervisor", null],
      [worker, "employee", directoryId(coordinator)],
      [other, "employee", null],
      [pending, "employee", null],
    ] as const) {
      const email = identity.slice(-2) + "@example.test";
      await db.query(
        "insert into auth.users values($1,$2,case when $3 then now() else null end)",
        [identity, email, identity !== pending],
      );
      await db.query(
        `
        insert into workforce.people(id,email,full_name,job_title,area,access_role,supervisor_id)
        values($1,$2,$3,'Cargo de prueba','Área de prueba',$4,$5)
      `,
        [
          directoryId(identity),
          email,
          "Persona " + identity.slice(-2),
          role,
          supervisor,
        ],
      );
    }

    async function asUser(identity: string | null, assurance = "aal1") {
      await db.exec("reset role");
      await db.query(
        "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.aal',$2,false)",
        [identity ?? "", assurance],
      );
      await db.exec(identity ? "set role authenticated" : "set role anon");
    }

    async function day(date: string | null = null) {
      return (
        await db.query<{ data: WorkforceDay }>(
          "select public.workforce_day($1) as data",
          [date],
        )
      ).rows[0].data;
    }
    async function mark(action: "arrival" | "departure", id: string) {
      return (
        await db.query<{ data: Shift }>(
          "select public.workforce_mark_shift($1,$2) as data",
          [action, id],
        )
      ).rows[0].data;
    }
    async function schedule(
      id: string,
      person: string,
      date: string,
      title = "Preparar pedido",
    ) {
      return db.query(
        "select public.workforce_assign_task($1,$2,$3,'15:30',$4,'Separar material')",
        [id, directoryId(person), date, title],
      );
    }
    async function status(id: string, next: string) {
      return db.query("select public.workforce_set_task_status($1,$2)", [
        id,
        next,
      ]);
    }
    async function save(identity: string, role: string, active: boolean) {
      return db.query(
        `
        select public.workforce_save_person($1,$2,'Nombre validado','Cargo de prueba','Área de prueba',$3,null,$4)
      `,
        [
          directoryId(identity),
          identity.slice(-2) + "@example.test",
          role,
          active,
        ],
      );
    }

    await t.test(
      "anonymous and unverified accounts cannot read; direct table access is denied",
      async () => {
        await asUser(null);
        await assert.rejects(day(), /permission denied/);
        await asUser(pending);
        await assert.rejects(day(), /no tiene acceso activo/);
        await asUser(admin, "aal2");
        assert.equal((await day()).people.length, 5);
        await assert.rejects(
          db.query("select * from workforce.people"),
          /permission denied/,
        );
        await assert.rejects(
          db.query("select workforce.require_person()"),
          /permission denied/,
        );
      },
    );

    await t.test(
      "only AAL2 administrators can add people or generate invitations",
      async () => {
        const id = uuid(6);
        await asUser(admin);
        assert.equal((await day()).can_manage, false);
        await assert.rejects(save(id, "employee", true), /doble factor/);
        await asUser(coordinator, "aal2");
        await assert.rejects(save(id, "admin", true), /administrador/);
        await assert.rejects(
          db.query("select public.workforce_invite_target($1)", [
            directoryId(pending),
          ]),
          /administrador/,
        );
        await asUser(admin, "aal2");
        await save(id, "employee", true);
        assert.equal(
          (await day()).people.find((person) => person.id === directoryId(id))
            ?.registered,
          false,
        );
        const result = await db.query<{ email: string }>(
          "select public.workforce_invite_target($1) email",
          [directoryId(id)],
        );
        assert.equal(result.rows[0].email, "06@example.test");
        await assert.rejects(save(admin, "employee", true), /propio acceso/);
      },
    );

    await t.test(
      "repeat arrivals and exits preserve one shift and authentic timestamps",
      async () => {
        await asUser(worker);
        const before = Date.now();
        const first = await mark("arrival", uuid(20));
        assert.equal(first.person_id, directoryId(worker));
        assert.ok(Date.parse(first.arrived_at) >= before - 500);
        assert.equal(first.left_at, null);
        const second = await mark("arrival", uuid(21));
        assert.equal(second.id, first.id);
        await asUser(other);
        await assert.rejects(mark("departure", first.id), /no está disponible/);
        await asUser(worker);
        const exit = await mark("departure", first.id);
        assert.ok(exit.left_at);
        assert.equal((await mark("departure", first.id)).left_at, exit.left_at);
        assert.equal((await mark("arrival", uuid(21))).left_at, exit.left_at);
        assert.equal((await day()).shifts.length, 1);
        const nextShift = await mark("arrival", uuid(22));
        assert.notEqual(nextShift.id, first.id);
        assert.equal((await mark("departure", first.id)).left_at, exit.left_at);
        assert.equal(
          (await day()).shifts.find((shift) => shift.id === nextShift.id)
            ?.left_at,
          null,
        );
        await asUser(admin, "aal2");
        await assert.rejects(
          save(worker, "employee", false),
          /registrar la salida/,
        );
        await asUser(worker);
        await mark("departure", nextShift.id);
      },
    );

    await t.test(
      "supervisors can schedule only for direct reports; employees see and update only their own tasks",
      async () => {
        const task = uuid(30);
        const otherTask = uuid(31);
        await asUser(coordinator);
        const { today } = await day();
        await assert.rejects(
          schedule(task, worker, today),
          /dentro de tu equipo/,
        );
        await asUser(admin, "aal2");
        await schedule(otherTask, other, today);
        await asUser(coordinator, "aal2");
        await assert.rejects(
          schedule(task, other, today),
          /dentro de tu equipo/,
        );
        await assert.rejects(
          schedule(otherTask, worker, today),
          /editar tareas dentro de tu equipo/,
        );
        await schedule(task, worker, today);
        await schedule(task, worker, today, "Preparar pedido urgente");
        const team = await day();
        assert.deepEqual(
          team.people.map((person) => person.id),
          [directoryId(worker)],
        );
        assert.equal(team.people[0].email, null);
        assert.ok(
          team.shifts.every((shift) => shift.person_id === directoryId(worker)),
        );
        assert.equal(team.tasks[0].title, "Preparar pedido urgente");
        await asUser(worker);
        assert.deepEqual(
          (await day()).tasks.map((row) => row.id),
          [task],
        );
        assert.equal((await day("2000-01-01")).tasks.length, 0);
        await assert.rejects(status(otherTask, "done"), /No puedes cambiar/);
        await status(task, "in_progress");
        await status(task, "done");
        await status(task, "done");
        assert.equal((await day()).tasks[0].status, "done");
        await asUser(coordinator, "aal2");
        await assert.rejects(schedule(task, worker, today), /tarea pendiente/);
        await asUser(admin, "aal2");
        await save(worker, "employee", false);
        await asUser(worker);
        await assert.rejects(day(), /no tiene acceso activo/);
      },
    );
  } finally {
    await db.close();
  }
});

test("A night shift counts only the time that falls on each Bogotá date", () => {
  const shift: Shift = {
    id: uuid(1),
    person_id: uuid(2),
    arrived_at: "2026-11-12T03:00:00Z",
    left_at: "2026-11-12T11:30:00Z",
  };
  assert.equal(
    workDuration([shift], "2026-11-11", shift.left_at!),
    "2 h 0 min",
  );
  assert.equal(
    workDuration([shift], "2026-11-12", shift.left_at!),
    "6 h 30 min",
  );
});
