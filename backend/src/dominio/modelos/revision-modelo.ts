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

/**
 * Fecha del acto de revisión tal y como la va a LEER quien firma, aquí en México.
 *
 * ⚠️ No es `toISOString()`: `revisadoEn` es un instante (no una fecha-only a medianoche UTC como
 * las de `indicadores/fechas.ts`), el servidor corre en UTC y quien lo lee vive en `-06:00`. Un
 * rechazo firmado a las 18:00 de Ciudad de México cae ya en el día siguiente en UTC, así que el
 * mensaje de error diría un día y la ficha del modelo —que lo pinta con
 * `toLocaleDateString('es-MX')` en el navegador— diría otro: dos fechas para el mismo acto. Se
 * formatea con la MISMA llamada que la pantalla, con el huso escrito a mano porque el servidor no
 * lo hereda de nadie.
 */
const ZONA_DEL_NEGOCIO = 'America/Mexico_City';

function fechaDelActo(fecha: Date): string {
  return fecha.toLocaleDateString('es-MX', { timeZone: ZONA_DEL_NEGOCIO });
}

/**
 * ⭐ **LA COMPUERTA.** Lanza si el modelo es una VERSIÓN cuya revisión no está aprobada; si no es
 * una versión, no hace absolutamente nada (los modelos normales no cambian de conducta).
 *
 * Se llama desde {@link promoverAProduccionNucleo} y por eso protege **los dos caminos que
 * PROMUEVEN** el modelo: el endpoint «pasar a producción» y la generación de la OP.
 *
 * ⚠️ **No se dice "las dos puertas" a propósito: hay una TERCERA.** `POST /api/ordenes` →
 * `crearOrden` crea una OP **sin promover** el modelo, así que no pasa por
 * {@link promoverAProduccionNucleo} y esta compuerta no la mira. Es un hueco **sólo por API**
 * (no tiene llamador en el frontend, y los dos importadores de pedido reusan `salidaAProduccion`,
 * que sí promueve), **pre-existente** a esta etapa —viene de F2— y que además se salta la
 * promoción de §Post-F9.34 entera. Queda anotado como deuda con nombre en
 * `docs/hoja-de-ruta/V1-etapas.md` §V1-E7d; cerrarlo es tocar el módulo de órdenes.
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
    const cuando = modelo.revisadoEn === null ? '' : ` el ${fechaDelActo(modelo.revisadoEn)}`;
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
    modelo.revisadoEn === null ? '' : ` La aprobación era del ${fechaCorta(modelo.revisadoEn)}.`;
  const nota =
    `Se INVALIDÓ automáticamente el ${fechaCorta(cuando)}: después de aprobarse cambió ` +
    `${TEXTO_CAMBIO[cambio]} de la receta, así que la firma anterior ya no corresponde a lo que ` +
    `se va a fabricar.${desde} Hay que volver a revisarla antes de mandarla a producir.`;

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
  await tx.modelo.update({ where: { id: idModelo }, data: { ...datosModificacion(sesion) } });
}
