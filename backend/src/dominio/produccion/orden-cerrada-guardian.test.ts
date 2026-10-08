/**
 * ⭐⭐ 0.226a (§Post-F9.244) — **EL GUARDIÁN DE LAS PUERTAS DE LA ORDEN CERRADA.**
 *
 * EL DEFECTO QUE VINO A MATAR, medido en el peinado del 30-sep-2026: «cerrada» era una promesa a
 * medias. La guarda existía y era UNA (`exigirOrdenAbierta`), pero se aplicaba **a mano, puerta por
 * puerta** — 17 llamadas en 9 archivos — y SIETE módulos no la llamaban (calidad, ruta crítica,
 * inventarios, compras, notas, EsMa, EDR). Se podía sacar tela, comprar material, auditar y mover PT
 * contra una orden cerrada sin que nada protestara. Una lista a mano se queda corta sola en cuanto
 * nace una puerta nueva.
 *
 * Éste trabaja **por FUNCIÓN** (molde: `modelos/receta-escritores-guardian.test.ts`, con su lección
 * de tres rondas): parte cada archivo de `src/dominio` en sus bindings de nivel superior, se queda con
 * los que **ESCRIBEN** (método de escritura de Prisma, o el motor de kardex) **y hablan de una orden**
 * (`idOrden`, o las indirectas `idOrdenCompraLinea` / `origenId`, o escriben la tabla `orden` misma),
 * y exige que **cada uno** esté declarado abajo con su DISCIPLINA y su razón. Una función nueva que
 * escriba con una orden y no esté declarada pone esto ROJO.
 *
 * ## Las disciplinas, y qué comprueba cada una (no basta con declararla)
 *
 *  • `guarda` — la puerta llama a la guarda CON CANDADO (`exigirOrdenesAbiertas` /
 *    `exigirOrdenAbiertaPorId`), directo o por un ENVOLTORIO declarado de su mismo archivo que la llama.
 *  • `la-bloquea-su-puerta` — ayudante que recibe la orden ya comprobada. NOMBRA a sus puertas y se
 *    comprueba que existen, que lo llaman y que ellas sí están guardadas.
 *  • `finanzas` / `mrp` / `rc` — las EXCEPCIONES de Daniel (decisiones 2 y 3). Se comprueba lo
 *    INVERSO: que NO llaman la guarda. Meterla ahí es romper una decisión del dueño (el maquilero se
 *    quedaría sin cobrar; la RC atrasada no se podría capturar; el MRP dejaría de netear).
 *  • `pendiente-daniel` — las dudas C1–C7 de §Post-F9.244, construidas con su DEFAULT. `libre` ⇒ NO
 *    llama la guarda; `bloquear` ⇒ SÍ. Cambiar el default es cambiar el renglón (y se ve en el diff).
 *  • `migracion` — funciones `*Migrad*` del ETL. NUNCA llevan la guarda (cargan histórico, y ningún
 *    cargador escribe `cerradaEn`).
 *  • `crea-la-orden` — la orden nace en esa misma transacción: no puede estar cerrada.
 *  • `es-el-cierre` — cerrar/reabrir mismos (toman el candado EXCLUSIVO).
 *  • `derivado` — recalcula un espejo (estado de la orden, estatus de la OC) desde lo ya escrito.
 *  • `exenta-decidida` — exención escrita y razonada (cerrar la receta, V1-E8z).
 *  • `no-aplica` — menciona una orden sólo como ORIGEN de un acto de catálogo.
 *
 * ⚠️ **Lo que SÍ y NO garantiza.** Garantiza que ninguna función escriba con una orden sin que alguien
 * haya declarado —y la prueba comprobado— qué hace con el cierre. NO garantiza que la llamada esté en
 * el sitio correcto dentro de la función; eso lo cubren las pruebas de conducta
 * (`orden-cerrada-puertas.int.test.ts`). Atribuye por binding con un REGEX, no con un parser: las
 * formas que reconoce son las del molde.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** La raíz del BACKEND. */
const RAIZ_BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Los métodos de Prisma que ESCRIBEN. */
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
 * ESCRIBE: un método de escritura de Prisma sobre un modelo (`tx.algo.create(`), o una llamada al
 * motor de kardex (que escribe movimientos sin nombrar la tabla). El `(?<!function\s+)` evita que la
 * DECLARACIÓN de una función homónima cuente como llamada.
 */
const ESCRIBE = new RegExp(
  `\\.[a-zA-Z]+\\.(?:${ESCRITURAS.join('|')})\\s*\\(` +
    `|(?<!function\\s+)\\b(?:registrarMovimiento|registrarTraspaso|cancelarMovimiento)[A-Za-z]*\\s*\\(`,
);

/**
 * HABLA DE UNA ORDEN: el id directo, las dos indirectas por las que se llega a ella (el renglón de OC
 * y el `origenId` polimórfico del kardex), o escribir la tabla `orden` misma.
 */
const CON_ORDEN = new RegExp(
  `\\bidOrden\\b|\\bidOrdenCompraLinea\\b|\\borigenId\\b|\\.orden\\.(?:${ESCRITURAS.join('|')})\\s*\\(`,
);

const ESCRIBE_CON_ORDEN = (codigo: string): boolean =>
  ESCRIBE.test(codigo) && CON_ORDEN.test(codigo);

/** La guarda CON CANDADO (las dos formas que la toman). */
const LLAMA_GUARDA = /\b(?:exigirOrdenesAbiertas|exigirOrdenAbiertaPorId)\s*\(/;

/** Quita comentarios (sin llevarse el código que va delante de un `//`, ni las URLs). */
function sinComentarios(codigo: string): string {
  return codigo.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/(?<!:)\/\/[^\n]*/g, '');
}

const DECLARACION_FUNCION =
  /^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm;
const DECLARACION_BINDING =
  /^(?:export\s+(?:default\s+)?)?(?:abstract\s+)?(?:const|let|var|class)\s+([A-Za-z0-9_$]+)/gm;

interface Trozo {
  nombre: string;
  codigo: string;
}

/** Reparte el archivo en trozos, uno por binding de nivel superior (mismo repartidor del molde). */
function trozosDe(codigo: string): Trozo[] {
  const marcas = [
    ...[...codigo.matchAll(DECLARACION_FUNCION)].map((m) => ({ pos: m.index, nombre: m[1] ?? '' })),
    ...[...codigo.matchAll(DECLARACION_BINDING)].map((m) => ({ pos: m.index, nombre: m[1] ?? '' })),
  ].sort((a, b) => a.pos - b.pos);
  return marcas.map((marca, i) => ({
    nombre: marca.nombre,
    codigo: codigo.slice(marca.pos, marcas[i + 1]?.pos ?? codigo.length),
  }));
}

