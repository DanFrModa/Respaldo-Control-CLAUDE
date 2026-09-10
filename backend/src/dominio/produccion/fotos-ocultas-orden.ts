/**
 * FOTOS DEL MODELO OCULTAS EN UNA ORDEN (§Post-F9.169(b)) — la media frase que le faltaba a la tira
 * de fotos de la OP.
 *
 * 🔴 DANIEL, textual: *«La foto debería de ser **de la OP no del desarrollo**. Si el desarrollo tiene
 * fotos está bien que podamos **heredarlas**, pero también la opción de **quitarlas de la OP** y
 * meter fotos directo a la OP. **Eso me parece que ya existe.»* — y tenía razón: heredar, subir a la
 * OP y quitar lo subido ya existían (F2-E3 + ajuste de jul-2026). Lo único que faltaba era poder
 * quitar de la OP una foto **heredada del modelo**, que es lo que vive aquí.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 OCULTAR NO ES BORRAR (D3), y no es un matiz: es todo el diseño
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * La foto del modelo **no se toca**: sigue en su galería, sigue siendo la principal si lo era, y
 * **otra orden del mismo modelo la sigue viendo**. Lo único que existe es una MARCA por
 * *(orden, foto)* en `OrdenFotoOculta`. Sin fila = se ve (el comportamiento de siempre, y el de
 * todo lo ya capturado, REGLA 0-B); con fila = esta orden no la enseña.
 *
 * ⚠️ **Y NUNCA TOCA R2.** Este módulo no crea ni destruye ningún `Archivo` y no llama al servicio de
 * archivos ni para presignar: sólo inserta y borra filas de 4 columnas. Compárese con
 * `adjuntos-orden.ts` (el vecino), que sí sube y borra objetos de R2 — ahí es correcto, aquí sería
 * destruir el dato de otro dueño.
 *
 * ⚠️ **Por qué no es una bandera `excluido` como en `OrdenArte`** (el patrón de la casa para esto
 * mismo con los artes): allá la orden CONGELA una copia del renglón del modelo, así que ya tiene una
 * fila propia donde cabe el booleano. Las fotos NO se copian por orden a propósito —viven en R2 y el
 * repo no clona objetos de R2 desde SQL, lo dice el propio `OrdenArte`—, así que no hay fila donde
 * poner la bandera. La marca por ausencia/presencia es el MISMO concepto (lápida reversible,
 * decisión de la orden, el modelo intacto) en la única forma que admite un dato que no se copia.
 *
 * Cuatro operaciones. Toda la lógica AQUÍ (A1); las rutas sólo validan permiso + Zod y delegan.
 * Permisos REUSADOS (sin permisos nuevos, sin `SEED_ON_START`): `ordenes.ver` para leer,
 * `ordenes.administrar` para ocultar/mostrar — los mismos que gobiernan subir/quitar fotos de la OP.
 */
import { esquemaOrdenFotoOcultar, type DatosOrdenFotoOcultar } from '../../contrato/index.js';

import { registrarBitacora } from '../../comun/auditoria.js';
import { ErrorNoEncontrado } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { idModeloDeLasFotos } from '../modelos/fotos-modelo.js';

/** Una foto del modelo oculta en esta orden (qué foto y desde cuándo). */
export interface FotoOcultaOrden {
  idModeloFoto: number;
  ocultadaEn: Date;
}

/** Cliente de lectura (transacción o cliente suelto), tal como lo devuelve `clienteLectura`. */
type ClienteLectura = ReturnType<typeof clienteLectura>;

