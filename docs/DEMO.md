# Demo — recording the acceptance video/GIF

> **Honest status note:** the extension is complete and code-reviewed, but a screen recording requires a live Illustrator session with a valid API key, so it cannot be produced inside an automated headless session. This file is the exact shot list + recording setup to produce it in ~10 minutes on a clean Illustrator install.

## Prerequisites (clean install)
1. Fresh Windows/macOS user account **or** a VM with Illustrator v25+ (2021–2025) and nothing else installed.
2. Copy `lumen-ai-studio/` per the OS installer script, restart Illustrator (macOS: the script also restarts `cfprefsd`; a re-login may be needed).
3. Set a throwaway API key in Settings → Test connection (green dot).
4. Recorder: **ShareX** (Windows) or **QuickTime** (macOS); for a GIF, convert with `ffmpeg -i demo.mp4 -vf 'fps=12,scale=900:-1' demo.gif`. OBS also works.
5. If demoing a **signed .zxp** instead of the dev flow: remove the per-user unsigned copy and set `PlayerDebugMode` back to `0` first, otherwise the unsigned copy shadows the signed package.

## Shot list (90–120 seconds, single take with cuts)

| # | Shot | Proves |
|---|---|---|
| 1 | `Window → Extensions → Lumen AI Studio` — panel opens docked, dark, no errors in console | Panel loads clean on fresh install |
| 1b | About tab → shows version, Md. Mobasherul Hasan, mobasherul1.github.io button opens in system browser | Credits/branding intact |
| 2 | Settings → paste key → **Test connection** → dot goes green | Secure per-user key flow works |
| 3 | Palette Muse: drop a client photo → Extract → 5 swatches → select artwork → Apply → artwork recolors | Offline k-means + recolor engine |
| 4 | Pattern Dream: prompt "indigo botanical tile, seamless" → Generate → PNG appears on artboard on **Lumen AI** layer | Text-to-image + placement on correct layer |
| 5 | Artboard Critique: click → PNG export → critique text renders | Artboard export + vision round-trip |
| 6 | Copywriter: brief + tone → Generate → click **Use** → headline lands in selected text frame | Text-frame round-trip |
| 7 | Vector Muse: "heron logo mark, navy & coral" → Generate → SVG placed; `Object → Expand` shows editable nodes | LLM SVG → scalable vector |
| 8 | **Clear keys** in Settings → dot greys out; Window → Extensions close/reopen still clean | No hard-coded keys / clean uninstall state |

## Voiceover script (optional)

> "Lumen lives in the Extensions menu. Keys are entered once in Settings and stored per-user, never in the source. Palette Muse recolors existing artwork to a client's reference image — offline. Pattern Dream renders a surface and places it on a Lumen AI layer. Artboard Critique sends just the artboard to a vision model. Copywriter writes straight into selected text. And Vector Muse turns a prompt into a real, expandable SVG."

## What to check before calling it done
- Console clean: Help → … → DevTools (on `.debug` port 8088), zero red errors during all 8 shots.
- Every placed asset on layer **Lumen AI** — one click toggle shows all of them.
- `git status` clean except `build/` — no keys committed anywhere.
