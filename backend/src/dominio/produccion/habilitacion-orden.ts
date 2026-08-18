/**
 * HABILITACIÓN / SURTIDO de avíos por orden (rediseño R6, brecha B13 — `docs/rediseno/
 * REDISENO-FRONTEND.md §4.6`; decisión de Daniel 6-jul-2026). Tablero "qué avíos lleva la orden vs.
 * qué ya se envió al maquilero": por cada avío de la **RECETA CONGELADA DE LA ORDEN**
 * (`OrdenAvio paraProduccion`, no excluido) cruza el REQUERIDO contra el ENVIADO y deja la FALTA +
 * un estado por avío.
 *
 * ⭐ **V1-E3d (§Post-F9.43): la fuente cambió del modelo a la ORDEN.** Antes leía `ModeloAvio`, así
 * que dos órdenes del mismo modelo tenían por fuerza la misma lista de surtido — aunque a una le
 * hubieran quitado la jareta. Ahora cada orden pide lo que SU receta dice.
 *
 * Toda la lógica vive AQUÍ (A1); la ruta REST solo valida permiso + delega. Consulta ON-DEMAND (de
 * solo lectura, sin transacción de escritura): la habilitación es una foto del momento.
 *
 *  • REQUERIDO = consumo × piezas de la orden (R18 — por talla si el avío maneja `consumoPorTalla`;
 *    las tallas sin medida caen a `consumoPorPrenda`). El cálculo PURO vive en el helper COMPARTIDO
 *    `requeridoAvioReceta` (`./receta-avios.ts`), la MISMA fuente que usa la explosión MRP
 *    (`compras/mrp.ts`) — sin duplicar la regla ni acoplarse al `select` pesado del MRP.
 *  • ⭐ **TALLAS SIN MEDIDA (§Post-F9.64).** El helper ya devolvía `tallasSinMedida` y aquí se
 *    tiraba a la basura (`const { requerido } = …`): el MRP avisaba y la habilitación —la pantalla
 *    que sí mira quien surte— se quedaba callada. Ahora se publican las ETIQUETAS por avío y el
 *    conteo agregado `aviosSinMedida`, calculados EN SERVIDOR. **Avisa, NO bloquea**: la orden se
 *    surte igual (una talla de última hora es producción legítima). Sólo entran las tallas que la
 *    orden pide de verdad (piezas > 0) y sólo los avíos `consumoPorTalla`; un cero CAPTURADO no
 *    aparece —es una decisión, no un olvido— porque el dominio nunca crea fila para lo no
 *    capturado.
 *  • ENVIADO = Σ de `NotaSalidaLinea.cantidad` de notas **confirmadas** (NO borrador ni cancelada) de
 *    esa orden×avío. ⚠ Fuente DISTINTA de `estatusMaterialesOrden` (MRP), que cruza contra
 *    COMPRAS/recepciones: aquí es contra NOTAS DE SALIDA — no se doble-cuenta.
 *  • FALTA = max(0, requerido − enviado). Estado por avío: `completo` / `parcial` / `pendiente` /
 *    `sobre-surtido` (enviado > requerido — re-envío por extravío/daño, estado VÁLIDO con su % real)
 *    / `extra` (avío enviado a la orden fuera de su receta).
 *
 * Innegociables aplicados:
 *  • A1 — la lógica vive aquí; la ruta es delgada.
 *  • A4 — permiso `ordenes.habilitacion` (por fin cableado) verificado aquí (defensa en profundidad).
 *  • A9 — la orden, su BOM y las notas se sellan por la empresa ACTIVA de la sesión.
 *  • Sin importes (solo cantidades). Sin N+1: el "enviado" se agrega en UNA consulta `groupBy`.
 */
import type {
  HabilitacionAvio,
  HabilitacionOrden,
  EstadoHabilitacion,
} from '../../contrato/index.js';
import { EstatusNotaSalida, type Prisma } from '../../datos/index.js';

import { ErrorNoEncontrado } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { num } from '../costos/decimales.js';
import { requeridoAvioReceta } from './receta-avios.js';

/** Tolerancia de redondeo al comparar cantidades decimales (igual criterio que el MRP). */
const TOLERANCIA = 1e-6;

/**
 * Selección FOCALIZADA de la orden para la habilitación: solo los AVÍOS `paraProduccion` de la
 * RECETA DE LA ORDEN (con su consumo por prenda / por talla, R18) y la matriz (para las piezas). NO
 * trae telas ni proveedores/precios (aquí no aplican) — a diferencia del `select` del MRP.
 */
