import type { Metadata } from 'next';
import { AuthScreen } from '@/components/auth-screen';

export const metadata: Metadata = { title: 'Acceso institucional · Trefil OS', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default function AccessPage() { return <AuthScreen />; }
