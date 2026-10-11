import axios from "axios";
/**
 * Thin HTTP client for the Frappe / ERPNext REST + method APIs.
 * Base path is `${baseUrl}/api`.
 */
export class FrappeClient {
    http;
    baseUrl;
    constructor(config) {
        const baseURL = config.baseUrl.replace(/\/+$/, "");
        this.baseUrl = baseURL;
        const headers = {
            Accept: "application/json",
            "Content-Type": "application/json",
        };
        if (config.apiKey && config.apiSecret) {
            headers.Authorization = `token ${config.apiKey}:${config.apiSecret}`;
        }
        else if (config.bearerToken) {
            headers.Authorization = `Bearer ${config.bearerToken}`;
        }
        else if (config.username && config.password) {
            headers.Authorization =
                "Basic " + Buffer.from(`${config.username}:${config.password}`).toString("base64");
        }
        this.http = axios.create({
            baseURL: `${baseURL}/api`,
            timeout: config.timeout ?? 30000,
            headers,
        });
    }
    async request(method, url, config) {
        const res = await this.http.request({ method, url, ...config });
        return res.data;
    }
    // ---- REST resource helpers ----
    list(doctype, opts) {
        const params = {
            limit_page_length: String(opts.limit ?? 20),
            limit_start: String(opts.offset ?? 0),
        };
        if (opts.fields && opts.fields.length)
            params.fields = JSON.stringify(opts.fields);
        if (opts.filters && opts.filters.length)
            params.filters = JSON.stringify(opts.filters);
        if (opts.orderBy)
            params.order_by = opts.orderBy;
        return this.request("GET", `resource/${encodeURIComponent(doctype)}`, { params });
    }
    get(doctype, name) {
        return this.request("GET", `resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`);
    }
    create(doctype, data) {
        return this.request("POST", `resource/${encodeURIComponent(doctype)}`, { data });
    }
    update(doctype, name, data) {
        return this.request("PUT", `resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`, { data });
    }
    remove(doctype, name) {
        return this.request("DELETE", `resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`);
    }
    // ---- Whitelisted method helper ----
    callMethod(method, opts = {}) {
        const httpMethod = opts.httpMethod ?? "GET";
        const cfg = {};
        if (opts.params && Object.keys(opts.params).length)
            cfg.params = opts.params;
        if (httpMethod === "POST")
            cfg.data = opts.body ?? {};
        return this.request(httpMethod, `method/${method}`, cfg);
    }
}
//# sourceMappingURL=client.js.map