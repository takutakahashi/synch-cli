/**
 * Machine-readable output helpers.
 *
 * Commands that describe state (`status`, `vault list`) write to stdout so the
 * result can be piped or parsed. Progress and diagnostics continue to go
 * through `Logger`, which writes to stderr.
 */
export function writeStdout(line: string): void {
  process.stdout.write(`${line}\n`);
}

export function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
