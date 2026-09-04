/**
 * ⭐ LA CORRIDA SEMANAL DE PAGOS (fila 0.113) — §Post-F9.185 y §Post-F9.189.
 *
 * Daniel: *«Es una de las pantallas más importantes dentro del sistema. Debe estar muy bien hecha.»*
 *
 * ## Qué sustituye
 * Cada semana producción le pasa un Excel de maquilas; él revisa recibo por recibo, DECIDE A MANO
 * cuánto se le paga a cada quien, arma OTRO Excel —una relación CON factura y otra SIN— y se lo
 * manda a finanzas. *«Quiero automatizar todo ese proceso y quitar por completo todos los reportes
 * de Excel.»* Y sobre cuál es el entregable: *«Ni siquiera necesito el Excel. Eso puede vivir en la
 * pantalla y de ahí ir llenando la información de pagos … la idea es trabajarlo ahí mismo.»*
 *
 * ## El ciclo, y qué significa cada paso
 *  • **borrador** — se trabaja: se teclean montos, se eligen formas de pago y cuentas, se agregan
 *    conceptos. Nada de esto ha tocado ninguna cuenta corriente todavía.
 *  • **cerrada** — la relación quedó FINAL y se le manda a finanzas. Ya no se edita (D3): si algo
 *    salió mal, se hace OTRA corrida. Aquí es donde muerde la **guarda fiscal**.
 *  • **ejecutada** — el dinero salió. Cada renglón con monto nace como movimiento real: un
 *    `PagoMaquilero` a cuenta si es maquilero, un `MovimientoTercero` origen `pago` si es proveedor
 *    de estado de cuenta, y nada si es un concepto del catálogo (un concepto no tiene cuenta
 *    corriente: la corrida ES su registro).
 *
 * ## Los cuatro innegociables que este archivo sostiene
 *  • **A1** — toda la regla vive aquí; las rutas sólo delegan.
 *  • **A2** — cerrar y ejecutar son UNA transacción: o nacen todos los movimientos o ninguno.
 *  • **A3** — el folio sale de `siguienteFolio` (secuencia atómica), NUNCA de `Max()+1`.
 *  • **D3** — lo cerrado no se edita ni se borra. Un renglón ejecutado apunta a su movimiento y no
 *    puede volver a pagar (lo repite un CHECK en la base).
 *
 * ## Y lo que NO hace, dicho a propósito
 * NO deriva el monto de los recibos ni del saldo (§Post-F9.189(b): *«yo voy decidiendo los montos a
 * pagar de cada uno. Manualmente»*). El saldo, lo pendiente de revisión, el vencido y lo recibido
 * en la semana viajan **al lado** del campo, como referencia — nunca lo llenan.
 */
