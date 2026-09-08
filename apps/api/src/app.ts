import express, { type Express, type Request, type Response } from "express";
import type { Logger } from "pino";
import type { Registry } from "prom-client";
import { errorMiddleware } from "./middleware/error-middleware.js";
import { requestIdMiddleware } from "./middleware/request-id-middleware.js";
import { createRequestLoggerMiddleware } from "./logger/logger.js";
import { captchaMiddleware } from "./middleware/enforcement/captcha.js";
import { killSwitchMiddleware } from "./middleware/enforcement/kill-switch.js";
import { quotaMiddleware } from "./middleware/enforcement/quota.js";
import { rateLimitMiddleware } from "./middleware/enforcement/rate-limit.js";
import { tempBlockMiddleware } from "./middleware/enforcement/temp-block.js";
import type { EnforcementDeps } from "./middleware/enforcement/deps.js";
import type { EnforcementMetrics } from "./observability/enforcement-metrics.js";
import type { SubjectHasher } from "./observability/pii.js";
import { metricsRouter } from "./routes/metrics-router.js";
import { submitRoastHandler } from "./routes/roast-routes.js";
import type { EnforcementStore } from "./store/enforcement-store.js";

/**
 * Composition root for the HTTP app. Built as a function over its dependencies (manual DI) so tests
 * can inject a fresh prom-client registry, a recording logger, and deterministic in-memory
 * enforcement state via supertest.
 */
export interface AppDependencies {
  logger: Logger;
  metrics: EnforcementMetrics;
  store: EnforcementStore;
  registry: Registry;
  subjectHash: SubjectHasher;
  metricsEnabled?: boolean;
  service?: string;
  environment?: string;
  routeId?: string;
}

export function buildApp(deps: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");

  app.use(requestIdMiddleware(deps.logger));
  app.use(createRequestLoggerMiddleware(deps.logger));

  // Liveness/readiness are unauthenticated and deliberately do not require a body parser.
  app.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok", version: "1.0.0" });
  });
  app.get("/readyz", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  // /metrics is mounted before body parsing and only when enabled (default true).
  if (deps.metricsEnabled !== false) {
    app.use("/metrics", metricsRouter(deps.registry));
  }

  app.use(express.json());

  const enforcementDeps: EnforcementDeps = {
    logger: deps.logger,
    metrics: deps.metrics,
    store: deps.store,
    subjectHash: deps.subjectHash,
    service: deps.service ?? "resume-roast-api",
    environment: deps.environment ?? "development",
    routeId: deps.routeId ?? "api.resume.roast",
  };

  app.post(
    "/api/resume/roast",
    killSwitchMiddleware(enforcementDeps),
    tempBlockMiddleware(enforcementDeps),
    rateLimitMiddleware(enforcementDeps),
    quotaMiddleware(enforcementDeps),
    captchaMiddleware(enforcementDeps),
    submitRoastHandler,
  );

  // Central typed-error -> status mapping is the LAST middleware.
  app.use(errorMiddleware);

  return app;
}
