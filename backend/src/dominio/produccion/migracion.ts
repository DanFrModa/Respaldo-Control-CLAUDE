/**
 * MODO MIGRACIÓN del módulo ÓRDENES (F2-E5) — capa de dominio (A1).
 *
 * El servicio normal (`ordenes.ts`) está afinado para la CAPTURA nueva: genera folio de la
 * secuencia, EXIGE un renglón de pedido válido (no cancelado/no-producir, modelo activo), deriva
 * el modelo/cliente/empresa del pedido, sella `fechaCompletada = now()` y `estado='completa'` al
 * guardar la primera matriz, etc. — todo correcto para el día a día. El ETL del histórico, en
 * cambio, debe PRESERVAR los datos viejos tal cual: folio original, `idPedidoLinea` NULL para las
 * ~26 órdenes huérfanas del viejo, modelo/cliente EXPLÍCITOS, `fechaCompletada` desde `FechaDet`
 * original (no re-sellada), estado/`motivoCancelada` desde `OrdCancelada`/`MotivoCancelada`, los
 * snapshots de datos sin endpoint (tallasV1, RC/F5, F3/F6 — el UPC fue ELIMINADO del modelo por
 * decisión, códigos de barra en retiro), y la matriz despivotada de `OrdenesDet` (color del catálogo + tallas).
 *
 * Para no ENSUCIAR el servicio normal con banderas de migración (E1–E4 y el API REST quedan
 * INTACTOS: estas funciones NO se exponen en ninguna ruta Zod/REST), el modo migración vive en
 * funciones DEDICADAS aquí. Siguen siendo:
 *  • Transaccionales (A2): encabezado + matriz + comentarios cada uno en su tx.
 *  • Auditadas (A7): `creadoPorId`/`modificadoPorId` + `Bitacora` en la misma tx. Los comentarios
 *    migrados preservan la auditoría ORIGINAL del viejo (ComentaOrd: IdUsuarios/FechaComen).
 *  • Por empresa (A9): el `idEmpresa` se pasa EXPLÍCITO (el histórico abarca varias empresas).
 *
 * Lo que RELAJAN respecto al servicio normal (excepciones históricas, documentadas):
 *  • Folio EXPLÍCITO (preserva `Ordenes.Numero`), no de la secuencia.
 *  • `idPedidoLinea` NULL permitido (orden sin pedido = solo histórico).
 *  • NO valida pedido cancelado/no-producir ni modelo activo (el histórico los referencia tal cual).
 *  • Estado + `fechaCompletada` EXPLÍCITOS (de `FechaDet`/`OrdCancelada`), no derivados con now().
 *  • Setea TODOS los snapshots/datos sin endpoint de escritura (tallasV1, maquilaOrd,
 *    aplicacionOrd, pagada, noCostear, composicion, compForzada, obsMaquila, y los campos RC de F5).
 *
 * Las validaciones de INTEGRIDAD que SÍ se conservan (las cubre la FK de la BD, pero damos error
 * claro/lo confía el loader que ya resolvió los ids vía MapeoMigracion): color del catálogo,
 * talla del catálogo, unicidad de color por orden y de talla por color (las protege el @@unique).
 */
import type { EstadoOrden, Prisma } from '../../datos/index.js';

import { registrarBitacora } from '../../comun/auditoria.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { enTransaccion, type ContextoBd } from '../../comun/transaccion.js';

/** Una celda de la matriz a migrar: color + talla + cantidad (ya resueltos a ids del catálogo). */
export interface CeldaOrdenMigrada {
  idColor: number;
  idTalla: number;
  cantidad: number;
}

