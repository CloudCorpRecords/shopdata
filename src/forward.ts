/**
 * shopdata core: a forwarding client for the hosted
 * HasData Amazon MCP server.
 *
 * Nothing is computed locally. tools/list is answered
 * from the literal tool definitions below, taken verbatim
 * from a live capture of the upstream server (name,
 * title, description and inputSchema exactly as
 * captured). A tools/call is forwarded over a
 * streamable-HTTP JSON-RPC session: an initialize POST,
 * a notifications/initialized POST, then the tools/call
 * POST, honouring the Mcp-Session-Id response header
 * when the upstream issues one. The session is
 * established lazily on the first forwarded call and
 * reused for the lifetime of the client.
 *
 * The upstream endpoint is pinned to
 * https://mcp.hasdata.com/mcp?apis=amazon (the query
 * string is part of the pinned URL) and can be
 * overridden with the HASDATA_AMAZON_MCP_URL
 * environment variable (that override is a labelled
 * reconstruction). When HASDATA_API_KEY is set in the
 * environment, every upstream request carries an
 * `x-api-key: <key>` header (the env name is pinned by
 * the registry record's package entry and the header
 * name by its remote declaration; forwarding the key
 * from this env var is a labelled reconstruction — the
 * capture itself was taken keyless). When the variable
 * is unset, no key header is sent, and no Authorization
 * header is sent in either case.
 *
 * Upstream results pass through verbatim, including any
 * isError flag and any extra result fields. Failures — a
 * JSON-RPC error from the upstream, a non-2xx status, an
 * unparseable response, or a fetch that throws or times
 * out — surface as an isError result whose text starts
 * with `shopdata error:` (that rendering is a labelled
 * reconstruction). Responses may be plain JSON or SSE
 * (data: lines); the JSON-RPC message with the matching
 * id wins.
 */
