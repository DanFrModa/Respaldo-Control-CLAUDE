/**
 * 🔒 GUARDIÁN DE LA BITÁCORA para el dinero del MODELO y de la ORDEN (fila 0.249 parte C).
 *
 * La bitácora guarda EN CLARO precios del modelo y de la orden (antes/después de la maquila y el
 * corte base, el precio del arte, el precio congelado de los renglones de la receta, la maquila real
 * capturada y la meta de costo de la revisión), y hoy la leen roles que NO pueden ver esos precios
 * en su pantalla. Taparlos ahí es la **PARTE D de la 0.249, pendiente de decisión de Daniel**: aquí
 * NO se arregla, se CONGELA el estado conocido con dos excepciones declaradas, para que nada nuevo
 * entre a escondidas. Son dos guardianes INDEPENDIENTES; ninguno cubre los huecos del otro:
 *
 *  1. **Por CAMPO** — un escáner del CÓDIGO (con el AST de TypeScript) recorre cada llamada a
 *     `registrarBitacora(` / `bitacoraReceta(` de los archivos en alcance y junta las CLAVES con
 *     nombre de dinero (`precio`, `maquila`, `corte`, `costo`) de lo que les llega. Sigue:
 *      • objetos en línea, sus `...spread` y sus valores anidados;
 *      • IDENTIFICADORES del mismo archivo: sus declaraciones (`const|let X = {…}`), sus
 *        reasignaciones (`X = {…}`) y sus asignaciones de miembro (`X.clave =`, `X['clave'] =`);
 *      • los DOS lados de `??`, `||` y `&&`, las dos ramas de un ternario, y lo que hay dentro de
 *        paréntesis, `await`, `as`, `<T>`, `satisfies` y `!`;
 *      • llamadas a funciones LOCALES del mismo archivo (sus `return`, o el cuerpo de una flecha):
 *        `function` declaradas, flechas y function expressions guardadas en una variable, y la
 *        función invocada en el acto (`(() => ({…}))()`); si hay VARIAS con el mismo nombre (una
 *        anidada en otra función), se miran TODAS; también los callbacks de `.map(…)`;
 *      • además, el `return` de las funciones que arman las fotos de la bitácora (`foto*`,
 *        `*ParaBitacora`), aunque las llame otro archivo.
 *     Lo encontrado tiene que ser EXACTAMENTE la lista declarada: un precio nuevo ESCRITO EN LAS
 *     FORMAS CUBIERTAS (arriba) la pone roja, y
 *     una entrada de la lista que ya no exista también (la excepción no puede quedarse vieja).
 *  2. **Por ROL** — la misma mecánica que la parte B (`precios-de-catalogo.test.ts`): todo rol
 *     sembrado que lee la bitácora tiene que poder ver esos precios… SALVO los declarados. Un rol
 *     NUEVO con `admin.ver-bitacora` y sin llave de precio la pone roja. ⚠️ Mira QUIÉN lee, no QUÉ
 *     se guarda: NO caza un campo nuevo que el escáner no vea.
 *
 * ⚠️ **LÍMITES DEL ESCÁNER (lo que NO ve), cada uno con su razón.** ⚠️ **Esta lista NO es
 * exhaustiva**: el guardián caza las formas COMUNES de escribir una bitácora, no cualquier forma
 * posible de TypeScript. No garantiza que la bitácora no guarde un precio; sólo hace ruidoso el caso
 * habitual. La garantía de raíz llega con la **parte D** de la 0.249: tapar los precios al LEER la
 * bitácora según las llaves de quien la consulta, sin depender de cómo se escribió.
 *  • **Claves con nombre genérico**: el filtro es por NOMBRE. Un monto guardado como `anterior` /
 *    `nuevo` (la maquila real de `precios-orden.ts`) o como `de` / `a` dentro de una clave que no
 *    suena a dinero, no se ve. Esa entrada se declara a mano en la lista, con su nota.
 *  • **Objetos que llegan de OTRO lado** (una función importada que no se llame `foto*` /
 *    `*ParaBitacora`, un parámetro, una desestructuración): el AST es de un archivo a la vez y no
 *    sigue tipos; resolverlos exigiría el programa entero de TypeScript.
 *  • **Filas de la base o resultados de métodos** (`...await tx.x.findUnique()`, `algo.metodo()`):
 *    sus claves son las columnas del modelo de Prisma y no están escritas en el código.
 *  • **Claves calculadas** (`[variable]: v`, `X[variable] =`, `Object.assign(X, …)`): no tienen
 *    nombre en el código.
 *  • **Archivos fuera de alcance**: sólo `dominio/modelos/*` y los dos de la orden con dinero
 *    (`receta-orden.ts`, `precios-orden.ts`). Otras escrituras a la bitácora de un Modelo o una Orden
 *    desde otros módulos (p. ej. `compras/proveedor-de-orden.ts`, el precio de COMPRA) no se miran.
 *  • **Sombra de nombres**: un nombre se resuelve por NOMBRE en todo el archivo, no por ámbito, y
 *    se UNEN todas sus declaraciones indexadas (variables, reasignaciones, `function`, flechas):
 *    dos homónimos en ámbitos distintos suman sus claves. Entre lo INDEXADO eso sólo puede dar un
 *    falso rojo; lo que no se indexa (un parámetro, una desestructuración `const { a } = …`) cae en
 *    el límite de «objetos que llegan de otro lado».
 *  • **Texto armado** (un template `` `precio: ${p}` `` o un `JSON.stringify(…)` guardado como
 *    cadena): la cifra viaja dentro de un STRING bajo una clave cualquiera; es el mismo límite que
 *    el de las claves con nombre genérico.
 *  • **Llamadas indirectas** (`fn.call(…)`, `fn.bind(…)()`, una función guardada en un objeto
 *    `o.armar()` o pasada como parámetro): no se resuelven a la función local.
 *  • **Getters y métodos dentro del objeto** (`{ get precioEtiqueta() { return 3; } }`,
 *    `{ precio() {…} }`): el escáner sólo lee propiedades con valor (`clave: valor`, abreviadas y
 *    `...spread`). Un getter SÍ lo serializa `JSON.stringify`, así que el precio llega.
 *  • **Alias o reasignación de la bitácora** (`const rb = registrarBitacora; await rb(…)`, o pasarla
 *    como parámetro): el escáner reconoce las llamadas por su NOMBRE (`registrarBitacora(` /
 *    `bitacoraReceta(`); con otro nombre, la llamada no se mira.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { definirRoles, PERFILES_EDITABLES } from '../../../prisma/seed.js';
import type { ClavePermiso } from '../../contrato/index.js';
import { tienePermiso } from '../../comun/permisos.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  puedeVerMaquilaDeReferencia,
  puedeVerPreciosDeModelo,
  puedeVerPreciosDeOrden,
} from './precios-de-modelo.js';

/**
 * 🔴 PARTE D DE LA 0.249, PENDIENTE DE DECISIÓN — los campos de dinero que la bitácora guarda HOY en
 * claro (archivo relativo a `src/dominio/` → claves). Quitarlos de aquí exige taparlos en la
 * bitácora; agregar uno exige decidirlo con Daniel.
 */
