/**
 * 🔒 GUARDIÁN DE LA BITÁCORA: todo el dinero que el CÓDIGO escribe tiene su regla de TAPADO
 * (fila 0.249 parte D + fila 0.255).
 *
 * La bitácora tapa el dinero AL LEERLA (`bitacora-tapado.ts`): un mapa por ENTIDAD + CLAVE dice con
 * qué llave se ve cada importe, unas pocas claves tienen regla fija por nombre en cualquier entidad
 * (los factores), y lo no declarado CUYO NOMBRE suena a dinero se tapa por defecto con
 * `consultas.ver-importes`. El default es la RED, no el diseño: cada importe debe taparse con la
 * llave de SU pantalla, y eso sólo pasa si alguien la declaró. Este guardián lo exige.
 *
 * Un escáner del CÓDIGO (con el AST de TypeScript) recorre TODOS los `.ts` (no pruebas) de
 * `backend/src` **y `backend/migracion`** (el ETL también escribe la bitácora), encuentra cada llamada
 * a `registrarBitacora(` / `registrarBitacoraLote(` / `bitacoraReceta(`, saca su ENTIDAD (el literal
 * `entidad:`; `bitacoraReceta` ⇒ `RecetaOrden`) y junta las CLAVES con nombre de dinero
 * ({@link PARECE_DINERO}, la MISMA prueba que usa el tapado) de lo que les llega. Toda clave
 * encontrada tiene que estar en `MAPA_BITACORA[entidad]` (regla explícita) o en
 * `NO_ES_DINERO[entidad]` (con su razón). El escáner sigue:
 *      • objetos en línea, sus `...spread` y sus valores anidados;
 *      • IDENTIFICADORES del mismo archivo: sus declaraciones (`const|let X = {…}`), sus
 *        reasignaciones (`X = {…}`) y sus asignaciones de miembro (`X.clave =`, `X['clave'] =`);
 *      • lo que se EMPUJA a un arreglo (`X.push({…})`, `X.unshift(…)`) es contenido de `X`;
 *      • la variable de un `for (const x of LISTA)` toma los elementos de LISTA; si LISTA es una
 *        llamada (`trocear(bitacoras, N)`), también los identificadores que recibe (el lote);
 *      • las claves CALCULADAS `X[campo] = v` cuando `campo` recorre un arreglo de literales del mismo
 *        archivo (`for (const campo of CAMPOS)` con `const CAMPOS = ['a', 'b'] as const`);
 *      • los DOS lados de `??`, `||` y `&&`, las dos ramas de un ternario, y lo que hay dentro de
 *        paréntesis, `await`, `as`, `<T>`, `satisfies` y `!`;
 *      • llamadas a funciones LOCALES del mismo archivo (sus `return`, o el cuerpo de una flecha):
 *        `function` declaradas, flechas y function expressions guardadas en una variable, y la
 *        función invocada en el acto (`(() => ({…}))()`); si hay VARIAS con el mismo nombre (una
 *        anidada en otra función), se miran TODAS; también los callbacks de `.map(…)`;
 *      • además, el `return` de las funciones que arman las fotos de la bitácora (`foto*`,
 *        `*ParaBitacora`, `datos*Bitacora`, `bitacoraDe*`), aunque las llame otro archivo: sus claves
 *        se atribuyen a las entidades declaradas en {@link FOTOS_POR_ARCHIVO}.
 *     Una entidad que no es un literal (`entidad: entidadBitacora(concepto)`) tiene que estar
 *     declarada en {@link ENTIDADES_DINAMICAS}; una nueva sin declarar pone la prueba roja.
 *
 * ⚠️ **LÍMITES DEL ESCÁNER (lo que NO ve), cada uno con su razón — Y LO QUE PASA CON ESO AL LEER.**
 * Lo que el escáner no ve NO queda cubierto «por el default» en general: el default al leer
 * ({@link PARECE_DINERO} ⇒ `consultas.ver-importes`) SÓLO alcanza a las claves cuyo NOMBRE encaja con
 * esa prueba, y aun entonces con la regla `importes`, que NO siempre es la de su pantalla. Dos casos
 * medidos en la revisión de la 0.249 D lo demuestran: los factores descartados al fusionar
 * departamentos (sí encajaban, pero `importes` se los dejaba ver a Gerencial: hizo falta
 * `REGLAS_POR_NOMBRE`), y la `utilidadSugerida` de la configuración de la empresa (NO encajaba: salía
 * en claro). Un hueco de esta lista es, por tanto, un posible hueco de tapado: se declara a mano en el
 * mapa lo que se encuentre por ahí (así entraron `Cliente`, `Color` y `ConfiguracionEmpresa`).
 *  • **Claves con nombre genérico** (`anterior`/`nuevo`/`total`/`otros`): el filtro es por NOMBRE. Se
 *    declaran a mano por entidad en el mapa (`Orden.anterior`, `CorridaPago.total`, …). Al leer, el
 *    default NO las tapa.
 *  • **Objetos que llegan de OTRO lado** (lo que devuelve una función IMPORTADA que no se llame como
 *    foto —p. ej. `repunte.descartados` de `*-fusion-referencias.ts`—, un parámetro, una
 *    desestructuración, un campo de un objeto recibido): el AST es de un archivo a la vez y no sigue
 *    tipos.
 *  • **Claves armadas en tiempo de ejecución**: `Object.fromEntries(Object.entries(datos))`
 *    (`admin/empresas.ts`: `Empresa` y `ConfiguracionEmpresa`), `[variable]: v`, `Object.assign`, o
 *    `X[campo] =` con `campo` que no recorre un arreglo de literales del mismo archivo.
 *  • **Filas de la base o resultados de métodos** (`aJsonBitacora(fila)`, `...await tx.x.findUnique()`):
 *    sus claves son las columnas de Prisma.
 *  • **Un `for…of` sobre algo que no es un arreglo del archivo ni una llamada que reciba el arreglo**
 *    (p. ej. `for (const x of mapa.values())`): no se resuelve.
 *  • **Sombra de nombres**: un nombre se resuelve por NOMBRE en todo el archivo, no por ámbito; dos
 *    homónimos suman sus claves (sólo puede dar un falso rojo: p. ej. `ProveedorContacto`, que
 *    comparte el nombre `detalle` con la ficha del proveedor).
 *  • **Texto armado** (`` `precio: ${p}` ``): la cifra viaja dentro de un STRING.
 *  • **Llamadas indirectas** (`fn.call(…)`, `o.armar()`), **getters/métodos** dentro del objeto y
 *    **alias de la bitácora** (`const rb = registrarBitacora`): no se resuelven.
 *
 * 🔑 **ENTIDADES (opción B).** Además de las claves, toda ENTIDAD escrita tiene que estar en el mapa o
 * en {@link ENTIDADES_SIN_DINERO}. Lo que esa exigencia NO alcanza: una entidad cuyo `entidad:` no
 * se resuelve estáticamente (`entidad: f(x)`, un parámetro, `{ entidad }` abreviado) sale como
 * dinámica y PONE ROJA la prueba hasta declararla en {@link ENTIDADES_DINAMICAS} con sus valores — o
 * sea, no se escapa en silencio; pero si quien la declara se equivoca de valores, la entidad real
 * que falte no se ve. Y no ve las escrituras que no pasan por las tres llamadas reconocidas (un alias
 * de `registrarBitacora`, o un `tx.bitacora.create` directo: hoy no existe ninguno, medido).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { MAPA_BITACORA, NO_ES_DINERO, PARECE_DINERO, REGLAS_BITACORA } from './bitacora-tapado.js';

/** Raíz del backend: se escanean `src/` y `migracion/` (el ETL también escribe la bitácora). */
const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));

