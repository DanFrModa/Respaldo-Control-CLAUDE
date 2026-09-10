/**
 * REPARA TODAS las secuencias de folio contra el máximo REAL de su tabla (§Post-F9.17), y — sólo si
 * se le pide — SALTA la numeración de OP y OC al siguiente ESCALÓN redondo del arranque
 * (§Post-F9.36 punto 5, fila 0.187).
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
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * ⭐ EL SALTO AL ESCALÓN DEL ARRANQUE (fila 0.187 · decisión §Post-F9.36 punto 5)
 *
 * Daniel: *"Continuaría. Pero no el siguiente número disponible. Me saltaría al siguiente escalón.
 * Para saber que las nuevas órdenes empiezan a partir de la 6000 por ejemplo (para OP). Esto para OP
 * y OC también."* El número exacto se fija EN EL ENSAYO, cuando se conozca el máximo real migrado.
 *
 *   npx tsx --env-file=.env migracion/reparar-secuencias.ts --escalon-orden=6000            # ensayo
 *   npx tsx --env-file=.env migracion/reparar-secuencias.ts --escalon-orden=6000 --aplicar  # de veras
 *
 * Tres cinturones, porque **es irreversible en cuanto alguien captura con la numeración nueva**:
 *  1. **Sólo OP y OC** admiten escalón (las otras cinco series no tienen bandera: no se pueden
 *     saltar ni por error de dedo). Cada serie declara la suya en {@link SERIES}.
 *  2. **Ensayo en seco por omisión**: con escalón y sin `--aplicar` NO se escribe NADA — se imprime
 *     el cuadro de lo que pasaría y se pide repetir el comando con `--aplicar`.
 *  3. **Aborta si el escalón no queda por encima de lo ya comprometido** (máximo de la tabla Y
 *     valor actual de la secuencia): pedir 6,000 cuando la última OP es 6,120 no se aplica en
 *     silencio ni "por lo bajo" — se aborta nombrando el caso, sin escribir nada de nada.
 *
 * Cualquier bandera desconocida ABORTA (un `--escalon-orden 6000` con espacio, o un `--dry_run`, no
 * pueden acabar en una corrida real por descuido).
 * ────────────────────────────────────────────────────────────────────────────────────────────────
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
  /**
   * Bandera que fija el ESCALÓN de arranque de esta serie (`--escalon-orden=6000`). **Sólo la
   * declaran las dos series que Daniel nombró** (OP y OC, §Post-F9.36 punto 5): una serie sin
   * bandera no se puede saltar. Sumar otra en el futuro es esta línea y nada más.
   */
  flagEscalon?: string;
  /**
   * Cómo se llama la serie EN EL CUADRO DEL ESCALÓN y en el modo de uso. La `descripcion` de
   * arriba arrastra apostillas históricas ("la que faltaba", del defecto §Post-F9.17) que en el
   * reporte de siempre explican algo, pero en la pantalla del arranque sólo estorban.
   */
  etiquetaEscalon?: string;
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
    flagEscalon: 'escalon-orden',
    etiquetaEscalon: 'órdenes de producción (OP)',
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
    flagEscalon: 'escalon-orden-compra',
    etiquetaEscalon: 'órdenes de compra (OC)',
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
 * El escalón pedido NO se puede aplicar. Lleva TODOS los casos detectados en un solo mensaje (en el
 * arranque conviene ver los dos números malos de una vez, no uno por corrida). Nada se escribe.
 */
export class ErrorEscalonInvalido extends Error {
  constructor(readonly casos: readonly string[]) {
    super(casos.join('\n'));
    this.name = 'ErrorEscalonInvalido';
  }
}

