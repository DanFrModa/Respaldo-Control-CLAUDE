/**
 * ⭐⭐ CERRAR LA ORDEN CON UN MAQUILERO — el acto que salda la CUARTA CUBETA (V1, fila 0.109;
 * DANIEL 3-sep-2026). Toda la lógica vive AQUÍ (A1); las rutas REST solo validan permiso + Zod.
 *
 * ## Qué pidió Daniel, textual
 *
 * Un **botón de «cerrar la orden»** (*«se cierra por orden»*), que **lo aprieta quien recibe**, que
 * **salda siempre el pendiente** y que **PROPONE** el cobro esperando su visto bueno — *«nunca
 * cobra solo»*. Dos desenlaces, y los dos limpian la lista de pendientes: **cerrado y cobrado** o
 * **cerrado y perdonado**. Reversible.
 *
 * ## El problema que cierra (y por qué antes era IMPOSIBLE cobrar)
 *
 * §Post-F9.147 dejó la invariante `enviado = primeras + segundas + faltantes + incompletas`, y la
 * prosa de `incompletas.ts` decía que el faltante *«se le cobra»*. Pero el faltante NO era un dato:
 * era el RESIDUO de `pendiente = enviado − buenas − incompletas − faltantes saldados`. **Faltante ≡ pendiente, el mismo
 * número** ⇒ cobrarlo no bajaba nada y la lista de pendientes crecía para siempre. Y
 * `esma/cargos.ts` no mencionaba «faltante» ni una vez: la regla vivía en la prosa y no en el
 * código. Aquí el faltante pasa a tener su columna (`CierreMaquilaOrdenDet.cantidadFaltantes`) y
 * sale del pendiente.
 *
 * ## Las cinco decisiones que sostienen este módulo
 *
 * 1. **El acto es un REGISTRO PROPIO, no un estado de la orden** (§Post-F9.181(a)): `EstadoOrden` es
 *    `capturada | completa | cancelada` y `completa` significa completitud de CAPTURA, no
 *    «terminada». Y una orden puede tener **varios maquileros vivos**, así que el cierre no cabe en
 *    una bandera por orden: es por **orden × maquilero × proceso**, que es la granularidad a la que
 *    se lleva el pendiente, a la que vive el `precioPactado` (en el ENVÍO) y a la que se le cobra.
 * 2. **El cobro es un DESCUENTO, no un cargo.** `saldo = Σcargos + Σabonos − Σpagos − Σdescuentos`
 *    (`esma/formula-saldo.ts`): el CARGO sube lo que se le debe al maquilero — le pagaría las
 *    prendas que no devolvió, además de dejárselas. Cobrarle BAJA lo que se le debe. Y es la palabra
 *    de Daniel (§Post-F9.147): *«se le quita a mando (normalmente **descontandole** esas prendas
 *    faltantes)»*.
 * 3. **Nace `capturado`, o sea PROPUESTO.** Un `DescuentoMaquilero` `capturado` **no cuenta al
 *    saldo** y se ve en el estado de cuenta marcado como pendiente de revisión (fila 0.115). Ahí
 *    está el *«esperando su visto bueno»*, con el flujo de revisión que ya existía — **sin pantalla
 *    nueva** y sin que este acto pueda cobrar por su cuenta.
 * 4. **Deshacer es el acto inverso auditado (D3), nunca una edición ni un borrado**: el cierre queda
 *    `deshechoEn` (sus piezas vuelven al pendiente en el mismo instante, porque el pendiente se
 *    DERIVA) y el descuento propuesto queda cancelado. Si el descuento **ya se revisó**, el deshacer
 *    se RECHAZA: ese dinero ya movió el saldo y sacarlo es un movimiento contrario capturado a mano.
 * 5. **Lo que se salda lo DERIVA el servidor bajo bloqueo**, nunca lo manda el cliente: dejar que la
 *    pantalla dijera cuántas piezas se cobran es exactamente lo que las guardas de este módulo
 *    existen para impedir.
 *
 * Innegociables: A1 (lógica aquí), A2 (una transacción), A4 (`produccion.recibo` para cerrar,
 * `produccion.cancelar` para deshacer — SIN permisos nuevos), A7 (bitácora), A9 (empresa activa),
 * D3 (derivado por suma directa bajo `pg_advisory_xact_lock`, nunca la vista; inverso auditado).
 */
