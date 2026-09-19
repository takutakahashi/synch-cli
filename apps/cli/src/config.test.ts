import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveApiBaseUrl } from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveApiBaseUrl", () => {
  it("falls back to the local development server", () => {
    expect(resolveApiBaseUrl()).toBe("http://127.0.0.1:8787");
  });

  it("accepts a self-hosted URL from the flag", () => {
    expect(resolveApiBaseUrl("https://synch.example.com")).toBe(
      "https://synch.example.com",
    );
  });

  it("accepts a self-hosted URL from the environment", () => {
    vi.stubEnv("SYNCH_API_URL", "http://192.168.1.10:8787");
    expect(resolveApiBaseUrl()).toBe("http://192.168.1.10:8787");
  });

  it("prefers the flag over the environment", () => {
    vi.stubEnv("SYNCH_API_URL", "http://env.example.com");
    expect(resolveApiBaseUrl("https://flag.example.com")).toBe(
      "https://flag.example.com",
    );
  });

  it("normalizes trailing slashes and surrounding whitespace", () => {
    expect(resolveApiBaseUrl("  https://synch.example.com/v1//  ")).toBe(
      "https://synch.example.com/v1",
    );
  });

  it("rejects non-http schemes and query strings", () => {
    expect(() => resolveApiBaseUrl("ftp://synch.example.com")).toThrow(
      /Invalid API base URL/,
    );
    expect(() => resolveApiBaseUrl("https://synch.example.com?debug=1")).toThrow(
      /Invalid API base URL/,
    );
  });

  it("rejects an empty flag but still honors the environment", () => {
    vi.stubEnv("SYNCH_API_URL", "http://self-hosted.local:9000/");
    expect(resolveApiBaseUrl("   ")).toBe("http://self-hosted.local:9000");
  });
});
