/**
 * Inventario de TELAS NUEVO por COLOR — partidas + existencias + kardex (etapa A2; Daniel
 * §Post-F9.9 opción B y §Post-F9.11 puntos 2/4/5). Toda la lógica vive AQUÍ (A1); las rutas REST
 * solo validan permiso + Zod y delegan. Orquesta el MISMO motor de kardex (`comun/kardex.ts`) que
 * el flujo viejo por Lote — ese flujo queda INTACTO como legado consultable (`telas.ts`).
 *
 * Reglas del modelo nuevo:
 *  • La dimensión de existencia es TELA × COLOR (`TelaColor`, hijo de la tela) × almacén; el
 *    CUERPO y el COMPLEMENTO (cardigan) viajan SIEMPRE JUNTOS en el mismo renglón (comprar solo
 *    complemento = cuerpo en 0). `Tela.nombreComplemento != NULL` = la tela lleva complemento.
 *  • La PARTIDA es la unidad de ENTRADA (folio propio consecutivo POR EMPRESA — A3, secuencia
 *    `partida-tela` — + número de lote del proveedor, texto opcional buscable). El CONSUMO
 *    empareja por TELA+COLOR: las salidas NO piden partida (`idPartida` va NULL).
 *  • El inventario ARRANCA DESDE CERO (conteo físico): la puerta es el ajuste de entrada, que
 *    CREA la(s) partida(s) en la MISMA transacción (A2).
 *  • D3 — existencia = Σ de movimientos. Las validaciones de no-negativo (de AMBOS componentes)
 *    suman `MovimientoDetTela` DIRECTO bajo `pg_advisory_xact_lock` (motor:
 *    `existenciaTelaColorBloqueada`), NUNCA la vista `existencia_tela_color` (solo consulta).
 *  • Cancelar = movimiento INVERSO auditado (NUNCA edita/borra) — `cancelarMovimientoMaterial`.
 *  • A4 — permisos REUSADOS: `inventario-telas.ver` / `inventario-telas.mover` (cero permisos
 *    nuevos, cero seed). Ex-acceso #7 (`telas.ver-totales`): costos/importes del kardex se OMITEN
 *    (null) server-side.
 *  • A9 — todo se filtra/sella por la empresa activa de la sesión.
 *
 * ⚠️ Orden de folios (aviso de `comun/secuencias.ts`): cuando una transacción pide DOS claves
 * (partida + movimiento) SIEMPRE se toman en el mismo orden — primero `partida-tela`, luego
 * `movimiento` (que toma el motor) — para no interbloquear transacciones cruzadas.
 */
import {
  esquemaAjusteTelaColorCrear,
  esquemaSalidaTelaColorCrear,
  esquemaTraspasoTelaColorCrear,
  esquemaMovimientoMaterialCancelarCuerpo,
  type MovimientoTelaColorSalida,
  type TraspasoTelaColorSalida,
  type ExistenciasTelaColorLista,
  type ExistenciaTelaAgrupada,
  type ExistenciaTelaColorHijo,
  type KardexTelaColorLista,
  type KardexTelaColorRenglon,
  type PartidasTelaLista,
} from '../../contrato/index.js';
import { DireccionMovimiento, Prisma } from '../../datos/index.js';
import { z } from 'zod';

import { registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import {
  bloquearTelaColor,
  cancelarMovimientoMaterial,
  existenciaTelaColorBloqueada,
  registrarMovimientoTela as registrarMovimientoTelaMotor,
  registrarTraspasoTela as registrarTraspasoTelaMotor,
  type LineaMovimientoTela,
} from '../../comun/kardex.js';
import { ORIGEN } from '../../comun/origenes.js';
import { siguienteFolio } from '../../comun/secuencias.js';
import { verificarPermiso, tienePermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { aDateColumna, aNumero, tipoPorCodigo, tipoPorId } from './telas.js';

/** Clave de la secuencia de folios de partida (A3 — consecutivo por empresa, jamás Max()+1). */
const CLAVE_SECUENCIA_PARTIDA = 'partida-tela';

/** Tipo inverso para CANCELAR una entrada (dirección `salida`). */
const COD_AJUSTE_SALIDA = 'ajuste-salida';
/** Tipo inverso para CANCELAR una salida (dirección `entrada`). */
const COD_AJUSTE_ENTRADA = 'ajuste-entrada';
/** Tipos de las patas del traspaso. */
const COD_TRANSFERENCIA_SALIDA = 'transferencia-salida';
const COD_TRANSFERENCIA_ENTRADA = 'transferencia-entrada';
/** Tipo de la salida ligada a una orden. */
const COD_SALIDA_A_ORDEN = 'salida-a-orden';

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────

/** Un color de tela con los datos de su tela padre que las reglas necesitan. */
interface ColorConTela {
  idTelaColor: number;
  nombreColor: string;
  idTela: number;
  nombreTela: string;
  /** `null` = la tela NO lleva complemento (la bandera es `Tela.nombreComplemento`). */
  nombreComplemento: string | null;
}

/** La forma MÍNIMA de un renglón por color que las reglas necesitan (sin `loteProveedor` — las
 * líneas de salida/traspaso ya no traen ese campo en el contrato, reviewer A2 #4). */
interface LineaColorBase {
  idTelaColor: number;
  cantidad: number;
  cantidadComplemento?: number | undefined;
}

/**
 * Resuelve los colores capturados con su tela padre y VALIDA las reglas del complemento:
 * la cantidad de complemento solo se acepta en telas que LLEVAN complemento; en las que lo
 * llevan, un complemento no capturado se toma como 0. Rechaza colores inexistentes; los
 * REPETIDOS se rechazan SALVO `permitirRepetidos` (ajuste de ENTRADA: una factura puede traer
 * DOS lotes del MISMO tela+color en un documento — cada renglón crea SU partida, DECISIONES
 * §Post-F9.11 punto 4).
 */
async function resolverColores(
  tx: Tx,
  lineas: readonly LineaColorBase[],
  opciones?: { permitirRepetidos?: boolean },
): Promise<Map<number, ColorConTela>> {
  const ids = lineas.map((l) => l.idTelaColor);
  if (opciones?.permitirRepetidos !== true && new Set(ids).size !== ids.length) {
    throw new ErrorValidacion('No repitas el mismo color de tela en dos renglones de la captura.');
  }
  const colores = await tx.telaColor.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      nombre: true,
      tela: { select: { id: true, nombre: true, nombreComplemento: true } },
    },
  });
  const porId = new Map<number, ColorConTela>(
    colores.map((c) => [
      c.id,
      {
        idTelaColor: c.id,
        nombreColor: c.nombre,
        idTela: c.tela.id,
        nombreTela: c.tela.nombre,
        nombreComplemento: c.tela.nombreComplemento,
      },
    ]),
  );
  for (const linea of lineas) {
    const color = porId.get(linea.idTelaColor);
    if (color === undefined) {
      throw new ErrorNoEncontrado('TelaColor', linea.idTelaColor);
    }
    if (color.nombreComplemento === null && (linea.cantidadComplemento ?? 0) > 0) {
      throw new ErrorValidacion(
        `La tela "${color.nombreTela}" no lleva complemento: no se puede capturar cantidad de complemento en el color "${color.nombreColor}".`,
      );
    }
  }
  return porId;
}

/**
 * Convierte los renglones capturados a líneas del MOTOR de kardex. `cantidad` = cuerpo (admite
 * 0); `cantidadComplemento` se guarda como número (0 incluido) SOLO si la tela lleva complemento
 * — en telas sin complemento va NULL (la columna distingue "no lleva" de "llevó 0").
 * `idPartidaPorLinea` va POR ÍNDICE (no por color): en una entrada el mismo color puede aparecer
 * en varios renglones y cada uno lleva SU propia partida.
 */
function aLineasMotor(
  lineas: readonly LineaColorBase[],
  colores: Map<number, ColorConTela>,
  idPartidaPorLinea?: readonly (number | null)[],
): LineaMovimientoTela[] {
  return lineas.map((l, i) => {
    const color = colores.get(l.idTelaColor);
    if (color === undefined) {
      throw new ErrorNoEncontrado('TelaColor', l.idTelaColor);
    }
    const llevaComplemento = color.nombreComplemento !== null;
    return {
      idTela: color.idTela,
      idTelaColor: l.idTelaColor,
      idPartida: idPartidaPorLinea?.[i] ?? null,
      cantidad: l.cantidad,
      cantidadComplemento: llevaComplemento ? (l.cantidadComplemento ?? 0) : null,
    };
  });
}

/**
 * Valida, bajo bloqueo, que SACAR `lineas` (tela×color) del almacén no deje NINGUNO de los DOS
 * componentes en negativo (D3). Advisory lock por color (`bloquearTelaColor`) + suma DIRECTA de
 * `MovimientoDetTela` (`existenciaTelaColorBloqueada`) — NUNCA la vista (ADR-0010 §3). Locks en
 * orden DETERMINISTA (por idTelaColor) para evitar deadlocks entre operaciones cruzadas.
 */
async function validarNoNegativoTelaColor(
  tx: Tx,
  idEmpresa: number,
  idAlmacen: number,
  lineas: readonly LineaColorBase[],
  colores: Map<number, ColorConTela>,
): Promise<void> {
  const ordenadas = [...lineas].sort((a, b) => a.idTelaColor - b.idTelaColor);
  for (const l of ordenadas) {
    const color = colores.get(l.idTelaColor);
    if (color === undefined) {
      throw new ErrorNoEncontrado('TelaColor', l.idTelaColor);
    }
    await bloquearTelaColor(tx, idEmpresa, idAlmacen, l.idTelaColor);
    const existencia = await existenciaTelaColorBloqueada(tx, idEmpresa, idAlmacen, l.idTelaColor);
    if (existencia.cuerpo - l.cantidad < 0) {
      throw new ErrorConflicto(
        `No hay existencia suficiente de "${color.nombreTela} · ${color.nombreColor}": se intenta ` +
          `sacar ${l.cantidad} de cuerpo con ${existencia.cuerpo} en existencia (no se permite dejar ` +
          `el inventario en negativo).`,
      );
    }
    const complemento = l.cantidadComplemento ?? 0;
    if (existencia.complemento - complemento < 0) {
      throw new ErrorConflicto(
        `No hay existencia suficiente del complemento de "${color.nombreTela} · ${color.nombreColor}": ` +
          `se intenta sacar ${complemento} con ${existencia.complemento} en existencia (no se permite ` +
          `dejar el inventario en negativo).`,
      );
    }
  }
}

