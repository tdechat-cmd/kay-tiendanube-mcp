// Cliente mínimo de la API de Tiendanube / Nuvemshop.
// Docs: https://tiendanube.github.io/api-documentation/

export interface TiendanubeConfig {
  storeId: string;
  accessToken: string;
  userAgent: string;
  apiVersion: string; // "v1" por defecto
}

export class TiendanubeError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`Tiendanube respondió ${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
}

export class Tiendanube {
  constructor(private cfg: TiendanubeConfig) {}

  baseUrl(apiVersion = this.cfg.apiVersion) {
    return `https://api.tiendanube.com/${apiVersion}/${this.cfg.storeId}`;
  }

  async request<T = unknown>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    opts: { query?: Record<string, unknown>; body?: unknown; apiVersion?: string } = {},
  ): Promise<{ data: T; total?: number }> {
    const url = new URL(this.baseUrl(opts.apiVersion) + (path.startsWith("/") ? path : `/${path}`));
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }

    const res = await fetch(url, {
      method,
      headers: {
        // Tiendanube usa "Authentication" (no "Authorization").
        Authentication: `bearer ${this.cfg.accessToken}`,
        "User-Agent": this.cfg.userAgent,
        "Content-Type": "application/json",
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* respuesta no JSON */
    }
    if (!res.ok) throw new TiendanubeError(res.status, data);

    const total = res.headers.get("x-total-count");
    return { data: data as T, total: total ? Number(total) : undefined };
  }
}

/** Canjea el `code` del flujo OAuth por un access_token. */
export async function exchangeCode(clientId: string, clientSecret: string, code: string) {
  const res = await fetch("https://www.tiendanube.com/apps/authorize/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    user_id?: number | string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Error ${res.status} al canjear el code`);
  }
  return data;
}
