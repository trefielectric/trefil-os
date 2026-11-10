import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const INSTITUTIONAL_PROJECT_REF = 'kifmqoolaerepvlzrqnk';
export const INSTITUTIONAL_ORGANIZATION_SLUG = 'trefielectric';

type PublicConfiguration = { configured: true; url: string; publishableKey: string } | { configured: false; reason: string };

// These are deliberately the only environment values read by this browser
// module. A secret/service_role key is never accepted as a substitute.
export function publicSupabaseConfiguration(): PublicConfiguration {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return { configured: false, reason: 'Supabase pendiente de configurar.' };
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) return { configured: false, reason: 'La configuración de acceso necesita una clave publicable válida.' };
  try {
    const parsed = new URL(url);
    const institutional = parsed.protocol === 'https:' && parsed.hostname === `${INSTITUTIONAL_PROJECT_REF}.supabase.co`;
    const local = process.env.NODE_ENV !== 'production' && parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
    if ((!institutional && !local) || parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) {
      return { configured: false, reason: 'La dirección de Supabase no corresponde al proyecto institucional autorizado.' };
    }
    return { configured: true, url: parsed.origin, publishableKey };
  } catch {
    return { configured: false, reason: 'La dirección pública de Supabase no es válida.' };
  }
}

let browserClient: SupabaseClient | null = null;
export function getSupabaseClient(): SupabaseClient | null {
  if (typeof window === 'undefined') return null;
  const configuration = publicSupabaseConfiguration();
  if (!configuration.configured) return null;
  browserClient ??= createClient(configuration.url, configuration.publishableKey, {
    auth: {
      flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
      storageKey: 'trefil-os:institutional:auth:v1',
    },
  });
  return browserClient;
}
