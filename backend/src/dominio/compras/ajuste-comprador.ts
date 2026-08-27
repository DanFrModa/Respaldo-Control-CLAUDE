/**
 * ⭐⭐ **LO QUE EL COMPRADOR AJUSTA A MANO ANTES DE GENERAR LA OC** — V1-E3z, `DECISIONES.md`
 * §Post-F9.94.
 *
 * Daniel, 23-ago-2026: *"Al hacer las órdenes de compra en explosión de materiales, ya hay una
 * pantalla previa, pero **no me deja poner el precio correcto ni la cantidad**. Acuérdate que al
 * final puedo modificar precio o cantidad antes de generar la OC"*.
 *
 * Este módulo es la REGLA de ese ajuste, en un solo lugar y **sin base de datos**: recibe lo que el
 * sistema propuso para un renglón (material+color+proveedor) y lo que el comprador tecleó, y
 * devuelve con qué cantidad y con qué precio va a nacer ese renglón — más los **bloqueos** que
 * impedirían generar. Vive aparte de `mrp.ts` por dos razones:
 *
 *  1. **A1** — la pantalla NO calcula. La revisión previa vuelve a pedirle el plan al servidor cada
 *     vez que se cambia un número, y lo que repinta es lo que decide ESTA función. Que la previa y
 *     la generación coincidan no es una promesa: es el mismo código corriendo dos veces.
 *  2. Es **pura**, así que se prueba entera en `test:unit` (sin Postgres) — que es donde de verdad
 *     se cazan los casos feos (el cero, el redondeo que se come el número, el negativo).
 *
 * ── LAS DECISIONES, CON SU RAZÓN (V1-E3z) ────────────────────────────────────────────────────────
 *
 * **Vacío ≠ cero.** Un campo que el comprador NO tocó no manda ajuste: manda lo que el sistema
 * propuso. Por eso `cantidadTotal` y `precioUnitario` son OPCIONALES por separado — se puede
 * corregir sólo el precio, sólo la cantidad, o los dos.
 *
 * **El 0 en el precio SÍ es un ajuste, y significa "esta línea nace SIN precio"**. No es una
 * invención de esta etapa: es exactamente lo que ya pasaba cuando la cascada no encontraba ningún
 * precio (`sin-precio` → la línea nace en `0.00` y se captura después en la OC), y el contrato de la
 * OC ya acepta `precio ≥ 0`. Prohibirlo aquí sería más estricto que la propia orden de compra. Lo
 * que NO se deja pasar callado es el **0 por redondeo**: un `0.004` tecleado se guardaría como
 * `0.00` y el comprador creería haber puesto un precio. Eso se BLOQUEA y se dice con su número.
 *
 * **El precio negativo no llega hasta aquí**: lo rechaza el contrato (`min(0)`). Una compra no se
 * paga en negativo; una devolución no es una línea de orden de compra.
 *
 * **Bajar la cantidad se permite** — es justo lo que Daniel pide poder hacer. Lo único que se frena
 * es la cantidad que **no sobrevive al guardarse** (< 0.01): esa no crearía una compra, crearía una
 * OC con una línea en `0.00` quemando un folio (A3).
 *
 * **NADA de esto toca el catálogo** (§Post-F9.88 lo prohíbe expresamente): el precio corregido vive
 * en la línea de OC y nada más. Y no hace falta que lo toque — el costeo lee el último precio de la
 * línea de OC **autorizada** (`costos/ultimo-precio-compra.ts`, §Post-F9.48: *"manda la OC
 * AUTORIZADA, no lo recibido ni lo surtido"*), así que un precio corregido aquí se vuelve solo el
 * "último precio de compra" en cuanto la OC se autorice.
 */
import {
  ESCALA_CANTIDAD_COMPRA,
  ESCALA_PRECIO_COMPRA,
  redondearCantidadCompra,
  redondearPrecioCompra,
  seGuardaComoAlgo,
} from './reparto-ordenes.js';

