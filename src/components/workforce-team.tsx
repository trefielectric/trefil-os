import { useRef, useState, type FormEvent } from "react";
import { ClipboardList, Clock, Link2, Pencil, Plus, ShieldCheck, Users } from "lucide-react";
import {
  documentIdentity,
  hasCapability,
  roleLabel,
  workforceRpc,
  WorkforceError,
  type DailyTask,
  type DirectoryPerson,
  type PermissionDefinition,
  type RoleDefinition,
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
  const [section, setSection] = useState<"schedule" | "directory" | "roles">(
    () => hasCapability(snapshot, "roles_manage") && !hasCapability(snapshot, "team_view") ? "roles" : "schedule",
  );
  const [filter, setFilter] = useState("");
  const [personForm, setPersonForm] = useState<DirectoryPerson | "new" | null>(
    null,
  );
  const [taskForm, setTaskForm] = useState<DailyTask | "new" | null>(null);
  const [accessPerson, setAccessPerson] = useState<DirectoryPerson | null>(null);
  const [invite, setInvite] = useState<{ name: string; link: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const people = snapshot.people;
  const activePeople = people.filter((person) => person.active);
  const canPeople = hasCapability(snapshot, "people_manage");
  const canAccess = hasCapability(snapshot, "access_manage");
  const canRoles = hasCapability(snapshot, "roles_manage");
  const canAssign = hasCapability(snapshot, "tasks_assign");
  const canCancel = hasCapability(snapshot, "tasks_cancel");
  const viewAttendance = hasCapability(snapshot, "attendance_view_team");
  const viewTasks = hasCapability(snapshot, "tasks_view_team");
  const viewDirectory = hasCapability(snapshot, "team_view") || canPeople || canAccess;
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
        {(viewAttendance || viewTasks || canAssign || canCancel) && (
          <button
            aria-current={section === "schedule" ? "page" : undefined}
            onClick={() => setSection("schedule")}
          >
            <ClipboardList size={16} /> Plan del día
          </button>
        )}
        {viewDirectory && (
          <button
            aria-current={section === "directory" ? "page" : undefined}
            onClick={() => setSection("directory")}
          >
            <Users size={16} /> Personas
          </button>
        )}
        {canRoles && (
          <button
            aria-current={section === "roles" ? "page" : undefined}
            onClick={() => setSection("roles")}
          >
            <ShieldCheck size={16} /> Funciones y roles
          </button>
        )}
      </nav>
      {section === "roles" && canRoles ? (
        <RolesManager snapshot={snapshot} busy={busy} perform={perform} />
      ) : section === "directory" ? (
        <section className="workforce-card">
          <div className="workforce-card-heading">
            <Users size={20} />
            <h2>Personas</h2>
            {canPeople && (
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
          {personForm && canPeople && (
            <PersonForm
              key={personForm === "new" ? personForm : personForm.id}
              person={personForm === "new" ? undefined : personForm}
              people={people}
              roles={snapshot.roles}
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
                    <Badge tone="blue">{roleLabel(snapshot.roles, person.access_role)}</Badge>
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
                  {(canPeople || canAccess) && (
                    <div className="workforce-actions">
                      {canRoles && (
                        <button
                          className="button button-secondary"
                          onClick={() => setAccessPerson(person)}
                          disabled={busy}
                        >
                          <ShieldCheck size={15} /> Funciones
                        </button>
                      )}
                      {canAccess && person.active && (
                        <button
                          className="button button-secondary"
                          onClick={() => void generateInvite(person)}
                          disabled={busy}
                        >
                          <Link2 size={16} /> {person.registered ? "Restablecer acceso" : "Crear acceso"}
                        </button>
                      )}
                      {canPeople && (
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
                      )}
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
          {accessPerson && canRoles && (
            <PersonAccessPanel
              person={accessPerson}
              roles={snapshot.roles}
              permissions={snapshot.permissions}
              close={() => setAccessPerson(null)}
              edit={() => {
                setPersonForm(accessPerson);
                setAccessPerson(null);
              }}
            />
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
            {viewAttendance && <section className="workforce-card">
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
            </section>}
            {viewTasks && <section className="workforce-card">
              <div className="workforce-card-heading">
                <ClipboardList size={20} />
                <h2>Tareas del equipo</h2>
                {canAssign && (
                  <button
                    className="button button-primary"
                    disabled={busy || !activePeople.length}
                    onClick={() => setTaskForm("new")}
                  >
                    <Plus size={17} /> Programar tarea
                  </button>
                )}
              </div>
              {taskForm && canAssign && (
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
                interactive={canCancel || canAssign}
                canCancel={canCancel}
                names={names}
                edit={canAssign ? setTaskForm : undefined}
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
            </section>}
          </div>
        </>
      )}
    </>
  );
}

function PersonAccessPanel({
  person,
  roles,
  permissions,
  close,
  edit,
}: {
  person: DirectoryPerson;
  roles: RoleDefinition[];
  permissions: PermissionDefinition[];
  close: () => void;
  edit: () => void;
}) {
  const role = roles.find((item) => item.code === person.access_role);
  const enabled = new Set(role?.permissions ?? []);
  const groups = [
    ["personal", "Funciones personales"],
    ["team", "Equipo y coordinación"],
    ["administration", "Administración y acceso a información"],
  ] as const;
  return (
    <section className="workforce-inline-form workforce-access-panel" aria-label={`Funciones de ${person.full_name}`}>
      <div className="workforce-card-heading">
        <ShieldCheck size={20} />
        <div>
          <h3>Funciones de {person.full_name}</h3>
          <p>Este perfil hereda las funciones del rol <strong>{role?.name ?? person.access_role}</strong>.</p>
        </div>
      </div>
      <div className="workforce-permission-groups">
        {groups.map(([category, title]) => (
          <fieldset key={category}>
            <legend>{title}</legend>
            {permissions.filter((permission) => permission.category === category).map((permission) => (
              <label key={permission.code} className="workforce-permission-option">
                <input type="checkbox" checked={enabled.has(permission.code)} readOnly />
                <span><strong>{permission.name}</strong><small>{permission.description}</small></span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <p className="workforce-form-note">Para cambiar estas funciones, edita el rol de esta persona o crea un rol nuevo en “Funciones y roles”. Los controles se vuelven a validar en el servidor.</p>
      <div className="workforce-actions">
        <button className="button button-primary" type="button" onClick={edit}><Pencil size={15} /> Cambiar rol</button>
        <button className="button button-secondary" type="button" onClick={close}>Cerrar</button>
      </div>
    </section>
  );
}

function RolesManager({
  snapshot,
  busy,
  perform,
}: {
  snapshot: WorkforceDay;
  busy: boolean;
  perform: Perform;
}) {
  const [form, setForm] = useState<RoleDefinition | "new" | null>(null);
  const permissionNames = new Map(
    snapshot.permissions.map((permission) => [permission.code, permission.name]),
  );
  return (
    <section className="workforce-card">
      <div className="workforce-card-heading">
        <ShieldCheck size={20} />
        <h2>Funciones y roles</h2>
        <button
          className="button button-primary"
          disabled={busy}
          onClick={() => setForm("new")}
        >
          <Plus size={17} /> Nuevo rol
        </button>
      </div>
      <p className="workforce-section-intro">
        Define qué puede hacer cada rol y qué información puede consultar. Los
        permisos se aplican al volver a cargar Equipo.
      </p>
      {form && (
        <RoleForm
          key={form === "new" ? form : form.code}
          role={form === "new" ? undefined : form}
          permissions={snapshot.permissions}
          busy={busy}
          perform={perform}
          close={() => setForm(null)}
        />
      )}
      <ul className="workforce-roles">
        {snapshot.roles.map((role) => (
          <li key={role.code}>
            <div className="workforce-role-heading">
              <div>
                <strong>{role.name}</strong>
                <p>{role.description}</p>
              </div>
              <div className="workforce-people-access">
                {role.system && <Badge tone="blue">Rol base</Badge>}
                <Badge tone={role.active ? "green" : "neutral"}>
                  {role.active ? "Activo" : "Inactivo"}
                </Badge>
              </div>
            </div>
            <div className="workforce-permission-summary">
              {role.permissions.length ? role.permissions.map((permission) => (
                <span key={permission}>{permissionNames.get(permission) ?? permission}</span>
              )) : <span>Sin funciones asignadas</span>}
            </div>
            {role.code === "admin" ? (
              <small>Protegido: conserva todas las funciones para evitar un bloqueo administrativo.</small>
            ) : (
              <button
                className="button button-secondary"
                disabled={busy}
                onClick={() => setForm(role)}
              >
                <Pencil size={15} /> Editar funciones
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RoleForm({
  role,
  permissions,
  busy,
  perform,
  close,
}: {
  role?: RoleDefinition;
  permissions: PermissionDefinition[];
  busy: boolean;
  perform: Perform;
  close: () => void;
}) {
  const code = useRef(
    role?.code ?? `rol_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`,
  );
  const groups = [
    ["personal", "Funciones personales"],
    ["team", "Equipo y coordinación"],
    ["administration", "Administración y acceso a información"],
  ] as const;

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void perform(
      async (client) => {
        await workforceRpc(client, "workforce_save_role", {
          p_code: code.current,
          p_name: fields.get("name"),
          p_description: fields.get("description"),
          p_permissions: fields.getAll("permission"),
          p_active: role?.system || fields.get("active") === "on",
        });
        close();
      },
      role ? "Rol y funciones actualizados." : "Rol creado.",
    );
  }

  return (
    <form className="workforce-inline-form" onSubmit={save}>
      <h3>{role ? `Editar ${role.name}` : "Nuevo rol"}</h3>
      <div className="workforce-form-grid">
        <Field label="Nombre del rol">
          <input name="name" required minLength={2} maxLength={60} defaultValue={role?.name} placeholder="Ej. Auxiliar de bodega" />
        </Field>
        <Field label="Descripción">
          <input name="description" required minLength={2} maxLength={240} defaultValue={role?.description} placeholder="Responsabilidad principal del rol" />
        </Field>
      </div>
      <div className="workforce-permission-groups">
        {groups.map(([category, title]) => (
          <fieldset key={category}>
            <legend>{title}</legend>
            {permissions.filter((permission) => permission.category === category).map((permission) => (
              <label key={permission.code} className="workforce-permission-option">
                <input
                  type="checkbox"
                  name="permission"
                  value={permission.code}
                  defaultChecked={role?.permissions.includes(permission.code)}
                />
                <span><strong>{permission.name}</strong><small>{permission.description}</small></span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <label className="workforce-checkbox">
        <input name="active" type="checkbox" defaultChecked={role?.active ?? true} disabled={role?.system} /> Rol disponible para asignar
      </label>
      <div className="workforce-actions">
        <button className="button button-primary" type="submit" disabled={busy}>Guardar rol</button>
        <button className="button button-secondary" type="button" onClick={close} disabled={busy}>Cancelar</button>
      </div>
    </form>
  );
}

function PersonForm({
  person,
  people,
  roles,
  actorId,
  busy,
  perform,
  close,
}: {
  person?: DirectoryPerson;
  people: DirectoryPerson[];
  roles: RoleDefinition[];
  actorId: string;
  busy: boolean;
  perform: Perform;
  close: () => void;
}) {
  const requestId = useRef(person?.id);
  const self = person?.id === actorId;
  const roleMap = new Map(roles.map((role) => [role.code, role]));
  const coordinators = people.filter(
    (candidate) =>
      candidate.id !== person?.id &&
      candidate.active &&
      roleMap.get(candidate.access_role)?.permissions.includes("team_view"),
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
            {roles.filter((role) => role.active || role.code === person?.access_role).map((role) => (
              <option key={role.code} value={role.code}>
                {role.name}
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
        Las funciones de cada rol se configuran en Funciones y roles. Los
        cambios se validan en la base de datos antes de permitir cada acción.
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
