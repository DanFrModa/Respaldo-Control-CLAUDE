/**
 * ⭐⭐ DETECTOR de la CONTRADICCIÓN «avío POR MEDIDA con cantidades POR TALLA» (§Post-F9.105).
 *
 * Daniel, 24-ago-2026: *"la compra de los **cierres** me está dando una cantidad muchísimo mayor de
 * la que necesito… ¿me ayudas a checar las OP 5559 y 5561?"*. **No eran sólo esas dos.** Un avío que
 * se compra por MEDIDA (el cierre de 53 cm) arrastrando encendido el `consumoPorTalla` de una
 * captura vieja hace que la longitud cuente como cantidad: el requerido sale ~53× inflado. La
 * corrección de V1-E3g fue **prospectiva** (`copiarRecetaDelModelo` apaga la bandera al copiar, pero
 * desde el 18-ago-2026) y **nada re-normaliza una OP existente**, así que la contradicción sigue
 * congelada en las órdenes anteriores — las cargadas por ETL incluidas.
 *
 * Este script contesta la pregunta que faltaba: **¿en cuáles está pasando, y por cuánto?**
 *
 * ── QUÉ HACE ───────────────────────────────────────────────────────────────────────────────────
 *
 *  1. Busca los renglones de receta de OP **VIVAS** (`estado ≠ cancelada`) que traen las dos cosas a
 *     la vez: `OrdenAvio.consumoPorTalla = true` **y** un avío con ≥1 `AvioMedida` **activa** (el
 *     ÚNICO hecho del que sale "es por medida" en todo el sistema — el mismo que usan el BOM, la
 *     receta y el precosto).
 *  2. Calcula el descuadre con **la función del dominio** (`requeridoContradictorioPorMedida`, que
 *     a su vez usa `requeridoAvioReceta`, R18): el requerido de HOY contra el que saldría ya
 *     normalizado. Se reusa a propósito — un detector que calculara por su cuenta podría decir una
 *     cosa mientras la explosión hace otra, que es justo el tipo de divergencia que abrió el hoyo.
 *  3. Marca lo que decide la urgencia: si el renglón está **LIBERADO** (sólo lo firmado entra a la
 *     explosión, V1-E3h) y si ese avío **ya tiene OC** ligada a esa OP (ahí el dinero ya salió).
 *
 * ── QUÉ **NO** HACE ────────────────────────────────────────────────────────────────────────────
 *
 * **NO escribe absolutamente nada.** Ni apaga banderas, ni toca recetas, ni borra medidas: es
 * `findMany` + aritmética + `console.log`. Se puede correr en producción cuando sea. La corrección
 * se hace **con el botón «Corregir»** del renglón, en la receta de la orden (V1-E8h, §Post-F9.130),
 * que es donde queda auditada y con su bitácora. ⚠️ Es **por renglón**: no existe —a propósito— una
 * reparación EN BLOQUE, porque tocaría datos de muchas órdenes vivas a la vez y eso necesita la
 * palabra de Daniel. Este reporte es justamente el insumo para pedírsela con números.
 *
 * ── CORRER (desde `backend/`) ──────────────────────────────────────────────────────────────────
 *
 *     npx tsx --env-file=.env migracion/analisis/avios-por-medida-contradictorios.ts
 *     npx tsx --env-file=.env migracion/analisis/avios-por-medida-contradictorios.ts --json
 *     npx tsx --env-file=.env migracion/analisis/avios-por-medida-contradictorios.ts --todas
 *
 * ⚠️ **`--env-file=.env` NO es opcional**: sin él no hay `DATABASE_URL` (la trampa de siempre —
 * `npm run etl:*` tampoco la carga, ver `migracion/README.md`). `--todas` incluye también las OP
 * canceladas (por defecto se excluyen: no van a comprar nada).
 */
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../../src/datos/index.js';
import { hayDescuadreDeRequerido } from '../../src/dominio/catalogos/unidades-avio.js';
import { requeridoContradictorioPorMedida } from '../../src/dominio/produccion/receta-avios.js';

