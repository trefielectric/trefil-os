"use client";

import { useState, type FormEvent } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { Field } from "./ui";

export interface AccountDetails {
  name: string;
  contact: string | null;
  last_four: string | null;
  role: string;
  creator: boolean;
  preview_enabled: boolean;
}
export function MyAccount({
  account,
  role,
}: {
  account: AccountDetails;
  role: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [publicAccess, setPublicAccess] = useState(account.preview_enabled);
  async function changePublicAccess() {
    const client = getSupabaseClient();
    if (!client || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { data, error } = await client.rpc("workforce_set_preview", {
        p_enabled: !publicAccess,
      });
      if (error || typeof data !== "boolean") throw new Error();
      setPublicAccess(data);
      setNotice(data ? "Vista pública abierta." : "Vista pública cerrada.");
      window.dispatchEvent(new Event("jornada-updated"));
      try {
        localStorage.setItem("trefil:jornada:changed", crypto.randomUUID());
      } catch {}
    } catch {
      setError("No se pudo cambiar el acceso público.");
    } finally {
      setBusy(false);
    }
  }
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget,
      fields = new FormData(form);
    const password = String(fields.get("new") ?? "");
    setError("");
    setNotice("");
    if (password !== fields.get("confirm")) {
      setError("Las dos claves nuevas deben coincidir.");
      return;
    }
    const client = getSupabaseClient();
    if (!client) return;
    setBusy(true);
    try {
      const { error: failure } = await client.auth.updateUser({
        password,
        current_password: String(fields.get("current") ?? ""),
      });
      if (failure) {
        setError(
          "Revisa la contraseña actual y usa una clave nueva de al menos seis caracteres.",
        );
        return;
      }
      form.reset();
      setNotice("Contraseña actualizada. Úsala la próxima vez que ingreses.");
    } catch {
      setError("No se pudo guardar la contraseña. Revisa tu conexión.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="jrn-card" aria-label="Mi cuenta">
      <div className="jrn-heading">
        <div>
          <h2>Mi cuenta</h2>
          <strong>{account.name}</strong>
          <p>
            {role}
            {account.creator ? " · Creador de la plataforma" : ""}
          </p>
        </div>
        <button
          className="button button-secondary"
          onClick={() => getSupabaseClient()?.auth.signOut({ scope: "local" })}
        >
          Cerrar sesión
        </button>
      </div>
      <p>
        <strong>Usuario de ingreso</strong> · {account.contact ?? "Cédula"}
        {account.last_four && " · Cédula terminada en " + account.last_four}
      </p>
      {account.creator && account.role === "admin" && (
        <div className="jrn-row">
          <strong>Vista pública de prueba</strong>
          <p>
            {publicAccess
              ? "Cualquier persona con el enlace puede probar la plataforma con datos temporales."
              : "Las visitas requieren iniciar sesión."}
          </p>
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={changePublicAccess}
          >
            {publicAccess ? "Cerrar vista pública" : "Abrir vista pública"}
          </button>
        </div>
      )}
      <details>
        <summary>Cambiar mi contraseña</summary>
        <form className="workforce-auth-form" onSubmit={changePassword}>
          <Field label="Contraseña actual">
            <input
              name="current"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <Field label="Nueva contraseña">
            <input
              name="new"
              type="password"
              autoComplete="new-password"
              minLength={6}
              maxLength={256}
              required
            />
          </Field>
          <Field label="Confirmar nueva contraseña">
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={6}
              maxLength={256}
              required
            />
          </Field>
          <button className="button button-primary" disabled={busy}>
            Guardar mi contraseña
          </button>
        </form>
      </details>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
