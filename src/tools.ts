import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Tiendanube, TiendanubeError } from "./tiendanube.js";

type Json = Record<string, any>;

const ok = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
});

const fail = (err: unknown) => ({
  isError: true,
  content: [
    {
      type: "text" as const,
      text: err instanceof TiendanubeError ? err.message : `Error: ${(err as Error).message}`,
    },
  ],
});

/** Tiendanube devuelve textos multi-idioma: { es: "...", pt: "..." }. Nos quedamos con es. */
const t = (v: unknown): string | undefined => {
  if (v == null) return undefined;
  if (typeof v === "string") return v;
  const o = v as Json;
  return o.es ?? o.pt ?? o.en ?? Object.values(o)[0];
};

const compactVariant = (v: Json) => ({
  id: v.id,
  sku: v.sku,
  values: (v.values ?? []).map(t),
  price: v.price,
  promotional_price: v.promotional_price,
  cost: v.cost,
  stock: v.stock,
  stock_management: v.stock_management,
});

const compactProduct = (p: Json) => ({
  id: p.id,
  name: t(p.name),
  handle: t(p.handle),
  published: p.published,
  categories: (p.categories ?? []).map((c: Json) => ({ id: c.id, name: t(c.name) })),
  variants: (p.variants ?? []).map(compactVariant),
  updated_at: p.updated_at,
});

const compactOrder = (o: Json) => ({
  id: o.id,
  number: o.number,
  created_at: o.created_at,
  status: o.status,
  payment_status: o.payment_status,
  shipping_status: o.shipping_status,
  total: o.total,
  subtotal: o.subtotal,
  discount: o.discount,
  shipping_cost: o.shipping_cost_customer,
  currency: o.currency,
  customer: o.customer ? { id: o.customer.id, name: o.customer.name, email: o.customer.email } : undefined,
  zipcode: o.shipping_address?.zipcode,
  city: o.shipping_address?.city,
  products: (o.products ?? []).map((i: Json) => ({
    product_id: i.product_id,
    variant_id: i.variant_id,
    sku: i.sku,
    name: i.name,
    quantity: i.quantity,
    price: i.price,
  })),
  coupon: (o.coupon ?? []).map((c: Json) => c.code),
});

const pageArgs = {
  page: z.number().int().min(1).optional().describe("Página (desde 1)"),
  per_page: z.number().int().min(1).max(200).optional().describe("Resultados por página (máx. 200)"),
};