// ── Proyección a la salida ───────────────────────────────────────────────────────────────────────

/** `include` para proyectar un movimiento por color con nombres legibles. */
const incluirMovimientoTelaColor = {
  tipoMov: { select: { nombre: true, direccion: true } },
  almacen: { select: { nombre: true } },
  anuladoPor: { select: { id: true } },
  detallesTela: {
    orderBy: [{ idTelaColor: 'asc' }, { id: 'asc' }],
    include: {
      tela: { select: { nombre: true } },
      telaColor: { select: { nombre: true, pantone: true } },
      partida: { select: { folio: true, loteProveedor: true } },
    },
  },
} satisfies Prisma.MovimientoInclude;

type MovimientoTelaColorConDetalle = Prisma.MovimientoGetPayload<{
  include: typeof incluirMovimientoTelaColor;
}>;

/**
 * Proyecta un movimiento por color (con detalle) a la forma del contrato. `verImportes`
 * (ex-acceso #7) decide si se exponen los costos/importes o van null (A4).
 */
function aMovimientoTelaColorSalida(
  m: MovimientoTelaColorConDetalle,
  verImportes: boolean,
): MovimientoTelaColorSalida {
  let totalCuerpo = 0;
  let totalComplemento = 0;
  let totalImporte = 0;
  let hayImporte = false;
  const renglones = m.detallesTela
    .filter((d) => d.idTelaColor !== null && d.telaColor !== null)
    .map((d) => {
      const cantidad = Number(d.cantidad);
      const cantidadComplemento = aNumero(d.cantidadComplemento);
      totalCuerpo += cantidad;
      totalComplemento += cantidadComplemento ?? 0;
      const costoUnit = verImportes ? aNumero(d.costoUnit) : null;
      const importe = costoUnit === null ? null : costoUnit * cantidad;
      if (importe !== null) {
        totalImporte += importe;
        hayImporte = true;
      }
      return {
        idTela: d.idTela,
        tela: d.tela.nombre,
        // El filter de arriba garantiza ambos; el `??` cubre el estrechamiento de tipos.
        idTelaColor: d.idTelaColor ?? 0,
        telaColor: d.telaColor?.nombre ?? '',
        pantone: d.telaColor?.pantone ?? null,
        idPartida: d.idPartida,
        partidaFolio: d.partida === null ? null : Number(d.partida.folio),
        loteProveedor: d.partida?.loteProveedor ?? null,
        cantidad,
        cantidadComplemento,
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
    totalCuerpo,
    totalComplemento,
    totalImporte: verImportes && hayImporte ? totalImporte : null,
    creadoEn: m.creadoEn.toISOString(),
    creadoPorId: m.creadoPorId,
  };
}

/** Obtiene un movimiento por color de la empresa activa, o lanza (A9). */
async function obtenerMovimientoTelaColor(
  idMovimiento: number,
  idEmpresa: number,
  verImportes: boolean,
  bd?: ContextoBd,
): Promise<MovimientoTelaColorSalida> {
  const m = await clienteLectura(bd).movimiento.findFirst({
    where: { id: idMovimiento, idEmpresa },
    include: incluirMovimientoTelaColor,
  });
  if (m === null || !m.detallesTela.some((d) => d.idTelaColor !== null)) {
    throw new ErrorNoEncontrado('Movimiento de tela por color', idMovimiento);
  }
  return aMovimientoTelaColorSalida(m, verImportes);
}

// ── Operaciones de ESCRITURA ─────────────────────────────────────────────────────────────────────

/** Datos de un ajuste por color. */
export type EntradaAjusteTelaColor = z.input<typeof esquemaAjusteTelaColorCrear>;
/** Datos de una salida por color a orden. */
export type EntradaSalidaTelaColor = z.input<typeof esquemaSalidaTelaColorCrear>;
/** Datos de un traspaso por color. */
export type EntradaTraspasoTelaColor = z.input<typeof esquemaTraspasoTelaColorCrear>;

/**
 * Registra un AJUSTE de inventario de tela POR COLOR (conteo físico / arranque desde cero /
 * corrección). El tipo de movimiento define la dirección. Una ENTRADA crea UNA PARTIDA por
 * renglón (folio atómico A3 — primero los folios `partida-tela`, luego el del movimiento — +
 * `loteProveedor` del renglón + `factura` del encabezado) en la MISMA transacción (A2). Una
 * SALIDA valida no-negativo de AMBOS componentes bajo lock (D3) y NO lleva partida ni
 * `loteProveedor`. Motivo OBLIGATORIO (A7). Permiso `inventario-telas.mover` (A4). RECHAZA
 * `traspaso` (va por {@link traspasarTelaColor}).
 */
export async function ajustarInventarioTelaColor(
  sesion: SesionUsuario,
  entrada: EntradaAjusteTelaColor,
  bd?: ContextoBd,
): Promise<MovimientoTelaColorSalida> {
  verificarPermiso(sesion, 'inventario-telas.mover');
  const datos = validarEntrada(esquemaAjusteTelaColorCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;
  const verImportes = tienePermiso(sesion, 'telas.ver-totales');

  const idMovimiento = await enTransaccion(async (tx) => {
    const tipo = await tipoPorId(tx, datos.idTipoMov);
    if (tipo.direccion === DireccionMovimiento.traspaso) {
      throw new ErrorValidacion(
        'Un tipo de movimiento de dirección "traspaso" no es un ajuste: usa el traspaso entre almacenes.',
      );
    }
    const esEntrada = tipo.direccion === DireccionMovimiento.entrada;
    // En ENTRADA el MISMO tela+color puede venir en varios renglones (una factura con dos lotes
    // del mismo color = dos partidas — DECISIONES §Post-F9.11 punto 4). En salida NO (no hay
    // partida que los distinga).
    const colores = await resolverColores(tx, datos.lineas, { permitirRepetidos: esEntrada });

    let idPartidaPorLinea: (number | null)[] | undefined;
    if (esEntrada) {
      // ENTRADA: crea la partida de cada RENGLÓN (unidad de entrada, opción B de Daniel) — por
      // índice, porque un color repetido lleva partidas distintas.
      idPartidaPorLinea = [];
      for (const linea of datos.lineas) {
        const folio = await siguienteFolio(tx, idEmpresa, CLAVE_SECUENCIA_PARTIDA);
        const partida = await tx.partidaTela.create({
          data: {
            folio,
            idEmpresa,
            idTelaColor: linea.idTelaColor,
            loteProveedor: linea.loteProveedor?.trim() || null,
            factura: datos.factura?.trim() || null,
            fecha: aDateColumna(datos.fecha),
            creadoPorId: sesion.id,
            modificadoPorId: sesion.id,
          },
        });
        idPartidaPorLinea.push(partida.id);
        await registrarBitacora(tx, sesion, {
          entidad: 'PartidaTela',
          idEntidad: partida.id,
          accion: 'CREAR',
          datos: {
            folio: folio.toString(),
            idTelaColor: linea.idTelaColor,
            ...(partida.loteProveedor === null ? {} : { loteProveedor: partida.loteProveedor }),
          },
        });
      }
    } else {
      // SALIDA de ajuste: sin partida (el consumo empareja por color) y sin lote del proveedor.
      if (datos.lineas.some((l) => l.loteProveedor !== undefined && l.loteProveedor !== '')) {
        throw new ErrorValidacion(
          'El lote del proveedor solo se captura en ajustes de ENTRADA (la partida es la unidad de entrada).',
        );
      }
      await validarNoNegativoTelaColor(tx, idEmpresa, datos.idAlmacen, datos.lineas, colores);
    }

    const movimiento = await registrarMovimientoTelaMotor(
      sesion,
      {
        idEmpresa,
        idTipoMov: datos.idTipoMov,
        idAlmacen: datos.idAlmacen,
        fecha: aDateColumna(datos.fecha),
        origenTipo: ORIGEN.movimientoManual,
        lineas: aLineasMotor(datos.lineas, colores, idPartidaPorLinea),
        observaciones: datos.motivo,
      },
      { tx },
    );
    return movimiento.id;
  }, bd);

  return obtenerMovimientoTelaColor(idMovimiento, idEmpresa, verImportes, bd);
}

/**
 * Registra una SALIDA de tela POR COLOR hacia una orden de producción. El consumo empareja por
 * TELA+COLOR (NO pide partida — Daniel §Post-F9.9). Valida que la orden exista en la empresa
 * activa (A9) y que NINGUNO de los dos componentes quede negativo (D3, bajo lock). Conserva la
 * traza `origenTipo = salida-tela-orden` + `origenId = idOrden`. La función vieja
 * `registrarSalidaTelaAOrden` (flujo Lote) queda intacta. Permiso `inventario-telas.mover`.
 */
export async function registrarSalidaTelaColorAOrden(
  sesion: SesionUsuario,
  entrada: EntradaSalidaTelaColor,
  bd?: ContextoBd,
): Promise<MovimientoTelaColorSalida> {
  verificarPermiso(sesion, 'inventario-telas.mover');
  const datos = validarEntrada(esquemaSalidaTelaColorCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;
  const verImportes = tienePermiso(sesion, 'telas.ver-totales');

  const idMovimiento = await enTransaccion(async (tx) => {
    const orden = await tx.orden.findFirst({
      where: { id: datos.idOrden, idEmpresa },
      select: { id: true },
    });
    if (orden === null) {
      throw new ErrorNoEncontrado('Orden', datos.idOrden);
    }
    const tipo = await tipoPorCodigo(tx, COD_SALIDA_A_ORDEN);
    const colores = await resolverColores(tx, datos.lineas);
    await validarNoNegativoTelaColor(tx, idEmpresa, datos.idAlmacen, datos.lineas, colores);

    const movimiento = await registrarMovimientoTelaMotor(
      sesion,
      {
        idEmpresa,
        idTipoMov: tipo.id,
        idAlmacen: datos.idAlmacen,
        fecha: aDateColumna(datos.fecha),
        origenTipo: ORIGEN.salidaTelaOrden,
        origenId: String(datos.idOrden),
        lineas: aLineasMotor(datos.lineas, colores),
        ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
      },
      { tx },
    );
    return movimiento.id;
  }, bd);

  return obtenerMovimientoTelaColor(idMovimiento, idEmpresa, verImportes, bd);
}

/**
 * Registra un TRASPASO de tela POR COLOR entre dos almacenes de la empresa activa: DOS patas
 * atómicas (salida del origen + entrada al destino) en UNA transacción (A2, patrón
 * `registrarTraspasoTela`), con AMBAS cantidades juntas. Valida que el ORIGEN aguante los dos
 * componentes (D3, bajo lock). Sin partida (las patas del traspaso no son entradas de compra).
 * Permiso `inventario-telas.mover`.
 */
export async function traspasarTelaColor(
  sesion: SesionUsuario,
  entrada: EntradaTraspasoTelaColor,
  bd?: ContextoBd,
): Promise<TraspasoTelaColorSalida> {
  verificarPermiso(sesion, 'inventario-telas.mover');
  const datos = validarEntrada(esquemaTraspasoTelaColorCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;
  const verImportes = tienePermiso(sesion, 'telas.ver-totales');

  if (datos.idAlmacenOrigen === datos.idAlmacenDestino) {
    throw new ErrorValidacion(
      'El traspaso necesita un almacén de origen y otro de destino distintos.',
    );
  }

  const { idSalida, idEntrada } = await enTransaccion(async (tx) => {
    const tipoSalida = await tipoPorCodigo(tx, COD_TRANSFERENCIA_SALIDA);
    const tipoEntrada = await tipoPorCodigo(tx, COD_TRANSFERENCIA_ENTRADA);
    const colores = await resolverColores(tx, datos.lineas);
    await validarNoNegativoTelaColor(tx, idEmpresa, datos.idAlmacenOrigen, datos.lineas, colores);

    const { salida, entrada: entradaMov } = await registrarTraspasoTelaMotor(
      sesion,
      {
        idEmpresa,
        idTipoMovSalida: tipoSalida.id,
        idTipoMovEntrada: tipoEntrada.id,
        idAlmacenOrigen: datos.idAlmacenOrigen,
        idAlmacenDestino: datos.idAlmacenDestino,
        fecha: aDateColumna(datos.fecha),
        lineas: aLineasMotor(datos.lineas, colores),
        ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
      },
      { tx },
    );
    return { idSalida: salida.id, idEntrada: entradaMov.id };
  }, bd);

  return {
    salida: await obtenerMovimientoTelaColor(idSalida, idEmpresa, verImportes, bd),
    entrada: await obtenerMovimientoTelaColor(idEntrada, idEmpresa, verImportes, bd),
  };
}

/**
 * CANCELA un movimiento por color generando su INVERSO auditado (D3/A7): NUNCA edita ni borra el
 * original. Reusa el motor genérico `cancelarMovimientoMaterial` (que copia TAMBIÉN
 * `idTelaColor`/`idPartida`/`cantidadComplemento` al inverso para que el par se neutralice en la
 * suma por color). `entrada` → inverso `ajuste-salida`; `salida` → inverso `ajuste-entrada`. El
 * inverso es de corrección: NO valida no-negativo. Permiso `inventario-telas.mover`; empresa
 * activa (A9). No se re-cancela ni se cancela una sola pata de un traspaso (motor).
 */
export async function cancelarMovimientoTelaColor(
  sesion: SesionUsuario,
  idMovimiento: number,
  cuerpo: z.input<typeof esquemaMovimientoMaterialCancelarCuerpo>,
  bd?: ContextoBd,
): Promise<MovimientoTelaColorSalida> {
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
        detallesTela: { select: { idTelaColor: true } },
      },
    });
    if (original === null || !original.detallesTela.some((d) => d.idTelaColor !== null)) {
      throw new ErrorNoEncontrado('Movimiento de tela por color', idMovimiento);
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
      datos: { motivoCancelacion: datos.motivo, dimension: 'tela-color' },
    });
  }, bd);

  return obtenerMovimientoTelaColor(idMovimiento, idEmpresa, verImportes, bd);
}

