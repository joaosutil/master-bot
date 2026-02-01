export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__left">
          <div className="footer-brand">
            <span className="brand-mark">MB</span>
            <div>
              <div className="brand-title">Master Bot</div>
              <div className="brand-sub">
                Tickets, economia, cards/packs e moderação — com visual premium.
              </div>
            </div>
          </div>
          <div className="footer-mini">
            <span className="badge">Dark • Glass • Neon</span>
            <span className="badge">Transcripts imersivos</span>
            <span className="badge">UI FIFA-like</span>
          </div>
        </div>

        <div className="site-footer__right">
          <div className="footer-links">
            <a href="/">Home</a>
            <a href="/dashboard">Dashboard</a>
            <a href="/login">Login</a>
          </div>
          <div className="footer-legal">
            <span>© {new Date().getFullYear()} Master Bot</span>
            <span className="dot" />
            <a href="/api/auth/logout">Sair</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

