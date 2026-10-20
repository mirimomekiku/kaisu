import { describe, expect, it } from "vitest";
import { checkAudioQuality, checkProxy, checkSpeedLimit, checkTag } from "./validate";

describe("validate", () => {
  it("accepts good proxies and explains bad ones", () => {
    for (const ok of ["", "127.0.0.1:8080", "socks5://127.0.0.1:1080", "http://user:pw@host:3128", "https://proxy.example.com"]) expect(checkProxy(ok), ok).toBeNull();
    for (const bad of ["ftp://x", "http://", "has space:1", "http://host/path", "socks5://host:0", "://x"]) expect(checkProxy(bad), bad).not.toBeNull();
  });

  it("checks speed limits", () => {
    for (const ok of ["", "500K", "2M", "1.5m", "300"]) expect(checkSpeedLimit(ok), ok).toBeNull();
    for (const bad of ["fast", "-5M", "0", "1G", "5 M"]) expect(checkSpeedLimit(bad), bad).not.toBeNull();
  });

  it("checks audio quality", () => {
    for (const ok of ["", "0", "9", "192K", "32k", "512K"]) expect(checkAudioQuality(ok), ok).toBeNull();
    for (const bad of ["10", "31K", "513K", "abc", "128"]) expect(checkAudioQuality(bad), bad).not.toBeNull();
  });

  it("checks tags", () => {
    expect(checkTag("year", "2024")).toBeNull();
    expect(checkTag("year", "24")).not.toBeNull();
    expect(checkTag("track", "7")).toBeNull();
    expect(checkTag("track", "0")).not.toBeNull();
    expect(checkTag("track", "07")).not.toBeNull();
    expect(checkTag("text", "x".repeat(201))).not.toBeNull();
  });
});
