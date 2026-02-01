import { redirect } from "next/navigation";
import { getSession } from "../../lib/session.js";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getSession();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="card hero">
      <div>
        <h1>Conectar Discord</h1>
        <p className="helper">
          Entre com sua conta para gerenciar tickets, eventos e modulos do Master Bot.
        </p>
        <div className="hero-actions">
          <a className="button" href="/api/auth/login">
            Entrar com Discord
          </a>
          <a className="button button--secondary" href="/api/discord/invite">
            Adicionar bot
          </a>
        </div>
      </div>
      <div className="badge">OAuth2 Seguro</div>
    </div>
  );
}
