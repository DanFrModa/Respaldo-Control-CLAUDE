/**
 * Impreso de la ORDEN DE COMPRA (F4-E2) — el PDF que se le manda al proveedor para comprar
 * material (telas/avíos). Documento generado EN EL SERVIDOR con `@react-pdf/renderer`
 * (`renderToBuffer`), el mismo motor que los demás impresos del sistema (orden de producción,
 * envío de maquila, etc.). El frontend solo abre el blob.
 *
 * Decisiones del dueño (Daniel, cerradas):
 *  • (c) UN SOLO PDF de OC (se retiran las variantes viejas y el Excel). La matriz talla×color del
 *    renglón que la use se imprime como tabla. La cantidad del renglón = Σ de su matriz.
 *  • A diferencia de la orden de PRODUCCIÓN, la OC SÍ lleva importes (precio, importe, total): es un
 *    documento de COMPRA, no una hoja de piso.
 *  • ⭐ V1-E4e (§Post-F9.101) — **una OC sin autorizar NO se imprime**, *"ni aunque diga borrador.
 *    Para no generar confusiones con el proveedor"*. Un papel con membrete, folio, proveedor,
 *    materiales, cantidades y precios ES una orden de compra a los ojos de quien la recibe, diga lo
 *    que diga en una esquina; y un borrador todavía puede cambiar. **La autorización es la firma;
 *    sin firma no hay papel.** Lo niega {@link armarDatosImpresoOC} —en el SERVIDOR, no sólo
 *    escondiendo el botón (§Post-F9.68: esconder Y bloquear)— con el criterio COMPARTIDO
 *    `ESTATUS_OC_COMPROMETIDA`, el mismo que responde *"¿ya me comprometí con el proveedor?"* en el
 *    resto de compras. Un criterio, no dos.
 *  • ⭐ V1-E4e — **el COMPLEMENTO de la tela (el Cardigan) se IMPRIME.** No es una mejora suelta:
 *    hasta esta etapa el papel se callaba un material que el proveedor tiene que mandar **y aun así
 *    le cobraba** —`aCompraSalida` mete el complemento dentro del `subtotal`—, así que el renglón
 *    salía con `cantidad × precio ≠ importe` y sin decir por qué. Es exactamente *"la confusión con
 *    el proveedor"* que §Post-F9.101 vino a evitar, del otro lado del mismo papel. Ahora el renglón
 *    cuelga su complemento (espejo de la pantalla del comprador) y **enseña la suma**: cuerpo +
 *    complemento = importe del renglón. Ver {@link textosComplemento}.
 *  • ⭐⭐ V1-E4e (§Post-F9.102) — **el impreso se CONSOLIDA para el proveedor**: *"para el proveedor
 *    debe de salir solamente una sola cantidad sumando todo el rojo. Ya de manera interna se
 *    divide"*, y *"las órdenes a las que corresponden no son relevantes para el proveedor"*. Lo
 *    hace {@link consolidarRenglonesParaProveedor} (función PURA, A1: en el servidor; el PDF sólo
 *    pinta lo que le dan).
 *
 * Innegociables aplicados:
 *  • A1 — TODA la lógica de armado vive aquí (dominio); la ruta solo valida permiso+Zod y delega.
 *  • A4 — la autorización la hace `obtenerOC` (`verificarPermiso(sesion, 'compras.ver')`).
 *  • A9 — la OC se resuelve por `obtenerOC`, que filtra por la empresa activa de la sesión (una OC de
 *    otra empresa, para esta sesión, no existe → `ErrorNoEncontrado`/404).
 *  • REUSO — los datos se arman con `obtenerOC` (encabezado + líneas + matriz + total derivado). NO
 *    se reinventa la consulta ni el cálculo del total; el impreso es una vista del mismo dato.
 *
 * Es PURO sobre los datos: `armarDatosImpresoOC` resuelve (única parte que toca BD) y
 * `generarPdfOrdenCompra` recibe los datos ya resueltos (testeable sin BD). `obtenerOC` es un seam
 * inyectable para los tests.
 */
import { createElement as h, type ReactElement } from 'react';

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
  type DocumentProps,
} from '@react-pdf/renderer';

import { renderizarPdfEnWorker } from '../../../comun/pdf-worker.js';
import {
  estilosDoc,
  PALETA,
  EncabezadoDocumento,
  PieDocumento,
  TituloSeccion,
  BandaEstado,
} from '../../../comun/impresos-estilos.js';

import { ErrorValidacion } from '../../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../../comun/permisos.js';
import { type ContextoBd } from '../../../comun/transaccion.js';
import { redondear2 } from '../../costos/decimales.js';
import { ESTATUS_OC_COMPROMETIDA } from '../comprometido-en-oc.js';
import { obtenerOC } from '../ordenes-compra.js';
import { redondearCantidadCompra } from '../reparto-ordenes.js';
import { sumarDesgloses, type DesgloseMedida } from '../desglose-por-medida.js';

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/**
 * El COMPLEMENTO de una tela (el *Cardigan*) dentro de un renglón del impreso: **material adicional
 * que el proveedor tiene que surtir**, con su cantidad, su precio y la parte del importe que le
 * toca. `null` cuando el renglón no compra complemento — y entonces **no se pinta nada**: un renglón
 * fantasma en cero es ruido, no información.
 */