// ── Consultas de SOLO LECTURA ────────────────────────────────────────────────────────────────────

const esquemaConsultaExistenciasTelaColor = z.object({
  idTela: z.number().int().positive().optional(),
  idTelaColor: z.number().int().positive().optional(),
  idAlmacen: z.number().int().positive().optional(),
  idCategoria: z.number().int().positive().optional(),
  idProveedor: z.number().int().positive().optional(),
  busqueda: z.string().trim().max(150).optional(),
  incluirCeros: z.boolean().default(false),
});

/** Parámetros de la consulta de existencias por color (forma de dominio). */
export type ParametrosExistenciasTelaColor = z.input<typeof esquemaConsultaExistenciasTelaColor>;

/** Fila cruda de la vista + joins (una por tela×color×almacén). */
interface FilaExistenciaColor {
  idTela: number;
  tela: string;
  categoria: string | null;
  idProveedor: number | null;
  proveedor: string | null;
  nombreProveedor: string | null;
  unidadMedida: 'KG' | 'M';
  nombreCuerpo: string | null;
  nombreComplemento: string | null;
  idTelaColor: number;
  color: string;
  pantone: string | null;
  idAlmacen: number;
  almacen: string;
  cuerpo: Prisma.Decimal;
  complemento: Prisma.Decimal;
}

