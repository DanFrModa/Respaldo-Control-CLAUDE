/**
 * BORRADO de los datos ficticios de FINANZAS (`--limpiar`).
 *
 * ## La regla que gobierna este archivo
 *
 * 🔴 **SÓLO SE BORRA LO QUE ESTÁ EN EL MAPEO.** El conjunto sale entero de `mapeo_migracion`
 * (entidades `Demo:Fin:*`), que es donde el sembrador anotó, uno por uno, cada id que creó
 * —incluidos los que nacieron DENTRO del dominio (el movimiento INVERSO de una cancelación, el pago
 * de EsMa o de CxP que nació al ejecutar una corrida)—. **Nada se deduce del tercero.**
 *
 * ⚠️ No es una preferencia de estilo: el sembrador de INVENTARIOS ya pagó ese error (ver la cabecera
 * de `demo/limpiar.ts`). Deducir el conjunto de «todo lo que cuelga del proveedor DEMO» barrería
 * también lo que alguien capturara encima —y los terceros `DEMO-FIN` salen en todos los
 * desplegables, así que Daniel probando Finanzas los va a usar—. Como el saldo es Σ de movimientos
 * (D3), borrar un movimiento ajeno es corrupción silenciosa de una cuenta corriente.
 *
 * ## Por qué esto NO rompe D3
 *
 * D3 dice que lo ASENTADO no se edita ni se borra: cancelar es un movimiento INVERSO auditado. Esa
 * regla gobierna **a la aplicación** —lo que una persona puede hacerle a un documento real— y aquí
 * no se toca: el sembrador siembra por el dominio y el dominio sigue igual de estricto. Lo de aquí
 * es un **mantenimiento de la base de `prueba`** que retira, entero y por su inventario, un juego de
 * datos que nunca fue del negocio.
 *
 * ## Los cuatro cinturones
 *
 *  1. **El conjunto es cerrado**: los ids del mapeo `Demo:Fin:*`, y nada más. En particular, NO se
 *     toca ni un renglón del sembrador de inventarios (que vive bajo `Demo:*`).
 *  2. **Chequeo de INVASIÓN antes de tocar nada** ({@link detectarInvasoresFin}): si apareció algo
 *     que cuelga de lo ficticio y que el sembrador NO creó —un movimiento capturado a mano en la
 *     cuenta de un tercero demo, un pago de EsMa nuevo, un renglón de una corrida ajena que le paga
 *     a un proveedor demo, una factura de otro que cotejó contra un documento demo, o una compra a
 *     nombre suyo— el borrado **se niega a correr**, con `EXIT=1`, y los lista con sus ids.
 *  3. **Orden de dependencia**, porque las FK importan: las ligas de cotejo antes que las corridas;
 *     las corridas (que arrastran sus renglones en cascada) antes que los pagos y las cuentas a las
 *     que esos renglones apuntan con `Restrict`; los movimientos derivados antes que sus originales.
 *  4. **Todo en UNA transacción**, así que un fallo a mitad no deja nada a medio borrar. Ése es
 *     además el último cinturón: si quedara alguna `Restrict` que el chequeo de invasión no previó,
 *     la base aborta y **no se borra nada** (en vez de dejar la base a medias).
 *
 * ⚠️ **La BITÁCORA no se borra.** Sus renglones no tienen FK (guardan entidad + id como texto) y son
 * la huella de auditoría (A7): que sobreviva el rastro de «se sembró y se limpió» es lo correcto.
 * Tampoco se tocan los contadores de folios (`EmpresaSecuencia`): un folio consumido no se devuelve.
 */
import type { PrismaClient } from '../../../src/datos/index.js';

import { ENTIDAD_DEMO_FIN, type EntidadDemoFin } from './datos.js';

/** Los ids que el sembrador anotó, por tabla. Es TODO lo que `--limpiar` puede tocar. */
export interface ConjuntoDemoFin {
  proveedores: number[];
  cuentasPago: number[];
  clientes: number[];
  conceptosPago: number[];
  movimientosTercero: number[];
  abonosEsMa: number[];
  descuentosEsMa: number[];
  pagosEsMa: number[];
  corridas: number[];
}

/** Qué se borró (lo imprime el script). */
export interface ResultadoLimpiezaFin {
  ligasCotejo: number;
  corridas: number;
  pagosEsMa: number;
  abonosEsMa: number;
  descuentosEsMa: number;
  movimientosTercero: number;
  cuentasPago: number;
  conceptosPago: number;
  proveedores: number;
  clientes: number;
  mapeos: number;
}

