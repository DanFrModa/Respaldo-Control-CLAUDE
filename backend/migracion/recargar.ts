/**
 * RECARGA de punta a punta en UN comando (pedido de Gabriel/Daniel: ya no correr ETL por ETL).
 *
 * Orquesta, en SECUENCIA y con banner por paso: limpieza opcional de la BD (reusa
 * `limpiar-datos.ts`) → seed de fundación (el MISMO `prisma/seed.ts` idempotente que dispara
 * `SEED_ON_START` vía `prisma db seed`; correrlo aquí evita esperar un redeploy para poder
 * cargar) → los 12 ETL en el orden documentado del README → los ETL de F9 SI se pasaron sus
 * banderas (opcionales: sus fuentes aún no existen) → el **realineado del estado de las
 * órdenes** (paso final obligatorio de toda carga) → los cuadres.
 *
 * USO (desde `backend/`, como todos los ETL — ver README):
 *
 *   npx tsx --env-file=.env migracion/recargar.ts --desde=2025-01-01 --limpiar --confirmar
 *
 * Banderas:
 *  • `--desde=YYYY-MM-DD` (opcional): ventana temporal. Se valida con `parsearEtlDesde`
 *    (mal formada → ABORTA) y se exporta como `ETL_DESDE` para TODOS los subprocesos.
 *    Sin `--desde` → recarga COMPLETA (sin ventana).
 *  • `--confirmar` (OBLIGATORIO para ejecutar): sin él, CUALQUIER invocación es MODO PLAN —
 *    imprime el plan numerado (con la ventana que aplicaría y, si trae `--limpiar`, los
 *    conteos actuales) y sale con exit 0 SIN tocar la BD. `--confirmar` solo (sin
 *    `--limpiar`) significa "ejecuta la carga sin vaciar antes" — es el modo de REANUDAR.
 *  • `--limpiar`: vacía la BD antes de cargar (TRUNCATE, reusa `limpiar-datos.ts`) y agrega
 *    el paso de seed. Como todo, solo ejecuta con `--confirmar`.
 *  • `--sin-cuadres`: se salta los cuadres del final (el realineado SÍ corre: es carga, no
 *    verificación).
 *  • `--saldos-terceros=<ruta.csv>` / `--cfdi=<carpeta>` (F9, OPCIONALES): activan
 *    `etl-terceros-saldos` (+ `cuadre-f9`) y `etl-cfdi-masivo`. Sin ellas esos pasos se
 *    OMITEN y el plan lo dice — sus fuentes (corte de SINUBE / export del contador) aún no
 *    existen (D15c), así que meterlos por defecto tronaría por archivo faltante.
 *
 * Cada ETL corre como SUBPROCESO (no import): cada script ya es standalone con su propio
 * cliente Prisma y su reporte; el spawn es portable (Windows/Linux: `process.execPath` + el
 * CLI de tsx resuelto de node_modules — sin `npx`, sin shell, sin .cmd). Los hijos HEREDAN
 * el env del padre (que ya corrió con `--env-file=.env`), así que no se repite el flag.
 *
 * Si un paso FALLA (exit ≠ 0) la recarga se DETIENE ahí: los ETL son idempotentes, así que
 * re-correr `recargar.ts --confirmar` SIN `--limpiar` retoma desde donde quedó sin duplicar
 * nada. CASO ESPECIAL: si lo que falló fue el SEED tras una limpieza, la BD quedó vacía y
 * SIN sembrar — ahí la reanudación correcta es re-correr CON `--limpiar --confirmar` (volver
 * a truncar una BD vacía es inocuo) o sembrar a mano y luego reanudar sin `--limpiar`.
 *
 * NOTA fotos: `etl-modelos` corre SIN los flags de fotos masivas (`--fotos-modelos` /
 * `--fotos-bordados`); esas se corren aparte cuando exista la carpeta física (pendiente F1).
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { crearClientePrisma } from '../src/datos/index.js';

import { ejecutarLimpieza } from './limpiar-datos.js';
import {
  describirVentana,
  ErrorEtlDesdeInvalida,
  parsearEtlDesde,
  resolverVentana,
} from './comun/ventana.js';

/** Raíz de `backend/` (este archivo vive en `backend/migracion/`): cwd de todos los subprocesos. */
const RAIZ_BACKEND = fileURLToPath(new URL('..', import.meta.url));

