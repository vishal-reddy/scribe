# Deep Dive: Scribe MCP Server

The Scribe MCP Server runs natively inside Cloudflare Workers (`SCRIBE_MCP` binding) and proxies through the unified `mcp.kecker.co` gateway.

## Primary Capabilities

- Document discovery and full-text search.
- Document drafting, section updating, and Markdown exports.
- Quota inspection via `check_storage_quota`.
