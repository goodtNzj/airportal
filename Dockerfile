# ============================
# Stage 1: Dependencies
# ============================
FROM node:22-alpine AS deps

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY pnpm-lock.yaml package.json ./
COPY pnpm-workspace.yaml ./
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/

RUN pnpm install --frozen-lockfile

# ============================
# Stage 2: Build
# ============================
FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=deps /app/packages/web/node_modules ./packages/web/node_modules

COPY packages/server/prisma/schema.prisma ./packages/server/prisma/schema.prisma
RUN cd packages/server && npx prisma generate --schema=./prisma/schema.prisma

COPY packages/server ./packages/server
COPY packages/web ./packages/web
COPY tsconfig.base.json ./

RUN pnpm --filter @airportal/web build
RUN pnpm --filter @airportal/server build

# ============================
# Stage 3: Production
# ============================
FROM node:22-alpine AS production

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY --from=deps /app/pnpm-workspace.yaml ./
COPY --from=deps /app/package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/server/package.json ./packages/server/
COPY --from=deps /app/packages/server/node_modules ./packages/server/node_modules

COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/server/prisma/schema.prisma ./packages/server/prisma/schema.prisma
COPY --from=build /app/packages/web/dist ./packages/web/dist

RUN cd packages/server && npx prisma generate --schema=./prisma/schema.prisma

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 node && \
    mkdir -p /app/uploads /app/packages/server/prisma/data && \
    chown -R node:nodejs /app/uploads /app/packages/server/prisma/data

USER node

EXPOSE 3000

CMD ["sh", "-c", "cp -r /app/packages/web/dist/. /web-dist/ 2>/dev/null; node packages/server/dist/index.js"]
