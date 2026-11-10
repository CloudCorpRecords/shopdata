import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  ShopdataClient,
  callTool,
  createClient,
  DEFAULT_ENDPOINT_URL,
  parseRpcBody,
  PROTOCOL_VERSION,
  TOOL_DEFS,
  TOOL_NAMES,
  VERSION,
} from "../src/forward.js";
import { handleCallTool } from "../src/mcp.js";
import type {
  FetchFn,
  FetchResponseLike,
  ToolDef,
  ToolResult,
} from "../src/types.js";

/**
 * Every test runs against a stubbed JSON-RPC upstream
 * implementing the streamable-HTTP session flow
 * (initialize -> notifications/initialized -> tools/call):
 * no live network, no live call — the real HasData
 * endpoint is never contacted.
 */

const FIXTURE_URL = new URL(
  "../../../harness/fixtures/hasdata-amazon-tools-original.json",
  import.meta.url,
);
const FIXTURE_AVAILABLE = existsSync(FIXTURE_URL);
const fixture = (
  FIXTURE_AVAILABLE
    ? JSON.parse(readFileSync(FIXTURE_URL, "utf-8"))
    : { tools: [] }
) as {
  tools: ToolDef[];
};
/**
 * Publish-survival guard (Wave 25 preflight, proven Wave 24 pattern):
 * the parity fixture lives in the build harness, outside the published
 * repo tree, so fixture-dependent tests skip cleanly when it is absent;
 * with the fixture present they run in full, with no skips.
 */
function skipWithoutFixture(t: {
  skip: (message: string) => void;
}): boolean {
  if (FIXTURE_AVAILABLE) return false;
  t.skip("parity fixture lives in the build harness, not the repo tree");
  return true;
}


const SAMPLE_RESULT = {
  content: [{ type: "text", text: "{\"asin\":\"B07FZ8S74R\",\"title\":\"Example\"}" }],
  structuredContent: { asin: "B07FZ8S74R" },
};

const PRODUCT = "hasdata_amazon_product_getProductDetails";
const REVIEWS = "hasdata_amazon_reviews_getProductReviews";
const SEARCH = "hasdata_amazon_search_getSearchResults";
const SELLER = "hasdata_amazon_seller_getSellerDetails";
const SELLER_PRODUCTS = "hasdata_amazon_seller_products_getSellerProducts";

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

interface FakeOptions {
  callResult?: Record<string, unknown>;
  callBodyText?: string;
  callError?: Record<string, unknown>;
  callStatus?: number;
  initError?: Record<string, unknown>;
  throwOn?: "initialize" | "tools/call";
  sessionId?: string | null;
  hangOnCall?: boolean;
  sse?: boolean;
}

function makeResponse(
  status: number,
  bodyText: string,
  headers: Record<string, string> = {},
): FetchResponseLike {
  const lowered = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lowered.get(name.toLowerCase()) ?? null },
    text: async () => bodyText,
  };
}

function jsonResponse(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
) {
  return makeResponse(status, JSON.stringify(payload), headers);
}

