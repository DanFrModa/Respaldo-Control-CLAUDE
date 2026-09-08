/**
 * ETL de APERTURA DE SALDOS desde el listado de SINUBE (fila 0.131, §Post-F9.224) — orquestador.
 *
 * Mete al sistema los **saldos vivos de cada proveedor** como movimientos de apertura, para poder
 * apagar SINUBE. La fuente es el XLSX que Daniel exporta de SINUBE (una hoja, 53 columnas); el lector
 * y el mapeo viven en `loaders/sinube-apertura.ts`, y la carga la hace el **modo migración del motor
 * de cuenta corriente** que ya existía (`src/dominio/terceros/migracion.ts`, F9-E6) a través de
 * `cargarAperturas` — por LOTES, con folios en bloque, en transacción y con idempotencia por
 * `MapeoMigracion`. **Aquí no hay motor nuevo.**
 *
 * ## Cómo se corre
 *
 * ```
 * # 1) ENSAYO EN SECO — lee, valida y saca el cuadre SIN escribir nada. Hazlo siempre primero.
 * npx tsx --env-file=.env migracion/etl-apertura-sinube.ts -- --archivo=sinube.xlsx --simular
 *
 * # 2) La carga de verdad (idempotente: re-correrla no duplica).
 * npx tsx --env-file=.env migracion/etl-apertura-sinube.ts -- --archivo=sinube.xlsx [--empresa=<id|nombre>]
 * ```
 *
 * (NUNCA `npm run`: esos no llevan `--env-file` — ver `migracion/README.md`.)
 *
 * ## Todo o nada
 *
 * Si algún renglón no se puede representar bien —proveedor desconocido, **proveedor sin días de
 * crédito**, moneda que no son pesos, UUID repetido, saldo negativo…— el script **imprime TODOS los
 * casos y termina en 1 sin escribir nada**. Es deliberado: una carga a medias de saldos de apertura
 * es peor que ninguna, porque el error no se ve (sale un número, sólo que equivocado) y el que lo
 * lee decide pagos con él.
 *
 * Cada corrida deja su reporte en un `.txt` junto al directorio de trabajo, igual que los demás ETL.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

import { Reporte } from './comun/reporte.js';
import { sesionEtl } from './comun/sesion-etl.js';
import { calcularCuadreApertura, formatearCuadreApertura } from './cuadre-apertura-sinube.js';
import { empresaPorDefecto } from './etl-terceros-saldos.js';
import { cargarAperturas } from './loaders/terceros-saldos.js';
import {
  ErrorAperturaSinube,
  ErrorListadoSinube,
  clasificarSinube,
  indiceProveedoresPorRfc,
  leerArchivoSinube,
  verificarProveedoresApertura,
  type ProblemaSinube,
} from './loaders/sinube-apertura.js';

/** Lee un flag `--clave=valor` de argv (o null). */
function flag(clave: string): string | null {
  const pref = `--${clave}=`;
  const arg = process.argv.find((a) => a.startsWith(pref));
  return arg === undefined ? null : arg.slice(pref.length);
}

/** ¿Está presente un flag booleano (`--simular`)? */
function bandera(clave: string): boolean {
  return process.argv.includes(`--${clave}`);
}

/** Imprime la lista de problemas duros con el formato de "esto es lo que hay que arreglar". */
export function formatearProblemas(problemas: ProblemaSinube[]): string {
  const porMotivo = new Map<string, string[]>();
  for (const p of problemas) {
    const lista = porMotivo.get(p.motivo) ?? [];
    lista.push(p.detalle);
    porMotivo.set(p.motivo, lista);
  }
  const salida: string[] = [];
  salida.push('═══════════════════════════════════════════════════════════════');
  salida.push(' 🔴 LA CARGA NO SE CORRIÓ — no se escribió NADA en la base');
  salida.push('═══════════════════════════════════════════════════════════════');
  for (const [motivo, detalles] of porMotivo) {
    salida.push('');
    salida.push(`── ${motivo} (${String(detalles.length)}) ──`);
    for (const d of detalles.slice(0, 50)) salida.push(`   • ${d}`);
    if (detalles.length > 50) salida.push(`   … y ${String(detalles.length - 50)} más.`);
  }
  return salida.join('\n');
}

/** Lo que devuelve una corrida (para las pruebas de integración). */
export interface ResultadoEtlApertura {
  creados: number;
  existentes: number;
  omitidos: number;
  /**
   * Renglones que la carga NO logró escribir (un bloque que reventó al insertar; p. ej. un folio ya
   * ocupado). `cargarAperturas` es tolerante a propósito —un bloque malo no tumba al resto— y eso,
   * sin nadie mirándolo, sería una carga a medias que se ve exitosa. Aquí NO: si esto no es 0, el
   * script termina en 1 con un aviso grande. El detalle está en el `reporte`.
   */
  fallidos: number;
  cuadre: string;
  reporte: Reporte;
}

/**
 * Corre el ETL contra `cliente`, leyendo `archivo`. Lanza `ErrorAperturaSinube` —con la lista
 * completa de casos— si algo no se puede representar; en ese caso NO escribió nada.
 */
