/**
 * Loader de ÓRDENES de producción (F2-E5). El núcleo del ETL de F2.
 *
 *   `Ordenes.csv` (5,451)    → `Orden` (ejecuta el mapeo de 34 columnas de F2-E2)
 *   `OrdenesDet.csv` (9,511) → `OrdenLinea` (color) + `OrdenLineaTalla` (matriz despivotada)
 *   `Ordenes.Monarch`        → `OrdenReferencia` (D7, solo valores REALES)
 *
 * Carga vía el MODO MIGRACIÓN del dominio (`crearOrdenMigrada`/`agregarReferenciasOrdenMigrada`,
 * A1). Reglas DURAS (todas verificadas, nada se pierde en silencio §7):
 *  • IdPedidosDet ∈ {0, vacío} → idPedidoLinea NULL (las ~26 órdenes huérfanas: NO se intenta FK).
 *  • FechaDet presente → estado='completa' + fechaCompletada (de FechaDet, NO re-sellada con now()).
 *  • OrdCancelada → estado='cancelada' + motivoCancelada (default claro si MotivoCancelada vacío).
 *  • UPC ELIMINADO (Gabriel, 16-jun-2026): los códigos de barra están en retiro; la columna
 *    `Orden.upc` fue borrada del modelo, así que ni se migra ni se conserva historial.
 *  • Tallas → tallasV1 (cadena cruda). Campos RC/F5 y F3/F6 tal cual.
 *  • DESPIVOTE T1..T8 (de OrdenesDet) → filas (solo cantidades >0), alineando cada Tn con la
 *    etiqueta de su POSICIÓN en `Ordenes.Tallas` (parser posicional de `tallas-orden.ts`), con
 *    manejo de doble curva (separadores). Token de talla sin match en catálogo → se CREA la talla
 *    y se LISTA al reporte (nunca se pierde la cantidad).
 *  • Color (texto libre) → idColor: primero por el mapeo texto→idColor de F1; si no, por nombre
 *    normalizado; si tampoco, se CREA el color y se LISTA al reporte (nunca se pierde el renglón).
 *  • Monarch → OrdenReferencia con el ClienteCampo D7 del cliente de la orden; SOLO valores reales
 *    (si Monarch == código del modelo, era el default automático del viejo → NO migra, se cuenta).
 *
 * Idempotencia: por el unique `(idEmpresa, folio)` de la orden; en 2ª corrida no duplica. Guarda
 * IdOrdenes→Orden.id.
 */
import {
  agregarReferenciasOrdenMigrada,
  crearOrdenMigrada,
  type CeldaOrdenMigrada,
} from '../../src/dominio/produccion/migracion.js';
import { crearColor, normalizarNombreColor } from '../../src/dominio/catalogos/colores.js';
import { crearTalla } from '../../src/dominio/catalogos/tallas-curvas.js';
import { ErrorConflicto } from '../../src/comun/errores.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { EstadoOrden, PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import {
  cargarMapaNumerico,
  ENTIDAD_MAPEO,
  guardarMapeo,
  leerMapeo,
  type ClienteMapeo,
} from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear, LIMITES, truncarTexto } from '../comun/saneo.js';
import {
  esIdPedidosDetVacio,
  estadoOrdenMigrada,
  monarchEsDefaultDeModelo,
} from '../comun/ordenes-reglas.js';
import { mapaColumnasTalla, normalizarClaveColor } from '../comun/tallas-orden.js';
import {
  parsearBandera,
  parsearDinero,
  parsearEntero,
  parsearFecha,
  parsearFechaSoloDia,
  parsearTexto,
} from '../comun/valores.js';
import { CAMPO_D7_PEDIDO_CLIENTE } from './clientes.js';
import type { ResultadoLoader } from './clientes.js';

/** Texto por defecto cuando una orden cancelada del viejo no trae motivo. */
export const MOTIVO_CANCELADA_DEFECTO = 'Cancelada en sistema anterior (sin motivo registrado)';

/** Resultado del loader de órdenes. */
export interface ResultadoOrdenes {
  ordenes: ResultadoLoader;
  /** # de renglones de color (OrdenLinea) creados. */
  renglonesColor: number;
  /** # de celdas (OrdenLineaTalla) creadas. */
  celdasTalla: number;
  /** # de referencias D7 (Monarch real) migradas. */
  referencias: number;
  /** # de Monarch descartados por ser == código del modelo (default automático del viejo). */
  monarchDefault: number;
  /** # de colores creados al vuelo (sin match en catálogo). */
  coloresCreados: number;
  /** # de tallas creadas al vuelo (token sin match en catálogo). */
  tallasCreadas: number;
}

