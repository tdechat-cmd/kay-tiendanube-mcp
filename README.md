# KAY · Tiendanube MCP

Servidor MCP que conecta Claude con la tienda **KAY** (tiendakay.com.ar) a través de la app personalizada de Tiendanube **950583**.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `get_store` | Datos generales de la tienda |
| `list_products` | Catálogo compacto: variantes con SKU, precio, costo y stock. Búsqueda por texto |
| `get_product` | Producto completo |
| `find_by_sku` | Busca una variante por SKU exacto |
| `update_product` | Nombre, descripción, publicado, etiquetas, categorías, SEO |
| `update_variant` | Precio, precio promocional, costo, stock, SKU |
| `list_categories` | Categorías |
| `list_orders` / `get_order` | Pedidos con filtros por estado y fecha |
| `list_customers` | Clientes |
| `list_coupons` / `create_coupon` | Cupones de descuento |
| `list_pages` / `get_page` / `update_page` | Páginas de contenido (Sobre Kay, FAQs…). Usan la API `2025-03` y requieren los permisos `read_content` / `write_content` |
| `fetch_site_file` | Lee archivos públicos del sitio y de los CDN de Tiendanube |
| `tiendanube_api` | Llamada directa a cualquier endpoint de la API (para lo que no tenga herramienta propia). Acepta `api_version` (ej. `2025-03`) |

Las imágenes en `public/` se sirven en `https://<tu-dominio-railway>/assets/...` para usarlas en las páginas de la tienda.

## Variables de entorno (Railway → servicio → Variables)

| Variable | Valor |
|---|---|
| `TN_CLIENT_ID` | `950583` |
| `TN_CLIENT_SECRET` | Client secret de la app (Portal de Socios de Tiendanube) |
| `MCP_SECRET` | Cadena aleatoria larga (mín. 24 caracteres). Generala con `openssl rand -hex 32` |
| `TN_USER_AGENT` | Nombre de la app y un email de contacto, ej. `KAY MCP (tu@email.com)`. Tiendanube lo exige |
| `TN_STORE_ID` | Se obtiene en el paso 3 |
| `TN_ACCESS_TOKEN` | Se obtiene en el paso 3 |
| `TN_API_VERSION` | Opcional, por defecto `v1` |

Nunca subas estos valores al repositorio.

## Puesta en marcha

1. **Railway**: en tu proyecto, *New → GitHub Repo* y elegí este repo. Railway detecta Node, corre `npm run build` y `npm start`. En *Settings → Networking* generá un dominio público.
2. **Tiendanube**: en el Portal de Socios, en la app 950583, configurá la *URL de redirección* como `https://<tu-dominio-railway>/oauth/callback` y revisá que tenga los permisos que vas a usar (productos, pedidos, clientes, cupones; lectura y escritura según corresponda).
3. **Instalar la app en KAY**: con la sesión de administrador de KAY abierta, entrá a `https://www.tiendanube.com/apps/950583/authorize`. Al aceptar, te devuelve a `/oauth/callback`, que muestra `TN_STORE_ID` y `TN_ACCESS_TOKEN`. Cargalos en Railway (se redeploya solo).
4. **Comprobar**: `https://<tu-dominio-railway>/health` debe decir `"storeConfigured": true`.
5. **Claude**: en *Configuración → Conectores → Agregar conector personalizado*, poné como URL:
   `https://<tu-dominio-railway>/mcp/<MCP_SECRET>`

La URL del conector incluye el secreto: tratala como una contraseña. Si se filtra, cambiá `MCP_SECRET` en Railway y actualizá el conector.

## Desarrollo local

```bash
npm install
npm run build
MCP_SECRET=... TN_STORE_ID=... TN_ACCESS_TOKEN=... TN_USER_AGENT="..." npm start
```
