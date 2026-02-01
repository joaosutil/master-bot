import "./globals.css";
import SiteHeaderClient from "./_components/SiteHeaderClient.js";
import BackBarClient from "./_components/BackBarClient.js";
import { getSession } from "../lib/session.js";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Master Bot Panel",
  description: "Painel de configuraÃ§Ã£o do Master Bot"
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
      <body>
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

