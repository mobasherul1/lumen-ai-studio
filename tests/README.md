# Tests

Dependency-free gates, runnable on any machine with Node:

```bash
node tests/sanity-check.js     # syntax (node --check), manifest XML, icons, secret scan
node tests/host-mock-test.js   # jsx/lumen.jsx against a mocked Illustrator DOM
node tests/api-smoke-test.js   # js/api.js against a mock OpenAI-compatible gateway (HTTP)
```

- `host-mock-test.js` executes the real ExtendScript inside a Node `vm` and asserts the JSON contracts the panel relies on.
- `api-smoke-test.js` boots a local HTTP server and checks chat success, the max_completion_tokens → max_tokens 400 retry, upstream-404 body surfacing, the Stability credit probe, multipart image generation, and the content-filter refusal path.

None of these can execute Illustrator itself — end-to-end behavior must be verified on a real machine; see [../docs/DEMO.md](../docs/DEMO.md) for the acceptance shot list.
