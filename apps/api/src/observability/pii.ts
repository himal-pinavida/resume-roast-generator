import { createHmac } from "node:crypto";

export type SubjectHasher = (value: string) => string;

/**
 * Deterministic, keyed HMAC-SHA256 subject hash for identifiers such as client IPs. The raw input is
 * never returned or logged; the stable `h_` prefix makes hashed subjects easy to distinguish from
 * other opaque ids. Résumé content must never be passed through this helper.
 */
export function hashSubject(value: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(value, "utf8").digest("hex");
  return `h_${digest}`;
}

/** Binds the configured PII_HASH_KEY once at composition time. */
export function createSubjectHasher(secret: string): SubjectHasher {
  return (value: string): string => hashSubject(value, secret);
}
