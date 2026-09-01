/**
 * ⭐ LAS FOTOS DEL ARTE SON **DE LA OP** (§Post-F9.177) — heredar, ocultar y agregar, por RENGLÓN
 * de arte de la orden.
 *
 * 🔴 DANIEL, textual: *«Un modelo de desarrollo que se va a usar para **4 órdenes diferentes** no
 * puede usar la misma foto ni del modelo **ni de arte** para todas las OP. Tendría que haber la
 * posibilidad de **modificar las fotos directamente en la OP**. Entiendo que **la OP es de donde
 * cuelgan las fotos directamente, no del desarrollo**.»* Y, cerrando: *«aplica para fotos de la
 * prenda pero también **del arte**»*.
 *
 * La mitad de la PRENDA se construyó en §Post-F9.169(b) (`fotos-ocultas-orden.ts`). Ésta es la del
 * ARTE, y aquí **no existía nada**: `OrdenArte` no tenía columna de fotos, ninguna ruta las exponía
 * y ninguna pantalla las pintaba. Lo único que enseñaba fotos de arte de una OP era su IMPRESO, y
 * las leía vivas del arte del MODELO. Un arte **agregado a mano** (`idModeloArte` NULL) no podía
 * llevar foto en absoluto: no había dónde ponerla.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * LA DECISIÓN: se HEREDA + se OCULTA + se AGREGA. **NO se congela.**
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * `OrdenArte` congela una copia del renglón del modelo (descripción, posición, puntadas, precio,
 * proveedor), así que congelar también las fotos sería lo coherente… hasta que se mide. Sale caro
 * por tres lados, y los tres son verificables en el código de hoy:
 *
 *  1. **Le arrebataría a la OP lo que acaba de guardar.** `borrarArchivoSiQuedoHuerfano`
 *     (`modelos/arte-modelo.ts`) decide si borra el `Archivo` contando **sólo** `ModeloArteFoto`.
 *     Unas filas congeladas que compartieran `idArchivo` —que es exactamente lo que hace hoy
 *     «copiar arte de otro modelo»: comparten objeto de R2, que no se clona desde SQL— se irían con
 *     ese `Archivo` por CASCADE, y su objeto de R2 detrás, por una acción del dueño del MODELO. Y
 *     enseñarle esa cuenta a la tabla de la OP dejaría el objeto pagándose para siempre en cuanto
 *     una sola OP lo hubiera congelado: justo lo que cerró la 0.081.
 *  2. **Rompería lo que hoy funciona.** `copiarRecetaDelModelo` sólo corre al CREAR la orden. Sin
 *     backfill (REGLA 0-B), **todas** las órdenes que ya existen se quedarían sin fotos de arte en
 *     su impreso — que hoy sí las lleva (petición de Daniel, jul-2026). "No gastar en reparar el
 *     pasado" no es permiso para romper lo que hoy funciona; la propia regla lo dice.
 *  3. **Se separaría en silencio.** La desalineación (`calcularDesalineacion`, `receta-orden.ts`)
 *     compara existencia y precio; para el ARTE ni siquiera compara consumo (le pasa
 *     `{ orden: null, modelo: null }`), y **fotos no compara ninguna**. Una foto que el arte del
 *     modelo gane DESPUÉS de abrir la OP no llegaría, y nadie se enteraría.
 *
 * ⭐ **Y heredar sale barato aquí, más barato que en la prenda:** `OrdenArte.idModeloArte` ya viene
 * RESUELTO POR LINAJE. Son **CUATRO** los sitios que lo escriben, y los cuatro leen el arte del
 * modelo por una función que resuelve el linaje por dentro:
 *   1. `copiarRecetaDelModelo` — resuelve con `resolverIdRecetaDeModelo` y lee con `leerArtesModelo`;
 *   2. `agregarRenglonReceta`  — `leerArtesModelo`;
 *   3. `traerDelModelo`        — `leerArtesModelo`;
 *   4. `restaurarRenglonReceta`— `leerArtesModelo` (el que faltaba en la primera cuenta).
 * Así que un modelo hijo por color (V1-E9a/b) apunta al arte del modelo de DESARROLLO desde el
 * propio renglón, y la pertenencia se comprueba contra ese arte — sin repetir la resolución de
 * linaje que la prenda sí necesita (`idModeloDeLasFotos`), y sin el 404 absurdo que aquélla tuvo que
 * esquivar. (La lista de los cuatro no se queda en prosa: `receta-compartida-guardian.test.ts`
 * exige que NADIE más escriba `OrdenArte`.)
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 OCULTAR NO ES BORRAR (D3) — y no es un matiz: es todo el diseño
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * La foto del arte del modelo **no se toca**: sigue en su galería, sigue siendo la principal si lo
 * era, y **otra orden del mismo modelo la sigue viendo**. Lo único que existe es una MARCA por
 * *(renglón, foto)* en `OrdenArteFotoOculta`. Sin fila = se ve (el comportamiento de siempre y el de
 * todo lo ya capturado, REGLA 0-B); con fila = esta OP no la enseña.
 *
 * ⚠️ **Ocultar y mostrar NUNCA tocan R2.** Sólo dos de las cinco operaciones de este módulo hablan
 * de archivos —subir y quitar una foto PROPIA de la OP— y esas dos sólo tocan objetos que nacieron
 * aquí (`OrdenArteFoto` lleva `@@unique([idArchivo])`: no los comparte nadie). Las heredadas no se
 * borran jamás desde este módulo.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * PERMISOS — reusados, ninguno nuevo ⇒ el deploy **no** requiere `SEED_ON_START`
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * Los que ya gobiernan **la receta de la OP**, que es donde vive el arte:
 *  • **leer**: `ordenes.ver` **o** `desarrollo.ver` (`exigirVerLaReceta`, V1-E3j).
 *  • **mutar**: `desarrollo.administrar` (§Post-F9.72: las siete mutaciones de la receta bajaron
 *    ahí, *"nadie va a tener permiso de modificar la OP más que yo"*).
 *
 * ⚠️ **Y NO `ordenes.administrar`**, que sería la copia literal de la prenda: reabriría el agujero
 * que V1-E3j vino a cerrar. Un usuario de Desarrollo puro puede cambiarle a ESTE MISMO renglón la
 * descripción, el precio y el proveedor —y hasta quitarlo de la receta—, pero no podría cambiarle
 * la foto: la pantalla ofrecería el botón y el servidor devolvería 403, que es el síntoma que
 * §Post-F9.68 manda matar. La foto de la PRENDA sí es `ordenes.administrar` porque cuelga de la
 * ORDEN y se administra desde el Centro de Órdenes; ésta cuelga del RENGLÓN y se administra desde
 * la pantalla de la receta.
 *
 * Toda la lógica AQUÍ (A1); las rutas sólo validan permiso + Zod y delegan. Cada mutación va en UNA
 * transacción (A2) y deja bitácora (A7).
 */
