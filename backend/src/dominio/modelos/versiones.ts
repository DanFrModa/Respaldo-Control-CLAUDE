/**
 * ⭐ V1-E7b — LA VERSIÓN DE UN MODELO NACE CON SUFIJO (§Post-F9.110, decisión de Daniel).
 *
 * Cuando se negocia con el cliente y la receta cambia (ejemplo suyo: se le quita el cierre a una
 * sudadera para bajar el precio), **el modelo original NO se edita**. Nace un modelo NUEVO con
 * sufijo de versión que hereda la receta completa, y el original queda intacto: lo que ya se
 * produjo con la receta vieja conserva su verdad (D3, "nada se edita ni se borra").
 *
 * Palabras de Daniel: *"¿Por qué no dejamos el mismo modelo, pero le adjuntamos un nuevo número?
 * Al final le ponemos otro -01 y así sabemos que heredamos el modelo xxx pero es la nueva versión.
 * De esta manera creamos el nuevo modelo, que tendrá la nueva receta, y el modelo original queda
 * igual"*.
 *
 * Las cuatro reglas que él fijó, y que este archivo hace cumplir:
 *
 *  1. `CYA-26-71-001` → su versión es `CYA-26-71-001-01`.
 *  2. **PLANO, NUNCA ANIDADO.** Versionar `CYA-26-71-001-01` da `CYA-26-71-001-02`, jamás
 *     `CYA-26-71-001-01-01` — razón suya: *"con anidamiento, en tres temporadas hay -01-02-01 y
 *     nadie lo lee"*. Por eso todo se calcula contra la **RAÍZ** de la familia, no contra el padre.
 *  3. El sufijo **NO quema un consecutivo nuevo** de la serie de desarrollo: es sufijo del código
 *     que YA existe, no un código nuevo. Aquí no se llama a `mintearCodigoDesarrollo` a propósito.
 *  4. El sufijo vive en el mundo de **DESARROLLO**. Al salir a producción el modelo toma su número
 *     de 5 dígitos como cualquier otro (`nomenclatura.ts`), y eso no cambia.
 *
 * ⭐ **V1-E7d añadió la quinta regla** (§Post-F9.110, misma decisión): la versión nace **PENDIENTE
 * DE REVISIÓN** y no pasa a producción hasta que alguien con `modelos.aprobar-receta` la firme —
 * *"enfrente del cliente puede ser que se cometa una imprudencia o un error"*. Ver
 * `revision-modelo.ts`; la compuerta vive en `promoverAProduccionNucleo` para cerrar también la
 * puerta lateral de generar la OP.
 *
 * ⚠️ **Por qué hace falta un advisory lock.** El siguiente sufijo es `max(los que ya hay) + 1`
 * sobre la familia de la raíz — un `Max()+1`, que A3 sólo tolera dentro de un lock (mismo caso y
 * mismo razonamiento que el consecutivo de PRODUCCIÓN, ver el encabezado de `nomenclatura.ts` y
 * ADR-0018). Y no puede salir de una secuencia: la serie no es global, es *por familia*, arranca
 * en 1 en cada modelo raíz y sólo existe cuando alguien versiona. Sin el lock, dos personas
 * versionando el mismo padre a la vez leen ambas "no hay ninguna" y sacan las dos `-01`; con él,
 * elegir el sufijo y escribirlo son un solo hecho serializado, y el `@unique` de `codigo` /
 * `codigoDesarrollo` queda de última red.
 *
 * ⚠️ **Y por qué las comparaciones de código van `mode: 'insensitive'`.** Cicatriz de V1-E3n: un
 * centinela comparaba exacto mientras el alta bloquea sin distinguir mayúsculas, así que la
 * colisión no se absorbía —se dejaba llegar al `@unique`— y abortaba la transacción entera en vez
 * de avanzar al siguiente sufijo libre.
 */