function makeUpstream(options: FakeOptions = {}): {
  fetchFn: FetchFn;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    calls.push({ url, headers: init?.headers ?? {}, body });
    const method = body.method as string;
    if (options.throwOn === method) throw new Error("socket hang up");
    if (method === "initialize") {
      if (options.initError !== undefined) {
        return jsonResponse(200, {
          jsonrpc: "2.0",
          id: body.id,
          error: options.initError,
        });
      }
      const headers: Record<string, string> = {};
      const sessionId =
        options.sessionId === undefined ? "sess-amz" : options.sessionId;
      if (sessionId !== null) headers["mcp-session-id"] = sessionId;
      return jsonResponse(
        200,
        {
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            serverInfo: { name: "hasdata-amazon", version: "1.0.3" },
          },
        },
        headers,
      );
    }
    if (method === "notifications/initialized") {
      return makeResponse(202, "");
    }
    if (method === "tools/call") {
      if (options.hangOnCall) {
        return new Promise<FetchResponseLike>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            if (signal.aborted) {
              reject(new Error("aborted"));
              return;
            }
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }
        });
      }
      if (options.callBodyText !== undefined) {
        return makeResponse(options.callStatus ?? 200, options.callBodyText);
      }
      if (options.callError !== undefined) {
        return jsonResponse(200, {
          jsonrpc: "2.0",
          id: body.id,
          error: options.callError,
        });
      }
      const result = options.callResult ?? SAMPLE_RESULT;
      const payload = { jsonrpc: "2.0", id: body.id, result };
      if (options.sse) {
        return makeResponse(
          200,
          `event: message\ndata: ${JSON.stringify(payload)}\n\n`,
        );
      }
      return jsonResponse(options.callStatus ?? 200, payload);
    }
    return jsonResponse(200, {});
  };
  return { fetchFn, calls };
}

function stubClient(options: FakeOptions = {}, extra: Record<string, unknown> = {}) {
  const upstream = makeUpstream(options);
  const c = new ShopdataClient({
    fetchFn: upstream.fetchFn,
    env: {},
    ...extra,
  });
  return { client: c, calls: upstream.calls };
}

function textOf(result: ToolResult): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0].text;
}

function methods(calls: Captured[]): string[] {
  return calls.map((c) => c.body.method as string);
}

/* ------------------------------------------------------------------ */

describe("registration integrity (captured surface)", () => {
  it("serves exactly the fixture's 5 tools, deep-equal, in order", (t) => {
    if (skipWithoutFixture(t)) return;
    assert.equal(fixture.tools.length, 5);
    assert.deepEqual(TOOL_DEFS, fixture.tools);
  });

  it("serves the 5 tool names in fixture order", () => {
    assert.deepEqual(TOOL_NAMES, [PRODUCT, REVIEWS, SEARCH, SELLER, SELLER_PRODUCTS]);
  });

  it("carries the fixture's title key on every tool, with its captured value", (t) => {
    if (skipWithoutFixture(t)) return;
    for (let i = 0; i < TOOL_DEFS.length; i++) {
      assert.equal("title" in TOOL_DEFS[i], true);
      assert.equal(TOOL_DEFS[i].title, fixture.tools[i].title);
      assert.deepEqual(Object.keys(TOOL_DEFS[i]).sort(), [
        "description",
        "inputSchema",
        "name",
        "title",
      ]);
    }
    assert.deepEqual(
      TOOL_DEFS.map((t) => t.title),
      [
        "amazon_product: GET /",
        "amazon_reviews: GET /",
        "amazon_search: GET /",
        "amazon_seller: GET /",
        "amazon_seller_products: GET /",
      ],
    );
  });

  it("carries exactly the fixture's required fields per tool", () => {
    const required = new Map(
      TOOL_DEFS.map((t) => [
        t.name,
        (t.inputSchema as { required?: string[] }).required ?? [],
      ]),
    );
    assert.deepEqual(required.get(PRODUCT), ["asin"]);
    assert.deepEqual(required.get(REVIEWS), ["asin"]);
    assert.deepEqual(required.get(SEARCH), ["q"]);
    assert.deepEqual(required.get(SELLER), ["sellerId"]);
    assert.deepEqual(required.get(SELLER_PRODUCTS), ["sellerId"]);
  });

  it("carries every fixture property, in order, per tool", (t) => {
    if (skipWithoutFixture(t)) return;
    for (let i = 0; i < fixture.tools.length; i++) {
      const served = Object.keys(
        (TOOL_DEFS[i].inputSchema as { properties: object }).properties,
      );
      const expected = Object.keys(
        (fixture.tools[i].inputSchema as { properties: object }).properties,
      );
      assert.deepEqual(served, expected);
    }
  });
});

/* ------------------------------------------------------------------ */

