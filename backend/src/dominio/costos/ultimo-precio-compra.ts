/**
 * ÚLTIMO PRECIO DE COMPRA REAL de un material — la maquinaria COMPARTIDA del escalón 1 de la cascada
 * única de precios (DANIEL, 15-ago-2026 — `DECISIONES.md` §Post-F9.48: *"Si ya tenemos precios
 * reales, lo mejor es tomar ese costo. El más actualizado. El de referencia podría funcionar solo
 * cuando es algo nuevo que no se ha comprado"*).
 *
 * ⚠️ **NO es una regla nueva.** Nació en §Post-F9.5 (26-jul-2026) dentro de `costo-real-compras.ts`
 * para valuar el remanente de una orden. V1-E3e la EXTRAE aquí —sin cambiarla— para que la receta,
 * el pre-costo rápido y el precosteo persistido la usen tal cual: duplicar la regla es exactamente
 * cómo divergen los números, que es el defecto que esta etapa vino a matar.
 *
 * QUÉ CUENTA COMO "COMPRADO" (regla 1 de Daniel, §Post-F9.5 — NO se re-inventa): la línea de una OC
 * en `autorizada` / `recibida_parcial` / `recibida_total`. **Manda la OC AUTORIZADA**, no lo recibido
 * ni lo surtido. Quedan fuera `borrador`, `pendiente_autorizacion` y `cancelada`.
 *
 * "MÁS RECIENTE" = **fecha de la OC DESC (las OC sin fecha, al final) → folio DESC → renglón DESC**.
 * Es el mismo desempate determinista de §Post-F9.5, palabra por palabra: la liga a una orden de
 * producción NO influye.
 *
 * DOS LECTURAS, porque la cascada necesita las dos (§Post-F9.48):
 *  • **por MATERIAL** — la compra más reciente, venga del proveedor que venga. Es el escalón 1
 *    cuando el renglón NO tiene amarre de Desarrollo.
 *  • **por MATERIAL + PROVEEDOR** — la compra más reciente A ESE proveedor. Es el escalón 1 cuando
 *    Desarrollo SÍ amarró: ⭐ *"el amarre elige el PROVEEDOR; el precio es el de la última compra A
 *    ESE proveedor"*. Así el trabajo de negociación no se tira y el costo no se queda viejo.
 *
 * El global se DERIVA de los representantes por proveedor sin una segunda consulta: la línea más
 * reciente de un material es, necesariamente, la más reciente dentro de su propio grupo de proveedor.
 *
 * UNIDADES (R1): el precio se devuelve **POR UNIDAD DE CONSUMO** (`precio ÷ factor`), con la MISMA
 * cascada de factor que usa la recepción (`compras/recepciones.ts`) y el costo real: **tela → 1**;
 * **avío → `AvioProveedor.factorConversion` del proveedor de la OC → `Avio.factorConversion` → 1**.
 * El `factor` viaja en el resultado porque un factor ≠ 1 arrastra la DEUDA CONOCIDA DE F4 (el MRP
 * escribe la línea en unidad de consumo y la recepción la lee como presentación, ver
 * `HOJA-DE-RUTA.md` §4) y quien costea tiene que poder AVISARLO.
 *
 * RENDIMIENTO — **se lee EN VIVO, pero POR LOTE** (decisión de construcción de V1-E3e). La consulta
 * es UNA sola (`DISTINCT ON`) para TODOS los materiales pedidos, no un `findFirst` por renglón:
 * la receta pide precio renglón por renglón y la lista de precios recorre el catálogo entero, así
 * que un N+1 contra el histórico de compras se pagaría carísimo. No se materializa en una columna
 * porque el valor tendría que invalidarse en CINCO caminos (autorizar OC, des-autorizar, cancelar,
 * editar el renglón, borrarlo) más el ETL: cualquiera que se olvide deja un precio falso en silencio
 * — justo la clase de defecto que esta etapa persigue. Es el mismo criterio de D3 (la existencia es
 * la suma de movimientos, nunca un nivel guardado).
 *
 * A9: TODO va acotado a la EMPRESA ACTIVA (las OC de otra empresa, para esta sesión, no existen).
 * Lectura pura: este módulo NO escribe nada.
 */
