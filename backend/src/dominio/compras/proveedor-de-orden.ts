/**
 * ⭐ **EL COMPRADOR DESATORA DESDE SU PANTALLA — SOLO PARA ESA OP** (V1-E3m, `DECISIONES.md`
 * §Post-F9.82). Asigna (o quita) el proveedor de un material **dentro de UNA orden de producción**,
 * sin tocar el catálogo.
 *
 * DE DÓNDE SALE. Daniel, 20-ago-2026: *"el comprador podría asignarle un proveedor y no esperar a
 * que la gente de desarrollo se lo asigne… debería haber una manera de que el comprador pueda
 * destrabarlo desde su área"*. Y su restricción, textual y no negociable: *"el comprador asigna un
 * proveedor **para esa OP en particular**… no para siempre ni para todo. **El proveedor puede seguir
 * viniendo desde desarrollo**"*.
 *
 * ⭐ **DÓNDE VIVE Y POR QUÉ.** En la RECETA CONGELADA de la orden (`OrdenTela.idProveedorCompra` /
 * `OrdenAvio.idProveedorCompra`), que es la misma casa de todo lo que es "de esta orden y no del
 * catálogo": *el catálogo propone, la orden manda* (D3/§Post-F9.43). Consecuencias buscadas:
 *  • una compra de urgencia **no se vuelve permanente** sin que nadie lo decida;
 *  • **Desarrollo conserva su autoridad**: esta asignación es el ÚLTIMO escalón de la resolución
 *    (`proveedor-material.ts`), así que jamás pisa un amarre ni al dueño de la tela;
 *  • y la explosión **la nombra** cuando quedó dormida, en vez de callarla (D3).
 *
 * Innegociables: A1 (toda la regla aquí, la ruta solo valida y delega) · A2 (una transacción) ·
 * A4 (`compras.administrar`, el mismo permiso que genera las OC: quien compra, desatora) ·
 * A7 (auditoría + bitácora con lo viejo y lo nuevo) · A9 (orden de la empresa activa, o 404).
 */
import { randomUUID } from 'node:crypto';

import type {
  AsignarProveedorEnBloqueSalida,
  AsignarProveedorSalida,
  DatosAsignarProveedor,
  DatosAsignarProveedorEnBloque,
} from '../../contrato/index.js';

import { datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { enTransaccion, type ContextoBd, type Tx } from '../../comun/transaccion.js';
import { numOrNull } from '../costos/decimales.js';

/** El renglón de receta afectado, en la forma mínima que esta operación necesita. */
interface RenglonReceta {
  id: number;
  material: string;
  excluido: boolean;
  idProveedorCompraPrevio: number | null;
  precioCompraPrevio: number | null;
}

/** Lee el renglón de TELA de la receta de la orden, o lanza el error que explica qué falta. */
async function renglonTela(tx: Tx, idOrden: number, idTela: number): Promise<RenglonReceta> {
  const fila = await tx.ordenTela.findFirst({
    where: { idOrden, idTela },
    select: {
      id: true,
      excluido: true,
      idProveedorCompra: true,
      precioCompra: true,
      tela: { select: { nombre: true } },
    },
  });
  if (fila === null) {
    throw new ErrorValidacion(
      'Esa tela no está en la receta de esta orden, así que no se le puede asignar proveedor aquí. ' +
        'Si de verdad hay que comprarla para la orden, agrégala a la receta o captura la OC a mano.',
    );
  }
  return {
    id: fila.id,
    material: fila.tela.nombre,
    excluido: fila.excluido,
    idProveedorCompraPrevio: fila.idProveedorCompra,
    precioCompraPrevio: numOrNull(fila.precioCompra),
  };
}

/** Lee el renglón de AVÍO de la receta de la orden, o lanza el error que explica qué falta. */
async function renglonAvio(tx: Tx, idOrden: number, idAvio: number): Promise<RenglonReceta> {
  const fila = await tx.ordenAvio.findFirst({
    where: { idOrden, idAvio },
    select: {
      id: true,
      excluido: true,
      idProveedorCompra: true,
      precioCompra: true,
      avio: { select: { clave: true, descripcion: true } },
    },
  });
  if (fila === null) {
    throw new ErrorValidacion(
      'Ese avío no está en la receta de esta orden, así que no se le puede asignar proveedor aquí. ' +
        'Si de verdad hay que comprarlo para la orden, agrégalo a la receta o captura la OC a mano.',
    );
  }
  return {
    id: fila.id,
    material: `${fila.avio.clave} — ${fila.avio.descripcion}`,
    excluido: fila.excluido,
    idProveedorCompraPrevio: fila.idProveedorCompra,
    precioCompraPrevio: numOrNull(fila.precioCompra),
  };
}

/**
 * ⭐ V1-E3x (§Post-F9.88) — **LA MARCA DEL ACTO EN BLOQUE**. Cuando N renglones se asignan de un
 * golpe, cada uno deja su renglón de bitácora (el detalle no se pierde) pero los N llevan ESTA
 * marca: mismo `idLote`, el mismo total y su lugar dentro del acto. Es lo que hace que la bitácora
 * diga *"fueron seis en UN acto"* y no *"seis actos sueltos indistinguibles"* (A7), sin tener que
 * adivinarlo por la hora.
 */
export interface ContextoLote {
  /** Id del acto en bloque; lo comparten los N renglones (y el resumen por orden). */
  idLote: string;
  /** Cuántos renglones lleva el acto COMPLETO (no cuántos van en esta orden). */
  total: number;
  /** Lugar de este renglón dentro del acto (1..total), para poder reconstruir el orden. */
  posicion: number;
}

/**
 * Asigna —o QUITA, con `idProveedor: null`— el proveedor con el que ESTA orden va a comprar un
 * material. Nunca escribe en el catálogo: solo en el renglón de la receta de la orden.
 *
 * Qué rechaza, y por qué cada cosa:
 *  • **orden de otra empresa** → 404 (A9: para esta sesión esa orden no existe);
 *  • **material que no está en la receta de la orden** → se dice, con el camino alterno (la OC a
 *    mano sí permite comprar algo que la receta no lleva; esta pantalla no es esa puerta);
 *  • **renglón EXCLUIDO** (la lápida de §Post-F9.43) → 409: esta orden decidió que NO lo lleva, así
 *    que asignarle proveedor sería preparar una compra que nadie va a hacer;
 *  • **proveedor inexistente o DADO DE BAJA** → se dice con su nombre. Aquí sí se bloquea el
 *    inactivo (a diferencia del amarre viejo, que se conserva y solo avisa): esto es una elección
 *    que se está tomando AHORA, no una heredada que ya estaba tomada.
 *
 * ⚠️ **No exige que el renglón esté LIBERADO.** Asignar proveedor no compra nada; y prohibirlo antes
 * de la firma obligaría a esperar dos veces por el mismo trámite. La puerta de la firma sigue donde
 * tiene que estar: en explotar y en generar la OC (`exigirRecetaLiberada`/`exigirMaterialesLiberados`).
 */
export async function asignarProveedorDeMaterial(
  sesion: SesionUsuario,
  idOrden: number,
  datos: DatosAsignarProveedor,
  bd?: ContextoBd,
  lote?: ContextoLote,
): Promise<AsignarProveedorSalida> {
  verificarPermiso(sesion, 'compras.administrar');
  const idEmpresa = sesion.idEmpresaActiva;

  return enTransaccion(async (tx) => {
    // A9 primero: si la orden es de otra empresa se responde 404 y no se dice nada más de ella.
    const orden = await tx.orden.findFirst({
      where: { id: idOrden, idEmpresa },
      select: { id: true, folio: true },
    });
    if (orden === null) {
      throw new ErrorNoEncontrado('Orden', idOrden);
    }

    const renglon =
      datos.tipo === 'tela'
        ? await renglonTela(tx, idOrden, datos.idMaterial)
        : await renglonAvio(tx, idOrden, datos.idMaterial);

    if (renglon.excluido) {
      throw new ErrorConflicto(
        `"${renglon.material}" está EXCLUIDO de la receta de la orden ${String(orden.folio)}: esta ` +
          `orden no lo lleva, así que no hay a quién comprárselo. Si sí se necesita, restaura el ` +
          `renglón en la receta de la orden.`,
      );
    }

    let nombreProveedor: string | null = null;
    if (datos.idProveedor !== null) {
      const proveedor = await tx.proveedor.findUnique({
        where: { id: datos.idProveedor },
        select: { nombre: true, activo: true },
      });
      if (proveedor === null) {
        throw new ErrorValidacion('El proveedor seleccionado no existe.');
      }
      if (!proveedor.activo) {
        throw new ErrorValidacion(
          `El proveedor "${proveedor.nombre}" está desactivado: no se le puede asignar una compra.`,
        );
      }
      nombreProveedor = proveedor.nombre;
    }

    // El precio solo tiene sentido con proveedor: al QUITAR la asignación se va con ella (dejarlo
    // colgando escondería un número que ya no vale para nada, y alguien lo leería como vigente).
    const precio = datos.idProveedor === null ? null : (datos.precio ?? null);

    const cambios = {
      idProveedorCompra: datos.idProveedor,
      precioCompra: precio,
      ...datosModificacion(sesion),
    };
    if (datos.tipo === 'tela') {
      await tx.ordenTela.update({ where: { id: renglon.id }, data: cambios });
    } else {
      await tx.ordenAvio.update({ where: { id: renglon.id }, data: cambios });
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: idOrden,
      accion: 'OTRO',
      datos: {
        proveedorDeCompraDelMaterial: true,
        tipo: datos.tipo,
        idMaterial: datos.idMaterial,
        material: renglon.material,
        // El ANTES y el DESPUÉS, los dos: quitar una asignación es tan auditable como ponerla.
        idProveedorAnterior: renglon.idProveedorCompraPrevio,
        precioAnterior: renglon.precioCompraPrevio,
        idProveedorNuevo: datos.idProveedor,
        precioNuevo: precio,
        // ⭐ V1-E3x (A7): si vino de un acto en bloque, el renglón lo DICE. Sin esta marca, seis
        // asignaciones del mismo segundo serían seis actos indistinguibles para quien audita.
        ...(lote === undefined
          ? {}
          : { actoEnBloque: { idLote: lote.idLote, total: lote.total, posicion: lote.posicion } }),
      },
    });

    return {
      idOrden,
      tipo: datos.tipo,
      idMaterial: datos.idMaterial,
      material: renglon.material,
      idProveedor: datos.idProveedor,
      proveedor: nombreProveedor,
      precio,
    };
  }, bd);
}

