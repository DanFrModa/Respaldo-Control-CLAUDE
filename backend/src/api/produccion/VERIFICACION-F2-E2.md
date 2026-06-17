# Verificación F2-E2 — Órdenes de producción (para Gabriel)

Guía para probar el módulo **Órdenes** en `prueba` (Railway) vía **Swagger UI**
(`/api/docs`). Todos los endpoints exigen sesión iniciada (cookie de better-auth) y
los permisos del rol; con el usuario `admin` (rol Administrador) los tienes todos.

> Recordatorio de deploy: el backend de `prueba` necesita `SEED_ON_START=true` para
> sembrar los permisos nuevos (`ordenes.ver` / `ordenes.administrar` / `ordenes.cancelar`).
> Sin eso, el módulo no aparece en los menús/roles.

---

## 1. Sembrar los datos demo

Con `DATABASE_URL` apuntando a la base de `prueba` (o local), desde `backend/`:

```bash
npm run demo:ordenes
```

Es **idempotente** (se puede re-correr): re-crea los pedidos y órdenes demo cada vez.
Al terminar imprime los IDs sembrados. Valores de referencia (los IDs **reales** los
imprime el script; los nombres son fijos):

> ⚠️ **Trampa para F2-E5 (siembra de secuencias de folio).** Los pedidos demo usan folios
> **centinela** altos (`9000001` / `9000002`) insertados como literales — **no** avanzan la
> secuencia `"pedido"`. Pero cuando F2-E5 inicialice las secuencias por empresa con
> `MAX(folio)+1`, esos centinelas contaminarían el máximo y la numeración arrancaría en
> ~`9000003`. **Antes de sembrar las secuencias en F2-E5: eliminar de la base los pedidos demo
> (folios `9000001`/`9000002`)** — o que la siembra ignore esos folios centinela al calcular el máximo.

| Entidad                       | Cómo se identifica                | Para qué sirve                                   |
|-------------------------------|-----------------------------------|--------------------------------------------------|
| Empresa **FR Moda**           | favorita del seed                 | empresa de la sesión                             |
| Cliente **Cliente Demo F2**   | nombre                            | cliente de las órdenes demo                      |
| Campo D7 del cliente          | "No. de pedido del cliente (DEMO)"| referencia válida (mismo cliente)                |
| **Otro Cliente Demo F2** + su campo "Referencia ajena (DEMO)" | nombre | referencia **inválida** (otro cliente)        |
| Modelo **DEMO-501**           | código                            | modelo a producir                                |
| Colores **Rojo Demo / Azul Demo** | nombre                        | matriz                                           |
| Tallas **CH-DEMO / M-DEMO / G-DEMO** | etiqueta                   | matriz                                           |
| **Pedido demo VIVO**          | folio `9000001`                   | su renglón = origen para CREAR órdenes (OK)      |
| **Pedido demo CANCELADO**     | folio `9000002`                   | su renglón = crear orden debe **FALLAR**         |

Órdenes que deja sembradas:

- **DEMO-A** (con matriz capturada): Rojo[CH:120, M:240] + Azul[G:60] → **total esperado = 420 piezas**.
- **DEMO-B** (con referencia D7): valor `MONARCH-DEMO-2026`.
- **DEMO-C** (cancelada): motivo "Demo de cancelación".

> Anota del output de la consola estos IDs (varían según la base): `idPedidoLinea`
> (renglón del pedido VIVO), `idPedidoLineaCancelado`, `idClienteCampo` (campo del
> Cliente Demo) y `idOtroClienteCampo` (campo del Otro Cliente). Los cuerpos JSON de
> abajo usan placeholders `<...>` que reemplazas con esos valores.

---

## 2. Casos en Swagger UI

### 2.1 Crear una orden OK (`POST /api/ordenes`)

Debe responder **201** con la orden recién creada (estado `capturada`, modelo/cliente
autorrellenados del pedido).

```json
{
  "idPedidoLinea": <idPedidoLinea del pedido VIVO>
}
```

Variante con matriz en el alta (nace `completa`, total 35):

