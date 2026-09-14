/**
 * REPARA TODAS las secuencias de folio contra el máximo REAL de su tabla (§Post-F9.17), y — sólo si
 * se le pide — SALTA al ESCALÓN redondo del arranque **cualquiera de las SIETE series**
 * (§Post-F9.36 punto 5 para OP y OC, fila 0.187; §Post-F9.233 para las otras cinco y para la regla
 * del «siguiente millar», fila 0.194).
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
 * ⭐ EL SALTO AL ESCALÓN DEL ARRANQUE (filas 0.187 y 0.194 · §Post-F9.36 punto 5 y §Post-F9.233)
 *
 * Daniel, primero por OP y OC: *"Continuaría. Pero no el siguiente número disponible. Me saltaría al
 * siguiente escalón. Para saber que las nuevas órdenes empiezan a partir de la 6000 por ejemplo
 * (para OP). Esto para OP y OC también."* Y el 14-sep-2026, ampliándolo a TODAS: *"me gustaría hacer
 * saltos en todos los conteos. Si quieres ubícate en el siguiente millar. Ejemplo, una Nota de
 * salida… si van en la 4804, ubícate en la 5000."*
 *
 * Por eso hay DOS maneras de pedir el escalón, y conviven:
 *
 *  · **El número EXPLÍCITO de una serie** (`--escalon-orden=6000`): lo dijo Daniel con su cifra.
 *  · **La REGLA del siguiente millar** (`--escalon-millar`): el comando MIRA el máximo real de cada
 *    serie y sube al millar de arriba (4,804 → 5,000 · 312 → 1,000). Es una regla y no siete números
 *    tecleados porque **hoy nadie conoce esos máximos** —se sabrán el día de la migración— y teclear
 *    a mano un número POR DEBAJO del máximo real es justo el error que arruinaría el arranque.
 *    ⚠️ Es de **UNA SOLA VEZ**: recalcula contra el máximo del MOMENTO, así que volver a correrla
 *    después de empezar a capturar saltaría otra vez al millar de arriba (el escalón EXPLÍCITO, en
 *    cambio, aborta al repetirse porque su número ya está comprometido). El cuadro lo avisa.
 *
 * 🔑 **El explícito MANDA sobre la regla** (§Post-F9.233 (a)): si una serie trae su `--escalon-…`, ése
 * es su arranque aunque `--escalon-millar` esté puesto. Y para que eso **no pueda pasar en silencio**,
 * el cuadro de confirmación imprime, renglón por renglón, DE DÓNDE sale el número y —cuando es
 * explícito— **qué habría dicho la regla**, con un aviso si no coinciden.
 *
 * El comando del arranque, tal cual (los dos números explícitos son los de §Post-F9.233):
 *
 *   npx tsx --env-file=.env migracion/reparar-secuencias.ts \
 *     --escalon-millar --escalon-orden=6000 --escalon-orden-compra=10000                      # ensayo
 *   …el MISMO comando, con --aplicar al final                                                # escribe
 *
 * Tres cinturones, porque **es irreversible en cuanto alguien captura con la numeración nueva**:
 *  1. **El escalón NUNCA es automático**: hay que pedirlo, por serie (`--escalon-…`) o por regla
 *     (`--escalon-millar`). Sin ninguna de las dos, la corrida es la reparación de siempre.
 *  2. **Ensayo en seco por omisión**: con escalón y sin `--aplicar` NO se escribe NADA — se imprime
 *     el cuadro de lo que pasaría y se pide repetir el comando con `--aplicar`.
 *  3. **Aborta si el escalón no queda por encima de lo ya comprometido** (máximo de la tabla Y
 *     valor actual de la secuencia): pedir 6,000 cuando la última OP es 6,120 no se aplica en
 *     silencio ni "por lo bajo" — se aborta nombrando el caso, sin escribir nada de nada. La regla
 *     del millar no puede tropezar con esto (siempre da un número ESTRICTAMENTE mayor); el número
 *     explícito sí, y por eso la guarda se queda tal cual.
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
   * Bandera que fija el ESCALÓN de arranque de esta serie (`--escalon-orden=6000`). Desde la fila
   * 0.194 la declaran **las SIETE** (§Post-F9.233: *"me gustaría hacer saltos en todos los
   * conteos"*); hasta entonces sólo la tenían OP y OC. Es OBLIGATORIA a propósito: una serie nueva
   * no puede entrar al arranque sin decir cómo se la nombra desde la línea de comandos.
   */
  flagEscalon: string;
  /**
   * Cómo se llama la serie EN EL CUADRO DEL ESCALÓN y en el modo de uso. La `descripcion` de
   * arriba arrastra apostillas históricas ("la que faltaba", del defecto §Post-F9.17) que en el
   * reporte de siempre explican algo, pero en la pantalla del arranque sólo estorban.
   */
  etiquetaEscalon: string;
}