import {
  esquemaCierreMaquilaCrear,
  esquemaCierreMaquilaDeshacerCuerpo,
  type CierreMaquilaSalida,
  type CierresMaquilaLista,
} from '../../contrato/index.js';
import { TipoEtapaMovimiento, type Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { dispararPublicacion } from '../../comun/cola-eventos.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import {
  EVENTOS_OUTBOX,
  VERSION_CIERRE_MAQUILA,
  registrarEventoOutbox,
} from '../../comun/eventos-dominio.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { resolverConFactura } from '../esma/facturacion.js';

import { celdasSaldables, saldadosPorCelda } from './faltantes-saldados.js';
import { pendientePorCelda } from './incompletas.js';
import { claveCeldaPack, normalizarPack } from './packs.js';
import { bloquearEtapasDeOrden, sumarCeldas } from './recibos.js';

/** Cliente de solo lectura (el singleton de Prisma o una transacción en curso). */
type ClienteLectura = ReturnType<typeof clienteLectura>;

/**
 * Llave PLEGADA color×talla — la MISMA que arma `sumarCeldas` para su condición (1) y la que usa
 * `faltantes-saldados.ts`. Se construye, nunca se parte.
 */
function clavePlegada(idColor: number, idTalla: number): string {
  return `${idColor}:${idTalla}`;
}

/** Convierte un `YYYY-MM-DD` al `Date` UTC que Prisma guarda en `@db.Date`. */
function aDateColumna(valor: string): Date {
  return new Date(`${valor}T00:00:00.000Z`);
}

// ── El reparto del faltante entre tendidos (PURO, probado sin BD) ────────────────────────────────

/** Una celda color×talla×pack con su pendiente ya derivado. */
export interface PendienteDeTendido {
  pack: string;
  pendiente: number;
}

/**
 * ⭐ CUÁNTO SE SALDA DE CADA TENDIDO, dado el pendiente AGREGADO de un color×talla (§Post-F9.10).
 *
 * 🔴 POR QUÉ NO SE SALDAN SIMPLEMENTE LOS POSITIVOS DE CADA PACK. Con los tendidos revueltos, el
 * bucket de pack VACÍO sale **negativo** —lo que el maquilero devolvió sin decir de qué tendido
 * era—, y entonces `Σ positivos > pendiente real`. Ejemplo real de esa mecánica: enviados 5 del
 * pack A y 5 del B, devueltas 8 sin pack ⇒ `{A:+5, B:+5, '':−8}` y el pendiente REAL es 2. Saldar
 * los positivos habría cobrado **10 piezas de 2**. Por eso el tope es el AGREGADO (que es también
 * la condición (1) que el recibo topa, `packs.ts::excesosDelRecibo`) y los packs solo dicen **cómo
 * se reparte** ese número.
 *
 * El reparto es por orden de pack (estable, alfabético: lo decide el llamador al ordenar) tomando
 * `min(pendiente del pack, lo que queda)`. Cuando no hay packs —el caso normal— hay un solo bucket
 * de pack vacío y el reparto es la identidad.
 *
 * Devuelve solo las celdas con cantidad > 0. Si el pendiente agregado es ≤ 0, devuelve vacío: no hay
 * nada que cobrar (y un pendiente negativo es histórico migrado, no una deuda).
 */
export function repartirFaltantePorTendido(
  pendienteAgregado: number,
  tendidos: readonly PendienteDeTendido[],
): { pack: string; cantidad: number }[] {
  // Contrato explícito: un pendiente ≤ 0 no salda NADA (un pendiente negativo es histórico migrado,
  // no una deuda). ⚠️ Es una salida temprana que DICE la regla, no la única que la sostiene: si se
  // quita, el `if (restante <= 0) break` del bucle devuelve lo mismo — medido con mutación, el
  // mutante sobrevive porque de verdad es equivalente. Se conserva porque el contrato de esta
  // función se lee aquí arriba y no dentro del bucle.
  if (pendienteAgregado <= 0) {
    return [];
  }
  const reparto: { pack: string; cantidad: number }[] = [];
  let restante = pendienteAgregado;
  for (const t of tendidos) {
    if (restante <= 0) break;
    if (t.pendiente <= 0) continue;
    const cantidad = Math.min(t.pendiente, restante);
    reparto.push({ pack: t.pack, cantidad });
    restante -= cantidad;
  }
  // No puede quedar resto: `pendienteAgregado = Σ todos los tendidos ≤ Σ los positivos`. Si algún
  // día quedara (una lectura inconsistente), se cuelga del pack vacío para que la SUMA siga siendo
  // exacta — el número que se le cobra al maquilero no puede depender de cómo se repartió.
  if (restante > 0) {
    reparto.push({ pack: '', cantidad: restante });
  }
  return reparto;
}