/** Una entidad que no es literal: el escáner la anota así. */
const DINAMICA = '<dinámica>';

/**
 * Archivos que escriben la bitácora con una entidad que NO es un literal, y las entidades que esa
 * expresión puede tomar (medidas a mano, con su razón).
 */
const ENTIDADES_DINAMICAS: Readonly<Record<string, readonly string[]>> = {
  // `entidadBitacora(concepto)`: abono / descuento / pago.
  'src/dominio/esma/correccion.ts': ['AbonoMaquilero', 'DescuentoMaquilero', 'PagoMaquilero'],
  // `const entidadBitacora = concepto === 'abono' ? …` al revisar una partida.
  'src/dominio/esma/movimientos.ts': ['AbonoMaquilero', 'DescuentoMaquilero', 'PagoMaquilero'],
  // `puerta.entidad`: 'UbicacionTelaColor' | 'UbicacionAvio' (tipo de la puerta).
  'src/dominio/inventarios/ubicaciones.ts': ['UbicacionTelaColor', 'UbicacionAvio'],
};

/**
 * Archivos con funciones que arman FOTOS para la bitácora (las puede llamar otro archivo) → las
 * entidades bajo las que esas fotos se guardan.
 */
const FOTOS_POR_ARCHIVO: Readonly<Record<string, readonly string[]>> = {
  // `datosArteParaBitacora`: el arte al quitarlo (ModeloArte) y los artes que se van al copiar el
  // BOM de otro modelo (`modelos/bom-modelo.ts`, entidad Modelo).
  'src/dominio/modelos/arte-modelo.ts': ['ModeloArte', 'Modelo'],
  // `desenlaceAnteriorParaBitacora`: la meta de costo anterior.
  'src/dominio/modelos/revision-modelo.ts': ['Modelo'],
  // `fotoTela`/`fotoAvio`/`fotoArte`: los renglones de la receta de la orden.
  'src/dominio/produccion/receta-orden.ts': ['RecetaOrden'],
  // `bitacoraDeRenglon`: el renglón de la corrida.
  'src/dominio/pagos/corrida.ts': ['RenglonCorridaPago'],
};