import { aJsonBitacora, datosCreacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { enTransaccion, type ContextoBd, type Tx } from '../../comun/transaccion.js';

import {
  CAMPOS_FICHA_HEREDADOS,
  exigirDigitosDeNomenclatura,
  incluirRelacionesModelo,
  type ModeloConRelaciones,
} from './modelos.js';

/**
 * Namespace del `pg_advisory_xact_lock` que serializa el minteo del SUFIJO de versión de UNA
 * familia de modelos. Segunda clave = el hash de la RAÍZ (no el id del padre: dos personas
 * versionando padres DISTINTOS de la misma familia —el original y su `-01`— compiten por el mismo
 * sufijo y tienen que esperarse).
 *
 * Inventario de la familia 20_5xx en el comentario de `NAMESPACE_LOCK_FOTOS` (`fotos-modelo.ts`);
 * el 20_546 lo estrenó `nomenclatura.ts` y **éste estrena el 20_547**.
 */
const NAMESPACE_LOCK_VERSION = 20_547;

/** Cuántos sufijos se prueban si el que toca resulta ocupado (colisión con un código a mano). */
const MAX_INTENTOS_SUFIJO = 50;

/**
 * Forma canónica de un código de DESARROLLO con su sufijo de versión OPCIONAL:
 * `CYA-26-71-001` (raíz) o `CYA-26-71-001-01` (versión 1).
 *
 * ⚠️ **La trampa que este patrón evita, y que hay que seguir evitando:** el código base YA termina
 * en `-001` (el consecutivo). Un "quítale el último `-NN`" a ciegas convertiría `CYA-26-71-001` en
 * `CYA-26-71` y la familia entera cambiaría de raíz. Por eso el prefijo se exige COMPLETO
 * (abreviatura + año + par + consecutivo de 3+ dígitos, la misma forma que arma
 * `armarCodigoDesarrollo`) y sólo lo que sobra DESPUÉS de él puede ser sufijo de versión.
 */
const PATRON_CODIGO_CON_VERSION = /^([A-Za-z0-9]{2,6}-\d{2}-\d{2}-\d{3,})(?:-(\d+))?$/;

/** La raíz de una familia de versiones y, si el código venía versionado, qué versión era. */
export interface RaizDeVersion {
  /** Código SIN sufijo de versión: el tronco del que cuelgan todas las versiones. */
  raiz: string;
  /** Número de versión que traía el código, o `null` si es la raíz misma. */
  version: number | null;
}

/**
 * Descompone un código de desarrollo en RAÍZ + versión. Regla 2 de Daniel: todo se numera contra
 * la raíz, así que versionar un `-01` produce un `-02` y nunca un `-01-01`.
 *
 * `versionConocida` es el `versionDesarrollo` del modelo cuando el sistema lo minteó: es la verdad
 * y manda sobre el texto. Sirve para los códigos que NO tienen la forma canónica (capturados a
 * mano o importados): ahí el texto no se puede interpretar sin adivinar, pero el número sí se sabe
 * y el sufijo se recorta exacto.
 *
 * Si el código no es canónico y no hay versión conocida, se devuelve TAL CUAL como raíz: preferir
 * un `-01` de más a inventarle una raíz que no le corresponde.
 */
export function raizDeCodigoDesarrollo(
  codigo: string,
  versionConocida?: number | null,
): RaizDeVersion {
  // 1) La verdad de la BASE primero: si el modelo dice "soy la versión N", su sufijo es exactamente
  //    `-N` (con o sin cero a la izquierda) y se recorta sin interpretar nada.
  if (versionConocida != null) {
    for (const sufijo of [`-${sufijoTexto(versionConocida)}`, `-${String(versionConocida)}`]) {
      if (codigo.length > sufijo.length && codigo.endsWith(sufijo)) {
        return { raiz: codigo.slice(0, -sufijo.length), version: versionConocida };
      }
    }
  }

  // 2) El TEXTO después: sólo se recorta un sufijo cuando lo que queda delante es un código de
  //    desarrollo COMPLETO (ver la trampa del `-001` en el comentario del patrón).
  const m = PATRON_CODIGO_CON_VERSION.exec(codigo);
  if (m?.[1] !== undefined) {
    const sufijo = m[2];
    return { raiz: m[1], version: sufijo === undefined ? null : Number(sufijo) };
  }

  // 3) Código no canónico y sin versión conocida: es su propia raíz.
  return { raiz: codigo, version: versionConocida ?? null };
}

/** Formatea el número de versión como sale en el código: dos dígitos (`1` → `01`, `12` → `12`). */
export function sufijoTexto(version: number): string {
  return String(version).padStart(2, '0');
}

/** Arma el código de una versión: la raíz + su sufijo (`CYA-26-71-001` + 1 → `CYA-26-71-001-01`). */
export function codigoDeVersion(raiz: string, version: number): string {
  return `${raiz}-${sufijoTexto(version)}`;
}

/**
 * El siguiente número de versión de una familia: `max(los que ya hay) + 1`, o 1 si no hay ninguna.
 * Función PURA a propósito (la lectura de la familia y el lock viven en {@link mintearVersionDeModelo}).
 */
export function siguienteVersion(versionesUsadas: readonly number[]): number {
  let maximo = 0;
  for (const v of versionesUsadas) {
    if (Number.isFinite(v) && v > maximo) {
      maximo = v;
    }
  }
  return maximo + 1;
}

/** Lo que puede ajustarse al crear la versión (el resto se HEREDA del padre tal cual). */
export interface DatosVersionModelo {
  /** Descripción de la versión; si se omite, hereda la del padre. */
  descripcion?: string | undefined;
}

/**
 * MINTEA la versión de un modelo: crea el modelo NUEVO con el siguiente sufijo de la familia,
 * le copia la receta del padre y deja el padre INTACTO. Corre dentro de la transacción del
 * llamador (A2: o queda la versión con su receta completa, o no queda nada).
 *
 * Qué hereda la versión:
 *  • Los campos de FICHA del padre ({@link CAMPOS_FICHA_HEREDADOS}).
 *  • La RECETA completa: telas, avíos (con sus medidas por talla) y arte. Es una **copia
 *    congelada**, no una referencia: es el mismo patrón que gobierna receta modelo→ORDEN
 *    (`produccion/receta-orden.ts`), y es lo que permite que la versión evolucione sin mover ni
 *    un gramo de lo que el padre ya tiene.
 *
 * Qué NO hereda:
 *  • El `numeroProduccion`: la versión NACE en desarrollo (regla 4) y estrenará el suyo cuando se
 *    promueva. El CHECK de la base (`modelos_desarrollo_sin_numero_produccion_check`) lo exige.
 *  • Las FOTOS del modelo (`ModeloFoto`): son la foto de ESE modelo y viven en R2; duplicar el
 *    registro no duplicaría el objeto, pero tampoco es lo que se espera de un modelo recién
 *    nacido — se le suben las suyas. (Las fotos del ARTE sí viajan, pero **compartiendo** el mismo
 *    `Archivo`: no se copia ningún objeto de R2, exactamente como hace «copiar arte de otro
 *    modelo» en `arte-modelo.ts`.)
 *
 * El padre no recibe ni un `update`: leerlo es lo único que se hace con él.
 */
export async function mintearVersionDeModelo(
  tx: Tx,
  sesion: SesionUsuario,
  idModeloPadre: number,
  datos: DatosVersionModelo = {},
): Promise<number> {
  const padre = await tx.modelo.findUnique({
    where: { id: idModeloPadre },
    select: {
      id: true,
      codigo: true,
      codigoDesarrollo: true,
      versionDesarrollo: true,
      activo: true,
      ...CAMPOS_FICHA_HEREDADOS,
    },
  });
  if (padre === null) {
    throw new ErrorNoEncontrado('Modelo', idModeloPadre);
  }

  // El versionado vive en el mundo de DESARROLLO (regla 4): el sufijo cuelga del código de
  // desarrollo, y un modelo que nunca lo tuvo —los 4,987 migrados del Access— no tiene de dónde
  // colgarlo. Se rechaza en vez de inventarle uno: versionar un modelo puramente de producción es
  // una decisión de negocio que Daniel todavía no ha tomado, y esta etapa NO la toma por él.
  if (padre.codigoDesarrollo === null) {
    throw new ErrorValidacion(
      `El modelo "${padre.codigo}" no tiene número de DESARROLLO, y la versión con sufijo cuelga ` +
        `de él (el "-01" de CYA-26-71-001-01). Los modelos migrados del sistema viejo nacieron ` +
        `directamente en producción: para cambiarles la receta hay que darlos de alta en ` +
        `Desarrollo.`,
    );
  }

  // ⭐ V1-E7e (§Post-F9.119, DANIEL): un modelo DESCONTINUADO no se versiona. Hasta hoy sí se
  // podía, mientras el vecino más cercano —dar de alta un desarrollo, `desarrollo/desarrollos.ts`
  // `exigirModeloActivo`— lo bloqueaba: dos puertas con reglas distintas para el mismo hecho.
  // Daniel: *"Sí. Está bien. Hay que activarlo para poder usarlo nuevamente"*.
  //
  // ⚠️ El valor del candado NO es impedir que un modelo descontinuado reviva —descontinuar es una
  // casilla que alguien desmarcó y es REVERSIBLE, así que el caso de negocio "revivirlo con receta
  // nueva" sigue vivo—: es que REVIVIRLO SEA UN ACTO QUE ALGUIEN DECIDE, y no el efecto lateral de
  // versionar. Reactivar cuesta un clic; que un modelo dado de baja vuelva al catálogo sin que
  // nadie lo haya querido, no se paga con nada.
  //
  // ⚠️ VA DESPUÉS del candado del código de desarrollo, y el orden importa: un modelo migrado y
  // además descontinuado NUNCA se va a poder versionar, así que mandarlo primero a reactivarse
  // sería mandarlo a una puerta que igual está cerrada. Primero lo que no tiene arreglo.
  if (!padre.activo) {
    throw new ErrorConflicto(
      `El modelo "${padre.codigo}" está descontinuado; reactívalo primero si lo vas a ` +
        `re-desarrollar. Se hace desde la ficha del modelo, marcándolo como activo.`,
    );
  }

  const { raiz } = raizDeCodigoDesarrollo(padre.codigoDesarrollo, padre.versionDesarrollo);

  // ⚠️ EL LOCK VA ANTES DE LEER LA FAMILIA. Dentro de él, "¿qué sufijos hay?" y "escribo el
  // siguiente" son un solo hecho: dos personas versionando a la vez se serializan y salen `-01` y
  // `-02`, no dos `-01`. La llave se deriva de la RAÍZ (no del padre) porque la serie es de la
  // FAMILIA. Familias distintas no se estorban; una colisión de hash sólo serializa de más.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NAMESPACE_LOCK_VERSION}::int, ${claveLockDeRaiz(
    raiz,
  )}::int)`;

  const familia = await tx.modelo.findMany({
    where: { codigoDesarrollo: { startsWith: `${raiz}-`, mode: 'insensitive' } },
    select: { codigoDesarrollo: true, versionDesarrollo: true },
  });

  // Se leen las DOS fuentes: el número guardado (la verdad de lo que minteó el sistema) y el
  // sufijo del texto (un código capturado a mano también OCUPA su lugar en la familia, aunque su
  // columna no se haya poblado). Mismo criterio que `consecutivosUsados` en `nomenclatura.ts`.
  const usadas: number[] = [];
  for (const hermano of familia) {
    if (hermano.versionDesarrollo !== null) {
      usadas.push(hermano.versionDesarrollo);
    }
    const sufijo = hermano.codigoDesarrollo?.slice(raiz.length + 1);
    if (sufijo !== undefined && /^\d+$/.test(sufijo)) {
      usadas.push(Number(sufijo));
    }
  }

  let version = siguienteVersion(usadas);
  let codigo = codigoDeVersion(raiz, version);
  // Red de seguridad: el código podría estar ocupado por un modelo que NO cuelga de esta familia
  // por `codigoDesarrollo` (uno cuyo `codigo` se tecleó así a mano). Se absorbe avanzando al
  // siguiente sufijo — jamás dejando que la colisión reviente la transacción entera.
  let libre = false;
  for (let intento = 0; intento < MAX_INTENTOS_SUFIJO; intento += 1) {
    const ocupado = await tx.modelo.findFirst({
      where: {
        OR: [
          { codigo: { equals: codigo, mode: 'insensitive' } },
          { codigoDesarrollo: { equals: codigo, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    if (ocupado === null) {
      libre = true;
      break;
    }
    version += 1;
    codigo = codigoDeVersion(raiz, version);
  }
  if (!libre) {
    throw new ErrorValidacion(
      `No se encontró un sufijo de versión libre para "${raiz}" (se probaron ` +
        `${String(MAX_INTENTOS_SUFIJO)}). Revisa los códigos de esa familia.`,
    );
  }

  // ⭐ V1-E8j · R4-H1 — LA TERCERA PUERTA: la versión HEREDA el par del padre, así que hereda
  // también su defecto. Y el padre SÍ puede estar mal: la edición deja vaciarle los dos dígitos a
  // un modelo de PRODUCCIÓN —laxitud deliberada, los ~4,987 migrados no traen género— y un modelo
  // PROMOVIDO conserva su `codigoDesarrollo`, así que pasa los candados de arriba y se puede
  // versionar. La hija nacería `desarrollo` con el par en null: el mismo estado prohibido que el
  // alta y la edición ya cierran, alcanzado **componiendo dos escritores legales**.
  //
  // ⚠️ Se valida AQUÍ y no al promover a propósito: aceptar que la hija nazca en borrador y ya se
  // validará después es exactamente el razonamiento que §Post-F9.134 rechazó para el alta.
  //
  // 🔑 Y se hace llamando a **la MISMA función** del alta, no resumiéndola: es la lección de R3-H1,
  // donde una copia reducida de esta misma comprobación derivó antes de comitearse.
  if (padre.idTipoProducto === null || padre.idGenero === null) {
    throw new ErrorValidacion(
      `El modelo "${padre.codigo}" no tiene ${padre.idTipoProducto === null ? 'tipo de prenda' : 'género'} ` +
        `capturado, y la versión nacería sin poder recibir su número de producción. Captúraselo ` +
        `primero en su ficha.`,
    );
  }
  await exigirDigitosDeNomenclatura(tx, padre.idTipoProducto, padre.idGenero);

  const hija = await tx.modelo.create({
    data: {
      // El código VIGENTE y el de DESARROLLO valen lo mismo mientras el modelo es de desarrollo
      // (misma regla que el alta de desarrollo, §Post-F9.34 punto 5).
      codigo,
      codigoDesarrollo: codigo,
      origen: 'desarrollo',
      // Nace SIN nº de producción: lo estrenará al promoverse, como cualquier otro (regla 4).
      numeroProduccion: null,
      versionDesarrollo: version,
      idModeloPadre: padre.id,
      // ⭐ V1-E7d (§Post-F9.110) — la versión NACE PENDIENTE DE REVISIÓN. La receta que hereda se
      // acordó en la mesa, frente al cliente, y hasta que alguien con `modelos.aprobar-receta` la
      // firme no puede mandarse a producir (la compuerta vive en `promoverAProduccionNucleo`, y
      // por eso también le cierra la puerta lateral de generar la OP). Nacer en `pendiente` y no
      // en `null` es lo que separa "espera revisión" de "no lleva revisión" (los modelos que no
      // son versiones).
      revisionEstado: 'pendiente',
      descripcion: datos.descripcion ?? padre.descripcion,
      composicion: padre.composicion,
      maquilaBase: padre.maquilaBase,
      corteBase: padre.corteBase,
      idTemporada: padre.idTemporada,
      idCurvaTalla: padre.idCurvaTalla,
      idGenero: padre.idGenero,
      idTipoProducto: padre.idTipoProducto,
      idMaquileroCotizado: padre.idMaquileroCotizado,
      numOperaciones: padre.numOperaciones,
      secuenciaEstampado: padre.secuenciaEstampado,
      llevaArte: padre.llevaArte,
      ...datosCreacion(sesion),
    },
    select: { id: true },
  });

  const copiada = await copiarRecetaAModeloNuevo(tx, sesion, padre.id, hija.id);

  await registrarBitacora(tx, sesion, {
    entidad: 'Modelo',
    idEntidad: hija.id,
    accion: 'CREAR',
    datos: {
      operacion: 'crear-version',
      codigo,
      version,
      // De qué padre salió y de qué raíz cuelga: el linaje queda en la bitácora además de en la
      // columna (A7 — quién aprobó este cambio de receta y sobre qué).
      idModeloPadre: padre.id,
      codigoPadre: padre.codigo,
      codigoDesarrolloPadre: padre.codigoDesarrollo,
      raiz,
      recetaCopiada: aJsonBitacora(copiada),
      // V1-E7d: nace pendiente de revisión, y el acto de firmarla deja su propio renglón.
      revisionEstado: 'pendiente',
    },
  });

  return hija.id;
}

/** Qué se copió de la receta (telas, avíos, sus medidas por talla y artes). */
export interface RecetaCopiada {
  telas: number;
  avios: number;
  medidas: number;
  artes: number;
}

/**
 * Copia la RECETA de un modelo a OTRO modelo recién nacido (telas, avíos + sus medidas por talla,
 * y arte con sus fotos compartidas).
 *
 * ⚠️ **Por qué no se reusa `copiarBom` de `bom-modelo.ts`, que copia lo mismo.** Porque exige
 * `modelos.administrar`, y ése se corta en Directivo: reusarlo dejaría fuera a Gerencial, que es
 * exactamente a quien Daniel le encargó aprobar recetas (*"Aurora podría hacerlo aparte de mí"*).
 * Aquí, además, el destino acaba de nacer VACÍO: no hay nada que reemplazar, fusionar ni
 * deduplicar, así que el camino es recto. Tampoco se reusa `copiarRecetaDelModelo`
 * (`produccion/receta-orden.ts`): ése es modelo→ORDEN y congela PRECIOS, que aquí no aplican.
 *
 * ⭐ **V1-E8y la EXPORTA** (§Post-F9.152). «Copiar un modelo» desde la mesa de negociación necesita
 * exactamente esto —un destino recién nacido y vacío que hereda la receta entera— y la alternativa
 * era escribir una segunda copia reducida, que en este proyecto siempre termina derivando. Lo que
 * NO se reusó es `mintearVersionDeModelo` completa, y por una razón de negocio: una VERSIÓN cuelga
 * de la familia del padre (`CYA-26-71-001` → `-01`) y ese código lleva dentro la abreviatura del
 * cliente del padre. Copiar el modelo de un cliente para cotizárselo a OTRO tiene que **mintear un
 * código nuevo** del cliente de la mesa, no colgarse de la familia ajena.
 */
export async function copiarRecetaAModeloNuevo(
  tx: Tx,
  sesion: SesionUsuario,
  idPadre: number,
  idHijo: number,
): Promise<RecetaCopiada> {
  const auditoria = datosCreacion(sesion);

  const [telas, avios, artes] = await Promise.all([
    tx.modeloTela.findMany({ where: { idModelo: idPadre } }),
    tx.modeloAvio.findMany({ where: { idModelo: idPadre } }),
    tx.modeloArte.findMany({
      where: { idModelo: idPadre },
      orderBy: [{ orden: 'asc' }, { id: 'asc' }],
      include: { fotos: { select: { idArchivo: true, orden: true }, orderBy: { orden: 'asc' } } },
    }),
  ]);

  if (telas.length > 0) {
    // El AMARRE de precio (R17, `idTelaProveedor`) viaja con el renglón: heredar la receta y
    // perder el proveedor amarrado dejaría a la versión costeando con el precio genérico sin
    // avisar (misma razón que en `copiarBom`).
    await tx.modeloTela.createMany({
      data: telas.map((t) => ({
        idModelo: idHijo,
        idTela: t.idTela,
        consumoPorPrenda: t.consumoPorPrenda,
        paraPreCosto: t.paraPreCosto,
        paraProduccion: t.paraProduccion,
        paraCosto: t.paraCosto,
        idTelaProveedor: t.idTelaProveedor,
        ...auditoria,
      })),
    });
  }

  let medidas = 0;
  if (avios.length > 0) {
    await tx.modeloAvio.createMany({
      data: avios.map((a) => ({
        idModelo: idHijo,
        idAvio: a.idAvio,
        consumoPorPrenda: a.consumoPorPrenda,
        paraPreCosto: a.paraPreCosto,
        paraProduccion: a.paraProduccion,
        paraCosto: a.paraCosto,
        consumoPorTalla: a.consumoPorTalla,
        idAvioProveedor: a.idAvioProveedor,
        ...auditoria,
      })),
    });

    // MEDIDAS POR TALLA (R18): sin ellas la versión heredaría el toggle "se consume por talla"
    // encendido y la matriz VACÍA — un avío que dice costear por talla y no tiene ni una medida.
    const medidasPadre = await tx.modeloAvioTalla.findMany({ where: { idModelo: idPadre } });
    if (medidasPadre.length > 0) {
      await tx.modeloAvioTalla.createMany({
        data: medidasPadre.map((m) => ({
          idModelo: idHijo,
          idAvio: m.idAvio,
          idTalla: m.idTalla,
          consumo: m.consumo,
          idAvioMedida: m.idAvioMedida,
          ...auditoria,
        })),
      });
      medidas = medidasPadre.length;
    }
  }

  // El arte se crea uno a uno (lleva fotos anidadas, que `createMany` no admite); son un puñado
  // por modelo. Las fotos COMPARTEN el `Archivo` del padre: no se duplica ningún objeto de R2.
  for (const a of artes) {
    await tx.modeloArte.create({
      data: {
        idModelo: idHijo,
        descripcion: a.descripcion,
        posicion: a.posicion,
        puntadas: a.puntadas,
        precio: a.precio,
        idTipoArte: a.idTipoArte,
        idProveedor: a.idProveedor,
        orden: a.orden,
        fotos: {
          create: a.fotos.map((f) => ({
            idArchivo: f.idArchivo,
            orden: f.orden,
            creadoPorId: sesion.id,
          })),
        },
        ...auditoria,
      },
    });
  }

  return { telas: telas.length, avios: avios.length, medidas, artes: artes.length };
}

/**
 * Segunda clave del advisory lock a partir de la RAÍZ (que es texto y el lock quiere `int4`).
 * Hash FNV-1a de 32 bits, determinista y estable entre procesos: dos transacciones que versionan
 * la misma familia obtienen la MISMA clave, que es lo único que el lock necesita. Una colisión
 * entre familias distintas sólo las serializa de más (nunca da un resultado incorrecto).
 */
function claveLockDeRaiz(raiz: string): number {
  let h = 0x811c9dc5;
  const texto = raiz.toUpperCase();
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

/**
 * Crea la VERSIÓN de un modelo (servicio de entrada del endpoint). Todo en UNA transacción (A2) y
 * bajo `modelos.aprobar-receta` — el permiso que Daniel repartió hasta Gerencial, SEPARADO de
 * `listas.aprobar` (precios, sólo del dueño). Ver el porqué en `contrato/permisos.ts`.
 *
 * Devuelve el modelo NUEVO con sus relaciones, listo para que la pantalla navegue a él.
 */
export async function crearVersionDeModelo(
  sesion: SesionUsuario,
  idModeloPadre: number,
  datos: DatosVersionModelo = {},
  bd?: ContextoBd,
): Promise<ModeloConRelaciones> {
  verificarPermiso(sesion, 'modelos.aprobar-receta');
  return enTransaccion(async (tx) => {
    const idHija = await mintearVersionDeModelo(tx, sesion, idModeloPadre, datos);
    return tx.modelo.findUniqueOrThrow({
      where: { id: idHija },
      include: incluirRelacionesModelo,
    });
  }, bd);
}