describe("session establishment and reuse", () => {
  it("runs initialize, notifications/initialized, then tools/call in order", async () => {
    const { client: c, calls } = stubClient();
    const out = await c.callTool(PRODUCT, { asin: "B07FZ8S74R" });
    assert.equal(out.isError, undefined);
    assert.deepEqual(methods(calls), [
      "initialize",
      "notifications/initialized",
      "tools/call",
    ]);
    assert.ok(calls.every((call) => call.url === DEFAULT_ENDPOINT_URL));
    assert.equal(
      DEFAULT_ENDPOINT_URL,
      "https://mcp.hasdata.com/mcp?apis=amazon",
    );

    const initParams = calls[0].body.params as Record<string, unknown>;
    assert.equal(initParams.protocolVersion, PROTOCOL_VERSION);
    assert.deepEqual(initParams.capabilities, {});
    assert.deepEqual(initParams.clientInfo, {
      name: "shopdata",
      version: VERSION,
    });
    assert.equal(calls[0].headers["Mcp-Session-Id"], undefined);
    for (const call of calls) {
      assert.equal(call.headers["Content-Type"], "application/json");
      assert.equal(
        call.headers["Accept"],
        "application/json, text/event-stream",
      );
    }
    assert.equal(calls[1].headers["Mcp-Session-Id"], "sess-amz");
    assert.equal(calls[2].headers["Mcp-Session-Id"], "sess-amz");
  });

  it("establishes the session lazily once and reuses it on later calls", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool(SEARCH, { q: "headphones" });
    await c.callTool(SELLER, { sellerId: "A1EXAMPLE" });
    assert.deepEqual(methods(calls), [
      "initialize",
      "notifications/initialized",
      "tools/call",
      "tools/call",
    ]);
    assert.equal(calls[3].headers["Mcp-Session-Id"], "sess-amz");
    assert.notEqual(calls[2].body.id, calls[3].body.id);
  });

  it("sends no session header when the upstream issues none", async () => {
    const { client: c, calls } = stubClient({ sessionId: null });
    const out = await c.callTool(SEARCH, { q: "headphones" });
    assert.equal(out.isError, undefined);
    assert.ok(calls.every((call) => call.headers["Mcp-Session-Id"] === undefined));
  });

  it("honours the HASDATA_AMAZON_MCP_URL env override", async () => {
    const upstream = makeUpstream();
    const c = new ShopdataClient({
      fetchFn: upstream.fetchFn,
      env: { HASDATA_AMAZON_MCP_URL: "https://staging.example.com/mcp?apis=amazon" },
    });
    await c.callTool(SEARCH, { q: "headphones" });
    assert.ok(
      upstream.calls.every(
        (call) => call.url === "https://staging.example.com/mcp?apis=amazon",
      ),
    );
  });

  it("honours an explicit url override over the default endpoint", async () => {
    const upstream = makeUpstream();
    const c = createClient({
      fetchFn: upstream.fetchFn,
      env: {},
      url: "https://alt.example.com/mcp",
    });
    await c.callTool(SEARCH, { q: "headphones" });
    assert.ok(
      upstream.calls.every((call) => call.url === "https://alt.example.com/mcp"),
    );
  });
});

/* ------------------------------------------------------------------ */

describe("upstream key header", () => {
  it("sends x-api-key on every request when HASDATA_API_KEY is set, and no Authorization header", async () => {
    const upstream = makeUpstream();
    const c = new ShopdataClient({
      fetchFn: upstream.fetchFn,
      env: { HASDATA_API_KEY: "hasdata-key-42" },
    });
    await c.callTool(SEARCH, { q: "headphones" });
    assert.equal(upstream.calls.length, 3);
    assert.ok(
      upstream.calls.every((call) => call.headers["x-api-key"] === "hasdata-key-42"),
    );
    assert.ok(
      upstream.calls.every((call) => call.headers["Authorization"] === undefined),
    );
  });

  it("sends no x-api-key and no Authorization header when HASDATA_API_KEY is unset", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool(SEARCH, { q: "headphones" });
    assert.ok(calls.every((call) => call.headers["x-api-key"] === undefined));
    assert.ok(calls.every((call) => call.headers["Authorization"] === undefined));
  });
});

