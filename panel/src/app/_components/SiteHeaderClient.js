"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

function cn(...values) {
  return values.filter(Boolean).join(" ");
}

export default function SiteHeaderClient({ user }) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  const links = useMemo(
    () =>
      user
        ? [
            { href: "/dashboard", label: "Dashboard" }
          ]
        : [
            { href: "/login", label: "Login" }
          ],
    [user]
  );

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className={cn("site-header", scrolled && "site-header--scrolled")}>
      <div className="site-header__inner">
        <Link className="brand" href="/" onClick={() => setOpen(false)}>
          <span className="brand-mark">MB</span>
          <span className="brand-title">Master Bot</span>
          <span className="brand-chip">Nexus</span>
        </Link>

        <nav className={cn("site-nav", open && "site-nav--open")}>
          {links.map((l) => (
            <Link
              key={l.href}
              className={cn(
                "site-nav__link",
                pathname === l.href && "site-nav__link--active"
              )}
              href={l.href}
              onClick={() => setOpen(false)}
            >
              {l.label}
            </Link>
          ))}

          {user ? (
            <>
              <span className="user-chip" title={user.id || undefined}>
                <span className="user-chip__avatar" aria-hidden="true">
                  {user.avatar ? (
                    <Image
                      src={`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`}
                      alt=""
                      width={24}
                      height={24}
                      sizes="24px"
                    />
                  ) : (
                    (user.name || "U").slice(0, 1).toUpperCase()
                  )}
                </span>
                <span className="user-chip__name">{user.name}</span>
              </span>
              <a
                className="button button--sm button--secondary"
                href="/api/discord/invite"
                onClick={() => setOpen(false)}
              >
                Adicionar bot
              </a>
              <a
                className="button button--sm button--secondary"
                href="/api/auth/logout"
                onClick={() => setOpen(false)}
              >
                Sair
              </a>
            </>
          ) : (
            <>
              <a
                className="button button--sm"
                href="/api/auth/login"
                onClick={() => setOpen(false)}
              >
                Entrar com Discord
              </a>
              <a
                className="button button--sm button--secondary"
                href="/api/discord/invite"
                onClick={() => setOpen(false)}
              >
                Adicionar bot
              </a>
            </>
          )}
        </nav>

        <button
          type="button"
          className={cn("menu-btn", open && "menu-btn--open")}
          aria-label={open ? "Fechar menu" : "Abrir menu"}
          aria-expanded={open ? "true" : "false"}
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
        </button>
      </div>
    </header>
  );
}
