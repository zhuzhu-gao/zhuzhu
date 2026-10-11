import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";

export interface FrappeConfig {
  baseUrl: string;
  apiKey?: string;
  apiSecret?: string;
  username?: string;
  password?: string;
  bearerToken?: string;
  timeout?: number;
}

/**
 * Thin HTTP client for the Frappe / ERPNext REST + method APIs.
 * Base path is `${baseUrl}/api`.
 */
export class FrappeClient {
  private readonly http: AxiosInstance;
  readonly baseUrl: string;

  constructor(config: FrappeConfig) {
    const baseURL = config.baseUrl.replace(/\/+$/, "");
    this.baseUrl = baseURL;

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (config.apiKey && config.apiSecret) {
      headers.Authorization = `token ${config.apiKey}:${config.apiSecret}`;
    } else if (config.bearerToken) {
      headers.Authorization = `Bearer ${config.bearerToken}`;
    } else if (config.username && config.password) {
      headers.Authorization =
        "Basic " + Buffer.from(`${config.username}:${config.password}`).toString("base64");
    }

    this.http = axios.create({
      baseURL: `${baseURL}/api`,
      timeout: config.timeout ?? 30000,
      headers,
    });
  }

  private async request<T = unknown>(method: string, url: string, config?: AxiosRequestConfig): Promise<T> {
    const res = await this.http.request<T>({ method, url, ...config });
    return res.data;
  }

  // ---- REST resource helpers ----

  list(
    doctype: string,
    opts: {
      filters?: unknown[][] | undefined;
      fields?: string[] | undefined;
      orderBy?: string | undefined;
      limit?: number;
      offset?: number;
    },
  ): Promise<unknown> {
    const params: Record<string, string> = {
      limit_page_length: String(opts.limit ?? 20),
      limit_start: String(opts.offset ?? 0),
    };
    if (opts.fields && opts.fields.length) params.fields = JSON.stringify(opts.fields);
    if (opts.filters && opts.filters.length) params.filters = JSON.stringify(opts.filters);
    if (opts.orderBy) params.order_by = opts.orderBy;
    return this.request("GET", `resource/${encodeURIComponent(doctype)}`, { params });
  }

  get(doctype: string, name: string): Promise<unknown> {
    return this.request("GET", `resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`);
  }

  create(doctype: string, data: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", `resource/${encodeURIComponent(doctype)}`, { data });
  }

  update(doctype: string, name: string, data: Record<string, unknown>): Promise<unknown> {
    return this.request(
      "PUT",
      `resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
      { data },
    );
  }

  remove(doctype: string, name: string): Promise<unknown> {
    return this.request(
      "DELETE",
      `resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
    );
  }

  // ---- Whitelisted method helper ----

  callMethod(
    method: string,
    opts: { httpMethod?: "GET" | "POST"; params?: Record<string, string> | undefined; body?: Record<string, unknown> | undefined } = {},
  ): Promise<unknown> {
    const httpMethod = opts.httpMethod ?? "GET";
    const cfg: AxiosRequestConfig = {};
    if (opts.params && Object.keys(opts.params).length) cfg.params = opts.params;
    if (httpMethod === "POST") cfg.data = opts.body ?? {};
    return this.request(httpMethod, `method/${method}`, cfg);
  }
}