// ── Proyección a la forma del contrato ───────────────────────────────────────────────────────────

/** `include` para proyectar un cierre con sus nombres legibles y su descuento. */
const incluirCierre = {
  orden: { select: { folio: true } },
  maquilero: { select: { nombre: true } },
  tipoProceso: { select: { nombre: true } },
  descuento: { select: { id: true, estadoRevision: true, canceladoEn: true } },
  detalles: {
    select: {
      idColor: true,
      idTalla: true,
      pack: true,
      cantidadFaltantes: true,
      color: { select: { nombre: true } },
      talla: { select: { etiqueta: true, orden: true } },
    },
  },
} satisfies Prisma.CierreMaquilaOrdenInclude;

type CierreConDetalle = Prisma.CierreMaquilaOrdenGetPayload<{ include: typeof incluirCierre }>;

/**
 * Proyecta un cierre a la forma JSON del contrato. `ocultarPrecio` REDACTA el precio y el importe
 * (mismo criterio que la cancelación de un recibo, R2 §4.4.3): el cierre lo aprieta quien recibe, y
 * quien recibe no necesariamente tiene `ordenes.ver-precio-real-maquila`.
 */
function aCierreSalida(c: CierreConDetalle, ocultarPrecio: boolean): CierreMaquilaSalida {
  const celdas = c.detalles
    .map((d) => ({
      idColor: d.idColor,
      color: d.color.nombre,
      pack: d.pack,
      idTalla: d.idTalla,
      etiquetaTalla: d.talla.etiqueta,
      ordenTalla: d.talla.orden,
      cantidadFaltantes: d.cantidadFaltantes,
    }))
    .sort(
      (a, b) =>
        a.color.localeCompare(b.color, 'es') ||
        a.pack.localeCompare(b.pack, 'es') ||
        a.ordenTalla - b.ordenTalla ||
        a.idTalla - b.idTalla,
    )
    .map(({ ordenTalla: _o, ...resto }) => resto);

  const piezasFaltantes = c.detalles.reduce((s, d) => s + d.cantidadFaltantes, 0);
  const precio = c.precioFaltante === null ? null : c.precioFaltante.toNumber();
  const precioFaltante = ocultarPrecio ? null : precio;
  const importe = ocultarPrecio || precio === null ? null : piezasFaltantes * precio;
  // Un descuento CANCELADO (por un deshacer) ya no es «el descuento de este cierre»: se reporta
  // como si no lo hubiera, para que nadie lo lea como dinero vivo.
  const descuentoVivo =
    c.descuento !== null && c.descuento.canceladoEn === null ? c.descuento : null;

  return {
    id: c.id,
    idEmpresa: c.idEmpresa,
    idOrden: c.idOrden,
    folioOrden: Number(c.orden.folio),
    idMaquilero: c.idMaquilero,
    maquilero: c.maquilero.nombre,
    idTipoProceso: c.idTipoProceso,
    tipoProceso: c.tipoProceso.nombre,
    fecha: c.fecha.toISOString().slice(0, 10),
    desenlace: c.desenlace,
    piezasFaltantes,
    precioFaltante,
    importe,
    idDescuento: descuentoVivo?.id ?? null,
    descuentoRevisado: descuentoVivo?.estadoRevision === 'revisado',
    motivo: c.motivo,
    deshecho: c.deshechoEn !== null,
    deshechoEn: c.deshechoEn === null ? null : c.deshechoEn.toISOString(),
    deshechoPorId: c.deshechoPorId,
    motivoDeshacer: c.motivoDeshacer,
    celdas,
    creadoEn: c.creadoEn.toISOString(),
    creadoPorId: c.creadoPorId,
  };
}

/** Lee un cierre de la empresa activa (A9) y lo proyecta, o lanza `ErrorNoEncontrado`. */
async function obtenerCierre(
  cliente: ClienteLectura,
  sesion: SesionUsuario,
  idCierre: number,
): Promise<CierreMaquilaSalida> {
  const cierre = await cliente.cierreMaquilaOrden.findFirst({
    where: { id: idCierre, idEmpresa: sesion.idEmpresaActiva },
    include: incluirCierre,
  });
  if (cierre === null) {
    throw new ErrorNoEncontrado('CierreMaquilaOrden', idCierre);
  }
  return aCierreSalida(cierre, !tienePermiso(sesion, 'ordenes.ver-precio-real-maquila'));
}