/** Renglón crudo de `OrdenesDet`: color + las 8 cantidades. */
interface DetCrudo {
  color: string;
  /** Cantidades T1..T8 (índice 0..7); null = vacío/0. */
  cantidades: (number | null)[];
}

export async function cargarOrdenes(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoOrdenes> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };

  // Mapeos de fases previas.
  const mapaEmpresa = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.empresa);
  const mapaModelo = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.modelo);
  const mapaCliente = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.cliente);
  const mapaPedidoLinea = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.pedidoLinea);
  const mapaMaquilero = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.proveedorPorIdMaquileros);
  const mapaEtiqueta = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.etiquetaMarca);
  const mapaTelaDis = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.telaPorIdTelasDis);

  // Código de modelo por idModelo nuevo (para detectar Monarch == código de modelo).
  const codigoPorIdModelo = new Map<number, string>();
  for (const m of await cliente.modelo.findMany({ select: { id: true, codigo: true } })) {
    codigoPorIdModelo.set(m.id, m.codigo.trim().toUpperCase());
  }

  // ClienteCampo D7 ("No. de pedido del cliente") por idCliente (para las referencias Monarch).
  const campoD7PorCliente = new Map<number, number>();
  for (const c of await cliente.clienteCampo.findMany({
    where: { etiqueta: { equals: CAMPO_D7_PEDIDO_CLIENTE, mode: 'insensitive' } },
    select: { id: true, idCliente: true },
  })) {
    campoD7PorCliente.set(c.idCliente, c.id);
  }

  // Detalle agrupado por IdOrdenes.
  const detPorOrden = new Map<string, DetCrudo[]>();
  for (const f of leerCsv('OrdenesDet.csv')) {
    const idOrd = (f.IdOrdenes ?? '').trim();
    if (idOrd === '') continue;
    const lista = detPorOrden.get(idOrd) ?? [];
    lista.push({
      color: (f.Color ?? '').trim(),
      cantidades: [
        parsearEntero(f.T1),
        parsearEntero(f.T2),
        parsearEntero(f.T3),
        parsearEntero(f.T4),
        parsearEntero(f.T5),
        parsearEntero(f.T6),
        parsearEntero(f.T7),
        parsearEntero(f.T8),
      ],
    });
    detPorOrden.set(idOrd, lista);
  }

  // Cachés para colores/tallas creados/resueltos al vuelo (clave normalizada → id).
  const idPorColorNorm = new Map<string, number>();
  const idPorTallaNorm = new Map<string, number>();
  // Mapeo texto→idColor de F1 (clave = texto original; aquí lo recargamos como mapa normalizado).
  const mapaColorF1 = new Map<string, number>();
  for (const m of await cliente.mapeoMigracion.findMany({
    where: { entidad: ENTIDAD_MAPEO.color },
    select: { claveVieja: true, idNuevo: true },
  })) {
    const id = Number(m.idNuevo);
    if (Number.isFinite(id)) {
      mapaColorF1.set(normalizarClaveColor(m.claveVieja), id);
    }
  }

  const resultado: ResultadoOrdenes = {
    ordenes: { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 },
    renglonesColor: 0,
    celdasTalla: 0,
    referencias: 0,
    monarchDefault: 0,
    coloresCreados: 0,
    tallasCreadas: 0,
  };

  /** Resuelve (o crea+reporta) el idColor de un texto libre de color. */
  async function resolverColor(textoCrudo: string, ctxIdOrden: string): Promise<number | null> {
    const norm = normalizarClaveColor(textoCrudo);
    if (norm === '') return null;
    const enCache = idPorColorNorm.get(norm);
    if (enCache !== undefined) return enCache;
    // 1) Mapeo texto→idColor de F1 (por clave normalizada).
    const deF1 = mapaColorF1.get(norm);
    if (deF1 !== undefined) {
      idPorColorNorm.set(norm, deF1);
      return deF1;
    }
    // 2) Por nombre normalizado en el catálogo.
    const canonico =
      truncarTexto(normalizarNombreColor(textoCrudo), LIMITES.color.nombre) ??
      normalizarNombreColor(textoCrudo);
    const existe = await cliente.color.findFirst({
      where: { nombre: { equals: canonico, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existe !== null) {
      idPorColorNorm.set(norm, existe.id);
      return existe.id;
    }
    // 3) No hay match: CREAR el color (marcado) y LISTAR (nunca perder el renglón de orden).
    try {
      const creado = await crearColor(sesion, { nombre: canonico }, bd);
      idPorColorNorm.set(norm, creado.id);
      resultado.coloresCreados += 1;
      reporte.agregar(
        'Color de orden CREADO al vuelo (sin match en catálogo F1 — revisar)',
        `"${textoCrudo}" → "${canonico}" (IdOrdenes=${ctxIdOrden})`,
      );
      return creado.id;
    } catch (error) {
      if (error instanceof ErrorConflicto) {
        const re = await cliente.color.findFirst({
          where: { nombre: { equals: canonico, mode: 'insensitive' } },
          select: { id: true },
        });
        if (re !== null) {
          idPorColorNorm.set(norm, re.id);
          return re.id;
        }
      }
      throw error;
    }
  }

  /** Resuelve (o crea+reporta) el idTalla de una etiqueta del despivote. */
  async function resolverTalla(etiqueta: string, ctxIdOrden: string): Promise<number | null> {
    const norm = etiqueta.trim().toLowerCase();
    if (norm === '') return null;
    const enCache = idPorTallaNorm.get(norm);
    if (enCache !== undefined) return enCache;
    const existe = await cliente.talla.findFirst({
      where: { etiqueta: { equals: etiqueta, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existe !== null) {
      idPorTallaNorm.set(norm, existe.id);
      return existe.id;
    }
    // Token sin match en el catálogo (p. ej. "GE" de una cadena con padding perdido): CREAR +
    // LISTAR para Daniel (la cantidad se preserva; la etiqueta queda marcada para revisión).
    try {
      const creada = await crearTalla(sesion, { etiqueta }, bd);
      idPorTallaNorm.set(norm, creada.id);
      resultado.tallasCreadas += 1;
      reporte.agregar(
        'Talla CREADA al vuelo en despivote (token sin match — revisar con Daniel)',
        `etiqueta="${etiqueta}" (IdOrdenes=${ctxIdOrden})`,
      );
      return creada.id;
    } catch (error) {
      if (error instanceof ErrorConflicto) {
        const re = await cliente.talla.findFirst({
          where: { etiqueta: { equals: etiqueta, mode: 'insensitive' } },
          select: { id: true },
        });
        if (re !== null) {
          idPorTallaNorm.set(norm, re.id);
          return re.id;
        }
      }
      throw error;
    }
  }

  for (const f of leerCsv('Ordenes.csv')) {
    const idViejo = (f.IdOrdenes ?? '').trim();
    const folio = parsearEntero(f.Numero);
    const idEmpresaV1 = (f.IdEmpresas ?? '').trim();
    const idModeloV1 = (f.IdModelos ?? '').trim();
    const idClienteV1 = (f.IdClientes ?? '').trim();

    if (folio === null) {
      resultado.ordenes.omitidos += 1;
      reporte.agregar('Orden sin Numero numérico (omitida)', `IdOrdenes=${idViejo}`);
      continue;
    }
    const idEmpresa = mapaEmpresa.get(idEmpresaV1);
    if (idEmpresa === undefined) {
      resultado.ordenes.omitidos += 1;
      reporte.agregar(
        'Orden con empresa sin mapeo (omitida)',
        `IdOrdenes=${idViejo} IdEmpresas=${idEmpresaV1}`,
      );
      continue;
    }
    const idModelo = mapaModelo.get(idModeloV1);
    if (idModelo === undefined) {
      resultado.ordenes.omitidos += 1;
      reporte.agregar(
        'Orden con modelo sin mapeo (omitida)',
        `IdOrdenes=${idViejo} IdModelos=${idModeloV1}`,
      );
      continue;
    }
    const idCliente = mapaCliente.get(idClienteV1);
    if (idCliente === undefined) {
      resultado.ordenes.omitidos += 1;
      reporte.agregar(
        'Orden con cliente sin mapeo (omitida)',
        `IdOrdenes=${idViejo} IdClientes=${idClienteV1}`,
      );
      continue;
    }

    // idPedidoLinea: 0/vacío → NULL (órdenes huérfanas del viejo).
    const idPedidosDetV1 = (f.IdPedidosDet ?? '').trim();
    let idPedidoLinea: number | null = null;
    if (!esIdPedidosDetVacio(idPedidosDetV1)) {
      const mapeada = mapaPedidoLinea.get(idPedidosDetV1);
      if (mapeada === undefined) {
        // El viejo apunta a un renglón de pedido que no se migró: NO romper la FK, dejar NULL +
        // reportar (la orden sí entra; queda como histórica sin pedido ligado).
        reporte.agregar(
          'Orden con IdPedidosDet sin mapeo (idPedidoLinea NULL)',
          `IdOrdenes=${idViejo} IdPedidosDet=${idPedidosDetV1}`,
        );
      } else {
        idPedidoLinea = mapeada;
      }
    } else {
      reporte.agregar('Orden SIN pedido (IdPedidosDet 0/vacío)', `IdOrdenes=${idViejo}`);
    }

    // Idempotencia: ¿ya existe la orden por (idEmpresa, folio)?
    const yaMapeada = await leerMapeo(cliente, ENTIDAD_MAPEO.orden, idViejo);
    if (yaMapeada !== null) {
      resultado.ordenes.existentes += 1;
      continue;
    }
    const existePorFolio = await cliente.orden.findUnique({
      where: { idEmpresa_folio: { idEmpresa, folio: BigInt(folio) } },
      select: { id: true },
    });
    if (existePorFolio !== null) {
      resultado.ordenes.existentes += 1;
      await guardarMapeo(cliente, ENTIDAD_MAPEO.orden, idViejo, existePorFolio.id);
      continue;
    }

    // Estado histórico: cancelada > completa > capturada.
    const cancelada = parsearBandera(f.OrdCancelada);
    const fechaCompletada = parsearFecha(f.FechaDet);
    const estado: EstadoOrden = estadoOrdenMigrada(cancelada, fechaCompletada !== null);
    const motivoCancelada = cancelada
      ? (parsearTexto(f.MotivoCancelada) ?? MOTIVO_CANCELADA_DEFECTO)
      : null;

    // Despivote de la matriz: mapa columna→etiqueta de la cadena Tallas, luego cada DetCrudo.
    const mapaCol = mapaColumnasTalla(f.Tallas ?? '');
    if (mapaCol.ambigua) {
      reporte.agregar(
        'Cadena Tallas AMBIGUA (despivotada por posición; etiqueta a revisar con Daniel)',
        `IdOrdenes=${idViejo} Tallas="${mapaCol.original}"`,
      );
    }
    const detCrudo = detPorOrden.get(idViejo) ?? [];
    const celdas: CeldaOrdenMigrada[] = [];
    for (const d of detCrudo) {
      const idColor = await resolverColor(d.color, idViejo);
      if (idColor === null) {
        // Renglón de color con color vacío: si tiene cantidades, reportar (no perder); si no, ignorar.
        const suma = d.cantidades.reduce((a: number, c) => a + (c ?? 0), 0);
        if (suma > 0) {
          reporte.agregar(
            'OrdenLinea con color VACÍO pero con cantidades (revisar)',
            `IdOrdenes=${idViejo} suma=${String(suma)}`,
          );
        }
        continue;
      }
      for (let col = 1; col <= 8; col += 1) {
        const cantidad = d.cantidades[col - 1] ?? 0;
        if (cantidad <= 0) continue;
        const etiqueta = mapaCol.porColumna.get(col);
        if (etiqueta === undefined) {
          // Hay cantidad en una columna que la cadena Tallas no etiquetó (separador/posición vacía).
          reporte.agregar(
            'Cantidad en columna SIN etiqueta de talla (revisar — cantidad preservada en T?)',
            `IdOrdenes=${idViejo} col=T${String(col)} cant=${String(cantidad)} Tallas="${mapaCol.original}"`,
          );
          continue;
        }
        const idTalla = await resolverTalla(etiqueta, idViejo);
        if (idTalla === null) continue;
        celdas.push({ idColor, idTalla, cantidad });
      }
    }

    const creada = await intentarCrear(reporte, 'Orden', idViejo, () =>
      crearOrdenMigrada(
        sesion,
        {
          folio,
          idEmpresa,
          idPedidoLinea,
          idModelo,
          idCliente,
          idMaquilero: resolverMaquilero(f.IdMaquileros, mapaMaquilero),
          idEtiquetaMarca: resolverFk(f.IdEtiquetasM, mapaEtiqueta),
          idTela: resolverFk(f.IdTelasDis, mapaTelaDis),
          fecha: parsearFechaSoloDia(f.Fecha),
          fechaEntrega: parsearFechaSoloDia(f.FechaEntrega),
          observaciones: parsearTexto(f.Observaciones),
          tallasV1: parsearTexto(f.Tallas),
          maquilaOrd: parsearDinero(f.MaquilaOrd),
          aplicacionOrd: parsearDinero(f.AplicacionOrd),
          noCostear: parsearBandera(f.NoCost),
          composicion: parsearTexto(f.Composicion),
          compForzada: parsearBandera(f.CompForzada),
          obsMaquila: parsearTexto(f.ObsMaquila),
          pagada: parsearBanderaNullable(f.Pagada),
          // UPC ELIMINADO POR DECISIÓN (Gabriel, 16-jun-2026): los códigos de barra están en
          // retiro; la columna `Orden.upc` fue borrada del modelo, así que no hay nada que migrar.
          estado,
          fechaCompletada,
          motivoCancelada,
          idTipoArticuloRC: parsearEntero(f.IdCP_Articulos),
          idRcAplicaciones: parsearEntero(f.IdRC_Aplicaciones),
          idRcTipoTelas: parsearEntero(f.IdRC_TipoTelas),
          fechaInicioRC: parsearFecha(f.FechaInicioRC),
          fechaEntregaRC: parsearFecha(f.FechaEntregaRC),
          fechaProg: parsearFecha(f.FechaProg),
          enRiesgo: parsearBanderaNullable(f.EnRiesgo),
          siRC: parsearBanderaNullable(f.SI_RC),
          rcViva: parsearBanderaNullable(f.RC_Viva),
          celdas,
        },
        bd,
      ),
    );
    if (creada === null) {
      resultado.ordenes.omitidosValidacion = (resultado.ordenes.omitidosValidacion ?? 0) + 1;
      continue;
    }
    resultado.ordenes.creados += 1;
    resultado.renglonesColor += creada.renglones;
    resultado.celdasTalla += creada.celdas;
    await guardarMapeo(cliente, ENTIDAD_MAPEO.orden, idViejo, creada.idOrden);

    // Monarch → OrdenReferencia (D7): SOLO valores reales (≠ código del modelo, que era el default).
    const monarch = parsearTexto(f.Monarch);
    if (monarch !== null) {
      const codModelo = codigoPorIdModelo.get(idModelo);
      if (monarchEsDefaultDeModelo(monarch, codModelo)) {
        resultado.monarchDefault += 1; // default automático del viejo: NO migrar
      } else {
        const idCampo = campoD7PorCliente.get(idCliente);
        if (idCampo === undefined) {
          reporte.agregar(
            'Monarch real pero cliente sin campo D7 (referencia NO migrada)',
            `IdOrdenes=${idViejo} idCliente=${String(idCliente)} Monarch="${monarch}"`,
          );
        } else {
          const n = await agregarReferenciasOrdenMigrada(
            sesion,
            creada.idOrden,
            [{ idClienteCampo: idCampo, valor: monarch }],
            bd,
          );
          resultado.referencias += n;
        }
      }
    }
  }

  return resultado;
}

/** Resuelve una FK opcional del viejo (0/vacío → null; sin mapeo → null + sin reporte aquí). */
function resolverFk(crudo: string | undefined, mapa: Map<string, number>): number | null {
  const t = (crudo ?? '').trim();
  if (t === '' || t === '0') return null;
  return mapa.get(t) ?? null;
}

/** Igual que `resolverFk`, separado por claridad semántica (maquilero = Proveedor). */
function resolverMaquilero(crudo: string | undefined, mapa: Map<string, number>): number | null {
  return resolverFk(crudo, mapa);
}

/** Bandera del viejo que puede ser NULL en v2 (las banderas RC/F5 son `Boolean?`). Vacío → null. */
function parsearBanderaNullable(crudo: string | undefined | null): boolean | null {
  if (crudo === undefined || crudo === null || crudo.trim() === '') return null;
  return parsearBandera(crudo);
}
