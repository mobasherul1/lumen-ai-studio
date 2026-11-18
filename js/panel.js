/* ============================================================
   Lumen AI Studio — panel controller
   ----------------------------------------------------------
   Plain DOM, no framework, no build step. Communicates with
   Illustrator through ExtendScript via CSInterface.evalScript.
   The JSX source (jsx/lumen.jsx) is read from disk once, then
   combined with a one-line dispatch call:

       evalScript(<jsx source> + '\n' + 'Lumen_applyPalette("…json…")')

   The JSON argument is embedded with JSON.stringify, so quotes and
   backslashes survive the round trip into ExtendScript safely.
   ============================================================ */
'use strict';

var CS = new CSInterface();

/* ---------- DOM shortcuts ----------------------------------- */
function $(s) { return document.querySelector(s); }
function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }

/* ---------- status bar + toast ------------------------------ */
var stIcon = $('#st-icon'), stText = $('#st-text');
function setStatus(text, state) {
  stText.textContent = text;
  stIcon.style.color = state === 'ok' ? 'var(--ok)' : state === 'err' ? 'var(--err)' : state === 'busy' ? 'var(--accent)' : 'var(--text-dim)';
}
var toastTimer = null;
function toast(msg, isErr) {
  var t = $('#toast');
  t.textContent = msg;
  t.className = isErr ? 'show err' : 'show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.className = ''; }, 4200);
}

/* ---------- Host dispatch (Illustrator ExtendScript) -------- */
var jsxSourceCache = null;
function jsxSource() {
  if (jsxSourceCache !== null) { return jsxSourceCache; }
  try {
    if (!window.LumenNode) { throw new Error('node unavailable'); }
    var extPath = CS.getSystemPath(SystemPath.EXTENSION);      // extension install dir
    var jsxPath = require('path').join(extPath, 'jsx', 'lumen.jsx');
    jsxSourceCache = require('fs').readFileSync(jsxPath, 'utf8');
  } catch (e) {
    // Fallback: ScriptPath in the manifest loads the JSX into the ExtendScript
    // engine at startup — the Lumen_* globals exist there already, so we send
    // just the dispatch call. Slightly slower first call in some hosts, but keeps
    // the panel functional on locked-down installs.
    jsxSourceCache = '';
  }
  return jsxSourceCache;
}

/* Callers pass RAW values; each argument is embedded as a literal via one
   JSON.stringify, which escapes quotes/backslashes for the ExtendScript parser. */
function hostCall(fnName) {
  var rawArgs = Array.prototype.slice.call(arguments, 1);
  return new Promise(function (resolve, reject) {
    var literals = rawArgs.map(function (a) {
      var lit = JSON.stringify(String(a)); return lit.split(String.fromCharCode(0x2028)).join(' ').split(String.fromCharCode(0x2029)).join(' ');
    });
    var src = jsxSource() + '\n' + fnName + '(' + literals.join(',') + ');';
    CS.evalScript(src, function (result) {
      var parsed = null;
      try { parsed = JSON.parse(result); }
      catch (e) { return reject(new Error('Illustrator returned an unreadable reply: ' + String(result).slice(0, 240))); }
      if (!parsed || parsed.ok !== true) { return reject(new Error((parsed && parsed.error) || 'Unknown host error')); }
      resolve(parsed);
    });
  });
}

function toJsxPath(p) { return String(p).replace(/\\/g, '/'); }   // File() prefers forward slashes

/* ============================================================
   Tabs
   ============================================================ */
$$('.tab').forEach(function (tab) {
  tab.addEventListener('click', function () {
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t === tab); });
    $$('.page').forEach(function (p) { p.classList.toggle('active', p.id === 'page-' + tab.dataset.tab); });
  });
});

/* About tab — open the author's GitHub profile in the system browser
   (never navigate the panel window itself). */
$('#btn-github').addEventListener('click', function () {
  try { CS.openURLInDefaultBrowser('https://mobasherul1.github.io'); }
  catch (e) { toast('mobasherul1.github.io'); }
});

/* ============================================================
   6 · SETTINGS — per-provider config, stored in CEP userData
   ============================================================ */
