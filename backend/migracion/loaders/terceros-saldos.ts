/**
 * Loader de SALDOS INICIALES de terceros (F9-E6; D15c) — el "punto de partida" de CxC/CxP que hoy
 * vive en SINUBE. Lee un CSV de FORMATO FLEXIBLE (export del contador / corte de SINUBE) y crea, por
 * cada renglón, un movimiento de APERTURA vía el MODO MIGRACIÓN del motor (`insertarAperturasMigradas`,
 * A1), por LOTES (regla dura de Gabriel), IDEMPOTENTE (por `MapeoMigracion` + la unique del `uuidCfdi`).
 *
 * FORMATO DE ENTRADA (encabezados case-insensitive; se documentan en `migracion/README.md`):
 *   Comunes (obligatorios): `tipo` (cliente|proveedor) · `rfc` y/o `nombre` (para localizar al tercero).
 *   Opcional: `empresa` (id o nombre; default = empresa favorita) · `saldoEsperado` (para el cuadre).
 *   Dos MODOS por renglón (Daniel pidió el detalle: cada factura pendiente con SU fecha → el aging
 *   funciona desde el día 1):
 *     • DETALLE de factura pendiente: `fecha` + `importe` + (`folio` y/o `uuid`).
 *         - con `uuid`  → cargo FISCAL (`factura_proveedor`/`factura_cliente`), rfc del tercero.
 *         - sin `uuid`  → cargo NO fiscal (`entrada_sin_factura`). Requiere `folio` (clave de idempotencia).
 *     • SALDO NETO por tercero: `saldo` (± ; sin desglose). saldo>0 → `entrada_sin_factura` (cargo);
 *         saldo<0 → `abono`. `fecha` opcional (default = corte). observaciones = "apertura SINUBE".
 *
 * SIGNO y VENCIMIENTO los pone el motor (no el ETL): el importe entra POSITIVO y `signoDeOrigen` /
 * `calcularVencimiento` (reusados de `cuenta-terceros.ts`) hacen el resto. Saldo = Σ movimientos (D3):
 * jamás una columna editable.
 *
 * NO SE CORRE todavía (D15c): los archivos fuente aún no existen (Daniel está sacando el corte de
 * SINUBE). Este loader se CONSTRUYE y PRUEBA con fixtures; se ejecuta cuando llegue el corte.
 */
import { readFileSync } from 'node:fs';

import { parse } from 'csv-parse/sync';
import iconv from 'iconv-lite';

import {
  insertarAperturasMigradas,
  type AperturaMigrada,
  type TerceroApertura,
} from '../../src/dominio/terceros/migracion.js';
import { normalizarRfc } from '../../src/dominio/terceros/cfdi/parser-cfdi.js';
import type { OrigenMovimientoTercero, PrismaClient, TipoTercero } from '../../src/datos/index.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';

import { CONCURRENCIA_ETL, enLotes } from '../comun/lotes.js';
import { cargarMapaNumerico, ENTIDAD_MAPEO, type ClienteMapeo } from '../comun/mapeo.js';
import { conReintentoTransitorio } from '../comun/reintentos.js';
import { parsearDinero, parsearFechaSoloDia, normalizarParaDedup } from '../comun/valores.js';
import type { Reporte } from '../comun/reporte.js';
import type { ResultadoLoader } from './clientes.js';

/** Tamaño de bloque para el `createManyAndReturn` (acota el tamaño de la transacción por lote). */
const TAMANO_BLOQUE = 300;

/** Concepto de cuenta corriente al que apunta un renglón parseado + el lookup del tercero. */
export interface AperturaParseada {
  tipoTercero: TipoTercero;
  /** RFC capturado en el renglón (para localizar al tercero y —si fiscal— sellar el movimiento). */
  rfc: string | null;
  /** Nombre capturado en el renglón (localización alterna cuando no hay RFC). */
  nombre: string | null;
  /** Empresa (id o nombre) del renglón; null = empresa por defecto (favorita / `--empresa`). */
  empresaRef: string | null;
  /** Total esperado del tercero (columna `saldoEsperado`), para el cuadre. Null si no viene. */
  saldoEsperado: number | null;
  /** El movimiento de apertura ya armado (origen/fecha/importe/fiscal/clave), sin el id del tercero. */
  movimiento: AperturaMigrada;
}

/** Una incidencia de parseo/carga (renglón omitido o dato dudoso), para el reporte (§7). */
export interface IncidenciaApertura {
  motivo: string;
  detalle: string;
}