/** Un renglón de receta con la contradicción, ya medido. */
export interface HallazgoContradiccion {
  idOrden: number;
  folioOrden: number;
  empresa: string;
  modelo: string;
  estadoOrden: string;
  idOrdenAvio: number;
  idAvio: number;
  avio: string;
  unidad: string | null;
  /** Piezas de la OP (Σ de su matriz color×talla). */
  piezas: number;
  consumoPorPrenda: number;
  /** Cuántas medidas ACTIVAS tiene el avío en su catálogo (≥1 = "es por medida"). */
  medidasActivas: number;
  /** Cuántas cantidades por talla trae capturadas el renglón. */
  tallasCapturadas: number;
  /** Requerido que la OP pide HOY (con las cantidades por talla contando). */
  requeridoHoy: number;
  /** Requerido que pediría ya normalizada. */
  requeridoNormalizado: number;
  /** `requeridoHoy − requeridoNormalizado` (positivo = se pide de MÁS). */
  exceso: number;
  /**
   * ⭐ ¿La contradicción está DESCUADRANDO el requerido hoy? `false` = la bandera está encendida
   * pero nadie capturó cantidades por talla, así que R18 cae al consumo por prenda y el número sale
   * BIEN. Ese renglón **sigue habiendo que normalizarlo** (una captura futura lo inflaría, y por eso
   * se lista), pero hoy no está comprando de más — y la explosión, con buen criterio, ni lo menciona.
   */
  descuadra: boolean;
  /** ¿El renglón está firmado por Desarrollo? Sólo lo liberado entra a la explosión (V1-E3h). */
  liberado: boolean;
  /** ¿Cuenta para la compra? (no excluido y `paraProduccion`). */
  cuentaParaCompra: boolean;
  /** Cantidad de ese avío ya pedida en OC VIVAS ligadas a esta OP (0 = todavía no se compra). */
  cantidadEnOc: number;
  /** Folios de esas OC (para poder ir a mirarlas). */
  foliosOc: number[];
}

/** El reporte completo. */
export interface ReporteContradicciones {
  /** Renglones revisados (avío por medida + `consumoPorTalla` encendido). */
  revisados: number;
  hallazgos: HallazgoContradiccion[];
  /**
   * De los hallazgos, cuántos DESCUADRAN el requerido hoy. 🔴 El titular tiene que decir este
   * número y no sólo el total (2ª vuelta del reviewer): contar como "está pidiendo de más" a un
   * renglón cuyo requerido sale correcto es exagerar el problema en el mismo documento que se va a
   * usar para priorizar el trabajo.
   */
  conDescuadre: number;
  /** Σ del exceso de los renglones que HOY entran a la compra (liberados y para producción). */
  excesoQueYaCompra: number;
  /** Cuántos hallazgos ya tienen OC de ese avío (el dinero ya salió). */
  conOcViva: number;
}

/** Parte una lista de ids en lotes (regla del ETL: nunca una consulta por registro). */
function enLotes<T>(ids: readonly T[], tamano = 200): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < ids.length; i += tamano) lotes.push(ids.slice(i, i + tamano));
  return lotes;
}

/** Suma las piezas de cada orden desde su matriz color×talla (D4), agrupadas por talla. */
async function piezasPorOrden(
  cliente: PrismaClient,
  idsOrden: number[],
): Promise<Map<number, { total: number; porTalla: Map<number, number> }>> {
  const mapa = new Map<number, { total: number; porTalla: Map<number, number> }>();
  if (idsOrden.length === 0) return mapa;
  for (const lote of enLotes(idsOrden)) {
    const filas = await cliente.ordenLineaTalla.findMany({
      where: { ordenLinea: { idOrden: { in: lote } } },
      select: { idTalla: true, cantidad: true, ordenLinea: { select: { idOrden: true } } },
    });
    for (const f of filas) {
      const idOrden = f.ordenLinea.idOrden;
      const acumulado = mapa.get(idOrden) ?? { total: 0, porTalla: new Map<number, number>() };
      acumulado.total += f.cantidad;
      acumulado.porTalla.set(f.idTalla, (acumulado.porTalla.get(f.idTalla) ?? 0) + f.cantidad);
      mapa.set(idOrden, acumulado);
    }
  }
  return mapa;
}

/**
 * Lo ya pedido en OC VIVAS por (orden, avío) — donde ya salió dinero.
 *
 * Va por LOTES igual que {@link piezasPorOrden} (nit del reviewer: una de las dos lo hacía y la otra
 * no, y una inconsistencia así en un script de análisis se copia sola a la siguiente).
 */