const CAMPOS_DECLARADOS: Readonly<Record<string, readonly string[]>> = {
  // maquilaBase / corteBase { de, a } al editar el modelo.
  'modelos/modelos.ts': ['corteBase', 'maquilaBase'],
  // El precio del arte { de, a } al editarlo, y el arte ÍNTEGRO al quitarlo o copiar encima.
  'modelos/arte-modelo.ts': ['precio'],
  // La meta de costo de la revisión (lo prometido y lo conseguido, y sus anteriores).
  'modelos/revision-modelo.ts': [
    'metaCostoConseguido',
    'metaCostoConseguidoAnterior',
    'metaCostoPrometido',
    'metaCostoPrometidoAnterior',
  ],
  // El precio CONGELADO de los renglones de la receta (fotos íntegras al editar/quitar/restaurar).
  'produccion/receta-orden.ts': ['precio'],
  // `precio` aquí NOMBRA el campo (maquila/aplicación); los MONTOS van en `anterior`/`nuevo`, que el
  // escáner no reconoce por nombre: quedan declarados por esta misma entrada.
  'produccion/precios-orden.ts': ['precio'],
};

/** Claves con nombre de dinero que NO son dinero (banderas de la receta). */
const NO_ES_DINERO = new Set(['paraCosto', 'paraPreCosto']);
const PARECE_DINERO = /precio|maquila|corte|costo/i;

