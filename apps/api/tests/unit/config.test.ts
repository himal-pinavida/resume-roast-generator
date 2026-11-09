import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/config.js";

describe("loadConfig", () => {
  it("reads API_PORT, LOG_LEVEL, and METRICS_ENABLED", () => {
    const config = loadConfig({
      NODE_ENV: "development",
      API_PORT: "4321",
      LOG_LEVEL: "debug",
      METRICS_ENABLED: "false",
    });
    expect(config.port).toBe(4321);
    expect(config.logLevel).toBe("debug");
    expect(config.metricsEnabled).toBe(false);
  });

  it("uses a development fallback PII_HASH_KEY only in development", () => {
    const config = loadConfig({ NODE_ENV: "development" });
    expect(config.piiHashKey).toBe("dev-only-change-me");
  });

  it("fails fast when PII_HASH_KEY is missing outside development", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(
      "PII_HASH_KEY is required outside development",
    );
  });

  it("accepts an explicit PII_HASH_KEY outside development", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      PII_HASH_KEY: "prod-secret",
    });
    expect(config.piiHashKey).toBe("prod-secret");
  });
});
