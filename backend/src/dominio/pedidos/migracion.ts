/**
 * MODO MIGRACIÓN del módulo PEDIDOS (F2-E5) — capa de dominio (A1).
 *
 * Los servicios normales (`pedidos.ts`/`pedidos-reales.ts`) están afinados para la CAPTURA
 * nueva: generan folio de la secuencia, exigen cliente/modelo ACTIVOS, replican el detalle del
 * pedido real en 0, etc. — todo correcto para el día a día, pero el ETL del histórico necesita
 * PRESERVAR los datos viejos tal cual (folio original, fechas originales, cantidades capturadas,
 * pedidos de clientes/modelos hoy desactivados, auditoría original).
 *
 * Para no ENSUCIAR los servicios normales con banderas de migración (E1–E4 y el API REST quedan
 * INTACTOS: estas funciones NO se exponen en ninguna ruta Zod/REST), el modo migración vive en
 * funciones DEDICADAS aquí. Siguen siendo:
 *  • Transaccionales (A2): encabezado + renglones en una tx.
 *  • Auditadas (A7): `creadoPorId`/`modificadoPorId` + `Bitacora` en la misma tx, con la
 *    auditoría ORIGINAL del viejo donde el CSV la trae (PedidosReales: IdUsuarios/FechaUsuario).
 *  • Por empresa (A9): el `idEmpresa` se pasa EXPLÍCITO (el histórico abarca varias empresas,
 *    no la "activa" de la sesión).
 *
 * Lo que RELAJAN respecto al servicio normal (excepciones históricas, documentadas):
 *  • Folio EXPLÍCITO (preserva `NumeroPed`), no de la secuencia.
 *  • NO valida cliente/modelo activos (el histórico referencia catálogos hoy desactivados).
 *  • Setea los SNAPSHOTS V1 sin endpoint de escritura (idOrdCompraV1, entregadoParcialV1,
 *    cantFaltanteV1).
 *  • PedidoLinea con `precio` explícito (snapshot del viejo), sin la regla de ocultamiento.
 */
import type { Prisma } from '../../datos/index.js';

import { registrarBitacora } from '../../comun/auditoria.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { enTransaccion, type ContextoBd, type Tx } from '../../comun/transaccion.js';

/** Renglón de pedido a migrar (snapshot del viejo `PedidosDet`). */
export interface LineaPedidoMigrada {
  idModelo: number;
  cantidadPedida: number;
  precio: number;
  /** Snapshot V1 de SOLO lectura (viejo: `EntregadoParcial`). */
  entregadoParcialV1?: number | null;
  /** Snapshot V1 de SOLO lectura (viejo: `CantFalt`). */
  cantFaltanteV1?: number | null;
  /** Clave vieja `IdPedidosDet` (para que el loader guarde el mapeo del renglón creado). */
  claveVieja?: string | number;
}

/** Encabezado + renglones de un pedido a migrar (snapshot del viejo `Pedidos`). */
export interface PedidoMigrado {
  /** Folio EXPLÍCITO = `NumeroPed` del viejo (preserva la numeración histórica). */
  folio: bigint | number;
  idEmpresa: number;
  idCliente: number;
  fechaPedido?: Date | null;
  fechaDe?: Date | null;
  fechaHasta?: Date | null;
  fechaTela?: Date | null;
  fechaElaboracion?: Date | null;
  entregadoTienda?: boolean;
  noProducir?: boolean;
  /** Cancelación suave preservada (viejo: `PedCancelado`). */
  pedCancelado?: boolean;
  /** Snapshot V1 de SOLO lectura (viejo: `IdOrdCompra`); SIN FK hasta F4. */
  idOrdCompraV1?: number | null;
  lineas: LineaPedidoMigrada[];
}

/** Resultado de migrar un pedido: el id nuevo + el id de cada renglón (mapeado por su clave vieja). */
export interface ResultadoPedidoMigrado {
  idPedido: number;
  /** claveVieja `IdPedidosDet` → `PedidoLinea.id` nuevo (para el mapeo del loader). */
  lineas: { claveVieja: string | number | undefined; id: number }[];
}

/**
 * Crea un pedido HISTÓRICO con su folio y datos originales, en UNA transacción (A2/A7).
 * Idempotencia: el loader resuelve "ya existe" por el unique `(idEmpresa, folio)` ANTES de
 * llamar a esta función (no la llama dos veces para el mismo pedido). Aquí solo se crea.
 */
