/**
 * ⭐⭐ FILA 0.103 — DÓNDE ESTÁ GUARDADO EL MATERIAL DENTRO DEL ALMACÉN.
 *
 * Daniel (2-sep-2026): *«sí quiero que haya un lugar donde está ubicado. Principalmente para telas
 * y avíos»*; cerrada el 3-sep: *«de texto libre está bien. Por ahora NO un catálogo de posiciones —
 * si en algún momento se requiere lo hacemos»*. El sistema ya sabía CUÁNTO hay y EN QUÉ ALMACÉN; lo
 * que le faltaba es lo único que el almacenista necesita para ir por el material: DÓNDE dentro de
 * la bodega.
 *
 * Aquí vive TODA la regla (A1) y las rutas sólo validan permiso + Zod y delegan. Las reglas son
 * cuatro, y las tres primeras están escritas UNA SOLA VEZ ({@link guardarUbicacion}) para que las
 * dos puertas —telas y avíos— no puedan divergir:
 *
 *  1. **El almacén se valida por la MISMA puerta que los movimientos** (`exigirAlmacenDelTipo`):
 *     existe, está activo, es de esta empresa o global (A9) y es del TIPO del artículo (fila
 *     0.137). Un almacén de otra empresa, para esta sesión, no existe — ése es el aislamiento, y
 *     por eso las tablas no llevan `id_empresa` (ver la cabecera del modelo en `schema.prisma`).
 *  2. **VACÍO = BORRAR.** Nunca se guarda una cadena vacía: al vaciar el campo se borra la fila, de
 *     modo que «no hay fila» y «no hay ubicación» son el mismo hecho. Si hubiera dos maneras de
 *     decir «sin ubicación», las consultas tendrían que distinguirlas para siempre.
 *  3. **Todo en UNA transacción con su bitácora** (A2/A7): el cambio y su rastro, juntos o nada.
 *  4. **El artículo tiene que existir** — se comprueba ANTES de escribir, para contestar «no existe
 *     ese color» en vez de un error de llave foránea que no le dice nada a nadie.
 *
 * ⚠️ **NO es un movimiento de inventario y no toca el kardex** (D3 sigue intacto): la ubicación es
 * un ATRIBUTO editable —una nota de dónde está la mercancía—, no un documento. Por eso sí se edita
 * y se borra en el sitio, al contrario que todo lo que mueve existencias.
 *
 * **Permisos REUSADOS, ninguno nuevo**: escribir pide `inventario-telas.mover` /
 * `inventario-avios.mover` — el mismo que ya tiene quien acomoda la mercancía, que es justo quien
 * sabe dónde la puso—, y leerla no pide nada aparte: viaja pegada al renglón de existencia, que ya
 * exige `inventario-telas.ver` / `inventario-avios.ver`.
 */
import {
  esquemaUbicacionAvioFijar,
  esquemaUbicacionTelaColorFijar,
  type UbicacionMaterialSalida,
} from '../../contrato/index.js';
import type { z } from 'zod';

import { exigirAlmacenDelTipo } from '../../comun/almacenes.js';
import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorNoEncontrado } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { enTransaccion, type ContextoBd, type Tx } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Alta/edición de la ubicación de un COLOR DE TELA. */
export type EntradaUbicacionTelaColor = z.input<typeof esquemaUbicacionTelaColorFijar>;

/** Alta/edición de la ubicación de un AVÍO. */
export type EntradaUbicacionAvio = z.input<typeof esquemaUbicacionAvioFijar>;

/** La fila de ubicación, reducida a lo que la regla necesita (sirve a las dos tablas). */
interface FilaUbicacion {
  id: number;
  ubicacion: string;
}

/** Las cuatro operaciones sobre la tabla concreta, para que la regla se escriba una sola vez. */
interface PuertaUbicacion {
  /** Nombre del modelo para la bitácora (A7). */
  entidad: 'UbicacionTelaColor' | 'UbicacionAvio';
  /** La pareja artículo×almacén, tal cual para el `datos` de la bitácora. */
  llave: Record<string, number>;
  buscar: () => Promise<FilaUbicacion | null>;
  crear: (texto: string) => Promise<FilaUbicacion>;
  actualizar: (id: number, texto: string) => Promise<FilaUbicacion>;
  borrar: (id: number) => Promise<void>;
}

/**
 * LA REGLA, una sola vez para telas y avíos: vacío borra, con texto crea o actualiza, y en los tres
 * casos deja bitácora con el antes y el después. Devuelve el texto ya guardado, o `null` si quedó
 * sin ubicación — que es lo que la UI pinta, en vez de re-adivinar lo que el usuario tecleó.
 */
