'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Building2, Check, KeyRound, LockKeyhole, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { getSupabaseClient, publicSupabaseConfiguration } from '@/lib/supabase/client';
import {
  authErrorMessage, beginTotpEnrollment, cancelPendingEnrollment, readAuthContext, requestRecovery,
  signIn, signOut, updateRecoveredPassword, verifyTotp, type AuthContext, type Enrollment,
} from '@/lib/supabase/auth';
import { Badge, Field } from './ui';
import { roleLabels } from './view-helpers';
import { Brand } from './brand';

type Mode = 'loading' | 'signin' | 'request_recovery' | 'recovery_password' | 'mfa_verify' | 'mfa_enroll' | 'identity';
const readinessText: Record<AuthContext['readiness'], string> = {
  mfa_required: 'Completa la verificación de doble factor para comprobar tu membresía institucional.',
  profile_missing: 'La identidad existe, pero falta crear su perfil institucional mediante el proceso de alta autorizado.',
  profile_inactive: 'El perfil institucional está inactivo. Un administrador autorizado debe revisar el acceso.',
  membership_missing: 'Esta identidad no tiene una membresía activa y una sede autorizada en Trefil Electric.',
  membership_unavailable: 'Tu identidad y doble factor fueron validados; todavía no fue posible comprobar las tablas de perfiles, membresías y sedes.',
  ready: 'Identidad, doble factor y membresía institucional comprobados.',
};

