import { describe, expect, it } from "vitest";
import cases from "../../testdata/download-validation.json";
import { RETRY } from "./errors";
import { REDACTED, SECRET_KEY_EXACT, SECRET_KEY_PARTS, redactText } from "./redact";

describe("constants shared with the Rust backend", () => {
  it("uses the retry timing in the shared file", () => {
    expect({ ...RETRY, delays: [...RETRY.delays] }).toEqual(cases.retry);
  });
  it("uses the same secret-name lists", () => {
    expect([...SECRET_KEY_PARTS]).toEqual(cases.secretKeys.parts);
    expect([...SECRET_KEY_EXACT]).toEqual(cases.secretKeys.exact);
  });
  for (const key of cases.secretKeys.redact) it(`redacts ?${key}=`, () => {
    const safe = redactText(`https://x/a?v=1&${key}=private`);
    expect(safe).toContain(REDACTED);
    expect(safe).not.toContain("private");
    expect(safe).toContain("v=1");
  });
  for (const key of cases.secretKeys.keep) it(`keeps ?${key}=`, () => expect(redactText(`https://x/a?${key}=public`)).toBe(`https://x/a?${key}=public`));
});
