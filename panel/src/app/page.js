import { redirect } from "next/navigation";
import { getSession } from "../lib/session.js";
import HomeClient from "./_components/HomeClient.js";
import SiteFooter from "./_components/SiteFooter.js";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="page page-home">
      <HomeClient />
      <SiteFooter />
    </div>
  );
}