const RAIZ = fileURLToPath(new URL('../', import.meta.url));

/** Los archivos que se escanean: todo el dominio de modelos y los dos de la orden con dinero. */
function archivosEnAlcance(): string[] {
  const modelos = readdirSync(`${RAIZ}modelos`)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => `modelos/${f}`);
  return [...modelos, 'produccion/receta-orden.ts', 'produccion/precios-orden.ts'];
}

/** ¿La clave tiene nombre de DINERO? */
function esDinero(clave: string): boolean {
  return PARECE_DINERO.test(clave) && !NO_ES_DINERO.has(clave);
}

/** Funciones cuyo `return` es una FOTO para la bitácora aunque la llame otro archivo. */
const ARMA_FOTO = /^foto(?:Tela|Avio|Arte)$|ParaBitacora$/;

/** Quita paréntesis, `as`, `<T>`, `satisfies` y `!` alrededor de una expresión. */
function sinEnvoltura(e: ts.Expression): ts.Expression {
  let actual = e;
  while (
    ts.isParenthesizedExpression(actual) ||
    ts.isAsExpression(actual) ||
    ts.isTypeAssertionExpression(actual) ||
    ts.isSatisfiesExpression(actual) ||
    ts.isNonNullExpression(actual)
  ) {
    actual = actual.expression;
  }
  return actual;
}

/**
 * Las claves de dinero que un TEXTO de código manda a la bitácora (ver el encabezado: qué sigue y
 * qué no). Recorre el AST de TypeScript del archivo.
 */
