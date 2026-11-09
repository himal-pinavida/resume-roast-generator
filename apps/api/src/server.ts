import { Registry } from "prom-client";
import { buildApp } from "./app.js";
import { loadConfig } from "./config/config.js";
import { createLogger } from "./logger/logger.js";
import { createEnforcementMetrics } from "./observability/enforcement-metrics.js";
import { createSubjectHasher } from "./observability/pii.js";
import { InMemoryEnforcementStore } from "./store/enforcement-store.js";

/**
 * Production-ish entry point: load config, wire concrete dependencies (an in-memory enforcement store
 * for Story 89), and start listening.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({
    level: config.logLevel,
    environment: config.nodeEnv,
  });
  const registry = new Registry();
  const metrics = createEnforcementMetrics(registry, logger);
  const store = new InMemoryEnforcementStore();
  const subjectHash = createSubjectHasher(config.piiHashKey);

  const app = buildApp({
    logger,
    metrics,
    store,
    registry,
    subjectHash,
    metricsEnabled: config.metricsEnabled,
    environment: config.nodeEnv,
  });

  const server = app.listen(config.port, () => {
    logger.info(
      `Resume Roast API listening on http://localhost:${config.port} (metrics: ${config.metricsEnabled ? "on" : "off"})`,
    );
  });

  const shutdown = (): void => {
    server.close(() => {
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
