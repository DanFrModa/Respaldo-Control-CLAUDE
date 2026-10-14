/**
 * ⭐⭐ Fila 0.238 (§Post-F9.248(b)) — LOS COMENTARIOS DE LA NEGOCIACIÓN de una lista de precios.
 *
 * Daniel, sobre Aurora (perfil «Gerente de Ventas»): *«las listas negociar **solo de lectura y poder
 * agregar comentarios**, pero no modificar lo que yo hice»*.
 *  • **Leer** ya lo daba `listas.ver`.
 *  • **Comentar** no se podía expresar: el único texto de la negociación era `NegociacionEvento.acuerdo`
 *    y escribirlo exigía `listas.negociar`, que gobierna NUEVE operaciones —rondas, acuerdos, estado
 *    de la lista y del renglón, la calculadora, la mesa (simular y guardar) y EMITIR/CANCELAR
 *    cotizaciones—. Darle `negociar` para que comente le habría dado mandar papel al cliente.
 *
 * Desde aquí, `listas.comentar` escribe un `NegociacionComentario`: un registro NUEVO e
 * INMUTABLE (D3) con quién, cuándo, el texto, la lista y —opcional— el renglón. **No edita ni
 * sobrescribe nada de lo que capturó el dueño**: ni el `acuerdo` de un evento, ni precios, ni estados.
 * No hay edición ni borrado: si alguien se equivoca, escribe otro.
 *
 * 🔴 **Por qué tabla propia y NO un `NegociacionEvento` más.** El evento no tiene columna de tipo y
 * seis lectores lo interpretan por sus columnas (último precio negociado, meta negociada, el hilo,
 * la vista 360 de la orden que lo pinta como «acuerdos», y las dos fotos de bitácora). Un comentario
 * metido ahí aparecería como acuerdo pactado en la orden. Aparte, ningún cálculo lo puede leer.
 *
 * ⚠️ **No los frena el cierre de la lista ni el estado del renglón** (`cerrado`/`dropeado`): un
 * comentario no es el papel —no sale en PDF, Excel ni cotización— y comentar una lista cerrada
 * («el cliente pidió reabrir el modelo 3») es justo para lo que sirve. Mismo criterio que los
 * pendientes (`pendientes-linea.ts`).
 *
 * Innegociables: A1 (la regla vive aquí; la ruta sólo valida y delega), A2 (comentario + bitácora en
 * UNA transacción), A7 (bitácora sobre `ListaPrecios`), A9 (scope por empresa activa), D3 (se agrega,
 * jamás se edita). Se toma el advisory lock POR LISTA —el mismo de `quitarLineaLista` y
 * `eliminarLista`— para que un comentario no pueda colarse entre la FOTO que esas dos toman y el
 * borrado en cascada (se perdería sin rastro).
 */
