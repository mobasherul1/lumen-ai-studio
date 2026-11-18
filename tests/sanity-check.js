/* Headless sanity checks — run with: node tests/sanity-check.js
   Checks: JS syntax (node --check), manifest XML well-formedness, required
   files present, manifest icon paths exist, no obvious hard-coded secrets. */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failures = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { console.error('  ✗ ' + m); failures++; };

console.log('1) JavaScript syntax (node --check)');
for (const f of ['js/CSInterface.js', 'js/node-helper.js', 'js/api.js', 'js/panel.js', 'jsx/lumen.jsx']) {
  // node --check only accepts .js/.mjs — copy non-.js sources to a temp .js first
  const srcPath = path.join(ROOT, f);
  let checkPath = srcPath;
  let tmp = null;
  if (path.extname(f) !== '.js') {
    tmp = path.join(require('os').tmpdir(), 'lumen-check-' + Buffer.from(f).toString('hex') + '.js');
    fs.copyFileSync(srcPath, tmp);
    checkPath = tmp;
  }
  try {
    execFileSync(process.execPath, ['--check', checkPath], { stdio: 'pipe' });
    ok(f);
  } catch (e) {
    bad(f + ' — ' + String(e.stderr || e.message).trim().slice(0, 300));
  } finally {
    if (tmp && fs.existsSync(tmp)) { fs.unlinkSync(tmp); }
  }
}

console.log('2) Manifest well-formedness');
const manifestPath = path.join(ROOT, 'CSXS', 'manifest.xml');
try {
  const xml = fs.readFileSync(manifestPath, 'utf8');
  // Minimal XML parser via python (stdlib) — no npm deps allowed in this repo
  execFileSync('python', ['-c', 'import sys,xml.etree.ElementTree as ET; ET.parse(sys.argv[1])', manifestPath], { stdio: 'pipe' });
  ok('manifest.xml parses');
  // Icon paths referenced by the manifest must exist
  const iconPaths = [...xml.matchAll(/<Icon[^>]*>\s*(?:\.\/)?([^<]+?\.png)\s*<\/Icon>/g)].map(m => m[1]);
  for (const p of iconPaths) {
    if (fs.existsSync(path.join(ROOT, p))) { ok('icon exists: ' + p); } else { bad('missing icon: ' + p); }
  }
  // Bundle folder name must match the extension id used in Window > Extensions
  const m = xml.match(/<Extension Id="([^"]+)"/);
  if (m) { ok('Extension Id: ' + m[1]); } else { bad('manifest has no <Extension Id=…>'); }
} catch (e) {
  bad('manifest.xml — ' + String(e.message).slice(0, 300));
}

console.log('3) Required files');
for (const f of ['index.html', 'css/panel.css', 'js/CSInterface.js', 'js/node-helper.js', 'js/api.js', 'js/panel.js', 'jsx/lumen.jsx', 'CSXS/manifest.xml', '.debug']) {
  if (fs.existsSync(path.join(ROOT, f))) { ok(f); } else { bad('missing: ' + f); }
}

console.log('4) No hard-coded secrets in shipped source');
const secretPatterns = [/sk-[A-Za-z0-9_-]{16,}/, /AKIA[0-9A-Z]{16}/, /Bearer\s+[A-Za-z0-9._-]{20,}/i];
const scanDirs = ['index.html', 'css', 'js', 'jsx', 'CSXS'];
function walk(p) {
  const stat = fs.statSync(p);
  if (stat.isDirectory()) { return fs.readdirSync(p).flatMap(f => walk(path.join(p, f))); }
  return [p];
}
for (const d of scanDirs) {
  for (const file of walk(path.join(ROOT, d))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const re of secretPatterns) {
      if (re.test(text)) { bad('possible secret matching ' + re + ' in ' + path.relative(ROOT, file)); }
    }
  }
}
ok('secret scan complete');

process.exit(failures ? 1 : 0);