import { EstatusOrdenCompra, Prisma, type PrismaClient } from '../../datos/index.js';

import { resolverFactor } from '../../comun/conversion.js';
import type { Tx } from '../../comun/transaccion.js';

/** Cliente de LECTURA (transacción o singleton): los dos saben `$queryRaw`. */
type ClienteLectura = Tx | PrismaClient;

/**
 * Estatus de OC que cuentan como COMPRADO (regla 1 de Daniel, §Post-F9.5: manda lo AUTORIZADO, no lo
 * recibido). Quedan fuera `borrador`, `pendiente_autorizacion` y `cancelada`.
 */
export const ESTATUS_COMPRADO: readonly EstatusOrdenCompra[] = [
  EstatusOrdenCompra.autorizada,
  EstatusOrdenCompra.recibida_parcial,
  EstatusOrdenCompra.recibida_total,
];

/** Referencia a una orden de compra (trazabilidad: qué OC, de quién y cuándo). */
export interface ReferenciaCompra {
  idOrdenCompra: number;
  numCompra: number;
  estatus: string;
  /** Fecha de la OC en `YYYY-MM-DD` (o null si la OC no la trae). */
  fecha: string | null;
  idProveedor: number;
  proveedor: string;
}

/** La última compra REAL de un material, ya normalizada a unidad de consumo (R1). */
export interface UltimaCompraMaterial {
  /** Precio POR UNIDAD DE CONSUMO (`precio de la línea ÷ factor`). */
  precio: number;
  /** Proveedor al que se le compró. */
  idProveedor: number;
  /** Nombre del proveedor (para la traza en pantalla). */
  proveedor: string;
  /** La OC de la que salió (trazabilidad). */
  compra: ReferenciaCompra;
  /** Factor de conversión aplicado. ≠ 1 ⇒ arrastra la deuda conocida de F4 (hay que avisar). */
  factor: number;
}

/** Resultado de la lectura por lote: los dos mapas que la cascada necesita. */
export interface UltimosPreciosCompra {
  /** Clave {@link claveMaterial} → la compra más reciente del material (cualquier proveedor). */
  porMaterial: ReadonlyMap<string, UltimaCompraMaterial>;
  /** Clave {@link claveMaterialProveedor} → la compra más reciente A ESE proveedor. */
  porMaterialProveedor: ReadonlyMap<string, UltimaCompraMaterial>;
}

/** Resultado VACÍO (para los caminos que no piden ningún material; evita crear mapas sueltos). */
export const SIN_ULTIMOS_PRECIOS: UltimosPreciosCompra = {
  porMaterial: new Map(),
  porMaterialProveedor: new Map(),
};

/** Clave de cruce de un material: `tela-<id>` / `avio-<id>` (la misma de `costo-real-compras.ts`). */
export function claveMaterial(tipo: 'tela' | 'avio', id: number): string {
  return `${tipo}-${String(id)}`;
}

/** Clave de cruce de un material COMPRADO A UN PROVEEDOR concreto: `tela-<id>@<idProveedor>`. */
export function claveMaterialProveedor(
  tipo: 'tela' | 'avio',
  id: number,
  idProveedor: number,
): string {
  return `${claveMaterial(tipo, id)}@${String(idProveedor)}`;
}

/** Materiales cuyos últimos precios se quieren leer (ids del catálogo, sin repetir). */
export interface MaterialesAConsultar {
  telas?: readonly number[];
  avios?: readonly number[];
}

/** Fila cruda del `$queryRaw` (una por material×proveedor: su compra más reciente). */
interface FilaUltimaCompra {
  idLinea: number;
  idTela: number | null;
  idAvio: number | null;
  precio: Prisma.Decimal;
  idOrdenCompra: number;
  numCompra: bigint;
  estatus: string;
  fecha: Date | null;
  idProveedor: number;
  proveedor: string;
}

/** Fecha `Date` de columna date-only → `YYYY-MM-DD` (o null). */
function aFechaCorta(fecha: Date | null): string | null {
  return fecha === null ? null : fecha.toISOString().slice(0, 10);
}

