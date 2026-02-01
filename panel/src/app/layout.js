import "./globals.css";
import SiteHeaderClient from "./_components/SiteHeaderClient.js";
import BackBarClient from "./_components/BackBarClient.js";
import { Inter, Space_Grotesk } from "next/font/google";
import { getSession } from "../lib/session.js";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-sans" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], display: "swap", variable: "--font-display" });

export const metadata = {
  title: "Master Bot Panel",
  description: "Painel de configuração do Master Bot"
};

export default async function RootLayout({ children }) {
  const session = await getSession().catch(() => null);
  const user = session
    ? {
        id: String(session.userId ?? ""),
        name: session.userName ?? "Discord",
        avatar: session.userAvatar ?? null
      }
    : null;

  return (
    <html lang="pt-BR">
      <body className={`${inter.variable} ${spaceGrotesk.variable}`}>
        <div className="backdrop">
          <span className="orb orb-blue" />
          <span className="orb orb-amber" />
          <span className="orb orb-cyan" />
        </div>
        <div className="shell">
          <SiteHeaderClient user={user} />
          <BackBarClient />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