import {
  esquemaCorridaCrear,
  esquemaCorridasQuery,
  esquemaRenglonCorridaGuardar,
  ORDEN_RUBROS_PAGO,
  type ConcentradoSalida,
  type CorridaDetalleSalida,
  type CorridasLista,
  type CorridaSalida,
  type FilaCorridaSalida,
  type FormaDePagoClave,
  type OrigenRenglonPagoClave,
  type RenglonCorridaSalida,
  type RubroPagoClave,
} from '../../contrato/index.js';
import type { Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { siguienteFolio } from '../../comun/secuencias.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { tieneSaldo } from '../esma/formula-saldo.js';
import { crearPagoACuentaMaquilero } from '../esma/pagos.js';
import { carteraCombinadaPorProveedor, type FilaNeta } from '../terceros/cxp/cxp.js';
import { leerLimitesAging } from '../terceros/config-aging.js';
import { registrarMovimientoCxp } from '../terceros/cxp/cxp.js';

import {
  conceptosParaPago,
  formaPagoSugerida,
  proveedoresParaPago,
  proyectarCuentaDestino,
  recibosDeLaSemanaPorMaquilero,
  ultimos4,
  type ConceptoParaPago,
  type CuentaElegible,
  type ProveedorParaPago,
} from './beneficiarios.js';
import {
  exigirCorrida,
  exigirVerCorrida,
  incluirRenglones,
  type CorridaConRenglones,
  type RenglonFila,
} from './acceso-corrida.js';
import { facturabilidadDeRenglones, SIN_FACTURACION } from './documento-facturacion.js';
import { aDateColumna, aFechaIso, lunesDeLaSemana, rangoDeLaSemana } from './semana.js';
import { redondear2, tieneMonto, totalesDe } from './totales.js';

/** Clave de la secuencia del folio (A3). Una clave por transacción. */
const CLAVE_FOLIO_CORRIDA = 'corrida-pago';

/**
 * Namespace del `pg_advisory_xact_lock` que serializa las corridas de UNA empresa. Segunda clave =
 * `idEmpresa`. Familia 20_5xx; el proveedor usa 20_549, el concepto 20_550, ésta estrena el 20_551.
 *
 * Sirve para dos cosas que compiten de verdad: que no nazcan DOS BORRADORES de la misma semana y
 * segmento, y que dos personas no cierren o ejecuten la misma corrida a la vez (lo segundo también
 * lo atrapa la comprobación de estado dentro de la transacción; el lock evita el 409 confuso).
 */
const NAMESPACE_LOCK_CORRIDA = 20_551;

/** Serializa las corridas de la empresa dentro de la transacción. */
async function bloquearCorridas(tx: Tx, idEmpresa: number): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NAMESPACE_LOCK_CORRIDA}::int, ${idEmpresa}::int)`;
}

/** Proyecta un renglón al contrato (oculta importes si no se pueden ver). */
function proyectarRenglon(r: RenglonFila, puedeVerImportes: boolean): RenglonCorridaSalida {
  return {
    id: r.id,
    origen: r.origen,
    idProveedor: r.idProveedor,
    idConcepto: r.idConcepto,
    rubro: r.rubro,
    nombre: r.nombre,
    monto: puedeVerImportes ? r.monto.toNumber() : null,
    formaPago: r.formaPago,
    idCuenta: r.idCuentaProveedor ?? r.idCuentaConcepto,
    beneficiario: r.beneficiario,
    banco: r.banco,
    tipoCuenta: r.tipoCuenta,
    // ⚠️ El número COMPLETO no viaja a la pantalla de trabajo: sólo los últimos 4, que es lo único
    // que hace falta para distinguir dos cuentas del mismo beneficiario. Entero va sólo en la
    // relación ejecutable, que es donde sirve para transferir.
    ultimos4: r.numeroCuenta === null ? null : ultimos4(r.numeroCuenta),
    aliasCuenta: r.aliasCuenta,
    cuentaEsFiscal: r.cuentaEsFiscal,
    concepto: r.concepto,
    referencia: r.referencia,
    idPagoMaquilero: r.idPagoMaquilero,
    idMovimientoTercero: r.idMovimientoTercero,
  };
}

/** Los renglones, listos para sumar (el monto en número, aunque se oculte a la salida). */
function sumables(
  renglones: readonly RenglonFila[],
): { monto: number; formaPago: FormaDePagoClave }[] {
  return renglones.map((r) => ({ monto: r.monto.toNumber(), formaPago: r.formaPago }));
}

/** Proyecta el encabezado de una corrida con sus totales. */
function proyectarCorrida(c: CorridaConRenglones, puedeVerImportes: boolean): CorridaSalida {
  return {
    id: c.id,
    folio: Number(c.folio),
    semana: aFechaIso(c.semana),
    conFactura: c.conFactura,
    estado: c.estado,
    notas: c.notas,
    cerradaEn: c.cerradaEn === null ? null : c.cerradaEn.toISOString(),
    ejecutadaEn: c.ejecutadaEn === null ? null : c.ejecutadaEn.toISOString(),
    totales: totalesDe(sumables(c.renglones), puedeVerImportes),
  };
}

// ── Alta y lista ────────────────────────────────────────────────────────────────────────────────

/**
 * Abre una corrida de la semana, con su folio (A3) y **los conceptos predeterminados ya cargados en
 * cero**.
 *
 * Eso último es literal de Daniel (§Post-F9.189(c)): *«algunos de ellos quiero que se carguen por
 * default en la relación, porque son conceptos que cada semana pago y no quiero que se me vaya a
 * olvidar ponerlo (caja chica, nómina por fuera, etc.) … para que siempre se carguen EN CERO para
 * que yo le ponga la cantidad»*.
 *
 * ⚠️ **Un solo BORRADOR por semana y segmento**, bajo lock. No es una restricción de la base a
 * propósito (ver el comentario de la migración): una corrida cerrada se corrige haciendo otra, y
 * prohibirlo en la base lo dejaría sin marcha atrás. Lo que no puede pasar es tener dos borradores
 * abiertos de lo mismo, porque la relación se partiría en dos y una mitad no se pagaría.
 */
export async function crearCorrida(
  sesion: SesionUsuario,
  entrada: z.input<typeof esquemaCorridaCrear>,
  bd?: ContextoBd,
): Promise<CorridaDetalleSalida> {
  verificarPermiso(sesion, 'pagos.corrida-armar');
  const datos = validarEntrada(esquemaCorridaCrear, entrada);
  const semana = lunesDeLaSemana(datos.semana);
  const idEmpresa = sesion.idEmpresaActiva;

  const id = await enTransaccion(async (tx) => {
    await bloquearCorridas(tx, idEmpresa);

    const borradorAbierto = await tx.corridaPago.findFirst({
      where: {
        idEmpresa,
        semana: aDateColumna(semana),
        conFactura: datos.conFactura,
        estado: 'borrador',
      },
      select: { id: true, folio: true },
    });
    if (borradorAbierto !== null) {
      throw new ErrorConflicto(
        `Ya hay una corrida ${datos.conFactura ? 'CON' : 'SIN'} factura abierta para la semana ` +
          `del ${semana} (folio ${String(borradorAbierto.folio)}). Trabájala o ciérrala antes de ` +
          'abrir otra.',
      );
    }

    const folio = await siguienteFolio(tx, idEmpresa, CLAVE_FOLIO_CORRIDA);
    const corrida = await tx.corridaPago.create({
      data: {
        idEmpresa,
        folio,
        semana: aDateColumna(semana),
        conFactura: datos.conFactura,
        estado: 'borrador',
        ...(datos.notas === undefined ? {} : { notas: datos.notas }),
        ...datosCreacion(sesion),
      },
    });

    // ⭐ Los predeterminados, en cero. Se congelan igual que cualquier renglón (nombre, rubro y
    // datos del depósito): si mañana se renombra "Caja chica", la relación de esta semana sigue
    // diciendo lo que decía.
    const predeterminados = await conceptosParaPago(tx, { soloPredeterminados: true });
    for (const concepto of predeterminados.values()) {
      const cuenta = cuentaPorOmision(concepto.cuentas);
      const forma = formaPagoSugerida(concepto.formaPagoPreferida, concepto.cuentas.length > 0);
      // Un predeterminado que sugiere transferencia pero no tiene cuenta viva nace en EFECTIVO: es
      // la única combinación que la base admite sin cuenta, y es además la verdad (sin cuenta no se
      // puede transferir). Daniel lo cambia en el renglón si hace falta.
      const efectivo = forma === 'efectivo' || cuenta === null;
      await tx.renglonCorridaPago.create({
        data: {
          idCorrida: corrida.id,
          origen: 'concepto',
          idConcepto: concepto.id,
          rubro: concepto.rubro,
          nombre: concepto.nombre,
          monto: 0,
          formaPago: efectivo ? 'efectivo' : 'transferencia',
          ...congelarDestino(efectivo ? null : cuenta, concepto.nombre),
          ...datosCreacion(sesion),
        },
      });
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'CorridaPago',
      idEntidad: corrida.id,
      accion: 'CREAR',
      datos: {
        folio: Number(folio),
        semana,
        conFactura: datos.conFactura,
        predeterminadosCargados: predeterminados.size,
      },
    });
    return corrida.id;
  }, bd);

  return obtenerCorridaDetalle(sesion, id, bd);
}

/** La cuenta por omisión de una lista ya ordenada (la default primero), o `null` si no hay ninguna. */
function cuentaPorOmision(cuentas: readonly CuentaElegible[]): CuentaElegible | null {
  return cuentas.find((c) => c.esDefault) ?? cuentas[0] ?? null;
}

/**
 * ⭐ CONGELA los datos del depósito en el renglón (ver el TSDoc del modelo `RenglonCorridaPago`).
 *
 * Con cuenta: se copian beneficiario, banco, tipo, número y alias, y si era FISCAL. Sin cuenta
 * (efectivo): el beneficiario es el propio proveedor/concepto — §Post-F9.189(c), *«sin cuenta ⇒
 * efectivo y el beneficiario es el proveedor mismo»*.
 *
 * Si no se copiaran, editar o retirar una cuenta cambiaría lo que dice una corrida ya cerrada, y la
 * promesa es la contraria: reimprimir el martes da lo mismo que el lunes.
 */
function congelarDestino(
  cuenta: CuentaElegible | null,
  nombreDelBeneficiario: string,
): {
  idCuentaProveedor?: number;
  idCuentaConcepto?: number;
  beneficiario: string;
  banco: string | null;
  tipoCuenta: 'clabe' | 'tarjeta' | null;
  numeroCuenta: string | null;
  aliasCuenta: string | null;
  cuentaEsFiscal: boolean | null;
} {
  if (cuenta === null) {
    return {
      beneficiario: nombreDelBeneficiario,
      banco: null,
      tipoCuenta: null,
      numeroCuenta: null,
      aliasCuenta: null,
      cuentaEsFiscal: null,
    };
  }
  return {
    beneficiario: cuenta.beneficiario,
    banco: cuenta.banco,
    tipoCuenta: cuenta.tipoCuenta,
    numeroCuenta: cuenta.cuenta,
    aliasCuenta: cuenta.alias,
    cuentaEsFiscal: cuenta.esFiscal,
  };
}

/** Lista las corridas (paginación del SERVIDOR). Permiso `pagos.corrida-ver`. */
export async function listarCorridas(
  sesion: SesionUsuario,
  parametros: z.input<typeof esquemaCorridasQuery> = {},
  bd?: ContextoBd,
): Promise<CorridasLista> {
  exigirVerCorrida(sesion);
  const filtros = validarEntrada(esquemaCorridasQuery, parametros);
  const cliente = clienteLectura(bd);
  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');

  const where: Prisma.CorridaPagoWhereInput = {
    idEmpresa: sesion.idEmpresaActiva,
    // Filtra la PROPIA tabla `corrida_pago`, no los movimientos de EsMa: su `con_factura` es NOT
    // NULL (una corrida es de un segmento o del otro; no existe la «sin definir»), así que aquí
    // `= false` sí es la mitad exacta y no hay NULLs que incluir. La guardia lo sabe por el
    // marcador de la línea; el resto del archivo sigue vigilado.
    ...(filtros.conFactura === undefined ? {} : { conFactura: filtros.conFactura === 'con' }), // segmento: no particiona — `corrida_pago.con_factura` es NOT NULL: `= false` es la mitad exacta
    ...(filtros.estado === undefined ? {} : { estado: filtros.estado }),
  };

  const [total, filas] = await Promise.all([
    cliente.corridaPago.count({ where }),
    cliente.corridaPago.findMany({
      where,
      orderBy: [{ semana: 'desc' }, { folio: 'desc' }],
      skip: (filtros.pagina - 1) * filtros.porPagina,
      take: filtros.porPagina,
      include: incluirRenglones,
    }),
  ]);

  return {
    filas: filas.map((c) => proyectarCorrida(c, puedeVerImportes)),
    total,
    pagina: filtros.pagina,
    porPagina: filtros.porPagina,
    totalPaginas: Math.max(1, Math.ceil(total / filtros.porPagina)),
  };
}

// ── La pantalla de trabajo ──────────────────────────────────────────────────────────────────────

/**
 * ⭐ LA PANTALLA DE TRABAJO: la corrida con sus SECCIONES por rubro, cada fila con su referencia al
 * lado y sus renglones capturados.
 *
 * Es la pantalla que Daniel dibujó (§Post-F9.189(f)): *«en la pantalla donde están los saldos de
 * todos los proveedores con un campo abierto a un lado para capturar lo que se le va a pagar esa
 * semana. Y en esa misma pantalla cargar por default estos conceptos que te comento, también con el
 * campo a un lado. Y tener la posibilidad de cargar el concepto que necesito del catálogo.»*
 *
 * El universo de proveedores **no se calcula aquí**: se lo pide a `carteraCombinadaPorProveedor`
 * —el mismo agregado que alimenta la bandeja de CxP—, segmentado por el `conFactura` de la corrida.
 * Si tuviera su propia versión, un proveedor podría salir en la bandeja y no en la corrida, y el que
 * no sale en la corrida no cobra.
 *
 * ⭐ **QUÉ FILAS APARECEN: TODA la cartera del segmento, sin recortar.** No se aplica el corte
 * «saldo ≠ 0 o pendiente» que usan el tablero de EsMa y la bandeja de CxP, y es a propósito:
 *
 *  • **en la corrida no hay «agregar proveedor»** — sólo se puede pagar a quien la pantalla enseña,
 *    así que un corte que esconda a alguien lo deja SIN COBRAR, y eso no tiene arreglo desde aquí;
 *  • enseñar de más sólo cuesta una fila con saldo cero; enseñar de menos cuesta un pago perdido.
 *
 * Lo que sí se hace es **ordenar**: primero los que tienen saldo o algo esperando revisión (que es
 * donde está la decisión), después el resto; dentro de cada bloque, por nombre. Así la fila que
 * importa está arriba sin que nadie desaparezca.
 *
 * A eso se suman las de cualquier renglón ya capturado —aunque su saldo haya quedado en cero: si ya
 * se tecleó un monto, esa fila no se puede evaporar— y los conceptos predeterminados del catálogo.
 *
 * ⚠️ El TSDoc de esta función decía lo contrario (que aplicaba el corte) mientras el código traía
 * todo. Lo corrigió la ronda de revisión de 0.113: manda el código, y la decisión es la de arriba.
 *
 * Permiso `pagos.corrida-ver` (armarla pide el otro). Importes ocultos sin `consultas.ver-importes`.
 */
export async function obtenerCorridaDetalle(
  sesion: SesionUsuario,
  idCorrida: number,
  bd?: ContextoBd,
): Promise<CorridaDetalleSalida> {
  exigirVerCorrida(sesion);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;
  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');

  const corrida = await exigirCorrida(cliente, idEmpresa, idCorrida);
  const semana = aFechaIso(corrida.semana);
  const segmento = corrida.conFactura ? ('con' as const) : ('sin' as const);

  // El universo de proveedores del segmento (el MISMO agregado de la bandeja de CxP).
  const limites = await leerLimitesAging(cliente, idEmpresa);
  const cartera = await carteraCombinadaPorProveedor(cliente, idEmpresa, limites, segmento);

  // Proveedores que hay que traer: los de la cartera + los que ya tienen renglón (aunque su saldo
  // se haya quedado en cero: lo capturado no se esconde).
  const idsProveedor = new Set<number>(cartera.map((f) => f.idProveedor));
  const idsConcepto = new Set<number>();
  for (const r of corrida.renglones) {
    if (r.idProveedor !== null) idsProveedor.add(r.idProveedor);
    if (r.idConcepto !== null) idsConcepto.add(r.idConcepto);
  }
  // Los predeterminados siempre están a la vista, aunque alguien haya borrado su renglón.
  const predeterminados = await conceptosParaPago(cliente, { soloPredeterminados: true });
  for (const id of predeterminados.keys()) idsConcepto.add(id);

  const [proveedores, conceptos, recibos] = await Promise.all([
    proveedoresParaPago(cliente, [...idsProveedor]),
    conceptosParaPago(cliente, { ids: [...idsConcepto] }),
    recibosDeLaSemanaPorMaquilero(cliente, idEmpresa, ...rangoSemanaArgs(semana)),
  ]);

  const carteraPorId = new Map<number, FilaNeta>(cartera.map((f) => [f.idProveedor, f]));
  const renglonesPorProveedor = agrupar(corrida.renglones, (r) => r.idProveedor);
  const renglonesPorConcepto = agrupar(corrida.renglones, (r) => r.idConcepto);

  const filas: FilaCorridaSalida[] = [];

  for (const id of idsProveedor) {
    const proveedor = proveedores.get(id);
    if (proveedor === undefined) {
      continue; // Proveedor borrado: sin nombre no se puede etiquetar la fila.
    }
    const neta = carteraPorId.get(id);
    const propios = renglonesPorProveedor.get(id) ?? [];
    const recibido = recibos.get(id);
    const esMaquila = proveedor.rubro === 'maquila';
    const cuentaDefault = cuentaPorOmision(proveedor.cuentas);
    const oculto = (v: number): number | null => (puedeVerImportes ? v : null);

    filas.push({
      origen: esMaquila ? 'maquila' : 'proveedor',
      idProveedor: id,
      idConcepto: null,
      rubro: proveedor.rubro,
      nombre: proveedor.nombre,
      nombreCorto: proveedor.nombreCorto,
      formaPagoSugerida: formaPagoSugerida(
        proveedor.formaPagoPreferida,
        proveedor.cuentas.length > 0,
      ),
      idCuentaSugerida: cuentaDefault?.id ?? null,
      cuentas: proveedor.cuentas.map(proyectarCuentaDestino),
      puedeConFactura: proveedor.cuentas.some((c) => c.esFiscal),
      saldo: neta === undefined ? oculto(0) : oculto(neta.saldo),
      // El «vencido» es sólo de CxP: son las cubetas del aging del motor. La maquila no tiene
      // antigüedad por ítem (los cargos EsMa no traen fecha de vencimiento), así que en la sección
      // de maquileros va en null en vez de en un cero que parecería «no debe nada vencido».
      vencido:
        esMaquila || neta === undefined
          ? null
          : oculto(redondear2(neta.d1a30 + neta.d31a60 + neta.mas60)),
      // El «por revisar» viene ENTERO del mismo agregado que la bandeja de CxP: desde la fila 0.111
      // incluye los RECIBOS SIN VALIDAR del maquilero (cargos `propuesto`) además de sus abonos,
      // pagos y descuentos capturados. Aquí no se filtra ni se recalcula nada — si se recalculara,
      // la corrida y la bandeja podrían decir cosas distintas del mismo maquilero.
      porRevisarNeto: esMaquila && neta !== undefined ? oculto(neta.maquilaPorRevisar.neto) : null,
      porRevisarPartidas: esMaquila && neta !== undefined ? neta.maquilaPorRevisar.partidas : 0,
      recibosSemanaImporte:
        esMaquila && recibido !== undefined
          ? oculto(recibido.importe)
          : esMaquila
            ? oculto(0)
            : null,
      recibosSemanaCantidad: esMaquila ? (recibido?.cantidad ?? 0) : 0,
      renglones: propios.map((r) => proyectarRenglon(r, puedeVerImportes)),
      totalCapturado: puedeVerImportes
        ? redondear2(propios.reduce((s, r) => s + r.monto.toNumber(), 0))
        : null,
    });
  }

  for (const id of idsConcepto) {
    const concepto = conceptos.get(id);
    if (concepto === undefined) continue;
    const propios = renglonesPorConcepto.get(id) ?? [];
    // Un concepto RETIRADO que ya no tiene renglón no se ofrece más (se retiró por algo); si tiene
    // renglón, sigue a la vista: lo capturado no se esconde.
    if (!concepto.activo && propios.length === 0) continue;
    const cuentaDefault = cuentaPorOmision(concepto.cuentas);

    filas.push({
      origen: 'concepto',
      idProveedor: null,
      idConcepto: id,
      rubro: concepto.rubro,
      nombre: concepto.nombre,
      nombreCorto: null,
      formaPagoSugerida: formaPagoSugerida(
        concepto.formaPagoPreferida,
        concepto.cuentas.length > 0,
      ),
      idCuentaSugerida: cuentaDefault?.id ?? null,
      cuentas: concepto.cuentas.map(proyectarCuentaDestino),
      puedeConFactura: concepto.cuentas.some((c) => c.esFiscal),
      // Un concepto no tiene cuenta corriente: nace en cero y no hay nada que enseñar al lado.
      saldo: null,
      vencido: null,
      porRevisarNeto: null,
      porRevisarPartidas: 0,
      recibosSemanaImporte: null,
      recibosSemanaCantidad: 0,
      renglones: propios.map((r) => proyectarRenglon(r, puedeVerImportes)),
      totalCapturado: puedeVerImportes
        ? redondear2(propios.reduce((s, r) => s + r.monto.toNumber(), 0))
        : null,
    });
  }

  // Secciones en el orden del Excel de Daniel (maquilas primero). Dentro de cada una: primero lo
  // que pide una decisión —saldo ≠ 0, algo esperando revisión, o un renglón ya capturado— y luego
  // el resto; a igualdad, por nombre. La lista trae TODA la cartera (ver el TSDoc), así que el
  // orden es lo que evita que la fila que importa quede sepultada entre las que están en ceros.
  const secciones = ORDEN_RUBROS_PAGO.map((rubro) => {
    const propias = filas
      .filter((f) => f.rubro === rubro)
      .sort(
        (a, b) =>
          Number(pideDecision(b)) - Number(pideDecision(a)) ||
          a.nombre.localeCompare(b.nombre, 'es'),
      );
    return {
      rubro,
      filas: propias,
      totales: totalesDe(
        propias.flatMap((f) => renglonesSumablesDeFila(f, corrida.renglones)),
        puedeVerImportes,
      ),
    };
  }).filter((s) => s.filas.length > 0);

  return {
    corrida: proyectarCorrida(corrida, puedeVerImportes),
    secciones,
    bloqueos: bloqueosDeCierre(corrida),
  };
}

/**
 * ¿Esta fila pide una decisión? Es el criterio de ORDEN de la pantalla (no de corte: no se esconde
 * a nadie). Pide decisión quien debe algo, quien tiene partidas esperando revisión —§Post-F9.188a,
 * el maquilero con todo sin revisar— o quien ya tiene un renglón capturado.
 *
 * El «¿debe algo?» se le pide a `tieneSaldo` (`formula-saldo.ts`), que es donde vive el medio
 * centavo de tolerancia y el criterio que usan el tablero de EsMa y la bandeja de CxP. Estuvo
 * escrito a mano aquí (`Math.abs(saldo) >= 0.005`) — o sea, una cuarta copia de la misma decisión,
 * exactamente lo que esa definición única existe para impedir.
 *
 * ⚠️ Mira el CONTEO de partidas y la EXISTENCIA de renglones, no los importes: con
 * `consultas.ver-importes` apagado el saldo viaja en `null` y un criterio por importe mandaría
 * todas las filas al fondo justo para quien no puede ver dinero.
 *
 * Se EXPORTA para poder medirla: mientras fue privada, romperla no ponía roja ninguna prueba (la
 * mutación sobrevivió en la ronda de revisión). Una regla de orden que nadie mide es una regla que
 * se pierde en el siguiente refactor.
 */
export function pideDecision(fila: FilaCorridaSalida): boolean {
  return (
    fila.renglones.length > 0 ||
    fila.porRevisarPartidas > 0 ||
    (fila.saldo !== null && tieneSaldo(fila.saldo))
  );
}

/** Los argumentos `desde`/`hasta` del agregado de recibos de la semana. */
function rangoSemanaArgs(semana: string): [string, string] {
  const { desde, hasta } = rangoDeLaSemana(semana);
  return [desde, hasta];
}

/** Agrupa renglones por una clave nullable (las claves `null` se descartan). */
function agrupar(
  renglones: readonly RenglonFila[],
  clave: (r: RenglonFila) => number | null,
): Map<number, RenglonFila[]> {
  const mapa = new Map<number, RenglonFila[]>();
  for (const r of renglones) {
    const k = clave(r);
    if (k === null) continue;
    const lista = mapa.get(k);
    if (lista === undefined) {
      mapa.set(k, [r]);
    } else {
      lista.push(r);
    }
  }
  return mapa;
}

/** Los renglones de una fila, en forma sumable (se buscan por id en los de la corrida). */
function renglonesSumablesDeFila(
  fila: FilaCorridaSalida,
  todos: readonly RenglonFila[],
): { monto: number; formaPago: FormaDePagoClave }[] {
  const ids = new Set(fila.renglones.map((r) => r.id));
  return sumables(todos.filter((r) => ids.has(r.id)));
}

/**
 * ⭐ LA GUARDA FISCAL, en forma de lista con NOMBRES (§Post-F9.189(d)).
 *
 * Daniel: *«un pago CON factura sólo sale a una cuenta fiscal; sin cuenta fiscal capturada, ese
 * proveedor no se puede pagar con factura hasta tenerla — **la corrida lo dice con su nombre**»*.
 *
 * Devuelve lo que IMPIDE cerrar. Vacío = se puede cerrar. Se calcula sobre lo GUARDADO (la copia
 * congelada del renglón), no sobre el catálogo: es lo que de verdad va a salir al banco.
 *
 * En la corrida SIN factura no hay nada que exigir: *«lo sin factura sale a cualquier cuenta»*.
 */
function bloqueosDeCierre(corrida: CorridaConRenglones): { nombre: string; motivo: string }[] {
  if (!corrida.conFactura) {
    return [];
  }
  const bloqueos: { nombre: string; motivo: string }[] = [];
  for (const r of corrida.renglones) {
    if (!tieneMonto(r.monto.toNumber())) continue;
    if (r.formaPago === 'efectivo') {
      bloqueos.push({
        nombre: r.nombre,
        motivo:
          'En la relación CON factura el pago tiene que salir a una cuenta FISCAL, y en efectivo ' +
          'no hay cuenta. Captúrale su cuenta fiscal o pásalo a la relación sin factura.',
      });
      continue;
    }
    if (r.cuentaEsFiscal !== true) {
      bloqueos.push({
        nombre: r.nombre,
        motivo:
          'La cuenta elegida no está marcada como fiscal: un pago CON factura sólo puede salir a ' +
          'una cuenta fiscal.',
      });
    }
  }
  return bloqueos;
}

// ── Capturar un renglón ─────────────────────────────────────────────────────────────────────────

/** Sólo un BORRADOR se edita: lo cerrado no se toca (D3), se corrige con otra corrida. */
function exigirBorrador(corrida: { estado: string; folio: bigint }): void {
  if (corrida.estado !== 'borrador') {
    throw new ErrorConflicto(
      `La corrida ${String(corrida.folio)} ya está ${corrida.estado}: no se edita. Si hay que ` +
        'corregir algo, se hace otra corrida (lo guardado no se modifica).',
    );
  }
}

/**
 * Guarda un renglón: lo crea si `idRenglon` es `undefined`, o lo reemplaza si viene.
 *
 * ⭐ **No hay unique por beneficiario a propósito**: partir un pago son DOS renglones
 * (§Post-F9.185(e), *«en ocasiones me pide el proveedor partir un pago grande en más de una cuenta:
 * 30 mil en una y 20 mil en la otra la misma semana … así debe salir en la relación para poder
 * hacer las dos transferencias»*).
 *
 * Las tres guardas que muerden aquí, y por qué:
 *  1. **transferencia exige cuenta** — una transferencia sin destino no se puede hacer, y dejarla
 *     «para después» es el hueco por el que un renglón llega al banco sin a dónde ir.
 *  2. **la cuenta tiene que ser DEL beneficiario** — si no, el dinero sale a nombre de otro.
 *  3. **el segmento tiene que cuadrar con la modalidad del proveedor**. Ésta es la sutil: EsMa/CxP
 *     resuelven el con/sin factura con `resolverConFactura`, que **ignora lo solicitado** cuando la
 *     modalidad es `solo_con` o `solo_sin`. Sin esta guarda, meter un proveedor `solo_sin` en la
 *     corrida CON factura produciría, al ejecutar, un pago marcado SIN factura — el renglón habría
 *     saltado en silencio a la otra relación. Se caza al capturar, no al ejecutar, para que Daniel
 *     lo vea cuando puede arreglarlo. Y un proveedor SIN modalidad definida no se puede pagar: se
 *     reusa el mensaje de `MENSAJE_SIN_MODALIDAD`, que dice exactamente qué hacer.
 */
export async function guardarRenglonCorrida(
  sesion: SesionUsuario,
  idCorrida: number,
  entrada: z.input<typeof esquemaRenglonCorridaGuardar>,
  idRenglon?: number,
  bd?: ContextoBd,
): Promise<CorridaDetalleSalida> {
  verificarPermiso(sesion, 'pagos.corrida-armar');
  const datos = validarEntrada(esquemaRenglonCorridaGuardar, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  await enTransaccion(async (tx) => {
    const corrida = await exigirCorrida(tx, idEmpresa, idCorrida);
    exigirBorrador(corrida);

    // ⭐ EL RENGLÓN ES DE UN PROVEEDOR **O** DE UN CONCEPTO: nunca de los dos, nunca de ninguno.
    // (El CHECK `renglon_corrida_pago_beneficiario_check` de la base dice lo mismo; esto lo caza
    // antes, con un mensaje que se entiende.)
    const esConcepto = datos.idConcepto !== undefined;
    if (esConcepto && datos.idProveedor !== undefined) {
      throw new ErrorValidacion(
        'Un renglón es de un proveedor O de un concepto del catálogo, no de los dos.',
      );
    }
    if (!esConcepto && datos.idProveedor === undefined) {
      throw new ErrorValidacion(
        'Falta a quién se le paga: el renglón lleva un proveedor o un concepto del catálogo.',
      );
    }

    const destino = esConcepto
      ? await beneficiarioConcepto(tx, datos.idConcepto as number)
      : await beneficiarioProveedor(tx, datos.idProveedor as number, corrida.conFactura);

    // ⭐⭐ EL ORIGEN SE **DERIVA** DEL DESTINO, NUNCA SE ACEPTA DEL CLIENTE.
    //
    // 🔴 Antes venía en el cuerpo, y el `origen` es lo que decide EN QUÉ LIBRO nace el pago al
    // ejecutar (`PagoMaquilero` de EsMa vs `MovimientoTercero` de CxP). Un cuerpo con
    // `{origen:'proveedor', idProveedor:<un maquilero>}` se pintaba en la sección de Maquileros
    // —el `rubro` sí se derivaba— y al ejecutar nacía en CxP: el pago aparecía en el libro
    // equivocado y el saldo de EsMa del maquilero no bajaba nunca. No hacía falta mala fe, basta
    // un cliente viejo o un `curl`.
    //
    // Ahora el origen es una CONSECUENCIA del beneficiario y de sus roles, exactamente igual que el
    // rubro: los dos salen del MISMO `destino.rubro`, así que la sección que se ve y el libro donde
    // cae el dinero no pueden discrepar. El cuerpo ya no lo manda (se quitó del contrato).
    const origen: OrigenRenglonPagoClave = esConcepto
      ? 'concepto'
      : destino.rubro === 'maquila'
        ? 'maquila'
        : 'proveedor';

    // Guarda 1: la transferencia exige cuenta; el efectivo no admite ninguna.
    const idCuenta = datos.idCuenta ?? null;
    if (datos.formaPago === 'transferencia' && idCuenta === null) {
      throw new ErrorValidacion(
        `Elige la cuenta a la que se le transfiere a "${destino.nombre}" (o pásalo a efectivo).`,
      );
    }
    if (datos.formaPago === 'efectivo' && idCuenta !== null) {
      throw new ErrorValidacion('Un pago en efectivo no lleva cuenta destino.');
    }

    // Guarda 2: la cuenta tiene que ser suya (y estar viva).
    let cuenta: CuentaElegible | null = null;
    if (idCuenta !== null) {
      cuenta = destino.cuentas.find((c) => c.id === idCuenta) ?? null;
      if (cuenta === null) {
        throw new ErrorValidacion(
          `Esa cuenta no es de "${destino.nombre}" o está retirada: elige una de las suyas.`,
        );
      }
      // La guarda fiscal, adelantada al momento de elegir: en la corrida CON factura no se puede
      // siquiera seleccionar una cuenta no fiscal (§Post-F9.189(d)). Lo que el CIERRE revisa es lo
      // que falta (quien no tiene cuenta fiscal ninguna); esto impide el error de dedo.
      if (corrida.conFactura && !cuenta.esFiscal) {
        throw new ErrorValidacion(
          `La cuenta elegida de "${destino.nombre}" no está marcada como fiscal: en la relación ` +
            'CON factura el pago sólo puede salir a una cuenta fiscal.',
        );
      }
    }

    const datosRenglon = {
      origen,
      idProveedor: esConcepto ? null : (datos.idProveedor as number),
      idConcepto: esConcepto ? (datos.idConcepto as number) : null,
      rubro: destino.rubro,
      nombre: destino.nombre,
      monto: datos.monto,
      formaPago: datos.formaPago,
      ...congelarDestino(cuenta, destino.nombre),
      // La FK va del lado que corresponde (el CHECK de la base lo repite).
      idCuentaProveedor: !esConcepto && cuenta !== null ? cuenta.id : null,
      idCuentaConcepto: esConcepto && cuenta !== null ? cuenta.id : null,
      // ⭐ La explicación del pago y sus folios: es lo que finanzas lee para ejecutar.
      concepto: datos.concepto === undefined || datos.concepto === '' ? null : datos.concepto,
      referencia:
        datos.referencia === undefined || datos.referencia === '' ? null : datos.referencia,
    };

    if (idRenglon === undefined) {
      const creado = await tx.renglonCorridaPago.create({
        data: { idCorrida, ...datosRenglon, ...datosCreacion(sesion) },
      });
      await registrarBitacora(tx, sesion, {
        entidad: 'RenglonCorridaPago',
        idEntidad: creado.id,
        accion: 'CREAR',
        datos: bitacoraDeRenglon(corrida.folio, datosRenglon),
      });
      return;
    }

    const actual = await tx.renglonCorridaPago.findFirst({
      where: { id: idRenglon, idCorrida },
      select: { id: true, monto: true, formaPago: true, nombre: true },
    });
    if (actual === null) {
      throw new ErrorNoEncontrado('RenglonCorridaPago', idRenglon);
    }
    await tx.renglonCorridaPago.update({
      where: { id: idRenglon },
      data: { ...datosRenglon, ...datosModificacion(sesion) },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'RenglonCorridaPago',
      idEntidad: idRenglon,
      accion: 'MODIFICAR',
      datos: {
        ...bitacoraDeRenglon(corrida.folio, datosRenglon),
        montoAnterior: actual.monto.toNumber(),
        formaPagoAnterior: actual.formaPago,
      },
    });
  }, bd);

  return obtenerCorridaDetalle(sesion, idCorrida, bd);
}

/**
 * Lo que va del renglón a la bitácora (A7). ⚠️ **El número de cuenta NO va**: basta con saber a
 * nombre de quién salió y si la cuenta era fiscal (dato bancario, misma regla que las cuentas del
 * catálogo).
 */
function bitacoraDeRenglon(
  folio: bigint,
  r: {
    nombre: string;
    monto: number;
    formaPago: string;
    beneficiario: string;
    cuentaEsFiscal: boolean | null;
  },
): Prisma.InputJsonObject {
  return {
    corrida: Number(folio),
    nombre: r.nombre,
    monto: r.monto,
    formaPago: r.formaPago,
    beneficiario: r.beneficiario,
    cuentaEsFiscal: r.cuentaEsFiscal,
  };
}

/** Datos del beneficiario de un renglón, ya resueltos (proveedor o concepto). */
interface DestinoResuelto {
  nombre: string;
  rubro: RubroPagoClave;
  cuentas: CuentaElegible[];
}

/** Resuelve un proveedor y comprueba que su modalidad de facturación cuadre con el segmento. */
async function beneficiarioProveedor(
  tx: Tx,
  idProveedor: number,
  conFactura: boolean,
): Promise<DestinoResuelto> {
  const mapa = await proveedoresParaPago(tx, [idProveedor]);
  const proveedor: ProveedorParaPago | undefined = mapa.get(idProveedor);
  if (proveedor === undefined) {
    throw new ErrorNoEncontrado('Proveedor', idProveedor);
  }
  if (!proveedor.activo) {
    throw new ErrorConflicto(`El proveedor "${proveedor.nombre}" está desactivado.`);
  }
  // Guarda 3: el segmento contra la modalidad (ver el TSDoc de `guardarRenglonCorrida`).
  if (proveedor.modalidadFacturacion === null) {
    throw new ErrorValidacion(
      `Define primero la modalidad de facturación de "${proveedor.nombre}" (con factura, sin ` +
        'factura o ambas) en el catálogo de proveedores: sin ella no se sabe en cuál de las dos ' +
        'relaciones de la semana va su pago.',
    );
  }
  if (proveedor.modalidadFacturacion === 'solo_con' && !conFactura) {
    throw new ErrorValidacion(
      `"${proveedor.nombre}" factura SIEMPRE: su pago va en la relación CON factura, no en ésta.`,
    );
  }
  if (proveedor.modalidadFacturacion === 'solo_sin' && conFactura) {
    throw new ErrorValidacion(
      `"${proveedor.nombre}" NUNCA factura: su pago va en la relación SIN factura, no en ésta.`,
    );
  }
  return { nombre: proveedor.nombre, rubro: proveedor.rubro, cuentas: proveedor.cuentas };
}

/** Resuelve un concepto del catálogo. */
async function beneficiarioConcepto(tx: Tx, idConcepto: number): Promise<DestinoResuelto> {
  const mapa = await conceptosParaPago(tx, { ids: [idConcepto] });
  const concepto: ConceptoParaPago | undefined = mapa.get(idConcepto);
  if (concepto === undefined) {
    throw new ErrorNoEncontrado('ConceptoPago', idConcepto);
  }
  if (!concepto.activo) {
    throw new ErrorConflicto(`El concepto "${concepto.nombre}" está retirado del catálogo.`);
  }
  return { nombre: concepto.nombre, rubro: concepto.rubro, cuentas: concepto.cuentas };
}

/**
 * Quita un renglón de un BORRADOR.
 *
 * Borrar aquí NO choca con D3: un renglón de borrador es una intención, no un hecho — no ha tocado
 * ninguna cuenta corriente ni ha salido dinero. Lo que D3 protege (los movimientos) nace al
 * EJECUTAR, y a partir de ahí nada se borra: se cancela con su inverso.
 */
export async function eliminarRenglonCorrida(
  sesion: SesionUsuario,
  idCorrida: number,
  idRenglon: number,
  bd?: ContextoBd,
): Promise<CorridaDetalleSalida> {
  verificarPermiso(sesion, 'pagos.corrida-armar');
  const idEmpresa = sesion.idEmpresaActiva;

  await enTransaccion(async (tx) => {
    const corrida = await exigirCorrida(tx, idEmpresa, idCorrida);
    exigirBorrador(corrida);
    const renglon = await tx.renglonCorridaPago.findFirst({
      where: { id: idRenglon, idCorrida },
      select: { id: true, nombre: true, monto: true },
    });
    if (renglon === null) {
      throw new ErrorNoEncontrado('RenglonCorridaPago', idRenglon);
    }
    await tx.renglonCorridaPago.delete({ where: { id: idRenglon } });
    await registrarBitacora(tx, sesion, {
      entidad: 'RenglonCorridaPago',
      idEntidad: idRenglon,
      // `OTRO`: el enum de la bitácora no tiene ELIMINAR porque en este sistema casi nada se borra
      // (D3). Aquí sí, y por eso la operación va escrita en `datos` — un borrador es una intención,
      // no un hecho: no movió un peso. Lo que D3 protege nace al EJECUTAR.
      accion: 'OTRO',
      datos: {
        operacion: 'eliminar-renglon',
        corrida: Number(corrida.folio),
        nombre: renglon.nombre,
        monto: renglon.monto.toNumber(),
      },
    });
  }, bd);

  return obtenerCorridaDetalle(sesion, idCorrida, bd);
}

// ── Cerrar y ejecutar ───────────────────────────────────────────────────────────────────────────

/**
 * CIERRA la corrida: la relación queda final y se le manda a finanzas. A partir de aquí no se edita
 * (D3) — si algo salió mal, se hace otra corrida.
 *
 * Aquí muerde la **guarda fiscal** (§Post-F9.189(d)): en la relación CON factura, todo renglón con
 * monto tiene que salir a una cuenta FISCAL. Si alguno no puede, el cierre se rechaza **nombrando a
 * cada uno** — que es exactamente lo que pidió Daniel: *«la corrida lo dice con su nombre»*.
 *
 * Una corrida sin un solo renglón con monto tampoco se cierra: cerrar una relación vacía y mandarla
 * a finanzas no significa nada, y casi siempre quiere decir que se cerró la corrida equivocada.
 */
export async function cerrarCorrida(
  sesion: SesionUsuario,
  idCorrida: number,
  bd?: ContextoBd,
): Promise<CorridaDetalleSalida> {
  verificarPermiso(sesion, 'pagos.corrida-armar');
  const idEmpresa = sesion.idEmpresaActiva;

  await enTransaccion(async (tx) => {
    await bloquearCorridas(tx, idEmpresa);
    const corrida = await exigirCorrida(tx, idEmpresa, idCorrida);
    exigirBorrador(corrida);

    const conMonto = corrida.renglones.filter((r) => tieneMonto(r.monto.toNumber()));
    if (conMonto.length === 0) {
      throw new ErrorValidacion(
        'Esta corrida no tiene ningún renglón con monto: no hay nada que pagar.',
      );
    }

    const bloqueos = bloqueosDeCierre(corrida);
    if (bloqueos.length > 0) {
      throw new ErrorValidacion(
        'No se puede cerrar la relación CON factura: ' +
          bloqueos.map((b) => `${b.nombre} — ${b.motivo}`).join(' · '),
      );
    }

    await tx.corridaPago.update({
      where: { id: idCorrida },
      data: {
        estado: 'cerrada',
        cerradaEn: new Date(),
        cerradaPorId: sesion.id,
        ...datosModificacion(sesion),
      },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'CorridaPago',
      idEntidad: idCorrida,
      accion: 'MODIFICAR',
      datos: {
        operacion: 'cerrar',
        folio: Number(corrida.folio),
        renglonesConMonto: conMonto.length,
        total: redondear2(conMonto.reduce((s, r) => s + r.monto.toNumber(), 0)),
      },
    });
  }, bd);

  return obtenerCorridaDetalle(sesion, idCorrida, bd);
}

/**
 * ⭐ EJECUTA la corrida: el dinero salió, y cada renglón con monto nace como movimiento real.
 *
 *  • maquilero → `PagoMaquilero` **a cuenta** (sin aplicaciones a cargos: el monto lo decidió
 *    Daniel, no lo derivó de los cargos). Es también la forma del ANTICIPO — §Post-F9.186(h): un
 *    anticipo es un pago sin recibos, y en EsMa el «abono» SUBE lo que se le debe mientras el pago
 *    lo BAJA, así que un anticipo tiene que ser un pago (y deja el saldo en negativo a propósito).
 *  • proveedor de estado de cuenta → `MovimientoTercero` origen `pago` (el motor le pone el signo).
 *  • concepto del catálogo → **nada**: un concepto no tiene cuenta corriente. La corrida ES su
 *    registro. No se inventa un tercero para poder anotarlo en algún lado.
 *
 * TODO en UNA transacción (A2): o nacen todos los movimientos o ninguno. Si a mitad de camino un
 * proveedor resulta impagable, la corrida se queda cerrada y entera, no a medias.
 *
 * **Idempotente por construcción:** sólo una corrida `cerrada` se ejecuta, y al terminar queda
 * `ejecutada`; además cada renglón guarda el id del movimiento que creó, y un CHECK de la base
 * impide que un renglón apunte al movimiento del lado equivocado. Ejecutar dos veces es imposible.
 *
 * Los movimientos nacen `revisado` (EsMa): el estado `capturado` existe para lo que OTRO capturó y
 * Daniel todavía no ha decidido; aquí la decisión es suya y ejecutar es el acto de confirmarla.
 *
 * ⚠️ Exige ADEMÁS los permisos de EsMa y de CxP al delegar (defensa en profundidad, igual que CxP
 * con el motor de terceros): quien puede armar la corrida los tiene en el seed.
 */
export async function ejecutarCorrida(
  sesion: SesionUsuario,
  idCorrida: number,
  bd?: ContextoBd,
): Promise<CorridaDetalleSalida> {
  verificarPermiso(sesion, 'pagos.corrida-armar');
  const idEmpresa = sesion.idEmpresaActiva;

  await enTransaccion(async (tx) => {
    await bloquearCorridas(tx, idEmpresa);
    const corrida = await exigirCorrida(tx, idEmpresa, idCorrida);
    if (corrida.estado !== 'cerrada') {
      throw new ErrorConflicto(
        corrida.estado === 'borrador'
          ? `La corrida ${String(corrida.folio)} todavía está en borrador: ciérrala antes de ejecutarla.`
          : `La corrida ${String(corrida.folio)} ya se ejecutó.`,
      );
    }

    // La fecha del pago es el LUNES de la semana pagada, no «hoy»: la corrida es de esa semana, y
    // ejecutarla el jueves no la mueve de sitio en el estado de cuenta.
    const fecha = aFechaIso(corrida.semana);
    const referencia = { corrida: Number(corrida.folio), semana: fecha };

    for (const renglon of corrida.renglones) {
      const monto = renglon.monto.toNumber();
      if (!tieneMonto(monto)) continue;

      if (renglon.origen === 'maquila' && renglon.idProveedor !== null) {
        const pago = await crearPagoACuentaMaquilero(tx, sesion, {
          idMaquilero: renglon.idProveedor,
          monto,
          fecha,
          conFactura: corrida.conFactura,
          observaciones: observacionDelPago(renglon),
          estadoRevision: 'revisado',
          origenAuditoria: referencia,
        });
        await tx.renglonCorridaPago.update({
          where: { id: renglon.id },
          data: { idPagoMaquilero: pago.id, ...datosModificacion(sesion) },
        });
        continue;
      }

      if (renglon.origen === 'proveedor' && renglon.idProveedor !== null) {
        const observaciones = observacionDelPago(renglon);
        const movimiento = await registrarMovimientoCxp(
          sesion,
          renglon.idProveedor,
          {
            fecha,
            origen: 'pago',
            importe: monto,
            esFiscal: corrida.conFactura,
            refTipo: 'corrida-pago',
            refId: corrida.id,
            ...(observaciones === undefined ? {} : { observaciones }),
          },
          { tx },
        );
        await tx.renglonCorridaPago.update({
          where: { id: renglon.id },
          data: { idMovimientoTercero: movimiento.id, ...datosModificacion(sesion) },
        });
        continue;
      }

      // Concepto del catálogo: no hay cuenta corriente que mover. Su registro ES este renglón.
    }

    await tx.corridaPago.update({
      where: { id: idCorrida },
      data: {
        estado: 'ejecutada',
        ejecutadaEn: new Date(),
        ejecutadaPorId: sesion.id,
        ...datosModificacion(sesion),
      },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'CorridaPago',
      idEntidad: idCorrida,
      accion: 'MODIFICAR',
      datos: {
        operacion: 'ejecutar',
        folio: Number(corrida.folio),
        total: redondear2(
          corrida.renglones.reduce((s, r) => {
            const m = r.monto.toNumber();
            return tieneMonto(m) ? s + m : s;
          }, 0),
        ),
      },
    });
  }, bd);

  return obtenerCorridaDetalle(sesion, idCorrida, bd);
}

/**
 * Lo que viaja como observación al movimiento real (pago EsMa o movimiento de CxP): **el concepto**,
 * que es la explicación del pago, más sus folios si los trae. Así el estado de cuenta dice lo mismo
 * que la relación que finanzas tuvo en la mano — no un «pago de la corrida 12» que no explica nada.
 */
function observacionDelPago(renglon: RenglonFila): string | undefined {
  const partes = [renglon.concepto, renglon.referencia].filter(
    (p): p is string => p !== null && p !== '',
  );
  return partes.length === 0 ? undefined : partes.join(' · ');
}

/**
 * Elimina un BORRADOR entero (sus renglones se van en cascada).
 *
 * Sólo un borrador, y por el mismo motivo que un renglón: todavía no es un hecho, no ha movido un
 * peso. Una corrida CERRADA no se borra jamás — es lo que finanzas tiene en la mano.
 */
export async function eliminarCorrida(
  sesion: SesionUsuario,
  idCorrida: number,
  bd?: ContextoBd,
): Promise<void> {
  verificarPermiso(sesion, 'pagos.corrida-armar');
  const idEmpresa = sesion.idEmpresaActiva;

  await enTransaccion(async (tx) => {
    const corrida = await exigirCorrida(tx, idEmpresa, idCorrida);
    exigirBorrador(corrida);
    // Los renglones se van con ella: la FK `idCorrida` es `onDelete: Cascade` (el detalle vive con
    // su encabezado). Y ninguno puede tener movimiento: los movimientos sólo nacen al EJECUTAR, y
    // ejecutar exige que la corrida esté CERRADA — que es justo lo que `exigirBorrador` descarta.
    await tx.corridaPago.delete({ where: { id: idCorrida } });
    await registrarBitacora(tx, sesion, {
      entidad: 'CorridaPago',
      idEntidad: idCorrida,
      // `OTRO` con la operación en `datos`: ver la nota del borrado de un renglón.
      accion: 'OTRO',
      datos: {
        operacion: 'eliminar-borrador',
        folio: Number(corrida.folio),
        semana: aFechaIso(corrida.semana),
        conFactura: corrida.conFactura,
        renglones: corrida.renglones.length,
      },
    });
  }, bd);
}

// ── El concentrado (la relación ejecutable) ─────────────────────────────────────────────────────

/**
 * ⭐ EL CONCENTRADO: sólo los renglones CON monto, por rubro, ordenados por monto descendente, con
 * los totales de efectivo y transferencia por sección y el gran total.
 *
 * Es lo que sustituye a la hoja «Transfers Concentrado» de su Excel (§Post-F9.185(d): *«la lista
 * ejecutable — sólo los que llevan monto, ordenados por monto»*), y es una salida SECUNDARIA: el
 * producto es la pantalla (§Post-F9.189(f)).
 *
 * ⚠️ **Los renglones NO se colapsan por beneficiario.** Un pago partido en dos cuentas son dos
 * renglones, *«así debe salir en la relación para poder hacer las dos transferencias»*. Agruparlos
 * sería lo «ordenado» y rompería el pago.
 *
 * Aquí SÍ va el número de cuenta completo: es para transferir. Por eso exige
 * `consultas.ver-importes` — sin poder ver el dinero, la relación ejecutable no tiene sentido y
 * saldría con todos los montos en `null` junto a los números de cuenta.
 */
export async function concentradoDeCorrida(
  sesion: SesionUsuario,
  idCorrida: number,
  bd?: ContextoBd,
): Promise<ConcentradoSalida> {
  exigirVerCorrida(sesion);
  verificarPermiso(sesion, 'consultas.ver-importes');
  const cliente = clienteLectura(bd);
  const corrida = await exigirCorrida(cliente, sesion.idEmpresaActiva, idCorrida);

  const conMonto = corrida.renglones.filter((r) => tieneMonto(r.monto.toNumber()));

  // ⭐ La facturabilidad de TODOS los renglones, en dos consultas (fila 0.118). Va aquí y no en una
  // llamada por renglón porque la pantalla pinta un botón «Documento para facturar» por fila: en una
  // relación de 40 renglones serían 40 peticiones para dibujar 40 botones.
  const facturacion = await facturabilidadDeRenglones(cliente, sesion, corrida, conMonto);

  const secciones = ORDEN_RUBROS_PAGO.map((rubro) => {
    const propios = conMonto
      .filter((r) => r.rubro === rubro)
      // Por MONTO descendente, como su Excel; el nombre desempata (orden determinista, A8).
      .sort(
        (a, b) => b.monto.toNumber() - a.monto.toNumber() || a.nombre.localeCompare(b.nombre, 'es'),
      );
    return {
      rubro,
      renglones: propios.map((r) => ({
        id: r.id,
        rubro: r.rubro,
        nombre: r.nombre,
        beneficiario: r.beneficiario,
        banco: r.banco,
        tipoCuenta: r.tipoCuenta,
        cuenta: r.numeroCuenta,
        aliasCuenta: r.aliasCuenta,
        formaPago: r.formaPago,
        monto: r.monto.toNumber(),
        concepto: r.concepto,
        referencia: r.referencia,
        facturacion: facturacion.get(r.id) ?? SIN_FACTURACION,
      })),
      totales: totalesDe(sumables(propios), true),
    };
  }).filter((s) => s.renglones.length > 0);

  return {
    corrida: proyectarCorrida(corrida, true),
    secciones,
    totales: totalesDe(sumables(conMonto), true),
  };
}
