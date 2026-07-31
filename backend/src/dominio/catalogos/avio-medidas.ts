/**
 * MEDIDAS de un avío "por medida" (rediseño R5, B11) — cierres, elástico… El avío se COSTEA con un
 * solo precio en el precosto (el PROMEDIO SIMPLE de los precios de las medidas ACTIVAS) pero se COMPRA
 * por medida, cada una con su precio real. Las medidas viven agrupadas DENTRO del avío padre (decisión
 * Daniel): NO son avíos independientes del catálogo.
 *
 * Se administran como un SET completo desde la pantalla de Avíos (sección expandible "Medidas del
 * avío"), como los proveedores del avío: `reemplazarMedidasAvio` sincroniza (agrega/actualiza/desactiva)
 * en UNA transacción (A2). El borrado es SUAVE (`activo=false`): preserva el amarre medida×talla
 * (`ModeloAvioTalla.idAvioMedida`, SetNull) y el historial; re-agregar una medida la reactiva (por eso
 * el diff casa por ETIQUETA, respaldado por el `@@unique([idAvio, medida])`). Toda la lógica AQUÍ (A1).
 */
import { esquemaAvioMedidasCuerpo, type DatosAvioMedidas } from '../../contrato/index.js';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorNoEncontrado } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { num, redondear2 } from '../costos/decimales.js';

/** Una medida del avío tal como la devuelve la API. */
export interface MedidaAvioSalida {
  id: number;
  medida: string;
  precio: number;
  orden: number;
  activo: boolean;
}

/** Las medidas de un avío + el promedio (activas) que usa el precosto. */
export interface MedidasDeAvio {
  datos: MedidaAvioSalida[];
  promedioPreCosto: number | null;
}

/** Exige que el avío exista (o lanza `ErrorNoEncontrado`). */
async function exigirAvio(tx: Tx, idAvio: number): Promise<void> {
  const avio = await tx.avio.findUnique({ where: { id: idAvio }, select: { id: true } });
  if (avio === null) {
    throw new ErrorNoEncontrado('Avio', idAvio);
  }
}

/** Proyecta las medidas (ordenadas) + el promedio de las ACTIVAS (el que usa el precosto). */
function proyectarMedidas(
  filas: {
    id: number;
    medida: string;
    precio: { toNumber(): number };
    orden: number;
    activo: boolean;
  }[],
): MedidasDeAvio {
  const datos = filas.map((f) => ({
    id: f.id,
    medida: f.medida,
    precio: f.precio.toNumber(),
    orden: f.orden,
    activo: f.activo,
  }));
  const activas = datos.filter((d) => d.activo);
  const promedioPreCosto =
    activas.length === 0
      ? null
      : redondear2(activas.reduce((s, d) => s + d.precio, 0) / activas.length);
  return { datos, promedioPreCosto };
}

/**
 * Lista las medidas de un avío (ordenadas por `orden`, luego `medida`) + el promedio de precios de las
 * ACTIVAS (`promedioPreCosto`, el valor que usa el precosto). Requiere `avios.ver`. Exige que el avío
 * exista.
 */
export async function listarMedidasDeAvio(
  sesion: SesionUsuario,
  idAvio: number,
  bd?: ContextoBd,
): Promise<MedidasDeAvio> {
  verificarPermiso(sesion, 'avios.ver');
  const cliente = clienteLectura(bd);
  const avio = await cliente.avio.findUnique({ where: { id: idAvio }, select: { id: true } });
  if (avio === null) {
    throw new ErrorNoEncontrado('Avio', idAvio);
  }
  const filas = await cliente.avioMedida.findMany({
    where: { idAvio },
    orderBy: [{ orden: 'asc' }, { medida: 'asc' }],
  });
  return proyectarMedidas(filas);
}

/**
 * Reemplaza el SET de medidas de un avío en UNA transacción (A2): las que siguen se ACTUALIZAN
 * (precio/orden/reactivar), las nuevas se CREAN y las que ya no vienen se DESACTIVAN (borrado suave, no
 * físico — preserva el amarre medida×talla y el historial). El diff casa por ETIQUETA (unique dentro
 * del avío). Requiere `avios.administrar`. Devuelve las medidas resultantes + el promedio del precosto.
 */
export async function reemplazarMedidasAvio(
  sesion: SesionUsuario,
  idAvio: number,
  entrada: DatosAvioMedidas,
  bd?: ContextoBd,
): Promise<MedidasDeAvio> {
  verificarPermiso(sesion, 'avios.administrar');
  const datos: DatosAvioMedidas = validarEntrada(esquemaAvioMedidasCuerpo, entrada);

  return enTransaccion(async (tx) => {
    await exigirAvio(tx, idAvio);

    const actuales = await tx.avioMedida.findMany({ where: { idAvio } });
    const actualPorLabel = new Map(actuales.map((m) => [m.medida, m]));
    const deseadosLabels = new Set(datos.medidas.map((m) => m.medida));

    // Agrega/actualiza (reactivando si estaba desactivada) por etiqueta.
    let i = 0;
    for (const deseado of datos.medidas) {
      const orden = deseado.orden ?? i;
      const actual = actualPorLabel.get(deseado.medida);
      if (actual === undefined) {
        await tx.avioMedida.create({
          data: {
            idAvio,
            medida: deseado.medida,
            precio: deseado.precio,
            orden,
            ...datosCreacion(sesion),
          },
        });
      } else {
        const cambia =
          num(actual.precio) !== deseado.precio || actual.orden !== orden || !actual.activo;
        if (cambia) {
          await tx.avioMedida.update({
            where: { id: actual.id },
            data: { precio: deseado.precio, orden, activo: true, ...datosModificacion(sesion) },
          });
        }
      }
      i += 1;
    }

    // Desactiva (borrado suave) las que ya no vienen y siguen activas.
    for (const actual of actuales) {
      if (!deseadosLabels.has(actual.medida) && actual.activo) {
        await tx.avioMedida.update({
          where: { id: actual.id },
          data: { activo: false, ...datosModificacion(sesion) },
        });
      }
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'Avio',
      idEntidad: idAvio,
      accion: 'MODIFICAR',
      datos: { operacion: 'medidas', total: datos.medidas.length },
    });

    const filas = await tx.avioMedida.findMany({
      where: { idAvio },
      orderBy: [{ orden: 'asc' }, { medida: 'asc' }],
    });
    return proyectarMedidas(filas);
  }, bd);
}
