import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock3,
  Copy,
  Link2,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  documentIdentity,
  roleLabel,
  workforceRpc,
  WorkforceError,
  type AvailabilityInterval,
  type DirectoryPerson,
  type PermissionCode,
  type PermissionDefinition,
  type RoleDefinition,
  type WorkforceDay,
} from "@/lib/workforce";
import { Field } from "./ui";
import type { Perform } from "./workforce-app";

const dayNames = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const moduleNames: Record<string, string> = {
  personal: "Mi jornada",
  workforce: "Equipo y tareas",
  finance: "Finanzas",
  cash: "Caja",
  inventory: "Inventarios",
  sales: "Ventas",
  debts: "Deudas",
  agenda: "Agenda financiera",
  reports: "Informes",
  documents: "Documentos",
  integrations: "Integraciones e IA",
  administration: "Administración",
};

function defaultAvailability(): AvailabilityInterval[] {
  return dayNames.map((_, index) => ({
    weekday: index + 1,
    start_time: index < 6 ? "09:00" : "09:00",
    end_time: index < 6 ? "18:00" : "18:00",
    slot_order: 0,
    active: index < 6,
  }));
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function effectivePermissions(person: DirectoryPerson, roles: RoleDefinition[]) {
  return person.permissions ?? roles.find((role) => role.code === person.access_role)?.permissions ?? [];
}

export function WorkforceMemberConsole({
  snapshot,
  busy,
  perform,
}: {
  snapshot: WorkforceDay;
  busy: boolean;
  perform: Perform;
}) {
  const [selectedId, setSelectedId] = useState(snapshot.me.id);
  const [drawer, setDrawer] = useState<DirectoryPerson | "new" | null>(null);
  const [created, setCreated] = useState<{ name: string } | null>(null);
  const [invite, setInvite] = useState<{ name: string; link: string } | null>(null);
  const [loginCopied, setLoginCopied] = useState(false);
  const [removing, setRemoving] = useState<DirectoryPerson | null>(null);
  const people = snapshot.people;
  const selected = people.find((person) => person.id === selectedId) ?? people[0];

  useEffect(() => {
    if (!people.some((person) => person.id === selectedId) && people[0]) {
      setSelectedId(people[0].id);
    }
  }, [people, selectedId]);

  useEffect(() => setLoginCopied(false), [selectedId]);

  function createPrivateLink(person: DirectoryPerson) {
    void perform(async (client) => {
      const { data, error } = await client.functions.invoke<{ link: string }>("workforce-invite", {
        body: { action: "link", personId: person.id },
      });
      if (error || !data?.link)
        throw new WorkforceError("No pudimos crear el enlace privado. Intenta de nuevo.");
      setInvite({ name: person.full_name, link: data.link });
    }, "Enlace privado preparado.", false);
  }

  async function copyLoginLink() {
    await navigator.clipboard.writeText(new URL("/equipo/", window.location.origin).href);
    setLoginCopied(true);
  }

  if (!selected) {
    return (
      <section className="member-empty">
        <Users size={28} />
        <h2>Crea la primera persona del equipo</h2>
        <button className="button button-primary" onClick={() => setDrawer("new")}>
          <UserPlus size={17} /> Crear usuario
        </button>
      </section>
    );
  }

  return (
    <section className="member-console">
      <header className="member-console-heading">
        <div>
          <p className="workforce-eyebrow">ADMINISTRACIÓN</p>
          <h2>Equipo y permisos</h2>
          <p>Crea usuarios, define sus funciones y programa su jornada desde un solo lugar.</p>
        </div>
        <button className="button button-primary" disabled={busy} onClick={() => setDrawer("new")}>
          <UserPlus size={17} /> Crear usuario
        </button>
      </header>

      <div className="member-console-grid">
        <aside className="member-directory" aria-label="Miembros del equipo">
          <div className="member-directory-title">
            <strong>Miembros</strong>
            <span>{people.length}</span>
          </div>
          <ul>
            {people.map((person) => {
              const self = person.id === snapshot.me.id;
              const administrator = person.access_role === "admin";
              return (
                <li key={person.id}>
                  <button
                    className={person.id === selected.id ? "selected" : ""}
                    onClick={() => setSelectedId(person.id)}
                  >
                    <span className="member-avatar">{initials(person.full_name)}</span>
                    <span className="member-summary">
                      <strong>
                        {person.full_name}
                        {self && <small>Tú</small>}
                      </strong>
                      <span>{person.email || `${person.job_title} · ${person.area}`}</span>
                      <span className={administrator ? "member-admin-role" : ""}>
                        {administrator ? "Administrador total" : roleLabel(snapshot.roles, person.access_role)}
                      </span>
                    </span>
                    <MoreHorizontal size={17} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="member-detail">
          <MemberDetailHeader
            person={selected}
            roles={snapshot.roles}
            permissions={snapshot.permissions}
            self={selected.id === snapshot.me.id}
            busy={busy}
            edit={() => setDrawer(selected)}
            remove={() => setRemoving(selected)}
            copyLogin={() => void copyLoginLink()}
            loginCopied={loginCopied}
            createLink={() => createPrivateLink(selected)}
          />
          <AvailabilityEditor person={selected} busy={busy} perform={perform} />
          <section className="member-tasks-panel">
            <div>
              <ClipboardList size={19} />
              <div>
                <h3>Tareas programadas</h3>
                <p>Actividades asignadas para {snapshot.day === snapshot.today ? "hoy" : snapshot.day}.</p>
              </div>
            </div>
            <span>
              {snapshot.tasks.filter((task) => task.person_id === selected.id && task.status !== "cancelled").length} tareas
            </span>
          </section>
        </div>
      </div>

      {drawer && (
        <MemberDrawer
          key={drawer === "new" ? "new" : drawer.id}
          person={drawer === "new" ? undefined : drawer}
          snapshot={snapshot}
          busy={busy}
          perform={perform}
          close={() => setDrawer(null)}
          created={(name) => {
            setDrawer(null);
            setCreated({ name });
          }}
        />
      )}
      {created && <AccessCreatedResult result={created} close={() => setCreated(null)} />}
      {invite && <PrivateLinkResult result={invite} close={() => setInvite(null)} />}
      {removing && (
        <RemoveMemberDialog
          person={removing}
          busy={busy}
          perform={perform}
          close={() => setRemoving(null)}
          removed={() => {
            setRemoving(null);
            setSelectedId(snapshot.me.id);
          }}
        />
      )}
    </section>
  );
}

function MemberDetailHeader({
  person,
  roles,
  permissions,
  self,
  busy,
  edit,
  remove,
  copyLogin,
  loginCopied,
  createLink,
}: {
  person: DirectoryPerson;
  roles: RoleDefinition[];
  permissions: PermissionDefinition[];
  self: boolean;
  busy: boolean;
  edit: () => void;
  remove: () => void;
  copyLogin: () => void;
  loginCopied: boolean;
  createLink: () => void;
}) {
  const granted = effectivePermissions(person, roles);
  const modules = new Set(
    permissions.filter((permission) => granted.includes(permission.code)).map((permission) => permission.module ?? permission.category),
  );
  return (
    <section className="member-profile-header">
      <div>
        <span className="member-avatar large">{initials(person.full_name)}</span>
        <div>
          <div className="member-profile-name">
            <h3>{person.full_name}</h3>
            {self && <span>Tú</span>}
          </div>
          <p>{person.job_title} · {person.area}</p>
          <div className="member-profile-badges">
            <span className={person.access_role === "admin" ? "total" : ""}>
              <ShieldCheck size={14} />
              {person.access_role === "admin" ? "Administrador total" : roleLabel(roles, person.access_role)}
            </span>
            <span>{modules.size || granted.length} módulos autorizados</span>
            <span>{person.active ? "Usuario activo" : "Usuario inactivo"}</span>
          </div>
        </div>
      </div>
      <div className="member-profile-actions">
        <button className="button button-secondary" disabled={busy} onClick={copyLogin}><Copy size={16} /> {loginCopied ? "Enlace copiado" : "Copiar ingreso"}</button>
        <button className="button button-secondary" disabled={busy} onClick={createLink}><Link2 size={16} /> Enlace privado</button>
        {!self && <button className="button member-danger-button" disabled={busy} onClick={remove}><Trash2 size={16} /> Eliminar usuario</button>}
        <button className="button button-secondary" disabled={busy} onClick={edit}>
          {person.access_role === "admin" && self ? "Revisar control total" : "Editar usuario"}
        </button>
      </div>
    </section>
  );
}

function AvailabilityEditor({ person, busy, perform }: { person: DirectoryPerson; busy: boolean; perform: Perform }) {
  const [rows, setRows] = useState<AvailabilityInterval[]>(person.availability?.length ? person.availability : defaultAvailability());

  useEffect(() => {
    setRows(person.availability?.length ? person.availability : defaultAvailability());
  }, [person.id, person.availability]);

  function update(index: number, change: Partial<AvailabilityInterval>) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...change } : row));
  }

  function addSlot(weekday: number) {
    setRows((current) => [
      ...current,
      { weekday, start_time: "13:00", end_time: "17:00", slot_order: current.filter((row) => row.weekday === weekday).length, active: true },
    ].sort((a, b) => a.weekday - b.weekday || a.slot_order - b.slot_order));
  }

  function save() {
    void perform(
      (client) => workforceRpc(client, "workforce_save_availability", { p_person: person.id, p_schedule: rows }),
      `Horario de ${person.full_name} actualizado.`,
    );
  }

  return (
    <section className="member-schedule">
      <div className="member-section-heading">
        <div>
          <CalendarClock size={19} />
          <div><h3>Horario</h3><p>Disponibilidad semanal de {person.full_name}.</p></div>
        </div>
        <span className="member-status-dot">Disponible</span>
      </div>
      <div className="member-schedule-rows">
        {dayNames.map((name, dayIndex) => {
          const weekday = dayIndex + 1;
          const slots = rows.map((row, index) => ({ row, index })).filter(({ row }) => row.weekday === weekday);
          const enabled = slots.some(({ row }) => row.active);
          return (
            <div className="member-schedule-day" key={weekday}>
              <label className="member-day-toggle">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => slots.forEach(({ index }) => update(index, { active: event.target.checked }))}
                />
                <span aria-hidden="true" />
                <strong>{name}</strong>
              </label>
              <div className="member-time-slots">
                {slots.map(({ row, index }) => (
                  <div className="member-time-slot" key={`${weekday}-${row.slot_order}`}>
                    <label><Clock3 size={15} /><input type="time" value={row.start_time.slice(0, 5)} disabled={!row.active} onChange={(event) => update(index, { start_time: event.target.value })} /></label>
                    <span>a</span>
                    <label><Clock3 size={15} /><input type="time" value={row.end_time.slice(0, 5)} disabled={!row.active} onChange={(event) => update(index, { end_time: event.target.value })} /></label>
                    {slots.length > 1 && <button type="button" aria-label="Eliminar intervalo" onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}><X size={16} /></button>}
                  </div>
                ))}
              </div>
              <button type="button" className="member-add-slot" aria-label={`Agregar intervalo el ${name}`} disabled={!enabled} onClick={() => addSlot(weekday)}><Plus size={18} /></button>
            </div>
          );
        })}
      </div>
      <div className="member-schedule-actions">
        <button className="button button-primary" disabled={busy} onClick={save}>Guardar horario</button>
      </div>
    </section>
  );
}

