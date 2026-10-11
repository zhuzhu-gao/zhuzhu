#!/usr/bin/env node
/**
 * ERPNext MCP Server
 *
 * Exposes the Frappe / ERPNext REST API as MCP tools for LLM clients
 * (Claude Desktop, Cline, Trae, etc.) over stdio.
 *
 * Configuration via environment variables:
 *   ERPNEXT_URL            (required) base URL of the ERPNext site, e.g. https://erp.example.com
 *   ERPNEXT_API_KEY        (preferred) Frappe API key
 *   ERPNEXT_API_SECRET     (preferred) Frappe API secret
 *   ERPNEXT_USERNAME       (alt) username for Basic auth
 *   ERPNEXT_PASSWORD       (alt) password for Basic auth
 *   ERPNEXT_BEARER_TOKEN   (alt) bearer token
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FrappeClient, type FrappeConfig } from "./client.js";
import { registerTools } from "./tools.js";

function loadConfig(): FrappeConfig {
  const baseUrl = process.env.ERPNEXT_URL;
  if (!baseUrl) {
    console.error("ERROR: ERPNEXT_URL environment variable is required (e.g. https://erp.example.com).");
    process.exit(1);
  }
  const hasTokenAuth = Boolean(process.env.ERPNEXT_API_KEY && process.env.ERPNEXT_API_SECRET);
  const hasBasicAuth = Boolean(process.env.ERPNEXT_USERNAME && process.env.ERPNEXT_PASSWORD);
  const hasBearer = Boolean(process.env.ERPNEXT_BEARER_TOKEN);
  if (!hasTokenAuth && !hasBasicAuth && !hasBearer) {
    console.error(
      "ERROR: authentication required. Set ERPNEXT_API_KEY + ERPNEXT_API_SECRET (preferred), or ERPNEXT_USERNAME + ERPNEXT_PASSWORD, or ERPNEXT_BEARER_TOKEN.",
    );
    process.exit(1);
  }
  return {
    baseUrl,
    apiKey: process.env.ERPNEXT_API_KEY,
    apiSecret: process.env.ERPNEXT_API_SECRET,
    username: process.env.ERPNEXT_USERNAME,
    password: process.env.ERPNEXT_PASSWORD,
    bearerToken: process.env.ERPNEXT_BEARER_TOKEN,
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new FrappeClient(config);
  const server = new McpServer({ name: "erpnext-mcp-server", version: "1.0.0" });
  registerTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`erpnext-mcp-server connected (site: ${client.baseUrl}) via stdio`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
