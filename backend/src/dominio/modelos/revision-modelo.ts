/**
 * ⭐ V1-E7d — LA REVISIÓN ANTES DE MANDAR A PRODUCIR (§Post-F9.110, decisión de Daniel).
 *
 * Palabras suyas: *"Creo también que después de la negociación con el cliente, debe de haber una
 * revisión antes de mandar a producir. Porque luego en la negociación enfrente del cliente puede
 * ser que se cometa una imprudencia o un error"*.
 *
 * V1-E7b construyó el MECANISMO de versionar: la negociación mueve la receta en vivo y, en vez de
 * editar el modelo, nace `CYA-26-71-001-01` con la receta heredada y el padre intacto. Lo que
 * faltaba es la BISAGRA: el momento en que esa decisión de mesa se vuelve un compromiso de
 * producción — y que ese momento quede **firmado, con quién y cuándo** (A7).
 *
 * ⚠️ **DÓNDE VA LA COMPUERTA, y por qué no va donde parecía.** La regla NO vive en el endpoint
 * «pasar a producción»: vive dentro de {@link promoverAProduccionNucleo} (`nomenclatura.ts`), que
 * es el núcleo que ese endpoint comparte con **generar una OP** (`produccion/salida-produccion.ts`
 * paso 4 — generar la orden PROMUEVE el modelo sola). Puesta en el endpoint, una versión sin
 * revisar llegaría a producción por la **puerta lateral** de generar su OP, que es exactamente lo
 * que esta decisión viene a impedir. Esconder el botón es cortesía; negar la operación es la
 * regla, y con la URL a mano un botón oculto no protege nada.
 *
 * ⚠️ **A QUIÉN alcanza, y a quién NO.** Sólo a las **versiones** — lo que nació de una
 * negociación (`versionDesarrollo` o `idModeloPadre` no nulos). Los ~4,987 modelos migrados del
 * Access y los desarrollos normales **no cambian de conducta**: su `revisionEstado` es `null`, que
 * aquí significa *no aplica*, y la compuerta ni los mira. Esta etapa NO le puso una revisión nueva
 * al catálogo entero, y ensanchar la compuerta es una decisión de negocio que Daniel no ha tomado.
 *
 * ⚠️ **EL PERMISO es `modelos.aprobar-receta`** (el que ya creó V1-E7b: Dueño + Gerencial/Aurora).
 * NO es `listas.aprobar`, que es el PRECIO y es SÓLO DEL DUEÑO — Daniel fue explícito: *"el precio
 * lo apruebo solo yo"*. Son dos firmas distintas sobre dos cosas distintas y no se tocan.
 *
 * ⚠️ **QUÉ SE GUARDA Y DÓNDE (D3).** Las cuatro columnas de `Modelo` describen **UN** acto de
 * revisión (resultado + quién + cuándo + observación) y se escriben siempre juntas: un acto nuevo
 * sustituye al anterior COMPLETO, nunca se limpia un campo suelto dejando una tupla mentirosa
 * ("aprobada" con el motivo del rechazo viejo colgando). La **secuencia** de actos —que es lo que
 * D3 pide no perder— vive en la BITÁCORA, que se agrega y jamás se edita. Es el mismo reparto que
 * el vecino `ListaPreciosLinea.aprobadoPorId/aprobadoEn` con `NegociacionEvento`.
 */
import { registrarBitacora, datosModificacion } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { enTransaccion, type ContextoBd, type Tx } from '../../comun/transaccion.js';

/** Los tres estados de la firma (espejo del enum `EstadoRevisionModelo` de Prisma). */
export type EstadoRevision = 'pendiente' | 'aprobada' | 'rechazada';

/**
 * Lo que la compuerta necesita mirar de un modelo. Es una interfaz ESTRUCTURAL a propósito (no el
 * tipo de Prisma): así {@link exigirRevisionAprobadaParaProducir} es una función pura, probable
 * sin base de datos, y `nomenclatura.ts` puede llamarla con el `select` que ya tenía en la mano.
 */