async function comprometidoPorOrdenAvio(
  cliente: PrismaClient,
  idsOrden: number[],
): Promise<Map<string, { cantidad: number; folios: Set<number> }>> {
  const mapa = new Map<string, { cantidad: number; folios: Set<number> }>();
  if (idsOrden.length === 0) return mapa;
  for (const lote of enLotes(idsOrden)) {
    const filas = await cliente.ordenCompraLinea.findMany({
      where: {
        idOrden: { in: lote },
        idAvio: { not: null },
        ordenCompra: { estatus: { not: 'cancelada' } },
      },
      select: {
        idOrden: true,
        idAvio: true,
        cantidad: true,
        ordenCompra: { select: { numCompra: true } },
      },
    });
    for (const f of filas) {
      if (f.idOrden === null || f.idAvio === null) continue;
      const clave = `${String(f.idOrden)}-${String(f.idAvio)}`;
      const acumulado = mapa.get(clave) ?? { cantidad: 0, folios: new Set<number>() };
      acumulado.cantidad += f.cantidad.toNumber();
      acumulado.folios.add(Number(f.ordenCompra.numCompra));
      mapa.set(clave, acumulado);
    }
  }
  return mapa;
}

/** Busca y mide TODAS las contradicciones vivas. Solo lectura. */
export async function detectarContradicciones(
  cliente: PrismaClient,
  incluirCanceladas = false,
): Promise<ReporteContradicciones> {
  const renglones = await cliente.ordenAvio.findMany({
    where: {
      consumoPorTalla: true,
      // ⭐ El hecho ÚNICO: el avío tiene al menos una medida ACTIVA en su catálogo.
      avio: { medidas: { some: { activo: true } } },
      ...(incluirCanceladas ? {} : { orden: { estado: { not: 'cancelada' } } }),
    },
    select: {
      id: true,
      idAvio: true,
      idOrden: true,
      consumoPorPrenda: true,
      consumoPorTalla: true,
      excluido: true,
      paraProduccion: true,
      liberadoEn: true,
      tallas: { select: { idTalla: true, consumo: true } },
      avio: {
        select: {
          clave: true,
          descripcion: true,
          unidad: true,
          _count: { select: { medidas: { where: { activo: true } } } },
        },
      },
      orden: {
        select: {
          folio: true,
          estado: true,
          modelo: { select: { codigo: true } },
          empresa: { select: { nombre: true } },
        },
      },
    },
    orderBy: { idOrden: 'asc' },
  });

  const idsOrden = [...new Set(renglones.map((r) => r.idOrden))];
  const [piezas, comprometido] = await Promise.all([
    piezasPorOrden(cliente, idsOrden),
    comprometidoPorOrdenAvio(cliente, idsOrden),
  ]);

  const hallazgos: HallazgoContradiccion[] = [];
  for (const r of renglones) {
    const p = piezas.get(r.idOrden) ?? { total: 0, porTalla: new Map<number, number>() };
    // La MISMA cuenta que hace el aviso de la explosión y el de la receta (no una copia).
    const medida = requeridoContradictorioPorMedida(r, p.total, p.porTalla, r.avio.unidad);
    if (medida === null) continue; // imposible aquí (`consumoPorTalla` es true), pero no se supone.
    const oc = comprometido.get(`${String(r.idOrden)}-${String(r.idAvio)}`);
    hallazgos.push({
      idOrden: r.idOrden,
      folioOrden: Number(r.orden.folio),
      empresa: r.orden.empresa.nombre,
      modelo: r.orden.modelo.codigo,
      estadoOrden: r.orden.estado,
      idOrdenAvio: r.id,
      idAvio: r.idAvio,
      avio: `${r.avio.clave} — ${r.avio.descripcion}`,
      unidad: r.avio.unidad,
      piezas: p.total,
      consumoPorPrenda: r.consumoPorPrenda.toNumber(),
      medidasActivas: r.avio._count.medidas,
      tallasCapturadas: r.tallas.length,
      requeridoHoy: medida.hoy,
      requeridoNormalizado: medida.normalizado,
      exceso: medida.hoy - medida.normalizado,
      descuadra: hayDescuadreDeRequerido(medida),
      liberado: r.liberadoEn !== null,
      cuentaParaCompra: !r.excluido && r.paraProduccion,
      cantidadEnOc: oc?.cantidad ?? 0,
      foliosOc: [...(oc?.folios ?? [])].sort((a, b) => a - b),
    });
  }

  // Lo más caro primero: es el orden en que conviene arreglarlas.
  hallazgos.sort((a, b) => b.exceso - a.exceso);

  return {
    revisados: renglones.length,
    hallazgos,
    conDescuadre: hallazgos.filter((h) => h.descuadra).length,
    excesoQueYaCompra: hallazgos
      .filter((h) => h.liberado && h.cuentaParaCompra)
      .reduce((suma, h) => suma + h.exceso, 0),
    conOcViva: hallazgos.filter((h) => h.cantidadEnOc > 0).length,
  };
}