/** Qué va a pasar con UNA serie en UNA empresa. */
export interface RenglonPlan {
  idEmpresa: number;
  nombreEmpresa: string;
  /** Máximo folio que HOY existe en la tabla (0 si no hay ninguno). */
  maxTabla: bigint;
  /** Valor actual de la secuencia (0 si nunca se usó). */
  valorSecuencia: bigint;
  /**
   * El folio más alto ya COMPROMETIDO: `max(maxTabla, valorSecuencia)`. La secuencia puede ir por
   * ENCIMA de la tabla (un rollback quema folio sin dejar fila) y `sembrarSecuencia` es monótona,
   * así que éste —y no el máximo de la tabla— es el número contra el que hay que medir el escalón.
   */
  comprometido: bigint;
  /** Primer folio nuevo pedido con `--escalon-…` (ausente si no se pidió para esta empresa). */
  escalon?: bigint;
  /** Valor que se sembrará en la secuencia. */
  valorASembrar: bigint;
  /** Folio que tomará la siguiente captura si el plan se aplica. */
  siguiente: bigint;
}

/** Qué va a pasar con una serie (sin renglones = tabla sin datos: no se toca). */
export interface PlanSerie {
  clave: string;
  descripcion: string;
  /** Nombre corto para el cuadro del escalón (cae en `descripcion` si la serie no trae uno). */
  etiqueta: string;
  renglones: RenglonPlan[];
}

/** Lo que la corrida haría. Se calcula SÓLO leyendo; escribir es un paso aparte. */
export interface Plan {
  series: PlanSerie[];
  /** ¿Algún renglón lleva escalón? Es lo que enciende el ensayo en seco por omisión. */
  hayEscalon: boolean;
}

/** Filtros y escalones de una corrida. */
export interface OpcionesPlan {
  /** Sólo estas series (lo usan los ETL para sembrar las suyas). Por omisión, todas. */
  claves?: readonly string[];
  /** Serie → primer folio nuevo pedido. */
  escalones?: ReadonlyMap<string, bigint>;
  /** Limita el ESCALÓN a una empresa (la reparación normal siempre corre para todas: es inocua). */
  idEmpresa?: number;
}

/** Separador de miles sin depender de ICU (el reporte se lee a las 2 a.m. y debe ser estable). */
function conMiles(n: bigint): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Calcula QUÉ haría la corrida, **sin escribir nada**. Lee tres cosas: el máximo folio de cada
 * tabla, el valor actual de cada secuencia y el nombre de las empresas (para que el cuadro del
 * escalón se lea en palabras y no en ids).
 *
 * @throws {ErrorEscalonInvalido} si algún escalón pedido no queda POR ENCIMA de lo ya comprometido,
 * o si no hay ninguna empresa a la que aplicárselo. Se juntan todos los casos en un solo error y
 * **no se escribe nada**: un escalón por lo bajo repetiría folios y, por la monotonía de
 * `sembrarSecuencia`, se quedaría en NO-OP mientras el reporte canta un número que no es.
 */
