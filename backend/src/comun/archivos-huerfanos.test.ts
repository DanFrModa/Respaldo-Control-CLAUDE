/**
 * ⭐⭐ GUARDIÁN DE LA FILA **0.091** — «el huérfano invisible: borrar un PADRE deja su archivo en la
 * nube».
 *
 * ## La trampa, en tres líneas
 *
 * Un `Archivo` (fila + objeto en Cloudflare R2) se cuelga de su dueño por una **tabla puente** con
 * `onDelete: Cascade` **en los dos lados**. Borrar el `Archivo` arrastra el puente — ése es el
 * camino bueno, y el que vigila el embudo de la 0.081(a) (`comun/archivos.ts`
 * `eliminarObjetosBestEffort`, con un guardián por puerta en `pruebas/commit-r2.ts`). Pero borrar
 * al **PADRE** arrastra el puente **por el otro lado** y deja la fila `Archivo` viva y su objeto en
 * R2 **pagándose para siempre**, sin que nadie pueda verlo. El embudo no lo atrapa: cuelga de
 * `archivo.delete`, no de la cascada.
 *
 * ## Por qué este guardián y no una fila en un documento
 *
 * 🔴 **La lista escrita a mano ya envejeció, y en UNA sola versión.** La fila 0.091 (1-sep-2026)
 * enumeró **siete** puentes; al medirlo desde el esquema son **ocho** —la 0.083 estrenó
 * `OrdenArteFoto`— y hay además **tres** referencias a `Archivo` que no son puentes y que la fila
 * no menciona, con exactamente el mismo riesgo. Y el ancestro que arrastra a un puente puede estar
 * **dos saltos** más arriba (`OrdenArteFoto` → `OrdenArte` → `Orden`), que es donde una lista a
 * mano no llega.
 *
 * Por eso **nada de esto se enumera a mano**: los dos guardianes de este archivo leen
 * `prisma/schema.prisma` y calculan la superficie. Lo único escrito a mano es el **registro** —la
 * declaración de que alguien ya miró cada caso—, y el guardián exige que registro y esquema digan
 * lo mismo.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ancestrosPorCascada,
  modelosDelEsquema,
  relacionesFk,
  relacionesInversas,
  textoDelEsquema,
  type RelacionFk,
} from '../pruebas/esquema-prisma.js';

const esquema = textoDelEsquema();
const fks = relacionesFk(esquema);
/** Todas las FK que apuntan a `Archivo`, vengan de un puente o de un campo del propio dueño. */
const fksAArchivo = fks.filter((fk) => fk.destino === 'Archivo');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1) EL INVENTARIO — quién apunta a `Archivo` y qué pasa cuando su dueño muere
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Cómo se cuelga del `Archivo` quien lo referencia. Los dos casos tienen el MISMO riesgo (el
 * `Archivo` sobrevive a su dueño), pero por caminos distintos:
 *
 *  • `puente` — una tabla intermedia cuya única razón de ser es esa liga. Muere por CASCADE cuando
 *    muere el padre, y el `Archivo` se queda solo.
 *  • `campo`  — la FK vive en el propio dueño (`Empresa.archivoLogo`). No hay puente que borrar: se
 *    borra la fila que apuntaba, y el `Archivo` se queda solo igual.
 */
type FormaDeLiga = 'puente' | 'campo';

interface ReferenciaAArchivo {
  /** Modelo que declara la FK a `Archivo`. */
  modelo: string;
  /** Campo de la FK dentro de ese modelo. */
  campo: string;
  /** Nombre de la relación de vuelta dentro de `model Archivo`. */
  inversa: string;
  /** Qué le pasa a ESTA fila cuando se borra el `Archivo` (el camino bueno, el de la 0.081a). */
  alBorrarElArchivo: 'Cascade' | 'SetNull' | 'Restrict';
  forma: FormaDeLiga;
  /**
   * Para un `puente`: el modelo cuyo borrado se lo lleva por CASCADE (el padre DIRECTO). El
   * guardián lo comprueba contra el esquema y además calcula la cadena completa de ancestros.
   * Para un `campo`: el propio modelo (no hay puente; muere él).
   */
  padreDirecto: string;
}

/**
 * 🔴 **EL REGISTRO — se toca A MANO, y ése es el punto.** Cada renglón es la constancia de que
 * alguien miró esa liga y entendió qué pasa con su objeto de R2. Si el esquema gana una liga nueva
 * a `Archivo` y no aparece aquí, la primera prueba de abajo se pone ROJA con las instrucciones.
 *
 * Al 2-sep-2026 son **once**: ocho puentes y tres campos.
 */
