"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function cn(...values) {
  return values.filter(Boolean).join(" ");
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(Boolean(mq.matches));
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

export default function HomeClient() {
  const reducedMotion = useReducedMotion();
  const rootRef = useRef(null);

  const featureRows = useMemo(
    () => [
      {
        title: "Tickets que parecem produto premium",
        desc: "Categorias com formulário, mensagem fixada, botões de assumir/transferir e transcript automático no seu painel.",
        icon: "🎫"
      },
      {
        title: "Economia em nível mercado",
        desc: "Valores em milhares e milhões, pagamentos claros, ranking bonito e uma base pronta para evoluir (loja, trade, leilão).",
        icon: "💸"
      },
      {
        title: "Cards & packs com vibe FIFA",
        desc: "Aberturas animadas, raridades balanceadas, artes de pack e imagens com legibilidade máxima.",
        icon: "🃏"
      }
    ],
    []
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const setVars = (x, y) => {
      root.style.setProperty("--mx", `${x}px`);
      root.style.setProperty("--my", `${y}px`);
    };

    const onMove = (e) => {
      if (reducedMotion) return;
      const rect = root.getBoundingClientRect();
      setVars(e.clientX - rect.left, e.clientY - rect.top);
    };

    root.addEventListener("mousemove", onMove, { passive: true });
    return () => root.removeEventListener("mousemove", onMove);
  }, [reducedMotion]);

  useEffect(() => {
    if (reducedMotion) return;
    const els = document.querySelectorAll("[data-reveal]");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [reducedMotion]);

  return (
    <div ref={rootRef} className="home">
      <section className="hero2">
        <div className="hero2__content" data-reveal>
          <div className="kicker">
            <span className="kicker__dot" />
            Painel Master Bot • Nexus
          </div>
          <h1 className="hero2__title">
            Um painel <span className="gradient-text">épico</span> para um bot
            <span className="gradient-text"> épico</span>.
          </h1>
          <p className="hero2__desc">
            Design dark premium com animações suaves, performance e uma experiência
            imersiva — do ticket ao transcript, do pack à economia.
          </p>

          <div className="hero2__cta">
            <a className="button button--lg" href="/api/auth/login">
              Entrar com Discord
            </a>
            <a className="button button--lg button--secondary" href="/api/discord/invite">
              Adicionar bot
            </a>
            <a className="button button--lg button--secondary" href="/dashboard">
              Ir para dashboard
            </a>
          </div>

          <div className="hero2__stats">
            <div className="stat2">
              <div className="stat2__n">Tickets</div>
              <div className="stat2__l">Formulários + pins + transcript</div>
            </div>
            <div className="stat2">
              <div className="stat2__n">Packs</div>
              <div className="stat2__l">Animações + raridades balanceadas</div>
            </div>
            <div className="stat2">
              <div className="stat2__n">Economia</div>
              <div className="stat2__l">Milhares e milhões, UI limpa</div>
            </div>
          </div>

          <div className="scroll-cue" aria-hidden="true">
            <span className="scroll-cue__text">Role para ver mais</span>
            <span className="scroll-cue__dot" />
          </div>
        </div>

        <div className="hero2__visual" data-reveal>
          <div className="glow-card">
            <div className="glow-card__top">
              <span className="pill">Live Preview</span>
              <span className="pill pill--alt">Transcripts</span>
            </div>
            <div className="glow-card__screen">
              <div className="mock-line w-60" />
              <div className="mock-line w-80" />
              <div className="mock-line w-70" />
              <div className="mock-box" />
              <div className="mock-chat">
                <div className="mock-msg">
                  <span className="mention mention-user">@Master</span> abriu um ticket.
                </div>
                <div className="mock-msg">
                  Pedido: <code>trocar pack</code> e ajustar economia.
                </div>
                <div className="mock-msg">
                  Staff: <span className="mention mention-role">@Suporte</span> assumiu.
                </div>
              </div>
            </div>
            <div className="glow-card__bottom">
              <span className="mini">Apple-like smooth</span>
              <span className="mini">Dark • Glass • Neon</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section" aria-label="Destaques">
        <div className="section__head" data-reveal>
          <h2>O que faz o Master Bot parecer de outra liga</h2>
          <p className="helper">
            Tudo foi desenhado para parecer produto de empresa grande: tipografia,
            espaçamento, motion, contrastes e “polish”.
          </p>
        </div>

        <div className="feature-grid">
          {featureRows.map((f) => (
            <div key={f.title} className="feature" data-reveal>
              <div className="feature__icon">{f.icon}</div>
              <div>
                <div className="feature__title">{f.title}</div>
                <div className="feature__desc">{f.desc}</div>
              </div>
              <div className="feature__shine" />
            </div>
          ))}
        </div>
      </section>

      <section className={cn("section", "cta-strip")} aria-label="Chamada final" data-reveal>
        <div className="cta-strip__inner">
          <div>
            <h2>Pronto para deixar o servidor no nível máximo?</h2>
            <p className="helper">
              Conecte com Discord e configure tickets, boas-vindas, moderação e
              muito mais.
            </p>
          </div>
          <div className="cta-strip__actions">
            <a className="button button--lg" href="/api/auth/login">
              Conectar agora
            </a>
            <a className="button button--lg button--secondary" href="/api/discord/invite">
              Adicionar bot
            </a>
            <a className="button button--lg button--secondary" href="/login">
              Ver login
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
