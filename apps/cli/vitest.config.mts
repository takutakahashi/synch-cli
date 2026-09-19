export default {
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Filesystem watcher tests wait on real chokidar poll cycles. They are
    // deterministic locally but can exceed their per-test budget on a loaded
    // shared CI runner, so allow a bounded number of retries.
    retry: 2,
  },
};
