/**
 * ⭐ LA REVISIÓN DE LA RECETA DE UNA VERSIÓN — nació en V1-E7d (§Post-F9.110) y **cambió de
 * naturaleza en V1-E9c** (§Post-F9.169).
 *
 * Lo que Daniel pidió en §Post-F9.110: *"Creo también que después de la negociación con el
 * cliente, debe de haber una revisión antes de mandar a producir. Porque luego en la negociación
 * enfrente del cliente puede ser que se cometa una imprudencia o un error"*. V1-E7b había
 * construido el MECANISMO de versionar (la negociación mueve la receta en vivo y, en vez de editar
 * el modelo, nace `CYA-26-71-001-01` con la receta heredada y el padre intacto); esto le puso la
 * BISAGRA: que ese compromiso quede **firmado, con quién y cuándo** (A7).
 *
 * 🔴🔴 **V1-E9c — LA REVISIÓN YA NO ES UNA PUERTA: ES UN REGISTRO.** Daniel, 31-ago-2026, textual:
 * *«**Todo lo que no está firmado simplemente no se puede comprar. Pero no detiene ni la
 * producción ni los demás renglones ya firmados.**»* El único control sobre el gasto es **la firma
 * POR RENGLÓN de la receta de la orden** (`produccion/receta-orden.ts`:
 * `exigirRecetaLiberada` / `exigirMaterialesLiberados`), que ya cubre las bocas de gasto.
 * En consecuencia:
 *
 *  • **Se retiró `exigirRevisionAprobadaParaProducir`**, la compuerta que vivía en
 *    {@link promoverAProduccionNucleo} y le negaba producción a la versión sin firma. Una OP puede
 *    nacer con la receta pendiente de revisar; lo que no puede es **comprarle material** a un
 *    renglón sin liberar.
 *  • **La firma sigue existiendo, y sigue sirviendo:** dice que alguien miró lo que se negoció
 *    frente al cliente. Lo que ya no hace es gobernar una operación.
 *  • **Por eso se puede firmar TAMBIÉN con el modelo ya en producción** (ver
 *    {@link exigirVersionRevisable}) y por eso la BANDEJA «Recetas por revisar» dejó de filtrar por
 *    `origen = 'desarrollo'`: si el acto se pudiera ejecutar pero nadie lo viera —o se viera pero
 *    nadie lo pudiera ejecutar— sería un acto de negocio muerto, que es peor que no tenerlo.
 *
 * ⚠️ **Lo que NO se retiró, y no se toca:** las 12 puertas de {@link tocarModeloPorCambioDeReceta}
 * y la invalidación automática de §Post-F9.116. Mover la receta después de firmarla **sigue
 * tumbando la firma**: eso es lo que mantiene honesto el registro, y sin ello la firma sería un
 * adorno. Daniel pidió el mecanismo en §Post-F9.140 y nada lo revoca.
 *
 * ⚠️ **A QUIÉN alcanza, y a quién NO.** Sólo a las **versiones** — lo que nació de una
 * negociación (`versionDesarrollo` o `idModeloPadre` no nulos). Los ~4,987 modelos migrados del
 * Access y los desarrollos normales **no cambian de conducta**: su `revisionEstado` es `null`, que
 * aquí significa *no aplica*. Ensanchar la revisión al catálogo entero es una decisión de negocio
 * que Daniel no ha tomado.
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
import { fechaDelActo } from '../../comun/fecha-negocio.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { enTransaccion, type ContextoBd, type Tx } from '../../comun/transaccion.js';
import { Prisma } from '../../datos/index.js';

/** Los tres estados de la firma (espejo del enum `EstadoRevisionModelo` de Prisma). */
export type EstadoRevision = 'pendiente' | 'aprobada' | 'rechazada';

/**
 * Lo que hay que mirar de un modelo para saber si su revisión está firmada. Es una interfaz
 * ESTRUCTURAL a propósito (no el tipo de Prisma): así {@link revisionSinAprobar} es una función
 * pura, probable sin base de datos, y cualquier `select` que ya traiga estas cuatro columnas sirve.
 *
 * ⚠️ **V1-E9c la encogió.** Traía además `codigo`, `revisadoEn` y `revisionNota` porque la
 * compuerta retirada las necesitaba para redactar su mensaje de rechazo. Sin compuerta, nadie las
 * pregunta aquí: pedirlas seguiría obligando a todo llamador a hacer un `select` más ancho de lo
 * necesario para contestar una pregunta de sí o no.
 */