/**
 * ⭐⭐ OPCIÓN B (revisión de la 0.249 D) — LAS ENTIDADES QUE SE ESCRIBEN A LA BITÁCORA SIN DINERO,
 * escritas a mano y cada una con su razón. TODA entidad que el escáner ve escribirse (en `src/` y en
 * `migracion/`, incluidas las dinámicas declaradas) tiene que estar AQUÍ o en `MAPA_BITACORA`: así
 * una entidad NUEVA cuyo dinero no suena a dinero (`ListaMayoreo { markupSugerido, piso }`) pone la
 * prueba roja en vez de pasar en claro. Y una entrada de aquí que ya nadie escribe, también.
 * Medido el 7-oct-2026 con el propio escáner (las claves de cada una, en el informe de la fila).
 */
const ENTIDADES_SIN_DINERO: Readonly<Record<string, string>> = {
  ActividadProductividad: 'catálogo de actividades: nombre y área',
  Almacen: 'catálogo de almacenes: nombre, tipo, cortador',
  ArticuloRC: 'artículos de la ruta crítica: nombre y activo',
  Auditor: 'catálogo de auditores: nombre, rol, nivel AQL',
  Auditoria: 'auditorías de calidad: piezas, muestra, defectos, resultado (conteos)',
  CalendarioEmpresa: 'calendario laboral: días',
  ChecklistFichaDef: 'definición de checklist: claves de texto',
  ClienteContacto: 'contactos del cliente: nombre y puesto',
  ComposicionTela: 'catálogo de composiciones: nombre',
  ConceptoCosto: 'catálogo de conceptos de costo: código, nombre, orden (sin importes)',
  ConceptoPago: 'catálogo de conceptos de pago: nombre, rubro, forma de pago preferida (texto)',
  ConceptoPagoCuenta:
    'cuentas del concepto: banco/CLABE/beneficiario se guardan como `{ cambio: true }`',
  Curva: 'curvas de tallas: nombre e items',
  DefectoCatalogo: 'catálogo de defectos: clave, severidad, nivel AQL',
  Desarrollo: 'alta de desarrollos: código, año, género, receta copiada (conteos)',
  DiaFestivo: 'días festivos: fecha y descripción',
  DireccionEntrega: 'direcciones de entrega: nombre',
  DuracionPorAplicacion: 'reglas de duración: días',
  DuracionPorTipoTela: 'reglas de duración: días',
  Empresa: 'empresas: nombre, RFC, banderas y logo',
  EntradaTela: 'entradas de tela: folio, documento, estatus, conteos de renglones',
  EstadoLista: 'catálogo de estados de la lista: código, nombre, orden',
  FactorCantidad: 'factores de CANTIDAD por rango de piezas (no de precio)',
  FamiliaArticulo: 'familias de artículos: nombre',
  FichaVerificacion: 'fichas de verificación: reactivos',
  HitoOrden: 'hitos de la orden: tipo, fecha, motivo',
  InventarioCiclico: 'conteos cíclicos: cantidades teórica y real (piezas), folio',
  Lote: 'lotes de tela: clave y componentes',
  Movimiento: 'kardex: folio, dimensión, renglones (conteo)',
  Muestrario: 'muestrarios: fechas y motivo',
  NotaSalida: 'notas de salida: número, conteos de renglones y avíos',
  OrdenCompra: 'órdenes de compra: folio, estatus y conteos (`anterior` es un estatus)',
  PartidaTela: 'partidas de tela: folio y lote del proveedor',
  Pedido: 'pedidos: folio, conteos de renglones, archivos importados',
  PedidoReal: 'pedidos reales: número y conteo de renglones',
  PersonalArea: 'personal por área: nombre',
  PlanMuestreoAQL: 'planes de muestreo AQL: tablas de tamaño de muestra',
  PlantillaRuta: 'plantillas de la ruta crítica: nombre y total de procesos (conteo)',
  ProcesoDef: 'procesos de la ruta crítica: código, antecesores, duración (`total` es un conteo)',
  ProveedorCuentaPago:
    'cuentas del proveedor: banco/CLABE/beneficiario se guardan como `{ cambio: true }`',
  Proyecto: 'proyectos de desarrollo: folio, nombre, año',
  RangoDificultad: 'rangos de dificultad: operaciones y días de costura',
  RegistroProductividad: 'registros de productividad: área, fecha, motivo',
  RespaldoBd: 'respaldos de la base: bucket, tamaños, duración',
  Rol: 'roles: nombre y claves de permiso',
  RutaOrden: 'ruta crítica de la orden: estados y eventos',
  RutaOrdenChecklist: 'checklist de la ruta: hecho/no hecho',
  Talla: 'catálogo de tallas: etiqueta y orden',
  TelaCategoria: 'catálogo de categorías de tela: nombre',
  Temporada: 'catálogo de temporadas: nombre',
  TipoProceso: 'tipos de proceso: código, nombre, banderas',
  TipoProducto: 'tipos de producto: nombre y dígito',
  UbicacionAvio: 'ubicaciones de avío: antes/después son textos de ubicación',
  UbicacionTelaColor: 'ubicaciones de tela: antes/después son textos de ubicación',
  Usuario: 'usuarios: nombre, correo, roles, intentos fallidos',
};