// ── El PENDIENTE que se va a saldar (derivado bajo lock, D3) ─────────────────────────────────────

/** Una celda que el cierre va a saldar: color×talla×pack con sus piezas faltantes. */
interface CeldaASaldar {
  idColor: number;
  idTalla: number;
  pack: string;
  cantidadFaltantes: number;
}

/**
 * DERIVA lo que un maquilero le queda a deber de un proceso, por celda, con la MISMA aritmética que
 * el resto del módulo: `pendiente = enviado − devuelto − saldado − yaSaldado`
 * ({@link produccion/incompletas.ts::pendientePorCelda}), leyendo con las MISMAS funciones que el
 * tope del recibo (`sumarCeldas`, `saldadosPorCelda`) — no con una copia reducida, que es como las
 * dos caras acaban diciendo números distintos.
 *
 * El tope de cada color×talla es el AGREGADO de sus packs, y el reparto entre tendidos lo hace
 * {@link repartirFaltantePorTendido} (ver ahí por qué no se saldan los positivos de cada pack).
 *
 * Debe llamarse con el lock de la orden ya tomado: los números son un saldo.
 */
async function derivarFaltantes(
  tx: Tx,
  filtros: { idOrden: number; idTipoProceso: number; idMaquilero: number },
): Promise<CeldaASaldar[]> {
  // 🔑 EL UNIVERSO DE CELDAS SALE DE LOS ENVÍOS, y no de partir las llaves de los mapas. Dos
  // razones: (1) `claveCeldaPack` es una llave que *«no se vuelve a partir nunca: sólo se
  // compara»* (`packs.ts`), y (2) un maquilero sólo puede DEBER lo que se le mandó — una celda sin
  // envío suyo da pendiente ≤ 0 y este cierre no la toca. Así la enumeración es estructurada
  // (color/talla/pack como columnas) y los mapas se usan sólo para los NÚMEROS.
  const [enviosDet, enviado, devuelto, saldado] = await Promise.all([
    tx.etapaMovimientoDet.findMany({
      where: {
        etapaMov: {
          idOrden: filtros.idOrden,
          idTipoProceso: filtros.idTipoProceso,
          idTercero: filtros.idMaquilero,
          tipo: TipoEtapaMovimiento.envio_maquila,
          canceladoEn: null,
        },
      },
      select: { idColor: true, idTalla: true, pack: true },
      distinct: ['idColor', 'idTalla', 'pack'],
    }),
    sumarCeldas(
      tx,
      filtros.idOrden,
      TipoEtapaMovimiento.envio_maquila,
      filtros.idTipoProceso,
      filtros.idMaquilero,
    ),
    sumarCeldas(
      tx,
      filtros.idOrden,
      TipoEtapaMovimiento.recibo_maquila,
      filtros.idTipoProceso,
      filtros.idMaquilero,
    ),
    saldadosPorCelda(tx, filtros),
  ]);

  // Agrupa los tendidos por celda color×talla, conservando las tres columnas.
  const porCelda = new Map<string, { idColor: number; idTalla: number; packs: Set<string> }>();
  for (const d of enviosDet) {
    const plegada = clavePlegada(d.idColor, d.idTalla);
    const grupo = porCelda.get(plegada) ?? {
      idColor: d.idColor,
      idTalla: d.idTalla,
      packs: new Set<string>(),
    };
    grupo.packs.add(normalizarPack(d.pack));
    porCelda.set(plegada, grupo);
  }

  // ⭐ QUÉ SE PUEDE SALDAR — por la MISMA función que usa la pantalla para ofrecer el botón
  // (`celdasSaldables`, `faltantes-saldados.ts`): pliega por color×talla y se queda con lo positivo.
  // Escribirlo aquí a mano era el defecto que cazó el reviewer: la vista sumaba plano (las celdas
  // negativas del histórico compensaban) y el servidor saldaba por celda, así que el diálogo podía
  // decir 2 piezas y el descuento salir por 5.
  const saldables = new Map(
    celdasSaldables(
      [...porCelda.entries()].map(([plegada, grupo]) => ({
        idColor: grupo.idColor,
        idTalla: grupo.idTalla,
        // El TOPE de cada color×talla es su AGREGADO (la condición (1) que el recibo topa): es el
        // número que el maquilero de verdad debe. Ver `repartirFaltantePorTendido`.
        pendiente: pendientePorCelda(
          enviado.total.get(plegada) ?? 0,
          devuelto.total.get(plegada) ?? 0,
          saldado.total.get(plegada) ?? 0,
        ),
      })),
    ).map((c) => [clavePlegada(c.idColor, c.idTalla), c.pendiente] as const),
  );

  const celdas: CeldaASaldar[] = [];
  for (const [plegada, grupo] of porCelda) {
    const pendienteAgregado = saldables.get(plegada);
    if (pendienteAgregado === undefined) continue;

    const tendidos = [...grupo.packs]
      .sort((a, b) => a.localeCompare(b, 'es'))
      .map((pack) => {
        const clave = claveCeldaPack(grupo.idColor, grupo.idTalla, pack);
        return {
          pack,
          pendiente: pendientePorCelda(
            enviado.porPack.get(clave) ?? 0,
            devuelto.porPack.get(clave) ?? 0,
            saldado.porPack.get(clave) ?? 0,
          ),
        };
      });

    for (const parte of repartirFaltantePorTendido(pendienteAgregado, tendidos)) {
      celdas.push({
        idColor: grupo.idColor,
        idTalla: grupo.idTalla,
        pack: normalizarPack(parte.pack),
        cantidadFaltantes: parte.cantidad,
      });
    }
  }
  return celdas;
}

