/**
 * NOMENCLATURA DE MODELOS — desarrollo vs. producción (§Post-F9.34 + §Post-F9.46, V1-E3n).
 *
 * El catálogo tiene DOS numeraciones y este archivo es el único que las sabe armar:
 *
 *  • **PRODUCCIÓN** — cinco dígitos con significado (documento «Estructura de modelos FR Moda»,
 *    2014): `7` concepto/tipo de prenda + `1` género + `001` consecutivo. Los DOS primeros son
 *    FIJOS y el consecutivo corre por esa pareja, con tope de **999 por par** (Daniel,
 *    20-ago-2026: *"el concepto y género van FIJOS y los consecutivos disponibles son los otros 3"*).
 *  • **DESARROLLO** — `CYA-26-71-001` = abreviatura del cliente + año de ENTREGA + los mismos dos
 *    dígitos + consecutivo. Lo arma el sistema ENTERO: es mecánico.
 *
 *    ⚠️ **El consecutivo de desarrollo corre por CLIENTE + AÑO, y nada más.** El primer jogger de
 *    DAMA de ese mismo cliente y año es `CYA-26-72-002`, no el `001`: el `71-001` ya se llevó el 1
 *    (Daniel, 25-ago-2026: *"Me gusta solo por cliente por año. O sea 71-001 y el siguiente
 *    72-002"*). Los dos dígitos siguen DESCRIBIENDO la prenda, pero ya no gobiernan la serie.
 *
 *    🔴 **Esto SUSTITUYE a §Post-F9.34 y §Post-F9.46**, que colgaban el contador del prefijo
 *    COMPLETO (`cliente + año + concepto + género`) y hacían arrancar cada par en `001`. Es un
 *    **cambio de criterio del dueño** (V1-E7a; `Documentacion_MJD/DECISIONES.md` §Post-F9.108,
 *    bloque «✅ RESUELTO»), no la corrección de un error: aquellas entradas se escribieron con el
 *    documento «Estructura de modelos FR Moda» (2014) enfrente y siguen siendo legibles — quien las
 *    lea y "arregle" esto de vuelta al par estaría rompiendo lo decidido. Y es **PROSPECTIVO**: los
 *    códigos ya minteados con el criterio viejo se quedan como están (renumerarlos rompería lo que
 *    ya anda en correos, cotizaciones y listas de precios del cliente), así que los dos criterios
 *    conviven en el catálogo y eso es correcto.
 *
 *    ⭐ **Y arranca DESPUÉS del último consecutivo que ese cliente+año ya tenga** (V1-E7h). Sin eso
 *    la regla anterior se cumplía en el papel y NO en la pantalla: la secuencia nacía en 1, el
 *    código lleva el par y sólo chocaba dentro del MISMO par, así que un cliente que ya llegaba al
 *    `007` recibía `71-001`, `71-002` y `72-008` — exactamente lo que Daniel reportó el 25-ago-2026
 *    y exactamente lo que el criterio VIEJO producía. Lo esperado es `008, 009, 010`, de corrido y
 *    sin importar la prenda. El arranque lo pone {@link pisoConsecutivoDesarrollo}.
 *
 * ⚠️ **Por qué el consecutivo de producción NO sale de una secuencia y el de desarrollo SÍ.**
 * A3 exige folios por secuencia atómica, jamás `Max()+1`, y el de DESARROLLO lo cumple al pie de
 * la letra ({@link siguienteFolioGlobal}). El PISO de V1-E7h no lo rompe: no decide el número en
 * JS, sólo entra como parámetro de la MISMA sentencia atómica, que se queda con el mayor de los dos
 * y suma 1 — dos altas simultáneas siguen esperándose en el candado de la fila y sacan números
 * distintos. Lo que sería `Max()+1` es leer el máximo y escribirlo con un `UPDATE`; eso no se hace.
 * La de PRODUCCIÓN no puede: son 30 años de numeración hecha a mano, **hueca y ya topada** — al
 * medir los 4,987 modelos del Access, el par `51` tiene 535 números usados de 999 **y el 999 ya
 * está ocupado**; lo mismo `20`, `30`, `39`, `73`, `74`. Una secuencia (que sólo sabe avanzar)
 * propondría `1000`, que no existe como modelo. La única propuesta útil es **el hueco libre más
 * bajo del par**, y para que dos promociones simultáneas no lo tomen a la vez se toma un
 * `pg_advisory_xact_lock` del par ANTES de calcularlo: dentro del lock el cálculo y el INSERT son
 * un solo hecho serializado, y el `@unique` de `codigo`/`numeroProduccion` queda de última red.
 * Eso da la misma garantía que la secuencia (nunca dos modelos con el mismo número) sobre una
 * serie que una secuencia no puede modelar — medido: 20 promociones concurrentes del mismo par dan
 * 20 números distintos con el lock, y 2 éxitos + 18 conflictos sin él (las pruebas viven en
 * `nomenclatura.int.test.ts`). **La decisión, su alcance exacto (dónde SÍ y dónde NO se sale uno de
 * A3) y esas mediciones están en `docs/arquitectura/ADR-0018`.**
 */
