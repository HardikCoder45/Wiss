# Landing asset manifest

| Asset | Owner and source | Usage right | Delivery | Budget and fallback |
| --- | --- | --- | --- | --- |
| `public/logo.svg` | OmniX Wiss product artwork from this repository | Project-owned | Inline-sized SVG served by Vite | 2 KB; the wordmark remains readable if images are disabled |
| Voice core | Original procedural WebGL shader in `src/main.js` | Project-owned | Generated in the browser; no model or texture download | No asset payload; CSS halo remains if WebGL initialization fails |
| Typography | Manrope and DM Mono from Google Fonts | SIL Open Font License | CSS font request with system fallbacks | Page remains readable with the local fallback stack |

No stock photography, third-party 3D model, video, or generated provider URL is used.
