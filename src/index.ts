import express, { type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Tiendanube, exchangeCode } from "./tiendanube.js";
import { registerTools } from "./tools.js";

const env = {
  port: Number(process.env.PORT ?? 3000),
  clientId: process.env.TN_CLIENT_ID ?? "950583",
  clientSecret: process.env.TN_CLIENT_SECRET ?? "",
  storeId: process.env.TN_STORE_ID ?? "",
  accessToken: process.env.TN_ACCESS_TOKEN ?? "",
  userAgent: process.env.TN_USER_AGENT ?? "KAY MCP (app 950583)",
  apiVersion: process.env.TN_API_VERSION ?? "v1",
  mcpSecret: process.env.MCP_SECRET ?? "",
};

if (!env.mcpSecret || env.mcpSecret.length < 24) {
  console.error("Falta MCP_SECRET (mínimo 24 caracteres). El endpoint /mcp queda deshabilitado.");
}

const app = express();
app.use(express.json({ limit: "4mb" }));

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const page = (title: string, body: string) => `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;line-height:1.5;color:#1a1a1a}
code{background:#f2f2f2;padding:2px 6px;border-radius:4px;word-break:break-all}.box{background:#f7f7f7;border:1px solid #ddd;border-radius:8px;padding:16px}</style>
</head><body>${body}</body></html>`;

app.get("/", (_req, res) => {
  res.type("html").send(
    page(
      "KAY · Tiendanube MCP",
      `<h1>KAY · Tiendanube MCP</h1>
       <p>Servidor activo. Tienda conectada: <b>${env.storeId && env.accessToken ? "sí" : "no"}</b>.</p>
       <p>Para instalar la app en la tienda: <a href="https://www.tiendanube.com/apps/${escapeHtml(env.clientId)}/authorize">autorizar app ${escapeHtml(env.clientId)}</a></p>`,
    ),
  );
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, storeConfigured: Boolean(env.storeId && env.accessToken) });
});

// Redirect URL de la app en el Portal de Socios: https://<tu-dominio>/oauth/callback
app.get("/oauth/callback", async (req: Request, res: Response) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  if (!code) return res.status(400).type("html").send(page("Error", "<h1>Falta el parámetro code</h1>"));
  if (!env.clientSecret)
    return res.status(500).type("html").send(page("Error", "<h1>Falta TN_CLIENT_SECRET en las variables de Railway</h1>"));
  try {
    const data = await exchangeCode(env.clientId, env.clientSecret, code);
    res.type("html").send(
      page(
        "App instalada",
        `<h1>✅ App instalada en la tienda</h1>
         <p>Copiá estos dos valores en las variables del servicio en Railway y después redeployá. No los compartas con nadie.</p>
         <div class="box">
           <p><b>TN_STORE_ID</b><br><code>${escapeHtml(String(data.user_id))}</code></p>
           <p><b>TN_ACCESS_TOKEN</b><br><code>${escapeHtml(data.access_token!)}</code></p>
           <p><b>Permisos</b><br><code>${escapeHtml(data.scope ?? "")}</code></p>
         </div>
         <p>El token no vence, pero se invalida si desinstalás la app o generás uno nuevo.</p>`,
      ),
    );
  } catch (e) {
    res.status(400).type("html").send(page("Error", `<h1>No se pudo instalar</h1><p>${escapeHtml((e as Error).message)}</p>`));
  }
});

const secretMatches = (given: string) => {
  if (!env.mcpSecret || env.mcpSecret.length < 24) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(env.mcpSecret);
  return a.length === b.length && timingSafeEqual(a, b);
};

function buildServer() {
  const server = new McpServer({ name: "kay-tiendanube", version: "1.0.0" });
  if (!env.storeId || !env.accessToken) {
    server.registerTool(
      "estado_conexion",
      { description: "Indica que la tienda todavía no está conectada.", annotations: { readOnlyHint: true } },
      async () => ({
        isError: true,
        content: [
          {
            type: "text",
            text: "La tienda no está conectada: faltan TN_STORE_ID y/o TN_ACCESS_TOKEN en Railway. Instalá la app desde /oauth y cargá los valores.",
          },
        ],
      }),
    );
    return server;
  }
  registerTools(
    server,
    new Tiendanube({
      storeId: env.storeId,
      accessToken: env.accessToken,
      userAgent: env.userAgent,
      apiVersion: env.apiVersion,
    }),
  );
  return server;
}

// Endpoint MCP (Streamable HTTP, sin estado). La URL incluye un secreto: tratala como una contraseña.
app.post("/mcp/:secret", async (req: Request, res: Response) => {
  if (!secretMatches(String(req.params.secret))) return res.status(404).json({ error: "not found" });
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  }
});

const methodNotAllowed = (req: Request, res: Response) => {
  if (!secretMatches(String(req.params.secret))) return res.status(404).json({ error: "not found" });
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
};
app.get("/mcp/:secret", methodNotAllowed);
app.delete("/mcp/:secret", methodNotAllowed);

app.listen(env.port, () => console.log(`KAY Tiendanube MCP escuchando en :${env.port}`));
