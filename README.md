# shopdata

shopdata is a small local bridge to the hosted
HasData Amazon MCP server, which returns public
Amazon data as JSON. Give it an ASIN and it fetches
that product's details or its customer reviews; give
it a keyword and it runs a search on a chosen Amazon
domain; give it a seller ID and it returns the
seller's public storefront profile or the catalogue
that seller offers.

The bridge keeps no Amazon data of its own. It serves
the upstream server's tool list locally, exactly as
captured from the live endpoint, and forwards each
tool call upstream, returning the result untouched.
The captured surface is read-only: there is no
purchase, checkout, or account tool in it.

## Tools

- `hasdata_amazon_product_getProductDetails` — fetch
  one product page by ASIN. Required: `asin`.
  Optional: `domain`, `language`, `deliveryZip`,
  `shippingLocation`, `otherSellers` (also collect the
  other-sellers offers block).
- `hasdata_amazon_reviews_getProductReviews` —
  paginated customer reviews for an ASIN. Required:
  `asin`. Optional: `domain`, `language`, `page`,
  `searchTerm`, `reviewerType`, `stars`, `format`,
  `mediaType`, `sortBy`.
- `hasdata_amazon_search_getSearchResults` — keyword
  search on a chosen Amazon domain. Required: `q`.
  Optional: `domain`, `language`, `page`,
  `deliveryZip`, `shippingLocation`, `sortBy`.
- `hasdata_amazon_seller_getSellerDetails` — public
  storefront profile for a seller. Required:
  `sellerId`. Optional: `domain`, `language`.
- `hasdata_amazon_seller_products_getSellerProducts`
  — paginated catalogue offered by a seller.
  Required: `sellerId`. Optional: `domain`,
  `language`, `page`.

## Configuration

- `HASDATA_AMAZON_MCP_URL` (optional) — override the
  upstream endpoint. Defaults to
  `https://mcp.hasdata.com/mcp?apis=amazon`, query
  string included. (The override hook is this
  rebuild's own labelled reconstruction.)
- `HASDATA_API_KEY` (optional) — when set, every
  upstream request carries an `x-api-key: <key>`
  header with the caller's own HasData API key. When
  it is not set, no key header is sent, and no
  `Authorization` header is sent in either case.
  (The env and header names are pinned by the
  original's registry record; forwarding the key from
  this env var is a labelled reconstruction — the
  original surface was captured keyless.)

### Forwarding mechanics

On the first tool call the client opens a streamable
HTTP session with the upstream: a JSON-RPC
`initialize` request (protocolVersion `2025-03-26`,
clientInfo name `shopdata`), then a
`notifications/initialized` notification, then the
`tools/call` request carrying the caller's arguments
unchanged. When the upstream answers `initialize`
with an `Mcp-Session-Id` header, that value rides on
every later request of the session, which is reused
for the life of the process. Replies may arrive as
plain JSON or as server-sent events; both are read.

Successful upstream results pass through verbatim,
including any `isError` flag the upstream sets.
Failures — a JSON-RPC error, a non-2xx status, an
unreadable response, or a request that cannot be
completed — come back as an `isError` result whose
text starts with `shopdata error:` (this rendering
is this rebuild's own labelled reconstruction).

## CLI

Each tool is also a subcommand taking one JSON
argument string:

```bash
npx @reneturcios/shopdata hasdata_amazon_product_getProductDetails '{"asin":"B07FZ8S74R"}'
npx @reneturcios/shopdata hasdata_amazon_search_getSearchResults '{"q":"noise cancelling headphones","sortBy":"priceLowToHigh"}'
npx @reneturcios/shopdata --version
```

Exit codes: `0` on success, `1` on an `isError`
result, `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/shopdata mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "shopdata": {
      "command": "npx",
      "args": ["-y", "@reneturcios/shopdata", "mcp"]
    }
  }
}
```

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/shopdata
docker run --rm ghcr.io/cloudcorprecords/shopdata --version
```

The container's default command is `mcp`, so the first
form is a stdio MCP server; any other arguments reach
the CLI normally.

## Development

```bash
npm install
npm run build
npm test
npm run dev
```

The test suite runs entirely against a stubbed
JSON-RPC upstream — no live network calls.

## License

MIT — see `LICENSE`.
