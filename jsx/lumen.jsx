/* ============================================================
   Lumen AI Studio - ExtendScript (JSX) host for Illustrator
   ----------------------------------------------------------
   Loaded indirectly: js/panel.js reads this file with Node's fs,
   appends a one-line dispatch call, and hands the string to
   CSInterface.evalScript(). This keeps a single source of truth
   (this file) and avoids $.evalFile() path-escaping problems on
   paths that contain spaces. (manifest.xml also lists this file as
   ScriptPath - harmless duplicate definition.)

   Every public function returns a JSON string:
       { ok: true, ... }   or   { ok: false, error: "message" }
   so the panel never parses raw ExtendScript exceptions - and CEP
   reports evalScript failures as plain strings anyway.

   ExtendScript is ES3-era JavaScript. Keep it plain: var, no arrow
   functions, no Promises, no let/const.
   ============================================================ */

var LUMEN_LAYER = 'Lumen AI';

/* ---------- tiny JSON helpers (ExtendScript ships native JSON) ---------- */
function lumen_jsonStringify(v) {
  if (v === null) { return 'null'; }
  var t = typeof v;
  if (t === 'number' || t === 'boolean') { return String(v); }
  if (t === 'string') {
    return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      .replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
  }
  if (v instanceof Array) {
    var parts = [];
    for (var i = 0; i < v.length; i++) { parts.push(lumen_jsonStringify(v[i])); }
    return '[' + parts.join(',') + ']';
  }
  var out = [];
  for (var k in v) {
    if (v.hasOwnProperty(k)) { out.push('"' + lumen_escapeKey(k) + '":' + lumen_jsonStringify(v[k])); }
  }
  return '{' + out.join(',') + '}';
}
function lumen_escapeKey(k) {
  return String(k).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
function lumen_jsonParse(s) {
  if (typeof JSON !== 'undefined' && JSON.parse) { return JSON.parse(s); }
  return eval('(' + s + ')'); /* last-resort, our own data only */
}
function lumen_err(e) {
  return lumen_jsonStringify({ ok: false, error: String(e && e.message ? e.message : e) });
}
function lumen_ok(extra) {
  extra = extra || {};
  extra.ok = true;
  return lumen_jsonStringify(extra);
}

/* ---------- color math ---------- */
function lumen_lin(c01) {
  return c01 <= 0.03928 ? c01 / 12.92 : Math.pow((c01 + 0.055) / 1.055, 2.4);
}
function lumen_relLum255(r, g, b) { /* sRGB relative luminance (Rec.709) */
  return 0.2126 * lumen_lin(r / 255) + 0.7152 * lumen_lin(g / 255) + 0.0722 * lumen_lin(b / 255);
}
function lumen_hexToRgb(hex) {
  var h = String(hex).replace('#', '');
  if (h.length === 3) { h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2); }
  return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
}

/* Read any practical fill color into {space, r, g, b (0-255 approx)} or null. */
function lumen_readFill(col) {
  if (!col) { return null; }
  var t = col.typename;
  if (t === 'RGBColor') { return { space: 'RGB', r: col.red, g: col.green, b: col.blue }; }
  if (t === 'GrayColor') { var v = Math.round(255 * (1 - col.gray / 100)); return { space: 'Gray', r: v, g: v, b: v }; }
  if (t === 'CMYKColor') {
    var k = col.black; /* 0-100 */
    return {
      space: 'CMYK',
      r: Math.round(255 * (1 - Math.min(100, col.cyan + k) / 100)),
      g: Math.round(255 * (1 - Math.min(100, col.magenta + k) / 100)),
      b: Math.round(255 * (1 - Math.min(100, col.yellow + k) / 100))
    };
  }
  return null; /* Spot/Gradient/Pattern/NoColor - skip */
}
/* Build a Color object of the SAME space the source used, from an RGB triple. */
function lumen_makeFill(space, r, g, b) {
  if (space === 'CMYK') {
    var c = new CMYKColor();
    var rr = r / 255, gg = g / 255, bb = b / 255;
    var k = 1 - Math.max(rr, gg, bb);
    if (k >= 1) { c.cyan = 0; c.magenta = 0; c.yellow = 0; c.black = 100; return c; }
    c.cyan    = Math.round((1 - rr - k) / (1 - k) * 100);
    c.magenta = Math.round((1 - gg - k) / (1 - k) * 100);
    c.yellow  = Math.round((1 - bb - k) / (1 - k) * 100);
    c.black   = Math.round(k * 100);
    return c;
  }
  if (space === 'Gray') {
    var gc = new GrayColor();
    var lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    gc.gray = Math.round((1 - lum) * 100);
    return gc;
  }
  var rgb = new RGBColor();
  rgb.red = Math.round(r); rgb.green = Math.round(g); rgb.blue = Math.round(b);
  return rgb;
}

