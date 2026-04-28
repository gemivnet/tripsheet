# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build

RUN corepack enable
# Native modules (better-sqlite3, argon2) need a compiler toolchain.
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable

COPY tsconfig.json ./
COPY src/ ./src/
COPY web/ ./web/
RUN yarn build

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:20-alpine AS production

RUN corepack enable
# Runtime linkage for native modules + Chromium for PDF export.
RUN apk add --no-cache libstdc++ chromium chromium-chromedriver \
    nss freetype harfbuzz ca-certificates ttf-freefont
ENV CHROMIUM_PATH=/usr/bin/chromium-browser

WORKDIR /app

COPY package.json yarn.lock .yarnrc.yml ./
# Bring the already-built node_modules (with compiled natives) from the build
# stage rather than recompiling in the production image.
COPY --from=build /app/node_modules ./node_modules

COPY --from=build /app/dist/ ./dist/
COPY --from=build /app/web/dist/ ./web/dist/
COPY config.example.yaml ./config.example.yaml

RUN mkdir -p /app/data/uploads

ENV NODE_ENV=production
ENV TZ=America/Chicago
ENV DATA_DIR=/app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

ENTRYPOINT ["node", "dist/entrypoint.js"]
