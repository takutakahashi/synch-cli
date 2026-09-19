#!/usr/bin/env node
/**
 * Refreshes the vendored Synch engine (`packages/sync-client`,
 * `packages/vault-crypto`, `tsconfig.base.json`) from an upstream checkout and
 * re-applies the local normalizations the CLI repository depends on.
 *
 * Usage:
 *   node scripts/vendor-from-upstream.mjs --ref <branch|tag|sha>
 *   node scripts/vendor-from-upstream.mjs --repo <url> --ref <sha> --dir <checkout>
 *
 * Run `pnpm typecheck && pnpm test` afterwards, then review `git diff`.
 */
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const VENDORED_PACKAGES = ["packages/sync-client", "packages/vault-crypto"];
const VENDORED_FILES = ["tsconfig.base.json"];

const args = parseArgs(process.argv.slice(2));
const upstreamRepo = args.repo ?? "https://github.com/hjinco/synch.git";
const upstreamDir = args.dir ?? (await shallowClone(upstreamRepo, args.ref));

try {
  for (const relative of VENDORED_PACKAGES) {
    await replaceDirectory(
      path.join(upstreamDir, relative),
      path.join(repoRoot, relative),
    );
  }
  for (const relative of VENDORED_FILES) {
    await cp(path.join(upstreamDir, relative), path.join(repoRoot, relative), {
      force: true,
    });
  }

  await normalizePackageJson(path.join(repoRoot, "packages/sync-client/package.json"));
  await normalizePackageJson(path.join(repoRoot, "packages/vault-crypto/package.json"));
  await applyLocalPatches();
} finally {
  if (!args.dir) {
    await rm(upstreamDir, { recursive: true, force: true });
  }
}

console.log(
  [
    `Vendored from ${upstreamRepo} at ${args.ref ?? "HEAD"}.`,
    "Next: run `pnpm install && pnpm typecheck && pnpm test`, then review `git diff`.",
  ].join("\n"),
);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith("--")) {
      throw new Error(`Unexpected argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    parsed[flag.slice(2)] = value;
    index += 1;
  }
  return parsed;
}

async function shallowClone(repo, ref) {
  const dir = await mkdtemp(path.join(tmpdir(), "synch-upstream-"));
  const cloneArgs = ["clone", "--depth", "1", "--filter=blob:none"];
  if (ref) {
    cloneArgs.push("--branch", ref);
  }
  cloneArgs.push(repo, dir);
  execFileSync("git", cloneArgs, { stdio: "inherit" });
  return dir;
}

/**
 * Replaces `target` with `source`, dropping `node_modules` so upstream build
 * artifacts never leak into the vendored copy.
 */
async function replaceDirectory(source, target) {
  await rm(target, { recursive: true, force: true });
  await cp(source, target, {
    recursive: true,
    filter: (entry) => path.basename(entry) !== "node_modules",
  });
}

/**
 * The CLI repository pins its own toolchain and typechecks with plain `tsc`
 * instead of upstream's workspace-wide TypeScript preview build.
 */
async function normalizePackageJson(filePath) {
  const pkg = JSON.parse(await readFile(filePath, "utf8"));
  pkg.devDependencies = {
    ...pkg.devDependencies,
    typescript: "^5.9.3",
    vitest: "4.1.4",
  };
  pkg.scripts = {
    ...pkg.scripts,
    typecheck: "tsc --noEmit",
  };
  await writeFile(filePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

async function applyLocalPatches() {
  const filePath = path.join(
    repoRoot,
    "packages/sync-client/src/sync/core/sha256-worker-pool.ts",
  );
  const source = await readFile(filePath, "utf8");
  const before = `    const concurrency = normalizeConcurrency(
      options.concurrency ?? HASH_CONCURRENCY,
      HASH_CONCURRENCY,
    );`;
  const after = `    // A machine-derived default is capped by HASH_CONCURRENCY. An explicit
    // caller-provided concurrency is honored even on hosts that report very
    // few CPUs, otherwise the pool silently collapses to one worker.
    const concurrency = normalizeConcurrency(
      options.concurrency ?? HASH_CONCURRENCY,
      Math.max(options.concurrency ?? 1, HASH_CONCURRENCY),
    );`;

  if (source.includes(after)) {
    return;
  }
  if (!source.includes(before)) {
    throw new Error(
      "Local patch for sha256-worker-pool.ts no longer applies; rebase it manually and update VENDORING.md.",
    );
  }
  await writeFile(filePath, source.replace(before, after));
}
