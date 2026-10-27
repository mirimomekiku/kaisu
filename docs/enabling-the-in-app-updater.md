# Switching on the in-app updater

Kaisu can install its own updates on Windows, but only after you give it a signing key. Until then it **announces** new
releases and links to the releases page, and nothing more. This guide takes you from that starting point to a working
"Install update" button.

## How it works, in short

1. You create a signing key pair once. The **private key** stays on your computer. The **public key** is built into Kaisu.
2. For every release you sign the Windows exe with the private key. The signature is a small `.sig` file published next to it.
3. When a user clicks **Install update**, Kaisu downloads the exe and the `.sig`, checks the signature against the public key
   inside the running program, and only then replaces itself.

Why this matters: the download comes from GitHub. If someone ever got control of your GitHub account or a release, they could
publish a malicious exe. They cannot produce a valid signature without your private key, so installed copies would refuse it.

What is signed: the version number and the SHA-256 of the exe. A signature for version 0.0.6 is therefore useless for any other
version or any other file.

## Before you start

- Node.js 20 or newer (the signing script uses Node's built-in crypto, nothing to install).
- A place to keep a secret file safely, such as a password manager.
- Your usual release setup from `CONTRIBUTING.md` (the Windows build and `gh release create`).

## Step 1: create the key pair (once)

From the repository root:

```bash
node scripts/release-sign.mjs keygen
```

It writes the private key to `~/.kaisu-update-key.pem` (on Windows, `C:\Users\<you>\.kaisu-update-key.pem`) and prints
something like:

```
Private key written to C:\Users\you\.kaisu-update-key.pem. Keep it secret and back it up; ...
Public key (paste into desktop/src-tauri/update-key.pub):
ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c
```

To keep the key somewhere else, pass a path: `node scripts/release-sign.mjs keygen D:\keys\kaisu.pem`. The script refuses to
overwrite an existing key file, so you cannot lose a key by running it twice.

**Back up the private key now.** Store a copy in your password manager or on an offline drive. Never put it in this repository,
in a release, or in chat. If it is lost, installed copies can no longer verify updates and users have to download new versions by
hand (see "Lost or leaked key" below).

## Step 2: put the public key into Kaisu

Open `desktop/src-tauri/update-key.pub`. It contains comment lines starting with `#`. Add the 64-character public key on its own
line, then save:

```
# Public key for verifying Kaisu updates: 64 hex characters on one line.
# ...
ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c
```

Rules: exactly 64 hex characters, one line, no spaces or quotes. A wrong value is treated as "no key", so the updater just stays
off instead of breaking. Commit this file:

```bash
git add desktop/src-tauri/update-key.pub
git commit -m "chore(updater): add the release public key"
```

The key is compiled into the program, so **it only takes effect in builds made after this commit.**

## Step 3: build and sign a release

Bump the version and build as described in `CONTRIBUTING.md` ("Releases"). Then name the file exactly as the updater expects and
sign it. The file name and the version you give to `sign` must both be right:

```bash
cp desktop/src-tauri/target/x86_64-pc-windows-msvc/release/desktop.exe kaisu-windows-x64.exe
node scripts/release-sign.mjs sign kaisu-windows-x64.exe 0.0.6
```

- Use the version **without** a leading `v` (`0.0.6`, not `v0.0.6`). It must match the release tag you publish (`v0.0.6`).
- The script reads the key from `~/.kaisu-update-key.pem`. If you stored it elsewhere, add the path as a third argument:
  `node scripts/release-sign.mjs sign kaisu-windows-x64.exe 0.0.6 D:\keys\kaisu.pem`.
- It creates `kaisu-windows-x64.exe.sig` next to the exe.

## Step 4: publish both files

Upload the exe **and** the signature, and do not mark the release as a prerelease:

```bash
git tag v0.0.6 && git push origin v0.0.6
gh release create v0.0.6 kaisu-windows-x64.exe kaisu-windows-x64.exe.sig --generate-notes
```

Two things commonly go wrong here:

- **`--prerelease`:** Kaisu finds the newest version through `https://github.com/mirimomekiku/kaisu/releases/latest`, which
  ignores prereleases. A prerelease is invisible to both the update notice and the updater.
- **Wrong file names:** the updater downloads exactly `kaisu-windows-x64.exe` and `kaisu-windows-x64.exe.sig` from
  `releases/download/v<version>/`. Any other name means "the release has no file".

## Step 5: the first update everyone has to do by hand

A copy of Kaisu can only verify updates if it was built **with** the public key. Builds from before Step 2 do not contain it, and
they will keep announcing updates without being able to install them. So:

1. Release a version built after Step 2 (this is the Step 3 and 4 release, for example 0.0.6).
2. Everyone downloads that one from the releases page and runs it as usual.
3. From then on, newer signed releases (0.0.7 and later) can be installed from inside the app.

## Step 6: test it before relying on it

The updater has only been tested with mocks and unit tests so far; a real run on Windows is the final check. The repository
address is built into the program, so a test means a real release:

1. Install the 0.0.6 build from Step 5 on a Windows machine, in a folder you can write to (for example `D:\Kaisu\`, not
   `C:\Program Files`).
2. Make a small change, bump to 0.0.7, build, sign and publish it as in Steps 3 and 4.
3. In Kaisu 0.0.6, open Settings and choose **Check Kaisu for updates**. You should see "Kaisu 0.0.7 is available" and an
   **Install update** button.
4. Click it. You should see progress, then "Kaisu 0.0.7 is installed. Restart to start using it."
5. Click **Restart Kaisu**. The new version should open by itself. Check Settings or the title for 0.0.7.
6. Look in the folder: `kaisu.exe.old` (the previous version) is removed the next time Kaisu starts.

Also try the failure path once: publish a release whose `.sig` was made for a different version (for example sign `0.0.8` but
publish it as `v0.0.9`). Kaisu should refuse with "The update's signature did not match, so it was not installed." and leave the
running program untouched.

## What users see

| Situation | What happens |
| --- | --- |
| Build without a public key | "See what's new" only (opens the releases page). |
| Build with a key, Windows | "Install update" plus "See what's new". |
| Linux | "See what's new" only. Self-updating is Windows-only for now. |
| Downloads are running | Install is refused: "Wait for running downloads to finish before updating." |
| Kaisu is in a read-only folder (such as Program Files) | The install fails with a clear message; the releases page still works. |
| Signature missing, wrong or for another version | Nothing is installed; the downloaded file is deleted. |
| Install finished | The app keeps running. The new version starts only when the user clicks **Restart Kaisu**. |

## Turning it off again

- **For one build:** empty `desktop/src-tauri/update-key.pub` back to comments only and rebuild. That build only announces updates.
- **For users:** Settings has "Tell me when a new version of Kaisu is out". Switching it off stops the daily check. Nothing is
  ever installed unless the user chooses Install update.

## Lost or leaked key

- **Lost, but not leaked:** you can no longer sign updates the installed copies will accept. Create a new key (Step 1), put its
  public key in `update-key.pub`, and release a new version. Everyone installs that one by hand once (as in Step 5); after that
  in-app updates work again.
- **Leaked:** treat it like a lost key, and do it quickly. Anyone with the key can sign an update that existing installs will
  accept. A leaked key cannot be revoked remotely, so the fix is a new key and a hand-installed release, and telling users.

## Rotating a key on purpose

Installed copies only trust the key they were built with. To change keys without stranding users, release one more version
signed with the **old** key whose build contains the **new** public key. Once users have installed that, later releases can be
signed with the new key.

## Security notes

- Keep the private key off GitHub, off shared drives and out of build logs. Signing needs it only on the machine where you run
  `release-sign.mjs sign`.
- The signature protects against a tampered download or a compromised release page, not against a compromised signing computer.
- Kaisu is not signed with a Windows code-signing certificate. Windows SmartScreen may still warn about unsigned exes; that is
  separate from this updater signature.
- The release lookup, the file name and the size limit (300 MB) are fixed in `desktop/src-tauri/src/app_update.rs`.

## Troubleshooting

| Message or symptom | Likely cause and fix |
| --- | --- |
| No "Install update" button | The build has no public key, or it is not Windows, or the release is a prerelease. Check `update-key.pub` and the release page. |
| "The release has no kaisu-windows-x64.exe" | The release assets are named differently. Rename and re-upload. |
| "The release has no signature file" | The `.sig` was not uploaded. Run the `sign` command and add it to the release. |
| "The update's signature did not match" | Signed with a different key, for a different version, or the exe changed after signing. Sign the final exe again. |
| "A different release is now the newest" | A newer release appeared during the download. Check for updates again. |
| "Kaisu can't write to its own folder" | Move Kaisu to a folder your account can write to, or install the update by hand. |
| "Wait for running downloads to finish" | Pause or finish downloads, then try again. |
| Restart does nothing | The old process may still be closing; wait a few seconds. If it persists, start `kaisu.exe` yourself; the update is already in place. |

## Quick checklist

- [ ] `node scripts/release-sign.mjs keygen` run once, private key backed up.
- [ ] Public key committed in `desktop/src-tauri/update-key.pub` **before** building the release.
- [ ] Windows exe copied to `kaisu-windows-x64.exe`.
- [ ] `node scripts/release-sign.mjs sign kaisu-windows-x64.exe <version>` run, `.sig` created.
- [ ] Release published with **both** files and **not** as a prerelease.
- [ ] Tested an update from the previous signed version on Windows.