const seleccionOrdenHabilitacion = {
  id: true,
  folio: true,
  idEmpresa: true,
  idModelo: true,
  idMaquilero: true,
  maquilero: { select: { nombre: true } },
  modelo: { select: { codigo: true } },
  // La RECETA de ESTA orden (V1-E3d): `paraProduccion` y NO excluida. Un renglón excluido —la
  // jareta que esta orden no lleva— no se surte ni aparece como faltante.
  recetaAvios: {
    where: { paraProduccion: true, excluido: false },
    select: {
      idAvio: true,
      consumoPorPrenda: true,
      consumoPorTalla: true,
      tallas: { select: { idTalla: true, consumo: true } },
      avio: {
        select: { clave: true, descripcion: true, unidad: true, esGenerico: true },
      },
    },
  },
  lineas: {
    select: {
      tallas: { select: { idTalla: true, cantidad: true } },
    },
  },
} satisfies Prisma.OrdenSelect;

type OrdenParaHabilitacion = Prisma.OrdenGetPayload<{ select: typeof seleccionOrdenHabilitacion }>;

/** Σ de TODAS las piezas color×talla de la orden = base del requerido. */
function totalPiezasOrden(orden: OrdenParaHabilitacion): number {
  let total = 0;
  for (const linea of orden.lineas) {
    for (const t of linea.tallas) {
      total += t.cantidad;
    }
  }
  return total;
}

/**
 * Piezas de la orden AGRUPADAS por talla (para el consumo por talla, R18), con la ETIQUETA a la
 * mano para poder nombrar las tallas en el aviso sin una segunda consulta.
 */
function piezasPorTallaOrden(
  orden: OrdenParaHabilitacion,
): Map<number, { piezas: number; etiqueta: string }> {
  const mapa = new Map<number, { piezas: number; etiqueta: string }>();
  for (const linea of orden.lineas) {
    for (const t of linea.tallas) {
      const previo = mapa.get(t.idTalla);
      if (previo === undefined) {
        mapa.set(t.idTalla, { piezas: t.cantidad, etiqueta: t.talla.etiqueta });
      } else {
        previo.piezas += t.cantidad;
      }
    }
  }
  return mapa;
}

/** Estado del avío según requerido/enviado (el sobre-surtido es VÁLIDO, no error). */
function estadoAvio(requerido: number, enviado: number, esExtra: boolean): EstadoHabilitacion {
  if (esExtra) return 'extra';
  if (enviado > requerido + TOLERANCIA) return 'sobre-surtido';
  if (requerido - enviado <= TOLERANCIA) return 'completo';
  if (enviado > TOLERANCIA) return 'parcial';
  return 'pendiente';
}

/** % de surtido de un avío (puede pasar de 100 en sobre-surtido). */
function porcentajeAvio(requerido: number, enviado: number): number {
  if (requerido > TOLERANCIA) return (enviado / requerido) * 100;
  return enviado > TOLERANCIA ? 100 : 0;
}

/**
 * Tablero de habilitación / surtido de avíos de una orden (B13, R6). Por avío de la receta cruza
 * requerido (R18) vs. enviado (Σ notas confirmadas) y agrega los EXTRAS (avíos enviados fuera de la
 * receta). Permiso `ordenes.habilitacion`; empresa activa (A9). Sin importes; sin N+1.
 */
