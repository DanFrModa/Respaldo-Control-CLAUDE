/**
 * Inventario de AVÍOS operable por kardex (F4-E1; doc 04-Inventarios §B; R4). Toda la lógica vive
 * AQUÍ (A1); las rutas REST solo validan permiso + Zod y delegan. ORQUESTA el motor de kardex
 * (`comun/kardex.ts`) — el ÚNICO que escribe `Movimiento`/`MovimientoDetAvio`— y le pone las
 * VALIDACIONES de negocio: no dejar existencia negativa en salidas/traspasos y elegir el tipo
 * inverso de la cancelación.
 *
 * Innegociables: A1 (lógica aquí), A2 (transacción del motor; validación dentro de ella), A3/A7
 * (folio + bitácora del motor), A4 (`inventario-avios.ver`/`.mover`), A9 (empresa activa), D3
 * (existencia = Σ de movimientos; corrección = inverso auditado; validación por suma directa bajo
 * lock, NUNCA la vista `existencia_avio`).
 *
 * R4 — inventario de avíos MULTI-ALMACÉN: la existencia es por avío × almacén (el lote del avío es
 * opcional y NO entra en la dimensión de existencia). `esGenerico` se copia de `Avio.esGenerico` a
 * cada renglón de kardex (consultas sin join). Sin mínimos/máximos ni reorden (no se compra para
 * stock, salvo genéricos). `costoUnit` se acepta (la entrada-recepción de E3 valúa); en ajustes va
 * NULL (D1).
 */
import {
  esquemaAjusteAvioCrear,
  esquemaSalidaAvioSinOrdenCrear,
  esquemaTraspasoAvioCrear,
  esquemaMovimientoMaterialCancelarCuerpo,
  type DatosAjusteAvioLinea,
  type MovimientoAvioSalida,
  type TraspasoAvioSalida,
  type ExistenciasAvioLista,
  type ExistenciaAvioFila,
  type KardexAvioLista,
  type KardexAvioRenglon,
} from '../../contrato/index.js';
import { DireccionMovimiento, Prisma } from '../../datos/index.js';
import { z } from 'zod';

