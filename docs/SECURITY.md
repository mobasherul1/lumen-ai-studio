# Security — keys, data flow, and what to check before shipping

## Storing credentials

- API keys are entered only in **Settings** and stored in `config.json` inside CEP's per-user data folder (`SystemPath.USER_DATA/lumen-ai-studio/`), with file mode `0600` on POSIX systems.
- **The file is plaintext.** Anyone with read access to your user profile can read the key. CEP offers no built-in encrypted vault; if your threat model requires at-rest secrecy, upgrade `node-helper.js#writeConfig` to: (a) Windows DPAPI (`node-dpapi` / `edge-js` native module — note: native modules are unsupported inside CEP, so use a small helper app outside the panel instead), (b) macOS Keychain via the `security` CLI, or (c) AES-256-GCM with a machine-derived key (better than nothing; the key still sits next to the ciphertext). The panel API stays identical either way — only the two functions change.
- The extension **source tree and the .zxp contain no keys** — verify before distributing:

  ```powershell
  Get-ChildItem -Recurse -File | Select-String -Pattern 'sk-|api_key|AIza|Bearer'
  ```

  (expect no matches in source files).
- **Clear keys** deletes the stored key for the active provider.
- `.gitignore` excludes `config.json` and `.env` as belt-and-braces.

## What is sent where

| When | Payload | Destination |
|---|---|---|
| Test connection | 1-token chat ping (Stability: credit balance read) | Base URL you configured |
| Pattern Dream | Text prompt | Base URL (+ `imagePath`) |
| Artboard Critique | Base64 PNG of the **active artboard only** | Base URL (chat/vision) |
| Copywriter | Brief + tone text | Base URL (chat) |
| Vector Muse | Description text | Base URL (chat) |
| Palette Muse | **nothing** (offline) | — |

No telemetry, no analytics, no third-party CDNs — the panel loads zero remote scripts/styles/fonts.

## Hardening already in place

- Panel ships a strict `Content-Security-Policy` meta tag (`default-src 'self'`, `connect-src 'self'`; all HTTP goes through Node, not the renderer).
- `Vector Muse` SVG output is sanitized before placement: rejects `<script>`, `<foreignObject>`, `<iframe>`, `javascript:` URLs and inline `on*=` handlers; only the first `<svg>…</svg>` is kept.
- All HTTP errors surface the (truncated) upstream body — keys never appear in error text; our client does not log request headers.
- ExtendScript host functions never `eval` model output; the only `eval` path is the JSON fallback for *our own* palette payload on hosts without a native JSON object (none in v25+).
- Temp files (artboard PNG, generated images/SVG) are written to the OS temp dir; they contain no secrets (artboard pixels may contain confidential design — delete `%TEMP%/lumen-ai-studio` if required by policy).

## Before distributing a signed build

1. Rotate/remove your dev keys from the machine that builds the .zxp (keys never enter the package anyway).
2. Zip/manifest review — the package must not include `docs/`, `.git`, or dev certs.
3. Re-read `jsx/lumen.jsx` for accidental `$.evalFile` usage (there is none by design).
4. Confirm `PlayerDebugMode` is **not** required by your installer flow when shipping signed (it isn't).

## Reporting
If you find a leak/exfiltration path, treat it as a release-blocker: open an issue with repro steps before publishing any package.
