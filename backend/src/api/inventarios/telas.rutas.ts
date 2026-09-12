/**
 * Rutas REST del INVENTARIO de TELAS por kardex (F4-E1; doc 04-Inventarios §B; D5). Handlers
 * DELGADOS (A1): validan (Zod compartido de `src/contrato`), autorizan (`conPermiso`, A4) y delegan
 * al dominio `dominio/inventarios/telas`. Las reglas (no-negativo, lote del ajuste, inverso de
 * cancelación, existencia por suma directa, ocultamiento de importes del ex-acceso #7) viven en el
 * dominio.
 *
 * 🔴 EL FLUJO POR LOTE YA NO ESCRIBE — fila 0.170 (9-sep-2026). Los tres endpoints que CAPTURABAN
 * por lote se RETIRARON: `POST /inventarios/telas/ajustes`, `POST /inventarios/telas/salidas-orden`
 * y `POST /inventarios/telas/traspasos`. Grababan renglones SIN `idTelaColor`, y la pantalla de
 * existencias que hoy se mira (`/inventarios/telas/existencias`, vista `existencia_tela_color`)
 * EXCLUYE esas filas: sacar tela por ahí descontaba existencia que nadie veía moverse. Sus dos
 * primeras pantallas ya se habían retirado (el ajuste el 13-ago-2026, el traspaso en la 0.098) pero
 * los endpoints seguían vivos y alcanzables con el `inventario-telas.mover` que tienen seis
 * perfiles; la tercera, «Salida a orden por lote (legado)», seguía capturando desde ⌘K. Lo que se
 * captura hoy va SIEMPRE por los `/color/*` de abajo. El dominio (`ajustarInventarioTela`,
 * `registrarSalidaTelaAOrden`, `traspasarTela`) NO se borró: sigue siendo el andamio con el que las
 * pruebas fabrican movimientos con la forma LEGADA para comprobar que el flujo por color los
 * tolera; sin ruta, ningún cliente lo alcanza.
 *
 * Endpoints (todos por la empresa activa = A9):
 *  • `POST /inventarios/telas/movimientos/:id/cancelar` (`inventario-telas.mover`) → inverso auditado.
 *  • `GET  /inventarios/telas/existencias`           (`inventario-telas.ver`)   → existencias LEGADAS (vista).
 *  • `GET  /inventarios/telas/kardex`                (`inventario-telas.ver`)   → kardex LEGADO por tela.
 *
 * Los tres que quedan son la ventana al HISTÓRICO MIGRADO de Access (lo único que ya vive con esa
 * forma): dos consultas y la cancelación por inverso que el kardex necesita para corregir (D3). Y
 * OJO — la cancelación NO es sólo del legado: acepta cualquier movimiento con renglones de tela, los
 * del flujo por color incluidos, por eso conserva sus guardas de la 0.099/0.104.
 *
 * INVENTARIO VIGENTE POR COLOR (etapa A2 — partidas + tela×color; es el ÚNICO que captura;
 * dominio `dominio/inventarios/partidas-telas`):
 *  • `POST /inventarios/telas/color/ajustes`         (`inventario-telas.mover`) → ajuste (entrada crea partidas).
 *  • `POST /inventarios/telas/color/conteos`         (`inventario-telas.mover`) → conteo físico (lo contado → diferencia).
 *  • `GET  /inventarios/telas/color/saldos`          (`inventario-telas.ver`)   → saldos (Σ directa) para el conteo.
 *  • `POST /inventarios/telas/color/salidas-orden`   (`inventario-telas.mover`) → salida a orden (sin partida).
 *  • `POST /inventarios/telas/color/salidas-orden/previa` (`inventario-telas.mover`) → SOLO LECTURA:
 *    los dos avisos de la captura en curso (sobre-salida contra lo que la orden pide + riesgo de
 *    tono con la lista de partidas). No registra nada y NUNCA bloquea (fila 0.101).
 *  • `POST /inventarios/telas/color/salidas-sin-orden` (`salida-material.registrar`) → ⭐ salida que
 *    NO va a ninguna orden (devolución al proveedor / venta de material / otra causa — fila 0.104).
 *    Permiso PROPIO y sólo del administrador: NO basta `inventario-telas.mover`.
 *  • `POST /inventarios/telas/color/traspasos`       (`inventario-telas.mover`) → traspaso (2 patas, ambas cantidades).
 *  • `POST /inventarios/telas/color/movimientos/:id/cancelar` (`inventario-telas.mover`) → inverso auditado.
 *  • `GET  /inventarios/telas/color/existencias`     (`inventario-telas.ver`)   → agrupadas tela → colores.
 *  • `PUT  /inventarios/telas/color/ubicacion`       (`inventario-telas.mover`) → ⭐ DÓNDE está
 *    guardado ese color en ese almacén (texto libre, fila 0.103). Vacío = borrar la ubicación.
 *  • `GET  /inventarios/telas/color/kardex`          (`inventario-telas.ver`)   → kardex por color (2 componentes).
 *  • `GET  /inventarios/telas/color/lotes`           (`inventario-telas.ver`)   → lotes CON SALDO del
 *    almacén de origen de un color, para escoger de cuál sale la tela del traspaso (fila 0.146).
 *  • `GET  /inventarios/telas/partidas`              (`inventario-telas.ver`)   → búsqueda de partidas.
 *  • `GET  /inventarios/telas/traspasos/:id/impreso` (`inventario-telas.ver`)   → hoja del traspaso (PDF).
 *
 * NINGÚN endpoint edita/borra existencias (D3). Los importes de telas se omiten server-side a quien
 * no tenga `telas.ver-totales` (ex-acceso #7) — la decisión es del dominio, no de la UI.
 */
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaMovimientoMaterialCancelarCuerpo,
  esquemaMovimientoTelaSalida,
  esquemaExistenciasTelaQuery,
  esquemaExistenciasTelaLista,
  esquemaKardexTelaQuery,
  esquemaKardexTelaLista,
  esquemaAjusteTelaColorCrear,
  esquemaLotesTelaColorQuery,
  esquemaLotesTelaColorSalida,
  esquemaSaldosTelaColorQuery,
  esquemaSaldosTelaColorSalida,
  esquemaConteoTelaColorCrear,
  esquemaConteoTelaColorSalida,
  esquemaSalidaTelaColorCrear,
  esquemaSalidaTelaColorSinOrdenCrear,
  esquemaTraspasoTelaColorCrear,
  esquemaMovimientoTelaColorSalida,
  esquemaTraspasoTelaColorSalida,
  esquemaExistenciasTelaColorQuery,
  esquemaExistenciasTelaColorLista,
  esquemaUbicacionTelaColorFijar,
  esquemaUbicacionMaterialSalida,
  esquemaKardexTelaColorQuery,
  esquemaKardexTelaColorLista,
  esquemaPartidasTelaQuery,
  esquemaPartidasTelaLista,
  esquemaPreviaSalidaTelaColorCrear,
  esquemaPreviaSalidaTelaColorSalida,
  esquemaParamIdMaterial,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import { impresoInventarioTelas } from '../../dominio/inventarios/impresos/impreso-inventario-telas.js';