import type {
  FetchFn,
  FetchResponseLike,
  ForwardDeps,
  ToolArgs,
  ToolDef,
  ToolResult,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_ENDPOINT_URL = "https://mcp.hasdata.com/mcp?apis=amazon";

export const DEFAULT_TIMEOUT_MS = 30000;

export const PROTOCOL_VERSION = "2025-03-26";

/* ------------------------------------------------------------------ */
/* Tool definitions (tools/list literals, verbatim from the live       */
/* capture in harness/fixtures/hasdata-amazon-tools-original.json)     */
/* ------------------------------------------------------------------ */

export const TOOL_DEFS: ToolDef[] = [
  {
    "name": "hasdata_amazon_product_getProductDetails",
    "title": "amazon_product: GET /",
    "description": "Get Amazon Product Details\n\nFetches a single Amazon product page by ASIN on a chosen Amazon domain (amazon.com, .co.uk, .de, .jp, etc.). Returns title, brand, current/list/deal price, currency, availability, Buy Box seller, Prime eligibility, bullet points, A+ description, rating and review count, images, category breadcrumbs, variants/sibling ASINs, and the other-sellers offers block (when otherSellers=true), plus delivery-zone-aware pricing when a shipping zip/location is set. Use for product research agents, price/stock monitoring, catalog enrichment, listing QA, Buy Box tracking, and cross-locale competitive analysis.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "asin": {
          "type": "string",
          "description": "The Amazon Standard Identification Number (ASIN) of the product."
        },
        "domain": {
          "type": "string",
          "enum": [
            "www.amazon.com",
            "www.amazon.de",
            "www.amazon.co.uk",
            "www.amazon.ae",
            "www.amazon.com.au",
            "www.amazon.com.be",
            "www.amazon.com.br",
            "www.amazon.ca",
            "www.amazon.eg",
            "www.amazon.es",
            "www.amazon.fr",
            "www.amazon.ie",
            "www.amazon.in",
            "www.amazon.it",
            "www.amazon.co.jp",
            "www.amazon.com.mx",
            "www.amazon.nl",
            "www.amazon.pl",
            "www.amazon.sa",
            "www.amazon.se",
            "www.amazon.sg",
            "www.amazon.com.tr",
            "www.amazon.co.za"
          ],
          "description": "Amazon domain to use. Default is www.amazon.com."
        },
        "language": {
          "type": "string",
          "enum": [
            "AR",
            "BN",
            "CS",
            "DA",
            "DE",
            "EN",
            "ES",
            "FR",
            "HI",
            "IT",
            "JP",
            "KN",
            "ML",
            "MR",
            "NL",
            "PL",
            "PT",
            "SV",
            "TA",
            "TE",
            "TR",
            "ZH"
          ],
          "description": "Optional Amazon language code. Supported values depend on the selected domain."
        },
        "deliveryZip": {
          "type": "string",
          "description": "Postal code of the delivery location."
        },
        "shippingLocation": {
          "type": "string",
          "description": "The two-letter country code to define the country of the delivery address. Provide one exact documented value (238 allowed), e.g. `AU`, `CA`."
        },
        "otherSellers": {
          "type": "boolean",
          "description": "Also collect the offers of other sellers competing for this item. This takes an extra request to Amazon and costs 5 credits on top of the base. Default is false."
        }
      },
      "required": [
        "asin"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "hasdata_amazon_reviews_getProductReviews",
    "title": "amazon_reviews: GET /",
    "description": "Get Amazon Product Reviews\n\nPaginated fetch of customer reviews for an Amazon ASIN with filters for star rating (1-5, positive, critical), reviewer type (all vs verified purchase), media-only reviews, current-variant vs all-formats, keyword search, and sort (helpful/recent). Returns per-review title, body, star rating, author name and profile, review date, helpful-vote count, variant/format attributes, and attached media URLs, plus aggregate rating histogram. Use for voice-of-customer analysis, sentiment and theme extraction, feature-request mining, competitor review benchmarking, and feeding review-summarization or Q&A agents.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "asin": {
          "type": "string",
          "description": "The Amazon Standard Identification Number (ASIN) of the product."
        },
        "domain": {
          "type": "string",
          "enum": [
            "www.amazon.com",
            "www.amazon.de",
            "www.amazon.co.uk",
            "www.amazon.ae",
            "www.amazon.com.au",
            "www.amazon.com.be",
            "www.amazon.com.br",
            "www.amazon.ca",
            "www.amazon.eg",
            "www.amazon.es",
            "www.amazon.fr",
            "www.amazon.ie",
            "www.amazon.in",
            "www.amazon.it",
            "www.amazon.co.jp",
            "www.amazon.com.mx",
            "www.amazon.nl",
            "www.amazon.pl",
            "www.amazon.sa",
            "www.amazon.se",
            "www.amazon.sg",
            "www.amazon.com.tr",
            "www.amazon.co.za"
          ],
          "description": "Amazon domain to use. Default is www.amazon.com."
        },
        "language": {
          "type": "string",
          "enum": [
            "AR",
            "BN",
            "CS",
            "DA",
            "DE",
            "EN",
            "ES",
            "FR",
            "HI",
            "IT",
            "JP",
            "KN",
            "ML",
            "MR",
            "NL",
            "PL",
            "PT",
            "SV",
            "TA",
            "TE",
            "TR",
            "ZH"
          ],
          "description": "Optional Amazon language code. Supported values depend on the selected domain."
        },
        "page": {
          "type": "number",
          "description": "The page number to retrieve."
        },
        "searchTerm": {
          "type": "string",
          "description": "A term to search within the reviews."
        },
        "reviewerType": {
          "type": "string",
          "enum": [
            "allReviews",
            "verifiedPurchaseReviews"
          ],
          "description": "The type of reviewers to filter."
        },
        "stars": {
          "type": "string",
          "enum": [
            "allStars",
            "fiveStar",
            "fourStar",
            "threeStar",
            "twoStar",
            "oneStar",
            "positive",
            "critical"
          ],
          "description": "The star ratings to filter reviews."
        },
        "format": {
          "type": "string",
          "enum": [
            "allFormats",
            "currentFormat"
          ],
          "description": "The format type to filter reviews. Include reviews of any product format/variant or specifically to the current format/variant."
        },
        "mediaType": {
          "type": "string",
          "enum": [
            "allReviews",
            "mediaReviews"
          ],
          "description": "The media type to filter reviews."
        },
        "sortBy": {
          "type": "string",
          "enum": [
            "helpful",
            "recent"
          ],
          "description": "The criterion to sort reviews."
        }
      },
      "required": [
        "asin"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "hasdata_amazon_search_getSearchResults",
    "title": "amazon_search: GET /",
    "description": "Get Amazon Search Results\n\nRuns a keyword search on a chosen Amazon domain with pagination, delivery zip/location scoping, and sort order (featured, price low-to-high, price high-to-low, avg-customer-review, newest). Returns the organic results list with ASIN, title, thumbnail, product URL, price and list price, currency, star rating, review count, Prime/sponsored flags, and position. Use for SERP monitoring, keyword/share-of-shelf tracking, competitor discovery, ASIN harvesting to feed downstream product/reviews endpoints, and building product-research or price-comparison agents.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "q": {
          "type": "string",
          "description": "The search term for which to get the search results."
        },
        "domain": {
          "type": "string",
          "enum": [
            "www.amazon.com",
            "www.amazon.de",
            "www.amazon.co.uk",
            "www.amazon.ae",
            "www.amazon.com.au",
            "www.amazon.com.be",
            "www.amazon.com.br",
            "www.amazon.ca",
            "www.amazon.eg",
            "www.amazon.es",
            "www.amazon.fr",
            "www.amazon.ie",
            "www.amazon.in",
            "www.amazon.it",
            "www.amazon.co.jp",
            "www.amazon.com.mx",
            "www.amazon.nl",
            "www.amazon.pl",
            "www.amazon.sa",
            "www.amazon.se",
            "www.amazon.sg",
            "www.amazon.com.tr",
            "www.amazon.co.za"
          ],
          "description": "Amazon domain to use. Default is www.amazon.com."
        },
        "language": {
          "type": "string",
          "enum": [
            "AR",
            "BN",
            "CS",
            "DA",
            "DE",
            "EN",
            "ES",
            "FR",
            "HI",
            "IT",
            "JP",
            "KN",
            "ML",
            "MR",
            "NL",
            "PL",
            "PT",
            "SV",
            "TA",
            "TE",
            "TR",
            "ZH"
          ],
          "description": "Optional Amazon language code. Supported values depend on the selected domain."
        },
        "page": {
          "type": "number",
          "description": "Page number for pagination (e.g., 1 for the first page, 2 for the second page, etc.)."
        },
        "deliveryZip": {
          "type": "string",
          "description": "Postal code of the delivery location."
        },
        "shippingLocation": {
          "type": "string",
          "description": "The two-letter country code to define the country of the delivery address. Provide one exact documented value (238 allowed), e.g. `AU`, `CA`."
        },
        "sortBy": {
          "type": "string",
          "enum": [
            "featured",
            "priceLowToHigh",
            "priceHighToLow",
            "avgCustomerReview",
            "newestArrivals",
            "bestSellers"
          ],
          "description": "Parameter used for sorting results"
        }
      },
      "required": [
        "q"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "hasdata_amazon_seller_getSellerDetails",
    "title": "amazon_seller: GET /",
    "description": "Get Amazon Seller Details\n\nFetches the public storefront profile for an Amazon seller by sellerId on the chosen domain/language. Returns business name, seller logo, About-this-seller text, overall feedback rating and lifetime/12-month/90-day/30-day rating breakdown, feedback count, business address and contact details, and customer service info. Use for seller due-diligence and vetting, counterfeit/brand-protection workflows, MAP-violation investigations, building seller leaderboards, and enriching marketplace seller directories.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "sellerId": {
          "type": "string",
          "description": "The unique Amazon seller ID."
        },
        "domain": {
          "type": "string",
          "enum": [
            "www.amazon.com",
            "www.amazon.de",
            "www.amazon.co.uk",
            "www.amazon.ae",
            "www.amazon.com.au",
            "www.amazon.com.be",
            "www.amazon.com.br",
            "www.amazon.ca",
            "www.amazon.eg",
            "www.amazon.es",
            "www.amazon.fr",
            "www.amazon.ie",
            "www.amazon.in",
            "www.amazon.it",
            "www.amazon.co.jp",
            "www.amazon.com.mx",
            "www.amazon.nl",
            "www.amazon.pl",
            "www.amazon.sa",
            "www.amazon.se",
            "www.amazon.sg",
            "www.amazon.com.tr",
            "www.amazon.co.za"
          ],
          "description": "Amazon domain to use. Default is www.amazon.com."
        },
        "language": {
          "type": "string",
          "enum": [
            "AR",
            "BN",
            "CS",
            "DA",
            "DE",
            "EN",
            "ES",
            "FR",
            "HI",
            "IT",
            "JP",
            "KN",
            "ML",
            "MR",
            "NL",
            "PL",
            "PT",
            "SV",
            "TA",
            "TE",
            "TR",
            "ZH"
          ],
          "description": "Optional Amazon language code. Supported values depend on the selected domain."
        }
      },
      "required": [
        "sellerId"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "hasdata_amazon_seller_products_getSellerProducts",
    "title": "amazon_seller_products: GET /",
    "description": "Get Amazon Seller Products\n\nPaginated listing of the storefront catalog offered by a given Amazon sellerId on the chosen domain. Returns each product row with ASIN, title, image, product URL, price and list price, currency, star rating, and review count. Use to map a competitor's or 3P seller's full assortment, detect new SKU launches, build brand-protection watchlists, drive price-intelligence pipelines, and seed per-ASIN deep-dives against the product and reviews endpoints.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "sellerId": {
          "type": "string",
          "description": "The unique Amazon seller ID."
        },
        "domain": {
          "type": "string",
          "enum": [
            "www.amazon.com",
            "www.amazon.de",
            "www.amazon.co.uk",
            "www.amazon.ae",
            "www.amazon.com.au",
            "www.amazon.com.be",
            "www.amazon.com.br",
            "www.amazon.ca",
            "www.amazon.eg",
            "www.amazon.es",
            "www.amazon.fr",
            "www.amazon.ie",
            "www.amazon.in",
            "www.amazon.it",
            "www.amazon.co.jp",
            "www.amazon.com.mx",
            "www.amazon.nl",
            "www.amazon.pl",
            "www.amazon.sa",
            "www.amazon.se",
            "www.amazon.sg",
            "www.amazon.com.tr",
            "www.amazon.co.za"
          ],
          "description": "Amazon domain to use. Default is www.amazon.com."
        },
        "language": {
          "type": "string",
          "enum": [
            "AR",
            "BN",
            "CS",
            "DA",
            "DE",
            "EN",
            "ES",
            "FR",
            "HI",
            "IT",
            "JP",
            "KN",
            "ML",
            "MR",
            "NL",
            "PL",
            "PT",
            "SV",
            "TA",
            "TE",
            "TR",
            "ZH"
          ],
          "description": "Optional Amazon language code. Supported values depend on the selected domain."
        },
        "page": {
          "type": "number",
          "description": "Page number for pagination (e.g., 1 for the first page, 2 for the second page, etc.)."
        }
      },
      "required": [
        "sellerId"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  }
];

