# ADR-0011 — Eventos de dominio con OUTBOX transaccional + pg-boss (F4-E3)

- **Estado:** Aceptado
- **Fecha:** 2026-06-20
- **Decisores:** Gabriel (dueño de la ejecución; firma el diseño antes de codificar). Etapa F4-E3
  (Recepción de compras) — `docs/hoja-de-ruta/F4-etapas.md`.

## Contexto

La **recepción de compras** (F4-E3) es el primer hecho de dominio que debe **notificar a otro
módulo**: cuando entra material contra una OC, el **MRP / Ruta Crítica (F5)** querrá reaccionar
("ya llegó la tela del pedido X → desbloquea el corte"). Hoy el repo solo tiene un emitter
**in-process best-effort post-commit** (`backend/src/comun/eventos.ts`, gancho de RC de F3): vive en
memoria del proceso. Si el proceso muere entre el commit del hecho y la entrega del evento, **el
evento se pierde** — inaceptable para disparar MRP/finanzas.

Restricciones del plan:

- **A2** — el hecho de negocio (recepción + lote + kardex) va en UNA transacción. El evento NO puede
  quedar fuera de esa atomicidad: si la recepción se confirma, el evento DEBE existir; si hace
  rollback, el evento NO debe existir.
- **NUNCA Docker local** (PLANMAESTRO §8): los tests no pueden depender de un broker vivo. Lo
  testeable es la **escritura del evento**, no el transporte.
- **Portabilidad** (§1): nada de infra nueva que ate a Railway. Si el broker vive en el **mismo
  Postgres**, `docker compose up` y Railway no necesitan servicios extra.
- El **consumidor** de negocio es de **F5** — F4-E3 solo PUBLICA y registra.

## Decisión

Se adopta el **patrón OUTBOX transaccional** con **pg-boss 12** como transporte, sobre el **mismo
Postgres** del sistema.

### 1. Tabla OUTBOX (`EventoOutbox`), escrita dentro de la transacción

El dominio inserta la fila del evento con `registrarEventoOutbox(tx, …)`
(`backend/src/comun/eventos-dominio.ts`) **dentro de la misma `tx`** que la recepción/lote/kardex.
Así la atomicidad de A2 cubre también el evento: o quedan el hecho **y** el evento, o ninguno. La
tabla:

```
EventoOutbox { id, tipo, version, idEmpresa, payload Json, publicadoEn?, intentos, error?, creadoEn }
```

- `tipo` = nombre del evento (`"material-recibido"`); `version` = versión del contrato del payload
  (evolución sin romper consumidores); `payload` = la carga JSON; `publicadoEn` NULL = pendiente;
  `intentos`/`error` = telemetría del relay.

### 2. Relay (`comun/cola-eventos.ts`) — publica a pg-boss y marca `publicadoEn`

Tras el commit, un **disparo best-effort** (`dispararPublicacion()`, fire-and-forget) publica las
filas pendientes a la cola pg-boss `eventos-dominio` y sella `publicadoEn`. Un **barrido periódico**
(`setInterval`, default 30 s, `unref`) reintenta las filas no publicadas: si el proceso murió entre
el commit y el publish, el barrido las recupera (durabilidad). pg-boss corre sobre `DATABASE_URL`
(el MISMO Postgres) → **cero infra nueva** (`docker-compose.yml` no cambia).

### 3. Guarda por entorno (`EVENTOS_COLA_ACTIVA`)

El worker pg-boss arranca SOLO si `EVENTOS_COLA_ACTIVA !== 'false'`. Se cablea en el **entry point**
(`servidor.ts`), no en `app.ts`, para que los tests (que construyen la app con `inject()`) y el CI
**no requieran un pg-boss vivo**. Con la cola inactiva, `publicarPendientes()` es no-op silencioso:
las filas quedan en el outbox (nadie las pierde). Lo crítico y testeable es la **escritura atómica
del outbox**, cubierto por tests de integración; el transporte se ejercita en Railway.

### 4. Contrato del evento `material-recibido` (v1)

Nombre: **`material-recibido`**. Versión: **1**. Payload (lo MÍNIMO para reaccionar; el consumidor
relee el detalle de la BD):

```jsonc
{
  "idEmpresa":     <int>,            // A9
  "idOrdenCompra": <int>,            // OC contra la que se recibió
  "idRecepcion":   <int>,            // recepción que generó el evento
  "folioRecepcion":<int>,
  "material": {                       // material representativo (1er renglón); siempre presente
    "tipo": "tela" | "avio" | "libre",
    "id":   <int|null>,              // id de tela/avío, o null en líneas libres
    "idLote": <int|null>,            // lote creado (telas D5), o null
    "idOrdenCompraLinea": <int>,     // R7
    "idOrden": <int|null>            // orden de PRODUCCIÓN ligada (R7), o null
  },
  "materiales": [ <material>, … ],   // TODOS los renglones de la recepción (no se pierde ninguno)
  "idAlmacen": <int>,                // destino
  "fecha": "YYYY-MM-DD"
}
```

El `material` singular es el **representativo** (primer renglón) para consumidores simples; el
arreglo `materiales` lleva **todos** los renglones para no perder ninguno cuando la recepción trae
varias telas/avíos. La interfaz tipada vive en `comun/eventos-dominio.ts` (`EventoMaterialRecibido`).

**No se incluye una cantidad en el payload (decisión M3):** sumar la cantidad recibida en un escalar
mezclaría unidades heterogéneas (metros de tela + piezas de avío) → engañoso y nadie lo usaría para
cálculo. El consumidor (F5) relee de la BD la cantidad/costo por renglón cuando los necesite. Si en
el futuro hiciera falta una cantidad, debe ir **por renglón dentro de `materiales[]`** (con su unidad),
nunca agregada — y eso sería una **nueva versión** del contrato (`version` 2).

## Alternativas consideradas

- **Emitter in-process (lo que había)** — se pierde si el proceso muere tras el commit. Sirve para
  ganchos best-effort (RC F3), no para disparar MRP/finanzas. Se conserva para su uso original.
- **Broker externo (Redis/RabbitMQ/SQS)** — infra nueva que ata a un proveedor y rompe la
  portabilidad y el "sin Docker local en tests". Descartado.
- **Publicar dentro de la transacción de negocio** (en vez de outbox) — acopla el commit al broker:
  si el broker está caído, la recepción no se puede confirmar. El outbox desacopla: el hecho se
  confirma siempre; el transporte es eventual y reintentable.

## Consecuencias

- **A favor:** durabilidad real (el evento sobrevive a caídas); atomicidad con A2; cero infra nueva
  (pg-boss sobre el Postgres existente); tests sin broker; contrato versionado.
- **En contra / a vigilar:** entrega **at-least-once** (el consumidor de F5 debe ser idempotente);
  la tabla outbox crece (conviene un purgado de `publicadoEn` viejos, backlog para F5); el orden de
  entrega no está garantizado entre eventos (cada consumidor relee de la BD lo que necesite).
- **Despliegue:** la migración `20260620140000_f4_e3_recepciones` crea `eventos_outbox`. pg-boss crea
  sus propias tablas (esquema `pgboss`) la primera vez que arranca en Railway. `EVENTOS_COLA_ACTIVA`
  se deja activo en prod (default) e inactivo en CI/tests.
