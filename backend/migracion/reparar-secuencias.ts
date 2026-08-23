/**
 * REPARA TODAS las secuencias de folio contra el máximo REAL de su tabla (§Post-F9.17).
 *
 * POR QUÉ EXISTE — el defecto que lo motivó (reportado por Daniel, 7-ago-2026: *"hice la OC pero al
 * refrescar el listado, no la veo"*): los ETL que migran con folio EXPLÍCITO deben dejar su secuencia
 * adelantada al máximo migrado, o la primera captura nueva arranca en 1. De las 12 secuencias del
 * sistema, los ETL solo sembraban 4 (`pedido`, `orden`, `etapa-mov`, `auditoria`). Las **órdenes de
 * compra** (7,978 migradas, folios hasta ~7,920) y las **notas de salida** quedaron en 0 → la OC nueva
 * tomó folio 1 y, como el listado ordena por folio DESCENDENTE, se fue a la última página. Peor aún:
 * si el histórico ya tenía ese folio, la captura habría chocado contra el unique `(idEmpresa, folio)`.
 *
 * Este script NO es un parche de una vez: es la RED permanente. Recalcula toda secuencia con
 * histórico desde el máximo real por empresa, es **idempotente** y **monótono** (`sembrarSecuencia`
 * usa `GREATEST`: nunca RETROCEDE una serie que la captura ya avanzó). Se puede correr cuantas veces
 * se quiera, y conviene correrlo después de CUALQUIER ETL.
 *
 * Uso (desde `backend/`, SIEMPRE con --env-file: los `npm run` no lo llevan a propósito):
 *   npx tsx --env-file=.env migracion/reparar-secuencias.ts
 *
 * Las secuencias que NO se listan aquí son las que nacen en cero porque su histórico no se migra con
 * folio propio (`entrada-tela`, `partida-tela`, `proyecto`, `recepcion-compra`) o porque el ETL ya
 * las pide por secuencia y no explícitas (`movimiento`: los movimientos migrados salen del motor de
 * kardex, que siempre usa `siguienteFolio`).
 */
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

import { sembrarSecuencia } from '../src/comun/secuencias.js';
import { CLAVE_SECUENCIA_AUDITORIA } from '../src/dominio/calidad/auditorias.js';
import { CLAVE_SECUENCIA_ORDEN_COMPRA } from '../src/dominio/compras/ordenes-compra.js';
import { CLAVE_SECUENCIA_NOTA_SALIDA } from '../src/dominio/notas/notas-salida.js';
import { CLAVE_SECUENCIA_PEDIDO } from '../src/dominio/pedidos/pedidos.js';
import { CLAVE_SECUENCIA_ETAPA } from '../src/dominio/produccion/etapas.js';
import { CLAVE_SECUENCIA_ORDEN } from '../src/dominio/produccion/ordenes.js';
import { CLAVE_SECUENCIA_TERCERO } from '../src/dominio/terceros/cuenta-terceros.js';

/** Una serie a reparar: su clave y cómo leer el máximo folio por empresa. */
interface SerieAReparar {
  clave: string;
  /** Qué numera (para el reporte). */
  descripcion: string;
  maximos: (cliente: PrismaClient) => Promise<{ idEmpresa: number; max: bigint }[]>;
}

/**
 * Normaliza el `groupBy` de Prisma. El campo del folio NO se llama igual en todas las tablas
 * (`folio`, pero también `numCompra`, `numNota`, `numAuditoria`), así que se pasa por nombre.
 * `_max` puede venir null si el grupo no tiene filas con valor.
 */
function aMaximos<K extends string>(
  campo: K,
  filas: { idEmpresa: number; _max: Record<K, bigint | null> }[],
): { idEmpresa: number; max: bigint }[] {
  return filas.map((f) => ({ idEmpresa: f.idEmpresa, max: f._max[campo] ?? 0n }));
}

