/**
 * MODO MIGRACIÓN del módulo MODELOS (V1-E8j) — capa de dominio (A1).
 *
 * El servicio normal (`modelos.ts` → `crearModelo`) está afinado para la CAPTURA nueva y desde
 * §Post-F9.134 hace nacer **todo modelo en DESARROLLO**: sin nº de producción, con el código
 * tecleado guardado además como `codigoDesarrollo`, y con el catálogo de producción llenándose
 * SÓLO por «pasar a producción». Es lo correcto para el día a día y es lo que Daniel pidió.
 *
 * El ETL del histórico de Access carga otra cosa: **~4,987 modelos que YA son de producción y no
 * tienen orden ninguna** — su código de 5 dígitos de siempre *es* su nº de producción, nunca
 * pasaron por Desarrollo y no tienen nº de desarrollo que conservar. Si entraran por el servicio
 * normal quedarían todos marcados como desarrollo, con un `codigoDesarrollo` inventado y sin poblar
 * `numeroProduccion` — o sea, el generador del consecutivo dejaría de ver ocupadas las series
 * reales del Access.
 *
 * Para no ENSUCIAR el servicio normal con banderas de migración (el API REST queda INTACTO: esta
 * función NO se expone en ninguna ruta Zod/REST), el modo migración vive aquí, igual que en
 * órdenes (`produccion/migracion.ts`), compras, notas, inventarios, RC y terceros.
 *
 * Lo que hace, y lo único que RELAJA: reusa `crearModelo` entero —las mismas validaciones de
 * código único global, temporada/curva/género/tipo de producto, la misma auditoría y la misma
 * bitácora (A7)— y, DENTRO DE LA MISMA TRANSACCIÓN (A2), reasienta las tres columnas de la
 * separación desarrollo/producción:
 *
 *  • `origen: 'produccion'` — el histórico nace en el catálogo de producción.
 *  • `codigoDesarrollo: null` — nunca fue de desarrollo; inventarle uno haría que su código
 *    apareciera DOS veces en la búsqueda por texto.
 *  • `numeroProduccion` derivado del código cuando tiene la forma de 5 dígitos, para que **OCUPE**
 *    su consecutivo (285 de los 4,987 traen códigos no numéricos —`51783a`, `M-18`— y ésos se
 *    quedan en null, como manda el esquema).
 */
import type { Modelo } from '../../datos/index.js';

import type { SesionUsuario } from '../../comun/permisos.js';
import { enTransaccion, type ContextoBd } from '../../comun/transaccion.js';

import {
  crearModelo,
  incluirRelacionesModelo,
  type EntradaCrearModelo,
  type ModeloConRelaciones,
} from './modelos.js';
import { numeroProduccionDeCodigo } from './nomenclatura.js';

/**
 * Crea un modelo HISTÓRICO, ya en el catálogo de producción (ETL de Access, F1-E7).
 *
 * @param sesion Sesión del ETL (necesita `modelos.administrar`, igual que el alta normal).
 * @param entrada Los mismos datos del alta normal (código, descripción, maquila…).
 * @param bd Contexto de BD: el loader pasa su cliente; si ya hay `tx`, se une a ella (A2).
 */
export async function crearModeloMigrado(
  sesion: SesionUsuario,
  entrada: EntradaCrearModelo,
  bd?: ContextoBd,
): Promise<ModeloConRelaciones> {
  return enTransaccion(async (tx) => {
    const modelo: Modelo = await crearModelo(sesion, entrada, { tx });
    return tx.modelo.update({
      where: { id: modelo.id },
      data: {
        origen: 'produccion',
        codigoDesarrollo: null,
        numeroProduccion: numeroProduccionDeCodigo(modelo.codigo),
      },
      include: incluirRelacionesModelo,
    });
  }, bd);
}
