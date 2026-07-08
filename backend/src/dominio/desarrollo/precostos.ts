/**
 * Precosto PERSISTIDO por desarrollo (F8-E3, D13/R17/R18/R19) — el CORAZÓN de la fase.
 *
 * Convierte el pre-costo "al vuelo" de F7 en filas `Precosto`/`PrecostoLinea` calculadas desde el BOM
 * del modelo con los PRECIOS AMARRADOS de E1 (`resolverPrecioTela`/`resolverPrecioAvio`), el PROMEDIO
 * SIMPLE de las medidas por talla (R18, decisión (g)) y N conceptos de costo (R19), versionable por
 * CONGELADO INMUTABLE (base del re-costeo de negociación, E5).
 *
 * Innegociables aplicados:
 *  • A1 — toda la lógica vive aquí; las rutas sólo validan permiso + Zod y delegan.
 *  • A2 — cada operación multi-tabla (precosto + renglones + bitácora) va en UNA transacción.
 *  • A3 — la VERSIÓN se genera bajo `pg_advisory_xact_lock` por desarrollo (NUNCA Max()+1 en carrera);
 *    el `@@unique([idDesarrollo, version])` la respalda. Además, a lo más UN borrador por desarrollo.
 *  • A7 — auditoría uniforme (`creadoPorId`/`modificadoPorId`) + `Bitacora` en la misma tx.
 *  • A9 — scope por empresa activa en TODA lectura/mutación (el precosto cuelga de desarrollo→proyecto→
 *    empresa); un precosto de otra empresa, para esta sesión, no existe.
 *  • D3 (espíritu) — las versiones CONGELADAS son INMUTABLES: cualquier recalcular/editar/congelar
 *    sobre un congelado → `ErrorConflicto`. Para cambiar, se genera una versión nueva.
 *
 * NO duplica aritmética: reutiliza `redondear2`/`num`/`numOrNull` (`../costos/decimales.js`) y la
 * cascada de precios amarrados (`../costos/resolucion-precios.js`). La REGALÍA no es concepto del costo
 * (D2: va SOBRE la venta — factor de la lista, E4): no se incluye.
 */
