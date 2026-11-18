# Lumen AI Studio — AI tools inside Illustrator

**Lumen** is a dockable [CEP](https://github.com/Adobe-CEP/CEP-Resources) panel for Adobe Illustrator (v25 → v29, i.e. 2021 → 2025) that adds five AI-powered capabilities beyond the usual text-to-image box:

| Tab | What it does | Needs an API key? |
|---|---|---|
| **Palette Muse** | Extracts the dominant colors of any reference image (offline k-means) and remaps the fills of your selected artwork, dark→light onto dark→light. | No — fully offline |
| **Pattern Dream** | Renders a seamless-style surface from a text prompt and places it on the `Lumen AI` layer. | Yes (image model) |
| **Artboard Critique** | Exports the active artboard as PNG, sends it to a vision model, and returns a structured critique (composition / contrast / typography / brand / WCAG). | Yes (vision model) |
| **Copywriter** | Drafts N headline options from a brief + tone; "Use" writes one straight into your selected text frame (or creates a new one). | Yes (chat model) |
| **Vector Muse** | Generates raw SVG from a prompt, sanitizes it, and places it as scalable vector on the artboard. | Yes (chat model) |

Works with **any OpenAI-compatible endpoint** — OpenAI, Azure OpenAI, OpenRouter, LM Studio, Ollama — plus direct **Stability AI** for image generation. No keys are bundled or hard-coded; you enter your own in **Settings** and they are stored per-user, outside the extension source (see [SECURITY.md](docs/SECURITY.md)).

---

## Install (development / unsigned)

Illustrator won't load unsigned panels until `PlayerDebugMode` is set. The scripts do both steps:

**Windows**
```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\install-dev.ps1"
```

**macOS**
```bash
./scripts/install-dev.sh
```

Then restart Illustrator → **Window → Extensions → Lumen AI Studio**.

To uninstall: delete `lumen-ai-studio` from the CEP extensions folder (`%APPDATA%\Adobe\CEP\extensions` on Windows, `~/Library/Application Support/Adobe/CEP/extensions` on macOS) and set `PlayerDebugMode` back to `0`.

## Package (signed .zxp)

Distribution requires a code-signing certificate (or self-signed cert for internal testing). With [ZXPSignCmd](https://github.com/Adobe-CEP/CEP-Resources/tree/master/ZXPSignCMD) on PATH:

```powershell
.\scripts\package-zxp.ps1 -ZxpSignCmd ZXPSignCmd.exe -CertPfx cert.pfx -CertPassword 'secret'
```

Result: `build/LumenAIStudio-v1.0.0.zxp`. Install by double-clicking the .zxp with Creative Cloud desktop installed (UPIA installs it); signed packages need no PlayerDebugMode. Always sign with a timestamp (`-tsa`) or the package stops installing when the cert expires. Avoid symlinks/node_modules in the payload (known CEP 11/12 issue: blank panels after install) — this extension has no npm dependencies. Note: Extension Manager / ExManCmd is end-of-life — do not use it for the demo.

> Plain-text guide (install + full interface walkthrough): [`docs/LUMEN-AI-STUDIO-GUIDE.txt`](docs/LUMEN-AI-STUDIO-GUIDE.txt) — also shipped inside `LumenAIStudio-v1.0.0.zip`.

Remove the dev copy from the per-user CEP folder (or set PlayerDebugMode back to 0) before evaluating a signed build — otherwise the unsigned shadow copy wins.

## Configure an AI provider

1. Open the panel → **Settings**.
2. Pick a provider preset (e.g. `OpenAI`). Base URL and sensible default models fill in; adjust if you use Azure/OpenRouter/local.
3. Paste your API key → **Save** → **Test connection**. The dot in the header turns green on success.
4. **Clear keys** removes the stored key at any time.

### Provider notes
- **OpenAI** — chat/vision default `gpt-4o`; image default `gpt-image-2.5-flare`. (Note: `dall-e-*` and `gpt-image-1` were shut down in 2026; GPT Image models always return base64 PNG, no `response_format` needed.)
- **OpenRouter** — set your OpenRouter key; model slugs like `openai/gpt-4o`. Text/vision work; OpenRouter's image route is a different shape, so prefer the OpenAI or Stability preset for Pattern Dream.
- **Azure OpenAI** — the v1 API (GA Aug 2025) is the default path: Base URL `https://<resource>.openai.azure.com/openai/v1`, Chat/Vision/Image model = your **deployment** names, auth via `api-key` header automatically. No `api-version` needed.
- **LM Studio / Ollama** — local chat/vision work (Ollama default `qwen3-vl:8b`; any non-empty key is accepted). LM Studio's `/v1` base URL is community-documented; verify on your install. Image generation is not offered by these presets — the panel says so instead of failing obscurely.
- **Stability AI** — images only, via **Stable Image Core** (`/v2beta/stable-image/generate/core`, multipart form-data, `Accept: application/json`). Base URL stays `https://api.stability.ai`. Test connection checks your credit balance (no credits spent).

## Project layout

```
lumen-ai-studio/
├─ index.html            # panel markup (seven tabs — last is About)
├─ css/panel.css         # native-dark styling, tokens only
├─ js/
│  ├─ CSInterface.js     # Adobe's official bridge (Apache-2.0, from Adobe-CEP/CEP-Resources)
│  ├─ node-helper.js     # Node/fs helpers: config storage, temp files, base64
│  ├─ api.js             # dependency-free OpenAI-compatible HTTPS client (http/https only)
│  └─ panel.js           # UI logic, k-means, host dispatch
├─ jsx/lumen.jsx         # ExtendScript host: export PNG, place files, recolor, write text
├─ CSXS/manifest.xml     # CEP bundle manifest (downloads target v25–v29)
├─ .debug                # remote-debug ports for unsigned development
├─ icons/                # panel icons (23/46/96 px, gradient "L")
├─ scripts/              # install-dev (win/mac), package-zxp
├─ docs/                 # LUMEN-AI-STUDIO-GUIDE.txt, ARCHITECTURE, USER_GUIDE, SECURITY, DEMO
└─ tests/                # headless sanity checks (see tests/README.md)
```

## Development

No build step — edit and reinstall. For unsigned dev, `.debug` exposes the panel at `localhost:8088` (Chrome/Edge DevTools via the CEP remote inspector). Illustrator CEP uses the CEF engine; `console.log` output lands in that inspector. CEP logs on host load failures: `%TEMP%\CEP<ver>-ILST.log` (Windows) or `~/Library/Logs/CSXS/CEP<ver>-ILST.log` (macOS).

Run the checks (syntax, manifest XML, host logic against a mocked Illustrator DOM, HTTPS client against a mock gateway):

```bash
node tests/sanity-check.js
node tests/host-mock-test.js
node tests/api-smoke-test.js
```

## Troubleshooting
- **Panel missing from Window → Extensions** — `PlayerDebugMode` not set, or Illustrator wasn't restarted after install.
- **"Node bridge MISSING"** — host blocked Node integration; ensure the manifest sets `--enable-nodejs=true` (it does) and that you're on CEP ≥ 6.
- **HTTP 401/404 from your endpoint** — wrong Base URL for your provider (Azure needs the full deployment path) or the key lacks access to the model. The full upstream body is echoed in the toast/status bar.
- **Palette apply does nothing** — selection must contain items with **RGB fills** (gradients/placed rasters are skipped).
- **Critique is slow** — it exports the artboard and uploads it; use a smaller artboard or a faster vision model.

## Requirements & compatibility
- Illustrator **v25 (2021) through v29 (2025)**, Windows and macOS.
- **CEP vs UXP roadmap:** CEP panels still load in Illustrator 2021–2025. Adobe has announced Illustrator UXP plugins for Q4 2027 (GA), with the Creative Cloud marketplace dropping new CEP submissions ~Dec 2028 and cross-product CEP removal in Dec 2029 — this extension uses CEP deliberately (it is the only option covering v25–v29 today), structured so a UXP port is mechanical (all Node usage is behind `node-helper.js`, all host calls behind `hostCall()`).
- Works in both light and dark UI themes (panel chrome is theme-agnostic dark, matching Illustrator defaults).
- Internet access only to the Base URL you configure — see [SECURITY.md](docs/SECURITY.md).

## License
Extension source: Apache-2.0. **CSInterface.js © Adobe Systems Incorporated**, redistributed from [Adobe-CEP/CEP-Resources](https://github.com/Adobe-CEP/CEP-Resources) under Adobe's CEP license (it is not Apache-2.0; the Adobe header is retained in the file and must not be altered). Your artwork and API keys remain yours.