const REFERENCIAS_A_ARCHIVO: ReferenciaAArchivo[] = [
  {
    modelo: 'ProveedorArchivo',
    campo: 'archivo',
    inversa: 'proveedorArchivo',
    alBorrarElArchivo: 'Cascade',
    forma: 'puente',
    padreDirecto: 'Proveedor',
  },
  {
    modelo: 'ModeloFoto',
    campo: 'archivo',
    inversa: 'modeloFoto',
    alBorrarElArchivo: 'Cascade',
    forma: 'puente',
    padreDirecto: 'Modelo',
  },
  {
    // El único puente SIN `@@unique([idArchivo])`: varios artes comparten el mismo objeto de R2 a
    // propósito (migración del catálogo + «copiar arte de otro modelo»), y por eso su borrado pasa
    // por `borrarArchivoSiQuedoHuerfano` en vez de borrar a ciegas.
    modelo: 'ModeloArteFoto',
    campo: 'archivo',
    inversa: 'modeloArteFotos',
    alBorrarElArchivo: 'Cascade',
    forma: 'puente',
    padreDirecto: 'ModeloArte',
  },
  {
    modelo: 'PedidoArchivo',
    campo: 'archivo',
    inversa: 'pedidoArchivo',
    alBorrarElArchivo: 'Cascade',
    forma: 'puente',
    padreDirecto: 'Pedido',
  },
  {
    modelo: 'OrdenArchivo',
    campo: 'archivo',
    inversa: 'ordenArchivo',
    alBorrarElArchivo: 'Cascade',
    forma: 'puente',
    padreDirecto: 'Orden',
  },
  {
    // ⭐ EL OCTAVO — el que la fila 0.091 no alcanzó a ver (§Post-F9.177, v0.083). Y no era
    // latente: su padre `OrdenArte` SÍ se borra en duro hoy (`receta-orden.ts`, el arte «agregado a
    // mano»), así que la trampa estaba VIVA y se tapó en esta misma etapa. Los otros dos padres que
    // hoy se borran en duro —`ModeloArte`, desde `arte-modelo.ts` y `bom-modelo.ts`— ya soltaban su
    // R2 desde la 0.081(a); éste no lo hacía. Los seis puentes restantes siguen latentes: nadie
    // borra en duro a su padre.
    modelo: 'OrdenArteFoto',
    campo: 'archivo',
    inversa: 'ordenArteFoto',
    alBorrarElArchivo: 'Cascade',
    forma: 'puente',
    padreDirecto: 'OrdenArte',
  },
  {
    modelo: 'DesarrolloArchivo',
    campo: 'archivo',
    inversa: 'desarrolloArchivo',
    alBorrarElArchivo: 'Cascade',
    forma: 'puente',
    padreDirecto: 'Desarrollo',
  },
  {
    modelo: 'EntradaTelaArchivo',
    campo: 'archivo',
    inversa: 'entradaTelaArchivo',
    alBorrarElArchivo: 'Cascade',
    forma: 'puente',
    padreDirecto: 'EntradaTela',
  },
  {
    // Los tres de abajo NO son puentes y la fila 0.091 no los nombra: la FK vive en el propio
    // dueño. El riesgo es el mismo —borrado el dueño, el `Archivo` sobrevive—, sólo que sin tabla
    // intermedia de por medio.
    modelo: 'Empresa',
    campo: 'archivoLogo',
    inversa: 'empresaLogo',
    alBorrarElArchivo: 'SetNull',
    forma: 'campo',
    padreDirecto: 'Empresa',
  },
  {
    modelo: 'EntradaTela',
    campo: 'archivoCfdi',
    inversa: 'entradasTelaCfdi',
    alBorrarElArchivo: 'SetNull',
    forma: 'campo',
    padreDirecto: 'EntradaTela',
  },
  {
    modelo: 'MovimientoTercero',
    campo: 'archivoCfdi',
    inversa: 'movimientosTerceroCfdi',
    alBorrarElArchivo: 'Restrict',
    forma: 'campo',
    padreDirecto: 'MovimientoTercero',
  },
];

/** Cómo se identifica una liga de forma estable (no depende del orden del registro). */
const llave = (r: { modelo: string; campo: string }): string => `${r.modelo}.${r.campo}`;

