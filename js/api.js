/* ============================================================
   Lumen AI Studio - OpenAI-compatible HTTPS client
   ----------------------------------------------------------
   Deliberately dependency-free (Node's built-in http/https only).
   One config object drives OpenAI, Azure OpenAI, OpenRouter,
   LM Studio, Ollama and any other compatible gateway:

     { provider, baseUrl, apiKey, chatModel, visionModel, imageModel, imagePath }

   Behaviours worth knowing:
   - Upstream non-2xx errors surface a truncated response body so the
     user sees *why* a call failed (bad key, wrong model, quota...).
   - Redirects are followed (max 5), including for image downloads.
   - OpenAI/Azure use max_completion_tokens; everyone else gets
     max_tokens. If the API rejects the chosen one with a 400 that
     names it, the call is retried once with the other spelling.
   ============================================================ */
'use strict';

window.LumenAPI = (function () {
  if (!window.LumenNode || !window.LumenNode.available) { return null; }

  // Resolve require whether CEP exposes it globally or under window.cep_node
  var nodeRequire = (typeof require === 'function')
    ? require
    : (window.cep_node && window.cep_node.require)
      ? window.cep_node.require.bind(window.cep_node)
      : null;
  if (!nodeRequire) { return null; }

  var https = nodeRequire('https');
  var http  = nodeRequire('http');
  var url   = nodeRequire('url');

  var REDIR = { 301: 1, 302: 1, 303: 1, 307: 1, 308: 1 };
  function isRedirect(s) { return !!REDIR[s]; }
  function timeoutSecs(ms) { return Math.round(((ms || 90000) / 1000)); }

  function guardParsed(target) {
    if (!target || !target.hostname) {
      throw new Error('Invalid URL: ' + JSON.stringify(target && target.href ? target.href : target) + ' - check Settings > Base URL.');
    }
    return target;
  }

  /* Shared low-level request. Follows redirects (max 5). Resolves
     { status, body, headers }. body = utf8 string unless opts.binary. */
  function rawRequest(opts) {
    var redirects = opts.redirects || 0;
    return new Promise(function (resolve, reject) {
      var target;
      try { target = guardParsed(url.parse(opts.urlString)); }
      catch (e) { return reject(e); }
      var lib = target.protocol === 'http:' ? http : https;
      var bodyBuf = opts.body ? Buffer.from(opts.body, 'utf8') : (opts.bodyBuf || null);
      var headers = {};
      for (var k in opts.headers) { headers[k] = opts.headers[k]; }
      if (bodyBuf && !headers['Content-Length'] && !headers['content-length']) { headers['Content-Length'] = bodyBuf.length; }

      var req = lib.request({
        method: opts.method || 'GET',
        hostname: target.hostname,
        port: target.port || (target.protocol === 'http:' ? 80 : 443),
        path: target.path || '/',
        headers: headers,
        timeout: opts.timeoutMs || 90000
      }, function (res) {
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('error', reject);
        res.on('end', function () {
          var status = res.statusCode || 0;
          var location = res.headers && res.headers.location;
          if (isRedirect(status) && location && redirects < 5) {
            var next = url.resolve(opts.urlString, String(location));
            var method = status === 303 ? 'GET' : (opts.method || 'GET');
            var body = status === 303 ? undefined : opts.body;
            return resolve(rawRequest({
              method: method, urlString: next, headers: opts.headers || {},
              body: body, bodyBuf: status === 303 ? null : opts.bodyBuf,
              timeoutMs: opts.timeoutMs, binary: opts.binary, redirects: redirects + 1
            }));
          }
          var buf = Buffer.concat(chunks);
          resolve({ status: status, body: opts.binary ? buf : buf.toString('utf8'), headers: res.headers });
        });
      });
      req.on('timeout', function () { req.destroy(new Error('Request timed out after ' + timeoutSecs(opts.timeoutMs) + 's')); });
      req.on('error', reject);
      if (bodyBuf) { req.write(bodyBuf); }
      req.end();
    });
  }

  /* Build a minimal multipart/form-data body from a flat {name: value} map.
     CR/LF in values would break multipart framing - strip them. */
  function buildMultipart(boundary, fields) {
    var parts = [];
    for (var name in fields) {
      var value = String(fields[name]).replace(/[\r\n]+/g, ' ');
      parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"\r\n\r\n' + value + '\r\n', 'utf8'));
    }
    parts.push(Buffer.from('--' + boundary + '--\r\n', 'utf8'));
    return parts;
  }

  function joinUrl(baseUrl, suffix) {
    return String(baseUrl || '').replace(/\/+$/, '') + '/' + String(suffix || '').replace(/^\/+/, '');
  }

  /* Auth + content-type per provider.
     Azure v1 API: 'api-key' header, no api-version, base URL .../openai/v1 */
  function authParts(cfg, pathSuffix, hasBody) {
    var headers = { 'Accept': 'application/json' };
    if (hasBody) { headers['Content-Type'] = 'application/json'; }
    if (cfg.provider === 'azure') {
      headers['api-key'] = cfg.apiKey || '';
    } else {
      headers['Authorization'] = 'Bearer ' + (cfg.apiKey || '');
    }
    return { headers: headers, path: pathSuffix };
  }

  function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '...' : s; }

  /* POST JSON; throw descriptive error on non-2xx. */
  async function postJson(cfg, pathSuffix, payload, timeoutMs) {
    var a = authParts(cfg, pathSuffix, true);
    var res = await rawRequest({
      method: 'POST',
      urlString: joinUrl(cfg.baseUrl, a.path),
      headers: a.headers,
      body: JSON.stringify(payload),
      timeoutMs: timeoutMs
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error('HTTP ' + res.status + ' from ' + pathSuffix + ' - ' + truncate(res.body, 400));
    }
    try { return JSON.parse(res.body); }
    catch (e) { throw new Error('Upstream returned non-JSON from ' + pathSuffix + ' - ' + truncate(res.body, 300)); }
  }

  async function getJson(cfg, pathSuffix, timeoutMs) {
    var a = authParts(cfg, pathSuffix, false);
    var res = await rawRequest({
      method: 'GET',
      urlString: joinUrl(cfg.baseUrl, a.path),
      headers: a.headers,
      timeoutMs: timeoutMs
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error('HTTP ' + res.status + ' from ' + pathSuffix + ' - ' + truncate(res.body, 400));
    }
    try { return JSON.parse(res.body); }
    catch (e) { throw new Error('Upstream returned non-JSON from ' + pathSuffix + ' - ' + truncate(res.body, 300)); }
  }

  /* Fetch a remote image URL and return base64 (no auth - signed URLs). */
  async function urlToBase64(imageUrl) {
    var res = await rawRequest({ method: 'GET', urlString: imageUrl, headers: {}, timeoutMs: 120000, binary: true });
    if (res.status < 200 || res.status >= 300) {
      throw new Error('Image download failed: HTTP ' + res.status);
    }
    var body = res.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new Error('Image download produced no bytes.');
    }
    if (body.length > 25 * 1024 * 1024) {
      throw new Error('Image download exceeded 25 MB - refusing to buffer more.');
    }
    return body.toString('base64');
  }

  /* Which token-limit spelling does this model want? */
  function tokenKeyFor(cfg, model) {
    if (cfg.provider === 'openai' || cfg.provider === 'azure') { return 'max_completion_tokens'; }
    if (/^(gpt-4o|gpt-4\.1|gpt-5|o\d|chatgpt-4o)/.test(String(model || ''))) { return 'max_completion_tokens'; }
    return 'max_tokens';
  }
  /* Does the error complain about the token-limit key we chose? If so, the
     gateway wants the other spelling — trigger the single retry. */
  function mentionsOtherTokenKey(errText, key) {
    var s = String(errText || '');
    var re = key === 'max_completion_tokens' ? /max_completion_tokens/i : /max_tokens/i;
    return re.test(s) && /(unsupported|invalid|unknown|unexpected|deprecated|not allowed|not permitted|unrecognized)/i.test(s);
  }

  /* ---- shared chat implementation (closure; also used by test()) ---- */
  async function doChat(cfg, options) {
    var model = options.model || cfg.chatModel;
    var tokenKey = tokenKeyFor(cfg, model);
    var maxTokens = (options.maxTokens && options.maxTokens > 0) ? options.maxTokens : 900;
    var base = {
      model: model,
      messages: options.messages,
      temperature: options.temperature != null ? options.temperature : 0.8
    };
    base[tokenKey] = maxTokens;
    try {
      var data = await postJson(cfg, '/chat/completions', base, options.timeoutMs || 120000);
      return readChatMessage(data);
    } catch (err) {
      /* retry once with the other token-limit spelling when the API asks us to */
      if (mentionsOtherTokenKey(err.message, tokenKey)) {
        var other = tokenKey === 'max_completion_tokens' ? 'max_tokens' : 'max_completion_tokens';
        var retry = { model: base.model, messages: base.messages, temperature: base.temperature };
        retry[other] = maxTokens;
        var data2 = await postJson(cfg, '/chat/completions', retry, options.timeoutMs || 120000);
        return readChatMessage(data2);
      }
      throw err;
    }
  }
  function readChatMessage(data) {
    var msg = data && data.choices && data.choices[0] && data.choices[0].message;
    if (!msg || typeof msg.content !== 'string') {
      throw new Error('Unexpected chat response shape: ' + truncate(JSON.stringify(data), 300));
    }
    return msg.content;
  }

  return {

    /* ---- Chat completions (text + vision) ------------------- */
    chat: doChat,

    /* ---- Text-to-image -------------------------------------- */
    generateImage: async function (cfg, options) {
      var n = (options.n && options.n > 0) ? Math.floor(options.n) : 1;

      if (cfg.provider === 'ollama' || cfg.provider === 'lmstudio') {
        throw new Error('Pattern Dream needs an image-capable endpoint. Switch the provider preset to OpenAI, OpenRouter or Stability AI in Settings.');
      }

      /* Stability AI v2beta - multipart/form-data ONLY (no JSON body).
         Accept: application/json -> { image: <base64>, seed, finish_reason }
         NOTE: base URL must be the API root (https://api.stability.ai); a path here breaks the join. */
      if (cfg.provider === 'stability') {
        var aspectMap = { '1024x1024': '1:1', '1536x1024': '3:2', '1024x1536': '2:3', 'auto': '1:1' };
        var aspect = aspectMap[options.size] || '1:1';
        var endpoint = joinUrl(cfg.baseUrl, '/v2beta/stable-image/generate/core');
        var fields = { prompt: options.prompt, aspect_ratio: aspect, output_format: 'png' };

        var imgs = [];
        var refused = 0;
        for (var i = 0; i < n; i++) {
          var boundary = '----lumen' + Math.random().toString(36).slice(2) + Date.now().toString(36) + i;
          var body = Buffer.concat(buildMultipart(boundary, fields));
          var res = await rawRequest({
            method: 'POST',
            urlString: endpoint,
            headers: {
              'Authorization': 'Bearer ' + (cfg.apiKey || ''),
              'Content-Type': 'multipart/form-data; boundary=' + boundary,
              'Accept': 'application/json'
            },
            bodyBuf: body,
            timeoutMs: 180000
          });
          if (res.status < 200 || res.status >= 300) {
            throw new Error('Stability AI HTTP ' + res.status + ' - ' + truncate(res.body, 400));
          }
          var sdata;
          try { sdata = JSON.parse(res.body); }
          catch (e) { throw new Error('Stability AI returned non-JSON (HTTP ' + res.status + ') - ' + truncate(res.body, 200)); }
          if (sdata.finish_reason && sdata.finish_reason !== 'SUCCESS') { refused++; continue; }
          if (sdata.image) { imgs.push(sdata.image); }
        }
        if (!imgs.length) {
          throw new Error('Stability AI refused every image' + (refused ? ' (content filter)' : '') + '. Rephrase the prompt.');
        }
        return imgs;
      }

      /* OpenAI-compatible images endpoint (OpenAI, Azure, OpenRouter...) */
      var payload = {
        model: options.model || cfg.imageModel || 'gpt-image-2.5-flare',
        prompt: options.prompt,
        n: n
      };
      if (options.size && options.size !== 'auto') { payload.size = options.size; }
      // GPT Image models always return b64_json; legacy dall-e (shut down 2026) needed response_format.
      if (/^dall-e/.test(payload.model)) { payload.response_format = 'b64_json'; }

      var pathSuffix = (cfg.imagePath || '/images/generations');
      var data = await postJson(cfg, pathSuffix, payload, 240000);
      var arr = (data && data.data) || [];
      var out = [];
      for (var j = 0; j < arr.length; j++) {
        if (arr[j].b64_json) { out.push(arr[j].b64_json); }
        else if (arr[j].url) { out.push(await urlToBase64(arr[j].url)); }
      }
      if (!out.length) { throw new Error('Image endpoint returned no image payloads: ' + truncate(JSON.stringify(data), 300)); }
      return out;
    },

    /* ---- Cheap connectivity probe --------------------------- */
    test: async function (cfg) {
      if (cfg.provider === 'stability') {
        // Read-only credit balance (no credits spent, no image generated).
        // Throws on non-2xx / non-JSON - that error IS the report.
        var balance = await getJson(cfg, '/v1/user/balance', 30000);
        var credits = (balance && typeof balance.credits !== 'undefined') ? balance.credits + ' credits' : 'reachable';
        return 'Stability OK - ' + credits;
      }
      var reply = await doChat(cfg, {
        model: cfg.chatModel,
        messages: [{ role: 'user', content: 'Reply with the word: pong' }],
        maxTokens: 5, temperature: 0, timeoutMs: 45000
      });
      return 'Chat OK - model replied: ' + truncate(reply.trim(), 60);
    }
  };
})();
