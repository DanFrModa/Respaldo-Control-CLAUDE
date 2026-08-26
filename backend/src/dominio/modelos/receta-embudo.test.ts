/**
 * ⭐ V1-E7e — EL GUARDIÁN DEL EMBUDO (§Post-F9.116).
 *
 * Daniel fue explícito en que esto es TODO o nada: *"cubrir sólo una parte sería PEOR que no
 * cubrir nada: parecería resuelto sin estarlo"*. Las pruebas de conducta demuestran que las SEIS
 * puertas de HOY tumban la firma; lo que ninguna de ellas puede demostrar es que la puerta de
 * MAÑANA lo haga.
 *
 * 📏 **Cómo se cuenta, porque los dos números son ciertos y confunden juntos:** son **SEIS puertas**
 * —seis acciones que el usuario puede hacer para mover la receta: el PUT de telas, el de avíos,
 * copiar la receta de otro modelo, aceptar avíos favoritos, las medidas por talla y el arte—
 * repartidas en **CINCO archivos**. La prueba trabaja por archivo; el negocio cuenta acciones.
 *
 * Esta prueba es esa red: **lee el código fuente** y exige que todo archivo del backend que
 * ESCRIBA en una tabla de la receta (`ModeloTela`, `ModeloAvio`, `ModeloAvioTalla`, `ModeloArte` y
 * las fotos del arte) pase por {@link tocarModeloPorCambioDeReceta}. Si alguien abre un camino
 * nuevo a la receta y se olvida del embudo, esto se pone rojo antes de que la firma-adorno vuelva
 * por la puerta de atrás.
 *
 * ⚠️ **Lo que esta prueba SÍ y NO garantiza.** Trabaja por ARCHIVO, no por función: garantiza que
 * ningún archivo escriba la receta sin conocer el embudo, y obliga a que toda excepción sea
 * DECLARADA aquí abajo (con su razón) en vez de colarse callada. NO garantiza que dentro de un
 * archivo que ya lo importa, una función nueva lo llame — eso lo cubren las pruebas de conducta y
 * el hecho de que el `cambio` sea un parámetro obligatorio. Es una red, no un teorema.
 *
 * 🕳️ **El punto ciego que el reviewer encontró, y por qué está cerrado.** La primera versión sólo
 * miraba la escritura DIRECTA (`tx.modeloTela.updateMany(...)`), así que una escritura ANIDADA por
 * relación —`tx.modelo.update({ data: { telas: { updateMany: … } } })`— pasaba invisible. El
 * reviewer la escribió y el guardián no la vio. Hoy se miran las dos formas: la directa y la
 * anidada por el nombre de la relación (`telas`, `avios`, `artes`, `tallas`, `fotos`).
 *
 * 🕳️ **Y el segundo: el alcance.** Miraba sólo `src/`, y `backend/migracion/` también escribe estas
 * tablas. Hoy barre las dos raíces. Los cargadores del ETL quedan como excepción DECLARADA abajo
 * (con su razón), que es lo contrario de no mirarlos.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** La raíz del BACKEND (no de `src/`): el barrido tiene que alcanzar también `migracion/`. */
const RAIZ_BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Las dos raíces de código del backend que pueden escribir la receta. */
const RAICES = ['src', 'migracion'];

/** Las tablas que SON la receta de un modelo (§Post-F9.116: telas, avíos, medidas y arte). */
const TABLAS_DE_RECETA = [
  'modeloTela',
  'modeloAvio',
  'modeloAvioTalla',
  'modeloArte',
  'modeloArteFoto',
];

/** Los métodos de Prisma que ESCRIBEN (los de lectura no invalidan nada). */
const ESCRITURAS = [
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
];

/**
 * Los nombres de RELACIÓN por los que se llega a la receta desde su padre. Existen porque Prisma
 * deja escribir anidado: `tx.modelo.update({ data: { telas: { updateMany: … } } })` toca
 * `ModeloTela` sin nombrarla nunca. El reviewer de V1-E7e demostró que ese camino era invisible.
 */