export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name);

/** Whether `name` is one of the captured tools. */
export function isKnownTool(name: string): boolean {
  return TOOL_NAMES.includes(name);
}

/* ------------------------------------------------------------------ */
/* Forwarding client                                                   */
/* ------------------------------------------------------------------ */

function errorResult(detail: string): ToolResult {
  return {
    content: [{ type: "text", text: `shopdata error: ${detail}` }],
    isError: true,
  };
}

function rpcErrorMessage(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
    return JSON.stringify(error);
  }
  return String(error);
}

/**
 * Parse a JSON-RPC response body, tolerating SSE framing.
 * Returns the message whose id matches `expectedId` when
 * one is present, else the last parseable message, else
 * null when nothing parses.
 */
export function parseRpcBody(
  text: string,
  expectedId?: number,
): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const candidates: Record<string, unknown>[] = [];
  const tryPush = (payload: string): void => {
    try {
      const parsed: unknown = JSON.parse(payload);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        candidates.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Not JSON; ignore this candidate.
    }
  };
  if (trimmed.includes("data:")) {
    for (const line of trimmed.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice("data:".length).trim();
      if (payload !== "" && payload !== "[DONE]") tryPush(payload);
    }
  } else {
    tryPush(trimmed);
  }
  if (candidates.length === 0) return null;
  if (expectedId !== undefined) {
    const match = candidates.find((c) => c.id === expectedId);
    if (match !== undefined) return match;
  }
  return candidates[candidates.length - 1];
}