export interface ComplementoImpreso {
  /** Cómo se llama ("Cardigan"). Si la tela no lo nombra, "Complemento" — antes callar el dinero. */
  nombre: string;
  cantidad: number;
  /** Precio unitario EFECTIVO (el propio, o el del cuerpo si no tiene uno). */
  precio: number;
  /**
   * Parte del importe del renglón que corresponde al complemento.
   *
   * ⚠️ Se DERIVA por resta (`importe − importeCuerpo`) y no multiplicando otra vez: así
   * `importeCuerpo + complemento.importe` **cierra siempre** contra el importe del renglón, que es
   * lo que el papel promete a la vista. Recalcularlo por separado abre la puerta a que las dos
   * cifras impresas se contradigan por un centavo de redondeo — y un documento que no cuadra
   * consigo mismo es justo lo que esta etapa vino a quitar.
   *
   * 🔴 **Nunca es negativo**: el cuerpo va acotado al importe del renglón (ver la consolidación).
   */
  importe: number;
}

/** Una celda de la matriz talla×color de un renglón (para imprimirla como tabla). */
export interface CeldaMatrizImpreso {
  color: string;
  talla: string;
  cantidad: number;
}

/**
 * Un renglón **del papel que ve el proveedor**: lo que tiene que surtir, con su importe.
 *
 * ⭐⭐ V1-E4e (§Post-F9.102) — **ya NO lleva el folio de la orden de producción**, y el campo se
 * quitó del tipo a propósito en vez de dejarlo sin pintar: *"las órdenes a las que corresponden no
 * son relevantes para el proveedor"*. No es sólo ruido — son **números internos** que invitan a que
 * el proveedor los use como referencia y luego facture o remisione contra ellos, creando una
 * correspondencia que el sistema no reconoce. Sin campo, ningún cambio futuro puede volver a
 * colarlos por descuido.
 *
 * ⚠️ El reparto por OP **no se pierde**: sigue guardado (una línea por material × OP, §Post-F9.86) y
 * sigue a la vista del comprador en la pantalla de la OC. Lo que cambia es SÓLO el impreso.
 */
export interface LineaImpresoOC {
  /** Texto del material: nombre de tela/avío (con su color y pantone), o la descripción libre. */
  material: string;
  cantidad: number;
  unidad: string | null;
  precio: number;
  /** Importe TOTAL del renglón: cuerpo + complemento (es el que suma al total de la OC). */
  importe: number;
  /**
   * Importe sólo del cuerpo: `cantidad × precio`, **acotado a no pasarse del importe del renglón**
   * (ver la consolidación: es lo que evita imprimirle un negativo al proveedor). Sin complemento es
   * exactamente {@link LineaImpresoOC.importe}, y siempre vale
   * `importeCuerpo + (complemento?.importe ?? 0) === importe`.
   */
  importeCuerpo: number;
  /** Complemento de la tela (Cardigan), o `null` si el renglón no lo compra. */
  complemento: ComplementoImpreso | null;
  /** Matriz talla×color del renglón, ya consolidada (vacía si no aplica). */
  matriz: CeldaMatrizImpreso[];
  /**
   * ⭐⭐ V1-E8c (§Post-F9.126) — **el DESGLOSE POR MEDIDA del avío, consolidado**. Es la mitad de la
   * etapa que sólo existe para el proveedor: la medida **no se recibe** (llegan "3,200 cierres"),
   * así que su único destino útil es este papel, donde le dice cómo cortarlos. Vacío = no aplica.
   *
   * ⚠️ Consolidado con el MISMO criterio de §Post-F9.102: una cantidad por color+medida, **sin el
   * reparto interno por OP**, que a él no le sirve.
   */
  medidas: DesgloseMedida[];
}

/**
 * Todo lo que necesita el documento PDF de UNA orden de compra, ya RESUELTO (sin BD): así
 * `generarPdfOrdenCompra` es una función pura y testeable. El total CUADRA con `CompraSalida.total`.
 */
export interface DatosImpresoOC {
  empresa: string;
  numCompra: number;
  estatus: string;
  cancelada: boolean;
  motivoCancelacion: string | null;
  proveedor: string;
  fecha: string | null;
  fechaEntrega: string | null;
  entregaEn: string | null;
  observaciones: string | null;
  correspondeA: string | null;
  /** Facturas amparadas en v1 (solo lectura, lo llena el ETL), o null. */
  facturasAmparadasLegacy: string | null;
  lineas: LineaImpresoOC[];
  total: number;
}

// ── Resolución de datos (lo único que toca BD) ───────────────────────────────────────────────────

/**
 * Dependencias inyectables de la resolución de datos. Por defecto usa la lectura de dominio real
 * (`obtenerOC`, que ya verifica permiso + empresa activa). Los tests inyectan un fake para no tocar
 * la BD.
 */
export interface DepsImpresoOC {
  obtenerOC?: typeof obtenerOC;
}

/**
 * Texto del material de un renglón: nombre de tela/avío, o la descripción libre, o "—".
 *
 * ⭐⭐ V1-E3u (§Post-F9.89) — **y el COLOR, con su pantone.** Este papel es lo que el proveedor lee
 * para saber qué mandar: una OC que dice *"Felpa 280"* sin decir el tono es justo lo que Daniel
 * describió (*"tengo que pedir el color en cada modelo"*). Con color se imprime
 * `Felpa 280 · Marino Alsa 3040 (19-4052 TCX)`; sin color, exactamente lo de antes.
 */
