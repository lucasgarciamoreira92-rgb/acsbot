import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ACS Pilot — Central de implantação",
  description: "Modelos, credenciais e implantação de ACS em roteadores e ONUs. Protótipo demonstrativo.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
