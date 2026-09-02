/**
 * Lector mínimo de `prisma/schema.prisma` **para guardianes**.
 *
 * ## Por qué existe
 *
 * Hay listas en este repo que enumeran a mano partes del modelo de datos («los N puentes a
 * `Archivo`», «las N referencias entrantes de `Color`») y que **envejecen en una sola versión**.
 * El precedente es `dominio/catalogos/colores-fusion-referencias.test.ts`: tres veces se
 * enumeraron las referencias de `Color` y las tres se enumeraron mal, hasta que una prueba pasó a
 * leer el esquema. Este módulo es esa misma idea, extraída para que no haya **dos** parsers.
 *
 * ⚠️ **Es un parser de TEXTO, no de la AST de Prisma**, y eso acota lo que puede afirmar: entiende
 * `model X { … }`, los campos de relación con `@relation(fields: […])` y las relaciones de vuelta.
 * NO entiende `@@map`, ni tipos compuestos, ni `enum`. Por eso cada guardián que lo use añade sus
 * propias **redes de seguridad** (afirmar que ciertos nombres conocidos SÍ aparecen): si un cambio
 * de formato rompiera un regex, el guardián se vuelve rojo en vez de quedarse mudo — que es
 * exactamente el fallo silencioso que estos guardianes vienen a impedir.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Una llave foránea declarada en un modelo: el lado que lleva `fields: […]`. */
export interface RelacionFk {
  /** Modelo que DECLARA la FK (el que se queda sin destino si el destino muere). */
  modelo: string;
  /** Nombre del campo de relación (p. ej. `archivo`). */
  campo: string;
  /** Modelo al que apunta (p. ej. `Archivo`). */
  destino: string;
  /** `true` si el campo es opcional (`Destino?`): la fila puede existir sin destino. */
  opcional: boolean;
  /** `Cascade` / `SetNull` / `Restrict` / `(sin declarar)` si el esquema no lo dice. */
  onDelete: string;
}

/** Una relación de VUELTA (la lista o el 0..1 que Prisma exige en el otro extremo). */
export interface RelacionInversa {
  campo: string;
  destino: string;
  /** `true` para `Destino[]`, `false` para `Destino?`. */
  esLista: boolean;
}

/** Texto crudo de `backend/prisma/schema.prisma`. */
export function textoDelEsquema(): string {
  return readFileSync(
    fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)),
    'utf8',
  );
}

/** Los bloques `model X { … }` del esquema, por nombre de modelo. */
export function modelosDelEsquema(esquema: string): Map<string, string> {
  const modelos = new Map<string, string>();
  const bloque = /^model ([A-Za-z][A-Za-z0-9]*) \{$([\s\S]*?)^\}$/gm;
  let encontrado = bloque.exec(esquema);
  while (encontrado !== null) {
    modelos.set(encontrado[1]!, encontrado[2]!);
    encontrado = bloque.exec(esquema);
  }
  return modelos;
}

/**
 * TODAS las llaves foráneas del esquema (el lado con `fields: […]`), en orden de aparición.
 *
 * Una FK se reconoce por la forma `  campo  Destino(?)  @relation(… fields: [… ] …)`. El
 * `fields:` es lo que distingue el lado que MANDA del lado de vuelta.
 */
export function relacionesFk(esquema: string): RelacionFk[] {
  const fks: RelacionFk[] = [];
  for (const [modelo, cuerpo] of modelosDelEsquema(esquema)) {
    for (const linea of cuerpo.split('\n')) {
      const campo =
        /^\s{2}([a-zA-Z][a-zA-Z0-9]*)\s+([A-Z][A-Za-z0-9]*)(\?)?\s+@relation\((.*)\)\s*$/.exec(
          linea,
        );
      if (campo === null) continue;
      const argumentos = campo[4]!;
      if (!argumentos.includes('fields:')) continue;
      const onDelete = /onDelete:\s*([A-Za-z]+)/.exec(argumentos);
      fks.push({
        modelo,
        campo: campo[1]!,
        destino: campo[2]!,
        opcional: campo[3] === '?',
        onDelete: onDelete === null ? '(sin declarar)' : onDelete[1]!,
      });
    }
  }
  return fks;
}

/**
 * Las relaciones de VUELTA declaradas dentro de `model <nombre>`: campos cuyo tipo es OTRO MODELO
 * y que no llevan `fields:`.
 *
 * ⚠️ Se exige que el tipo sea un modelo real del esquema: sin eso, un escalar opcional
 * (`subidoPorId String?`) se colaría como si fuera una relación.
 */
export function relacionesInversas(esquema: string, nombreModelo: string): RelacionInversa[] {
  const modelos = modelosDelEsquema(esquema);
  const cuerpo = modelos.get(nombreModelo);
  if (cuerpo === undefined) {
    throw new Error(`No se encontró \`model ${nombreModelo}\` en prisma/schema.prisma`);
  }
  const inversas: RelacionInversa[] = [];
  for (const linea of cuerpo.split('\n')) {
    const campo = /^\s{2}([a-zA-Z][a-zA-Z0-9]*)\s+([A-Z][A-Za-z0-9]*)(\[\]|\?)/.exec(linea);
    if (campo === null) continue;
    if (linea.includes('fields:')) continue;
    const destino = campo[2]!;
    if (!modelos.has(destino)) continue;
    inversas.push({ campo: campo[1]!, destino, esLista: campo[3] === '[]' });
  }
  return inversas;
}

/**
 * Los modelos cuyo borrado ARRASTRA una fila de `modelo` por `onDelete: Cascade`, en cadena.
 *
 * Es el cierre transitivo hacia arriba: si `OrdenArteFoto` cae en Cascade con `OrdenArte`, y
 * `OrdenArte` cae en Cascade con `Orden`, entonces borrar una `Orden` **también** se lleva la
 * `OrdenArteFoto`. Ese salto de abuelo es justo el que una lista escrita a mano no ve.
 *
 * @param ignorar destinos que no cuentan como «padre» (p. ej. `Archivo`, que es el otro extremo
 *   del puente y no el dueño que lo arrastra).
 */
export function ancestrosPorCascada(
  fks: readonly RelacionFk[],
  modelo: string,
  ignorar: readonly string[] = [],
): string[] {
  const encontrados = new Set<string>();
  const pendientes = [modelo];
  while (pendientes.length > 0) {
    const actual = pendientes.pop()!;
    for (const fk of fks) {
      if (fk.modelo !== actual) continue;
      if (fk.onDelete !== 'Cascade') continue;
      if (ignorar.includes(fk.destino)) continue;
      if (encontrados.has(fk.destino)) continue;
      encontrados.add(fk.destino);
      pendientes.push(fk.destino);
    }
  }
  return [...encontrados].sort();
}