import { z } from 'zod';

import { datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { siguienteFolioGlobal } from '../../comun/secuencias.js';
import { enTransaccion, type ContextoBd, type Tx } from '../../comun/transaccion.js';

import { exigirRevisionAprobadaParaProducir } from './revision-modelo.js';

/** Tope del consecutivo de un par concepto+género (Daniel: los otros 3 dígitos). */
export const CONSECUTIVO_MAX = 999;

/**
 * A partir de cuántos números libres se avisa que el par se acerca al tope. No es adorno: el par
 * `51` ya llegó a 999 en el Access y la salida de Daniel fue duplicar el dígito de género
 * (Caballero 1→5) — cualquier otro par que se llene ya no tendrá ese escape (§Post-F9.34).
 */
export const LIBRES_PARA_AVISAR = 50;

/**
 * Namespace del `pg_advisory_xact_lock` que serializa la asignación del consecutivo de PRODUCCIÓN
 * de UN par concepto+género. Segunda clave = el par como entero (`71`). Inventario de la familia
 * 20_5xx en el comentario de `NAMESPACE_LOCK_FOTOS` (`fotos-modelo.ts`); éste estrena el 20_546.
 */
const NAMESPACE_LOCK_NUMERO_PRODUCCION = 20_546;

/** Un código de producción es SIEMPRE numérico de 5 dígitos (concepto ≥ 2 → nunca empieza en 0). */
const PATRON_CODIGO_PRODUCCION = /^\d{5}$/;

/**
 * Deriva el nº de producción (entero de 5 dígitos) de un código de modelo, o `null` si el código
 * no tiene esa forma. Es la MISMA regla que usó el backfill de la migración: 4,702 de los 4,987
 * modelos del Access la cumplen; los otros 285 (`51783a`, `71240-1`, `M-18`) se quedan sin número
 * y por eso no ocupan consecutivo.
 */
export function numeroProduccionDeCodigo(codigo: string): number | null {
  return PATRON_CODIGO_PRODUCCION.test(codigo) ? Number(codigo) : null;
}

/** Formatea un nº de producción como su código de 5 dígitos. */
export function codigoDeNumeroProduccion(numero: number): string {
  return String(numero).padStart(5, '0');
}

/** Esquema del nº de producción capturado a mano: entero de 5 dígitos (§Post-F9.46: editable). */
export const esquemaNumeroProduccion = z
  .number({ error: 'El número de producción debe ser un número' })
  .int({ error: 'El número de producción debe ser entero' })
  .min(10_000, { error: 'El número de producción debe tener 5 dígitos' })
  .max(99_999, { error: 'El número de producción debe tener 5 dígitos' });

// ── Dígitos del modelo ─────────────────────────────────────────────────────────────

/** Los dos dígitos de la nomenclatura de un modelo + de dónde salieron. */
export interface DigitosModelo {
  /** 1er dígito: concepto/tipo de prenda (`TipoProducto.digitoConcepto`). */
  concepto: number;
  /** 2º dígito: género (`Genero.digitoNomenclatura`). */
  genero: number;
  /** Dígito de continuación del género cuando su serie se agota (Caballero 1→5), o `null`. */
  generoAlterno: number | null;
  /** `catalogo` = de tipo de producto + género; `codigo-desarrollo` = leídos del `CYA-26-71-001`. */
  fuente: 'catalogo' | 'codigo-desarrollo';
}

/** El par concepto+género como entero de dos cifras (`7`,`1` → `71`). */
export function parDe(concepto: number, genero: number): number {
  return concepto * 10 + genero;
}

/** El par como texto de dos cifras, tal como sale en el código (`"71"`, `"09"`). */
export function parTexto(concepto: number, genero: number): string {
  return `${String(concepto)}${String(genero)}`;
}

/** Forma mínima del modelo que necesitan el generador y la promoción. */
export interface ModeloParaNomenclatura {
  id: number;
  codigo: string;
  codigoDesarrollo: string | null;
  idTipoProducto: number | null;
  idGenero: number | null;
}

/** Extrae los dos dígitos de un código de desarrollo `CYA-26-71-001`, o `null` si no los trae. */
export function digitosDeCodigoDesarrollo(
  codigoDesarrollo: string,
): { concepto: number; genero: number } | null {
  const m = /^[A-Z0-9]{2,6}-\d{2}-(\d)(\d)-\d{3,}$/.exec(codigoDesarrollo);
  if (m === null) {
    return null;
  }
  return { concepto: Number(m[1]), genero: Number(m[2]) };
}

/**
 * Resuelve los dos dígitos con los que se numera un modelo. Manda el CATÁLOGO (tipo de producto +
 * género del modelo, que es lo que Daniel edita); si al modelo le falta alguno, cae al código de
 * desarrollo, donde los dígitos ya quedaron decididos (§Post-F9.34 punto 4). Si no hay ninguno de
 * los dos caminos lanza `ErrorValidacion` diciendo QUÉ capturar — nunca inventa un dígito.
 */
export async function digitosDelModelo(
  tx: Tx,
  modelo: ModeloParaNomenclatura,
): Promise<DigitosModelo> {
  const [tipo, genero] = await Promise.all([
    modelo.idTipoProducto === null
      ? Promise.resolve(null)
      : tx.tipoProducto.findUnique({
          where: { id: modelo.idTipoProducto },
          select: { nombre: true, digitoConcepto: true },
        }),
    modelo.idGenero === null
      ? Promise.resolve(null)
      : tx.genero.findUnique({
          where: { id: modelo.idGenero },
          select: { nombre: true, digitoNomenclatura: true, digitoAlterno: true },
        }),
  ]);

  if (tipo?.digitoConcepto != null && genero?.digitoNomenclatura != null) {
    return {
      concepto: tipo.digitoConcepto,
      genero: genero.digitoNomenclatura,
      generoAlterno: genero.digitoAlterno,
      fuente: 'catalogo',
    };
  }

  const delCodigo =
    modelo.codigoDesarrollo === null ? null : digitosDeCodigoDesarrollo(modelo.codigoDesarrollo);
  if (delCodigo !== null) {
    return { ...delCodigo, generoAlterno: null, fuente: 'codigo-desarrollo' };
  }

  const faltan: string[] = [];
  if (modelo.idTipoProducto === null) {
    faltan.push('el tipo de producto del modelo');
  } else if (tipo?.digitoConcepto == null) {
    faltan.push(`el dígito de concepto del tipo de producto "${tipo?.nombre ?? ''}"`);
  }
  if (modelo.idGenero === null) {
    faltan.push('el género del modelo');
  } else if (genero?.digitoNomenclatura == null) {
    faltan.push(`el dígito de nomenclatura del género "${genero?.nombre ?? ''}"`);
  }
  throw new ErrorValidacion(
    `No se puede numerar el modelo "${modelo.codigo}": falta capturar ${faltan.join(' y ')}.`,
  );
}

// ── Ocupación y propuesta del consecutivo de PRODUCCIÓN ────────────────────────────

/** Consecutivos YA usados de un par (leídos de las DOS columnas que pueden llevarlos). */
async function consecutivosUsados(tx: Tx, concepto: number, genero: number): Promise<Set<number>> {
  const par = parDe(concepto, genero);
  const desde = par * 1000 + 1;
  const hasta = par * 1000 + CONSECUTIVO_MAX;

  // Dos fuentes a propósito: `numero_produccion` (la que llena la promoción y el backfill) y el
  // `codigo` textual (un modelo cuyo código se editó a mano a 5 dígitos también OCUPA el número,
  // aunque su columna numérica no se haya poblado). Se leen como TEXTO y se parsean aquí: castear
  // `codigo::int` dentro del SQL depende de que Postgres evalúe el filtro ANTES del cast, y no lo
  // garantiza.
  const [porNumero, porCodigo] = await Promise.all([
    tx.$queryRaw<{ n: number }[]>`
      SELECT "numero_produccion" AS n FROM "modelos"
      WHERE "numero_produccion" BETWEEN ${desde} AND ${hasta}
    `,
    tx.$queryRaw<{ codigo: string }[]>`
      SELECT "codigo" FROM "modelos" WHERE "codigo" ~ ${`^${parTexto(concepto, genero)}\\d{3}$`}
    `,
  ]);

  const usados = new Set<number>();
  for (const fila of porNumero) {
    usados.add(Number(fila.n) - par * 1000);
  }
  for (const fila of porCodigo) {
    usados.add(Number(fila.codigo.slice(2)));
  }
  usados.delete(0); // `71000` no es un consecutivo válido (arrancan en 001)
  return usados;
}

/** Estado de UNA serie (un par concepto+género). */
export interface SerieProduccion {
  /** El par como texto (`"71"`). */
  par: string;
  concepto: number;
  genero: number;
  /** Consecutivo libre más bajo (1–999), o `null` si la serie está llena. */
  libre: number | null;
  usados: number;
  libres: number;
}

/** Lee el estado de UNA serie: cuántos números tiene usados y cuál es el hueco más bajo. */
export async function leerSerie(
  tx: Tx,
  concepto: number,
  genero: number,
): Promise<SerieProduccion> {
  const usados = await consecutivosUsados(tx, concepto, genero);
  let libre: number | null = null;
  for (let n = 1; n <= CONSECUTIVO_MAX; n += 1) {
    if (!usados.has(n)) {
      libre = n;
      break;
    }
  }
  return {
    par: parTexto(concepto, genero),
    concepto,
    genero,
    libre,
    usados: usados.size,
    libres: CONSECUTIVO_MAX - usados.size,
  };
}

/** Propuesta de nº de producción para un modelo, con sus avisos (§Post-F9.46: avisa, no bloquea). */
export interface PropuestaNumeroProduccion {
  /** Nº de 5 dígitos propuesto, o `null` si no queda ninguno libre en la(s) serie(s) del modelo. */
  numero: number | null;
  /** El código correspondiente (`"71001"`), o `null`. */
  codigo: string | null;
  /** Serie de la que salió la propuesta (la base, o la de continuación si la base estaba llena). */
  serie: SerieProduccion;
  /** `true` si hubo que pasarse a la serie de continuación del género (Caballero 1→5). */
  serieContinuada: boolean;
  /** Avisos para enseñar junto al campo. NUNCA bloquean. */
  avisos: string[];
}

/**
 * Propone el siguiente nº de producción de un par: el hueco LIBRE MÁS BAJO (ver el encabezado del
 * módulo). Si la serie está llena y el género tiene continuación (Caballero `x1` → `x5`, la única
 * que existe, §Post-F9.46: en el CONCEPTO no se encadena nada), sigue en ella. Devuelve avisos
 * cuando la serie se acerca al tope o cuando ya no queda ninguna.
 *
 * ⚠️ Debe llamarse DENTRO de la transacción que va a guardar el número, y después de tomar el
 * lock del par ({@link promoverAProduccion} lo hace): fuera de eso la propuesta es informativa.
 */
export async function proponerNumeroProduccion(
  tx: Tx,
  digitos: DigitosModelo,
): Promise<PropuestaNumeroProduccion> {
  const avisos: string[] = [];
  const base = await leerSerie(tx, digitos.concepto, digitos.genero);

  let serie = base;
  let continuada = false;
  if (base.libre === null && digitos.generoAlterno !== null) {
    serie = await leerSerie(tx, digitos.concepto, digitos.generoAlterno);
    continuada = true;
    avisos.push(
      `La serie ${base.par} se agotó (999 de 999 usados); se continúa en la serie ${serie.par}, ` +
        `la ampliación de capacidad del mismo género.`,
    );
  }

  if (serie.libre === null) {
    avisos.push(
      `La serie ${serie.par} está LLENA (999 de 999 usados) y no tiene otra serie a la que ` +
        `continuar: el número hay que decidirlo a mano.`,
    );
  } else if (serie.libres <= LIBRES_PARA_AVISAR) {
    avisos.push(
      `A la serie ${serie.par} le quedan ${String(serie.libres)} números de ${String(
        CONSECUTIVO_MAX,
      )}.`,
    );
  }

  const numero =
    serie.libre === null ? null : parDe(serie.concepto, serie.genero) * 1000 + serie.libre;
  return {
    numero,
    codigo: numero === null ? null : codigoDeNumeroProduccion(numero),
    serie,
    serieContinuada: continuada,
    avisos,
  };
}

/**
 * Avisos de CONGRUENCIA de un número capturado a mano contra los dígitos del modelo (§Post-F9.34
 * punto 7, vigente tras §Post-F9.46): **avisa, no bloquea** — *"si Daniel quiere una excepción, la
 * excepción es suya"*.
 */
export function avisosDeCongruencia(numero: number, digitos: DigitosModelo): string[] {
  const parNumero = Math.floor(numero / 1000);
  const parEsperado = parDe(digitos.concepto, digitos.genero);
  const parAlterno =
    digitos.generoAlterno === null ? null : parDe(digitos.concepto, digitos.generoAlterno);
  if (parNumero === parEsperado || parNumero === parAlterno) {
    return [];
  }
  return [
    `Los dos primeros dígitos del número (${String(parNumero)}) no corresponden al tipo de prenda ` +
      `y al género del modelo (${String(parEsperado)}). Se guarda igual: la excepción es tuya.`,
  ];
}

// ── Código de DESARROLLO ───────────────────────────────────────────────────────────

/** Año de ENTREGA del modelo (el que se congela en el código, no el de creación). */
export const esquemaAnioEntrega = z
  .number({ error: 'El año de entrega debe ser un número' })
  .int({ error: 'El año de entrega debe ser entero' })
  .min(2020, { error: 'El año de entrega no puede ser anterior a 2020' })
  .max(2100, { error: 'El año de entrega no puede ser posterior a 2100' });

/**
 * Lo que TODO código de desarrollo de un cliente+año comparte: `CYA-26-` (abreviatura + año a dos
 * dígitos + guion). Es a la vez lo que arma el código y lo que lo RECONOCE al buscar el piso del
 * consecutivo, y por eso vive en una sola función: si el armado y el reconocimiento se escribieran
 * por separado, bastaría tocar uno para que el piso dejara de ver los códigos que él mismo arma.
 */
export function prefijoCodigoDesarrollo(abreviatura: string, anioEntrega: number): string {
  return `${abreviatura}-${String(anioEntrega % 100).padStart(2, '0')}-`;
}

/** Arma el código de desarrollo `CYA-26-71-001` (sin tocar la base). */
export function armarCodigoDesarrollo(
  abreviatura: string,
  anioEntrega: number,
  concepto: number,
  genero: number,
  consecutivo: number,
): string {
  return `${prefijoCodigoDesarrollo(abreviatura, anioEntrega)}${parTexto(concepto, genero)}-${String(
    consecutivo,
  ).padStart(3, '0')}`;
}

/**
 * Forma del consecutivo al LEER un código: se escribe con 3 dígitos y DEGRADA a 4 pasando de 999
 * (`armarCodigoDesarrollo` sólo rellena, no recorta), así que el ancho no es fijo. El tope de 9
 * dígitos no es capricho: más allá ya no es un consecutivo sino un número tecleado que se salió de
 * la forma, y admitirlo dispararía el piso de TODA la serie por un dedazo
 * (`CYA-26-71-99999999999` dejaría al cliente sin poder dar de alta nada). Se IGNORA, como
 * cualquier otro código no canónico.
 */
const PATRON_CONSECUTIVO_LEIDO = /^\d{3,9}$/;

/**
 * Extrae el CONSECUTIVO de un código de desarrollo de ese `prefijo`, o `null` si el código no tiene
 * la forma canónica. Es la lectura inversa de {@link armarCodigoDesarrollo}.
 *
 * ⚠️ **Se lee el NÚMERO, no el texto** (V1-E7h). Un "los últimos dígitos" a ciegas se equivocaría en
 * los dos casos que de verdad existen en el catálogo:
 *
 *  • la VERSIÓN de un modelo (`CYA-26-71-045-02`, V1-E7b) daría **2**, cuando la versión NO quema
 *    consecutivo y lo que cuenta es el de su raíz (`45`);
 *  • el consecutivo DEGRADA a 4 dígitos pasando de 999 (`…-71-1000`), así que no se puede leer un
 *    ancho fijo de 3.
 *
 * Y lo que NO cumple la forma —códigos capturados a mano, migrados del Access, cualquier cosa— se
 * ignora devolviendo `null`: **jamás revienta**. Un piso "de menos" sólo hace trabajar al centinela
 * del bucle; una excepción aquí tumbaría el alta entera.
 *
 * La comparación del prefijo es case-INSENSITIVE a propósito, igual que el resto del módulo: en la
 * base conviven `CYA-…` y `cya-…` y los dos ocupan el mismo número.
 */
export function consecutivoDeCodigoDesarrollo(codigo: string, prefijo: string): number | null {
  if (!codigo.toUpperCase().startsWith(prefijo.toUpperCase())) {
    return null;
  }
  // Lo que sobra tras el prefijo: `71-001`, `71-001-02` o basura. Como el prefijo se comparó
  // insensible a la caja pero con la MISMA longitud, cortar por longitud es exacto.
  const partes = codigo.slice(prefijo.length).split('-');
  if (partes.length < 2 || partes.length > 3) {
    return null;
  }
  const [par, consecutivo, version] = partes;
  if (par === undefined || !/^\d{2}$/.test(par)) {
    return null;
  }
  if (consecutivo === undefined || !PATRON_CONSECUTIVO_LEIDO.test(consecutivo)) {
    return null;
  }
  // El sufijo de versión, si viene, tiene que ser numérico: `CYA-26-71-001-BIS` no es canónico.
  if (version !== undefined && !/^\d+$/.test(version)) {
    return null;
  }
  return Number(consecutivo);
}

/**
 * El PISO del consecutivo de un cliente+año: el MAYOR consecutivo que ya existe en el catálogo con
 * ese prefijo, o `0` si no hay ninguno.
 *
 * ⚠️ **Por qué existe (V1-E7h — defecto reportado por Daniel el 25-ago-2026).** El contador corre
 * por cliente+año (V1-E7a), pero la secuencia de ese cliente+año NACÍA EN 1 aunque el catálogo ya
 * tuviera modelos del criterio anterior. El bucle de reintentos tapaba la colisión sólo cuando el
 * código armado ya existía —o sea, sólo dentro del MISMO par—, y el resultado se veía idéntico al
 * criterio viejo: Daniel metió dos sudaderas y un jogger a un cliente que ya llegaba al 007 y
 * obtuvo **001, 002 y 008** en vez de **008, 009 y 010**. El piso arregla la causa: la serie no
 * arranca donde está el contador, arranca donde de verdad va el catálogo.
 *
 * Se mira en las DOS columnas que pueden llevar un código de desarrollo: `codigoDesarrollo` (lo
 * normal, y lo ÚNICO que le queda a un modelo ya promovido, D3) y `codigo` (un código de desarrollo
 * capturado a mano, que nunca pasó por aquí). El filtro de la base es un `startsWith` insensible
 * —barato de escribir pero NO exacto: si la abreviatura trajera comodines de `LIKE` podría traer de
 * más— y por eso cada fila se vuelve a validar en {@link consecutivoDeCodigoDesarrollo}, que es la
 * autoridad. La base FILTRA; quien DECIDE es el parseo.
 *
 * Es un recorrido de unos pocos miles de modelos por alta de desarrollo (una acción humana, no un
 * bucle): irrelevante al lado de dejar la numeración mal.
 */
async function pisoConsecutivoDesarrollo(tx: Tx, prefijo: string): Promise<number> {
  const filas = await tx.modelo.findMany({
    where: {
      OR: [
        { codigo: { startsWith: prefijo, mode: 'insensitive' } },
        { codigoDesarrollo: { startsWith: prefijo, mode: 'insensitive' } },
      ],
    },
    select: { codigo: true, codigoDesarrollo: true },
  });

  let piso = 0;
  for (const fila of filas) {
    for (const texto of [fila.codigo, fila.codigoDesarrollo]) {
      if (texto === null) {
        continue;
      }
      const consecutivo = consecutivoDeCodigoDesarrollo(texto, prefijo);
      if (consecutivo !== null && consecutivo > piso) {
        piso = consecutivo;
      }
    }
  }
  return piso;
}

/**
 * Cuántos intentos se hacen si el código armado ya existe. Desde V1-E7h la serie arranca sobre el
 * piso del catálogo, así que el único motivo que queda es un código que el piso no puede ver: uno
 * capturado a mano fuera de la forma canónica, o un alta simultánea todavía sin comitear.
 *
 * ⚠️ **Por qué 1000 y no 50** (V1-E7a, hallazgo del reviewer; sigue vigente). El bucle avanza de UNO
 * EN UNO y el código lleva el par, así que sólo choca contra los del MISMO par: un cliente+año con
 * `71-001..010` y `91-001..070` deja la secuencia en 11 y el alta del par 91 quema 50 intentos sin
 * llegar al 71.
 * Y agotarlos **no es un error recuperable**: el minteo corre DENTRO de la transacción del llamador
 * (`desarrollo/desarrollos.ts`), así que al lanzar **la secuencia se revierte con ella** — el
 * siguiente intento arranca del mismo número y falla igual, dejando a ese cliente+año sin poder dar
 * de alta desarrollos hasta que alguien adelante el contador con SQL a mano (no hay
 * `sembrarSecuenciaGlobal` ni pantalla; `reparar-secuencias.ts` no toca `secuencias_globales`).
 *
 * 1000 es el **techo natural del diseño**: el consecutivo son 3 dígitos, así que un cliente+año no
 * puede tener más de 999 códigos de desarrollo vivos y la pared queda **inalcanzable por
 * construcción**, no por suerte. Bajarlo vuelve a poner la trampa. Y como cada intento es un
 * `findFirst` por índice único, el peor caso sigue siendo barato — y sólo lo paga el alta que de
 * verdad está chocando.
 */
export const MAX_INTENTOS_CODIGO_DESARROLLO = 1000;

/**
 * MINTEA el código de desarrollo de un modelo nuevo, en la transacción del llamador. El
 * consecutivo sale de una secuencia GLOBAL atómica (A3) —nunca `Max()+1`— cuya clave es
 * **`cliente + año`**, tal como Daniel lo cerró el 25-ago-2026: *"Me gusta solo por cliente por
 * año. O sea 71-001 y el siguiente 72-002"*. El par concepto+género VA en el código pero **NO** en
 * la clave (encabezado del módulo: sustituye a §Post-F9.34 / §Post-F9.46).
 *
 * La clave lleva el **id** del cliente, no su abreviatura: si mañana Daniel corrige el `CYA`, el
 * contador no se reinicia ni se mezcla con el de otro cliente.
 *
 * ⭐ **La serie arranca DESPUÉS de lo que ya existe** ({@link pisoConsecutivoDesarrollo}, V1-E7h).
 * Ésa es la corrección del defecto que reportó Daniel: no basta con que el contador sea por
 * cliente+año si para un cliente que ya tenía modelos ese contador nace en 1.
 *
 * ⚠️ **Y el bucle de reintentos SE QUEDA, aunque ya casi nunca actúe.** Con el piso puesto, el
 * código armado sólo puede chocar con algo que el piso NO alcanzó a ver: un código capturado a mano
 * que no cumple la forma canónica, o un alta simultánea aún sin comitear. Es la última red antes del
 * `@unique`: si el código estuviera ocupado y se entregara igual, reventaría al insertar y
 * **abortaría la transacción entera del alta**. Por eso se comprueba que esté LIBRE en las DOS
 * columnas que pueden llevarlo y, si no, se pide otro número. La comprobación es case-INSENSITIVE a
 * propósito, igual que el control de duplicados de `crearModelo` (que es quien recibe este código).
 */
export async function mintearCodigoDesarrollo(
  tx: Tx,
  entrada: { idCliente: number; anioEntrega: number; concepto: number; genero: number },
): Promise<{ codigo: string; consecutivo: number }> {
  const cliente = await tx.cliente.findUnique({
    where: { id: entrada.idCliente },
    select: { nombre: true, abreviatura: true },
  });
  if (cliente === null) {
    throw new ErrorNoEncontrado('Cliente', entrada.idCliente);
  }
  if (cliente.abreviatura === null || cliente.abreviatura === '') {
    throw new ErrorValidacion(
      `El cliente "${cliente.nombre}" no tiene ABREVIATURA capturada, y sin ella no se puede ` +
        `armar el código de desarrollo (es el "CYA" de CYA-26-71-001). Captúrala en su ficha.`,
    );
  }

  // Cliente + año, y NADA más: el par concepto+género queda FUERA de la clave (§Post-F9.108
  // «✅ RESUELTO»; sustituye a §Post-F9.34/.46). Volverlo a meter aquí revive el criterio viejo.
  const clave = `modelo-desarrollo-${String(entrada.idCliente)}-${String(entrada.anioEntrega)}`;

  // ⭐ DÓNDE ARRANCA la serie (V1-E7h): en el máximo que YA existe en el catálogo para este
  // cliente+año, no en 1. Se recalcula en CADA alta a propósito, y no se "siembra una sola vez":
  // los clientes que ya venían del criterio anterior tienen la secuencia a media asta (la de Daniel
  // iba en 3 con el catálogo en 7) y una siembra sólo-al-nacer nunca los alcanzaría — harían falta
  // scripts a mano, cliente por cliente. Con el piso en cada alta la regla es una sola y se cumple
  // sola: **la secuencia nunca retrocede, pero sí adelanta**.
  const prefijo = prefijoCodigoDesarrollo(cliente.abreviatura, entrada.anioEntrega);
  const piso = await pisoConsecutivoDesarrollo(tx, prefijo);

  for (let intento = 0; intento < MAX_INTENTOS_CODIGO_DESARROLLO; intento += 1) {
    // El piso viaja DENTRO de la sentencia atómica de la secuencia (A3): no se lee-decide-escribe
    // aquí. Va también en los reintentos y es inofensivo: tras la primera vuelta la secuencia ya
    // rebasó el piso y `GREATEST` se queda con ella.
    const consecutivo = Number(await siguienteFolioGlobal(tx, clave, piso));
    const codigo = armarCodigoDesarrollo(
      cliente.abreviatura,
      entrada.anioEntrega,
      entrada.concepto,
      entrada.genero,
      consecutivo,
    );
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
      return { codigo, consecutivo };
    }
  }
  // Si se llega aquí, el contador de ese cliente+año se REVIERTE con la transacción (ver el JSDoc
  // del tope): reintentar da exactamente el mismo error. Por eso el mensaje no puede limitarse a
  // describir el problema — tiene que decir cómo seguir HOY y que esto no se arregla solo.
  throw new ErrorConflicto(
    `No se pudo asignar un código de desarrollo libre para ${cliente.abreviatura} en ` +
      `${String(entrada.anioEntrega)}: los ${String(MAX_INTENTOS_CODIGO_DESARROLLO)} consecutivos ` +
      `que siguen en su serie ya están ocupados (por códigos capturados a mano, o heredados del ` +
      `criterio anterior del contador). Da de alta el modelo capturando su código a mano y AVISA ` +
      `a soporte: volver a intentarlo va a fallar igual, porque el contador de este cliente y año ` +
      `no avanza mientras el alta no se complete.`,
  );
}

