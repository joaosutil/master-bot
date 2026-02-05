FROM node:20-bookworm-slim

# Fonts are required for @napi-rs/canvas to render text/emoji reliably on slim images.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core fonts-noto-color-emoji ffmpeg \
  && rm -rf /var/lib/apt/lists/* \
  && fc-cache -f

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY assets ./assets
COPY data ./data

EXPOSE 3000

CMD ["npm","start"]
