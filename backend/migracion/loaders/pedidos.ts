/**
 * Loader de PEDIDOS internos (F2-E5). `Pedidos.csv` (1,529) + `PedidosDet.csv` (5,636) →
 * `Pedido` + `PedidoLinea`, vía el MODO MIGRACIÓN del dominio (`crearPedidoMigrado`, A1).
 *
 * Preserva el histórico: folio = `NumeroPed`, banderas pedCancelado/noProducir/entregadoTienda,
 * todas las fechas, `IdOrdCompra`→idOrdCompraV1 (snapshot sin FK), y por renglón
 * EntregadoParcial→entregadoParcialV1 y CantFalt→cantFaltanteV1 (snapshots de SOLO lectura).
 *
 * Mapeos: IdClientes→idCliente (vía MapeoMigracion de F1), IdEmpresas→idEmpresa (vía F1). Guarda
 * IdPedidos→Pedido.id y, CRÍTICO, IdPedidosDet→PedidoLinea.id (lo necesitan las órdenes y los
 * pedidos reales).
 *
 * Idempotencia: resuelve "ya existe" por el unique `(idEmpresa, folio)` ANTES de crear; en una
 * 2ª corrida no duplica y re-guarda los mapeos (por si el primer corrido se cortó). Las filas con
 * cliente/empresa/modelo sin mapeo, o con NumeroPed no numérico, se LISTAN al reporte (§7).
 *
 * ⚠️ FOLIO YA OCUPADO: encontrar un pedido con ese folio ya NO basta para darlo por "el mismo".
 * En el re-volcado del go-live, v2 pudo capturar su propio pedido con ese folio y el Access traer
 * otro distinto con el mismo número — mapearlos juntos colgaba las órdenes del volcado nuevo del
 * renglón de pedido equivocado, en silencio. `comun/colision-folio.ts` distingue la recuperación de
 * una corrida cortada (lo creó el ETL y nadie más lo reclama) del **duplicado del ORIGEN** (el
 * Access trae dos pedidos con el mismo folio) y de la **colisión con V2** (lo capturó una persona);
 * los dos últimos NO se migran, se REPORTAN por separado y se cuentan por separado.
 */
import {
  crearPedidoMigrado,
  type LineaPedidoMigrada,
} from '../../src/dominio/pedidos/migracion.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { CONCURRENCIA_ETL, enLotes } from '../comun/lotes.js';
import {
  cargarMapaNumerico,
  ENTIDAD_MAPEO,
  guardarMapeo,
  type ClienteMapeo,
} from '../comun/mapeo.js';
import { conReintentoTransitorio } from '../comun/reintentos.js';
import type { Reporte } from '../comun/reporte.js';
import { GuardiaFolios } from '../comun/colision-folio.js';
import { intentarCrear } from '../comun/saneo.js';
import { parsearEntero, parsearFechaSoloDia, parsearBandera } from '../comun/valores.js';
import { filtrarPorVentana, resolverVentana } from '../comun/ventana.js';
import type { ResultadoLoader } from './clientes.js';

/** Resultado del loader de pedidos: pedidos + renglones (para el log/cuadre). */
export interface ResultadoPedidos {
  pedidos: ResultadoLoader;
  lineas: ResultadoLoader;
  /** # de pedidos excluidos por la ventana temporal (§Post-F9.24). Listados en el reporte. */
  fueraVentana: number;
  /**
   * # de pedidos NO migrados porque el ACCESS trae otro pedido con el mismo folio (culpa del
   * origen, no de la base de v2). Ver `comun/colision-folio.ts`.
   */
  duplicadosOrigen: number;
  /**
   * # de pedidos NO migrados porque su folio ya lo ocupaba un pedido CAPTURADO EN V2 (ver
   * `comun/colision-folio.ts`). Se cuentan APARTE de los `existentes`: contarlos ahí era justo lo
   * que los volvía invisibles. Salen listados uno por uno en el reporte.
   */
  colisionesFolio: number;
}

/** Renglón crudo de `PedidosDet` ya parseado (sin el idModelo resuelto). */
interface DetCrudo {
  idPedidosDet: string;
  idModelos: string;
  cantPed: number;
  precio: number;
  entregadoParcial: number | null;
  cantFalt: number | null;
}

