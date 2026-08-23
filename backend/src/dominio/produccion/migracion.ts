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
import { TipoEtapaMovimiento, type EstadoOrden, type Prisma } from '../../datos/index.js';

import { registrarBitacora } from '../../comun/auditoria.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { siguienteFolio } from '../../comun/secuencias.js';
import { enTransaccion, type ContextoBd } from '../../comun/transaccion.js';

import { CLAVE_SECUENCIA_ETAPA } from './etapas.js';
import { copiarRecetaDelModelo } from './receta-orden.js';

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

    // V1-E3d (§Post-F9.43): la orden nace con SU receta congelada, copiada del BOM del modelo —
    // igual que en el alta interactiva. Sin esto, una orden migrada llegaría a `prueba` sin receta
    // y los cuatro consumidores (MRP, habilitación, costeo y semáforo) la verían VACÍA.
    const receta = await copiarRecetaDelModelo(
      tx,
      sesion,
      { id: orden.id, idEmpresa: entrada.idEmpresa, idModelo: entrada.idModelo },
      // `sinPrecios`: una orden de 2025 no puede congelar el precio que la cascada resuelve HOY —
      // sería inventar un dato. NULL = "esta orden no congeló precio" → el costeo cae al catálogo,
      // igual que antes de la etapa (y es lo mismo que hizo el backfill de la migración).
      { sinPrecios: true },
    );
    // Las órdenes históricas nacen LIBERADAS: son de un mundo anterior a la puerta de Desarrollo y
    // dejarlas cerradas bloquearía sus compras el día del deploy (mismo criterio que el backfill de
    // la migración `20260815140000_receta_en_la_orden`). Sus renglones sí quedan `sin_revisar`.
    //
    // DOS EXCEPCIONES, las dos con la misma razón que el dominio:
    //  • Una orden CANCELADA no compra nada: no se le abre una puerta que no va a usar.
    //  • ⚠️ Una orden cuya receta quedó VACÍA **tampoco se libera** — es lo mismo que rechaza
    //    `liberarReceta`: liberar "nada" dejaría al MRP explotando cero y a alguien creyendo que ya
    //    lo revisaron. No es un caso raro: **2,577 órdenes del viejo (2 de cada 3) tienen un modelo
    //    sin BOM**, así que su receta solo puede nacer vacía y hay que capturarla en la OP —que es
    //    exactamente como funcionaba el viejo—. Cerrarles la puerta es la señal correcta.
    //
    // ⭐ V1-E3h (§Post-F9.72): la firma bajó AL RENGLÓN, así que aquí se firman TODOS los renglones
    // con la MISMA fecha —igual que el backfill de `20260819120000_receta_liberada_por_renglon`— y
    // `ordenes.receta_liberada_en` se sella con ella como DERIVADO ("todo liberado"). Sellar solo la
    // columna de la orden dejaría la puerta CERRADA de hecho: la puerta ya no la consulta, pregunta
    // renglón por renglón.
    const recetaVacia = receta.telas + receta.avios + receta.artes === 0;
    if (entrada.estado !== 'cancelada' && !recetaVacia) {
      const firmadaEn = new Date();
      const firma = { liberadoEn: firmadaEn, liberadoPorId: null };
      await Promise.all([
        tx.ordenTela.updateMany({ where: { idOrden: orden.id }, data: firma }),
        tx.ordenAvio.updateMany({ where: { idOrden: orden.id }, data: firma }),
        tx.ordenArte.updateMany({ where: { idOrden: orden.id }, data: firma }),
      ]);
      await tx.orden.update({
        where: { id: orden.id },
        data: { recetaLiberadaEn: firmadaEn, recetaLiberadaPorId: null },
      });
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
        receta: { ...receta, liberada: entrada.estado !== 'cancelada' && !recetaVacia },
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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// MODO MIGRACIÓN de las ETAPAS de producción (F3-E6 — corte / envío / recibo de maquila).
//
// El servicio normal (`etapas.ts`/`recibos.ts`) está afinado para la CAPTURA nueva: folio de la
// secuencia, valida que la orden no esté cancelada, que el tercero tenga el rol correcto, sobre-corte
// libre/sobre-envío estricto/recibido≤enviado por suma directa bajo lock, y —en el recibo de
// costura— DERIVA efectos: ENTRADA al kardex PT (`generaEntradaPt`) + `EsMaCargo` propuesto. Todo
// correcto para el día a día. El ETL del histórico, en cambio, debe PRESERVAR los datos viejos tal
// cual y, sobre todo, NO derivar esos efectos.
//
// ⭐ VARIANTE SIN EFECTOS DERIVADOS (excepción JUSTIFICADA a PLANMAESTRO §7 — DECISIONES.md F3-E6):
// el recibo migrado crea SOLO `EtapaMovimiento(recibo_maquila)` + detalle con calidad. NO genera
// entrada al kardex PT NI crea `EsMaCargo`. Razón de no-doble-conteo: el kardex histórico se migra
// ÚNICAMENTE de `IPT_Movs` (Pieza B, `origenTipo = migracion`) y los cargos ÚNICAMENTE de
// `EsMa_Recibos` (loader `esma-cargos`). Si los recibos pasaran por el servicio completo, las 2,468
// entradas tipo 2 'Entrada de Maquila' del viejo se DUPLICARÍAN (ya vienen en `IPT_Movs`), y cada
// recibo crearía un cargo que también nace de `EsMa_Recibos`. La liga informativa `IPT_Movs.IdRecibos`
// la conserva la Pieza B como referencia; el recibo migrado NO escribe Movimiento ni cargo.
//
// Lo que RELAJAN respecto al servicio normal (excepciones históricas, documentadas):
//  • Folio de la SECUENCIA atómica "etapa-mov" POR EMPRESA (A3), igual que la captura nueva. El
//    identificador VIEJO (`IdCorte`/`IdEntregas`+`Consecutivo`/`IdRecibos`) NO sirve como folio:
//    `Entregas.Consecutivo` es el N-ésimo envío DE LA ORDEN (1,2,3…), no un consecutivo global —
//    usarlo como folio colisionaría masivamente bajo el unique (idEmpresa, folio). Por eso el folio
//    se asigna de la secuencia y el id viejo se PRESERVA en el MapeoMigracion + la bitácora.
//  • NO valida orden cancelada, ni rol del tercero, ni tolerancias (recibido≤enviado / sobre-envío):
//    los datos viejos pueden violarlas (el loader las LISTA como incidencias; nunca trunca el dato).
//  • `idTercero` puede ser NULL (envíos/cortes viejos sin tercero mapeable).
//  • Recibo: SIN entrada a PT, SIN EsMaCargo, SIN almacenes destino (la calidad sí se preserva,
//    SEPARADA del almacén — el almacén nace en v2).
//
// Lo que CONSERVAN (siguen siendo del dominio, A1/A2/A7/A9):
//  • Transaccionales (A2): encabezado + detalle + bitácora en UNA transacción.
//  • Auditadas (A7): `creadoPorId`/`modificadoPorId` + `Bitacora` (origen ETL).
//  • Por empresa (A9): `idEmpresa` EXPLÍCITO (el histórico abarca varias empresas; el loader lo
//    deriva de la orden, igual que el servicio normal).
//  • Detalle color×talla (D4); la cantidad por celda se SUMA si el despivote del viejo repitiera
//    una talla (defensa del `@@unique(idEtapaMov, idColor, idTalla)`).
//
// Idempotencia: el LOADER resuelve "ya existe" por el unique `(idEmpresa, folio)` ANTES de llamar
// (preservando `Consecutivo`); aquí solo se crea.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Una celda color×talla a migrar para una etapa (ya resuelta a ids del catálogo). */
export interface CeldaEtapaMigrada {
  idColor: number;
  idTalla: number;
  cantidad: number;
  /** Solo recibos: piezas de PRIMERA. NULL en corte/envío. */
  cantidadPrimeras?: number | null;
  /** Solo recibos: piezas de SEGUNDA. NULL en corte/envío. */
  cantidadSegundas?: number | null;
}

/** Encabezado + matriz de una etapa de producción a migrar (snapshot del viejo). */
export interface EtapaMigrada {
  idEmpresa: number;
  idOrden: number;
  tipo: TipoEtapaMovimiento;
  /** Identificador VIEJO de la etapa (IdCorte / IdEntregas+Consecutivo / IdRecibos) para la bitácora. */
  claveVieja?: string;
  /** Proceso de maquila (costura/estampado). OBLIGATORIO en envío/recibo, NULL en corte. */
  idTipoProceso?: number | null;
  /** Cortador (corte) o maquilero (envío/recibo). NULL si el viejo no lo trae/mapea. */
  idTercero?: number | null;
  /** Fecha original de la etapa (de la tabla vieja). */
  fecha: Date;
  /** Fecha compromiso del maquilero (envíos: `Entregas.FechaEntregaM`). Solo día. */
  fechaCompromiso?: Date | null;
  /** Precio pactado de maquila (envíos: `Entregas.PrecioPactado`). Decimal o NULL. */
  precioPactado?: number | null;
  observaciones?: string | null;
  /** Matriz despivotada (celdas color×talla con cantidad >0). */
  celdas: CeldaEtapaMigrada[];
}

/** Resultado de migrar una etapa. */
export interface ResultadoEtapaMigrada {
  idEtapa: number;
  /** # de celdas (color×talla) creadas. */
  celdas: number;
}

/**
 * Crea una etapa de producción HISTÓRICA (corte/envío/recibo) con su encabezado y matriz despivotada,
 * en UNA transacción (A2/A7). SIN efectos derivados (ver el bloque de TSDoc de arriba). Folio de la
 * secuencia atómica "etapa-mov" POR EMPRESA (A3). La matriz se agrupa por (color, talla) sumando
 * cantidades repetidas (defensa del `@@unique`). Idempotencia: el loader resuelve "ya existe" por su
 * `MapeoMigracion` ANTES de llamar; aquí solo se crea.
 */
async function crearEtapaMigrada(
  sesion: SesionUsuario,
  entrada: EtapaMigrada,
  bd?: ContextoBd,
): Promise<ResultadoEtapaMigrada> {
  return enTransaccion(async (tx) => {
    // Suma celdas repetidas (mismo color×talla) — el despivote posicional del viejo podría repetir
    // una talla si dos columnas TCn mapean a la misma etiqueta; el @@unique lo exige.
    const porClave = new Map<string, CeldaEtapaMigrada>();
    for (const c of entrada.celdas) {
      const clave = `${String(c.idColor)}:${String(c.idTalla)}`;
      const prev = porClave.get(clave);
      if (prev === undefined) {
        porClave.set(clave, { ...c });
      } else {
        prev.cantidad += c.cantidad;
        if (prev.cantidadPrimeras != null || c.cantidadPrimeras != null) {
          prev.cantidadPrimeras = (prev.cantidadPrimeras ?? 0) + (c.cantidadPrimeras ?? 0);
        }
        if (prev.cantidadSegundas != null || c.cantidadSegundas != null) {
          prev.cantidadSegundas = (prev.cantidadSegundas ?? 0) + (c.cantidadSegundas ?? 0);
        }
      }
    }
    const celdas = [...porClave.values()];

    const folio = await siguienteFolio(tx, entrada.idEmpresa, CLAVE_SECUENCIA_ETAPA);
    const etapa = await tx.etapaMovimiento.create({
      data: {
        folio,
        idEmpresa: entrada.idEmpresa,
        idOrden: entrada.idOrden,
        tipo: entrada.tipo,
        idTipoProceso: entrada.idTipoProceso ?? null,
        idTercero: entrada.idTercero ?? null,
        fecha: entrada.fecha,
        fechaCompromiso: entrada.fechaCompromiso ?? null,
        ...(entrada.precioPactado == null ? {} : { precioPactado: entrada.precioPactado }),
        observaciones: entrada.observaciones ?? null,
        detalles: {
          create: celdas.map((c) => ({
            idColor: c.idColor,
            idTalla: c.idTalla,
            cantidad: c.cantidad,
            ...(c.cantidadPrimeras == null ? {} : { cantidadPrimeras: c.cantidadPrimeras }),
            ...(c.cantidadSegundas == null ? {} : { cantidadSegundas: c.cantidadSegundas }),
          })),
        },
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'EtapaMovimiento',
      idEntidad: etapa.id,
      accion: 'CREAR',
      datos: {
        operacion: 'migracion',
        tipo: entrada.tipo,
        folio: Number(folio),
        idEmpresa: entrada.idEmpresa,
        idOrden: entrada.idOrden,
        celdas: celdas.length,
        ...(entrada.claveVieja === undefined ? {} : { claveVieja: entrada.claveVieja }),
      },
    });

    return { idEtapa: etapa.id, celdas: celdas.length };
  }, bd);
}

/** Migra un CORTE histórico (`Corte` + `OrdenesDetCorte`). Folio de la secuencia A3 (el `IdCorte` se preserva en MapeoMigracion). idTipoProceso NULL. */
export async function crearCorteMigrado(
  sesion: SesionUsuario,
  entrada: Omit<EtapaMigrada, 'tipo' | 'idTipoProceso'>,
  bd?: ContextoBd,
): Promise<ResultadoEtapaMigrada> {
  return crearEtapaMigrada(sesion, { ...entrada, tipo: TipoEtapaMovimiento.corte }, bd);
}

/**
 * Migra un ENVÍO a maquila histórico (`Entregas`/`EntregasEst` + sus detalles). Folio de la secuencia
 * A3; el id viejo se preserva en MapeoMigracion (`Consecutivo` es el N-ésimo envío DE LA ORDEN, no un
 * folio global). `idTipoProceso` = costura (M) o estampado (A). En el viejo "Entregas" = envío AL maquilero.
 */
export async function crearEnvioMigrado(
  sesion: SesionUsuario,
  entrada: Omit<EtapaMigrada, 'tipo'> & { idTipoProceso: number },
  bd?: ContextoBd,
): Promise<ResultadoEtapaMigrada> {
  return crearEtapaMigrada(sesion, { ...entrada, tipo: TipoEtapaMovimiento.envio_maquila }, bd);
}

/**
 * Migra un RECIBO de maquila histórico (`Recibos`/`RecibosEst` + sus detalles). Folio de la secuencia
 * A3 (el `IdRecibos`/`IdRecibosEst` se preserva en MapeoMigracion). VARIANTE SIN EFECTOS: NO genera
 * entrada al kardex PT NI `EsMaCargo` (ver el bloque de TSDoc — no-doble-conteo contra IPT_Movs/
 * EsMa_Recibos). La calidad primeras/segundas se preserva en el detalle, SEPARADA del almacén destino
 * (que nace en v2).
 */
export async function crearReciboMigrado(
  sesion: SesionUsuario,
  entrada: Omit<EtapaMigrada, 'tipo'> & { idTipoProceso: number },
  bd?: ContextoBd,
): Promise<ResultadoEtapaMigrada> {
  return crearEtapaMigrada(sesion, { ...entrada, tipo: TipoEtapaMovimiento.recibo_maquila }, bd);
}