function textoMaterial(linea: {
  tela: string | null;
  telaColor?: string | null;
  pantoneTelaColor?: string | null;
  avio: string | null;
  colorAvio?: string | null;
  descripcionLibre: string | null;
}): string {
  if (linea.tela !== null) {
    if (linea.telaColor == null || linea.telaColor === '') return linea.tela;
    const pantone =
      linea.pantoneTelaColor == null || linea.pantoneTelaColor === ''
        ? ''
        : ` (${linea.pantoneTelaColor})`;
    return `${linea.tela} · ${linea.telaColor}${pantone}`;
  }
  // ⭐⭐ V1-E8c (§Post-F9.126) — **Y EL COLOR DEL AVÍO, que es literalmente lo que Daniel pidió**:
  // *"poner 4 veces el cierre y en la descripción del avío ponerle el color"*. Sin esto, las cuatro
  // líneas del ejemplo se leerían IDÉNTICAS en el papel del proveedor: cuatro renglones del mismo
  // cierre, cada uno con su cantidad y ninguna manera de saber cuál es cuál.
  if (linea.avio !== null) {
    return linea.colorAvio == null || linea.colorAvio === ''
      ? linea.avio
      : `${linea.avio} · ${linea.colorAvio}`;
  }
  return linea.descripcionLibre ?? '—';
}

// ── ⭐ §Post-F9.101 — quién SÍ se imprime (criterio COMPARTIDO, no uno nuevo) ────────────────────

/**
 * ⭐ **¿POR QUÉ NO SE PUEDE IMPRIMIR ESTA OC?** — `null` = sí se puede (§Post-F9.101). Función PURA:
 * la usa la guarda del servidor y es la que explica el bloqueo con palabras.
 *
 * 🔴 **El criterio NO se escribe aquí: se REÚSA.** `ESTATUS_OC_COMPROMETIDA` (`comprometido-en-oc.ts`)
 * es la lista que ya responde *"¿ya me comprometí con el proveedor?"* —la que usan las guardas de
 * §Post-F9.79 y V1-E4c—, y esa es exactamente la pregunta que decide si hay papel: **la autorización
 * es la firma; sin firma no hay documento que mandar a la calle.** Escribir un segundo criterio
 * ('autorizada' o 'recibida_*' a mano) sería una segunda verdad que se desincroniza el día que
 * alguien agregue un estatus. Un criterio, no dos.
 *
 * De ahí salen las tres respuestas, sin escribir ninguna lista extra:
 *  • `autorizada` / `recibida_parcial` / `recibida_total` → **sí** se imprime;
 *  • `borrador` / `pendiente_autorizacion` → **no**, *"ni aunque diga borrador"* (Daniel);
 *  • `cancelada` → **no** (no está en la lista): una OC cancelada en manos del proveedor es la misma
 *    confusión al revés.
 *
 * ⚠️ El texto es el MISMO que el de la pantalla (`frontend/.../piezas.tsx`), a propósito: quien vea
 * el aviso en el cajón de la OC y quien tope con el 400 tienen que leer la misma frase, o parecerán
 * dos reglas distintas.
 *
 * @param estatus estatus de la OC tal como lo sirve `obtenerOC`.
 * @returns el motivo, como frase autónoma, o `null` si se imprime.
 */
export function motivoNoImprimirOC(estatus: string): string | null {
  if ((ESTATUS_OC_COMPROMETIDA as readonly string[]).includes(estatus)) {
    return null;
  }
  if (estatus === 'cancelada') {
    return 'La orden está cancelada: ya no se manda al proveedor.';
  }
  return 'Se imprime cuando la orden esté autorizada.';
}

// ── ⭐⭐ §Post-F9.102 — la consolidación PARA EL PROVEEDOR (función pura) ────────────────────────

/**
 * Un renglón GUARDADO de la OC visto por la consolidación: su **identidad** (qué material y de qué
 * color), sus **precios unitarios** y sus números. Es la entrada de
 * {@link consolidarRenglonesParaProveedor}; deliberadamente NO trae el folio de la OP, que es lo que
 * esta etapa saca del papel.
 */
export interface RenglonParaConsolidar {
  idTela: number | null;
  idTelaColor: number | null;
  idAvio: number | null;
  descripcionLibre: string | null;
  /** Texto del material ya armado (tela · color (pantone) / avío / descripción libre). */
  material: string;
  cantidad: number;
  unidad: string | null;
  precio: number;
  /**
   * El complemento (Cardigan) que compra ESTE renglón, o `null` si no compra ninguno. El `precio` es
   * el EFECTIVO (`precioComplemento ?? precio`, la misma regla con la que `aCompraSalida` derivó el
   * subtotal): lo que decide si dos renglones se pueden sumar es el precio con el que se calculó su
   * importe, no el que quedó escrito.
   */
  complemento: { nombre: string; cantidad: number; precio: number } | null;
  /** Importe del renglón (cuerpo + complemento), tal como lo derivó el dominio. */
  importe: number;
  matriz: CeldaMatrizImpreso[];
  /** ⭐⭐ V1-E8c: el color de PRENDA del avío (identidad) y su desglose por medida. */
  idColorPrenda: number | null;
  colorAvio: string | null;
  medidas: DesgloseMedida[];
}

