/**
 * MODO MIGRACIÓN del módulo COMPRAS (F4-E6) — capa de dominio (A1).
 *
 * El servicio normal (`ordenes-compra.ts`) está afinado para la CAPTURA nueva: folio de la
 * secuencia atómica POR EMPRESA, EXIGE renglones contra catálogo (XOR tela/avío/libre con la
 * tela/avío existente), valida la matriz talla×color y las órdenes de producción ligadas, y
 * sella la auditoría con `sesion.id`. El ETL del histórico, en cambio, debe PRESERVAR los datos
 * viejos tal cual: folio original (`OrdCompra.NumCompra`), empresa/proveedor EXPLÍCITOS, los
 * renglones como TEXTO LIBRE (`descripcionLibre`/`descripcionLegacy` — las líneas legacy NO
 * cruzan a catálogo, R7), la autorización/cancelación históricas, y las ligas N:N a órdenes de
 * producción de `OrdCom-Ord`.
 *
 * Para no ENSUCIAR el servicio normal con banderas de migración (E2 y el API REST quedan
 * INTACTOS: estas funciones NO se exponen en ninguna ruta Zod/REST), el modo migración vive en
 * funciones DEDICADAS aquí. Siguen siendo:
 *  • Transaccionales (A2): encabezado + líneas + ligas N:N + bitácora en UNA transacción.
 *  • Auditadas (A7): `creadoPorId`/`modificadoPorId` + `Bitacora` (origen ETL).
 *  • Por empresa (A9): el `idEmpresa` se pasa EXPLÍCITO (el histórico abarca varias empresas).
 *
 * Lo que RELAJAN respecto al servicio normal (excepciones históricas, documentadas):
 *  • Folio EXPLÍCITO (preserva `NumCompra`), no de la secuencia.
 *  • Renglones de SOLO `descripcionLibre` (sin tela/avío/orden ligada): la data vieja no tiene
 *    catálogo; el XOR del servicio normal NO aplica al histórico.
 *  • Estatus/autorización/cancelación EXPLÍCITOS (derivados de `Autorizado`/`Cancelado`), no del
 *    flujo de captura. El `Totales` viejo NO se migra (el total se DERIVA de las líneas).
 *  • SIN efectos de kardex (las OC legacy NO crean `RecepcionCompra` ni mueven inventario — el
 *    viejo no liga entrada↔OC; las entradas legacy las migra la Pieza B directo al kardex).
 *
 * Lo que CONSERVAN: las FK de la BD (proveedor/empresa/orden existen — el loader las resolvió
 * vía MapeoMigracion antes de llamar). Idempotencia: el LOADER resuelve "ya existe" por el unique
 * `(idEmpresa, numCompra)` o por su `MapeoMigracion` ANTES de llamar; aquí solo se crea.
 */
import type { EstatusOrdenCompra, Prisma } from '../../datos/index.js';

import { registrarBitacora } from '../../comun/auditoria.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { enTransaccion, type ContextoBd } from '../../comun/transaccion.js';

/** Un renglón LEGACY de OC a migrar (de `OrdCompraDet`): SIEMPRE texto libre (sin catálogo). */
export interface LineaOCMigrada {
  /** Texto de `OrdCompraDet.Descripcion` → `descripcionLibre`/`descripcionLegacy` (sin catálogo). */
  descripcionLibre: string;
  /** Cantidad de `OrdCompraDet.Cantidad` (≥0; el loader sanea negativos/vacíos a 0). */
  cantidad: number;
  /** Unidad de `OrdCompraDet.Unidad` (texto: Kilos/Piezas/Metros…). */
  unidad?: string | null;
  /** Precio unitario de `OrdCompraDet.Precio` (≥0; vacío → 0). */
  precio: number;
}

