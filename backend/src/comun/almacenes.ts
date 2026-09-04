/**
 * Validación de ALMACÉN para los flujos que mueven inventario (F3/F4).
 *
 * Los almacenes pueden ser GLOBALES (`idEmpresa = null`) o PRIVADOS de una empresa (`idEmpresa`
 * con valor). Cualquier operación que reciba/saque/traspase material hacia/desde un almacén DEBE
 * validar, dentro de su transacción y ANTES de escribir, que el almacén exista, esté activo y sea
 * usable por la empresa de la sesión (A9): un almacén privado de OTRA empresa, para esta sesión,
 * no existe. Este helper centraliza esa regla (antes duplicada en `produccion/recibos.ts` y
 * `produccion/entregas-cliente.ts`).
 *
 * ⚠️ **Y el TIPO (fila 0.137).** `Almacen.tipo` dice qué inventario guarda cada bodega
 * (`PT` / `TELA` / `AVIO`), pero hasta esta fila NADIE lo verificaba al mover: el desplegable de
 * la pantalla era el único filtro, así que un movimiento de producto terminado entraba sin
 * chistar a la bodega de telas (y una entrada de tela a un almacén de PT). Eso parte el inventario
 * en buckets que nadie va a mirar: la existencia sigue cuadrando en la suma del kardex, pero la
 * mercancía no está donde el sistema dice. A1 manda que esa validación viva en el DOMINIO, no en
 * el desplegable → {@link exigirAlmacenDelTipo}, que es {@link exigirAlmacen} + el tipo.
 *
 * REGLA DE USO: todo escritor que reciba un `idAlmacen` llama a `exigirAlmacenDelTipo` con el tipo
 * del artículo que mueve, DENTRO de su transacción y ANTES de escribir. `exigirAlmacen` (sin tipo)
 * se conserva para los pocos casos donde el tipo lo garantiza otra cosa.
 *
 * NO se llama en las CANCELACIONES ni en el modo MIGRACIÓN:
 *  • La cancelación es un movimiento INVERSO sobre el almacén del movimiento ORIGINAL (D3). Un
 *    inverso SIEMPRE debe poder registrarse — es EL mecanismo de corrección; bloquearlo porque el
 *    almacén cambió de tipo o se desactivó dejaría un error sin forma de deshacerse.
 *  • El ETL (`dominio/**\/migracion.ts`) preserva el histórico tal cual (relaja a propósito las
 *    validaciones de captura, ver su cabecera) y no pasa por estos escritores.
 */
import type { TipoAlmacen } from '../datos/index.js';

import { ErrorNoEncontrado, ErrorValidacion } from './errores.js';
import type { Tx } from './transaccion.js';

/** Lo que el inventario de cada tipo de almacén guarda, en palabras del negocio (para el mensaje). */
const QUE_GUARDA: Record<TipoAlmacen, string> = {
  PT: 'producto terminado',
  TELA: 'telas',
  AVIO: 'avíos',
};

/** Almacén ya verificado como usable por la empresa de la sesión. */
interface AlmacenUsable {
  nombre: string;
  tipo: TipoAlmacen;
}

/**
 * Lee el almacén y verifica que exista, esté ACTIVO y sea GLOBAL o de la empresa dada (A9).
 * Devuelve su nombre y su tipo para que el llamador decida si además exige un tipo concreto.
 */
async function leerAlmacenUsable(
  tx: Tx,
  idAlmacen: number,
  idEmpresa: number,
): Promise<AlmacenUsable> {
  const almacen = await tx.almacen.findUnique({
    where: { id: idAlmacen },
    select: { activo: true, idEmpresa: true, nombre: true, tipo: true },
  });
  if (almacen === null) {
    throw new ErrorNoEncontrado('Almacen', idAlmacen);
  }
  if (!almacen.activo) {
    throw new ErrorValidacion(`El almacén "${almacen.nombre}" está desactivado.`);
  }
  if (almacen.idEmpresa !== null && almacen.idEmpresa !== idEmpresa) {
    throw new ErrorValidacion(`El almacén "${almacen.nombre}" no es de esta empresa.`);
  }
  return { nombre: almacen.nombre, tipo: almacen.tipo };
}

/**
 * Verifica que un almacén exista, esté ACTIVO y sea GLOBAL o de la empresa dada (A9). Lanza
 * `ErrorNoEncontrado` si no existe y `ErrorValidacion` si está desactivado o es de otra empresa.
 * Pensado para llamarse DENTRO de la transacción del flujo, antes de cualquier escritura.
 *
 * ⚠️ NO mira el TIPO del almacén: úsalo solo cuando el tipo lo garantice otra cosa (p. ej. el
 * almacén se resolvió con un `where` que ya lo filtra). Para todo lo demás, {@link exigirAlmacenDelTipo}.
 */
export async function exigirAlmacen(tx: Tx, idAlmacen: number, idEmpresa: number): Promise<void> {
  await leerAlmacenUsable(tx, idAlmacen, idEmpresa);
}

/**
 * Igual que {@link exigirAlmacen} y ADEMÁS exige que el almacén sea del `tipo` que corresponde al
 * artículo que se está moviendo (fila 0.137). Lanza `ErrorValidacion` con el nombre del almacén y
 * qué guarda cada uno, para que el capturador sepa qué elegir sin adivinar.
 *
 * El orden de las verificaciones importa: existe → activo → de la empresa → del tipo. Un almacén
 * privado de OTRA empresa "no existe" para esta sesión (A9), así que su mensaje gana al del tipo:
 * decir "es de telas" de un almacén que el usuario no debería ni ver filtraría información de otra
 * empresa.
 */
export async function exigirAlmacenDelTipo(
  tx: Tx,
  idAlmacen: number,
  tipo: TipoAlmacen,
  idEmpresa: number,
): Promise<void> {
  const almacen = await leerAlmacenUsable(tx, idAlmacen, idEmpresa);
  if (almacen.tipo !== tipo) {
    throw new ErrorValidacion(
      `El almacén "${almacen.nombre}" es de ${QUE_GUARDA[almacen.tipo]}; este movimiento es de ` +
        `${QUE_GUARDA[tipo]}. Elige un almacén de ${QUE_GUARDA[tipo]}.`,
    );
  }
}