/**
 * ⭐ **EL COMPLEMENTO DE UN RENGLÓN GUARDADO, NORMALIZADO** — o `null` si ese renglón no compra
 * ninguno. Función PURA: es el ÚNICO lugar donde se decide qué es "tener complemento", para que la
 * clave de agrupación y lo que se pinta no puedan responder distinto.
 *
 * Tres reglas, y cada una tiene su porqué:
 *  • 🔴 **Cero y vacío son lo mismo: NO hay complemento.** Las OC que genera el MRP pueden traer la
 *    cantidad sin capturar, y un *"+ Cardigan: 0"* en el papel del proveedor es un renglón fantasma:
 *    no le dice qué mandar y sí le hace dudar.
 *  • **Sin precio propio, el del cuerpo** — la misma regla con la que `aCompraSalida` derivó el
 *    subtotal. Si aquí se leyera otro precio, el papel no cuadraría contra el importe.
 *  • **Sin nombre, "Complemento"** (no debería pasar: la tela lo nombra). Se prefiere un nombre
 *    genérico a **callar un material que el proveedor tiene que mandar y que ya se le está
 *    cobrando** — que es justo el defecto que esta pieza vino a cerrar.
 */
export function complementoDeLinea(linea: {
  nombreComplementoTela: string | null;
  cantidadComplemento: number | null;
  precioComplemento: number | null;
  precio: number;
}): { nombre: string; cantidad: number; precio: number } | null {
  const cantidad = linea.cantidadComplemento;
  if (cantidad == null || cantidad <= 0) {
    return null;
  }
  return {
    nombre: linea.nombreComplementoTela ?? 'Complemento',
    cantidad,
    precio: linea.precioComplemento ?? linea.precio,
  };
}

/**
 * Clave de agrupación: **lo que el proveedor tiene que surtir** + **los precios con los que se armó
 * el importe**.
 *
 *  • **Identidad por ids, no por el texto**: dos telas distintas que se llamaran igual no se
 *    fusionan, y el color entra en la clave porque §Post-F9.89 dejó claro que **el color sí le
 *    importa al proveedor** (es lo que le dice qué tono mandar). Una tela SIN color no se fusiona
 *    con la misma tela CON color: adivinar que son el mismo tono escribiría una suposición como
 *    hecho.
 *  • **Los precios entran en la clave** (decisión (c)): con precios distintos para el mismo material
 *    la consolidación MENTIRÍA —el renglón diría `cantidad × precio` y el importe sería otro—, así
 *    que no se fusiona: se dejan separados. 🔴 **No se promedia ni se inventa un precio.** Es raro
 *    (el precio sale de la misma cascada) pero posible desde que V1-E3z dejó teclear el precio por
 *    renglón, así que se resuelve, no se ignora.
 *  • **El precio del complemento también**, y "no lleva complemento" es un valor distinto de "lo
 *    lleva a $X": es otro precio unitario dentro del mismo importe, y la regla de (c) vale igual
 *    para él.
 *  • **La unidad también**: sumar 100 m con 20 kg no es una cantidad, es un número sin significado.
 */
function claveConsolidacion(r: RenglonParaConsolidar): string {
  return JSON.stringify([
    r.idTela,
    r.idTelaColor,
    r.idAvio,
    // ⭐⭐ V1-E8c (§Post-F9.126): el color del AVÍO entra en la clave por la MISMA razón que el de
    // la tela — es lo que le dice al proveedor qué mandar. Entran **los dos**: el id (la identidad
    // del renglón) y el TEXTO, porque el texto es lo que se imprime: fundir dos líneas que dicen
    // colores distintos bajo el primer texto le mandaría al proveedor una cantidad con la etiqueta
    // equivocada. Un avío sin color no se funde con el mismo avío CON color: adivinar que son el
    // mismo tono escribiría una suposición como hecho.
    r.idColorPrenda,
    r.colorAvio,
    r.descripcionLibre,
    r.unidad,
    r.precio,
    r.complemento?.precio ?? null,
  ]);
}

/**
 * Suma dos matrices talla×color en una sola, por `(color, talla)` y en orden de aparición.
 *
 * 🔴 **Esto NO es un adorno: es la mitad de la verdad del renglón fusionado.** Si dos renglones del
 * mismo material se juntan en una cantidad y sus matrices NO se sumaran, el papel diría *"Rojo: 300"*
 * arriba y un desglose de 180 abajo — un documento que se contradice a sí mismo es peor que uno
 * partido en dos renglones.
 */
function sumarMatrices(
  a: readonly CeldaMatrizImpreso[],
  b: readonly CeldaMatrizImpreso[],
): CeldaMatrizImpreso[] {
  const celdas = new Map<string, CeldaMatrizImpreso>();
  for (const c of [...a, ...b]) {
    const clave = JSON.stringify([c.color, c.talla]);
    const previa = celdas.get(clave);
    if (previa === undefined) {
      celdas.set(clave, { color: c.color, talla: c.talla, cantidad: c.cantidad });
    } else {
      previa.cantidad += c.cantidad;
    }
  }
  return [...celdas.values()];
}

