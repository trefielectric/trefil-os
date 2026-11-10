import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Trefil OS · Control financiero',
  description: 'El centro de operaciones de Trefil Electric. Tesorería, obligaciones y control financiero.',
  robots: { index: false, follow: false },
  manifest: '/manifest.webmanifest',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#202b29' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="es-CO"><body>{children}</body></html>;
}