/** Las entidades escritas que no están ni en el mapa ni en la lista sin dinero (y las que sobran). */
function clasificarEntidades(escritas: ReadonlySet<string>): {
  sinDeclarar: string[];
  sinDineroQueNadieEscribe: string[];
  enLasDos: string[];
} {
  const enMapa = (e: string): boolean => Object.hasOwn(MAPA_BITACORA, e);
  const sinDinero = (e: string): boolean => Object.hasOwn(ENTIDADES_SIN_DINERO, e);
  return {
    sinDeclarar: [...escritas].filter((e) => !enMapa(e) && !sinDinero(e)).sort(),
    sinDineroQueNadieEscribe: Object.keys(ENTIDADES_SIN_DINERO)
      .filter((e) => !escritas.has(e))
      .sort(),
    enLasDos: Object.keys(ENTIDADES_SIN_DINERO).filter(enMapa).sort(),
  };
}

/** Funciones cuyo `return` es una FOTO para la bitácora aunque la llame otro archivo. */
const ARMA_FOTO = /^foto(?:Tela|Avio|Arte)$|ParaBitacora$|^datos\w*Bitacora$|^bitacoraDe\w*$/;

/** Las llamadas que escriben la bitácora. */
const LLAMADA_BITACORA = /^(?:registrarBitacora|registrarBitacoraLote|bitacoraReceta)$/;

/** ¿La clave tiene nombre de DINERO (sin contar los ids)? */
function suenaADinero(clave: string): boolean {
  return PARECE_DINERO.test(clave) && !/^id[A-Z]/.test(clave);
}

/**
 * Todos los `.ts` no-prueba de `src/` y `migracion/` (relativos a la raíz del backend), sin lo
 * generado.
 */
function archivosEscaneados(): string[] {
  return [...archivosDe(`${RAIZ}src/`, 'src/'), ...archivosDe(`${RAIZ}migracion/`, 'migracion/')];
}

/** Los `.ts` no-prueba bajo un directorio (recursivo). */
function archivosDe(dir: string, prefijo: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = `${dir}${nombre}`;
    const relativo = `${prefijo}${nombre}`;
    if (statSync(ruta).isDirectory()) {
      if (relativo === 'src/datos/generated' || nombre === 'node_modules') continue;
      salida.push(...archivosDe(`${ruta}/`, `${relativo}/`));
    } else if (
      nombre.endsWith('.ts') &&
      !nombre.endsWith('.test.ts') &&
      !nombre.endsWith('.d.ts')
    ) {
      salida.push(relativo);
    }
  }
  return salida;
}

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

/** Lo que el escáner encuentra en un archivo. */
interface Escaneo {
  /** entidad (o {@link DINAMICA}) → claves de dinero que le llegan. */
  porEntidad: Map<string, Set<string>>;
  /** Claves de dinero de las funciones que arman fotos (las puede llamar otro archivo). */
  fotos: Set<string>;
}

/**
 * Las claves de dinero que un TEXTO de código manda a la bitácora, por entidad (ver el encabezado:
 * qué sigue y qué no). Recorre el AST de TypeScript del archivo.
 */