export function AuthScreen() {
  const configuration = publicSupabaseConfiguration();
  const [mode, setMode] = useState<Mode>('loading');
  const [identity, setIdentity] = useState<AuthContext | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [factorId, setFactorId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const recovery = useRef(false);
  const requestVersion = useRef(0);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshIdentity = useCallback(async () => {
    const client = getSupabaseClient(); if (!client) { setMode('signin'); return; }
    const version = ++requestVersion.current;
    try {
      const current = await readAuthContext(client);
      if (!mounted.current || version !== requestVersion.current) return;
      setIdentity(current);
      if (!current) { recovery.current = false; setEnrollment(null); setMode('signin'); return; }
      if (recovery.current && (current.assurance === 'aal2' || current.factors.length === 0)) { setMode('recovery_password'); return; }
      if (current.assurance !== 'aal2') {
        setFactorId(previous => current.factors.some(factor => factor.id === previous) ? previous : current.factors[0]?.id ?? '');
        setMode(current.factors.length ? 'mfa_verify' : 'mfa_enroll'); return;
      }
      setEnrollment(null); setMode('identity');
    } catch (reason) {
      if (!mounted.current || version !== requestVersion.current) return;
      // A failed revalidation must never leave a previous "ready" identity on
      // screen. The provider session can be retried, but readiness is revoked.
      setIdentity(null); setEnrollment(null); setError(authErrorMessage(reason)); setMode('signin');
    }
  }, []);
  const refreshRef = useRef(refreshIdentity); refreshRef.current = refreshIdentity;

  useEffect(() => {
    mounted.current = true;
    const client = getSupabaseClient();
    if (!client) { setMode('signin'); return; }
    // Keep the auth callback synchronous. Query Supabase on a later task after
    // its auth lock is released; never log the event's session argument.
    const { data: { subscription } } = client.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') { recovery.current = true; setError(''); setNotice('Enlace de recuperación verificado.'); }
      if (event === 'SIGNED_OUT') { requestVersion.current++; recovery.current = false; setEnrollment(null); setIdentity(null); setMode('signin'); }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { void refreshRef.current(); }, 0);
    });
    void refreshRef.current();
    return () => { mounted.current = false; requestVersion.current++; subscription.unsubscribe(); if (timer.current) clearTimeout(timer.current); };
  }, []);

  async function perform(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (reason) { if (mounted.current) setError(authErrorMessage(reason)); }
    finally { if (mounted.current) setBusy(false); }
  }
  const clientOrThrow = () => { const client = getSupabaseClient(); if (!client) throw new Error('unconfigured'); return client; };
  function submitSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const fields = new FormData(form);
    void perform(async () => {
      try { await signIn(clientOrThrow(), String(fields.get('email') ?? ''), String(fields.get('password') ?? '')); await refreshRef.current(); }
      finally { const password = form.elements.namedItem('password'); if (password instanceof HTMLInputElement) password.value = ''; }
    });
  }
  function submitRecoveryRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const fields = new FormData(form);
    void perform(async () => {
      await requestRecovery(clientOrThrow(), String(fields.get('email') ?? ''));
      setNotice('Si la cuenta puede recuperarse, recibirás un enlace por correo. Ábrelo en este mismo navegador para continuar.'); form.reset();
    });
  }
  function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const fields = new FormData(form);
    const password = String(fields.get('password') ?? ''); const confirmation = String(fields.get('confirmation') ?? '');
    if (password !== confirmation) { setError('Las contraseñas no coinciden.'); return; }
    void perform(async () => {
      try {
        await updateRecoveredPassword(clientOrThrow(), password); recovery.current = false;
        setNotice('Contraseña actualizada. Completa el doble factor si está pendiente.'); await refreshRef.current();
      } finally { form.reset(); }
    });
  }
  function submitFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const code = String(new FormData(form).get('code') ?? '');
    const selected = enrollment?.factorId ?? factorId;
    void perform(async () => { try { await verifyTotp(clientOrThrow(), selected, code); setEnrollment(null); await refreshRef.current(); } finally { form.reset(); } });
  }
  function closeSession() {
    void perform(async () => {
      const client = clientOrThrow();
      if (enrollment) await cancelPendingEnrollment(client, enrollment.factorId);
      await signOut(client); recovery.current = false; setEnrollment(null); setIdentity(null); setMode('signin'); setNotice('Sesión institucional cerrada en este navegador.');
    });
  }

  return <div className="login-page auth-screen">
    <aside className="login-art"><Brand href="/"/><div><span className="eyebrow">TREFIL ELECTRIC</span><h1>Tu identidad.<br />Tu responsabilidad.</h1><p>Acceso institucional con doble factor.<br />Permisos por empresa y sede.</p></div><small>America/Bogota · COP · Uso empresarial autorizado</small></aside>
    <main className="login-card" aria-busy={busy}>
      <Badge tone={configuration.configured ? 'blue' : 'orange'}>{configuration.configured ? 'Acceso institucional' : 'Conexión pendiente'}</Badge>
      {!configuration.configured && <div className="inline-note note-warning"><LockKeyhole size={20} /><p><strong>Supabase pendiente de configurar</strong><br />{configuration.reason === 'Supabase pendiente de configurar.' ? 'El inicio de sesión se habilitará cuando se configure y verifique el proyecto institucional.' : configuration.reason} El espacio local se guarda únicamente en este navegador.</p></div>}
      {mode === 'loading' && <><h2>Comprobando la sesión…</h2><p>Validando identidad y nivel de autenticación.</p></>}
      {mode === 'signin' && <><h2>Accede a Trefil OS.</h2><p>Usa tu usuario personal autorizado. La cuenta institucional administra el entorno.</p><form onSubmit={submitSignIn}>
        <Field label="Correo electrónico"><input name="email" type="email" required autoComplete="username" disabled={!configuration.configured || busy} placeholder="tu.correo@empresa.com" /></Field>
        <Field label="Contraseña"><input name="password" type="password" required autoComplete="current-password" disabled={!configuration.configured || busy} /></Field>
        <button className="button button-primary" type="submit" disabled={!configuration.configured || busy}>{busy ? 'Verificando…' : 'Iniciar sesión'}<ArrowRight size={17} /></button>
      </form><button className="text-button" disabled={!configuration.configured || busy} onClick={() => { setMode('request_recovery'); setError(''); setNotice(''); }}>Recuperar mi cuenta</button><small>Las cuentas y los permisos se crean mediante un alta autorizada. No hay registro público.</small></>}
      {mode === 'request_recovery' && <><h2>Recupera el acceso.</h2><p>Recibirás un enlace seguro. No compartas ese enlace, contraseñas ni códigos.</p><form onSubmit={submitRecoveryRequest}><Field label="Correo de la cuenta"><input name="email" type="email" required autoComplete="email" disabled={busy} /></Field><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Solicitando…' : 'Enviar enlace de recuperación'}</button></form><button className="text-button" disabled={busy} onClick={() => { setMode('signin'); setError(''); setNotice(''); }}><ArrowLeft size={16} /> Volver al inicio de sesión</button></>}
      {mode === 'recovery_password' && <><h2>Define una nueva contraseña.</h2><p>El enlace ya fue validado por Supabase. Usa una contraseña distinta y guárdala en tu administrador.</p><form onSubmit={submitPassword}><Field label="Nueva contraseña" hint="Mínimo 12 caracteres; se aplica además la política del proveedor."><input name="password" type="password" required minLength={12} autoComplete="new-password" disabled={busy} /></Field><Field label="Repetir nueva contraseña"><input name="confirmation" type="password" required minLength={12} autoComplete="new-password" disabled={busy} /></Field><button className="button button-primary" type="submit" disabled={busy}><KeyRound size={17} />{busy ? 'Actualizando…' : 'Actualizar contraseña'}</button></form></>}
      {mode === 'mfa_verify' && identity && <><h2>Verifica tu identidad.</h2><p>Introduce directamente aquí el código de tu autenticador para {identity.email}. No lo envíes por chat.</p><form onSubmit={submitFactor}>{identity.factors.length > 1 && <Field label="Autenticador"><select value={factorId} onChange={event => setFactorId(event.target.value)} disabled={busy}>{identity.factors.map(factor => <option key={factor.id} value={factor.id}>{factor.name}</option>)}</select></Field>}<TotpField disabled={busy} /><button className="button button-primary" type="submit" disabled={busy || !factorId}><ShieldCheck size={17} />{busy ? 'Verificando…' : 'Verificar doble factor'}</button></form><small>Si perdiste el autenticador, contacta al administrador autorizado. Esta pantalla no elimina factores ni omite la verificación.</small></>}
      {mode === 'mfa_enroll' && identity && <><h2>Activa el doble factor.</h2><p>El acceso institucional requiere una segunda verificación antes de consultar permisos y operaciones.</p>{!enrollment ? <button className="button button-primary" disabled={busy} onClick={() => void perform(async () => { setEnrollment(await beginTotpEnrollment(clientOrThrow())); })}><ShieldCheck size={17} />{busy ? 'Preparando…' : 'Configurar autenticador'}</button> : <><div className="auth-qr"><img src={enrollment.qrCode} width={200} height={200} alt="QR privado para configurar Trefil OS en tu aplicación de autenticación" /></div><p>Escanea este QR con tu autenticador y escribe el código actual. El QR es privado: no lo captures ni compartas.</p><form onSubmit={submitFactor}><TotpField disabled={busy} /><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Verificando…' : 'Confirmar y activar doble factor'}</button></form><button className="text-button" disabled={busy} onClick={() => void perform(async () => { await cancelPendingEnrollment(clientOrThrow(), enrollment.factorId); setEnrollment(null); })}>Cancelar esta configuración</button></>}</>}
      {mode === 'identity' && identity && <><h2>{identity.readiness === 'ready' ? 'Identidad verificada.' : 'Acceso en validación.'}</h2><p>{identity.email}</p><div className="inline-note"><ShieldCheck size={20} /><span>Doble factor comprobado · nivel {identity.assurance.toUpperCase()}</span></div><p>{readinessText[identity.readiness]}</p>{identity.memberships.map(membership => <section className="auth-membership" key={membership.organizationId}><div className="panel-header compact"><strong><Building2 size={17} /> {membership.organizationName}</strong><Badge tone="green">{roleLabels[membership.role]}</Badge></div><p><Check size={15} /> {membership.locations.map(location => location.name).join(' · ') || 'Sin sedes autorizadas'}</p><small>Permisos consultados en la base de datos institucional.</small></section>)}<div className="inline-note note-warning"><LockKeyhole size={19} /><span><strong>La operación financiera institucional aún está en validación.</strong><br />Esta pantalla no registra dinero ni carga los datos del espacio local.</span></div><button className="button button-secondary" disabled={busy} onClick={() => void perform(refreshRef.current)}><RefreshCw size={16} /> Volver a comprobar acceso</button></>}
      {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="inline-note" role="status">{notice}</p>}
      {identity && <button className="text-button" disabled={busy} onClick={closeSession}><LogOut size={16} /> Cerrar esta sesión institucional</button>}
      <div className="auth-demo-link"><Link href="/"><ArrowLeft size={15} /> Volver al espacio local</Link></div>
    </main>
  </div>;
}

function TotpField({ disabled }: { disabled: boolean }) {
  return <Field label="Código de seis dígitos" hint="Escríbelo únicamente en este formulario."><input name="code" type="text" required inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="one-time-code" disabled={disabled} /></Field>;
}