export async function planificar(
  cliente: PrismaClient,
  opciones: OpcionesPlan = {},
): Promise<Plan> {
  const claves = opciones.claves;
  const series = claves === undefined ? SERIES : SERIES.filter((s) => claves.includes(s.clave));

  const empresas = new Map(
    (await cliente.empresa.findMany({ select: { id: true, nombre: true } })).map((e) => [
      e.id,
      e.nombre,
    ]),
  );
  const filasSecuencia = await cliente.secuencia.findMany({
    select: { idEmpresa: true, clave: true, valor: true },
  });
  const secuencias = new Map(
    filasSecuencia.map((s) => [`${String(s.idEmpresa)}|${s.clave}`, s.valor]),
  );

  // Una `--empresa` que no existe se caza AQUÍ y no al escribir: si no, la única señal sería el
  // choque de la llave foránea de `secuencias`, que no le dice nada a quien está en el arranque.
  if (opciones.idEmpresa !== undefined && !empresas.has(opciones.idEmpresa)) {
    throw new ErrorEscalonInvalido([
      `  ✖ --empresa=${String(opciones.idEmpresa)}: no existe esa empresa. Las que hay: ` +
        `${[...empresas].map(([id, nombre]) => `${String(id)} (${nombre})`).join(' · ')}.`,
    ]);
  }

  const casos: string[] = [];
  const plan: PlanSerie[] = [];
  let hayEscalon = false;

  for (const serie of series) {
    const maximos = await serie.maximos(cliente);
    const escalon = opciones.escalones?.get(serie.clave);

    // A qué empresas alcanza esta serie: las que tienen histórico y —si se pidió el escalón para
    // una empresa concreta— también ésa, aunque su tabla esté vacía (arranque desde cero).
    const ids = new Set(maximos.map((m) => m.idEmpresa));
    if (escalon !== undefined && opciones.idEmpresa !== undefined) ids.add(opciones.idEmpresa);

    const renglones: RenglonPlan[] = [];
    /**
     * A cuántas empresas ALCANZÓ el escalón — se cuenta aunque la empresa acabe rechazada por ir
     * el escalón por lo bajo. Si se contaran sólo los renglones aceptados, un escalón rechazado
     * dispararía ADEMÁS el aviso de "esta serie no tiene ninguna fila", que sería falso y mandaría
     * a corregir lo que no está mal.
     */
    let alcanzadas = 0;
    for (const idEmpresa of [...ids].sort((a, b) => a - b)) {
      const maxTabla = maximos.find((m) => m.idEmpresa === idEmpresa)?.max ?? 0n;
      const valorSecuencia = secuencias.get(`${String(idEmpresa)}|${serie.clave}`) ?? 0n;
      const comprometido = maxTabla > valorSecuencia ? maxTabla : valorSecuencia;
      const nombreEmpresa = empresas.get(idEmpresa) ?? `empresa ${String(idEmpresa)}`;
      const base = { idEmpresa, nombreEmpresa, maxTabla, valorSecuencia, comprometido };
      const leToca =
        escalon !== undefined &&
        (opciones.idEmpresa === undefined || opciones.idEmpresa === idEmpresa);

      if (leToca && escalon !== undefined) {
        hayEscalon = true;
        alcanzadas += 1;
        if (escalon <= comprometido) {
          casos.push(
            `  ✖ ${serie.clave} · empresa ${String(idEmpresa)} (${nombreEmpresa}): pediste arrancar ` +
              `en ${conMiles(escalon)}, pero el folio más alto ya comprometido es ` +
              `${conMiles(comprometido)} (máximo en la tabla ${conMiles(maxTabla)}, secuencia en ` +
              `${conMiles(valorSecuencia)}). Un escalón por debajo REPETIRÍA folios: elige uno mayor ` +
              `que ${conMiles(comprometido)}.`,
          );
          continue;
        }
        renglones.push({ ...base, escalon, valorASembrar: escalon - 1n, siguiente: escalon });
      } else {
        renglones.push({ ...base, valorASembrar: maxTabla, siguiente: comprometido + 1n });
      }
    }

    if (escalon !== undefined && alcanzadas === 0) {
      // Ni una empresa a la que aplicárselo: sin esto, el escalón sería un no-op silencioso.
      // (Sólo puede pasar SIN `--empresa`: con ella, esa empresa siempre entra en `ids`, y que
      // exista ya se comprobó arriba.)
      casos.push(
        `  ✖ --${serie.flagEscalon ?? 'escalon'}: la serie "${serie.clave}" (${serie.descripcion}) ` +
          `no tiene ninguna fila, así que no sé a qué empresa aplicarle el escalón. Corre primero ` +
          `el ETL, o dilo con --empresa=<id>.`,
      );
    }

    plan.push({
      clave: serie.clave,
      descripcion: serie.descripcion,
      etiqueta: serie.etiquetaEscalon ?? serie.descripcion,
      renglones,
    });
  }

  if (casos.length > 0) throw new ErrorEscalonInvalido(casos);
  return { series: plan, hayEscalon };
}

