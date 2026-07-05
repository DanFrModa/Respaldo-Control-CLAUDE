/**
 * Helpers de la tabla de MAPEO `MapeoMigracion` (F1-E6).
 *
 * Es el entregable persistido que reutilizan los ETLs de fases futuras (E7/F2/F4/F10) para
 * traducir las FKs viejas a ids nuevos. Aquí va el ÚNICO acceso directo a esa tabla por
 * Prisma (la regla A1 — "nada de `prisma.create` directo de catálogos" — aplica a los
 * CATÁLOGOS; la tabla de mapeo es metadato técnico de la migración y la maneja el ETL).
 *
 * Las CLAVES de `entidad` son estables (las consume el ETL y las fases futuras):
 *   Color · Cliente · EtiquetaMarca · Bordado · Avio · Genero · TelaCategoria · Empresa ·
 *   Tela:IdTelas · Tela:IdTelasDis · Proveedor:IdProveedor · Proveedor:IdMaquileros ·
 *   Proveedor:IdEstampadores · Proveedor:IdCortadores · Almacen:IPT · Almacen:Tela
 * (un sufijo de fuente cuando una entidad nueva absorbe varias tablas viejas).
 */
import type { Prisma, PrismaClient } from '../../src/datos/index.js';
import type { Tx } from '../../src/comun/transaccion.js';

/** Cliente que sirve tanto al singleton como a una transacción/cliente de pruebas. */
export type ClienteMapeo = Tx | PrismaClient;