/**
 * ⭐⭐ **LA CONSOLIDACIÓN DEL IMPRESO** (§Post-F9.102) — función PURA, en el SERVIDOR (A1): el PDF
 * sólo pinta lo que ésta le devuelve.
 *
 * Daniel, tras generar la OC 7965: *"La orden de compra debe de juntar las cantidades de dos órdenes
 * si es el mismo producto… **para el proveedor debe de salir solamente una sola cantidad sumando
 * todo el rojo**. Ya de manera interna se divide."*
 *
 * ⚖️ **No contradice §Post-F9.86 (la COMPLETA): son TRES vistas del mismo hecho**, y cada una
 * responde a quién la lee — **guardado** (el sistema): una línea por material × OP, para el costo y
 * el surtido de cada orden; **pantalla** (el comprador): junto, CON el desglose por OP, que es su
 * control; **impreso** (el proveedor): una cantidad por material, SIN folios internos. Aquí sólo se
 * construye la tercera; las otras dos no se tocan.
 *
 * 🔴 **El TOTAL de la OC no puede cambiar** — es la misma suma agrupada de otra forma. Por eso el
 * importe fusionado es la Σ de los importes que ya derivó el dominio (no se recalcula
 * `cantidad × precio`, que volvería a inventar el número y perdería el complemento) y el total del
 * encabezado se sigue tomando de `CompraSalida.total`. Si el total cambia, hay un defecto — y hay
 * una prueba que lo fija.
 *
 * @returns un renglón por grupo, en el orden en que apareció el primero de cada uno (estable).
 */
export function consolidarRenglonesParaProveedor(
  renglones: readonly RenglonParaConsolidar[],
): LineaImpresoOC[] {
  /** Lo que se va acumulando por grupo; el desglose del importe se deriva AL FINAL (ver abajo). */
  interface Acumulado {
    material: string;
    cantidad: number;
    unidad: string | null;
    precio: number;
    importe: number;
    complemento: { nombre: string; cantidad: number; precio: number } | null;
    matriz: CeldaMatrizImpreso[];
    /** ⭐⭐ V1-E8c: el desglose por medida, sumado entre los renglones que se funden. */
    medidas: DesgloseMedida[];
  }

  const grupos = new Map<string, Acumulado>();
  for (const r of renglones) {
    const clave = claveConsolidacion(r);
    const previo = grupos.get(clave);
    if (previo === undefined) {
      grupos.set(clave, {
        material: r.material,
        cantidad: redondearCantidadCompra(r.cantidad),
        unidad: r.unidad,
        precio: r.precio,
        importe: redondear2(r.importe),
        complemento:
          r.complemento === null
            ? null
            : { ...r.complemento, cantidad: redondearCantidadCompra(r.complemento.cantidad) },
        matriz: sumarMatrices([], r.matriz),
        medidas: sumarDesgloses([r.medidas]),
      });
      continue;
    }
    // ⚠️ Se redondea a la escala de CADA columna (cantidad `Decimal(14,2)`, importe dinero): sumar
    // decimales en coma flotante deja polvo (`0.1 + 0.2 = 0.30000000000000004`) y ese polvo se
    // imprimiría tal cual en el papel del proveedor.
    previo.cantidad = redondearCantidadCompra(previo.cantidad + r.cantidad);
    previo.importe = redondear2(previo.importe + r.importe);
    // ⭐ El COMPLEMENTO se suma igual que la cantidad: si dos renglones del mismo rojo se juntan,
    // sus Cardigan también. La clave ya garantiza que o los dos lo llevan al mismo precio, o no se
    // fusionan — por eso aquí basta con sumar.
    if (previo.complemento !== null && r.complemento !== null) {
      previo.complemento.cantidad = redondearCantidadCompra(
        previo.complemento.cantidad + r.complemento.cantidad,
      );
    }
    previo.matriz = sumarMatrices(previo.matriz, r.matriz);
    // ⭐⭐ V1-E8c: y el desglose por medida se suma igual que la matriz y que la cantidad. Si dos
    // renglones del mismo cierre rojo se juntan y sus medidas NO se sumaran, el papel diría "3,200"
    // arriba y un desglose de 1,800 abajo — el mismo defecto que `sumarMatrices` vino a cerrar.
    previo.medidas = sumarDesgloses([previo.medidas, r.medidas]);
  }

  // 🔴 **EL DESGLOSE DEL IMPORTE, AL FINAL Y CERRANDO SIEMPRE.** El papel promete a la vista que
  // `cuerpo + complemento = importe del renglón`, así que el cuerpo se calcula multiplicando lo que
  // el proveedor VE en la fila (`cantidad × precio`) y el complemento se lleva **el RESTO EXACTO**.
  // Recalcular las dos mitades por separado dejaría que se contradijeran por un centavo de
  // redondeo, y un documento que no cuadra consigo mismo es justo lo que esta etapa vino a quitar.
  // Sin complemento no hay nada que partir: el cuerpo ES el importe.
  //
  // ⚠️ **EL `Math.min` NO ES DEFENSIVO: evita imprimir un importe NEGATIVO.** Las dos cifras que se
  // restan no se redondean a la vez (el importe viene de subtotales redondeados renglón por
  // renglón; el cuerpo se redondea una sola vez sobre la cantidad ya fusionada), y cuando el
  // complemento vale ~$0 —un *Cardigan "incluido"*, que el contrato permite— ese polvo lo supera y
  // el resto sale en negativo. **El problema no es el centavo, es el signo:** un *"+ $-0.01 de
  // Cardigan"* en un papel se lee como un sistema roto y provoca justo la llamada al proveedor que
  // este impreso vino a evitar. Con el tope, ninguna de las dos mitades baja de cero y la suma
  // sigue cerrando contra el importe del renglón. El total de la OC no lo toca nadie.
  return [...grupos.values()].map((g) => {
    const importeCuerpo =
      g.complemento === null ? g.importe : Math.min(redondear2(g.cantidad * g.precio), g.importe);
    return {
      material: g.material,
      cantidad: g.cantidad,
      unidad: g.unidad,
      precio: g.precio,
      importe: g.importe,
      importeCuerpo,
      complemento:
        g.complemento === null
          ? null
          : { ...g.complemento, importe: redondear2(g.importe - importeCuerpo) },
      matriz: g.matriz,
      medidas: g.medidas,
    };
  });
}