async function guardarUbicacion(
  tx: Tx,
  sesion: SesionUsuario,
  puerta: PuertaUbicacion,
  texto: string,
): Promise<string | null> {
  const actual = await puerta.buscar();

  if (texto.length === 0) {
    // VACÍO = BORRAR. Si no había nada que borrar no se inventa un renglón de bitácora: no cambió
    // nada, y una bitácora de un no-cambio sólo ensucia el rastro de los que sí cambiaron.
    if (actual === null) return null;
    await puerta.borrar(actual.id);
    await registrarBitacora(tx, sesion, {
      entidad: puerta.entidad,
      idEntidad: actual.id,
      accion: 'OTRO',
      datos: { ...puerta.llave, antes: actual.ubicacion, despues: null },
    });
    return null;
  }

  if (actual === null) {
    const creada = await puerta.crear(texto);
    await registrarBitacora(tx, sesion, {
      entidad: puerta.entidad,
      idEntidad: creada.id,
      accion: 'CREAR',
      datos: { ...puerta.llave, despues: creada.ubicacion },
    });
    return creada.ubicacion;
  }

  if (actual.ubicacion === texto) return actual.ubicacion;

  const editada = await puerta.actualizar(actual.id, texto);
  await registrarBitacora(tx, sesion, {
    entidad: puerta.entidad,
    idEntidad: editada.id,
    accion: 'MODIFICAR',
    datos: { ...puerta.llave, antes: actual.ubicacion, despues: editada.ubicacion },
  });
  return editada.ubicacion;
}

/**
 * Fija (o borra, si el texto llega vacío) la ubicación de un COLOR DE TELA en un almacén de TELA.
 * Permiso `inventario-telas.mover`. Ver la cabecera del archivo para las cuatro reglas.
 */
export async function fijarUbicacionTelaColor(
  sesion: SesionUsuario,
  entrada: EntradaUbicacionTelaColor,
  bd?: ContextoBd,
): Promise<UbicacionMaterialSalida> {
  verificarPermiso(sesion, 'inventario-telas.mover');
  const datos = validarEntrada(esquemaUbicacionTelaColorFijar, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  const ubicacion = await enTransaccion(async (tx) => {
    await exigirAlmacenDelTipo(tx, datos.idAlmacen, 'TELA', idEmpresa);
    const color = await tx.telaColor.findUnique({
      where: { id: datos.idTelaColor },
      select: { id: true },
    });
    if (color === null) throw new ErrorNoEncontrado('TelaColor', datos.idTelaColor);

    const llave = { idTelaColor: datos.idTelaColor, idAlmacen: datos.idAlmacen };
    return guardarUbicacion(
      tx,
      sesion,
      {
        entidad: 'UbicacionTelaColor',
        llave,
        buscar: () =>
          tx.ubicacionTelaColor.findUnique({
            where: { idTelaColor_idAlmacen: llave },
            select: { id: true, ubicacion: true },
          }),
        crear: (texto) =>
          tx.ubicacionTelaColor.create({
            data: { ...llave, ubicacion: texto, ...datosCreacion(sesion) },
            select: { id: true, ubicacion: true },
          }),
        actualizar: (id, texto) =>
          tx.ubicacionTelaColor.update({
            where: { id },
            data: { ubicacion: texto, ...datosModificacion(sesion) },
            select: { id: true, ubicacion: true },
          }),
        borrar: async (id) => {
          await tx.ubicacionTelaColor.delete({ where: { id } });
        },
      },
      datos.ubicacion,
    );
  }, bd);

  return { idAlmacen: datos.idAlmacen, ubicacion };
}

/**
 * Fija (o borra, si el texto llega vacío) la ubicación de un AVÍO en un almacén de AVÍO. Permiso
 * `inventario-avios.mover`. Gemela de {@link fijarUbicacionTelaColor} — misma regla, misma puerta.
 */
export async function fijarUbicacionAvio(
  sesion: SesionUsuario,
  entrada: EntradaUbicacionAvio,
  bd?: ContextoBd,
): Promise<UbicacionMaterialSalida> {
  verificarPermiso(sesion, 'inventario-avios.mover');
  const datos = validarEntrada(esquemaUbicacionAvioFijar, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  const ubicacion = await enTransaccion(async (tx) => {
    await exigirAlmacenDelTipo(tx, datos.idAlmacen, 'AVIO', idEmpresa);
    const avio = await tx.avio.findUnique({ where: { id: datos.idAvio }, select: { id: true } });
    if (avio === null) throw new ErrorNoEncontrado('Avio', datos.idAvio);

    const llave = { idAvio: datos.idAvio, idAlmacen: datos.idAlmacen };
    return guardarUbicacion(
      tx,
      sesion,
      {
        entidad: 'UbicacionAvio',
        llave,
        buscar: () =>
          tx.ubicacionAvio.findUnique({
            where: { idAvio_idAlmacen: llave },
            select: { id: true, ubicacion: true },
          }),
        crear: (texto) =>
          tx.ubicacionAvio.create({
            data: { ...llave, ubicacion: texto, ...datosCreacion(sesion) },
            select: { id: true, ubicacion: true },
          }),
        actualizar: (id, texto) =>
          tx.ubicacionAvio.update({
            where: { id },
            data: { ubicacion: texto, ...datosModificacion(sesion) },
            select: { id: true, ubicacion: true },
          }),
        borrar: async (id) => {
          await tx.ubicacionAvio.delete({ where: { id } });
        },
      },
      datos.ubicacion,
    );
  }, bd);

  return { idAlmacen: datos.idAlmacen, ubicacion };
}