/* ---------- document / layer helpers ---------- */
function lumen_activeDoc() {
  if (app.documents.length === 0) { throw new Error('No document open in Illustrator.'); }
  return app.activeDocument;
}
function lumen_activeArtboardRect(doc) {
  return doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect; /* [left, top, right, bottom]; top > bottom (y-flip, negative y) */
}
function lumen_findOrCreateLayer(doc, name) {
  for (var i = 0; i < doc.layers.length; i++) {
    if (doc.layers[i].name === name) { return doc.layers[i]; }
  }
  var layer = doc.layers.add(); /* added on top of the stack */
  layer.name = name;
  return layer;
}
/* Recursively walk selection, expanding groups and compound paths */
function lumen_walkFills(item, out) {
  if (!item) { return; }
  var t = item.typename;

  if (t === 'GroupItem') {
    if (item.pageItems) {
      for (var i = 0; i < item.pageItems.length; i++) { lumen_walkFills(item.pageItems[i], out); }
    }
    return;
  }
  if (t === 'CompoundPathItem') {
    if (item.pathItems) {
      for (var j = 0; j < item.pathItems.length; j++) { lumen_walkFills(item.pathItems[j], out); }
    }
    return;
  }
  if (t === 'TextFrame') {
    /* TextFrame has no fillColor of its own - fills live on the character range */
    try {
      var cf = item.textRange.characterAttributes.fillColor;
      var parsed = lumen_readFill(cf);
      if (parsed) { out.push({ item: item, space: parsed.space, isText: true, lum: lumen_relLum255(parsed.r, parsed.g, parsed.b) }); }
    } catch (e) { /* empty frame etc. */ }
    return;
  }
  /* PathItem and friends */
  try {
    if (item.filled && item.fillColor) {
      var p = lumen_readFill(item.fillColor);
      if (p) { out.push({ item: item, space: p.space, isText: false, lum: lumen_relLum255(p.r, p.g, p.b) }); }
    }
  } catch (e) { /* rasters/placed links - no fill; skip */ }
}
function lumen_normalizeSelection(doc) {
  var sel = doc.selection;
  if (!sel) { return []; }
  if (sel.typename === 'TextRange') { return 'TEXT_RANGE'; } /* lone selected range, not an item array */
  if (typeof sel.length === 'number') { return sel; }
  return [sel];
}
function lumen_setFill(entry, rgbHex) {
  var rgb = lumen_hexToRgb(rgbHex);
  var col = lumen_makeFill(entry.space, rgb[0], rgb[1], rgb[2]);
  if (entry.isText) { entry.item.textRange.characterAttributes.fillColor = col; }
  else { entry.item.fillColor = col; }
}

/* Run host work with warning dialogs suppressed; restore state afterwards. */
function lumen_begin(doc) {
  try { app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS; } catch (e) {}
  try { app.redraw(); } catch (e) {}
}
function lumen_end(doc) {
  try { app.redraw(); } catch (e) {}
  try { app.userInteractionLevel = UserInteractionLevel.INTERACTWITHALL; } catch (e) {}
}

/* ============================================================
   1. Lumen_getState - cheap capability probe for button states
   ============================================================ */