export interface RevisionDeModelo {
  /** Padre del que nació esta versión (V1-E7b), o null. */
  idModeloPadre: number | null;
  /** Nº del sufijo de versión (`-01` → 1), o null si el modelo es raíz. */
  versionDesarrollo: number | null;
  /**
   * ⭐ V1-E9a — Modelo de DESARROLLO del que nació este modelo de PRODUCCIÓN (el linaje 1:N), o
   * null. Viaja aquí porque {@link esVersionDeModelo} lo mira para EXCLUIR a los hijos: ver el
   * porqué en esa función.
   */
  idModeloDesarrollo: number | null;
  /** En qué quedó el último acto de revisión. Null = sin revisar (o no aplica). */
  revisionEstado: EstadoRevision | null;
}

/**
 * ¿Este modelo nació de una NEGOCIACIÓN? Se miran las DOS columnas del linaje de VERSIONES, no una:
 * `versionDesarrollo` puede faltar en una versión cuyo código se capturó a mano, y `idModeloPadre`
 * puede faltar si algún día se importa una versión sin su padre. Cualquiera de las dos basta para
 * que el modelo caiga bajo la revisión — la lectura CONSERVADORA es exigir la firma de más, nunca
 * de menos.
 *
 * ⭐⭐ **V1-E9a (§Post-F9.167 punto 2) — Y LOS HIJOS DE PRODUCCIÓN QUEDAN FUERA, SIEMPRE.** Un
 * modelo que lleva `idModeloDesarrollo` es un HIJO del linaje 1:N: nació **ya en producción**,
 * **comparte** la receta de su padre de desarrollo (no la copia) y **no lleva revisión propia** —
 * la firma que lo habilitó a producir es la del padre, y se exigió antes de que él existiera.
 *
 * 🔴 **Qué evita esta línea, en concreto.** La ficha del modelo pinta el chip de la revisión
 * preguntando este mismo predicado, y la BANDEJA «Recetas por revisar» lista con él. Si un hijo
 * llegara a contestar `true` —hoy no puede, porque nace con las dos columnas de versión en `null`,
 * pero basta con que una etapa futura le ponga `idModeloPadre` para "guardar de dónde salió"— se
 * enseñaría a sí mismo como *«Revisión pendiente»* y se colaría en la bandeja **pidiendo una firma
 * que no le toca**: su receta es la del padre, y firmarla en el hijo sería firmar dos veces lo
 * mismo. La guarda va aquí, en el predicado ÚNICO, y no en la pantalla: aquí la heredan las tres
 * copias (dominio, SQL y ficha) de una sola vez.
 *
 * ⚠️ **La exclusión es lo PRIMERO que se mira, y no un `&&` al final.** Un hijo no es "una versión
 * que además comparte receta": no es una versión, punto — el linaje de versiones y el 1:N son dos
 * ejes distintos y el segundo manda sobre este predicado.
 *
 * 🔴 **Y por qué se pregunta `typeof === 'number'` y no `!== null`.** Esta exclusión es la única
 * parte del predicado que puede DEJAR A UN MODELO FUERA de la revisión, así que su modo de fallo
 * tiene que caer del lado seguro. Con `!== null`, un objeto al que le FALTE la clave —`undefined`,
 * no `null`— contesta "es un hijo" y la versión sin firmar desaparece de la bandeja sin que nadie
 * la revise nunca. **No es hipotético:** al construir V1-E9a, siete pruebas que arman la fila como
 * `Record<string, unknown>` se pusieron en rojo por exactamente eso, y TypeScript no las alcanza.
 * Sólo un id de verdad excluye; lo que no se sabe, no excluye — que es la misma lectura
 * conservadora del párrafo de arriba: pedir la firma de más, nunca de menos.
 */