const INSTRUCCIONES_LIGA_NUEVA =
  'FILA 0.091 — apareció (o cambió) una liga a `Archivo` que el registro de ' +
  '`comun/archivos-huerfanos.test.ts` no declara.\n' +
  'LA TRAMPA: el `Archivo` y su objeto de R2 SOBREVIVEN a su dueño. Borrar el `Archivo` arrastra ' +
  'el puente (camino bueno, vigilado por el embudo de la 0.081a); borrar al PADRE arrastra el ' +
  'puente por el otro lado y deja la fila `Archivo` viva y el objeto pagándose para siempre, sin ' +
  'que nadie pueda verlo.\n' +
  'QUÉ HACER: agrega el renglón al registro, y si el nuevo dueño se puede borrar en duro, junta ' +
  'las keys ANTES de borrarlo y suéltalas con `eliminarObjetosBestEffort` DESPUÉS del commit ' +
  '(patrón de `dominio/modelos/arte-modelo.ts`).';

describe('⭐ fila 0.091 — el inventario de quién se cuelga de `Archivo`', () => {
  it('el registro cubre EXACTAMENTE las ligas a `Archivo` que declara el esquema', () => {
    // Red de seguridad del propio guardián: si los regex del parser dejaran de casar, esto lo
    // delata en vez de aprobar un inventario vacío (un guardián mudo es peor que ninguno).
    expect(fks.length).toBeGreaterThan(200);
    expect(fksAArchivo.length).toBeGreaterThan(5);
    expect(fksAArchivo.map(llave)).toContain('ModeloFoto.archivo');

    const enElEsquema = fksAArchivo.map(llave).sort();
    const registradas = REFERENCIAS_A_ARCHIVO.map(llave).sort();

    expect(registradas, INSTRUCCIONES_LIGA_NUEVA).toEqual(enElEsquema);
  });

  it('cada renglón del registro dice lo mismo que el esquema (onDelete y forma de la liga)', () => {
    const porLlave = new Map<string, RelacionFk>(fksAArchivo.map((fk) => [llave(fk), fk]));

    for (const referencia of REFERENCIAS_A_ARCHIVO) {
      const fk = porLlave.get(llave(referencia));
      expect(fk, `${llave(referencia)} ya no existe en el esquema`).toBeDefined();
      expect(fk!.onDelete, `${llave(referencia)}: cambió el onDelete hacia \`Archivo\``).toBe(
        referencia.alBorrarElArchivo,
      );
      // Un PUENTE cuelga del archivo de forma OBLIGATORIA (la fila no tiene sentido sin él); un
      // CAMPO lo lleva como atributo opcional del propio dueño. Si esto se invirtiera, la liga
      // cambió de naturaleza y el renglón del registro ya no describe lo que hay.
      expect(
        fk!.opcional,
        `${llave(referencia)}: la liga cambió de forma (${referencia.forma})`,
      ).toBe(referencia.forma === 'campo');
    }
  });

  it('los PUENTES caen en Cascade con el padre que el registro declara (la trampa del enunciado)', () => {
    const puentes = REFERENCIAS_A_ARCHIVO.filter((r) => r.forma === 'puente');
    // Si esto bajara de 8, o la lista quedara vacía por un cambio de forma, la prueba de arriba ya
    // habría gritado; aquí se afirma para que el número viva escrito junto a lo que lo produce.
    expect(puentes).toHaveLength(8);

    for (const puente of puentes) {
      const haciaElPadre = fks.filter(
        (fk) => fk.modelo === puente.modelo && fk.destino !== 'Archivo',
      );
      expect(
        haciaElPadre.map((fk) => fk.destino),
        `${puente.modelo}: el registro dice que su padre es ${puente.padreDirecto}`,
      ).toEqual([puente.padreDirecto]);
      expect(
        haciaElPadre[0]!.onDelete,
        `${puente.modelo} → ${puente.padreDirecto}: si ya no es Cascade, la trampa de la 0.091 ` +
          'cambió de forma y el registro hay que releerlo entero',
      ).toBe('Cascade');
    }
  });

  it('la relación de VUELTA declarada en `model Archivo` coincide con el registro', () => {
    // La segunda mitad de la liga. Se comprueba aparte porque un renombre de la inversa no rompe
    // nada en el esquema pero sí deja mintiendo al registro (defecto «la prosa miente»).
    const inversas = relacionesInversas(esquema, 'Archivo');
    expect(inversas.length).toBeGreaterThan(5);
    // El escalar `subidoPorId String?` NO es una relación: si se colara, el parser está mal.
    expect(inversas.map((i) => i.campo)).not.toContain('subidoPorId');

    const porInversa = new Map(inversas.map((i) => [i.campo, i.destino]));
    for (const referencia of REFERENCIAS_A_ARCHIVO) {
      expect(
        porInversa.get(referencia.inversa),
        `\`model Archivo\` ya no declara la vuelta \`${referencia.inversa}\` de ${referencia.modelo}`,
      ).toBe(referencia.modelo);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2) EL BORRADO DURO — quién puede disparar la trampa desde el código de producción
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Los modelos cuyo hard-delete deja un `Archivo` sin dueño, **calculados desde el esquema**:
 *
 *  • los puentes mismos (borrar el renglón del puente deja el `Archivo` vivo),
 *  • todos sus ancestros por Cascade, en cadena — incluido el salto de ABUELO
 *    (`OrdenArteFoto` → `OrdenArte` → `Orden`) que una lista a mano no ve,
 *  • y los dueños de las ligas por campo (`Empresa`, `EntradaTela`, `MovimientoTercero`).
 *
 * `Archivo` queda FUERA a propósito: borrarlo es el camino BUENO y ya tiene su propio guardián por
 * puerta (la 0.081a, `pruebas/commit-r2.ts`). Vigilarlo aquí sería duplicar esa defensa y llenar
 * este registro de ruido.
 */
const MODELOS_VIGILADOS: string[] = [
  ...new Set(
    REFERENCIAS_A_ARCHIVO.flatMap((r) => [
      r.modelo,
      ...ancestrosPorCascada(fks, r.modelo, ['Archivo']),
    ]),
  ),
].sort();

/** `OrdenArteFoto` → `ordenArteFoto`: el nombre con el que Prisma lo expone en el cliente. */
const enElCliente = (modelo: string): string => modelo.charAt(0).toLowerCase() + modelo.slice(1);

interface BorradoDuroConocido {
  /** Ruta relativa a `backend/`, con `/`. */
  archivo: string;
  /** Modelo borrado, con el nombre del cliente de Prisma (`ordenArte`). */
  modelo: string;
  /** Cómo libera el objeto de R2. Si un día deja de ser cierto, este renglón es la mentira. */
  comoLiberaR2: string;
}

/**
 * 🔴 **Los borrados duros que hoy SÍ existen y ya están resueltos.** Cualquier otro que aparezca
 * pone la prueba en rojo.
 *
 * ⚠️ El registro NO exime: declara que alguien miró ese sitio y comprobó que el objeto de R2 se
 * suelta. Si agregas uno sin soltarlo, la prueba te dejará pasar — y estarás mintiendo aquí.
 */
const BORRADOS_DUROS_CONOCIDOS: BorradoDuroConocido[] = [
  {
    archivo: 'src/dominio/modelos/arte-modelo.ts',
    modelo: 'modeloArte',
    comoLiberaR2:
      'lee las fotos ANTES de borrar, pasa cada idArchivo por `borrarArchivoSiQuedoHuerfano` ' +
      '(otros artes comparten objeto) y suelta las keys con `eliminarObjetosBestEffort` tras el commit',
  },
  {
    archivo: 'src/dominio/modelos/arte-modelo.ts',
    modelo: 'modeloArteFoto',
    comoLiberaR2: 'mismo camino que `modeloArte`, para una sola foto (`quitarFotoArte`)',
  },
  {
    archivo: 'src/dominio/modelos/bom-modelo.ts',
    modelo: 'modeloArte',
    comoLiberaR2:
      'al REEMPLAZAR la receta lee las fotos que se van, las pasa por ' +
      '`borrarArchivoSiQuedoHuerfano` y suelta las keys tras el commit',
  },
  {
    archivo: 'src/dominio/produccion/receta-orden.ts',
    modelo: 'ordenArte',
    comoLiberaR2:
      'el arte AGREGADO A MANO sí se borra de verdad: antes de borrarlo, ' +
      '`liberarFotosPropiasDeArteOrden` borra los `Archivo` de sus fotos propias (Cascade se lleva ' +
      'los `OrdenArteFoto`) y devuelve las keys, que se sueltan tras el commit',
  },
];

/** Ficheros `.ts` bajo `dir`, recursivo. */
function ficherosTs(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) {
      salida.push(...ficherosTs(ruta));
      continue;
    }
    if (ruta.endsWith('.ts')) salida.push(ruta);
  }
  return salida;
}

/**
 * Quita comentarios de bloque y comentarios de LÍNEA COMPLETA, para que una explicación que
 * mencione `tx.orden.delete(` no cuente como código. Un comentario al final de una línea con
 * código sí sobrevive — y está bien: ahí el código de al lado ya cuenta igual.
 */
function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const RAIZ_BACKEND = fileURLToPath(new URL('../..', import.meta.url));

/**
 * ⚠️ **LO QUE ESTE ESCANEO NO MIRA — dicho aquí para que nadie asuma cobertura total.**
 *
 * Recorre `src/` y **sólo** `src/`. Quedan fuera, medido al 2-sep-2026:
 *  • **`scripts/`**, donde HOY hay tres hard-deletes vivos (`datos-demo-ordenes.ts:163` y `:166`,
 *    `demo-rc.ts:152`, sobre `Orden` y `Pedido`). No es un descuido: la propia fila 0.091 los
 *    bendice —son generadores de datos de DEMO sobre `prueba`, REGLA 0-B—. Pero si alguno subiera
 *    archivos algún día, su R2 se quedaría huérfano y **este guardián no lo vería**.
 *  • **`migracion/`** (el ETL), donde hoy hay **cero** hard-deletes de los modelos vigilados.
 *  • El **cliente Prisma generado** (`src/datos/generated/`), y las **pruebas**.
 *
 * Y por ser un guardián de TEXTO tampoco ve: `$executeRaw` con DELETE (hoy: cero en producción —
 * los `$executeRaw` que hay son advisory locks), el despacho por variable (`tx[nombre].delete`), los
 * borrados anidados de Prisma (`{ fotos: { deleteMany } }`, hoy: cero) ni el SQL de
 * `prisma/migrations/**`.
 */
describe('⭐ fila 0.091 — nadie borra en duro un dueño de `Archivo` sin soltar su objeto de R2', () => {
  it('la superficie vigilada sale del esquema y contiene los saltos de abuelo', () => {
    // Sin esta prueba, un fallo del cálculo dejaría la lista vacía y el escaneo de abajo pasaría
    // por no mirar nada: el paso vacuo.
    expect(MODELOS_VIGILADOS.length).toBeGreaterThanOrEqual(15);
    // El abuelo: `OrdenArteFoto` cuelga de `OrdenArte`, que cuelga de `Orden`. Los tres vigilados.
    expect(MODELOS_VIGILADOS).toEqual(
      expect.arrayContaining(['OrdenArteFoto', 'OrdenArte', 'Orden']),
    );
    // Y el bisabuelo del otro lado: `DesarrolloArchivo` → `Desarrollo` → `Proyecto`.
    expect(MODELOS_VIGILADOS).toContain('Proyecto');
    // `Archivo` NO se vigila aquí (es la 0.081a, con guardián propio por puerta).
    expect(MODELOS_VIGILADOS).not.toContain('Archivo');
    // Y el registro no puede nombrar un modelo que no se vigila (renombre o dedazo).
    for (const conocido of BORRADOS_DUROS_CONOCIDOS) {
      expect(MODELOS_VIGILADOS.map(enElCliente)).toContain(conocido.modelo);
    }
  });

  it('🔴 ningún borrado duro NUEVO sobre un dueño de `Archivo` en `src/` (fuera de pruebas)', () => {
    const patron = new RegExp(
      `\\.(${MODELOS_VIGILADOS.map(enElCliente).join('|')})\\s*\\.\\s*(?:delete|deleteMany)\\s*\\(`,
      'g',
    );

    const encontrados: string[] = [];
    for (const ruta of ficherosTs(join(RAIZ_BACKEND, 'src'))) {
      const relativa = relative(RAIZ_BACKEND, ruta).split('\\').join('/');
      // Fuera: las pruebas (montan y desmontan datos a propósito), la infraestructura de pruebas y
      // el CLIENTE PRISMA GENERADO (megabytes que eslint también ignora; hoy da cero positivos,
      // pero recorrerlo es puro coste y un falso positivo ahí sería ingobernable).
      if (relativa.endsWith('.test.ts') || relativa.startsWith('src/pruebas/')) continue;
      if (relativa.startsWith('src/datos/generated/')) continue;
      const codigo = sinComentarios(readFileSync(ruta, 'utf8'));
      for (const golpe of codigo.matchAll(patron)) {
        encontrados.push(`${relativa} → ${golpe[1]!}.delete`);
      }
    }

    // Red de seguridad: si el escaneo dejara de encontrar los que YA sabemos que hay, el regex se
    // rompió y este guardián estaría aprobando por no mirar nada.
    expect(encontrados).toContain('src/dominio/produccion/receta-orden.ts → ordenArte.delete');
    expect(encontrados).toContain('src/dominio/modelos/arte-modelo.ts → modeloArte.delete');

    const declarados = BORRADOS_DUROS_CONOCIDOS.map((c) => `${c.archivo} → ${c.modelo}.delete`);
    const nuevos = [...new Set(encontrados)].filter((e) => !declarados.includes(e)).sort();

    expect(
      nuevos,
      'FILA 0.091 — este código borra EN DURO un dueño de `Archivo`.\n' +
        'LA TRAMPA: la cascada se lleva el puente y deja la fila `Archivo` VIVA y su objeto en R2 ' +
        'pagándose para siempre. El embudo de la 0.081(a) no lo atrapa porque cuelga de ' +
        '`archivo.delete`, no de la cascada. Y el dueño puede estar dos saltos arriba: borrar una ' +
        '`Orden` se lleva sus `OrdenArte` y con ellos sus `OrdenArteFoto`.\n' +
        'QUÉ HACER: junta las keys de R2 ANTES de borrar, borra los `Archivo` (la Cascade se lleva ' +
        'los puentes) y suelta las keys con `eliminarObjetosBestEffort` DESPUÉS del commit; luego ' +
        'declara el sitio en `BORRADOS_DUROS_CONOCIDOS` diciendo cómo lo libera.',
    ).toEqual([]);
  });

  it('el registro de borrados conocidos no tiene renglones muertos', () => {
    // Un renglón que ya no corresponde a nada es prosa que miente: se quita.
    const patron = new RegExp(
      `\\.(${MODELOS_VIGILADOS.map(enElCliente).join('|')})\\s*\\.\\s*(?:delete|deleteMany)\\s*\\(`,
      'g',
    );
    for (const conocido of BORRADOS_DUROS_CONOCIDOS) {
      const codigo = sinComentarios(readFileSync(join(RAIZ_BACKEND, conocido.archivo), 'utf8'));
      const modelos = [...codigo.matchAll(patron)].map((g) => g[1]!);
      expect(modelos, `${conocido.archivo} ya no borra \`${conocido.modelo}\``).toContain(
        conocido.modelo,
      );
      expect(conocido.comoLiberaR2.trim().length).toBeGreaterThan(20);
    }
  });
});

describe('el parser del esquema no está mirando un archivo vacío', () => {
  it('lee `prisma/schema.prisma` de verdad', () => {
    // Si el fichero no se encontrara, `readFileSync` ya habría reventado; esto atrapa el otro caso
    // (leer algo que no es el esquema) antes de que los guardianes concluyan «no hay nada».
    expect(modelosDelEsquema(esquema).size).toBeGreaterThan(100);
    expect(modelosDelEsquema(esquema).has('Archivo')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3) LA GEMELA: cada PUERTA a R2 tiene que tener su prueba de commit
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⭐⭐ **POR QUÉ ESTO ES PARTE DE LA 0.091 Y NO UN EXTRA.**
 *
 * La cobertura real de los dos guardianes de arriba **descansa en que cada puerta a R2 tenga su
 * prueba de commit**, y esa correspondencia no la vigilaba nada. Medido: con la fuga de
 * `receta-orden.ts` reintroducida, el guardián de hard-delete se queda **8/8 en verde** — quien la
 * mata es la prueba de commit de esa puerta. Una puerta sin `*-r2.test.ts` **no está protegida por
 * nada de este archivo**.
 *
 * 🔴 **Y ya falló una vez, a mano.** `produccion/fotos-arte-orden.ts` fue puerta a R2 desde la 0.083
 * y se quedó sin guardián durante dos versiones; se descubrió leyendo, no por una prueba roja. Ése
 * es exactamente el modo de fallo contra el que existe esta fila: **la lista escrita a mano que
 * envejece**. Por eso las puertas se ESCANEAN y sólo las excepciones se escriben.
 *
 * ⚠️ **GRANULARIDAD: por MÓDULO, no por sitio de borrado.** Hoy hay **15 sitios de borrado en 12
 * módulos** (`admin/empresas.ts` —`confirmarLogo` y `quitarLogo`—, `modelos/arte-modelo.ts`
 * —`eliminarArte` y `quitarFotoArte`— y `comun/jobs/respaldo-bd.ts` llevan **dos cada uno**). Lo que
 * esto exige es que **ALGÚN `*-r2.test.ts` IMPORTE el módulo**, no que pruebe cada función. Medido
 * al 2-sep-2026: los dos módulos de adjuntos con dos puertas **las tienen las dos cubiertas** y
 * llaman al guardián dos veces cada uno. 🔴 **Una TERCERA puerta en cualquiera de ellos pasaría
 * inadvertida** — y el número que se reporta («12 puertas») es un conteo de MÓDULOS. Se dice aquí
 * para no aparentar más cobertura de la que hay.
 */

/** Una puerta que a propósito no exige `*-r2.test.ts`, con la razón por la que no. */
interface PuertaExenta {
  archivo: string;
  motivo: string;
}

/**
 * 🔴 **LAS EXCEPCIONES — a mano, y cada una con su razón.** Sólo dos familias:
 *
 *  1. **Los cuatro `adjuntos-*`: DEUDA DECLARADA de la 0.081(a).** Llevan la MISMA invariante
 *     (borrar en R2 después del commit) con un `try/catch` **en línea** en vez del embudo, y el
 *     reviewer de aquella fila los dejó explícitamente fuera de alcance. Hoy **la mutación que
 *     viola la invariante sobreviviría ahí**. No se tocan en esta etapa; se nombran para que la
 *     deuda esté donde se trabaja y no sólo en un documento.
 *  2. **El respaldo de la base**, que no es una puerta de este tipo: borra RESPALDOS VIEJOS por
 *     retención, sobre su propia interfaz inyectada `AlmacenRespaldos.eliminarObjeto`. No hay fila
 *     `Archivo` que pueda quedar huérfana ni transacción con la que sincronizarse, así que el
 *     guardián de commit no le aplica — tiene sus propias pruebas de retención.
 */
const PUERTAS_R2_EXENTAS: PuertaExenta[] = [
  {
    archivo: 'src/dominio/produccion/adjuntos-orden.ts',
    motivo: 'DEUDA 0.081(a): try/catch en línea, sin guardián de commit — fuera de alcance',
  },
  {
    archivo: 'src/dominio/pedidos/adjuntos-pedido.ts',
    motivo: 'DEUDA 0.081(a): try/catch en línea, sin guardián de commit — fuera de alcance',
  },
  {
    archivo: 'src/dominio/desarrollo/adjuntos-desarrollo.ts',
    motivo: 'DEUDA 0.081(a): try/catch en línea, sin guardián de commit — fuera de alcance',
  },
  {
    archivo: 'src/dominio/inventarios/adjuntos-entrada-tela.ts',
    motivo: 'DEUDA 0.081(a): try/catch en línea, sin guardián de commit — fuera de alcance',
  },
  {
    archivo: 'src/comun/jobs/respaldo-bd.ts',
    motivo:
      'no es puerta de adjuntos: borra respaldos viejos por RETENCIÓN sobre su propia interfaz ' +
      '`AlmacenRespaldos`; no hay fila `Archivo` que quede huérfana ni commit con el que sincronizar',
  },
];

/** Módulos de producción que BORRAN algo de R2 — escaneados, nunca enumerados a mano. */
function puertasR2(): string[] {
  const puertas: string[] = [];
  for (const ruta of ficherosTs(join(RAIZ_BACKEND, 'src'))) {
    const relativa = relative(RAIZ_BACKEND, ruta).split('\\').join('/');
    if (relativa.endsWith('.test.ts') || relativa.startsWith('src/pruebas/')) continue;
    if (relativa.startsWith('src/datos/generated/')) continue;
    // El motor mismo NO es una puerta: es por donde pasan todas.
    if (relativa === 'src/comun/archivos.ts') continue;
    const codigo = sinComentarios(readFileSync(ruta, 'utf8'));
    if (/eliminarObjetosBestEffort\s*\(|\.eliminarObjeto\s*\(/.test(codigo)) puertas.push(relativa);
  }
  return puertas.sort();
}

/**
 * Los módulos que importa cada `*-r2.test.ts`, resueltos a ruta del repo.
 *
 * ⚠️ Reconoce **las dos formas**, y hace falta: tres de los siete guardianes de hoy cargan su
 * módulo con `await import('./x.js')` (porque antes hacen `vi.mock` de sus vecinos) y no con un
 * `import … from`. Mirar sólo la estática dejaría fuera precisamente a `arte-modelo`, `bom-modelo`
 * y `receta-orden`.
 */
function modulosCubiertosPorPruebasR2(): Set<string> {
  const cubiertos = new Set<string>();
  for (const ruta of ficherosTs(join(RAIZ_BACKEND, 'src'))) {
    if (!ruta.endsWith('-r2.test.ts')) continue;
    const codigo = readFileSync(ruta, 'utf8');
    for (const golpe of codigo.matchAll(/(?:from|import\()\s*'(\.[^']+\.js)'/g)) {
      const destino = resolve(dirname(ruta), golpe[1]!).replace(/\.js$/, '.ts');
      cubiertos.add(relative(RAIZ_BACKEND, destino).split('\\').join('/'));
    }
  }
  return cubiertos;
}

describe('⭐⭐ fila 0.091 — cada puerta a R2 tiene su prueba de commit (la gemela)', () => {
  it('el escaneo encuentra puertas y pruebas de verdad (si no, no está midiendo nada)', () => {
    const puertas = puertasR2();
    const cubiertos = modulosCubiertosPorPruebasR2();

    expect(puertas.length).toBeGreaterThanOrEqual(11);
    expect(puertas).toContain('src/dominio/produccion/fotos-arte-orden.ts');
    expect(puertas).toContain('src/dominio/produccion/adjuntos-orden.ts');
    // La forma ESTÁTICA y la DINÁMICA, una de cada, para que romper cualquiera de las dos grite.
    expect(cubiertos).toContain('src/dominio/admin/empresas.ts');
    expect(cubiertos).toContain('src/dominio/produccion/receta-orden.ts');
  });

  it('🔴 ninguna puerta a R2 se queda sin `*-r2.test.ts` (y las exentas dicen por qué)', () => {
    const cubiertos = modulosCubiertosPorPruebasR2();
    const exentas = PUERTAS_R2_EXENTAS.map((e) => e.archivo);

    const huerfanas = puertasR2()
      .filter((puerta) => !cubiertos.has(puerta) && !exentas.includes(puerta))
      .sort();

    expect(
      huerfanas,
      'FILA 0.091 — este módulo borra objetos de Cloudflare R2 y NO tiene un `*-r2.test.ts` que lo ' +
        'importe.\n' +
        'LA TRAMPA: sin esa prueba, mover el borrado DENTRO de la transacción no rompe nada — un ' +
        'rollback dejaría el objeto borrado y su fila `Archivo` viva. Y el guardián de hard-delete ' +
        'de esta misma fila NO lo cubre: medido, se queda en verde con la fuga puesta.\n' +
        'QUÉ HACER: crea `<modulo>-r2.test.ts` con `exigirBorradoTrasElCommit` de ' +
        '`pruebas/commit-r2.ts` (copia cualquiera de los siete que ya existen). Si de verdad no le ' +
        'aplica, decláralo en `PUERTAS_R2_EXENTAS` con la razón.',
    ).toEqual([]);
  });

  it('🔴 y todo `*-r2.test.ts` INVOCA de verdad el guardián de commit (importar no basta)', () => {
    // La otra mitad del agujero: la prueba de arriba se conforma con que el módulo esté IMPORTADO.
    // Un `*-r2.test.ts` que lo importara y sólo afirmara cosas sueltas dejaría la puerta marcada
    // como cubierta sin vigilar la invariante — cobertura de mentira, que es peor que ninguna.
    const pruebas = ficherosTs(join(RAIZ_BACKEND, 'src')).filter((r) => r.endsWith('-r2.test.ts'));
    expect(pruebas.length).toBeGreaterThanOrEqual(7);
    for (const ruta of pruebas) {
      const relativa = relative(RAIZ_BACKEND, ruta).split('\\').join('/');
      expect(
        readFileSync(ruta, 'utf8'),
        `${relativa} no invoca \`exigirBorradoTrasElCommit\`: no está vigilando el commit`,
      ).toContain('exigirBorradoTrasElCommit(');
    }
  });

  it('el registro de exentas no tiene renglones muertos ni razones vacías', () => {
    const puertas = puertasR2();
    for (const exenta of PUERTAS_R2_EXENTAS) {
      expect(puertas, `${exenta.archivo} ya no borra nada en R2: sobra en las exentas`).toContain(
        exenta.archivo,
      );
      expect(exenta.motivo.trim().length).toBeGreaterThan(30);
    }
  });
});