function Lumen_getState() {
  try {
    if (app.documents.length === 0) { return lumen_ok({ hasDoc: false, selectionCount: 0 }); }
    var doc = app.activeDocument;
    var sel = lumen_normalizeSelection(doc);
    var types = [];
    if (sel === 'TEXT_RANGE') { types = ['TextRange']; }
    else if (sel.length) { for (var i = 0; i < Math.min(sel.length, 5); i++) { types.push(sel[i].typename); } }
    return lumen_ok({
      hasDoc: true,
      fileName: doc.name,
      selectionCount: sel === 'TEXT_RANGE' ? 1 : sel.length,
      selectionTypes: types,
      artboardIndex: doc.artboards.getActiveArtboardIndex()
    });
  } catch (e) { return lumen_err(e); }
}

/* ============================================================
   2. Lumen_applyPalette - remap selection fills to a palette
   ============================================================ */
function Lumen_applyPalette(paletteJson) {
  try {
    var doc = lumen_activeDoc();
    var hexList = lumen_jsonParse(paletteJson);
    if (!hexList || hexList.length === 0) { return lumen_err('Empty palette.'); }

    var palette = [];
    for (var i = 0; i < hexList.length; i++) {
      var rgb = lumen_hexToRgb(hexList[i]);
      palette.push({ hex: hexList[i], lum: lumen_relLum255(rgb[0], rgb[1], rgb[2]) });
    }
    palette.sort(function (a, b) { return a.lum - b.lum; });

    var sel = lumen_normalizeSelection(doc);
    if (sel === 'TEXT_RANGE') { return lumen_err('Text characters are selected - select objects (or whole text frames) instead.'); }
    if (!sel.length) { return lumen_err('Nothing selected on the artboard.'); }

    var targets = [];
    for (var j = 0; j < sel.length; j++) { lumen_walkFills(sel[j], targets); }
    if (targets.length === 0) { return lumen_err('No recolorable fills in the selection (gradients, placed rasters and spot/gradient fills are skipped).'); }

    targets.sort(function (a, b) { return a.lum - b.lum; });
    var nFills = targets.length, nPal = palette.length;

    lumen_begin(doc);
    var changed = 0, failed = 0;
    try {
      for (var k = 0; k < nFills; k++) {
        var rank = nFills === 1 ? Math.floor(nPal / 2) : Math.round(k * (nPal - 1) / (nFills - 1));
        try {
          lumen_setFill(targets[k], palette[rank].hex);
          changed++;
        } catch (e) { failed++; /* e.g. locked layer item - skip, don't abort the whole recolor */ }
      }
    } finally {
      lumen_end(doc);
    }
    return lumen_ok({ recolored: changed, failed: failed, colors: hexList.length });
  } catch (e) { return lumen_err(e); }
}

/* ============================================================
   3. Lumen_exportArtboardPng - snapshot the active artboard
      (scales down so the longest edge stays <= maxPixels,
       keeping vision-model uploads small)
   ============================================================ */
function Lumen_exportArtboardPng(targetPath, optionsJson) {
  try {
    var doc = lumen_activeDoc();
    var options = optionsJson ? lumen_jsonParse(optionsJson) : {};
    var maxPixels = options.maxPixels || 1568;

    var r = lumen_activeArtboardRect(doc);
    var abW = Math.abs(r[2] - r[0]), abH = Math.abs(r[1] - r[3]); /* points; 1 pt = 1 px at 100% */
    var longest = Math.max(abW, abH);
    var scale = longest > maxPixels ? Math.floor((maxPixels / longest) * 100) : 100;

    var opts = new ExportOptionsPNG24();
    opts.artBoardClipping = true;  /* clip to the ACTIVE artboard */
    opts.antiAliasing     = true;
    opts.transparency     = true;
    opts.horizontalScale  = scale;
    opts.verticalScale    = scale;

    lumen_begin(doc);
    var file = new File(String(targetPath));
    try { doc.exportFile(file, ExportType.PNG24, opts); } finally { lumen_end(doc); }

    if (!file.exists) { return lumen_err('Illustrator did not produce the PNG at ' + targetPath); }
    return lumen_ok({ path: file.fsName, scale: scale });
  } catch (e) { return lumen_err(e); }
}

/* ============================================================
   4. Lumen_placeFile - drop PNG/SVG onto the Lumen AI layer
      PNG  -> linked PlacedItem, then embedded (no temp-file dep)
      SVG  -> GroupItems.createFromFile (EDITABLE vector grp)
   ============================================================ */