import {
  esquemaOrdenArteFotoCrear,
  esquemaOrdenArteFotoOcultar,
  type DatosOrdenArteFotoCrear,
  type DatosOrdenArteFotoOcultar,
} from '../../contrato/index.js';

import {
  eliminarObjetosBestEffort,
  servicioArchivos,
  type ServicioArchivos,
} from '../../comun/archivos.js';
import { registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { exigirVerLaReceta } from './receta-orden.js';

/** Carpeta R2 de las fotos de arte SUBIDAS A UNA OP (la key se ordena por id, no por nombre, A5). */
const CARPETA_FOTOS = 'orden-arte';

/** Orden de las fotos dentro de un arte (espejo de `ModeloArteFoto` y de `ModeloFoto`). */
const ORDEN_FOTOS = [{ orden: 'asc' as const }, { id: 'asc' as const }];

/** Una foto tal como la enseña ESTE renglón de arte de la orden. */
export interface FotoArteOrden {
  /** `modelo` = heredada del arte del modelo; `orden` = la subió esta OP. */
  origen: 'modelo' | 'orden';
  /** Id de `ModeloArteFoto` cuando es heredada; null si la subió la OP. */
  idModeloArteFoto: number | null;
  /** Id de `OrdenArteFoto` cuando la subió la OP; null si es heredada. */
  idFoto: number | null;
  urlDescarga: string;
  nombreOriginal: string;
  /** Heredada que esta OP dejó de enseñar. Nunca true en las de origen `orden`. */
  oculta: boolean;
  /**
   * Es la PRIMERA foto heredada de ESTE arte. Nunca lo es una subida a la OP.
   *
   * ⚠️ **Nace aquí.** La galería del arte del modelo NO tiene concepto de foto principal
   * (`ModeloArteFoto` sólo lleva `orden`; `marcarArtePrincipal` ordena ARTES, no fotos, y
   * `modulos/arte/FotosArte.tsx` lo dice con todas sus letras). Esto es la convención *"la primera
   * del arte es su principal"* aplicada sobre ese `orden` — no un dato heredado.
   *
   * ⚠️ Y **no es lo mismo que el `principal` del IMPRESO**: allá la marca la lleva sólo la
   * primerísima foto del PRIMER arte, y es una GARANTÍA (el tope de la rejilla nunca la recorta).
   * Aquí es una por arte, y es sólo un distintivo.
   */
  principal: boolean;
}

/** Un renglón de arte de la orden con las fotos que enseña. */
export interface ArteOrdenConFotos {
  idOrdenArte: number;
  descripcion: string;
  agregadoAMano: boolean;
  fotos: FotoArteOrden[];
}

/**
 * Lo que el IMPRESO necesita de un renglón de arte para decidir qué imprimir. Forma CRUDA (keys de
 * R2, sin presignar): el impreso presigna y descarga best-effort por su cuenta.
 */
export interface ArteOrdenFotosImpreso {
  idOrdenArte: number;
  /** Traza al arte del modelo; null = renglón AGREGADO A MANO (no hereda nada). */
  idModeloArte: number | null;
  descripcion: string;
  /** Ids de `ModeloArteFoto` que este renglón NO enseña. */
  ocultas: number[];
  /** Fotos que subió esta OP, ordenadas. */
  propias: { idFoto: number; key: string }[];
}

/** Cliente de lectura (transacción o cliente suelto), tal como lo devuelve `clienteLectura`. */
type ClienteLectura = ReturnType<typeof clienteLectura>;

/** Renglón de arte tal como lo necesitan las mutaciones (traza + estado de la orden). */
interface RenglonArte {
  id: number;
  idModeloArte: number | null;
}

/**
 * Exige que el renglón de arte exista, sea de ESA orden y que la orden sea de la empresa activa
 * (A9). Un solo `findFirst` amarra las tres pertenencias — si cualquiera falla es un 404, nunca un
 * 403: quien no puede ver la orden no se entera de que el renglón existe.
 *
 * `exigirViva` bloquea las mutaciones sobre una orden CANCELADA, que es la regla de TODO lo demás
 * que se le puede hacer a un `OrdenArte` (`enRecetaEditable` → `exigirOrdenViva`): sería raro que
 * su descripción y su precio quedaran congelados por la cancelación y sus fotos no.
 *
 * ⚠️ **Un renglón EXCLUIDO sí se deja tocar**, y no es un olvido: es la regla de la casa para una
 * lápida (`editarRenglonReceta`: *"editar una LÁPIDA no cambia qué se compra"*, así que se permite y
 * no revoca la firma). La pantalla no ofrece el botón sobre un renglón excluido —igual que no ofrece
 * editarle el precio—, pero la API no inventa aquí un 409 que el resto de la receta no tiene. Y una
 * foto no puede cambiar qué se compra: este módulo no toca la firma de nadie.
 *
 * 🔴 **Y esa mitad de pantalla SÍ está vigilada**, porque si no, esto sería una permisividad
 * apoyada en aire: `PanelRecetaOrden.test.tsx` › *«el renglón EXCLUIDO no ofrece NINGÚN botón»*
 * pinta una receta con un arte vivo y otro excluido y exige la diferencia. Sin esa prueba, quitarle
 * el `&& !a.excluido` al cableado dejaba la suite entera en verde — es exactamente lo que encontró
 * la revisión de esta etapa. **Un control compensatorio sin prueba no es un control.**
 */
async function exigirRenglonDeLaOrden(
  cliente: ClienteLectura,
  idOrden: number,
  idOrdenArte: number,
  idEmpresa: number,
  exigirViva: boolean,
): Promise<RenglonArte> {
  const renglon = await cliente.ordenArte.findFirst({
    where: { id: idOrdenArte, idOrden, orden: { idEmpresa } },
    select: { id: true, idModeloArte: true, orden: { select: { estado: true } } },
  });
  if (renglon === null) {
    throw new ErrorNoEncontrado('Arte de la orden', idOrdenArte);
  }
  if (exigirViva && renglon.orden.estado === 'cancelada') {
    throw new ErrorConflicto('La orden está cancelada: su receta ya no se puede modificar.');
  }
  return { id: renglon.id, idModeloArte: renglon.idModeloArte };
}

/**
 * Exige que `idModeloArteFoto` sea una de las fotos que ESTE renglón hereda de verdad, o lanza 404.
 *
 * ⭐ La pertenencia se comprueba contra `OrdenArte.idModeloArte`, **que ya viene resuelto por
 * linaje**: cuando la orden es de un modelo hijo por color, su receta se copió del modelo de
 * DESARROLLO (`resolverIdRecetaDeModelo`) y la traza apunta al arte del padre. Por eso aquí no hace
 * falta repetir la resolución que la prenda sí necesita (`idModeloDeLasFotos`) — y por eso el 404
 * absurdo que aquélla tuvo que esquivar no puede ocurrir.
 *
 * Un renglón AGREGADO A MANO (`idModeloArte` null) no hereda de nadie: cualquier foto del modelo le
 * es ajena, así que siempre es 404. Sus fotos son las suyas ({@link solicitarSubidaFotoArteOrden}).
 */
async function exigirFotoHeredada(
  cliente: ClienteLectura,
  renglon: RenglonArte,
  idModeloArteFoto: number,
): Promise<void> {
  const foto =
    renglon.idModeloArte === null
      ? null
      : await cliente.modeloArteFoto.findFirst({
          where: { id: idModeloArteFoto, idModeloArte: renglon.idModeloArte },
          select: { id: true },
        });
  if (foto === null) {
    throw new ErrorNoEncontrado('Foto heredada del arte del modelo', idModeloArteFoto);
  }
}

/**
 * Lectura de BAJO NIVEL de las marcas de UN renglón, ordenadas por antigüedad. NO verifica permiso
 * ni empresa — el llamador autoriza. Es la ÚNICA definición de "qué oculta este renglón".
 */
async function leerOcultasDelRenglon(
  cliente: ClienteLectura,
  idOrdenArte: number,
): Promise<number[]> {
  const filas = await cliente.ordenArteFotoOculta.findMany({
    where: { idOrdenArte },
    orderBy: [{ creadoEn: 'asc' }, { id: 'asc' }],
    select: { idModeloArteFoto: true },
  });
  return filas.map((f) => f.idModeloArteFoto);
}

/**
 * LEE el arte de la orden con lo que hace falta para decidir qué fotos lleva: la traza, las marcas
 * de ocultar y las fotos PROPIAS (sólo sus keys de R2). Lectura de BAJO NIVEL: **no verifica
 * permiso** — la usa el IMPRESO, ya autorizado, para que el papel y la pantalla no puedan divergir.
 *
 * Devuelve sólo los renglones NO EXCLUIDOS, en el mismo orden que `leerRecetaParaImpreso`
 * (descripción, desempate por id): lo que la orden de verdad lleva.
 */
export async function leerArteOrdenParaImpreso(
  cliente: ClienteLectura,
  idOrden: number,
): Promise<ArteOrdenFotosImpreso[]> {
  const filas = await cliente.ordenArte.findMany({
    where: { idOrden, excluido: false },
    orderBy: [{ descripcion: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      idModeloArte: true,
      descripcion: true,
      fotosOcultas: {
        orderBy: [{ creadoEn: 'asc' }, { id: 'asc' }],
        select: { idModeloArteFoto: true },
      },
      fotos: {
        orderBy: ORDEN_FOTOS,
        select: { id: true, archivo: { select: { key: true } } },
      },
    },
  });
  return filas.map((f) => ({
    idOrdenArte: f.id,
    idModeloArte: f.idModeloArte,
    descripcion: f.descripcion,
    ocultas: f.fotosOcultas.map((o) => o.idModeloArteFoto),
    propias: f.fotos.map((p) => ({ idFoto: p.id, key: p.archivo.key })),
  }));
}

/**
 * LISTA las fotos que enseña cada renglón de arte de la orden, con sus URL GET prefirmadas.
 * Requiere `ordenes.ver` **o** `desarrollo.ver` (la misma pareja que la receta, V1-E3j).
 *
 * Salen TODOS los renglones, incluidos los EXCLUIDOS: la pantalla de la receta los pinta tachados y
 * seguiría enseñando su fila. (El IMPRESO sí los descarta — {@link leerArteOrdenParaImpreso}.)
 *
 * Dentro de cada renglón: primero las HEREDADAS en el orden del arte del modelo, luego las que subió
 * la OP. La `principal` es la primera del modelo y **se decide sobre la galería completa, antes de
 * descartar las ocultas**: ser principal es una decisión sobre una foto concreta, no un puesto que
 * la siguiente herede (mismo criterio que la prenda y que el impreso).
 *
 * ⚠️ Esa estrella **nace en esta etapa** y va **una por arte** — el arte del modelo no tiene foto
 * principal en ninguna parte. En el IMPRESO la misma palabra marca sólo la primerísima del PRIMER
 * arte y vale como garantía anti-recorte: son dos cosas distintas con el mismo nombre, y conviene
 * saberlo antes de "unificarlas". Ver {@link FotoArteOrden.principal}.
 *
 * ⚠️ Las ocultas VIAJAN marcadas (`oculta: true`) en vez de desaparecer: quien administra tiene que
 * poder traerlas de vuelta, y una foto que se esconde sin retorno es una trampa. Quién las pinta y
 * quién no es decisión de la pantalla, que ya sabe si el usuario administra.
 */
export async function listarFotosArteOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<ArteOrdenConFotos[]> {
  exigirVerLaReceta(sesion);
  const cliente = clienteLectura(bd);

  const orden = await cliente.orden.findFirst({
    where: { id: idOrden, idEmpresa: sesion.idEmpresaActiva },
    select: { id: true },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }

  const renglones = await cliente.ordenArte.findMany({
    where: { idOrden },
    orderBy: [{ descripcion: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      idModeloArte: true,
      descripcion: true,
      agregadoAMano: true,
      fotosOcultas: { select: { idModeloArteFoto: true } },
      fotos: {
        orderBy: ORDEN_FOTOS,
        select: {
          id: true,
          archivo: { select: { key: true, nombreOriginal: true } },
        },
      },
    },
  });

  // Las HEREDADAS de todos los renglones, en UNA consulta (nunca una por fila). La traza ya viene
  // resuelta por linaje, así que se pregunta por el arte al que apunta cada renglón, sin más.
  const idsArte = [
    ...new Set(renglones.flatMap((r) => (r.idModeloArte === null ? [] : [r.idModeloArte]))),
  ];
  const fotosModelo =
    idsArte.length === 0
      ? []
      : await cliente.modeloArteFoto.findMany({
          where: { idModeloArte: { in: idsArte } },
          orderBy: ORDEN_FOTOS,
          select: {
            id: true,
            idModeloArte: true,
            archivo: { select: { key: true, nombreOriginal: true } },
          },
        });
  const heredadasPorArte = new Map<number, typeof fotosModelo>();
  for (const foto of fotosModelo) {
    const ya = heredadasPorArte.get(foto.idModeloArte);
    if (ya === undefined) {
      heredadasPorArte.set(foto.idModeloArte, [foto]);
    } else {
      ya.push(foto);
    }
  }

  return Promise.all(
    renglones.map(async (r) => {
      const ocultas = new Set(r.fotosOcultas.map((o) => o.idModeloArteFoto));
      const heredadas = r.idModeloArte === null ? [] : (heredadasPorArte.get(r.idModeloArte) ?? []);
      const deModelo = await Promise.all(
        heredadas.map(async (foto, indice) => ({
          origen: 'modelo' as const,
          idModeloArteFoto: foto.id,
          idFoto: null,
          urlDescarga: await archivos.urlDescarga(foto.archivo.key, {
            nombreDescarga: foto.archivo.nombreOriginal,
          }),
          nombreOriginal: foto.archivo.nombreOriginal,
          oculta: ocultas.has(foto.id),
          principal: indice === 0,
        })),
      );
      const deLaOrden = await Promise.all(
        r.fotos.map(async (foto) => ({
          origen: 'orden' as const,
          idModeloArteFoto: null,
          idFoto: foto.id,
          urlDescarga: await archivos.urlDescarga(foto.archivo.key, {
            nombreDescarga: foto.archivo.nombreOriginal,
          }),
          nombreOriginal: foto.archivo.nombreOriginal,
          oculta: false,
          principal: false,
        })),
      );
      return {
        idOrdenArte: r.id,
        descripcion: r.descripcion,
        agregadoAMano: r.agregadoAMano,
        fotos: [...deModelo, ...deLaOrden],
      };
    }),
  );
}

/**
 * QUITA de este renglón una foto HEREDADA del arte del modelo (`desarrollo.administrar`), en UNA
 * transacción (A2): exige el renglón (orden de la empresa activa y VIVA, A9), exige que la foto sea
 * de las que ese renglón hereda de verdad, inserta la marca y registra bitácora (A7).
 *
 * ⚠️ **La foto del arte del modelo NO se toca** (D3): no se borra, no deja de ser la principal, no
 * sale de su galería y **las demás órdenes la siguen viendo**. Y **R2 no se toca jamás**: esto es un
 * INSERT de cuatro columnas.
 *
 * IDEMPOTENTE: ocultar dos veces deja UNA marca (llave única `(idOrdenArte, idModeloArteFoto)`) y
 * UNA sola entrada de bitácora — el segundo clic no cambió nada, así que no hay nada que contar.
 * Devuelve la lista resultante leída DENTRO de la misma transacción.
 */
export async function ocultarFotoArteEnOrden(
  sesion: SesionUsuario,
  idOrden: number,
  idOrdenArte: number,
  entrada: DatosOrdenArteFotoOcultar,
  bd?: ContextoBd,
): Promise<number[]> {
  verificarPermiso(sesion, 'desarrollo.administrar');
  const datos = validarEntrada(esquemaOrdenArteFotoOcultar, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  return enTransaccion(async (tx: Tx) => {
    const renglon = await exigirRenglonDeLaOrden(tx, idOrden, idOrdenArte, idEmpresa, true);
    await exigirFotoHeredada(tx, renglon, datos.idModeloArteFoto);

    const yaOculta = await tx.ordenArteFotoOculta.findUnique({
      where: {
        idOrdenArte_idModeloArteFoto: {
          idOrdenArte,
          idModeloArteFoto: datos.idModeloArteFoto,
        },
      },
      select: { id: true },
    });
    if (yaOculta === null) {
      await tx.ordenArteFotoOculta.create({
        data: {
          idOrdenArte,
          idModeloArteFoto: datos.idModeloArteFoto,
          creadoPorId: sesion.id,
        },
      });
      await registrarBitacora(tx, sesion, {
        entidad: 'Orden',
        idEntidad: idOrden,
        accion: 'MODIFICAR',
        datos: {
          fotoArte: 'ocultar',
          idOrdenArte,
          idModeloArteFoto: datos.idModeloArteFoto,
        },
      });
    }

    return leerOcultasDelRenglon(tx, idOrdenArte);
  }, bd);
}

/**
 * VUELVE A ENSEÑAR en este renglón una foto heredada que estaba oculta (`desarrollo.administrar`),
 * en UNA transacción (A2). Es la vuelta atrás COMPLETA de {@link ocultarFotoArteEnOrden}: una foto
 * escondida sin retorno sería una trampa, no una función.
 *
 * IDEMPOTENTE, igual que su gemela: mostrar algo que no estaba oculto no es un error y no escribe
 * bitácora, porque no cambió nada.
 *
 * ⚠️ **ASIMETRÍA DELIBERADA con `ocultar`:** aquí NO se exige que la foto siga siendo de las que el
 * renglón hereda; sólo se exige el RENGLÓN (orden de la empresa activa y viva) y se levanta la marca.
 *
 * 🔑 **La razón es que ese guard no compraría nada: sólo puede rechazar un no-op.** El guard de
 * `ocultar` pasa ⟺ la foto pertenece al arte que la traza señala, que es EXACTAMENTE el predicado
 * con el que {@link listarFotosArteOrden} decide qué hereda el renglón. Así que una marca que de
 * verdad esté escondiendo algo **siempre** pasaría el guard: lo único que éste llegaría a rechazar
 * es levantar una marca INERTE —una que ya no esconde nada porque el renglón dejó de heredar esa
 * foto— y la dejaría atascada en la tabla sin ganar ni una garantía a cambio.
 *
 * Y el argumento de fondo, que es el que manda: **levantar una marca nunca puede hacer daño; a lo
 * sumo deja de esconder.** Poner una es lo que necesita permiso y comprobación; quitarla, no.
 */
export async function mostrarFotoArteEnOrden(
  sesion: SesionUsuario,
  idOrden: number,
  idOrdenArte: number,
  idModeloArteFoto: number,
  bd?: ContextoBd,
): Promise<number[]> {
  verificarPermiso(sesion, 'desarrollo.administrar');
  const idEmpresa = sesion.idEmpresaActiva;

  return enTransaccion(async (tx: Tx) => {
    await exigirRenglonDeLaOrden(tx, idOrden, idOrdenArte, idEmpresa, true);

    const { count } = await tx.ordenArteFotoOculta.deleteMany({
      where: { idOrdenArte, idModeloArteFoto },
    });
    if (count > 0) {
      await registrarBitacora(tx, sesion, {
        entidad: 'Orden',
        idEntidad: idOrden,
        accion: 'MODIFICAR',
        datos: { fotoArte: 'mostrar', idOrdenArte, idModeloArteFoto },
      });
    }

    return leerOcultasDelRenglon(tx, idOrdenArte);
  }, bd);
}

/** Resultado de preparar la subida de una foto propia (registro + URL PUT prefirmada). */
export interface SubidaFotoArteOrden {
  idFoto: number;
  idArchivo: string;
  nombreOriginal: string;
  urlSubida: string;
  expiraEnSegundos: number;
}

/**
 * Prepara la subida de una foto PROPIA de este renglón de arte (`desarrollo.administrar`) en UNA
 * transacción (A2): exige el renglón (orden de la empresa activa y viva, A9), crea el `Archivo` vía
 * el motor de R2 (carpeta `orden-arte/<idOrdenArte>` — key ordenada por id, NO por nombre, A5), crea
 * el renglón `OrdenArteFoto` AL FINAL de los que ya hay y devuelve la URL PUT prefirmada para que el
 * navegador suba DIRECTO a R2.
 *
 * ⭐ Es lo que le da foto al arte **AGREGADO A MANO**, que no hereda de nadie y hasta hoy no tenía
 * dónde ponerla. Y a los demás renglones les deja añadir sin quitarle nada al modelo: heredar y
 * agregar conviven.
 *
 * Si el PUT del navegador fallara, el `Archivo`/`OrdenArteFoto` referencian una key sin objeto (su
 * `urlDescarga` daría 404): el frontend limpia ESE renglón por su `idFoto`.
 */
export async function solicitarSubidaFotoArteOrden(
  sesion: SesionUsuario,
  idOrden: number,
  idOrdenArte: number,
  entrada: DatosOrdenArteFotoCrear,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<SubidaFotoArteOrden> {
  verificarPermiso(sesion, 'desarrollo.administrar');
  const datos = validarEntrada(esquemaOrdenArteFotoCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  return enTransaccion(async (tx: Tx) => {
    await exigirRenglonDeLaOrden(tx, idOrden, idOrdenArte, idEmpresa, true);

    const ultima = await tx.ordenArteFoto.aggregate({
      where: { idOrdenArte },
      _max: { orden: true },
    });

    const subida = await archivos.solicitarSubida(tx, sesion, {
      nombreOriginal: datos.nombreOriginal,
      tipoMime: datos.tipoMime,
      tamanoBytes: datos.tamanoBytes,
      carpeta: `${CARPETA_FOTOS}/${String(idOrdenArte)}`,
    });

    const foto = await tx.ordenArteFoto.create({
      data: {
        idOrdenArte,
        idArchivo: subida.archivo.id,
        orden: (ultima._max.orden ?? -1) + 1,
        creadoPorId: sesion.id,
      },
      select: { id: true },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: idOrden,
      accion: 'MODIFICAR',
      datos: {
        fotoArte: 'agregar',
        idOrdenArte,
        idFoto: foto.id,
        archivo: datos.nombreOriginal,
      },
    });

    return {
      idFoto: foto.id,
      idArchivo: subida.archivo.id,
      nombreOriginal: datos.nombreOriginal,
      urlSubida: subida.urlSubida,
      expiraEnSegundos: subida.expiraEnSegundos,
    };
  }, bd);
}

/**
 * QUITA una foto PROPIA de este renglón (`desarrollo.administrar`): borra el `Archivo` —Cascade se
 * lleva el `OrdenArteFoto`— + bitácora en UNA transacción (A2) y, TRAS el commit, borra el OBJETO de
 * R2 en modo BEST-EFFORT (0.081a). Si R2 falla NO revierte el borrado del registro: se loguea y
 * sigue.
 *
 * ⭐ **Ésta sí borra de verdad, y puede**: la foto NACIÓ en esta OP. `OrdenArteFoto` lleva
 * `@@unique([idArchivo])`, así que ningún otro renglón la comparte, y ningún camino del sistema
 * apunta un `ModeloArteFoto` a un archivo subido a una orden. Por eso no hace falta aquí la cuenta
 * de huérfanos que sí necesita el arte del modelo (`borrarArchivoSiQuedoHuerfano`), donde varios
 * artes comparten objeto. Es el mismo trato que `eliminarAdjunto` le da a `OrdenArchivo`.
 *
 * ⚠️ **Una foto HEREDADA no entra por aquí y no puede**: el `findFirst` sólo mira `OrdenArteFoto`.
 * Para dejar de enseñarla está {@link ocultarFotoArteEnOrden}, que no borra nada.
 *
 * ⚠️ Llamar SIEMPRE a NIVEL SUPERIOR (sin un `bd.tx` ya abierto): el borrado del objeto corre
 * DESPUÉS del commit; anidado, un rollback del llamador dejaría el objeto borrado y el registro vivo.
 */
export async function quitarFotoArteOrden(
  sesion: SesionUsuario,
  idOrden: number,
  idOrdenArte: number,
  idFoto: number,
  bd?: ContextoBd,
  archivos?: ServicioArchivos,
): Promise<void> {
  verificarPermiso(sesion, 'desarrollo.administrar');
  const idEmpresa = sesion.idEmpresaActiva;

  const keyR2 = await enTransaccion(async (tx: Tx) => {
    await exigirRenglonDeLaOrden(tx, idOrden, idOrdenArte, idEmpresa, true);

    const foto = await tx.ordenArteFoto.findFirst({
      where: { id: idFoto, idOrdenArte },
      select: {
        idArchivo: true,
        archivo: { select: { key: true, nombreOriginal: true } },
      },
    });
    if (foto === null) {
      throw new ErrorNoEncontrado('Foto de arte de la orden', idFoto);
    }

    // Borrar el Archivo arrastra el OrdenArteFoto (Cascade): un solo paso, sin huérfano posible
    // entre dos borrados.
    await tx.archivo.delete({ where: { id: foto.idArchivo } });

    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: idOrden,
      accion: 'MODIFICAR',
      datos: {
        fotoArte: 'quitar',
        idOrdenArte,
        idFoto,
        archivo: foto.archivo.nombreOriginal,
      },
    });

    return foto.archivo.key;
  }, bd);

  await eliminarObjetosBestEffort(
    archivos,
    [keyR2],
    `la foto ${String(idFoto)} del arte ${String(idOrdenArte)} de la orden ${String(idOrden)}`,
  );
}