import { impresoTraspasoTela } from '../../dominio/inventarios/impresos/impreso-traspaso-tela.js';
import {
  cancelarMovimientoTela,
  consultarExistenciasTela,
  kardexTela,
} from '../../dominio/inventarios/telas.js';
import {
  ajustarInventarioTelaColor,
  cancelarMovimientoTelaColor,
  consultarExistenciasTelaColor,
  kardexTelaColor,
  listarPartidasTela,
  registrarConteoTelaColor,
  registrarSalidaTelaColorAOrden,
  registrarSalidaTelaColorSinOrden,
  lotesTelaColorEnAlmacen,
  saldosTelaColorParaConteo,
  traspasarTelaColor,
} from '../../dominio/inventarios/partidas-telas.js';
import { previaSalidaTelaColorAOrden } from '../../dominio/inventarios/previa-salida-tela-orden.js';
import { fijarUbicacionTelaColor } from '../../dominio/inventarios/ubicaciones.js';

const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de inventario de telas (montadas bajo `/api`). */
export const rutasInventarioTelas: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Cancelar un movimiento (inverso auditado, D3) ────────────────────────────
  // ⚠️ NO es sólo del legado: acepta cualquier movimiento con renglones de tela — los del flujo por
  // COLOR también lo son — y es el botón «cancelar» del kardex por lote, que sigue vivo para el
  // histórico migrado. Por eso sobrevivió al retiro de las tres capturas por lote (fila 0.170).
  app.route({
    method: 'POST',
    url: '/inventarios/telas/movimientos/:id/cancelar',
    preHandler: app.conPermiso('inventario-telas.mover'),
    schema: {
      tags: ['inventario-telas'],
      summary: 'Cancelar un movimiento de tela (genera el inverso auditado; no edita ni borra)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdMaterial,
      body: esquemaMovimientoMaterialCancelarCuerpo,
      response: { 200: esquemaMovimientoTelaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cancelarMovimientoTela(sesion, request.params.id, request.body);
    },
  });

  // ── Existencias (consulta; vista existencia_tela) ────────────────────────────
  app.route({
    method: 'GET',
    url: '/inventarios/telas/existencias',
    preHandler: app.conPermiso('inventario-telas.ver'),
    schema: {
      tags: ['inventario-telas'],
      summary: 'Existencias de tela por tela×lote×almacén (consulta, con componentes del lote)',
      security: SEGURIDAD_SESION,
      querystring: esquemaExistenciasTelaQuery,
      response: { 200: esquemaExistenciasTelaLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return consultarExistenciasTela(sesion, request.query);
    },
  });

  // ── Kardex por tela (movimientos con saldo corrido) ──────────────────────────
  app.route({
    method: 'GET',
    url: '/inventarios/telas/kardex',
    preHandler: app.conPermiso('inventario-telas.ver'),
    schema: {
      tags: ['inventario-telas'],
      summary: 'Kardex de una tela (movimientos cronológicos con saldo corrido por lote)',
      security: SEGURIDAD_SESION,
      querystring: esquemaKardexTelaQuery,
      response: { 200: esquemaKardexTelaLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return kardexTela(sesion, request.query);
    },
  });

  // ═══ INVENTARIO NUEVO POR COLOR (etapa A2 — partidas + tela×color) ═══════════

  // ── Ajuste por color (conteo físico / arranque desde cero; entrada crea partidas) ──
  app.route({
    method: 'POST',
    url: '/inventarios/telas/color/ajustes',
    preHandler: app.conPermiso('inventario-telas.mover'),
    schema: {
      tags: ['inventario-telas'],
      summary:
        'Registrar un ajuste de tela por color (una entrada crea la partida por renglón; una salida valida ambos componentes)',
      security: SEGURIDAD_SESION,
      body: esquemaAjusteTelaColorCrear,
      response: { 201: esquemaMovimientoTelaColorSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const movimiento = await ajustarInventarioTelaColor(sesion, request.body);
      return reply.code(201).send(movimiento);
    },
  });

  // ── Saldos para el CONTEO (Σ de movimientos DIRECTA, NUNCA la vista) ────────
  // Es la columna «Sistema» de la pantalla de conteo, y la MISMA aritmética que el conteo usa al
  // aplicar la diferencia (el fragmento SQL vive una sola vez en `comun/kardex.ts`), para que no
  // puedan divergir. Recibe TODOS los colores de la pantalla en UNA llamada (`idTelaColor=11,21`):
  // pedirlos de uno en uno eran cientos de GET al cargar el inventario del arranque. SIN lock — es
  // una lectura; la garantía contra el saldo viejo vive en el recálculo bajo lock AL APLICAR.
  app.route({
    method: 'GET',
    url: '/inventarios/telas/color/saldos',
    preHandler: app.conPermiso('inventario-telas.ver'),
    schema: {
      tags: ['inventario-telas'],
      summary: 'Saldos del sistema de varios tela+color en un almacén (Σ de movimientos, D3)',
      security: SEGURIDAD_SESION,
      querystring: esquemaSaldosTelaColorQuery,
      response: { 200: esquemaSaldosTelaColorSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return saldosTelaColorParaConteo(sesion, request.query);
    },
  });

  // ── CONTEO físico por color: se captura LO CONTADO y el servidor aplica la diferencia ──
  // Fila 0.098 (Daniel): «capturar lo contado, con el saldo del sistema a la vista, y que el
  // sistema calcule y aplique la diferencia». La diferencia se materializa SIEMPRE como movimiento
  // de kardex (D3), nunca como escritura de la existencia.
  app.route({
    method: 'POST',
    url: '/inventarios/telas/color/conteos',
    preHandler: app.conPermiso('inventario-telas.mover'),
    schema: {
      tags: ['inventario-telas'],
      summary:
        'Registrar un conteo físico de tela por color (se captura lo contado; el sistema aplica la diferencia)',
      security: SEGURIDAD_SESION,
      body: esquemaConteoTelaColorCrear,
      response: { 201: esquemaConteoTelaColorSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const conteo = await registrarConteoTelaColor(sesion, request.body);
      return reply.code(201).send(conteo);
    },
  });

  // ── Salida por color a una orden de producción (sin partida — empareja por color) ──
  app.route({
    method: 'POST',
    url: '/inventarios/telas/color/salidas-orden',
    preHandler: app.conPermiso('inventario-telas.mover'),
    schema: {
      tags: ['inventario-telas'],
      summary:
        'Registrar una salida de tela por color ligada a una orden (cuerpo y complemento juntos; sin partida)',
      security: SEGURIDAD_SESION,
      body: esquemaSalidaTelaColorCrear,
      response: { 201: esquemaMovimientoTelaColorSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const movimiento = await registrarSalidaTelaColorAOrden(sesion, request.body);
      return reply.code(201).send(movimiento);
    },
  });

  // ── ⭐⭐ PREVIA de la salida por color: los DOS avisos, decididos por el dominio (fila 0.101) ──
  // Daniel §Post-F9.193 (dec. 8 y 9): avisar la sobre-salida contra lo que la orden pide, y sacar
  // el aviso de tono SÓLO cuando hay más de una partida del color —con la lista a la vista—. Va
  // por POST porque el cuerpo es la CAPTURA EN CURSO (N renglones), no un filtro de URL; es SOLO
  // LECTURA (no registra ningún movimiento) y su respuesta AVISA, nunca bloquea. Sirve a la ÚNICA
  // pantalla que saca tela a una orden: la vigente por color (`lineas`). Su cuerpo admite además
  // `lineasTela` (tela sin color, sólo el aviso de sobre-salida), que era de la pantalla LEGADA por
  // lote: retirada en la fila 0.170, ese campo **ya no lo manda ningún cliente**.
  app.route({
    method: 'POST',
    url: '/inventarios/telas/color/salidas-orden/previa',
    preHandler: app.conPermiso('inventario-telas.mover'),
    schema: {
      tags: ['inventario-telas'],
      summary:
        'Avisos de una salida de tela por color: sobre-salida contra lo que la orden pide y riesgo de tono',
      security: SEGURIDAD_SESION,
      body: esquemaPreviaSalidaTelaColorCrear,
      response: { 200: esquemaPreviaSalidaTelaColorSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return previaSalidaTelaColorAOrden(sesion, request.body);
    },
  });

  // ── ⭐ Salida por color que NO va a ninguna orden (fila 0.104) ───────────────
  // DANIEL (§Post-F9.193 resp. 12): *«sacar por ejemplo una devolución, o una venta… que no sea
  // mediante la descarga o aplicación a una OP. Esto autorizado siempre por mí»*. El gate es el
  // permiso PROPIO `salida-material.registrar` —no el `.mover` que lleva medio organigrama—, y la
  // guarda de verdad la vuelve a hacer el dominio (A1): esto sólo evita el viaje.
  app.route({
    method: 'POST',
    url: '/inventarios/telas/color/salidas-sin-orden',
    preHandler: app.conPermiso('salida-material.registrar'),
    schema: {
      tags: ['inventario-telas'],
      summary:
        'Registrar una salida de tela por color SIN orden (devolución al proveedor, venta u otra causa)',
      security: SEGURIDAD_SESION,
      body: esquemaSalidaTelaColorSinOrdenCrear,
      response: { 201: esquemaMovimientoTelaColorSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const movimiento = await registrarSalidaTelaColorSinOrden(sesion, request.body);
      return reply.code(201).send(movimiento);
    },
  });

  // ── ⭐⭐ LOS LOTES DEL ORIGEN, PARA ESCOGER UNO (fila 0.146) ─────────────────
  // Daniel §Post-F9.205·1: *«está bien que decida el sistema pero que haya posibilidad de
  // seleccionar otro si es que el cortador decide un lote específico»*. Es SOLO LECTURA: enseña qué
  // lotes hay HOY en el almacén de ORIGEN de un color y cuánto queda de cada uno (Σ de movimientos,
  // acotada a la existencia real — el MISMO tope con el que el traspaso mide lo elegido). Va con
  // `inventario-telas.ver` como las demás lecturas de tela; quien captura el traspaso lo tiene.
  app.route({
    method: 'GET',
    url: '/inventarios/telas/color/lotes',
    preHandler: app.conPermiso('inventario-telas.ver'),
    schema: {
      tags: ['inventario-telas'],
      summary: 'Lotes con saldo de un color en un almacén (para escoger de cuál sale la tela)',
      security: SEGURIDAD_SESION,
      querystring: esquemaLotesTelaColorQuery,
      response: { 200: esquemaLotesTelaColorSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return lotesTelaColorEnAlmacen(sesion, request.query);
    },
  });

  // ── Traspaso por color entre almacenes (dos patas, ambas cantidades) ─────────
  app.route({
    method: 'POST',
    url: '/inventarios/telas/color/traspasos',
    preHandler: app.conPermiso('inventario-telas.mover'),
    schema: {
      tags: ['inventario-telas'],
      summary: 'Traspasar tela por color entre almacenes (salida del origen + entrada al destino)',
      security: SEGURIDAD_SESION,
      body: esquemaTraspasoTelaColorCrear,
      response: { 201: esquemaTraspasoTelaColorSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const traspaso = await traspasarTelaColor(sesion, request.body);
      return reply.code(201).send(traspaso);
    },
  });

  // ── Cancelar un movimiento por color (inverso auditado, D3) ──────────────────
  app.route({
    method: 'POST',
    url: '/inventarios/telas/color/movimientos/:id/cancelar',
    preHandler: app.conPermiso('inventario-telas.mover'),
    schema: {
      tags: ['inventario-telas'],
      summary:
        'Cancelar un movimiento de tela por color (genera el inverso auditado; no edita ni borra)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdMaterial,
      body: esquemaMovimientoMaterialCancelarCuerpo,
      response: { 200: esquemaMovimientoTelaColorSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cancelarMovimientoTelaColor(sesion, request.params.id, request.body);
    },
  });

  // ── Existencias por color (vista existencia_tela_color, agrupadas tela → colores) ──
  app.route({
    method: 'GET',
    url: '/inventarios/telas/color/existencias',
    preHandler: app.conPermiso('inventario-telas.ver'),
    schema: {
      tags: ['inventario-telas'],
      summary:
        'Existencias de tela por color, agrupadas tela padre → colores (cuerpo y complemento)',
      security: SEGURIDAD_SESION,
      querystring: esquemaExistenciasTelaColorQuery,
      response: { 200: esquemaExistenciasTelaColorLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return consultarExistenciasTelaColor(sesion, request.query);
    },
  });

  // ── ⭐ Ubicación física del color dentro del almacén (fila 0.103) ────────────
  // NO es un movimiento (no toca el kardex, D3 intacto): es una NOTA editable de dónde está la
  // mercancía, por eso es PUT y por eso se puede borrar. Se lee pegada al renglón de existencias.
  app.route({
    method: 'PUT',
    url: '/inventarios/telas/color/ubicacion',
    preHandler: app.conPermiso('inventario-telas.mover'),
    schema: {
      tags: ['inventario-telas'],
      summary: 'Fija dónde está guardado un color de tela en un almacén (vacío = borra)',
      security: SEGURIDAD_SESION,
      body: esquemaUbicacionTelaColorFijar,
      response: { 200: esquemaUbicacionMaterialSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return fijarUbicacionTelaColor(sesion, request.body);
    },
  });

  // ── Kardex por color (saldo corrido de ambos componentes) ────────────────────
  app.route({
    method: 'GET',
    url: '/inventarios/telas/color/kardex',
    preHandler: app.conPermiso('inventario-telas.ver'),
    schema: {
      tags: ['inventario-telas'],
      summary:
        'Kardex de un color de tela (movimientos cronológicos con saldo corrido de cuerpo y complemento)',
      security: SEGURIDAD_SESION,
      querystring: esquemaKardexTelaColorQuery,
      response: { 200: esquemaKardexTelaColorLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return kardexTelaColor(sesion, request.query);
    },
  });

  // ── Búsqueda de partidas (folio / lote del proveedor / factura) ──────────────
  app.route({
    method: 'GET',
    url: '/inventarios/telas/partidas',
    preHandler: app.conPermiso('inventario-telas.ver'),
    schema: {
      tags: ['inventario-telas'],
      summary: 'Buscar partidas de tela por folio, lote del proveedor o factura',
      security: SEGURIDAD_SESION,
      querystring: esquemaPartidasTelaQuery,
      response: { 200: esquemaPartidasTelaLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarPartidasTela(sesion, request.query);
    },
  });

  // ── Impreso PDF 'Traspaso de tela entre almacenes' (V1-E3b, §Post-F9.38) ─────
  // La hoja que ACOMPAÑA la tela que sale a otro almacén (p. ej. al cortador). NO genera folio ni
  // documento nuevo: IMPRIME el traspaso que ya existe, por el id de CUALQUIERA de sus dos patas
  // (así se reimprime desde el historial del kardex). Un traspaso cancelado NO se imprime (400).
  // Respuesta BINARIA (application/pdf): no se declara `response` 200.
  app.route({
    method: 'GET',
    url: '/inventarios/telas/traspasos/:id/impreso',
    preHandler: app.conPermiso('inventario-telas.ver'),
    schema: {
      tags: ['inventario-telas'],
      summary: 'Hoja del traspaso de tela entre almacenes (PDF del folio que ya existe)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdMaterial,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer, folio } = await impresoTraspasoTela(sesion, request.params.id);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="traspaso-tela-${String(folio)}.pdf"`);
      return reply.send(buffer as unknown as never);
    },
  });

  // ── Impreso PDF 'Inventario de telas' (R9) ───────────────────────────────────
  // Respuesta BINARIA (application/pdf): no se declara `response` 200 (Fastify manda el Buffer).
  // Reusa el querystring de las existencias POR COLOR (mismos filtros que la pantalla de la que
  // cuelga su botón). Permiso `inventario-telas.ver`.
  //
  // ⚠️ Hasta v0.097 este endpoint recibía `esquemaExistenciasTelaQuery` (los filtros del inventario
  // LEGADO por lote) y su impreso leía esa consulta: la hoja salía prácticamente en blanco. Ver el
  // encabezado de `impreso-inventario-telas.ts`.
  app.route({
    method: 'GET',
    url: '/inventarios/telas/impreso',
    preHandler: app.conPermiso('inventario-telas.ver'),
    schema: {
      tags: ['inventario-telas'],
      summary: 'Imprimir el inventario de telas (PDF de existencias por tela × color × almacén)',
      security: SEGURIDAD_SESION,
      querystring: esquemaExistenciasTelaColorQuery,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const buffer = await impresoInventarioTelas(sesion, request.query);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', 'inline; filename="inventario-telas.pdf"');
      return reply.send(buffer as unknown as never);
    },
  });

  done();
};
