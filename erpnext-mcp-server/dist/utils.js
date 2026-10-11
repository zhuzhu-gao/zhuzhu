import { AxiosError } from "axios";
/** Maximum size (in characters) of a tool's text response before truncation. */
export const CHARACTER_LIMIT = 25000;
/** Convert our filter tuples to Frappe's [[field, operator, value], ...] form. */
export function toFrappeFilters(filters) {
    if (!filters || filters.length === 0)
        return undefined;
    return filters.map((f) => [f.field, f.operator, f.value]);
}
/** Serialize params for GET: scalars pass through, arrays/objects are JSON-encoded. */
export function serializeParams(params) {
    if (!params)
        return undefined;
    const out = {};
    for (const [k, v] of Object.entries(params)) {
        out[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
    return out;
}
/** Truncate a string to CHARACTER_LIMIT with a clear marker. */
export function truncate(text) {
    if (text.length <= CHARACTER_LIMIT)
        return { text, truncated: false };
    return {
        text: text.slice(0, CHARACTER_LIMIT) +
            `\n\n...[response truncated at ${CHARACTER_LIMIT} characters; narrow filters or request fewer fields]`,
        truncated: true,
    };
}
/** Render a list of records as a markdown table. */
export function recordsToMarkdown(title, records) {
    if (!records.length)
        return `${title}: no records found.`;
    const first = records[0];
    const keys = Object.keys(first);
    const esc = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
    const header = `| ${keys.join(" | ")} |`;
    const sep = `| ${keys.map(() => "---").join(" | ")} |`;
    const rows = records.map((r) => `| ${keys.map((k) => esc(r[k])).join(" | ")} |`);
    return `# ${title} (${records.length} record${records.length === 1 ? "" : "s"})\n\n${[header, sep, ...rows].join("\n")}`;
}
/** Render a single document as markdown (scalar fields as list, child tables nested). */
export function docToMarkdown(doctype, name, doc) {
    const lines = [`# ${doctype}: ${name}`, ""];
    const childTables = [];
    for (const [k, v] of Object.entries(doc)) {
        if (k.startsWith("_") || k === "doctype")
            continue;
        if (Array.isArray(v)) {
            if (v.length)
                childTables.push({ key: k, rows: v });
            continue;
        }
        if (v !== null && typeof v === "object")
            continue;
        lines.push(`- **${k}**: ${v === "" || v == null ? "—" : String(v)}`);
    }
    for (const ct of childTables) {
        lines.push("", `## ${ct.key} (${ct.rows.length} rows)`, "");
        lines.push(recordsToMarkdown(ct.key, ct.rows));
    }
    return lines.join("\n");
}
/** Render doctype metadata as markdown. */
export function metaToMarkdown(meta) {
    const lines = [
        `# DocType: ${meta.doctype}`,
        "",
        `- **Module**: ${meta.module ?? "—"}`,
        `- **Naming**: ${meta.naming ?? "—"}`,
        `- **Submittable**: ${meta.is_submittable ? "yes" : "no"}`,
        `- **Tree**: ${meta.is_tree ? "yes" : "no"}`,
        `- **Document Type**: ${meta.document_type ?? "—"}`,
        "",
        "## Fields",
        "",
        "| fieldname | label | type | options | required | read_only | hidden | default |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ];
    for (const f of meta.fields) {
        const reqd = f.reqd ? "yes" : "";
        const ro = f.read_only ? "yes" : "";
        const hid = f.hidden ? "yes" : "";
        lines.push(`| ${f.fieldname ?? ""} | ${f.label ?? ""} | ${f.fieldtype ?? ""} | ${f.options ?? ""} | ${reqd} | ${ro} | ${hid} | ${f.default ?? ""} |`);
    }
    return lines.join("\n");
}
/** Render a report result as a markdown table. */
export function reportToMarkdown(reportName, columns, rows) {
    if (!rows.length)
        return `Report "${reportName}" returned no rows.`;
    const colNames = columns.length ? columns : rows[0].map((_, i) => `col_${i + 1}`);
    const esc = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
    const header = `| ${colNames.join(" | ")} |`;
    const sep = `| ${colNames.map(() => "---").join(" | ")} |`;
    const body = rows.map((r) => `| ${r.map((c) => esc(c)).join(" | ")} |`);
    return `# Report: ${reportName} (${rows.length} rows)\n\n${[header, sep, ...body].join("\n")}`;
}
/** Convert an axios/Frappe error into an actionable message for the agent. */
export function handleApiError(error) {
    if (error instanceof AxiosError) {
        const status = error.response?.status;
        const data = error.response?.data;
        const detail = (data && data.message) ||
            (data && data.exc_type) ||
            (data && data.error) ||
            (data && data.exc ? String(data.exc).split("\n").filter(Boolean).pop() : undefined);
        if (status === 401) {
            return "Error 401 Unauthorized: ERPNext rejected the credentials. Verify ERPNEXT_API_KEY/ERPNEXT_API_SECRET (or username/password) are correct and the API key is enabled for the user.";
        }
        if (status === 403) {
            return "Error 403 Forbidden: the authenticated user lacks permission for this operation. Grant the required role/permission in ERPNext, or check that the doctype/method name is correct.";
        }
        if (status === 404) {
            return `Error 404 Not Found: ${error.config?.url ?? "resource"}. Check the doctype name, record name, or method path for typos.`;
        }
        if (status === 429) {
            return "Error 429 Rate Limited: ERPNext is throttling requests. Wait and retry, or reduce the call rate.";
        }
        if (error.code === "ECONNABORTED") {
            return "Error: ERPNext request timed out. The server may be slow or unreachable.";
        }
        if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
            return `Error: cannot reach ERPNEXT_URL (${error.code}). Confirm the site URL is correct and reachable from this host.`;
        }
        return `Error calling ERPNext${status ? ` (HTTP ${status})` : ""}: ${detail ?? error.message}`;
    }
    return `Error: unexpected error: ${error instanceof Error ? error.message : String(error)}`;
}
//# sourceMappingURL=utils.js.map