import { exigirAlmacenDelTipo } from '../../comun/almacenes.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import {
  bloquearAvio,
  cancelarMovimientoMaterial,
  existenciaAvioBloqueada,
  registrarMovimientoAvio as registrarMovimientoAvioMotor,
  registrarTraspasoAvio as registrarTraspasoAvioMotor,
  type LineaMovimientoAvio,
} from '../../comun/kardex.js';
import { ORIGEN } from '../../comun/origenes.js';
import { verificarPermiso, tienePermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import {
  camposPeriodoKardex,
  diaDelPeriodo,
  periodoAlDerecho,
  recortarPorLaCola,
  resolverVentanaKardex,
} from './periodo-kardex.js';
import { exigirCancelableFueraDelCiclico } from './cancelacion-comun.js';
import {
  CODIGO_TIPO_MOV_POR_CONCEPTO,
  exigirPermisoParaCancelarSalidaSinOrden,
  exigirPermisoSalidaSinOrden,
} from './salida-sin-orden.js';
import { rechazarTipoReservado } from './tipos-reservados.js';

// ── Códigos estables de tipos de movimiento ──────────────────────────────────────────────────────

const COD_AJUSTE_SALIDA = 'ajuste-salida';
const COD_AJUSTE_ENTRADA = 'ajuste-entrada';
const COD_TRANSFERENCIA_SALIDA = 'transferencia-salida';
const COD_TRANSFERENCIA_ENTRADA = 'transferencia-entrada';

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────

function aDateColumna(valor: string): Date {
  return new Date(`${valor}T00:00:00.000Z`);
}

function aNumero(valor: Prisma.Decimal | null): number | null {
  return valor === null ? null : Number(valor);
}

async function tipoPorCodigo(
  tx: Tx,
  codigo: string,
): Promise<{ id: number; nombre: string; direccion: DireccionMovimiento }> {
  const tipo = await tx.tipoMovimientoInventario.findUnique({
    where: { codigo },
    select: { id: true, nombre: true, direccion: true, activo: true },
  });
  if (tipo === null) {
    throw new ErrorValidacion(
      `Falta el tipo de movimiento "${codigo}" en el catálogo (re-sembrar). No se puede continuar.`,
    );
  }
  if (!tipo.activo) {
    throw new ErrorValidacion(`El tipo de movimiento "${tipo.nombre}" está desactivado.`);
  }
  return { id: tipo.id, nombre: tipo.nombre, direccion: tipo.direccion };
}

async function tipoPorId(
  tx: Tx,
  idTipoMov: number,
): Promise<{ id: number; nombre: string; direccion: DireccionMovimiento }> {
  const tipo = await tx.tipoMovimientoInventario.findUnique({
    where: { id: idTipoMov },
    select: { id: true, nombre: true, direccion: true, activo: true },
  });
  if (tipo === null) {
    throw new ErrorNoEncontrado('TipoMovimientoInventario', idTipoMov);
  }
  if (!tipo.activo) {
    throw new ErrorValidacion(`El tipo de movimiento "${tipo.nombre}" está desactivado.`);
  }
  return { id: tipo.id, nombre: tipo.nombre, direccion: tipo.direccion };
}

/** Valida que no se repita el mismo avío en una captura de renglones. */
function validarRenglonesAvioUnicos(renglones: DatosAjusteAvioLinea[]): void {
  const ids = renglones.map((l) => l.idAvio);
  if (new Set(ids).size !== ids.length) {
    throw new ErrorValidacion('No repitas el mismo avío en dos renglones de la captura.');
  }
}

/**
 * Carga `esGenerico` de cada avío de la captura (R4: se copia al detalle de kardex) y valida que
 * todos existan. Devuelve un mapa idAvio → esGenerico.
 */
async function cargarGenericos(tx: Tx, idsAvio: number[]): Promise<Map<number, boolean>> {
  const avios = await tx.avio.findMany({
    where: { id: { in: idsAvio } },
    select: { id: true, esGenerico: true },
  });
  const mapa = new Map(avios.map((a) => [a.id, a.esGenerico]));
  for (const id of idsAvio) {
    if (!mapa.has(id)) {
      throw new ErrorNoEncontrado('Avio', id);
    }
  }
  return mapa;
}

/**
 * Valida, bajo bloqueo, que SACAR `lineas` (avío) del almacén no deje la existencia negativa (D3).
 * Suma directa de `MovimientoDetAvio`, NUNCA la vista (ADR-0010 §3). Locks en orden DETERMINISTA
 * (por avío) para evitar deadlocks. La existencia de avíos es por avío×almacén (R4 — el lote no
 * cuenta).
 */
async function validarNoNegativoAvio(
  tx: Tx,
  idEmpresa: number,
  idAlmacen: number,
  lineas: { idAvio: number; cantidad: number }[],
): Promise<void> {
  const ordenadas = [...lineas].sort((a, b) => a.idAvio - b.idAvio);
  for (const l of ordenadas) {
    await bloquearAvio(tx, idEmpresa, idAlmacen, l.idAvio);
    const existencia = await existenciaAvioBloqueada(tx, idEmpresa, idAlmacen, l.idAvio);
    if (existencia - l.cantidad < 0) {
      throw new ErrorConflicto(
        `No hay existencia suficiente de avío: se intenta sacar ${l.cantidad} de un avío con ` +
          `${existencia} en existencia (no se permite dejar el inventario en negativo).`,
      );
    }
  }
}

// ── Proyección a la salida ─────────────────────────────────────────────────────────────────────

const incluirMovimientoAvio = {
  tipoMov: { select: { nombre: true, direccion: true } },
  almacen: { select: { nombre: true } },
  anuladoPor: { select: { id: true } },
  detallesAvio: {
    orderBy: [{ idAvio: 'asc' }],
    include: { avio: { select: { clave: true, descripcion: true } } },
  },
} satisfies Prisma.MovimientoInclude;

type MovimientoAvioConDetalle = Prisma.MovimientoGetPayload<{
  include: typeof incluirMovimientoAvio;
}>;

function aMovimientoAvioSalida(
  m: MovimientoAvioConDetalle,
  verImportes: boolean,
): MovimientoAvioSalida {
  let totalCantidad = 0;
  let totalImporte = 0;
  let hayImporte = false;
  const renglones = m.detallesAvio.map((d) => {
    const cantidad = Number(d.cantidad);
    totalCantidad += cantidad;
    const costoUnit = verImportes ? aNumero(d.costoUnit) : null;
    const importe = costoUnit === null ? null : costoUnit * cantidad;
    if (importe !== null) {
      totalImporte += importe;
      hayImporte = true;
    }
    return {
      idAvio: d.idAvio,
      avio: d.avio.clave,
      descripcion: d.avio.descripcion,
      esGenerico: d.esGenerico,
      idLote: d.idLote,
      cantidad,
      costoUnit,
      importe,
    };
  });

  return {
    id: m.id,
    folio: Number(m.folio),
    idEmpresa: m.idEmpresa,
    idTipoMov: m.idTipoMov,
    tipoMov: m.tipoMov.nombre,
    direccion: m.tipoMov.direccion,
    idAlmacen: m.idAlmacen,
    almacen: m.almacen.nombre,
    fecha: m.fecha.toISOString().slice(0, 10),
    origenTipo: m.origenTipo,
    origenId: m.origenId,
    observaciones: m.observaciones,
    cancelado: m.anuladoPor.length > 0,
    idMovimientoInverso: m.idMovimientoInverso,
    renglones,
    totalCantidad,
    totalImporte: verImportes && hayImporte ? totalImporte : null,
    creadoEn: m.creadoEn.toISOString(),
    creadoPorId: m.creadoPorId,
  };
}

async function obtenerMovimientoAvio(
  idMovimiento: number,
  idEmpresa: number,
  verImportes: boolean,
  bd?: ContextoBd,
): Promise<MovimientoAvioSalida> {
  const m = await clienteLectura(bd).movimiento.findFirst({
    where: { id: idMovimiento, idEmpresa },
    include: incluirMovimientoAvio,
  });
  if (m === null || m.detallesAvio.length === 0) {
    throw new ErrorNoEncontrado('Movimiento de avío', idMovimiento);
  }
  return aMovimientoAvioSalida(m, verImportes);
}

// ── Operaciones de ESCRITURA ───────────────────────────────────────────────────────────────────

export type EntradaAjusteAvio = z.input<typeof esquemaAjusteAvioCrear>;
export type EntradaTraspasoAvio = z.input<typeof esquemaTraspasoAvioCrear>;
/** Datos de una salida de avío que NO va a ninguna orden (fila 0.104). */
export type EntradaSalidaAvioSinOrden = z.input<typeof esquemaSalidaAvioSinOrdenCrear>;

/**
 * Registra un AJUSTE de inventario de AVÍO (conteo físico inicial / corrección — R4). El tipo de
 * movimiento define la dirección. Si es salida, valida no-negativo bajo lock (D3). Motivo
 * OBLIGATORIO (A7). Permiso `inventario-avios.mover`. RECHAZA `traspaso` (va por el traspaso). El
 * avío NO se compra para stock (R4): el ajuste de entrada es el conteo físico inicial de los pocos
 * genéricos / la corrección puntual.
 */
export async function ajustarInventarioAvio(
  sesion: SesionUsuario,
  entrada: EntradaAjusteAvio,
  bd?: ContextoBd,
): Promise<MovimientoAvioSalida> {
  verificarPermiso(sesion, 'inventario-avios.mover');
  const datos = validarEntrada(esquemaAjusteAvioCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;
  const verImportes = tienePermiso(sesion, 'telas.ver-totales');
  validarRenglonesAvioUnicos(datos.lineas);

  const idMovimiento = await enTransaccion(async (tx) => {
    // Fila 0.137 — el almacén del ajuste tiene que ser de AVIO (además de existir, estar activo y
    // ser de esta empresa, A9). Antes no se miraba nada de eso aquí.
    await exigirAlmacenDelTipo(tx, datos.idAlmacen, 'AVIO', idEmpresa);
    // Fila 0.104 + 0.171 — ver `tipos-reservados.ts`: ni los rótulos que se reserva la dirección
    // ni los que sólo escribe el sistema (recibo, entrega, cancelación) se capturan por aquí.
    await rechazarTipoReservado(tx, datos.idTipoMov);
    const tipo = await tipoPorId(tx, datos.idTipoMov);
    if (tipo.direccion === DireccionMovimiento.traspaso) {
      throw new ErrorValidacion(
        'Un tipo de movimiento de dirección "traspaso" no es un ajuste: usa el traspaso entre almacenes.',
      );
    }
    const genericos = await cargarGenericos(
      tx,
      datos.lineas.map((l) => l.idAvio),
    );
    if (tipo.direccion === DireccionMovimiento.salida) {
      await validarNoNegativoAvio(
        tx,
        idEmpresa,
        datos.idAlmacen,
        datos.lineas.map((l) => ({ idAvio: l.idAvio, cantidad: l.cantidad })),
      );
    }
    const lineas: LineaMovimientoAvio[] = datos.lineas.map((l) => ({
      idAvio: l.idAvio,
      ...(l.idLote === undefined ? {} : { idLote: l.idLote }),
      esGenerico: genericos.get(l.idAvio) ?? false,
      cantidad: l.cantidad,
    }));
    const movimiento = await registrarMovimientoAvioMotor(
      sesion,
      {
        idEmpresa,
        idTipoMov: datos.idTipoMov,
        idAlmacen: datos.idAlmacen,
        fecha: aDateColumna(datos.fecha),
        origenTipo: ORIGEN.movimientoManual,
        lineas,
        observaciones: datos.motivo,
      },
      { tx },
    );
    return movimiento.id;
  }, bd);

  return obtenerMovimientoAvio(idMovimiento, idEmpresa, verImportes, bd);
}

/**
 * ⭐ Registra una SALIDA de AVÍO que **no va a ninguna orden** (fila 0.104). Es el caso que Daniel
 * nombró con nombre y apellido (§Post-F9.193 resp. 12): *«una venta de avíos que ya no se usen»*,
 * y su hermano, la devolución al proveedor. **Sólo ajusta inventario**: no toca compras, CxP ni
 * facturación — *«por ahora que toque sólo inventarios»*.
 *
 * Salida de kardex normal y corriente (D3), así que reusa lo de esta casa: el mismo
 * `validarNoNegativoAvio` (advisory lock + suma directa de `MovimientoDetAvio`, nunca la vista) y
 * el mismo motor `registrarMovimientoAvio`. Lo propio de la fila son las tres decisiones que viven
 * en `salida-sin-orden.ts`: la llave del dueño (`salida-material.registrar`, exigida ANTES que
 * nada), el `concepto` que elige un tipo de movimiento DEDICADO para que el kardex distinga
 * devolución de venta, y la traza `origenTipo = salida-sin-orden` (sin `origenId`: no hay entidad
 * detrás) que después obliga a tener esa misma llave para cancelarla. Motivo OBLIGATORIO (A7).
 */
export async function registrarSalidaAvioSinOrden(
  sesion: SesionUsuario,
  entrada: EntradaSalidaAvioSinOrden,
  bd?: ContextoBd,
): Promise<MovimientoAvioSalida> {
  exigirPermisoSalidaSinOrden(sesion);
  const datos = validarEntrada(esquemaSalidaAvioSinOrdenCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;
  const verImportes = tienePermiso(sesion, 'telas.ver-totales');
  validarRenglonesAvioUnicos(datos.lineas);

  const idMovimiento = await enTransaccion(async (tx) => {
    // El avío sale de un almacén de AVIO, y de uno usable por ESTA empresa (A9 — fila 0.137).
    await exigirAlmacenDelTipo(tx, datos.idAlmacen, 'AVIO', idEmpresa);
    const tipo = await tipoPorCodigo(tx, CODIGO_TIPO_MOV_POR_CONCEPTO[datos.concepto]);
    const genericos = await cargarGenericos(
      tx,
      datos.lineas.map((l) => l.idAvio),
    );
    await validarNoNegativoAvio(
      tx,
      idEmpresa,
      datos.idAlmacen,
      datos.lineas.map((l) => ({ idAvio: l.idAvio, cantidad: l.cantidad })),
    );

    const lineas: LineaMovimientoAvio[] = datos.lineas.map((l) => ({
      idAvio: l.idAvio,
      ...(l.idLote === undefined ? {} : { idLote: l.idLote }),
      esGenerico: genericos.get(l.idAvio) ?? false,
      cantidad: l.cantidad,
    }));
    const movimiento = await registrarMovimientoAvioMotor(
      sesion,
      {
        idEmpresa,
        idTipoMov: tipo.id,
        idAlmacen: datos.idAlmacen,
        fecha: aDateColumna(datos.fecha),
        origenTipo: ORIGEN.salidaSinOrden,
        lineas,
        observaciones: datos.motivo,
      },
      { tx },
    );
    return movimiento.id;
  }, bd);

  return obtenerMovimientoAvio(idMovimiento, idEmpresa, verImportes, bd);
}

/**
 * Registra un TRASPASO de AVÍO entre dos almacenes de la empresa activa (R4 — multi-almacén). Dos
 * patas (salida del origen + entrada al destino) en UNA transacción (A2); valida que el ORIGEN
 * tenga existencia suficiente (D3, bajo lock). Origen y destino DISTINTOS. Permiso
 * `inventario-avios.mover`.
 *
 * ⭐ Fila 0.172 — MOTIVO obligatorio (3–500), como en {@link ajustarInventarioAvio}: se guarda en
 * las `observaciones` de las DOS patas. Antes eran unas observaciones opcionales.
 */
export async function traspasarAvio(
  sesion: SesionUsuario,
  entrada: EntradaTraspasoAvio,
  bd?: ContextoBd,
): Promise<TraspasoAvioSalida> {
  verificarPermiso(sesion, 'inventario-avios.mover');
  const datos = validarEntrada(esquemaTraspasoAvioCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;
  const verImportes = tienePermiso(sesion, 'telas.ver-totales');

  if (datos.idAlmacenOrigen === datos.idAlmacenDestino) {
    throw new ErrorValidacion(
      'El traspaso necesita un almacén de origen y otro de destino distintos.',
    );
  }
  validarRenglonesAvioUnicos(datos.lineas);

  const { idSalida, idEntrada } = await enTransaccion(async (tx) => {
    const tipoSalida = await tipoPorCodigo(tx, COD_TRANSFERENCIA_SALIDA);
    const tipoEntrada = await tipoPorCodigo(tx, COD_TRANSFERENCIA_ENTRADA);
    // Fila 0.137 — LOS DOS extremos del traspaso deben ser de AVIO.
    await exigirAlmacenDelTipo(tx, datos.idAlmacenOrigen, 'AVIO', idEmpresa);
    await exigirAlmacenDelTipo(tx, datos.idAlmacenDestino, 'AVIO', idEmpresa);
    const genericos = await cargarGenericos(
      tx,
      datos.lineas.map((l) => l.idAvio),
    );

    await validarNoNegativoAvio(
      tx,
      idEmpresa,
      datos.idAlmacenOrigen,
      datos.lineas.map((l) => ({ idAvio: l.idAvio, cantidad: l.cantidad })),
    );

    const lineas: LineaMovimientoAvio[] = datos.lineas.map((l) => ({
      idAvio: l.idAvio,
      ...(l.idLote === undefined ? {} : { idLote: l.idLote }),
      esGenerico: genericos.get(l.idAvio) ?? false,
      cantidad: l.cantidad,
    }));
    const { salida, entrada: entradaMov } = await registrarTraspasoAvioMotor(
      sesion,
      {
        idEmpresa,
        idTipoMovSalida: tipoSalida.id,
        idTipoMovEntrada: tipoEntrada.id,
        idAlmacenOrigen: datos.idAlmacenOrigen,
        idAlmacenDestino: datos.idAlmacenDestino,
        fecha: aDateColumna(datos.fecha),
        lineas,
        // Fila 0.172 — MOTIVO obligatorio, guardado en `observaciones` de LAS DOS PATAS (el motor
        // pasa el mismo encabezado a las dos). Mismo camino que `ajustarInventarioAvio`, que ya
        // escribía `observaciones: datos.motivo`: no hay columna nueva.
        observaciones: datos.motivo,
      },
      { tx },
    );
    return { idSalida: salida.id, idEntrada: entradaMov.id };
  }, bd);

  return {
    salida: await obtenerMovimientoAvio(idSalida, idEmpresa, verImportes, bd),
    entrada: await obtenerMovimientoAvio(idEntrada, idEmpresa, verImportes, bd),
  };
}

/**
 * CANCELA un movimiento de AVÍO generando su INVERSO auditado (D3/A7): `entrada` → `ajuste-salida`;
 * `salida` → `ajuste-entrada`. El inverso no valida no-negativo (debe poder registrarse siempre).
 * Permiso `inventario-avios.mover`. Solo movimientos de la empresa activa (A9). No se re-cancela.
 *
 * ⭐ **Y una llave EXTRA para las salidas sin orden (fila 0.104):** si el movimiento nació de una
 * salida que no iba a ninguna orden (`origenTipo = salida-sin-orden`), cancelarlo devuelve el avío
 * al inventario — o sea, deshace la decisión que Daniel se reservó. Para ésas se exige ADEMÁS
 * `salida-material.registrar` (ver `salida-sin-orden.ts`). Para todo lo demás, no cambia nada.
 */
export async function cancelarMovimientoAvio(
  sesion: SesionUsuario,
  idMovimiento: number,
  cuerpo: z.input<typeof esquemaMovimientoMaterialCancelarCuerpo>,
  bd?: ContextoBd,
): Promise<MovimientoAvioSalida> {
  verificarPermiso(sesion, 'inventario-avios.mover');
  const datos = validarEntrada(esquemaMovimientoMaterialCancelarCuerpo, cuerpo);
  const idEmpresa = sesion.idEmpresaActiva;
  const verImportes = tienePermiso(sesion, 'telas.ver-totales');

  await enTransaccion(async (tx) => {
    const original = await tx.movimiento.findFirst({
      where: { id: idMovimiento, idEmpresa },
      select: {
        id: true,
        origenTipo: true,
        tipoMov: { select: { direccion: true } },
        idMovimientoInverso: true,
        detallesAvio: { select: { id: true } },
      },
    });
    if (original === null || original.detallesAvio.length === 0) {
      throw new ErrorNoEncontrado('Movimiento de avío', idMovimiento);
    }
    // Fila 0.104: la marcha atrás de una salida sin orden —y la de esa marcha atrás— piden la
    // MISMA llave que la salida.
    // Fila 0.099 — el ajuste de un cíclico NO se deshace desde Inventarios (la hoja quedaría
    // `cerrado` mientras el kardex dice otra cosa). Misma puerta de atrás que cerró la 0.104.
    exigirCancelableFueraDelCiclico(original.origenTipo);
    await exigirPermisoParaCancelarSalidaSinOrden(tx, sesion, original);
    const codigoInverso =
      original.tipoMov.direccion === DireccionMovimiento.entrada
        ? COD_AJUSTE_SALIDA
        : COD_AJUSTE_ENTRADA;
    const tipoInverso = await tipoPorCodigo(tx, codigoInverso);
    // Fila 0.180: el motor recibe el MOTIVO (lo escribe en las `observaciones` del inverso y en
    // su renglón `CANCELAR`). El renglón `OTRO` que había aquí se retiró: decía exactamente lo
    // mismo que el del motor —misma entidad, mismo id, `dimension: 'avio'` incluido—, y sólo
    // existía porque el motivo no tenía dónde vivir.
    await cancelarMovimientoMaterial(sesion, idMovimiento, tipoInverso.id, datos.motivo, { tx });
  }, bd);

  return obtenerMovimientoAvio(idMovimiento, idEmpresa, verImportes, bd);
}

// ── Consultas de SOLO LECTURA ──────────────────────────────────────────────────────────────────

const esquemaConsultaExistenciasAvio = z.object({
  idAvio: z.number().int().positive().optional(),
  idAlmacen: z.number().int().positive().optional(),
  soloGenericos: z.boolean().default(false),
  incluirCeros: z.boolean().default(false),
});

/**
 * Filtros del kardex de avío + el PERIODO (fila 0.173, mecanismo de la 0.138). **Se EXPORTA** para
 * que `contrato/esquemas/tope-kardex-honesto.test.ts` cruce el tope contra el que publica el
 * querystring: es el objeto que de verdad valida, no uno «equivalente».
 */
export const esquemaConsultaKardexAvio = z
  .object({
    idAvio: z.number().int().positive(),
    idAlmacen: z.number().int().positive().optional(),
    ...camposPeriodoKardex,
  })
  .refine(periodoAlDerecho.predicado, periodoAlDerecho.opciones);

export type ParametrosExistenciasAvio = z.input<typeof esquemaConsultaExistenciasAvio>;

/**
 * Consulta las EXISTENCIAS de AVÍO por avío×almacén, leyendo la vista `existencia_avio` (CONSULTA,
 * ADR-0010 §3) filtrada por la empresa activa (A9). JOIN para nombres del avío + bandera
 * `esGenerico` (R4: para distinguir en la UI). Por defecto OMITE las filas con existencia 0.
 * Permiso `inventario-avios.ver`.
 */
export async function consultarExistenciasAvio(
  sesion: SesionUsuario,
  parametros: ParametrosExistenciasAvio = {},
  bd?: ContextoBd,
): Promise<ExistenciasAvioLista> {
  verificarPermiso(sesion, 'inventario-avios.ver');
  const filtros = validarEntrada(esquemaConsultaExistenciasAvio, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;

  const condiciones: Prisma.Sql[] = [Prisma.sql`e."id_empresa" = ${idEmpresa}`];
  if (filtros.idAvio !== undefined) condiciones.push(Prisma.sql`e."id_avio" = ${filtros.idAvio}`);
  if (filtros.idAlmacen !== undefined)
    condiciones.push(Prisma.sql`e."id_almacen" = ${filtros.idAlmacen}`);
  if (filtros.soloGenericos) condiciones.push(Prisma.sql`av."es_generico" = true`);
  if (!filtros.incluirCeros) condiciones.push(Prisma.sql`e."existencia" <> 0`);
  const where = Prisma.join(condiciones, ' AND ');

  const filas = await cliente.$queryRaw<
    {
      idAvio: number;
      avio: string;
      descripcion: string;
      unidad: string | null;
      esGenerico: boolean;
      idAlmacen: number;
      almacen: string;
      existencia: Prisma.Decimal;
    }[]
  >(Prisma.sql`
    SELECT
      e."id_avio"     AS "idAvio",
      av."clave"      AS "avio",
      av."descripcion" AS "descripcion",
      av."unidad"     AS "unidad",
      av."es_generico" AS "esGenerico",
      e."id_almacen"  AS "idAlmacen",
      a."nombre"      AS "almacen",
      e."existencia"  AS "existencia"
    FROM "existencia_avio" e
    JOIN "avios"     av ON av."id" = e."id_avio"
    JOIN "almacenes" a  ON a."id" = e."id_almacen"
    WHERE ${where}
    ORDER BY av."clave" ASC, a."nombre" ASC
  `);

  let totalExistencia = 0;
  const filasSalida: ExistenciaAvioFila[] = filas.map((f) => {
    const existencia = Number(f.existencia);
    totalExistencia += existencia;
    return {
      idAvio: f.idAvio,
      avio: f.avio,
      descripcion: f.descripcion,
      unidad: f.unidad,
      esGenerico: f.esGenerico,
      idAlmacen: f.idAlmacen,
      almacen: f.almacen,
      existencia,
    };
  });

  return { filas: filasSalida, totalExistencia };
}

export type ParametrosKardexAvio = z.input<typeof esquemaConsultaKardexAvio>;

/**
 * KARDEX por AVÍO: lista CRONOLÓGICA de los movimientos del avío EN UN PERIODO, con SALDO CORRIDO
 * por avío×almacén (la dimensión de existencia de avíos, R4). Lee `MovimientoDetAvio` DIRECTO (sin
 * la vista). Costos/importes OMITIDOS (null) sin `telas.ver-totales` (ex-acceso #7 — se reutiliza
 * para los importes de materiales). Permiso `inventario-avios.ver`; empresa activa (A9).
 *
 * ⭐ FILA 0.173 — EL PERIODO, con el mecanismo que la 0.138 construyó para producto terminado
 * (`periodo-kardex.ts`, léelo: ahí está el porqué completo). En una línea: el filtro de fechas se
 * aplica en el `WHERE` (servidor, nunca recortando en el cliente); si nadie pide periodo se aplica
 * la ventana por omisión de 12 meses; hay un TOPE DURO de renglones que se lleva **el final** del
 * periodo (`folio DESC`, no el pedazo más viejo); y el saldo corrido se SIEMBRA con lo que el
 * almacén traía justo antes del primer renglón visible, porque si no la columna «Saldo» arrancaría
 * en cero y todos los renglones mentirían.
 */
export async function kardexAvio(
  sesion: SesionUsuario,
  parametros: ParametrosKardexAvio,
  bd?: ContextoBd,
): Promise<KardexAvioLista> {
  verificarPermiso(sesion, 'inventario-avios.ver');
  const filtros = validarEntrada(esquemaConsultaKardexAvio, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;
  const verImportes = tienePermiso(sesion, 'telas.ver-totales');

  const avio = await cliente.avio.findUnique({
    where: { id: filtros.idAvio },
    select: { id: true, clave: true, descripcion: true },
  });
  if (avio === null) {
    throw new ErrorNoEncontrado('Avio', filtros.idAvio);
  }

  const ventana = resolverVentanaKardex(filtros);
  const desdeDia = diaDelPeriodo(ventana.desde);
  const hastaDia = ventana.hasta === null ? undefined : diaDelPeriodo(ventana.hasta);

  const detalles = await cliente.movimientoDetAvio.findMany({
    where: {
      idAvio: filtros.idAvio,
      movimiento: {
        idEmpresa,
        ...(filtros.idAlmacen === undefined ? {} : { idAlmacen: filtros.idAlmacen }),
        // El PERIODO, resuelto en SERVIDOR. Los dos extremos inclusivos: `fecha` es `date`, así que
        // `lte` del último día lo incluye entero (no hay medianoche que se coma el día).
        fecha: { gte: desdeDia, ...(hastaDia === undefined ? {} : { lte: hastaDia }) },
      },
    },
    select: {
      // El `id` del detalle NO es decorativo: junto con el folio forma la llave de orden, y con
      // ella se ancla el saldo anterior en el punto exacto donde arranca la lista.
      id: true,
      idLote: true,
      cantidad: true,
      costoUnit: true,
      movimiento: {
        select: {
          id: true,
          folio: true,
          fecha: true,
          observaciones: true,
          origenTipo: true,
          origenId: true,
          idAlmacen: true,
          almacen: { select: { nombre: true } },
          idTipoMov: true,
          tipoMov: { select: { nombre: true, direccion: true } },
          anuladoPor: { select: { id: true } },
        },
      },
    },
    // ⭐ DESCENDENTE a propósito: cuando el periodo no cabe en `limite`, lo que se conserva es el
    // FINAL. La llave es folio (secuencia atómica por empresa, A3) + id del detalle, recorrida al
    // revés; `recortarPorLaCola` la invierte y la lista sale igual de cronológica.
    orderBy: [{ movimiento: { folio: 'desc' } }, { id: 'desc' }],
    // Uno de más: la forma barata de saber que hay más SIN pagar un `count` sobre diez años.
    take: filtros.limite + 1,
  });

  const { enPeriodo, truncado } = recortarPorLaCola(detalles, filtros.limite);

  // SALDO ANTERIOR por almacén: lo que cada uno traía JUSTO ANTES del primer renglón que se ve.
  // Sin renglones no hay punto de anclaje NI nada que explicar: se ahorra la consulta.
  const ancla = enPeriodo[0];
  const saldosPrevios =
    ancla === undefined
      ? []
      : await saldosAvioAntesDelPeriodo(cliente, {
          idEmpresa,
          idAvio: filtros.idAvio,
          idAlmacen: filtros.idAlmacen,
          desde: desdeDia,
          hasta: hastaDia,
          anclaFolio: ancla.movimiento.folio,
          anclaIdDetalle: ancla.id,
        });

  const saldoPorAlmacen = new Map<number, number>(saldosPrevios.map((s) => [s.idAlmacen, s.saldo]));
  const almacenesDelPeriodo = new Set<number>();

  const renglones: KardexAvioRenglon[] = enPeriodo.map((d) => {
    const m = d.movimiento;
    const esEntrada = m.tipoMov.direccion === DireccionMovimiento.entrada;
    const esSalida = m.tipoMov.direccion === DireccionMovimiento.salida;
    const cantidad = Number(d.cantidad);
    const entrada = esEntrada ? cantidad : 0;
    const salida = esSalida ? cantidad : 0;

    almacenesDelPeriodo.add(m.idAlmacen);
    const saldoPrevio = saldoPorAlmacen.get(m.idAlmacen) ?? 0;
    const saldo = saldoPrevio + entrada - salida;
    saldoPorAlmacen.set(m.idAlmacen, saldo);

    const costoUnit = verImportes ? aNumero(d.costoUnit) : null;
    return {
      idMovimiento: m.id,
      folio: Number(m.folio),
      fecha: m.fecha.toISOString().slice(0, 10),
      idTipoMov: m.idTipoMov,
      tipoMov: m.tipoMov.nombre,
      direccion: m.tipoMov.direccion,
      idAlmacen: m.idAlmacen,
      almacen: m.almacen.nombre,
      idLote: d.idLote,
      entrada,
      salida,
      saldo,
      costoUnit,
      importe: costoUnit === null ? null : costoUnit * cantidad,
      origenTipo: m.origenTipo,
      origenId: m.origenId,
      cancelado: m.anuladoPor.length > 0,
      observaciones: m.observaciones,
    };
  });

  return {
    idAvio: avio.id,
    avio: avio.clave,
    descripcion: avio.descripcion,
    desde: ventana.desde,
    hasta: ventana.hasta,
    ventanaPorOmision: ventana.porOmision,
    limite: filtros.limite,
    truncado,
    // Sólo los almacenes que SE MOVIERON en el periodo: son los que la tabla enseña y los únicos
    // cuyo saldo hay que poder explicar. Lo que no se movió no es kardex del periodo — es
    // existencia, y para eso está la pantalla de Existencias.
    saldosIniciales: saldosPrevios.filter((s) => almacenesDelPeriodo.has(s.idAlmacen)),
    renglones,
  };
}

/** Filtros con los que se calcula el saldo anterior de un avío (los MISMOS del kardex + el ancla). */
interface FiltrosSaldoAnteriorAvio {
  idEmpresa: number;
  idAvio: number;
  idAlmacen?: number | undefined;
  /** Primer día del periodo. Todo lo ESTRICTAMENTE anterior a este día es «antes del periodo». */
  desde: Date;
  /** Último día del periodo, o `undefined` si no hay techo. */
  hasta?: Date | undefined;
  /** Folio del PRIMER renglón que se va a enseñar (el punto donde arranca el saldo corrido). */
  anclaFolio: bigint;
  /** Id del detalle de ese mismo renglón: desempata los renglones del mismo movimiento. */
  anclaIdDetalle: number;
}

/**
 * SALDO ANTERIOR por almacén: Σ(cantidad·signo) de todo lo que el avío movió ANTES del punto donde
 * arranca la lista (D3 — la existencia siempre es suma de movimientos, nunca un saldo guardado). Ese
 * punto son dos cosas a la vez, y por eso la condición tiene dos ramas:
 *
 *  1. **Todo lo anterior al periodo** (`fecha < desde`) — el saldo de apertura de siempre.
 *  2. **Lo del periodo que el TOPE dejó fuera por arriba** (dentro del periodo, pero con
 *     `(folio, id)` anterior al primer renglón visible). Sin corte esta rama está vacía.
 *
 * Las dos ramas son excluyentes (una mira `fecha <`, la otra `fecha >=`), así que nada se cuenta dos
 * veces. Y la segunda usa **la misma llave con la que la lista se ordena y se corta**, no la fecha:
 * es lo que evita que dos movimientos del mismo día a ambos lados del límite se dupliquen o se
 * pierdan.
 *
 * ⚠️ **`id_empresa` (A9) y `id_avio` son de CORRECCIÓN; `id_almacen` es de RENDIMIENTO.** La llave
 * de agrupación es el almacén, así que un renglón de otro almacén cae en OTRO grupo y el llamador lo
 * descarta; pero empresa y avío **no** están en esa llave: quitarlos sumaría movimientos ajenos
 * DENTRO del mismo grupo y toda la columna «Saldo» mentiría a la vez. Por eso esos dos tienen
 * prueba que muere al quitarlos y el tercero no puede tenerla — se dice aquí en vez de fingirla.
 *
 * ⚠️ **Y el desempate `d."id"` aquí NO puede tener prueba que muera, a diferencia de los kardex de
 * tela.** Este kardex filtra por UN avío, y hoy **ningún** escritor puede meter dos renglones de ese
 * avío en el MISMO movimiento ⇒ la llave `(folio, id)` degenera en el folio y quitar el `id` no
 * cambia ningún resultado. Se conserva porque tiene que ser **exactamente** la llave del `ORDER BY`
 * —el día que un movimiento sí traiga dos renglones del mismo avío, el desempate ya está puesto—, y
 * se dice aquí en vez de fingir una prueba que no mediría nada. En tela por color sí muere (un
 * traspaso reparte FIFO entre partidas y escribe varios renglones del mismo color y almacén).
 *
 * 🔑 **Y como aquí el COMENTARIO ES la garantía —no hay prueba detrás—, tiene que cubrir los SEIS
 * caminos DIRECTOS (más el derivado de abajo) que escriben `movimiento_det_avio`, no sólo los que comparten razón.** Son tres razones
 * distintas, y conviene saberlo porque cada una se puede romper por su lado:
 *  1. **Ajuste, traspaso y salida sin orden** (`avios.ts`): lo impide
 *     {@link validarRenglonesAvioUnicos} — rechaza el mismo avío repetido en la captura.
 *  2. **Recepción de compra** (`compras/recepciones.ts`) y **nota de salida** (`notas/notas-salida.ts`):
 *     emiten **un movimiento por renglón**, así que cada movimiento nace con UNA sola línea.
 *  3. **Ajuste del inventario cíclico** (`indicadores/ciclico/avio.ts`): se apoya en el
 *     `@@unique([idInventarioCiclico, idAvio])` de la BASE DE DATOS — el avío no se puede contar dos
 *     veces en el mismo conteo, así que el movimiento no puede traerlo repetido.
 *
 * 📌 **Hay un séptimo sitio que escribe la tabla, y es DERIVADO: la cancelación** (`comun/kardex.ts`
 * copia `original.detallesAvio` 1:1 en el movimiento inverso). No abre camino nuevo —no puede
 * duplicar lo que el original no traía—, pero se nombra porque en una enumeración cuyo valor ES la
 * completitud, quien la audite se topa con él y cree haber encontrado el fallo. Lo cazó el reviewer
 * de la 0.173 haciendo justo esa auditoría.
 *
 * ⇒ **Si mañana aparece un octavo escritor multi-línea que no pase por ninguna de las tres, esta
 * afirmación se vuelve falsa y NADA suena.** Quien lo añada tiene que venir aquí: o le pone su
 * guarda, o este párrafo deja de ser cierto y el desempate pasa a necesitar prueba propia.
 *
 * Va en SQL crudo a propósito: el signo lo da `tipos_movimiento_inventario.direccion`, que cuelga
 * del encabezado `movimientos`, y Prisma no sabe agrupar por columnas de una relación.
 */
async function saldosAvioAntesDelPeriodo(
  cliente: ReturnType<typeof clienteLectura>,
  filtros: FiltrosSaldoAnteriorAvio,
): Promise<KardexAvioLista['saldosIniciales']> {
  const dentroDelPeriodo =
    filtros.hasta === undefined
      ? Prisma.sql`m."fecha" >= ${filtros.desde}::date`
      : Prisma.sql`m."fecha" >= ${filtros.desde}::date AND m."fecha" <= ${filtros.hasta}::date`;

  const condiciones: Prisma.Sql[] = [
    Prisma.sql`d."id_avio" = ${filtros.idAvio}`,
    Prisma.sql`m."id_empresa" = ${filtros.idEmpresa}`,
    Prisma.sql`(
      m."fecha" < ${filtros.desde}::date
      OR (
        ${dentroDelPeriodo}
        AND (m."folio", d."id") < (${filtros.anclaFolio}::bigint, ${filtros.anclaIdDetalle}::int)
      )
    )`,
  ];
  if (filtros.idAlmacen !== undefined)
    condiciones.push(Prisma.sql`m."id_almacen" = ${filtros.idAlmacen}`);
  const where = Prisma.join(condiciones, ' AND ');

  const filas = await cliente.$queryRaw<
    { idAlmacen: number; almacen: string; saldo: Prisma.Decimal }[]
  >(Prisma.sql`
    WITH previos AS (
      SELECT
        m."id_almacen" AS "idAlmacen",
        SUM(
          CASE
            WHEN t."direccion" = 'entrada' THEN d."cantidad"
            WHEN t."direccion" = 'salida'  THEN -d."cantidad"
            ELSE 0
          END
        ) AS "saldo"
      FROM "movimiento_det_avio" d
      JOIN "movimientos" m ON m."id" = d."id_movimiento"
      JOIN "tipos_movimiento_inventario" t ON t."id" = m."id_tipo_mov"
      WHERE ${where}
      GROUP BY 1
    )
    SELECT p."idAlmacen", a."nombre" AS "almacen", p."saldo"
    FROM previos p
    JOIN "almacenes" a ON a."id" = p."idAlmacen"
    WHERE p."saldo" <> 0
    ORDER BY a."nombre" ASC
  `);

  return filas.map((f) => ({
    idAlmacen: f.idAlmacen,
    almacen: f.almacen,
    saldo: Number(f.saldo),
  }));
}