export function esVersionDeModelo(modelo: {
  idModeloPadre: number | null;
  versionDesarrollo: number | null;
  idModeloDesarrollo: number | null;
}): boolean {
  if (typeof modelo.idModeloDesarrollo === 'number') {
    return false;
  }
  return modelo.idModeloPadre !== null || modelo.versionDesarrollo !== null;
}

// La fecha del acto (`fechaDelActo`) vive en `comun/fecha-negocio.ts` desde V1-E8b: nació aquí, en
// V1-E7d, arreglando que el mensaje del servidor y la ficha del modelo enseñaran DÍAS DISTINTOS para
// el mismo acto, y la invalidación de la firma del PRECIO (V1-E8b) necesitó la misma frase. Se subió
// a `comun/` en vez de copiarse: dos copias del formateador serían dos fechas para el mismo problema.

/**
 * ⭐ V1-E8r (§Post-F9.140) — **EL PREDICADO ÚNICO: ¿a esta versión le FALTA la firma de la
 * revisión?** Es con lo que la BANDEJA «Recetas por revisar» arma su cola, y lo que la ficha del
 * modelo pinta como chip.
 *
 * 🔴 **Se llamaba `revisionBloqueaProduccion` hasta V1-E9c, y el nombre había dejado de ser
 * verdad.** La revisión ya no bloquea producción (§Post-F9.169: *"no detiene ni la producción ni
 * los demás renglones ya firmados"*); lo único que gobierna la COMPRA es la firma por renglón de
 * la receta de la orden. Renombrarlo no es cosmética: una función llamada "bloquea producción" que
 * no bloquea nada es la clase de mentira que hace que el siguiente lector vuelva a cablearla a una
 * operación "porque para eso está".
 *
 * 🔴 **Por qué existe, y qué defecto evita.** Una bandeja escrita "a ojo" listaría
 * `revisionEstado = 'pendiente'` — y eso deja fuera a dos poblaciones que tampoco están firmadas:
 *
 *  • el **`null`** de las versiones que ya existían cuando se desplegó V1-E7d (la migración
 *    `20260826120000` lo dice con todas sus letras: *"para ellas NULL se lee como `pendiente`"*), y
 *  • el **`rechazada`**, que es lo contrario de una firma.
 *
 * Con el predicado "a ojo", esas versiones quedarían **sin firmar y a la vez invisibles**: el
 * estado exacto que V1-E8r vino a matar. Es la MISMA cicatriz de §Post-F9.119, cuando la ficha del
 * modelo preguntaba `revisionEstado !== null` y dejaba versiones sin chip ni botones.
 *
 * ⚠️ **Su gemela EN SQL vive pegada aquí abajo** ({@link SQL_REVISION_SIN_APROBAR}) y una prueba de
 * integración las corre a las dos sobre las 32 combinaciones posibles y las compara fila por fila:
 * si alguien mueve una y no la otra, esa prueba muere.
 */
export function revisionSinAprobar(modelo: RevisionDeModelo): boolean {
  return esVersionDeModelo(modelo) && modelo.revisionEstado !== 'aprobada';
}

/**
 * ⭐ La GEMELA EN SQL de {@link revisionSinAprobar}, para poder **listar** lo que espera firma sin
 * bajarse el catálogo entero a memoria (la agregación es del servidor).
 *
 * ⚠️ Espera la tabla `modelos` **aliaseada como `m`**. Va aquí y no en el archivo de la bandeja a
 * propósito: las dos formas del mismo predicado se leen juntas o se desincronizan.
 *
 * `IS DISTINCT FROM` y no `<> 'aprobada'`: en SQL un `NULL <> 'aprobada'` es NULL —o sea, FALSO
 * para un `WHERE`— y las versiones sin firma se caerían de la lista justo por ser las más viejas.
 */
export const SQL_REVISION_SIN_APROBAR: Prisma.Sql = Prisma.sql`(
  m."id_modelo_desarrollo" IS NULL
  AND (m."id_modelo_padre" IS NOT NULL OR m."version_desarrollo" IS NOT NULL)
  AND m."revision_estado" IS DISTINCT FROM 'aprobada'
)`;