function Lumen_placeFile(targetPath, optionsJson) {
  try {
    var doc = lumen_activeDoc();
    var options = optionsJson ? lumen_jsonParse(optionsJson) : {};
    var widthFraction = options.widthFraction || 0.8;

    var file = new File(String(targetPath));
    if (!file.exists) { return lumen_err('File not found: ' + targetPath); }

    var layer = lumen_findOrCreateLayer(doc, LUMEN_LAYER);
    var prevActive = doc.activeLayer;
    doc.activeLayer = layer;

    var isSvg = /\.svg$/i.test(String(targetPath));
    var item = null;

    lumen_begin(doc);
    try {
      if (isSvg) {
        item = doc.groupItems.createFromFile(file); /* import as editable vector group */
        if (options.name) { try { item.name = options.name; } catch (e) {} }
      } else {
        item = doc.placedItems.add();
        item.file = file;                        /* zero-arg ctor then assign .file (ImageTracing.jsx pattern) */
        if (options.name) { try { item.name = options.name; } catch (e) {} }
        try { item.embed(); } catch (e) { /* embed best-effort; link still works */ }
      }

      var r  = lumen_activeArtboardRect(doc);
      var cx = (r[0] + r[2]) / 2;
      var cy = (r[1] + r[3]) / 2;
      var abW = Math.abs(r[2] - r[0]);

      /* Downscale to fit widthFraction of the artboard (never upscale) */
      var targetW = abW * widthFraction;
      if (item.width > targetW && item.width > 0) {
        var pct = (targetW / item.width) * 100;
        item.resize(pct, pct, true, true, true, true, true, Transformation.CENTER);
      }
      /* position = top-left; y axis in document coords is flipped (up = negative) */
      var cascade = (options.cascade || 0) * 18;
      item.position = [cx - item.width / 2 + cascade, cy + item.height / 2 - cascade];

      try { app.redraw(); } catch (e) {}
    } finally {
      try { doc.activeLayer = prevActive; } catch (e) {}  /* restore the user's active layer */
      lumen_end(doc);
    }
    return lumen_ok({ layer: LUMEN_LAYER, kind: isSvg ? 'vector-group' : 'embedded-raster', width: item.width, height: item.height });
  } catch (e) { return lumen_err(e); }
}

/* ============================================================
   5. Lumen_writeText - inject copy into selection or new frame
   ============================================================ */
function Lumen_writeText(text, optionsJson) {
  try {
    var doc = lumen_activeDoc();
    var options = optionsJson ? lumen_jsonParse(optionsJson) : {};
    var sel = doc.selection;

    /* Case A1: exactly one selected text frame -> replace contents */
    if (sel && typeof sel.length === 'number' && sel.length === 1 && sel[0].typename === 'TextFrame') {
      lumen_begin(doc);
      try { sel[0].contents = String(text); } finally { lumen_end(doc); }
      return lumen_ok({ mode: 'replaced', layer: sel[0].layer.name });
    }
    /* Case A2: a text RANGE is selected -> replace just that range */
    if (sel && sel.typename === 'TextRange') {
      lumen_begin(doc);
      try { sel.contents = String(text); } finally { lumen_end(doc); }
      return lumen_ok({ mode: 'replaced-range' });
    }
    /* Case B: create a new point-text frame, centered on the artboard */
    var layer = lumen_findOrCreateLayer(doc, LUMEN_LAYER);
    var prevActive = doc.activeLayer;
    doc.activeLayer = layer;

    var r  = lumen_activeArtboardRect(doc);
    var cx = (r[0] + r[2]) / 2;
    var cy = (r[1] + r[3]) / 2;

    lumen_begin(doc);
    try {
      var tf = doc.textFrames.add();           /* point text */
      tf.contents = String(text);
      try { app.redraw(); } catch (e) {}       /* flush bounds before reading them */
      tf.position = [cx - tf.width / 2, cy + tf.height / 2];
    } finally {
      try { doc.activeLayer = prevActive; } catch (e) {}
      lumen_end(doc);
    }
    return lumen_ok({ mode: 'created', layer: LUMEN_LAYER });
  } catch (e) { return lumen_err(e); }
}
