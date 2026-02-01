# Master Bot Panel

Painel web para configurar o bot (tickets, categorias e painel público).

## Requisitos
- Node.js 18+
- MongoDB

## Setup
1. Copie `.env.example` para `.env`
2. Preencha `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `SESSION_SECRET`, `MONGO_URI`
3. `npm install`
4. `npm run dev`

## Deploy (Vercel)
- Configure o “Root Directory” como `panel`
- Env vars:
  - `BASE_URL=https://SEU-DOMINIO`
  - `DISCORD_REDIRECT_URI=https://SEU-DOMINIO/api/auth/callback`
- No Discord Developer Portal, adicione o mesmo `DISCORD_REDIRECT_URI` em OAuth2 Redirects

## Troubleshooting
- Se aparecer erro tipo `Cannot find module './682.js'` dentro de `panel/.next`, rode `npm run clean` e reinicie o dev server.
- Se quiser iniciar sem limpar `.next` (mais rápido), use `npm run dev:fast`.
- Build: por padrão `npm run build` limpa `.next`. Se quiser build sem limpar (mais rápido), use `npm run build:fast`.

## URLs
- http://localhost:3000/login
- http://localhost:3000/dashboard
- http://localhost:3000/guild/<id>/insights
- http://localhost:3000/guild/<id>/transcripts
- http://localhost:3000/guild/<id>/tickets/queue
- http://localhost:3000/guild/<id>/memories
- http://localhost:3000/guild/<id>/verification