/** Contribución de UN pedido a los conteos (se suma tras los lotes). */
interface ContribPedido {
  /** Desenlace del documento pedido (`folioOcupado` = duplicado del origen o colisión con v2: el
   * desglose lo llevan los contadores del `GuardiaFolios`, no esta etiqueta). */
  pedido: 'creado' | 'existente' | 'omitido' | 'omitidoValidacion' | 'folioOcupado';
  /** Renglones creados / existentes / omitidos de ESTE pedido. */
  lineasCreadas: number;
  lineasExistentes: number;
  lineasOmitidas: number;
}

export async function cargarPedidos(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoPedidos> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };

  // Mapeos de F1 (clave vieja → id nuevo).
  const mapaCliente = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.cliente);
  const mapaEmpresa = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.empresa);
  const mapaModelo = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.modelo);

  // Detalle agrupado por IdPedidos (lo necesitamos completo al crear cada pedido en una tx).
  const detPorPedido = new Map<string, DetCrudo[]>();
  const filasDet = leerCsv('PedidosDet.csv');
  for (const f of filasDet) {
    const idPed = (f.IdPedidos ?? '').trim();
    if (idPed === '') continue;
    const lista = detPorPedido.get(idPed) ?? [];
    lista.push({
      idPedidosDet: (f.IdPedidosDet ?? '').trim(),
      idModelos: (f.IdModelos ?? '').trim(),
      cantPed: parsearEntero(f.CantPed) ?? 0,
      precio: Number((f.Precio ?? '').replace(/[$\s,]/g, '').trim() || '0') || 0,
      entregadoParcial: parsearEntero(f.EntregadoParcial),
      cantFalt: parsearEntero(f.CantFalt),
    });
    detPorPedido.set(idPed, lista);
  }

  // Cada pedido + sus renglones es una unidad INDEPENDIENTE → carga concurrente acotada (con
  // reintento ante cortes transitorios; la unidad es idempotente por (idEmpresa, folio)).
  // §Post-F9.24 — la migración lleva solo 2025-2026 (Daniel/Gabriel, 10-ago-2026). El recorte va
  // ANTES de procesar: lo anterior al corte ni se toca, y sale listado en el reporte.
  const ventana = resolverVentana();
  const { dentro: filas, fuera: fueraVentana } = filtrarPorVentana(
    leerCsv('Pedidos.csv'),
    // `FechaPedido` es la fecha del documento (`FechaElaboracion` es cuándo se capturó).
    'FechaPedido',
    ventana,
    reporte,
    'Pedidos',
    (f) => `IdPedidos=${f.IdPedidos ?? '?'}`,
  );
  // Guardia del re-volcado: separa la recuperación de una corrida cortada, el DUPLICADO DEL ORIGEN
  // (el Access trae dos pedidos con el mismo folio) y la COLISIÓN contra un pedido capturado en v2
  // (ver `comun/colision-folio.ts`).
  const guardia = new GuardiaFolios(
    cliente,
    ENTIDAD_MAPEO.pedido,
    'Pedido',
    'sus renglones (y las órdenes que colgaban de ellos quedan sin pedido ligado)',
  );
  const contribs = await enLotes(
    filas,
    (f): Promise<ContribPedido> =>
      conReintentoTransitorio(() =>
        procesarPedido(
          sesion,
          bd,
          cliente,
          reporte,
          { mapaCliente, mapaEmpresa, mapaModelo },
          detPorPedido,
          guardia,
          f,
        ),
      ),
    CONCURRENCIA_ETL,
  );

  const pedidos: ResultadoLoader = {
    creados: 0,
    existentes: 0,
    omitidos: 0,
    omitidosValidacion: 0,
  };
  const lineas: ResultadoLoader = { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 };
  for (const res of contribs) {
    // Un fallo de `enLotes` (tras agotar reintentos) cuenta como pedido omitido por validación.
    if (!res.ok) {
      pedidos.omitidosValidacion = (pedidos.omitidosValidacion ?? 0) + 1;
      continue;
    }
    const c = res.valor;
    if (c.pedido === 'creado') pedidos.creados += 1;
    else if (c.pedido === 'existente') pedidos.existentes += 1;
    else if (c.pedido === 'omitido') pedidos.omitidos += 1;
    // `folioOcupado` no suma al documento aquí: el desglose duplicado-de-origen vs colisión-con-v2
    // lo lleva el guardia (una sola fuente, ya separada por diagnóstico). Sus RENGLONES sí se
    // cuentan abajo, en `lineas.omitidos` (antes se perdían sin aparecer en ningún contador).
    else if (c.pedido !== 'folioOcupado')
      pedidos.omitidosValidacion = (pedidos.omitidosValidacion ?? 0) + 1;
    lineas.creados += c.lineasCreadas;
    lineas.existentes += c.lineasExistentes;
    lineas.omitidos += c.lineasOmitidas;
  }

  const conteos = guardia.conteos;
  return {
    pedidos,
    lineas,
    fueraVentana,
    duplicadosOrigen: conteos.duplicadoOrigen,
    colisionesFolio: conteos.colisionV2,
  };
}