/** Encabezado + matriz de una orden a migrar (snapshot del viejo `Ordenes` + `OrdenesDet`). */
export interface OrdenMigrada {
  /** Folio EXPLÍCITO = `Ordenes.Numero` (preserva la numeración histórica). */
  folio: bigint | number;
  idEmpresa: number;
  /** NULL para las ~26 órdenes huérfanas del viejo (IdPedidosDet ∈ {0, vacío}). */
  idPedidoLinea: number | null;
  idModelo: number;
  idCliente: number;
  idMaquilero?: number | null;
  idEtiquetaMarca?: number | null;
  idTela?: number | null;
  fecha?: Date | null;
  fechaEntrega?: Date | null;
  observaciones?: string | null;
  tallasV1?: string | null;
  maquilaOrd?: number | null;
  aplicacionOrd?: number | null;
  noCostear?: boolean;
  composicion?: string | null;
  compForzada?: boolean;
  obsMaquila?: string | null;
  pagada?: boolean | null;
  /** Estado histórico: 'completa' si tiene FechaDet, 'cancelada' si OrdCancelada, 'capturada' si no. */
  estado: EstadoOrden;
  /** `FechaDet` original (sella la fecha de completada SIN re-sellar con now()). */
  fechaCompletada?: Date | null;
  /** Motivo de cancelación histórico (de `MotivoCancelada`). */
  motivoCancelada?: string | null;
  // ── Datos de Ruta Crítica (F5) — conservados de v1 SIN motor. ──
  idTipoArticuloRC?: number | null;
  idRcAplicaciones?: number | null;
  idRcTipoTelas?: number | null;
  fechaInicioRC?: Date | null;
  fechaEntregaRC?: Date | null;
  fechaProg?: Date | null;
  enRiesgo?: boolean | null;
  siRC?: boolean | null;
  rcViva?: boolean | null;
  /** Matriz despivotada (celdas color×talla con cantidad >0). */
  celdas: CeldaOrdenMigrada[];
}

/** Resultado de migrar una orden. */
export interface ResultadoOrdenMigrada {
  idOrden: number;
  /** # de renglones de color creados. */
  renglones: number;
  /** # de celdas (talla) creadas. */
  celdas: number;
}

/**
 * Crea una orden HISTÓRICA con su encabezado, todos sus snapshots de v1 y su matriz despivotada,
 * en UNA transacción (A2/A7). La matriz se agrupa por color (un `OrdenLinea` por color, con sus
 * `OrdenLineaTalla`). Idempotencia: el loader resuelve "ya existe" por el unique `(idEmpresa,
 * folio)` ANTES de llamar; aquí solo se crea.
 */
export async function crearOrdenMigrada(
  sesion: SesionUsuario,
  entrada: OrdenMigrada,
  bd?: ContextoBd,
): Promise<ResultadoOrdenMigrada> {
  return enTransaccion(async (tx) => {
    const orden = await tx.orden.create({
      data: {
        folio: BigInt(entrada.folio),
        idEmpresa: entrada.idEmpresa,
        idPedidoLinea: entrada.idPedidoLinea,
        idModelo: entrada.idModelo,
        idCliente: entrada.idCliente,
        idMaquilero: entrada.idMaquilero ?? null,
        idEtiquetaMarca: entrada.idEtiquetaMarca ?? null,
        idTela: entrada.idTela ?? null,
        fecha: entrada.fecha ?? null,
        fechaEntrega: entrada.fechaEntrega ?? null,
        observaciones: entrada.observaciones ?? null,
        tallasV1: entrada.tallasV1 ?? null,
        maquilaOrd: entrada.maquilaOrd ?? null,
        aplicacionOrd: entrada.aplicacionOrd ?? null,
        noCostear: entrada.noCostear ?? false,
        composicion: entrada.composicion ?? null,
        compForzada: entrada.compForzada ?? false,
        obsMaquila: entrada.obsMaquila ?? null,
        pagada: entrada.pagada ?? null,
        // UPC ELIMINADO (Gabriel, 16-jun-2026): códigos de barra en retiro; la columna Orden.upc
        // fue borrada del modelo, no hay nada que setear.
        estado: entrada.estado,
        fechaCompletada: entrada.fechaCompletada ?? null,
        motivoCancelada: entrada.motivoCancelada ?? null,
        idTipoArticuloRC: entrada.idTipoArticuloRC ?? null,
        idRcAplicaciones: entrada.idRcAplicaciones ?? null,
        idRcTipoTelas: entrada.idRcTipoTelas ?? null,
        fechaInicioRC: entrada.fechaInicioRC ?? null,
        fechaEntregaRC: entrada.fechaEntregaRC ?? null,
        fechaProg: entrada.fechaProg ?? null,
        enRiesgo: entrada.enRiesgo ?? null,
        siRC: entrada.siRC ?? null,
        rcViva: entrada.rcViva ?? null,
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      },
    });

    // Agrupa las celdas por color (un OrdenLinea por color, con sus tallas).
    const porColor = new Map<number, CeldaOrdenMigrada[]>();
    for (const celda of entrada.celdas) {
      const lista = porColor.get(celda.idColor) ?? [];
      lista.push(celda);
      porColor.set(celda.idColor, lista);
    }

    let renglones = 0;
    let celdas = 0;
    for (const [idColor, lista] of porColor) {
      const linea = await tx.ordenLinea.create({
        data: { idOrden: orden.id, idColor, creadoPorId: sesion.id, modificadoPorId: sesion.id },
      });
      renglones += 1;
      // Suma cantidades de la misma talla (defensa: el loader ya despivota dispersa, pero por si
      // una talla repetida llega del mapeo de etiqueta; el @@unique(idOrdenLinea,idTalla) lo exige).
      const porTalla = new Map<number, number>();
      for (const c of lista) {
        porTalla.set(c.idTalla, (porTalla.get(c.idTalla) ?? 0) + c.cantidad);
      }
      const datosTallas: Prisma.OrdenLineaTallaCreateManyInput[] = [...porTalla.entries()].map(
        ([idTalla, cantidad]) => ({
          idOrdenLinea: linea.id,
          idTalla,
          cantidad,
          creadoPorId: sesion.id,
          modificadoPorId: sesion.id,
        }),
      );
      if (datosTallas.length > 0) {
        await tx.ordenLineaTalla.createMany({ data: datosTallas });
        celdas += datosTallas.length;
      }
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: orden.id,
      accion: 'OTRO',
      datos: {
        operacion: 'migracion',
        folio: Number(entrada.folio),
        idEmpresa: entrada.idEmpresa,
        estado: entrada.estado,
        renglones,
        celdas,
      },
    });

    return { idOrden: orden.id, renglones, celdas };
  }, bd);
}