/** Lo que el comprador tecleó para UN renglón (material+color+proveedor). Los dos son opcionales. */
export interface AjusteDelComprador {
  /** Total a comprar que REEMPLAZA la suma propuesta (§Post-F9.86). */
  cantidadTotal?: number | undefined;
  /** Precio unitario que se le pone a TODAS las líneas del renglón (§Post-F9.94). */
  precioUnitario?: number | undefined;
  /**
   * ⭐⭐ **V1-E8c (§Post-F9.126) — EL COLOR DEL AVÍO, COMO TEXTO.** Daniel: *"poner 4 veces el cierre
   * y en la descripción del avío ponerle el color"*. Nace precargado con el nombre del color de la
   * prenda y se puede corregir aquí, antes de generar — a veces el avío va en CONTRASTE (cierre
   * negro en prenda roja) y el nombre del color de la prenda sería una instrucción equivocada.
   *
   * ⚠️ **No tiene reglas que lo bloqueen y por eso NO lo aplica {@link aplicarAjusteDelComprador}**:
   * lo único que se le hace es recortarle los espacios. Este módulo existe para las reglas de la
   * cantidad y el precio —lo que puede impedir generar—; meter aquí un campo sin regla sólo
   * disfrazaría de decisión un `?? valor por omisión`. Se aplica donde se arma el renglón
   * (`mrp.ts`, `planearCompra`), que es el único sitio desde el que la previa y la generación leen.
   */
  colorTexto?: string | undefined;
  /**
   * ⭐⭐ **V1-E8e (§Post-F9.99) — «¿CON ESTO QUEDA CUBIERTO?»**. Daniel: *"compré 480 en lugar de 481
   * … y me sigue poniendo que me falta comprar 1 kilo… no voy a hacer otra OC por 1 kilo"*.
   *
   * `true` = *"con esto queda cubierto"* (el faltante deja de perseguirse); `false`/omitido = *"el
   * resto sigue pendiente"*, que es el **default** y lo único que pasa si nadie contesta.
   *
   * ⚠️ **No tiene reglas que lo bloqueen, así que —igual que `colorTexto`— NO lo aplica
   * {@link aplicarAjusteDelComprador}**: este módulo existe para lo que puede IMPEDIR generar. La
   * marca se escribe al generar la OC (`mrp.ts`, `generarOCDesdeExplosion`), que es el único momento
   * en que existe de verdad un faltante — antes de eso no se ha dejado de comprar nada.
   */
  restoCubierto?: boolean | undefined;
}

/** Con qué cantidad y a qué precio nace el renglón, ya en la escala de su columna. */
export interface RenglonAjustado {
  /** Total a comprar, redondeado a la escala de `OrdenCompraLinea.cantidad`. */
  cantidadTotal: number;
  /** ¿El comprador cambió el total? (el aviso «Total ajustado» de la previa). */
  cantidadAjustada: boolean;
  /**
   * Precio con el que nace el renglón, o `null` si el comprador no lo fijó **y** sus líneas traen
   * precios distintos entre sí (entonces no hay UN precio que enseñar: cada línea usa el suyo).
   */
  precioUnitario: number | null;
  /** Lo que el sistema había resuelto, para poder leer el desvío. */
  precioPropuesto: number | null;
  /** ¿El comprador fijó el precio a mano? (el aviso «Precio ajustado» de la previa). */
  precioAjustado: boolean;
  /**
   * Lo que IMPIDE generar por culpa de este renglón. Se DEVUELVE, no se lanza: la revisión previa
   * tiene que poder enseñar "esto es lo que falta" sin reventar, y la generación es la que convierte
   * la lista en un rechazo (mismo criterio que el resto de `planearCompra`).
   */
  bloqueos: string[];
}

/**
 * Aplica el ajuste del comprador a UN renglón del plan. Función PURA.
 *
 * @param material Nombre del material — sólo para NOMBRARLO en el bloqueo. Un "la cantidad es muy
 *   chica" a secas obliga al comprador a adivinar cuál de veinte renglones fue.
 * @param cantidadPropuesta Lo que el sistema calculó que hay que comprar (Σ de lo pendiente).
 * @param precioPropuesto El precio que resolvió el sistema para el renglón, o `null` si sus líneas
 *   traen precios distintos entre sí.
 * @param ajuste Lo que el comprador tecleó (`undefined` = no tocó nada).
 */