var PROVIDER_PRESETS = {
  openai:     { baseUrl: 'https://api.openai.com/v1',          chatModel: 'gpt-4o',        visionModel: 'gpt-4o',       imageModel: 'gpt-image-2.5-flare',          imagePath: '/images/generations' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1',       chatModel: 'openai/gpt-4o', visionModel: 'openai/gpt-4o', imageModel: 'openai/gpt-image-2.5-flare',  imagePath: '/images/generations' },
  azure:      { baseUrl: 'https://YOUR-RESOURCE.openai.azure.com/openai/v1', chatModel: 'YOUR-DEPLOYMENT', visionModel: 'YOUR-DEPLOYMENT', imageModel: 'YOUR-IMAGE-DEPLOYMENT', imagePath: '/images/generations' },
  stability:  { baseUrl: 'https://api.stability.ai',            chatModel: '',              visionModel: '',              imageModel: 'stable-image-core',            imagePath: '' },
  lmstudio:   { baseUrl: 'http://localhost:1234/v1',            chatModel: 'local-model',   visionModel: 'local-model',   imageModel: '',                             imagePath: '' },
  ollama:     { baseUrl: 'http://localhost:11434/v1',           chatModel: 'qwen3-vl:8b',   visionModel: 'qwen3-vl:8b',   imageModel: '',                             imagePath: '' },
  custom:     { baseUrl: '',                                    chatModel: '',              visionModel: '',              imageModel: '',                             imagePath: '/images/generations' }
};

var currentProvider = 'openai';

function readConfig() {
  var raw = (window.LumenNode ? window.LumenNode.readConfig() : {}) || {};
  if (!raw.providers) { raw.providers = {}; }
  if (!raw.active) { raw.active = 'openai'; }
  return raw;
}
function activeConfig() {
  var all = readConfig();
  var preset = PROVIDER_PRESETS[all.active] || PROVIDER_PRESETS.custom;  /* hand-edited/unknown provider */
  var p = all.providers[all.active] || {};
  return {
    provider: all.active,
    baseUrl: p.baseUrl || preset.baseUrl,
    apiKey: p.apiKey || '',
    chatModel: p.chatModel != null ? p.chatModel : preset.chatModel,
    visionModel: p.visionModel != null ? p.visionModel : preset.visionModel,
    imageModel: p.imageModel != null ? p.imageModel : preset.imageModel,
    imagePath: p.imagePath != null ? p.imagePath : preset.imagePath
  };
}
function fillSettingsForm(cfg) {
  $('#cfg-provider').value = cfg.provider;
  $('#cfg-baseurl').value = cfg.baseUrl || '';
  $('#cfg-key').value = cfg.apiKey || '';
  $('#cfg-chatmodel').value = cfg.chatModel || '';
  $('#cfg-visionmodel').value = cfg.visionModel || '';
  $('#cfg-imagemodel').value = cfg.imageModel || '';
  $('#cfg-imagepath').value = cfg.imagePath || '';
  renderConfigSummary();
}
function collectSettingsForm() {
  return {
    baseUrl: $('#cfg-baseurl').value.trim(),
    apiKey: $('#cfg-key').value.trim(),
    chatModel: $('#cfg-chatmodel').value.trim(),
    visionModel: $('#cfg-visionmodel').value.trim(),
    imageModel: $('#cfg-imagemodel').value.trim(),
    imagePath: $('#cfg-imagepath').value.trim()
  };
}
function renderConfigSummary() {
  var cfg = activeConfig();
  var masked = cfg.apiKey ? '••••••••' + cfg.apiKey.slice(-4) : '(not set)';
  var path = window.LumenNode ? window.LumenNode.configPathDisplay() : '(Node unavailable)';
  $('#cfg-summary').innerHTML =
    '<dt>Provider</dt><dd>' + escapeHtml(cfg.provider) + '</dd>' +
    '<dt>Base URL</dt><dd>' + escapeHtml(cfg.baseUrl || '(not set)') + '</dd>' +
    '<dt>Key</dt><dd>' + escapeHtml(masked) + '</dd>' +
    '<dt>Chat</dt><dd>' + escapeHtml(cfg.chatModel || '—') + '</dd>' +
    '<dt>Image</dt><dd>' + escapeHtml(cfg.imageModel || '—') + '</dd>' +
    '<dt>Stored at</dt><dd>' + escapeHtml(path) + '</dd>';
}
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function setConnDot(state) {
  var d = $('#conn-dot');
  d.className = state === 'ok' ? 'ok' : state === 'bad' ? 'bad' : '';
  d.title = state === 'ok' ? 'Endpoint reachable' : state === 'bad' ? 'Endpoint error — see Settings' : 'Not tested';
}

$('#cfg-provider').addEventListener('change', function () {
  var p = this.value;
  var all = readConfig();
  var saved = all.providers[p];
  var preset = PROVIDER_PRESETS[p];
  fillSettingsForm({
    provider: p,
    baseUrl: (saved && saved.baseUrl) || preset.baseUrl,
    apiKey: (saved && saved.apiKey) || '',
    chatModel: saved ? saved.chatModel : preset.chatModel,
    visionModel: saved ? saved.visionModel : preset.visionModel,
    imageModel: saved ? saved.imageModel : preset.imageModel,
    imagePath: saved ? saved.imagePath : preset.imagePath
  });
  currentProvider = p;
});

$('#btn-toggle-key').addEventListener('click', function () {
  var input = $('#cfg-key');
  var showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  this.textContent = showing ? 'Show' : 'Hide';
});

$('#btn-save-cfg').addEventListener('click', function () {
  if (!window.LumenNode) { toast('Node.js unavailable in this host — cannot persist keys.', true); return; }
  var all = readConfig();
  all.active = $('#cfg-provider').value;
  all.providers[all.active] = collectSettingsForm();
  var where = window.LumenNode.writeConfig(all);
  renderConfigSummary();
  setStatus('Settings saved to ' + where, 'ok');
  toast('Keys saved to per-user data folder.');
});

$('#btn-test-cfg').addEventListener('click', function () {
  var cfg = mergeFormIntoConfig();
  if (!cfg.apiKey && cfg.provider !== 'lmstudio' && cfg.provider !== 'ollama') {
    toast('No API key set for this provider.', true); setConnDot('bad'); return;
  }
  setStatus('Contacting endpoint…', 'busy');
  setConnDot('');
  if (!nodeReady()) { return; }
  window.LumenAPI.test(cfg).then(function (msg) {
    setStatus(msg, 'ok'); toast(msg); setConnDot('ok');
  }, function (err) {
    setStatus('Test failed', 'err'); toast(String(err.message || err), true); setConnDot('bad');
  });
});

$('#btn-clear-cfg').addEventListener('click', function () {
  if (!window.LumenNode) { return; }
  var all = readConfig();
  var p = all.active;
  delete all.providers[p];
  window.LumenNode.writeConfig(all);
  var preset = PROVIDER_PRESETS[p] || PROVIDER_PRESETS.custom;
  fillSettingsForm({ provider: p, baseUrl: preset.baseUrl, apiKey: '',
    chatModel: preset.chatModel, visionModel: preset.visionModel,
    imageModel: preset.imageModel, imagePath: preset.imagePath });
  setConnDot('');
  setStatus('Keys cleared for ' + p, 'ok');
  toast('Stored keys deleted for provider: ' + p);
});

function mergeFormIntoConfig() {
  var form = collectSettingsForm();
  form.provider = $('#cfg-provider').value;
  return form;
}

/* ============================================================
   1 · PALETTE MUSE — offline k-means
   ============================================================ */
var paletteHexes = [];

var dropZone = $('#drop-zone'), dropPreview = $('#drop-preview'), dropLabel = $('#drop-label');
var fileInput = $('#palette-file');
var lastImageData = null;

dropZone.addEventListener('click', function () { fileInput.click(); });
dropZone.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { fileInput.click(); } });
['dragenter', 'dragover'].forEach(function (evt) {
  dropZone.addEventListener(evt, function (e) { e.preventDefault(); dropZone.classList.add('dragover'); });
});
['dragleave', 'drop'].forEach(function (evt) {
  dropZone.addEventListener(evt, function (e) { e.preventDefault(); dropZone.classList.remove('dragover'); });
});
dropZone.addEventListener('drop', function (e) {
  var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) { loadReferenceImage(f); }
});
fileInput.addEventListener('change', function () { if (this.files[0]) { loadReferenceImage(this.files[0]); } });