/**
 * Con qué estado se LEE la revisión de una versión: el `null` se pliega a `pendiente`
 * (*"nadie la firmó"*). Se pliega **en el servidor** para que la bandeja y la ficha del modelo no
 * puedan enseñar dos palabras distintas del mismo hecho.
 */
export function estadoRevisionEfectivo(estado: EstadoRevision | null): EstadoRevision {
  return estado ?? 'pendiente';
}

// ── 🔴🔴 V1-E9c (§Post-F9.169) — AQUÍ VIVÍA LA COMPUERTA, Y SE RETIRÓ ─────────────────────────
//
// `exigirRevisionAprobadaParaProducir(modelo)` lanzaba `ErrorConflicto` cuando una VERSIÓN sin
// firma intentaba pasar a producción, y se llamaba desde `promoverAProduccionNucleo` (y, desde
// V1-E9a, desde `derivarModeloDeProduccion`). Daniel la disolvió, textual:
//
//   *«Todo lo que no está firmado simplemente no se puede comprar. Pero no detiene ni la
//    producción ni los demás renglones ya firmados.»*
//
// ⚠️ **SE RETIRÓ ENTERA, no se dejó "por si acaso".** Al quitarle su único acto, una función
// exportada que lanza y que se llama *"exigir revisión aprobada para producir"* es una invitación
// a volver a cablearla —el proyecto no tiene `knip` ni `ts-prune`, así que el lint no la habría
// marcado nunca— y el muro volvería en silencio por la puerta que la cableara.
//
// 🔑 **Y no se perdió nada de lo que sabía:** el conocimiento —*"a esta versión le falta la
// firma"*— vive en `revisionSinAprobar` y en su gemela `SQL_REVISION_SIN_APROBAR`, que siguen aquí
// porque la BANDEJA y la ficha del modelo las preguntan. Lo único que se fue es el `throw`.
//
// 🚧 **La deuda que esto NO cierra** (para que nadie la dé por cerrada): `POST /api/ordenes` →
// `crearOrden` se salta **la PROMOCIÓN ENTERA** (§Post-F9.34), no sólo la compuerta — por esa ruta
// nace una OP de un modelo que sigue en `origen = 'desarrollo'` y **sin `numeroProduccion`**. Es
// alcance de V1-E3 y sigue anotada en `docs/hoja-de-ruta/V1-etapas.md`.

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
  // ⭐ V1-E9a — lo lee `esVersionDeModelo` para dejar fuera a los hijos del linaje 1:N.
  idModeloDesarrollo: true,
  revisionEstado: true,
  revisadoEn: true,
  revisionNota: true,
} as const;