/**
 * Resuelve TODOS los datos del impreso de una OC (A9: por la empresa activa de la sesión). Reúsa
 * `obtenerOC` (encabezado + líneas + matriz + total derivado): el impreso es una vista del mismo
 * dato, no recalcula nada. Lanza `ErrorNoEncontrado` (404) si la OC no es de la empresa activa.
 *
 * ⭐ §Post-F9.101 — **y NIEGA el impreso de una OC que todavía no está autorizada** (o que se
 * canceló): aquí, en el SERVIDOR. El botón de la pantalla también se esconde, pero esconder es
 * cortesía y negar es la regla (§Post-F9.68: esconder Y bloquear) — con la URL a mano, un botón
 * oculto no protege nada. Lanza `ErrorValidacion` (400) con el motivo en palabras.
 */
export async function armarDatosImpresoOC(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
  deps: DepsImpresoOC = {},
): Promise<DatosImpresoOC> {
  verificarPermiso(sesion, 'compras.ver');
  const obtener = deps.obtenerOC ?? obtenerOC;

  // `obtenerOC` ya verifica permiso + empresa activa (A9) y deriva el total.
  const oc = await obtener(sesion, id, bd);

  // ⭐ §Post-F9.101 — la firma antes que el papel. Va ANTES de armar nada: si no se puede imprimir,
  // no hay documento que construir.
  const motivo = motivoNoImprimirOC(oc.estatus);
  if (motivo !== null) {
    throw new ErrorValidacion(
      `No se puede imprimir la orden de compra ${String(oc.numCompra)}. ${motivo}`,
    );
  }

  return {
    empresa: sesion.nombreEmpresaActiva,
    numCompra: oc.numCompra,
    estatus: oc.estatus,
    cancelada: oc.estatus === 'cancelada',
    motivoCancelacion: oc.motivoCancelacion,
    proveedor: oc.proveedor,
    fecha: oc.fecha,
    fechaEntrega: oc.fechaEntrega,
    entregaEn: oc.entregaEn,
    observaciones: oc.observaciones,
    correspondeA: oc.correspondeA,
    facturasAmparadasLegacy: oc.facturasAmparadasLegacy,
    // ⭐⭐ §Post-F9.102 — lo GUARDADO viene partido por material × OP; el papel del proveedor sale
    // consolidado. El total NO se recalcula: se toma el que ya derivó el dominio.
    lineas: consolidarRenglonesParaProveedor(
      oc.lineas.map((l) => ({
        idTela: l.idTela,
        idTelaColor: l.idTelaColor,
        idAvio: l.idAvio,
        // ⭐⭐ V1-E8c (§Post-F9.126): el color del avío y su desglose por medida.
        idColorPrenda: l.idColorPrenda,
        colorAvio: l.colorAvio,
        medidas: l.medidas,
        descripcionLibre: l.descripcionLibre,
        material: textoMaterial(l),
        cantidad: l.cantidad,
        unidad: l.unidad,
        precio: l.precio,
        // ⭐ V1-E4e — el Cardigan, normalizado en un solo lugar (`complementoDeLinea`).
        complemento: complementoDeLinea(l),
        importe: l.subtotal,
        matriz: l.tallas.map((t) => ({
          color: t.color,
          talla: t.etiquetaTalla,
          cantidad: t.cantidad,
        })),
      })),
    ),
    total: oc.total,
  };
}

// ── Documento PDF (react-pdf, sin JSX: `createElement`) ──────────────────────────────────────────

const estilos = StyleSheet.create({
  // Anchos de columna PROPIOS de esta tabla (lo compartido vive en `estilosDoc`).
  celdaMaterial: { flexGrow: 1, flexBasis: 0, textAlign: 'left' },
  celdaNum: { width: 58, textAlign: 'right' },
  celdaUnidad: { width: 46, textAlign: 'center' },
  // Sub-bloque del COMPLEMENTO (Cardigan) de un renglón.
  complementoContenedor: { marginTop: 1, marginBottom: 3, marginLeft: 8 },
  complementoTexto: { fontSize: 8 },
  complementoCuenta: { fontSize: 7, color: PALETA.muted },
  // Sub-tabla de la matriz talla×color de un renglón.
  matrizContenedor: { marginTop: 2, marginBottom: 4, marginLeft: 8 },
  matrizTitulo: { fontSize: 7, color: PALETA.muted, marginBottom: 1 },
  celdaMatriz: { width: 70, textAlign: 'left' },
});

