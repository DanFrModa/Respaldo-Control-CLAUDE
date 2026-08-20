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
import type { AsignarProveedorSalida, DatosAsignarProveedor } from '../../contrato/index.js';

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