/**
 * Lee el modelo y comprueba lo que las DOS firmas exigen igual: que exista y que sea una VERSIÓN.
 * Devuelve lo leído para que el llamador no repita la consulta.
 *
 * 🔴 **V1-E9c — YA NO exige que el modelo siga en DESARROLLO, y eso es media etapa.** Hasta aquí
 * rebotaba con *"ya está en el catálogo de producción: la revisión es ANTES de mandar a producir"*,
 * y tenía sentido mientras la firma abriera una compuerta: después de promover no le quedaba nada
 * que abrir. Al disolverse la compuerta (§Post-F9.169) esa regla se volvió una TRAMPA: generar la
 * OP promueve el modelo, así que la versión llegaría a producción con la revisión en `pendiente` y
 * **ya nadie podría firmarla nunca** — un acto de negocio que existe, que nadie puede ejecutar y
 * que la bandeja tampoco enseñaría. Hoy la revisión es un REGISTRO, y un registro se puede levantar
 * cuando el revisor de verdad la mira, aunque la orden ya esté corriendo.
 *
 * ⚠️ El `origen` se sigue leyendo: viaja a la BITÁCORA (`origenAlFirmar`) para que el acto diga si
 * se firmó antes o después de que el modelo pasara a producción. Es la única forma de distinguirlo
 * después, porque la fila del modelo sólo guarda el ÚLTIMO acto (D3).
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
  idModeloDesarrollo: number | null;
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
        `(los modelos con sufijo, "CYA-26-71-001-01").`,
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
      throw new ErrorConflicto(`La receta del modelo "${modelo.codigo}" ya está aprobada.`);
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
        // ⭐ V1-E9c — en qué catálogo estaba el modelo AL FIRMAR. Desde §Post-F9.169 se puede
        // revisar también con la OP ya generada (el modelo ya en `produccion`), y ésta es la
        // única forma de distinguir después las dos cosas: la fila sólo guarda el último acto.
        origenAlFirmar: modelo.origen,
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
 * borra), sigue editándose y **vuelve a la cola** de «Recetas por revisar» hasta que se firme.
 *
 * ⚠️ **V1-E9c (§Post-F9.169) — rechazar NO detiene producir.** Aquí decía *"lo que no puede es
 * mandarse a producir"*, y era verdad mientras existiera la compuerta. Hoy una versión rechazada
 * genera su OP igual (`../produccion/salida-produccion.test.ts` lo asevera); lo que frena el gasto
 * es la firma POR RENGLÓN de la receta de la orden. El texto del diálogo que lee quien rechaza dice
 * esto mismo, y está aseverado en `DialogoRevisionModelo.test.tsx`.
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
        origenAlFirmar: modelo.origen,
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

// ── ⭐ V1-E7e (§Post-F9.116): LA APROBACIÓN SE INVALIDA SI LA RECETA CAMBIA ────
//
// El hueco que V1-E7d dejó declarado y Daniel mandó cerrar (*"Sí, ciérralo"*): Aurora aprueba la
// versión, después alguien le cambia el consumo de una tela o le mueve el arte, y la OP sale con
// la aprobación VIEJA sobre una receta que ya no es la que ella miró. Es el mismo problema que la
// revisión viene a evitar, entrando por otra puerta — y peor, porque el sistema la presenta como
// revisada. *Una firma que no está amarrada a lo que se firmó no es una firma: es un adorno.*
//
// ⚠️ **POR QUÉ ESTO VIVE PEGADO A `tocarModelo` Y NO SUELTO EN CADA MUTACIÓN.** El requisito de
// Daniel es TODAS las puertas, no un subconjunto: *"cubrir sólo una parte sería PEOR que no cubrir
// nada, parecería resuelto sin estarlo"*. Antes de esta etapa había TRES copias de `tocarModelo`
// (bom / arte / medidas) y cada mutación de receta llamaba a la suya — o sea, ya existía el
// embudo, sólo estaba triplicado. Aquí se unifica en UNA sola función
// ({@link tocarModeloPorCambioDeReceta}) y la invalidación se mete DENTRO: así no hay forma de
// cambiar la receta y saltarse la caída de la firma sin, literalmente, no marcar el modelo como
// modificado. Y el `cambio` es un parámetro OBLIGATORIO: una puerta nueva no compila hasta que
// declara qué parte de la receta toca.

/**
 * Qué parte de la receta cambió. No es adorno: es lo que la nota de la invalidación le va a
 * decir a quien vuelva a revisar (b), y lo que queda en la bitácora para reconstruir la secuencia
 * de actos (c).
 */
export type CambioDeReceta =
  | 'telas'
  | 'avios'
  | 'medidas-por-talla'
  | 'arte'
  | 'copia-de-otro-modelo';

/** Cómo se lee cada cambio en la nota que ve el humano (en su idioma, no en clave). */
const TEXTO_CAMBIO: Record<CambioDeReceta, string> = {
  telas: 'las TELAS',
  avios: 'los AVÍOS',
  'medidas-por-talla': 'las MEDIDAS POR TALLA de un avío',
  arte: 'el ARTE',
  'copia-de-otro-modelo': 'la receta COMPLETA (se copió la de otro modelo)',
};

/**
 * ⭐ V1-E8d — Traduce el código guardado en `Modelo.recetaTocadaCambio` a la frase que lee el
 * humano. Vive AQUÍ, junto al catálogo que traduce, para que no nazca una segunda tabla de textos
 * que se desincronice con {@link TEXTO_CAMBIO} en la primera corrección.
 *
 * Recibe `string | null` y no `CambioDeReceta` a propósito: lo que llega de la columna es TEXTO, y
 * un código que esta versión del código no conoce (una puerta futura desplegada y revertida, un
 * dato tocado a mano) tiene que producir una frase honesta —*"la receta"*— en vez de un `undefined`
 * incrustado en mitad del aviso.
 */
