# Architecture — how Lumen AI Studio fits together

## Why CEP (not UXP)

Illustrator ships two extension techs: CEP (Chromium-Embedded-Framework + ExtendScript) and, from ~2027, UXP. **CEP is supported by Illustrator v25 through v29 and is the only route that runs unchanged on both Windows and macOS for that whole range.** Illustrator UXP is on Adobe's published roadmap (private beta MAX 2026 → GA Q4 2027), with CEP phasing out later (marketplace cutoff ~Dec 2028, removal Dec 2029), so the panel is deliberately written with thin seams (all Node usage behind `node-helper.js`, all host commands behind `hostCall()`) for a mechanical UXP port later. The manifest declares `Version="5.0"` (correct for CEP 9–12); the host-side `PlayerDebugMode` key is what differs per host generation: CSXS.10 (v25.0), CSXS.11 (v25.3–v28), CSXS.12 (v29/2025).

## Process model

```
┌─────────────────────────────────────────────────────────────┐
│  Illustrator.exe / Illustrator.app                          │
│  ┌───────────────────────┐        ┌───────────────────────┐ │
│  │ CEP panel (CEF)        │        │ ExtendScript engine    │ │
│  │ index.html + js/*      │        │ jsx/lumen.jsx          │ │
│  │  ├─ panel.js  (UI)     │        │  ├─ export artboard PNG│ │
│  │  ├─ api.js    (HTTPS)  │        │  ├─ placeFile()        │ │
│  │  ├─ node-helper.js(fs) │        │  ├─ applyPalette()     │ │
│  │  └─ CSInterface.js     │  evalScript()                   │ │
│  │     └─ window.cep_node │ ────────────────►               │ │
│  │                        │ ◄──────────────── JSON string   │ │
│  └───────┬───────────────┘        └───────────────────────┘ │
│          │ Node (built into CEP CEF when --enable-nodejs=true)│
└──────────┼───────────────────────────────────────────────────┘
           ▼  HTTPS (Node http/https, no npm deps)
   OpenAI-compatible endpoint (user-configured Base URL)
```

- The panel never opens remote HTML. Everything rendered is local.
- Node is used for two things only: filesystem (temp files, per-user config) and HTTPS requests. `api.js` uses built-in `http`/`https` — **zero npm dependencies**, so packaging for .zxp needs no `npm install`.
- Illustrator itself only ever sees local file paths: temp PNGs/SVGs it places, and the ExtendScript commands from `jsx/lumen.jsx`.

## The evalScript round-trip

`panel.js` reads `jsx/lumen.jsx` from disk once, then calls host functions like:

```js
hostCall('Lumen_applyPalette', JSON.stringify(['#1b2a41','#c1562e']))
                                   // raw JSON text
        │
        ▼  Embedded via JSON.stringify ⇒ valid ExtendScript literal
        evalScript(<jsx source> + '\n' +
          'Lumen_applyPalette("[\\"#1b2a41\\", ...]");')
        │
        ▼
ExtendScript: Lumen_applyPalette(paletteJson) → JSON.parse(paletteJson)
              → every public fn returns lumen_ok()/lumen_err() JSON
```

Two rules keep the bridge reliable everywhere:
1. Every `Lumen_*` function is wrapped in try/catch and returns `{ok:false, error:"…"}` on failure — ExtendScript exceptions never propagate as raw errors into CEF. (CEP surfaces evalScript failures as *strings* in the callback, e.g. "EvalScript error." — `hostCall()` treats an unparseable string as a host error with the raw text attached.)
2. Arguments are embedded with exactly one `JSON.stringify`, with U+2028/U+2029 neutralized — the one JSON/JS-literal mismatch that can otherwise break the ExtendScript parser.

Also note: ExtendScript runs on Illustrator's **main thread** — long host calls block the UI (the artboard export is normally < 1s; avoid adding loops there).

## Why the k-means palette is offline

Palette extraction needs pixel data and nothing else. Doing it in panel JS (canvas → `getImageData` → k-means) keeps it instant, free, and usable without any key — and it works while the artboard is open in any workspace. Colors map dark→light by luminance rank, matching Illustrator's own grayscale logic.

## File flow for placed artwork

1. Generated PNG/SVG bytes land in the OS temp dir (`os.tmpdir()/lumen-ai-studio`) via `node-helper.js`.
2. Panel passes the path (forward-slashed) to `Lumen_placeFile`.
3. ExtendScript finds/creates layer **`Lumen AI`**, adds a `placedItem`, downscales to ≤80% artboard width, centers, and (for multi-image placement) cascades diagonally by 18pt each.
4. The user's previous active layer is restored afterwards.

## Data privacy

Only two network flows exist, both user-configured:
1. Settings → Test connection: a 1-token request (Stability: `/v1/engines/list`).
2. Feature calls: Pattern Dream (prompt), Artboard Critique (artboard PNG), Copywriter (brief), Vector Muse (description).

Nothing else leaves the machine; Palette Muse never touches the network. Config lives in CEP's per-user `SystemPath.USER_DATA` folder in `lumen-ai-studio/config.json` (mode 0600 on POSIX), keyed per provider. The .zxp never contains keys.

## Deliberate limitations (documented, not bugs)

- **Gradient/pattern fills, spot colors** aren't recolored by Palette Muse (flat RGB/Gray/CMYK fills only).
- **Vector Muse SVGs** arrive as editable vector groups via `groupItems.createFromFile()` (Illustrator import, not a placed link), auto-sized to 50% of artboard width.
- **Pattern Dream rasters** are embedded (`PlacedItem.embed()`), so temp-file cleanup can't break links — but they are not vector; use Object → Image Trace if you need paths.
- **Stability AI** has no chat/vision endpoints — the relevant tabs show a clear message instead of an opaque failure.
- Unsigned dev installs require `PlayerDebugMode=1` (CEP by design).