export interface RevisionDeModelo {
  /** Código VIGENTE, para que el mensaje diga de qué modelo habla. */
  codigo: string;
  /** Padre del que nació esta versión (V1-E7b), o null. */
  idModeloPadre: number | null;
  /** Nº del sufijo de versión (`-01` → 1), o null si el modelo es raíz. */
  versionDesarrollo: number | null;
  /** En qué quedó el último acto de revisión. Null = sin revisar (o no aplica). */
  revisionEstado: EstadoRevision | null;
  /** Cuándo se firmó ese acto, o null. */
  revisadoEn: Date | null;
  /** Motivo del rechazo / nota de la aprobación, o null. */
  revisionNota: string | null;
}

/**
 * ¿Este modelo nació de una NEGOCIACIÓN? Se miran las DOS columnas del linaje, no una:
 * `versionDesarrollo` puede faltar en una versión cuyo código se capturó a mano, y `idModeloPadre`
 * puede faltar si algún día se importa una versión sin su padre. Cualquiera de las dos basta para
 * que el modelo caiga bajo la revisión — la lectura CONSERVADORA es exigir la firma de más, nunca
 * de menos.
 */
export function esVersionDeModelo(modelo: {
  idModeloPadre: number | null;
  versionDesarrollo: number | null;
}): boolean {
  return modelo.idModeloPadre !== null || modelo.versionDesarrollo !== null;
}