/** Una referencia de cliente (D7) a migrar para una orden (snapshot del viejo `Ordenes.Monarch`). */
export interface ReferenciaOrdenMigrada {
  idClienteCampo: number;
  valor: string;
}

/**
 * Agrega referencias de cliente (D7) a una orden YA migrada, en UNA transacción (A2/A7). El loader
 * solo migra los valores REALES de `Monarch` (descarta los que igualan al código del modelo, que
 * eran el default automático del viejo). Idempotente vía `@@unique(idOrden, idClienteCampo)`:
 * usa `createMany` con `skipDuplicates` para no duplicar en re-corridas.
 */
export async function agregarReferenciasOrdenMigrada(
  sesion: SesionUsuario,
  idOrden: number,
  referencias: ReferenciaOrdenMigrada[],
  bd?: ContextoBd,
): Promise<number> {
  if (referencias.length === 0) {
    return 0;
  }
  return enTransaccion(async (tx) => {
    const res = await tx.ordenReferencia.createMany({
      data: referencias.map((r) => ({
        idOrden,
        idClienteCampo: r.idClienteCampo,
        valor: r.valor,
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      })),
      skipDuplicates: true,
    });
    if (res.count > 0) {
      await registrarBitacora(tx, sesion, {
        entidad: 'Orden',
        idEntidad: idOrden,
        accion: 'OTRO',
        datos: { operacion: 'migracion-referencias', referencias: res.count },
      });
    }
    return res.count;
  }, bd);
}

/** Un comentario inmutable a migrar (snapshot del viejo `ComentaOrd`), con su auditoría original. */
export interface ComentarioOrdenMigrado {
  idOrden: number;
  /** Autor original (viejo: `IdUsuarios`); null si el CSV no lo trae. */
  idUsuario?: string | null;
  comentario: string;
  /** Fecha ORIGINAL del comentario (viejo: `FechaComen`); si falta, se usa now() del create. */
  fecha?: Date | null;
  /** Clave vieja `IdComentaOrd` (para el mapeo del comentario creado). */
  claveVieja?: string | number;
}

/**
 * Crea un comentario HISTÓRICO de una orden, preservando autor y fecha ORIGINALES (A7). A
 * diferencia del servicio normal (que usa `sesion.id` + now()), aquí vienen de `ComentaOrd`. Cada
 * comentario es inmutable; el loader resuelve idempotencia por el mapeo de su `IdComentaOrd`.
 * Devuelve el id del comentario creado.
 */
export async function crearComentarioOrdenMigrado(
  sesion: SesionUsuario,
  entrada: ComentarioOrdenMigrado,
  bd?: ContextoBd,
): Promise<number> {
  return enTransaccion(async (tx) => {
    const com = await tx.ordenComentario.create({
      data: {
        idOrden: entrada.idOrden,
        idUsuario: entrada.idUsuario ?? null,
        comentario: entrada.comentario,
        ...(entrada.fecha == null ? {} : { fecha: entrada.fecha }),
      },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: entrada.idOrden,
      accion: 'OTRO',
      datos: { operacion: 'migracion-comentario', idComentario: com.id },
    });
    return com.id;
  }, bd);
}
