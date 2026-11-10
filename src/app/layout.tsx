import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Trefil OS · Control financiero',
  description: 'El centro de operaciones de Trefil Electric. Tesorería, obligaciones y control financiero.',
  robots: { index: false, follow: false },
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/brand/trefielectric-logo.jpg', type: 'image/jpeg', sizes: '628x631' }],
    shortcut: '/brand/trefielectric-logo.jpg',
  },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#1d3d6a' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="es-CO"><body>{children}</body></html>;
}
