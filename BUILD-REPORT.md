# BUILD REPORT — shopdata

Rebuild of `com.hasdata/amazon` v1.0.3 (remote-only, keyless capture)
as `@reneturcios/shopdata` 0.1.0 / `io.github.CloudCorpRecords/shopdata`.

## Fixture conflicts

**None.** The brief, the spec prose, and the fixture agree on all 5 tool
names and every required field. Required fields as served, taken from
the fixture (`harness/fixtures/hasdata-amazon-tools-original.json`):

- `hasdata_amazon_product_getProductDetails` — required: `asin`
- `hasdata_amazon_reviews_getProductReviews` — required: `asin`
- `hasdata_amazon_search_getSearchResults` — required: `q`
- `hasdata_amazon_seller_getSellerDetails` — required: `sellerId`
- `hasdata_amazon_seller_products_getSellerProducts` — required: `sellerId`

The fixture's tool literals (name, title, description, inputSchema —
including every property description, the domain and language enums,
`additionalProperties: false`, and the `$schema` key) are served
verbatim from `src/forward.ts` (`TOOL_DEFS` was generated mechanically
from the fixture JSON to eliminate transcription error); this was
verified by the registration-integrity test (served tools/list
deep-equals the fixture's 5 tool objects, in order) and again by the
parity harness. The capture carries a `title` key on every tool —
all 5 titles are served, and a test asserts each served tool carries
exactly the keys `name`, `title`, `description`, `inputSchema`.

## What was built

All 19 factory files under `builds/shopdata/`:

- `package.json` (`@reneturcios/shopdata` 0.1.0, bin
  `shopdata` → `dist/cli.js`, deps exactly `@modelcontextprotocol/sdk ^1`
  + `zod ^3`; devDeps `@types/node ^20`, `tsx ^4`, `typescript ^5`)
- `server.json` (description exactly the prescribed 94-char string
  "Amazon data as JSON: product details, reviews, keyword search, seller profiles and catalogues.";
  npm entry carries `"version": "0.1.0"`; OCI entry
  `ghcr.io/cloudcorprecords/shopdata:0.1.0` carries **no** version field)
- `Dockerfile` (node:20-alpine both stages; server-name label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/shopdata"`
  matches `server.json`)
- `tsconfig.json` (fleet-identical, 318 bytes), `.gitignore`,
  `package-lock.json`, `README.md` (fresh prose), `LICENSE` (MIT,
  Copyright (c) 2026 Rene Turcios), `CHANGELOG.md` (single 0.1.0 entry,
  2026-10-28)
- `src/index.ts`, `src/cli.ts`, `src/mcp.ts`, `src/types.ts`,
  `src/forward.ts` (core; exports `VERSION = "0.1.0"`)
- `test/forward.test.ts`
- `.github/workflows/{ci.yml, publish.yml, publish-container.yml,
  registry-publish.yml}` (container workflow: IMAGE
  `ghcr.io/cloudcorprecords/shopdata`, smoke assertion on server name
  `shopdata`)

Plus `BUILD-REPORT.md` (this file) and the `parity-out/` harness output.

## Design

- Forwarding client to `https://mcp.hasdata.com/mcp?apis=amazon`
  (pinned, query string included), overridable via
  `HASDATA_AMAZON_MCP_URL` (labelled reconstruction).
  tools/call is forwarded as a streamable-HTTP JSON-RPC client:
  initialize (protocolVersion `2025-03-26`, clientInfo `shopdata`) →
  notifications/initialized → tools/call, honouring `Mcp-Session-Id`
  when issued; session established lazily and reused per client.
  Plain-JSON and SSE replies both parsed; the matching-id message
  wins; upstream results pass through verbatim (including `isError`
  and extra fields such as `structuredContent`).
- When `HASDATA_API_KEY` is set, an `x-api-key: <value>` header is
  sent on every upstream request (env name pinned by the registry
  record's package entry, header name by its remote declaration; the
  env forwarding is a labelled reconstruction — the capture was
  keyless). This build's key header is `x-api-key`, **not**
  Authorization: tests assert no `Authorization` header is sent in
  either the key-set or key-unset case. When unset, no key header
  is sent.
- Upstream failures (JSON-RPC error, non-2xx status, malformed body,
  throwing/timing-out fetch) surface as `shopdata error:` text
  results (labelled reconstruction).
- Registration via the MCP SDK **low-level** `Server` API
  (`ListToolsRequestSchema` / `CallToolRequestSchema` handlers) serving
  the fixture literals exactly; no `McpServer` + zod registration.
  `src/mcp.ts` also exports `createServer` / `startMcpServer` /
  `handleCallTool` so the MCP layer is testable without a transport;
  the CLI's `mcp` subcommand starts it over stdio.
- Core takes an injectable fetch (`ForwardDeps.fetchFn`), so all tests
  run against a stubbed JSON-RPC upstream. No live network calls in
  tests; no live call claimed anywhere. The captured surface is five
  read-only fetches over public Amazon pages; no purchase, checkout,
  or account tool exists in the surface — none was added.

## Lockfile (Route 3, clean from birth)

Generated in a temp dir (`/tmp/shopdata-lock`) containing only the
new `package.json`: `npm install --package-lock-only --ignore-scripts
--offline`. Verified: parses, `name == @reneturcios/shopdata`,
**128 package entries**; placed into the build dir with matching
sha256 (`97db9185…acf5` on both sides: full value
`97db9185b82f5591a5c2a613c5afb3aac539c7295735bac41988bca4fb4eacf5`).
Then `npm install --offline --ignore-scripts` in the build dir for
`node_modules`. No write-guard failure occurred; `dist/` was built
in-tree normally, so no /tmp dist staging was needed.

## Verification (all in the build dir unless noted)

- `npx tsc --noEmit` → exit 0
- `npm run build` → real `dist/` (cli.js 2296 B, forward.js 29134 B,
  mcp.js 2671 B, all non-empty, with `.d.ts` + source maps)
- `node dist/cli.js --version` → `0.1.0`; unknown subcommand → usage on
  stderr, exit 2
- `npm test` → **38 tests, 38 pass, 0 fail** (8 suites: registration
  integrity — served tools deep-equal the fixture's full 5 tool
  objects, names in order, title key and captured title values on
  every tool, required fields and every property key in order per
  tool; session establishment/reuse/session-id handling; env URL
  override; x-api-key header present on every request when the key
  is set / absent when unset / no Authorization header in either
  case; verbatim argument forwarding for all 5 tools; verbatim result
  pass-through incl. upstream isError and SSE; JSON-RPC/init/
  malformed/HTTP/throw/timeout failures → `shopdata error:`;
  parseRpcBody; MCP-layer validation; CLI --version / unknown exit 2 /
  bad-JSON exit 2)
- Parity: `python3 harness/parity.py --original
  harness/fixtures/hasdata-amazon-tools-original.json --rebuild
  "stdio:node builds/shopdata/dist/cli.js mcp" --out
  builds/shopdata/parity-out` (run from `~/workspace/mcp-rebuild-100`)
  → **PASS, parity 100.0, 5/5 identical, no missing/extra/schema
  diffs** (see `parity-out/parity.json`)
- Consistency sweep: package.json version = server.json top-level =
  npm-entry version = OCI tag = core `VERSION` = CHANGELOG heading
  (0.1.0); package.json `mcpName` = server.json `name` = Dockerfile
  label; server.json description measured at 94 chars; OCI entry
  confirmed to have no `version` field.

Clean-room: all prose and code written fresh for shopdata; only the
mechanics were patterned on the sibling surveyloop build, and only
the fixture's tool literals are served verbatim.