/** Un estorbo que impide limpiar: algo que cuelga de lo ficticio y que el sembrador NO creó. */
export interface InvasorFin {
  /** Qué es, en palabras de quien lo va a leer. */
  que: string;
  /** Cuántos hay. */
  cuantos: number;
  /** Unos cuantos ids, para poder ir a verlos. */
  ejemplos: number[];
  /** Qué hacer con ellos. */
  comoSeArregla: string;
}

/** Error que corta el borrado cuando alguien ya operó encima de los datos ficticios. */
export class ErrorLimpiezaFinBloqueada extends Error {
  constructor(readonly invasores: InvasorFin[]) {
    super('No se puede limpiar: hay documentos que no sembró este script colgando de lo ficticio.');
    this.name = 'ErrorLimpiezaFinBloqueada';
  }
}

/** Lee los ids anotados bajo una entidad `Demo:Fin:*`. */
async function idsDe(cliente: PrismaClient, entidad: EntidadDemoFin): Promise<number[]> {
  const filas = await cliente.mapeoMigracion.findMany({
    where: { entidad },
    select: { idNuevo: true },
  });
  return [...new Set(filas.map((f) => Number(f.idNuevo)).filter((n) => Number.isFinite(n)))];
}

/** Reúne TODO el conjunto ficticio desde el mapeo (y sólo desde ahí). */
export async function reunirDemoFin(cliente: PrismaClient): Promise<ConjuntoDemoFin> {
  return {
    proveedores: await idsDe(cliente, ENTIDAD_DEMO_FIN.proveedor),
    cuentasPago: await idsDe(cliente, ENTIDAD_DEMO_FIN.cuentaPago),
    clientes: await idsDe(cliente, ENTIDAD_DEMO_FIN.cliente),
    conceptosPago: await idsDe(cliente, ENTIDAD_DEMO_FIN.conceptoPago),
    movimientosTercero: await idsDe(cliente, ENTIDAD_DEMO_FIN.movimientoTercero),
    abonosEsMa: await idsDe(cliente, ENTIDAD_DEMO_FIN.abonoEsMa),
    descuentosEsMa: await idsDe(cliente, ENTIDAD_DEMO_FIN.descuentoEsMa),
    pagosEsMa: await idsDe(cliente, ENTIDAD_DEMO_FIN.pagoEsMa),
    corridas: await idsDe(cliente, ENTIDAD_DEMO_FIN.corrida),
  };
}

/** ¿Está vacío el conjunto (no hay nada sembrado)? */
export function conjuntoFinVacio(c: ConjuntoDemoFin): boolean {
  const listas: number[][] = [
    c.proveedores,
    c.cuentasPago,
    c.clientes,
    c.conceptosPago,
    c.movimientosTercero,
    c.abonosEsMa,
    c.descuentosEsMa,
    c.pagosEsMa,
    c.corridas,
  ];
  return listas.every((lista) => lista.length === 0);
}

/** Arma un invasor a partir de una lista de ids, o `null` si no hay ninguno. */
function invasor(
  que: string,
  ids: number[],
  comoSeArregla: string,
  sembrados: Set<number>,
): InvasorFin | null {
  const ajenos = ids.filter((id) => !sembrados.has(id));
  if (ajenos.length === 0) return null;
  return { que, cuantos: ajenos.length, ejemplos: ajenos.slice(0, 10), comoSeArregla };
}

/**
 * Busca lo que cuelga de lo ficticio y que el sembrador NO anotó. Si devuelve algo, NO se borra
 * nada: significa que alguien ya operó encima.
 */
