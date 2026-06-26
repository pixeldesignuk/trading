# ── build stage: compile the Vite front end ──────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
# vite.config.js sets outDir: '../server/public' (relative to web/ root),
# so `pnpm build` writes assets straight into server/public/ — no cp needed.
RUN pnpm build

# ── runtime stage: prod deps only + built server ──────────────────────────────
FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/server ./server
COPY --from=build /app/vite.config.js ./
ENV NODE_ENV=production
# Listens on $PORT (Railway injects it); EXPOSE is documentation only.
EXPOSE 8920
CMD ["node", "--no-warnings", "server/index.js"]