/**
 * CLI de tsx resuelto de node_modules (`tsx/cli` → `dist/cli.mjs`). Se lanza con
 * `process.execPath` (el node actual): portable Windows/Linux — sin `npx`, sin shell,
 * sin depender del shim `.cmd` de win32.
 */
const TSX_CLI = createRequire(import.meta.url).resolve('tsx/cli');

/** Un paso del plan: etiqueta legible + script tsx a correr (relativo a `backend/`) + args. */
interface Paso {
  etiqueta: string;
  script: string;
  /** Argumentos que se le pasan al script (p. ej. `--archivo=saldos.csv` de los ETL de F9). */
  args?: string[];
}

/** ETLs en el ORDEN documentado del README (la cadena de mapeos/FKs importa). */
const PASOS_ETL: Paso[] = [
  { etiqueta: 'F1 · catálogos + proveedores + materiales', script: 'migracion/etl-catalogos.ts' },
  { etiqueta: 'F1 · modelos + BOM (fotos masivas APARTE)', script: 'migracion/etl-modelos.ts' },
  { etiqueta: 'F2 · pedidos + órdenes + comentarios', script: 'migracion/etl-pedidos-ordenes.ts' },
  { etiqueta: 'F3 · producción (corte/envío/recibo/EsMa)', script: 'migracion/etl-produccion.ts' },
  { etiqueta: 'F3 · kardex histórico de IPT', script: 'migracion/etl-ipt.ts' },
  { etiqueta: 'F4 · OC + notas de salida legacy', script: 'migracion/etl-compras-notas.ts' },
  { etiqueta: 'F4 · kardex de telas + lotes', script: 'migracion/etl-telas.ts' },
  { etiqueta: 'F5 · Ruta Crítica completa', script: 'migracion/etl-ruta-critica.ts' },
  { etiqueta: 'F6 · Calidad (auditorías AQL)', script: 'migracion/etl-calidad.ts' },
  { etiqueta: 'F6 · EsMa (cargos/abonos/descuentos/pagos)', script: 'migracion/etl-esma.ts' },
  { etiqueta: 'F7 · Costos (D2)', script: 'migracion/etl-costos.ts' },
  { etiqueta: 'F7 · Indicadores IP/almacén', script: 'migracion/etl-indicadores.ts' },
];

/** Cuadres del final (se saltan con `--sin-cuadres`). */
const PASOS_CUADRE: Paso[] = [
  { etiqueta: 'Cuadre F2', script: 'migracion/cuadre-f2.ts' },
  { etiqueta: 'Cuadre F3', script: 'migracion/cuadre-f3.ts' },
  { etiqueta: 'Cuadre F4', script: 'migracion/cuadre-f4.ts' },
  { etiqueta: 'Cuadre F5', script: 'migracion/cuadre-f5.ts' },
  { etiqueta: 'Cuadre F6', script: 'migracion/cuadre-f6.ts' },
  { etiqueta: 'Cuadre F7', script: 'migracion/cuadre-f7.ts' },
];

/** El seed de fundación: EXACTAMENTE el script que `SEED_ON_START` dispara vía `prisma db seed`. */
const PASO_SEED: Paso = {
  etiqueta: 'Seed de fundación (empresa/permisos/roles/admin — idempotente)',
  script: 'prisma/seed.ts',
};

/**
 * MANTENIMIENTO OBLIGATORIO al terminar cualquier carga (su propio encabezado lo exige): el ETL
 * es fiel a Access (`crearOrdenMigrada` copia el `estado` tal cual) pero la regla de `completa`
 * es de v2 (tallas + avíos + arte si aplica) → sin este paso el semáforo de "Órdenes
 * incompletas" queda desalineado recién cargada la base.
 *
 * Va DESPUÉS de los ETL y ANTES de los cuadres a propósito: los cuadres deben reportar el estado
 * FINAL de la BD. Es seguro en cualquier orden — ningún cuadre lee `Orden.estado` (verificado:
 * `cuadre-f2` cuenta órdenes sin filtrar por estado y el `estado` de `cuadre-f6` es el de
 * `EsMaCargo`), así que ninguna cifra del cuadre cambia por correrlo antes.
 */
