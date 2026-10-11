import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FrappeClient } from "./client.js";
import {
  docToMarkdown,
  handleApiError,
  metaToMarkdown,
  recordsToMarkdown,
  reportToMarkdown,
  serializeParams,
  toFrappeFilters,
  truncate,
  type FilterTuple,
} from "./utils.js";

const ResponseFormatSchema = z
  .enum(["markdown", "json"])
  .default("markdown")
  .describe("Output format: 'markdown' for human-readable, 'json' for machine-readable");

const FiltersSchema = z
  .array(
    z.object({
      field: z.string().describe("Fieldname, e.g. 'item_code', 'customer', 'posting_date'"),
      operator: z
        .string()
        .describe(
          "Operator: =, !=, <, >, <=, >=, like, not like, in, not in, between, is, is not. For boolean/disabled fields use 0/1 (not true/false).",
        ),
      value: z
        .unknown()
        .describe("Comparison value. 'like' uses %wildcard%; 'in' uses an array; 'is' uses 'set'/'not set'."),
    }),
  )
  .describe("AND-combined filter conditions.");

/** Register all ERPNext tools on the given MCP server. */
export function registerTools(server: McpServer, client: FrappeClient): void {
  // 1. LIST ---------------------------------------------------------------
  const ListSchema = z.object({
    doctype: z.string().min(1).describe("DocType name, e.g. 'Item', 'Customer', 'Sales Order', 'Purchase Receipt'."),
    filters: FiltersSchema.optional(),
    fields: z.array(z.string()).optional().describe("Fieldnames to return. Defaults to ['name']."),
    order_by: z.string().optional().describe("e.g. 'creation desc', 'name asc'."),
    limit: z.number().int().min(1).max(500).default(20).describe("Page size (1-500)."),
    offset: z.number().int().min(0).default(0).describe("Records to skip for pagination."),
    response_format: ResponseFormatSchema,
  }).strict();

  server.registerTool(
    "erpnext_list_records",
    {
      title: "List ERPNext Records",
      description: `List records of a Frappe/ERPNext DocType via GET /api/resource/{doctype} with filters, field selection, ordering, and pagination.

Pass 'fields' to limit payload size — returning all columns on large doctypes is wasteful. Use this to browse Customers, Items, Sales Orders, Invoices, Employees, etc.

Args:
  - doctype (string, required): DocType name.
  - filters (array, optional): AND-combined [field, operator, value] conditions.
  - fields (array, optional): fieldnames to return. Defaults to ['name'].
  - order_by (string, optional): e.g. 'creation desc'.
  - limit (int, 1-500, default 20): page size.
  - offset (int, >=0, default 0): records to skip.
  - response_format ('markdown'|'json', default 'markdown').

Returns {doctype, count, offset, limit, has_more, records}. 'has_more' is heuristic (true when rows returned == limit). Markdown renders a table.

Examples:
  - doctype="Customer", filters=[{field:"disabled",operator:"=",value:0}], fields=["name","customer_name","customer_group"], limit=10
  - doctype="Item", order_by="modified desc", fields=["name","item_code","item_name"], limit=50

Errors: 401 bad credentials; 403 missing role; 404 unknown doctype.`,
      inputSchema: ListSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const fields = params.fields && params.fields.length ? params.fields : ["name"];
        const data = (await client.list(params.doctype, {
          filters: toFrappeFilters(params.filters as FilterTuple[] | undefined),
          fields,
          orderBy: params.order_by,
          limit: params.limit,
          offset: params.offset,
        })) as { data?: unknown[] } | undefined;
        const records = Array.isArray(data?.data) ? (data as { data: unknown[] }).data : [];
        const output = {
          doctype: params.doctype,
          count: records.length,
          offset: params.offset,
          limit: params.limit,
          has_more: records.length === params.limit,
          records,
        };
        const text =
          params.response_format === "json"
            ? JSON.stringify(output, null, 2)
            : recordsToMarkdown(`${params.doctype} (offset ${params.offset})`, records);
        const t = truncate(text);
        return { content: [{ type: "text" as const, text: t.text }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: handleApiError(e) }], isError: true };
      }
    },
  );

  // 2. GET ----------------------------------------------------------------
  const GetSchema = z.object({
    doctype: z.string().min(1),
    name: z.string().min(1).describe("Record name (primary-key 'name' field, e.g. customer name or doc ID)."),
    response_format: ResponseFormatSchema,
  }).strict();

  server.registerTool(
    "erpnext_get_record",
    {
      title: "Get ERPNext Record",
      description: `Fetch a single record by DocType + name via GET /api/resource/{doctype}/{name}.

Args:
  - doctype (string, required).
  - name (string, required): record name.
  - response_format ('markdown'|'json', default 'markdown').

Returns the full document including child-table rows. Markdown lists scalar fields and nests child tables.

Examples:
  - doctype="Customer", name="Acme Corp"
  - doctype="Sales Order", name="SAL-ORD-2024-00001"

Errors: 404 record not found; 403 no read permission.`,
      inputSchema: GetSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const doc = (await client.get(params.doctype, params.name)) as Record<string, unknown>;
        const text =
          params.response_format === "json"
            ? JSON.stringify(doc, null, 2)
            : docToMarkdown(params.doctype, params.name, doc ?? {});
        const t = truncate(text);
        return { content: [{ type: "text" as const, text: t.text }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: handleApiError(e) }], isError: true };
      }
    },
  );

  // 3. COUNT --------------------------------------------------------------
  const CountSchema = z.object({
    doctype: z.string().min(1),
    filters: FiltersSchema.optional(),
    response_format: ResponseFormatSchema,
  }).strict();

  server.registerTool(
    "erpnext_count_records",
    {
      title: "Count ERPNext Records",
      description: `Count records of a DocType matching filters via frappe.client.get_count.

Faster than listing when you only need the total.

Args:
  - doctype (string, required).
  - filters (array, optional).
  - response_format ('markdown'|'json', default 'markdown').

Returns {doctype, count}.

Example: doctype="Sales Invoice", filters=[{field:"docstatus",operator:"=",value:1}] → submitted invoice count.`,
      inputSchema: CountSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const qp: Record<string, string> = { doctype: params.doctype };
        const f = toFrappeFilters(params.filters as FilterTuple[] | undefined);
        if (f) qp.filters = JSON.stringify(f);
        const res = (await client.callMethod("frappe.client.get_count", {
          httpMethod: "GET",
          params: qp,
        })) as { message?: unknown } | number | undefined;
        const count = typeof res === "number" ? res : (res && (res as { message?: unknown }).message) ?? res;
        const output = { doctype: params.doctype, count };
        const text =
          params.response_format === "json"
            ? JSON.stringify(output, null, 2)
            : `${params.doctype}: **${count}** record(s) match.`;
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: handleApiError(e) }], isError: true };
      }
    },
  );

  // 4. CREATE -------------------------------------------------------------
  const CreateSchema = z.object({
    doctype: z.string().min(1),
    data: z
      .record(z.string(), z.unknown())
      .describe("Field values, e.g. {customer_name:'Acme', customer_group:'All Customer Groups'}. Use erpnext_get_doctype_meta to discover mandatory fields."),
    response_format: ResponseFormatSchema,
  }).strict();

  server.registerTool(
    "erpnext_create_record",
    {
      title: "Create ERPNext Record",
      description: `Create a new record via POST /api/resource/{doctype}.

Args:
  - doctype (string, required).
  - data (object, required): field → value map.
  - response_format ('markdown'|'json', default 'markdown').

Returns the created document (Frappe echoes it with its assigned 'name').

Example: doctype="Customer", data={customer_name:"Acme Corp", customer_group:"All Customer Groups", territory:"All Territories"}.

Use erpnext_get_doctype_meta first to find mandatory (reqd) fields. Errors: 400/417 validation error (missing mandatory field or bad link); 403 no create permission.`,
      inputSchema: CreateSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const doc = (await client.create(params.doctype, params.data)) as Record<string, unknown>;
        const text =
          params.response_format === "json"
            ? JSON.stringify(doc, null, 2)
            : docToMarkdown(params.doctype, (doc && (doc.name as string)) ?? "(new)", doc ?? {});
        const t = truncate(text);
        return { content: [{ type: "text" as const, text: t.text }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: handleApiError(e) }], isError: true };
      }
    },
  );

  // 5. UPDATE -------------------------------------------------------------
  const UpdateSchema = z.object({
    doctype: z.string().min(1),
    name: z.string().min(1),
    data: z.record(z.string(), z.unknown()).describe("Only the fields to change."),
    response_format: ResponseFormatSchema,
  }).strict();

  server.registerTool(
    "erpnext_update_record",
    {
      title: "Update ERPNext Record",
      description: `Update an existing record via PUT /api/resource/{doctype}/{name}.

Args:
  - doctype (string, required).
  - name (string, required).
  - data (object, required): only the fields to change.
  - response_format ('markdown'|'json', default 'markdown').

Returns the updated document. Cannot update a submitted (docstatus=1) document directly — cancel or use an amendment.

Example: doctype="Customer", name="Acme Corp", data={lead_owner:"sales@example.com"}.

Errors: 404 not found; 403 no write permission.`,
      inputSchema: UpdateSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const doc = (await client.update(params.doctype, params.name, params.data)) as Record<string, unknown>;
        const text =
          params.response_format === "json"
            ? JSON.stringify(doc, null, 2)
            : docToMarkdown(params.doctype, params.name, doc ?? {});
        const t = truncate(text);
        return { content: [{ type: "text" as const, text: t.text }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: handleApiError(e) }], isError: true };
      }
    },
  );

  // 6. DELETE -------------------------------------------------------------
  const DeleteSchema = z.object({
    doctype: z.string().min(1),
    name: z.string().min(1),
    response_format: ResponseFormatSchema,
  }).strict();

  server.registerTool(
    "erpnext_delete_record",
    {
      title: "Delete ERPNext Record",
      description: `Delete a record via DELETE /api/resource/{doctype}/{name}.

Only works on draft (docstatus=0) records in most ERPNext doctypes; submitted documents must be cancelled first.

Args:
  - doctype (string, required).
  - name (string, required).
  - response_format ('markdown'|'json', default 'markdown').

Returns {doctype, name, deleted:true} on success. Errors: 404 not found; 403 no delete permission; cannot delete submitted doc.

Example: doctype="Customer", name="Acme Corp".`,
      inputSchema: DeleteSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        await client.remove(params.doctype, params.name);
        const output = { doctype: params.doctype, name: params.name, deleted: true };
        const text =
          params.response_format === "json"
            ? JSON.stringify(output, null, 2)
            : `Deleted ${params.doctype} **${params.name}**.`;
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: handleApiError(e) }], isError: true };
      }
    },
  );

  // 7. SEARCH -------------------------------------------------------------
  const SearchSchema = z.object({
    doctype: z.string().min(1),
    text: z.string().min(1).describe("Search text; wrapped in %wildcards% for a 'like' match."),
    search_field: z.string().default("name").describe("Field to match against (default 'name')."),
    fields: z.array(z.string()).optional().describe("Fields to return; defaults to ['name', <search_field>]."),
    limit: z.number().int().min(1).max(200).default(20),
    response_format: ResponseFormatSchema,
  }).strict();

  server.registerTool(
    "erpnext_search_records",
    {
      title: "Search ERPNext Records",
      description: `Quickly find records by a partial text match on one field (default 'name') using a 'like' filter.

Args:
  - doctype (string, required).
  - text (string, required): matched with %wildcards%.
  - search_field (string, default 'name').
  - fields (array, optional): defaults to ['name', <search_field>].
  - limit (int, 1-200, default 20).
  - response_format ('markdown'|'json', default 'markdown').

For multi-field OR search or complex filters, use erpnext_list_records with custom filters.

Examples:
  - doctype="Item", text="WIDGET", search_field="item_name"
  - doctype="Customer", text="acme"`,
      inputSchema: SearchSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const retFields = params.fields && params.fields.length
          ? params.fields
          : Array.from(new Set(["name", params.search_field]));
        const data = (await client.list(params.doctype, {
          filters: [[params.search_field, "like", `%${params.text}%`]],
          fields: retFields,
          limit: params.limit,
          offset: 0,
        })) as { data?: unknown[] } | undefined;
        const records = Array.isArray(data?.data) ? (data as { data: unknown[] }).data : [];
        const output = {
          doctype: params.doctype,
          search_field: params.search_field,
          text: params.text,
          count: records.length,
          records,
        };
        const text =
          params.response_format === "json"
            ? JSON.stringify(output, null, 2)
            : recordsToMarkdown(`Search ${params.doctype} where ${params.search_field} ~ "${params.text}"`, records);
        const t = truncate(text);
        return { content: [{ type: "text" as const, text: t.text }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: handleApiError(e) }], isError: true };
      }
    },
  );

  // 8. DOCTYPE META -------------------------------------------------------
  const MetaSchema = z.object({
    doctype: z.string().min(1),
    response_format: ResponseFormatSchema,
  }).strict();

  server.registerTool(
    "erpnext_get_doctype_meta",
    {
      title: "Get ERPNext DocType Metadata",
      description: `Get metadata (fields, mandatory fields, naming rule, submittable, etc.) for a DocType via GET /api/resource/DocType/{doctype}.

Essential before creating records: reveals mandatory (reqd) fields, field types, and Link options so you can build a valid 'data' payload for erpnext_create_record.

Args:
  - doctype (string, required).
  - response_format ('markdown'|'json', default 'markdown').

Returns {doctype, module, naming, is_submittable, is_tree, document_type, track_changes, fields:[{fieldname,label,fieldtype,options,reqd,read_only,hidden,default,description}]}.

Example: doctype="Customer" → lists customer_name (Data, reqd), customer_group (Link→Customer Group, reqd), territory (Link→Territory, reqd).`,
      inputSchema: MetaSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const doc = (await client.get("DocType", params.doctype)) as Record<string, unknown> & {
          fields?: Array<Record<string, unknown>>;
        };
        const fields = Array.isArray(doc?.fields)
          ? doc.fields.map((f) => ({
              fieldname: f.fieldname,
              label: f.label,
              fieldtype: f.fieldtype,
              options: f.options,
              reqd: f.reqd === 1,
              read_only: f.read_only === 1,
              hidden: f.hidden === 1,
              default: f.default,
              description: f.description,
            }))
          : [];
        const meta = {
          doctype: String(doc.name ?? params.doctype),
          module: typeof doc.module === "string" ? doc.module : undefined,
          naming: typeof (doc.naming_rule ?? doc.autoname) === "string" ? String(doc.naming_rule ?? doc.autoname) : undefined,
          is_submittable: doc.is_submittable === 1,
          is_tree: doc.is_tree === 1,
          document_type: typeof doc.document_type === "string" ? doc.document_type : undefined,
          track_changes: doc.track_changes === 1,
          fields,
        };
        const text =
          params.response_format === "json"
            ? JSON.stringify(meta, null, 2)
            : metaToMarkdown(meta);
        const t = truncate(text);
        return { content: [{ type: "text" as const, text: t.text }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: handleApiError(e) }], isError: true };
      }
    },
  );

  // 9. CALL METHOD --------------------------------------------------------
  const MethodSchema = z.object({
    method: z
      .string()
      .min(1)
      .describe("Dotted whitelisted method path, e.g. 'frappe.client.get_value', 'erpnext.stock.doctype.stock_entry.stock_entry.make_stock_entry'."),
    http_method: z.enum(["GET", "POST"]).default("GET").describe("GET for read-only; POST for actions with side effects or large args."),
    params: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Arguments as an object. For GET these become query params (arrays/objects are JSON-encoded)."),
    body: z.record(z.string(), z.unknown()).optional().describe("JSON body (POST only)."),
    response_format: ResponseFormatSchema,
  }).strict();

  server.registerTool(
    "erpnext_call_method",
    {
      title: "Call ERPNext Whitelisted Method",
      description: `Call any whitelisted Frappe/ERPNext server method via /api/method/{method}.

A powerful escape hatch for operations not covered by the CRUD tools: frappe.client.get_value, submit/cancel documents, stock transactions, ledger entries, etc.

Args:
  - method (string, required): dotted whitelisted path.
  - http_method ('GET'|'POST', default 'GET').
  - params (object, optional): arguments (GET → query; POST → merged into JSON body).
  - body (object, optional): JSON body (POST only; merged with params).
  - response_format ('markdown'|'json', default 'markdown').

Frappe wraps return values as {message: <retval>}; this tool returns the full response object — inspect 'message' for the actual result.

Examples:
  - method="frappe.client.get_value", params={doctype:"Customer", fieldname:"customer_name,customer_group", name:"Acme Corp"}
  - method="frappe.client.submit", http_method="POST", body={doctype:"Sales Order", name:"SAL-ORD-2024-00001"}  (if whitelisted)

Prefer the dedicated CRUD tools when they fit. Use erpnext_get_doctype_meta / erpnext_list_records to discover valid field/method names first.`,
      inputSchema: MethodSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const qp = params.http_method === "GET" ? serializeParams(params.params) : undefined;
        const body =
          params.http_method === "POST"
            ? { ...(params.params ?? {}), ...(params.body ?? {}) }
            : undefined;
        const res = await client.callMethod(params.method, {
          httpMethod: params.http_method,
          params: qp,
          body,
        });
        const text =
          params.response_format === "json"
            ? JSON.stringify(res ?? null, null, 2)
            : `# Method result: ${params.method}\n\n\`\`\`json\n${JSON.stringify(res ?? null, null, 2)}\n\`\`\``;
        const t = truncate(text);
        return { content: [{ type: "text" as const, text: t.text }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: handleApiError(e) }], isError: true };
      }
    },
  );

  // 10. RUN REPORT --------------------------------------------------------
  const ReportSchema = z.object({
    report_name: z.string().min(1).describe("Report name, e.g. 'Stock Ledger', 'Sales Register', 'Items To Be Delivered'."),
    filters: z
      .record(z.string(), z.unknown())
      .default({})
      .describe("Report filters as {fieldname: value}."),
    response_format: ResponseFormatSchema,
  }).strict();

  server.registerTool(
    "erpnext_run_report",
    {
      title: "Run ERPNext Report",
      description: `Run a Query/Script/List report via frappe.desk.query_report.run and return its columns and rows.

Args:
  - report_name (string, required).
  - filters (object, default {}): {fieldname: value}.
  - response_format ('markdown'|'json', default 'markdown').

Returns {report_name, columns, rows, result_count}. Markdown renders a table.

Examples:
  - report_name="Stock Ledger", filters={item_code:"ITEM-0001", warehouse:"Stores - TC", from_date:"2024-01-01", to_date:"2024-12-31"}
  - report_name="Sales Register", filters={from_date:"2024-01-01", to_date:"2024-01-31"}

Discover report names via ERPNext's report list or erpnext_list_records on the 'Report' doctype. Some reports require specific roles.`,
      inputSchema: ReportSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const res = (await client.callMethod("frappe.desk.query_report.run", {
          httpMethod: "POST",
          body: { report_name: params.report_name, filters: params.filters },
        })) as {
          columns?: Array<Record<string, unknown> | string>;
          result?: unknown[];
        } | undefined;
        const columns: string[] = Array.isArray(res?.columns)
          ? res.columns.map((c) =>
              typeof c === "string" ? c : String((c as Record<string, unknown>)?.label ?? (c as Record<string, unknown>)?.fieldname ?? "col"),
            )
          : [];
        let rows: unknown[][] = [];
        if (Array.isArray(res?.result)) {
          const result = res.result;
          rows = result.every((r) => Array.isArray(r))
            ? (result as unknown[][])
            : result.map((r) => (r && typeof r === "object" ? Object.values(r) : [r]));
        }
        const output = {
          report_name: params.report_name,
          columns,
          rows,
          result_count: rows.length,
        };
        const text =
          params.response_format === "json"
            ? JSON.stringify(output, null, 2)
            : reportToMarkdown(params.report_name, columns, rows);
        const t = truncate(text);
        return { content: [{ type: "text" as const, text: t.text }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: handleApiError(e) }], isError: true };
      }
    },
  );
}
