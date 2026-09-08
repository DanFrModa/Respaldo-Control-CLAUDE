/**
 * ⭐ LOS DÍAS VENCIDOS DE UN PROVEEDOR (fila 0.121) — la columna con la que Daniel decide, cada
 * jueves, a quién le paga.
 *
 * **DANIEL, 7-sep-2026 (§Post-F9.218(a)),** cuando se le preguntó con qué tramos agrupar la
 * antigüedad: *«Es irrelevante. Ni siquiera veo eso. **Solo con que pongas los días vencidos es
 * suficiente**.»* ⇒ aquí no hay cubetas: hay **un número por renglón**. El aging por cubetas sigue
 * donde estaba (`aging-comun.ts`, configurable) para quien lo use; esta pantalla no se diseña
 * alrededor de él.
 *
 * ## Qué número es, exactamente
 * **Los días que lleva vencido el cargo MÁS VIEJO que todavía no se ha pagado.** Es el número que
 * decide la urgencia: un promedio ponderado escondería justo la factura vieja que hay que sacar.
 *
 *  • `null` → **no hay nada que envejecer** (no debe nada, o los pagos ya cubrieron todo).
 *  • `0` → debe, pero **nada ha vencido** todavía (está dentro de su plazo).
 *  • `n > 0` → su cargo más viejo sin pagar lleva `n` días vencido.
 *
 * ## Por qué hay que "aplicar" los pagos para saberlo, y con qué convención
 * Los pagos **no están amarrados a un cargo concreto** (el motor todavía no liga pago↔factura; lo
 * dice `aging-comun.ts` en su nota del neteo). Así que «el cargo más viejo que sigue sin pagarse»
 * hay que **suponerlo**, y se supone con **la MISMA convención que ya usan las cubetas**: los
 * créditos se aplican **de más viejo a más nuevo**. Reusarla no es comodidad — es lo que impide que
 * esta columna y las cubetas de la bandeja cuenten historias distintas del mismo proveedor.
 *
 * ## De dónde salen los días (y por qué NO se calculan en JavaScript)
 * El `diasAtraso` de cada cargo lo calcula **Postgres**, con `CURRENT_DATE − vencimiento`, que es
 * literalmente la misma expresión con la que `cxp.ts` reparte las cubetas. Si el servidor de la
 * aplicación hiciera la resta con su propio reloj, dos números que salen de la misma pantalla
 * podrían quedar desfasados un día. Aquí sólo se **elige cuál** de esos días se enseña.
 *
 * ## El hueco que esta fila cierra
 * Los cargos de maquila **no viven en el motor**: viven en las tablas de EsMa (F6), que **no tienen
 * columna de vencimiento**, y la convivencia (`convivencia-esma.ts`) los proyectaba con
 * `fechaVencimiento: null`. Resultado: Daniel **sí** envejece a sus maquileros con plazo y el
 * sistema los mandaba a una cubeta sin edad. Aquí el vencimiento se **DERIVA** —fecha del cargo +
 * los días de crédito del proveedor— con la misma fórmula del motor. No se guarda nada nuevo y no
 * se toca ni un movimiento ya registrado.
 *
 * 🔴 **LA TRAMPA DE LOS SIGNOS, que es la que se come a quien llegue nuevo:** en EsMa el **abono es
 * un CARGO extra al maquilero** (suma, +), al revés que el `abono` del motor (que resta). Por eso lo
 * que decide si un renglón envejece **no es la etiqueta de su origen** sino su **signo**, que se lee
 * de `SIGNO_SALDO` (`formula-saldo.ts`): `cargo` y `abono` de EsMa envejecen; `pago` y `descuento`
 * son créditos y no envejecen nunca.
 *
 * Innegociables: A1 (la regla vive aquí, no en la ruta ni en la pantalla), A9 (todo se acota a la
 * empresa activa). Sin permisos ni ocultamiento de importes: el que llama los aplica. **D3/REGLA
 * 0-B: no escribe nada — el vencimiento se deriva al leer.**
 */
