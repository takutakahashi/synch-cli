# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS build

WORKDIR /src
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/cli/package.json apps/cli/package.json
COPY packages/sync-client/package.json packages/sync-client/package.json
COPY packages/vault-crypto/package.json packages/vault-crypto/package.json
RUN pnpm install --frozen-lockfile

COPY apps/cli apps/cli
COPY packages packages
RUN pnpm -C apps/cli build

FROM node:22-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="synch-cli" \
      org.opencontainers.image.description="Synch CLI and Streamable HTTP MCP server" \
      org.opencontainers.image.source="https://github.com/takutakahashi/synch-cli"

ENV NODE_ENV=production \
    XDG_CONFIG_HOME=/data/config

RUN install -d -o node -g node /data/config /data/vault
COPY --from=build --chown=node:node /src/apps/cli/dist/synch.js /usr/local/bin/synch

USER node
WORKDIR /data/vault
VOLUME ["/data"]
EXPOSE 3000

ENTRYPOINT ["synch"]
CMD ["mcp", "--vault", "/data/vault", "--host", "0.0.0.0", "--port", "3000"]