export function aplicarAjusteDelComprador(
  material: string,
  cantidadPropuesta: number,
  precioPropuesto: number | null,
  ajuste: AjusteDelComprador | undefined,
): RenglonAjustado {
  const bloqueos: string[] = [];

  // ── LA CANTIDAD (§Post-F9.86, ahora editable también desde la previa) ──
  const cantidadAjustada = ajuste?.cantidadTotal !== undefined;
  const cantidadTotal = redondearCantidadCompra(ajuste?.cantidadTotal ?? cantidadPropuesta);
  // 🔴 Un ajuste que NO SOBREVIVE al guardarse (por debajo de 0.01) no es una compra: se dice y se
  // frena, en vez de crear una OC con una línea en `0.00` y quemarle un folio (A3). Zod ya rechaza
  // el cero y los negativos; esto ataja el `0.004` que Zod sí deja pasar.
  if (cantidadAjustada && !seGuardaComoAlgo(cantidadTotal)) {
    bloqueos.push(
      `La cantidad que pusiste para "${material}" (${String(ajuste?.cantidadTotal)}) es más chica de lo ` +
        `que se puede pedir: la orden de compra guarda ${String(ESCALA_CANTIDAD_COMPRA)} ` +
        `decimales, así que el mínimo es 0.01.`,
    );
  }

  // ── ⭐⭐ EL PRECIO (§Post-F9.94) ──
  const precioAjustado = ajuste?.precioUnitario !== undefined;
  const base = precioPropuesto === null ? null : redondearPrecioCompra(precioPropuesto);
  const precioUnitario = precioAjustado ? redondearPrecioCompra(ajuste?.precioUnitario ?? 0) : base;
  // 🔴 EL CERO POR REDONDEO. Teclear `0.004` NO es lo mismo que teclear `0`: el primero es alguien
  // que cree haber puesto un precio y el documento lo guardaría como `0.00`. El `0` explícito sí se
  // deja pasar (es "la línea nace sin precio", lo que ya hacía la cascada cuando no encontraba
  // ninguno), y por eso el mensaje le dice exactamente cómo pedir eso a propósito.
  if (precioAjustado && (ajuste?.precioUnitario ?? 0) > 0 && precioUnitario === 0) {
    bloqueos.push(
      `El precio que pusiste para "${material}" (${String(ajuste?.precioUnitario)}) es más chico de ` +
        `lo que la orden de compra puede guardar: el precio lleva ${String(ESCALA_PRECIO_COMPRA)} ` +
        `decimales, así que se guardaría como 0.00. Si de verdad va sin precio, escribe 0.`,
    );
  }

  return {
    cantidadTotal,
    cantidadAjustada,
    precioUnitario,
    precioPropuesto: base,
    precioAjustado,
    bloqueos,
  };
}

/**
 * El precio que el sistema resolvió para un renglón COMPLETO: el común a todas sus líneas, o `null`
 * si no lo hay.
 *
 * ⚠️ **El `null` no es un descuido, es honestidad.** Un renglón agrupa varias OP, y sus precios
 * pueden diferir legítimamente (V1-E3m: Compras pudo teclear un precio distinto al asignar el
 * proveedor en UNA de las órdenes). Enseñar el de la primera como si fuera "el precio del renglón"
 * sería inventar un dato; el desglose por OP de la previa sigue diciendo el de cada una, y si el
 * comprador fija uno aquí, ése gana para todas.
 */
export function precioComunDelRenglon(precios: readonly number[]): number | null {
  if (precios.length === 0) return null;
  const primero = redondearPrecioCompra(precios[0] ?? 0);
  return precios.every((p) => redondearPrecioCompra(p) === primero) ? primero : null;
}

// ── ⭐⭐ V1-E8c (§Post-F9.126) — UN AJUSTE NO SE PUEDE PERDER EN SILENCIO ─────────────────────────

/** Un ajuste del cuerpo, visto por el reclamo: su clave y de qué decía ser. */
export interface AjusteRecibido {
  /** La clave con la que el cuerpo lo mandó (`claveAjuste` del cuerpo). */
  clave: string;
  tipo: 'tela' | 'avio';
  idMaterial: number;
  idProveedor: number;
}