/** Formatea un importe en pesos (2 decimales con separador de miles). */
function pesos(valor: number): string {
  return `$${valor.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Un campo etiqueta/valor del encabezado. */
function campo(etiqueta: string, valor: string | null, ancho = false): ReactElement {
  return h(
    View,
    { style: ancho ? estilosDoc.campoDosTercios : estilosDoc.campoTercio, key: etiqueta },
    h(Text, { style: estilosDoc.etiquetaCampo }, etiqueta),
    h(Text, { style: estilosDoc.valorCampo }, valor ?? '—'),
  );
}

/** Banda roja "CANCELADA" + motivo (solo si la OC está cancelada). */
function bandaCancelada(datos: DatosImpresoOC): ReactElement | null {
  if (!datos.cancelada) {
    return null;
  }
  return BandaEstado({
    titulo: 'ORDEN DE COMPRA CANCELADA',
    detalle: `Motivo: ${datos.motivoCancelacion ?? 'sin especificar'}`,
  });
}

/**
 * ⭐ **LO QUE DICE EL PAPEL SOBRE EL COMPLEMENTO** (V1-E4e) — función PURA; `null` cuando el renglón
 * no compra complemento (y entonces no se pinta NADA: cero renglones fantasma).
 *
 * Devuelve dos frases, y cada una responde a una pregunta distinta del proveedor:
 *  1. **"¿qué más tengo que mandar?"** → el nombre, la cantidad y su precio, marcado como *material
 *     adicional a surtir*. Hasta esta etapa el papel se lo callaba **y aun así se lo cobraba**.
 *  2. 🔴 **"¿de dónde sale este importe?"** → la SUMA, escrita: `cuerpo + complemento = importe`.
 *     Sin ella, el renglón se lee como un error de aritmética (`cantidad × precio ≠ importe`) y esa
 *     es exactamente *"la confusión con el proveedor"* que Daniel mandó quitar.
 *
 * Vive aquí, fuera de los elementos de `react-pdf`, a propósito: así el texto exacto **se prueba y
 * se muta** (el PDF sólo lo coloca). Es lo que ya funcionó en este archivo con `textoMaterial`.
 */
export function textosComplemento(linea: LineaImpresoOC): readonly string[] | null {
  const c = linea.complemento;
  if (c === null) {
    return null;
  }
  const unidad = linea.unidad === null || linea.unidad === '' ? '' : ` ${linea.unidad}`;
  return [
    `+ ${c.nombre} (material adicional a surtir): ${String(c.cantidad)}${unidad} a ${pesos(c.precio)}`,
    `Importe del renglón: ${pesos(linea.importeCuerpo)} de ${linea.material} + ` +
      `${pesos(c.importe)} de ${c.nombre} = ${pesos(linea.importe)}`,
  ];
}

/** Sub-bloque del complemento (Cardigan) de un renglón; `null` si el renglón no lo compra. */
function complementoLinea(linea: LineaImpresoOC, clave: string): ReactElement | null {
  const textos = textosComplemento(linea);
  if (textos === null) {
    return null;
  }
  return h(
    View,
    { style: estilos.complementoContenedor, key: clave },
    h(Text, { style: estilos.complementoTexto }, textos[0] ?? ''),
    h(Text, { style: estilos.complementoCuenta }, textos[1] ?? ''),
  );
}

/** Sub-tabla de la matriz talla×color de un renglón (solo si el renglón la usa). */
function matrizLinea(linea: LineaImpresoOC, clave: string): ReactElement | null {
  if (linea.matriz.length === 0) {
    return null;
  }
  return h(
    View,
    { style: estilos.matrizContenedor, key: clave },
    h(Text, { style: estilos.matrizTitulo }, 'Desglose por talla y color:'),
    ...linea.matriz.map((c, i) =>
      h(
        View,
        { style: estilosDoc.filaTabla, key: `m-${i}` },
        h(Text, { style: [estilosDoc.celda, estilos.celdaMatriz] }, c.color),
        h(Text, { style: [estilosDoc.celda, estilos.celdaMatriz] }, c.talla),
        h(Text, { style: [estilosDoc.celda, estilos.celdaNum] }, String(c.cantidad)),
      ),
    ),
  );
}

/**
 * ⭐⭐ V1-E8c (§Post-F9.126) — Sub-tabla del DESGLOSE POR MEDIDA (sólo si el renglón lo trae).
 * Se pinta como la matriz talla×color: pegada a su renglón y sin importes, porque **se desglosan
 * cantidades, no precios** (§Post-F9.113) — el renglón lleva UN precio y su importe cierra solo.
 */
function medidasLinea(linea: LineaImpresoOC, clave: string): ReactElement | null {
  if (linea.medidas.length === 0) {
    return null;
  }
  return h(
    View,
    { style: estilos.matrizContenedor, key: clave },
    h(Text, { style: estilos.matrizTitulo }, 'Desglose por medida:'),
    ...linea.medidas.map((m, i) =>
      h(
        View,
        { style: estilosDoc.filaTabla, key: `md-${i}` },
        h(Text, { style: [estilosDoc.celda, estilos.celdaMatriz] }, m.etiqueta),
        h(Text, { style: [estilosDoc.celda, estilos.celdaNum] }, String(m.cantidad)),
      ),
    ),
  );
}

/**
 * Tabla de renglones de la OC: **material, cantidad, unidad, precio e importe**.
 *
 * ⭐⭐ V1-E4e (§Post-F9.102) — **sin la columna «Orden»**: los renglones llegan ya consolidados por
 * material (y color) desde `consolidarRenglonesParaProveedor`, y el folio de la OP no le sirve al
 * proveedor — le estorba. Ver {@link LineaImpresoOC}.
 */
function tablaLineas(datos: DatosImpresoOC): ReactElement {
  const filaEncabezado = h(
    View,
    { style: estilosDoc.filaTabla, key: 'enc' },
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaMaterial] },
      'Material',
    ),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaNum] },
      'Cantidad',
    ),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaUnidad] },
      'Unidad',
    ),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaNum] }, 'Precio'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaNum] }, 'Importe'),
  );

  const filas: ReactElement[] = [];
  datos.lineas.forEach((l, i) => {
    filas.push(
      h(
        View,
        { style: estilosDoc.filaTabla, key: `fila-${i}` },
        h(Text, { style: [estilosDoc.celda, estilos.celdaMaterial] }, l.material),
        h(Text, { style: [estilosDoc.celda, estilos.celdaNum] }, String(l.cantidad)),
        h(Text, { style: [estilosDoc.celda, estilos.celdaUnidad] }, l.unidad ?? '—'),
        h(Text, { style: [estilosDoc.celda, estilos.celdaNum] }, pesos(l.precio)),
        h(Text, { style: [estilosDoc.celda, estilos.celdaNum] }, pesos(l.importe)),
      ),
    );
    // ⭐ El complemento va PEGADO a su tela (no es una línea suelta del pedido).
    const complemento = complementoLinea(l, `compl-${i}`);
    if (complemento !== null) {
      filas.push(complemento);
    }
    const matriz = matrizLinea(l, `matriz-${i}`);
    if (matriz !== null) {
      filas.push(matriz);
    }
    // ⭐⭐ V1-E8c (§Post-F9.126) — EL DESGLOSE POR MEDIDA, pegado a su renglón. Es la razón por la
    // que la medida existe en el sistema: el proveedor corta los cierres según esta tablita.
    const medidas = medidasLinea(l, `medidas-${i}`);
    if (medidas !== null) {
      filas.push(medidas);
    }
  });

  const filaTotal = h(
    View,
    { style: [estilosDoc.filaTabla, estilosDoc.filaTotal], key: 'total' },
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.celdaMaterial] },
      'Total de la orden de compra',
    ),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.celdaNum] }, ''),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.celdaUnidad] }, ''),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.celdaNum] }, ''),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.celdaNum] },
      pesos(datos.total),
    ),
  );

  const cuerpo =
    datos.lineas.length === 0
      ? [h(Text, { style: estilosDoc.vacio, key: 'vacio' }, 'Sin renglones capturados.')]
      : [filaEncabezado, ...filas, filaTotal];

  return h(View, { style: estilosDoc.seccion }, TituloSeccion('Renglones'), ...cuerpo);
}

/** Una página = una orden de compra. */
function paginaOC(datos: DatosImpresoOC, clave: string): ReactElement {
  const hijos: (ReactElement | null)[] = [
    EncabezadoDocumento({
      empresa: datos.empresa,
      titulo: 'Orden de compra — CONTROL v2',
      derecha: { etiqueta: 'Folio', valor: String(datos.numCompra), grande: true },
    }),
    bandaCancelada(datos),
    h(
      View,
      { style: estilosDoc.filaCampos, key: 'campos' },
      campo('Proveedor', datos.proveedor, true),
      campo('Estatus', datos.estatus),
      campo('Fecha', datos.fecha),
      campo('Fecha de entrega', datos.fechaEntrega),
      campo('Entregar en', datos.entregaEn, true),
      campo('Corresponde a', datos.correspondeA, true),
    ),
    datos.observaciones
      ? h(
          View,
          { style: estilosDoc.campoDosTercios, key: 'obs' },
          h(Text, { style: estilosDoc.etiquetaCampo }, 'Observaciones'),
          h(Text, { style: estilosDoc.valorCampoTexto }, datos.observaciones),
        )
      : null,
    datos.facturasAmparadasLegacy
      ? h(
          View,
          { style: estilosDoc.campoDosTercios, key: 'facturas' },
          h(Text, { style: estilosDoc.etiquetaCampo }, 'Facturas amparadas (histórico)'),
          h(Text, { style: estilosDoc.valorCampoTexto }, datos.facturasAmparadasLegacy),
        )
      : null,
    tablaLineas(datos),
    PieDocumento({
      contexto: `CONTROL v2 · ${datos.empresa} · Orden de compra ${datos.numCompra} · Total ${pesos(datos.total)}`,
    }),
  ];

  return h(
    Page,
    { key: clave, size: 'A4', style: estilosDoc.pagina },
    ...hijos.filter((x) => x !== null),
  );
}

/** Documento de UNA orden de compra. */
function documentoOC(datos: DatosImpresoOC): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: `Orden de compra ${datos.numCompra}`,
      author: datos.empresa,
      subject: 'Orden de compra',
    },
    paginaOC(datos, 'pagina-0'),
  );
}

// ── Generación del Buffer (función pura: recibe datos resueltos) ──────────────────────────────────

/** Genera el PDF (Buffer) de una OC a partir de sus datos ya resueltos. */
export async function generarPdfOrdenCompra(datos: DatosImpresoOC): Promise<Buffer> {
  return renderToBuffer(documentoOC(datos));
}

// ── Orquestación de alto nivel (resuelve datos + genera) — la usa la ruta ─────────────────────────

/** Resultado de generar el impreso de una OC (Buffer + folio para el `filename`). */
export interface ImpresoOC {
  buffer: Buffer;
  numCompra: number;
}

/** Resuelve los datos de una OC (A9) y devuelve su PDF + el folio para el nombre del archivo. */
export async function impresoOrdenCompra(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
  deps: DepsImpresoOC = {},
): Promise<ImpresoOC> {
  const datos = await armarDatosImpresoOC(sesion, id, bd, deps);
  const buffer = await renderizarPdfEnWorker('orden-compra', datos, {
    idEmpresa: sesion.idEmpresaActiva,
  });
  return { buffer, numCompra: datos.numCompra };
}