// ── Pasar a producción ─────────────────────────────────────────────────────────────

/** Resultado de promover un modelo: el número que quedó, el código anterior y los avisos. */
export interface ResultadoPromocion {
  idModelo: number;
  /** Nº de producción asignado. */
  numeroProduccion: number;
  /** Código VIGENTE tras la promoción (= el número). */
  codigo: string;
  /** Código de desarrollo, que se CONSERVA (D3). */
  codigoDesarrollo: string | null;
  /** `true` si el número lo capturó el usuario en vez de aceptar la propuesta. */
  numeroCapturado: boolean;
  avisos: string[];
}

/**
 * Toma el lock del par y calcula/valida el número. Núcleo compartido por el endpoint «pasar a
 * producción» y por la salida a producción (generar OP), para que los dos apliquen las MISMAS
 * reglas dentro de la MISMA transacción (A2).
 */
export async function promoverAProduccionNucleo(
  tx: Tx,
  sesion: SesionUsuario,
  idModelo: number,
  numeroCapturado?: number,
): Promise<ResultadoPromocion> {
  const modelo = await tx.modelo.findUnique({
    where: { id: idModelo },
    select: {
      id: true,
      codigo: true,
      codigoDesarrollo: true,
      origen: true,
      numeroProduccion: true,
      idTipoProducto: true,
      idGenero: true,
      // ⭐ V1-E7d — lo que mira LA COMPUERTA de la revisión (ver abajo).
      idModeloPadre: true,
      versionDesarrollo: true,
      revisionEstado: true,
      revisadoEn: true,
      revisionNota: true,
    },
  });
  if (modelo === null) {
    throw new ErrorNoEncontrado('Modelo', idModelo);
  }
  if (modelo.origen === 'produccion') {
    throw new ErrorConflicto(
      `El modelo "${modelo.codigo}" ya está en el catálogo de producción` +
        (modelo.numeroProduccion === null
          ? '.'
          : ` con el número ${codigoDeNumeroProduccion(modelo.numeroProduccion)}.`),
    );
  }

  // ⭐ V1-E7d (§Post-F9.110) — LA REVISIÓN ANTES DE MANDAR A PRODUCIR.
  //
  // ⚠️ **Va AQUÍ, en el núcleo, y no en el endpoint «pasar a producción».** Este núcleo tiene DOS
  // llamadores: ese endpoint y `produccion/salida-produccion.ts` paso 4 — es decir, **generar una
  // OP promueve el modelo sola**. Con la compuerta en el endpoint, una versión sin revisar llegaría
  // a producción por la PUERTA LATERAL de generar su OP, que es exactamente lo que la decisión de
  // Daniel viene a impedir: *"enfrente del cliente puede ser que se cometa una imprudencia o un
  // error"*. Esconder un botón es cortesía; negar la operación es la regla.
  //
  // Y alcanza SÓLO a las versiones: un modelo que no nació de una negociación pasa igual que
  // siempre (el porqué, en `revision-modelo.ts`). Va antes del lock a propósito — no se serializa
  // el par de una promoción que va a rebotar.
  exigirRevisionAprobadaParaProducir(modelo);

  const digitos = await digitosDelModelo(tx, modelo);

  // El lock se toma ANTES de mirar la ocupación: dentro de él, "elegir el hueco" y "escribirlo"
  // son un solo hecho (ver el encabezado del módulo). El par que se bloquea es el del CATÁLOGO;
  // si el usuario captura un número de otro par, el `@unique` sigue siendo la red de seguridad.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NAMESPACE_LOCK_NUMERO_PRODUCCION}::int, ${parDe(
    digitos.concepto,
    digitos.genero,
  )}::int)`;

  const propuesta = await proponerNumeroProduccion(tx, digitos);
  const avisos = [...propuesta.avisos];

  let numero: number;
  if (numeroCapturado === undefined) {
    if (propuesta.numero === null) {
      throw new ErrorValidacion(
        `No queda ningún número libre en la serie ${propuesta.serie.par}: captura el número de ` +
          `producción a mano.`,
      );
    }
    numero = propuesta.numero;
  } else {
    numero = numeroCapturado;
    avisos.push(...avisosDeCongruencia(numero, digitos));
  }

  const codigo = codigoDeNumeroProduccion(numero);

  // Repetido = BLOQUEA (es lo único que §Post-F9.34 pide impedir; el resto sólo avisa).
  const chocan = await tx.modelo.findFirst({
    where: {
      id: { not: idModelo },
      OR: [
        { codigo: { equals: codigo, mode: 'insensitive' } },
        { numeroProduccion: numero },
        { codigoDesarrollo: { equals: codigo, mode: 'insensitive' } },
      ],
    },
    select: { codigo: true, activo: true },
  });
  if (chocan !== null) {
    throw new ErrorConflicto(
      `El número de producción ${codigo} ya está ocupado por el modelo "${chocan.codigo}"` +
        (chocan.activo ? '.' : ' (descontinuado).'),
    );
  }

  await tx.modelo.update({
    where: { id: idModelo },
    data: {
      codigo,
      numeroProduccion: numero,
      origen: 'produccion',
      // `codigoDesarrollo` NO se toca: el número de desarrollo se conserva y sigue siendo
      // buscable (§Post-F9.34 punto 5, D3).
      ...datosModificacion(sesion),
    },
  });

  await registrarBitacora(tx, sesion, {
    entidad: 'Modelo',
    idEntidad: idModelo,
    accion: 'MODIFICAR',
    datos: {
      operacion: 'pasar-a-produccion',
      codigo: { de: modelo.codigo, a: codigo },
      codigoDesarrollo: modelo.codigoDesarrollo,
      numeroProduccion: numero,
      numeroCapturado: numeroCapturado !== undefined,
      propuesto: propuesta.numero,
      avisos,
    },
  });

  return {
    idModelo,
    numeroProduccion: numero,
    codigo,
    codigoDesarrollo: modelo.codigoDesarrollo,
    numeroCapturado: numeroCapturado !== undefined,
    avisos,
  };
}

/**
 * Consulta (sin escribir) qué número propondría el sistema para un modelo — lo que la pantalla usa
 * para llegar con el campo YA LLENO. La propuesta es informativa hasta que se guarda: entre la
 * consulta y el guardado alguien pudo tomar ese número, y ahí `pasarAProduccion` avisa del choque.
 */
export async function consultarPropuestaProduccion(
  sesion: SesionUsuario,
  idModelo: number,
  bd?: ContextoBd,
): Promise<PropuestaNumeroProduccion & { yaEnProduccion: boolean }> {
  verificarPermiso(sesion, 'modelos.ver');
  return enTransaccion(async (tx) => {
    const modelo = await tx.modelo.findUnique({
      where: { id: idModelo },
      select: {
        id: true,
        codigo: true,
        codigoDesarrollo: true,
        origen: true,
        idTipoProducto: true,
        idGenero: true,
      },
    });
    if (modelo === null) {
      throw new ErrorNoEncontrado('Modelo', idModelo);
    }
    const digitos = await digitosDelModelo(tx, modelo);
    const propuesta = await proponerNumeroProduccion(tx, digitos);
    return { ...propuesta, yaEnProduccion: modelo.origen === 'produccion' };
  }, bd);
}
