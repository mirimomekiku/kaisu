import { describe, expect, it } from "vitest";
import cases from "../../testdata/custom-argument-redaction.json";
import { customSecretValues, persistedDownload, redactCustomText } from "./redact";

describe("sensitive custom argument payloads", () => {
  for (const [i, fixture] of cases.entries()) it(`redacts command and parsed diagnostics for shared fixture ${i}`, () => {
    const values = customSecretValues(fixture.args);
    const diagnostic = redactCustomText(fixture.text, values);
    const command = redactCustomText(fixture.args, values);
    for (const secret of fixture.secrets) {
      expect(diagnostic).not.toContain(secret);
      expect(command).not.toContain(secret);
    }
    for (const publicText of fixture.keep) expect(diagnostic).toContain(publicText);
    const saved = persistedDownload({ url: "https://example.com/video", extra: { proxy: null, custom_args: fixture.args, credentials_required: false } });
    expect(saved.extra.custom_args).toBe("[REDACTED]");
    expect(saved.extra.credentials_required).toBe(true);
    expect(fixture.args).not.toContain("[REDACTED]");
  });

  it("preserves ordinary arguments and handles quoted escapes without evaluation", () => {
    expect(customSecretValues("--limit-rate 500K --embed-chapters")).toEqual([]);
    const values = customSecretValues('--add-headers "X-Custom: private\\\"quote"');
    expect(values).toContain('private"quote');
    expect(redactCustomText('header private"quote', values)).not.toContain('private"quote');
    expect(customSecretValues('--referer "unterminated')).toEqual([]);
  });
});