export async function ejecutarEtlAperturaSinube(
  cliente: PrismaClient,
  archivo: string,
  opciones: { empresaRef?: string | null; simular?: boolean } = {},
): Promise<ResultadoEtlApertura> {
  const sesion = sesionEtl();
  const reporte = new Reporte();

  console.log('ETL apertura de saldos (SINUBE) — inicio');
  const renglones = await leerArchivoSinube(archivo);
  const clasificacion = clasificarSinube(renglones);
  console.log(
    `  Renglones leídos: ${String(clasificacion.resumen.leidos)} · ` +
      `vivos a cargar: ${String(clasificacion.resumen.cargados)} · ` +
      `descartados: ${String(clasificacion.descartes.length)}`,
  );

  // ── Guardas DURAS, todas antes de escribir una sola fila ──
  const indice = await indiceProveedoresPorRfc(cliente);
  const problemas = [...clasificacion.problemas];
  try {
    verificarProveedoresApertura(clasificacion.aperturas, indice);
  } catch (e) {
    if (e instanceof ErrorAperturaSinube) {
      problemas.push(...e.problemas);
    } else {
      throw e;
    }
  }
  if (problemas.length > 0) {
    throw new ErrorAperturaSinube(
      `La carga de apertura NO se corrió: ${String(problemas.length)} problema(s) por resolver. ` +
        'No se escribió nada en la base.',
      problemas,
    );
  }

  for (const d of clasificacion.descartes) {
    reporte.agregar(d.motivo, `fila ${String(d.fila)} · ${d.detalle}`);
  }
  for (const a of clasificacion.avisos) {
    reporte.agregar(a.motivo, a.detalle);
  }

  if (opciones.simular === true) {
    reporte.nota('ENSAYO EN SECO (--simular): no se escribió nada en la base.');
    console.log('  --simular: no se escribe nada. Sólo el cuadre de lo que se cargaría.');
    const cuadre = formatearCuadreApertura(await calcularCuadreApertura(cliente, clasificacion));
    return { creados: 0, existentes: 0, omitidos: 0, fallidos: 0, cuadre, reporte };
  }

  const idEmpresaDefault = await empresaPorDefecto(cliente, opciones.empresaRef ?? null);
  const res = await cargarAperturas(sesion, cliente, reporte, {
    filas: clasificacion.aperturas,
    idEmpresaDefault,
  });
  console.log(
    `  Aperturas   creados=${String(res.creados)} existentes=${String(res.existentes)} ` +
      `omitidos=${String(res.omitidos)}` +
      ((res.omitidosValidacion ?? 0) > 0
        ? ` omitidosValidacion=${String(res.omitidosValidacion)}`
        : ''),
  );

  const cuadre = formatearCuadreApertura(await calcularCuadreApertura(cliente, clasificacion));
  console.log('ETL apertura de saldos (SINUBE) — fin de carga');
  return {
    creados: res.creados,
    existentes: res.existentes,
    omitidos: res.omitidos,
    fallidos: res.omitidosValidacion ?? 0,
    cuadre,
    reporte,
  };
}

/** Punto de entrada del script. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  const archivo = flag('archivo');
  if (archivo === null) {
    console.error(
      'Falta --archivo=<ruta.xlsx>. Uso: npx tsx --env-file=.env migracion/etl-apertura-sinube.ts ' +
        '-- --archivo=sinube.xlsx [--empresa=<id|nombre>] [--simular]',
    );
    process.exit(1);
  }
  const cliente = crearClientePrisma(url, {
    transactionOptions: { maxWait: 20_000, timeout: 120_000 },
    poolMax: 12,
    pool: { keepAlive: true, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 30_000 },
  });

  try {
    const r = await ejecutarEtlAperturaSinube(cliente, archivo, {
      empresaRef: flag('empresa'),
      simular: bandera('simular'),
    });
    const textoReporte = r.reporte.aTexto();
    console.log('\n' + r.cuadre);
    console.log('\n' + textoReporte);
    const salida = join(
      process.cwd(),
      `reporte-etl-apertura-sinube-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
    );
    writeFileSync(salida, `${r.cuadre}\n\n${textoReporte}\n`, { encoding: 'utf-8' });
    console.log(`\nReporte escrito en: ${salida}`);
    if (r.fallidos > 0 || r.omitidos > 0) {
      // La carga QUEDÓ A MEDIAS. Ya se escribió parte, así que no se puede prometer "no se tocó
      // nada"; lo que sí se puede es no cantar victoria: sale en rojo y con el número a la vista.
      console.error(
        `\n🔴 LA CARGA QUEDÓ INCOMPLETA: ${String(r.fallidos)} renglón(es) no se pudieron escribir y ` +
          `${String(r.omitidos)} se omitieron. Revisa el reporte de arriba ANTES de dar la apertura ` +
          'por buena; volver a correr el script retoma lo que falta (es idempotente).',
      );
      process.exitCode = 1;
    }
  } catch (e) {
    if (e instanceof ErrorAperturaSinube) {
      console.error('\n' + formatearProblemas(e.problemas));
      console.error(`\n${e.message}`);
      process.exitCode = 1;
      return;
    }
    // El archivo no tiene la forma esperada: es un error de OPERACIÓN (mandaron otro Excel), no un
    // defecto — se dice en una línea legible en vez de escupir una traza.
    if (e instanceof ErrorListadoSinube) {
      console.error(`\n🔴 No se pudo leer el archivo: ${e.message}`);
      console.error('   No se escribió nada en la base.');
      process.exitCode = 1;
      return;
    }
    throw e;
  } finally {
    await cliente.$disconnect();
  }
}

const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  await main();
}
