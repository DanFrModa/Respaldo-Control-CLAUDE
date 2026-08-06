/**
 * Inventario de TELAS operable por kardex (F4-E1; doc 04-Inventarios §B; D5/R4). Toda la lógica de
 * negocio vive AQUÍ (A1); las rutas REST solo validan permiso + Zod y delegan. Esta capa ORQUESTA el
 * motor de kardex (`comun/kardex.ts`) — el ÚNICO que escribe `Movimiento`/`MovimientoDetTela`— y le
 * pone las VALIDACIONES que el motor no hace: no dejar existencia negativa en salidas/traspasos,
 * crear el lote del ajuste de entrada (D5), elegir el tipo inverso de la cancelación y resolver los
 * tipos de movimiento por su código.
 *
 * Innegociables aplicados:
 *  • A1 — la lógica vive en este módulo de dominio; las rutas son delgadas.
 *  • A2 — el motor abre/compone la transacción; las validaciones de existencia y la creación del
 *    lote suceden DENTRO de la misma transacción (este módulo abre la tx, valida/crea y llama al
 *    motor con `{ tx }`).
 *  • A3/A7 — folio atómico + bitácora los hace el motor en cada movimiento.
 *  • A4 — cada operación re-verifica su permiso (`inventario-telas.ver`/`.mover`).
 *  • A9 — todo se filtra/sella por la empresa ACTIVA de la sesión.
 *  • D3 — la existencia es SIEMPRE Σ de movimientos; NO se edita ni se borra un movimiento. La
 *    corrección es un movimiento INVERSO auditado. Las VALIDACIONES transaccionales suman
 *    `MovimientoDetTela` DIRECTO bajo bloqueo (motor: `existenciaTelaBloqueada`), NUNCA la vista
 *    `existencia_tela` (la vista es solo CONSULTA — ADR-0010 §3).
 *  • D5 — un lote define el color/teñido y agrupa 1..N telas acompañantes (LoteComponente).
 *  • D1 — `costoUnit` se acepta (la entrada-recepción de E3 valúa); en ajustes/salidas va NULL.
 *
 * EX-ACCESO #7 (`telas.ver-totales`): en existencias y kardex de telas, los campos de costo/importe
 * se OMITEN (null) server-side para quien no tenga el permiso (A4, deny-by-default). Las cantidades
 * sí se ven con `inventario-telas.ver`. La UI los oculta cuando vienen null.
 *
 * SEMÁNTICA salida-vs-nota (fija para la fase, doc §"Cómo conecta"): `registrarSalidaTelaAOrden` es
 * LA única vía que descuenta tela hacia una orden (conserva la traza `origenId = idOrden`); la nota
 * de salida de E5 será un documento de envío que REFERENCIA esta salida SIN generar otro movimiento.
 */
import {
  esquemaAjusteTelaCrear,
  esquemaSalidaTelaCrear,
  esquemaTraspasoTelaCrear,
  esquemaMovimientoMaterialCancelarCuerpo,
  type DatosLoteEntrada,
  type DatosAjusteTelaLinea,
  type MovimientoTelaSalida,
  type TraspasoTelaSalida,
  type ExistenciasTelaLista,
  type ExistenciaTelaFila,
  type KardexTelaLista,
  type KardexTelaRenglon,
} from '../../contrato/index.js';
import { DireccionMovimiento, Prisma } from '../../datos/index.js';
import { z } from 'zod';

import { registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import {
  bloquearTela,
  cancelarMovimientoMaterial,
  existenciaTelaBloqueada,
  registrarMovimientoTela as registrarMovimientoTelaMotor,
  registrarTraspasoTela as registrarTraspasoTelaMotor,
  type LineaMovimientoTela,
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

// ── Códigos estables de los tipos de movimiento que el dominio resuelve por nombre ───────────────

/** Tipo inverso para CANCELAR un movimiento de ENTRADA de tela (dirección `salida`). */
const COD_AJUSTE_SALIDA = 'ajuste-salida';
/** Tipo inverso para CANCELAR un movimiento de SALIDA de tela (dirección `entrada`). */
const COD_AJUSTE_ENTRADA = 'ajuste-entrada';
/** Tipo de la pata de SALIDA de un traspaso de tela (dirección `salida`). */
const COD_TRANSFERENCIA_SALIDA = 'transferencia-salida';
/** Tipo de la pata de ENTRADA de un traspaso de tela (dirección `entrada`). */
const COD_TRANSFERENCIA_ENTRADA = 'transferencia-entrada';
/** Tipo de la salida de tela ligada a una orden (dirección `salida`). */
const COD_SALIDA_A_ORDEN = 'salida-a-orden';

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────

/** Convierte un `YYYY-MM-DD` al `Date` UTC que Prisma guarda en `@db.Date`. (Compartido con el
 * inventario NUEVO por color de `partidas-telas.ts` — etapa A2.) */
export function aDateColumna(valor: string): Date {
  return new Date(`${valor}T00:00:00.000Z`);
}

/** Resuelve un tipo de movimiento por su `codigo`, exigiéndolo activo. Lanza si no existe/inactivo.
 * (Compartido con `partidas-telas.ts`.) */
export async function tipoPorCodigo(
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

/** Resuelve un tipo de movimiento por su id (PK), exigiéndolo activo. (Compartido con
 * `partidas-telas.ts`.) */
export async function tipoPorId(
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

/** Convierte un Decimal de Prisma (o null) a number (o null). (Compartido con `partidas-telas.ts`.) */
export function aNumero(valor: Prisma.Decimal | null): number | null {
  return valor === null ? null : Number(valor);
}

/**
 * Valida, bajo bloqueo, que SACAR `lineas` (tela×lote) del almacén no deje la existencia negativa
 * (D3). Toma `bloquearTela` + `existenciaTelaBloqueada` por cada artículo DENTRO de la transacción
 * (concurrencia: dos salidas del mismo artículo no se cuelan entre la lectura y la escritura). Suma
 * directa de `MovimientoDetTela`, NUNCA la vista (ADR-0010 §3). Toma los locks en orden DETERMINISTA
 * (por tela, luego lote) para evitar deadlocks entre operaciones cruzadas.
 */
async function validarNoNegativoTela(
  tx: Tx,
  idEmpresa: number,
  idAlmacen: number,
  lineas: { idTela: number; idLote: number; cantidad: number }[],
): Promise<void> {
  const ordenadas = [...lineas].sort((a, b) => a.idTela - b.idTela || a.idLote - b.idLote);
  for (const l of ordenadas) {
    await bloquearTela(tx, idEmpresa, idAlmacen, l.idTela, l.idLote);
    const existencia = await existenciaTelaBloqueada(tx, idEmpresa, idAlmacen, l.idTela, l.idLote);
    if (existencia - l.cantidad < 0) {
      throw new ErrorConflicto(
        `No hay existencia suficiente de tela: se intenta sacar ${l.cantidad} de un artículo con ` +
          `${existencia} en existencia (no se permite dejar el inventario en negativo).`,
      );
    }
  }
}

// ── Proyección a la salida ─────────────────────────────────────────────────────────────────────

/** `include` para proyectar un movimiento de tela con nombres legibles. */
const incluirMovimientoTela = {
  tipoMov: { select: { nombre: true, direccion: true } },
  almacen: { select: { nombre: true } },
  anuladoPor: { select: { id: true } },
  detallesTela: {
    orderBy: [{ idTela: 'asc' }, { idLote: 'asc' }],
    include: {
      tela: { select: { nombre: true } },
      lote: { select: { clave: true } },
    },
  },
} satisfies Prisma.MovimientoInclude;

type MovimientoTelaConDetalle = Prisma.MovimientoGetPayload<{
  include: typeof incluirMovimientoTela;
}>;

/**
 * Proyecta un movimiento de tela (con detalle) a la forma del contrato. `verImportes` (ex-acceso #7)
 * decide si se exponen los costos/importes o se ponen en null (A4).
 */
function aMovimientoTelaSalida(
  m: MovimientoTelaConDetalle,
  verImportes: boolean,
): MovimientoTelaSalida {
  let totalCantidad = 0;
  let totalImporte = 0;
  let hayImporte = false;
  const renglones = m.detallesTela.map((d) => {
    const cantidad = Number(d.cantidad);
    totalCantidad += cantidad;
    const costoUnit = verImportes ? aNumero(d.costoUnit) : null;
    const importe = costoUnit === null ? null : costoUnit * cantidad;
    if (importe !== null) {
      totalImporte += importe;
      hayImporte = true;
    }
    return {
      idTela: d.idTela,
      tela: d.tela.nombre,
      idLote: d.idLote,
      loteClave: d.lote?.clave ?? null,
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

/** Obtiene un movimiento de tela de la empresa activa, o lanza (A9). */
async function obtenerMovimientoTela(
  idMovimiento: number,
  idEmpresa: number,
  verImportes: boolean,
  bd?: ContextoBd,
): Promise<MovimientoTelaSalida> {
  const m = await clienteLectura(bd).movimiento.findFirst({
    where: { id: idMovimiento, idEmpresa },
    include: incluirMovimientoTela,
  });
  if (m === null || m.detallesTela.length === 0) {
    throw new ErrorNoEncontrado('Movimiento de tela', idMovimiento);
  }
  return aMovimientoTelaSalida(m, verImportes);
}

// ── Operaciones de ESCRITURA ───────────────────────────────────────────────────────────────────

/** Datos de un ajuste de tela. */
export type EntradaAjusteTela = z.input<typeof esquemaAjusteTelaCrear>;
/** Datos de una salida de tela a orden. */
export type EntradaSalidaTela = z.input<typeof esquemaSalidaTelaCrear>;
/** Datos de un traspaso de tela. */
export type EntradaTraspasoTela = z.input<typeof esquemaTraspasoTelaCrear>;

/**
 * Genera una clave de lote legible cuando el ajuste no la trae. Lleva el sello de tiempo + un sufijo
 * aleatorio corto para que dos entradas en el MISMO milisegundo no colisionen en la clave única
 * `Lote.clave` (reviewer F4-E1 obs. #3: solo con `Date.now` colisionarían y reventaría con un 500 por
 * el @unique). No es un folio de negocio (esos van por secuencia atómica A3): es solo una clave de
 * conveniencia, así que `Math.random` es apropiado aquí (no es un script de workflow).
 */
function claveLoteAuto(idEmpresa: number, fecha: string): string {
  const sello = Date.now().toString(36);
  const sufijo = Math.random().toString(36).slice(2, 6);
  return `LOTE-${idEmpresa}-${fecha.replaceAll('-', '')}-${sello}-${sufijo}`;
}

/**
 * Crea el LOTE del ajuste de entrada (D5) y devuelve las líneas de kardex (una por componente,
 * todas con el mismo idLote). El lote define el color; los componentes son las telas que llegaron.
 */
async function crearLoteAjuste(
  tx: Tx,
  sesion: SesionUsuario,
  idEmpresa: number,
  fecha: string,
  lote: DatosLoteEntrada,
  costoUnit: number | null,
): Promise<LineaMovimientoTela[]> {
  const clave = lote.clave?.trim() || claveLoteAuto(idEmpresa, fecha);
  // Una tela no puede repetirse en los componentes del lote (PK compuesta).
  const idsTela = lote.componentes.map((c) => c.idTela);
  if (new Set(idsTela).size !== idsTela.length) {
    throw new ErrorValidacion('Una tela no puede aparecer dos veces en los componentes del lote.');
  }
  const existe = await tx.lote.findUnique({ where: { clave }, select: { id: true } });
  if (existe !== null) {
    throw new ErrorConflicto(`Ya existe un lote con la clave "${clave}".`);
  }
  const creado = await tx.lote.create({
    data: {
      clave,
      idColor: lote.idColor,
      ...(lote.idProveedor === undefined ? {} : { idProveedor: lote.idProveedor }),
      ...(lote.factura === undefined ? {} : { factura: lote.factura }),
      ...(lote.fecha === undefined ? {} : { fecha: aDateColumna(lote.fecha) }),
      ...(lote.observaciones === undefined ? {} : { observaciones: lote.observaciones }),
      componentes: {
        create: lote.componentes.map((c) => ({
          idTela: c.idTela,
          cantidad: c.cantidad,
          ...(c.peso === undefined ? {} : { peso: c.peso }),
        })),
      },
      creadoPorId: sesion.id,
      modificadoPorId: sesion.id,
    },
  });
  await registrarBitacora(tx, sesion, {
    entidad: 'Lote',
    idEntidad: creado.id,
    accion: 'CREAR',
    datos: { clave, idColor: lote.idColor, componentes: lote.componentes.length },
  });
  return lote.componentes.map((c) => ({
    idTela: c.idTela,
    idLote: creado.id,
    cantidad: c.cantidad,
    costoUnit,
  }));
}

/**
 * Registra un AJUSTE de inventario de TELA (conteo físico / corrección — doc 04-Inventarios §B). El
 * tipo de movimiento define la dirección. Una ENTRADA puede CREAR un lote nuevo con sus componentes
 * (D5); una salida (o un ajuste sobre lo existente) usa `lineas` tela×lote. Exactamente UNO de
 * `lote`/`lineas`. Si la dirección es salida, valida no-negativo bajo lock (D3). El motivo es
 * OBLIGATORIO (A7, va en la bitácora). Permiso `inventario-telas.mover` (A4). RECHAZA `traspaso`.
 */
export async function ajustarInventarioTela(
  sesion: SesionUsuario,
  entrada: EntradaAjusteTela,
  bd?: ContextoBd,
): Promise<MovimientoTelaSalida> {
  verificarPermiso(sesion, 'inventario-telas.mover');
  const datos = validarEntrada(esquemaAjusteTelaCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;
  const verImportes = tienePermiso(sesion, 'telas.ver-totales');

  if ((datos.lote === undefined) === (datos.lineas === undefined)) {
    throw new ErrorValidacion(
      'Captura un lote nuevo O renglones sobre lotes existentes (exactamente uno de los dos).',
    );
  }

  const idMovimiento = await enTransaccion(async (tx) => {
    const tipo = await tipoPorId(tx, datos.idTipoMov);
    if (tipo.direccion === DireccionMovimiento.traspaso) {
      throw new ErrorValidacion(
        'Un tipo de movimiento de dirección "traspaso" no es un ajuste: usa el traspaso entre almacenes.',
      );
    }

    let lineas: LineaMovimientoTela[];
    if (datos.lote !== undefined) {
      if (tipo.direccion !== DireccionMovimiento.entrada) {
        throw new ErrorValidacion('Crear un lote solo aplica a un ajuste de ENTRADA.');
      }
      lineas = await crearLoteAjuste(tx, sesion, idEmpresa, datos.fecha, datos.lote, null);
    } else {
      const renglones = datos.lineas ?? [];
      if (renglones.length === 0) {
        throw new ErrorValidacion('Captura al menos un renglón de tela.');
      }
      validarRenglonesTelaUnicos(renglones);
      lineas = renglones.map((l) => ({ idTela: l.idTela, idLote: l.idLote, cantidad: l.cantidad }));
      if (tipo.direccion === DireccionMovimiento.salida) {
        await validarNoNegativoTela(
          tx,
          idEmpresa,
          datos.idAlmacen,
          renglones.map((l) => ({ idTela: l.idTela, idLote: l.idLote, cantidad: l.cantidad })),
        );
      }
    }

    const movimiento = await registrarMovimientoTelaMotor(
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

  return obtenerMovimientoTela(idMovimiento, idEmpresa, verImportes, bd);
}

/** Valida que no se repita la misma pareja tela×lote en una captura de renglones. */
function validarRenglonesTelaUnicos(renglones: DatosAjusteTelaLinea[]): void {
  const claves = renglones.map((l) => `${l.idTela}:${l.idLote}`);
  if (new Set(claves).size !== claves.length) {
    throw new ErrorValidacion('No repitas la misma tela y lote en dos renglones de la captura.');
  }
}

/**
 * Registra una SALIDA de TELA hacia una orden de producción (`Salidas.IdOrdenes` del viejo —
 * 04-Inventarios §"Cómo conecta"). Es LA única vía que descuenta tela hacia una orden; conserva la
 * traza en `origenTipo = salida-a-orden` + `origenId = idOrden` (la nota de E5 la referenciará SIN
 * generar otro movimiento). Valida que la orden exista en la empresa activa (A9), que no deje
 * existencia negativa (D3, bajo lock) y usa el tipo `salida-a-orden`. Permiso
 * `inventario-telas.mover`.
 */
export async function registrarSalidaTelaAOrden(
  sesion: SesionUsuario,
  entrada: EntradaSalidaTela,
  bd?: ContextoBd,
): Promise<MovimientoTelaSalida> {
  verificarPermiso(sesion, 'inventario-telas.mover');
  const datos = validarEntrada(esquemaSalidaTelaCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;
  const verImportes = tienePermiso(sesion, 'telas.ver-totales');
  validarRenglonesTelaUnicos(datos.lineas);

  const idMovimiento = await enTransaccion(async (tx) => {
    const orden = await tx.orden.findFirst({
      where: { id: datos.idOrden, idEmpresa },
      select: { id: true },
    });
    if (orden === null) {
      throw new ErrorNoEncontrado('Orden', datos.idOrden);
    }
    const tipo = await tipoPorCodigo(tx, COD_SALIDA_A_ORDEN);

    await validarNoNegativoTela(
      tx,
      idEmpresa,
      datos.idAlmacen,
      datos.lineas.map((l) => ({ idTela: l.idTela, idLote: l.idLote, cantidad: l.cantidad })),
    );

    const movimiento = await registrarMovimientoTelaMotor(
      sesion,
      {
        idEmpresa,
        idTipoMov: tipo.id,
        idAlmacen: datos.idAlmacen,
        fecha: aDateColumna(datos.fecha),
        origenTipo: ORIGEN.salidaTelaOrden,
        origenId: String(datos.idOrden),
        lineas: datos.lineas.map((l) => ({
          idTela: l.idTela,
          idLote: l.idLote,
          cantidad: l.cantidad,
        })),
        ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
      },
      { tx },
    );
    return movimiento.id;
  }, bd);

  return obtenerMovimientoTela(idMovimiento, idEmpresa, verImportes, bd);
}

/**
 * Registra un TRASPASO de TELA entre dos almacenes de la empresa activa. Materializa DOS patas
 * (salida del origen + entrada al destino) en UNA transacción (A2); valida que el ORIGEN tenga
 * existencia suficiente (D3, bajo lock). Origen y destino DISTINTOS. Patas por
 * `transferencia-salida`/`transferencia-entrada`. Permiso `inventario-telas.mover`.
 */
export async function traspasarTela(
  sesion: SesionUsuario,
  entrada: EntradaTraspasoTela,
  bd?: ContextoBd,
): Promise<TraspasoTelaSalida> {
  verificarPermiso(sesion, 'inventario-telas.mover');
  const datos = validarEntrada(esquemaTraspasoTelaCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;
  const verImportes = tienePermiso(sesion, 'telas.ver-totales');

  if (datos.idAlmacenOrigen === datos.idAlmacenDestino) {
    throw new ErrorValidacion(
      'El traspaso necesita un almacén de origen y otro de destino distintos.',
    );
  }
  validarRenglonesTelaUnicos(datos.lineas);

  const { idSalida, idEntrada } = await enTransaccion(async (tx) => {
    const tipoSalida = await tipoPorCodigo(tx, COD_TRANSFERENCIA_SALIDA);
    const tipoEntrada = await tipoPorCodigo(tx, COD_TRANSFERENCIA_ENTRADA);

    await validarNoNegativoTela(
      tx,
      idEmpresa,
      datos.idAlmacenOrigen,
      datos.lineas.map((l) => ({ idTela: l.idTela, idLote: l.idLote, cantidad: l.cantidad })),
    );

    const lineas: LineaMovimientoTela[] = datos.lineas.map((l) => ({
      idTela: l.idTela,
      idLote: l.idLote,
      cantidad: l.cantidad,
    }));
    const { salida, entrada: entradaMov } = await registrarTraspasoTelaMotor(
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
    salida: await obtenerMovimientoTela(idSalida, idEmpresa, verImportes, bd),
    entrada: await obtenerMovimientoTela(idEntrada, idEmpresa, verImportes, bd),
  };
}

/**
 * CANCELA un movimiento de TELA generando su INVERSO auditado (D3/A7): NUNCA edita ni borra el
 * original. Lee la dirección del original y elige el tipo inverso — `entrada` → `ajuste-salida`
 * (saca lo que entró); `salida` → `ajuste-entrada` (re-entra lo que salió). El inverso es de
 * corrección: NO valida no-negativo (debe poder registrarse siempre). Permiso
 * `inventario-telas.mover`. Solo movimientos de la empresa activa (A9). No se re-cancela.
 */
export async function cancelarMovimientoTela(
  sesion: SesionUsuario,
  idMovimiento: number,
  cuerpo: z.input<typeof esquemaMovimientoMaterialCancelarCuerpo>,
  bd?: ContextoBd,
): Promise<MovimientoTelaSalida> {
  verificarPermiso(sesion, 'inventario-telas.mover');
  const datos = validarEntrada(esquemaMovimientoMaterialCancelarCuerpo, cuerpo);
  const idEmpresa = sesion.idEmpresaActiva;
  const verImportes = tienePermiso(sesion, 'telas.ver-totales');

  await enTransaccion(async (tx) => {
    const original = await tx.movimiento.findFirst({
      where: { id: idMovimiento, idEmpresa },
      select: {
        id: true,
        tipoMov: { select: { direccion: true } },
        detallesTela: { select: { id: true } },
      },
    });
    if (original === null || original.detallesTela.length === 0) {
      throw new ErrorNoEncontrado('Movimiento de tela', idMovimiento);
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
      datos: { motivoCancelacion: datos.motivo, dimension: 'tela' },
    });
  }, bd);

  return obtenerMovimientoTela(idMovimiento, idEmpresa, verImportes, bd);
}

// ── Consultas de SOLO LECTURA ──────────────────────────────────────────────────────────────────

const esquemaConsultaExistenciasTela = z.object({
  idTela: z.number().int().positive().optional(),
  idLote: z.number().int().positive().optional(),
  idColor: z.number().int().positive().optional(),
  idAlmacen: z.number().int().positive().optional(),
  incluirCeros: z.boolean().default(false),
});

const esquemaConsultaKardexTela = z.object({
  idTela: z.number().int().positive(),
  idLote: z.number().int().positive().optional(),
  idAlmacen: z.number().int().positive().optional(),
});

/** Parámetros de la consulta de existencias de tela (forma de dominio). */
export type ParametrosExistenciasTela = z.input<typeof esquemaConsultaExistenciasTela>;

/**
 * Consulta las EXISTENCIAS de TELA por tela×lote×almacén, leyendo la vista `existencia_tela` (aquí
 * SÍ se usa la vista — es una CONSULTA, ADR-0010 §3) por `$queryRaw`, filtrada por la empresa activa
 * (A9). JOIN para traer nombres del lote (color, proveedor, factura) y los COMPONENTES del lote
 * (D5: para expandir en la UI). Por defecto OMITE las filas con existencia 0. Permiso
 * `inventario-telas.ver`. (Los importes NO aparecen en existencias — la valuación cruda no se
 * muestra aquí; el ex-acceso #7 aplica a los costos del kardex/movimientos.)
 */
export async function consultarExistenciasTela(
  sesion: SesionUsuario,
  parametros: ParametrosExistenciasTela = {},
  bd?: ContextoBd,
): Promise<ExistenciasTelaLista> {
  verificarPermiso(sesion, 'inventario-telas.ver');
  const filtros = validarEntrada(esquemaConsultaExistenciasTela, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;

  const condiciones: Prisma.Sql[] = [Prisma.sql`e."id_empresa" = ${idEmpresa}`];
  if (filtros.idTela !== undefined) condiciones.push(Prisma.sql`e."id_tela" = ${filtros.idTela}`);
  if (filtros.idLote !== undefined) condiciones.push(Prisma.sql`e."id_lote" = ${filtros.idLote}`);
  if (filtros.idColor !== undefined)
    condiciones.push(Prisma.sql`l."id_color" = ${filtros.idColor}`);
  if (filtros.idAlmacen !== undefined)
    condiciones.push(Prisma.sql`e."id_almacen" = ${filtros.idAlmacen}`);
  if (!filtros.incluirCeros) condiciones.push(Prisma.sql`e."existencia" <> 0`);
  const where = Prisma.join(condiciones, ' AND ');

  const filas = await cliente.$queryRaw<
    {
      idTela: number;
      tela: string;
      idLote: number | null;
      loteClave: string | null;
      idColor: number | null;
      color: string | null;
      idProveedor: number | null;
      proveedor: string | null;
      factura: string | null;
      idAlmacen: number;
      almacen: string;
      existencia: Prisma.Decimal;
    }[]
  >(Prisma.sql`
    SELECT
      e."id_tela"     AS "idTela",
      te."nombre"     AS "tela",
      e."id_lote"     AS "idLote",
      l."clave"       AS "loteClave",
      l."id_color"    AS "idColor",
      c."nombre"      AS "color",
      l."id_proveedor" AS "idProveedor",
      p."nombre"      AS "proveedor",
      l."factura"     AS "factura",
      e."id_almacen"  AS "idAlmacen",
      a."nombre"      AS "almacen",
      e."existencia"  AS "existencia"
    FROM "existencia_tela" e
    JOIN "telas"     te ON te."id" = e."id_tela"
    LEFT JOIN "lotes" l  ON l."id"  = e."id_lote"
    LEFT JOIN "colores" c ON c."id" = l."id_color"
    LEFT JOIN "proveedores" p ON p."id" = l."id_proveedor"
    JOIN "almacenes" a  ON a."id" = e."id_almacen"
    WHERE ${where}
    ORDER BY te."nombre" ASC, l."clave" ASC NULLS FIRST, a."nombre" ASC
  `);

  // Componentes por lote (D5) para expandir en la UI: una sola consulta por los lotes presentes.
  const idsLote = [
    ...new Set(filas.map((f) => f.idLote).filter((id): id is number => id !== null)),
  ];
  const componentesPorLote = new Map<
    number,
    { idTela: number; tela: string; cantidad: number; peso: number | null }[]
  >();
  if (idsLote.length > 0) {
    const componentes = await cliente.loteComponente.findMany({
      where: { idLote: { in: idsLote } },
      include: { tela: { select: { nombre: true } } },
      orderBy: [{ idLote: 'asc' }, { idTela: 'asc' }],
    });
    for (const comp of componentes) {
      const lista = componentesPorLote.get(comp.idLote) ?? [];
      lista.push({
        idTela: comp.idTela,
        tela: comp.tela.nombre,
        cantidad: Number(comp.cantidad),
        peso: aNumero(comp.peso),
      });
      componentesPorLote.set(comp.idLote, lista);
    }
  }

  let totalExistencia = 0;
  const filasSalida: ExistenciaTelaFila[] = filas.map((f) => {
    const existencia = Number(f.existencia);
    totalExistencia += existencia;
    return {
      idTela: f.idTela,
      tela: f.tela,
      idLote: f.idLote,
      loteClave: f.loteClave,
      idColor: f.idColor,
      color: f.color,
      idProveedor: f.idProveedor,
      proveedor: f.proveedor,
      factura: f.factura,
      idAlmacen: f.idAlmacen,
      almacen: f.almacen,
      existencia,
      componentes: f.idLote === null ? [] : (componentesPorLote.get(f.idLote) ?? []),
    };
  });

  return { filas: filasSalida, totalExistencia };
}

/** Parámetros del kardex de tela (forma de dominio). */
export type ParametrosKardexTela = z.input<typeof esquemaConsultaKardexTela>;

/**
 * KARDEX por TELA (doc 04-Inventarios §B.4 — Movimientos por tela): lista CRONOLÓGICA de los
 * movimientos de la tela, con SALDO CORRIDO por tela×lote×almacén. Lee `MovimientoDetTela` DIRECTO
 * (sin la vista — la vista no preserva el orden). El saldo se calcula en memoria por artículo en
 * orden de folio. Los costos/importes se OMITEN (null) sin `telas.ver-totales` (ex-acceso #7).
 * Permiso `inventario-telas.ver`; empresa activa (A9).
 */
export async function kardexTela(
  sesion: SesionUsuario,
  parametros: ParametrosKardexTela,
  bd?: ContextoBd,
): Promise<KardexTelaLista> {
  verificarPermiso(sesion, 'inventario-telas.ver');
  const filtros = validarEntrada(esquemaConsultaKardexTela, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;
  const verImportes = tienePermiso(sesion, 'telas.ver-totales');

  const tela = await cliente.tela.findUnique({
    where: { id: filtros.idTela },
    select: { id: true, nombre: true },
  });
  if (tela === null) {
    throw new ErrorNoEncontrado('Tela', filtros.idTela);
  }

  const detalles = await cliente.movimientoDetTela.findMany({
    where: {
      idTela: filtros.idTela,
      ...(filtros.idLote === undefined ? {} : { idLote: filtros.idLote }),
      // SOLO el flujo LEGADO por lote: los renglones del inventario NUEVO por color (etapa A2,
      // `idTelaColor` poblado) tienen su propio kardex (`kardexTelaColor`) — sin este filtro se
      // colaban aquí como "(sin lote)" y descuadraban el saldo corrido (reviewer A2 #1).
      idTelaColor: null,
      movimiento: {
        idEmpresa,
        ...(filtros.idAlmacen === undefined ? {} : { idAlmacen: filtros.idAlmacen }),
      },
    },
    select: {
      idLote: true,
      cantidad: true,
      costoUnit: true,
      lote: { select: { clave: true } },
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

  const saldoPorArticulo = new Map<string, number>();
  const renglones: KardexTelaRenglon[] = detalles.map((d) => {
    const m = d.movimiento;
    const esEntrada = m.tipoMov.direccion === DireccionMovimiento.entrada;
    const esSalida = m.tipoMov.direccion === DireccionMovimiento.salida;
    const cantidad = Number(d.cantidad);
    const entrada = esEntrada ? cantidad : 0;
    const salida = esSalida ? cantidad : 0;

    const claveArt = `${d.idLote ?? 0}:${m.idAlmacen}`;
    const saldoPrevio = saldoPorArticulo.get(claveArt) ?? 0;
    const saldo = saldoPrevio + entrada - salida;
    saldoPorArticulo.set(claveArt, saldo);

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
      loteClave: d.lote?.clave ?? null,
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

  return { idTela: tela.id, tela: tela.nombre, renglones };
}