const RELACIONES_DE_RECETA = ['telas', 'avios', 'artes', 'tallas', 'fotos'];

/** La escritura DIRECTA: `tx.modeloTela.updateMany(...)`. */
const ESCRIBE_DIRECTO = new RegExp(
  `\\.(?:${TABLAS_DE_RECETA.join('|')})\\.(?:${ESCRITURAS.join('|')})\\s*\\(`,
);

/** La escritura ANIDADA: `telas: { updateMany: … }` colgando del padre. */
const ESCRIBE_ANIDADO = new RegExp(
  `\\b(?:${RELACIONES_DE_RECETA.join('|')})\\s*:\\s*\\{\\s*(?:${ESCRITURAS.join('|')})\\s*:`,
);

const ESCRIBE_RECETA = {
  test: (codigo: string) => ESCRIBE_DIRECTO.test(codigo) || ESCRIBE_ANIDADO.test(codigo),
};

/**
 * Los archivos a los que el embudo NO les aplica, cada uno con su razón. Añadir uno aquí es una
 * DECISIÓN que se lee en el diff — que es justamente lo que se quiere: nadie desactiva la regla
 * sin decir por qué.
 */
const EXCEPCIONES: Record<string, string> = {
  'src/dominio/modelos/versiones.ts':
    'Copia la receta a un modelo RECIÉN NACIDO, dentro de la transacción que lo crea: su revisión ' +
    'nace en `pendiente` y no hay firma que tumbar. Llamar al embudo aquí marcaría como ' +
    '"invalidada" a una versión que nunca se firmó.',
  'migracion/loaders/fotos-modelos.ts':
    'Cargador del ETL: mete las fotos de los ~5.000 modelos MIGRADOS de Access, que tienen ' +
    '`revisionEstado` en NULL — nunca pasaron por una revisión, así que no hay firma que tumbar. ' +
    'Corre a mano, fuera de la vida normal del sistema. Queda DECLARADO aquí y no fuera del ' +
    'barrido: si algún día el ETL tocara un modelo revisado, esta línea es donde hay que discutirlo.',
};

/** Carpetas que no son código de negocio (generado por Prisma, ayudas de prueba). */
const CARPETAS_FUERA = ['src/datos/generated', 'src/pruebas'];

/** Todos los `.ts` de producción del backend (sin generados, sin pruebas), en las dos raíces. */
function fuentesDeProduccion(carpeta: string, acumulado: string[] = []): string[] {
  for (const entrada of readdirSync(carpeta)) {
    const completa = path.join(carpeta, entrada);
    const relativa = path.relative(RAIZ_BACKEND, completa).replaceAll(path.sep, '/');
    if (CARPETAS_FUERA.some((fuera) => relativa === fuera || relativa.startsWith(`${fuera}/`))) {
      continue;
    }
    if (entrada === 'node_modules') continue;
    if (statSync(completa).isDirectory()) {
      fuentesDeProduccion(completa, acumulado);
    } else if (entrada.endsWith('.ts') && !entrada.endsWith('.test.ts')) {
      acumulado.push(relativa);
    }
  }
  return acumulado;
}