/** Resultado del parseo puro (filas válidas + incidencias). */
export interface ResultadoParseoAperturas {
  filas: AperturaParseada[];
  incidencias: IncidenciaApertura[];
}

/** Opciones del parseo. */
export interface OpcionesParseo {
  /** Fecha de corte por defecto para renglones sin fecha (saldo neto). Default: hoy. */
  corte?: Date;
}

/** Lee una columna por cualquiera de sus alias (case-insensitive), ya trim; '' → null. */
function col(fila: Record<string, string>, ...nombres: string[]): string | null {
  for (const n of nombres) {
    const clave = Object.keys(fila).find((k) => k.trim().toLowerCase() === n.toLowerCase());
    if (clave !== undefined) {
      const v = (fila[clave] ?? '').trim();
      if (v !== '') return v;
    }
  }
  return null;
}

/** Normaliza el `tipo` del renglón a `cliente`/`proveedor` (acepta c/p, mayúsculas, plural). */
function parsearTipoTercero(crudo: string | null): TipoTercero | null {
  if (crudo === null) return null;
  const t = crudo.trim().toLowerCase();
  if (t === 'cliente' || t === 'clientes' || t === 'c' || t === 'cxc') return 'cliente';
  if (t === 'proveedor' || t === 'proveedores' || t === 'p' || t === 'cxp') return 'proveedor';
  return null;
}

/**
 * Fecha FLEXIBLE de una apertura: acepta ISO `YYYY-MM-DD` (export moderno del contador) o el
 * `DD/MM/YYYY` del sistema viejo (`parsearFechaSoloDia`). A medianoche UTC (columna `@db.Date`).
 */
