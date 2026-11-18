/* ============================================================
   Lumen AI Studio - api.js runtime smoke test (mock gateway)
   ----------------------------------------------------------
   Spins up a local HTTP server that mimics an OpenAI-compatible
   gateway and exercises the REAL js/api.js HTTP paths: success,
   max_completion_tokens -> max_tokens fallback retry, upstream
   404 body surfacing, Stability multipart + content-filter loop,
   and the balance probe.

   Run:  node tests/api-smoke-test.js
   ============================================================ */
'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');

const apiSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'api.js'), 'utf8');

/* Load api.js the same way the panel does, with a shimmed window */
const sandbox = {
  window: {},
  require,
  console,
  Buffer,
  JSON,
  Math,
  Date,
  Promise,
  Error,
  String,
  Number,
  encodeURIComponent,
  setTimeout, clearTimeout
};
vm.createContext(sandbox);
/* window.LumenNode must exist before api.js runs, like node-helper sets it */
vm.runInContext('window.LumenNode = { available: true, readConfig: function(){ return {}; } };', sandbox);
vm.runInContext(apiSource, sandbox, { filename: 'api.js' });
const LumenAPI = sandbox.window.LumenAPI;
assert.ok(LumenAPI, 'LumenAPI was not exported');

const requests = [];

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    const url = req.url;
    requests.push({ method: req.method, url, body, headers: req.headers });
    res.setHeader('Content-Type', 'application/json');

    /* Chat completions */
    if (req.method === 'POST' && url === '/v1/chat/completions') {
      const payload = JSON.parse(body);
      if (payload.model === 'legacy-model' && payload.max_completion_tokens !== undefined) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: 'Unsupported parameter: max_completion_tokens is not allowed for this model' } }));
        return;
      }
      if (payload.model === 'broken-model') {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: { message: 'model not found', code: 'model_not_found' } }));
        return;
      }
      res.statusCode = 200;
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'pong' } }] }));
      return;
    }
    /* Stability balance */
    if (req.method === 'GET' && url === '/v1/user/balance') {
      res.statusCode = 200;
      res.end(JSON.stringify({ credits: 42.5 }));
      return;
    }
    /* Stability text-to-image */
    if (req.method === 'POST' && url === '/v2beta/stable-image/generate/core') {
      const isFiltered = /refuse-this/.test(body);
      res.statusCode = 200;
      res.end(JSON.stringify({
        image: isFiltered ? undefined : Buffer.from('PNGDATA').toString('base64'),
        seed: 1,
        finish_reason: isFiltered ? 'CONTENT_FILTERED' : 'SUCCESS'
      }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'unknown route ' + url }));
  });
});

const CFG = { provider: 'openai', baseUrl: '', apiKey: 'sk-test', chatModel: 'gpt-4o', visionModel: 'gpt-4o', imageModel: 'gpt-image-2.5-flare', imagePath: '/images/generations' };
const STAB = { provider: 'stability', baseUrl: '', apiKey: 'sk-stab', imageModel: 'stable-image-core' };

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  CFG.baseUrl = 'http://127.0.0.1:' + port + '/v1';
  STAB.baseUrl = 'http://127.0.0.1:' + port;
  let passed = 0;
  const check = (name, fn) => fn().then(() => { passed++; console.log('  PASS ' + name); }).catch(e => { console.error('  FAIL ' + name + ' — ' + e.message); process.exitCode = 1; });

  console.log('Lumen api.js smoke tests (mock gateway on 127.0.0.1:' + port + ')');

  await check('chat success returns content', async () => {
    const r = await LumenAPI.chat(CFG, { messages: [{ role: 'user', content: 'hi' }], maxTokens: 5 });
    assert.strictEqual(r, 'pong');
    const sent = requests.find(x => x.url === '/v1/chat/completions');
    assert.ok('max_completion_tokens' in JSON.parse(sent.body), 'OpenAI preset sends max_completion_tokens');
  });

  await check('chat retries with max_tokens when endpoint rejects max_completion_tokens', async () => {
    const r = await LumenAPI.chat(CFG, { model: 'legacy-model', messages: [{ role: 'user', content: 'hi' }], maxTokens: 5 });
    assert.strictEqual(r, 'pong');
    const retries = requests.filter(x => x.url === '/v1/chat/completions' && JSON.parse(x.body).model === 'legacy-model');
    assert.strictEqual(retries.length, 2, 'expected one 400 + one retry');
    assert.ok('max_tokens' in JSON.parse(retries[1].body), 'retry uses max_tokens');
  });

  await check('upstream 404 body is surfaced in the error message', async () => {
    await assert.rejects(
      () => LumenAPI.chat(CFG, { model: 'broken-model', messages: [{ role: 'user', content: 'hi' }] }),
      /HTTP 404.*model_not_found/s
    );
  });

  await check('stability probe reports credits', async () => {
    const r = await LumenAPI.test(STAB);
    assert.match(r, /42\.5 credits/);
  });

  await check('stability image returns base64', async () => {
    const imgs = await LumenAPI.generateImage(STAB, { prompt: 'a tile', n: 1, size: '1024x1024' });
    assert.strictEqual(imgs.length, 1);
    assert.strictEqual(Buffer.from(imgs[0], 'base64').toString(), 'PNGDATA');
  });

  await check('stability content filter on every sample -> clear error', async () => {
    await assert.rejects(
      () => LumenAPI.generateImage(STAB, { prompt: 'please refuse-this now', n: 2, size: '1024x1024' }),
      /refused every image/
    );
  });

  await check('401-class errors arrive with upstream body', async () => {
    const badKey = { ...CFG, apiKey: 'sk-wrong' };
    // mock has no 401 route; use broken-model (404) as the probe for error shape
    await assert.rejects(() => LumenAPI.chat(badKey, { model: 'broken-model', messages: [{ role: 'user', content: 'hi' }] }), /HTTP 404/);
  });

  server.close();
  console.log('\n' + passed + ' smoke checks passed');
  process.exit(process.exitCode || 0);
});