const PASO_REALINEAR: Paso = {
  etiqueta: 'Realinear estado de órdenes (completa/capturada — obligatorio tras cargar)',
  script: 'migracion/realinear-estado-ordenes.ts',
};

/**
 * F9 (Finanzas) — OPCIONALES: sus fuentes NO vienen de Access sino del corte de SINUBE / export
 * del contador, y **aún no existen** (D15c). Por eso NUNCA entran al flujo por defecto (tronarían
 * por archivo faltante): solo con `--saldos-terceros=<csv>` / `--cfdi=<carpeta>`.
 */
function pasosF9(args: Argumentos): { etl: Paso[]; cuadre: Paso[] } {
  const etl: Paso[] = [];
  const cuadre: Paso[] = [];
  if (args.saldosTerceros !== null) {
    etl.push({
      etiqueta: 'F9 · saldos iniciales de terceros (CxC/CxP)',
      script: 'migracion/etl-terceros-saldos.ts',
      args: [`--archivo=${args.saldosTerceros}`],
    });
    cuadre.push({
      etiqueta: 'Cuadre F9 (corte vs aperturas cargadas)',
      script: 'migracion/cuadre-f9.ts',
      args: [`--archivo=${args.saldosTerceros}`],
    });
  }
  if (args.cfdi !== null) {
    etl.push({
      etiqueta: 'F9 · CFDI históricos (carpeta de XML)',
      script: 'migracion/etl-cfdi-masivo.ts',
      args: [`--dir=${args.cfdi}`],
    });
  }
  return { etl, cuadre };
}

/** Resultado de un paso ya corrido (para la tabla del resumen final). */
interface PasoCorrido {
  etiqueta: string;
  estado: 'OK' | 'FALLÓ' | 'no corrido';
  segundos: number;
}

/** Formatea segundos como `m:ss` (o `12.3s` si es menos de un minuto). */
function formatearDuracion(segundos: number): string {
  if (segundos < 60) return `${segundos.toFixed(1)}s`;
  const m = Math.floor(segundos / 60);
  const s = Math.round(segundos % 60);
  return `${String(m)}m ${String(s).padStart(2, '0')}s`;
}

/** Banner de paso: número/total + etiqueta. */
function banner(numero: number, total: number, etiqueta: string): void {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(` PASO ${String(numero)}/${String(total)} · ${etiqueta}`);
  console.log('═══════════════════════════════════════════════════════════════');
}

/**
 * Corre un script con tsx como subproceso SECUENCIAL, con la salida heredada (se ve el output
 * normal del ETL). Devuelve el exit code (null del SO se trata como fallo).
 */
function correrScript(script: string, args: string[] = []): number {
  const res = spawnSync(process.execPath, [TSX_CLI, script, ...args], {
    cwd: RAIZ_BACKEND,
    stdio: 'inherit',
    env: process.env, // hereda ETL_DESDE + todo el .env del padre
  });
  if (res.error !== undefined) {
    console.error(`No se pudo lanzar el subproceso de ${script}: ${res.error.message}`);
    return 1;
  }
  return res.status ?? 1;
}

/** Argumentos ya parseados del CLI. */
interface Argumentos {
  desde: string | null;
  limpiar: boolean;
  confirmar: boolean;
  sinCuadres: boolean;
  /** F9 opcional: ruta del CSV del corte de saldos de terceros (SINUBE). */
  saldosTerceros: string | null;
  /** F9 opcional: carpeta con los XML de CFDI históricos. */
  cfdi: string | null;
}

/** Uso del comando (se imprime ante una bandera desconocida). */
const USO =
  '  npx tsx --env-file=.env migracion/recargar.ts [--desde=YYYY-MM-DD] [--limpiar] [--confirmar]\n' +
  '      [--sin-cuadres] [--saldos-terceros=<ruta.csv>] [--cfdi=<carpeta>]';