function escanear(codigo: string, resolverIdentificadores = true): Escaneo {
  const archivo = ts.createSourceFile('escaneado.ts', codigo, ts.ScriptTarget.Latest, true);
  const asignaciones = new Map<string, ts.Expression[]>();
  const miembros = new Map<string, { clave: string; valor: ts.Expression }[]>();
  // ⚠️ B8: una LISTA por nombre. Con un `Map` simple ganaba la última `function` homónima (p. ej.
  // una anidada en otra función) y la que de verdad llegaba a la bitácora quedaba sin mirar.
  const funciones = new Map<string, ts.FunctionLikeDeclaration[]>();
  // G4: lo que se EMPUJA a un arreglo (`X.push({…})`, `X.unshift(…)`) es contenido de `X`.
  const empujes = new Map<string, ts.Expression[]>();
  // G4: la variable de un `for (const x of EXPR)` toma los elementos de `EXPR`.
  const iteraciones = new Map<string, ts.Expression[]>();
  // G4: `X[campo] = valor` con `campo` variable de un `for (const campo of LISTA)`: las claves son
  // los literales de LISTA (`const LISTA = ['a', 'b'] as const`).
  const calculados = new Map<string, { clave: string; valor: ts.Expression }[]>();
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
      } else if (
        ts.isElementAccessExpression(izq) &&
        ts.isIdentifier(izq.expression) &&
        ts.isIdentifier(izq.argumentExpression)
      ) {
        agregar(calculados, izq.expression.text, {
          clave: izq.argumentExpression.text,
          valor: nodo.right,
        });
      }
    }
    if (
      ts.isCallExpression(nodo) &&
      ts.isIdentifier(nodo.expression) &&
      LLAMADA_BITACORA.test(nodo.expression.text)
    ) {
      llamadas.push(nodo);
    }
    if (
      ts.isCallExpression(nodo) &&
      ts.isPropertyAccessExpression(nodo.expression) &&
      ts.isIdentifier(nodo.expression.expression) &&
      (nodo.expression.name.text === 'push' || nodo.expression.name.text === 'unshift')
    ) {
      for (const arg of nodo.arguments) {
        agregar(
          empujes,
          nodo.expression.expression.text,
          ts.isSpreadElement(arg) ? arg.expression : arg,
        );
      }
    }
    if (
      ts.isForOfStatement(nodo) &&
      ts.isVariableDeclarationList(nodo.initializer) &&
      nodo.initializer.declarations.length === 1 &&
      ts.isIdentifier(nodo.initializer.declarations[0]!.name)
    ) {
      agregar(iteraciones, nodo.initializer.declarations[0]!.name.text, nodo.expression);
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
  let campos = new Set<string>();
  let vistos = new Set<ts.Node>();
  const anotar = (clave: string): void => {
    if (suenaADinero(clave)) campos.add(clave);
  };
  /**
   * Los literales de texto que puede tomar la variable de un `for (const v of LISTA)`, cuando LISTA
   * es un arreglo de literales del mismo archivo (directo o por una constante, con `as const`).
   */
  const literalesDeIteracion = (variable: string): string[] =>
    (iteraciones.get(variable) ?? []).flatMap((it) => {
      const x = sinEnvoltura(it);
      const arreglos = ts.isArrayLiteralExpression(x)
        ? [x]
        : ts.isIdentifier(x)
          ? (asignaciones.get(x.text) ?? [])
              .map((v) => sinEnvoltura(v))
              .filter((v): v is ts.ArrayLiteralExpression => ts.isArrayLiteralExpression(v))
          : [];
      return arreglos.flatMap((a) =>
        a.elements.filter((el) => ts.isStringLiteralLike(el)).map((el) => el.text),
      );
    });

  /**
   * El iterable de un `for…of`: él mismo y, si es una llamada (`trocear(bitacoras, N)`, `lotes(x)`),
   * los IDENTIFICADORES que recibe — la forma de partir en lotes un arreglo armado con `push`.
   */
  const seguirIterable = (iterable: ts.Expression): void => {
    seguir(iterable);
    const x = sinEnvoltura(iterable);
    if (ts.isCallExpression(x)) {
      for (const arg of x.arguments) if (ts.isIdentifier(arg)) seguir(arg);
    }
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
      for (const valor of empujes.get(e.text) ?? []) seguir(valor);
      for (const c of calculados.get(e.text) ?? []) {
        for (const clave of literalesDeIteracion(c.clave)) anotar(clave);
        seguir(c.valor);
      }
      for (const iterable of iteraciones.get(e.text) ?? []) seguirIterable(iterable);
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

  /**
   * Los objetos literales que forman los argumentos de una llamada (el objeto en línea, los de un
   * arreglo y los que devuelve el callback de un `.map(…)` — `registrarBitacoraLote`), para leer su
   * `entidad:` SIN entrar a `datos`.
   */
  const objetosDe = (e: ts.Expression, profundidad = 0): ts.ObjectLiteralExpression[] => {
    if (profundidad > 4) return [];
    const x = sinEnvoltura(e);
    if (ts.isObjectLiteralExpression(x)) return [x];
    if (ts.isArrayLiteralExpression(x)) {
      return x.elements.flatMap((el) =>
        ts.isSpreadElement(el) ? [] : objetosDe(el, profundidad + 1),
      );
    }
    if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(sinEnvoltura(x.expression))) {
      return x.arguments.flatMap((arg) =>
        ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)
          ? retornos(arg).flatMap((r) => objetosDe(r, profundidad + 1))
          : [],
      );
    }
    if (ts.isIdentifier(x) && resolverIdentificadores) {
      const iterables = (iteraciones.get(x.text) ?? []).flatMap((it) => {
        const llamada = sinEnvoltura(it);
        return ts.isCallExpression(llamada) ? [it, ...llamada.arguments] : [it];
      });
      return [
        ...(asignaciones.get(x.text) ?? []),
        ...(empujes.get(x.text) ?? []),
        ...iterables,
      ].flatMap((v) => objetosDe(v, profundidad + 1));
    }
    return [];
  };

  /** Las entidades de una llamada: literales, o {@link DINAMICA} si alguna no lo es. */
  const entidadesDe = (llamada: ts.CallExpression): string[] => {
    if (ts.isIdentifier(llamada.expression) && llamada.expression.text === 'bitacoraReceta') {
      return ['RecetaOrden'];
    }
    const entidades = new Set<string>();
    for (const obj of llamada.arguments.flatMap((a) => objetosDe(a))) {
      for (const p of obj.properties) {
        if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name) || p.name.text !== 'entidad') {
          continue;
        }
        const v = sinEnvoltura(p.initializer);
        entidades.add(ts.isStringLiteralLike(v) ? v.text : DINAMICA);
      }
    }
    return entidades.size === 0 ? [DINAMICA] : [...entidades];
  };

  const porEntidad = new Map<string, Set<string>>();
  for (const llamada of llamadas) {
    campos = new Set();
    vistos = new Set();
    for (const arg of llamada.arguments) seguir(arg);
    for (const entidad of entidadesDe(llamada)) {
      porEntidad.set(entidad, new Set([...(porEntidad.get(entidad) ?? []), ...campos]));
    }
  }
  campos = new Set();
  vistos = new Set();
  for (const [nombre, lista] of funciones) {
    if (!ARMA_FOTO.test(nombre)) continue;
    for (const fn of lista) for (const r of retornos(fn)) seguir(r);
  }
  return { porEntidad, fotos: campos };
}

