"use client";

import { useState, type FormEvent } from "react";
import { Brand } from "./brand";
import { WorkforceEmbedded } from "./workforce-embedded";
import { plantKinds, sections } from "@/lib/plant-forms";

export function TeamPage() {
  return (
    <main className="jrn-shell">
      <header className="jrn-brand">
        <Brand href="/" />
        <a href="/">Volver a la plataforma</a>
      </header>
      <WorkforceEmbedded />
    </main>
  );
}
export function PublicShift() {
  return (
    <main className="jrn-shell">
      <header className="jrn-brand">
        <Brand href="/" />
        <a href="/">Volver a la plataforma</a>
      </header>
      <h1>Mi jornada</h1>
      <section className="jrn-card">
        <h2>Control de pendientes</h2>
        <p>
          Las tareas, el horario y las marcaciones pertenecen a cada persona.
        </p>
        <a className="jrn-primary" href="/usuario/?ingresar=1">
          Entrar a mi jornada
        </a>
      </section>
    </main>
  );
}

const headings: Record<string, string> = {
  panel: "Panel gerencial",
  personas: "Usuarios y permisos",
  archivo: "Archivo de empresa",
  revision: "Revisión documental",
  auditoria: "Auditoría",
  informes: "Informes",
};
const display = (key: string) => sections[key]?.name ?? headings[key] ?? key;
export function PublicPlant({ control }: { control: boolean }) {
  const tabs = control
    ? [
        "panel",
        "personas",
        "caso",
        "proyecto",
        "expediente",
        "archivo",
        "revision",
        "auditoria",
      ]
    : [...plantKinds, "informes"];
  const [tab, setTab] = useState(tabs[0]);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<
    {
      key: string;
      kind: string;
      name: string;
      values: Record<string, string>;
    }[]
  >([]);
  const fields = sections[tab]?.fields ?? [];
  const items = rows.filter((row) => row.kind === tab);
  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(
      fields.map((f) => [f.key, String(form.get(f.key) ?? "")]),
    );
    setRows((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        kind: tab,
        name: String(form.get("publicTitle")),
        values,
      },
    ]);
    setEditing(false);
  }
  return (
    <main className="jrn-shell">
      <header className="jrn-brand">
        <Brand href="/" />
        <a href="/">Volver a la plataforma</a>
      </header>
      <h1>{control ? "Control Administrativo" : "Producción"}</h1>
      <p>Vista pública. Los registros de prueba se descartan al salir.</p>
      <nav className="jrn-tabs" aria-label="Apartados">
        {tabs.map((k) => (
          <button
            key={k}
            aria-pressed={tab === k}
            onClick={() => {
              setTab(k);
              setEditing(false);
            }}
          >
            {display(k)}
          </button>
        ))}
      </nav>
      <section className="jrn-card">
        <div className="jrn-heading">
          <h2>{display(tab)}</h2>
          {sections[tab] && (
            <button onClick={() => setEditing(!editing)}>
              {editing ? "Cancelar" : "Nuevo registro de prueba"}
            </button>
          )}
        </div>
        {tab === "personas" ? (
          <a className="button button-primary" href="/#equipo">
            Administrar usuarios y contraseñas
          </a>
        ) : tab === "panel" || tab === "informes" ? (
          <div className="jrn-grid">
            {(control
              ? ["caso", "proyecto", "expediente"]
              : ["ot", "lote", "entrega"]
            ).map((k) => (
              <div key={k} className="jrn-row">
                <strong>{display(k)}</strong>
                <p>{rows.filter((r) => r.kind === k).length}</p>
              </div>
            ))}
          </div>
        ) : (
          <p>{items.length} registros de prueba</p>
        )}
        {editing && (
          <form key={tab} onSubmit={add}>
            <label>
              Nombre del registro
              <input name="publicTitle" maxLength={160} required />
            </label>
            {fields.map((f) => (
              <label key={f.key}>
                {f.label}
                {f.choices ? (
                  <select name={f.key}>
                    {f.choices.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                ) : f.type === "textarea" ? (
                  <textarea name={f.key} />
                ) : (
                  <input name={f.key} type={f.type ?? "text"} />
                )}
              </label>
            ))}
            <button className="jrn-primary">Guardar en la prueba</button>
          </form>
        )}
        {items.map((r) => (
          <details key={r.key} className="jrn-row">
            <summary>{r.name}</summary>
            {fields
              .filter((f) => r.values[f.key])
              .map((f) => (
                <p key={f.key}>
                  <strong>{f.label}</strong> · {r.values[f.key]}
                </p>
              ))}
          </details>
        ))}
      </section>
    </main>
  );
}