/** Fecha corta y sin sorpresas de zona para los mensajes (`2026-08-25`). */
function fechaCorta(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/**
 * ⭐ **LA COMPUERTA.** Lanza si el modelo es una VERSIÓN cuya revisión no está aprobada; si no es
 * una versión, no hace absolutamente nada (los modelos normales no cambian de conducta).
 *
 * Se llama desde {@link promoverAProduccionNucleo} y por eso protege LOS DOS caminos a producción:
 * el endpoint «pasar a producción» y la generación de la OP.
 *
 * El mensaje dice **qué falta y quién puede hacerlo**: quien lo lee está a punto de mandar a
 * fabricar y necesita saber a quién buscar, no sólo que no se pudo.
 */
export function exigirRevisionAprobadaParaProducir(modelo: RevisionDeModelo): void {
  if (!esVersionDeModelo(modelo)) {
    return;
  }
  if (modelo.revisionEstado === 'aprobada') {
    return;
  }

  const quien =
    'Quien tenga el permiso «Aprobar receta» (Dirección o Gerencia) la revisa desde la ficha del ' +
    'modelo.';

  if (modelo.revisionEstado === 'rechazada') {
    const cuando = modelo.revisadoEn === null ? '' : ` el ${fechaCorta(modelo.revisadoEn)}`;
    const motivo =
      modelo.revisionNota === null || modelo.revisionNota === ''
        ? ''
        : `: "${modelo.revisionNota}"`;
    throw new ErrorConflicto(
      `La receta del modelo "${modelo.codigo}" se revisó${cuando} y quedó RECHAZADA${motivo}. ` +
        `No puede mandarse a producir: corrige lo observado y pide que se vuelva a revisar. ` +
        quien,
    );
  }

  // `pendiente` y `null` se leen IGUAL: nadie la firmó. El `null` es el caso de las versiones que
  // ya existían antes de esta etapa — no tienen firma, y tampoco se les va a fingir una.
  throw new ErrorConflicto(
    `El modelo "${modelo.codigo}" nació de una negociación y su receta todavía NO pasa la ` +
      `REVISIÓN, así que no puede mandarse a producir. La negociación mueve la receta en vivo, ` +
      `frente al cliente; esta revisión es la que confirma que lo acordado se puede fabricar. ` +
      quien,
  );
}

/** Lo que se devuelve tras firmar (o al consultar) la revisión de un modelo. */
export interface RevisionModeloSalida {
  idModelo: number;
  codigo: string;
  revisionEstado: EstadoRevision | null;
  idRevisadoPor: string | null;
  /** Nombre de quien firmó (para la pantalla), o null. */
  revisadoPor: string | null;
  /** ISO-8601, o null. */
  revisadoEn: string | null;
  revisionNota: string | null;
}

/**
 * Campos que las dos firmas leen del modelo. NO se lee el firmante ANTERIOR ni por relación ni por
 * id: quien firma ahora es la sesión, y de quien firmó antes lo que importa —su acto completo—
 * queda en la bitácora, no en un join que sólo serviría para el mensaje.
 */
const SELECT_REVISION = {
  id: true,
  codigo: true,
  origen: true,
  idModeloPadre: true,
  versionDesarrollo: true,
  revisionEstado: true,
  revisadoEn: true,
  revisionNota: true,
} as const;

/**
 * Lee el modelo y comprueba lo que las DOS firmas exigen igual: que exista, que sea una VERSIÓN y
 * que no esté ya en producción. Devuelve lo leído para que el llamador no repita la consulta.
 */
async function exigirVersionRevisable(
  tx: Tx,
  idModelo: number,
): Promise<{
  id: number;
  codigo: string;
  origen: string;
  idModeloPadre: number | null;
  versionDesarrollo: number | null;
  revisionEstado: EstadoRevision | null;
  revisionNota: string | null;
  revisadoEn: Date | null;
}> {
  const modelo = await tx.modelo.findUnique({ where: { id: idModelo }, select: SELECT_REVISION });
  if (modelo === null) {
    throw new ErrorNoEncontrado('Modelo', idModelo);
  }

  // La revisión es de lo que nació de una NEGOCIACIÓN. Firmar un modelo cualquiera no está
  // prohibido "por si acaso": está prohibido porque implicaría que el catálogo entero necesita
  // firma, y esa regla Daniel no la ha pedido (§Post-F9.110 alcanza a las versiones).
  if (!esVersionDeModelo(modelo)) {
    throw new ErrorValidacion(
      `El modelo "${modelo.codigo}" no es una VERSIÓN de otro modelo, así que no lleva revisión ` +
        `de receta: la revisión existe para lo que nació de una negociación con el cliente ` +
        `(los modelos con sufijo, "CYA-26-71-001-01"). Este modelo puede pasar a producción sin ` +
        `firma, como siempre.`,
    );
  }

  // Ya en producción, la firma no tendría a qué compuerta abrirle: la revisión es ANTES de mandar
  // a producir, y cambiarla después sólo dejaría un dato que ya no gobierna nada.
  if (modelo.origen === 'produccion') {
    throw new ErrorConflicto(
      `El modelo "${modelo.codigo}" ya está en el catálogo de producción: la revisión es ANTES ` +
        `de mandar a producir y ya no se puede cambiar. Si la receta tiene que cambiar, crea una ` +
        `versión nueva.`,
    );
  }

  return modelo;
}

/** Arma la salida de la firma con lo que quedó escrito. */
function aSalida(
  base: { id: number; codigo: string },
  estado: EstadoRevision,
  sesion: SesionUsuario,
  cuando: Date,
  nota: string | null,
): RevisionModeloSalida {
  return {
    idModelo: base.id,
    codigo: base.codigo,
    revisionEstado: estado,
    idRevisadoPor: sesion.id,
    revisadoPor: sesion.nombre,
    revisadoEn: cuando.toISOString(),
    revisionNota: nota,
  };
}

/** Lo que se puede acompañar a la aprobación. */
export interface DatosAprobarRevision {
  /** Nota opcional del aprobador (queda como observación del acto). */
  nota?: string | undefined;
}

/**
 * ⭐ APRUEBA la revisión de una versión: la firma que la habilita para producción.
 *
 * Todo en UNA transacción (A2) con la bitácora dentro (A7). Aprobar dos veces es `ErrorConflicto`:
 * la segunda firma no cambiaría nada y sí borraría de la fila a quien firmó primero.
 */
export async function aprobarRevisionModelo(
  sesion: SesionUsuario,
  idModelo: number,
  datos: DatosAprobarRevision = {},
  bd?: ContextoBd,
): Promise<RevisionModeloSalida> {
  verificarPermiso(sesion, 'modelos.aprobar-receta');
  const nota = normalizarTexto(datos.nota);

  return enTransaccion(async (tx) => {
    const modelo = await exigirVersionRevisable(tx, idModelo);

    if (modelo.revisionEstado === 'aprobada') {
      throw new ErrorConflicto(
        `La receta del modelo "${modelo.codigo}" ya está aprobada. Ya puede mandarse a producir.`,
      );
    }

    const cuando = new Date();
    await tx.modelo.update({
      where: { id: idModelo },
      data: {
        // Las cuatro juntas: el acto nuevo sustituye al anterior COMPLETO (ver el encabezado).
        revisionEstado: 'aprobada',
        idRevisadoPor: sesion.id,
        revisadoEn: cuando,
        revisionNota: nota,
        ...datosModificacion(sesion),
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Modelo',
      idEntidad: idModelo,
      accion: 'MODIFICAR',
      datos: {
        operacion: 'aprobar-revision',
        codigo: modelo.codigo,
        version: modelo.versionDesarrollo,
        idModeloPadre: modelo.idModeloPadre,
        // El acto ANTERIOR viaja al renglón: así la bitácora sola cuenta la secuencia completa
        // (rechazada con tal motivo → aprobada), que es lo que la fila ya no guarda (D3).
        estadoAnterior: modelo.revisionEstado,
        notaAnterior: modelo.revisionNota,
        nota,
      },
    });

    return aSalida(modelo, 'aprobada', sesion, cuando, nota);
  }, bd);
}

/** Lo que exige el rechazo. */
export interface DatosRechazarRevision {
  /** MOTIVO del rechazo: obligatorio. Sin él, el rechazo no le dice nada a quien tiene que corregir. */
  motivo: string;
}

/**
 * ⭐ RECHAZA la revisión de una versión, con motivo. La versión sigue existiendo (D3: nada se
 * borra) y sigue editándose; lo que no puede es mandarse a producir.
 *
 * ⚠️ **Asimetría deliberada con la aprobación:** aprobar dos veces se rechaza (no cambia nada y
 * borra quién firmó primero), pero rechazar otra vez SÍ se permite — un segundo vistazo con una
 * observación distinta es información nueva, y el motivo anterior no se pierde: queda en la
 * bitácora, junto con quién y cuándo lo escribió.
 */
export async function rechazarRevisionModelo(
  sesion: SesionUsuario,
  idModelo: number,
  datos: DatosRechazarRevision,
  bd?: ContextoBd,
): Promise<RevisionModeloSalida> {
  verificarPermiso(sesion, 'modelos.aprobar-receta');
  const motivo = normalizarTexto(datos.motivo);
  if (motivo === null) {
    throw new ErrorValidacion(
      'Escribe el motivo del rechazo: sin él, quien tiene que corregir la receta no sabe qué se ' +
        'observó.',
    );
  }

  return enTransaccion(async (tx) => {
    const modelo = await exigirVersionRevisable(tx, idModelo);

    const cuando = new Date();
    await tx.modelo.update({
      where: { id: idModelo },
      data: {
        revisionEstado: 'rechazada',
        idRevisadoPor: sesion.id,
        revisadoEn: cuando,
        revisionNota: motivo,
        ...datosModificacion(sesion),
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Modelo',
      idEntidad: idModelo,
      accion: 'MODIFICAR',
      datos: {
        operacion: 'rechazar-revision',
        codigo: modelo.codigo,
        version: modelo.versionDesarrollo,
        idModeloPadre: modelo.idModeloPadre,
        estadoAnterior: modelo.revisionEstado,
        notaAnterior: modelo.revisionNota,
        motivo,
      },
    });

    return aSalida(modelo, 'rechazada', sesion, cuando, motivo);
  }, bd);
}

/** Recorta el texto y convierte el vacío en `null` (una nota en blanco no es una nota). */
function normalizarTexto(texto: string | undefined): string | null {
  const limpio = texto?.trim() ?? '';
  return limpio === '' ? null : limpio;
}
