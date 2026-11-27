"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { getSupabaseClient, publicSupabaseConfiguration } from "@/lib/supabase/client";
import {
  roleLabel,
  signInWithDocument,
  workforceRpc,
  WorkforceError,
  type WorkforceDay,
} from "@/lib/workforce";
import {MyAccount,type AccountDetails} from "./my-account";
import { Field } from "./ui";
import { TeamManagement } from "./workforce-team";
import type { Perform } from "./workforce-app";

function messageFor(reason: unknown) {
  return reason instanceof WorkforceError
    ? reason.message
    : "No pudimos abrir Equipo. Revisa la conexión e inténtalo de nuevo.";
}

export function WorkforceEmbedded() {
  const configuration = publicSupabaseConfiguration();
  const [snapshot, setSnapshot] = useState<WorkforceDay | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const locked = useRef(false);
  const generation=useRef(0);
  const [account,setAccount]=useState<AccountDetails|null>(null);
  const [signingIn,setSigningIn]=useState(false);

  const load = useCallback(async (client: SupabaseClient) => {
    const version=++generation.current;
    try {
      const me=await workforceRpc<AccountDetails>(client,"workforce_my_account",{});
      if(version!==generation.current)return;
      setAccount(me);
      const next=await workforceRpc<WorkforceDay>(client,"workforce_day",{p_day:null});
      if(version!==generation.current)return;
      setSnapshot(next);setError("");
    } catch (reason) {
      if(version!==generation.current)return;
      setSnapshot(null);
      setError(reason instanceof WorkforceError && reason.message.startsWith("Abre Mi jornada")?"":messageFor(reason));
    } finally {
      if(version===generation.current)setChecking(false);
    }
  }, []);

  useEffect(() => {
    const client=getSupabaseClient();
    if(!client){setChecking(false);return;}
    let timer:ReturnType<typeof setTimeout>|undefined, identity="";
    const {data:{subscription}}=client.auth.onAuthStateChange((_event,session)=>{
      clearTimeout(timer);
      if(identity!==(session?.user.id??"")){
        ++generation.current;identity=session?.user.id??"";
        setAccount(null);setSnapshot(null);setNotice("");setError("");
      }
      if(!session){setChecking(false);return;}
      timer=setTimeout(()=>void load(client),0);
    });
    return ()=>{++generation.current;clearTimeout(timer);subscription.unsubscribe();};
  }, [load]);

  const perform: Perform = async (operation, success, shouldRefresh = true) => {
    const client = getSupabaseClient();
    if (!client || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation(client);
      if (success) setNotice(success);
      if (shouldRefresh) await load(client);
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    void perform(async (client) => {
      await signInWithDocument(
        client,
        String(fields.get("document") ?? ""),
        String(fields.get("password") ?? ""),
      );
      form.reset();
    }, undefined, false);
  }

  if (!configuration.configured) {
    return <section className="workforce-embedded-state error"><ShieldCheck size={22} /><div><h2>Equipo no está disponible</h2><p>{configuration.reason}</p></div></section>;
  }

  if (checking) {
    return <section className="workforce-embedded-state"><span className="workforce-spinner"><LoaderCircle size={24} /></span><div><h2>Abriendo Equipo</h2><p>Usando tu sesión actual de Trefil OS.</p></div></section>;
  }

  if (!account) {
    return (
      <section className="workforce-embedded-login">
        <div>
          <p className="workforce-eyebrow">EQUIPO</p>
          <h2>Usuarios y contraseñas</h2>
          <p>Desde tu cuenta puedes gestionar el equipo según tus permisos y cambiar tu contraseña.</p>
          {!signingIn&&<button className="button button-primary" onClick={()=>setSigningIn(true)}>Entrar a mi cuenta</button>}
        </div>
        {signingIn&&<form onSubmit={submit}>
          <Field label="Número de cédula o correo"><input name="document" autoComplete="username" required /></Field>
          <Field label="Contraseña"><input name="password" type="password" autoComplete="current-password" required /></Field>
          <button className="button button-primary" disabled={busy}><KeyRound size={16} /> Iniciar sesión</button>
        </form>}
        {error && <p className="workforce-feedback error" role="alert">{error}</p>}
      </section>
    );
  }

  return (
    <div className="workforce-embedded">
      {notice && <p className="workforce-feedback" role="status">{notice}</p>}
      {error && <p className="workforce-feedback error" role="alert">{error}</p>}
      <MyAccount account={account} role={roleLabel(snapshot?.roles??[],account.role)}/>
      {snapshot?.can_manage&&<TeamManagement snapshot={snapshot} busy={busy} perform={perform}/>}
      <a className="button button-secondary" href="/usuario/?ingresar=1">Abrir mi jornada</a>
    </div>
  );
}
