/**
 * SALIDA A PRODUCCIÓN (rediseño R3, B4 — proto §4.1 "Generar OP"): la operación CENTRAL del flujo
 * nuevo de captura. Desde un RENGLÓN de pedido interno (que el constructor eligió por su modelo DE
 * DESARROLLO), aquí NACE la matriz color×talla y, en UNA transacción (A2):
 *
 *  1. Se crea la ORDEN de producción REUSANDO `crearOrden` (F2-E2: autorrelleno modelo/cliente/
 *     empresa del renglón→pedido, folio por secuencia atómica A3, snapshot `ocCliente` B3 y el
 *     evento outbox `orden-creada` B5 — la RC se programa SOLA en segundo plano).
 *  2. Se capturan las REFERENCIAS del cliente (D7) si vienen (helpers compartidos de `ordenes.ts`).
 *  3. Se LIGA la orden a su desarrollo (`DesarrolloOrden`) REUSANDO el núcleo de `ligarOrden`
 *     (F8-E6) — si el renglón NO tiene desarrollo, la OP nace SIN liga (caso legado, proto §4.1).
 *  4. Se MINTEA el nº INTERNO de producción del modelo (`Modelo.numeroProduccion`) si es su
 *     PRIMERA salida a producción — secuencia Postgres `numero_produccion_seq` (A3: atómica,
 *     jamás Max()+1; global porque el catálogo de modelos es global, ADR-0007). Si el modelo ya
 *     salió antes, se REUSA su número (resurtidos). Aclaración Daniel 7-jul: Desarrollo y
 *     Producción son BASES DISTINTAS — este número es distinto del folio de OP y del nº de
 *     desarrollo (`Modelo.codigo`).
 *
 * Reglas deliberadas (diferencias vs el prototipo, documentadas):
 *  • El proto AJUSTABA la cantidad del renglón del pedido al total de la matriz; aquí NO se
 *    re-escribe `PedidoLinea.cantidadPedida` — el backend F2 modela N órdenes por renglón
 *    (resurtidos) y el pedido es el compromiso comercial, no un espejo de la matriz. La validación
 *    cuadra/faltan/sobran es GUÍA de la UI.
 *  • El proto usaba el código del modelo como nº de producción para históricos; aquí el número se
 *    mintea SIEMPRE en la primera salida (también para modelos legado sin desarrollo): entrar al
 *    catálogo de producción es lo que asigna el número, tenga o no ficha de desarrollo.
 *
 * Permiso: `ordenes.administrar` (el MISMO con que hoy nacen órdenes — sin permisos nuevos). La
 * liga al desarrollo es un EFECTO de crear la OP (no una edición del expediente de Desarrollo),
 * por eso no exige `desarrollo.administrar` (el núcleo compartido valida las mismas reglas A1).
 */
import type { DatosSalidaProduccion, SalidaProduccionSalida } from '../../contrato/index.js';
import { esquemaSalidaProduccionCuerpo } from '../../contrato/index.js';