/** El escalón de la regla salta a múltiplos de MIL (Daniel: *"ubícate en el siguiente millar"*). */
const MILLAR = 1000n;

/**
 * La REGLA del arranque (§Post-F9.233): el millar SIGUIENTE al folio ya comprometido.
 *
 * Es **estrictamente mayor** que su entrada, siempre — y eso no es un detalle de redondeo sino la
 * propiedad que hace segura la regla:
 *  · 4,804 → 5,000 (el ejemplo textual de Daniel) · 312 → 1,000 · 0 (tabla vacía) → 1,000.
 *  · **5,000 → 6,000**, y NO 5,000: si el máximo ya cae justo en un millar, quedarse ahí repetiría
 *    el folio 5,000 —que ya está usado— y la guarda del escalón por lo bajo abortaría la corrida.
 *    Subir al siguiente millar mantiene además lo que Daniel busca: que el salto SE VEA.
 */
export function siguienteMillar(comprometido: bigint): bigint {
  return (comprometido / MILLAR + 1n) * MILLAR;
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
    flagEscalon: 'escalon-pedido',
    etiquetaEscalon: 'pedidos internos',
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
    flagEscalon: 'escalon-etapa',
    // Es UNA SOLA serie para corte, envío, recibo y entrega, y el folio SALE IMPRESO en el papel
    // del envío, el del recibo y el de la entrega (§Post-F9.233 (b)): lo tienen en la mano el
    // maquilero y el cliente ⇒ no es numeración interna, y saltarla tiene el mismo sentido que OC.
    etiquetaEscalon: 'etapas de producción (corte/envío/recibo/entrega)',
    maximos: async (c) => {
      const filas = await c.etapaMovimiento.groupBy({ by: ['idEmpresa'], _max: { folio: true } });
      return aMaximos('folio', filas);
    },
  },
  {
    clave: CLAVE_SECUENCIA_AUDITORIA,
    descripcion: 'auditorías de calidad',
    flagEscalon: 'escalon-auditoria',
    etiquetaEscalon: 'auditorías de calidad',
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
    flagEscalon: 'escalon-nota-salida',
    // La serie del EJEMPLO de Daniel: *"una Nota de salida… si van en la 4804, ubícate en la 5000"*.
    etiquetaEscalon: 'notas de salida',
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
    flagEscalon: 'escalon-tercero',
    etiquetaEscalon: 'movimientos de cuenta corriente de terceros',
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
  /** Primer folio nuevo pedido con `--escalon-…` o con la regla (ausente si no le toca escalón). */
  escalon?: bigint;
  /**
   * De dónde sale el `escalon`: de la cifra que alguien tecleó para ESTA serie (`explicito`) o de
   * la regla del siguiente millar (`millar`). Va al cuadro de confirmación: quien aplica una
   * operación irreversible tiene que ver si el número lo eligió una persona o lo calculó el
   * programa. Ausente cuando no hay escalón.
   */
  origenEscalon?: 'explicito' | 'millar';
  /**
   * Lo que la REGLA habría dicho para esta empresa, se haya usado o no. Cuando el escalón es
   * explícito y los dos números NO coinciden, el cuadro lo canta — que es lo que vuelve imposible
   * equivocarse EN SILENCIO al mezclar `--escalon-millar` con una cifra a mano. Ausente cuando no
   * hay escalón.
   */
  millarRegla?: bigint;
  /** Valor que se sembrará en la secuencia. */
  valorASembrar: bigint;
  /** Folio que tomará la siguiente captura si el plan se aplica. */
  siguiente: bigint;
}

/** Qué va a pasar con una serie (sin renglones = tabla sin datos: no se toca). */
export interface PlanSerie {
  clave: string;
  descripcion: string;
  /** Nombre corto para el cuadro del escalón (la `descripcion` arrastra apostillas históricas). */
  etiqueta: string;
  /** Bandera de su escalón (`escalon-orden`), sin los guiones: el cuadro la cita tal cual se teclea. */
  flagEscalon: string;
  renglones: RenglonPlan[];
}

