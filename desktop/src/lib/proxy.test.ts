import { describe, expect, it } from "vitest";
import { joinProxyPassword, maskProxyPassword, splitProxyPassword } from "./proxy";

describe("splitProxyPassword", () => {
  it("takes the password out and keeps the user", () => {
    expect(splitProxyPassword("socks5://me:secret@10.0.0.1:1080")).toEqual({ address: "socks5://me@10.0.0.1:1080", password: "secret" });
    expect(splitProxyPassword("  http://me:p%40ss@proxy.local:8080 ")).toEqual({ address: "http://me@proxy.local:8080", password: "p%40ss" });
  });

  it("works without a scheme", () => {
    expect(splitProxyPassword("me:secret@host:3128")).toEqual({ address: "me@host:3128", password: "secret" });
  });

  it("reads the login up to the last @", () => {
    expect(splitProxyPassword("http://me:p@ss@host:1")).toEqual({ address: "http://me@host:1", password: "p@ss" });
  });

  it("leaves addresses without a password alone", () => {
    for (const a of ["", "host:8080", "http://host:8080", "socks5://me@host:1080", "socks5://me:@host:1080", "http://@host"]) {
      expect(splitProxyPassword(a)).toEqual({ address: a, password: null });
    }
  });
});

describe("joinProxyPassword", () => {
  it("puts the password back for a user", () => {
    expect(joinProxyPassword("socks5://me@10.0.0.1:1080", "secret")).toBe("socks5://me:secret@10.0.0.1:1080");
    expect(joinProxyPassword("me@host:3128", "x")).toBe("me:x@host:3128");
  });

  it("does nothing when there is no user, no password, or already a password", () => {
    expect(joinProxyPassword("socks5://host:1080", "secret")).toBe("socks5://host:1080");
    expect(joinProxyPassword("socks5://me@host:1080", "")).toBe("socks5://me@host:1080");
    expect(joinProxyPassword("socks5://me:old@host:1080", "new")).toBe("socks5://me:old@host:1080");
  });

  it("is the exact reverse of splitting", () => {
    for (const a of ["socks5://me:secret@10.0.0.1:1080", "http://me:p%40ss@proxy.local:8080", "me:secret@host:3128", "http://me:p@ss@host:1"]) {
      const { address, password } = splitProxyPassword(a);
      expect(joinProxyPassword(address, password!)).toBe(a);
    }
  });
});

describe("maskProxyPassword", () => {
  it("hides the password and nothing else", () => {
    expect(maskProxyPassword("socks5://me:secret@host:1080")).toBe("socks5://me:***@host:1080");
    expect(maskProxyPassword("socks5://host:1080")).toBe("socks5://host:1080");
    expect(maskProxyPassword("socks5://me@host:1080")).toBe("socks5://me@host:1080");
  });
});