/**
 * ESCRIBE el plan. Todo en UNA transacción: con escalón el cambio es irreversible en la práctica, y
 * medio aplicado (la OP saltada y la OC no) sería peor que no aplicado.
 */
export async function aplicarPlan(cliente: PrismaClient, plan: Plan): Promise<void> {
  await cliente.$transaction(async (tx) => {
    for (const serie of plan.series) {
      for (const renglon of serie.renglones) {
        await sembrarSecuencia(tx, renglon.idEmpresa, serie.clave, renglon.valorASembrar);
      }
    }
  });
}

/**
 * ¿Esta corrida ESCRIBE, o sólo ensaya? Es el cinturón nº 2 del escalón, y por eso vive en una
 * función propia y probada: **con escalón, el ensayo en seco es el DEFAULT** y sólo `--aplicar`
 * escribe. Sin escalón manda el comportamiento de siempre (escribe, salvo `--simular`), porque la
 * reparación normal es idempotente, monótona e inocua.
 */
export function corridaEscribe(
  opciones: Pick<OpcionesCli, 'aplicar' | 'simular'>,
  hayEscalon: boolean,
): boolean {
  if (opciones.simular) return false;
  return hayEscalon ? opciones.aplicar : true;
}

/** El reporte de siempre: un renglón por serie con el folio que tomará la próxima captura. */
export function formatearReporte(plan: Plan): string[] {
  return plan.series.map((serie) => {
    if (serie.renglones.length === 0) {
      return `  ${serie.clave}: sin datos (${serie.descripcion}) → no se toca`;
    }
    const detalle = serie.renglones
      .map((r) => `empresa ${String(r.idEmpresa)}: siguiente = ${String(r.siguiente)}`)
      .join(' · ');
    return `  ${serie.clave} (${serie.descripcion}) → ${detalle}`;
  });
}

/**
 * El cuadro del ESCALÓN: lo que va a pasar, en números grandes y en palabras, ANTES de que pase.
 * Es la "confirmación" de una operación irreversible — y se imprime igual en el ensayo que al
 * aplicar, para que lo que se leyó sea exactamente lo que se hizo.
 */
export function formatearEscalon(plan: Plan, escrito: boolean): string {
  const p: string[] = [];
  p.push('');
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(
    ` SALTO DE FOLIO AL ESCALÓN DE ARRANQUE${
      escrito ? '  ·  APLICADO' : '  ·  ENSAYO EN SECO (no se escribió nada)'
    }`,
  );
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(' ⚠️  IRREVERSIBLE en cuanto alguien capture con la numeración nueva.');
  for (const serie of plan.series) {
    for (const r of serie.renglones) {
      if (r.escalon === undefined) continue;
      p.push('');
      p.push(`  ${serie.clave} — ${serie.etiqueta}`);
      p.push(`  empresa ${String(r.idEmpresa)} · ${r.nombreEmpresa}`);
      p.push(
        `${'    último folio ya comprometido'.padEnd(42)}${conMiles(r.comprometido).padStart(12)}`,
      );
      p.push(
        `${'    sin escalón, la siguiente sería'.padEnd(42)}${conMiles(r.comprometido + 1n).padStart(12)}`,
      );
      p.push(
        `${'    CON el escalón, la siguiente será'.padEnd(42)}${conMiles(r.escalon).padStart(12)}`,
      );
      p.push(
        `${'    folios que quedan sin usar'.padEnd(42)}${conMiles(r.escalon - r.comprometido - 1n).padStart(12)}`,
      );
    }
  }
  p.push('');
  p.push(
    escrito
      ? ' Aplicado. La próxima OP/OC capturada tomará el número redondo de arriba.'
      : ' NO se escribió nada. Si el cuadro es correcto, repite el MISMO comando con --aplicar.',
  );
  return p.join('\n');
}

/**
 * Repara las series contra el cliente dado (todas, o solo las `claves` pedidas — así un ETL siembra
 * las suyas sin duplicar la lógica). Devuelve un renglón de reporte por serie. **Sin escalón**: es
 * la reparación de siempre, idempotente y monótona.
 */