/** Lo que la corrida haría. Se calcula SÓLO leyendo; escribir es un paso aparte. */
export interface Plan {
  series: PlanSerie[];
  /** ¿Algún renglón lleva escalón? Es lo que enciende el ensayo en seco por omisión. */
  hayEscalon: boolean;
  /**
   * Series a las que la REGLA del millar no pudo aplicarse porque su tabla está vacía (etiquetas).
   * No es un error —no hay folio que saltar ni empresa a la que aplicárselo—, pero **tiene que
   * verse**: quien corre el arranque pidió que saltaran todas, y éstas no van a saltar. Con un
   * escalón EXPLÍCITO el mismo caso ABORTA (alguien tecleó una cifra y debe aterrizar en algún
   * sitio); con la regla sólo se informa, para que una serie vacía no tumbe el comando del go-live.
   */
  sinDatosConRegla: string[];
}

/** Filtros y escalones de una corrida. */
export interface OpcionesPlan {
  /** Sólo estas series (lo usan los ETL para sembrar las suyas). Por omisión, todas. */
  claves?: readonly string[];
  /** Serie → primer folio nuevo pedido A MANO. Manda sobre la regla del millar (§Post-F9.233 (a)). */
  escalones?: ReadonlyMap<string, bigint>;
  /**
   * Aplica la REGLA del siguiente millar a TODA serie que no traiga su número explícito
   * (§Post-F9.233). El número se calcula por empresa, del máximo real de esa empresa: dos empresas
   * de la misma serie pueden arrancar en millares distintos, y así debe ser (cada una numera lo
   * suyo, la secuencia es por `idEmpresa`+clave).
   */
  millar?: boolean;
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
 * o si no hay ninguna empresa a la que aplicar un escalón EXPLÍCITO (el de la REGLA, en cambio, no
 * aborta: la serie vacía se anota en `sinDatosConRegla` y se canta en el cuadro). Se juntan todos
 * los casos en un solo error y
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
  const sinDatosConRegla: string[] = [];
  let hayEscalon = false;

  for (const serie of series) {
    const maximos = await serie.maximos(cliente);
    const explicito = opciones.escalones?.get(serie.clave);
    // La regla sólo entra donde NO hay cifra a mano: el explícito manda (§Post-F9.233 (a)).
    const porRegla = explicito === undefined && opciones.millar === true;
    const pideEscalon = explicito !== undefined || porRegla;

    // A qué empresas alcanza esta serie: las que tienen histórico y —si se pidió el escalón para
    // una empresa concreta— también ésa, aunque su tabla esté vacía (arranque desde cero).
    const ids = new Set(maximos.map((m) => m.idEmpresa));
    if (pideEscalon && opciones.idEmpresa !== undefined) ids.add(opciones.idEmpresa);

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
        pideEscalon && (opciones.idEmpresa === undefined || opciones.idEmpresa === idEmpresa);

      if (leToca) {
        // La regla se resuelve AQUÍ y no al leer las banderas: depende de `comprometido`, que es
        // de esta empresa y esta serie. Por eso `--escalon-millar` no es "un número" sino una regla.
        const millarRegla = siguienteMillar(comprometido);
        const escalon = explicito ?? millarRegla;
        hayEscalon = true;
        alcanzadas += 1;
        if (escalon <= comprometido) {
          // Sólo alcanzable con un número EXPLÍCITO: `siguienteMillar` es siempre > comprometido.
          casos.push(
            `  ✖ ${serie.clave} · empresa ${String(idEmpresa)} (${nombreEmpresa}): pediste arrancar ` +
              `en ${conMiles(escalon)}, pero el folio más alto ya comprometido es ` +
              `${conMiles(comprometido)} (máximo en la tabla ${conMiles(maxTabla)}, secuencia en ` +
              `${conMiles(valorSecuencia)}). Un escalón por debajo REPETIRÍA folios: elige uno mayor ` +
              `que ${conMiles(comprometido)} (la regla del millar diría ${conMiles(millarRegla)}).`,
          );
          continue;
        }
        renglones.push({
          ...base,
          escalon,
          origenEscalon: explicito === undefined ? 'millar' : 'explicito',
          millarRegla,
          valorASembrar: escalon - 1n,
          siguiente: escalon,
        });
      } else {
        renglones.push({ ...base, valorASembrar: maxTabla, siguiente: comprometido + 1n });
      }
    }

