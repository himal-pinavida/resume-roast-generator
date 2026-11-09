import { describe, expect, it } from "vitest";
import {
  safeErrorSerializer,
  summarizeError,
} from "../../src/logger/error-serializer.js";

describe("safeErrorSerializer", () => {
  it("emits only type, message, stack, and code from a real Error", () => {
    const error = new SyntaxError("unexpected token");
    Object.assign(error, {
      status: 400,
      statusCode: 400,
      expose: true,
      body: '{"resumeText":"John Doe 555-123"} BAD',
    });

    expect(safeErrorSerializer(error)).toEqual({
      type: "SyntaxError",
      message: "unexpected token",
      stack: error.stack,
    });
    expect(JSON.stringify(safeErrorSerializer(error))).not.toContain("John Doe");
    expect(JSON.stringify(safeErrorSerializer(error))).not.toContain("resumeText");
  });

  it("handles the pino-std-serializers reduced object pino-http passes through", () => {
    const reduced = {
      type: "SyntaxError",
      message: "unexpected token",
      stack: "SyntaxError: unexpected token",
      expose: true,
      statusCode: 400,
      body: '{"phone":"555-123"} BAD',
      raw: {},
    };

    const serialized = safeErrorSerializer(reduced);
    expect(serialized).toEqual({
      type: "SyntaxError",
      message: "unexpected token",
      stack: "SyntaxError: unexpected token",
    });
    expect(JSON.stringify(serialized)).not.toContain("555-123");
    expect(JSON.stringify(serialized)).not.toContain("body");
    expect(JSON.stringify(serialized)).not.toContain("raw");
  });

  it("preserves an allow-listed code when present", () => {
    const error = Object.assign(new Error("boom"), { code: "ECONNREFUSED" });
    expect(safeErrorSerializer(error)).toMatchObject({ code: "ECONNREFUSED" });
  });

  it("summarizeError returns the same controlled summary", () => {
    const error = Object.assign(new Error("boom"), {
      body: '{"captchaToken":"captcha-token-xyz"} BAD',
    });
    expect(summarizeError(error)).toEqual(safeErrorSerializer(error));
    expect(JSON.stringify(summarizeError(error))).not.toContain("captcha-token-xyz");
  });
});
