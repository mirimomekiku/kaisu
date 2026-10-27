import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import { privateKeyFromSeed, publicHex, signFile, signedMessage } from "./release-sign.mjs";

const key = privateKeyFromSeed(Buffer.alloc(32, 7));

test("a signature verifies over the version and the file digest", () => {
  const signature = Buffer.from(signFile(Buffer.from("program"), "0.0.6", key), "hex");
  const digest = createHash("sha256").update("program").digest();
  const publicKey = createPublicKey(key);
  assert.ok(verify(null, signedMessage("0.0.6", digest), publicKey, signature));
  assert.ok(!verify(null, signedMessage("0.0.7", digest), publicKey, signature), "another version");
  assert.ok(!verify(null, signedMessage("0.0.6", createHash("sha256").update("other").digest()), publicKey, signature), "another file");
});
test("the public key is 64 hex characters", () => assert.match(publicHex(key), /^[0-9a-f]{64}$/));
test("only plain versions are signed", () => {
  for (const bad of ["v0.0.6", "0.0.6-beta", "", "1.2.3.4.5"]) assert.throws(() => signFile(Buffer.from("x"), bad, key), /version/);
});
// The Rust updater checks this exact vector (see app_update.rs), so the two implementations cannot drift apart.
test("known vector", () => {
  assert.equal(publicHex(key), "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c");
  assert.equal(signFile(Buffer.from("program"), "0.0.6", key), "6e0da9f31847314487459f618f802301398dae423d0b46b7c50d417b07bbf89ed09b33ebda9bfac7f7c206d1f6639294feab5e0dc4ce3af0b44dc95bbeccbe08");
});
