import { chmod } from "node:fs/promises";

import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/synch.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: {
    // `node:sqlite` is still flagged experimental on supported Node releases.
    // Suppress only that warning so command output stays clean; `env -S` keeps
    // the shebang portable across Linux and macOS.
    js: "#!/usr/bin/env -S node --disable-warning=ExperimentalWarning\n",
  },
});

// npm links `bin` entries through this file, so it has to be executable.
await chmod("dist/synch.js", 0o755);