function camposDeDineroEnBitacora(codigo: string, resolverIdentificadores = true): Set<string> {
  const archivo = ts.createSourceFile('escaneado.ts', codigo, ts.ScriptTarget.Latest, true);
  const asignaciones = new Map<string, ts.Expression[]>();
  const miembros = new Map<string, { clave: string; valor: ts.Expression }[]>();
  // ⚠️ B8: una LISTA por nombre. Con un `Map` simple ganaba la última `function` homónima (p. ej.
  // una anidada en otra función) y la que de verdad llegaba a la bitácora quedaba sin mirar.
  const funciones = new Map<string, ts.FunctionLikeDeclaration[]>();
  const llamadas: ts.CallExpression[] = [];
  const agregar = <T>(mapa: Map<string, T[]>, nombre: string, valor: T): void => {
    mapa.set(nombre, [...(mapa.get(nombre) ?? []), valor]);
  };

  // 1) Índice del archivo: declaraciones, reasignaciones, asignaciones de miembro, funciones y
  //    llamadas a la bitácora.
  const indexar = (nodo: ts.Node): void => {
    if (ts.isVariableDeclaration(nodo) && ts.isIdentifier(nodo.name) && nodo.initializer) {
      agregar(asignaciones, nodo.name.text, nodo.initializer);
    }
    if (ts.isFunctionDeclaration(nodo) && nodo.name !== undefined) {
      agregar(funciones, nodo.name.text, nodo);
    }
    // B7: una flecha o una function expression GUARDADA en una variable también es una función
    // local que se puede llamar (`const armar = () => ({…})`).
    if (
      ts.isVariableDeclaration(nodo) &&
      ts.isIdentifier(nodo.name) &&
      nodo.initializer !== undefined &&
      (ts.isArrowFunction(sinEnvoltura(nodo.initializer)) ||
        ts.isFunctionExpression(sinEnvoltura(nodo.initializer)))
    ) {
      agregar(
        funciones,
        nodo.name.text,
        sinEnvoltura(nodo.initializer) as ts.ArrowFunction | ts.FunctionExpression,
      );
    }
    if (ts.isBinaryExpression(nodo) && nodo.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const izq = nodo.left;
      if (ts.isIdentifier(izq)) agregar(asignaciones, izq.text, nodo.right);
      else if (ts.isPropertyAccessExpression(izq) && ts.isIdentifier(izq.expression)) {
        agregar(miembros, izq.expression.text, { clave: izq.name.text, valor: nodo.right });
      } else if (
        ts.isElementAccessExpression(izq) &&
        ts.isIdentifier(izq.expression) &&
        ts.isStringLiteralLike(izq.argumentExpression)
      ) {
        agregar(miembros, izq.expression.text, {
          clave: izq.argumentExpression.text,
          valor: nodo.right,
        });
      }
    }
    if (
      ts.isCallExpression(nodo) &&
      ts.isIdentifier(nodo.expression) &&
      (nodo.expression.text === 'registrarBitacora' || nodo.expression.text === 'bitacoraReceta')
    ) {
      llamadas.push(nodo);
    }
    ts.forEachChild(nodo, indexar);
  };
  indexar(archivo);

  /** Las expresiones que DEVUELVE una función (sin entrar a funciones anidadas). */
  const retornos = (fn: ts.FunctionLikeDeclaration): ts.Expression[] => {
    const salida: ts.Expression[] = [];
    if (fn.body !== undefined && !ts.isBlock(fn.body)) salida.push(fn.body);
    const visitar = (nodo: ts.Node): void => {
      if (ts.isFunctionLike(nodo)) return;
      if (ts.isReturnStatement(nodo) && nodo.expression !== undefined) salida.push(nodo.expression);
      ts.forEachChild(nodo, visitar);
    };
    if (fn.body !== undefined && ts.isBlock(fn.body)) ts.forEachChild(fn.body, visitar);
    return salida;
  };

  // 2) Lo que LLEGA a la bitácora: se sigue cada valor hasta sus claves.
  const campos = new Set<string>();
  const vistos = new Set<ts.Node>();
  const anotar = (clave: string): void => {
    if (esDinero(clave)) campos.add(clave);
  };
  const seguir = (e: ts.Expression): void => {
    if (vistos.has(e)) return;
    vistos.add(e);
    if (
      ts.isParenthesizedExpression(e) ||
      ts.isAsExpression(e) ||
      ts.isTypeAssertionExpression(e) ||
      ts.isNonNullExpression(e) ||
      ts.isSatisfiesExpression(e) ||
      ts.isAwaitExpression(e)
    ) {
      seguir(e.expression);
    } else if (
      // B6: los DOS lados de `??`, `||` y `&&` pueden ser lo que llega (`x ?? { precio… }`).
      ts.isBinaryExpression(e) &&
      (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        e.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
    ) {
      seguir(e.left);
      seguir(e.right);
    } else if (ts.isObjectLiteralExpression(e)) {
      for (const p of e.properties) {
        if (ts.isPropertyAssignment(p)) {
          if (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) anotar(p.name.text);
          seguir(p.initializer);
        } else if (ts.isShorthandPropertyAssignment(p)) {
          anotar(p.name.text);
          seguir(p.name);
        } else if (ts.isSpreadAssignment(p)) {
          seguir(p.expression);
        }
      }
    } else if (ts.isArrayLiteralExpression(e)) {
      for (const x of e.elements) seguir(ts.isSpreadElement(x) ? x.expression : x);
    } else if (ts.isConditionalExpression(e)) {
      seguir(e.whenTrue);
      seguir(e.whenFalse);
    } else if (ts.isIdentifier(e)) {
      if (!resolverIdentificadores) return;
      for (const valor of asignaciones.get(e.text) ?? []) seguir(valor);
      for (const m of miembros.get(e.text) ?? []) {
        anotar(m.clave);
        seguir(m.valor);
      }
    } else if (ts.isCallExpression(e)) {
      const llamado = sinEnvoltura(e.expression);
      if (ts.isIdentifier(llamado)) {
        // B7 + B8: TODAS las funciones locales con ese nombre (declaradas o guardadas en variable).
        for (const fn of funciones.get(llamado.text) ?? []) for (const r of retornos(fn)) seguir(r);
      } else if (ts.isArrowFunction(llamado) || ts.isFunctionExpression(llamado)) {
        // La función que se invoca en el acto: `(() => ({…}))()`.
        for (const r of retornos(llamado)) seguir(r);
      } else if (ts.isPropertyAccessExpression(llamado)) {
        // `.map(cb)` y compañía: lo que devuelve el callback.
        for (const arg of e.arguments) {
          if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
            for (const r of retornos(arg)) seguir(r);
          }
        }
      }
    }
  };
  for (const llamada of llamadas) for (const arg of llamada.arguments) seguir(arg);
  for (const [nombre, lista] of funciones) {
    if (!ARMA_FOTO.test(nombre)) continue;
    for (const fn of lista) for (const r of retornos(fn)) seguir(r);
  }
  return campos;
}

