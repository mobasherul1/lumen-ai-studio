/* ============================================================
   Lumen AI Studio - Node bridge
   ----------------------------------------------------------
   CEP 10+ panels may enable Node.js (<CEFCommandLine>--enable-nodejs=true
   in the manifest). Everything filesystem-adjacent lives in this file
   so the rest of the panel stays plain DOM code and can be ported to a
   UXP panel with an afternoon of work.

   If Node is NOT available (locked-down host) exports degrade gracefully:
   window.LumenNode stays null and panel.js shows a clear status message
   instead of crashing.
   ============================================================ */
'use strict';

window.LumenNodeError = function LumenNodeError(message) {
  this.name = 'LumenNodeError';
  this.message = message;
};
window.LumenNodeError.prototype = Object.create(Error.prototype);

window.LumenNode = (function () {
  // Resolve require whether CEP exposes it globally (default) or under
  // window.cep_node (-mixed-context mode)
  var nodeRequire = (typeof require === 'function')
    ? require
    : (window.cep_node && window.cep_node.require)
      ? window.cep_node.require.bind(window.cep_node)
      : null;
  if (!nodeRequire) {
    // Fail loudly but gracefully - the Settings tab still renders.
    return null;
  }

  var fs   = nodeRequire('fs');
  var path = nodeRequire('path');
  var os   = nodeRequire('os');

  var CONFIG_DIR_NAME  = 'lumen-ai-studio';
  var CONFIG_FILE_NAME = 'config.json';

  /* Base directory for per-user data (keys!). Prefers CEP's own userData
     system path when CSInterface is present; falls back to a sane OS dir so
     the code also runs in a plain browser for development. */
  function userDataDir() {
    try {
      if (typeof CSInterface === 'function') {
        var cs = new CSInterface();
        // SystemPath.USER_DATA - per-user, per-extension writable folder.
        var base = cs.getSystemPath(SystemPath.USER_DATA);
        if (base) { return path.join(base, CONFIG_DIR_NAME); }
      }
    } catch (e) { /* fall through to OS default */ }
    return path.join(os.tmpdir(), 'lumen-ai-studio');
  }

  function configPath() { return path.join(userDataDir(), CONFIG_FILE_NAME); }
  function ensureDir(dir) { if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); } }

  function tempDir() { var d = path.join(os.tmpdir(), 'lumen-ai-studio'); ensureDir(d); return d; }
  function tempFile(name) { return path.join(tempDir(), name); }

  return {
    available: true,

    /* ---- config (API keys) ---------------------------------- */

    readConfig: function () {
      try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); }
      catch (e) { return {}; /* missing file = first run */ }
    },

    writeConfig: function (obj) {
      ensureDir(userDataDir());
      fs.writeFileSync(configPath(), JSON.stringify(obj, null, 2), { encoding: 'utf8', mode: 0o600 });
      return configPath();
    },

    clearConfig: function () {
      try { fs.unlinkSync(configPath()); return true; } catch (e) { return false; }
    },

    configPathDisplay: function () { return configPath(); },

    /* ---- file helpers ---------------------------------------- */

    writeTempText: function (name, contents) {
      var p = tempFile(name);
      fs.writeFileSync(p, contents, 'utf8');
      return p;
    },

    writeTempBase64: function (name, b64) {
      var p = tempFile(name);
      fs.writeFileSync(p, Buffer.from(b64, 'base64'));
      return p;
    },

    readFileBase64: function (p) {
      return fs.readFileSync(p).toString('base64');
    },

    fileExists: function (p) {
      try { return fs.existsSync(p); } catch (e) { return false; }
    }
  };
})();