export async function repararSecuencias(
  cliente: PrismaClient,
  claves?: readonly string[],
): Promise<string[]> {
  const plan = await planificar(cliente, claves === undefined ? {} : { claves });
  await aplicarPlan(cliente, plan);
  return formatearReporte(plan);
}

/** Opciones de la línea de comandos. */
export interface OpcionesCli {
  /** Serie → primer folio nuevo pedido (vacío = corrida normal). */
  escalones: Map<string, bigint>;
  idEmpresa?: number;
  /** Escribir de verdad el escalón (sin esto, con escalón sólo se ensaya). */
  aplicar: boolean;
  /** Forzar ensayo en seco aunque no haya escalón. */
  simular: boolean;
  /** Sólo imprimir el modo de uso. */
  ayuda: boolean;
}

/** El modo de uso, construido desde {@link SERIES} para que las banderas no se desincronicen. */
export function modoDeUso(): string {
  const banderas = SERIES.filter((s) => s.flagEscalon !== undefined).map(
    (s) =>
      `  ${`--${s.flagEscalon ?? ''}=<n>`.padEnd(30)}primer folio nuevo de ${s.etiquetaEscalon ?? s.descripcion}`,
  );
  return [
    'Uso: npx tsx --env-file=.env migracion/reparar-secuencias.ts [opciones]',
    '',
    'Sin opciones: adelanta TODA secuencia de folio al máximo real (idempotente e inocuo).',
    '',
    'Salto al escalón de arranque (§Post-F9.36 punto 5) — sólo estas series:',
    ...banderas,
    `  ${'--aplicar'.padEnd(30)}escribe el escalón (sin esto sólo se ENSAYA)`,
    `  ${'--empresa=<id>'.padEnd(30)}limita el escalón a una empresa (por omisión, todas)`,
    `  ${'--simular'.padEnd(30)}ensayo en seco aunque no haya escalón (alias: --dry-run)`,
    `  ${'--ayuda'.padEnd(30)}esto`,
  ].join('\n');
}

/**
 * Lee las banderas de `process.argv` (mismo estilo que el resto de `migracion/`).
 *
 * Es ESTRICTA a propósito: una bandera que no reconoce ABORTA en vez de ignorarla. Un
 * `--escalon-orden 6000` (con espacio en vez de `=`) o un `--dry_run` mal escrito no pueden acabar
 * en una corrida real por descuido — que es justo el riesgo de una operación irreversible que se
 * teclea con prisa.
 */