/**
 * Lee, en UNA consulta, el ÚLTIMO precio de compra de cada material pedido — por proveedor y
 * (derivado) global. `DISTINCT ON (id_tela, id_avio, id_proveedor)` con el desempate exacto de
 * §Post-F9.5: `fecha DESC NULLS LAST → num_compra DESC → id del renglón DESC`.
 *
 * Se hace en SQL y no con `findFirst` por material porque los llamadores son la RECETA (un renglón
 * por material), el PRECOSTEO y la LISTA DE PRECIOS (el catálogo entero): un `findFirst` por renglón
 * sería un N+1 contra todo el histórico de compras. La línea de OC ya está indexada por
 * `id_tela`/`id_avio`, así que la consulta ataca por el índice del material.
 */
export async function leerUltimosPreciosCompra(
  cliente: ClienteLectura,
  idEmpresa: number,
  materiales: MaterialesAConsultar,
): Promise<UltimosPreciosCompra> {
  const telas = [...new Set(materiales.telas ?? [])];
  const avios = [...new Set(materiales.avios ?? [])];
  if (telas.length === 0 && avios.length === 0) {
    return SIN_ULTIMOS_PRECIOS;
  }

  // Condición del material: se omite el lado vacío (un `IN ()` no es SQL válido).
  const condTela =
    telas.length === 0 ? Prisma.empty : Prisma.sql`l."id_tela" IN (${Prisma.join(telas)})`;
  const condAvio =
    avios.length === 0 ? Prisma.empty : Prisma.sql`l."id_avio" IN (${Prisma.join(avios)})`;
  const condMaterial =
    telas.length === 0
      ? condAvio
      : avios.length === 0
        ? condTela
        : Prisma.sql`${condTela} OR ${condAvio}`;

  const filas = await cliente.$queryRaw<FilaUltimaCompra[]>(Prisma.sql`
    SELECT DISTINCT ON (l."id_tela", l."id_avio", oc."id_proveedor")
      l."id"             AS "idLinea",
      l."id_tela"        AS "idTela",
      l."id_avio"        AS "idAvio",
      l."precio"         AS "precio",
      oc."id"            AS "idOrdenCompra",
      oc."num_compra"    AS "numCompra",
      oc."estatus"::text AS "estatus",
      oc."fecha"         AS "fecha",
      oc."id_proveedor"  AS "idProveedor",
      p."nombre"         AS "proveedor"
    FROM "orden_compra_linea" l
    JOIN "ordenes_compra" oc ON oc."id" = l."id_orden_compra"
    JOIN "proveedores"    p  ON p."id"  = oc."id_proveedor"
    WHERE oc."id_empresa" = ${idEmpresa}
      AND oc."estatus"::text IN (${Prisma.join(ESTATUS_COMPRADO.map((e) => String(e)))})
      AND (${condMaterial})
    ORDER BY
      l."id_tela", l."id_avio", oc."id_proveedor",
      oc."fecha" DESC NULLS LAST, oc."num_compra" DESC, l."id" DESC
  `);

  const factores = await leerFactoresDeConversion(cliente, filas);

  const porMaterial = new Map<string, UltimaCompraMaterial>();
  const porMaterialProveedor = new Map<string, UltimaCompraMaterial>();
  // El ganador GLOBAL de cada material se elige comparando a los representantes de cada proveedor
  // con el MISMO desempate del SQL. ⚠️ No basta con "quedarse con el primero": `DISTINCT ON` ordena
  // la salida por las claves del grupo (`id_tela, id_avio, id_proveedor`), NO por fecha, así que el
  // primero que llega es el del proveedor con id más chico — no el más reciente.
  const ganadorGlobal = new Map<string, FilaUltimaCompra>();
  for (const f of filas) {
    const tipo: 'tela' | 'avio' = f.idTela === null ? 'avio' : 'tela';
    const idMaterial = f.idTela ?? f.idAvio;
    if (idMaterial === null) continue; // línea LIBRE: no cruza con ningún material de catálogo.
    const factor = factorDeFila(f, factores);
    const ultima: UltimaCompraMaterial = {
      precio: f.precio.toNumber() / factor,
      idProveedor: f.idProveedor,
      proveedor: f.proveedor,
      compra: {
        idOrdenCompra: f.idOrdenCompra,
        numCompra: Number(f.numCompra),
        estatus: f.estatus,
        fecha: aFechaCorta(f.fecha),
        idProveedor: f.idProveedor,
        proveedor: f.proveedor,
      },
      factor,
    };
    porMaterialProveedor.set(claveMaterialProveedor(tipo, idMaterial, f.idProveedor), ultima);
    const claveGlobal = claveMaterial(tipo, idMaterial);
    const campeon = ganadorGlobal.get(claveGlobal);
    if (campeon === undefined || esMasReciente(f, campeon)) {
      ganadorGlobal.set(claveGlobal, f);
      porMaterial.set(claveGlobal, ultima);
    }
  }
  return { porMaterial, porMaterialProveedor };
}

