# ─────────────────────────────────────────────────────────────────────────────
# Multi-stage build for Raspberry Pi 5 (ARM64) and x86-64
# Build on the Pi:  docker compose up --build
# Native ARM64 CI:  built on a native arm64 runner (no QEMU emulation).
# ─────────────────────────────────────────────────────────────────────────────

# ── 1. Base ───────────────────────────────────────────────────────────────────
FROM node:24-alpine AS base
# Build tools + vips (sharp compiles its native binding against system libvips).
# node-gyp is a devDependency in package.json so sharp can resolve it during
# the source build; SHARP_FORCE_GLOBAL_LIBVIPS links against the Alpine
# vips-dev package (>=8.17.3, which sharp 0.34.x requires) instead of
# downloading a prebuilt libvips. This sidesteps the npm bug where a
# Windows-generated package-lock.json drops the linuxmusl optional binaries.
RUN apk upgrade --no-cache \
 && apk add --no-cache libc6-compat python3 make g++ vips-dev
ENV SHARP_FORCE_GLOBAL_LIBVIPS=1

# ── 2. Production dependencies ────────────────────────────────────────────────
# Install ALL deps first (devDeps are needed for native module compilation,
# e.g. sharp needs node-addon-api which is a devDependency).
# Then prune to production-only — the compiled .node binaries stay in place.
FROM base AS prod-deps
WORKDIR /app
COPY package*.json ./
# prisma schema + config must exist before npm ci, because the postinstall
# script runs `prisma generate`.
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
RUN npm prune --omit=dev

# ── 3. Builder ────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY package*.json ./
# Same as above: postinstall needs the prisma schema during npm ci.
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate
RUN npm run build

# ── 4. Runner ─────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next.js installs its own SIGTERM/SIGINT handler that races with our
# shutdown logic in instrumentation.ts (it can call process.exit() before our
# prisma.$disconnect()/WAL checkpoint finishes). Disabling it gives our
# handler sole control of the shutdown sequence.
ENV NEXT_MANUAL_SIG_HANDLE=true

# Runtime libs only (no -dev headers needed at runtime)
RUN apk upgrade --no-cache \
 && apk add --no-cache libc6-compat vips

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Next.js standalone server (exclude standalone's traced node_modules — prod-deps
# provides the full set below, so copying both would waste a duplicate layer).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone/server.js ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone/.next     ./.next
COPY --from=builder --chown=nextjs:nodejs /app/.next/static               ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public          ./public

# Prisma schema
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

# Full production node_modules (native modules already compiled for target platform)
COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules

# Prisma WASM query engine (platform-independent, generated in builder)
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma

# Persistent data directory for SQLite
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

# Startup script: runs migrations + seeds admin user before the server starts
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/auth/session > /dev/null || exit 1

CMD ["sh", "-c", "node /app/scripts/startup.js && exec node /app/server.js"]