const SERIES: SerieAReparar[] = [
  {
    clave: CLAVE_SECUENCIA_PEDIDO,
    descripcion: 'pedidos internos',
    maximos: async (c) => {
      const filas = await c.pedido.groupBy({ by: ['idEmpresa'], _max: { folio: true } });
      return aMaximos('folio', filas);
    },
  },
  {
    clave: CLAVE_SECUENCIA_ORDEN,
    descripcion: 'órdenes de producción',
    maximos: async (c) => {
      const filas = await c.orden.groupBy({ by: ['idEmpresa'], _max: { folio: true } });
      return aMaximos('folio', filas);
    },
  },
  {
    clave: CLAVE_SECUENCIA_ETAPA,
    descripcion: 'etapas de producción (corte/envío/recibo/entrega)',
    maximos: async (c) => {
      const filas = await c.etapaMovimiento.groupBy({ by: ['idEmpresa'], _max: { folio: true } });
      return aMaximos('folio', filas);
    },
  },
  {
    clave: CLAVE_SECUENCIA_AUDITORIA,
    descripcion: 'auditorías de calidad',
    maximos: async (c) => {
      // Ojo: en auditorías el folio se llama `numAuditoria`.
      const filas = await c.auditoria.groupBy({ by: ['idEmpresa'], _max: { numAuditoria: true } });
      return aMaximos('numAuditoria', filas);
    },
  },
  // ── Las dos que faltaban y provocaron el defecto ────────────────────────────────────────────────
  {
    clave: CLAVE_SECUENCIA_ORDEN_COMPRA,
    descripcion: 'ÓRDENES DE COMPRA (la que faltaba)',
    maximos: async (c) => {
      const filas = await c.ordenCompra.groupBy({ by: ['idEmpresa'], _max: { numCompra: true } });
      return aMaximos('numCompra', filas);
    },
  },
  {
    clave: CLAVE_SECUENCIA_NOTA_SALIDA,
    descripcion: 'NOTAS DE SALIDA (la que faltaba)',
    maximos: async (c) => {
      const filas = await c.notaSalida.groupBy({ by: ['idEmpresa'], _max: { numNota: true } });
      return aMaximos('numNota', filas);
    },
  },
  // Cuenta corriente de terceros: su ETL de apertura (F9-E6) aún no se corre, pero si se corre con
  // folios explícitos esta serie también hay que adelantarla. Con la tabla vacía es un no-op.
  {
    clave: CLAVE_SECUENCIA_TERCERO,
    descripcion: 'movimientos de cuenta corriente de terceros',
    maximos: async (c) => {
      const filas = await c.movimientoTercero.groupBy({ by: ['idEmpresa'], _max: { folio: true } });
      return aMaximos('folio', filas);
    },
  },
];

/**
 * Repara las series contra el cliente dado (todas, o solo las `claves` pedidas — así un ETL siembra
 * las suyas sin duplicar la lógica). Devuelve un renglón de reporte por serie.
 */
export async function repararSecuencias(
  cliente: PrismaClient,
  claves?: readonly string[],
): Promise<string[]> {
  const reporte: string[] = [];
  const series = claves === undefined ? SERIES : SERIES.filter((s) => claves.includes(s.clave));
  for (const serie of series) {
    const maximos = await serie.maximos(cliente);
    if (maximos.length === 0) {
      reporte.push(`  ${serie.clave}: sin datos (${serie.descripcion}) → no se toca`);
      continue;
    }
    for (const { idEmpresa, max } of maximos) {
      await sembrarSecuencia(cliente, idEmpresa, serie.clave, max);
    }
    const detalle = maximos
      .map((m) => `empresa ${String(m.idEmpresa)}: siguiente = ${String(m.max + 1n)}`)
      .join(' · ');
    reporte.push(`  ${serie.clave} (${serie.descripcion}) → ${detalle}`);
  }
  return reporte;
}

/** Punto de entrada del script. */
async function principal(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (corre con --env-file=.env — ver migracion/README.md)');
    process.exit(1);
  }
  const cliente = crearClientePrisma(url);
  try {
    console.log('Reparando secuencias de folio contra el máximo real de cada tabla…\n');
    const reporte = await repararSecuencias(cliente);
    for (const linea of reporte) {
      console.log(linea);
    }
    console.log(
      '\nListo. Es idempotente y monótono: correrlo de nuevo no baja ninguna serie.\n' +
        'Conviene correrlo después de CUALQUIER ETL que migre folios explícitos.',
    );
  } finally {
    await cliente.$disconnect();
  }
}

const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  await principal();
}