/** Un renglón que el plan SÍ va a comprar, visto por el reclamo. */
export interface RenglonDelPlan {
  /** La clave de ajuste de ESE renglón (`claveAjuste` del renglón). */
  clave: string;
  tipo: 'tela' | 'avio';
  idMaterial: number;
  idProveedor: number;
  /** Nombre del material CON su color, tal como la previa lo enseña. */
  material: string;
}

/**
 * ⭐⭐ **RECLAMA LOS AJUSTES QUE NO ENCONTRARON SU RENGLÓN** (V1-E8c, §Post-F9.126) — función PURA.
 *
 * 🔴 **De dónde salió: de un defecto MEDIDO, no de una idea.** Al partir el renglón de avío por
 * color, su clave de ajuste pasó a llevar el color — y un ajuste que no lo nombra **dejó de casar**.
 * Lo que hacía el sistema entonces era lo peor posible: **nada**. El comprador tecleaba «comprar
 * 0.1» y se compraban **180**, sin un aviso, sin un bloqueo, sin una línea de bitácora. Se midió con
 * un doble de transacción: `cantidadTotal: 100` (la propuesta) y `bloqueos: []`.
 *
 * ⚖️ **Cuándo SÍ se reclama, y por qué no siempre.** Sólo cuando ese mismo material se le va a
 * comprar **a ese mismo proveedor** en esta compra — o sea, cuando el dinero se va a mover con un
 * número que el comprador no aprobó. Si el material no está en el plan (lo desmarcó, ya estaba
 * cubierto, se quedó sin proveedor), el ajuste es **moot**: no hay nada que corregir y bloquear
 * sería ruido. *Se reclama el dinero, no la contabilidad de claves.*
 *
 * ⚠️ Es un **BLOQUEO** y no un aviso, a diferencia del desvío de cantidad (§Post-F9.64, *guía no
 * jaula*). La diferencia es de naturaleza: el desvío es un **juicio de negocio** sobre un número que
 * la persona SÍ eligió; esto es el sistema diciendo *"no pude honrar tu instrucción"*. Gastar sin
 * ella es exactamente lo que §Post-F9.94 vino a impedir.
 *
 * @returns una frase por ajuste huérfano, ya redactada; vacío = todo se aplicó (o era moot).
 */
export function reclamosDeAjustesNoAplicados(
  recibidos: readonly AjusteRecibido[],
  renglones: readonly RenglonDelPlan[],
): string[] {
  const aplicables = new Set(renglones.map((r) => r.clave));
  const reclamos: string[] = [];
  for (const a of recibidos) {
    if (aplicables.has(a.clave)) continue;
    // ¿Ese material se le va a comprar a ese proveedor de todas formas? Ahí es donde duele.
    const hermanos = renglones.filter(
      (r) => r.tipo === a.tipo && r.idMaterial === a.idMaterial && r.idProveedor === a.idProveedor,
    );
    if (hermanos.length === 0) continue;
    const nombres = [...new Set(hermanos.map((h) => h.material))].sort((x, y) =>
      x.localeCompare(y, 'es'),
    );
    reclamos.push(
      // ⭐⭐ V1-E8e (§Post-F9.99): «con esto queda cubierto» es la TERCERA instrucción que puede
      // perderse por esta puerta, y la más cara de perder en silencio (deja un faltante vivo que la
      // persona creyó cerrar). La frase la nombra en vez de hablar sólo de números.
      `Lo que capturaste para "${nombres[0] ?? ''}" (la cantidad, el precio o «con esto queda ` +
        `cubierto») no corresponde a ningún ` +
        `renglón de esta compra: el ajuste viene SIN color (o con otro), y desde que un avío se ` +
        `compra por color el renglón se identifica por su color. Si se generara así, se compraría ` +
        `lo que propone el sistema y NO lo que tecleaste. ` +
        `Renglón${nombres.length === 1 ? '' : 'es'} de este material en esta compra: ` +
        `${nombres.join(', ')}.`,
    );
  }
  return reclamos;
}