import { registrarBitacora } from '../../comun/auditoria.js';
import { dispararPublicacion } from '../../comun/cola-eventos.js';
import { ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { enTransaccion, type ContextoBd, type Tx } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { ligarOrdenNucleo } from '../desarrollo/liga-orden.js';

import { crearOrden, obtenerOrden, sincronizarReferencias, validarReferencias } from './ordenes.js';

/**
 * MINTEA (o reusa) el nº interno de producción del modelo, de forma ATÓMICA: el UPDATE condicional
 * `numero_produccion IS NULL` con `nextval()` garantiza que dos primeras-salidas concurrentes del
 * MISMO modelo minteen UNA sola vez (la que pierde la carrera no actualiza y relee el número ya
 * minteado; a lo sumo se desperdicia un valor de la secuencia — aceptable, igual que los huecos
 * por rollback de folios A3). Devuelve el número y si ESTA llamada lo minteó.
 */
async function mintearNumeroProduccion(
  tx: Tx,
  idModelo: number,
): Promise<{ numero: number; minteado: boolean }> {
  const minteadas = await tx.$queryRaw<{ numero_produccion: number }[]>`
    UPDATE "modelos"
    SET "numero_produccion" = nextval('numero_produccion_seq')
    WHERE "id" = ${idModelo} AND "numero_produccion" IS NULL
    RETURNING "numero_produccion"
  `;
  const minteada = minteadas[0];
  if (minteada !== undefined) {
    return { numero: Number(minteada.numero_produccion), minteado: true };
  }
  // Ya tenía número (salidas anteriores): se REUSA.
  const modelo = await tx.modelo.findUnique({
    where: { id: idModelo },
    select: { numeroProduccion: true },
  });
  if (modelo?.numeroProduccion == null) {
    // Imposible salvo corrupción: el UPDATE no minteó porque NO era null, pero al releer es null.
    throw new Error(`El modelo ${idModelo} no tiene nº de producción tras intentar mintearlo.`);
  }
  return { numero: modelo.numeroProduccion, minteado: false };
}

/**
 * Genera la OP de un renglón de pedido (la "salida a producción", B4). Ver el encabezado del
 * módulo para el detalle de los pasos; todo ocurre en UNA transacción (A2) — si la matriz, la
 * liga o el minteo fallan, NADA persiste (ni la orden ni el folio consumido se ven).
 */
export async function salidaAProduccion(
  sesion: SesionUsuario,
  idPedidoLinea: number,
  entrada: DatosSalidaProduccion,
  bd?: ContextoBd,
): Promise<SalidaProduccionSalida> {
  verificarPermiso(sesion, 'ordenes.administrar');
  const datos = validarEntrada(esquemaSalidaProduccionCuerpo, entrada);

  // La matriz nace aquí: debe traer PIEZAS (>0). El desglose exacto lo valida `crearOrden`
  // (colores activos, tallas del catálogo, sin repetidos).
  const totalPiezas = datos.lineas.reduce(
    (suma, linea) => suma + linea.tallas.reduce((s, t) => s + t.cantidad, 0),
    0,
  );
  if (totalPiezas <= 0) {
    throw new ErrorValidacion('Captura las cantidades por color y talla de la orden.');
  }

  const resultado = await enTransaccion(async (tx) => {
    // Renglón + pedido (empresa activa, A9) + su desarrollo: la fuente del flujo.
    const linea = await tx.pedidoLinea.findFirst({
      where: { id: idPedidoLinea, pedido: { idEmpresa: sesion.idEmpresaActiva } },
      select: {
        id: true,
        idModelo: true,
        idDesarrollo: true,
        pedido: { select: { id: true, folio: true, fechaDe: true, fechaHasta: true } },
      },
    });
    if (linea === null) {
      throw new ErrorNoEncontrado('Renglón de pedido', idPedidoLinea);
    }

    // 1) La orden nace por el alta F2 (folio A3 + autorrelleno + snapshot ocCliente B3 + evento
    //    outbox orden-creada B5), UNIDA a esta transacción (composición A2).
    const orden = await crearOrden(
      sesion,
      {
        idPedidoLinea,
        lineas: datos.lineas,
        fecha: datos.fecha ?? aFechaIso(new Date()),
        // Sin fecha explícita, la OP hereda la ventana de entrega del pedido (la RC automática
        // la usa como fecha de entrega de la ruta).
        fechaEntrega:
          datos.fechaEntrega ??
          aFechaIso(linea.pedido.fechaHasta) ??
          aFechaIso(linea.pedido.fechaDe),
      },
      { tx },
    );

    // 2) Referencias del cliente (D7), si vienen: helpers compartidos con `guardarReferenciasOrden`.
    let ordenSalida = orden;
    if (datos.referencias !== undefined && datos.referencias.length > 0) {
      await validarReferencias(tx, orden.idCliente, datos.referencias);
      await sincronizarReferencias(tx, sesion, orden.id, datos.referencias);
      // La salida de `crearOrden` se LEYÓ antes de escribir las referencias (fallo del CI): se
      // relee EN LA MISMA tx para que la respuesta las traiga (la promesa de B4 es "refs D7 en la
      // misma operación", también en el payload que consume la UI).
      ordenSalida = await obtenerOrden(sesion, orden.id, { tx });
    }

    // 3) Liga al desarrollo (núcleo de F8-E6) — solo si el renglón tiene desarrollo.
    let ligaCreada = false;
    if (linea.idDesarrollo !== null) {
      await ligarOrdenNucleo(tx, sesion, orden.id, linea.idDesarrollo, sesion.idEmpresaActiva);
      ligaCreada = true;
    }

    // 4) Nº interno de producción: mintea la primera vez; reusa después.
    const numero = await mintearNumeroProduccion(tx, linea.idModelo);

    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: orden.id,
      accion: 'OTRO',
      datos: {
        operacion: 'salida-a-produccion',
        idPedidoLinea,
        folioPedido: Number(linea.pedido.folio),
        folioOrden: orden.folio,
        idDesarrollo: linea.idDesarrollo,
        numeroProduccion: numero.numero,
        numeroProduccionMinteado: numero.minteado,
        referencias: datos.referencias?.length ?? 0,
        totalPiezas,
      },
    });

    return {
      orden: ordenSalida,
      numeroProduccion: numero.numero,
      numeroProduccionMinteado: numero.minteado,
      idDesarrollo: linea.idDesarrollo,
      ligaCreada,
    };
  }, bd);

  // El evento outbox lo escribió `crearOrden` en la MISMA tx; aquí (ya commiteada) se dispara la
  // publicación best-effort (dentro de la tx el relay no ve la fila; el barrido la recuperaría).
  dispararPublicacion();

  return resultado;
}

/** Convierte un `Date` (o null) a `YYYY-MM-DD` para el contrato del alta de orden. */
function aFechaIso(fecha: Date | null): string | undefined {
  return fecha === null ? undefined : fecha.toISOString().slice(0, 10);
}
