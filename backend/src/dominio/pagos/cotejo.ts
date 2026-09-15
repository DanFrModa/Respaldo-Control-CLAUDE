/**
 * ⭐⭐ EL COTEJO: LA FACTURA DEL PROVEEDOR CONTRA EL DOCUMENTO QUE NOSOTROS EMITIMOS (fila 0.117).
 *
 * Daniel revisaba a mano, factura por factura, si lo que le cobraba cada maquilero era lo que él le
 * había mandado a cobrar. El sistema tenía las dos mitades y no las unía: por un lado IMPORTA los
 * CFDI del proveedor (`terceros/cfdi/cfdi-proveedor.ts`), por el otro EMITE el documento con el que
 * ese proveedor tiene que facturar (`documento-facturacion.ts`). Esto es la unión.
 *
 * ## Las cuatro decisiones que lo gobiernan (§Post-F9.232, ya cerradas)
 *  (a) **Se coteja contra EL DOCUMENTO QUE FR MODA EMITE**, no contra los recibos sueltos. Es la
 *      consecuencia de §Post-F9.186(k): *«nadie me factura si no le mando yo un documento con los
 *      datos con los que me tiene que facturar… no al revés»*. No se comparan dos papeles nacidos
 *      por separado: se compara **el nuestro contra su copia**.
 *  (b) **UN PESO FIJO de tolerancia, sin porcentaje.** Vive en `cotejo-tolerancia.ts`, en un solo
 *      sitio, y de ahí lo pide todo el mundo.
 *  (c) **La que no cuadra ENTRA, marcada y en ROJO, y no se puede pagar hasta que alguien la
 *      ATIENDA.** No se rechaza: *«la factura existe aunque esté mal»*, y un sistema que la escupe
 *      la manda a un Excel aparte — que es de lo que este módulo viene a sacar al negocio.
 *  (d) **«Como venga»:** una factura puede cubrir varios documentos y varias facturas uno solo. Por
 *      eso la liga es una TABLA de aplicaciones (`CotejoFacturaDocumento`) y no un `refTipo/refId`,
 *      que sólo sabe apuntar a una cosa.
 *
 * ## A quién le toca cotejo, y a quién no
 * Sólo a la **factura de un PROVEEDOR** (`origen = factura_proveedor`) que **NO va ligada a una
 * operación de compra** (`refTipo IS NULL`). Ésa es la que nace contra un documento que nosotros
 * emitimos —maquila, servicios—. Una factura ligada a una OC se coteja contra la OC (eso ya existe,
 * `cfdi-proveedor.ts`), y un pago, un abono o una nota de crédito no se cotejan contra nada.
 *
 * ## Los innegociables que sostiene
 *  • **A1** — toda la regla está aquí; las rutas sólo delegan.
 *  • **A2** — aplicar es UNA transacción: se reemplazan las ligas y se recalcula el veredicto, o no
 *    pasa nada.
 *  • **A9** — todo se filtra por la empresa activa, de los dos lados (la factura y el documento).
 *  • **D3** — nada de columnas de saldo: lo aplicado se obtiene por SUMA DIRECTA bajo lock, igual
 *    que el kardex y que el saldo de EsMa. El veredicto se RECALCULA; «atendida» es un hecho
 *    auditado aparte, y por eso recalcular nunca lo borra.
 */
import {
  ESTADOS_COTEJO,
  esquemaAplicarCotejoEntrada,
  esquemaAtenderCotejoEntrada,
  esquemaBandejaCotejoQuery,
  type AplicacionCotejo,
  type BandejaCotejoSalida,
  type DocumentoEmitido,
  type DocumentosEmitidosSalida,
  type FacturaCotejo,
} from '../../contrato/index.js';
import type { PrismaClient } from '../../datos/index.js';
import type { z } from 'zod';

import { datosCreacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { nombreDeUsuario, nombresDeUsuarios } from '../../comun/nombres-usuario.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { cotejoCuadra, diferenciaDeCotejo, TOLERANCIA_COTEJO_PESOS } from './cotejo-tolerancia.js';
import { redondear2 } from './totales.js';

/**
 * Namespace del `pg_advisory_xact_lock` que serializa el cotejo de UNA empresa. Segunda clave =
 * `idEmpresa`. Familia 20_5xx; la corrida usa 20_551, ésta estrena el 20_552.
 *
 * Serializa lo que de verdad compite: dos personas aplicando facturas distintas AL MISMO documento.
 * Sin él, las dos leerían «disponible = 1000», las dos aplicarían 1000 y el documento acabaría
 * cubierto dos veces — el write-skew clásico que este proyecto ya pagó una vez (F8-E3).
 */
const NAMESPACE_LOCK_COTEJO = 20_552;

/**
 * ⭐ LOS TOPES DE LECTURA — y por qué se DICEN en vez de callarse (§Post-F9.87 punto 4: *«sin topes
 * silenciosos… si algo se recorta, se dice»*).
 *
 * Las dos consultas de esta pantalla leen mucho y hay que cortarlas por algún lado, pero un corte
 * callado miente dos veces: la bandeja ordena por fecha DESC y los documentos por folio DESC, así
 * que **lo que desaparece es lo VIEJO** — justo lo que una factura atrasada necesita cubrir. Por eso
 * cada salida trae su `hayMas`, y la pantalla lo dice.
 *
 * 🔑 Y el conteo de `enRojo` NO sale de la lista recortada: va por `count()` aparte (abajo). Contar
 * sobre lo recortado haría que con 600 facturas en rojo la pantalla afirmara «500» **como si fuera
 * el dato**, que es peor que no enseñar el número.
 */
const TOPE_BANDEJA = 500;
const TOPE_DOCUMENTOS = 300;

/**
 * Exige poder VER el cotejo. Pasa con `cxp.ver` **o** con `cxp.administrar`: quien liga y atiende
 * obviamente ve, y las dos mutaciones devuelven la bandeja de vuelta — sin esta puerta, un rol con
 * sólo `administrar` escribiría bien y recibiría un 403 **sobre su propia escritura**. Sigue siendo
 * deny-by-default (A4): sin ninguno de los dos, 403. Mismo criterio y mismo motivo que
 * `exigirVerCorrida` en `acceso-corrida.ts`.
 */
function exigirVerCotejo(sesion: SesionUsuario): void {
  if (tienePermiso(sesion, 'cxp.administrar')) {
    return;
  }
  verificarPermiso(sesion, 'cxp.ver');
}

/** Serializa el cotejo de la empresa dentro de la transacción. */
async function bloquearCotejo(tx: Tx, idEmpresa: number): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NAMESPACE_LOCK_COTEJO}::int, ${idEmpresa}::int)`;
}

// ── A quién le toca cotejo ──────────────────────────────────────────────────────────────────────

/** Lo mínimo de un movimiento para decidir si se coteja. */
export interface MovimientoParaCotejo {
  tipoTercero: 'cliente' | 'proveedor';
  origen: string;
  refTipo: string | null;
}

/**
 * ⭐ ¿Esta factura se coteja contra los documentos que emitimos? Es PURA y es el único sitio donde
 * se decide: si mañana cambia el criterio, cambia aquí y cambia para la importación, para la
 * bandeja y para el bloqueo del pago a la vez.
 */
export function sujetaACotejo(m: MovimientoParaCotejo): boolean {
  return m.tipoTercero === 'proveedor' && m.origen === 'factura_proveedor' && m.refTipo === null;
}

// ── El veredicto ────────────────────────────────────────────────────────────────────────────────

/**
 * ⭐ RECALCULA el veredicto de una factura y lo guarda. Devuelve el veredicto, o `null` si a esa
 * factura no le toca cotejo (en cuyo caso deja la columna en `NULL`, que es lo que significa).
 *
 * Lo aplicado se obtiene por **suma directa** de sus ligas (D3): no hay ninguna columna de «total
 * aplicado» que mantener sincronizada, porque una columna así se desincroniza el día que alguien
 * escriba una liga por otro camino.
 *
 * ⚠️ NO toca `cotejoAtendidoEn`/`PorId`/`Nota`. Recalcular es mecánico; atender es el acto de una
 * persona, y borrarlo al recalcular haría que corregir una liga deshiciera en silencio la decisión
 * de alguien. Debe correr dentro de la transacción que cambió las ligas (A2).
 *
 * 📌 **Un hueco conocido, dicho a propósito: una factura de UN PESO O MENOS sin ninguna liga nace
 * `cuadra`.** Su diferencia contra cero (su total) cabe dentro de la tolerancia, así que la regla de
 * §Post-F9.232 (b) —un peso fijo, sin porcentaje— la deja pasar. **No se le pone una excepción**: la
 * tolerancia vive en UN solo sitio y con UN solo criterio (`cotejo-tolerancia.ts`), y meterle aquí un
 * «salvo que no tenga ligas» sería la segunda regla escondida que un día contradice a la primera. El
 * daño real es nulo —una factura de maquila de un peso no existe— y la alternativa (preguntar si
 * tiene ligas antes de comparar) cambiaría el significado del veredicto para todos los casos por un
 * caso que no pasa. Si alguna vez importa, **se pregunta** antes de programarlo.
 */
export async function recalcularCotejo(tx: Tx, idMovimiento: number): Promise<string | null> {
  const movimiento = await tx.movimientoTercero.findUnique({
    where: { id: idMovimiento },
    select: {
      id: true,
      tipoTercero: true,
      origen: true,
      refTipo: true,
      monto: true,
      estadoCotejo: true,
    },
  });
  if (movimiento === null) {
    throw new ErrorNoEncontrado('MovimientoTercero', idMovimiento);
  }
  if (!sujetaACotejo(movimiento)) {
    // El `if` de más evita un UPDATE por CADA movimiento que nace en el sistema (pagos, abonos,
    // CxC…): para uno recién creado la columna ya está en NULL y no hay nada que limpiar. Sólo se
    // escribe cuando de verdad había un veredicto que retirar.
    if (movimiento.estadoCotejo !== null) {
      await tx.movimientoTercero.update({
        where: { id: idMovimiento },
        data: { estadoCotejo: null },
      });
    }
    return null;
  }

  const aplicado = await sumaAplicadaDeFactura(tx, idMovimiento);
  // El total de la factura es su monto SIN SIGNO: un cargo entra positivo, pero el cotejo compara
  // magnitudes con el documento, que siempre es positivo.
  const total = Math.abs(movimiento.monto.toNumber());
  const estado = cotejoCuadra(total, aplicado) ? 'cuadra' : 'descuadre';
  await tx.movimientoTercero.update({
    where: { id: idMovimiento },
    data: { estadoCotejo: estado },
  });
  return estado;
}

/**
 * ⭐⭐ LO QUE UNA LIGA DE FACTURA CANCELADA VALE: NADA (fila 0.117, corrección del reviewer).
 *
 * Cancelar y reexpedir un CFDI es rutina en México, y el maquilero es justo quien lo hace. Sin este
 * filtro el sistema se ataba un nudo del que no se podía salir POR LA APLICACIÓN: la factura A
 * cancelada dejaba sus ligas colgando del documento, el documento quedaba con `disponible = 0`, y
 * la factura B —la de reemplazo, correcta— **no se podía ligar a nada** ⇒ se quedaba en rojo para
 * siempre y frenaba la corrida de ese proveedor. Y desligar la A tampoco era salida: `aplicarCotejo`
 * rechaza tocar una factura cancelada («ya no cobra nada y no hay qué cotejar»). La única puerta que
 * quedaba era marcar como «descuadre atendido» una factura CORRECTA, que es exactamente mentirle al
 * sistema.
 *
 * 🔑 Y era además una INCOHERENCIA INTERNA: «la cancelada no cuenta» ya se aplicaba en
 * {@link facturasQueFrenanElPago} y en el `frenaElPago` de la bandeja. Éste era el tercer sitio que
 * hacía la misma pregunta y contestaba lo contrario.
 *
 * ⚠️ Las ligas **NO se borran** al cancelar: siguen ahí, visibles en la bandeja como rastro de lo
 * que aquella factura decía cubrir (D3 — lo guardado es inmutable; cancelar es un hecho nuevo, no un
 * borrado). Lo que cambia es que **dejan de ocupar sitio en el documento**.
 */
const LIGA_DE_FACTURA_VIVA = { movimiento: { cancelado: false } } as const;

/** Σ de lo que esta factura aplica a documentos (suma directa, D3). */
async function sumaAplicadaDeFactura(tx: Tx | PrismaClient, idMovimiento: number): Promise<number> {
  const agregado = await tx.cotejoFacturaDocumento.aggregate({
    where: { idMovimiento },
    _sum: { importe: true },
  });
  return redondear2(agregado._sum.importe?.toNumber() ?? 0);
}

/**
 * Σ de lo que TODAS las facturas VIVAS aplican a un documento (suma directa, D3).
 *
 * Las de las facturas canceladas no suman — ver {@link LIGA_DE_FACTURA_VIVA}: si contaran, cancelar
 * una factura dejaría su documento ocupado para siempre.
 */
async function sumaAplicadaAlDocumento(tx: Tx, idRenglon: number): Promise<number> {
  const agregado = await tx.cotejoFacturaDocumento.aggregate({
    where: { idRenglon, ...LIGA_DE_FACTURA_VIVA },
    _sum: { importe: true },
  });
  return redondear2(agregado._sum.importe?.toNumber() ?? 0);
}

// ── Lo que frena un pago ────────────────────────────────────────────────────────────────────────

/** Una factura que impide pagarle a su proveedor. */
export interface FacturaQueFrena {
  idProveedor: number;
  proveedor: string;
  folio: number;
  uuidCfdi: string | null;
}

/**
 * ⭐ Las facturas EN ROJO y SIN ATENDER de un puñado de proveedores (decisión (c)). Es lo que la
 * corrida usa para no ejecutar un pago a quien tiene una factura sin cuadrar.
 *
 * Las CANCELADAS no cuentan: una factura anulada por su inverso (D3) ya no cobra nada, y dejarla
 * frenando el pago sería castigar por un papel que el sistema mismo dio de baja.
 */
export async function facturasQueFrenanElPago(
  cliente: Tx | PrismaClient,
  idEmpresa: number,
  idsProveedor: readonly number[],
): Promise<FacturaQueFrena[]> {
  if (idsProveedor.length === 0) return [];
  const filas = await cliente.movimientoTercero.findMany({
    where: {
      idEmpresa,
      tipoTercero: 'proveedor',
      idProveedor: { in: [...new Set(idsProveedor)] },
      estadoCotejo: 'descuadre',
      cotejoAtendidoEn: null,
      cancelado: false,
    },
    select: {
      folio: true,
      uuidCfdi: true,
      idProveedor: true,
      proveedor: { select: { nombre: true } },
    },
    orderBy: { folio: 'asc' },
  });
  return filas.flatMap((f) =>
    f.idProveedor === null
      ? []
      : [
          {
            idProveedor: f.idProveedor,
            proveedor: f.proveedor?.nombre ?? `Proveedor ${String(f.idProveedor)}`,
            folio: Number(f.folio),
            uuidCfdi: f.uuidCfdi,
          },
        ],
  );
}

// ── Los documentos emitidos a un proveedor ──────────────────────────────────────────────────────

/**
 * ⭐ Los DOCUMENTOS que FR Moda le emitió a un proveedor, con lo que les falta por cubrir.
 *
 * Sólo los que tienen **folio propio** (`folioDocumento`): un renglón sin folio no es un documento
 * que nadie tenga en la mano, y ligarle una factura sería amarrarla a un papel que no existe. Eso
 * deja fuera, por construcción, las corridas cerradas antes de esta fila — REGLA 0-B: se toleran,
 * no se rellenan.
 *
 * `disponible` puede quedar en NEGATIVO si alguien aplicó de más por otro camino; se devuelve tal
 * cual en vez de recortarlo a cero, porque esconder un sobre-aplicado es exactamente el tipo de
 * número que después nadie entiende.
 */
export async function documentosEmitidosDeProveedor(
  sesion: SesionUsuario,
  idProveedor: number,
  bd?: ContextoBd,
): Promise<DocumentosEmitidosSalida> {
  exigirVerCotejo(sesion);
  const cliente = clienteLectura(bd);
  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');

  const renglones = await cliente.renglonCorridaPago.findMany({
    where: {
      idEmpresa: sesion.idEmpresaActiva,
      idProveedor,
      folioDocumento: { not: null },
    },
    select: {
      id: true,
      folioDocumento: true,
      monto: true,
      concepto: true,
      corrida: { select: { folio: true, semana: true } },
      // Sólo las ligas VIVAS: lo que ocupa el documento es lo que una factura sin cancelar dice
      // cubrir. Es el MISMO criterio con el que {@link sumaAplicadaAlDocumento} decide si cabe una
      // liga nueva — si la pantalla enseñara un «disponible» y la guarda calculara otro, quien
      // teclea vería un hueco que el servidor le rechaza (o al revés).
      cotejos: { where: LIGA_DE_FACTURA_VIVA, select: { importe: true } },
    },
    orderBy: { folioDocumento: 'desc' },
    // Uno de más: si viene, es que hay más de los que caben y la pantalla tiene que decirlo.
    take: TOPE_DOCUMENTOS + 1,
  });
  const hayMas = renglones.length > TOPE_DOCUMENTOS;
  const visibles = renglones.slice(0, TOPE_DOCUMENTOS);

  const oculto = (v: number): number | null => (puedeVerImportes ? redondear2(v) : null);
  const documentos: DocumentoEmitido[] = visibles.map((r) => {
    const total = r.monto.toNumber();
    const aplicado = r.cotejos.reduce((s, c) => s + c.importe.toNumber(), 0);
    return {
      idRenglon: r.id,
      // El `where` ya descartó los NULL; el `?? 0` sólo calla al compilador, que no lo sabe.
      folioDocumento: Number(r.folioDocumento ?? 0),
      folioCorrida: Number(r.corrida.folio),
      semana: r.corrida.semana.toISOString().slice(0, 10),
      concepto: r.concepto ?? '',
      total: oculto(total),
      aplicado: oculto(aplicado),
      disponible: oculto(total - aplicado),
    };
  });
  return { documentos, hayMas };
}

// ── La bandeja ──────────────────────────────────────────────────────────────────────────────────

/**
 * ⭐ LAS FACTURAS SUJETAS A COTEJO de la empresa activa, con su veredicto y sus ligas.
 *
 * `pendientes` (el default) trae **sólo las que frenan un pago**: en rojo y sin atender. Es la
 * pantalla de trabajo — lo que hay que resolver hoy. `todas` trae también las que cuadran y las ya
 * atendidas, para poder mirar hacia atrás.
 *
 * La `toleranciaPesos` viaja en la respuesta a propósito: la pantalla tiene que poder explicar
 * *«se aceptan diferencias de hasta $1»* sin escribir el número por su cuenta — que es como una
 * tolerancia acaba diciendo dos cosas distintas en dos sitios.
 */
export async function bandejaDeCotejo(
  sesion: SesionUsuario,
  entrada: z.input<typeof esquemaBandejaCotejoQuery>,
  bd?: ContextoBd,
): Promise<BandejaCotejoSalida> {
  exigirVerCotejo(sesion);
  const { filtro } = validarEntrada(esquemaBandejaCotejoQuery, entrada);
  const cliente = clienteLectura(bd);
  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');

  // Lo que de verdad frena un pago, como condición reutilizable: es la MISMA pregunta que contesta
  // `facturasQueFrenanElPago` al ejecutar, y por eso alimenta a la vez el filtro `pendientes` y el
  // conteo de `enRojo`. Si fueran dos redacciones, un día dirían cosas distintas.
  const enRojoWhere = {
    idEmpresa: sesion.idEmpresaActiva,
    estadoCotejo: 'descuadre',
    cotejoAtendidoEn: null,
    cancelado: false,
  } as const;

  const filas = await cliente.movimientoTercero.findMany({
    where:
      filtro === 'pendientes'
        ? enRojoWhere
        : {
            idEmpresa: sesion.idEmpresaActiva,
            estadoCotejo: { in: [...ESTADOS_COTEJO] },
          },
    select: {
      id: true,
      folio: true,
      fecha: true,
      monto: true,
      uuidCfdi: true,
      cancelado: true,
      estadoCotejo: true,
      cotejoAtendidoEn: true,
      cotejoAtendidoPorId: true,
      cotejoNota: true,
      idProveedor: true,
      proveedor: { select: { nombre: true } },
      cotejos: {
        select: {
          idRenglon: true,
          importe: true,
          renglon: {
            select: { folioDocumento: true, corrida: { select: { semana: true } } },
          },
        },
      },
    },
    orderBy: [{ fecha: 'desc' }, { folio: 'desc' }],
    // Uno de más para saber si se recortó (ver el TSDoc de TOPE_BANDEJA).
    take: TOPE_BANDEJA + 1,
  });
  const hayMas = filas.length > TOPE_BANDEJA;
  const visibles = filas.slice(0, TOPE_BANDEJA);

  // ⭐ El conteo va POR SU CUENTA, contra la base y sin tope: es el número que la pantalla enseña
  // como «cuántas frenan un pago», y contarlo sobre la lista recortada lo volvería una mentira
  // redonda en cuanto hubiera más de las que caben.
  const enRojo = await cliente.movimientoTercero.count({ where: enRojoWhere });

  const nombres = await nombresDeUsuarios(
    cliente,
    visibles.map((f) => f.cotejoAtendidoPorId),
  );
  const oculto = (v: number): number | null => (puedeVerImportes ? redondear2(v) : null);

  const facturas: FacturaCotejo[] = visibles.map((f) => {
    const total = Math.abs(f.monto.toNumber());
    // ⚠️ Lo aplicado por una factura CANCELADA es cero, no lo que decía cubrir: sus ligas ya no
    // ocupan nada en el documento (ver {@link LIGA_DE_FACTURA_VIVA}), así que enseñarlas como
    // «amparado» diría en esta pantalla lo contrario de lo que dice la de documentos. Las ligas
    // siguen listándose abajo, como rastro de lo que aquella factura decía (D3).
    const aplicado = f.cancelado ? 0 : f.cotejos.reduce((s, c) => s + c.importe.toNumber(), 0);
    const atendida = f.cotejoAtendidoEn !== null;
    // El `?? 'descuadre'` no se alcanza: el `where` sólo trae filas con veredicto. Existe para que
    // el hueco imposible caiga del lado seguro (marcado) en vez de romper el contrato.
    const estado = f.estadoCotejo ?? 'descuadre';
    const aplicaciones: AplicacionCotejo[] = f.cotejos.map((c) => ({
      idRenglon: c.idRenglon,
      folioDocumento: c.renglon.folioDocumento === null ? null : Number(c.renglon.folioDocumento),
      semana: c.renglon.corrida.semana.toISOString().slice(0, 10),
      importe: oculto(c.importe.toNumber()),
    }));
    return {
      idMovimiento: f.id,
      folio: Number(f.folio),
      fecha: f.fecha.toISOString().slice(0, 10),
      idProveedor: f.idProveedor ?? 0,
      proveedor: f.proveedor?.nombre ?? '—',
      uuidCfdi: f.uuidCfdi,
      total: oculto(total),
      aplicado: oculto(aplicado),
      diferencia: oculto(diferenciaDeCotejo(total, aplicado)),
      estado,
      atendida,
      atendidaEn: f.cotejoAtendidoEn?.toISOString() ?? null,
      atendidaPor: nombreDeUsuario(nombres, f.cotejoAtendidoPorId),
      nota: f.cotejoNota,
      cancelada: f.cancelado,
      // ⚠️ La CANCELADA no frena, aunque no cuadre: ya no cobra nada (su inverso la anuló, D3) y
      // `facturasQueFrenanElPago` —lo que de verdad muerde al ejecutar— también la excluye. Sin
      // esta condición, el filtro «todas» la pintaba en rojo y la corrida la dejaba pasar: dos
      // respuestas distintas a la misma pregunta.
      frenaElPago: estado === 'descuadre' && !atendida && !f.cancelado,
      aplicaciones,
    };
  });

  return {
    facturas,
    enRojo,
    hayMas,
    toleranciaPesos: TOLERANCIA_COTEJO_PESOS,
  };
}

// ── Aplicar ─────────────────────────────────────────────────────────────────────────────────────

/** La factura tal como la necesita `aplicarCotejo`, ya comprobada. */
async function exigirFacturaCotejable(
  tx: Tx,
  idEmpresa: number,
  idMovimiento: number,
): Promise<{ id: number; folio: bigint; idProveedor: number; monto: number }> {
  const movimiento = await tx.movimientoTercero.findFirst({
    where: { id: idMovimiento, idEmpresa },
    select: {
      id: true,
      folio: true,
      monto: true,
      cancelado: true,
      idProveedor: true,
      tipoTercero: true,
      origen: true,
      refTipo: true,
    },
  });
  if (movimiento === null) {
    throw new ErrorNoEncontrado('MovimientoTercero', idMovimiento);
  }
  if (!sujetaACotejo(movimiento) || movimiento.idProveedor === null) {
    throw new ErrorValidacion(
      'Este movimiento no se coteja contra documentos emitidos: sólo se cotejan las facturas de un ' +
        'proveedor que no van ligadas a una orden de compra.',
    );
  }
  if (movimiento.cancelado) {
    throw new ErrorConflicto(
      `La factura ${String(movimiento.folio)} está cancelada: ya no cobra nada y no hay qué cotejar.`,
    );
  }
  return {
    id: movimiento.id,
    folio: movimiento.folio,
    idProveedor: movimiento.idProveedor,
    monto: Math.abs(movimiento.monto.toNumber()),
  };
}

/**
 * ⭐ Dice QUÉ DOCUMENTOS cubre esta factura. La lista llega **completa y REEMPLAZA** a la anterior
 * (no es un «agregar»): mandarla vacía deja la factura sin ninguna liga, que es un estado legítimo
 * — y rojo.
 *
 * Las tres guardas que muerden aquí, y por qué:
 *  1. **El documento es de ESTE proveedor y de ESTA empresa** (A9). Ligar la factura de uno al
 *     documento de otro descuadraría los dos a la vez y nadie sabría cuál mirar.
 *  2. **Ninguna factura aplica más de su propio total.** Si lo hiciera, el cotejo diría «cuadra»
 *     por un documento que la factura no ampara.
 *  3. **Ningún documento recibe más de su monto**, contando lo que ya le aplicaron OTRAS facturas.
 *     Se mide por SUMA DIRECTA bajo el lock (D3), nunca contra una columna de saldo: dos personas
 *     aplicando a la vez al mismo documento es justo el caso que el lock existe para serializar.
 *
 * Reemplazar las ligas NO viola D3: una liga de cotejo es una anotación de trabajo, no un
 * movimiento de dinero (ningún peso cambia de sitio). Aun así, cada reemplazo deja su rastro en la
 * bitácora con el antes y el después (A7), que es lo que permite reconstruir quién dijo qué.
 */
export async function aplicarCotejo(
  sesion: SesionUsuario,
  idMovimiento: number,
  entrada: z.input<typeof esquemaAplicarCotejoEntrada>,
  bd?: ContextoBd,
): Promise<BandejaCotejoSalida> {
  verificarPermiso(sesion, 'cxp.administrar');
  const datos = validarEntrada(esquemaAplicarCotejoEntrada, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  const idsRepetidos = datos.aplicaciones.map((a) => a.idRenglon);
  if (new Set(idsRepetidos).size !== idsRepetidos.length) {
    throw new ErrorValidacion(
      'Un mismo documento no puede venir dos veces en la lista: suma los importes en un solo renglón.',
    );
  }

  await enTransaccion(async (tx) => {
    await bloquearCotejo(tx, idEmpresa);
    const factura = await exigirFacturaCotejable(tx, idEmpresa, idMovimiento);

    const totalPedido = redondear2(datos.aplicaciones.reduce((s, a) => s + a.importe, 0));
    if (totalPedido > redondear2(factura.monto)) {
      throw new ErrorValidacion(
        `No se pueden aplicar ${totalPedido.toFixed(2)} a documentos: la factura ` +
          `${String(factura.folio)} es de ${factura.monto.toFixed(2)}.`,
      );
    }

    const antes = await tx.cotejoFacturaDocumento.findMany({
      where: { idMovimiento },
      select: { idRenglon: true, importe: true },
    });

    // Se borran TODAS y se vuelven a escribir: la lista que llega es la verdad completa, y así no
    // hay que razonar sobre altas/bajas/cambios por separado (tres caminos, tres formas de fallar).
    await tx.cotejoFacturaDocumento.deleteMany({ where: { idMovimiento } });

    for (const aplicacion of datos.aplicaciones) {
      const documento = await tx.renglonCorridaPago.findFirst({
        where: { id: aplicacion.idRenglon, idEmpresa },
        select: { id: true, folioDocumento: true, monto: true, idProveedor: true },
      });
      if (documento === null) {
        throw new ErrorNoEncontrado('RenglonCorridaPago', aplicacion.idRenglon);
      }
      if (documento.folioDocumento === null) {
        throw new ErrorValidacion(
          'Ese renglón todavía no es un documento emitido (no tiene folio): sólo se puede cotejar ' +
            'contra documentos de una corrida ya cerrada.',
        );
      }
      if (documento.idProveedor !== factura.idProveedor) {
        throw new ErrorValidacion(
          `El documento ${String(documento.folioDocumento)} es de otro proveedor: una factura sólo ` +
            'puede cubrir documentos emitidos a quien la emite.',
        );
      }
      // Lo que YA le aplicaron otras facturas (las de ésta acaban de borrarse, así que no se cuentan
      // dos veces). Suma directa bajo el lock, nunca una columna de saldo (D3).
      const yaCubierto = await sumaAplicadaAlDocumento(tx, documento.id);
      const disponible = redondear2(documento.monto.toNumber() - yaCubierto);
      if (redondear2(aplicacion.importe) > disponible) {
        throw new ErrorConflicto(
          `No se pueden aplicar ${aplicacion.importe.toFixed(2)} al documento ` +
            `${String(documento.folioDocumento)}: sólo le quedan ${disponible.toFixed(2)} por cubrir.`,
        );
      }
      await tx.cotejoFacturaDocumento.create({
        data: {
          idMovimiento,
          idRenglon: documento.id,
          importe: aplicacion.importe,
          creadoPorId: datosCreacion(sesion).creadoPorId,
        },
      });
    }

    const estado = await recalcularCotejo(tx, idMovimiento);
    await registrarBitacora(tx, sesion, {
      entidad: 'MovimientoTercero',
      idEntidad: idMovimiento,
      accion: 'MODIFICAR',
      datos: {
        operacion: 'cotejo-aplicar',
        folio: Number(factura.folio),
        antes: antes.map((a) => ({ idRenglon: a.idRenglon, importe: a.importe.toNumber() })),
        despues: datos.aplicaciones,
        estado,
      },
    });
  }, bd);

  return bandejaDeCotejo(sesion, { filtro: 'todas' }, bd);
}

// ── Atender ─────────────────────────────────────────────────────────────────────────────────────

/**
 * ⭐ ATIENDE el descuadre: la factura sigue marcada, pero deja de frenar el pago (decisión (c),
 * *«se queda en rojo hasta que atiendan el problema»*).
 *
 * La NOTA es obligatoria: «atendida» sin explicación no le dice nada a quien lo lea el mes que
 * viene, y el punto de esta fila es justamente que la diferencia quede contada por alguien.
 *
 * Se atiende UNA sola vez. Si después cambian las ligas y la factura acaba cuadrando, el veredicto
 * se recalcula solo y el rojo desaparece por su cuenta; lo atendido se queda escrito como lo que
 * es: el registro de que una persona se hizo cargo (D3/A7).
 */
export async function atenderCotejo(
  sesion: SesionUsuario,
  idMovimiento: number,
  entrada: z.input<typeof esquemaAtenderCotejoEntrada>,
  bd?: ContextoBd,
): Promise<BandejaCotejoSalida> {
  verificarPermiso(sesion, 'cxp.administrar');
  const datos = validarEntrada(esquemaAtenderCotejoEntrada, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  await enTransaccion(async (tx) => {
    await bloquearCotejo(tx, idEmpresa);
    const factura = await tx.movimientoTercero.findFirst({
      where: { id: idMovimiento, idEmpresa },
      select: {
        id: true,
        folio: true,
        estadoCotejo: true,
        cotejoAtendidoEn: true,
      },
    });
    if (factura === null) {
      throw new ErrorNoEncontrado('MovimientoTercero', idMovimiento);
    }
    if (factura.estadoCotejo !== 'descuadre') {
      throw new ErrorValidacion(
        `La factura ${String(factura.folio)} no está en rojo: no hay nada que atender.`,
      );
    }
    if (factura.cotejoAtendidoEn !== null) {
      throw new ErrorConflicto(`La factura ${String(factura.folio)} ya estaba atendida.`);
    }
    await tx.movimientoTercero.update({
      where: { id: idMovimiento },
      data: {
        cotejoAtendidoEn: new Date(),
        cotejoAtendidoPorId: sesion.id,
        cotejoNota: datos.nota,
      },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'MovimientoTercero',
      idEntidad: idMovimiento,
      accion: 'MODIFICAR',
      datos: { operacion: 'cotejo-atender', folio: Number(factura.folio), nota: datos.nota },
    });
  }, bd);

  return bandejaDeCotejo(sesion, { filtro: 'todas' }, bd);
}