/**
 * El PRECIO con el que se propone el cobro: el `precioPactado` del ENVÍO vivo más reciente de ese
 * maquilero a ese proceso. Es el precio de maquila que se le pactó por esa prenda, que es lo que
 * Daniel descuenta. `null` cuando ningún envío lo trae — el caso del histórico migrado (1,309
 * envíos sin precio): entonces el cierre SALDA igual y NO propone el cobro, y lo dice con nombre.
 * **No se inventa un precio** (REGLA 0-B: lo viejo se tolera, no se compensa).
 */
async function precioDelEnvio(
  tx: Tx,
  filtros: { idOrden: number; idTipoProceso: number; idMaquilero: number },
): Promise<number | null> {
  const envio = await tx.etapaMovimiento.findFirst({
    where: {
      idOrden: filtros.idOrden,
      idTipoProceso: filtros.idTipoProceso,
      idTercero: filtros.idMaquilero,
      tipo: TipoEtapaMovimiento.envio_maquila,
      canceladoEn: null,
      precioPactado: { not: null },
    },
    orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
    select: { precioPactado: true },
  });
  return envio?.precioPactado == null ? null : envio.precioPactado.toNumber();
}

// ── Operaciones ──────────────────────────────────────────────────────────────────────────────────

/** Alta de un cierre: campos del esquema compartido. */
export type EntradaCerrarOrdenMaquila = z.input<typeof esquemaCierreMaquilaCrear>;

/**
 * ⭐ CIERRA la orden con UN maquilero de UN proceso. En UNA transacción (A2): deriva el faltante por
 * suma directa bajo el lock de la orden (D3 — nunca la vista), lo SALDA en su cubeta y, si el
 * desenlace es `cobrado`, PROPONE el descuento (`capturado`: no cuenta al saldo hasta que alguien lo
 * revise). Emite el evento de dominio del cierre por outbox.
 *
 * Reglas:
 *  • solo órdenes de la EMPRESA ACTIVA (A9) y no canceladas;
 *  • si ese maquilero no le debe nada a la orden en ese proceso, **no hay nada que cerrar** (409):
 *    cerrar sin faltante crearía un acto vacío que después habría que explicar;
 *  • se puede cerrar VARIAS veces la misma orden+maquilero+proceso (si después del cierre se le
 *    envía más mercancía, ese nuevo saldo es un faltante nuevo). Cada cierre es su propio acto con
 *    su propio descuento;
 *  • al cobrar, el `conFactura` del descuento sale de la modalidad del proveedor (decisión (h)): si
 *    factura de las dos formas hay que indicarlo, y si no tiene modalidad definida el descuento NO
 *    se puede capturar (fila 0.110) — se dice y no se cierra, en vez de saldar sin poder cobrar.
 */
