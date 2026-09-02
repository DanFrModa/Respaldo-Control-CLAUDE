/**
 * ⭐ V1-E9b — **EL GUARDIÁN DE LAS LECTURAS DE RECETA** (§Post-F9.167 punto 1).
 *
 * Es el gemelo de `receta-embudo.test.ts`, que hace lo mismo para las ESCRITURAS. Existe porque el
 * error que aquél ya había arreglado **se repitió idéntico en la otra dirección**: el conteo de
 * sitios del plan buscó `.modeloTela.findMany` y hermanos, y por eso **no vio una clase entera de
 * lectores** — los que traen la receta por `include` anidado (`telas`, `avios`, `avios.tallas`,
 * `artes`) **sin nombrar jamás la tabla**.
 *
 * 🔴 **Lo que se habría entregado sin esto:** el precosto de un modelo hijo con la RECETA VACÍA
 * —sólo maquila, corte y el empaque— *sin lanzar y sin verse raro*, y de ese número sale el precio
 * que se cotiza en la cara del cliente.
 *
 * Esta prueba **lee el código fuente** y exige que todo archivo de producción del backend que LEA
 * una tabla de la receta —directo o por relación— importe el resolver
 * (`receta-compartida.ts`). Si alguien abre una lectura nueva y se olvida de preguntar de quién es
 * la receta, esto se pone rojo antes de que un hijo salga vacío en producción.
 *
 * ⚠️ **Lo que SÍ y NO garantiza.** Igual que el guardián del embudo: trabaja por ARCHIVO, no por
 * función. Garantiza que ningún archivo lea la receta sin conocer el resolver, y obliga a que toda
 * excepción sea **DECLARADA aquí abajo con su razón** en vez de colarse callada. NO garantiza que
 * dentro de un archivo que ya lo importa, una lectura nueva lo llame — eso lo cubren las pruebas de
 * conducta (`receta-compartida.int.test.ts`). Es una red, no un teorema.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** La raíz del BACKEND (no de `src/`): el barrido tiene que alcanzar también `migracion/`. */
const RAIZ_BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Las dos raíces de código del backend que pueden leer la receta. */
const RAICES = ['src', 'migracion'];

/** Las tablas que SON la receta de un modelo (las mismas cinco del embudo). */
const TABLAS_DE_RECETA = [
  'modeloTela',
  'modeloAvio',
  'modeloAvioTalla',
  'modeloArte',
  'modeloArteFoto',
];

/** Los métodos de Prisma que LEEN (los de escritura los vigila `receta-embudo.test.ts`). */
const LECTURAS = [
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
];

/**
 * Los nombres de RELACIÓN por los que se llega a la receta desde el modelo. `avios` arrastra sus
 * `tallas` (= `ModeloAvioTalla`, las medidas por talla R18) dentro de la misma fila, así que
 * vigilar `avios` las cubre sin nombrarlas.
 */
const RELACIONES_DE_RECETA = ['telas', 'avios', 'artes'];

/** Las palabras con las que Prisma abre los argumentos de una relación anidada. */
const ARGUMENTOS_PRISMA = ['where', 'select', 'include', 'orderBy', 'take', 'skip', 'cursor'];

/** La lectura DIRECTA: `tx.modeloTela.findMany(...)`. */
const LEE_DIRECTO = new RegExp(
  `\\.(?:${TABLAS_DE_RECETA.join('|')})\\.(?:${LECTURAS.join('|')})\\s*\\(`,
);

/**
 * La lectura ANIDADA: `telas: { where: … }` colgando del modelo. Se pide un argumento de Prisma
 * justo después para no confundirla con una DECLARACIÓN de tipo (`telas: { idTela: number }[]`),
 * que abunda en los mismos archivos.
 */
const LEE_ANIDADO = new RegExp(
  `\\b(?:${RELACIONES_DE_RECETA.join('|')})\\s*:\\s*\\{\\s*(?:${ARGUMENTOS_PRISMA.join('|')})\\s*:`,
);

const LEE_RECETA = (codigo: string): boolean =>
  LEE_DIRECTO.test(codigo) || LEE_ANIDADO.test(codigo);

/** ¿El archivo IMPORTA el resolver de la receta compartida? */
const CONOCE_EL_RESOLVER = /from '(?:\.{1,2}\/)+(?:modelos\/)?receta-compartida\.js'/;

/**
 * Los archivos a los que el resolver NO les aplica, cada uno con su razón. Añadir uno aquí es una
 * DECISIÓN que se lee en el diff — que es justamente lo que se quiere: nadie desactiva la regla sin
 * decir por qué.
 */
