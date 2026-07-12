/**
 * SOBRE-PEDIDO por PACKS de C&A (petición Daniel — regla de negocio, función PURA testeable sin BD).
 *
 * C&A acepta recibir hasta un % de más (≈5%); Daniel fabrica ese margen + su merma (~7% arriba). Pero
 * su producto se vende en PACKS con una PROPORCIÓN de tallas fija (p. ej. un pack de 12 = 2·(5-6) +
 * 1·(6-7) + 1·(7-8) + 3·(9-10) + 3·(11-12) + 2·(13-14)). Por eso el % NUNCA se aplica talla por talla en
 * los packs: se aplica al NÚMERO DE PACKS (redondeo al más cercano) y la corrida se reconstruye con la
 * proporción del pack, para que lo fabricado arme packs COMPLETOS. Las piezas SUELTAS (tipo "SKU") sí se
 * redondean talla por talla.
 *
 *  • Grupo PACK: proporción[talla] = cantidad[talla] / totalPacks (debe ser ENTERA; si no lo es, se
 *    avisa y ese grupo cae al redondeo por talla). packsPropuestos = round(totalPacks × (1 + pct/100));
 *    propuesta[talla] = packsPropuestos × proporción[talla].
 *  • Grupo SKU: propuesta[talla] = round(cantidad[talla] × (1 + pct/100)).
 *  • Matriz propuesta = suma de los grupos por talla. La `original` por talla es la de la tabla SKU del
 *    cliente (lo contractual). Si la suma de los desgloses de los packs NO cuadra con esa tabla, se
 *    AVISA (no revienta). Si no hay grupos, la propuesta = round por talla sobre la tabla SKU.
 *
 * La propuesta es EDITABLE en la vista previa (el usuario decide la matriz final); esta función sólo
 * PROPONE. No conoce BD ni catálogos (A1: la resolución color/talla y el alta viven en `importacion-pdf`).
 */

/** Una talla de la tabla SKU/Talla/Piezas del cliente (lo contractual pedido). */
export interface TallaOriginal {
  talla: string;
  piezas: number;
}

/** Un grupo de la sección "Detalles PACK / SKU" (entrada del cálculo). */
export interface GrupoPackEntrada {
  grupo: string;
  /** "PACK" (proporción por pack) o "SKU" (piezas sueltas); cualquier otro se trata como SKU. */
  tipo: string;
  totalPacks: number;
  desglose: { talla: string; cantidad: number }[];
}

/** Una celda del desglose propuesto de un grupo: lo original y lo propuesto de esa talla. */
export interface CeldaGrupo {
  talla: string;
  original: number;
  propuesta: number;
}

/** La propuesta de sobre-pedido de UN grupo (packs originales→propuestos + su desglose). */
export interface GrupoPropuesta {
  grupo: string;
  tipo: string;
  packsOriginales: number;
  packsPropuestos: number;
  desglose: CeldaGrupo[];
  /** Aviso si la proporción del pack no era entera (cayó a redondeo por talla), o null. */
  advertencia: string | null;
}

/** Una celda del total por talla: lo que pidió el cliente vs lo propuesto a fabricar. */
export interface CeldaTotal {
  talla: string;
  original: number;
  propuesta: number;
}

/** La propuesta completa de sobre-pedido de un PDF. */
export interface PropuestaSobrepedido {
  porcentajeAdicional: number;
  grupos: GrupoPropuesta[];
  totalPorTalla: CeldaTotal[];
  totalOriginal: number;
  totalPropuesta: number;
  advertencias: string[];
}

/**
 * Calcula la propuesta de sobre-pedido de un PDF a partir de la tabla SKU del cliente + los grupos de
 * packs + el % adicional. PURA. Con `pct <= 0` la propuesta iguala a lo pedido (sin sobre-pedido).
 */