export async function cerrarOrdenMaquila(
  sesion: SesionUsuario,
  idOrden: number,
  entrada: EntradaCerrarOrdenMaquila,
  bd?: ContextoBd,
): Promise<CierreMaquilaSalida> {
  verificarPermiso(sesion, 'produccion.recibo');
  const datos = validarEntrada(esquemaCierreMaquilaCrear, entrada);

  const idCierre = await enTransaccion(async (tx) => {
    const orden = await tx.orden.findFirst({
      where: { id: idOrden, idEmpresa: sesion.idEmpresaActiva },
      select: { id: true, idEmpresa: true, folio: true, estado: true },
    });
    if (orden === null) {
      throw new ErrorNoEncontrado('Orden', idOrden);
    }
    if (orden.estado === 'cancelada') {
      throw new ErrorConflicto('Esa orden está cancelada: no hay saldo que cerrar.');
    }

    const proceso = await tx.tipoProceso.findUnique({
      where: { id: datos.idTipoProceso },
      select: { id: true, nombre: true },
    });
    if (proceso === null) {
      throw new ErrorNoEncontrado('TipoProceso', datos.idTipoProceso);
    }
    // ⚠️ A propósito NO se exige que el proceso siga ACTIVO ni que el proveedor conserve su rol de
    // maquila (lo que sí exige `registrarReciboMaquila`): cerrar es un acto de LIMPIEZA sobre un
    // saldo que ya existe. Bloquearlo porque el catálogo cambió después dejaría ese pendiente vivo
    // para siempre, que es justo lo que esta fila vino a impedir. La guarda real es más fuerte que
    // cualquiera de las dos: sin faltante derivado, no hay cierre.
    const maquilero = await tx.proveedor.findUnique({
      where: { id: datos.idMaquilero },
      select: { id: true, nombre: true, modalidadFacturacion: true },
    });
    if (maquilero === null) {
      throw new ErrorNoEncontrado('Proveedor', datos.idMaquilero);
    }

    // Serializa la orden con el corte/envío/recibo (MISMA fórmula de lock): el faltante es un saldo,
    // y un recibo entrando a la vez lo cambiaría bajo los pies del cierre.
    await bloquearEtapasDeOrden(tx, orden.idEmpresa, orden.id);

    const filtros = {
      idOrden: orden.id,
      idTipoProceso: datos.idTipoProceso,
      idMaquilero: datos.idMaquilero,
    };
    const celdas = await derivarFaltantes(tx, filtros);
    const piezasFaltantes = celdas.reduce((s, c) => s + c.cantidadFaltantes, 0);
    if (piezasFaltantes === 0) {
      throw new ErrorConflicto(
        `"${maquilero.nombre}" no tiene piezas pendientes de "${proceso.nombre}" en esta orden: ` +
          'no hay nada que cerrar.',
      );
    }

    const precio = datos.desenlace === 'cobrado' ? await precioDelEnvio(tx, filtros) : null;
    // El `conFactura` se resuelve ANTES de escribir nada: si el proveedor no tiene modalidad
    // definida (fila 0.110) el descuento no se puede capturar, y saldar el faltante sin poder
    // proponer el cobro sería dejar al maquilero sin deuda Y sin descuento.
    const conFactura =
      datos.desenlace === 'cobrado' && precio !== null
        ? resolverConFactura(maquilero.modalidadFacturacion, datos.conFactura)
        : null;

    const cierre = await tx.cierreMaquilaOrden.create({
      data: {
        idEmpresa: orden.idEmpresa,
        idOrden: orden.id,
        idMaquilero: datos.idMaquilero,
        idTipoProceso: datos.idTipoProceso,
        fecha: aDateColumna(datos.fecha),
        desenlace: datos.desenlace,
        ...(precio === null ? {} : { precioFaltante: precio }),
        ...(datos.motivo === undefined ? {} : { motivo: datos.motivo }),
        detalles: {
          create: celdas.map((c) => ({
            idColor: c.idColor,
            idTalla: c.idTalla,
            pack: c.pack,
            cantidadFaltantes: c.cantidadFaltantes,
            creadoPorId: sesion.id,
          })),
        },
        ...datosCreacion(sesion),
      },
      select: { id: true },
    });

    // EL COBRO PROPUESTO: un DESCUENTO `capturado` (no cuenta al saldo hasta que se revise).
    let idDescuento: number | null = null;
    if (datos.desenlace === 'cobrado' && precio !== null && conFactura !== null) {
      const descuento = await tx.descuentoMaquilero.create({
        data: {
          idEmpresa: orden.idEmpresa,
          idMaquilero: datos.idMaquilero,
          monto: piezasFaltantes * precio,
          fecha: aDateColumna(datos.fecha),
          conFactura,
          idCierreMaquila: cierre.id,
          // La referencia que pidió la fila: que la línea de tiempo diga de qué OP es y de qué es.
          observaciones:
            `Faltante de la orden #${String(Number(orden.folio))} · ${proceso.nombre}: ` +
            `${String(piezasFaltantes)} pza(s) que no se devolvieron.` +
            (datos.motivo === undefined ? '' : ` ${datos.motivo}`),
          ...datosCreacion(sesion),
        },
        select: { id: true },
      });
      idDescuento = descuento.id;
      await registrarBitacora(tx, sesion, {
        entidad: 'DescuentoMaquilero',
        idEntidad: descuento.id,
        accion: 'CREAR',
        datos: {
          origen: 'cierre-maquila',
          idCierre: cierre.id,
          idOrden: orden.id,
          idMaquilero: datos.idMaquilero,
          piezasFaltantes,
          precio,
          monto: piezasFaltantes * precio,
          conFactura,
        },
      });
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'CierreMaquilaOrden',
      idEntidad: cierre.id,
      accion: 'CREAR',
      datos: {
        idOrden: orden.id,
        folioOrden: Number(orden.folio),
        idMaquilero: datos.idMaquilero,
        idTipoProceso: datos.idTipoProceso,
        desenlace: datos.desenlace,
        piezasFaltantes,
        celdas: celdas.length,
        // A7: el precio y el descuento se anotan aunque no haya habido cobro — «se cobró 0 porque
        // el envío no traía precio» es exactamente el dato que alguien va a buscar después.
        precio,
        idDescuento,
        motivo: datos.motivo ?? null,
      },
    });

    // OUTBOX: el punto del que se colgará el CONGELADO DEL COSTO (fila 0.061) sin rediseñar nada.
    // Hoy nadie lo consume: el despachador del auto-avance ignora en silencio los tipos que no
    // conoce (`ruta-critica/autoAvance.ts`), así que el evento queda registrado y disponible.
    await registrarEventoOutbox(
      tx,
      EVENTOS_OUTBOX.cierreMaquilaResuelto,
      VERSION_CIERRE_MAQUILA,
      orden.idEmpresa,
      {
        idEmpresa: orden.idEmpresa,
        idOrden: orden.id,
        idMaquilero: datos.idMaquilero,
        idTipoProceso: datos.idTipoProceso,
        idCierre: cierre.id,
        deshecho: false,
      },
    );

    return cierre.id;
  }, bd);

  dispararPublicacion();
  return obtenerCierre(clienteLectura(bd), sesion, idCierre);
}