describe('🔒 bitácora · los precios de modelo y orden que guarda son EXACTAMENTE los declarados (parte D)', () => {
  const encontrados: Record<string, string[]> = {};
  for (const archivo of archivosEnAlcance()) {
    const campos = [...camposDeDineroEnBitacora(readFileSync(`${RAIZ}${archivo}`, 'utf8'))].sort();
    if (campos.length > 0) encontrados[archivo] = campos;
  }

  it('lo que el código manda a la bitácora coincide con la lista declarada (ni más, ni menos)', () => {
    const declarados = Object.fromEntries(
      Object.entries(CAMPOS_DECLARADOS).map(([a, c]) => [a, [...c].sort()]),
    );
    expect(
      encontrados,
      'Un campo de DINERO entró (o salió) de la bitácora de modelos/órdenes. Si entró: decidir con ' +
        'Daniel (parte D de la 0.249) y declararlo; si salió: quitarlo de CAMPOS_DECLARADOS.',
    ).toEqual(declarados);
  });

  it('control B3: el escáner SÍ ve un precio nuevo escrito EN LÍNEA en un registrarBitacora', () => {
    const muestra = [
      'async function x(): Promise<void> {',
      '  await registrarBitacora(tx, sesion, {',
      "    entidad: 'Modelo',",
      '    datos: { costoNuevoDeEmpaque: 3, descripcion: "a" },',
      '  });',
      '}',
    ].join('\n');
    expect([...camposDeDineroEnBitacora(muestra)]).toEqual(['costoNuevoDeEmpaque']);
  });

  it('control: el `detalle` armado aparte que se ESPARCE en la bitácora también se ve', () => {
    const muestra = [
      'async function x(): Promise<void> {',
      '  const detalle: Record<string, unknown> = {};',
      '  detalle.precioDeVenta = { de: 1, a: 2 };',
      "  await registrarBitacora(tx, sesion, { datos: { operacion: 'x', ...detalle } });",
      '}',
    ].join('\n');
    expect([...camposDeDineroEnBitacora(muestra)]).toEqual(['precioDeVenta']);
  });

  it('control B1: un objeto armado APARTE y pasado por variable también se ve', () => {
    const muestra = [
      'async function x(): Promise<void> {',
      '  const datosBitacora = { precioEmpaque: 1, nota: "n" };',
      "  await registrarBitacora(tx, sesion, { entidad: 'Modelo', datos: datosBitacora });",
      '}',
    ].join('\n');
    expect([...camposDeDineroEnBitacora(muestra)]).toEqual(['precioEmpaque']);
  });

  it("control B2: las claves asignadas a una variable (`X.clave =`, `X['clave'] =`) también se ven", () => {
    const muestra = [
      'async function x(): Promise<void> {',
      '  const cambios: Record<string, unknown> = {};',
      '  cambios.costoEmpaque = 1;',
      "  cambios['maquilaNueva'] = 2;",
      "  await bitacoraReceta(tx, sesion, 1, 'MODIFICAR', { ...cambios });",
      "  await registrarBitacora(tx, sesion, { entidad: 'Modelo', datos: cambios });",
      '}',
    ].join('\n');
    expect([...camposDeDineroEnBitacora(muestra)].sort()).toEqual(['costoEmpaque', 'maquilaNueva']);
  });

  it('control: una función LOCAL que arma la foto, y la reasignación de una variable, también', () => {
    const muestra = [
      'function armar(f: F): object {',
      '  return { precioCongelado: f.p };',
      '}',
      'async function x(): Promise<void> {',
      '  let datos = {};',
      '  datos = { corteNuevo: 3 };',
      '  await registrarBitacora(tx, sesion, { datos: { ...armar(f), d: datos } });',
      '}',
    ].join('\n');
    expect([...camposDeDineroEnBitacora(muestra)].sort()).toEqual([
      'corteNuevo',
      'precioCongelado',
    ]);
  });

  it.each(['??', '||', '&&'])('control B6: los DOS lados de `%s` llegan a la bitácora', (op) => {
    const muestra = [
      'async function x(): Promise<void> {',
      `  await registrarBitacora(tx, sesion, { datos: previo ${op} { precioEtiqueta: 3 } });`,
      `  await registrarBitacora(tx, sesion, { datos: { corteIzquierdo: 1 } ${op} otro });`,
      '}',
    ].join('\n');
    expect([...camposDeDineroEnBitacora(muestra)].sort()).toEqual([
      'corteIzquierdo',
      'precioEtiqueta',
    ]);
  });

  it('control B7: una FLECHA guardada en una variable (cuerpo de expresión y con bloque)', () => {
    const muestra = [
      'const armarDatosRev = () => ({ precioEtiqueta: 3 });',
      'const armarConBloque = function () {',
      '  return { costoBloque: 1 };',
      '};',
      'const armarFlechaBloque = (): object => {',
      '  return { maquilaFlecha: 2 };',
      '};',
      'async function x(): Promise<void> {',
      '  await registrarBitacora(tx, sesion, { datos: armarDatosRev() });',
      '  await registrarBitacora(tx, sesion, { datos: { ...armarConBloque(), ...armarFlechaBloque() } });',
      '}',
    ].join('\n');
    expect([...camposDeDineroEnBitacora(muestra)].sort()).toEqual([
      'costoBloque',
      'maquilaFlecha',
      'precioEtiqueta',
    ]);
  });

  it('control B8: dos `function` HOMÓNIMAS (una anidada) se miran las DOS, no gana la última', () => {
    const muestra = [
      'function armarRev(): object {',
      '  return { precioEtiqueta: 3 };',
      '}',
      'async function x(): Promise<void> {',
      '  await registrarBitacora(tx, sesion, { datos: armarRev() });',
      '}',
      'function otra(): void {',
      '  function armarRev(): object {',
      '    return { nota: 1 };',
      '  }',
      '  usar(armarRev());',
      '}',
    ].join('\n');
    expect([...camposDeDineroEnBitacora(muestra)]).toEqual(['precioEtiqueta']);
  });

  it('control: `await` de una local, paréntesis, `as`, `<T>`, `satisfies`, `!` y la función invocada en el acto', () => {
    const muestra = [
      'async function armarAsync(): Promise<object> {',
      '  return { precioAsync: 1 };',
      '}',
      'async function x(): Promise<void> {',
      '  await registrarBitacora(tx, sesion, {',
      '    datos: {',
      '      ...(await armarAsync()),',
      '      a: ({ costoParentesis: 1 } as object),',
      '      b: <object>{ corteAngular: 1 },',
      '      c: ({ maquilaSatisfies: 1 } satisfies object),',
      '      d: posible!,',
      '      e: (() => ({ precioEnElActo: 1 }))(),',
      '    },',
      '  });',
      '  const posible = { costoNoNulo: 1 };',
      '}',
    ].join('\n');
    expect([...camposDeDineroEnBitacora(muestra)].sort()).toEqual([
      'corteAngular',
      'costoNoNulo',
      'costoParentesis',
      'maquilaSatisfies',
      'precioAsync',
      'precioEnElActo',
    ]);
  });

  it('control inverso: SIN resolver identificadores, B1 y B2 se escapan (la resolución es lo que los ve)', () => {
    const muestra = [
      'async function x(): Promise<void> {',
      '  const a = { precioEmpaque: 1 };',
      '  const b = {};',
      '  b.costoEmpaque = 1;',
      '  await registrarBitacora(tx, sesion, { datos: a, otros: b });',
      '}',
    ].join('\n');
    expect(camposDeDineroEnBitacora(muestra, false).size).toBe(0);
    expect([...camposDeDineroEnBitacora(muestra)].sort()).toEqual([
      'costoEmpaque',
      'precioEmpaque',
    ]);
  });

  it('control: lo que NO va a la bitácora no cuenta (un create con precio no es bitácora)', () => {
    const muestra = 'await tx.modeloArte.create({ data: { precio: a.precio } });';
    expect(camposDeDineroEnBitacora(muestra).size).toBe(0);
  });
});