const EXCEPCIONES: Record<string, string> = {
  // ⭐⭐ V1-E9b pieza B — LA EXCEPCIÓN DE `versiones.ts` SE BORRÓ, y merece quedar dicho aquí
  // porque el hueco era doble y muy caro:
  //
  // Su razón era un ARGUMENTO EN PROSA: «un hijo no se puede versionar (rebota en la guarda de
  // `codigoDesarrollo`), así que `copiarRecetaAModeloNuevo` nunca lee la receta de un hijo». La
  // premisa era cierta y **la conclusión no se seguía**: `desarrollo/modelo-en-la-mesa.ts` llama a
  // `copiarRecetaAModeloNuevo` DIRECTO, sin pasar por `crearVersionDeModelo`, con el id que el
  // usuario eligió en el selector de la cita — y ahí copiar un hijo daba un modelo nuevo con la
  // receta VACÍA, del que sale el precio que se le dice al cliente en la cara. La excepción razonaba
  // sobre UNA de las dos puertas y concluía sobre la FUNCIÓN: la rama gemela, dentro del guardián
  // que existe para cazar ramas gemelas.
  //
  // ⇒ Hoy `copiarRecetaAModeloNuevo` RESUELVE el origen por dentro, `versiones.ts` importa el
  // resolver como cualquier otro lector, y **ya no hay ninguna prosa que verificar**. Es la lección
  // de la etapa: una excepción declarada vale lo que vale su argumento, y un argumento no lo
  // ejecuta nadie.
  'migracion/cuadre-fase.ts':
    'Cuadre del ETL: son `.count()` GLOBALES sin `where` — cuenta las filas de la tabla entera, ' +
    'no la receta de un modelo. No hay nada que resolver.',
  'migracion/loaders/bom-modelos.ts':
    'Cargador del ETL: carga el BOM de los ~4,987 modelos MIGRADOS del Access, que llevan ' +
    '`idModeloDesarrollo = NULL` (REGLA 0-B: sin backfill, a propósito) ⇒ el resolver es la ' +
    'identidad. Queda DECLARADO aquí y no fuera del barrido: si el ETL algún día cargara sobre un ' +
    'hijo del linaje 1:N, ésta es la línea donde hay que discutirlo.',
  'migracion/loaders/fotos-modelos.ts':
    'Cargador del ETL de fotos del arte, sobre los mismos modelos migrados (`idModeloDesarrollo = ' +
    'NULL`) ⇒ resolver = identidad. Misma razón que `bom-modelos.ts`.',
  // ⭐ §Post-F9.177 — y su argumento NO se queda en prosa: lo EJECUTA la prueba de más abajo
  // («las fotos del arte por OP…»), que es la lección que dejó `versiones.ts`.
  'src/dominio/produccion/fotos-arte-orden.ts':
    'Las fotos del arte POR OP nunca parten de un modelo: la pertenencia se comprueba contra ' +
    '`OrdenArte.idModeloArte`, la traza que la receta CONGELÓ, y ésa ya viene resuelta por linaje ' +
    '(sus CUATRO escritores —copiar la receta al crear la orden, agregar un renglón, «traer del ' +
    'modelo» y RESTAURAR un renglón— la sacan de `leerArtesModelo`, que resuelve por dentro). ' +
    'Volver a ' +
    'resolver aquí no sería una red: sería CONTRADECIR el dato congelado — si el linaje del modelo ' +
    'cambiara después, la traza seguiría señalando el arte que la OP enseña y un guard re-resuelto ' +
    'daría 404 sobre esa misma foto, que es justo el defecto que la prenda tuvo que esquivar.',
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

describe('El guardián de las lecturas de receta (V1-E9b)', () => {
  const fuentes = RAICES.flatMap((raiz) => fuentesDeProduccion(path.join(RAIZ_BACKEND, raiz)));
  const codigo = new Map(
    fuentes.map((f) => [f, readFileSync(path.join(RAIZ_BACKEND, f), 'utf8')] as const),
  );
  const lectores = fuentes.filter((f) => LEE_RECETA(codigo.get(f) ?? ''));

  it('la prueba está mirando el código de verdad (si no, no vigila nada)', () => {
    // Defensa contra el fallo silencioso: si la ruta se rompiera, la lista quedaría vacía y todas
    // las aserciones de abajo pasarían por no tener nada que revisar.
    expect(fuentes.length).toBeGreaterThan(100);
    expect(fuentes).toContain('src/dominio/modelos/bom-modelo.ts');
    expect(fuentes.some((f) => f.startsWith('migracion/'))).toBe(true);
  });

  it('detecta la lectura DIRECTA (`tx.modeloTela.findMany(…)`)', () => {
    expect(lectores).toContain('src/dominio/modelos/bom-modelo.ts');
    expect(lectores).toContain('src/dominio/produccion/receta-orden.ts');
    // Y no confunde una ESCRITURA con una lectura: el embudo vigila esas.
    expect(LEE_DIRECTO.test('await tx.modeloTela.createMany({ data })')).toBe(false);
  });

  it('🔴 detecta la lectura ANIDADA por `include` — la clase que el plan no vio', () => {
    // `costos/pre-costo.ts` NO nombra ni una vez `modeloTela`/`modeloAvio`/`modeloArte`: su receta
    // entra entera por `include: incluirReceta`. Que aparezca aquí ES la prueba de que la
    // detección anidada funciona; si dejara de aparecer, el guardián estaría ciego justo donde el
    // defecto silencioso vive.
    expect(codigo.get('src/dominio/costos/pre-costo.ts')).not.toMatch(LEE_DIRECTO);
    expect(lectores).toContain('src/dominio/costos/pre-costo.ts');
    expect(lectores).toContain('src/dominio/desarrollo/precostos.ts');
  });

  it('no confunde una DECLARACIÓN DE TIPO con una consulta', () => {
    // Los mismos archivos declaran `telas: { idTela: number; … }[]`. Si eso contara, el guardián
    // marcaría medio backend y acabaría desactivado a fuerza de excepciones.
    expect(LEE_ANIDADO.test('  telas: { idTela: number; consumo: number }[];')).toBe(false);
    expect(LEE_ANIDADO.test("  artes: { flexDirection: 'row', gap: 8 },")).toBe(false);
    expect(LEE_ANIDADO.test('    telas: { where: { paraPreCosto: true },')).toBe(true);
    expect(LEE_ANIDADO.test('    avios: { select: { idAvio: true } },')).toBe(true);
  });

  it('TODO archivo que lee la receta conoce el resolver (o está DECLARADO como excepción)', () => {
    const olvidados = lectores.filter(
      (f) => !(f in EXCEPCIONES) && !CONOCE_EL_RESOLVER.test(codigo.get(f) ?? ''),
    );
    expect(olvidados).toEqual([]);
  });

  it('⭐⭐ `versiones.ts` YA NO es excepción: conoce el resolver de verdad', () => {
    // El candado del arreglo de esta pieza. Su excepción se justificaba con un argumento en PROSA
    // («un hijo no se puede versionar») que era cierto y NO cerraba la puerta: la segunda entrada,
    // `desarrollo/modelo-en-la-mesa.ts`, llama a `copiarRecetaAModeloNuevo` directo, y por ahí
    // copiar un hijo daba un modelo nuevo con la receta VACÍA. Si alguien vuelve a añadirla a
    // EXCEPCIONES —o le quita el resolver— esto se pone rojo antes que nada.
    expect(Object.keys(EXCEPCIONES)).not.toContain('src/dominio/modelos/versiones.ts');
    expect(lectores).toContain('src/dominio/modelos/versiones.ts');
    expect(codigo.get('src/dominio/modelos/versiones.ts') ?? '').toMatch(CONOCE_EL_RESOLVER);
  });

  it('las excepciones declaradas SIGUEN EXISTIENDO y siguen leyendo la receta', () => {
    // Una excepción que ya no aplica es peor que ninguna: parece que alguien lo pensó cuando en
    // realidad protege a un archivo que ya no está o que ya dejó de leer la receta.
    for (const archivo of Object.keys(EXCEPCIONES)) {
      expect(fuentes, `la excepción "${archivo}" ya no existe: bórrala`).toContain(archivo);
      expect(lectores, `"${archivo}" ya no lee la receta: bórralo de las excepciones`).toContain(
        archivo,
      );
    }
  });

  it('⭐⭐ NADIE lee `ModeloAvioTalla` directo fuera de los archivos que pueden', () => {
    // 🔴 LA LECCIÓN DE LA REVISIÓN DE ESTA ETAPA. De las cinco tablas de la receta,
    // `ModeloAvioTalla` es la ÚNICA que no tenía lectura canónica: las otras cuatro viven bajo el
    // paraguas del embudo, y su resolución no puede perderse porque no está en el llamador. La de
    // las medidas SÍ estaba en el llamador, repetida en CUATRO sitios de `receta-orden.ts`, y sólo
    // uno tenía prueba. El reviewer revirtió uno a mano y **la suite entera siguió verde** — la
    // regla de arriba tampoco lo veía, porque trabaja por ARCHIVO y ése ya importaba el resolver.
    //
    // Esta regla es la que cierra ese hueco: `leerMedidasAvioBom` es la CUARTA canónica, y aquí se
    // exige que nadie más lea la tabla directo. Ya no es «acuérdate de resolver»: es «no puedes
    // escribir la consulta».
    const LEE_MEDIDAS = /\.modeloAvioTalla\.(?:findMany|findFirst|findUnique|count|aggregate)\s*\(/;
    /** Los únicos que pueden, cada uno con su razón. */
    const PUEDEN: Record<string, string> = {
      'src/dominio/modelos/bom-modelo.ts':
        'ALOJA la canónica `leerMedidasAvioBom`. Y `copiarBom`, que desde la pieza B lee sus ' +
        'medidas de `idRecetaOrigen` (el origen RESUELTO), no del id crudo.',
      'src/dominio/modelos/medidas-avio-talla.ts':
        'Es el módulo DUEÑO de la tabla: la captura por talla se lee y se escribe aquí.',
      'src/dominio/modelos/versiones.ts':
        '`copiarRecetaAModeloNuevo` copia las medidas a un modelo RECIÉN NACIDO, y desde la pieza ' +
        'B las lee del origen RESUELTO (`resolverIdRecetaDeModelo`), igual que la canónica. Ya no ' +
        'es una excepción del guardián de arriba: importa el resolver y lo llama.',
    };
    const leenMedidas = fuentes.filter((f) => LEE_MEDIDAS.test(codigo.get(f) ?? ''));
    expect(leenMedidas.filter((f) => !(f in PUEDEN))).toEqual([]);
    // Y la contraparte: `receta-orden.ts` —los cuatro sitios del incidente— ya NO la lee.
    expect(leenMedidas).not.toContain('src/dominio/produccion/receta-orden.ts');
    // La canónica existe y resuelve por dentro (si dejara de hacerlo, la regla sería un adorno).
    const bom = codigo.get('src/dominio/modelos/bom-modelo.ts') ?? '';
    expect(bom).toMatch(/export async function leerMedidasAvioBom\b/);
    expect(bom.slice(bom.indexOf('export async function leerMedidasAvioBom'))).toMatch(
      /resolverIdRecetaDeModelo\(tx, idModelo\)/,
    );
  });

  it('⭐ §Post-F9.177 — las fotos del arte por OP: la excepción, EJECUTADA (no en prosa)', () => {
    // La lección de `versiones.ts` vive arriba: una excepción vale lo que vale su argumento, y un
    // argumento en prosa no lo ejecuta nadie. Éstas son las tres patas de aquél, comprobadas.
    const archivo = 'src/dominio/produccion/fotos-arte-orden.ts';
    const fuente = codigo.get(archivo) ?? '';
    // La excepción sigue haciendo falta (si dejara de leer la receta, hay que borrarla).
    expect(lectores).toContain(archivo);

    // 1️⃣ NO HAY POR DÓNDE RESOLVER: el archivo no nombra ni una vez un id de MODELO.
    //    ⚠️ El ancla `(?![A-Za-z])` es lo que hace que la regla se pueda escribir: `idModeloArte` y
    //    `idModeloArteFoto` —que el archivo usa a cada línea— llevan `idModelo` como SUBCADENA, así
    //    que sin ella esto estaría rojo SIEMPRE y acabaría borrado o aflojado. Con ella dice
    //    exactamente lo que quiere decir: aquí no entra un id de MODELO.
    expect(fuente).not.toMatch(/\bidModelo(?![A-Za-z])/);
    //    Y su única tabla de receta es `ModeloArteFoto`, filtrada SIEMPRE por la traza.
    expect(fuente).toMatch(
      /where: \{ id: idModeloArteFoto, idModeloArte: renglon\.idModeloArte \}/,
    );
    expect(fuente).toMatch(/where: \{ idModeloArte: \{ in: idsArte \} \}/);
    //    (`.modeloArte.` con punto NO casa `.modeloArteFoto.`: la otra subcadena, también anclada.)
    expect(fuente).not.toMatch(/\.(?:modeloTela|modeloAvio|modeloAvioTalla|modeloArte)\./);

    // 2️⃣ LA TRAZA QUE SE COMPRUEBA VIENE RESUELTA: la canónica que la alimenta resuelve por dentro
    //    (mismo candado que `leerMedidasAvioBom` más abajo).
    const arteModelo = codigo.get('src/dominio/modelos/arte-modelo.ts') ?? '';
    const desde = arteModelo.indexOf('export async function leerArtesModelo');
    expect(desde).toBeGreaterThan(-1);
    // ⚠️ La ventana se CIERRA en el siguiente bloque de documentación (= la siguiente función). Sin
    // cerrarla, el `slice` arrastraría el resto del archivo —donde otras funciones también llaman al
    // resolver— y la aserción pasaría con `leerArtesModelo` ya sin resolver: verde con el defecto
    // dentro, que es exactamente lo que esta prueba existe para impedir.
    const cuerpo = arteModelo.slice(desde, arteModelo.indexOf('\n/**', desde));
    expect(cuerpo).toMatch(/resolverIdRecetaDeModelo\(tx, idModelo\)/);
    expect(cuerpo.length).toBeLessThan(1500);

    // 3️⃣ Y NADIE MÁS ESCRIBE `OrdenArte`: si alguien abre un escritor nuevo, aterriza AQUÍ y tiene
    //    que decir de dónde saca la traza — que es lo único que sostiene los puntos 1 y 2.
    const ESCRIBE_ORDEN_ARTE = /\.ordenArte\.(?:create|createMany|update|updateMany|upsert)\s*\(/;
    const PUEDEN_ESCRIBIR: Record<string, string> = {
      'src/dominio/produccion/receta-orden.ts':
        'Los CUATRO sitios que escriben la traza —copiar la receta al crear la orden, agregar un ' +
        'renglón, «traer del modelo» y RESTAURAR un renglón— sacan el id de `leerArtesModelo`, que ' +
        'resuelve el linaje. (Eran «tres» en la primera cuenta: `restaurarRenglonReceta` faltaba. ' +
        'La conclusión no cambia —también lee por la canónica— pero la enumeración sí, y es la que ' +
        'sostiene esta excepción.)',
      'src/dominio/produccion/migracion.ts':
        'Sólo firma renglones ya existentes por `idOrden` (`liberadoEn`): no toca la traza.',
    };
    const escritores = fuentes.filter((f) => ESCRIBE_ORDEN_ARTE.test(codigo.get(f) ?? ''));
    expect(escritores.filter((f) => !(f in PUEDEN_ESCRIBIR))).toEqual([]);
    expect(escritores).toEqual(expect.arrayContaining(Object.keys(PUEDEN_ESCRIBIR)));
    // El de la receta importa la canónica…
    const receta = codigo.get('src/dominio/produccion/receta-orden.ts') ?? '';
    expect(receta).toMatch(/import \{ leerArtesModelo \} from '\.\.\/modelos\/arte-modelo\.js';/);
    // …y los CUATRO escritores que la razón enumera siguen existiendo con ese nombre. La cuenta
    // empezó siendo «tres» (faltaba `restaurarRenglonReceta`) y es la que sostiene la excepción: si
    // alguien renombra o borra uno, aterriza aquí en vez de dejar la razón hablando de fantasmas.
    for (const escritor of [
      'copiarRecetaDelModelo',
      'agregarRenglonReceta',
      'traerDelModelo',
      'restaurarRenglonReceta',
    ]) {
      expect(receta, `el escritor "${escritor}" ya no existe: corrige la razón`).toMatch(
        new RegExp(`function ${escritor}\\b`),
      );
    }
    // …y el del ETL, tal como dice su razón, ni menciona la traza.
    expect(codigo.get('src/dominio/produccion/migracion.ts') ?? '').not.toMatch(/idModeloArte/);
  });

  it('🔴 quien trae la receta por `include` TIENE que injertarla, no sólo importar el resolver', () => {
    // La regla de arriba se conforma con que el archivo importe algo del resolver. Para la forma 3
    // eso no basta: importar `resolverIdRecetaDeModelo` y seguir usando el `include` tal cual
    // dejaría el precosto vacío igual. Aquí se exige la función que de verdad lo arregla.
    const conInclude = lectores.filter((f) => LEE_ANIDADO.test(codigo.get(f) ?? ''));
    expect(conInclude).toEqual([
      'src/dominio/costos/pre-costo.ts',
      'src/dominio/desarrollo/precostos.ts',
    ]);
    for (const archivo of conInclude) {
      expect(codigo.get(archivo), `${archivo} usa un \`include\` de receta sin injertarla`).toMatch(
        /conRecetaCompartida(DeUno)?\(/,
      );
    }
  });
});