/** Todas las claves de dinero de un texto, sin importar la entidad (para los controles). */
function camposDeDineroEnBitacora(codigo: string, resolverIdentificadores = true): Set<string> {
  const { porEntidad, fotos } = escanear(codigo, resolverIdentificadores);
  return new Set([...[...porEntidad.values()].flatMap((c) => [...c]), ...fotos]);
}

/** El escaneo de TODO `src/`, por entidad real (dinámicas y fotos ya repartidas). */
function escanearSrc(): {
  porEntidad: Map<string, Set<string>>;
  dinamicasSinDeclarar: string[];
  fotosSinDeclarar: string[];
  dinamicasDeclaradasDeMas: string[];
  fotosDeclaradasDeMas: string[];
} {
  const porEntidad = new Map<string, Set<string>>();
  const sumar = (entidad: string, claves: Iterable<string>): void => {
    porEntidad.set(entidad, new Set([...(porEntidad.get(entidad) ?? []), ...claves]));
  };
  const conDinamica = new Set<string>();
  const conFotos = new Set<string>();
  for (const archivo of archivosEscaneados()) {
    const { porEntidad: delArchivo, fotos } = escanear(readFileSync(`${RAIZ}${archivo}`, 'utf8'));
    for (const [entidad, claves] of delArchivo) {
      if (entidad === DINAMICA) {
        conDinamica.add(archivo);
        for (const real of ENTIDADES_DINAMICAS[archivo] ?? []) sumar(real, claves);
      } else {
        sumar(entidad, claves);
      }
    }
    if (fotos.size > 0) {
      conFotos.add(archivo);
      for (const real of FOTOS_POR_ARCHIVO[archivo] ?? []) sumar(real, fotos);
    }
  }
  return {
    porEntidad,
    dinamicasSinDeclarar: [...conDinamica].filter((a) => !(a in ENTIDADES_DINAMICAS)).sort(),
    fotosSinDeclarar: [...conFotos].filter((a) => !(a in FOTOS_POR_ARCHIVO)).sort(),
    dinamicasDeclaradasDeMas: Object.keys(ENTIDADES_DINAMICAS)
      .filter((a) => !conDinamica.has(a))
      .sort(),
    fotosDeclaradasDeMas: Object.keys(FOTOS_POR_ARCHIVO)
      .filter((a) => !conFotos.has(a))
      .sort(),
  };
}

