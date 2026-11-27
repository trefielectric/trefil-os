"use client";

import { useContext, useEffect, useState } from "react";
import { PublicWorkspace } from "@/lib/jornada-permissions";
import { getSupabaseClient } from "@/lib/supabase/client";

type SourceContact = {
  source_document: string;
  sheet: string;
  source_row: number;
  filename: string;
  given_names: string;
  surnames: string;
  phone: string;
  document_number: string;
  address: string;
  source_status: string;
};
type SearchResult = { rows: SourceContact[]; total: number };

const PAGE_SIZE = 30;

export function SharePointCustomers() {
  const guest = useContext(PublicWorkspace);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (guest) return;
    let current = true;
    setResult(null);
    setError("");
    const timer = window.setTimeout(async () => {
      try {
        const client = getSupabaseClient();
        if (!client) throw new Error("La conexión con Trefil OS no está disponible.");
        const reply = await client.rpc("sharepoint_sales_contacts_page", {
          search_term: search.trim(), status_filter: status, start_at: offset,
        });
        if (reply.error) {
          throw new Error(reply.error.code === "42501"
            ? "Abre tu jornada con un perfil que tenga permiso para consultar Ventas."
            : "No se pudo consultar la base de clientes.");
        }
        if (current) setResult(reply.data as SearchResult);
      } catch (reason) {
        if (current) setError(reason instanceof Error ? reason.message : "Error de conexión.");
      }
    }, 180);
    return () => { current = false; window.clearTimeout(timer); };
  }, [guest, search, status, offset, retry]);

  return <section className="panel" aria-label="Clientes de SharePoint">
    <h2>Clientes de SharePoint</h2>
    {guest ? <p>El directorio de la empresa está en la sesión privada de Ventas. <a href="/usuario/?ingresar=1">Entrar a mi jornada</a></p> : <>
      <p>Directorio histórico de Trefielectric. El estado y los datos de contacto corresponden a la fecha del archivo.</p>
      <div className="plant-fields">
        <label>Buscar por nombre, documento o celular<input type="search" maxLength={180} value={search} onChange={e => { setSearch(e.target.value); setOffset(0); }}/></label>
        <label>Estado en el archivo<select value={status} onChange={e => { setStatus(e.target.value); setOffset(0); }}>
          <option value="">Todos</option><option value="ACTIVO">Activo</option><option value="INACTIVA">Inactivo</option>
        </select></label>
      </div>
      {error ? <p role="alert">{error} <button className="text-button" onClick={() => setRetry(n => n + 1)}>Volver a intentar</button></p>
        : !result ? <p role="status">Consultando clientes…</p>
        : <><p aria-live="polite">{result.total ? `Registros ${offset + 1} a ${Math.min(offset + PAGE_SIZE, result.total)} de ${result.total}.` : "Sin coincidencias."}</p>
          {result.rows.map(row => <details className="plant-item" key={JSON.stringify([row.source_document, row.sheet, row.source_row])}>
            <summary><span><strong>{[row.given_names, row.surnames].filter(Boolean).join(" ")}</strong></span><span>{row.source_status === "ACTIVO" ? "Activo" : "Inactivo"}</span></summary>
            <dl><dt>Documento</dt><dd>{row.document_number || "Sin registrar"}</dd>
              <dt>Celular</dt><dd>{row.phone || "Sin registrar"}</dd>
              <dt>Dirección</dt><dd>{row.address || "Sin registrar"}</dd>
              <dt>Origen</dt><dd>{row.filename} · {row.sheet} · Fila {row.source_row}</dd></dl>
          </details>)}
          {result.total > PAGE_SIZE && <div className="plant-actions">
            <button disabled={!offset} onClick={() => setOffset(n => Math.max(0,n - PAGE_SIZE))}>Anterior</button>
            <button disabled={offset + PAGE_SIZE >= result.total} onClick={() => setOffset(n => n + PAGE_SIZE)}>Siguiente</button>
          </div>}
        </>}
    </>}
  </section>;
}
