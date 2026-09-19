#!/usr/bin/env node
// Example hook for `synch watch --on-change`.
//
// The CLI passes the change event as JSON on stdin and mirrors the highlights
// in SYNCH_* environment variables, so a hook can be a few lines long.
//
//   synch watch --vault ./notes --on-change ./examples/on-change.mjs
//
// Hook output is streamed to the terminal, and a non-zero exit is reported
// without stopping the watch loop.
import { execFile } from "node:child_process";

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}
const event = JSON.parse(Buffer.concat(chunks).toString("utf8"));

for (const change of event.changes) {
  console.log(`${change.kind.padEnd(8)} ${change.path}`);
}

// Optional: rebuild something on every change, e.g.
//   SYNCH_HOOK_BUILD=1 synch watch --vault . --on-change ./examples/on-change.mjs
if (process.env.SYNCH_HOOK_BUILD === "1") {
  await run("pnpm", ["build"], event.vault);
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, stdio: "inherit" }, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}
