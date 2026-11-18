/* ============================================================
   Lumen AI Studio - headless host test (ExtendScript mock)
   ----------------------------------------------------------
   Runs jsx/lumen.jsx inside a Node vm with a mocked Illustrator
   DOM and asserts the JSON contracts the panel relies on.
   This is NOT a substitute for a real Illustrator run (see
   docs/DEMO.md), but it catches the majority of logic errors.

   Run:  node tests/host-mock-test.js
   ============================================================ */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');

const JSX_PATH = path.join(__dirname, '..', 'jsx', 'lumen.jsx');
const jsxSource = fs.readFileSync(JSX_PATH, 'utf8');

/* ------------ Mock Illustrator DOM primitives ------------ */
function colorClass(typename) {
  return class {
    constructor() { this.typename = typename; }
  };
}
class RGBColor extends colorClass('RGBColor') {}
class CMYKColor extends colorClass('CMYKColor') {}
class GrayColor extends colorClass('GrayColor') {}
class ExportOptionsPNG24 {
  constructor() { this.artBoardClipping = undefined; this.horizontalScale = undefined; }
}
const ExportType = { PNG24: 5, SVG: 3, JPEG: 1 };
const UserInteractionLevel = { DONTDISPLAYALERTS: 1, INTERACTWITHALL: 0 };
const Transformation = { CENTER: 'CENTER' };
class File {
  constructor(p) { this._p = String(p); this.fsName = String(p).replace(/\\/g, '/'); }
  get exists() { return fs.existsSync(this._p); }
}
class Folder {}

/* ------------ Mock document factory ------------ */
let createdItems;   // capture everything jsx creates/places
function makeDoc() {
  createdItems = { placed: [], groups: [], textFrames: [], exportCalls: [] };
  const layers = [];
  layers.add = function () {
    const l = { name: 'Layer ' + (layers.length + 1), pageItems: [] };
    layers.push(l);
    return l;
  };
  const baseLayer = { name: 'Background', pageItems: [] };
  layers.push(baseLayer);

  const abRect = [0, 0, 595, -842];  // A4 portrait, y-flipped: top(0) > bottom(-842)
  const artboards = [{ artboardRect: abRect }];
  artboards.getActiveArtboardIndex = () => 0;

  const doc = {
    name: 'mock.ai',
    layers,
    activeLayer: baseLayer,
    artboards,
    selection: [],
    placedItems: {
      add: function () {
        const item = {
          typename: 'PlacedItem', width: 800, height: 800, position: null,
          _file: null, embedCalled: false,
          set file(f) { this._file = f; createdItems.placed.push(this); },
          get file() { return this._file; },
          resize: function (pct) { this.width = this.width * pct / 100; this.height = this.height * pct / 100; },
          embed: function () { this.embedCalled = true; }
        };
        return item;
      }
    },
    groupItems: {
      createFromFile: function (f) {
        const g = {
          typename: 'GroupItem', width: 256, height: 256, position: null, _file: f,
          resize: function (pct) { this.width = this.width * pct / 100; this.height = this.height * pct / 100; }
        };
        createdItems.groups.push(g);
        return g;
      }
    },
    textFrames: {
      add: function () {
        const tf = {
          typename: 'TextFrame', contents: '', width: 400, height: 20, position: null, layer: null,
          textRange: { characterAttributes: {} }
        };
        createdItems.textFrames.push(tf);
        return tf;
      }
    },
    exportFile: function (file, type, opts) {
      createdItems.exportCalls.push({ file: String(file._p), type, opts });
      fs.writeFileSync(file._p, 'FAKE-PNG-BYTES');
    }
  };
  return doc;
}

function makeApp() {
  const doc = makeDoc();
  const app = {
    documents: [doc],
    activeDocument: doc,
    userInteractionLevel: UserInteractionLevel.INTERACTWITHALL,
    redraw: function () {}
  };
  return app;
}

/* ------------ Build the vm context ------------ */
const app = makeApp();
const sandbox = {
  app, File, Folder, RGBColor, CMYKColor, GrayColor,
  ExportOptionsPNG24, ExportType, UserInteractionLevel, Transformation,
  JSON, Math, console
};
vm.createContext(sandbox);
vm.runInContext(jsxSource, sandbox, { filename: 'lumen.jsx' });

/* Helper: run a host fn and parse its JSON reply */
function call(fn, ...args) {
  const quoted = args.map(a => JSON.stringify(String(a))).join(',');
  const out = vm.runInContext(fn + '(' + quoted + ')', sandbox);
  return JSON.parse(out);
}

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('  PASS ' + name);
}

console.log('Lumen host-mock tests');

check('Lumen_getState reports the open document and empty selection', () => {
  const r = call('Lumen_getState');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.hasDoc, true);
  assert.strictEqual(r.selectionCount, 0);
});

check('Lumen_applyPalette with empty palette errors', () => {
  const r = call('Lumen_applyPalette', '[]');
  assert.strictEqual(r.ok, false);
});

check('Lumen_applyPalette errors with nothing selected', () => {
  app.activeDocument.selection = [];
  const r = call('Lumen_applyPalette', JSON.stringify(['#102030', '#dfe8f0']));
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /Nothing selected/);
});

check('Lumen_applyPalette remaps dark fills to the dark palette color', () => {
  // Two flat-filled paths: near-black and near-white
  const dark = new RGBColor(); dark.red = 20; dark.green = 20; dark.blue = 20;
  const light = new RGBColor(); light.red = 240; light.green = 240; light.blue = 240;
  app.activeDocument.selection = [
    { typename: 'PathItem', filled: true, fillColor: light },
    { typename: 'PathItem', filled: true, fillColor: dark }
  ];
  const r = call('Lumen_applyPalette', JSON.stringify(['#10335c', '#f2e8d5']));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.recolored, 2);
  const [palDark, palLight] = ['#10335c', '#f2e8d5'];
  assert.strictEqual(app.activeDocument.selection[1].fillColor.red, 16);   // #10 -> 16
  assert.strictEqual(app.activeDocument.selection[0].fillColor.red, 242);  // #f2 -> 242
});

