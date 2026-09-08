import { Router, type Request, type Response } from "express";
import type { Registry } from "prom-client";

const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

/** Prometheus scrape endpoint. No application-level auth by design — exposure is a deployment concern. */
export function metricsRouter(registry: Registry): Router {
  const router = Router();

  router.get("/", async (_req: Request, res: Response) => {
    res.setHeader("Content-Type", PROMETHEUS_CONTENT_TYPE);
    res.status(200).send(await registry.metrics());
  });

  return router;
}
