"use client";

import { useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";

function getGuildId(pathname) {
  const match = String(pathname || "").match(/^\/guild\/([^/]+)/);
  return match ? match[1] : null;
}

function computeFallback(pathname) {
  const p = String(pathname || "");
  if (p === "/dashboard") return "/";

  const guildId = getGuildId(p);
  if (guildId) {
    const home = `/guild/${guildId}`;
    return p === home ? "/dashboard" : home;
  }

  if (p.startsWith("/transcript/")) return "/dashboard";

  return "/dashboard";
}

export default function BackBarClient() {
  const pathname = usePathname();
  const router = useRouter();

  const hidden = pathname === "/" || pathname === "/login";
  const fallback = useMemo(() => computeFallback(pathname), [pathname]);

  if (hidden) return null;

  return (
    <div className="backbar" role="navigation" aria-label="Navegação">
      <div className="backbar__inner">
        <button
          type="button"
          className="button button--sm button--secondary"
          onClick={() => {
            try {
              if (typeof window !== "undefined" && window.history.length > 1) {
                router.back();
                return;
              }
            } catch {}
            router.push(fallback);
          }}
        >
          ← Voltar
        </button>
      </div>
    </div>
  );
}