/** Encabezado + líneas + ligas N:N de una OC a migrar (snapshot del viejo `OrdCompra`). */
export interface OCMigrada {
  /** Folio EXPLÍCITO = `OrdCompra.NumCompra` (preserva la numeración histórica). */
  numCompra: bigint | number;
  idEmpresa: number;
  idProveedor: number;
  fecha?: Date | null;
  fechaEntrega?: Date | null;
  entregaEn?: string | null;
  observaciones?: string | null;
  /** `OrdCompra.CorrespondeA` → `correspondeA`. */
  correspondeA?: string | null;
  /** `OrdCompra.FacturasAmparadas` → `facturasAmparadasLegacy` (solo lectura en v2). */
  facturasAmparadasLegacy?: string | null;
  /** Estatus histórico derivado (cancelada > autorizada > borrador). */
  estatus: EstatusOrdenCompra;
  /** Autorización histórica: usuario (id texto) + fecha. NULL si no estaba autorizada. */
  idUsuAutorizado?: string | null;
  fechaAutorizado?: Date | null;
  /** Cancelación histórica (suave): fecha + responsable + motivo. NULL si no estaba cancelada. */
  canceladaEn?: Date | null;
  canceladaPorId?: string | null;
  motivoCancelacion?: string | null;
  /** Renglones legacy (texto libre). */
  lineas: LineaOCMigrada[];
  /** Ids de órdenes de PRODUCCIÓN v2 ligadas (de `OrdCom-Ord`, ya resueltos por el loader). */
  idsOrdenLigada: number[];
}

/** Resultado de migrar una OC. */
export interface ResultadoOCMigrada {
  idOrdenCompra: number;
  /** # de renglones (OrdenCompraLinea) creados. */
  lineas: number;
  /** # de ligas N:N (OrdenCompraOrden) creadas. */
  ligas: number;
}

/**
 * Crea una OC HISTÓRICA con su encabezado, sus renglones legacy (texto libre) y sus ligas N:N a
 * órdenes de producción, en UNA transacción (A2/A7). SIN efectos de kardex/recepción. El `Totales`
 * viejo NO se persiste (el total se deriva de las líneas). Idempotencia: el loader resuelve "ya
 * existe" por `(idEmpresa, numCompra)`/mapeo ANTES de llamar; aquí solo se crea.
 */
export async function crearOCMigrada(
  sesion: SesionUsuario,
  entrada: OCMigrada,
  bd?: ContextoBd,
): Promise<ResultadoOCMigrada> {
  return enTransaccion(async (tx) => {
    const oc = await tx.ordenCompra.create({
      data: {
        numCompra: BigInt(entrada.numCompra),
        idEmpresa: entrada.idEmpresa,
        idProveedor: entrada.idProveedor,
        fecha: entrada.fecha ?? null,
        fechaEntrega: entrada.fechaEntrega ?? null,
        entregaEn: entrada.entregaEn ?? null,
        observaciones: entrada.observaciones ?? null,
        correspondeA: entrada.correspondeA ?? null,
        facturasAmparadasLegacy: entrada.facturasAmparadasLegacy ?? null,
        estatus: entrada.estatus,
        idUsuAutorizado: entrada.idUsuAutorizado ?? null,
        fechaAutorizado: entrada.fechaAutorizado ?? null,
        canceladaEn: entrada.canceladaEn ?? null,
        canceladaPorId: entrada.canceladaPorId ?? null,
        motivoCancelacion: entrada.motivoCancelacion ?? null,
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      },
    });

    let lineas = 0;
    if (entrada.lineas.length > 0) {
      const datos: Prisma.OrdenCompraLineaCreateManyInput[] = entrada.lineas.map((l) => ({
        idOrdenCompra: oc.id,
        descripcionLibre: l.descripcionLibre,
        cantidad: l.cantidad,
        unidad: l.unidad ?? null,
        precio: l.precio,
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      }));
      await tx.ordenCompraLinea.createMany({ data: datos });
      lineas = datos.length;
    }

    // Ligas N:N a órdenes de producción (de OrdCom-Ord). Distintas (Set) — el @@unique(idOrdenCompra,
    // idOrden) las protege; `skipDuplicates` evita romper si el viejo repitiera la liga.
    let ligas = 0;
    const idsOrden = [...new Set(entrada.idsOrdenLigada)];
    if (idsOrden.length > 0) {
      const res = await tx.ordenCompraOrden.createMany({
        data: idsOrden.map((idOrden) => ({
          idOrdenCompra: oc.id,
          idOrden,
          creadoPorId: sesion.id,
          modificadoPorId: sesion.id,
        })),
        skipDuplicates: true,
      });
      ligas = res.count;
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'OrdenCompra',
      idEntidad: oc.id,
      accion: 'CREAR',
      datos: {
        operacion: 'migracion',
        numCompra: Number(entrada.numCompra),
        idEmpresa: entrada.idEmpresa,
        estatus: entrada.estatus,
        lineas,
        ligas,
      },
    });

    return { idOrdenCompra: oc.id, lineas, ligas };
  }, bd);
}
