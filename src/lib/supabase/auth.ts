import type { SupabaseClient } from '@supabase/supabase-js';
import { INSTITUTIONAL_ORGANIZATION_SLUG } from './client';

export const INSTITUTIONAL_ROLES = ['owner', 'admin', 'treasury', 'accounting', 'inventory', 'production', 'sales', 'hr', 'employee', 'auditor'] as const;
export type InstitutionalRole = typeof INSTITUTIONAL_ROLES[number];
export interface FactorChoice { id: string; name: string }
export interface InstitutionalMembership {
  organizationId: string; organizationName: string; role: InstitutionalRole;
  allLocations: boolean; locations: { id: string; name: string }[];
}
export interface AuthContext {
  userId: string; email: string; displayName: string | null; assurance: 'aal1' | 'aal2';
  factors: FactorChoice[]; memberships: InstitutionalMembership[];
  readiness: 'mfa_required' | 'profile_missing' | 'profile_inactive' | 'membership_missing' | 'membership_unavailable' | 'ready';
}
export interface Enrollment { factorId: string; qrCode: string }

export class AuthFlowError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'AuthFlowError'; }
}

// Provider errors are translated, not logged or interpolated into the page.
// This avoids accidentally surfacing tokens, connection details or raw replies.
function failure(error: unknown): AuthFlowError {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'auth_unavailable';
  const messages: Record<string, string> = {
    invalid_credentials: 'El correo o la contraseña no son correctos.',
    email_not_confirmed: 'Confirma tu correo antes de iniciar sesión.',
    user_banned: 'Esta identidad está deshabilitada. Contacta al administrador autorizado.',
    over_request_rate_limit: 'Se hicieron demasiados intentos. Espera unos minutos y vuelve a intentarlo.',
    over_email_send_rate_limit: 'Espera unos minutos antes de solicitar otro correo.',
    mfa_verification_failed: 'El código no es válido. Usa el código actual de tu autenticador.',
    mfa_challenge_expired: 'El desafío venció. Introduce un código nuevo.',
    mfa_factor_not_found: 'Ese factor ya no está disponible. Actualiza la sesión.',
    mfa_totp_enroll_not_enabled: 'El administrador debe habilitar TOTP en Supabase antes de configurar el doble factor.',
    weak_password: 'La contraseña no cumple la política de seguridad de la organización.',
    same_password: 'La nueva contraseña debe ser distinta de la anterior.',
    session_expired: 'La sesión venció. Vuelve a iniciar sesión.',
    session_not_found: 'La sesión ya no está disponible. Vuelve a iniciar sesión.',
    reauthentication_needed: 'Se requiere verificar de nuevo la identidad antes de cambiar la contraseña.',
    reauthentication_not_valid: 'No fue posible verificar de nuevo la identidad. Solicita otro enlace de recuperación.',
  };
  return new AuthFlowError(code, messages[code] ?? 'No fue posible completar la autenticación. Revisa tu conexión e inténtalo de nuevo.');
}
export function authErrorMessage(error: unknown): string {
  return error instanceof AuthFlowError ? error.message : 'No fue posible completar la operación. Inténtalo de nuevo.';
}