export async function detectarInvasoresFin(
  cliente: PrismaClient,
  c: ConjuntoDemoFin,
): Promise<InvasorFin[]> {
  const resultado: (InvasorFin | null)[] = [];
  const vacio = new Set<number>();

  // (a) Movimientos de cuenta corriente de un tercero ficticio que este script no creó.
  const movs = (
    await cliente.movimientoTercero.findMany({
      where: {
        OR: [{ idProveedor: { in: c.proveedores } }, { idCliente: { in: c.clientes } }],
      },
      select: { id: true },
    })
  ).map((x) => x.id);
  resultado.push(
    invasor(
      'movimientos de cuenta corriente (CxP/CxC) de un tercero DEMO-FIN que este script no creó',
      movs,
      'Cancélalos desde Finanzas (cancelar = movimiento inverso, D3) y vuelve a intentarlo.',
      new Set(c.movimientosTercero),
    ),
  );

  // (b) Pagos, abonos y descuentos de EsMa de un maquilero ficticio.
  const pagos = (
    await cliente.pagoMaquilero.findMany({
      where: { idMaquilero: { in: c.proveedores } },
      select: { id: true },
    })
  ).map((x) => x.id);
  resultado.push(
    invasor(
      'pagos de EsMa a un maquilero DEMO-FIN que este script no creó',
      pagos,
      'Cancélalos en EsMa antes de limpiar.',
      new Set(c.pagosEsMa),
    ),
  );
  const abonos = (
    await cliente.abonoMaquilero.findMany({
      where: { idMaquilero: { in: c.proveedores } },
      select: { id: true },
    })
  ).map((x) => x.id);
  resultado.push(
    invasor(
      'abonos de EsMa de un maquilero DEMO-FIN que este script no creó',
      abonos,
      'Cancélalos en EsMa antes de limpiar.',
      new Set(c.abonosEsMa),
    ),
  );
  const descuentos = (
    await cliente.descuentoMaquilero.findMany({
      where: { idMaquilero: { in: c.proveedores } },
      select: { id: true },
    })
  ).map((x) => x.id);
  resultado.push(
    invasor(
      'descuentos de EsMa de un maquilero DEMO-FIN que este script no creó',
      descuentos,
      'Cancélalos en EsMa antes de limpiar.',
      new Set(c.descuentosEsMa),
    ),
  );

  // (c) Renglones de OTRA corrida (una de verdad) que le pagan a un tercero/cuenta/concepto DEMO.
  const renglonesAjenos = (
    await cliente.renglonCorridaPago.findMany({
      where: {
        idCorrida: { notIn: c.corridas },
        OR: [
          { idProveedor: { in: c.proveedores } },
          { idConcepto: { in: c.conceptosPago } },
          { idCuentaProveedor: { in: c.cuentasPago } },
        ],
      },
      select: { id: true },
    })
  ).map((x) => x.id);
  resultado.push(
    invasor(
      'renglones de una corrida de pago AJENA que le pagan a un beneficiario DEMO-FIN',
      renglonesAjenos,
      'Quita esos renglones (o borra esa corrida si es un borrador) antes de limpiar.',
      vacio,
    ),
  );

  // (d) Ligas de cotejo de OTRA factura contra un documento emitido por una corrida ficticia.
  const ligasAjenas = (
    await cliente.cotejoFacturaDocumento.findMany({
      where: {
        renglon: { idCorrida: { in: c.corridas } },
        idMovimiento: { notIn: c.movimientosTercero },
      },
      select: { idMovimiento: true },
    })
  ).map((x) => x.idMovimiento);
  resultado.push(
    invasor(
      'facturas AJENAS cotejadas contra un documento emitido por una corrida DEMO-FIN',
      ligasAjenas,
      'Quítales la liga desde la bandeja de cotejo antes de limpiar.',
      vacio,
    ),
  );

  // (e) Documentos de OTROS módulos a nombre de un tercero ficticio. No los crea este sembrador, pero
  //     los terceros DEMO-FIN salen en todos los desplegables y alguien puede haberlos usado. Todos
  //     estos FK son `Restrict`: si quedaran, la transacción abortaría con un error de base ilegible.
  const compras = (
    await cliente.ordenCompra.findMany({
      where: { idProveedor: { in: c.proveedores } },
      select: { id: true },
    })
  ).map((x) => x.id);
  resultado.push(
    invasor(
      'órdenes de compra a nombre de un proveedor DEMO-FIN',
      compras,
      'Cancélalas o reasígnalas antes de limpiar.',
      vacio,
    ),
  );
  const entradas = (
    await cliente.entradaTela.findMany({
      where: { idProveedor: { in: c.proveedores } },
      select: { id: true },
    })
  ).map((x) => x.id);
  resultado.push(
    invasor(
      'entradas de tela a nombre de un proveedor DEMO-FIN',
      entradas,
      'Cancélalas antes de limpiar.',
      vacio,
    ),
  );
  const cargos = (
    await cliente.esMaCargo.findMany({
      where: { idMaquilero: { in: c.proveedores } },
      select: { id: true },
    })
  ).map((x) => x.id);
  resultado.push(
    invasor(
      'cargos de EsMa (recibos de maquila) a nombre de un maquilero DEMO-FIN',
      cargos,
      'Cancela los recibos de producción que los crearon antes de limpiar.',
      vacio,
    ),
  );
  const pedidos = (
    await cliente.pedido.findMany({
      where: { idCliente: { in: c.clientes } },
      select: { id: true },
    })
  ).map((x) => x.id);
  resultado.push(
    invasor(
      'pedidos de un cliente DEMO-FIN',
      pedidos,
      'Cancélalos o reasígnalos antes de limpiar.',
      vacio,
    ),
  );

  return resultado.filter((x): x is InvasorFin => x !== null);
}

