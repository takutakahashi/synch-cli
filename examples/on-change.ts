#!/usr/bin/env node
// The same hook written in TypeScript. `synch watch` runs `.ts` hooks with its
// own Node binary, which strips types natively on Node 22.6+ (no tsx needed).
//
//   synch watch --vault ./notes --on-change ./examples/on-change.ts
import { execFile } from "node:child_process";

interface VaultChange {
  path: string;
  kind: "created" | "modified" | "deleted";
}

interface VaultChangedEvent {
  event: "vault.changed";
  vault: string;
  apiBaseUrl: string;
  detectedAt: string;
  changes: VaultChange[];
}

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk as Buffer);
}
const event = JSON.parse(
  Buffer.concat(chunks).toString("utf8"),
) as VaultChangedEvent;

const deleted = event.changes.filter((change) => change.kind === "deleted");
const written = event.changes.filter((change) => change.kind !== "deleted");
console.log(
  `${written.length} written, ${deleted.length} deleted in ${event.vault}`,
);

if (process.env.SYNCH_HOOK_BUILD === "1") {
  await run("pnpm", ["build"], event.vault);
}

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, stdio: "inherit" }, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}