```json
{
  "idPedidoLinea": <idPedidoLinea del pedido VIVO>,
  "lineas": [
    { "idColor": <idColorRojo>, "tallas": [ { "idTalla": <idTallaCH>, "cantidad": 30 } ] },
    { "idColor": <idColorAzul>, "tallas": [ { "idTalla": <idTallaG>, "cantidad": 5 } ] }
  ]
}
```

### 2.2 Crear orden desde un pedido CANCELADO → debe FALLAR (`POST /api/ordenes`)

Debe responder **409** (`CONFLICTO`): "El pedido 9000002 está cancelado; no se le
pueden crear órdenes."

```json
{
  "idPedidoLinea": <idPedidoLineaCancelado del pedido CANCELADO>
}
```

### 2.3 Crear orden SIN pedido → debe FALLAR (`POST /api/ordenes`)

Debe responder **400** (`VALIDACION`): el `idPedidoLinea` es obligatorio (orden sin
pedido = solo histórico; nunca captura nueva).

```json
{}
```

### 2.4 Guardar matriz (`PUT /api/ordenes/{id}/matriz`)

Sobre una orden demo (o la que creaste). Debe responder **200**; la respuesta trae
`totalPiezas` y, por color, `totalPiezas` derivado por suma. Este ejemplo da total **420**:

```json
{
  "lineas": [
    {
      "idColor": <idColorRojo>,
      "tallas": [
        { "idTalla": <idTallaCH>, "cantidad": 120 },
        { "idTalla": <idTallaM>, "cantidad": 240 }
      ]
    },
    { "idColor": <idColorAzul>, "tallas": [ { "idTalla": <idTallaG>, "cantidad": 60 } ] }
  ]
}
```

Verificaciones adicionales de la matriz (deben **FALLAR**):
- **Color repetido** (mismo `idColor` dos veces en `lineas`) → 400 `VALIDACION`.
- **Talla fuera de catálogo** (`idTalla` inexistente, p. ej. `999999`) → 404 `NO_ENCONTRADO`.
- **Cantidad negativa** → 400 `VALIDACION`.

### 2.5 Referencia D7 con ClienteCampo de OTRO cliente → debe FALLAR (`PUT /api/ordenes/{id}/referencias`)

Sobre una orden del **Cliente Demo F2**, mandar un campo del **Otro Cliente Demo**.
Debe responder **400** (`VALIDACION`): "El campo de referencia ... no pertenece al
cliente de esta orden."

```json
{
  "referencias": [ { "idClienteCampo": <idOtroClienteCampo>, "valor": "X" } ]
}
```

Variante VÁLIDA (mismo cliente) → 200:

```json
{
  "referencias": [ { "idClienteCampo": <idClienteCampo del Cliente Demo>, "valor": "PO-12345" } ]
}
```

### 2.6 Buscar por la referencia demo (`GET /api/ordenes`)

Querystring (campo `busqueda` en Swagger): debe devolver la orden **DEMO-B**.

```
busqueda = MONARCH-DEMO-2026
```

La misma búsqueda combinada también encuentra por **folio**, por **código de modelo**
(`DEMO-501`) y por **nombre de cliente** (`Cliente Demo F2`).

### 2.7 Cancelar (`POST /api/ordenes/{id}/cancelar`) — motivo obligatorio

Con `ordenes.cancelar`. Sin `motivo` (o vacío) → 400. Con motivo → 200, `estado` pasa a
`cancelada`. Cancelar dos veces → 409.

```json
{ "motivo": "Cliente desistió" }
```

---

## 3. Notas

- El **estado** de la orden (`capturada` → `completa` → `cancelada`) NO se captura: lo
  derivan los servicios (`completa` se sella en el primer guardado de matriz con líneas,
  paridad con el `FechaDet` del sistema viejo).
- El listado por defecto **NO** trae canceladas; usa `incluirCanceladas=true` para verlas.
- **No hay rutas de UPC** (los códigos de barra de orden ya no se usan; `upc` es solo un
  dato histórico de lectura).