import { Prisma } from '../../datos/index.js';
import type { PrismaClient } from '../../datos/index.js';
import type { Tx } from '../../comun/transaccion.js';

import {
  redondear2,
  SIGNO_SALDO,
  sqlCuenta,
  sqlSegmentoFactura,
  tieneSaldo,
  type ConceptoSaldo,
  type SegmentoFactura,
} from '../esma/formula-saldo.js';
import { sumarPlazo } from './aging-comun.js';

/**
 * Un cargo (o el montón de cargos que vencen el MISMO día) con su edad ya calculada por Postgres.
 * `diasAtraso` negativo = todavía no vence.
 */
export interface CargoPorEdad {
  /** `CURRENT_DATE − vencimiento`, en días. Negativo mientras esté dentro del plazo. */
  diasAtraso: number;
  /** Importe POSITIVO de lo que se debe con esa edad. */
  importe: number;
}

/**
 * ⭐ LA REGLA, pura y medible: **cuántos días lleva vencido el cargo más viejo que sigue sin pagarse**.
 *
 * Aplica `creditos` (pagos, descuentos y notas de crédito, en POSITIVO) de más viejo a más nuevo
 * —la convención de `netearCubetas`— y devuelve la edad del primer cargo que sobrevive.
 *
 * Devuelve `null` cuando no queda nada que envejecer (sin cargos, o los créditos se lo comieron
 * todo: saldo cero o a favor) y `0` cuando lo que sobrevive aún no ha vencido. El corte de «queda
 * algo» es `tieneSaldo` —el mismo medio centavo de tolerancia que usan la bandeja, el tablero de
 * EsMa y la corrida—: escribirlo aquí a mano sería la quinta copia de una decisión que este
 * repositorio guarda en un solo sitio.
 */
export function diasVencidosDeCartera(
  cargos: readonly CargoPorEdad[],
  creditos: number,
): number | null {
  // De más viejo a más nuevo: el más atrasado primero (mayor `diasAtraso`).
  const ordenados = [...cargos].sort((a, b) => b.diasAtraso - a.diasAtraso);
  let restante = creditos;
  for (const cargo of ordenados) {
    // Se redondea ANTES de comparar, como toda cifra monetaria de esta casa: los importes vienen de
    // un `SUM(...)::numeric` y arrastran ruido de coma flotante, y sin el redondeo la comparación
    // contra el medio centavo de `tieneSaldo` se decide por ese ruido y no por el dinero.
    const vivo = redondear2(cargo.importe - restante);
    if (tieneSaldo(vivo) && vivo > 0) {
      // Éste es el más viejo que sobrevive: su edad es la respuesta. Lo que aún no vence se enseña
      // como 0 («debe, pero está a tiempo»), nunca en negativo: nadie lee «−12 días vencidos».
      return Math.max(0, cargo.diasAtraso);
    }
    // El remanente también se redondea en cada paso: con muchos cargos, arrastrar el ruido de coma
    // flotante acabaría decidiendo cuál es «el más viejo que sobrevive».
    restante = Math.max(0, redondear2(restante - cargo.importe));
  }
  return null;
}

/** Fila cruda del agregado de cargos: un proveedor, una edad, lo que debe con esa edad. */
interface CargoCrudo {
  idProveedor: number;
  diasAtraso: number;
  importe: Prisma.Decimal;
}

/** Fila cruda del agregado de créditos: un proveedor y todo lo que se le ha abonado. */
interface CreditoCrudo {
  idProveedor: number;
  importe: Prisma.Decimal;
}

/** Segmento de facturación del MOTOR (`es_fiscal`, NOT NULL): la mitad exacta con `= TRUE/FALSE`. */
function segmentoMotor(segmento: SegmentoFactura | undefined): Prisma.Sql {
  return segmento === undefined
    ? Prisma.empty
    : Prisma.sql`AND m."es_fiscal" = ${segmento === 'con'}`;
}