/**
 * Consulta las EXISTENCIAS del inventario NUEVO agrupadas TELA PADRE → COLORES hijos (cada color
 * con su desglose por almacén), leyendo la vista `existencia_tela_color` (aquí SÍ se usa la vista
 * — es una CONSULTA, ADR-0010 §3) filtrada por la empresa activa (A9). Filtros: tela, color,
 * almacén, tipo/categoría, proveedor dueño y búsqueda (nombre de tela / nombre del proveedor /
 * color / pantone). Por defecto OMITE los colores con AMBOS componentes en 0. Permiso
 * `inventario-telas.ver`. (Aquí no viajan importes; el ex-acceso #7 aplica al kardex.)
 */
export async function consultarExistenciasTelaColor(
  sesion: SesionUsuario,
  parametros: ParametrosExistenciasTelaColor = {},
  bd?: ContextoBd,
): Promise<ExistenciasTelaColorLista> {
  verificarPermiso(sesion, 'inventario-telas.ver');
  const filtros = validarEntrada(esquemaConsultaExistenciasTelaColor, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;

  const condiciones: Prisma.Sql[] = [Prisma.sql`e."id_empresa" = ${idEmpresa}`];
  if (filtros.idTela !== undefined) condiciones.push(Prisma.sql`e."id_tela" = ${filtros.idTela}`);
  if (filtros.idTelaColor !== undefined)
    condiciones.push(Prisma.sql`e."id_tela_color" = ${filtros.idTelaColor}`);
  if (filtros.idAlmacen !== undefined)
    condiciones.push(Prisma.sql`e."id_almacen" = ${filtros.idAlmacen}`);
  if (filtros.idCategoria !== undefined)
    condiciones.push(Prisma.sql`te."id_categoria" = ${filtros.idCategoria}`);
  if (filtros.idProveedor !== undefined)
    condiciones.push(Prisma.sql`te."id_proveedor" = ${filtros.idProveedor}`);
  if (filtros.busqueda !== undefined && filtros.busqueda.length > 0) {
    const patron = `%${filtros.busqueda}%`;
    condiciones.push(
      Prisma.sql`(te."nombre" ILIKE ${patron} OR te."nombre_proveedor" ILIKE ${patron} OR p."nombre" ILIKE ${patron} OR c."nombre" ILIKE ${patron} OR c."pantone" ILIKE ${patron})`,
    );
  }
  if (!filtros.incluirCeros) {
    condiciones.push(Prisma.sql`(e."existencia_cuerpo" <> 0 OR e."existencia_complemento" <> 0)`);
  }
  const where = Prisma.join(condiciones, ' AND ');

  const filas = await cliente.$queryRaw<FilaExistenciaColor[]>(Prisma.sql`
    SELECT
      e."id_tela"        AS "idTela",
      te."nombre"        AS "tela",
      cat."nombre"       AS "categoria",
      te."id_proveedor"  AS "idProveedor",
      p."nombre"         AS "proveedor",
      te."nombre_proveedor"   AS "nombreProveedor",
      te."unidad_medida"      AS "unidadMedida",
      te."nombre_cuerpo"      AS "nombreCuerpo",
      te."nombre_complemento" AS "nombreComplemento",
      e."id_tela_color"  AS "idTelaColor",
      c."nombre"         AS "color",
      c."pantone"        AS "pantone",
      e."id_almacen"     AS "idAlmacen",
      a."nombre"         AS "almacen",
      e."existencia_cuerpo"      AS "cuerpo",
      e."existencia_complemento" AS "complemento"
    FROM "existencia_tela_color" e
    JOIN "telas"         te  ON te."id" = e."id_tela"
    JOIN "telas_colores" c   ON c."id"  = e."id_tela_color"
    LEFT JOIN "telas_categorias" cat ON cat."id" = te."id_categoria"
    LEFT JOIN "proveedores"      p   ON p."id"   = te."id_proveedor"
    JOIN "almacenes"     a   ON a."id" = e."id_almacen"
    WHERE ${where}
    ORDER BY te."nombre" ASC, c."nombre" ASC, a."nombre" ASC
  `);

  // Agrupa en memoria: TELA PADRE → COLORES hijos → almacenes (el ORDER BY ya viene agrupable).
  const telas: ExistenciaTelaAgrupada[] = [];
  let telaActual: ExistenciaTelaAgrupada | undefined;
  let colorActual: ExistenciaTelaColorHijo | undefined;
  let totalCuerpo = 0;
  let totalComplemento = 0;

  for (const f of filas) {
    const cuerpo = Number(f.cuerpo);
    const complemento = Number(f.complemento);
    if (telaActual === undefined || telaActual.idTela !== f.idTela) {
      telaActual = {
        idTela: f.idTela,
        nombre: f.tela,
        categoria: f.categoria,
        idProveedor: f.idProveedor,
        proveedor: f.proveedor,
        nombreProveedor: f.nombreProveedor,
        unidadMedida: f.unidadMedida,
        nombreCuerpo: f.nombreCuerpo,
        nombreComplemento: f.nombreComplemento,
        totalCuerpo: 0,
        totalComplemento: 0,
        colores: [],
      };
      telas.push(telaActual);
      colorActual = undefined;
    }
    if (colorActual === undefined || colorActual.idTelaColor !== f.idTelaColor) {
      colorActual = {
        idTelaColor: f.idTelaColor,
        nombre: f.color,
        pantone: f.pantone,
        existenciaCuerpo: 0,
        existenciaComplemento: 0,
        almacenes: [],
      };
      telaActual.colores.push(colorActual);
    }
    colorActual.almacenes.push({
      idAlmacen: f.idAlmacen,
      almacen: f.almacen,
      cuerpo,
      complemento,
    });
    colorActual.existenciaCuerpo += cuerpo;
    colorActual.existenciaComplemento += complemento;
    telaActual.totalCuerpo += cuerpo;
    telaActual.totalComplemento += complemento;
    totalCuerpo += cuerpo;
    totalComplemento += complemento;
  }

  return { telas, totalCuerpo, totalComplemento };
}

const esquemaConsultaKardexTelaColor = z.object({
  idTelaColor: z.number().int().positive(),
  idAlmacen: z.number().int().positive().optional(),
  idPartida: z.number().int().positive().optional(),
});

/** Parámetros del kardex por color (forma de dominio). */
export type ParametrosKardexTelaColor = z.input<typeof esquemaConsultaKardexTelaColor>;

/**
 * KARDEX por TELA+COLOR: lista CRONOLÓGICA de los movimientos del color, con SALDO CORRIDO de
 * AMBOS componentes por color×almacén (patrón `kardexTela`). Filtro opcional por almacén y por
 * partida (traza de entrada). Lee `MovimientoDetTela` DIRECTO (sin la vista — no preserva orden).
 * Los costos/importes se OMITEN (null) sin `telas.ver-totales` (ex-acceso #7). Permiso
 * `inventario-telas.ver`; empresa activa (A9).
 */
export async function kardexTelaColor(
  sesion: SesionUsuario,
  parametros: ParametrosKardexTelaColor,
  bd?: ContextoBd,
): Promise<KardexTelaColorLista> {
  verificarPermiso(sesion, 'inventario-telas.ver');
  const filtros = validarEntrada(esquemaConsultaKardexTelaColor, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;
  const verImportes = tienePermiso(sesion, 'telas.ver-totales');

  const color = await cliente.telaColor.findUnique({
    where: { id: filtros.idTelaColor },
    select: {
      id: true,
      nombre: true,
      pantone: true,
      tela: {
        select: {
          id: true,
          nombre: true,
          unidadMedida: true,
          nombreCuerpo: true,
          nombreComplemento: true,
        },
      },
    },
  });
  if (color === null) {
    throw new ErrorNoEncontrado('TelaColor', filtros.idTelaColor);
  }

  const detalles = await cliente.movimientoDetTela.findMany({
    where: {
      idTelaColor: filtros.idTelaColor,
      ...(filtros.idPartida === undefined ? {} : { idPartida: filtros.idPartida }),
      movimiento: {
        idEmpresa,
        ...(filtros.idAlmacen === undefined ? {} : { idAlmacen: filtros.idAlmacen }),
      },
    },
    select: {
      cantidad: true,
      cantidadComplemento: true,
      costoUnit: true,
      idPartida: true,
      partida: { select: { folio: true, loteProveedor: true } },
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

  const saldoCuerpoPorAlmacen = new Map<number, number>();
  const saldoComplementoPorAlmacen = new Map<number, number>();
  const renglones: KardexTelaColorRenglon[] = detalles.map((d) => {
    const m = d.movimiento;
    const esEntrada = m.tipoMov.direccion === DireccionMovimiento.entrada;
    const esSalida = m.tipoMov.direccion === DireccionMovimiento.salida;
    const cuerpo = Number(d.cantidad);
    const complemento = aNumero(d.cantidadComplemento) ?? 0;
    const entradaCuerpo = esEntrada ? cuerpo : 0;
    const salidaCuerpo = esSalida ? cuerpo : 0;
    const entradaComplemento = esEntrada ? complemento : 0;
    const salidaComplemento = esSalida ? complemento : 0;

    const saldoCuerpo =
      (saldoCuerpoPorAlmacen.get(m.idAlmacen) ?? 0) + entradaCuerpo - salidaCuerpo;
    saldoCuerpoPorAlmacen.set(m.idAlmacen, saldoCuerpo);
    const saldoComplemento =
      (saldoComplementoPorAlmacen.get(m.idAlmacen) ?? 0) + entradaComplemento - salidaComplemento;
    saldoComplementoPorAlmacen.set(m.idAlmacen, saldoComplemento);

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
      idPartida: d.idPartida,
      partidaFolio: d.partida === null ? null : Number(d.partida.folio),
      loteProveedor: d.partida?.loteProveedor ?? null,
      entradaCuerpo,
      salidaCuerpo,
      saldoCuerpo,
      entradaComplemento,
      salidaComplemento,
      saldoComplemento,
      costoUnit,
      importe: costoUnit === null ? null : costoUnit * cuerpo,
      origenTipo: m.origenTipo,
      origenId: m.origenId,
      cancelado: m.anuladoPor.length > 0,
      observaciones: m.observaciones,
    };
  });

  return {
    idTela: color.tela.id,
    tela: color.tela.nombre,
    idTelaColor: color.id,
    telaColor: color.nombre,
    pantone: color.pantone,
    unidadMedida: color.tela.unidadMedida,
    nombreCuerpo: color.tela.nombreCuerpo,
    nombreComplemento: color.tela.nombreComplemento,
    renglones,
  };
}

const esquemaConsultaPartidasTela = z.object({
  idTelaColor: z.number().int().positive().optional(),
  idTela: z.number().int().positive().optional(),
  busqueda: z.string().trim().max(100).optional(),
});

/** Parámetros de la búsqueda de partidas (forma de dominio). */
export type ParametrosListarPartidasTela = z.input<typeof esquemaConsultaPartidasTela>;

/** Cuántas partidas devuelve la búsqueda como máximo (selector typeahead). */
const MAX_PARTIDAS = 50;

/**
 * Busca PARTIDAS de tela (unidad de entrada) por folio, lote del proveedor o factura — para el
 * selector de la UI y consultas de traza. Filtro opcional por color o por tela. Devuelve las 50
 * más recientes (folio descendente). Permiso `inventario-telas.ver`; empresa activa (A9).
 */
export async function listarPartidasTela(
  sesion: SesionUsuario,
  parametros: ParametrosListarPartidasTela = {},
  bd?: ContextoBd,
): Promise<PartidasTelaLista> {
  verificarPermiso(sesion, 'inventario-telas.ver');
  const filtros = validarEntrada(esquemaConsultaPartidasTela, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;

  const busqueda = filtros.busqueda;
  const filtrosBusqueda: Prisma.PartidaTelaWhereInput[] = [];
  if (busqueda !== undefined && busqueda.length > 0) {
    const or: Prisma.PartidaTelaWhereInput[] = [
      { loteProveedor: { contains: busqueda, mode: 'insensitive' } },
      { factura: { contains: busqueda, mode: 'insensitive' } },
    ];
    // Si lo tecleado es un número, también casa por folio exacto.
    if (/^\d+$/.test(busqueda)) {
      or.push({ folio: BigInt(busqueda) });
    }
    filtrosBusqueda.push({ OR: or });
  }

  const partidas = await cliente.partidaTela.findMany({
    where: {
      idEmpresa,
      ...(filtros.idTelaColor === undefined ? {} : { idTelaColor: filtros.idTelaColor }),
      ...(filtros.idTela === undefined ? {} : { telaColor: { idTela: filtros.idTela } }),
      AND: filtrosBusqueda,
    },
    select: {
      id: true,
      folio: true,
      idTelaColor: true,
      loteProveedor: true,
      factura: true,
      fecha: true,
      creadoEn: true,
      telaColor: { select: { nombre: true, tela: { select: { id: true, nombre: true } } } },
    },
    orderBy: { folio: 'desc' },
    take: MAX_PARTIDAS,
  });

  return {
    datos: partidas.map((p) => ({
      id: p.id,
      folio: Number(p.folio),
      idTelaColor: p.idTelaColor,
      telaColor: p.telaColor.nombre,
      idTela: p.telaColor.tela.id,
      tela: p.telaColor.tela.nombre,
      loteProveedor: p.loteProveedor,
      factura: p.factura,
      fecha: p.fecha === null ? null : p.fecha.toISOString().slice(0, 10),
      creadoEn: p.creadoEn.toISOString(),
    })),
  };
}
