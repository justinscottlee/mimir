import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mimir",
  description: "Self-hosted AI workbench",
  icons: {
    icon: "/mimir-brand-logo.svg",
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
