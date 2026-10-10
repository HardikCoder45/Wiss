# OmniX Wiss release signing

The application code can configure signing, hardened runtime, notarization, and verification, but it cannot manufacture platform trust. Public installers must be signed with certificates issued to the publisher.

## macOS: remove the unidentified-developer / Gatekeeper warning

A public direct-download macOS build requires all of the following:

1. An active Apple Developer Program membership.
2. A **Developer ID Application** signing identity. An `Apple Development` identity is for development and is not sufficient for public Developer ID distribution.
3. Hardened Runtime enabled (already configured in `electron-builder.config.cjs`).
4. Apple notarization credentials.
5. The notarization ticket stapled/validated and Gatekeeper assessment passing.

### Supported signing inputs

Either install the Developer ID Application certificate in the release Mac keychain, or provide an exported signing identity to electron-builder:

```text
CSC_LINK
CSC_KEY_PASSWORD
```

For notarization, configure one of these methods.

Apple ID method:

```text
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID
```

App Store Connect API key method:

```text
APPLE_API_KEY
APPLE_API_KEY_ID
APPLE_API_ISSUER
```

Do not commit credential values to Git.

### Build and verify

```bash
npm run model:verify
npm run preflight:mac
npm run dist:mac
REQUIRE_NOTARIZED=1 npm run verify:mac
```

`npm run dist:mac` sets `REQUIRE_CODE_SIGNING=1` inside the cross-platform release wrapper. This changes electron-builder from local ad-hoc signing to required distribution signing + notarization. The build fails rather than silently producing an unsigned release if signing is unavailable.

A successful public release must pass:

```bash
codesign --verify --deep --strict --verbose=2 "/path/to/OmniX Wiss.app"
spctl --assess --type execute --verbose=4 "/path/to/OmniX Wiss.app"
xcrun stapler validate "/path/to/OmniX Wiss.app"
```

The included `scripts/verify-macos-artifact.mjs` performs these checks for the packaged app; strict Gatekeeper/stapler enforcement is enabled with `REQUIRE_NOTARIZED=1`.

### Current workstation state

At the time this project was prepared, the workstation had an `Apple Development` identity but **no Developer ID Application identity and no notarization credentials**. The locally generated DMG is therefore an ad-hoc test build. It is expected to fail public Gatekeeper assessment. This is a credential/trust-chain limitation, not an Electron code setting that can be bypassed safely.

## Windows: Authenticode and SmartScreen

A public Windows release should be Authenticode-signed. Configure:

```text
WIN_CSC_LINK
WIN_CSC_KEY_PASSWORD
```

`CSC_LINK` / `CSC_KEY_PASSWORD` are also accepted by the release preflight.

Then run on Windows:

```powershell
npm run model:verify
npm run preflight:win
npm run dist:win
Get-AuthenticodeSignature "dist/release/OmniX Wiss-0.1.0-win-x64.exe" | Format-List
```

The signature status must be `Valid` before publication.

Authenticode signing establishes publisher identity and package integrity. Microsoft SmartScreen may still show reputation-based warnings for a new publisher/certificate until reputation is established; there is no legitimate application-code flag that guarantees immediate SmartScreen reputation.

### Current workstation state

No Windows code-signing certificate was supplied. The locally generated NSIS `.exe` is therefore an unsigned test artifact. The release preflight correctly blocks a production release without Authenticode credentials.

## GitHub Actions release workflow

`.github/workflows/release.yml` contains separate macOS arm64 and Windows x64 release jobs. Configure repository secrets before using it:

### macOS secrets

```text
MAC_CSC_LINK
MAC_CSC_KEY_PASSWORD
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID
```

Or use the App Store Connect API-key notarization variables supported by the workflow/configuration.

### Windows secrets

```text
WIN_CSC_LINK
WIN_CSC_KEY_PASSWORD
```

For tag builds (`v*`), the workflow waits for both platform jobs, verifies platform trust, and only then publishes the artifacts to the GitHub Release.

## Local test artifacts

These are development artifacts only until they are rebuilt through the production signing path:

```text
dist/release/OmniX Wiss-0.1.0-mac-arm64.dmg
dist/release/OmniX Wiss-0.1.0-win-x64.exe
```

Verified hashes for the current local builds:

```text
cec7570b9bfab4ab4dafbdd204b836c58fbe96670a66d11c385cdbcf0b806330  OmniX Wiss-0.1.0-mac-arm64.dmg
4f8c2d87ba8400e45ba67df3baf1ac8258850d5fe3c99cd0c4e8b39c46870cb4  OmniX Wiss-0.1.0-win-x64.exe
```

Rebuilding changes artifact hashes; publish fresh checksums with every release.
