/**
 * BORRADO de los datos ficticios de inventarios (`--limpiar`).
 *
 * ## La regla que gobierna este archivo
 *
 * 🔴 **SÓLO SE BORRA LO QUE ESTÁ EN EL MAPEO.** El conjunto sale entero de `mapeo_migracion`
 * (entidades `Demo:*`), que es donde el sembrador anotó, uno por uno, cada id que creó —incluidos
 * los que nacieron DENTRO del dominio (el movimiento de kardex de una recepción, la partida de una
 * entrada de tela, el cargo de CxP). **Nada se deduce del ALMACÉN.**
 *
 * ⚠️ Y no es una preferencia de estilo: deducirlo del almacén fue un defecto REAL de la primera
 * versión de este archivo. El `where` incluía `idAlmacen in (almacenes DEMO)`, así que barría
 * cualquier movimiento que viviera en un almacén ficticio **aunque fuera de material de verdad** —y
 * los almacenes `DEMO-` salen en todos los desplegables, así que el dueño probando inventarios los
 * iba a usar—. Medido: una entrada manual de tela real al almacén demo desaparecía, y de un traspaso
 * real→demo se borraba **sólo la pata de entrada**, dejando la salida huérfana y la tela real en
 * existencia NEGATIVA. En `EXIT=0` y con un «la base quedó como antes». Como la existencia es Σ de
 * movimientos (D3), eso es corrupción silenciosa del inventario de verdad.
 *
 * ## Por qué esto NO rompe D3
 *
 * D3 dice que lo ASENTADO no se edita ni se borra: cancelar es un movimiento INVERSO auditado. Esa
 * regla gobierna **a la aplicación** —lo que una persona puede hacerle a un documento real— y aquí
 * no se toca: el sembrador siembra por el dominio y el dominio sigue igual de estricto. Lo de aquí
 * es un **mantenimiento de la base de `prueba`** que retira, entero y por su inventario, un juego de
 * datos que nunca fue del negocio.
 *
 * ## Los tres cinturones
 *
 *  1. **El conjunto es cerrado**: los ids del mapeo, y nada más.
 *  2. **Chequeo de INVASIÓN antes de tocar nada** ({@link detectarInvasores}): si apareció algo que
 *     cuelga de lo ficticio y que el sembrador NO creó —un movimiento de material demo capturado a
 *     mano, una recepción nueva sobre una OC demo, una entrada de tela nueva, una partida nueva, un
 *     cargo o un pago al proveedor demo— el borrado **se niega a correr**, con `EXIT=1`, y los
 *     lista con sus ids. Ésa es, literalmente, la alternativa que exige el enunciado: la limpieza
 *     sólo es posible mientras nadie haya operado encima.
 *  3. **El almacén ficticio que guarda cosas de VERDAD no se borra: se DESACTIVA**
 *     ({@link almacenesOcupados}). Alguien puede meter material real en un almacén `DEMO-` —salen
 *     en todos los desplegables—, y ese inventario no es de este script. Borrar el almacén lo
 *     arrastraría; abortar dejaría la base sin poder limpiarse nunca. Así que se limpia todo lo
 *     demás y el almacén se queda apagado, con su contenido intacto y dicho en el reporte.
 *  4. **Todo en UNA transacción**, así que un fallo a mitad no deja nada a medio borrar.
 *
 * ⚠️ **Lo que las llaves foráneas NO garantizan (medido contra el esquema, no supuesto).** Es cierto
 * que muchas relaciones son `RESTRICT` y abortan solas (`UbicacionTelaColor.idAlmacen`,
 * `RecepcionCompra.idOrdenCompra`, `MovimientoDetTela.idPartida`…), pero **NO todas**: los dos FK de
 * `NotaSalidaLinea` al movimiento, `EntradaTela.idMovimiento` y `RecepcionCompraLinea.idMovimiento`
 * son **`SET NULL`**. O sea que ahí la base **no protege**: el documento ajeno se quedaría sin su
 * movimiento y sin avisar. Por eso el guardia de verdad es el **chequeo de invasión del punto 2**, y
 * no el `RESTRICT`. (Con el conjunto cerrado por mapeo, esos casos dejan de ser alcanzables: un
 * movimiento que ampara una nota real o una entrada ajena no está en el mapeo, así que no se toca; y
 * si además tocara material demo, el chequeo aborta antes de empezar.)
 *
 * ⚠️ **La BITÁCORA no se borra.** Sus renglones no tienen FK (guardan entidad + id como texto) y son
 * la huella de auditoría (A7): que sobreviva el rastro de «se sembró y se limpió» es lo correcto.
 */
import type { PrismaClient } from '../../src/datos/index.js';

import { ENTIDAD_DEMO, type EntidadDemo } from './datos.js';

