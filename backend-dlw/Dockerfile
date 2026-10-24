# ── Etapa 1: Build ──────────────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Etapa 2: Producción ────────────────────────────────
FROM node:22-bookworm-slim AS runner

# Instalar dependencias del sistema: Python, ffmpeg, curl y Deno
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    ffmpeg \
    curl \
    ca-certificates \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Instalar Deno para yt-dlp
RUN curl -fsSL https://deno.land/install.sh | sh && \
    mv /root/.deno/bin/deno /usr/local/bin/deno

# Instalar yt-dlp última versión y plugin bgutil-ytdlp-pot-provider
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    pip3 install --no-cache-dir --break-system-packages bgutil-ytdlp-pot-provider

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

COPY package*.json ./
RUN npm ci --only=production

# Copiar dist compilado
COPY --from=builder /app/dist ./dist

# Usuario no root para seguridad
USER node

EXPOSE 3001

CMD ["node", "dist/main.js"]