/** Lo que se borraría, tabla por tabla (para el ensayo en seco: exactamente lo que se va a borrar). */
export async function planDeLimpiezaFin(
  cliente: PrismaClient,
  c: ConjuntoDemoFin,
): Promise<ResultadoLimpiezaFin> {
  // Se cuenta de verdad: prometer «exactamente lo que se va a borrar» y luego enseñar un número
  // fijo es la clase de falsa tranquilidad que este ensayo en seco existe para no dar.
  const ligasCotejo = await cliente.cotejoFacturaDocumento.count({
    where: { idMovimiento: { in: c.movimientosTercero } },
  });
  const mapeos = await cliente.mapeoMigracion.count({
    where: { entidad: { in: Object.values(ENTIDAD_DEMO_FIN) } },
  });
  return {
    ligasCotejo,
    corridas: c.corridas.length,
    pagosEsMa: c.pagosEsMa.length,
    abonosEsMa: c.abonosEsMa.length,
    descuentosEsMa: c.descuentosEsMa.length,
    movimientosTercero: c.movimientosTercero.length,
    cuentasPago: c.cuentasPago.length,
    conceptosPago: c.conceptosPago.length,
    proveedores: c.proveedores.length,
    clientes: c.clientes.length,
    mapeos,
  };
}

/**
 * Borra lo sembrado, en una sola transacción y en orden de dependencia. Lanza
 * {@link ErrorLimpiezaFinBloqueada} —**sin escribir nada**— si alguien operó encima.
 */
export async function limpiarDemoFinanzas(cliente: PrismaClient): Promise<ResultadoLimpiezaFin> {
  const c = await reunirDemoFin(cliente);
  const invasores = await detectarInvasoresFin(cliente, c);
  if (invasores.length > 0) throw new ErrorLimpiezaFinBloqueada(invasores);

  // Los movimientos DERIVADOS (el inverso de una cancelación, la corrección) apuntan a su original
  // con RESTRICT: van en una primera pasada, o la base impediría borrar al original.
  const derivados = (
    await cliente.movimientoTercero.findMany({
      where: {
        id: { in: c.movimientosTercero },
        OR: [{ idMovimientoInverso: { not: null } }, { idMovimientoCorregido: { not: null } }],
      },
      select: { id: true },
    })
  ).map((x) => x.id);
  const setDerivados = new Set(derivados);
  const originales = c.movimientosTercero.filter((id) => !setDerivados.has(id));

  return cliente.$transaction(async (tx) => {
    // 1. Las ligas de cotejo: cuelgan de la factura (Cascade) pero también del renglón (Restrict),
    //    así que se quitan antes de borrar la corrida que dueña ese renglón.
    const ligas = await tx.cotejoFacturaDocumento.deleteMany({
      where: { idMovimiento: { in: c.movimientosTercero } },
    });
    // 2. Las corridas (sus renglones se van en cascada). Tiene que ir ANTES que los pagos y las
    //    cuentas: el renglón les apunta con Restrict.
    const cor = await tx.corridaPago.deleteMany({ where: { id: { in: c.corridas } } });
    // 3. Los pagos de EsMa (sus aplicaciones se van en cascada) y los demás movimientos de EsMa.
    const pag = await tx.pagoMaquilero.deleteMany({ where: { id: { in: c.pagosEsMa } } });
    const abo = await tx.abonoMaquilero.deleteMany({ where: { id: { in: c.abonosEsMa } } });
    const des = await tx.descuentoMaquilero.deleteMany({
      where: { id: { in: c.descuentosEsMa } },
    });
    // 4. Los movimientos del motor: primero los derivados, después los originales.
    const mt1 = await tx.movimientoTercero.deleteMany({ where: { id: { in: derivados } } });
    const mt2 = await tx.movimientoTercero.deleteMany({ where: { id: { in: originales } } });
    // 5. Los catálogos, ya sin nada que los apunte.
    const cta = await tx.proveedorCuentaPago.deleteMany({ where: { id: { in: c.cuentasPago } } });
    const con = await tx.conceptoPago.deleteMany({ where: { id: { in: c.conceptosPago } } });
    const pro = await tx.proveedor.deleteMany({ where: { id: { in: c.proveedores } } });
    const cli = await tx.cliente.deleteMany({ where: { id: { in: c.clientes } } });
    // 6. Y la marca. Sólo las entidades `Demo:Fin:*`: las `Demo:*` del sembrador de inventarios se
    //    quedan intactas (`Object.values` es el de ESTE mapa, no el de aquél).
    const map = await tx.mapeoMigracion.deleteMany({
      where: { entidad: { in: Object.values(ENTIDAD_DEMO_FIN) } },
    });
    return {
      ligasCotejo: ligas.count,
      corridas: cor.count,
      pagosEsMa: pag.count,
      abonosEsMa: abo.count,
      descuentosEsMa: des.count,
      movimientosTercero: mt1.count + mt2.count,
      cuentasPago: cta.count,
      conceptosPago: con.count,
      proveedores: pro.count,
      clientes: cli.count,
      mapeos: map.count,
    };
  });
}