function MemberDrawer({
  person,
  snapshot,
  busy,
  perform,
  close,
  created,
}: {
  person?: DirectoryPerson;
  snapshot: WorkforceDay;
  busy: boolean;
  perform: Perform;
  close: () => void;
  created: (name: string) => void;
}) {
  const editingSelf = person?.id === snapshot.me.id;
  const [personId] = useState(()=>person?.id ?? crypto.randomUUID());
  const [role, setRole] = useState(person?.access_role ?? "employee");
  const initial = useMemo(() => new Set(person ? effectivePermissions(person, snapshot.roles) : snapshot.roles.find((item) => item.code === "employee")?.permissions ?? []), [person, snapshot.roles]);
  const [granted, setGranted] = useState<Set<string>>(initial);
  const [expanded, setExpanded] = useState<string | null>(null);
  const groups = useMemo(() => {
    const result = new Map<string, PermissionDefinition[]>();
    for (const permission of snapshot.permissions) {
      const module = permission.module ?? permission.category;
      result.set(module, [...(result.get(module) ?? []), permission]);
    }
    return [...result.entries()];
  }, [snapshot.permissions]);

  function selectRole(code: string) {
    setRole(code);
    setGranted(new Set(snapshot.roles.find((item) => item.code === code)?.permissions ?? []));
  }

  function toggleModule(modulePermissions: PermissionDefinition[]) {
    setGranted((current) => {
      const next = new Set(current);
      const all = modulePermissions.every((permission) => next.has(permission.code));
      modulePermissions.forEach((permission) => all ? next.delete(permission.code) : next.add(permission.code));
      return next;
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const name = String(fields.get("name") ?? "").trim();
    void perform(async (client) => {
      const password = String(fields.get("password") ?? "");
      if ((!person || password) && password.length < 6)
        throw new WorkforceError("La contraseña debe tener al menos 6 caracteres por el requisito técnico del acceso.");
      if ((!person || password) && password !== String(fields.get("confirm") ?? ""))
        throw new WorkforceError("Las contraseñas no coinciden.");
      const documentNumber = String(fields.get("document") ?? "");
      const identity = documentNumber
        ? await documentIdentity(documentNumber)
        : person?.identifier_hash && person.identifier_last_four
          ? { hash: person.identifier_hash, lastFour: person.identifier_last_four }
          : null;
      if (!identity) throw new WorkforceError("Introduce el número de cédula de la persona.");
      await workforceRpc(client, "workforce_save_person", {
        p_id: personId,
        p_identifier_hash: identity.hash,
        p_identifier_last_four: identity.lastFour,
        p_name: name,
        p_title: fields.get("title"),
        p_area: fields.get("area"),
        p_role: editingSelf ? person?.access_role : role,
        p_supervisor: person?.supervisor_id ?? null,
        p_active: editingSelf || fields.get("active") === "on",
      });
      await workforceRpc(client, "workforce_save_member_access", {
        p_person: personId,
        p_email: fields.get("email") || null,
        p_role: editingSelf ? person?.access_role : role,
        p_permissions: editingSelf ? effectivePermissions(person!, snapshot.roles) : [...granted],
      });
      if (!person) {
        const { data, error } = await client.functions.invoke<{ created: boolean }>("workforce-invite", {
          body: { action: "create", personId, password },
        });
        if (error || data?.created !== true) {
          const problem=await error?.context?.json?.().catch(()=>null);
          if(problem?.code!=="already_registered")throw new WorkforceError("El perfil se guardó. Vuelve a pulsar Crear usuario para completar el acceso.");
          const retry=await client.functions.invoke("workforce-invite",{body:{action:"password",personId,password}});
          if(retry.error||retry.data?.passwordUpdated!==true)throw new WorkforceError("No se pudo confirmar la contraseña. Intenta de nuevo.");
        }
        created(name);
      } else {
        if (password) {
          const { data, error } = await client.functions.invoke<{ passwordUpdated: boolean }>("workforce-invite", {
            body: { action: "password", personId, password },
          });
          if (error || data?.passwordUpdated !== true)
            throw new WorkforceError("Los datos se guardaron, pero no pudimos asignar la nueva contraseña. Intenta de nuevo.");
        }
        close();
      }
    }, person ? "Usuario y permisos actualizados." : "Usuario creado.");
  }

  return (
    <div className="member-drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <aside className="member-drawer" role="dialog" aria-modal="true" aria-labelledby="member-drawer-title">
        <header><div><p className="workforce-eyebrow">EQUIPO</p><h2 id="member-drawer-title">{person ? "Editar usuario" : "Crear usuario"}</h2></div><button className="icon-button" aria-label="Cerrar" onClick={close}><X size={20} /></button></header>
        <form onSubmit={submit}>
          <div className="member-form-grid">
            <Field label="Nombre completo"><input name="name" required minLength={2} maxLength={120} defaultValue={person?.full_name} /></Field>
            <Field label="Correo de trabajo"><input name="email" type="email" maxLength={254} defaultValue={person?.email ?? ""} placeholder="nombre@empresa.com" /></Field>
            <Field label="Número de cédula" hint={person ? "Déjalo vacío para conservar la cédula registrada." : "Será su usuario de ingreso; no se guardará el número completo."}><input name="document" inputMode="numeric" required={!person} disabled={person?.registered} /></Field>
            <Field label="Cargo"><input name="title" required minLength={2} maxLength={120} defaultValue={person?.job_title} /></Field>
            <Field label="Área"><input name="area" required minLength={2} maxLength={120} defaultValue={person?.area} /></Field>
            <Field label={person ? "Asignar nueva contraseña" : "Contraseña inicial"} hint={person ? "Opcional. Si la dejas vacía, la contraseña actual no cambia." : "Tú defines la clave. Mínimo técnico: 6 caracteres; sin obligación de mayúsculas, números o símbolos."}><input name="password" type="password" required={!person} minLength={6} maxLength={256} autoComplete="new-password" /></Field>
            <Field label={person ? "Repetir nueva contraseña" : "Repetir contraseña"}><input name="confirm" type="password" required={!person} minLength={6} maxLength={256} autoComplete="new-password" /></Field>
          </div>

          <section className="member-role-section">
            <div><h3>Rol base</h3><p>Sirve como punto de partida; después puedes ajustar cada permiso.</p></div>
            <div className="member-role-options">
              {snapshot.roles.filter((item) => ["admin", "employee", "reader"].includes(item.code)).map((item) => (
                <button key={item.code} type="button" className={role === item.code ? "active" : ""} disabled={editingSelf} onClick={() => selectRole(item.code)}>
                  {item.code === "admin" ? "Administrador" : item.code === "employee" ? "Agente" : "Lector"}
                </button>
              ))}
            </div>
          </section>

          <section className="member-permission-section">
            <div className="member-permission-heading"><div><h3>Permisos por módulo</h3><p>Decide qué información puede ver y qué acciones puede ejecutar.</p></div><span>{granted.size}/{snapshot.permissions.length}</span></div>
            <div className="member-permission-list">
              {groups.map(([module, modulePermissions]) => {
                const count = modulePermissions.filter((permission) => granted.has(permission.code)).length;
                const all = count === modulePermissions.length;
                return (
                  <div className="member-permission-group" key={module}>
                    <div className="member-permission-row">
                      <button type="button" className="member-expand" onClick={() => setExpanded(expanded === module ? null : module)}>{expanded === module ? <ChevronDown size={17} /> : <ChevronRight size={17} />}</button>
                      <label><input type="checkbox" checked={all} disabled={editingSelf} onChange={() => toggleModule(modulePermissions)} /><span>{all && <Check size={13} />}</span><strong>{moduleNames[module] ?? module}</strong></label>
                      <small>{count}/{modulePermissions.length}</small>
                    </div>
                    {expanded === module && <div className="member-permission-items">{modulePermissions.map((permission) => <label key={permission.code}><input type="checkbox" checked={granted.has(permission.code)} disabled={editingSelf} onChange={() => setGranted((current) => { const next = new Set(current); next.has(permission.code) ? next.delete(permission.code) : next.add(permission.code); return next; })} /><span>{permission.name}<small>{permission.description}</small></span></label>)}</div>}
                  </div>
                );
              })}
            </div>
          </section>
          <label className="workforce-checkbox"><input name="active" type="checkbox" defaultChecked={person?.active ?? true} disabled={editingSelf} /> Usuario activo</label>
          {editingSelf && <p className="member-protected"><ShieldCheck size={16} /> Tu cuenta conserva control total para evitar que la empresa quede sin administración.</p>}
          <footer><button type="button" className="button button-secondary" onClick={close} disabled={busy}>Cancelar</button><button type="submit" className="button button-primary" disabled={busy}>{person ? "Guardar cambios" : "Crear usuario y acceso"}</button></footer>
        </form>
      </aside>
    </div>
  );
}

function AccessCreatedResult({ result, close }: { result: { name: string }; close: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="member-drawer-backdrop">
      <section className="member-invite-result" role="dialog" aria-modal="true">
        <span className="member-success"><Check size={25} /></span>
        <h2>Usuario y clave listos</h2>
        <p>{result.name} puede entrar de inmediato con su número de cédula y la contraseña que acabas de definir. Compártelos únicamente por un canal privado.</p>
        <button className="button button-primary" onClick={async () => { await navigator.clipboard.writeText(new URL("/equipo/", window.location.origin).href); setCopied(true); }}><Copy size={16} /> {copied ? "Enlace copiado" : "Copiar enlace de ingreso"}</button>
        <button className="button button-secondary" onClick={close}>Cerrar</button>
      </section>
    </div>
  );
}

function PrivateLinkResult({ result, close }: { result: { name: string; link: string }; close: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="member-drawer-backdrop">
      <section className="member-invite-result" role="dialog" aria-modal="true" aria-labelledby="private-link-title">
        <span className="member-success"><Link2 size={25} /></span>
        <h2 id="private-link-title">Enlace privado listo</h2>
        <p>Envíalo únicamente a {result.name}. Al abrirlo podrá crear o restablecer su contraseña y luego ingresar con su cédula.</p>
        <Field label="Enlace de activación"><input value={result.link} readOnly onFocus={(event) => event.target.select()} /></Field>
        <button className="button button-primary" onClick={async () => { await navigator.clipboard.writeText(result.link); setCopied(true); }}><Copy size={16} /> {copied ? "Enlace copiado" : "Copiar enlace privado"}</button>
        <button className="button button-secondary" onClick={close}>Cerrar</button>
      </section>
    </div>
  );
}

function RemoveMemberDialog({
  person,
  busy,
  perform,
  close,
  removed,
}: {
  person: DirectoryPerson;
  busy: boolean;
  perform: Perform;
  close: () => void;
  removed: () => void;
}) {
  function confirmRemoval() {
    void perform(async (client) => {
      const { data, error } = await client.functions.invoke<{ removed: boolean }>("workforce-invite", {
        body: { action: "delete", personId: person.id },
      });
      if (error || data?.removed !== true)
        throw new WorkforceError("No pudimos eliminar el usuario. Revisa que no tenga una jornada abierta o personas a cargo.");
      removed();
    }, `${person.full_name} fue eliminado y su acceso quedó revocado.`);
  }

  return (
    <div className="member-drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section className="member-delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="member-delete-title">
        <span className="member-delete-icon"><Trash2 size={23} /></span>
        <div>
          <h2 id="member-delete-title">Eliminar usuario</h2>
          <p><strong>{person.full_name}</strong> dejará de aparecer en Equipo y no podrá volver a iniciar sesión. Su historial de tareas y jornadas se conservará.</p>
        </div>
        <div className="member-delete-actions">
          <button className="button button-secondary" disabled={busy} onClick={close}>Cancelar</button>
          <button className="button member-danger-button solid" disabled={busy} onClick={confirmRemoval}><Trash2 size={16} /> Eliminar definitivamente</button>
        </div>
      </section>
    </div>
  );
}