/* ------------------------------------------------------------------ */

describe("tools/call forwarding", () => {
  it("forwards product details arguments verbatim", async () => {
    const { client: c, calls } = stubClient();
    const args = {
      asin: "B07FZ8S74R",
      domain: "www.amazon.co.uk",
      language: "EN",
      deliveryZip: "SW1A 1AA",
      otherSellers: true,
    };
    await c.callTool(PRODUCT, args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, PRODUCT);
    assert.deepEqual(params.arguments, args);
  });

  it("forwards product reviews arguments verbatim", async () => {
    const { client: c, calls } = stubClient();
    const args = {
      asin: "B07FZ8S74R",
      page: 2,
      stars: "fiveStar",
      reviewerType: "verifiedPurchaseReviews",
      sortBy: "helpful",
    };
    await c.callTool(REVIEWS, args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, REVIEWS);
    assert.deepEqual(params.arguments, args);
  });

  it("forwards search arguments verbatim", async () => {
    const { client: c, calls } = stubClient();
    const args = { q: "noise cancelling headphones", page: 1, sortBy: "priceLowToHigh" };
    await c.callTool(SEARCH, args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, SEARCH);
    assert.deepEqual(params.arguments, args);
  });

  it("forwards seller details arguments verbatim", async () => {
    const { client: c, calls } = stubClient();
    const args = { sellerId: "A1EXAMPLE", domain: "www.amazon.de", language: "DE" };
    await c.callTool(SELLER, args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, SELLER);
    assert.deepEqual(params.arguments, args);
  });

  it("forwards seller products arguments verbatim", async () => {
    const { client: c, calls } = stubClient();
    const args = { sellerId: "A1EXAMPLE", page: 3 };
    await c.callTool(SELLER_PRODUCTS, args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, SELLER_PRODUCTS);
    assert.deepEqual(params.arguments, args);
  });

  it("passes the upstream result through verbatim, including extra fields", async () => {
    const { client: c } = stubClient();
    const out = await c.callTool(SEARCH, { q: "headphones" });
    assert.deepEqual(out, SAMPLE_RESULT);
  });

  it("passes an upstream isError result through untouched", async () => {
    const upstreamResult = {
      content: [{ type: "text", text: "product not found" }],
      isError: true,
    };
    const { client: c } = stubClient({ callResult: upstreamResult });
    const out = await c.callTool(PRODUCT, { asin: "nope" });
    assert.deepEqual(out, upstreamResult);
  });

  it("reads an SSE-framed tools/call response", async () => {
    const { client: c } = stubClient({ sse: true });
    const out = await c.callTool(REVIEWS, { asin: "B07FZ8S74R" });
    assert.equal(out.isError, undefined);
    assert.deepEqual(out, SAMPLE_RESULT);
  });

  it("the one-shot callTool helper forwards under the right tool name", async () => {
    const upstream = makeUpstream();
    const out = await callTool(
      SELLER_PRODUCTS,
      { sellerId: "A1EXAMPLE" },
      { fetchFn: upstream.fetchFn, env: {} },
    );
    assert.equal(out.isError, undefined);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, SELLER_PRODUCTS);
    assert.deepEqual(params.arguments, { sellerId: "A1EXAMPLE" });
  });
});

/* ------------------------------------------------------------------ */