export async function habilitacionOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<HabilitacionOrden> {
  verificarPermiso(sesion, 'ordenes.habilitacion');
  const idEmpresa = sesion.idEmpresaActiva;
  const cliente = clienteLectura(bd);

  const orden = await cliente.orden.findFirst({
    where: { id: idOrden, idEmpresa },
    select: seleccionOrdenHabilitacion,
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }

  const totalPiezas = totalPiezasOrden(orden);
  const piezasPorTalla = piezasPorTallaOrden(orden);
  const piezasSimples = new Map([...piezasPorTalla].map(([id, v]) => [id, v.piezas]));

  // ENVIADO por avío = Σ de renglones de notas CONFIRMADAS de esta orden×avío (una sola consulta).
  const enviados = await cliente.notaSalidaLinea.groupBy({
    by: ['idAvio'],
    where: {
      idOrden,
      idAvio: { not: null },
      notaSalida: { estatus: EstatusNotaSalida.confirmada, idEmpresa },
    },
    _sum: { cantidad: true },
  });
  const enviadoPorAvio = new Map<number, number>();
  for (const e of enviados) {
    if (e.idAvio !== null) {
      enviadoPorAvio.set(e.idAvio, num(e._sum.cantidad));
    }
  }

  const avios: HabilitacionAvio[] = [];
  const idsReceta = new Set<number>();

  // 1) Un renglón por avío de la RECETA (BOM paraProduccion): requerido vs. enviado.
  let totalRequerido = 0;
  let totalEnviado = 0;
  let completos = 0;
  let parciales = 0;
  let pendientes = 0;
  let faltaTotal = 0;
  let faltanAvios = 0;
  let aviosSinMedida = 0;
  for (const ma of orden.recetaAvios) {
    idsReceta.add(ma.idAvio);
    const { requerido, tallasSinMedida } = requeridoAvioReceta(ma, totalPiezas, piezasSimples);
    // Las etiquetas se resuelven con el mapa que ya se armó: sin consulta extra y sin pivotear en
    // el cliente. El orden es el de la matriz de la orden, no el de la BD.
    const etiquetasSinMedida = tallasSinMedida.map(
      (id) => piezasPorTalla.get(id)?.etiqueta ?? `#${String(id)}`,
    );
    if (etiquetasSinMedida.length > 0) aviosSinMedida += 1;
    const enviado = enviadoPorAvio.get(ma.idAvio) ?? 0;
    const falta = Math.max(0, requerido - enviado);
    const estado = estadoAvio(requerido, enviado, false);

    totalRequerido += requerido;
    totalEnviado += Math.min(enviado, requerido);
    faltaTotal += falta;
    if (falta > TOLERANCIA) faltanAvios += 1;
    if (estado === 'completo' || estado === 'sobre-surtido') completos += 1;
    else if (estado === 'parcial') parciales += 1;
    else pendientes += 1;

    avios.push({
      idAvio: ma.idAvio,
      clave: ma.avio.clave,
      descripcion: ma.avio.descripcion,
      unidad: ma.avio.unidad,
      esGenerico: ma.avio.esGenerico,
      requerido,
      enviado,
      falta,
      porcentaje: porcentajeAvio(requerido, enviado),
      esExtra: false,
      estado,
      consumoPorTalla: ma.consumoPorTalla,
      tallasSinMedida: etiquetasSinMedida,
    });
  }

  // 2) EXTRAS: avíos enviados a la orden (notas confirmadas) que NO están en la receta.
  const idsExtra = [...enviadoPorAvio.keys()].filter((id) => !idsReceta.has(id));
  if (idsExtra.length > 0) {
    const catalogo = await cliente.avio.findMany({
      where: { id: { in: idsExtra } },
      select: { id: true, clave: true, descripcion: true, unidad: true, esGenerico: true },
    });
    const porId = new Map(catalogo.map((a) => [a.id, a]));
    for (const idAvio of idsExtra) {
      const a = porId.get(idAvio);
      const enviado = enviadoPorAvio.get(idAvio) ?? 0;
      avios.push({
        idAvio,
        clave: a?.clave ?? `#${String(idAvio)}`,
        descripcion: a?.descripcion ?? '(avío fuera de la receta)',
        unidad: a?.unidad ?? null,
        esGenerico: a?.esGenerico ?? false,
        requerido: 0,
        enviado,
        falta: 0,
        porcentaje: porcentajeAvio(0, enviado),
        esExtra: true,
        estado: 'extra',
        // Un avío EXTRA no está en la receta: no tiene consumo por talla que revisar.
        consumoPorTalla: false,
        tallasSinMedida: [],
      });
    }
  }

  const porcentajeGlobal = totalRequerido > TOLERANCIA ? (totalEnviado / totalRequerido) * 100 : 0;

  return {
    idOrden: orden.id,
    folioOrden: Number(orden.folio),
    idModelo: orden.idModelo,
    modelo: orden.modelo.codigo,
    totalPiezas,
    idMaquilero: orden.idMaquilero,
    maquilero: orden.maquilero?.nombre ?? null,
    porcentajeGlobal,
    totalRequerido,
    totalEnviado,
    completos,
    parciales,
    pendientes,
    faltaTotal,
    faltanAvios,
    aviosSinMedida,
    avios,
  };
}
