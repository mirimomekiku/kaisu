#!/usr/bin/env node
// Signs a Kaisu release file so installed copies can verify it before updating themselves.
//
//   node scripts/release-sign.mjs keygen [key-file]            create a key pair (private key stays outside the repository)
//   node scripts/release-sign.mjs sign <file> <version> [key-file]   write <file>.sig for that version
//
// The signature covers the version and the file's SHA-256: "kaisu-update-v1\0" + version + "\0" + digest (Ed25519).
// desktop/src-tauri/update-key.pub holds the matching public key (64 hex characters).
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_KEY = join(homedir(), ".kaisu-update-key.pem");
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export function signedMessage(version, digest) {
  return Buffer.concat([Buffer.from("kaisu-update-v1\0"), Buffer.from(version), Buffer.from([0]), digest]);
}
export function privateKeyFromSeed(seed) { return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: "der", type: "pkcs8" }); }
export function publicHex(privateKey) { return createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(-32).toString("hex"); }
export function signFile(bytes, version, privateKey) {
  if (!/^\d+(\.\d+){0,3}$/.test(version)) throw new Error("The version must look like 0.0.5 (no leading v).");
  return sign(null, signedMessage(version, createHash("sha256").update(bytes).digest()), privateKey).toString("hex");
}

function main([command, ...args]) {
  if (command === "keygen") {
    const file = args[0] ?? DEFAULT_KEY;
    if (existsSync(file)) throw new Error(`${file} already exists; refusing to overwrite a signing key.`);
    const { privateKey } = generateKeyPairSync("ed25519");
    writeFileSync(file, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600, flag: "wx" });
    console.log(`Private key written to ${file}. Keep it secret and back it up; losing it means installed copies can no longer update themselves.`);
    console.log(`Public key (paste into desktop/src-tauri/update-key.pub):\n${publicHex(privateKey)}`);
  } else if (command === "sign") {
    const [file, version, keyFile = DEFAULT_KEY] = args;
    if (!file || !version) throw new Error("Usage: release-sign.mjs sign <file> <version> [key-file]");
    const signature = signFile(readFileSync(file), version, createPrivateKey(readFileSync(keyFile)));
    writeFileSync(`${file}.sig`, `${signature}\n`);
    console.log(`Wrote ${file}.sig for version ${version}. Upload both files to the release.`);
  } else {
    throw new Error("Usage: release-sign.mjs keygen [key-file] | sign <file> <version> [key-file]");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
}