export function textoDelCambioDeReceta(cambio: string | null): string {
  if (cambio !== null && cambio in TEXTO_CAMBIO) {
    return TEXTO_CAMBIO[cambio as CambioDeReceta];
  }
  return 'la receta';
}

/**
 * ⭐ Si la revisión del modelo está **APROBADA**, la devuelve a **pendiente** porque su receta
 * acaba de cambiar. Devuelve `true` si de verdad tumbó una firma.
 *
 * ⚠️ **A QUIÉN alcanza.** Sólo mira `revisionEstado === 'aprobada'`, y esa columna únicamente la
 * tienen las VERSIONES: en los ~4,987 modelos migrados y en cualquier desarrollo normal viene en
 * `null`, así que esta función es un no-op para ellos y su conducta NO cambia (el alcance que fijó
 * §Post-F9.116). Tampoco toca a las que están `pendiente` o `rechazada`: ahí no hay firma que
 * caer, y pisar el motivo de un rechazo con el de la invalidación borraría lo único que le sirve
 * a quien tiene que corregir.
 *
 * ⚠️ **QUÉ QUEDA ESCRITO (b y c).** Las CUATRO columnas del acto se escriben juntas, como manda
 * V1-E7d: la invalidación es un acto NUEVO que sustituye al anterior completo, no una limpieza de
 * campos sueltos que dejaría una tupla mentirosa ("pendiente" con el nombre de quien aprobó
 * colgando, como si hubiera firmado esto). Quién firmó y cuándo se van a `null` porque es la
 * verdad —**nadie** ha revisado la receta que hay AHORA— y el porqué se queda en `revisionNota`,
 * que es lo que la pantalla enseña. La SECUENCIA (aprobó Aurora el 12 → cambió la tela el 14 →
 * se volvió a firmar el 15) vive en la BITÁCORA, que se agrega y jamás se edita (D3): el renglón
 * de la invalidación se lleva a quién le tumbó la firma y de cuándo era.
 *
 * ⚠️ **NO cierra ningún camino (d).** El modelo queda `pendiente`, exactamente igual que una
 * versión recién nacida: se vuelve a firmar con `modelos.aprobar-receta` como siempre. No hay
 * estado muerto.
 */
export async function invalidarRevisionSiAprobada(
  tx: Tx,
  sesion: SesionUsuario,
  idModelo: number,
  cambio: CambioDeReceta,
): Promise<boolean> {
  const modelo = await tx.modelo.findUnique({
    where: { id: idModelo },
    select: {
      codigo: true,
      revisionEstado: true,
      idRevisadoPor: true,
      revisadoEn: true,
      revisionNota: true,
    },
  });

  // `null` = el modelo no existe; quien llamó ya lo exigió y su propio `update` va a tronar. Aquí
  // no se inventa un error distinto: esta función sólo sabe de firmas.
  if (modelo === null || modelo.revisionEstado !== 'aprobada') {
    return false;
  }

  const cuando = new Date();
  const desde =
    modelo.revisadoEn === null ? '' : ` La aprobación era del ${fechaDelActo(modelo.revisadoEn)}.`;
  const nota =
    `Se INVALIDÓ automáticamente el ${fechaDelActo(cuando)}: después de aprobarse cambió ` +
    `${TEXTO_CAMBIO[cambio]} de la receta, así que la firma anterior ya no corresponde a lo que ` +
    `se va a fabricar.${desde} Hay que volver a revisarla.`;

  await tx.modelo.update({
    where: { id: idModelo },
    data: {
      revisionEstado: 'pendiente',
      // Nadie ha revisado la receta que hay AHORA: dejar aquí a quien aprobó la anterior sería
      // exactamente la firma-adorno que esta etapa vino a matar.
      idRevisadoPor: null,
      revisadoEn: null,
      revisionNota: nota,
      ...datosModificacion(sesion),
    },
  });

  await registrarBitacora(tx, sesion, {
    entidad: 'Modelo',
    idEntidad: idModelo,
    accion: 'MODIFICAR',
    datos: {
      operacion: 'invalidar-revision',
      codigo: modelo.codigo,
      cambio,
      // El acto que se cae viaja ÍNTEGRO al renglón: sin esto, la bitácora no podría contestar
      // "¿quién la había aprobado y cuándo?" una vez que la fila se sobrescribió (D3).
      estadoAnterior: modelo.revisionEstado,
      idAprobadorAnterior: modelo.idRevisadoPor,
      aprobadaEn: modelo.revisadoEn === null ? null : modelo.revisadoEn.toISOString(),
      notaAnterior: modelo.revisionNota,
      nota,
    },
  });

  return true;
}