check('Lumen_applyPalette recolors text-frame fills via characterAttributes', () => {
  const textFill = new RGBColor(); textFill.red = 30; textFill.green = 30; textFill.blue = 30;
  const tf = { typename: 'TextFrame', textRange: { characterAttributes: { fillColor: textFill } } };
  app.activeDocument.selection = [tf];
  const r = call('Lumen_applyPalette', JSON.stringify(['#ff0000', '#00ff00']));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.recolored, 1);
  // single fill gets the middle palette rank: floor(2/2) = 1 -> #00ff00 (green)
  assert.strictEqual(tf.textRange.characterAttributes.fillColor.green, 255);
  assert.strictEqual(tf.textRange.characterAttributes.fillColor.red, 0);
});

check('Lumen_applyPalette expands compound paths and groups', () => {
  const f1 = new RGBColor(); f1.red = 10; f1.green = 10; f1.blue = 10;
  const f2 = new RGBColor(); f2.red = 230; f2.green = 230; f2.blue = 230;
  const compound = { typename: 'CompoundPathItem', pathItems: [
    { typename: 'PathItem', filled: true, fillColor: f1 },
    { typename: 'PathItem', filled: true, fillColor: f2 }
  ] };
  app.activeDocument.selection = [{ typename: 'GroupItem', pageItems: [compound] }];
  const r = call('Lumen_applyPalette', JSON.stringify(['#000000', '#ffffff']));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.recolored, 2);
});

check('Lumen_exportArtboardPng exports with artBoardClipping and honors maxPixels', () => {
  const target = path.join(os.tmpdir(), 'lumen-mock-export-' + process.pid + '.png');
  const r = call('Lumen_exportArtboardPng', target.replace(/\\/g, '/'), JSON.stringify({ maxPixels: 400 }));
  assert.strictEqual(r.ok, true);
  assert.ok(createdItems.exportCalls.length === 1);
  const { opts, type } = createdItems.exportCalls[0];
  assert.strictEqual(type, ExportType.PNG24);
  assert.strictEqual(opts.artBoardClipping, true);
  assert.ok(opts.horizontalScale <= 100);
  fs.unlinkSync(target);
});

check('Lumen_placeFile places and embeds a PNG on the Lumen AI layer', () => {
  const png = path.join(os.tmpdir(), 'lumen-mock-in-' + process.pid + '.png');
  fs.writeFileSync(png, 'fake');
  const before = app.activeDocument.activeLayer;
  const r = call('Lumen_placeFile', png.replace(/\\/g, '/'), JSON.stringify({ name: 'T', widthFraction: 0.8 }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.layer, 'Lumen AI');
  assert.strictEqual(r.kind, 'embedded-raster');
  assert.ok(createdItems.placed.length === 1);
  assert.strictEqual(createdItems.placed[0].embedCalled, true);
  assert.strictEqual(app.activeDocument.activeLayer, before, 'active layer restored');
  fs.unlinkSync(png);
});

check('Lumen_placeFile imports SVG as an editable vector group', () => {
  const svg = path.join(os.tmpdir(), 'lumen-mock-in-' + process.pid + '.svg');
  fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
  const r = call('Lumen_placeFile', svg.replace(/\\/g, '/'), JSON.stringify({ name: 'V', widthFraction: 0.5 }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.kind, 'vector-group');
  assert.strictEqual(createdItems.groups.length, 1);
  fs.unlinkSync(svg);
});

check('Lumen_placeFile fails cleanly on a missing file', () => {
  const r = call('Lumen_placeFile', os.tmpdir().replace(/\\/g, '/') + '/definitely-not-here-12345.png', '{}');
  assert.strictEqual(r.ok, false);
});

check('Lumen_writeText replaces a single selected text frame', () => {
  app.activeDocument.selection = [{
    typename: 'TextFrame', contents: 'old', layer: { name: 'Foreground' },
    textRange: { characterAttributes: {} }
  }];
  const r = call('Lumen_writeText', 'New headline');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.mode, 'replaced');
  assert.strictEqual(app.activeDocument.selection[0].contents, 'New headline');
});

check('Lumen_writeText replaces a selected text RANGE', () => {
  app.activeDocument.selection = { typename: 'TextRange', contents: 'old range' };
  const r = call('Lumen_writeText', 'Range copy');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.mode, 'replaced-range');
  assert.strictEqual(app.activeDocument.selection.contents, 'Range copy');
});

check('Lumen_writeText creates a new frame on Lumen AI when nothing is selected', () => {
  app.activeDocument.selection = [];
  const r = call('Lumen_writeText', 'Fresh headline');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.mode, 'created');
  assert.strictEqual(r.layer, 'Lumen AI');
  assert.ok(createdItems.textFrames.length >= 1);
  assert.strictEqual(createdItems.textFrames[createdItems.textFrames.length - 1].contents, 'Fresh headline');
});

check('Host JSON round-trips unicode and quotes safely', () => {
  const r = call('Lumen_writeText', 'Quirky “copy” — with π & \\ backslash');
  assert.strictEqual(r.ok, true);
  const tfs = createdItems.textFrames;
  assert.strictEqual(tfs[tfs.length - 1].contents, 'Quirky “copy” — with π & \\ backslash');
});

console.log('\n' + passed + ' tests passed');
process.exit(0);