/**
 * 🔴 PARTE D DE LA 0.249, PENDIENTE DE DECISIÓN — los roles SEMBRADOS que leen la bitácora y NO
 * pueden ver (todos) esos precios en su pantalla. Medido el 7-oct-2026 contra el seed.
 */
const ROLES_DECLARADOS = ['Asistente', 'Logistica', 'Secretarial', 'Ventas'] as const;

describe('🔒 bitácora · quien la lee ve el dinero de modelo y orden — salvo los roles DECLARADOS (parte D)', () => {
  const roles = [
    ...definirRoles().map((r) => ({ nombre: r.nombre, permisos: r.permisos })),
    ...PERFILES_EDITABLES.map((p) => ({ nombre: p.nombre, permisos: p.permisos })),
  ];
  const lectores = roles.filter((r) => r.permisos.includes('admin.ver-bitacora'));

  /** ¿El rol ve TODO el dinero que la bitácora de modelos/órdenes guarda? */
  function veTodo(permisos: readonly string[]): boolean {
    const sesion = sesionDePrueba({ permisos: [...permisos] as ClavePermiso[] });
    return (
      puedeVerPreciosDeModelo(sesion) &&
      puedeVerMaquilaDeReferencia(sesion) &&
      puedeVerPreciosDeOrden(sesion) &&
      tienePermiso(sesion, 'ordenes.ver-precio-real-maquila') &&
      tienePermiso(sesion, 'consultas.ver-importes')
    );
  }

  it('hay lectores de bitácora que revisar', () => {
    expect(lectores.length).toBeGreaterThan(0);
  });

  it('los que NO lo ven todo son EXACTAMENTE los declarados', () => {
    const sinLlave = lectores
      .filter((r) => !veTodo(r.permisos))
      .map((r) => r.nombre)
      .sort();
    expect(
      sinLlave,
      'Un rol que lee la bitácora no puede ver el dinero de modelos/órdenes que ella guarda. Si ' +
        'es nuevo: decidir con Daniel (parte D de la 0.249); si ya lo ve: quitarlo de la lista.',
    ).toEqual([...ROLES_DECLARADOS]);
  });
});
