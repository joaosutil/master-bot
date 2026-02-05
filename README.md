# Master Bot

Bot Discord all‑in‑one (moderação, tickets, utilidades e jogo de Expedições Cooperativas) + painel web (Next.js).

## Sumário
- [Recursos](#recursos)
- [Requisitos](#requisitos)
- [Rodar localmente](#rodar-localmente)
- [Deploy com Docker](#deploy-com-docker)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Comandos](#comandos)
- [Música (voz)](#música-voz)
- [Tickets (configuração rápida)](#tickets-configuração-rápida)
- [Notas](#notas)

## Recursos
- **Moderação e utilidades:** comandos e automod.
- **Tickets:** painel fixo + categorias + fechamento com tags.
- **Boas‑vindas (painel):** mensagem personalizada, auto‑role e botão para *testar mensagem* no canal escolhido.
- **Packs e cards:** inventário, abertura de packs e renderização de cards.
- **Economia global:** saldo/inventário/economia ficam **globais** (mesmo usuário = mesmos dados em todos os servidores).
- **Música (voz):** tocar/pausar/pular/fila, com fila por servidor e auto‑disconnect por inatividade.

## Requisitos
- Node.js 18+ (recomendado 20+)
- MongoDB
- (Opcional) Docker + Docker Compose

## Rodar localmente
1. Copie `.env.example` para `.env`
2. Preencha `DISCORD_TOKEN`, `CLIENT_ID`, `MONGO_URI` e `PANEL_BASE_URL` (e `GUILD_ID` se quiser registrar comandos só em 1 servidor)
3. Instale dependências: `npm install`
4. Registre os slash commands: `npm run deploy:commands`
5. Inicie o bot: `npm run dev` (ou `npm start`)

Painel web (Next.js):
- Veja `panel/README.md` (config do painel local e deploy).

## Deploy com Docker
1. Configure `.env` (bot) e `panel/.env` (painel)
2. Suba os serviços:
   - `docker compose up -d --build`
3. Registre os slash commands (execute 1x ou quando mudar comandos):
   - `docker compose run --rm bot npm run deploy:commands`

Local com MongoDB em container:
- `docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build`

## Variáveis de ambiente
Bot (principais):
- `DISCORD_TOKEN` (obrigatório)
- `CLIENT_ID` (obrigatório)
- `GUILD_ID` (opcional; se vazio registra global e pode demorar até 1h para refletir)
- `MONGO_URI` (obrigatório)
- `PANEL_BASE_URL` (obrigatório para recursos do painel)
- `BOT_PREFIX` (opcional; padrão: `.`)

Performance (render de cards):
- `RENDER_FAST=1` desliga efeitos pesados (mais rápido)
- `RENDER_NOISE=0` desliga ruído
- `CARD_RENDER_CACHE=50` cache de cards renderizados (aumente se tiver RAM)
- `PACK_REVEAL_MAX_CARDS=12` limite de cartas no reveal do `/pack`

Música (opcional):
- `SOUNDCLOUD_CLIENT_ID` (opcional; se vazio o bot tenta buscar um automaticamente)
- `MUSIC_ALLOW_YOUTUBE=1` (opcional; padrão: `0`)
- `MUSIC_MAX_QUEUE` (opcional; padrão: `100`; máx: `1000`)
- `MUSIC_RESOLVE_CONCURRENCY` (opcional; padrão: `3`; máx: `8`)
- `YOUTUBE_COOKIE` / `YOUTUBE_USERAGENT` (opcional; útil se o YouTube bloquear)
- Spotify (necessário para **playlist** do Spotify):
  - `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN` (e opcional `SPOTIFY_MARKET`)
  - Alternativa: criar `.data/spotify.data` com o assistente do `play-dl` (veja em “Música (voz)”)

## Comandos
Alguns comandos iniciais:
- `/ping`, `/ajuda`, `/status`
- `/pack`, `/inventory`, `/vender`
- `/expedicao iniciar`
- `/memoria adicionar`
- `/verificacao painel` (cria painel com botão + captcha)
- `/ticket abrir`, `/ticket painel`
- Música: `/tocar`, `/pausar`, `/resumir`, `/pular`, `/parar`, `/fila`, `/tocando`, `/volume`

Prefixo (se `BOT_PREFIX=.`):
- `.pack`, `.inventario`, `.vender`
- `.tocar`, `.pausar`, `.resumir`, `.pular`, `.parar`, `.fila`, `.tocando`, `.volume`

## Música (voz)
Comandos (slash e prefixo):
- `/tocar musica:<nome|link>` ou `.tocar <nome|link>`
- `/pausar` / `.pausar` | `/resumir` / `.resumir` | `/pular` / `.pular` | `/parar` / `.parar`
- `/fila` / `.fila` | `/tocando` / `.tocando`
- `/volume` / `.volume` (ex: `/volume 35` ou `.volume 35`)

Inatividade:
- O bot desconecta da call após ~2 minutos sem tocar nada (fila vazia) ou se ficar pausado.

Fontes de música (evitando YouTube por padrão):
- Por padrão, o `/tocar` **busca no SoundCloud**.
- Link de música do Spotify é aceito como entrada: o bot lê o título e usa isso para buscar no SoundCloud (não reproduz áudio diretamente do Spotify).
- Link de **playlist** do Spotify (`.../playlist/...`) adiciona as músicas na fila (precisa configurar token do Spotify no `play-dl` via `.data/spotify.data` ou vars `SPOTIFY_*`).
- Também aceita link curto do Spotify (`spoti.fi` / `spotify.link`) e URI `spotify:track:...`.
- YouTube fica desativado por padrão; para permitir, use `MUSIC_ALLOW_YOUTUBE=1`.

Como gerar `.data/spotify.data` (opção alternativa às vars `SPOTIFY_*`):
- Rode: `node -e "import('play-dl').then(m => (m.default ?? m).authorization())"`
- Siga o fluxo para obter e salvar as credenciais do Spotify.

Observação (YouTube):
- Em alguns servidores/hosts, o YouTube pode bloquear com “Sign in to confirm you’re not a bot”.
- Solução recomendada: usar **Lavalink**.
- Alternativa (menos recomendada): definir `YOUTUBE_COOKIE` no `.env` (cookie de uma conta) e reiniciar o bot.

## Tickets (configuração rápida)
1. `/ticket config tipo` (channel ou thread)
2. `/ticket config canal_abertura #canal`
3. `/ticket config categoria_canal #categoria` (obrigatório para tipo channel)
4. `/ticket config staff_add @cargo`
5. `/ticket config categoria_add "Suporte"`

## Notas
- Para comandos por prefixo e logs completos, habilite **Message Content Intent** no Discord Developer Portal.
- O comando `/expedicao iniciar` cria uma thread com lobby por 60s e botão “Entrar”.
- Boas‑vindas: no painel, você pode configurar cargos automáticos (auto‑role) e testar a mensagem antes de salvar.
- Cápsula do tempo: use `/memoria adicionar` para salvar mensagens e configure a postagem automática no painel.