function loadReferenceImage(file) {
  var reader = new FileReader();
  reader.onload = function () {
    var img = new Image();
    img.onload = function () {
      dropPreview.src = img.src; dropPreview.hidden = false; dropLabel.hidden = true;
      // Downscale to ≤128px on the long side — plenty for palette work, fast k-means
      var scale = Math.min(1, 128 / Math.max(img.width, img.height));
      var w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      try { lastImageData = ctx.getImageData(0, 0, w, h).data; }
      catch (e) { toast('Could not read pixels from this image.', true); return; }
      $('#btn-extract').disabled = false;
      setStatus('Reference loaded: ' + file.name, 'ok');
    };
    img.onerror = function () { toast('That file does not look like an image.', true); };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

/* Classic Lloyd's algorithm; pixels sampled with stride 2 for speed. */
function kmeans(data, k, iterations) {
  var pts = [];
  for (var i = 0; i < data.length; i += 8) {          // stride 2 pixels (RGBA)
    var a = data[i + 3];
    if (a < 128) { continue; }                         // skip transparent px
    pts.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (pts.length < k) { return null; }
  // Deterministic-ish init: evenly spaced quantiles of the pixel list
  var centroids = [];
  for (var c = 0; c < k; c++) { centroids.push(pts[Math.floor((c + 0.5) * pts.length / k)].slice()); }
  for (var iter = 0; iter < iterations; iter++) {
    var sums = [], counts = [];
    for (var j = 0; j < k; j++) { sums.push([0, 0, 0]); counts.push(0); }
    for (var p = 0; p < pts.length; p++) {
      var best = 0, bestD = Infinity;
      for (var q = 0; q < k; q++) {
        var dr = pts[p][0] - centroids[q][0], dg = pts[p][1] - centroids[q][1], db = pts[p][2] - centroids[q][2];
        var d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = q; }
      }
      sums[best][0] += pts[p][0]; sums[best][1] += pts[p][1]; sums[best][2] += pts[p][2]; counts[best]++;
    }
    for (var m = 0; m < k; m++) {
      if (counts[m] === 0) { continue; }
      centroids[m] = [sums[m][0] / counts[m], sums[m][1] / counts[m], sums[m][2] / counts[m]];
    }
  }
  return centroids;
}
function rgbToHex(c) {
  return '#' + c.map(function (v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); }).join('');
}
function lumOf(hex) {
  var n = parseInt(hex.slice(1), 16);
  function ch(v) { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

$('#btn-extract').addEventListener('click', function () {
  if (!lastImageData) { return; }
  var k = parseInt($('#palette-count').value, 10) || 5;
  var centroids = kmeans(lastImageData, k, 24);
  if (!centroids) { toast('Not enough opaque pixels to extract a palette.', true); return; }
  paletteHexes = centroids.map(rgbToHex).sort(function (a, b) { return lumOf(a) - lumOf(b); });
  var out = $('#palette-out');
  out.innerHTML = paletteHexes.map(function (hex) {
    return '<div class="swatch"><div class="chip-color" style="background:' + hex + '"></div><div class="hex">' + hex.toUpperCase() + '</div></div>';
  }).join('');
  $('#btn-apply-palette').disabled = paletteHexes.length === 0;
  setStatus('Palette extracted (' + paletteHexes.length + ' colors).', 'ok');
});

$('#btn-clear-palette').addEventListener('click', function () {
  paletteHexes = []; lastImageData = null;
  $('#palette-out').innerHTML = '';
  dropPreview.hidden = true; dropPreview.removeAttribute('src'); dropLabel.hidden = false;
  $('#btn-extract').disabled = true; $('#btn-apply-palette').disabled = true;
  setStatus('Palette cleared.', 'idle');
});

$('#btn-apply-palette').addEventListener('click', function () {
  var btn = this; btn.disabled = true;
  setStatus('Recoloring selection…', 'busy');
  hostCall('Lumen_applyPalette', JSON.stringify(paletteHexes)).then(function (res) {
    var suffix = res.failed ? ' (' + res.failed + ' skipped — locked or non-recolorable)' : '';
    setStatus('Recolored ' + res.recolored + ' fill(s) to the palette.' + suffix, 'ok');
    toast('Applied palette to ' + res.recolored + ' item(s).' + suffix);
    btn.disabled = false;
  }, function (err) {
    setStatus('Palette not applied', 'err'); toast(String(err.message || err), true); btn.disabled = false;
  });
});

/* ============================================================
   Shared: resolve temp PNG for the artboard export
   ============================================================ */
/* Every AI/file feature needs the Node bridge; fail fast with a clear message. */
function nodeReady() {
  if (window.LumenNode && window.LumenAPI) { return true; }
  toast('Node bridge unavailable in this host — check the panel console (Window → Extensions).', true);
  return false;
}

function exportArtboardPng() {
  var target = require('os').tmpdir() + '/lumen-artboard-' + Date.now() + '.png';
  return hostCall('Lumen_exportArtboardPng', toJsxPath(target), JSON.stringify({ maxPixels: 1568 }))
    .then(function () { return target; });
}

/* ============================================================
   3 · ARTBOARD CRITIQUE
   ============================================================ */
var CRITIQUE_FOCUS = {
  general:       'Give a senior art-director level critique: composition, hierarchy, contrast, typography, spacing, and 2-3 actionable next steps. Be specific about locations ("top-left", "the headline").',
  composition:   'Focus strictly on composition and balance: visual weight, alignment, grid, negative space, focal point. Give actionable fixes.',
  contrast:      'Focus on contrast and legibility: text/background ratios, foreground/background separation, print and screen legibility. Cite approximate WCAG ratios where possible.',
  typography:    'Focus on typography: hierarchy, pairing, sizes/leading, orphan control, alignment. Suggest concrete size/leading numbers.',
  brand:         'Critique as a brand guardian: consistency of palette, type, iconography and tone with the brand implied by the artboard.',
  accessibility: 'Critique strictly for accessibility: WCAG 2.1 contrast, minimum sizes, color-blind safety of palette distinctions, focus-order cues. Cite ratios.'
};

$('#btn-critique').addEventListener('click', function () {
  if (!nodeReady()) { return; }
  var cfg = activeConfig();
  if (!cfg.apiKey) { toast('Set your API key in Settings first.', true); return; }
  if (cfg.provider === 'stability') { toast('Stability has no vision model — pick an OpenAI-compatible provider with a vision model.', true); return; }
  var btn = this; btn.disabled = true;
  var focus = $('#critique-focus').value;
  var out = $('#critique-out');
  out.hidden = true;
  setStatus('Exporting artboard…', 'busy');

  exportArtboardPng().then(function (pngPath) {
    setStatus('Asking the vision model for critique…', 'busy');
    var b64 = window.LumenNode.readFileBase64(pngPath);
    var dataUri = 'data:image/png;base64,' + b64;
    return window.LumenAPI.chat(cfg, {
      model: cfg.visionModel || cfg.chatModel,
      temperature: 0.4,
      maxTokens: 1200,
      messages: [
        { role: 'system', content: 'You are a principal design critic embedded in Adobe Illustrator. Answer in tight markdown: short sections, bullets, bold key moves. Never mention you are an AI.' },
        { role: 'user', content: [
            { type: 'text', text: CRITIQUE_FOCUS[focus] || CRITIQUE_FOCUS.general },
            { type: 'image_url', image_url: { url: dataUri } }
        ] }
      ]
    });
  }).then(function (text) {
    out.textContent = text; out.hidden = false;
    setStatus('Critique complete.', 'ok');
    btn.disabled = false;
  }, function (err) {
    setStatus('Critique failed', 'err'); toast(String(err.message || err), true); btn.disabled = false;
  });
});

/* ============================================================
   2 · PATTERN DREAM
   ============================================================ */
$('#btn-pattern').addEventListener('click', function () {
  if (!nodeReady()) { return; }
  var cfg = activeConfig();
  if (!cfg.apiKey) { toast('Set your API key in Settings first.', true); return; }
  var rawPrompt = $('#pattern-prompt').value.trim();
  if (!rawPrompt) { toast('Describe the pattern first.', true); return; }
  var style = $('#pattern-style').value.trim();
  var prompt = style ? rawPrompt + '. Style: ' + style + '.' : rawPrompt;
  var size = $('#pattern-size').value;
  var n = parseInt($('#pattern-count').value, 10) || 1;

  var btn = this; btn.disabled = true;
  setStatus('Generating ' + n + ' image(s)… (this can take a minute)', 'busy');

  window.LumenAPI.generateImage(cfg, { prompt: prompt, size: size, n: n }).then(function (images) {
    var stamp = Date.now();
    var chain = Promise.resolve();
    images.forEach(function (b64, i) {
      chain = chain.then(function () {
        setStatus('Placing image ' + (i + 1) + ' of ' + images.length + '…', 'busy');
        var tempPng = window.LumenNode.writeTempBase64('lumen-pattern-' + stamp + '-' + (i + 1) + '.png', b64);
        return hostCall('Lumen_placeFile', toJsxPath(tempPng),
          JSON.stringify({ name: 'Lumen Pattern ' + (i + 1), widthFraction: 0.8, cascade: i }));
      });
    });
    return chain;
  }).then(function () {
    setStatus('Pattern(s) placed on the “Lumen AI” layer.', 'ok');
    toast('Done. Check the “Lumen AI” layer.');
    btn.disabled = false;
  }, function (err) {
    setStatus('Pattern generation failed', 'err'); toast(String(err.message || err), true); btn.disabled = false;
  });
});

/* ============================================================
   4 · COPYWRITER
   ============================================================ */
$('#btn-copy').addEventListener('click', function () {
  if (!nodeReady()) { return; }
  var cfg = activeConfig();
  if (!cfg.apiKey) { toast('Set your API key in Settings first.', true); return; }
  var brief = $('#copy-brief').value.trim();
  if (!brief) { toast('Write a brief first.', true); return; }
  var tone = $('#copy-tone').value;
  var count = parseInt($('#copy-count').value, 10) || 4;
  var out = $('#copy-out');
  out.innerHTML = '';
  var btn = this; btn.disabled = true;
  setStatus('Drafting ' + count + ' options…', 'busy');

  window.LumenAPI.chat(cfg, {
    model: cfg.chatModel,
    temperature: 0.9,
    maxTokens: 900,
    messages: [
      { role: 'system', content: 'You are a senior copywriter inside a design tool. Reply with ONLY a numbered list, one option per line, no commentary, no quotes around options.' },
      { role: 'user', content: 'Brief: ' + brief + '\nTone: ' + tone + '\nWrite ' + count + ' distinct options. Each ≤ 12 words.' }
    ]
  }).then(function (text) {
    var options = String(text).split('\n')
      .map(function (l) { return l.replace(/^\s*(\d+[\.\)\-:]|[-*])\s*/, '').trim(); })
      .filter(function (l) { return l.length > 0; });
    if (!options.length) { throw new Error('The model returned an empty list.'); }
    out.innerHTML = '';
    options.slice(0, 8).forEach(function (opt) {
      var card = document.createElement('div');
      card.className = 'option-card';
      card.innerHTML = '<div class="opt-text"></div><button class="btn small opt-use" type="button">Use</button>';
      card.querySelector('.opt-text').textContent = opt;
      card.querySelector('.opt-use').addEventListener('click', function () {
        setStatus('Writing into text frame…', 'busy');
        hostCall('Lumen_writeText', opt).then(function (res) {
          toast(res.mode === 'replaced' ? 'Replaced selected text frame.' : 'Created a new text frame on “Lumen AI”.');
          setStatus('Copy placed (' + res.mode + ').', 'ok');
        }, function (err) { toast(String(err.message || err), true); setStatus('Copy not placed', 'err'); });
      });
      out.appendChild(card);
    });
    setStatus(options.length + ' option(s) ready.', 'ok');
    btn.disabled = false;
  }, function (err) {
    setStatus('Copy generation failed', 'err'); toast(String(err.message || err), true); btn.disabled = false;
  });
});

/* ============================================================
   5 · VECTOR MUSE — LLM → sanitized SVG → placed artwork
   ============================================================ */
function extractSvg(raw) {
  var start = raw.indexOf('<svg');
  var end = raw.lastIndexOf('</svg>');
  if (start === -1 || end === -1 || end <= start) { throw new Error('Model did not return an <svg> document.'); }
  return raw.slice(start, end + 6);
}
function sanitizeSvg(svg) {
  // Block script-like elements, inline event handlers, and any EXTERNAL resource link.
  // Internal url(#id) references (gradients) stay legal — they carry no network/exec path.
  var bad = /<script|<foreignObject|<iframe|<object|<embed|javascript:|on[a-z]+\s*=|(xlink:)?href\s*=\s*["']?\s*(https?|ftp|data|file):|url\(\s*["']?\s*(https?|ftp|data|file):/i;
  if (bad.test(svg)) { throw new Error('SVG failed the safety check (script, event handler or external reference detected). Ask for simpler artwork.'); }
  return svg;
}

$('#btn-vector').addEventListener('click', function () {
  if (!nodeReady()) { return; }
  var cfg = activeConfig();
  if (!cfg.apiKey) { toast('Set your API key in Settings first.', true); return; }
  if (cfg.provider === 'stability') { toast('Stability has no text model — use an OpenAI-compatible chat model.', true); return; }
  var prompt = $('#vector-prompt').value.trim();
  if (!prompt) { toast('Describe the vector first.', true); return; }
  var complexity = $('#vector-complexity').value;
  var size = parseInt($('#vector-size').value, 10) || 256;

  var btn = this; btn.disabled = true;
  var out = $('#vector-out');
  out.hidden = true;
  setStatus('Asking the model for SVG…', 'busy');

  window.LumenAPI.chat(cfg, {
    model: cfg.chatModel,
    temperature: 0.7,
    maxTokens: 3000,
    messages: [
      { role: 'system', content: 'You are a master vector illustrator. Reply with RAW SVG markup only — no markdown fences, no commentary. Use a single <svg> root with xmlns, a viewBox of 0 0 ' + size + ' ' + size + ', flat fills, and at most 2-3 colors. No <script>, no event handlers, no external references.' },
      { role: 'user', content: 'Draw: ' + prompt + '\nComplexity: ' + complexity + '. Use viewBox="0 0 ' + size + ' ' + size + '".' }
    ]
  }).then(function (text) {
    var svg = sanitizeSvg(extractSvg(text));
    var stamp = Date.now();
    var svgPath = window.LumenNode.writeTempText('lumen-vector-' + stamp + '.svg', svg);
    out.textContent = svg; out.hidden = false;
    setStatus('Placing SVG on artboard…', 'busy');
    return hostCall('Lumen_placeFile', toJsxPath(svgPath),
      JSON.stringify({ name: 'Lumen Vector', widthFraction: 0.5 }));
  }).then(function () {
    toast('Vector placed on the “Lumen AI” layer.');
    setStatus('Vector placed.', 'ok');
    btn.disabled = false;
  }, function (err) {
    setStatus('Vector generation failed', 'err'); toast(String(err.message || err), true); btn.disabled = false;
  });
});

/* ============================================================
   Boot
   ============================================================ */
(function init() {
  var all = readConfig();
  currentProvider = all.active;
  fillSettingsForm(activeConfig());
  setConnDot('');
  setStatus(window.LumenNode ? 'Ready. (Node bridge OK)' : 'Ready — Node bridge MISSING; keys and file output will not work.', window.LumenNode ? 'idle' : 'err');
})();