/** Parsea los argumentos; bandera desconocida → aborta (mejor que ignorarla en silencio). */
function parsearArgumentos(argv: string[]): Argumentos {
  const args: Argumentos = {
    desde: null,
    limpiar: false,
    confirmar: false,
    sinCuadres: false,
    saldosTerceros: null,
    cfdi: null,
  };
  for (const crudo of argv) {
    if (crudo.startsWith('--desde=')) args.desde = crudo.slice('--desde='.length);
    else if (crudo.startsWith('--saldos-terceros='))
      args.saldosTerceros = crudo.slice('--saldos-terceros='.length);
    else if (crudo.startsWith('--cfdi=')) args.cfdi = crudo.slice('--cfdi='.length);
    else if (crudo === '--limpiar') args.limpiar = true;
    else if (crudo === '--confirmar') args.confirmar = true;
    else if (crudo === '--sin-cuadres') args.sinCuadres = true;
    else {
      console.error(`Bandera desconocida: "${crudo}". Uso:\n${USO}`);
      process.exit(1);
    }
  }
  return args;
}

/** Imprime el plan de pasos (modo plan y arranque). Con `conLimpieza` antepone el paso 0. */
function imprimirPlan(pasos: Paso[], conLimpieza: boolean, args: Argumentos): void {
  console.log('\nPlan de pasos (en este orden):');
  if (conLimpieza) {
    console.log(
      '   0. Limpieza de la BD — TRUNCATE de public, conserva _prisma_migrations  (limpiar-datos.ts)',
    );
  }
  pasos.forEach((p, i) => {
    const args_ = p.args === undefined || p.args.length === 0 ? '' : ` ${p.args.join(' ')}`;
    console.log(`  ${String(i + 1).padStart(2)}. ${p.etiqueta}  (${p.script}${args_})`);
  });
  // Lo OMITIDO también se dice (nada en silencio): F9 no corre sin sus banderas.
  const omitidos: string[] = [];
  if (args.saldosTerceros === null) {
    omitidos.push(
      '   • F9 · saldos iniciales de terceros + cuadre F9 — OMITIDOS (sin --saldos-terceros=<ruta.csv>;\n' +
        '     la fuente es el corte de SINUBE/contador y aún no existe, D15c)',
    );
  }
  if (args.cfdi === null) {
    omitidos.push(
      '   • F9 · CFDI históricos — OMITIDO (sin --cfdi=<carpeta>; la carpeta de XML aún no existe)',
    );
  }
  omitidos.push(
    '   • Fotos masivas de modelos/bordados — OMITIDAS (se corren aparte cuando exista la carpeta física)',
  );
  console.log('\nPasos OPCIONALES que NO se van a correr:');
  for (const o of omitidos) console.log(o);
}

/**
 * Arma el comando exacto de `recargar.ts` para los mensajes (modo plan / reanudación),
 * preservando las banderas tal como vinieron y forzando `--confirmar`.
 */
function comandoRecargar(args: Argumentos, opciones: { conLimpiar: boolean }): string {
  return (
    '  npx tsx --env-file=.env migracion/recargar.ts' +
    (args.desde !== null ? ` --desde=${args.desde}` : '') +
    (opciones.conLimpiar ? ' --limpiar' : '') +
    ' --confirmar' +
    (args.sinCuadres ? ' --sin-cuadres' : '') +
    (args.saldosTerceros !== null ? ` --saldos-terceros=${args.saldosTerceros}` : '') +
    (args.cfdi !== null ? ` --cfdi=${args.cfdi}` : '')
  );
}