/** Mapeos de F1 que necesita cada pedido (clave vieja → id nuevo). */
interface MapeosPedido {
  mapaCliente: Map<string, number>;
  mapaEmpresa: Map<string, number>;
  mapaModelo: Map<string, number>;
}

/** Procesa UN pedido + sus renglones (idempotente, tolerante). Devuelve su contribución. */
async function procesarPedido(
  sesion: SesionUsuario,
  bd: ContextoBd,
  cliente: ClienteMapeo,
  reporte: Reporte,
  mapeos: MapeosPedido,
  detPorPedido: Map<string, DetCrudo[]>,
  guardia: GuardiaFolios,
  f: Record<string, string>,
): Promise<ContribPedido> {
  const { mapaCliente, mapaEmpresa, mapaModelo } = mapeos;
  const idViejo = (f.IdPedidos ?? '').trim();
  const folio = parsearEntero(f.NumeroPed);
  const idClienteV1 = (f.IdClientes ?? '').trim();
  const idEmpresaV1 = (f.IdEmpresas ?? '').trim();

  if (folio === null) {
    reporte.agregar('Pedido sin NumeroPed numérico (omitido)', `IdPedidos=${idViejo}`);
    return { pedido: 'omitido', lineasCreadas: 0, lineasExistentes: 0, lineasOmitidas: 0 };
  }
  const idCliente = mapaCliente.get(idClienteV1);
  if (idCliente === undefined) {
    reporte.agregar(
      'Pedido con cliente sin mapeo (omitido)',
      `IdPedidos=${idViejo} IdClientes=${idClienteV1}`,
    );
    return { pedido: 'omitido', lineasCreadas: 0, lineasExistentes: 0, lineasOmitidas: 0 };
  }
  const idEmpresa = mapaEmpresa.get(idEmpresaV1);
  if (idEmpresa === undefined) {
    reporte.agregar(
      'Pedido con empresa sin mapeo (omitido)',
      `IdPedidos=${idViejo} IdEmpresas=${idEmpresaV1}`,
    );
    return { pedido: 'omitido', lineasCreadas: 0, lineasExistentes: 0, lineasOmitidas: 0 };
  }

  // Renglones: resolver idModelo; los sin mapeo se LISTAN y se descartan (el pedido sí entra).
  const detCrudo = detPorPedido.get(idViejo) ?? [];
  const lineasMigradas: LineaPedidoMigrada[] = [];
  let lineasOmitidas = 0;
  for (const d of detCrudo) {
    const idModelo = mapaModelo.get(d.idModelos);
    if (idModelo === undefined) {
      lineasOmitidas += 1;
      reporte.agregar(
        'PedidoLinea con modelo sin mapeo (omitida)',
        `IdPedidos=${idViejo} IdPedidosDet=${d.idPedidosDet} IdModelos=${d.idModelos}`,
      );
      continue;
    }
    lineasMigradas.push({
      idModelo,
      cantidadPedida: d.cantPed,
      precio: d.precio,
      entregadoParcialV1: d.entregadoParcial,
      cantFaltanteV1: d.cantFalt,
      claveVieja: d.idPedidosDet,
    });
  }

  // Idempotencia: ¿ya existe el pedido por (idEmpresa, folio)?
  const existente = await cliente.pedido.findUnique({
    where: { idEmpresa_folio: { idEmpresa, folio: BigInt(folio) } },
    select: {
      id: true,
      creadoPorId: true,
      lineas: { select: { id: true, idModelo: true }, orderBy: { id: 'asc' } },
    },
  });
  if (existente !== null) {
    // Ya hay un pedido con ese folio. Puede ser la corrida anterior cortada entre el `create` y el
    // `guardarMapeo`… o un pedido que v2 capturó con ese mismo folio, que es OTRO documento.
    // Mapearlo sin distinguir colgaba las órdenes del volcado nuevo del renglón equivocado, en
    // silencio. Ver `comun/colision-folio.ts`.
    const veredicto = await guardia.clasificar(idViejo, existente);
    if (veredicto !== 'recuperacion') {
      guardia.reportar(reporte, {
        claveVieja: idViejo,
        folio,
        existente,
        veredicto,
        arrastreFila: `renglones=${String(lineasMigradas.length)}`,
      });
      return {
        pedido: 'folioOcupado',
        lineasCreadas: 0,
        lineasExistentes: 0,
        // Los renglones que se iban a migrar TAMBIÉN se quedan fuera: se cuentan como omitidos para
        // que no desaparezcan de la contabilidad del reporte.
        lineasOmitidas: lineasOmitidas + lineasMigradas.length,
      };
    }
    // Re-guardar mapeos (por si la 1ª corrida se cortó tras crear pero antes de mapear).
    guardia.registrarCreado(idViejo, existente.id);
    await guardarMapeo(cliente, ENTIDAD_MAPEO.pedido, idViejo, existente.id);
    // Mapear cada renglón existente a su IdPedidosDet por orden (mismo orden de creación).
    const lineasExist = existente.lineas;
    let lineasExistentes = 0;
    for (let i = 0; i < lineasMigradas.length && i < lineasExist.length; i += 1) {
      const clave = lineasMigradas[i]?.claveVieja;
      const existeLinea = lineasExist[i];
      if (clave !== undefined && existeLinea !== undefined) {
        await guardarMapeo(cliente, ENTIDAD_MAPEO.pedidoLinea, clave, existeLinea.id);
        lineasExistentes += 1;
      }
    }
    return { pedido: 'existente', lineasCreadas: 0, lineasExistentes, lineasOmitidas };
  }

  const resultado = await intentarCrear(reporte, 'Pedido', idViejo, () =>
    crearPedidoMigrado(
      sesion,
      {
        folio,
        idEmpresa,
        idCliente,
        fechaPedido: parsearFechaSoloDia(f.FechaPedido),
        fechaDe: parsearFechaSoloDia(f.FechaDe),
        fechaHasta: parsearFechaSoloDia(f.FechaHasta),
        fechaTela: parsearFechaSoloDia(f.FechaTela),
        fechaElaboracion: parsearFechaSoloDia(f.FechaElaboracion),
        entregadoTienda: parsearBandera(f.EntregadoTienda),
        noProducir: parsearBandera(f.NoProducir),
        pedCancelado: parsearBandera(f.PedCancelado),
        idOrdCompraV1: parsearEntero(f.IdOrdCompra),
        lineas: lineasMigradas,
      },
      bd,
    ),
  );
  if (resultado === null) {
    return { pedido: 'omitidoValidacion', lineasCreadas: 0, lineasExistentes: 0, lineasOmitidas };
  }
  // Se reclama el folio ANTES de mapearlo: entre el create y el guardarMapeo el mapeo aún no está
  // en la BD, y una fila concurrente con el mismo folio lo tomaría por "recuperación".
  guardia.registrarCreado(idViejo, resultado.idPedido);
  await guardarMapeo(cliente, ENTIDAD_MAPEO.pedido, idViejo, resultado.idPedido);
  let lineasCreadas = 0;
  for (const l of resultado.lineas) {
    if (l.claveVieja !== undefined) {
      await guardarMapeo(cliente, ENTIDAD_MAPEO.pedidoLinea, l.claveVieja, l.id);
      lineasCreadas += 1;
    }
  }
  return { pedido: 'creado', lineasCreadas, lineasExistentes: 0, lineasOmitidas };
}
