# Master Bot

Bot Discord all-in-one (moderação, tickets, utilidades, jogo Expedições Cooperativas).

## Requisitos
- Node.js 18+
- MongoDB

## Setup
1. Copie `.env.example` para `.env`
2. Preencha `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` (opcional para registrar em um servidor específico), `MONGO_URI`, `PANEL_BASE_URL`
3. `npm install`
4. `npm run deploy:commands`
5. `npm run dev`

## Painel web (Next.js)
Veja `panel/README.md` para configurar o painel local.

## Deploy (funciona em qualquer servidor)
O bot e o painel rodam em qualquer lugar que tenha Node 18+ **ou** Docker.

### Opção A (recomendada): Docker (VPS/Oracle Always Free, etc.)
1. Configure `.env` (bot) e `panel/.env` (painel)
2. Suba os dois:
   - `docker compose up -d --build`
3. Registrar slash commands (execute 1x ou quando mudar comandos):
   - `docker compose run --rm bot npm run deploy:commands`

Local com MongoDB em container:
- `docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build`

### Opção B (free-tier mais simples): Vercel (painel) + Koyeb (bot) + MongoDB Atlas
1. Banco: crie um cluster gratuito no MongoDB Atlas e pegue o `MONGO_URI`
2. Painel (Vercel): importe o repo e selecione `panel` como “Root Directory”; configure as envs do `panel/.env.example` com as URLs finais
3. Bot (Koyeb): faça deploy do repo e configure as envs do `.env.example`; garanta que `PORT` esteja definido (o bot expõe `/health`)
4. Discord Developer Portal: adicione o redirect do painel (ex: `https://SEU-DOMINIO/api/auth/callback`) e atualize `PANEL_BASE_URL`/`BASE_URL`

### Performance (VPS fraca)
- `RENDER_FAST=1` desliga efeitos de ruído (mais rápido)
- `RENDER_NOISE=0` desliga ruído
- `CARD_RENDER_CACHE=50` cache de cards renderizados (aumente se tiver RAM)
- `PACK_REVEAL_MAX_CARDS=12` quantas cartas aparecem na imagem do reveal do /pack

## Comandos iniciais
- /ping
- /ajuda
- /status
- /expedicao iniciar
- /memoria adicionar
- /verificacao painel (cria painel com botão + captcha)
- /ticket abrir
- /ticket painel (cria uma mensagem fixa com seletor de categorias)

## Configurar tickets (básico)
1. /ticket config tipo (channel ou thread)
2. /ticket config canal_abertura #canal
3. /ticket config categoria_canal #categoria (obrigatório para tipo channel)
4. /ticket config staff_add @cargo
5. /ticket config categoria_add "Suporte"

## Notas
- Para gerar transcript completo (mensagens de usuários) habilite Message Content Intent no Developer Portal.
- O comando /expedicao iniciar cria uma thread com lobby por 60s e botão "Entrar".
- Boas-vindas: no painel, você pode configurar cargos automáticos (auto-role) para novos membros.
- Cápsula do tempo: use `/memoria adicionar` para salvar mensagens engraçadas/fofas e configure a postagem automática no painel.