/**
 * DÍAS VENCIDOS de CADA proveedor con deuda, en DOS agregados (uno de cargos y uno de créditos),
 * **nunca N+1**. Devuelve un `Map idProveedor → días` sólo con los que tienen algo que envejecer;
 * quien no aparece es que no debe nada envejecible (la pantalla lo pinta como «—»).
 *
 * Las TRES fuentes de cargo, y por qué cada una fecha distinto:
 *  • **motor** (`movimientos_tercero`): trae su `fecha_vencimiento` **ya sellada** al registrar
 *    (`calcularVencimiento`); aquí sólo se lee.
 *  • **EsMa cargo** (el recibo de maquila): su tabla **no tiene columna de fecha propia**, así que
 *    la fecha del cargo es su `creado_en` — exactamente la que el estado de cuenta ya enseña en la
 *    columna «fecha» de ese renglón (`convivencia-esma.ts`). El vencimiento se deriva sumándole los
 *    días de crédito del proveedor.
 *  • **EsMa abono** (que en EsMa **suma**, ver la trampa de los signos en la cabecera): tiene su
 *    propia `fecha` y se deriva igual.
 *
 * Y las DOS fuentes de crédito: los movimientos negativos del motor, y los pagos y descuentos de
 * EsMa. Los criterios de qué renglón cuenta (`sqlCuenta`) y de qué mitad de la semana es
 * (`sqlSegmentoFactura`) **no se escriben aquí**: salen de `formula-saldo.ts`, la definición única
 * —si se copiaran, esta columna podría contar un renglón que el saldo de al lado no cuenta—.
 *
 * ⭐ Por construcción `Σ cargos − créditos` es **el mismo saldo** que arma `carteraCombinadaPorProveedor`
 * (mismos criterios, mismos signos), así que un proveedor con saldo ≤ 0 no puede salir con días.
 */
