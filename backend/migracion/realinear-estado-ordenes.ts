/**
 * MANTENIMIENTO — realinea el ESTADO GUARDADO de las órdenes con la regla automática
 * (`completa` = tallas + receta liberada, y arte si aplica; ver
 * `src/dominio/produccion/requisitos-orden.ts`
 * y `DECISIONES.md §Post-F9.4`).
 *
 * ⚠️ **CÓRRELO AL TERMINAR CUALQUIER CARGA O RECARGA DE DATOS** (F10, o una re-corrida de los ETL):
 *
 * ```bash
 * cd backend
 * npx tsx --env-file=.env migracion/realinear-estado-ordenes.ts
 * ```
 *
 * POR QUÉ HACE FALTA. El ETL es **fiel a la fuente**: `crearOrdenMigrada` escribe el `estado` y la
 * `fechaCompletada` EXPLÍCITOS que traía Access (`FechaDet`/`OrdCancelada`) y NO recalcula — así
 * debe ser, porque migrar es copiar el histórico, no reinterpretarlo. Pero la pantalla "Órdenes
 * incompletas" filtra por ese estado guardado, así que recién cargada la base el semáforo no
 * refleja la regla nueva y **el backlog que Daniel pidió atender queda invisible**
 * (*"si no meten la información del arte, o no desmarcan la casilla, está como incompleto…
 * siempre hay que atender ese tema"*). Este script es el paso que cierra esa brecha, y se puede
 * correr las veces que haga falta.
 *
 * *(La migración `20260726130000_recalculo_estado_ordenes` aplicó la MISMA REGLA una sola vez sobre
 * la base actual, pero con MENOS ALCANCE: solo DEGRADA las `completa` que dejaron de cumplir. Este
 * script hace las dos direcciones —degrada Y completa las `capturada` que ya cumplían— y se puede
 * correr las veces que haga falta; es el que corre después de cada carga.)*
 *
 * QUÉ HACE Y QUÉ RESPETA — no reimplementa nada: delega en `realinearEstadoOrdenes` (dominio), que
 * usa las MISMAS funciones que la app (`requisitosOrden` + `cambiosEstadoPorRequisitos`):
 *  • baja a `capturada` las `completa` que ya no cumplen; sube a `completa` las `capturada` que sí;
 *  • **NUNCA degrada una orden con `EtapaMovimiento` viva** (corte/envío sin cancelar) — el mismo
 *    cinturón del dominio: lo que ya está en producción no cambia de semáforo;
 *  • no toca las `cancelada` ni borra `fechaCompletada` (sello histórico);
 *  • deja **bitácora por orden** con `idUsuario` NULL (proceso de sistema, como el resto del ETL).
 *
 * IDEMPOTENTE: la segunda corrida no escribe nada. Trabaja **por lotes** (páginas de ids ordenadas
 * por id, cada lote en su propia transacción corta) para no cargar en memoria ni bloquear miles de
 * órdenes de golpe.
 *
 * Flags (tras `--`):
 *   `--empresa=<id>`  limita a una empresa (por defecto TODAS: es mantenimiento, no una vista).
 *   `--lote=<n>`      tamaño de página (default 500).
 *   `--dry-run`       solo REPORTA lo que haría; no escribe nada.
 */
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';
import {
  realinearEstadoOrdenes,
  sumarResumenRealineacion,
  type ResumenRealineacion,
} from '../src/dominio/produccion/requisitos-orden.js';

/** Opciones de corrida (todas con default sano). */
export interface OpcionesRealineado {
  idEmpresa?: number;
  tamanoLote: number;
  dryRun: boolean;
}

