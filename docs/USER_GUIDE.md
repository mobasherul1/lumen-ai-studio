# User Guide — Lumen AI Studio

Open the panel: **Window → Extensions → Lumen AI Studio**. It docks like any other panel (drag, dock, resize). The dot in the top-right shows endpoint health: grey = untested, green = OK, red = endpoint error.

---

## 1 · Palette Muse — recolor artwork to match a reference

**When you'd use it:** you have a mood board / client photo and want your vector artwork to sit in the same color family.

1. Click the dashed drop zone and choose any image (or drag it onto the zone).
2. Pick **Colors** (3–8) → **Extract palette**. Swatches appear, darkest on the left.
3. On the artboard, **select your vector artwork** (paths, groups, compound paths, text — anything with RGB fills).
4. **Apply to selection**. Lumen sorts fills dark→light and palette colors dark→light and maps by rank, so your shadows land on the palette's deepest color and highlights on its lightest.

Notes
- Fully offline; no key required.
- Fills with gradients, placed rasters and pattern fills are skipped. Convert to flat fills first if needed.
- Undo works — the recolor is a single recordable Illustrator action (Ctrl/Cmd+Z once).

## 2 · Pattern Dream — text-to-pattern, placed for you

**When you'd use it:** packaging surfaces, fabric repeats, background textures.

1. (Settings) choose an image-capable provider and model (OpenAI `gpt-image-2.5-flare`, Stability Stable Image Core, …).
2. In **Pattern Dream**, describe the tile, e.g. *"hand-drawn indigo botanical line art on cream, seamless repeat, flat print look"*.
3. Optional: **Ambience** tag (*risograph*, *bauhaus*, *art deco*…).
4. Size: square 1024 for tiles; **Count** 1–4 for variations.
5. **Generate & place on artboard**. Each image is saved to a temp file, embedded on the **Lumen AI** layer, centered, auto-fit to 80% of artboard width, and cascading diagonally when you generate several.

Notes
- Generated rasters arrive as **embedded placed items** named `Lumen Pattern N`.
- For a true repeat: Object → Pattern → Make, or Object → Expand then Object → Pattern → Make.

## 3 · Artboard Critique — a senior art director on tap

**When you'd use it:** second-opinion pass before sending to print or dev hand-off.

1. Make the artboard you want critiqued the **active** one.
2. Pick **Review focus** — General / Composition / Contrast / Typography / Brand / Accessibility (WCAG).
3. **Critique current artboard**. Lumen exports the artboard as PNG (via Illustrator's own `ExportType.PNG24` with `artBoardClipping`) and uploads only that PNG to your configured vision model.
4. The critique renders in the panel — selectable text you can paste into a design doc.

Notes
- Nothing else is uploaded. The PNG is written to your OS temp folder and can be deleted by hand.
- If you see HTTP errors, the full upstream message appears — usually a model id typo or missing vision access on the key.

## 4 · Copywriter — headline options, written into your frames

**When you'd use it:** headline/subcopy while laying out a poster, packaging or landing page.

1. Write a one-paragraph **brief**: product, audience, desired feeling.
2. Choose **Tone** (confident … urgent) and **Options** count.
3. **Generate options** — a list of cards appears.
4. For each option click **Use**:
   - If exactly **one text frame is selected** on the artboard, its contents are replaced.
   - Otherwise Lumen creates a **new text frame** on the `Lumen AI` layer, centered on the active artboard.

Notes
- Options longer than 12 words may wrap awkwardly — the prompt constrains length, but layout is on you.
- Generate again for fresh takes; temperature is 0.9 for genuine variety.

## 5 · Vector Muse — prompt → SVG → scalable artwork

**When you'd use it:** icon drafts, spot illustrations, decorative badges.

1. Describe the mark: concept, geometry, 2–3 colors, negative space.
2. Pick **Complexity** (Simple = icon, Medium = spot illustration) and canvas size (256/512/1024).
3. **Generate & place SVG**. The model's SVG is extracted, safety-checked (no scripts, no event handlers, no external refs), saved to temp, and imported on the `Lumen AI` layer via Illustrator's `groupItems.createFromFile()` — i.e. as a real **editable vector group** (paths and text frames), not an opaque placed link.
4. Ungroup or recolor freely — it is native artwork.

Notes
- "Simple" prompts give cleanest SVGs. Complex scenes will produce mush — use Pattern Dream (raster) instead.
- If the model wraps output in prose or markdown fences, Lumen slices out the `<svg>…</svg>` automatically.

## 6 · Settings — keys stay per-user, out of the source

- **Provider preset** fills Base URL and model defaults; override any field. (Azure OpenAI users: this panel uses the **v1 API** — Base URL `https://<resource>.openai.azure.com/openai/v1`, model fields = deployment names, auth `api-key` header, no api-version. OpenAI defaults are current as of late 2026: `gpt-4o` chat/vision, `gpt-image-2.5-flare` images; `gpt-image-1` was shut down Oct 2026.)
- **API key** is stored per provider in `config.json` inside CEP's per-user data folder (path shown under *Stored at*), never in the extension folder, never in the .zxp. Heads-up: that file is plaintext — see [SECURITY.md](SECURITY.md) for the threat model and hardening options.
- **Test connection** makes a 1-token chat call (Stability: reads your credit balance) and paints the header dot green/red.
- **Clear keys** deletes the stored key for the current provider only.

## 7 · About — credits and links

The **About** tab (far right, next to Settings) shows the extension version, a one-line feature summary, the author (**Md. Mobasherul Hasan**), a button that opens the author's profile at **mobasherul1.github.io** in your browser, and the copyright/license notice (© 2026 Md. Mobasherul Hasan, Apache-2.0; CSInterface.js © Adobe under the CEP license).

## Keyboard & workflow tips
- Keep the panel docked next to Layers; `Lumen AI` layer collects everything Lumen places — toggle its visibility like any scratch layer, then move/lock it when happy.
- Use Ctrl/Cmd+Z to undo any Lumen action on the canvas — palette recolor and text insertion are single undo steps.
