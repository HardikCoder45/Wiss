# Runtime-downloaded models

OmniX Wiss does not bundle speech weights in this repository or in packaged installers.

On first launch the application downloads the tier that `src/main/capabilities.ts` selects for the detected hardware. Apple Silicon gets the MLX conversions, everything else the q4 ONNX conversions. Repos and pinned revisions live in `src/main/models.ts`; download state, resume, and per-backend cache paths are managed by `src/main/whisper-model.ts` and `src/main/whisper-worker.ts`.

Tiers side by side in the cache: `mlx/<model-key>/` and `onnx/<model-key>/`, each guarded by a `ready.json` marker.

Every MLX repo listed in `src/main/models.ts` must ship `weights.npz` — that is the only weight filename the bundled PyInstaller runner loads. Newer conversions that ship `model.safetensors` (including `whisper-large-v3-turbo-4bit`) cannot be used until that runner is rebuilt.
