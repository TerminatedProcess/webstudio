# Self-host image for the Webstudio builder (dev/staging only — not hardened for production).
# Build context is the repo ROOT (the pnpm workspace), not apps/builder.
#
#   docker build -f apps/builder/Dockerfile -t webstudio-builder .
#
# The builder is a Remix app served in production via `remix-serve`. At build
# time cross-package imports resolve to TS source via the "webstudio" export
# condition; at runtime externalized workspace packages resolve to their built
# lib/, so builder's dependencies must be built before the app (and before
# vite.config.ts is bundled — see the "build gotcha" in CLAUDE.md).
FROM node:22-bookworm-slim

# git: pnpm's "prepare" hook (simple-git-hooks) probes for it. openssl: prisma engine.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app

# Whole workspace is needed to build any single package.
COPY . .

# Resolve cross-package imports to TS source during the build only.
ENV NODE_OPTIONS=--conditions=webstudio

RUN pnpm install --frozen-lockfile
# Prisma client is imported by project-build -> builder at build time.
RUN pnpm --filter=@webstudio-is/prisma-client generate
# Build builder's workspace deps first: required both to bundle vite.config.ts
# and so their built lib/ exists for runtime resolution.
RUN pnpm --filter=@webstudio-is/builder^... build
# Build the app itself (remix vite:build -> apps/builder/build).
RUN pnpm --filter=@webstudio-is/builder build

# Runtime resolves workspace packages to their built lib/ (normal "import"
# condition) — do NOT carry the build-time condition into the running server.
ENV NODE_OPTIONS=
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

WORKDIR /app/apps/builder
# Custom server (not remix-serve) so global fetch is native undici, not the
# web-fetch polyfill that breaks PostgREST calls over the container network.
CMD ["node", "server.mjs"]
