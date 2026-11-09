import type { RequestHandler } from "express";

/**
 * Thin 202 handler for the roast-generation endpoint. All abuse/cost enforcement runs ahead of this
 * handler; the actual roast worker is out of scope for Story 89.
 */
export const submitRoastHandler: RequestHandler = (_req, res) => {
  res.status(202).json({ status: "accepted" });
};