/** Claves de `entidad` de la tabla de mapeo (estables; las usan E7/F2/F4/F10). */
export const ENTIDAD_MAPEO = {
  color: 'Color',
  cliente: 'Cliente',
  etiquetaMarca: 'EtiquetaMarca',
  bordado: 'Bordado',
  avio: 'Avio',
  genero: 'Genero',
  temporada: 'Temporada',
  telaCategoria: 'TelaCategoria',
  empresa: 'Empresa',
  telaPorIdTelas: 'Tela:IdTelas',
  telaPorIdTelasDis: 'Tela:IdTelasDis',
  proveedorPorIdProveedor: 'Proveedor:IdProveedor',
  proveedorPorIdMaquileros: 'Proveedor:IdMaquileros',
  proveedorPorIdEstampadores: 'Proveedor:IdEstampadores',
  proveedorPorIdCortadores: 'Proveedor:IdCortadores',
  almacenIpt: 'Almacen:IPT',
  almacenTela: 'Almacen:Tela',
  /** E7: IdModelos viejo → id nuevo (lo usan el BOM y las fotos). */
  modelo: 'Modelo',
  /** F2-E5: IdPedidos viejo → Pedido.id nuevo. */
  pedido: 'Pedido',
  /** F2-E5: IdPedidosDet viejo → PedidoLinea.id nuevo (CRÍTICO: lo usan las órdenes y los reales). */
  pedidoLinea: 'PedidoLinea',
  /** F2-E5: IdPedidosReales viejo → PedidoReal.id nuevo. */
  pedidoReal: 'PedidoReal',
  /** F2-E5: IdPedidosRealesDet viejo → PedidoRealLinea.id nuevo. */
  pedidoRealLinea: 'PedidoRealLinea',
  /** F2-E5: IdOrdenes viejo → Orden.id nuevo. */
  orden: 'Orden',
  /** F2-E5: IdOrdenesDet viejo → OrdenLinea.id nuevo. */
  ordenLinea: 'OrdenLinea',
  /** F2-E5: IdComentaOrd viejo → OrdenComentario.id nuevo. */
  ordenComentario: 'OrdenComentario',
  /** F3-E6: IdCorte viejo → EtapaMovimiento(corte).id nuevo. */
  etapaCorte: 'EtapaCorte',
  /** F3-E6: Consecutivo de Entregas (costura) viejo → EtapaMovimiento(envio_maquila costura).id. */
  etapaEnvioCostura: 'EtapaEnvioCostura',
  /** F3-E6: Consecutivo de EntregasEst (estampado) viejo → EtapaMovimiento(envio_maquila estampado).id. */
  etapaEnvioEstampado: 'EtapaEnvioEstampado',
  /** F3-E6: IdRecibos (costura) viejo → EtapaMovimiento(recibo_maquila costura).id. */
  etapaReciboCostura: 'EtapaReciboCostura',
  /** F3-E6: IdRecibosEst (estampado) viejo → EtapaMovimiento(recibo_maquila estampado).id. */
  etapaReciboEstampado: 'EtapaReciboEstampado',
  /** F3-E6: IdEsMa_Recibos viejo → EsMaCargo.id nuevo. */
  cargoEsMa: 'CargoEsMa',
  /** F6-E6: IdEsMa_Abonos viejo → AbonoMaquilero.id nuevo. */
  abonoMaquilero: 'AbonoMaquilero',
  /** F6-E6: IdEsMa_Desc viejo → DescuentoMaquilero.id nuevo. */
  descuentoMaquilero: 'DescuentoMaquilero',
  /** F6-E6: IdEsMa_Pagos viejo → PagoMaquilero.id nuevo (pago histórico LIBRE, sin aplicaciones). */
  pagoMaquilero: 'PagoMaquilero',
  /** F4-E6: IdOrdCompra viejo → OrdenCompra.id nuevo. */
  ordenCompra: 'OrdenCompra',
  /** F4-E6: IdNotas viejo → NotaSalida.id nuevo. */
  notaSalida: 'NotaSalida',
  /** F4-E6 (telas): IdEntradasDet (entrada de compra legacy) → Movimiento(entrada de tela).id. */
  movEntradaTela: 'MovEntradaTela',
  /** F4-E6 (telas): IdSalidasDet (salida a orden legacy) → Movimiento(salida de tela a orden).id. */
  movSalidaTela: 'MovSalidaTela',
  /** F4-E6 (telas): clave del par de traspaso de tela legacy (pata SALIDA) → Movimiento.id. */
  movTraspasoTelaSalida: 'MovTraspasoTelaSalida',
  /** F4-E6 (telas): clave del par de traspaso de tela legacy (pata ENTRADA) → Movimiento.id. */
  movTraspasoTelaEntrada: 'MovTraspasoTelaEntrada',
  /** F4-E6 (telas): IdTelasColores legacy → Lote sintetizado (lote-por-color, decisión f). */
  loteLegacyTela: 'LoteLegacyTela',
  /** F6-E6 (calidad): IdCC_Catalogo viejo → DefectoCatalogo.id nuevo. */
  defectoCatalogo: 'DefectoCatalogo',
  /** F6-E6 (calidad): IdCC_Auditorias viejo → Auditoria.id nuevo. */
  auditoria: 'Auditoria',
  /** F6-E6 (calidad): IdCC_AuditoriasDet viejo → AuditoriaDefecto.id nuevo. */
  auditoriaDefecto: 'AuditoriaDefecto',
  /** F7-E6 (costos): IdCostoOrd viejo → CostoOrden.id nuevo (la liga real es por `idOrden` @unique). */
  costoOrden: 'CostoOrden',
  /** F7-E6 (indicadores): IdIP_Personal viejo → PersonalArea.id nuevo (área ip). */
  personalIp: 'PersonalIp',
  /** F7-E6 (indicadores): IdIP_Actividades viejo → ActividadProductividad.id nuevo (área ip). */
  actividadIp: 'ActividadIp',
  /** F7-E6 (indicadores): IdAlm_Prd_Act viejo → ActividadProductividad.id nuevo (área almacén). */
  actividadAlmacen: 'ActividadAlmacen',
  /** F7-E6 (indicadores): IdIP_Productiv viejo → RegistroProductividad.id nuevo (área ip). */
  productividadIp: 'ProductividadIp',
  /** F7-E6 (indicadores): IdAlm_Prd_Det viejo → RegistroProductividad.id nuevo (área almacén). */
  productividadAlmacen: 'ProductividadAlmacen',
  /** F7-E6 (indicadores): IdIP_MuesPend viejo → Muestrario.id nuevo. */
  muestrario: 'Muestrario',
  /** F7-E6 (indicadores): IdAlm_InvCic viejo → InventarioCiclico.id nuevo (histórico Proscai, D6). */
  inventarioCiclicoHist: 'InventarioCiclicoHist',
} as const;