function parsearFechaApertura(crudo: string | null): Date | null {
  if (crudo === null) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(crudo.trim());
  if (iso !== null) {
    const d = new Date(`${iso[1]!}-${iso[2]!}-${iso[3]!}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return parsearFechaSoloDia(crudo);
}

/** Clave estable del tercero para namespacing de la idempotencia (RFC normalizado, o nombre dedup). */
function claveTercero(rfc: string | null, nombre: string | null): string {
  if (rfc !== null && rfc.trim() !== '') return normalizarRfc(rfc);
  return `n:${normalizarParaDedup(nombre)}`;
}

/**
 * Parsea las filas crudas del CSV a aperturas estructuradas (PURA: sin BD). Cada fila válida sale con
 * su movimiento ya armado (origen/signo-neutro-importe-positivo/fiscal/clave de idempotencia); las
 * filas dudosas van a `incidencias` (nunca se pierde nada en silencio, §7).
 */
export function parsearAperturas(
  filas: Record<string, string>[],
  opciones: OpcionesParseo = {},
): ResultadoParseoAperturas {
  const corte = opciones.corte ?? new Date();
  const salida: AperturaParseada[] = [];
  const incidencias: IncidenciaApertura[] = [];

  filas.forEach((fila, indice) => {
    const ref = `fila ${String(indice + 2)}`; // +2: 1-based + cabecera
    const tipoTercero = parsearTipoTercero(col(fila, 'tipo', 'tipotercero', 'tipo_tercero'));
    if (tipoTercero === null) {
      incidencias.push({ motivo: 'Tipo de tercero inválido o ausente', detalle: ref });
      return;
    }
    const rfc = col(fila, 'rfc', 'rfctercero');
    const nombre = col(fila, 'nombre', 'razonsocial', 'razon_social', 'tercero');
    if (rfc === null && nombre === null) {
      incidencias.push({
        motivo: 'Renglón sin RFC ni nombre (no se puede localizar al tercero)',
        detalle: ref,
      });
      return;
    }
    const empresaRef = col(fila, 'empresa', 'idempresa', 'id_empresa');
    const saldoEsperado = parsearDinero(col(fila, 'saldoesperado', 'saldo_esperado', 'esperado'));
    const observaciones = col(fila, 'observaciones', 'obs', 'concepto');
    const uuid = col(fila, 'uuid', 'uuidcfdi', 'folio_fiscal', 'foliofiscal');
    const folioFuente = col(fila, 'folio', 'foliofuente', 'folio_fuente', 'factura');
    const importe = parsearDinero(col(fila, 'importe', 'monto', 'total'));
    const saldoNeto = parsearDinero(col(fila, 'saldo', 'saldoapertura', 'saldo_apertura'));
    const clave = claveTercero(rfc, nombre);

    // ── MODO DETALLE: una factura pendiente (importe / uuid / folio presentes) ──
    if (importe !== null || uuid !== null || folioFuente !== null) {
      const fecha = parsearFechaApertura(col(fila, 'fecha', 'fechadoc', 'fecha_documento'));
      if (fecha === null) {
        incidencias.push({
          motivo: 'Factura pendiente SIN fecha (obligatoria para el aging) — OMITIDA',
          detalle: `${ref} rfc=${rfc ?? '—'} folio=${folioFuente ?? '—'}`,
        });
        return;
      }
      const monto = importe ?? null;
      if (monto === null || monto <= 0) {
        incidencias.push({
          motivo: 'Factura pendiente con importe ausente o ≤ 0 — OMITIDA',
          detalle: `${ref} rfc=${rfc ?? '—'} folio=${folioFuente ?? '—'}`,
        });
        return;
      }
      let origen: OrigenMovimientoTercero;
      let esFiscal: boolean;
      let uuidCfdi: string | null = null;
      let claveFuente: string;
      if (uuid !== null) {
        // Cargo FISCAL: I → factura_proveedor / factura_cliente. La clave natural es el UUID (global).
        origen = tipoTercero === 'proveedor' ? 'factura_proveedor' : 'factura_cliente';
        esFiscal = true;
        uuidCfdi = uuid;
        claveFuente = `uuid:${uuid}`;
      } else {
        // Cargo NO fiscal (sin CFDI): requiere folio para poder ser idempotente.
        if (folioFuente === null) {
          incidencias.push({
            motivo: 'Factura sin UUID y sin folio (sin clave de idempotencia) — OMITIDA',
            detalle: `${ref} rfc=${rfc ?? '—'}`,
          });
          return;
        }
        origen = 'entrada_sin_factura';
        esFiscal = false;
        claveFuente = `folio:${tipoTercero}:${clave}:${folioFuente}`;
      }
      salida.push({
        tipoTercero,
        rfc,
        nombre,
        empresaRef,
        saldoEsperado,
        movimiento: {
          origen,
          fecha,
          importe: monto,
          esFiscal,
          uuidCfdi,
          rfcTercero: esFiscal ? rfc : null,
          observaciones:
            observaciones ?? `Apertura SINUBE${uuid !== null ? ` (CFDI ${uuid})` : ''}`,
          refTipo: null,
          refId: null,
          claveFuente,
        },
      });
      return;
    }

    // ── MODO SALDO NETO: un solo movimiento de apertura por tercero ──
    if (saldoNeto !== null) {
      if (saldoNeto === 0) {
        incidencias.push({ motivo: 'Saldo neto = 0 (nada que abrir) — OMITIDO', detalle: ref });
        return;
      }
      const fecha = parsearFechaApertura(col(fila, 'fecha')) ?? corte;
      const esCargo = saldoNeto > 0;
      const origen: OrigenMovimientoTercero = esCargo ? 'entrada_sin_factura' : 'abono';
      salida.push({
        tipoTercero,
        rfc,
        nombre,
        empresaRef,
        // SOLO el `saldoEsperado` EXPLÍCITO del corte (la cifra que declaró el contador). NO se rellena
        // con `saldoNeto`: si un tercero tiene una factura (con su saldoEsperado) + un abono neto, el
        // abono rellenaría y PISARÍA el esperado del tercero en el cuadre. Cuando NO hay esperado
        // declarado, el cuadre deriva el esperado sumando los renglones con su signo (que para un neto
        // único da el mismo saldoNeto) — así nunca se pisa el total declarado del tercero.
        saldoEsperado,
        movimiento: {
          origen,
          fecha,
          importe: Math.abs(saldoNeto),
          esFiscal: false,
          uuidCfdi: null,
          rfcTercero: null,
          observaciones: observaciones ?? 'Apertura SINUBE (saldo neto)',
          refTipo: null,
          refId: null,
          claveFuente: `neto:${tipoTercero}:${clave}`,
        },
      });
      return;
    }

    incidencias.push({
      motivo: 'Renglón sin importe/uuid/folio ni saldo (no es detalle ni neto) — OMITIDO',
      detalle: ref,
    });
  });

  return { filas: salida, incidencias };
}

/**
 * Lee un archivo CSV de aperturas y lo parsea. Encoding UTF-8 por defecto (export moderno del
 * contador/SINUBE); `cp850` disponible por si el corte sale del sistema viejo. NO usa `leerCsv` (ese
 * asume la carpeta `Respaldo CLAUDE/TABLAS/` en CP850): la fuente aquí es un archivo suelto.
 */
export function leerArchivoAperturas(
  ruta: string,
  opciones: OpcionesParseo & { encoding?: string } = {},
): ResultadoParseoAperturas {
  const buffer = readFileSync(ruta);
  const texto =
    (opciones.encoding ?? 'utf8').toLowerCase() === 'cp850'
      ? iconv.decode(buffer, 'cp850')
      : buffer.toString('utf8');
  const filas = parse(texto, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as Record<string, string>[];
  return parsearAperturas(filas, opciones);
}

/** Datos del tercero resueltos contra la BD (id + días de crédito). */
export interface TerceroResuelto extends TerceroApertura {
  nombre: string;
}

/** Índices de terceros por RFC y por nombre normalizado (para localizar el id + días de crédito). */
export interface IndiceTerceros {
  porRfc: Map<string, TerceroResuelto>;
  porNombre: Map<string, TerceroResuelto | null>; // null = nombre AMBIGUO (homónimos)
}

/** Construye los índices de clientes o proveedores para localizarlos por RFC / nombre. */
export async function indiceTerceros(
  cliente: PrismaClient,
  tipoTercero: TipoTercero,
): Promise<IndiceTerceros> {
  const filas =
    tipoTercero === 'cliente'
      ? await cliente.cliente.findMany({
          select: { id: true, nombre: true, rfc: true, diasCredito: true },
        })
      : await cliente.proveedor.findMany({
          select: { id: true, nombre: true, rfc: true, diasCredito: true },
        });
  const porRfc = new Map<string, TerceroResuelto>();
  const porNombre = new Map<string, TerceroResuelto | null>();
  for (const f of filas) {
    const resuelto: TerceroResuelto = {
      tipoTercero,
      idTercero: f.id,
      diasCredito: f.diasCredito ?? 0,
      nombre: f.nombre,
    };
    if (f.rfc !== null && f.rfc.trim() !== '') {
      porRfc.set(normalizarRfc(f.rfc), resuelto);
    }
    const claveNombre = normalizarParaDedup(f.nombre);
    if (claveNombre !== '') {
      porNombre.set(claveNombre, porNombre.has(claveNombre) ? null : resuelto);
    }
  }
  return { porRfc, porNombre };
}

/** Localiza al tercero de una fila por RFC (preferente) o nombre. Null si no lo encuentra / es ambiguo. */
export function resolverTercero(
  indice: IndiceTerceros,
  rfc: string | null,
  nombre: string | null,
): { tercero: TerceroResuelto | null; motivo: string | null } {
  if (rfc !== null && rfc.trim() !== '') {
    const porRfc = indice.porRfc.get(normalizarRfc(rfc));
    if (porRfc !== undefined) return { tercero: porRfc, motivo: null };
  }
  if (nombre !== null && nombre.trim() !== '') {
    const clave = normalizarParaDedup(nombre);
    const porNombre = indice.porNombre.get(clave);
    if (porNombre === null) {
      return { tercero: null, motivo: 'nombre AMBIGUO (homónimos en el catálogo)' };
    }
    if (porNombre !== undefined) return { tercero: porNombre, motivo: null };
  }
  return { tercero: null, motivo: 'tercero no encontrado en el catálogo (¿falta RFC/nombre?)' };
}

/** Opciones de la carga (empresa por defecto + fecha de corte). */
export interface OpcionesCargaAperturas {
  filas: AperturaParseada[];
  /** Empresa por defecto cuando el renglón no trae `empresa` (id). */
  idEmpresaDefault: number;
}

/** Un bloque listo para insertar (una empresa + un tercero + sus movimientos nuevos). */
interface BloqueAperturas {
  idEmpresa: number;
  tercero: TerceroApertura;
  entradas: AperturaMigrada[];
}

/**
 * Carga las aperturas ya parseadas: resuelve el tercero y la empresa de cada renglón, filtra las que YA
 * existen (por `MapeoMigracion` y por `uuidCfdi` global), agrupa por (empresa, tercero), y las inserta
 * por BLOQUES vía el modo migración. Idempotente y por lotes. Devuelve el resumen (creados/existentes/
 * omitidos). Las incidencias van al `reporte`.
 */
export async function cargarAperturas(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
  opciones: OpcionesCargaAperturas,
): Promise<ResultadoLoader> {
  const cli = cliente as PrismaClient;
  const resultado: ResultadoLoader = {
    creados: 0,
    existentes: 0,
    omitidos: 0,
    omitidosValidacion: 0,
  };

  // Índices de terceros + empresas (id/nombre) + claves ya cargadas (idempotencia).
  const indices: Record<TipoTercero, IndiceTerceros> = {
    cliente: await indiceTerceros(cli, 'cliente'),
    proveedor: await indiceTerceros(cli, 'proveedor'),
  };
  const empresas = await cli.empresa.findMany({ select: { id: true, nombre: true } });
  const empresaPorNombre = new Map<string, number>();
  const empresasIds = new Set<number>();
  for (const e of empresas) {
    empresaPorNombre.set(normalizarParaDedup(e.nombre), e.id);
    empresasIds.add(e.id);
  }
  const yaMapeadas = new Set(
    (await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.aperturaTercero)).keys(),
  );
  const uuidsExistentes = new Set(
    (
      await cli.movimientoTercero.findMany({
        where: { uuidCfdi: { not: null } },
        select: { uuidCfdi: true },
      })
    )
      .map((m) => m.uuidCfdi)
      .filter((u): u is string => u !== null),
  );

  // Resuelve la empresa de un renglón (id directo, nombre, o el default).
  const resolverEmpresa = (ref: string | null): number | null => {
    if (ref === null) return opciones.idEmpresaDefault;
    const comoId = Number(ref);
    if (Number.isInteger(comoId) && empresasIds.has(comoId)) return comoId;
    return empresaPorNombre.get(normalizarParaDedup(ref)) ?? null;
  };

  // Agrupa las filas NUEVAS por (empresa, tercero).
  const grupos = new Map<string, BloqueAperturas>();
  for (const f of opciones.filas) {
    const idEmpresa = resolverEmpresa(f.empresaRef);
    if (idEmpresa === null) {
      resultado.omitidos += 1;
      reporte.agregar(
        'Apertura con empresa no encontrada (OMITIDA)',
        `empresa=${f.empresaRef ?? '?'}`,
      );
      continue;
    }
    const { tercero, motivo } = resolverTercero(indices[f.tipoTercero], f.rfc, f.nombre);
    if (tercero === null) {
      resultado.omitidos += 1;
      reporte.agregar(
        'Apertura con tercero sin resolver (OMITIDA)',
        `${f.tipoTercero} rfc=${f.rfc ?? '—'} nombre=${f.nombre ?? '—'} · ${motivo ?? ''}`,
      );
      continue;
    }
    // Ya cargada (idempotencia): por MapeoMigracion o por UUID global ya presente.
    const clave = f.movimiento.claveFuente;
    const uuid = f.movimiento.uuidCfdi;
    if (yaMapeadas.has(clave) || (uuid != null && uuidsExistentes.has(uuid))) {
      resultado.existentes += 1;
      continue;
    }

    const llave = `${String(idEmpresa)}:${f.tipoTercero}:${String(tercero.idTercero)}`;
    const grupo = grupos.get(llave) ?? {
      idEmpresa,
      tercero: {
        tipoTercero: tercero.tipoTercero,
        idTercero: tercero.idTercero,
        diasCredito: tercero.diasCredito,
      },
      entradas: [],
    };
    grupo.entradas.push(f.movimiento);
    grupos.set(llave, grupo);
  }

  // Aplana en bloques acotados (TAMANO_BLOQUE) y los inserta con concurrencia acotada.
  const bloques: BloqueAperturas[] = [];
  for (const g of grupos.values()) {
    for (let i = 0; i < g.entradas.length; i += TAMANO_BLOQUE) {
      bloques.push({ ...g, entradas: g.entradas.slice(i, i + TAMANO_BLOQUE) });
    }
  }

  const contribs = await enLotes(
    bloques,
    (b) =>
      conReintentoTransitorio(() =>
        insertarAperturasMigradas(
          sesion,
          b.idEmpresa,
          b.tercero,
          ENTIDAD_MAPEO.aperturaTercero,
          b.entradas,
          {
            cliente: cli,
          },
        ),
      ),
    CONCURRENCIA_ETL,
  );

  for (let i = 0; i < contribs.length; i += 1) {
    const res = contribs[i]!;
    if (res.ok) {
      resultado.creados += res.valor.creados;
    } else {
      const n = bloques[i]?.entradas.length ?? 0;
      resultado.omitidosValidacion = (resultado.omitidosValidacion ?? 0) + n;
      reporte.agregar(
        'Bloque de aperturas OMITIDO por error',
        `n=${String(n)} · ${res.error instanceof Error ? res.error.message : String(res.error)}`,
      );
    }
  }

  return resultado;
}