export async function diasVencidosPorProveedor(
  cliente: Tx | PrismaClient,
  idEmpresa: number,
  segmento?: SegmentoFactura,
): Promise<Map<number, number>> {
  const factura = Prisma.sql`AND ${sqlSegmentoFactura(segmento)}`;
  const facturaMotor = segmentoMotor(segmento);

  const [cargos, creditos] = await Promise.all([
    cliente.$queryRaw<CargoCrudo[]>(Prisma.sql`
      SELECT
        t."idProveedor",
        t."diasAtraso",
        COALESCE(SUM(t."importe"), 0)::numeric AS "importe"
      FROM (
        -- MOTOR: el vencimiento ya viene sellado del alta (calcularVencimiento).
        SELECT
          m."id_proveedor"                            AS "idProveedor",
          (CURRENT_DATE - m."fecha_vencimiento")::int AS "diasAtraso",
          m."monto"                                   AS "importe"
        FROM "movimientos_tercero" m
        WHERE m."id_empresa" = ${idEmpresa}
          AND m."id_proveedor" IS NOT NULL
          AND m."monto" > 0
          AND m."fecha_vencimiento" IS NOT NULL
          ${facturaMotor}
        UNION ALL
        -- EsMa CARGO: sin columna de fecha propia, la del renglon es creado_en, la MISMA que
        -- enseña el estado de cuenta. El plazo lo pone el proveedor; sin plazo, vence el mismo día.
        SELECT
          c."id_maquilero",
          (CURRENT_DATE - (c."fecha_base" + COALESCE(p."dias_credito", 0)))::int,
          c."importe"
        FROM (
          SELECT
            "id_maquilero",
            "creado_en"::date                  AS "fecha_base",
            "cantidad_real" * "precio_real"    AS "importe"
          FROM "esma_cargo"
          WHERE "id_empresa" = ${idEmpresa} AND ${sqlCuenta('cargo')} ${factura}
        ) c
        JOIN "proveedores" p ON p."id" = c."id_maquilero"
        UNION ALL
        -- EsMa ABONO: en EsMa SUMA (es un cargo extra al maquilero), así que envejece como un cargo.
        SELECT
          a."id_maquilero",
          (CURRENT_DATE - (a."fecha" + COALESCE(p."dias_credito", 0)))::int,
          a."monto"
        FROM (
          SELECT "id_maquilero", "fecha", "monto"
          FROM "abono_maquilero"
          WHERE "id_empresa" = ${idEmpresa} AND ${sqlCuenta('abono')} ${factura}
        ) a
        JOIN "proveedores" p ON p."id" = a."id_maquilero"
      ) t
      GROUP BY t."idProveedor", t."diasAtraso"
    `),
    cliente.$queryRaw<CreditoCrudo[]>(Prisma.sql`
      SELECT t."idProveedor", COALESCE(SUM(t."importe"), 0)::numeric AS "importe"
      FROM (
        -- MOTOR: todo lo que resta (pagos, notas de crédito, abonos, y los inversos de cancelación).
        SELECT m."id_proveedor" AS "idProveedor", -m."monto" AS "importe"
        FROM "movimientos_tercero" m
        WHERE m."id_empresa" = ${idEmpresa}
          AND m."id_proveedor" IS NOT NULL
          AND m."monto" < 0
          ${facturaMotor}
        UNION ALL
        SELECT "id_maquilero", "monto"
        FROM "pago_maquilero"
        WHERE "id_empresa" = ${idEmpresa} AND ${sqlCuenta('pago')} ${factura}
        UNION ALL
        SELECT "id_maquilero", "monto"
        FROM "descuento_maquilero"
        WHERE "id_empresa" = ${idEmpresa} AND ${sqlCuenta('descuento')} ${factura}
      ) t
      GROUP BY t."idProveedor"
    `),
  ]);

  const creditoPorId = new Map<number, number>();
  for (const c of creditos) {
    creditoPorId.set(c.idProveedor, c.importe.toNumber());
  }
  const cargosPorId = new Map<number, CargoPorEdad[]>();
  for (const c of cargos) {
    const lista = cargosPorId.get(c.idProveedor) ?? [];
    lista.push({ diasAtraso: c.diasAtraso, importe: c.importe.toNumber() });
    cargosPorId.set(c.idProveedor, lista);
  }

  const mapa = new Map<number, number>();
  for (const [idProveedor, lista] of cargosPorId) {
    const dias = diasVencidosDeCartera(lista, creditoPorId.get(idProveedor) ?? 0);
    if (dias !== null) {
      mapa.set(idProveedor, dias);
    }
  }
  return mapa;
}

/**
 * ⭐ EL VENCIMIENTO DE UN RENGLÓN DE EsMa, derivado — la puerta que el motor no puede dar.
 *
 * **Envejece el que SUMA al saldo del maquilero**, y quién suma no se escribe aquí: se le pregunta a
 * `SIGNO_SALDO` (`formula-saldo.ts`), la definición única. Hoy eso son `cargo` y `abono`; `pago` y
 * `descuento` son créditos y devuelven `null` (un pago no vence). El día que alguien cambie de bando
 * a un concepto allá, esta función se entera sola.
 *
 * 🔴 **Por qué no se usa `calcularVencimiento`:** esa función pregunta por el ORIGEN del motor, y el
 * `abono` del motor RESTA mientras el de EsMa SUMA ⇒ le devolvería `null` a un renglón que sí
 * envejece. La aritmética es la misma (`sumarPlazo`); lo que cambia es quién decide que es un cargo.
 *
 * `diasCredito` llega ya resuelto por el llamador (`?? 0`): sin plazo capturado, vence el mismo día
 * — la misma convención que `exigirTercero` aplica en el motor.
 */
export function vencimientoEsMa(
  concepto: ConceptoSaldo,
  fecha: Date,
  diasCredito: number,
): Date | null {
  return SIGNO_SALDO[concepto] === 1 ? sumarPlazo(fecha, diasCredito) : null;
}