describe('El embudo de mutación de receta (V1-E7e)', () => {
  const fuentes = RAICES.flatMap((raiz) => fuentesDeProduccion(path.join(RAIZ_BACKEND, raiz)));

  it('la prueba está mirando el código de verdad (si no, no vigila nada)', () => {
    // Defensa contra el fallo silencioso: si la ruta se rompiera, la lista quedaría vacía y todas
    // las aserciones de abajo pasarían por no tener nada que revisar.
    expect(fuentes.length).toBeGreaterThan(100);
    expect(fuentes).toContain('src/dominio/modelos/bom-modelo.ts');
    // Y que la SEGUNDA raíz entró de verdad: si `migracion/` no se recorriera, el punto ciego
    // que esta ronda vino a cerrar volvería sin que nada se pusiera rojo.
    expect(fuentes.some((f) => f.startsWith('migracion/'))).toBe(true);
  });

  it('⭐ todo archivo que ESCRIBE la receta pasa por `tocarModeloPorCambioDeReceta`', () => {
    const sinEmbudo: string[] = [];
    for (const relativa of fuentes) {
      const codigo = readFileSync(path.join(RAIZ_BACKEND, relativa), 'utf8');
      if (!ESCRIBE_RECETA.test(codigo)) continue;
      if (relativa in EXCEPCIONES) continue;
      if (!codigo.includes('tocarModeloPorCambioDeReceta')) sinEmbudo.push(relativa);
    }

    expect(
      sinEmbudo,
      'Estos archivos cambian la receta de un modelo y NO pasan por el embudo ' +
        '`tocarModeloPorCambioDeReceta` (§Post-F9.116): una versión aprobada podría cambiar sin ' +
        'perder su firma, y la OP saldría sobre una receta que nadie revisó. Mándalos por el ' +
        'embudo, o declara la excepción con su razón en EXCEPCIONES.',
    ).toEqual([]);
  });

  it('⭐ cada puerta sigue AMARRADA al embudo, con el cambio que le toca', () => {
    // El guardián de arriba mira si el archivo CONOCE el embudo; éste mira si sigue LLAMÁNDOLO
    // tantas veces como puertas tiene, y con qué motivo. Es tosco a propósito: se pone rojo cuando
    // alguien agrega, quita o re-etiqueta una puerta — que es justo cuando un humano debe mirar el
    // diff. Sin él, borrar una sola llamada (por ejemplo la de las telas) no rompía nada aquí y el
    // agujero volvía sólo por esa puerta, que es la forma más cara de todas: parece resuelto.
    const esperado: Record<string, string[]> = {
      // 3 puertas: el PUT de telas, el de avíos y el copiado de receta completa.
      'src/dominio/modelos/bom-modelo.ts': ['avios', 'copia-de-otro-modelo', 'telas'],
      // 7 puertas: alta, edición, borrado, marcar principal, copiar de otro modelo, y las dos de
      // las FOTOS del arte (la imagen ES el arte que el bordador va a hacer).
      'src/dominio/modelos/arte-modelo.ts': Array.from({ length: 7 }, () => 'arte'),
      'src/dominio/modelos/avios-favoritos.ts': ['avios'],
      'src/dominio/modelos/medidas-avio-talla.ts': ['medidas-por-talla'],
    };

    for (const [relativa, cambios] of Object.entries(esperado)) {
      const codigo = readFileSync(path.join(RAIZ_BACKEND, relativa), 'utf8');
      const encontrados = [
        ...codigo.matchAll(/tocarModeloPorCambioDeReceta\([^)]*?'([a-z-]+)'\s*\)/g),
      ].map((m) => m[1] as string);
      expect(encontrados.toSorted(), `las puertas de ${relativa}`).toEqual(cambios.toSorted());
    }
  });

  it('los CINCO ARCHIVOS que escriben receta hoy siguen siendo los que se esperan', () => {
    // Si una desaparece de esta lista, o es que se movió de archivo (y hay que revisarla de nuevo)
    // o es que dejó de escribir la receta. Las dos cosas piden mirar el diff.
    const conEscritura = fuentes.filter((relativa) =>
      ESCRIBE_RECETA.test(readFileSync(path.join(RAIZ_BACKEND, relativa), 'utf8')),
    );
    expect(conEscritura.toSorted()).toEqual([
      'migracion/loaders/fotos-modelos.ts',
      'src/dominio/modelos/arte-modelo.ts',
      'src/dominio/modelos/avios-favoritos.ts',
      'src/dominio/modelos/bom-modelo.ts',
      'src/dominio/modelos/medidas-avio-talla.ts',
      'src/dominio/modelos/versiones.ts',
    ]);
  });
});
