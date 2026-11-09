/**
 * Centralised, typed configuration. Read once at boot from the environment with safe defaults so
 * the service runs out of the box in development; real secrets only ever arrive via the environment
 * (see `apps/api/.env.example`).
 */
export interface AppConfig {
  port: number;
  nodeEnv: string;
  logLevel: string;
  piiHashKey: string;
  metricsEnabled: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";

  // In any non-development environment a stable subject-hash key is a hard requirement. Failing
  // fast here is deliberate: silently hashing with a fallback key would make historical hashes
  // useless when the secret is eventually supplied.
  if (nodeEnv !== "development" && !env.PII_HASH_KEY) {
    throw new Error(
      "PII_HASH_KEY is required outside development. Set a long random HMAC key and restart.",
    );
  }

  return {
    port: parsePort(env.API_PORT),
    nodeEnv,
    logLevel: env.LOG_LEVEL ?? "info",
    piiHashKey: env.PII_HASH_KEY ?? "dev-only-change-me",
    metricsEnabled: parseBoolean(env.METRICS_ENABLED, true),
  };
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return 4123;
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`API_PORT must be a valid TCP port; received "${raw}".`);
  }
  return port;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  return raw.toLowerCase() !== "false";
}