/**
 * ¿La compra `a` es MÁS RECIENTE que la `b`? Es el desempate de §Post-F9.5, palabra por palabra:
 * **fecha DESC (las OC sin fecha, al final) → folio DESC → renglón DESC**. Se aplica en TS —y no
 * solo en el `ORDER BY`— porque `DISTINCT ON` devuelve los representantes ordenados por las CLAVES
 * DEL GRUPO, no por fecha: quedarse con "el primero que llega" daría el del proveedor con id más
 * chico. Mismo criterio que el SQL, para que los dos mapas no puedan contradecirse.
 */
function esMasReciente(a: FilaUltimaCompra, b: FilaUltimaCompra): boolean {
  const fa = a.fecha === null ? null : a.fecha.getTime();
  const fb = b.fecha === null ? null : b.fecha.getTime();
  if (fa !== fb) {
    if (fa === null) return false; // sin fecha va al final
    if (fb === null) return true;
    return fa > fb;
  }
  if (a.numCompra !== b.numCompra) return a.numCompra > b.numCompra;
  return a.idLinea > b.idLinea;
}

/** Factores de conversión ya leídos (avío suelto y par avío–proveedor). */
interface FactoresConversion {
  porAvio: ReadonlyMap<number, number | null>;
  porAvioProveedor: ReadonlyMap<string, number | null>;
}

/**
 * Lee, en dos consultas, los factores de conversión (R1) de los avíos que aparecen en las filas.
 * Idéntico al que usaba `costo-real-compras.ts` (de donde se extrajo): sin N+1.
 */
async function leerFactoresDeConversion(
  cliente: ClienteLectura,
  filas: readonly FilaUltimaCompra[],
): Promise<FactoresConversion> {
  const idsAvio = [...new Set(filas.flatMap((f) => (f.idAvio === null ? [] : [f.idAvio])))];
  const porAvio = new Map<number, number | null>();
  const porAvioProveedor = new Map<string, number | null>();
  if (idsAvio.length === 0) {
    return { porAvio, porAvioProveedor };
  }
  const idsProveedor = [...new Set(filas.map((f) => f.idProveedor))];
  const [avios, pares] = await Promise.all([
    cliente.avio.findMany({
      where: { id: { in: idsAvio } },
      select: { id: true, factorConversion: true },
    }),
    cliente.avioProveedor.findMany({
      where: { idAvio: { in: idsAvio }, idProveedor: { in: idsProveedor } },
      select: { idAvio: true, idProveedor: true, factorConversion: true },
    }),
  ]);
  for (const a of avios) {
    porAvio.set(a.id, a.factorConversion === null ? null : a.factorConversion.toNumber());
  }
  for (const p of pares) {
    porAvioProveedor.set(
      `${String(p.idAvio)}-${String(p.idProveedor)}`,
      p.factorConversion === null ? null : p.factorConversion.toNumber(),
    );
  }
  return { porAvio, porAvioProveedor };
}

/**
 * FACTOR presentación→consumo de una línea de OC (R1), con la MISMA cascada que usa la recepción:
 * tela ⇒ 1; avío ⇒ `AvioProveedor.factorConversion` (del proveedor de la OC) → `Avio.factorConversion`
 * → 1.
 */
function factorDeFila(f: FilaUltimaCompra, factores: FactoresConversion): number {
  if (f.idAvio === null) {
    return 1;
  }
  const porProveedor = factores.porAvioProveedor.get(
    `${String(f.idAvio)}-${String(f.idProveedor)}`,
  );
  return resolverFactor(porProveedor ?? null, factores.porAvio.get(f.idAvio) ?? null);
}
