# Vendored engine

The Synch sync engine is not published to npm, so this repository vendors the
packages it needs and builds the CLI on top of them. Keeping a copy here means
the CLI can be built, tested, and shipped without cloning the upstream
monorepo, and that vault-format compatibility is exactly the one the official
clients use.

## Provenance

| Path | Upstream |
| --- | --- |
| `packages/sync-client` | `hjinco/synch` → `packages/sync-client` |
| `packages/vault-crypto` | `hjinco/synch` → `packages/vault-crypto` |
| `tsconfig.base.json` | `hjinco/synch` → `tsconfig.base.json` |

- Upstream: <https://github.com/hjinco/synch>
- Vendored at: `3fbb73fa15a0b2856ceaf30a357a38f28d8f977d` (2026-09-18)
- License: MIT, copyright the Synch authors

Everything under `apps/cli` is specific to this repository.

## Local changes to the vendored copy

The vendored copy is kept as close to upstream as possible. The following
changes are applied deliberately, and `scripts/vendor-from-upstream.mjs`
re-applies them on every refresh:

1. **Toolchain pins** — `packages/*/package.json` use plain
   `tsc --noEmit` for `typecheck` and pin `typescript`/`vitest`, so the CLI
   repository does not depend on upstream's workspace-wide TypeScript preview
   build.
2. **SHA-256 pool concurrency** —
   `packages/sync-client/src/sync/core/sha256-worker-pool.ts` previously clamped
   even an explicit `concurrency` option by the host's CPU count. On a 1–3 CPU
   host the pool silently collapsed to a single worker and its own test failed.
   An explicit concurrency is now honored; the machine-derived default is still
   capped by `HASH_CONCURRENCY`.

Do not edit other vendored files by hand. Propose the change upstream first,
then re-vendor.

## Refreshing

```sh
node scripts/vendor-from-upstream.mjs --ref <branch|tag|sha>
pnpm install
pnpm typecheck
pnpm test
pnpm build
git diff
```

The script clones upstream into a temporary directory, replaces the vendored
paths, and re-applies the local changes above. It fails loudly when a local
patch no longer applies so the divergence cannot rot silently.

Also update the *Vendored at* commit in this file when refreshing.