/** Un renglón del acto en bloque: la orden en cuya receta se escribe + qué material es. */
type RenglonDeLote = DatosAsignarProveedorEnBloque['asignaciones'][number];

/**
 * ⭐ V1-E3x — Quita los DUPLICADOS del acto en bloque, conservando el orden en que llegaron.
 *
 * La misma `(orden, tipo, material)` repetida es UN renglón de receta, no dos: escribirla dos veces
 * no cambia nada en la base (el segundo `update` deja lo mismo) pero SÍ cambia el número que el
 * usuario lee al final —*"se asignaron 8"* cuando fueron 6— y el `total` que queda en la bitácora
 * del acto (A7). Un conteo inflado es una mentira barata de producir y cara de descubrir.
 *
 * ⚠️ El tipo entra en la clave: la tela 7 y el avío 7 son materiales DISTINTOS (ids de catálogos
 * distintos), y colapsarlos por el número dejaría uno de los dos sin asignar en silencio.
 *
 * Es una función PURA y exportada a propósito: es la única pieza de este acto que se puede —y se
 * debe— ejercitar sin levantar Postgres.
 */
export function renglonesUnicos(asignaciones: readonly RenglonDeLote[]): RenglonDeLote[] {
  const vistos = new Set<string>();
  return asignaciones.filter((a) => {
    const clave = `${String(a.idOrden)}|${a.tipo}|${String(a.idMaterial)}`;
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
}

/**
 * ⭐⭐ **V1-E3x (§Post-F9.88) — EL MISMO PROVEEDOR A VARIOS RENGLONES, EN UN SOLO ACTO.**
 *
 * DE DÓNDE SALE. Daniel, 21-ago-2026: *"cuando no tengan proveedor los avíos, ya en la pantalla de
 * explosión, podemos hacer una forma de poder poner el proveedor de manera más rápida a varios
 * elementos que lleven el mismo proveedor"*. Con seis avíos del mismo proveedor, la asignación
 * renglón por renglón de §Post-F9.82 son seis veces el mismo tecleo: fricción sin ganancia de
 * control.
 *
 * **POR QUÉ EN BLOQUE AQUÍ SÍ SE VALE** (y firmar la receta NO, §Post-F9.80): *lo que se puede hacer
 * en bloque es lo que **no compromete dinero***. Esto no compra: la OC sigue pasando por la revisión
 * previa (§Post-F9.85) y por su autorización. Y el riesgo del "clickear sin leer" tampoco aplica —
 * aquí no se da un visto bueno, se **captura un dato** que además se vuelve a ver entero en la previa.
 *
 * ── CÓMO ESTÁ HECHA, Y POR QUÉ ASÍ ─────────────────────────────────────────────────────────────
 *
 * **NO valida nada por su cuenta: DELEGA renglón por renglón** en `asignarProveedorDeMaterial`,
 * dentro de UNA sola transacción (A2, `enTransaccion` compone al recibir `{ tx }`). Es la decisión
 * central: una segunda ruta que validara *"casi"* igual —empresa, renglón en la receta, excluido,
 * proveedor de baja— se desincronizaría de la de a uno en la primera corrección, y entonces la vía
 * rápida sería también la vía floja. Aquí sólo hay una regla, y las dos puertas la usan.
 *
 * **TODO O NADA, y el mensaje dice cuál falló.** Si el renglón 4 de 6 está EXCLUIDO (la lápida de
 * §Post-F9.43) o no está en la receta de esa orden, **no se asigna ninguno** y el error nombra la
 * orden, el material y la razón. Aplicar los buenos y reportar los otros dejaría al comprador con
 * una pantalla a medias que sólo entendería releyendo renglón por renglón —justo el trabajo que esta
 * etapa vino a quitar— y con un mensaje de "algunos sí" que nadie termina de leer. Todo-o-nada es
 * además lo único que A2 permite decir sin mentir: o entró el acto, o no entró.
 *
 * ⚠️ **Sigue siendo SÓLO PARA ESAS OP** (§Post-F9.82): cada asignación nombra su orden y se guarda
 * en la receta congelada de esa orden. **El catálogo no se toca nunca** — la vía rápida no puede
 * volverse una puerta trasera para editarlo.
 *
 * ⚠️ **En bloque sólo se PONE proveedor.** Quitarlo sigue siendo renglón por renglón (`idProveedor:
 * null` de la de a uno): quitar es deshacer una decisión puntual y se lleva el precio con ella.
 * Tampoco lleva precio: el precio es de CADA material, y un número para seis avíos distintos sería
 * falso.
 *
 * A7: cada renglón deja su bitácora **marcada con el `idLote` del acto** (`ContextoLote`) y, además,
 * se escribe un **resumen por orden** — de modo que quien audita la orden 1515 ve *"seis renglones,
 * un acto"* sin tener que deducirlo de las horas.
 */
export async function asignarProveedorDeMaterialEnBloque(
  sesion: SesionUsuario,
  datos: DatosAsignarProveedorEnBloque,
  bd?: ContextoBd,
): Promise<AsignarProveedorEnBloqueSalida> {
  verificarPermiso(sesion, 'compras.administrar');
  const idEmpresa = sesion.idEmpresaActiva;

  const unicos = renglonesUnicos(datos.asignaciones);

  return enTransaccion(async (tx) => {
    // A9 de entrada y para TODAS las órdenes: si una sola es de otra empresa se responde 404 y no se
    // escribe nada (ni siquiera de las que sí eran suyas). Se leen aquí, de una, también porque el
    // folio hace falta para el mensaje de confirmación.
    const idsOrden = [...new Set(unicos.map((a) => a.idOrden))];
    const ordenes = await tx.orden.findMany({
      where: { id: { in: idsOrden }, idEmpresa },
      select: { id: true, folio: true },
    });
    // `Orden.folio` es BigInt en el esquema; el contrato del MRP lo expone como `number`
    // (mismo trato que `mrp.ts`), así que se convierte UNA vez, aquí.
    const folioPorOrden = new Map(ordenes.map((o) => [o.id, Number(o.folio)]));
    for (const id of idsOrden) {
      if (!folioPorOrden.has(id)) {
        throw new ErrorNoEncontrado('Orden', id);
      }
    }

    const idLote = randomUUID();
    const asignados: AsignarProveedorEnBloqueSalida['asignados'] = [];
    let proveedor = '';

    for (const [indice, a] of unicos.entries()) {
      const folio = folioPorOrden.get(a.idOrden) ?? 0;
      try {
        // ⚠️ El proveedor se vuelve a verificar en CADA renglón (existe, está activo). Es una
        // lectura por PK dentro de la misma transacción —barata— y el precio de no duplicar la
        // regla aquí: la validación vive en un solo lugar.
        const hecho = await asignarProveedorDeMaterial(
          sesion,
          a.idOrden,
          { tipo: a.tipo, idMaterial: a.idMaterial, idProveedor: datos.idProveedor },
          { tx },
          { idLote, total: unicos.length, posicion: indice + 1 },
        );
        proveedor = hecho.proveedor ?? '';
        asignados.push({
          idOrden: a.idOrden,
          folioOrden: folio,
          tipo: hecho.tipo,
          idMaterial: hecho.idMaterial,
          material: hecho.material,
        });
      } catch (error) {
        // El error de la de a uno ya explica QUÉ pasó; lo que le falta al acto en bloque es DÓNDE
        // (con varias órdenes en pantalla, "ese avío no está en la receta" es ambiguo) y que NO
        // quedó nada a medias. Se conserva la clase del error para que la ruta siga respondiendo
        // 409 lo que era 409 y 400 lo que era 400.
        const donde = `Orden ${String(folio)}: `;
        const cola =
          ` No se asignó NINGUNO de los ${String(unicos.length)} renglones: el acto en bloque ` +
          `es todo o nada. Quita ese material de la selección y vuelve a intentarlo.`;
        if (error instanceof ErrorConflicto) {
          throw new ErrorConflicto(`${error.message}${cola}`);
        }
        if (error instanceof ErrorValidacion) {
          throw new ErrorValidacion(`${donde}${error.message}${cola}`);
        }
        throw error;
      }
    }

    // A7 — EL RESUMEN, uno por orden tocada: quien audita la orden lee "un acto de N renglones",
    // no N renglones sueltos que tenga que juntar por la hora.
    for (const idOrden of idsOrden) {
      const deEstaOrden = asignados.filter((x) => x.idOrden === idOrden);
      await registrarBitacora(tx, sesion, {
        entidad: 'Orden',
        idEntidad: idOrden,
        accion: 'OTRO',
        datos: {
          proveedorDeCompraEnBloque: true,
          idLote,
          idProveedor: datos.idProveedor,
          proveedor,
          renglonesDeEsteActo: unicos.length,
          renglonesDeEstaOrden: deEstaOrden.length,
          materiales: deEstaOrden.map((x) => x.material),
        },
      });
    }

    return {
      idLote,
      idProveedor: datos.idProveedor,
      proveedor,
      renglones: asignados.length,
      ordenes: idsOrden.length,
      asignados,
    };
  }, bd);
}
