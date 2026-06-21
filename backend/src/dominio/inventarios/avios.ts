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

import { registrarBitacora } from '../../comun/auditoria.js';
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
 * Registra un TRASPASO de AVÍO entre dos almacenes de la empresa activa (R4 — multi-almacén). Dos
 * patas (salida del origen + entrada al destino) en UNA transacción (A2); valida que el ORIGEN
 * tenga existencia suficiente (D3, bajo lock). Origen y destino DISTINTOS. Permiso
 * `inventario-avios.mover`.
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
        ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
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
        tipoMov: { select: { direccion: true } },
        detallesAvio: { select: { id: true } },
      },
    });
    if (original === null || original.detallesAvio.length === 0) {
      throw new ErrorNoEncontrado('Movimiento de avío', idMovimiento);
    }
    const codigoInverso =
      original.tipoMov.direccion === DireccionMovimiento.entrada
        ? COD_AJUSTE_SALIDA
        : COD_AJUSTE_ENTRADA;
    const tipoInverso = await tipoPorCodigo(tx, codigoInverso);
    await cancelarMovimientoMaterial(sesion, idMovimiento, tipoInverso.id, { tx });
    await registrarBitacora(tx, sesion, {
      entidad: 'Movimiento',
      idEntidad: idMovimiento,
      accion: 'OTRO',
      datos: { motivoCancelacion: datos.motivo, dimension: 'avio' },
    });
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

const esquemaConsultaKardexAvio = z.object({
  idAvio: z.number().int().positive(),
  idAlmacen: z.number().int().positive().optional(),
});

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
 * KARDEX por AVÍO: lista CRONOLÓGICA de los movimientos del avío con SALDO CORRIDO por avío×almacén
 * (la dimensión de existencia de avíos, R4). Lee `MovimientoDetAvio` DIRECTO (sin la vista). Costos/
 * importes OMITIDOS (null) sin `telas.ver-totales` (ex-acceso #7 — se reutiliza para los importes de
 * materiales). Permiso `inventario-avios.ver`; empresa activa (A9).
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

  const detalles = await cliente.movimientoDetAvio.findMany({
    where: {
      idAvio: filtros.idAvio,
      movimiento: {
        idEmpresa,
        ...(filtros.idAlmacen === undefined ? {} : { idAlmacen: filtros.idAlmacen }),
      },
    },
    select: {
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
    orderBy: [{ movimiento: { folio: 'asc' } }, { id: 'asc' }],
  });

  const saldoPorAlmacen = new Map<number, number>();
  const renglones: KardexAvioRenglon[] = detalles.map((d) => {
    const m = d.movimiento;
    const esEntrada = m.tipoMov.direccion === DireccionMovimiento.entrada;
    const esSalida = m.tipoMov.direccion === DireccionMovimiento.salida;
    const cantidad = Number(d.cantidad);
    const entrada = esEntrada ? cantidad : 0;
    const salida = esSalida ? cantidad : 0;

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

  return { idAvio: avio.id, avio: avio.clave, descripcion: avio.descripcion, renglones };
}