/** Exige que la orden exista y sea de la empresa activa (A9), y devuelve su modelo. */
async function exigirOrdenDeEmpresa(
  cliente: ClienteLectura,
  idOrden: number,
  idEmpresa: number,
): Promise<{ id: number; idModelo: number }> {
  const orden = await cliente.orden.findFirst({
    where: { id: idOrden, idEmpresa },
    select: { id: true, idModelo: true },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }
  return orden;
}

/**
 * Exige que `idModeloFoto` sea una de las fotos que ESTA orden enseña de verdad, o lanza 404.
 *
 * ⭐⭐ Aplica la MISMA resolución de linaje que la lectura (`idModeloDeLasFotos`): un modelo hijo por
 * color SIN fotos propias enseña las de su modelo de DESARROLLO (§Post-F9.172(b)). Sin esto, ocultar
 * una foto heredada del padre —que es justo el caso que Daniel describe— rebotaría con un 404
 * absurdo: *"esa foto no es de tu modelo"*, cuando es exactamente la que está viendo en pantalla.
 */
async function exigirFotoQueLaOrdenEnsena(
  cliente: ClienteLectura,
  idModelo: number,
  idModeloFoto: number,
): Promise<void> {
  const modelo = await cliente.modelo.findUnique({
    where: { id: idModelo },
    select: { id: true, idModeloDesarrollo: true },
  });
  if (modelo === null) {
    throw new ErrorNoEncontrado('Modelo', idModelo);
  }
  // La PROPIA gana: sólo si el modelo no tiene ninguna foto suya se miran las del padre (misma
  // regla y mismo orden de preguntas que `leerFotosModelo`).
  const propias = await cliente.modeloFoto.count({ where: { idModelo: modelo.id } });
  const idDueno = idModeloDeLasFotos(modelo, propias > 0);

  const foto = await cliente.modeloFoto.findFirst({
    where: { id: idModeloFoto, idModelo: idDueno },
    select: { id: true },
  });
  if (foto === null) {
    throw new ErrorNoEncontrado('Foto del modelo de la orden', idModeloFoto);
  }
}

/**
 * Lectura de BAJO NIVEL de las marcas de esta orden, ordenadas por antigüedad. NO verifica permiso
 * ni empresa — el llamador es responsable de autorizar. Es la ÚNICA definición de "qué oculta esta
 * orden": la usan la lista pública, las dos mutaciones (para devolver el resultado sin volver a
 * pedir permiso) y —vía {@link leerIdsFotosOcultasOrden}— el impreso.
 */
async function leerFotosOcultas(
  cliente: ClienteLectura,
  idOrden: number,
): Promise<FotoOcultaOrden[]> {
  const filas = await cliente.ordenFotoOculta.findMany({
    where: { idOrden },
    orderBy: [{ creadoEn: 'asc' }, { id: 'asc' }],
    select: { idModeloFoto: true, creadoEn: true },
  });
  return filas.map((f) => ({ idModeloFoto: f.idModeloFoto, ocultadaEn: f.creadoEn }));
}

/**
 * Lectura de BAJO NIVEL: los ids de foto del modelo que esta orden NO enseña. NO verifica permiso ni
 * empresa — el llamador es responsable de autorizar. La usa el IMPRESO de la orden (ya autorizado
 * por `ordenes.ver`), para que el papel y la pantalla no puedan divergir sobre qué fotos lleva la OP.
 */
export async function leerIdsFotosOcultasOrden(
  cliente: ClienteLectura,
  idOrden: number,
): Promise<number[]> {
  return (await leerFotosOcultas(cliente, idOrden)).map((f) => f.idModeloFoto);
}

/**
 * Lista las fotos del modelo que esta orden oculta (`ordenes.ver`), ordenadas por antigüedad de la
 * marca. Vacío = la orden las enseña todas, que es el caso normal y el de todo lo ya capturado.
 * Exige que la orden exista y sea de la empresa activa (A9).
 */
export async function listarFotosOcultasOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<FotoOcultaOrden[]> {
  verificarPermiso(sesion, 'ordenes.ver');
  const cliente = clienteLectura(bd);
  await exigirOrdenDeEmpresa(cliente, idOrden, sesion.idEmpresaActiva);
  return leerFotosOcultas(cliente, idOrden);
}

/**
 * OCULTA en ESTA orden una foto heredada del modelo (`ordenes.administrar`), en UNA transacción (A2):
 * exige la orden (empresa activa, A9), exige que la foto sea de las que la orden enseña de verdad
 * (incluido el linaje por color), inserta la marca y registra bitácora (A7).
 *
 * ⚠️ **La foto del modelo NO se toca** (D3): no se borra, no se desmarca, no sale de la galería y las
 * demás órdenes del mismo modelo la siguen viendo. Y **R2 no se toca jamás**.
 *
 * IDEMPOTENTE: ocultar dos veces deja UNA marca (la llave única `(idOrden, idModeloFoto)`) y
 * registra UNA sola entrada de bitácora — el segundo clic no cambió nada, así que no hay nada que
 * contar. Devuelve la lista resultante (leída DENTRO de la misma transacción) para que la pantalla
 * no tenga que releer; el guard de esa lectura es el `ordenes.administrar` ya verificado, no
 * `ordenes.ver` — una escritura que se commitea y luego truena al releer sería lo peor de los dos
 * mundos.
 */
export async function ocultarFotoModeloEnOrden(
  sesion: SesionUsuario,
  idOrden: number,
  entrada: DatosOrdenFotoOcultar,
  bd?: ContextoBd,
): Promise<FotoOcultaOrden[]> {
  verificarPermiso(sesion, 'ordenes.administrar');
  const datos = validarEntrada(esquemaOrdenFotoOcultar, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  return enTransaccion(async (tx: Tx) => {
    const orden = await exigirOrdenDeEmpresa(tx, idOrden, idEmpresa);
    await exigirFotoQueLaOrdenEnsena(tx, orden.idModelo, datos.idModeloFoto);

    const yaOculta = await tx.ordenFotoOculta.findUnique({
      where: { idOrden_idModeloFoto: { idOrden, idModeloFoto: datos.idModeloFoto } },
      select: { id: true },
    });
    if (yaOculta === null) {
      await tx.ordenFotoOculta.create({
        data: { idOrden, idModeloFoto: datos.idModeloFoto, creadoPorId: sesion.id },
      });
      await registrarBitacora(tx, sesion, {
        entidad: 'Orden',
        idEntidad: idOrden,
        accion: 'MODIFICAR',
        datos: { fotoModelo: 'ocultar', idModeloFoto: datos.idModeloFoto },
      });
    }

    return leerFotosOcultas(tx, idOrden);
  }, bd);
}

/**
 * VUELVE A MOSTRAR en esta orden una foto del modelo que estaba oculta (`ordenes.administrar`), en
 * UNA transacción (A2). Es la vuelta atrás COMPLETA de {@link ocultarFotoModeloEnOrden}: una foto
 * escondida sin retorno sería una trampa, no una función.
 *
 * IDEMPOTENTE, igual que su gemela: mostrar algo que no estaba oculto no es un error, y no escribe
 * bitácora porque no cambió nada.
 *
 * ⚠️ **ASIMETRÍA DELIBERADA con `ocultar`:** aquí NO se exige que la foto siga siendo de las que la
 * orden enseña; sólo se exige la ORDEN (empresa activa, A9) y se levanta la marca por
 * *(orden, foto)*.
 *
 * 🔑 **La razón es que ese guard no compraría nada: sólo puede rechazar un no-op.** El guard de
 * `ocultar` pasa ⟺ `foto.idModelo === idModeloDeLasFotos(...)`, que es EXACTAMENTE la condición con
 * la que `leerFotosModelo` decide qué fotos pinta. Así que una marca que de verdad esté escondiendo
 * algo **siempre** pasaría el guard: lo único que éste llegaría a rechazar es levantar una marca
 * INERTE —una que ya no esconde nada, porque la OP dejó de enseñar esa foto—, y la dejaría atascada
 * en la tabla sin ganar ni una garantía a cambio.
 *
 * Y el argumento de fondo, que es el que manda: **levantar una marca nunca puede hacer daño; a lo
 * sumo deja de esconder.** Poner una es lo que necesita permiso y comprobación; quitarla, no.
 *
 * *(Escrito así tras la medición del reviewer del 1-sep-2026: la versión anterior de este comentario
 * decía que sin la asimetría una marca quedaría "irrecuperable para siempre" — **era falso**, y un
 * comentario-razón falso envenena al siguiente que lo lea.)*
 */
export async function mostrarFotoModeloEnOrden(
  sesion: SesionUsuario,
  idOrden: number,
  idModeloFoto: number,
  bd?: ContextoBd,
): Promise<FotoOcultaOrden[]> {
  verificarPermiso(sesion, 'ordenes.administrar');
  const idEmpresa = sesion.idEmpresaActiva;

  return enTransaccion(async (tx: Tx) => {
    await exigirOrdenDeEmpresa(tx, idOrden, idEmpresa);

    const { count } = await tx.ordenFotoOculta.deleteMany({ where: { idOrden, idModeloFoto } });
    if (count > 0) {
      await registrarBitacora(tx, sesion, {
        entidad: 'Orden',
        idEntidad: idOrden,
        accion: 'MODIFICAR',
        datos: { fotoModelo: 'mostrar', idModeloFoto },
      });
    }

    return leerFotosOcultas(tx, idOrden);
  }, bd);
}
