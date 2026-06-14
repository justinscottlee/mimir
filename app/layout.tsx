import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0d0f11",
};

export const metadata: Metadata = {
  title: "Mimir",
  description: "Self-hosted AI workbench",
  icons: {
    icon: "/mimir-brand-logo.svg",
  },
  openGraph: {
    title: 'Mimir',
    description: 'A privacy-first platform for self-managed large language models.',
    url: 'https://mimir.justinlee.org',
    siteName: 'Mimir',
    images: [
      {
        url: 'https://mimir.justinlee.org/mimir-brand.png',
        width: 937,
        height: 355,
        alt: 'Mimir branding',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
