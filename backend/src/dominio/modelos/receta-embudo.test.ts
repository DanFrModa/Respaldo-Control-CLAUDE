/**
 * ⭐ V1-E7e — EL GUARDIÁN DEL EMBUDO (§Post-F9.116).
 *
 * Daniel fue explícito en que esto es TODO o nada: *"cubrir sólo una parte sería PEOR que no
 * cubrir nada: parecería resuelto sin estarlo"*. Las pruebas de conducta demuestran que las cinco
 * puertas de HOY tumban la firma; lo que ninguna de ellas puede demostrar es que la puerta de
 * MAÑANA lo haga.
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
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const RAIZ_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Las tablas que SON la receta de un modelo (§Post-F9.116: telas, avíos, medidas y arte). */
const TABLAS_DE_RECETA = ['modeloTela', 'modeloAvio', 'modeloAvioTalla', 'modeloArte', 'modeloArteFoto'];

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

const ESCRIBE_RECETA = new RegExp(
  `\\.(?:${TABLAS_DE_RECETA.join('|')})\\.(?:${ESCRITURAS.join('|')})\\s*\\(`,
);

/**
 * Los archivos a los que el embudo NO les aplica, cada uno con su razón. Añadir uno aquí es una
 * DECISIÓN que se lee en el diff — que es justamente lo que se quiere: nadie desactiva la regla
 * sin decir por qué.
 */
const EXCEPCIONES: Record<string, string> = {
  'dominio/modelos/versiones.ts':
    'Copia la receta a un modelo RECIÉN NACIDO, dentro de la transacción que lo crea: su revisión ' +
    'nace en `pendiente` y no hay firma que tumbar. Llamar al embudo aquí marcaría como ' +
    '"invalidada" a una versión que nunca se firmó.',
};

/** Carpetas que no son código de negocio (generado por Prisma, ayudas de prueba). */
const CARPETAS_FUERA = ['datos/generated', 'pruebas'];

/** Todos los `.ts` de producción del backend (sin generados, sin pruebas). */
function fuentesDeProduccion(carpeta: string, acumulado: string[] = []): string[] {
  for (const entrada of readdirSync(carpeta)) {
    const completa = path.join(carpeta, entrada);
    const relativa = path.relative(RAIZ_SRC, completa).replaceAll(path.sep, '/');
    if (CARPETAS_FUERA.some((fuera) => relativa === fuera || relativa.startsWith(`${fuera}/`))) {
      continue;
    }
    if (statSync(completa).isDirectory()) {
      fuentesDeProduccion(completa, acumulado);
    } else if (entrada.endsWith('.ts') && !entrada.endsWith('.test.ts')) {
      acumulado.push(relativa);
    }
  }
  return acumulado;
}

describe('El embudo de mutación de receta (V1-E7e)', () => {
  const fuentes = fuentesDeProduccion(RAIZ_SRC);

  it('la prueba está mirando el código de verdad (si no, no vigila nada)', () => {
    // Defensa contra el fallo silencioso: si la ruta se rompiera, la lista quedaría vacía y todas
    // las aserciones de abajo pasarían por no tener nada que revisar.
    expect(fuentes.length).toBeGreaterThan(100);
    expect(fuentes).toContain('dominio/modelos/bom-modelo.ts');
  });

  it('⭐ todo archivo que ESCRIBE la receta pasa por `tocarModeloPorCambioDeReceta`', () => {
    const sinEmbudo: string[] = [];
    for (const relativa of fuentes) {
      const codigo = readFileSync(path.join(RAIZ_SRC, relativa), 'utf8');
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

  it('las CINCO puertas de hoy siguen siendo las que se esperan (ni una menos)', () => {
    // Si una desaparece de esta lista, o es que se movió de archivo (y hay que revisarla de nuevo)
    // o es que dejó de escribir la receta. Las dos cosas piden mirar el diff.
    const conEscritura = fuentes.filter((relativa) =>
      ESCRIBE_RECETA.test(readFileSync(path.join(RAIZ_SRC, relativa), 'utf8')),
    );
    expect(conEscritura.toSorted()).toEqual([
      'dominio/modelos/arte-modelo.ts',
      'dominio/modelos/avios-favoritos.ts',
      'dominio/modelos/bom-modelo.ts',
      'dominio/modelos/medidas-avio-talla.ts',
      'dominio/modelos/versiones.ts',
    ]);
  });
});