/**
 * DESHACE un cierre: el acto inverso auditado (D3 — el cierre NUNCA se edita ni se borra). Las
 * piezas vuelven al pendiente en el mismo instante, porque el pendiente se DERIVA de los cierres
 * vivos; y el descuento propuesto queda CANCELADO (suave, con su motivo).
 *
 * 🔴 SE RECHAZA si el descuento YA SE REVISÓ: ese dinero ya movió el saldo del maquilero, y sacarlo
 * de ahí no es deshacer un acto sino capturar el movimiento contrario en su estado de cuenta. Es la
 * misma línea que traza `cancelarReciboMaquila` con un cargo ya validado; la diferencia es que aquí
 * no hay permiso que la levante, porque el descuento revisado ya puede estar pagado.
 *
 * Permiso `produccion.cancelar` (A4), el mismo de cancelar corte/envío/recibo/entrega.
 */
export async function deshacerCierreMaquila(
  sesion: SesionUsuario,
  idCierre: number,
  cuerpo: z.input<typeof esquemaCierreMaquilaDeshacerCuerpo>,
  bd?: ContextoBd,
): Promise<CierreMaquilaSalida> {
  verificarPermiso(sesion, 'produccion.cancelar');
  const datos = validarEntrada(esquemaCierreMaquilaDeshacerCuerpo, cuerpo);

  await enTransaccion(async (tx) => {
    const cierre = await tx.cierreMaquilaOrden.findFirst({
      where: { id: idCierre, idEmpresa: sesion.idEmpresaActiva },
      select: {
        id: true,
        idOrden: true,
        idEmpresa: true,
        idMaquilero: true,
        idTipoProceso: true,
        deshechoEn: true,
        descuento: { select: { id: true, estadoRevision: true, canceladoEn: true } },
      },
    });
    if (cierre === null) {
      throw new ErrorNoEncontrado('CierreMaquilaOrden', idCierre);
    }
    if (cierre.deshechoEn !== null) {
      throw new ErrorConflicto('Ese cierre ya se deshizo.');
    }

    // Mismo lock que el cierre y el recibo: mientras se des-salda, nadie más mueve el saldo.
    await bloquearEtapasDeOrden(tx, cierre.idEmpresa, cierre.idOrden);

    const descuento = cierre.descuento;
    if (descuento !== null && descuento.canceladoEn === null) {
      if (descuento.estadoRevision === 'revisado') {
        throw new ErrorValidacion(
          'El descuento de este cierre YA se revisó: ese importe ya está en el saldo del maquilero ' +
            'y puede estar pagado. No se deshace desde aquí — captura el movimiento contrario en su ' +
            'estado de cuenta.',
        );
      }
      // ⭐⭐ CONDICIONAL, no un `update` por id (precedente F8-E3, `CLAUDE.md` §7.3). La lectura de
      // arriba da el MENSAJE; esta condición da la GARANTÍA: entre las dos cabe la transacción de
      // `revisarMovimiento`, que no toma el lock de la ORDEN (no sabe nada de órdenes) y por lo
      // tanto NO se serializa con este acto. Sin la condición, revisar podía commitear en medio y
      // este `update` cancelaba un descuento YA REVISADO — dinero que ya está en el saldo del
      // maquilero, desapareciendo sin que nada lo dijera. `count === 0` = llegó primero el otro.
      const canceladas = await tx.descuentoMaquilero.updateMany({
        where: { id: descuento.id, estadoRevision: 'capturado', canceladoEn: null },
        data: {
          canceladoEn: new Date(),
          canceladoPorId: sesion.id,
          motivoCancelacion: datos.motivo,
          ...datosModificacion(sesion),
        },
      });
      if (canceladas.count === 0) {
        throw new ErrorValidacion(
          'El descuento de este cierre cambió mientras se deshacía (lo revisaron o lo cancelaron ' +
            'en paralelo). Vuelve a consultar el cierre antes de decidir.',
        );
      }
      await registrarBitacora(tx, sesion, {
        entidad: 'DescuentoMaquilero',
        idEntidad: descuento.id,
        accion: 'CANCELAR',
        datos: { motivo: datos.motivo, idCierre, origen: 'deshacer-cierre-maquila' },
      });
    }

    await tx.cierreMaquilaOrden.update({
      where: { id: idCierre },
      data: {
        deshechoEn: new Date(),
        deshechoPorId: sesion.id,
        motivoDeshacer: datos.motivo,
        ...datosModificacion(sesion),
      },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'CierreMaquilaOrden',
      idEntidad: idCierre,
      accion: 'CANCELAR',
      datos: {
        accion: 'deshacer',
        motivo: datos.motivo,
        idOrden: cierre.idOrden,
        idMaquilero: cierre.idMaquilero,
        idDescuentoCancelado: descuento?.id ?? null,
      },
    });

    await registrarEventoOutbox(
      tx,
      EVENTOS_OUTBOX.cierreMaquilaResuelto,
      VERSION_CIERRE_MAQUILA,
      cierre.idEmpresa,
      {
        idEmpresa: cierre.idEmpresa,
        idOrden: cierre.idOrden,
        idMaquilero: cierre.idMaquilero,
        idTipoProceso: cierre.idTipoProceso,
        idCierre: cierre.id,
        deshecho: true,
      },
    );
  }, bd);

  dispararPublicacion();
  return obtenerCierre(clienteLectura(bd), sesion, idCierre);
}

