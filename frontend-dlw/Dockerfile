# ── Etapa 1: Build de Astro ─────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Argumento para la URL del backend en tiempo de build
ARG PUBLIC_API_URL=https://api.dlw.sanzanadev.cl
ENV PUBLIC_API_URL=$PUBLIC_API_URL
ENV ASTRO_TELEMETRY_DISABLED=1

RUN npm run build

# ── Etapa 2: Servidor Nginx ultra-ligero para producción ─
FROM nginx:alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html

# Configuración básica de Nginx con gzip y soporte SPA/fallback
RUN echo 'server { \
    listen 80; \
    server_name _; \
    root /usr/share/nginx/html; \
    index index.html; \
    gzip on; \
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript image/svg+xml; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