/**
 * ⭐ **EL EMBUDO DE TODA MUTACIÓN DE RECETA.** Marca la auditoría del modelo (`modificadoPor/En`,
 * A7) y, si su revisión venía APROBADA, la tumba a `pendiente` (§Post-F9.116) — todo dentro de la
 * MISMA transacción del cambio (A2), porque una firma que cae "después" es una firma que no cayó.
 *
 * Lo llaman las CINCO familias que pueden mover la receta: telas y avíos del BOM
 * (`bom-modelo.ts`), avíos aceptados del catálogo de favoritos (`avios-favoritos.ts`), medidas por
 * talla (`medidas-avio-talla.ts`), arte y sus fotos (`arte-modelo.ts`) y el copiado de receta
 * completa (`copiarBom`). Si mañana nace una sexta, **tiene que pasar por aquí**: el guardián de
 * `receta-embudo.test.ts` falla si aparece una escritura a `ModeloTela`/`ModeloAvio`/
 * `ModeloAvioTalla`/`ModeloArte` en un archivo que no lo importe.
 *
 * ⭐ **V1-E8d (§Post-F9.127) — y desde aquí sale además la MARCA DE AGUA de la receta.** El mismo
 * `update` sella `recetaTocadaEn` + `recetaTocadaCambio`. Que sea este embudo y no una escritura
 * suelta es la etapa entera: son las únicas dos columnas del modelo que significan *"cambió la
 * RECETA"* y no *"se tocó el modelo"*, y por eso el aviso de «tu precio está sobre un costo viejo»
 * (`../desarrollo/costo-viejo.ts`) no grita en falso cuando alguien renombra un modelo o le cambia
 * una foto. Una puerta nueva de receta las hereda sin hacer nada — ya no compila sin pasar por aquí.
 *
 * ⚠️ **Deja DOS `update` sobre la misma fila cuando sí hay firma que tumbar**, y es a propósito:
 * {@link invalidarRevisionSiAprobada} tiene que ser un acto completo por sí solo —estado +
 * bitácora— y no la mitad de un `data` que arma otro. Pasa una vez cada tantas ediciones (sólo
 * cuando la versión estaba aprobada) y compra que la invalidación se pueda leer, probar y llamar
 * suelta sin depender de quién la envuelva.
 */
export async function tocarModeloPorCambioDeReceta(
  tx: Tx,
  sesion: SesionUsuario,
  idModelo: number,
  cambio: CambioDeReceta,
): Promise<void> {
  await invalidarRevisionSiAprobada(tx, sesion, idModelo, cambio);
  await tx.modelo.update({
    where: { id: idModelo },
    data: {
      // ⭐ V1-E8d (§Post-F9.127) — LA MARCA DE AGUA DE LA RECETA. Este es el ÚNICO lugar del
      // sistema que escribe estas dos columnas, y es lo que las hace creíbles: `modificadoEn` (que
      // se pone justo al lado) se mueve con cualquier escritura al modelo —renombrarlo, subirle una
      // foto, firmar su revisión—, así que no distingue un cambio de receta de un detalle. Estas
      // dos sí, porque sólo pasan por aquí. Con ellas, un renglón de lista de precios puede saber
      // que su precosto congelado —inmutable por diseño (D3)— quedó viejo, y decirlo.
      recetaTocadaEn: new Date(),
      recetaTocadaCambio: cambio,
      ...datosModificacion(sesion),
    },
  });
}
