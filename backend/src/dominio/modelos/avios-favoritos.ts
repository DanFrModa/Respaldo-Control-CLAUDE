/**
 * ⭐ V1-E3v (§Post-F9.90) — Los avíos FAVORITOS se SUGIEREN al armar la receta del MODELO, y se
 * aceptan de UN acto.
 *
 * > Daniel: *"cuando damos de alta una receta, deberíamos de tener algunos avíos «favoritos». Todo
 * > lleva etiqueta de lavado, por ejemplo. (…) Y debemos de tenerla con 1 pieza por default."* — y
 * > sobre cómo: *"los favoritos aparecen como sugerencia. **Pero solo hay que aceptarlos y ya.**"*
 *
 * ## Lo que este archivo NO inventa
 * `Avio.favorito` y `Avio.cantFav` existen desde F1-E3 con su regla validada (favorito ⇒ `cantFav`
 * > 0, `catalogos/avios.ts`). Lo que faltaba —y es TODO lo que agrega esta etapa— es que alguien
 * los LEA al armar la receta: hasta hoy se podía marcar un avío como favorito con su cantidad y al
 * armar el BOM no pasaba nada (el patrón "el dato llega al modelo y no al usuario").
 *
 * 🔴 **Cuáles son favoritos es un DATO, no una regla.** Aquí NO hay ninguna lista cableada de
 * "etiqueta de lavado / etiqueta de marca": se lee lo que Daniel haya marcado en el catálogo de
 * avíos, cuando lo marque. Si no hay ninguno marcado, no hay sugerencia — y eso es correcto.
 * Lo mismo con la cantidad: el *"1 pieza por default"* sale de `cantFav` de CADA avío, no de una
 * constante en el código.
 *
 * ## A1 — la pantalla no decide nada
 * Quién es favorito, con cuánto, cuáles faltan en esta receta y cuáles ya están: TODO lo dice el
 * servidor ({@link sugerirAviosFavoritos}). La UI solo pinta y pide aceptar.
 *
 * ## Aceptar es aditivo y de un acto (A2)
 * {@link aceptarAviosFavoritos} agrega en UNA transacción los favoritos que FALTAN, con su
 * `cantFav` como consumo. **No toca ni un renglón que ya esté** (ni el consumo, ni las banderas, ni
 * el amarre de precio, ni las medidas por talla) y **no borra nada** (D3): es un `createMany` de lo
 * que falta, no el PUT set-completo del BOM. Por eso aceptar dos veces seguidas es inofensivo —la
 * segunda no agrega nada— y por eso un favorito que ya está puesto NUNCA se duplica.
 *
 * ## Un favorito marcado SIN cantidad no se adivina
 * La regla favorito ⇒ `cantFav` > 0 se validó desde que existe, pero el ETL y las filas viejas
 * pudieron entrar sin ella. Un avío así NO se sugiere (inventarle un consumo sería escribir como
 * hecho una suposición — la lección de §Post-F9.86) pero **tampoco se calla**: sale en
 * `sinCantidad` para que la pantalla lo diga y alguien vaya a completarlo al catálogo.
 */
import type { PrismaClient } from '../../datos/index.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';

import { registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { CODIGO_PRISMA, codigoErrorPrisma } from '../../comun/prisma-errores.js';
import { clienteLectura, enTransaccion } from '../../comun/transaccion.js';

import { leerAviosBom, type ModeloAvioDetalle } from './bom-modelo.js';
import { tocarModeloPorCambioDeReceta } from './revision-modelo.js';
import { exigirModelo } from './modelos.js';
import { resolverIdRecetaDeModelo } from './receta-compartida.js';

/**
 * Cliente de LECTURA: la sugerencia es un GET y puede correr fuera de transacción, así que sus
 * ayudantes aceptan lo que devuelve `clienteLectura` (el `PrismaClient` o el `Tx` de una tx viva).
 */
type Lector = Tx | PrismaClient;

/** Un avío favorito, tal como lo ve la sugerencia. */
export interface AvioFavorito {
  idAvio: number;
  clave: string;
  descripcion: string;
  /**
   * La cantidad que se va a poner de consumo por prenda: es `Avio.cantFav`, el dato del catálogo.
   * NUNCA una constante (el *"1 pieza"* de Daniel es el `cantFav` que él capture, no un 1 cableado).
   */
  cantidadSugerida: number;
  /** Unidad de CONSUMO del avío (pza, m…), para que la sugerencia diga "1 pza" y no "1". */
  unidad: string | null;
}

/** Lo que el servidor sabe de los favoritos frente a la receta de UN modelo. */
export interface SugerenciaAviosFavoritos {
  /** Favoritos que NO están en la receta: son los que se agregan al aceptar. */
  sugeridos: AvioFavorito[];
  /** Favoritos que la receta YA tiene (se dicen para no prometer de más; no se vuelven a agregar). */
  yaEnLaReceta: AvioFavorito[];
  /**
   * Avíos marcados favoritos SIN `cantFav` > 0: no se pueden sugerir sin inventarles el consumo.
   * Se listan para que la pantalla lo diga en vez de esconderlos.
   */
  sinCantidad: { idAvio: number; clave: string; descripcion: string }[];
}

/** Fila cruda del catálogo que necesita la sugerencia. */
interface FilaFavorita {
  id: number;
  clave: string;
  descripcion: string;
  unidad: string | null;
  cantFav: { toNumber: () => number } | null;
}

/**
 * Los avíos marcados FAVORITOS y activos, en orden de clave (determinista: la sugerencia se lee de
 * arriba abajo y no puede bailar entre visitas). Incluye los que no tienen `cantFav` — separarlos
 * es trabajo de quien llama, porque los dos buckets se reportan.
 */
async function leerFavoritosDelCatalogo(tx: Lector): Promise<FilaFavorita[]> {
  return tx.avio.findMany({
    where: { activo: true, favorito: true },
    select: { id: true, clave: true, descripcion: true, unidad: true, cantFav: true },
    orderBy: { clave: 'asc' },
  });
}

/** ¿Esta fila trae una cantidad preestablecida usable (> 0)? */
function cantidadUsable(fila: FilaFavorita): number | null {
  if (fila.cantFav === null) return null;
  const valor = fila.cantFav.toNumber();
  return valor > 0 ? valor : null;
}

/** Proyecta una fila con cantidad usable al avío favorito de la salida. */
function aFavorito(fila: FilaFavorita, cantidadSugerida: number): AvioFavorito {
  return {
    idAvio: fila.id,
    clave: fila.clave,
    descripcion: fila.descripcion,
    cantidadSugerida,
    unidad: fila.unidad,
  };
}

/**
 * Ids de los avíos que la receta del modelo YA tiene.
 *
 * ⭐ V1-E9b — «la receta del modelo» es la del modelo del que **se lee** la receta: con un hijo del
 * linaje 1:N (V1-E9a) es la de su modelo de DESARROLLO. Sin esto, la sugerencia le ofrecería a un
 * hijo avíos que su receta compartida ya trae.
 */
async function idsAviosDelBom(tx: Lector, idModelo: number): Promise<Set<number>> {
  const filas = await tx.modeloAvio.findMany({
    where: { idModelo: await resolverIdRecetaDeModelo(tx, idModelo) },
    select: { idAvio: true },
  });
  return new Set(filas.map((f) => f.idAvio));
}

/** Parte los favoritos en los tres buckets de la sugerencia. */
function repartir(filas: FilaFavorita[], puestos: ReadonlySet<number>): SugerenciaAviosFavoritos {
  const sugeridos: AvioFavorito[] = [];
  const yaEnLaReceta: AvioFavorito[] = [];
  const sinCantidad: SugerenciaAviosFavoritos['sinCantidad'] = [];
  for (const fila of filas) {
    const cantidad = cantidadUsable(fila);
    if (cantidad === null) {
      sinCantidad.push({ idAvio: fila.id, clave: fila.clave, descripcion: fila.descripcion });
    } else if (puestos.has(fila.id)) {
      yaEnLaReceta.push(aFavorito(fila, cantidad));
    } else {
      sugeridos.push(aFavorito(fila, cantidad));
    }
  }
  return { sugeridos, yaEnLaReceta, sinCantidad };
}

/**
 * Qué favoritos sugerirle a la receta de este modelo (A1: lo decide el servidor). Requiere
 * `modelos.ver` y que el modelo exista (404 si no).
 *
 * ⚠️ La sugerencia se calcula IGUAL con la receta vacía y con la receta llena — no se apaga porque
 * ya haya renglones (decisión de la etapa, §Post-F9.90): quien agrega la tercera tela de un modelo
 * a medio armar necesita el recordatorio tanto como quien empieza de cero. Lo que cambia con los
 * renglones ya puestos es QUÉ se sugiere: un favorito que ya está sale por `yaEnLaReceta` y el
 * resto se sigue ofreciendo.
 */
export async function sugerirAviosFavoritos(
  sesion: SesionUsuario,
  idModelo: number,
  bd?: ContextoBd,
): Promise<SugerenciaAviosFavoritos> {
  verificarPermiso(sesion, 'modelos.ver');
  const cliente = clienteLectura(bd);
  // El modelo tiene que existir: sin él la sugerencia no significa nada (404, no una lista vacía).
  const existe = await cliente.modelo.findUnique({ where: { id: idModelo }, select: { id: true } });
  if (existe === null) throw new ErrorNoEncontrado('Modelo', idModelo);
  const [filas, puestos] = await Promise.all([
    leerFavoritosDelCatalogo(cliente),
    idsAviosDelBom(cliente, idModelo),
  ]);
  return repartir(filas, puestos);
}

/** Lo que devuelve aceptar: cuántos entraron y cómo quedó la receta de avíos. */
export interface ResultadoAceptarFavoritos {
  /** Cuántos renglones se agregaron de verdad (0 = ya estaban todos, y se dice). */
  agregados: number;
  /** Claves de los avíos agregados, para poder nombrarlos en el aviso. */
  clavesAgregadas: string[];
  /** La receta de avíos completa tras aceptar (misma forma que el PUT del BOM). */
  avios: ModeloAvioDetalle[];
}

/**
 * ⭐ EL ACTO ÚNICO: acepta TODOS los favoritos que le faltan a la receta, en UNA transacción (A2).
 *
 * Aditivo por diseño: agrega los que faltan con su `cantFav` como consumo y las tres banderas 🔑 en
 * true (el default del alta a mano), y **no toca ningún renglón existente** ni borra nada (D3). Es
 * idempotente: llamarlo dos veces no duplica (la segunda agrega 0).
 *
 * Requiere `modelos.administrar`. Si una carrera concurrente mete el mismo avío entre la lectura y
 * la escritura, el único de la tabla lo ataja y sale un 409 —nunca un renglón repetido—.
 */
export async function aceptarAviosFavoritos(
  sesion: SesionUsuario,
  idModelo: number,
  bd?: ContextoBd,
): Promise<ResultadoAceptarFavoritos> {
  verificarPermiso(sesion, 'modelos.administrar');
  return enTransaccion(async (tx) => {
    await exigirModelo(tx, idModelo);
    const [filas, puestos] = await Promise.all([
      leerFavoritosDelCatalogo(tx),
      idsAviosDelBom(tx, idModelo),
    ]);
    const { sugeridos } = repartir(filas, puestos);

    if (sugeridos.length > 0) {
      try {
        await tx.modeloAvio.createMany({
          data: sugeridos.map((f) => ({
            idModelo,
            idAvio: f.idAvio,
            // 🔑 La cantidad es la del CATÁLOGO (`cantFav`), no un número de esta función.
            consumoPorPrenda: f.cantidadSugerida,
            paraPreCosto: true,
            paraProduccion: true,
            paraCosto: true,
            idAvioProveedor: null,
            creadoPorId: sesion.id,
            modificadoPorId: sesion.id,
          })),
        });
      } catch (error) {
        if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
          throw new ErrorConflicto(
            'Alguien agregó uno de esos avíos a la receta al mismo tiempo. Vuelve a abrir la sugerencia.',
          );
        }
        throw error;
      }
      await tocarModeloPorCambioDeReceta(tx, sesion, idModelo, 'avios');
      await registrarBitacora(tx, sesion, {
        entidad: 'Modelo',
        idEntidad: idModelo,
        accion: 'MODIFICAR',
        datos: {
          bom: 'avios',
          aceptarFavoritos: sugeridos.map((f) => ({
            idAvio: f.idAvio,
            clave: f.clave,
            consumoPorPrenda: f.cantidadSugerida,
          })),
        },
      });
    }

    return {
      agregados: sugeridos.length,
      clavesAgregadas: sugeridos.map((f) => f.clave),
      avios: await leerAviosBom(tx, idModelo, sesion.idEmpresaActiva),
    };
  }, bd);
}