/** Punto de entrada. */
async function main(): Promise<void> {
  const args = parsearArgumentos(process.argv.slice(2));

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      'Falta DATABASE_URL: corre el orquestador con --env-file=.env desde backend/ ' +
        '(ver backend/.env.example). El seed y todos los ETL la necesitan.',
    );
    process.exit(1);
  }

  // Ventana: valida --desde (mal formada → aborta con el mensaje de parsearEtlDesde) y la
  // exporta como ETL_DESDE para TODOS los subprocesos. Sin --desde respeta un ETL_DESDE que
  // ya viniera del entorno (mismo contrato que correr los ETL a mano).
  if (args.desde !== null) {
    try {
      parsearEtlDesde(args.desde);
    } catch (error) {
      if (error instanceof ErrorEtlDesdeInvalida) {
        console.error(error.message);
        process.exit(1);
      }
      throw error;
    }
    process.env.ETL_DESDE = args.desde;
  }
  const ventana = resolverVentana(); // también valida un ETL_DESDE heredado del entorno

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' RECARGA DE PUNTA A PUNTA — CONTROL v2 (migracion/recargar.ts)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(
    ventana.corte === null
      ? ' Recarga COMPLETA: sin --desde → SIN ventana temporal (migra todo el histórico).'
      : ` ${describirVentana(ventana)}`,
  );

  // Plan de pasos (la limpieza va aparte: no es subproceso, corre en este mismo proceso).
  // Orden: seed → ETL → F9 opcional → REALINEADO (obligatorio, cierra la carga) → cuadres
  // (leen la BD ya final; ninguno depende de `Orden.estado`, ver el TSDoc de PASO_REALINEAR).
  const f9 = pasosF9(args);
  const pasos: Paso[] = [
    ...(args.limpiar ? [PASO_SEED] : []), // el seed solo hace falta tras vaciar (es idempotente)
    ...PASOS_ETL,
    ...f9.etl,
    PASO_REALINEAR,
    ...(args.sinCuadres ? [] : [...PASOS_CUADRE, ...f9.cuadre]),
  ];

  // ── MODO PLAN: sin --confirmar NUNCA se ejecuta nada (ni siquiera la carga sin limpieza) ───
  if (!args.confirmar) {
    console.log('\nMODO PLAN (sin --confirmar): NO se ejecuta nada. Esto es lo que haría:');
    if (args.limpiar) {
      // Los conteos actuales de la limpieza necesitan BD; sin conexión el plan sale igual.
      const cliente = crearClientePrisma(url);
      try {
        await ejecutarLimpieza(cliente, { confirmar: false });
      } catch (error) {
        console.error(
          `(No se pudo conectar a la BD para contar filas: ${error instanceof Error ? error.message : String(error)})`,
        );
      } finally {
        await cliente.$disconnect();
      }
    }
    imprimirPlan(pasos, args.limpiar, args);
    console.log('\nPara ejecutar de verdad: agrega --confirmar');
    console.log(comandoRecargar(args, { conLimpiar: args.limpiar }));
    return; // exit 0: solo plan
  }

  // ── Limpieza opcional (reusa limpiar-datos.ts) ─────────────────────────────────────────────
  let limpiezaCorrida = false;
  let segundosLimpieza = 0;
  if (args.limpiar) {
    const cliente = crearClientePrisma(url);
    try {
      banner(
        0,
        pasos.length,
        'Limpieza de la BD (TRUNCATE de public, conserva _prisma_migrations)',
      );
      const inicioLimpieza = Date.now();
      await ejecutarLimpieza(cliente, { confirmar: true });
      segundosLimpieza = (Date.now() - inicioLimpieza) / 1000;
      limpiezaCorrida = true;
      console.log(`\n[limpieza OK en ${formatearDuracion(segundosLimpieza)}]`);
    } finally {
      await cliente.$disconnect();
    }
  }

  imprimirPlan(pasos, false, args);

  // ── Pasos secuenciales (seed → ETLs → cuadres) ─────────────────────────────────────────────
  const corridos: PasoCorrido[] = pasos.map((p) => ({
    etiqueta: p.etiqueta,
    estado: 'no corrido',
    segundos: 0,
  }));
  let fallo: Paso | null = null;
  for (let i = 0; i < pasos.length; i += 1) {
    const paso = pasos[i];
    const corrido = corridos[i];
    if (paso === undefined || corrido === undefined) continue;
    banner(i + 1, pasos.length, paso.etiqueta);
    const inicio = Date.now();
    const exit = correrScript(paso.script, paso.args ?? []);
    corrido.segundos = (Date.now() - inicio) / 1000;
    corrido.estado = exit === 0 ? 'OK' : 'FALLÓ';
    if (exit !== 0) {
      fallo = paso;
      const encabezado =
        `\n⛔ El paso ${String(i + 1)}/${String(pasos.length)} (${paso.script}) terminó con exit=${String(exit)}. ` +
        'La recarga se DETIENE aquí.\n';
      if (paso.script === PASO_SEED.script && limpiezaCorrida) {
        // Caso especial: la BD quedó VACÍA y SIN SEMBRAR — reanudar "sin --limpiar" dejaría a
        // los ETL fallando contra una base sin permisos/roles/empresa.
        console.error(
          encabezado +
            '⚠️ La BD quedó VACÍA (la limpieza sí corrió) pero SIN SEMBRAR (falló el seed): los ETL\n' +
            'no pueden correr así. Cómo reanudar (elige una):\n' +
            ' • Re-corre CON --limpiar --confirmar (volver a truncar una BD vacía es inocuo):\n' +
            comandoRecargar(args, { conLimpiar: true }) +
            '\n' +
            ' • O corre el seed a mano y luego reanuda SIN --limpiar:\n' +
            '  npx tsx --env-file=.env prisma/seed.ts\n' +
            comandoRecargar(args, { conLimpiar: false }),
        );
      } else {
        console.error(
          encabezado +
            'Cómo reanudar: los ETL son IDEMPOTENTES — corrige la causa y re-corre el mismo comando ' +
            'SIN --limpiar (retoma desde donde quedó sin duplicar):\n' +
            comandoRecargar(args, { conLimpiar: false }),
        );
      }
      break;
    }
  }

  // ── Resumen final ──────────────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(' RESUMEN DE LA RECARGA');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(
    ventana.corte === null
      ? ' Ventana: NINGUNA (recarga completa).'
      : ` ${describirVentana(ventana)}`,
  );
  if (limpiezaCorrida) console.log(' Limpieza previa: SÍ (TRUNCATE ejecutado).');
  console.log('');
  console.log(`${'Paso'.padEnd(48)}${'Estado'.padEnd(12)}Duración`);
  console.log('─'.repeat(70));
  if (limpiezaCorrida) {
    console.log(
      `${'Limpieza de la BD (TRUNCATE)'.padEnd(48)}${'OK'.padEnd(12)}${formatearDuracion(segundosLimpieza)}`,
    );
  }
  for (const c of corridos) {
    console.log(
      `${c.etiqueta.padEnd(48)}${c.estado.padEnd(12)}${c.estado === 'no corrido' ? '—' : formatearDuracion(c.segundos)}`,
    );
  }
  console.log('─'.repeat(70));
  const totalSeg = corridos.reduce((s, c) => s + c.segundos, 0) + segundosLimpieza;
  console.log(`TOTAL: ${formatearDuracion(totalSeg)}`);

  // Recordatorios CONDICIONADOS a lo que de verdad pasó (tras un fallo temprano no aplica
  // hablar del password del seed ni de reportes que no existen).
  const seedOk = pasos.some(
    (p, i) => p.script === PASO_SEED.script && corridos[i]?.estado === 'OK',
  );
  const algunEtlCorrido = pasos.some(
    (p, i) => p.script.startsWith('migracion/etl-') && corridos[i]?.estado !== 'no corrido',
  );
  const algunEtlOk = pasos.some(
    (p, i) => p.script.startsWith('migracion/etl-') && corridos[i]?.estado === 'OK',
  );
  const recargaCompleta = fallo === null;
  const recordatorios: string[] = [];
  if (limpiezaCorrida || algunEtlCorrido) {
    recordatorios.push(
      ' • REINICIA el backend en Railway al terminar (invalida sesiones viejas' +
        (limpiezaCorrida
          ? ' y deja\n   drenarse los jobs pgboss encolados antes de la limpieza — ese esquema no se trunca).'
          : ').'),
    );
  }
  if (seedOk) {
    recordatorios.push(
      ' • El usuario `admin` quedó con el password del seed — CÁMBIALO en cuanto entres.',
    );
  }
  if (limpiezaCorrida) {
    recordatorios.push(
      ' • Las fotos previas en R2 quedaron huérfanas (limitación conocida, HOJA-DE-RUTA.md §4).',
    );
  }
  if (recargaCompleta) {
    recordatorios.push(
      ' • Las fotos masivas de modelos/bordados se corren APARTE cuando exista la carpeta\n' +
        '   física (etl-modelos --fotos-modelos / --fotos-bordados).',
    );
  }
  if (algunEtlOk) {
    recordatorios.push(
      ' • Cada ETL que corrió dejó su reporte-etl-*.txt en backend/ (gitignored): revísalos con Daniel.',
    );
  }
  if (recordatorios.length > 0) {
    console.log('\nRecordatorios:\n' + recordatorios.join('\n'));
  }

  if (fallo !== null) {
    process.exit(1);
  }
}

const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  await main();
}
