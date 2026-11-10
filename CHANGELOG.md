# Changelog

## 0.1.0 (2026-10-28)

- First release: a forwarding client for the hosted HasData Amazon MCP server, serving all 5 captured tools locally for tools/list and forwarding every tools/call upstream over a streamable-HTTP JSON-RPC session (initialize, notifications/initialized, tools/call, honouring the Mcp-Session-Id header when issued).
- Tools: `hasdata_amazon_product_getProductDetails`, `hasdata_amazon_reviews_getProductReviews`, `hasdata_amazon_search_getSearchResults`, `hasdata_amazon_seller_getSellerDetails`, `hasdata_amazon_seller_products_getSellerProducts`.
- Upstream results pass through verbatim; upstream failures surface as `shopdata error:` text results.
- One bin serves the CLI (one subcommand per tool, plus `--version`) and the stdio MCP server (`mcp` subcommand). Upstream endpoint overridable via `HASDATA_AMAZON_MCP_URL`; when `HASDATA_API_KEY` is set it is sent as an `x-api-key: <value>` header on every upstream request.