// ── La declaración ──────────────────────────────────────────────────────────────────────────────

type Disciplina =
  | 'guarda'
  | 'la-bloquea-su-puerta'
  | 'finanzas'
  | 'mrp'
  | 'rc'
  | 'pendiente-daniel'
  | 'migracion'
  | 'crea-la-orden'
  | 'es-el-cierre'
  | 'derivado'
  | 'exenta-decidida'
  | 'no-aplica';

interface Declarada {
  disciplina: Disciplina;
  /**
   * Con `la-bloquea-su-puerta`: sus puertas (`nombre` del mismo archivo, o `archivo::nombre`). Tienen
   * que ser, junto con `otrosLlamadores`, EXACTAMENTE todas las funciones que lo llaman.
   */
  puertas?: string[];
  /** Con `pendiente-daniel`: la duda de §Post-F9.244 y el default con el que se construyó. */
  duda?: { id: 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7'; porDefecto: 'libre' | 'bloquear' };
  /**
   * Con `la-bloquea-su-puerta`: los llamadores que NO son puertas guardadas pero tienen su propia
   * disciplina declarada en algún mapa (p. ej. `crea-la-orden`): `archivo::nombre` → razón.
   */
  otrosLlamadores?: Record<string, string>;
  razon: string;
}

const D = 'src/dominio/';

/**
 * ENVOLTORIOS: funciones que toman la guarda en nombre de sus puertas (están en el mismo archivo).
 * Cada uno se comprueba que de verdad llama la guarda con candado.
 */
const ENVOLTORIOS: Record<string, string[]> = {
  [`${D}produccion/etapas.ts`]: ['resolverOrden'],
  [`${D}produccion/recibos.ts`]: ['resolverOrden'],
  [`${D}produccion/entregas-cliente.ts`]: ['resolverOrden'],
  [`${D}produccion/receta-orden.ts`]: ['enRecetaEditable'],
  [`${D}inventarios/movimientos-pt.ts`]: ['validarOrdenesDeLaEmpresa'],
  [`${D}inventarios/entradas-tela.ts`]: ['exigirOrdenesAbiertasDeRenglonesOC'],
  [`${D}desarrollo/liga-orden.ts`]: ['ligarOrdenNucleo'],
};

const G = (razon: string): Declarada => ({ disciplina: 'guarda', razon });
const FIN = (razon: string): Declarada => ({ disciplina: 'finanzas', razon });
const RC = (razon: string): Declarada => ({ disciplina: 'rc', razon });
const MIG: Declarada = {
  disciplina: 'migracion',
  razon:
    'ETL del histórico de Access: no pasa por las puertas y ningún cargador escribe `cerradaEn`.',
};
const C = (
  id: NonNullable<Declarada['duda']>['id'],
  porDefecto: 'libre' | 'bloquear',
  razon: string,
): Declarada => ({ disciplina: 'pendiente-daniel', duda: { id, porDefecto }, razon });

/**
 * ⭐ TODA función de `src/dominio` que escribe con una orden, con su disciplina. Tiene que coincidir
 * EXACTAMENTE con lo que el barrido encuentra (ni una de más, ni una de menos).
 */
const ESCRITORES: Record<string, Record<string, Declarada>> = {
  // ── Calidad (A) ──
  [`${D}calidad/auditorias.ts`]: {
    crearAuditoria: G('Auditar una orden cerrada no.'),
    capturarResultado: G('El resultado es captura sobre la orden.'),
    reclasificar: G('Mueve PT entre Primeras y Segundas en el bucket de la orden.'),
    modificarAuditoria: G('Modificar la auditoría de una orden cerrada no.'),
    cancelarAuditoria: G('Las cancelaciones también se bloquean (D3, precedente 0.061).'),
    crearAuditoriaMigrada: MIG,
  },
  // ── Catálogos ──
  [`${D}catalogos/colores-fusion-referencias.ts`]: {
    REFERENCIAS_DE_COLOR: {
      disciplina: 'no-aplica',
      razon:
        'Fusionar colores es un acto de CATÁLOGO: repunta el amarre de color de tela de las órdenes ' +
        'que usaban el absorbido (ya lo hacía antes de la 0.257, sin mencionar `idOrden`) y, desde la ' +
        '0.257, sube la versión de su receta para que la previa pida re-explotar. No es una captura ' +
        'sobre la orden: no mueve producción, ni costo, ni dinero.',
    },
  },
  // ── Compras (A, salvo lo dicho) ──
  [`${D}compras/color-de-la-tela.ts`]: {
    asignarColorDeTela: G('Escribe la receta CONGELADA de la orden (puerta trasera de la receta).'),
    fijarPrecioDeColor: {
      disciplina: 'no-aplica',
      razon:
        'Escribe el CATÁLOGO (precio del color); la orden sólo viaja como ORIGEN de la bitácora.',
    },
  },
  [`${D}compras/dado-por-cubierto.ts`]: {
    darPorCubierto: C('C6', 'libre', '«Con esto queda cubierto» es una marca del comprador.'),
  },
  [`${D}compras/migracion.ts`]: { crearOCMigrada: MIG },
  [`${D}compras/mrp.ts`]: {
    explosionarUna: {
      disciplina: 'mrp',
      razon:
        'La explosión netea contra lo histórico: MARCA la cerrada, no la esconde (decisión 3).',
    },
    escribirDadosPorCubierto: {
      disciplina: 'mrp',
      razon:
        'Corre dentro de `generarOCDesdeExplosion`, DESPUÉS de `crearOC` —que sí bloquea la cerrada—: ' +
        'sólo marca lo que de verdad se compró.',
    },
  },
  [`${D}compras/ordenes-compra.ts`]: {
    crearOC: G('No se le compra a una orden cerrada (cubre la OC que genera la explosión).'),
    actualizarOC: G('Las líneas que se escriben no pueden comprarle a una cerrada.'),
    autorizarOC: G('Autorizar compromete el dinero contra las órdenes ligadas.'),
    crearLineas: {
      disciplina: 'la-bloquea-su-puerta',
      puertas: ['crearOC', 'actualizarOC'],
      razon: 'Ayudante que escribe las líneas ya validadas por su puerta.',
    },
    sincronizarOrdenesLigadas: {
      disciplina: 'la-bloquea-su-puerta',
      puertas: ['crearOC', 'actualizarOC'],
      razon: 'Re-deriva la N:N OC↔orden de las líneas ya validadas por su puerta.',
    },
  },
  [`${D}compras/proveedor-de-orden.ts`]: {
    asignarProveedorDeMaterial: G('Escribe la receta CONGELADA (proveedor/precio de compra).'),
  },
  [`${D}compras/recepciones.ts`]: {
    recibirCompra: G('Recibir material de una orden cerrada es un movimiento sobre ella.'),
    reversarRecepcion: G('Reversar saca del kardex lo recibido contra esa orden.'),
    registrarRecepcionesDesdeEntradaTela: {
      disciplina: 'la-bloquea-su-puerta',
      puertas: [`${D}inventarios/entradas-tela.ts::confirmarEnTransaccion`],
      razon: 'Corre DENTRO de la confirmación de la entrada de tela, que ya tomó la guarda.',
    },
    recalcularEstatusOC: {
      disciplina: 'derivado',
      razon: 'Re-deriva el estatus de la OC de lo recibido; no captura nada.',
    },
  },
  // ── Costos (A, ya de 0.061) ──
  [`${D}costos/costo-orden.ts`]: {
    guardarCostoOrden: G('La orden cerrada tiene el costo congelado.'),
  },
  // ── Desarrollo (C5: default BLOQUEAR) ──
  [`${D}desarrollo/liga-orden.ts`]: {
    ligarOrdenNucleo: C('C5', 'bloquear', 'Ligar cambia de qué negociación salió su precio.'),
    quitarLiga: C('C5', 'bloquear', 'Desligar, tampoco.'),
  },
  // ── Finanzas (B: decisión 2) ──
  [`${D}edr/edr.ts`]: {
    generarEdrMes: FIN('El EDR sigue vivo con la orden cerrada.'),
    agregarLineaManual: FIN('Ajuste manual del EDR.'),
  },
  [`${D}esma/migracion.ts`]: { crearCargoEsMaMigrado: MIG },
  [`${D}esma/orden-pagada.ts`]: {
    recalcularOrdenPagada: FIN(
      'Escribe `Orden.pagada` desde los pagos de EsMa: excepción legítima.',
    ),
    forzarOrdenPagada: FIN('Ídem, por la vía manual.'),
  },
  [`${D}esma/pagos.ts`]: {
    aplicarACargos: FIN('La cobranza del maquilero se entra por MAQUILERO, no por orden.'),
    crearPagoMaquilero: FIN('Pagar al maquilero de una orden cerrada tiene que poder hacerse.'),
    cancelarPagoMaquileroInterno: FIN('Cancelar un pago es Finanzas.'),
    recapturarPagoCorregido: FIN('Corregir un pago es Finanzas.'),
  },
  // ── Indicadores (C1, C7) ──
  [`${D}indicadores/ciclico/avio.ts`]: {
    adaptadorAvio: C('C1', 'libre', 'Ajuste del inventario cíclico.'),
  },
  [`${D}indicadores/ciclico/pt.ts`]: {
    adaptadorPt: C('C1', 'libre', 'Ajuste del inventario cíclico de PT.'),
  },
  [`${D}indicadores/ciclico/tela.ts`]: {
    adaptadorTela: C('C1', 'libre', 'Ajuste del inventario cíclico.'),
  },
  [`${D}indicadores/fichas.ts`]: {
    verificarFichaOrden: C('C7', 'libre', 'Marcar la ficha como confiable no mueve nada.'),
  },
  [`${D}indicadores/migracion.ts`]: { crearInventarioCiclicoMigrado: MIG },
  // ── Inventarios (A) ──
  [`${D}inventarios/entradas-tela.ts`]: {
    crearEntradaTela: G('No se le recibe tela a una orden cerrada.'),
    actualizarEntradaTela: G('Ídem, en la edición del borrador.'),
    confirmarEnTransaccion: G('Confirmar mete la tela al kardex y recibe contra la OC.'),
    cancelarEntradaTela: G('Cancelar una entrada CONFIRMADA saca la tela y reversa lo recibido.'),
  },
  [`${D}inventarios/migracion.ts`]: {
    crearMovimientoIptMigrado: MIG,
    crearMovimientoTelaMigrado: MIG,
  },
  [`${D}inventarios/movimientos-pt.ts`]: {
    cancelarMovimientoPt: G('Cancelar es un inverso sobre el bucket de esa orden.'),
  },
  [`${D}inventarios/partidas-telas.ts`]: {
    registrarSalidaTelaColorAOrden: G('A una orden cerrada no se le saca tela.'),
    cancelarMovimientoTelaColor: G('Cancelar una SALIDA A ORDEN de una cerrada, tampoco.'),
  },
  [`${D}inventarios/telas.ts`]: {
    registrarSalidaTelaAOrden: G('La gemela legada no puede ser la puerta trasera.'),
    cancelarMovimientoTela: G('Ídem, su cancelación legada.'),
  },
  // ── Notas de salida (A) ──
  [`${D}notas/migracion.ts`]: { crearNotaMigrada: MIG },
  [`${D}notas/notas-salida.ts`]: {
    crearNotaSalida: G('Una nota que surte a una orden cerrada no se crea.'),
    actualizarNotaSalida: G('Los renglones nuevos tampoco.'),
    confirmarNotaSalida: G('Confirmar descuenta avíos contra las órdenes de sus renglones.'),
    cancelarNotaSalida: G('Cancelar una CONFIRMADA devuelve avíos (el borrador es C2, libre).'),
    crearRenglones: {
      disciplina: 'la-bloquea-su-puerta',
      puertas: ['crearNotaSalida', 'actualizarNotaSalida'],
      razon: 'Ayudante que escribe los renglones ya validados por su puerta.',
    },
  },
  // ── Pedidos ──
  [`${D}pedidos/importacion-pdf.ts`]: {
    crearOrdenDesdePdf: {
      disciplina: 'crea-la-orden',
      razon: 'Nace la orden del PDF del cliente.',
    },
  },
  [`${D}pedidos/importacion.ts`]: {
    confirmarImportacion: { disciplina: 'crea-la-orden', razon: 'Nacen las órdenes del Excel.' },
  },
  [`${D}pedidos/pedidos.ts`]: {
    cancelarPedido: G('La cascada conserva la cerrada; la guarda con candado es su cinturón.'),
  },
  // ── Producción ──
  [`${D}produccion/adjuntos-orden.ts`]: {
    solicitarSubidaAdjunto: C('C4', 'libre', 'Un adjunto es documentación, no movimiento.'),
    eliminarAdjunto: C('C4', 'libre', 'Ídem.'),
  },
  [`${D}produccion/cierre-maquila.ts`]: {
    cerrarOrdenMaquila: G('Saldar con un maquilero es escritura sobre la orden (0.061).'),
    deshacerCierreMaquila: G('Deshacerlo, también (0.061).'),
  },
  [`${D}produccion/cierre-orden.ts`]: {
    cerrarOrden: { disciplina: 'es-el-cierre', razon: 'El acto mismo; toma el candado EXCLUSIVO.' },
    reabrirOrden: { disciplina: 'es-el-cierre', razon: 'El inverso auditado; candado EXCLUSIVO.' },
    congelarCostoDeOrden: { disciplina: 'es-el-cierre', razon: 'Corre dentro de `cerrarOrden`.' },
  },
  [`${D}produccion/entregas-cliente.ts`]: {
    registrarEntregaCliente: G('Vía `resolverOrden` (0.061).'),
    cancelarEntregaCliente: G('Cancelar mueve el inventario y el divisor `vendido` (0.061).'),
  },
  [`${D}produccion/etapas.ts`]: {
    registrarCorte: G('Vía `resolverOrden` (0.061).'),
    registrarEmpaque: G('Vía `resolverOrden` (0.061).'),
    registrarEnvioMaquila: G('Vía `resolverOrden` (0.061).'),
    cancelarEtapaMovimiento: G('Cancelar una etapa mueve las cantidades (0.061).'),
    crearCargoDeServicio: {
      disciplina: 'la-bloquea-su-puerta',
      puertas: ['registrarCorte', 'registrarEmpaque'],
      razon: 'Cargo EsMa del servicio, dentro de la etapa ya guardada.',
    },
  },
  [`${D}produccion/fotos-arte-orden.ts`]: {
    ocultarFotoArteEnOrden: C('C4', 'libre', 'Fotos: documentación, no movimiento.'),
    mostrarFotoArteEnOrden: C('C4', 'libre', 'Ídem.'),
    solicitarSubidaFotoArteOrden: C('C4', 'libre', 'Ídem.'),
    quitarFotoArteOrden: C('C4', 'libre', 'Ídem.'),
  },
  [`${D}produccion/fotos-ocultas-orden.ts`]: {
    ocultarFotoModeloEnOrden: C('C4', 'libre', 'Ídem.'),
    mostrarFotoModeloEnOrden: C('C4', 'libre', 'Ídem.'),
  },
  [`${D}produccion/migracion.ts`]: {
    crearOrdenMigrada: MIG,
    agregarReferenciasOrdenMigrada: MIG,
    crearComentarioOrdenMigrado: MIG,
    crearEtapaMigrada: MIG,
  },
  [`${D}produccion/ordenes.ts`]: {
    crearOrden: { disciplina: 'crea-la-orden', razon: 'La orden nace aquí.' },
    actualizarOrden: G('Encabezado (0.061).'),
    cancelarOrden: G('Dos finales a la vez no (0.061).'),
    guardarReferenciasOrden: G('Referencias del cliente (0.061).'),
    agregarComentarioOrden: C('C4', 'libre', 'Un comentario es documentación, no movimiento.'),
    sincronizarMatriz: {
      disciplina: 'la-bloquea-su-puerta',
      puertas: ['guardarMatrizOrden', 'copiarDetalleOrden'],
      otrosLlamadores: {
        [`${D}produccion/ordenes.ts::crearOrden`]: 'Crea la orden: no puede estar cerrada.',
      },
      razon: 'Ayudante de la matriz.',
    },
    sincronizarReferencias: {
      disciplina: 'la-bloquea-su-puerta',
      puertas: ['guardarReferenciasOrden'],
      otrosLlamadores: {
        [`${D}produccion/salida-produccion.ts::salidaAProduccion`]:
          'Crea la orden en la misma transacción: no puede estar cerrada.',
      },
      razon: 'Ayudante de referencias.',
    },
  },
  [`${D}produccion/precios-orden.ts`]: {
    actualizarPreciosOrden: G('El precio de maquila es componente del costo (0.061).'),
  },
  [`${D}produccion/receta-orden.ts`]: {
    copiarRecetaDelModelo: { disciplina: 'crea-la-orden', razon: 'Congela la receta AL CREAR.' },
    agregarRenglonReceta: G('Vía `enRecetaEditable`.'),
    editarRenglonReceta: G('Vía `enRecetaEditable`.'),
    corregirCapturaAvio: G('Vía `enRecetaEditable`.'),
    quitarRenglonReceta: G('Vía `enRecetaEditable`.'),
    restaurarRenglonReceta: G('Vía `enRecetaEditable`.'),
    marcarRecetaRevisada: G('Vía `enRecetaEditable`.'),
    liberarReceta: G('Vía `enRecetaEditable`.'),
    abrirReceta: G('Vía `enRecetaEditable`.'),
    traerDelModelo: G('Vía `enRecetaEditable`.'),
    cerrarReceta: {
      disciplina: 'exenta-decidida',
      razon:
        'V1-E8z: cerrar la receta de una orden cerrada o cancelada tiene que poder hacerse (si no, ' +
        'el candado quedaría puesto para siempre); no toca ni un renglón.',
    },
    revocarFirmaDeRenglones: {
      disciplina: 'la-bloquea-su-puerta',
      puertas: ['enRecetaEditable'],
      razon: 'Corre dentro de `enRecetaEditable`, después de la guarda.',
    },
    sincronizarLiberacionOrden: {
      disciplina: 'la-bloquea-su-puerta',
      puertas: ['enRecetaEditable'],
      razon: 'Ídem.',
    },
  },
  [`${D}produccion/recibos.ts`]: {
    registrarReciboMaquila: G('Vía `resolverOrden` (0.061).'),
    cancelarReciboMaquila: G('Cancelar mueve inventario y divisor (0.061).'),
  },
  [`${D}produccion/requisitos-orden.ts`]: {
    recalcularEstadoOrden: {
      disciplina: 'derivado',
      razon: 'Espejo derivado; no mueve `cerrada`.',
    },
    recalcularEstadoOrdenesDeModelo: { disciplina: 'derivado', razon: 'Ídem, por modelo.' },
    realinearEstadoOrdenes: { disciplina: 'derivado', razon: 'Ídem (script de realineación).' },
  },
  [`${D}produccion/transito.ts`]: {
    traspasarPrendasATransito: {
      disciplina: 'la-bloquea-su-puerta',
      puertas: [`${D}produccion/etapas.ts::registrarEnvioMaquila`],
      razon: 'Sólo la llama el envío, ya guardado.',
    },
    devolverPrendasDeTransito: {
      disciplina: 'la-bloquea-su-puerta',
      puertas: [`${D}produccion/recibos.ts::registrarReciboMaquila`],
      razon: 'Sólo la llama el recibo, ya guardado.',
    },
    darSalidaMermaIncompletas: {
      disciplina: 'la-bloquea-su-puerta',
      puertas: [`${D}produccion/recibos.ts::registrarReciboMaquila`],
      razon: 'Ídem.',
    },
    revertirMovimientosDeHecho: {
      disciplina: 'la-bloquea-su-puerta',
      puertas: [
        `${D}produccion/etapas.ts::cancelarEtapaMovimiento`,
        `${D}produccion/recibos.ts::cancelarReciboMaquila`,
      ],
      razon: 'Sólo la llaman las dos cancelaciones, ya guardadas.',
    },
  },
  // ── Ruta crítica (B: decisión 3, y C3) ──
  [`${D}ruta-critica/autoAvance.ts`]: {
    aplicarAProceso: RC('El auto-avance escribe `rcActiva`: excepción legítima.'),
  },
  [`${D}ruta-critica/cpm-job.ts`]: {
    recalcularRutaOrden: RC('Recálculo automático del CPM: sigue a la RC.'),
  },
  [`${D}ruta-critica/cumplimiento.ts`]: {
    completarProceso: RC('La RC se captura tarde a propósito (base del KPI de puntualidad, D11).'),
    revertirProceso: RC('Ídem.'),
    activarProcesosListos: RC('Ídem.'),
    marcarChecklistItem: RC('Ídem.'),
  },
  [`${D}ruta-critica/estampado.ts`]: {
    elegirSecuenciaEstampado: C('C3', 'libre', 'Plan de la RC.'),
  },
  [`${D}ruta-critica/hitosOrden.ts`]: {
    registrarHito: RC('Hitos de la RC.'),
    cancelarHito: RC('Ídem.'),
  },
  [`${D}ruta-critica/migracion.ts`]: {
    crearRutaOrdenMigrada: MIG,
    fijarEstadoRcOrdenMigrado: MIG,
  },
  [`${D}ruta-critica/rutaOrden.ts`]: {
    generarRutaOrden: C('C3', 'libre', 'Plan de la RC.'),
    ajustarRutaOrden: C('C3', 'libre', 'Plan de la RC.'),
  },
};

/**
 * ⭐ PUERTAS QUE EL BARRIDO NO VE (escriben por un ayudante, sin nombrar la orden en su cuerpo) pero
 * que §Post-F9.244 cuenta como puertas (A). Se exige que existan y que estén guardadas.
 */
const PUERTAS_INDIRECTAS: Record<string, Record<string, Declarada>> = {
  [`${D}inventarios/movimientos-pt.ts`]: {
    registrarMovimientoPt: G('Vía `validarOrdenesDeLaEmpresa` (bucket de orden).'),
    registrarTraspasoPt: G('Ídem, en las dos patas.'),
  },
  [`${D}produccion/ordenes.ts`]: {
    guardarMatrizOrden: G('La matriz manda las cantidades pedidas (0.061).'),
    copiarDetalleOrden: G('Copiar ENCIMA es escribir la matriz (0.061).'),
  },
  [`${D}compras/proveedor-de-orden.ts`]: {
    asignarProveedorDeMaterialEnBloque: G('En lote, nombra todas las cerradas.'),
  },
  [`${D}desarrollo/liga-orden.ts`]: {
    ligarOrden: G('La operación manual delega en el núcleo, que lleva la guarda (C5).'),
  },
  // No es puerta: es un LLAMADOR de ayudantes declarados que el barrido no ve. Se declara para que
  // `otrosLlamadores` de `sincronizarReferencias` apunte a algo con disciplina escrita.
  [`${D}produccion/salida-produccion.ts`]: {
    salidaAProduccion: {
      disciplina: 'crea-la-orden',
      razon:
        'Nace la OP desde el desarrollo; la liga y las referencias son de una orden recién nacida.',
    },
  },
};

/**
 * ⭐ H5 — LAS DUDAS DE DANIEL QUE EL BARRIDO NO VE (escriben sin nombrar la orden a la vista), y que
 * se construyeron con su DEFAULT. Se comprueban igual que las de arriba: `libre` ⇒ NO llaman la
 * guarda. Si Daniel contesta distinto, se cambia el renglón y la puerta.
 */
const DUDAS_SIN_ORDEN_A_LA_VISTA: Record<string, Record<string, Declarada>> = {
  [`${D}compras/ordenes-compra.ts`]: {
    cancelarOC: C(
      'C2',
      'libre',
      'Cancelar una OC sin recibir de una orden cerrada no compra nada.',
    ),
    desautorizarOC: C('C2', 'libre', 'Desautorizarla, tampoco.'),
  },
  [`${D}indicadores/inventario-ciclico.ts`]: {
    capturarConteo: C('C1', 'libre', 'Contar es inventario, no captura de la orden.'),
    agregarRenglonCiclico: C('C1', 'libre', 'Ídem.'),
    generarAjusteCiclico: C(
      'C1',
      'libre',
      'El ajuste del cíclico (su adaptador PT es C1 también).',
    ),
  },
};

/**
 * ⭐ LAS EXCEPCIONES DE DANIEL QUE NO ESCRIBEN CON `idOrden` A LA VISTA (no las ve el barrido), pero
 * que se AMARRAN igual: NO pueden llamar la guarda (decisiones 2 y 3).
 */
const EXCEPCIONES_SIN_ORDEN_A_LA_VISTA: Record<string, Record<string, Declarada>> = {
  [`${D}esma/cargos.ts`]: {
    validarCargoEsMa: FIN('El dinero del maquilero se fija al VALIDAR; nunca carga la orden.'),
  },
  [`${D}esma/movimientos.ts`]: {
    crearAbonoMaquilero: FIN('Cuenta del maquilero.'),
    crearDescuentoMaquilero: FIN('Cuenta del maquilero.'),
    revisarMovimiento: FIN('Cuenta del maquilero.'),
  },
  [`${D}esma/correccion.ts`]: { corregirMovimientoEsMa: FIN('Cuenta del maquilero.') },
  [`${D}esma/pagos.ts`]: { crearPagoACuentaMaquilero: FIN('Cuenta del maquilero.') },
  [`${D}edr/edr.ts`]: {
    ajustarLineaEdr: FIN('EDR.'),
    eliminarLineaManual: FIN('EDR.'),
    actualizarEncabezado: FIN('EDR.'),
  },
  [`${D}compras/mrp.ts`]: {
    explosionarOrdenes: { disciplina: 'mrp', razon: 'Decisión 3: el MRP marca, no esconde.' },
    explosionarOrden: { disciplina: 'mrp', razon: 'Ídem.' },
  },
};

// ── El barrido ──────────────────────────────────────────────────────────────────────────────────

const CARPETAS_FUERA = ['src/datos/generated', 'src/pruebas'];

function fuentes(carpeta: string, acumulado: string[] = []): string[] {
  for (const entrada of readdirSync(carpeta)) {
    const completa = path.join(carpeta, entrada);
    const relativa = path.relative(RAIZ_BACKEND, completa).replaceAll(path.sep, '/');
    if (CARPETAS_FUERA.some((fuera) => relativa === fuera || relativa.startsWith(`${fuera}/`))) {
      continue;
    }
    if (statSync(completa).isDirectory()) {
      fuentes(completa, acumulado);
    } else if (entrada.endsWith('.ts') && !entrada.endsWith('.test.ts')) {
      acumulado.push(relativa);
    }
  }
  return acumulado;
}

/**
 * Si `archivo` importa `nombre` desde `origen` (con `import { … } from '…'`), devuelve el nombre con
 * el que lo usa (`x as y` ⇒ `y`); si no, `null`. Sirve para buscar LLAMADORES por fuera del archivo
 * del ayudante sin confundirlo con un homónimo de otro módulo (hay dos `crearRenglones`).
 */
function nombreImportado(
  archivo: string,
  codigoArchivo: string,
  nombre: string,
  origen: string,
): string | null {
  for (const m of codigoArchivo.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    const espec = m[2] ?? '';
    if (!espec.startsWith('.')) continue;
    const resuelto = path.posix
      .normalize(path.posix.join(path.posix.dirname(archivo), espec))
      .replace(/\.js$/, '.ts');
    if (resuelto !== origen) continue;
    for (const pieza of (m[1] ?? '').split(',')) {
      const [original, alias] = pieza
        .replace(/^\s*type\s+/, '')
        .split(/\s+as\s+/)
        .map((x) => x.trim());
      if (original === nombre) return alias ?? original;
    }
  }
  return null;
}

describe('El guardián de la ORDEN CERRADA (0.226a, §Post-F9.244)', () => {
  const archivos = fuentes(path.join(RAIZ_BACKEND, 'src', 'dominio'));
  /** TODO `src` (sin generados ni ayudas de prueba): los llamadores pueden vivir fuera de dominio. */
  const archivosSrc = fuentes(path.join(RAIZ_BACKEND, 'src'));
  const codigo = new Map(
    archivosSrc.map(
      (f) => [f, sinComentarios(readFileSync(path.join(RAIZ_BACKEND, f), 'utf8'))] as const,
    ),
  );
  const trozosPorArchivo = new Map(
    archivosSrc.map((f) => [
      f,
      new Map(trozosDe(codigo.get(f) ?? '').map((t) => [t.nombre, t.codigo])),
    ]),
  );
  const encontradas = archivos.flatMap((f) =>
    trozosDe(codigo.get(f) ?? '')
      .filter((t) => ESCRIBE_CON_ORDEN(t.codigo))
      .map((t) => `${f}::${t.nombre}`),
  );

  const cuerpo = (archivo: string, nombre: string): string =>
    trozosPorArchivo.get(archivo)?.get(nombre) ?? '';

  /** ¿Toma la guarda con candado, directo o por un envoltorio declarado de su archivo? */
  const estaGuardada = (archivo: string, nombre: string): boolean => {
    const c = cuerpo(archivo, nombre);
    if (LLAMA_GUARDA.test(c)) return true;
    return (ENVOLTORIOS[archivo] ?? []).some(
      (env) => env !== nombre && new RegExp(`\\b${env}\\s*\\(`).test(c),
    );
  };

  /**
   * ⭐ H1 — TODAS las funciones de `src` que llaman al ayudante `nombre` de `archivo`: las del mismo
   * archivo, y las de los archivos que lo IMPORTAN de ahí (por el nombre con que lo importan).
   */
  const llamadoresDe = (archivo: string, nombre: string): string[] => {
    const resultado: string[] = [];
    for (const f of archivosSrc) {
      const c = codigo.get(f) ?? '';
      const local = f === archivo ? nombre : nombreImportado(f, c, nombre, archivo);
      if (local === null) continue;
      const llamada = new RegExp(`(?<!function\\s+)\\b${local}\\s*\\(`);
      for (const t of trozosDe(c)) {
        if (f === archivo && t.nombre === nombre) continue;
        if (llamada.test(t.codigo)) resultado.push(`${f}::${t.nombre}`);
      }
    }
    return resultado.toSorted();
  };

  /** ¿Está `archivo::nombre` declarado en alguno de los mapas, con disciplina escrita? */
  const declaradaEnAlgunMapa = (clave: string): Declarada | undefined => {
    const i = clave.indexOf('::');
    const [a, n] = [clave.slice(0, i), clave.slice(i + 2)];
    for (const mapa of [
      ESCRITORES,
      PUERTAS_INDIRECTAS,
      EXCEPCIONES_SIN_ORDEN_A_LA_VISTA,
      DUDAS_SIN_ORDEN_A_LA_VISTA,
    ]) {
      const dec = mapa[a]?.[n];
      if (dec !== undefined) return dec;
    }
    return undefined;
  };

  /** Resuelve `nombre` o `archivo::nombre` de una puerta. */
  const puertaDe = (archivo: string, puerta: string): [string, string] => {
    const i = puerta.indexOf('::');
    return i === -1 ? [archivo, puerta] : [puerta.slice(0, i), puerta.slice(i + 2)];
  };

  it('la prueba está mirando el código de verdad (si no, no vigila nada)', () => {
    expect(archivos.length).toBeGreaterThan(100);
    expect(archivos).toContain(`${D}produccion/cierre-orden.ts`);
    expect(encontradas.length).toBeGreaterThan(80);
  });

  it('🔴 el barrido VE una función nueva que escribe con una orden (la mutación 4, como dato)', () => {
    const texto = [
      'export async function ancla(tx: Tx) {',
      '  return tx;',
      '}',
      'export async function puertaNuevaSinDeclarar(tx: Tx, idOrden: number) {',
      '  await tx.algoNuevo.create({ data: { idOrden } });',
      '}',
      'export const otraPorArrow = async (tx: Tx, d: { idOrdenCompraLinea: number }) => {',
      '  await registrarMovimientoAvio(sesion, d, { tx });',
      '};',
    ].join('\n');
    const nuevas = trozosDe(texto)
      .filter((t) => ESCRIBE_CON_ORDEN(t.codigo))
      .map((t) => t.nombre);
    expect(nuevas).toEqual(['puertaNuevaSinDeclarar', 'otraPorArrow']);
    // Y una LECTURA no cuenta como escritura.
    expect(ESCRIBE_CON_ORDEN('await tx.orden.findMany({ where: { idOrden } })')).toBe(false);
    // Ni la DECLARACIÓN de una función homónima del motor.
    expect(ESCRIBE.test('export async function registrarMovimientoPt(')).toBe(false);
  });

  it('⭐⭐ TODA función que escribe con una orden está DECLARADA, y ninguna declarada sobra', () => {
    const declaradas = Object.entries(ESCRITORES)
      .flatMap(([archivo, fns]) => Object.keys(fns).map((nombre) => `${archivo}::${nombre}`))
      .toSorted();
    expect(
      encontradas.toSorted(),
      'Cambió el conjunto de funciones que ESCRIBEN con una orden. Si nació una puerta nueva, ' +
        'declárala arriba con su disciplina frente a la orden CERRADA (lo normal: `guarda`, ' +
        'llamando a `exigirOrdenesAbiertas`/`exigirOrdenAbiertaPorId` como PRIMERA instrucción de ' +
        'su transacción). Sin eso, una orden cerrada volvería a admitir movimientos por esa puerta. ' +
        'Si una desapareció o se renombró, bórrala de la declaración.',
    ).toEqual(declaradas);
  });

  /** Comprueba UNA declaración (de cualquiera de los tres mapas). */
  function comprobar(archivo: string, nombre: string, dec: Declarada): void {
    const c = cuerpo(archivo, nombre);
    expect(c, `${archivo}::${nombre} no aparece en el archivo`).not.toBe('');
    const guardada = estaGuardada(archivo, nombre);
    const quien = `${archivo}::${nombre}`;
    switch (dec.disciplina) {
      case 'guarda':
        expect(guardada, `${quien} declara \`guarda\` y no toma la guarda con candado`).toBe(true);
        break;
      case 'finanzas':
      case 'mrp':
      case 'rc':
        expect(
          guardada,
          `${quien} es una EXCEPCIÓN de Daniel (${dec.disciplina}) y llama la guarda: rompe su ` +
            'decisión (§Post-F9.244, decisiones 2 y 3). Si de verdad cambió, que la cambie él.',
        ).toBe(false);
        break;
      case 'pendiente-daniel': {
        const duda = dec.duda;
        expect(duda, `${quien} es pendiente-daniel sin duda declarada`).toBeDefined();
        expect(
          guardada,
          `${quien}: duda ${duda?.id ?? '?'} se construyó con default «${duda?.porDefecto ?? '?'}» ` +
            'y el código no lo cumple. Si Daniel ya contestó, cambia el renglón.',
        ).toBe(duda?.porDefecto === 'bloquear');
        break;
      }
      case 'migracion':
        expect(nombre, `${quien} se declara migración pero no es una *Migrad*`).toMatch(
          /Migrad[ao]/,
        );
        expect(guardada, `${quien}: la guarda NUNCA entra en el ETL`).toBe(false);
        break;
      case 'la-bloquea-su-puerta': {
        const puertas = dec.puertas ?? [];
        expect(puertas, `${quien} no nombró ninguna puerta`).not.toEqual([]);
        // ⭐ H1: las puertas nombradas (+ los otros llamadores declarados) tienen que ser TODOS los
        // que llaman al ayudante. Si no, una función nueva sin guarda que lo llame escribe con la
        // orden por la puerta de atrás y el guardián seguiría verde.
        const otros = Object.keys(dec.otrosLlamadores ?? {});
        const esperados = [
          ...puertas.map((p) => puertaDe(archivo, p).join('::')),
          ...otros,
        ].toSorted();
        expect(
          llamadoresDe(archivo, nombre),
          `${quien}: cambió QUIÉN llama a este ayudante. Cada llamador nuevo es una puerta: o toma ` +
            'la guarda y se añade a `puertas`, o tiene disciplina propia y va en `otrosLlamadores`.',
        ).toEqual(esperados);
        for (const o of otros) {
          expect(
            declaradaEnAlgunMapa(o),
            `${quien}: el llamador ${o} está en \`otrosLlamadores\` pero no tiene disciplina declarada`,
          ).toBeDefined();
        }
        for (const p of puertas) {
          const [archivoPuerta, nombrePuerta] = puertaDe(archivo, p);
          const cp = cuerpo(archivoPuerta, nombrePuerta);
          expect(cp, `la puerta ${p} de ${quien} ya no existe`).not.toBe('');
          expect(cp, `la puerta ${p} ya no llama a ${nombre}`).toMatch(
            new RegExp(`\\b${nombre}\\s*\\(`),
          );
          expect(
            estaGuardada(archivoPuerta, nombrePuerta),
            `la puerta ${p} dejó de tomar la guarda: ${nombre} escribe SIN que nadie mire el cierre`,
          ).toBe(true);
        }
        break;
      }
      case 'es-el-cierre':
        expect(archivo).toBe(`${D}produccion/cierre-orden.ts`);
        break;
      case 'exenta-decidida':
        expect(c, `${quien}: la exención se escribe con \`permitirOrdenNoViva: true\``).toContain(
          'permitirOrdenNoViva: true',
        );
        break;
      default:
        break;
    }
  }

  it('⭐ cada función CUMPLE la disciplina que declaró (no basta con declararla)', () => {
    for (const mapa of [
      ESCRITORES,
      PUERTAS_INDIRECTAS,
      EXCEPCIONES_SIN_ORDEN_A_LA_VISTA,
      DUDAS_SIN_ORDEN_A_LA_VISTA,
    ]) {
      for (const [archivo, fns] of Object.entries(mapa)) {
        for (const [nombre, dec] of Object.entries(fns)) {
          comprobar(archivo, nombre, dec);
        }
      }
    }
  });

  it('los ENVOLTORIOS declarados de verdad toman la guarda con candado', () => {
    for (const [archivo, envs] of Object.entries(ENVOLTORIOS)) {
      for (const env of envs) {
        expect(cuerpo(archivo, env), `${archivo}::${env} no existe`).not.toBe('');
        expect(cuerpo(archivo, env), `${archivo}::${env} dejó de tomar la guarda`).toMatch(
          LLAMA_GUARDA,
        );
      }
    }
  });

  it('🔴 R2 — ningún `import * as` RELATIVO en `src`: el barrido de llamadores no lo ve', () => {
    // `llamadoresDe` busca a quien llama a un ayudante por su NOMBRE importado. Con
    // `import * as tr from './transito.js'` + `tr.revertirMovimientosDeHecho(...)` el llamador
    // existe y el guardián no lo encuentra: una puerta trasera en verde (mutación del reviewer,
    // 8/8). Hoy no hay ninguno (medido); que siga sin haber.
    const conEspacioDeNombres = archivosSrc.filter((f) =>
      /\bimport\s+(?:type\s+)?\*\s+as\s+[A-Za-z0-9_$]+\s+from\s+'\./.test(codigo.get(f) ?? ''),
    );
    expect(
      conEspacioDeNombres,
      "Un `import * as x from './…'` esconde a sus llamadores del guardián de la orden CERRADA: " +
        "importa por nombre (`import { f } from './…'`) para que se vea quién llama a quién.",
    ).toEqual([]);
  });

  it('🔴 R2 — ningún RE-EXPORT relativo nuevo en `src/dominio` (tampoco los ve el barrido)', () => {
    // Un barril (`export { f } from './x.js'` o `export * from './x.js'`) deja importar el ayudante
    // desde OTRO módulo, y `llamadoresDe` sólo sigue los imports que apuntan al archivo que lo
    // declara. Los que existen hoy se listan con su razón; ninguno puede llevar un ayudante.
    const PERMITIDOS: Record<string, string> = {
      [`${D}catalogos/colores.ts`]:
        'Re-exporta `colorCanonico` (catálogo de colores): no escribe nada de una orden.',
    };
    const conReexport = archivos.filter((f) =>
      /^\s*export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+'\./m.test(codigo.get(f) ?? ''),
    );
    expect(
      conReexport.filter((f) => !(f in PERMITIDOS)),
      'Re-export relativo nuevo en `src/dominio`: el guardián de la orden CERRADA no ve a quien ' +
        'llame a un ayudante a través del barril. Importa del módulo que lo declara.',
    ).toEqual([]);
    // Y los permitidos no re-exportan a ningún ayudante declarado (ni con `*`).
    const ayudantes = new Set(
      [ESCRITORES, PUERTAS_INDIRECTAS].flatMap((m) =>
        Object.values(m).flatMap((fns) => Object.keys(fns)),
      ),
    );
    for (const f of conReexport) {
      for (const m of (codigo.get(f) ?? '').matchAll(
        /^\s*export\s+(?:type\s+)?(\*|\{[^}]*\})\s+from\s+'\./gm,
      )) {
        const lista = m[1] ?? '';
        expect(lista, `${f}: \`export * from\` relativo no se permite`).not.toBe('*');
        for (const pieza of lista.replace(/[{}]/g, '').split(',')) {
          const original =
            pieza
              .replace(/^\s*type\s+/, '')
              .split(/\s+as\s+/)[0]
              ?.trim() ?? '';
          expect(ayudantes.has(original), `${f} re-exporta ${original}`).toBe(false);
        }
      }
    }
  });

  it('🔴 la guarda PURA (sin candado) no existe en ninguna parte — ni declarada ni usada', () => {
    const usanPura = archivosSrc.filter((f) =>
      /\bexigirOrdenAbierta\s*\(/.test(codigo.get(f) ?? ''),
    );
    expect(
      usanPura,
      'La guarda pura no toma el candado compartido: una captura que la use puede escribir ' +
        'DESPUÉS de que el cierre congele el costo (0.226a la BORRÓ). Usa ' +
        '`exigirOrdenesAbiertas`/`exigirOrdenAbiertaPorId`.',
    ).toEqual([]);
  });

  it('🔴 ninguna función *Migrada ni ningún cargador del ETL toma la guarda', () => {
    const conGuarda: string[] = [];
    for (const f of archivos) {
      for (const t of trozosDe(codigo.get(f) ?? '')) {
        if (/Migrad[ao]/.test(t.nombre) && LLAMA_GUARDA.test(t.codigo)) {
          conGuarda.push(`${f}::${t.nombre}`);
        }
      }
    }
    for (const f of fuentes(path.join(RAIZ_BACKEND, 'migracion'))) {
      if (LLAMA_GUARDA.test(sinComentarios(readFileSync(path.join(RAIZ_BACKEND, f), 'utf8')))) {
        conGuarda.push(f);
      }
    }
    expect(conGuarda).toEqual([]);
  });

  it('⭐ cerrar y reabrir toman el candado EXCLUSIVO, y las dos formas de la guarda el COMPARTIDO', () => {
    const f = `${D}produccion/cierre-orden.ts`;
    expect(cuerpo(f, 'cerrarOrden')).toContain('bloquearOrdenParaCierre(tx, id)');
    expect(cuerpo(f, 'reabrirOrden')).toContain('bloquearOrdenParaCierre(tx, id)');
    expect(cuerpo(f, 'bloquearOrdenParaCierre')).toMatch(/pg_advisory_xact_lock\(/);
    expect(cuerpo(f, 'exigirOrdenesAbiertas')).toMatch(/pg_advisory_xact_lock_shared\(/);
    expect(cuerpo(f, 'exigirOrdenAbiertaPorId')).toContain('exigirOrdenesAbiertas(');
  });
});