export async function signIn(client: SupabaseClient, email: string, password: string): Promise<void> {
  const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw failure(error);
}
export async function signOut(client: SupabaseClient): Promise<void> {
  const { error } = await client.auth.signOut({ scope: 'local' });
  if (error) throw failure(error);
}
export async function requestRecovery(client: SupabaseClient, email: string): Promise<void> {
  if (typeof window === 'undefined') throw new AuthFlowError('browser_required', 'Abre la recuperación en el navegador.');
  // Build the redirect locally; never accept a user-supplied return URL.
  const redirectTo = new URL('/acceso/?recuperacion=1', window.location.origin).href;
  const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo });
  if (error) throw failure(error);
}
export async function updateRecoveredPassword(client: SupabaseClient, password: string): Promise<void> {
  if (password.length < 12) throw new AuthFlowError('password_too_short', 'Usa una contraseña de al menos 12 caracteres.');
  const { data: { user }, error: identityError } = await client.auth.getUser();
  if (identityError || !user) throw failure(identityError);
  const { error } = await client.auth.updateUser({ password });
  if (error) throw failure(error);
}
export async function beginTotpEnrollment(client: SupabaseClient): Promise<Enrollment> {
  const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Trefil OS · ${new Date().toISOString().slice(0, 10)}`, issuer: 'Trefil Electric' });
  if (error || !data) throw failure(error);
  if (!data.totp.qr_code.startsWith('data:image/svg+xml;utf-8,')) throw new AuthFlowError('invalid_qr', 'No fue posible preparar el QR de configuración.');
  // Never retain the secret/URI, copy them to storage or send them to telemetry.
  return { factorId: data.id, qrCode: data.totp.qr_code };
}
export async function verifyTotp(client: SupabaseClient, factorId: string, code: string): Promise<void> {
  if (!/^\d{6}$/.test(code)) throw new AuthFlowError('invalid_totp', 'Introduce los seis dígitos de tu autenticador.');
  const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) throw failure(error);
}
export async function cancelPendingEnrollment(client: SupabaseClient, factorId: string): Promise<void> {
  const { data, error: listError } = await client.auth.mfa.listFactors();
  if (listError) throw failure(listError);
  // Never remove a verified factor in this flow, even if a stale UI asks to.
  const pending = data?.all.find(factor => factor.id === factorId && factor.status === 'unverified');
  if (!pending) return;
  const { error } = await client.auth.mfa.unenroll({ factorId });
  if (error) throw failure(error);
}

export async function readAuthContext(client: SupabaseClient): Promise<AuthContext | null> {
  // Validate identity with Auth. getSession or user_metadata are not permission
  // sources. Memberships below are read from authoritative RLS-protected rows.
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (!user) {
    if (!userError || userError.name === 'AuthSessionMissingError' || userError.code === 'session_not_found') return null;
    throw failure(userError);
  }
  if (userError) throw failure(userError);
  const [{ data: assurance, error: assuranceError }, { data: factors, error: factorsError }] = await Promise.all([
    client.auth.mfa.getAuthenticatorAssuranceLevel(), client.auth.mfa.listFactors(),
  ]);
  if (assuranceError || factorsError || !assurance) throw failure(assuranceError ?? factorsError);
  const context: AuthContext = {
    userId: user.id, email: user.email ?? '', displayName: null,
    assurance: assurance.currentLevel === 'aal2' ? 'aal2' : 'aal1',
    factors: (factors?.totp ?? []).filter(factor => factor.status === 'verified').map((factor, index) => ({ id: factor.id, name: factor.friendly_name || `Autenticador ${index + 1}` })),
    memberships: [], readiness: 'mfa_required',
  };
  // AAL2 is mandatory for this institutional finance entrypoint, even when the
  // account has not enrolled a factor yet. Database policies must enforce it too.
  if (context.assurance !== 'aal2') return context;
  const [{ data: profile, error: profileError }, { data: members, error: membersError }] = await Promise.all([
    client.from('profiles').select('display_name,active').eq('id', user.id).maybeSingle(),
    client.from('organization_members').select('organization_id,role_code,active,all_locations,location_ids').eq('user_id', user.id).eq('active', true),
  ]);
  if (profileError || membersError) return { ...context, readiness: 'membership_unavailable' };
  if (!profile) return { ...context, readiness: 'profile_missing' };
  context.displayName = typeof profile.display_name === 'string' ? profile.display_name : null;
  if (!profile.active) return { ...context, readiness: 'profile_inactive' };
  const activeMembers = (members ?? []).filter(member => INSTITUTIONAL_ROLES.includes(member.role_code as InstitutionalRole));
  if (!activeMembers.length) return { ...context, readiness: 'membership_missing' };
  const orgIds = activeMembers.map(member => String(member.organization_id));
  const { data: organizations, error: organizationError } = await client.from('organizations').select('id,name,slug').eq('slug', INSTITUTIONAL_ORGANIZATION_SLUG).in('id', orgIds);
  if (organizationError) return { ...context, readiness: 'membership_unavailable' };
  const allowedOrgs = organizations ?? [];
  if (!allowedOrgs.length) return { ...context, readiness: 'membership_missing' };
  const { data: locations, error: locationsError } = await client.from('locations').select('id,name,organization_id').in('organization_id', allowedOrgs.map(org => org.id)).eq('active', true);
  if (locationsError) return { ...context, readiness: 'membership_unavailable' };
  context.memberships = allowedOrgs.flatMap(org => {
    const member = activeMembers.find(item => item.organization_id === org.id);
    if (!member) return [];
    const locationIds = Array.isArray(member.location_ids) ? member.location_ids : [];
    return [{ organizationId: String(org.id), organizationName: String(org.name), role: member.role_code as InstitutionalRole, allLocations: member.all_locations === true,
      locations: (locations ?? []).filter(location => location.organization_id === org.id && (member.all_locations === true || locationIds.includes(location.id))).map(location => ({ id: String(location.id), name: String(location.name) })) }];
  });
  context.readiness = context.memberships.some(member => member.locations.length > 0) ? 'ready' : 'membership_missing';
  return context;
}
