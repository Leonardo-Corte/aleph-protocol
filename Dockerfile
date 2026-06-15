# The Aleph deployable: one image, two roles. `@aleph/cli` runs either a
# registry or a node (same binary, different command) — see docker-compose.yml.
# Multi-stage: build with the full toolchain, ship a slim, non-root runtime.

# --- build ---
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
# install deps first (better layer caching), then build the workspace
COPY . .
RUN pnpm install --frozen-lockfile && pnpm -r build

# --- run ---
FROM node:22-slim AS run
ENV NODE_ENV=production
ENV HOST=0.0.0.0
WORKDIR /app
# the built workspace: hoisted node_modules (symlinks) + each package's dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/package.json ./package.json
USER node
EXPOSE 4000
# the CLI healthcheck subcommand reads PORT and probes /healthz
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "packages/cli/dist/cli.js", "healthcheck"]
# default role is the registry; compose overrides `command` for a node
CMD ["node", "packages/cli/dist/cli.js", "registry"]