/**
 * Los CIERRES de una orden (vivos primero, deshechos al final): lo que la pantalla de recepción
 * necesita para enseñar qué se cerró con quién y ofrecer el deshacer. Solo lectura
 * (`produccion.wip-ver`), con el precio REDACTADO para quien no puede verlo.
 */
export async function listarCierresDeOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<CierresMaquilaLista> {
  verificarPermiso(sesion, 'produccion.wip-ver');
  const cliente = clienteLectura(bd);

  const orden = await cliente.orden.findFirst({
    where: { id: idOrden, idEmpresa: sesion.idEmpresaActiva },
    select: { id: true, folio: true },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }

  const cierres = await cliente.cierreMaquilaOrden.findMany({
    where: { idOrden, idEmpresa: sesion.idEmpresaActiva },
    include: incluirCierre,
    orderBy: [{ id: 'desc' }],
  });
  const ocultarPrecio = !tienePermiso(sesion, 'ordenes.ver-precio-real-maquila');
  const filas = cierres
    .map((c) => aCierreSalida(c, ocultarPrecio))
    // Los vivos primero (son sobre los que se actúa); los deshechos quedan como historia.
    .sort((a, b) => Number(a.deshecho) - Number(b.deshecho));

  return { idOrden: orden.id, folioOrden: Number(orden.folio), filas };
}