describe('🔒 bitácora · todo el dinero que el código escribe tiene su regla de tapado (0.249 D)', () => {
  const escaneo = escanearSrc();

  it('el escáner encuentra escritores reales (no mide en vacío)', () => {
    // Control: si el escáner dejara de ver llamadas, todo lo de abajo pasaría en verde sin medir.
    expect(escaneo.porEntidad.size).toBeGreaterThan(30);
    expect([...(escaneo.porEntidad.get('Modelo') ?? [])]).toContain('maquilaBase');
    expect([...(escaneo.porEntidad.get('RenglonCorridaPago') ?? [])]).toContain('beneficiario');
    expect([...(escaneo.porEntidad.get('RecetaOrden') ?? [])]).toContain('precio');
    expect([...(escaneo.porEntidad.get('CostoOrden') ?? [])]).toContain('telaCost');
  });

  it('toda clave con nombre de dinero tiene regla en MAPA_BITACORA o está en NO_ES_DINERO', () => {
    const sinRegla: string[] = [];
    for (const [entidad, claves] of escaneo.porEntidad) {
      for (const clave of claves) {
        const explicita = MAPA_BITACORA[entidad]?.[clave] !== undefined;
        const declaradaNoDinero = NO_ES_DINERO[entidad]?.[clave] !== undefined;
        if (!explicita && !declaradaNoDinero) sinRegla.push(`${entidad}.${clave}`);
      }
    }
    expect(
      sinRegla.sort(),
      'Una clave de DINERO entró a la bitácora sin regla de tapado declarada. Decide con qué llave ' +
        'la enseña SU pantalla y agrégala a MAPA_BITACORA (o, si no es dinero, a NO_ES_DINERO con ' +
        'su razón). El default la tapa con `consultas.ver-importes`, pero puede no ser la llave correcta.',
    ).toEqual([]);
  });

  it('toda entidad dinámica está declarada (y ninguna declaración sobra)', () => {
    expect(escaneo.dinamicasSinDeclarar).toEqual([]);
    expect(escaneo.dinamicasDeclaradasDeMas).toEqual([]);
  });

  it('todo archivo que arma fotos para la bitácora declara sus entidades (y ninguno sobra)', () => {
    expect(escaneo.fotosSinDeclarar).toEqual([]);
    expect(escaneo.fotosDeclaradasDeMas).toEqual([]);
  });

  it('el mapa no envejece: toda entidad del mapa y de NO_ES_DINERO la escribe alguien', () => {
    const escritas = new Set<string>(escaneo.porEntidad.keys());
    const huerfanas = [...new Set([...Object.keys(MAPA_BITACORA), ...Object.keys(NO_ES_DINERO)])]
      .filter((e) => !escritas.has(e))
      .sort();
    expect(huerfanas).toEqual([]);
  });

  it('OPCIÓN B: TODA entidad escrita está en el mapa o en ENTIDADES_SIN_DINERO (y la lista no sobra)', () => {
    const escritas = new Set<string>(escaneo.porEntidad.keys());
    expect(escritas.has(DINAMICA), 'quedó una entidad dinámica sin resolver').toBe(false);
    const c = clasificarEntidades(escritas);
    expect(
      c.sinDeclarar,
      'Una entidad nueva se escribe a la bitácora sin estar en MAPA_BITACORA ni en ' +
        'ENTIDADES_SIN_DINERO. Si guarda dinero (aunque su clave no lo parezca), decláralo en el ' +
        'mapa con la llave de su pantalla; si no, agrégala a la lista con su razón.',
    ).toEqual([]);
    expect(
      c.sinDineroQueNadieEscribe,
      'una entrada de ENTIDADES_SIN_DINERO ya no se escribe',
    ).toEqual([]);
    expect(c.enLasDos).toEqual([]);
  });

  it('control OPCIÓN B: la mutante del reviewer (`ListaMayoreo { markupSugerido, piso }`) se detecta', () => {
    const muestra = [
      'async function x(): Promise<void> {',
      "  await registrarBitacora(tx, sesion, { entidad: 'ListaMayoreo', datos: { markupSugerido: 1.45, piso: 120 } });",
      '}',
    ].join('\n');
    const { porEntidad } = escanear(muestra);
    // Ninguna de sus claves suena a dinero: el guardián de CLAVES no la ve…
    expect([...(porEntidad.get('ListaMayoreo') ?? [])]).toEqual([]);
    // …pero el de ENTIDADES sí.
    const escritas = new Set([...escaneo.porEntidad.keys(), ...porEntidad.keys()]);
    expect(clasificarEntidades(escritas).sinDeclarar).toEqual(['ListaMayoreo']);
  });

  it('control inverso OPCIÓN B: una entidad legítima que deja de escribirse queda señalada', () => {
    const escritas = new Set(escaneo.porEntidad.keys());
    escritas.delete('Temporada');
    expect(clasificarEntidades(escritas).sinDineroQueNadieEscribe).toEqual(['Temporada']);
  });

  it('toda regla del mapa existe, y NO_ES_DINERO sólo lista claves que de verdad suenan a dinero', () => {
    for (const reglas of Object.values(MAPA_BITACORA)) {
      for (const regla of Object.values(reglas)) {
        expect(Object.keys(REGLAS_BITACORA)).toContain(regla);
      }
    }
    for (const [entidad, claves] of Object.entries(NO_ES_DINERO)) {
      for (const clave of Object.keys(claves)) {
        expect(PARECE_DINERO.test(clave), `${entidad}.${clave}`).toBe(true);
        // Y no se contradice con el mapa.
        expect(MAPA_BITACORA[entidad]?.[clave], `${entidad}.${clave}`).toBeUndefined();
      }
    }
  });

  it('control: una clave de dinero nueva en una entidad nueva SÍ la ve (con su entidad)', () => {
    const muestra = [
      'async function x(): Promise<void> {',
      '  await registrarBitacora(tx, sesion, {',
      "    entidad: 'Empaque',",
      '    datos: { costoNuevoDeEmpaque: 3, descripcion: "a", idPrecosto: 4 },',
      '  });',
      '}',
    ].join('\n');
    const { porEntidad } = escanear(muestra);
    expect(Object.fromEntries([...porEntidad].map(([e, c]) => [e, [...c]]))).toEqual({
      Empaque: ['costoNuevoDeEmpaque'],
    });
  });

  it('control: la entidad del LOTE (`.map`) y la de `bitacoraReceta` se resuelven; la no literal es dinámica', () => {
    const muestra = [
      'async function x(): Promise<void> {',
      '  await registrarBitacoraLote(tx, sesion, lote.map((o) => ({',
      "    entidad: 'Orden', idEntidad: o.id, accion: 'MODIFICAR', datos: { montoLote: 1 },",
      '  })));',
      "  await bitacoraReceta(tx, sesion, 1, 'MODIFICAR', { precio: 2 });",
      '  await registrarBitacora(tx, sesion, { entidad: deQuien(c), datos: { saldoX: 1 } });',
      '}',
    ].join('\n');
    const { porEntidad } = escanear(muestra);
    expect(Object.fromEntries([...porEntidad].map(([e, c]) => [e, [...c]]))).toEqual({
      Orden: ['montoLote'],
      RecetaOrden: ['precio'],
      [DINAMICA]: ['saldoX'],
    });
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
      '  datos = { montoNuevo: 3 };',
      '  await registrarBitacora(tx, sesion, { datos: { ...armar(f), d: datos } });',
      '}',
    ].join('\n');
    expect([...camposDeDineroEnBitacora(muestra)].sort()).toEqual([
      'montoNuevo',
      'precioCongelado',
    ]);
  });

  it.each(['??', '||', '&&'])('control B6: los DOS lados de `%s` llegan a la bitácora', (op) => {
    const muestra = [
      'async function x(): Promise<void> {',
      `  await registrarBitacora(tx, sesion, { datos: previo ${op} { precioEtiqueta: 3 } });`,
      `  await registrarBitacora(tx, sesion, { datos: { importeIzquierdo: 1 } ${op} otro });`,
      '}',
    ].join('\n');
    expect([...camposDeDineroEnBitacora(muestra)].sort()).toEqual([
      'importeIzquierdo',
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
      '      b: <object>{ saldoAngular: 1 },',
      '      c: ({ maquilaSatisfies: 1 } satisfies object),',
      '      d: posible!,',
      '      e: (() => ({ precioEnElActo: 1 }))(),',
      '    },',
      '  });',
      '  const posible = { costoNoNulo: 1 };',
      '}',
    ].join('\n');
    expect([...camposDeDineroEnBitacora(muestra)].sort()).toEqual([
      'costoNoNulo',
      'costoParentesis',
      'maquilaSatisfies',
      'precioAsync',
      'precioEnElActo',
      'saldoAngular',
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

  it('control G4: lo EMPUJADO a un arreglo (`push`) que llega a la bitácora se ve, con su entidad', () => {
    const muestra = [
      'async function x(): Promise<void> {',
      '  const descartados = [];',
      '  descartados.push({ margenPct: 1, porQue: "x" });',
      "  await registrarBitacora(tx, sesion, { entidad: 'Cliente', datos: { descartados } });",
      '  const lote = [];',
      "  lote.push({ entidad: 'Orden', datos: { montoEmpujado: 2 } });",
      '  await registrarBitacoraLote(tx, sesion, lote);',
      '}',
    ].join('\n');
    const { porEntidad } = escanear(muestra);
    expect(Object.fromEntries([...porEntidad].map(([e, c]) => [e, [...c].sort()]))).toEqual({
      Cliente: ['margenPct'],
      Orden: ['montoEmpujado'],
    });
  });

  it('control G4: el lote de un `for…of` sobre `trocear(arr, N)` resuelve entidad y claves del `push`', () => {
    const muestra = [
      'async function x(): Promise<void> {',
      '  const bitacoras = [];',
      "  bitacoras.push({ entidad: 'Orden', datos: { saldoDelLote: 1 } });",
      '  for (const lote of trocear(bitacoras, 500)) {',
      '    await registrarBitacoraLote(tx, null, lote);',
      '  }',
      '}',
    ].join('\n');
    const { porEntidad } = escanear(muestra);
    expect(Object.fromEntries([...porEntidad].map(([e, c]) => [e, [...c]]))).toEqual({
      Orden: ['saldoDelLote'],
    });
  });

  it('control G4: las claves CALCULADAS de un `for…of` sobre un arreglo de literales se ven', () => {
    const muestra = [
      "const CAMPOS = ['nombre', 'formaPago', 'precioLista'] as const;",
      'async function x(): Promise<void> {',
      '  const detalle: Record<string, unknown> = {};',
      '  for (const campo of CAMPOS) {',
      '    detalle[campo] = { de: 1, a: 2 };',
      '  }',
      "  await registrarBitacora(tx, sesion, { entidad: 'Proveedor', datos: { ...detalle } });",
      '}',
    ].join('\n');
    expect([...camposDeDineroEnBitacora(muestra)].sort()).toEqual(['formaPago', 'precioLista']);
  });

  it('control inverso G4: SIN resolver identificadores, el `push` y el lote se escapan', () => {
    const muestra = [
      'async function x(): Promise<void> {',
      '  const descartados = [];',
      '  descartados.push({ margenPct: 1 });',
      "  await registrarBitacora(tx, sesion, { entidad: 'Cliente', datos: { descartados } });",
      '}',
    ].join('\n');
    expect(camposDeDineroEnBitacora(muestra, false).size).toBe(0);
    expect([...camposDeDineroEnBitacora(muestra)]).toEqual(['margenPct']);
  });

  it('control G5: el escaneo incluye `migracion/` (el ETL de fotos escribe la bitácora)', () => {
    expect(
      archivosEscaneados().filter((a) => a.startsWith('migracion/') && !a.includes('.test.')),
    ).toContain('migracion/loaders/fotos-modelos.ts');
  });

  it('control: las fotos (`*ParaBitacora`) se ven aunque nadie del archivo las llame', () => {
    const muestra = [
      'export function datosArteParaBitacora(a: A): object {',
      '  return { precio: a.precio, nombre: a.nombre };',
      '}',
    ].join('\n');
    expect([...escanear(muestra).fotos]).toEqual(['precio']);
  });
});