/** Lee los flags de `process.argv` (mismo estilo que los ETL con parámetros). */
export function leerOpciones(argv: readonly string[]): OpcionesRealineado {
  const flag = (nombre: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${nombre}=`))?.split('=')[1];

  const empresa = flag('empresa');
  const lote = flag('lote');
  const tamano = lote === undefined ? 500 : Number.parseInt(lote, 10);
  if (Number.isNaN(tamano) || tamano < 1) {
    throw new Error(`--lote debe ser un entero ≥ 1 (llegó "${String(lote)}")`);
  }
  const idEmpresa = empresa === undefined ? undefined : Number.parseInt(empresa, 10);
  if (idEmpresa !== undefined && (Number.isNaN(idEmpresa) || idEmpresa < 1)) {
    throw new Error(`--empresa debe ser un id entero ≥ 1 (llegó "${String(empresa)}")`);
  }

  return {
    ...(idEmpresa === undefined ? {} : { idEmpresa }),
    tamanoLote: tamano,
    dryRun: argv.includes('--dry-run'),
  };
}

/** Señal interna para revertir la transacción en `--dry-run` conservando el resumen calculado. */
class AbortoSimulacion extends Error {
  constructor(readonly resumen: ResumenRealineacion) {
    super('simulación');
  }
}

/**
 * Recorre TODAS las órdenes no canceladas (paginando por id) y realinea su estado. Cada lote va en
 * su propia transacción: si una corrida se interrumpe, lo ya realineado queda bien y volver a
 * correrlo retoma sin duplicar nada (es idempotente).
 */
export async function realinearTodo(
  cliente: PrismaClient,
  opciones: OpcionesRealineado,
): Promise<ResumenRealineacion> {
  let acumulado: ResumenRealineacion = {
    revisadas: 0,
    degradadas: 0,
    completadas: 0,
    protegidasPorProduccion: 0,
  };
  let desde = 0;

  for (;;) {
    const pagina = await cliente.orden.findMany({
      where: {
        id: { gt: desde },
        estado: { not: 'cancelada' },
        ...(opciones.idEmpresa === undefined ? {} : { idEmpresa: opciones.idEmpresa }),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: opciones.tamanoLote,
    });
    if (pagina.length === 0) break;
    desde = pagina[pagina.length - 1]?.id ?? desde;

    const ids = pagina.map((o) => o.id);
    let resumen: ResumenRealineacion;
    try {
      resumen = await cliente.$transaction(async (tx) => {
        const r = await realinearEstadoOrdenes(tx, ids);
        // En simulación se evalúa TODO igual (mismo código, mismos conteos) y se deshace la
        // escritura con un rollback: así el "qué haría" nunca es una regla aparte de la real.
        if (opciones.dryRun) throw new AbortoSimulacion(r);
        return r;
      });
    } catch (error) {
      if (!(error instanceof AbortoSimulacion)) throw error;
      resumen = error.resumen;
    }
    acumulado = sumarResumenRealineacion(acumulado, resumen);
    process.stdout.write(`  … ${String(acumulado.revisadas)} órdenes revisadas\r`);
  }

  return acumulado;
}

/** Formatea el resumen final (mismo aire que los reportes de cuadre). */
export function formatearResumen(r: ResumenRealineacion, opciones: OpcionesRealineado): string {
  const p: string[] = [];
  p.push('');
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(
    ` REALINEADO DEL ESTADO DE LAS ÓRDENES${opciones.dryRun ? '  ·  SIMULACIÓN (no se escribió)' : ''}`,
  );
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(`${'Órdenes revisadas (no canceladas)'.padEnd(44)}${String(r.revisadas).padStart(8)}`);
  p.push(`${'→ pasaron a INCOMPLETA (capturada)'.padEnd(44)}${String(r.degradadas).padStart(8)}`);
  p.push(`${'→ pasaron a COMPLETA'.padEnd(44)}${String(r.completadas).padStart(8)}`);
  p.push(
    `${'· respetadas por tener producción viva'.padEnd(44)}${String(r.protegidasPorProduccion).padStart(8)}`,
  );
  p.push('─'.repeat(63));
  const sinCambio = r.revisadas - r.degradadas - r.completadas;
  p.push(`${'Sin cambio (ya estaban al día)'.padEnd(44)}${String(sinCambio).padStart(8)}`);
  p.push('');
  p.push('Las que pasaron a INCOMPLETA se resuelven POR MODELO (no orden por orden):');
  p.push('  • capturar su arte en la receta del modelo, o');
  p.push('  • desmarcar "Lleva arte" si la prenda es lisa.');
  p.push('En ambos casos sus órdenes se completan solas. El estado NO impide operarlas.');
  return p.join('\n');
}

/** Punto de entrada del script. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  const opciones = leerOpciones(process.argv.slice(2));
  const cliente = crearClientePrisma(url);
  try {
    const resumen = await realinearTodo(cliente, opciones);
    console.log(formatearResumen(resumen, opciones));
  } finally {
    await cliente.$disconnect();
  }
}

const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  await main();
}