/** Los ids que el sembrador anotó, por tabla. Es TODO lo que `--limpiar` puede tocar. */
export interface ConjuntoDemo {
  proveedores: number[];
  almacenes: number[];
  direcciones: number[];
  telas: number[];
  telaColores: number[];
  avios: number[];
  ordenesCompra: number[];
  entradasTela: number[];
  recepciones: number[];
  movimientos: number[];
  partidas: number[];
  movimientosTercero: number[];
}

/** Qué se borró (lo imprime el script). */
export interface ResultadoLimpieza {
  movimientosTercero: number;
  recepciones: number;
  entradasTela: number;
  movimientos: number;
  partidas: number;
  ordenesCompra: number;
  telas: number;
  avios: number;
  proveedores: number;
  almacenes: number;
  /**
   * Almacenes ficticios que NO se borraron porque guardan cosas de verdad: se dejan DESACTIVADOS
   * (borrado suave, el patrón del proyecto) para no tocar ese inventario. Van con su nombre.
   */
  almacenesConservados: string[];
  direcciones: number;
  mapeos: number;
}

/** Un estorbo que impide limpiar: algo que cuelga de lo ficticio y que el sembrador NO creó. */
export interface Invasor {
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
export class ErrorLimpiezaBloqueada extends Error {
  constructor(readonly invasores: Invasor[]) {
    super('No se puede limpiar: hay documentos que no sembró este script colgando de lo ficticio.');
    this.name = 'ErrorLimpiezaBloqueada';
  }
}

/** Lee los ids anotados bajo una entidad `Demo:*`. */
async function idsDe(cliente: PrismaClient, entidad: EntidadDemo): Promise<number[]> {
  const filas = await cliente.mapeoMigracion.findMany({
    where: { entidad },
    select: { idNuevo: true },
  });
  return [...new Set(filas.map((f) => Number(f.idNuevo)).filter((n) => Number.isFinite(n)))];
}

/** Reúne TODO el conjunto ficticio desde el mapeo (y sólo desde ahí). */
export async function reunirDemo(cliente: PrismaClient): Promise<ConjuntoDemo> {
  return {
    proveedores: await idsDe(cliente, ENTIDAD_DEMO.proveedor),
    almacenes: await idsDe(cliente, ENTIDAD_DEMO.almacen),
    direcciones: await idsDe(cliente, ENTIDAD_DEMO.direccionEntrega),
    telas: await idsDe(cliente, ENTIDAD_DEMO.tela),
    telaColores: await idsDe(cliente, ENTIDAD_DEMO.telaColor),
    avios: await idsDe(cliente, ENTIDAD_DEMO.avio),
    ordenesCompra: await idsDe(cliente, ENTIDAD_DEMO.ordenCompra),
    entradasTela: await idsDe(cliente, ENTIDAD_DEMO.entradaTela),
    recepciones: await idsDe(cliente, ENTIDAD_DEMO.recepcion),
    movimientos: await idsDe(cliente, ENTIDAD_DEMO.movimiento),
    partidas: await idsDe(cliente, ENTIDAD_DEMO.partida),
    movimientosTercero: await idsDe(cliente, ENTIDAD_DEMO.movimientoTercero),
  };
}

/** ¿Está vacío el conjunto (no hay nada sembrado)? */
export function conjuntoVacio(c: ConjuntoDemo): boolean {
  const listas: number[][] = [
    c.proveedores,
    c.almacenes,
    c.direcciones,
    c.telas,
    c.telaColores,
    c.avios,
    c.ordenesCompra,
    c.entradasTela,
    c.recepciones,
    c.movimientos,
    c.partidas,
    c.movimientosTercero,
  ];
  return listas.every((lista) => lista.length === 0);
}

/** Arma un invasor a partir de una lista de ids, o `null` si no hay ninguno. */
function invasor(
  que: string,
  ids: number[],
  comoSeArregla: string,
  sembrados: Set<number>,
): Invasor | null {
  const ajenos = ids.filter((id) => !sembrados.has(id));
  if (ajenos.length === 0) return null;
  return { que, cuantos: ajenos.length, ejemplos: ajenos.slice(0, 10), comoSeArregla };
}

/**
 * Busca lo que cuelga de lo ficticio y que el sembrador NO anotó. Si devuelve algo, NO se borra
 * nada: significa que alguien ya operó encima (o guardó material de verdad en un almacén demo).
 */
export async function detectarInvasores(
  cliente: PrismaClient,
  c: ConjuntoDemo,
): Promise<Invasor[]> {
  const sembradosMov = new Set(c.movimientos);
  const resultado: (Invasor | null)[] = [];

  // (a) Movimientos que tocan MATERIAL ficticio y no los creó el sembrador.
  const movMaterial = (
    await cliente.movimiento.findMany({
      where: {
        OR: [
          { detallesTela: { some: { idTela: { in: c.telas } } } },
          { detallesAvio: { some: { idAvio: { in: c.avios } } } },
        ],
      },
      select: { id: true },
    })
  ).map((x) => x.id);
  resultado.push(
    invasor(
      'movimientos de kardex sobre material DEMO que este script no creó',
      movMaterial,
      'Cancélalos desde la aplicación (cancelar = movimiento inverso, D3) y vuelve a intentarlo.',
      sembradosMov,
    ),
  );

  // (c) Recepciones nuevas sobre una OC ficticia.
  const rec = (
    await cliente.recepcionCompra.findMany({
      where: { idOrdenCompra: { in: c.ordenesCompra } },
      select: { id: true },
    })
  ).map((x) => x.id);
  resultado.push(
    invasor(
      'recepciones capturadas sobre una orden de compra DEMO',
      rec,
      'Revérsalas desde la aplicación antes de limpiar.',
      new Set(c.recepciones),
    ),
  );

  // (d) Entradas de tela nuevas a nombre de un proveedor ficticio.
  const ent = (
    await cliente.entradaTela.findMany({
      where: { idProveedor: { in: c.proveedores } },
      select: { id: true },
    })
  ).map((x) => x.id);
  resultado.push(
    invasor(
      'entradas de tela capturadas a nombre de un proveedor DEMO',
      ent,
      'Cancélalas desde la aplicación antes de limpiar.',
      new Set(c.entradasTela),
    ),
  );

  // (e) Partidas nuevas de un color ficticio.
  const part = (
    await cliente.partidaTela.findMany({
      where: { idTelaColor: { in: c.telaColores } },
      select: { id: true },
    })
  ).map((x) => x.id);
  resultado.push(
    invasor(
      'partidas (lotes) de un color de tela DEMO que este script no creó',
      part,
      'Cancela la entrada o el ajuste que las creó antes de limpiar.',
      new Set(c.partidas),
    ),
  );

  // (f) Movimientos de cuenta corriente (CxP) del proveedor ficticio: cargos, abonos, pagos.
  const mt = (
    await cliente.movimientoTercero.findMany({
      where: { idProveedor: { in: c.proveedores } },
      select: { id: true },
    })
  ).map((x) => x.id);
  resultado.push(
    invasor(
      'movimientos de cuenta corriente (CxP) de un proveedor DEMO que este script no creó',
      mt,
      'Cancélalos en Finanzas antes de limpiar.',
      new Set(c.movimientosTercero),
    ),
  );

  return resultado.filter((x): x is Invasor => x !== null);
}

/**
 * Almacenes ficticios que guardan cosas de VERDAD: algún movimiento que este script no creó, o una
 * ubicación de un color que no es ficticio. **No se borran** (eso arrastraría inventario ajeno);
 * se dejan desactivados, que es el borrado suave que usa todo el proyecto.
 *
 * ⚠️ Y no se puede simplemente intentar borrarlos «a ver si se puede»: `Movimiento.idAlmacen` y
 * `UbicacionTelaColor.idAlmacen` son RESTRICT, así que el intento tumbaría la transacción ENTERA y
 * la limpieza no se podría hacer nunca más en esa base.
 */
export async function almacenesOcupados(
  cliente: PrismaClient,
  c: ConjuntoDemo,
): Promise<{ id: number; nombre: string; motivo: string }[]> {
  const ocupados: { id: number; nombre: string; motivo: string }[] = [];
  for (const id of c.almacenes) {
    const alm = await cliente.almacen.findUnique({ where: { id }, select: { nombre: true } });
    if (alm === null) continue;
    const movsAjenos = await cliente.movimiento.count({
      where: { idAlmacen: id, id: { notIn: c.movimientos } },
    });
    const ubicAjenas = await cliente.ubicacionTelaColor.count({
      where: { idAlmacen: id, idTelaColor: { notIn: c.telaColores } },
    });
    if (movsAjenos > 0 || ubicAjenas > 0) {
      ocupados.push({
        id,
        nombre: alm.nombre,
        motivo:
          movsAjenos > 0
            ? `${String(movsAjenos)} movimiento(s) de material que este script no sembró`
            : `${String(ubicAjenas)} ubicación(es) de material ajeno`,
      });
    }
  }
  return ocupados;
}

/** Lo que se borraría, tabla por tabla (para el ensayo en seco: exactamente lo que se va a borrar). */
export function planDeLimpieza(
  c: ConjuntoDemo,
  ocupados: { nombre: string; motivo: string }[] = [],
): ResultadoLimpieza {
  return {
    movimientosTercero: c.movimientosTercero.length,
    recepciones: c.recepciones.length,
    entradasTela: c.entradasTela.length,
    movimientos: c.movimientos.length,
    partidas: c.partidas.length,
    ordenesCompra: c.ordenesCompra.length,
    telas: c.telas.length,
    avios: c.avios.length,
    proveedores: c.proveedores.length,
    almacenes: c.almacenes.length - ocupados.length,
    almacenesConservados: ocupados.map((o) => `${o.nombre} (${o.motivo})`),
    direcciones: c.direcciones.length,
    mapeos: 0,
  };
}

/**
 * Borra lo sembrado, en una sola transacción y en orden de dependencia. Lanza
 * {@link ErrorLimpiezaBloqueada} —**sin escribir nada**— si alguien operó encima.
 */
export async function limpiarDemoInventarios(cliente: PrismaClient): Promise<ResultadoLimpieza> {
  const c = await reunirDemo(cliente);
  const invasores = await detectarInvasores(cliente, c);
  if (invasores.length > 0) throw new ErrorLimpiezaBloqueada(invasores);

  // Los almacenes que guardan cosas de verdad NO se borran: se desactivan (ver `almacenesOcupados`).
  const ocupados = await almacenesOcupados(cliente, c);
  const idsOcupados = new Set(ocupados.map((o) => o.id));
  const almacenesABorrar = c.almacenes.filter((id) => !idsOcupados.has(id));

  // Los DERIVADOS (inversos de cancelación, correcciones) apuntan a su original con RESTRICT: van
  // en una primera pasada, o la base impediría borrar al original.
  const movInversos = (
    await cliente.movimiento.findMany({
      where: { id: { in: c.movimientos }, idMovimientoInverso: { not: null } },
      select: { id: true },
    })
  ).map((x) => x.id);
  const mtDerivados = (
    await cliente.movimientoTercero.findMany({
      where: {
        id: { in: c.movimientosTercero },
        OR: [{ idMovimientoInverso: { not: null } }, { idMovimientoCorregido: { not: null } }],
      },
      select: { id: true },
    })
  ).map((x) => x.id);
  const enDosPasadas = (todos: number[], primero: number[]): [number[], number[]] => {
    const set = new Set(primero);
    return [primero, todos.filter((id) => !set.has(id))];
  };
  const [mtA, mtB] = enDosPasadas(c.movimientosTercero, mtDerivados);
  const [movA, movB] = enDosPasadas(c.movimientos, movInversos);

  return cliente.$transaction(async (tx) => {
    const mt1 = await tx.movimientoTercero.deleteMany({ where: { id: { in: mtA } } });
    const mt2 = await tx.movimientoTercero.deleteMany({ where: { id: { in: mtB } } });
    const rec = await tx.recepcionCompra.deleteMany({ where: { id: { in: c.recepciones } } });
    const ent = await tx.entradaTela.deleteMany({ where: { id: { in: c.entradasTela } } });
    const mv1 = await tx.movimiento.deleteMany({ where: { id: { in: movA } } });
    const mv2 = await tx.movimiento.deleteMany({ where: { id: { in: movB } } });
    const par = await tx.partidaTela.deleteMany({ where: { id: { in: c.partidas } } });
    const oc = await tx.ordenCompra.deleteMany({ where: { id: { in: c.ordenesCompra } } });
    const tel = await tx.tela.deleteMany({ where: { id: { in: c.telas } } });
    const avi = await tx.avio.deleteMany({ where: { id: { in: c.avios } } });
    const pro = await tx.proveedor.deleteMany({ where: { id: { in: c.proveedores } } });
    const alm = await tx.almacen.deleteMany({ where: { id: { in: almacenesABorrar } } });
    // Borrado SUAVE de los que guardan material ajeno: se quedan, apagados, con su inventario intacto.
    if (idsOcupados.size > 0) {
      await tx.almacen.updateMany({
        where: { id: { in: [...idsOcupados] } },
        data: { activo: false },
      });
    }
    const dir = await tx.direccionEntrega.deleteMany({ where: { id: { in: c.direcciones } } });
    const map = await tx.mapeoMigracion.deleteMany({
      where: { entidad: { in: Object.values(ENTIDAD_DEMO) } },
    });
    return {
      movimientosTercero: mt1.count + mt2.count,
      recepciones: rec.count,
      entradasTela: ent.count,
      movimientos: mv1.count + mv2.count,
      partidas: par.count,
      ordenesCompra: oc.count,
      telas: tel.count,
      avios: avi.count,
      proveedores: pro.count,
      almacenes: alm.count,
      almacenesConservados: ocupados.map((o) => `${o.nombre} (${o.motivo})`),
      direcciones: dir.count,
      mapeos: map.count,
    };
  });
}