import {
  esquemaComentarioNegociacionCrear,
  type ComentarioNegociacionSalida,
  type DatosComentarioNegociacionCrear,
} from '../../contrato/index.js';
import { registrarBitacora } from '../../comun/auditoria.js';
import { ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { nombreDeUsuario, nombresDeUsuarios } from '../../comun/nombres-usuario.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, enTransaccion, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { NAMESPACE_LOCK_LISTA } from './listas-precios.js';

/**
 * Exige poder COMENTAR la negociación. Pasa con `listas.comentar` **o** con `listas.negociar`: quien
 * negocia obviamente puede comentar, y nadie que ya escribía en el hilo pierde nada. Deny-by-default
 * (A4): sin ninguna de las dos, 403 nombrando `listas.comentar`, que es la llave que hay que dar.
 *
 * ⚠️ La inversa NO vale y es la razón de la fila: `listas.comentar` no abre NINGUNA de las nueve
 * operaciones de `listas.negociar` (todas siguen exigiendo esa llave a secas con `verificarPermiso`).
 */
export function exigirComentarNegociacion(sesion: SesionUsuario): void {
  if (tienePermiso(sesion, 'listas.negociar')) {
    return;
  }
  verificarPermiso(sesion, 'listas.comentar');
}

/** Forma en que se lee un comentario (con el código del modelo del renglón, si apunta a uno). */
interface ComentarioCrudo {
  id: number;
  idLista: number;
  idListaLinea: number | null;
  texto: string;
  registradoPorId: string | null;
  registradoEn: Date;
  listaLinea: { desarrollo: { modelo: { codigo: string } } } | null;
}

const seleccionComentario = {
  id: true,
  idLista: true,
  idListaLinea: true,
  texto: true,
  registradoPorId: true,
  registradoEn: true,
  listaLinea: { select: { desarrollo: { select: { modelo: { select: { codigo: true } } } } } },
} as const;

function aComentarioSalida(
  c: ComentarioCrudo,
  nombrePorId: ReadonlyMap<string, string>,
): ComentarioNegociacionSalida {
  return {
    id: c.id,
    idLista: c.idLista,
    idListaLinea: c.idListaLinea,
    codigoModelo: c.listaLinea?.desarrollo.modelo.codigo ?? null,
    texto: c.texto,
    registradoPorId: c.registradoPorId,
    nombreRegistradoPor: nombreDeUsuario(nombrePorId, c.registradoPorId),
    registradoEn: c.registradoEn.toISOString(),
  };
}

/**
 * AGREGA un comentario a la negociación de una lista (y, opcional, a uno de sus renglones).
 * Requiere `listas.comentar` o `listas.negociar`, y `listas.ver` (mutar implica leer). Inmutable:
 * no hay función para editarlo ni borrarlo.
 */
export async function comentarNegociacion(
  sesion: SesionUsuario,
  idLista: number,
  entrada: DatosComentarioNegociacionCrear,
  bd?: ContextoBd,
): Promise<ComentarioNegociacionSalida> {
  exigirComentarNegociacion(sesion);
  // Mutar implica leer (mismo criterio que el `preHandler` de la ruta): la reja del dominio es
  // completa por sí sola, no depende de que la ruta haya pedido `listas.ver`.
  verificarPermiso(sesion, 'listas.ver');
  const datos = validarEntrada(esquemaComentarioNegociacionCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  return enTransaccion(async (tx) => {
    // A9 primero: una lista de otra empresa NO EXISTE para esta sesión (404, nunca 409).
    const existe = await tx.listaPrecios.findFirst({
      where: { id: idLista, idEmpresa },
      select: { id: true },
    });
    if (existe === null) {
      throw new ErrorNoEncontrado('Lista de precios', idLista);
    }
    // El lock de la lista: serializa con `quitarLineaLista`/`eliminarLista`, que fotografían los
    // comentarios antes de borrarlos en cascada (ver el encabezado).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NAMESPACE_LOCK_LISTA}::int, ${idLista}::int)`;

    // 🔴 RE-LECTURA BAJO EL LOCK (mismo patrón que `eliminarLista`). Mientras se esperaba el lock,
    // otra transacción pudo BORRAR la lista: sin esto, el `create` de abajo reventaba con la FK
    // (`negociacion_comentario_id_lista_fkey`, un 500) en vez del 404 que corresponde.
    const sigue = await tx.listaPrecios.findFirst({
      where: { id: idLista, idEmpresa },
      select: { id: true },
    });
    if (sigue === null) {
      throw new ErrorNoEncontrado('Lista de precios', idLista);
    }

    const idLinea = datos.idLinea ?? null;
    if (idLinea !== null) {
      // El renglón tiene que ser DE ESTA lista (y, por ella, de la empresa activa). Se lee DESPUÉS
      // del lock por la misma razón: quitarlo es otra mutación que toma ese lock.
      const linea = await tx.listaPreciosLinea.findFirst({
        where: { id: idLinea, lista: { idEmpresa } },
        select: { idLista: true },
      });
      if (linea === null) {
        throw new ErrorNoEncontrado('Renglón de lista de precios', idLinea);
      }
      if (linea.idLista !== idLista) {
        throw new ErrorValidacion('El renglón elegido no es de esta lista.');
      }
    }

    const creado = await tx.negociacionComentario.create({
      data: {
        idLista,
        idListaLinea: idLinea,
        texto: datos.texto,
        registradoPorId: sesion.id,
      },
      select: seleccionComentario,
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'ListaPrecios',
      idEntidad: idLista,
      accion: 'MODIFICAR',
      datos: {
        operacion: 'comentar',
        idComentario: creado.id,
        idLinea,
        texto: creado.texto,
      },
    });

    const nombres = await nombresDeUsuarios(tx, [creado.registradoPorId]);
    return aComentarioSalida(creado, nombres);
  }, bd);
}

/**
 * Los COMENTARIOS de una lista, del más viejo al más nuevo (por id, que es el orden de inserción).
 * Requiere `listas.ver`: leer la negociación ya lo daba esa llave.
 */
export async function listarComentariosNegociacion(
  sesion: SesionUsuario,
  idLista: number,
  bd?: ContextoBd,
): Promise<ComentarioNegociacionSalida[]> {
  verificarPermiso(sesion, 'listas.ver');
  const cliente = clienteLectura(bd);

  const lista = await cliente.listaPrecios.findFirst({
    where: { id: idLista, idEmpresa: sesion.idEmpresaActiva },
    select: { id: true },
  });
  if (lista === null) {
    throw new ErrorNoEncontrado('Lista de precios', idLista);
  }

  const comentarios = await cliente.negociacionComentario.findMany({
    where: { idLista },
    orderBy: { id: 'asc' },
    select: seleccionComentario,
  });
  const nombres = await nombresDeUsuarios(
    cliente,
    comentarios.map((c) => c.registradoPorId),
  );
  return comentarios.map((c) => aComentarioSalida(c, nombres));
}
