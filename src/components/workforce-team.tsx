import { useRef, useState, type FormEvent } from "react";
import { ClipboardList, Clock, Link2, Pencil, Plus, Users } from "lucide-react";
import {
  accessRoles,
  documentIdentity,
  workforceRpc,
  WorkforceError,
  type DailyTask,
  type DirectoryPerson,
  type WorkforceDay,
} from "@/lib/workforce";
import { Badge, Field } from "./ui";
import { ShiftList, TaskList } from "./workforce-lists";
import type { Perform } from "./workforce-app";

export function TeamManagement({
  snapshot,
  busy,
  perform,
}: {
  snapshot: WorkforceDay;
  busy: boolean;
  perform: Perform;
}) {
  const [section, setSection] = useState<"schedule" | "directory">("schedule");
  const [filter, setFilter] = useState("");
  const [personForm, setPersonForm] = useState<DirectoryPerson | "new" | null>(
    null,
  );
  const [taskForm, setTaskForm] = useState<DailyTask | "new" | null>(null);
  const [invite, setInvite] = useState<{ name: string; link: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const people = snapshot.people;
  const activePeople = people.filter((person) => person.active);
  const admin = snapshot.me.access_role === "admin";
  const names = new Map(people.map((person) => [person.id, person]));
  const teamTasks = snapshot.tasks.filter(
    (task) =>
      names.has(task.person_id) && (!filter || task.person_id === filter),
  );
  const attendance = people.filter(
    (person) =>
      (!filter || person.id === filter) &&
      (person.active ||
        snapshot.shifts.some((shift) => shift.person_id === person.id)),
  );

  async function generateInvite(person: DirectoryPerson) {
    setInvite(null);
    setCopied(false);
    await perform(
      async (client) => {
        const { data, error } = await client.functions.invoke<{ link: string }>(
          "workforce-invite",
          {
            body: { action: "link", personId: person.id },
          },
        );
        if (error || !data?.link) {
          const details = await error?.context?.json?.().catch(() => null);
          throw new WorkforceError(
            "No pudimos generar el enlace. Revisa que el alta esté activa e intenta de nuevo.",
          );
        }
        setInvite({ name: person.full_name, link: data.link });
      },
      undefined,
      false,
    );
  }

  return (
    <>
      <nav
        className="workforce-tabs workforce-subtabs"
        aria-label="Gestión de equipo"
      >
        <button
          aria-current={section === "schedule" ? "page" : undefined}
          onClick={() => setSection("schedule")}
        >
          <ClipboardList size={16} /> Plan del día
        </button>
        <button
          aria-current={section === "directory" ? "page" : undefined}
          onClick={() => setSection("directory")}
        >
          <Users size={16} /> Personas
        </button>
      </nav>
      {section === "directory" ? (
        <section className="workforce-card">
          <div className="workforce-card-heading">
            <Users size={20} />
            <h2>Personas</h2>
            {admin && (
              <button
                className="button button-primary"
                disabled={busy}
                onClick={() => {
                  setPersonForm("new");
                  setInvite(null);
                }}
              >
                <Plus size={17} /> Nueva persona
              </button>
            )}
          </div>
          {personForm && admin && (
            <PersonForm
              key={personForm === "new" ? personForm : personForm.id}
              person={personForm === "new" ? undefined : personForm}
              people={people}
              actorId={snapshot.me.id}
              busy={busy}
              perform={perform}
              close={() => setPersonForm(null)}
            />
          )}
          {invite && (
            <section className="workforce-inline-form">
              <h3>Invitación para {invite.name}</h3>
              <p>
                Comparte este enlace de activación por un canal privado con esta
                persona.
              </p>
              <Field label="Enlace de un solo uso">
                <input
                  value={invite.link}
                  readOnly
                  onFocus={(event) => event.target.select()}
                />
              </Field>
              <div className="workforce-actions">
                <button
                  className="button button-primary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(invite.link);
                      setCopied(true);
                    } catch {
                      setCopied(false);
                    }
                  }}
                >
                  <Link2 size={16} /> Copiar enlace
                </button>
                <button
                  className="button button-secondary"
                  onClick={() => setInvite(null)}
                >
                  Cerrar
                </button>
                {copied && <span role="status">Enlace copiado.</span>}
              </div>
            </section>
          )}
          {people.length ? (
            <ul className="workforce-people">
              {people.map((person) => (
                <li key={person.id}>
                  <div>
                    <strong>{person.full_name}</strong>
                    <p>
                      {person.job_title} · {person.area}
                    </p>
                    {person.identifier_last_four && <small>Cédula terminada en {person.identifier_last_four}</small>}
                    {person.supervisor_id &&
                      names.has(person.supervisor_id) && (
                        <small>
                          Coordina {names.get(person.supervisor_id)?.full_name}
                        </small>
                      )}
                  </div>
                  <div className="workforce-people-access">
                    <Badge tone="blue">{accessRoles[person.access_role]}</Badge>
                    <Badge
                      tone={
                        !person.active
                          ? "neutral"
                          : person.registered
                            ? "green"
                            : "orange"
                      }
                    >
                      {!person.active
                        ? "Inactivo"
                        : person.registered
                          ? "Activo"
                          : "Pendiente de ingreso"}
                    </Badge>
                  </div>
                  {admin && (
                    <div className="workforce-actions">
                      {person.active && (
                        <button
                          className="button button-secondary"
                          onClick={() => void generateInvite(person)}
                          disabled={busy}
                        >
                          <Link2 size={16} /> {person.registered ? "Restablecer acceso" : "Crear acceso"}
                        </button>
                      )}
                      <button
                        className="button button-secondary"
                        onClick={() => {
                          setPersonForm(person);
                          setInvite(null);
                        }}
                        disabled={busy}
                      >
                        <Pencil size={15} /> Editar
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="workforce-empty">
              Todavía no tienes personas asignadas.
            </p>
          )}
        </section>
      ) : (
        <>
          <div className="workforce-team-filter">
            <Field label="Persona">
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              >
                <option value="">Todo el equipo</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.full_name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="workforce-layout">
            <section className="workforce-card">
              <div className="workforce-card-heading">
                <Clock size={20} />
                <h2>Asistencia del equipo</h2>
              </div>
              {attendance.length ? (
                <ul className="workforce-team-attendance">
                  {attendance.map((person) => (
                    <li key={person.id}>
                      <h3>{person.full_name}</h3>
                      <p>
                        {person.job_title} · {person.area}
                      </p>
                      <ShiftList
                        shifts={snapshot.shifts.filter(
                          (shift) => shift.person_id === person.id,
                        )}
                        day={snapshot.day}
                        now={snapshot.server_now}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="workforce-empty">
                  No hay personas en esta selección.
                </p>
              )}
            </section>
            <section className="workforce-card">
              <div className="workforce-card-heading">
                <ClipboardList size={20} />
                <h2>Tareas del equipo</h2>
                <button
                  className="button button-primary"
                  disabled={busy || !activePeople.length}
                  onClick={() => setTaskForm("new")}
                >
                  <Plus size={17} /> Programar tarea
                </button>
              </div>
              {taskForm && (
                <TaskForm
                  key={taskForm === "new" ? taskForm : taskForm.id}
                  task={taskForm === "new" ? undefined : taskForm}
                  people={activePeople}
                  day={snapshot.day}
                  personId={filter}
                  busy={busy}
                  perform={perform}
                  close={() => setTaskForm(null)}
                />
              )}
              <TaskList
                tasks={teamTasks}
                busy={busy}
                manage
                names={names}
                edit={setTaskForm}
                change={(id, status) =>
                  void perform(
                    (client) =>
                      workforceRpc<void>(client, "workforce_set_task_status", {
                        p_id: id,
                        p_status: status,
                      }),
                    "Tarea cancelada.",
                  )
                }
              />
            </section>
          </div>
        </>
      )}
    </>
  );
}

function PersonForm({
  person,
  people,
  actorId,
  busy,
  perform,
  close,
}: {
  person?: DirectoryPerson;
  people: DirectoryPerson[];
  actorId: string;
  busy: boolean;
  perform: Perform;
  close: () => void;
}) {
  const requestId = useRef(person?.id);
  const self = person?.id === actorId;
  const coordinators = people.filter(
    (candidate) =>
      candidate.id !== person?.id &&
      candidate.active &&
      candidate.access_role !== "employee",
  );

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void perform(
      async (client) => {
        const documentNumber = String(fields.get("document") ?? "");
        const identity = documentNumber
          ? await documentIdentity(documentNumber)
          : person?.identifier_hash && person.identifier_last_four
            ? { hash: person.identifier_hash, lastFour: person.identifier_last_four }
            : null;
        if (!identity) throw new WorkforceError("Introduce el número de cédula.");
        await workforceRpc(client, "workforce_save_person", {
          p_id: (requestId.current ??= crypto.randomUUID()),
          p_identifier_hash: identity.hash,
          p_identifier_last_four: identity.lastFour,
          p_name: fields.get("name"),
          p_title: fields.get("title"),
          p_area: fields.get("area"),
          p_role: self ? person.access_role : fields.get("role"),
          p_supervisor: fields.get("supervisor") || null,
          p_active: self || fields.get("active") === "on",
        });
        close();
      },
      person
        ? "Datos de la persona actualizados."
        : "Persona creada. Ya puedes generar su invitación.",
    );
  }

  return (
    <form className="workforce-inline-form" onSubmit={save}>
      <h3>{person ? "Editar persona" : "Nueva persona"}</h3>
      <div className="workforce-form-grid">
        <Field label="Nombre completo">
          <input
            name="name"
            required
            minLength={2}
            maxLength={120}
            defaultValue={person?.full_name}
          />
        </Field>
        <Field label="Número de cédula" hint={person ? `Actual: •••• ${person.identifier_last_four ?? ""}. Déjalo vacío para conservarla.` : "No se guardará el número completo."}>
          <input
            name="document"
            inputMode="numeric"
            required={!person}
            disabled={person?.registered}
          />
        </Field>
        <Field label="Cargo en la empresa">
          <input
            name="title"
            required
            minLength={2}
            maxLength={120}
            placeholder="Ej. Operario de producción"
            defaultValue={person?.job_title}
          />
        </Field>
        <Field label="Área">
          <input
            name="area"
            required
            minLength={2}
            maxLength={120}
            placeholder="Ej. Producción"
            defaultValue={person?.area}
          />
        </Field>
        <Field label="Permisos en Equipo">
          <select
            name="role"
            defaultValue={person?.access_role ?? "employee"}
            disabled={self}
          >
            {Object.entries(accessRoles).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Coordinador asignado">
          <select name="supervisor" defaultValue={person?.supervisor_id ?? ""}>
            <option value="">Sin coordinador</option>
            {coordinators.map((coordinator) => (
              <option key={coordinator.id} value={coordinator.id}>
                {coordinator.full_name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p>
        El colaborador ve su jornada y sus tareas. El coordinador también
        gestiona a sus personas asignadas. El administrador gestiona cuentas,
        permisos y toda la operación de Equipo.
      </p>
      <label className="workforce-checkbox">
        <input
          name="active"
          type="checkbox"
          defaultChecked={person?.active ?? true}
          disabled={self}
        />{" "}
        Acceso activo
      </label>
      <div className="workforce-actions">
        <button className="button button-primary" type="submit" disabled={busy}>
          {person ? "Guardar cambios" : "Crear persona"}
        </button>
        <button
          className="button button-secondary"
          type="button"
          onClick={close}
          disabled={busy}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

function TaskForm({
  task,
  people,
  day,
  personId,
  busy,
  perform,
  close,
}: {
  task?: DailyTask;
  people: DirectoryPerson[];
  day: string;
  personId: string;
  busy: boolean;
  perform: Perform;
  close: () => void;
}) {
  const requestId = useRef(task?.id);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void perform(
      async (client) => {
        await workforceRpc(client, "workforce_assign_task", {
          p_id: (requestId.current ??= crypto.randomUUID()),
          p_person: fields.get("person"),
          p_day: fields.get("day"),
          p_time: fields.get("time") || null,
          p_title: fields.get("title"),
          p_details: fields.get("details"),
        });
        close();
      },
      task ? "Programación actualizada." : "Tarea programada.",
    );
  }

  return (
    <form className="workforce-inline-form" onSubmit={save}>
      <h3>{task ? "Editar programación" : "Programar tarea"}</h3>
      <Field label="Tarea">
        <input
          name="title"
          minLength={2}
          maxLength={140}
          defaultValue={task?.title}
          required
        />
      </Field>
      <Field label="Asignar a">
        <select
          name="person"
          defaultValue={
            task?.person_id ??
            (people.some((person) => person.id === personId) ? personId : "")
          }
          required
        >
          <option value="">Seleccionar persona</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.full_name}
            </option>
          ))}
        </select>
      </Field>
      <div className="workforce-form-grid">
        <Field label="Fecha">
          <input
            name="day"
            type="date"
            defaultValue={day}
            max="9999-12-31"
            required
          />
        </Field>
        <Field label="Hora límite (opcional)">
          <input
            name="time"
            type="time"
            defaultValue={task?.due_at?.slice(0, 5)}
          />
        </Field>
      </div>
      <Field label="Instrucciones (opcional)">
        <textarea
          name="details"
          rows={3}
          maxLength={1500}
          defaultValue={task?.details}
        />
      </Field>
      <div className="workforce-actions">
        <button className="button button-primary" type="submit" disabled={busy}>
          {task ? "Guardar programación" : "Asignar tarea"}
        </button>
        <button
          className="button button-secondary"
          type="button"
          onClick={close}
          disabled={busy}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