export async function crearPedidoMigrado(
  sesion: SesionUsuario,
  entrada: PedidoMigrado,
  bd?: ContextoBd,
): Promise<ResultadoPedidoMigrado> {
  return enTransaccion(async (tx) => {
    const pedido = await tx.pedido.create({
      data: {
        folio: BigInt(entrada.folio),
        idEmpresa: entrada.idEmpresa,
        idCliente: entrada.idCliente,
        fechaPedido: entrada.fechaPedido ?? null,
        fechaDe: entrada.fechaDe ?? null,
        fechaHasta: entrada.fechaHasta ?? null,
        fechaTela: entrada.fechaTela ?? null,
        fechaElaboracion: entrada.fechaElaboracion ?? null,
        entregadoTienda: entrada.entregadoTienda ?? false,
        noProducir: entrada.noProducir ?? false,
        pedCancelado: entrada.pedCancelado ?? false,
        idOrdCompraV1: entrada.idOrdCompraV1 ?? null,
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      },
    });

    const lineas: { claveVieja: string | number | undefined; id: number }[] = [];
    for (const l of entrada.lineas) {
      const creada = await tx.pedidoLinea.create({
        data: {
          idPedido: pedido.id,
          idModelo: l.idModelo,
          cantidadPedida: l.cantidadPedida,
          precio: l.precio,
          entregadoParcialV1: l.entregadoParcialV1 ?? null,
          cantFaltanteV1: l.cantFaltanteV1 ?? null,
          creadoPorId: sesion.id,
          modificadoPorId: sesion.id,
        },
      });
      lineas.push({ claveVieja: l.claveVieja, id: creada.id });
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'Pedido',
      idEntidad: pedido.id,
      accion: 'OTRO',
      datos: {
        operacion: 'migracion',
        folio: Number(entrada.folio),
        idEmpresa: entrada.idEmpresa,
        renglones: entrada.lineas.length,
      },
    });

    return { idPedido: pedido.id, lineas };
  }, bd);
}

/** Renglón de un pedido real a migrar (snapshot del viejo `PedidosRealesDet`). */
export interface LineaPedidoRealMigrada {
  /** `PedidoLinea.id` nuevo (resuelto por el loader vía mapeo de `IdPedidosDet`). */
  idPedidoLinea: number;
  cantidadPR?: number;
  cantidadEnviada?: number;
  cantidadEntregadaReal?: number;
  empaques?: number;
  /** Clave vieja `IdPedidosRealesDet` (para el mapeo del renglón creado). */
  claveVieja?: string | number;
}

/** Encabezado + renglones de un pedido real a migrar (snapshot del viejo `PedidosReales`). */
export interface PedidoRealMigrado {
  idPedido: number;
  numPedReal?: string | null;
  cedis?: string | null;
  apertura?: string | null;
  fechaPedPR?: Date | null;
  fechaInicio?: Date | null;
  fechaFin?: Date | null;
  fechaEntregadaReal?: Date | null;
  /** Auditoría ORIGINAL del viejo (IdUsuarios → creadoPorId/modificadoPorId). */
  creadoPorIdV1?: string | null;
  lineas: LineaPedidoRealMigrada[];
}

/** Resultado de migrar un pedido real. */
export interface ResultadoPedidoRealMigrado {
  idPedidoReal: number;
  lineas: { claveVieja: string | number | undefined; id: number }[];
}

/**
 * Crea un pedido real HISTÓRICO con su detalle y la auditoría ORIGINAL del viejo, en UNA
 * transacción (A2/A7). A diferencia del servicio normal (que replica el detalle en 0 desde el
 * pedido interno), aquí el detalle viene EXPLÍCITO de `PedidosRealesDet` (cantidades capturadas)
 * y liga cada renglón a su `PedidoLinea` ya migrado.
 */
export async function crearPedidoRealMigrado(
  sesion: SesionUsuario,
  entrada: PedidoRealMigrado,
  bd?: ContextoBd,
): Promise<ResultadoPedidoRealMigrado> {
  return enTransaccion(async (tx) => {
    // Auditoría original donde el CSV la trae; si no, el usuario de sistema del ETL.
    const autor = entrada.creadoPorIdV1 ?? sesion.id;
    const real = await tx.pedidoReal.create({
      data: {
        idPedido: entrada.idPedido,
        numPedReal: entrada.numPedReal ?? null,
        cedis: entrada.cedis ?? null,
        apertura: entrada.apertura ?? null,
        fechaPedPR: entrada.fechaPedPR ?? null,
        fechaInicio: entrada.fechaInicio ?? null,
        fechaFin: entrada.fechaFin ?? null,
        fechaEntregadaReal: entrada.fechaEntregadaReal ?? null,
        creadoPorId: autor,
        modificadoPorId: autor,
      },
    });

    const lineas: { claveVieja: string | number | undefined; id: number }[] = [];
    for (const l of entrada.lineas) {
      const datos: Prisma.PedidoRealLineaUncheckedCreateInput = {
        idPedidoReal: real.id,
        idPedidoLinea: l.idPedidoLinea,
        cantidadPR: l.cantidadPR ?? 0,
        cantidadEnviada: l.cantidadEnviada ?? 0,
        cantidadEntregadaReal: l.cantidadEntregadaReal ?? 0,
        empaques: l.empaques ?? 0,
        creadoPorId: autor,
        modificadoPorId: autor,
      };
      const creada = await tx.pedidoRealLinea.create({ data: datos });
      lineas.push({ claveVieja: l.claveVieja, id: creada.id });
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'PedidoReal',
      idEntidad: real.id,
      accion: 'OTRO',
      datos: {
        operacion: 'migracion',
        idPedido: entrada.idPedido,
        renglones: entrada.lineas.length,
      },
    });

    return { idPedidoReal: real.id, lineas };
  }, bd);
}

/** Lee el `PedidoLinea` (por id) para validar que un renglón de pedido real apunta a uno real. */
export async function existePedidoLinea(tx: Tx, idPedidoLinea: number): Promise<boolean> {
  const fila = await tx.pedidoLinea.findUnique({
    where: { id: idPedidoLinea },
    select: { id: true },
  });
  return fila !== null;
}