import {
  esquemaPrecostoLineaEditar,
  esquemaPrecostoLineaManualCrear,
  type DatosPrecostoLineaEditar,
  type DatosPrecostoLineaManualCrear,
  type PrecostoLineaSalida,
  type PrecostoResumen,
  type PrecostoSalida,
  type PrecostosDesarrolloLista,
} from '../../contrato/esquemas/precosto.js';
import type { Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { CODIGO_PRISMA, codigoErrorPrisma } from '../../comun/prisma-errores.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { num, numOrNull, redondear2 } from '../costos/decimales.js';
import { resolverPrecioAvio, resolverPrecioTela } from '../costos/resolucion-precios.js';

/** Entradas tipadas de las mutaciones (forma del esquema compartido). */
export type EntradaLineaManual = z.input<typeof esquemaPrecostoLineaManualCrear>;
export type EntradaLineaEditar = z.input<typeof esquemaPrecostoLineaEditar>;

/**
 * Namespace del `pg_advisory_xact_lock` para SERIALIZAR la generación de versión + la regla "un solo
 * borrador" por desarrollo. La segunda tx que genere para el MISMO desarrollo espera a la primera.
 */
const NAMESPACE_LOCK_PRECOSTO = 20_531;

/**
 * Códigos de concepto BASE que el motor del precosto alimenta directo (NO manuales del usuario): del
 * BOM (tela/avíos/bordado) o los costos fijos por prenda (maquila y —rediseño R5, B8— corte). Los
 * siembra el seed con `fijo=true` salvo `bordado`. `corte` es el renglón nuevo de R5 (costo de corte
 * separado de la costura; decisión Daniel).
 */
const CONCEPTOS_BOM = ['tela', 'avios', 'maquila', 'corte', 'bordado'] as const;

/** Ids de los conceptos base resueltos por código (se leen una vez por operación). */
interface ConceptosBase {
  tela: number;
  avios: number;
  maquila: number;
  /** Corte (rediseño R5, B8): costo fijo por prenda separado de la maquila. */
  corte: number;
  bordado: number;
}

// ── BOM del modelo (mismas banderas paraPreCosto que F7 + medidas por talla, R18) ──────────────────

/**
 * `include` del BOM `paraPreCosto` con los precios de catálogo Y el AMARRE de E1. Es el de F7
 * (`incluirReceta`) MÁS `consumoPorTalla` + `tallas` de avíos (R18): cuando un avío se consume por
 * talla, el precosto usa el PROMEDIO SIMPLE de sus medidas capturadas (decisión (g)).
 */
const incluirBomModelo = {
  telas: {
    where: { paraPreCosto: true },
    select: {
      idTela: true,
      consumoPorPrenda: true,
      idTelaProveedor: true,
      telaProveedor: { select: { precio: true, manejaPrecioPorColor: true } },
      tela: { select: { nombre: true, precioSugerido: true } },
    },
  },
  avios: {
    where: { paraPreCosto: true },
    select: {
      idAvio: true,
      consumoPorPrenda: true,
      consumoPorTalla: true,
      idAvioProveedor: true,
      avio: {
        select: {
          clave: true,
          descripcion: true,
          precioReferencia: true,
          factorConversion: true,
          proveedores: { select: { idProveedor: true, precio: true, factorConversion: true } },
          // R5, B11: medidas ACTIVAS del avío "por medida". Si trae ≥1, el precosto usa el PROMEDIO
          // SIMPLE de sus precios (decisión Daniel) en vez de la cascada por proveedor.
          medidas: { where: { activo: true }, select: { precio: true } },
        },
      },
      tallas: { select: { consumo: true } },
    },
  },
  bordados: {
    select: {
      idBordado: true,
      precio: true,
      bordado: { select: { nombre: true, precio: true } },
    },
  },
} satisfies Prisma.ModeloInclude;

type ModeloConBom = Prisma.ModeloGetPayload<{ include: typeof incluirBomModelo }>;

/** Un renglón nuevo (sin `idPrecosto`, que se agrega al insertar en lote). */
type LineaNueva = Omit<Prisma.PrecostoLineaCreateManyInput, 'idPrecosto'>;

/** Promedio SIMPLE de una lista de números (asume no vacía; el llamador lo garantiza). */
function promedioSimple(valores: number[]): number {
  return valores.reduce((s, v) => s + v, 0) / valores.length;
}

/** Orígenes que salen del BOM (se regeneran al recalcular salvo que estén AJUSTADOS, B12). */
const ORIGENES_BOM = ['bom_tela', 'bom_avio', 'bom_bordado'] as const;

/** Códigos de los conceptos ANCLA fijos (rediseño R5): un renglón `manual` por prenda, único, que se
 * EDITA pero NO se elimina ni se agrega dos veces (maquila/costura y corte). */
const CONCEPTOS_ANCLA = ['maquila', 'corte'] as const;

/**
 * ¿Es un renglón ANCLA fijo (B8/B12)? Los renglones auto-creados de maquila y corte: origen `manual`
 * + concepto fijo `maquila`/`corte`. Son ÚNICOS por precosto, editables pero NO eliminables (a
 * diferencia del resto, que en un borrador sí se puede quitar en la calculadora de negociación).
 */
function esAnclaFija(origen: string, conceptoCodigo: string): boolean {
  return origen === 'manual' && (CONCEPTOS_ANCLA as readonly string[]).includes(conceptoCodigo);
}

/** Clave de identidad de un renglón BOM (origen + insumo) para casar ajustes con la regeneración. */
function claveBom(l: {
  origen: string | null | undefined;
  idTela?: number | null;
  idAvio?: number | null;
  idBordado?: number | null;
}): string {
  return `${l.origen ?? ''}:${l.idTela ?? ''}:${l.idAvio ?? ''}:${l.idBordado ?? ''}`;
}

/**
 * Construye los renglones de ORIGEN BOM (tela/avío/bordado) de un modelo. La tela y el avío se valúan
 * con la CASCADA de precios amarrados de E1 (tela: amarre → sugerido; avío: amarre → más barato →
 * referencia); el avío por talla usa el PROMEDIO de sus medidas (R18). El bordado entra UNA vez, sin
 * cantidad. Determinista: mismos datos ⇒ mismos renglones (la usa `generar` y `recalcular`).
 */
function lineasBomDesdeModelo(
  modelo: ModeloConBom,
  conceptos: ConceptosBase,
  sesion: SesionUsuario,
): LineaNueva[] {
  const auditoria = datosCreacion(sesion);
  const lineas: LineaNueva[] = [];

  // TELA: consumo × precio resuelto (amarre → sugerido). Traza FIEL: `idTelaProveedor` sólo cuando el
  // precio SALIÓ del amarre (`amarre`/`amarre-color`); si cayó a color-referencia/sugerido, es null
  // (no mentimos "salió de este proveedor" cuando en realidad salió del sugerido genérico).
  for (const t of modelo.telas) {
    const consumo = num(t.consumoPorPrenda);
    const resuelto = resolverPrecioTela({
      precioSugerido: numOrNull(t.tela.precioSugerido),
      amarre:
        t.idTelaProveedor !== null && t.telaProveedor !== null
          ? {
              precio: numOrNull(t.telaProveedor.precio),
              manejaPrecioPorColor: t.telaProveedor.manejaPrecioPorColor,
            }
          : null,
    });
    const precioUnit = resuelto.precio ?? 0;
    const desdeAmarre = resuelto.origen === 'amarre' || resuelto.origen === 'amarre-color';
    lineas.push({
      idConceptoCosto: conceptos.tela,
      origen: 'bom_tela',
      idTela: t.idTela,
      idTelaProveedor: desdeAmarre ? t.idTelaProveedor : null,
      descripcion: t.tela.nombre,
      consumo,
      precioUnit,
      importe: redondear2(consumo * precioUnit),
      ...auditoria,
    });
  }

  // AVÍO: consumo (o PROMEDIO por talla) × precio resuelto. Traza: idAvio + proveedor REALMENTE usado.
  for (const a of modelo.avios) {
    const consumo =
      a.consumoPorTalla && a.tallas.length > 0
        ? promedioSimple(a.tallas.map((x) => num(x.consumo)))
        : num(a.consumoPorPrenda);
    // R5, B11: avío "por medida" (con ≥1 medida activa) → el precio = PROMEDIO SIMPLE de los precios
    // de las medidas (protege el costo sin desglosar; el desglose real vive en la compra/MRP). La
    // traza de proveedor queda en null (el precio NO salió de un proveedor sino del promedio de medidas).
    const porMedida = a.avio.medidas.length > 0;
    const resuelto = porMedida
      ? {
          precio: redondear2(promedioSimple(a.avio.medidas.map((m) => num(m.precio)))),
          idProveedor: null,
        }
      : resolverPrecioAvio({
          precioReferencia: numOrNull(a.avio.precioReferencia),
          factorConversionAvio: numOrNull(a.avio.factorConversion),
          idAvioProveedor: a.idAvioProveedor,
          proveedores: a.avio.proveedores.map((p) => ({
            idProveedor: p.idProveedor,
            precio: numOrNull(p.precio),
            factorConversion: numOrNull(p.factorConversion),
          })),
        });
    const precioUnit = resuelto.precio ?? 0;
    lineas.push({
      idConceptoCosto: conceptos.avios,
      origen: 'bom_avio',
      idAvio: a.idAvio,
      // El proveedor cuyo precio se USÓ (amarre o más barato); null si salió de referencia/medidas.
      idAvioProveedor: resuelto.idProveedor,
      descripcion: `${a.avio.clave} — ${a.avio.descripcion}`,
      consumo,
      precioUnit,
      importe: redondear2(consumo * precioUnit),
      ...auditoria,
    });
  }

  // BORDADO/ESTAMPADO: precio del renglón del modelo (o el del catálogo), UNA vez, sin cantidad.
  for (const b of modelo.bordados) {
    const precio = redondear2(b.precio === null ? num(b.bordado.precio) : b.precio.toNumber());
    lineas.push({
      idConceptoCosto: conceptos.bordado,
      origen: 'bom_bordado',
      idBordado: b.idBordado,
      descripcion: b.bordado.nombre,
      consumo: null,
      precioUnit: precio,
      importe: precio,
      ...auditoria,
    });
  }

  return lineas;
}

/**
 * Renglón de MAQUILA (concepto fijo `maquila`, origen `manual` → EDITABLE luego). Su importe default es
 * `Modelo.maquilaBase` (como F7); no lleva consumo. Sobrevive al recalcular desde el BOM.
 */
function lineaMaquila(
  modelo: { maquilaBase: Prisma.Decimal | null },
  conceptos: ConceptosBase,
  sesion: SesionUsuario,
): LineaNueva {
  const maquila = redondear2(num(modelo.maquilaBase));
  return {
    idConceptoCosto: conceptos.maquila,
    origen: 'manual',
    descripcion: 'Maquila',
    consumo: null,
    precioUnit: maquila,
    importe: maquila,
    ...datosCreacion(sesion),
  };
}

/**
 * Renglón de CORTE (rediseño R5, B8): costo fijo por prenda SEPARADO de la maquila/costura (decisión
 * Daniel). Concepto fijo `corte`, origen `manual` (editable luego; sobrevive al recalcular). Su
 * importe default es `Modelo.corteBase` (o $0 si no se capturó); SIN proveedor. Espejo de `lineaMaquila`.
 */
function lineaCorte(
  modelo: { corteBase: Prisma.Decimal | null },
  conceptos: ConceptosBase,
  sesion: SesionUsuario,
): LineaNueva {
  const corte = redondear2(num(modelo.corteBase));
  return {
    idConceptoCosto: conceptos.corte,
    origen: 'manual',
    descripcion: 'Corte',
    consumo: null,
    precioUnit: corte,
    importe: corte,
    ...datosCreacion(sesion),
  };
}

/** Resuelve los ids de los conceptos BASE por código (falla claro si el seed no los sembró). */
async function conceptosBase(tx: Tx): Promise<ConceptosBase> {
  const filas = await tx.conceptoCosto.findMany({
    where: { codigo: { in: [...CONCEPTOS_BOM] } },
    select: { id: true, codigo: true },
  });
  const porCodigo = new Map(filas.map((f) => [f.codigo, f.id]));
  const exigir = (codigo: string): number => {
    const id = porCodigo.get(codigo);
    if (id === undefined) {
      throw new Error(
        `Falta el concepto de costo base "${codigo}" (¿se corrió el seed de F8-E1?).`,
      );
    }
    return id;
  };
  return {
    tela: exigir('tela'),
    avios: exigir('avios'),
    maquila: exigir('maquila'),
    corte: exigir('corte'),
    bordado: exigir('bordado'),
  };
}

// ── Proyección / lectura ────────────────────────────────────────────────────────────

/** `include` para leer un precosto con sus renglones + el concepto de cada uno (para agrupar/flags). */
const incluirPrecosto = {
  lineas: {
    orderBy: [{ conceptoCosto: { orden: 'asc' } }, { id: 'asc' }],
    include: {
      conceptoCosto: { select: { codigo: true, nombre: true, orden: true, fijo: true } },
    },
  },
} satisfies Prisma.PrecostoInclude;

type PrecostoConLineas = Prisma.PrecostoGetPayload<{ include: typeof incluirPrecosto }>;

/** Proyecta un renglón a la salida del contrato (importes en null sin `consultas.ver-importes`). */
function aLineaSalida(
  linea: PrecostoConLineas['lineas'][number],
  verImportes: boolean,
): PrecostoLineaSalida {
  const esAncla = esAnclaFija(linea.origen, linea.conceptoCosto.codigo);
  return {
    id: linea.id,
    idConceptoCosto: linea.idConceptoCosto,
    conceptoCodigo: linea.conceptoCosto.codigo,
    conceptoNombre: linea.conceptoCosto.nombre,
    conceptoOrden: linea.conceptoCosto.orden,
    conceptoFijo: linea.conceptoCosto.fijo,
    origen: linea.origen,
    descripcion: linea.descripcion,
    consumo: linea.consumo === null ? null : linea.consumo.toNumber(),
    precioUnit: verImportes ? linea.precioUnit.toNumber() : null,
    importe: verImportes ? linea.importe.toNumber() : null,
    notas: linea.notas,
    idTela: linea.idTela,
    idTelaProveedor: linea.idTelaProveedor,
    idAvio: linea.idAvio,
    idAvioProveedor: linea.idAvioProveedor,
    idBordado: linea.idBordado,
    // R5, B12: en la calculadora de negociación CUALQUIER renglón de un borrador se puede editar
    // (los BOM pasan a `ajustado`). La UI gatea la edición tras `precosto.congelado`.
    editable: true,
    // Todo se puede quitar en un borrador SALVO los anclas fijos (maquila/corte: se editan, no se
    // borran). Los BOM quitados reaparecen al recalcular (reset al BOM del modelo); los ajustados no.
    eliminable: !esAncla,
    // R5, B12: renglón de origen BOM ajustado a mano (recalcular no lo pisa; se puede restaurar).
    ajustado: linea.ajustado,
  };
}

/** Proyecta un precosto completo (con el total vivo = Σ importes) a la salida del contrato. */
function aPrecostoSalida(precosto: PrecostoConLineas, verImportes: boolean): PrecostoSalida {
  const totalVivo = redondear2(precosto.lineas.reduce((suma, l) => suma + l.importe.toNumber(), 0));
  return {
    id: precosto.id,
    idDesarrollo: precosto.idDesarrollo,
    version: precosto.version,
    estado: precosto.estado,
    congelado: precosto.estado === 'congelado',
    congeladoEn: precosto.congeladoEn === null ? null : precosto.congeladoEn.toISOString(),
    congeladoPorId: precosto.congeladoPorId,
    costoTotal: verImportes ? totalVivo : null,
    lineas: precosto.lineas.map((l) => aLineaSalida(l, verImportes)),
    creadoEn: precosto.creadoEn.toISOString(),
    creadoPorId: precosto.creadoPorId,
    modificadoEn: precosto.modificadoEn.toISOString(),
    modificadoPorId: precosto.modificadoPorId,
  };
}

// ── Helpers de existencia / estado ────────────────────────────────────────────────────

/** Desarrollo de la EMPRESA ACTIVA (A9), listo para precostear (no apagado). */
async function exigirDesarrolloParaPrecostear(
  tx: Tx,
  id: number,
  idEmpresa: number,
): Promise<{ id: number; idModelo: number }> {
  const desarrollo = await tx.desarrollo.findFirst({
    where: { id, proyecto: { idEmpresa } },
    select: { id: true, idModelo: true, apagado: true },
  });
  if (desarrollo === null) {
    throw new ErrorNoEncontrado('Desarrollo', id);
  }
  if (desarrollo.apagado) {
    throw new ErrorConflicto('No se puede precostear un desarrollo apagado; reactívalo primero.');
  }
  return { id: desarrollo.id, idModelo: desarrollo.idModelo };
}

/** Precosto de la empresa activa (A9), o `ErrorNoEncontrado`. */
async function exigirPrecosto(
  tx: Tx,
  id: number,
  idEmpresa: number,
): Promise<{ id: number; idDesarrollo: number; estado: string; version: number }> {
  const precosto = await tx.precosto.findFirst({
    where: { id, desarrollo: { proyecto: { idEmpresa } } },
    select: { id: true, idDesarrollo: true, estado: true, version: true },
  });
  if (precosto === null) {
    throw new ErrorNoEncontrado('Precosto', id);
  }
  return precosto;
}

/** Regla D3 (espíritu): un precosto CONGELADO es inmutable → cualquier cambio es `ErrorConflicto`. */
function exigirBorrador(precosto: { estado: string; version: number }): void {
  if (precosto.estado !== 'borrador') {
    throw new ErrorConflicto(
      `El precosto v${precosto.version} está CONGELADO (inmutable); genera una versión nueva para cambiarlo.`,
    );
  }
}

/**
 * Lock transaccional por DESARROLLO (advisory). SERIALIZA todas las mutaciones del mismo desarrollo
 * (generar + editar/agregar/eliminar/recalcular/congelar): la 2ª tx espera a la 1ª hasta su commit.
 * Es lo que hace segura la invariante D3 bajo concurrencia — sin él, un `editarLinea` podría leer el
 * precosto como `borrador`, mientras `congelarVersion` corre en paralelo y lo congela, y terminar
 * escribiendo sobre un precosto YA congelado (write-skew). Tomándolo ANTES de leer el estado, la 2ª
 * operación re-lee bajo el lock, ve el congelado y aborta limpio en `exigirBorrador`.
 */
async function bloquearDesarrollo(tx: Tx, idDesarrollo: number): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NAMESPACE_LOCK_PRECOSTO}::int, ${idDesarrollo}::int)`;
}

/**
 * Resuelve el desarrollo (empresa activa, A9) de un precosto y toma su lock. Se usa al inicio de las
 * mutaciones que reciben `idPrecosto`, para que `exigirPrecosto`/`exigirBorrador` corran BAJO el lock.
 */
async function bloquearDesarrolloDePrecosto(
  tx: Tx,
  idPrecosto: number,
  idEmpresa: number,
): Promise<void> {
  const precosto = await tx.precosto.findFirst({
    where: { id: idPrecosto, desarrollo: { proyecto: { idEmpresa } } },
    select: { idDesarrollo: true },
  });
  if (precosto === null) {
    throw new ErrorNoEncontrado('Precosto', idPrecosto);
  }
  await bloquearDesarrollo(tx, precosto.idDesarrollo);
}

// ── Operaciones ─────────────────────────────────────────────────────────────────────

/**
 * GENERA un precosto BORRADOR (siguiente versión) desde el BOM del modelo del desarrollo, con los
 * renglones de tela/avío/bordado valuados con los precios amarrados (E1) + la maquila base. A lo más UN
 * borrador por desarrollo (serializado con advisory lock, A3). Requiere `desarrollo.precostear`.
 */
export async function generarPrecosto(
  sesion: SesionUsuario,
  idDesarrollo: number,
  bd?: ContextoBd,
): Promise<PrecostoSalida> {
  verificarPermiso(sesion, 'desarrollo.precostear');

  const idNuevo = await enTransaccion(async (tx) => {
    // Serializa versión + "un solo borrador" + toda mutación del desarrollo (A3/D3; NUNCA Max()+1).
    await bloquearDesarrollo(tx, idDesarrollo);
    const desarrollo = await exigirDesarrolloParaPrecostear(
      tx,
      idDesarrollo,
      sesion.idEmpresaActiva,
    );

    const borrador = await tx.precosto.findFirst({
      where: { idDesarrollo, estado: 'borrador' },
      select: { version: true },
    });
    if (borrador !== null) {
      throw new ErrorConflicto(
        `El desarrollo ya tiene un precosto en BORRADOR (v${borrador.version}); congélalo o edítalo antes de generar otro.`,
      );
    }

    const ultima = await tx.precosto.aggregate({
      where: { idDesarrollo },
      _max: { version: true },
    });
    const version = (ultima._max.version ?? 0) + 1;

    const modelo = await tx.modelo.findUnique({
      where: { id: desarrollo.idModelo },
      include: incluirBomModelo,
    });
    if (modelo === null) {
      throw new ErrorNoEncontrado('Modelo', desarrollo.idModelo);
    }
    const conceptos = await conceptosBase(tx);
    const lineas = [
      ...lineasBomDesdeModelo(modelo, conceptos, sesion),
      lineaCorte(modelo, conceptos, sesion),
      lineaMaquila(modelo, conceptos, sesion),
    ];

    let precostoId: number;
    try {
      const creado = await tx.precosto.create({
        data: { idDesarrollo, version, estado: 'borrador', ...datosCreacion(sesion) },
        select: { id: true },
      });
      precostoId = creado.id;
    } catch (error) {
      if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
        throw new ErrorConflicto('Se generó otra versión al mismo tiempo; vuelve a intentar.', {
          causa: error,
        });
      }
      throw error;
    }

    await tx.precostoLinea.createMany({
      data: lineas.map((l) => ({ ...l, idPrecosto: precostoId })),
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Precosto',
      idEntidad: precostoId,
      accion: 'CREAR',
      datos: { idDesarrollo, version, renglones: lineas.length },
    });

    return precostoId;
  }, bd);

  return obtenerPrecosto(sesion, idNuevo, bd);
}

/**
 * RECALCULA los renglones de origen BOM (tela/avío/bordado) desde el modelo, SIN tocar los MANUALES
 * (maquila editada y conceptos abiertos sobreviven). Sólo sobre un BORRADOR. Requiere
 * `desarrollo.precostear`.
 */
export async function recalcularDesdeBom(
  sesion: SesionUsuario,
  idPrecosto: number,
  bd?: ContextoBd,
): Promise<PrecostoSalida> {
  verificarPermiso(sesion, 'desarrollo.precostear');

  await enTransaccion(async (tx) => {
    // Lock por desarrollo ANTES de leer el estado: `exigirBorrador` corre serializado (evita el
    // write-skew que violaría D3 si otra tx congela en paralelo).
    await bloquearDesarrolloDePrecosto(tx, idPrecosto, sesion.idEmpresaActiva);
    const precosto = await exigirPrecosto(tx, idPrecosto, sesion.idEmpresaActiva);
    exigirBorrador(precosto);

    const desarrollo = await tx.desarrollo.findUnique({
      where: { id: precosto.idDesarrollo },
      select: { idModelo: true },
    });
    // El precosto ya está en scope, así que su desarrollo existe; defensivo por tipos.
    if (desarrollo === null) {
      throw new ErrorNoEncontrado('Desarrollo', precosto.idDesarrollo);
    }
    const modelo = await tx.modelo.findUnique({
      where: { id: desarrollo.idModelo },
      include: incluirBomModelo,
    });
    if (modelo === null) {
      throw new ErrorNoEncontrado('Modelo', desarrollo.idModelo);
    }
    const conceptos = await conceptosBase(tx);

    // R5, B12: los renglones BOM AJUSTADOS a mano en la negociación se PRESERVAN (no se regeneran).
    // Se borran sólo los BOM no ajustados y se re-generan del modelo, SALTANDO los insumos que ya
    // tienen un renglón ajustado (evita duplicar la misma tela/avío/bordado). Los quitados a mano SÍ
    // reaparecen (recalcular = reset explícito al BOM del modelo); para conservar un cambio definitivo
    // se edita el BOM del modelo. Los `manual` (maquila/corte/procesos) nunca los toca este recalcular.
    const ajustadas = await tx.precostoLinea.findMany({
      where: { idPrecosto, ajustado: true, origen: { in: [...ORIGENES_BOM] } },
      select: { origen: true, idTela: true, idAvio: true, idBordado: true },
    });
    const clavesAjustadas = new Set(ajustadas.map(claveBom));

    await tx.precostoLinea.deleteMany({
      where: { idPrecosto, origen: { in: [...ORIGENES_BOM] }, ajustado: false },
    });
    const lineas = lineasBomDesdeModelo(modelo, conceptos, sesion).filter(
      (l) => !clavesAjustadas.has(claveBom(l)),
    );
    if (lineas.length > 0) {
      await tx.precostoLinea.createMany({
        data: lineas.map((l) => ({ ...l, idPrecosto })),
      });
    }
    await tx.precosto.update({ where: { id: idPrecosto }, data: { ...datosModificacion(sesion) } });

    await registrarBitacora(tx, sesion, {
      entidad: 'Precosto',
      idEntidad: idPrecosto,
      accion: 'MODIFICAR',
      datos: { operacion: 'recalcular-bom', renglones: lineas.length },
    });
  }, bd);

  return obtenerPrecosto(sesion, idPrecosto, bd);
}

/**
 * Agrega un renglón MANUAL (estampado, otros procesos, otros…) contra un `ConceptoCosto` activo y NO
 * fijo. El importe = `consumo × precioUnit` (si hay consumo) o `precioUnit` a secas. Sólo sobre un
 * BORRADOR. Requiere `desarrollo.precostear`.
 *
 * Se RECHAZAN sólo los conceptos ANCLA (`maquila`/`corte`): son ÚNICOS por prenda y ya tienen su
 * renglón auto-creado (se EDITA, no se duplica). Cualquier otro concepto activo se puede agregar a
 * mano — incluidos tela/avíos como renglón de la calculadora de negociación (R5, B12): un manual bajo
 * tela/avíos queda `origen:'manual'`, sobrevive al recalcular (no viene del BOM) y ES eliminable
 * (`eliminable = !esAncla`), así que no queda atrapado como antes.
 */
export async function agregarLineaManual(
  sesion: SesionUsuario,
  idPrecosto: number,
  entrada: EntradaLineaManual,
  bd?: ContextoBd,
): Promise<PrecostoSalida> {
  verificarPermiso(sesion, 'desarrollo.precostear');
  const datos: DatosPrecostoLineaManualCrear = validarEntrada(
    esquemaPrecostoLineaManualCrear,
    entrada,
  );

  await enTransaccion(async (tx) => {
    // Lock por desarrollo ANTES de leer el estado: `exigirBorrador` corre serializado (evita el
    // write-skew que violaría D3 si otra tx congela en paralelo).
    await bloquearDesarrolloDePrecosto(tx, idPrecosto, sesion.idEmpresaActiva);
    const precosto = await exigirPrecosto(tx, idPrecosto, sesion.idEmpresaActiva);
    exigirBorrador(precosto);

    const concepto = await tx.conceptoCosto.findUnique({
      where: { id: datos.idConceptoCosto },
      select: { id: true, codigo: true, nombre: true, activo: true, fijo: true },
    });
    if (concepto === null) {
      throw new ErrorNoEncontrado('ConceptoCosto', datos.idConceptoCosto);
    }
    if (!concepto.activo) {
      throw new ErrorConflicto(`El concepto de costo "${concepto.nombre}" está desactivado.`);
    }
    if ((CONCEPTOS_ANCLA as readonly string[]).includes(concepto.codigo)) {
      throw new ErrorConflicto(
        `El concepto "${concepto.nombre}" ya tiene su renglón fijo por prenda; edítalo en vez de agregar otro.`,
      );
    }

    const consumo = datos.consumo ?? null;
    const importe =
      consumo === null ? redondear2(datos.precioUnit) : redondear2(consumo * datos.precioUnit);

    const linea = await tx.precostoLinea.create({
      data: {
        idPrecosto,
        idConceptoCosto: concepto.id,
        origen: 'manual',
        descripcion: datos.descripcion ?? concepto.nombre,
        consumo,
        precioUnit: datos.precioUnit,
        importe,
        ...(datos.notas === undefined ? {} : { notas: datos.notas }),
        ...datosCreacion(sesion),
      },
      select: { id: true },
    });
    await tx.precosto.update({ where: { id: idPrecosto }, data: { ...datosModificacion(sesion) } });

    await registrarBitacora(tx, sesion, {
      entidad: 'Precosto',
      idEntidad: idPrecosto,
      accion: 'MODIFICAR',
      datos: { operacion: 'agregar-linea', idLinea: linea.id, idConcepto: concepto.id },
    });
  }, bd);

  return obtenerPrecosto(sesion, idPrecosto, bd);
}

/**
 * Edita CUALQUIER renglón de un borrador (rediseño R5, B12 — calculadora de negociación en vivo):
 * descripción/consumo/precio/notas (PATCH parcial). El importe se recompone. Si el renglón viene del
 * BOM (tela/avío/bordado), al editarlo pasa a `ajustado=true` (traza) para que `recalcularDesdeBom`
 * NO lo pise; `restaurarLineaBom` lo revierte al valor del BOM. Los manuales se editan igual que
 * antes. Sólo sobre un BORRADOR. Requiere `desarrollo.precostear`.
 */
export async function editarLinea(
  sesion: SesionUsuario,
  idPrecosto: number,
  idLinea: number,
  entrada: EntradaLineaEditar,
  bd?: ContextoBd,
): Promise<PrecostoSalida> {
  verificarPermiso(sesion, 'desarrollo.precostear');
  const datos: DatosPrecostoLineaEditar = validarEntrada(esquemaPrecostoLineaEditar, entrada);

  await enTransaccion(async (tx) => {
    // Lock por desarrollo ANTES de leer el estado: `exigirBorrador` corre serializado (evita el
    // write-skew que violaría D3 si otra tx congela en paralelo).
    await bloquearDesarrolloDePrecosto(tx, idPrecosto, sesion.idEmpresaActiva);
    const precosto = await exigirPrecosto(tx, idPrecosto, sesion.idEmpresaActiva);
    exigirBorrador(precosto);

    const linea = await tx.precostoLinea.findFirst({
      where: { id: idLinea, idPrecosto },
      select: { id: true, origen: true, descripcion: true, consumo: true, precioUnit: true },
    });
    if (linea === null) {
      throw new ErrorNoEncontrado('PrecostoLinea', idLinea);
    }

    const descripcion = datos.descripcion ?? linea.descripcion;
    const consumo = datos.consumo === undefined ? numOrNull(linea.consumo) : datos.consumo;
    const precioUnit =
      datos.precioUnit === undefined ? linea.precioUnit.toNumber() : datos.precioUnit;
    const importe = consumo === null ? redondear2(precioUnit) : redondear2(consumo * precioUnit);
    // Editar un renglón de origen BOM lo marca AJUSTADO (B12): recalcular ya no lo pisa.
    const esBom = (ORIGENES_BOM as readonly string[]).includes(linea.origen);

    await tx.precostoLinea.update({
      where: { id: idLinea },
      data: {
        descripcion,
        consumo,
        precioUnit,
        importe,
        ...(esBom ? { ajustado: true } : {}),
        ...(datos.notas === undefined ? {} : { notas: datos.notas }),
        ...datosModificacion(sesion),
      },
    });
    await tx.precosto.update({ where: { id: idPrecosto }, data: { ...datosModificacion(sesion) } });

    await registrarBitacora(tx, sesion, {
      entidad: 'Precosto',
      idEntidad: idPrecosto,
      accion: 'MODIFICAR',
      datos: { operacion: 'editar-linea', idLinea },
    });
  }, bd);

  return obtenerPrecosto(sesion, idPrecosto, bd);
}

/**
 * Quita un renglón de un borrador (rediseño R5, B12): en la calculadora de negociación se puede
 * quitar CUALQUIER renglón (una tela/avío/proceso — "se quitan bolsas traseras") SALVO los ANCLAS
 * fijos (maquila/corte: se editan, no se borran). Un renglón de origen BOM quitado reaparece al
 * `recalcularDesdeBom` (reset al BOM del modelo); para quitarlo definitivamente se edita el BOM del
 * modelo. Sólo sobre un BORRADOR. Requiere `desarrollo.precostear`.
 */
export async function eliminarLinea(
  sesion: SesionUsuario,
  idPrecosto: number,
  idLinea: number,
  bd?: ContextoBd,
): Promise<PrecostoSalida> {
  verificarPermiso(sesion, 'desarrollo.precostear');

  await enTransaccion(async (tx) => {
    // Lock por desarrollo ANTES de leer el estado: `exigirBorrador` corre serializado (evita el
    // write-skew que violaría D3 si otra tx congela en paralelo).
    await bloquearDesarrolloDePrecosto(tx, idPrecosto, sesion.idEmpresaActiva);
    const precosto = await exigirPrecosto(tx, idPrecosto, sesion.idEmpresaActiva);
    exigirBorrador(precosto);

    const linea = await tx.precostoLinea.findFirst({
      where: { id: idLinea, idPrecosto },
      select: { id: true, origen: true, conceptoCosto: { select: { codigo: true, nombre: true } } },
    });
    if (linea === null) {
      throw new ErrorNoEncontrado('PrecostoLinea', idLinea);
    }
    if (esAnclaFija(linea.origen, linea.conceptoCosto.codigo)) {
      throw new ErrorConflicto(
        `El renglón de "${linea.conceptoCosto.nombre}" es fijo por prenda; se edita pero no se elimina.`,
      );
    }

    await tx.precostoLinea.delete({ where: { id: idLinea } });
    await tx.precosto.update({ where: { id: idPrecosto }, data: { ...datosModificacion(sesion) } });

    await registrarBitacora(tx, sesion, {
      entidad: 'Precosto',
      idEntidad: idPrecosto,
      accion: 'MODIFICAR',
      datos: { operacion: 'eliminar-linea', idLinea },
    });
  }, bd);

  return obtenerPrecosto(sesion, idPrecosto, bd);
}

/**
 * RESTAURA un renglón de origen BOM AJUSTADO (rediseño R5, B12) al valor del BOM del modelo: recupera
 * consumo/precio/proveedor del BOM vigente y limpia `ajustado`. Si el insumo YA NO existe en el BOM
 * (se quitó del modelo), la restauración lo ELIMINA (queda igual que un recalcular). Sólo aplica a
 * renglones BOM ajustados de un BORRADOR. Requiere `desarrollo.precostear`.
 */
export async function restaurarLineaBom(
  sesion: SesionUsuario,
  idPrecosto: number,
  idLinea: number,
  bd?: ContextoBd,
): Promise<PrecostoSalida> {
  verificarPermiso(sesion, 'desarrollo.precostear');

  await enTransaccion(async (tx) => {
    await bloquearDesarrolloDePrecosto(tx, idPrecosto, sesion.idEmpresaActiva);
    const precosto = await exigirPrecosto(tx, idPrecosto, sesion.idEmpresaActiva);
    exigirBorrador(precosto);

    const linea = await tx.precostoLinea.findFirst({
      where: { id: idLinea, idPrecosto },
      select: {
        id: true,
        origen: true,
        ajustado: true,
        idTela: true,
        idAvio: true,
        idBordado: true,
      },
    });
    if (linea === null) {
      throw new ErrorNoEncontrado('PrecostoLinea', idLinea);
    }
    if (!(ORIGENES_BOM as readonly string[]).includes(linea.origen)) {
      throw new ErrorConflicto(
        'Sólo se restauran renglones que vienen del BOM (tela/avío/bordado).',
      );
    }

    const desarrollo = await tx.desarrollo.findUnique({
      where: { id: precosto.idDesarrollo },
      select: { idModelo: true },
    });
    if (desarrollo === null) {
      throw new ErrorNoEncontrado('Desarrollo', precosto.idDesarrollo);
    }
    const modelo = await tx.modelo.findUnique({
      where: { id: desarrollo.idModelo },
      include: incluirBomModelo,
    });
    if (modelo === null) {
      throw new ErrorNoEncontrado('Modelo', desarrollo.idModelo);
    }
    const conceptos = await conceptosBase(tx);
    const clave = claveBom(linea);
    const original = lineasBomDesdeModelo(modelo, conceptos, sesion).find(
      (l) => claveBom(l) === clave,
    );

    if (original === undefined) {
      // El insumo ya no está en el BOM del modelo → restaurar = quitar el renglón.
      await tx.precostoLinea.delete({ where: { id: idLinea } });
    } else {
      await tx.precostoLinea.update({
        where: { id: idLinea },
        data: {
          descripcion: original.descripcion,
          consumo: original.consumo ?? null,
          precioUnit: original.precioUnit,
          importe: original.importe,
          idTelaProveedor: original.idTelaProveedor ?? null,
          idAvioProveedor: original.idAvioProveedor ?? null,
          ajustado: false,
          ...datosModificacion(sesion),
        },
      });
    }
    await tx.precosto.update({ where: { id: idPrecosto }, data: { ...datosModificacion(sesion) } });

    await registrarBitacora(tx, sesion, {
      entidad: 'Precosto',
      idEntidad: idPrecosto,
      accion: 'MODIFICAR',
      datos: { operacion: 'restaurar-linea-bom', idLinea, eliminado: original === undefined },
    });
  }, bd);

  return obtenerPrecosto(sesion, idPrecosto, bd);
}

/**
 * CONGELA un borrador (A2): valida que tenga ≥1 renglón, calcula y PERSISTE `costoTotal` (Σ importes),
 * marca `estado=congelado` + `congeladoEn`/`congeladoPorId`. La versión queda INMUTABLE (D3). Al haber
 * ≥1 congelado, el estado DERIVADO del desarrollo pasa a "cotizado" SOLO (E2). Requiere
 * `desarrollo.precostear`.
 */
export async function congelarVersion(
  sesion: SesionUsuario,
  idPrecosto: number,
  bd?: ContextoBd,
): Promise<PrecostoSalida> {
  verificarPermiso(sesion, 'desarrollo.precostear');

  await enTransaccion(async (tx) => {
    // Lock por desarrollo ANTES de leer el estado: `exigirBorrador` corre serializado (evita el
    // write-skew que violaría D3 si otra tx congela en paralelo).
    await bloquearDesarrolloDePrecosto(tx, idPrecosto, sesion.idEmpresaActiva);
    const precosto = await exigirPrecosto(tx, idPrecosto, sesion.idEmpresaActiva);
    exigirBorrador(precosto);

    const lineas = await tx.precostoLinea.findMany({
      where: { idPrecosto },
      select: { importe: true },
    });
    if (lineas.length === 0) {
      throw new ErrorConflicto(
        'El precosto no tiene renglones; agrega al menos uno antes de congelar.',
      );
    }
    const costoTotal = redondear2(lineas.reduce((suma, l) => suma + l.importe.toNumber(), 0));

    await tx.precosto.update({
      where: { id: idPrecosto },
      data: {
        estado: 'congelado',
        congeladoEn: new Date(),
        congeladoPorId: sesion.id,
        costoTotal,
        ...datosModificacion(sesion),
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Precosto',
      idEntidad: idPrecosto,
      accion: 'MODIFICAR',
      datos: { operacion: 'congelar', version: precosto.version, costoTotal },
    });
  }, bd);

  return obtenerPrecosto(sesion, idPrecosto, bd);
}

/** Obtiene un precosto completo (con renglones) de la empresa activa, o `ErrorNoEncontrado`. */
export async function obtenerPrecosto(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<PrecostoSalida> {
  verificarPermiso(sesion, 'desarrollo.ver');
  const precosto = await clienteLectura(bd).precosto.findFirst({
    where: { id, desarrollo: { proyecto: { idEmpresa: sesion.idEmpresaActiva } } },
    include: incluirPrecosto,
  });
  if (precosto === null) {
    throw new ErrorNoEncontrado('Precosto', id);
  }
  return aPrecostoSalida(precosto, tienePermiso(sesion, 'consultas.ver-importes'));
}

/**
 * HISTORIAL de precostos de un desarrollo (más nuevo primero), como resúmenes con su total. Scope por
 * empresa activa (A9). Requiere `desarrollo.ver`.
 */
export async function listarPrecostosDeDesarrollo(
  sesion: SesionUsuario,
  idDesarrollo: number,
  bd?: ContextoBd,
): Promise<PrecostosDesarrolloLista> {
  verificarPermiso(sesion, 'desarrollo.ver');
  const cliente = clienteLectura(bd);

  const desarrollo = await cliente.desarrollo.findFirst({
    where: { id: idDesarrollo, proyecto: { idEmpresa: sesion.idEmpresaActiva } },
    select: { id: true },
  });
  if (desarrollo === null) {
    throw new ErrorNoEncontrado('Desarrollo', idDesarrollo);
  }

  const precostos = await cliente.precosto.findMany({
    where: { idDesarrollo },
    orderBy: { version: 'desc' },
    include: { lineas: { select: { importe: true } } },
  });
  const verImportes = tienePermiso(sesion, 'consultas.ver-importes');

  return precostos.map((p): PrecostoResumen => {
    const total = redondear2(p.lineas.reduce((suma, l) => suma + l.importe.toNumber(), 0));
    return {
      id: p.id,
      version: p.version,
      estado: p.estado,
      congelado: p.estado === 'congelado',
      costoTotal: verImportes ? total : null,
      congeladoEn: p.congeladoEn === null ? null : p.congeladoEn.toISOString(),
      congeladoPorId: p.congeladoPorId,
      creadoEn: p.creadoEn.toISOString(),
    };
  });
}
