# @synch/cli

The `synch` command: a headless, end-to-end encrypted sync client for Synch
vaults. It drives the vendored `@synch/sync-client` engine with Node host
adapters (SQLite store, filesystem watcher, HTTP/WebSocket transport) so a
plain directory can be synchronized without Obsidian.

See the [repository README](../../README.md) for installation, the full command
reference, and the local state layout. This file covers the package itself.

Requirements: Node.js >= 22.5 (`node:sqlite`, global
`fetch`/`WebSocket`/WebCrypto).

## Layout

- `src/app/` — argv parsing, application context wiring, notices, output.
- `src/commands/` — one module per command.
- `src/host/` — Node adapters: HTTP client, vault adapter, change source,
  vault config source, SQLite sync store, lock file, credential store.

## Scripts

```sh
pnpm -C apps/cli dev -- status      # run from sources via tsx
pnpm -C apps/cli test               # vitest
pnpm -C apps/cli typecheck          # tsc
pnpm -C apps/cli build              # bundle to dist/synch.js
```

`dist/synch.js` is a single self-contained ESM bundle with a Node shebang and
the executable bit set, so it can be installed, linked, or copied directly. The
bundle inlines the vendored engine and `chokidar`; nothing else is needed at
runtime (`chokidar` stays declared as a dependency for `pnpm dev`/`tsx` runs).