/** Una clave de entidad de mapeo. */
export type EntidadMapeo = (typeof ENTIDAD_MAPEO)[keyof typeof ENTIDAD_MAPEO];

/** Contexto JSON del mapeo (record laxo; se sanea a `InputJsonObject` antes de guardar). */
export type DatosMapeo = Record<string, unknown>;

/**
 * Sanea un record laxo a un `Prisma.InputJsonObject`: descarta `null`/`undefined` (Prisma no
 * acepta `null` como valor de propiedad JSON sin `JsonNull`) y garantiza un objeto JSON plano
 * con un round-trip por `JSON.stringify` (quita funciones/undefined y asegura serializabilidad).
 */
function sanearJson(datos: DatosMapeo): Prisma.InputJsonObject {
  const limpio: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(datos)) {
    if (v !== null && v !== undefined) {
      limpio[k] = v;
    }
  }
  return JSON.parse(JSON.stringify(limpio)) as Prisma.InputJsonObject;
}

/**
 * Upsert IDEMPOTENTE de un renglón de mapeo por `(entidad, claveVieja)`. Re-ejecutar el ETL
 * no duplica: actualiza `idNuevo`/`datos` si cambiaran. `claveVieja` e `idNuevo` se guardan
 * SIEMPRE como texto. `datos` se sanea (sin null/undefined) antes de persistirse.
 */
export async function guardarMapeo(
  cliente: ClienteMapeo,
  entidad: EntidadMapeo,
  claveVieja: string | number,
  idNuevo: string | number,
  datos?: DatosMapeo,
): Promise<void> {
  const clave = String(claveVieja);
  const nuevo = String(idNuevo);
  const json = datos === undefined ? undefined : sanearJson(datos);
  await cliente.mapeoMigracion.upsert({
    where: { entidad_claveVieja: { entidad, claveVieja: clave } },
    update: { idNuevo: nuevo, ...(json === undefined ? {} : { datos: json }) },
    create: {
      entidad,
      claveVieja: clave,
      idNuevo: nuevo,
      ...(json === undefined ? {} : { datos: json }),
    },
  });
}

/** Lee el id nuevo mapeado para una clave vieja, o `null` si no hay mapeo. */
export async function leerMapeo(
  cliente: ClienteMapeo,
  entidad: EntidadMapeo,
  claveVieja: string | number,
): Promise<string | null> {
  const fila = await cliente.mapeoMigracion.findUnique({
    where: { entidad_claveVieja: { entidad, claveVieja: String(claveVieja) } },
    select: { idNuevo: true },
  });
  return fila?.idNuevo ?? null;
}

/**
 * Carga TODO el mapeo de una entidad a un `Map<claveVieja, idNuevoNumerico>` (para los
 * loaders que traducen FKs en lote, p. ej. TelasColores.IdTelas → idTela nuevo). Solo para
 * entidades cuyo id nuevo es numérico (todas las de F1).
 */
export async function cargarMapaNumerico(
  cliente: ClienteMapeo,
  entidad: EntidadMapeo,
): Promise<Map<string, number>> {
  const filas = await cliente.mapeoMigracion.findMany({
    where: { entidad },
    select: { claveVieja: true, idNuevo: true },
  });
  const mapa = new Map<string, number>();
  for (const f of filas) {
    const n = Number(f.idNuevo);
    if (Number.isFinite(n)) {
      mapa.set(f.claveVieja, n);
    }
  }
  return mapa;
}