async function defaultFetch(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<FetchResponseLike> {
  return fetch(url, init) as unknown as FetchResponseLike;
}

/**
 * A forwarding client holding one upstream session. The
 * session is established lazily on the first forwarded
 * call and reused for the lifetime of the client (the
 * process lifetime when the client is the MCP server's
 * or a one-shot client for the CLI).
 */
export class ShopdataClient {
  private readonly deps: ForwardDeps;
  private sessionId: string | null = null;
  private ready = false;
  private sessionPromise: Promise<void> | null = null;
  private idCounter = 0;

  constructor(deps: ForwardDeps = {}) {
    this.deps = deps;
  }

  private fetchFn(): FetchFn {
    return this.deps.fetchFn ?? defaultFetch;
  }

  private endpointUrl(): string {
    if (this.deps.url && this.deps.url.trim() !== "") return this.deps.url.trim();
    const raw = (this.deps.env ?? process.env).HASDATA_AMAZON_MCP_URL;
    if (raw && raw.trim() !== "") return raw.trim();
    return DEFAULT_ENDPOINT_URL;
  }

  private apiKey(): string | null {
    const raw = (this.deps.env ?? process.env).HASDATA_API_KEY;
    if (raw && raw.trim() !== "") return raw.trim();
    return null;
  }

  private timeoutMs(): number {
    if (typeof this.deps.timeoutMs === "number" && this.deps.timeoutMs > 0) {
      return this.deps.timeoutMs;
    }
    return DEFAULT_TIMEOUT_MS;
  }

  private nextId(): number {
    this.idCounter += 1;
    return this.idCounter;
  }

  private async post(
    body: unknown,
    withSession: boolean,
  ): Promise<FetchResponseLike> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    const key = this.apiKey();
    if (key !== null) headers["x-api-key"] = key;
    if (withSession && this.sessionId !== null) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      return await this.fetchFn()(this.endpointUrl(), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async ensureSession(): Promise<void> {
    if (this.ready) return;
    if (this.sessionPromise === null) {
      this.sessionPromise = (async () => {
        const initId = this.nextId();
        const initRes = await this.post(
          {
            jsonrpc: "2.0",
            id: initId,
            method: "initialize",
            params: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: { name: "shopdata", version: VERSION },
            },
          },
          false,
        );
        const sessionId = initRes.headers.get("mcp-session-id");
        if (sessionId) this.sessionId = sessionId;
        const initText = await initRes.text();
        const initParsed = parseRpcBody(initText, initId);
        if (initParsed !== null && initParsed.error) {
          throw new Error(rpcErrorMessage(initParsed.error));
        }
        if (initRes.status < 200 || initRes.status >= 300) {
          throw new Error(`HTTP ${initRes.status}`);
        }
        if (initParsed === null && initText.trim() !== "") {
          throw new Error("malformed response");
        }
        const initializedRes = await this.post(
          { jsonrpc: "2.0", method: "notifications/initialized" },
          true,
        );
        try {
          await initializedRes.text();
        } catch {
          // The notification response body carries nothing we need.
        }
        this.ready = true;
      })();
    }
    try {
      await this.sessionPromise;
    } catch (err) {
      this.sessionPromise = null;
      this.sessionId = null;
      throw err;
    }
  }

  /** Forward one tool call; upstream failures come back as isError results. */
  async callTool(name: string, args: ToolArgs): Promise<ToolResult> {
    try {
      await this.ensureSession();
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }

    const callId = this.nextId();
    let callRes: FetchResponseLike;
    try {
      callRes = await this.post(
        {
          jsonrpc: "2.0",
          id: callId,
          method: "tools/call",
          params: { name, arguments: args ?? {} },
        },
        true,
      );
    } catch (err) {
      return errorResult(
        `request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const parsed = parseRpcBody(await callRes.text(), callId);
    if (parsed !== null && parsed.error) {
      return errorResult(rpcErrorMessage(parsed.error));
    }
    if (callRes.status < 200 || callRes.status >= 300) {
      return errorResult(`HTTP ${callRes.status}`);
    }
    if (parsed === null) return errorResult("malformed response");
    const result = parsed.result as ToolResult | undefined;
    if (result === undefined || result === null || typeof result !== "object") {
      return errorResult("malformed response");
    }
    // Pass the upstream result through verbatim.
    return result;
  }
}

/** Create a forwarding client; tests inject a fake fetch and env through deps. */
export function createClient(deps: ForwardDeps = {}): ShopdataClient {
  return new ShopdataClient(deps);
}

/** One-shot helper: a fresh client per call (the CLI path). */
export async function callTool(
  name: string,
  args: ToolArgs,
  deps: ForwardDeps = {},
): Promise<ToolResult> {
  return new ShopdataClient(deps).callTool(name, args);
}