export function registerTools(server: McpServer, tn: Tiendanube) {
  // ---------- Tienda ----------
  server.registerTool(
    "get_store",
    {
      title: "Datos de la tienda",
      description: "Devuelve los datos generales de la tienda KAY (nombre, dominio, moneda, país, plan).",
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const { data } = await tn.request<Json>("GET", "/store");
        return ok({
          id: data.id,
          name: t(data.name),
          url: data.url_with_protocol ?? data.original_domain,
          domains: data.domains,
          main_currency: data.main_currency,
          country: data.country,
          plan_name: data.plan_name,
          email: data.email,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ---------- Productos ----------
  server.registerTool(
    "list_products",
    {
      title: "Listar productos",
      description:
        "Lista productos del catálogo en formato compacto (id, nombre, categorías y variantes con SKU, precio, costo y stock). Permite buscar por texto o SKU.",
      inputSchema: {
        q: z.string().optional().describe("Texto a buscar (nombre, SKU, etiquetas)"),
        category_id: z.number().int().optional(),
        published: z.boolean().optional(),
        ...pageArgs,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ q, category_id, published, page, per_page }) => {
      try {
        const { data, total } = await tn.request<Json[]>("GET", "/products", {
          query: { q, category_id, published, page: page ?? 1, per_page: per_page ?? 50 },
        });
        return ok({ total, page: page ?? 1, products: data.map(compactProduct) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_product",
    {
      title: "Ver producto",
      description: "Devuelve un producto completo (descripción, imágenes, variantes, SEO).",
      inputSchema: { product_id: z.number().int() },
      annotations: { readOnlyHint: true },
    },
    async ({ product_id }) => {
      try {
        const { data } = await tn.request<Json>("GET", `/products/${product_id}`);
        return ok(data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "find_by_sku",
    {
      title: "Buscar por SKU",
      description: "Busca la variante con un SKU exacto y devuelve producto + variante.",
      inputSchema: { sku: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ sku }) => {
      try {
        const { data } = await tn.request<Json>("GET", `/products/sku/${encodeURIComponent(sku)}`);
        return ok(compactProduct(data));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_product",
    {
      title: "Actualizar producto",
      description:
        "Modifica datos de un producto: nombre, descripción (HTML), publicado, etiquetas, categorías, SEO. Solo se cambian los campos enviados.",
      inputSchema: {
        product_id: z.number().int(),
        name: z.string().optional(),
        description: z.string().optional().describe("HTML"),
        published: z.boolean().optional(),
        tags: z.string().optional().describe("Etiquetas separadas por coma"),
        categories: z.array(z.number().int()).optional().describe("IDs de categorías (reemplaza las actuales)"),
        seo_title: z.string().optional(),
        seo_description: z.string().optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ product_id, name, description, seo_title, seo_description, ...rest }) => {
      try {
        const body: Json = { ...rest };
        if (name !== undefined) body.name = { es: name };
        if (description !== undefined) body.description = { es: description };
        if (seo_title !== undefined) body.seo_title = { es: seo_title };
        if (seo_description !== undefined) body.seo_description = { es: seo_description };
        const { data } = await tn.request<Json>("PUT", `/products/${product_id}`, { body });
        return ok(compactProduct(data));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_variant",
    {
      title: "Actualizar variante (precio, costo, stock, SKU)",
      description:
        "Modifica una variante: precio, precio promocional, costo, stock o SKU. Para quitar el precio promocional mandá promotional_price = null. Para stock ilimitado mandá stock = null.",
      inputSchema: {
        product_id: z.number().int(),
        variant_id: z.number().int(),
        price: z.number().nonnegative().optional(),
        promotional_price: z.number().nonnegative().nullable().optional(),
        cost: z.number().nonnegative().optional(),
        stock: z.number().int().nullable().optional(),
        sku: z.string().optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ product_id, variant_id, ...fields }) => {
      try {
        const body = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
        const { data } = await tn.request<Json>("PUT", `/products/${product_id}/variants/${variant_id}`, { body });
        return ok(compactVariant(data));
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ---------- Categorías ----------
  server.registerTool(
    "list_categories",
    {
      title: "Listar categorías",
      description: "Lista las categorías de la tienda (id, nombre, padre).",
      inputSchema: { ...pageArgs },
      annotations: { readOnlyHint: true },
    },
    async ({ page, per_page }) => {
      try {
        const { data } = await tn.request<Json[]>("GET", "/categories", {
          query: { page: page ?? 1, per_page: per_page ?? 200 },
        });
        return ok(data.map((c) => ({ id: c.id, name: t(c.name), handle: t(c.handle), parent: c.parent })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ---------- Pedidos ----------
  server.registerTool(
    "list_orders",
    {
      title: "Listar pedidos",
      description:
        "Lista pedidos en formato compacto. Filtros por estado, pago, envío y rango de fechas (ISO 8601, ej. 2026-10-01T00:00:00-03:00).",
      inputSchema: {
        status: z.enum(["any", "open", "closed", "cancelled"]).optional(),
        payment_status: z.enum(["any", "pending", "authorized", "paid", "abandoned", "refunded", "voided"]).optional(),
        shipping_status: z.enum(["any", "unpacked", "unfulfilled", "fulfilled"]).optional(),
        created_at_min: z.string().optional(),
        created_at_max: z.string().optional(),
        q: z.string().optional().describe("Número de pedido, nombre o email del cliente"),
        ...pageArgs,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ page, per_page, ...filters }) => {
      try {
        const { data, total } = await tn.request<Json[]>("GET", "/orders", {
          query: { ...filters, page: page ?? 1, per_page: per_page ?? 50 },
        });
        return ok({ total, page: page ?? 1, orders: data.map(compactOrder) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_order",
    {
      title: "Ver pedido",
      description: "Devuelve un pedido completo por su ID.",
      inputSchema: { order_id: z.number().int() },
      annotations: { readOnlyHint: true },
    },
    async ({ order_id }) => {
      try {
        const { data } = await tn.request<Json>("GET", `/orders/${order_id}`);
        return ok(data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ---------- Clientes ----------
  server.registerTool(
    "list_customers",
    {
      title: "Listar clientes",
      description: "Lista clientes (id, nombre, email, teléfono, total gastado, último pedido).",
      inputSchema: { q: z.string().optional(), ...pageArgs },
      annotations: { readOnlyHint: true },
    },
    async ({ q, page, per_page }) => {
      try {
        const { data, total } = await tn.request<Json[]>("GET", "/customers", {
          query: { q, page: page ?? 1, per_page: per_page ?? 50 },
        });
        return ok({
          total,
          customers: data.map((c) => ({
            id: c.id,
            name: c.name,
            email: c.email,
            phone: c.phone,
            total_spent: c.total_spent,
            last_order_id: c.last_order_id,
            created_at: c.created_at,
          })),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ---------- Cupones ----------
  server.registerTool(
    "list_coupons",
    {
      title: "Listar cupones",
      description: "Lista los cupones de descuento.",
      inputSchema: { ...pageArgs },
      annotations: { readOnlyHint: true },
    },
    async ({ page, per_page }) => {
      try {
        const { data } = await tn.request<Json[]>("GET", "/coupons", {
          query: { page: page ?? 1, per_page: per_page ?? 50 },
        });
        return ok(data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_coupon",
    {
      title: "Crear cupón",
      description: "Crea un cupón de descuento (porcentaje, monto fijo o envío gratis).",
      inputSchema: {
        code: z.string(),
        type: z.enum(["percentage", "absolute", "shipping"]),
        value: z.number().nonnegative().optional().describe("Porcentaje o monto; no aplica a shipping"),
        start_date: z.string().optional().describe("YYYY-MM-DD"),
        end_date: z.string().optional().describe("YYYY-MM-DD"),
        max_uses: z.number().int().optional(),
        min_price: z.number().optional().describe("Monto mínimo de compra"),
      },
      annotations: { destructiveHint: false },
    },
    async (args) => {
      try {
        const body = Object.fromEntries(
          Object.entries({ ...args, value: args.value?.toString() }).filter(([, v]) => v !== undefined),
        );
        const { data } = await tn.request<Json>("POST", "/coupons", { body });
        return ok(data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ---------- Acceso genérico ----------
  server.registerTool(
    "tiendanube_api",
    {
      title: "Llamada directa a la API",
      description:
        "Llamada genérica a cualquier endpoint de la API de Tiendanube cuando no hay una herramienta específica (ej. GET /shipping_carriers, GET /products/123/images, POST /products). path es relativo a la tienda, ej. '/scripts'. Usar con cuidado en métodos de escritura.",
      inputSchema: {
        method: z.enum(["GET", "POST", "PUT", "DELETE"]),
        path: z.string().startsWith("/"),
        query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
        body: z.any().optional(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ method, path, query, body }) => {
      try {
        const { data, total } = await tn.request(method, path, { query, body });
        return ok(total !== undefined ? { total, data } : data);
      } catch (e) {
        return fail(e);
      }
    },
  );
}
