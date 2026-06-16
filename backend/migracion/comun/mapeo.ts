/**
 * Helpers de la tabla de MAPEO `MapeoMigracion` (F1-E6).
 *
 * Es el entregable persistido que reutilizan los ETLs de fases futuras (E7/F2/F4/F9) para
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

/** Claves de `entidad` de la tabla de mapeo (estables; las usan E7/F2/F4/F9). */
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