describe("upstream failures surface as shopdata error text", () => {
  it("maps a JSON-RPC error to `shopdata error: <message>`", async () => {
    const { client: c } = stubClient({
      callError: { code: -32000, message: "product not found" },
    });
    const out = await c.callTool(PRODUCT, { asin: "nope" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "shopdata error: product not found");
  });

  it("maps an initialize JSON-RPC error to shopdata error text", async () => {
    const { client: c } = stubClient({
      initError: { code: -32600, message: "bad initialize" },
    });
    const out = await c.callTool(SEARCH, { q: "headphones" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "shopdata error: bad initialize");
  });

  it("maps an unparseable upstream response to a malformed-response error", async () => {
    const { client: c } = stubClient({ callBodyText: "<html>oops</html>" });
    const out = await c.callTool(SEARCH, { q: "headphones" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "shopdata error: malformed response");
  });

  it("maps a non-2xx upstream status to shopdata error text", async () => {
    const { client: c } = stubClient({
      callBodyText: "internal error",
      callStatus: 500,
    });
    const out = await c.callTool(SEARCH, { q: "headphones" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "shopdata error: HTTP 500");
  });

  it("maps a throwing fetch to shopdata error text", async () => {
    const { client: c } = stubClient({ throwOn: "tools/call" });
    const out = await c.callTool(SEARCH, { q: "headphones" });
    assert.equal(out.isError, true);
    assert.match(textOf(out), /^shopdata error: /);
  });

  it("maps a throwing initialize fetch to shopdata error text", async () => {
    const { client: c } = stubClient({ throwOn: "initialize" });
    const out = await c.callTool(SEARCH, { q: "headphones" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "shopdata error: socket hang up");
  });

  it("maps a timed-out call to shopdata error text", async () => {
    const { client: c } = stubClient({ hangOnCall: true }, { timeoutMs: 20 });
    const out = await c.callTool(SEARCH, { q: "headphones" });
    assert.equal(out.isError, true);
    assert.match(textOf(out), /^shopdata error: /);
  });
});

/* ------------------------------------------------------------------ */

describe("parseRpcBody", () => {
  it("parses plain JSON and picks the message with the matching id", () => {
    const body = '{"jsonrpc":"2.0","id":7,"result":{"ok":true}}';
    assert.deepEqual(parseRpcBody(body, 7), {
      jsonrpc: "2.0",
      id: 7,
      result: { ok: true },
    });
  });

  it("parses SSE data lines", () => {
    const body =
      'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}\n\n';
    assert.deepEqual(parseRpcBody(body, 2), {
      jsonrpc: "2.0",
      id: 2,
      result: { ok: true },
    });
  });

  it("returns null for empty and unparseable bodies", () => {
    assert.equal(parseRpcBody(""), null);
    assert.equal(parseRpcBody("not json at all"), null);
  });
});

/* ------------------------------------------------------------------ */

describe("MCP layer validation", () => {
  it("rejects an unknown tool before any network hop", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, "not_a_tool", {}),
      (err: unknown) => err instanceof McpError,
    );
    assert.equal(upstream.calls.length, 0);
  });

  it("rejects non-object arguments before any network hop", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, PRODUCT, ["nope"]),
      (err: unknown) => err instanceof McpError,
    );
    assert.equal(upstream.calls.length, 0);
  });

  it("forwards a valid call through the MCP layer unchanged", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await handleCallTool(c, SELLER, { sellerId: "A1EXAMPLE" });
    assert.deepEqual(out, SAMPLE_RESULT);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.deepEqual(params.arguments, { sellerId: "A1EXAMPLE" });
  });
});

/* ------------------------------------------------------------------ */

describe("CLI", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

  function runCli(args: string[]) {
    return spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
    });
  }

  it("--version prints 0.1.0 and exits 0", () => {
    const res = runCli(["--version"]);
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), "0.1.0");
  });

  it("an unknown command prints usage on stderr and exits 2", () => {
    const res = runCli(["not-a-tool"]);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /Usage:/);
  });

  it("a non-JSON argument exits 2", () => {
    const res = runCli([PRODUCT, "not json"]);
    assert.equal(res.status, 2);
  });

  it("a JSON array argument exits 2", () => {
    const res = runCli([PRODUCT, "[]"]);
    assert.equal(res.status, 2);
  });
});
