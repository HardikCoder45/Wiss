# Wiss

> **Private, local voice-to-text for macOS.**

<p align="center">
  <img src="public/logo.svg" alt="OmniX Wiss logo" width="180" />
</p>

> The OmniX Wiss logo is the application brand used in the packaged macOS app, replacing the previous workflow illustration so the README matches the product.

Wiss is a fast, local-first alternative to cloud dictation apps such as Wispr Flow. Hold one shortcut, speak naturally, and the transcription is inserted where your cursor is—without sending recordings to a cloud service.

## Why Wiss

- **Private by default** — transcription runs on your Mac.
- **Fast insertion** — capture a thought and send text straight to the active app.
- **System-wide workflow** — works wherever you can type.
- **Model-managed locally** — downloads and verifies its speech model when needed.
- **Built for Mac** — menu-bar presence, global shortcut, microphone/accessibility guidance, and packaged `.app` distribution.

## Product flow

1. Open **OmniX Wiss** from the menu bar.
2. Grant microphone and accessibility permissions when macOS prompts.
3. Hold the configured shortcut to dictate.
4. Release it to transcribe and insert text into the focused application.

## Landing site

A standalone product site lives in [`landing/`](landing/). Its dimensional voice core is rendered with native WebGL, while GSAP handles the small interface transitions. The production bundle stays under 100 KB of JavaScript before gzip and does not ship a 3D framework or model asset.

```bash
cd landing
npm install
npm run dev
```

For a production bundle:

```bash
npm run build
```

## Desktop development

Requirements:

- macOS 13+
- Node.js 20+
- Microphone permission
- Accessibility permission (for system-wide text insertion)

```bash
npm install
npm run dev
```

Validation:

```bash
npm test -- --run
npm run build
```

## Build the macOS app

```bash
npm run preflight:mac
npm run dist:mac
npm run verify:mac
```

The packaged application is produced under `dist/release/mac-arm64/OmniX Wiss.app`. This local build is unsigned unless a Developer ID certificate is configured; macOS may require an explicit first-open confirmation.

## Privacy

Wiss is designed around local inference. Audio is processed on-device by the local speech stack; the application does not require an account or a hosted transcription API to dictate text.

## Project structure

```text
src/                 Electron main process, preload bridge, and renderer
native/              Native macOS helper implementation
resources/           Local model and runtime resources
landing/             GSAP-powered product landing page
docs/assets/         README/product visuals
scripts/             Release verification helpers
```

## Release checks

The release process validates the packaged bundle and its required local resources. Run `npm run verify:mac` after packaging before distributing the `.app`.

---

Built for people who think faster than they type.
