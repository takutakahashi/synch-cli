# synch-cli

A headless command-line client for [Synch](https://synch.run), the end-to-end
encrypted Obsidian sync service. It keeps a plain directory on disk in sync with
a remote vault, so a vault can be read, written, and watched from a terminal,
a server, a container, or a script — no Obsidian required.

```sh
synch login                                  # device-code sign-in
synch vault create --name notes --vault ./notes
synch sync --vault ./notes                   # one-shot, both directions
synch watch --vault ./notes                  # keep running until Ctrl+C
```

- **Read** — `synch pull` downloads remote changes and never uploads.
- **Write** — `synch sync` reconciles local edits and uploads them, merging
  non-overlapping Markdown edits and preserving overlapping ones as conflict
  copies.
- **Watch** — `synch watch` runs a file watcher plus a realtime connection so
  both local and remote changes converge while it runs.

## Requirements

- Node.js **22.5 or newer** (`node:sqlite`, global `fetch`/`WebSocket`/WebCrypto).
- A Synch account and a remote vault.

## Install

Build the self-contained bundle from source:

```sh
pnpm install
pnpm build
./apps/cli/dist/synch.js --help
```

To put a `synch` command on your `PATH`, link the workspace package globally:

```sh
pnpm -C apps/cli link --global
synch status
```

## Commands

| Command | Description |
| --- | --- |
| `synch login` | Sign in with a device code. |
| `synch logout` | Sign out and clear stored session and vault keys. |
| `synch vault list [--json]` | List the account's remote vaults. |
| `synch vault create --name <name>` | Create a remote vault and connect this directory. |
| `synch vault connect --vault-id <id>` | Connect this directory to an existing vault. |
| `synch vault disconnect [--json]` | Forget the remote vault bound to this directory. |
| `synch pull` | Download remote changes; never uploads local changes. |
| `synch sync` | Reconcile, upload, and download once, then exit. |
| `synch watch` | Keep syncing (file watcher + realtime) until interrupted. |
| `synch status [--json]` | Show account, vault, and local sync state. |

### Options

| Option | Description |
| --- | --- |
| `--vault <path>` | Vault directory (default: current directory). |
| `--vault-id <id>` | Remote vault ID, for `vault connect`. |
| `--name <name>` | Remote vault name, for `vault create`. |
| `--api-url <url>` | API server URL, or `SYNCH_API_URL`. |
| `--json` | Machine-readable output for `status`, `vault list`, `vault disconnect`. |
| `-h`, `--help` | Show help. |
| `-v`, `--version` | Show the CLI version. |

### Environment

| Variable | Description |
| --- | --- |
| `SYNCH_API_URL` | API server URL (default `http://127.0.0.1:8787`). |
| `SYNCH_VAULT_PASSWORD` | Vault password for non-interactive `vault connect`/`vault create`. |
| `XDG_CONFIG_HOME` | Base directory for stored credentials. |

`SYNCH_VAULT_PASSWORD` is read only when a vault password is required, and it
keeps the password out of shell history and process arguments. Prefer an
interactive prompt when a human is present.

## Self-hosted servers

The CLI never assumes Synch Cloud. Point it at any Synch deployment with
`--api-url` or `SYNCH_API_URL`:

```sh
synch login --api-url https://synch.example.com
synch vault connect --vault-id <id> --api-url https://synch.example.com
SYNCH_API_URL=https://synch.example.com synch watch --vault ./notes
```

The base URL is used for every request (sign-in, vault listing, sync tokens,
blobs), and the realtime socket is derived from it: `https://` becomes
`wss://` and `http://` becomes `ws://`. The API and socket endpoints must be
reachable from the machine running the CLI. Upstream deployment guides:
[Cloudflare](https://synch.run/self-hosting) and
[Docker/systemd](https://synch.run/self-hosting-docker).

`--api-url` on `login`/`vault connect` selects the server; later commands must
use the same URL, either as a flag or through `SYNCH_API_URL`. With a private
CA, point `NODE_EXTRA_CA_CERTS` at the CA bundle.

## Local state

Everything the CLI writes stays inside the target directory and the user config
directory:

- `<vault>/.synch/sync.sqlite` — local sync store (entry state, cursors,
  pending mutations). Never synced; `.synch/` is a reserved path.
- `<vault>/.synch/cli.lock` — per-vault process lock with stale-lock recovery,
  so two commands cannot corrupt one store.
- `~/.config/synch/credentials.json` (XDG-aware, mode `0600`) — session token
  and per-vault remote vault keys, keyed by absolute vault path. Credentials
  are scoped per API server, so a token or vault key issued by one deployment is
  never sent to another.

Vault keys are unwrapped locally from the password and stored outside the vault.
The server only ever receives encrypted blobs and encrypted metadata.

## Safety notes

- `synch pull` replaces differing local files with remote versions and never
  uploads. Use it for read-only replicas and backup staging directories, not for
  a directory where you also edit files.
- `synch vault disconnect` clears the stored key but leaves local files and the
  sync store in place.
- Run one Synch client per directory. The lock file prevents concurrent CLI
  processes, but other sync tools should not watch the same directory.
- Back up a vault before connecting it to any new sync provider.

## Development

```sh
pnpm install
pnpm typecheck   # tsc across the vendored engine and the CLI
pnpm test        # engine + CLI unit tests
pnpm build       # bundle apps/cli/dist/synch.js
```

The CLI is exercised by unit tests for argument parsing, command output, and
credential/password handling. The vendored engine carries its own test suite
(encryption, conflict handling, store and transport behavior), which runs as
part of `pnpm test`.

## Vendored engine

`packages/sync-client` and `packages/vault-crypto` are vendored from the
upstream Synch repository under the MIT license. The CLI itself lives in
`apps/cli`. See [VENDORING.md](VENDORING.md) for provenance, the list of local
patches, and how to refresh the vendored code.

## License

MIT. See [LICENSE](LICENSE). Portions of this repository are derived from
[hjinco/synch](https://github.com/hjinco/synch), copyright the Synch authors,
and remain under the MIT license.
