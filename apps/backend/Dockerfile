FROM node:22-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Copy Prisma schema before generate so tsc can resolve @prisma/client types
COPY prisma/ ./prisma/
RUN npx prisma generate

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output
COPY --from=builder /app/dist ./dist

# Copy Prisma schema + migrations (needed for migrate deploy at startup)
COPY --from=builder /app/prisma ./prisma

# Copy generated Prisma client (prisma generate output lives here, not in prod node_modules)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy Prisma CLI binaries so index.ts can exec "npx prisma migrate deploy" at startup
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma

# Copy @prisma engines — Prisma 6 uses WASM-bundled engines so this is likely redundant,
# but avoids a silent failure if any code path falls back to a native engine binary.
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

CMD ["node", "dist/index.js"]