    if (pideEscalon && alcanzadas === 0) {
      // Ni una empresa a la que aplicárselo. (Sólo puede pasar SIN `--empresa`: con ella, esa
      // empresa siempre entra en `ids`, y que exista ya se comprobó arriba.)
      if (explicito === undefined) {
        // Por REGLA: no es un error. La serie no tiene folios que saltar y arrancará en 1; tumbar
        // el comando del go-live por una tabla vacía empujaría a quitar la regla, que es peor. Se
        // informa en el cuadro, que es donde lo va a leer quien aplica.
        sinDatosConRegla.push(serie.etiquetaEscalon);
      } else {
        // EXPLÍCITO: alguien tecleó una cifra y no va a aterrizar en ningún lado. Eso sí aborta,
        // porque el escalón sería un no-op silencioso mientras el reporte canta un número.
        casos.push(
          `  ✖ --${serie.flagEscalon}: la serie "${serie.clave}" (${serie.descripcion}) ` +
            `no tiene ninguna fila, así que no sé a qué empresa aplicarle el escalón. Corre primero ` +
            `el ETL, o dilo con --empresa=<id>.`,
        );
      }
    }

    plan.push({
      clave: serie.clave,
      descripcion: serie.descripcion,
      etiqueta: serie.etiquetaEscalon,
      flagEscalon: serie.flagEscalon,
      renglones,
    });
  }

  if (casos.length > 0) throw new ErrorEscalonInvalido(casos);
  return { series: plan, hayEscalon, sinDatosConRegla };
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
  if (plan.series.some((s) => s.renglones.some((r) => r.origenEscalon === 'millar'))) {
    // La REGLA se recalcula en cada corrida contra el máximo del momento: una vez capturado el
    // 5,000, `--escalon-millar` volvería a subir al 6,000. El escalón EXPLÍCITO, en cambio, aborta
    // al repetirse (ya está comprometido). Hay que decirlo AQUÍ, que es donde se decide aplicar.
    p.push(' ⚠️  --escalon-millar es de UNA SOLA VEZ: recalcula contra el máximo del momento, así');
    p.push(
      '     que repetirlo DESPUÉS de empezar a capturar saltaría otra vez al millar de arriba.',
    );
  }
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
      // ⭐ DE DÓNDE SALE EL NÚMERO. Es lo que vuelve imposible equivocarse en silencio al mezclar
      // `--escalon-millar` con una cifra a mano (§Post-F9.233 (a)): si el explícito y la regla no
      // dicen lo mismo, el cuadro lo canta ANTES de que nadie escriba nada.
      if (r.origenEscalon === 'explicito') {
        p.push(`    de dónde sale: NÚMERO EXPLÍCITO --${serie.flagEscalon}=${String(r.escalon)}`);
        p.push(
          r.millarRegla === r.escalon
            ? `      manda sobre la regla del millar, que aquí decía lo mismo (${conMiles(r.millarRegla ?? 0n)})`
            : `      ⚠️  manda sobre la regla del millar, que decía ${conMiles(r.millarRegla ?? 0n)}: se usa el explícito`,
        );
      } else {
        p.push(
          `    de dónde sale: REGLA --escalon-millar (el millar siguiente a ${conMiles(r.comprometido)})`,
        );
      }
    }
  }
  if (plan.sinDatosConRegla.length > 0) {
    // Las series vacías NO saltan, y quien pidió que saltaran todas tiene que verlo aquí — no
    // deducirlo de una ausencia en el cuadro.
    p.push('');
    p.push('  Series que NO saltan porque su tabla está VACÍA (arrancarán en 1):');
    for (const etiqueta of plan.sinDatosConRegla) {
      p.push(`    · ${etiqueta}`);
    }
    p.push('    Si alguna debe saltar igual, dilo con --empresa=<id>.');
  }
  p.push('');
  p.push(
    escrito
      ? ' Aplicado. La próxima captura de cada serie de arriba tomará su número redondo.'
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
  /** Serie → primer folio nuevo pedido A MANO (vacío = ninguna cifra explícita). */
  escalones: Map<string, bigint>;
  /** `--escalon-millar`: la regla del siguiente millar para toda serie sin cifra explícita. */
  millar: boolean;
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
  const banderas = SERIES.map(
    (s) => `  ${`--${s.flagEscalon}=<n>`.padEnd(30)}primer folio nuevo de ${s.etiquetaEscalon}`,
  );
  return [
    'Uso: npx tsx --env-file=.env migracion/reparar-secuencias.ts [opciones]',
    '',
    'Sin opciones: adelanta TODA secuencia de folio al máximo real (idempotente e inocuo).',
    '',
    'Salto al escalón de arranque (§Post-F9.36 punto 5 · §Post-F9.233):',
    `  ${'--escalon-millar'.padEnd(30)}REGLA: cada serie salta al millar siguiente a su máximo real`,
    '',
    '  …y el número EXPLÍCITO de una serie, que MANDA sobre la regla:',
    ...banderas,
    '',
    `  ${'--aplicar'.padEnd(30)}escribe el escalón (sin esto sólo se ENSAYA)`,
    `  ${'--empresa=<id>'.padEnd(30)}limita el escalón a una empresa (por omisión, todas)`,
    `  ${'--simular'.padEnd(30)}ensayo en seco aunque no haya escalón (alias: --dry-run)`,
    `  ${'--ayuda'.padEnd(30)}esto`,
    '',
    'El comando del arranque (§Post-F9.233), primero SIN --aplicar para leer el cuadro:',
    '  --escalon-millar --escalon-orden=6000 --escalon-orden-compra=10000',
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
  const conValor = new Set(['empresa', ...SERIES.map((s) => s.flagEscalon)]);
  const solas = new Set(['aplicar', 'simular', 'dry-run', 'ayuda', 'help', 'escalon-millar']);

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
      // Repetida = ABORTA. Quedarse con la última (o con la primera) sería ADIVINAR, y este
      // parser existe justo para lo contrario: en una operación irreversible que se teclea con
      // prisa, `--escalon-orden=6000 --escalon-orden=7000` no puede resolverse en silencio.
      if (valores.has(nombreConValor)) {
        throw new Error(
          `--${nombreConValor} viene dos veces (con "${valores.get(nombreConValor) ?? ''}" y con ` +
            `"${conIgual?.[2] ?? ''}"). No adivino cuál querías: déjala UNA sola vez.\n\n${modoDeUso()}`,
        );
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
    // ESTRICTO igual que el escalón: `parseInt` a secas se traga "4abc" (→ 4) y "2.9" (→ 2), o sea
    // que un dedazo aplicaría el salto a OTRA empresa sin decir nada. En una corrida irreversible
    // vale mil veces más un aborto que una empresa adivinada.
    if (!/^\d+$/.test(empresaCruda)) {
      throw new Error(`--empresa debe ser un id entero ≥ 1 (llegó "${empresaCruda}").`);
    }
    idEmpresa = Number.parseInt(empresaCruda, 10);
    if (idEmpresa < 1) {
      throw new Error(`--empresa debe ser un id entero ≥ 1 (llegó "${empresaCruda}").`);
    }
  }

  const millar = presentes.has('escalon-millar');
  const pideEscalon = escalones.size > 0 || millar;
  const aplicar = presentes.has('aplicar');
  const simular = presentes.has('simular') || presentes.has('dry-run');
  if (aplicar && simular) {
    throw new Error('--aplicar y --simular se contradicen: elige uno.');
  }
  if (aplicar && !pideEscalon) {
    throw new Error(
      '--aplicar sólo tiene sentido con un escalón: sin él la reparación normal ya escribe (es inocua).',
    );
  }
  if (idEmpresa !== undefined && !pideEscalon) {
    throw new Error(
      '--empresa sólo acota el ESCALÓN: la reparación normal siempre corre para todas las empresas.',
    );
  }

  return {
    escalones,
    millar,
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
  // Mismos tiempos HOLGADOS que los 16 ETL de `migracion/` (los defaults de Prisma son maxWait
  // 2 s / timeout 5 s). Esto se corre desde una laptop contra la BD REMOTA de Railway y
  // `aplicarPlan` mete TODAS las series en UNA sola transacción, así que 5 s no dan margen. El
  // código viejo escribía FUERA de transacción: el riesgo de agotar el tiempo nació con esta fila.
  // (Si aun así se agotara: P2028 → rollback → no escribe NADA y se vuelve a correr, porque es
  // idempotente. Pero ésta es la corrida que no debe fallar.)
  const cliente = crearClientePrisma(url, {
    transactionOptions: { maxWait: 20_000, timeout: 120_000 },
  });
  try {
    const plan = await planificar(cliente, {
      escalones: opciones.escalones,
      millar: opciones.millar,
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
    } else if (opciones.millar) {
      // Pidió la regla y NINGUNA serie tenía folios que saltar. No es un error (nada se repite y
      // todas arrancarán en 1), pero decirlo callando sería mentir por omisión.
      console.log(
        '\n⚠️  Pediste --escalon-millar y NINGUNA serie tiene datos: no saltó nada.\n' +
          '   Corre primero los cargadores, o dilo con --empresa=<id> para saltar desde cero.',
      );
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