export function calcularSobrepedidoCya(
  tallas: TallaOriginal[],
  grupos: GrupoPackEntrada[],
  pct: number,
): PropuestaSobrepedido {
  const factor = 1 + (pct > 0 ? pct : 0) / 100;
  const advertencias: string[] = [];

  // Orden canónico de tallas: primero el de la tabla SKU (contractual), luego cualquier extra de los packs.
  const orden: string[] = [];
  const vistas = new Set<string>();
  const registrar = (t: string): void => {
    if (!vistas.has(t)) {
      vistas.add(t);
      orden.push(t);
    }
  };
  for (const t of tallas) registrar(t.talla);
  for (const g of grupos) for (const d of g.desglose) registrar(d.talla);

  // Original por talla desde la tabla SKU (lo que pidió el cliente).
  const originalTabla = new Map<string, number>();
  for (const t of tallas) originalTabla.set(t.talla, (originalTabla.get(t.talla) ?? 0) + t.piezas);

  const gruposProp: GrupoPropuesta[] = [];
  const propuestaPorTalla = new Map<string, number>();
  const originalGruposPorTalla = new Map<string, number>();

  for (const g of grupos) {
    const esPack = g.tipo.toUpperCase() === 'PACK';
    // ¿La proporción por talla es entera? (sólo aplica a los PACK con packs > 0).
    const proporciones = new Map<string, number>();
    let proporcionEntera = esPack && g.totalPacks > 0;
    if (proporcionEntera) {
      for (const d of g.desglose) {
        const p = d.cantidad / g.totalPacks;
        if (!Number.isInteger(p)) {
          proporcionEntera = false;
          break;
        }
        proporciones.set(d.talla, p);
      }
    }
    const packsPropuestos = esPack ? Math.round(g.totalPacks * factor) : g.totalPacks;
    const celdas: CeldaGrupo[] = g.desglose.map((d) => {
      originalGruposPorTalla.set(d.talla, (originalGruposPorTalla.get(d.talla) ?? 0) + d.cantidad);
      const propuesta =
        esPack && proporcionEntera
          ? packsPropuestos * (proporciones.get(d.talla) ?? 0)
          : Math.round(d.cantidad * factor); // SKU o PACK con proporción no entera → por talla
      propuestaPorTalla.set(d.talla, (propuestaPorTalla.get(d.talla) ?? 0) + propuesta);
      return { talla: d.talla, original: d.cantidad, propuesta };
    });
    let advertencia: string | null = null;
    if (esPack && !proporcionEntera && g.desglose.length > 0) {
      advertencia = `El pack ${g.grupo} no tiene una proporción entera por talla; su sobre-pedido se redondeó talla por talla.`;
      advertencias.push(advertencia);
    }
    gruposProp.push({
      grupo: g.grupo,
      tipo: g.tipo,
      packsOriginales: g.totalPacks,
      packsPropuestos,
      desglose: celdas,
      advertencia,
    });
  }

  // Sin grupos: la propuesta es el redondeo por talla sobre la tabla SKU del cliente.
  if (grupos.length === 0) {
    for (const t of tallas) {
      propuestaPorTalla.set(
        t.talla,
        (propuestaPorTalla.get(t.talla) ?? 0) + Math.round(t.piezas * factor),
      );
    }
  }

  const totalPorTalla: CeldaTotal[] = orden.map((talla) => ({
    talla,
    original: originalTabla.get(talla) ?? originalGruposPorTalla.get(talla) ?? 0,
    propuesta: propuestaPorTalla.get(talla) ?? 0,
  }));

  // Integridad (no bloquea): la suma de los desgloses de los packs debe cuadrar con la tabla SKU.
  if (grupos.length > 0 && tallas.length > 0) {
    for (const talla of orden) {
      const enTabla = originalTabla.get(talla) ?? 0;
      const enPacks = originalGruposPorTalla.get(talla) ?? 0;
      if (enTabla !== enPacks) {
        advertencias.push(
          `La talla ${talla} suma ${enPacks} pz en los packs pero ${enTabla} pz en la tabla SKU del cliente.`,
        );
      }
    }
  }

  const totalOriginal = totalPorTalla.reduce((s, c) => s + c.original, 0);
  const totalPropuesta = totalPorTalla.reduce((s, c) => s + c.propuesta, 0);
  return {
    porcentajeAdicional: pct,
    grupos: gruposProp,
    totalPorTalla,
    totalOriginal,
    totalPropuesta,
    advertencias,
  };
}