/** Cifra corta para el reporte de texto. */
function n(valor: number): string {
  return valor.toLocaleString('es-MX', { maximumFractionDigits: 2 });
}

/** El reporte en texto (el que se lee de un vistazo). */
export function formatearReporte(r: ReporteContradicciones): string {
  const p: string[] = [];
  p.push('═══════════════════════════════════════════════════════════════════════════');
  p.push(' AVÍOS POR MEDIDA CON CANTIDADES POR TALLA (§Post-F9.105) — SOLO LECTURA');
  p.push('═══════════════════════════════════════════════════════════════════════════');
  p.push(`  Renglones con la contradicción                   : ${String(r.hallazgos.length)}`);
  p.push(
    `    de ésos, DESCUADRANDO el requerido hoy         : ${String(r.conDescuadre)}` +
      ` (los otros ${String(r.hallazgos.length - r.conDescuadre)} no tienen cantidades por talla` +
      ' capturadas: su número sale bien, pero la bandera sigue mal puesta)',
  );
  p.push(
    `  OP distintas afectadas                           : ${String(new Set(r.hallazgos.map((h) => h.idOrden)).size)}`,
  );
  p.push(`  De ésos, YA con OC de ese avío (dinero fuera)    : ${String(r.conOcViva)}`);
  p.push(`  Σ exceso de lo que HOY entra a la explosión      : ${n(r.excesoQueYaCompra)}`);
  p.push('');
  if (r.hallazgos.length === 0) {
    p.push('  ✔ Ninguna OP viva arrastra la contradicción. Nada que arreglar.');
    return p.join('\n');
  }
  p.push('  ── Detalle (de mayor a menor exceso) ──');
  p.push(
    '  OP      | AVÍO                                | PIEZAS | HOY        | NORMAL.    | EXCESO     | LIB | OC',
  );
  for (const h of r.hallazgos) {
    const avio = h.avio.length > 35 ? `${h.avio.slice(0, 32)}...` : h.avio.padEnd(35);
    p.push(
      `  ${String(h.folioOrden).padEnd(7)} | ${avio} | ${String(h.piezas).padStart(6)} | ` +
        `${n(h.requeridoHoy).padStart(10)} | ${n(h.requeridoNormalizado).padStart(10)} | ` +
        `${n(h.exceso).padStart(10)} | ${h.liberado ? ' ✓ ' : ' — '} | ` +
        `${h.foliosOc.length === 0 ? '—' : h.foliosOc.map((f) => `#${String(f)}`).join(',')}`,
    );
  }
  p.push('');
  p.push('  LIB = renglón liberado por Desarrollo (sólo lo liberado entra a la explosión).');
  p.push('  OC  = órdenes de compra VIVAS de ese avío ligadas a esa OP (ahí el dinero ya salió).');
  p.push('');
  p.push('  ── CÓMO SE ARREGLA (por renglón) ──');
  // ⭐⭐ V1-E8h (§Post-F9.130): ya hay un BOTÓN. Antes esto decía «guardar el renglón (cualquier
  // guardado lo normaliza)» — cierto, pero un conjuro: nadie que no lea el código lo adivina.
  p.push('  Receta de la OP › renglón del avío › botón «Corregir», y volver a explotar. Ojo con');
  p.push('  dos consecuencias que sí muerden:');
  p.push('   (a) corregir el renglón REVOCA su liberación → hay que volver a Liberar o el avío');
  p.push('       desaparece de la explosión (que sólo lee lo liberado);');
  p.push(
    '   (b) si el consumo por prenda fuera 0 y ese avío ya tiene OC, la corrección se RECHAZA:',
  );
  p.push('       hay que capturar antes el consumo por prenda (en un cierre, normalmente 1). El');
  p.push('       error lo dice con esas palabras.');
  return p.join('\n');
}

/** Punto de entrada del script. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      'Falta DATABASE_URL. Córrelo así (desde backend/):\n' +
        '  npx tsx --env-file=.env migracion/analisis/avios-por-medida-contradictorios.ts',
    );
    process.exit(1);
  }
  const json = process.argv.includes('--json');
  const incluirCanceladas = process.argv.includes('--todas');
  const cliente = crearClientePrisma(url);
  try {
    const reporte = await detectarContradicciones(cliente, incluirCanceladas);
    console.log(json ? JSON.stringify(reporte, null, 2) : formatearReporte(reporte));
  } finally {
    await cliente.$disconnect();
  }
}

const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  await main();
}