export function leerOpciones(argv: readonly string[]): OpcionesCli {
  const conValor = new Set([
    'empresa',
    ...SERIES.flatMap((s) => (s.flagEscalon === undefined ? [] : [s.flagEscalon])),
  ]);
  const solas = new Set(['aplicar', 'simular', 'dry-run', 'ayuda', 'help']);

  const valores = new Map<string, string>();
  const presentes = new Set<string>();
  for (const arg of argv) {
    if (arg === '--') continue; // separador que enseña el README (`-- --archivo=…`)
    const conIgual = /^--([a-z][a-z0-9-]*)=(.*)$/.exec(arg);
    const nombreConValor = conIgual?.[1];
    if (nombreConValor !== undefined) {
      if (!conValor.has(nombreConValor)) {
        throw new Error(`Opción desconocida: "${arg}".\n\n${modoDeUso()}`);
      }
      valores.set(nombreConValor, conIgual?.[2] ?? '');
      continue;
    }
    const sola = /^--([a-z][a-z0-9-]*)$/.exec(arg)?.[1];
    if (sola !== undefined && solas.has(sola)) {
      presentes.add(sola);
      continue;
    }
    // Pista para el error de dedo más probable: la bandera correcta pero con espacio en vez de "=".
    const pista =
      sola !== undefined && conValor.has(sola)
        ? ` Esa opción lleva su número pegado con "=", así: "${arg}=6000".`
        : '';
    throw new Error(`Opción desconocida: "${arg}".${pista}\n\n${modoDeUso()}`);
  }

  const escalones = new Map<string, bigint>();
  for (const serie of SERIES) {
    const bandera = serie.flagEscalon;
    if (bandera === undefined) continue;
    const crudo = valores.get(bandera);
    if (crudo === undefined) continue;
    if (!/^\d+$/.test(crudo)) {
      throw new Error(
        `--${bandera} debe ser un entero sin comas ni puntos (llegó "${crudo}"; escribe 6000, no 6,000).`,
      );
    }
    const valor = BigInt(crudo);
    if (valor < 1n) {
      throw new Error(`--${bandera} debe ser ≥ 1 (llegó "${crudo}").`);
    }
    escalones.set(serie.clave, valor);
  }

  const empresaCruda = valores.get('empresa');
  let idEmpresa: number | undefined;
  if (empresaCruda !== undefined) {
    idEmpresa = Number.parseInt(empresaCruda, 10);
    if (Number.isNaN(idEmpresa) || idEmpresa < 1) {
      throw new Error(`--empresa debe ser un id entero ≥ 1 (llegó "${empresaCruda}").`);
    }
  }

  const aplicar = presentes.has('aplicar');
  const simular = presentes.has('simular') || presentes.has('dry-run');
  if (aplicar && simular) {
    throw new Error('--aplicar y --simular se contradicen: elige uno.');
  }
  if (aplicar && escalones.size === 0) {
    throw new Error(
      '--aplicar sólo tiene sentido con un escalón: sin él la reparación normal ya escribe (es inocua).',
    );
  }
  if (idEmpresa !== undefined && escalones.size === 0) {
    throw new Error(
      '--empresa sólo acota el ESCALÓN: la reparación normal siempre corre para todas las empresas.',
    );
  }

  return {
    escalones,
    ...(idEmpresa === undefined ? {} : { idEmpresa }),
    aplicar,
    simular,
    ayuda: presentes.has('ayuda') || presentes.has('help'),
  };
}

/** Punto de entrada del script. */
async function principal(): Promise<void> {
  let opciones: OpcionesCli;
  try {
    opciones = leerOpciones(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  if (opciones.ayuda) {
    console.log(modoDeUso());
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (corre con --env-file=.env — ver migracion/README.md)');
    process.exit(1);
  }
  const cliente = crearClientePrisma(url);
  try {
    const plan = await planificar(cliente, {
      escalones: opciones.escalones,
      ...(opciones.idEmpresa === undefined ? {} : { idEmpresa: opciones.idEmpresa }),
    });

    const escribe = corridaEscribe(opciones, plan.hayEscalon);
    if (escribe) await aplicarPlan(cliente, plan);

    // El encabezado dice de entrada si esto PASÓ o sólo pasaría: el reporte de abajo se lee igual
    // en los dos casos, y confundirlos en una operación irreversible sale caro.
    console.log(
      escribe
        ? 'Reparando secuencias de folio contra el máximo real de cada tabla…\n'
        : 'ENSAYO EN SECO — esto es lo que QUEDARÍA (no se escribió nada):\n',
    );
    for (const linea of formatearReporte(plan)) {
      console.log(linea);
    }
    if (plan.hayEscalon) {
      console.log(formatearEscalon(plan, escribe));
    } else if (escribe) {
      console.log(
        '\nListo. Es idempotente y monótono: correrlo de nuevo no baja ninguna serie.\n' +
          'Conviene correrlo después de CUALQUIER ETL que migre folios explícitos.',
      );
    } else {
      console.log('\nENSAYO EN SECO (--simular): no se escribió nada.');
    }
  } catch (error) {
    if (!(error instanceof ErrorEscalonInvalido)) throw error;
    console.error('\nNO se escribió NADA. El escalón pedido no se puede aplicar:\n');
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await cliente.$disconnect();
  }
}

const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  await principal();
}
