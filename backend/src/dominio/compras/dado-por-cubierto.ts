/**
 * ⭐⭐ **«CON ESTO QUEDA CUBIERTO» — el faltante chico que alguien decidió NO perseguir**
 * (V1-E8e, `DECISIONES.md` §Post-F9.99).
 *
 * DE DÓNDE SALE. Daniel, usando la explosión de materiales en `prueba`:
 *
 * > *"En las telas, compré **480 en lugar de 481** que era el cálculo de la tela. Y me sigue
 * > poniendo que me falta comprar 1 kilo… no sé cómo manejar eso, pero **a veces pasa eso en la
 * > realidad**. Y **no voy a hacer otra OC por 1 kilo**."*
 *
 * Hasta hoy `RequerimientoOrden` sólo guardaba **cuánto se necesita**. No existía el concepto de
 * *"esto ya lo doy por surtido aunque falte un pedacito"*, así que el faltante lo perseguía para
 * siempre: cada explosión volvía a ofrecerle comprar 1 kilo.
 *
 * ── LA REGLA, CON SU RAZÓN ───────────────────────────────────────────────────────────────────────
 *
 * ⭐ **Se pregunta EN EL MOMENTO de decidir, no después.** Cuando el comprador baja la cantidad por
 * debajo de lo que se necesitaba —en la revisión previa, lo que V1-E3z hizo posible—, la pantalla
 * pregunta qué significa: *"el resto sigue pendiente"* o *"con esto queda cubierto"*. Ahí es cuando
 * la persona sabe la respuesta; un interruptor escondido en otra pantalla la obligaría a acordarse
 * y a buscarlo.
 *
 * **Se pregunta SIEMPRE que se baja, sin umbral.** Un umbral sería otro número inventado, y de todos
 * modos es un clic.
 *
 * 🔴 **El default es «sigue pendiente». NUNCA se cierra solo.** Nada de esto pasa por omisión: sin
 * una respuesta explícita, el faltante sigue vivo. Es la mitad de la decisión que protege al
 * sistema de taparle a alguien un faltante que sí importaba.
 *
 * 🔴 **Por qué NO una tolerancia automática** (que es lo primero que se le ocurre a uno, y está
 * descartado con razón): **1 kg de 481 es nada, pero 1 kg de 5 es el 20 %**. Un porcentaje único o
 * **tapa faltantes de verdad** o no sirve. *Que la persona lo diga es más barato y más honesto que
 * adivinarlo.*
 *
 * ── DÓNDE VIVE LA MARCA, Y POR QUÉ NO DONDE PARECÍA ──────────────────────────────────────────────
 *
 * 🔴 **NO puede vivir en `RequerimientoOrden`.** Ese snapshot se **borra y se reescribe ENTERO en
 * cada explosión** (`deleteMany` + recreación, `mrp.ts`). Una bandera ahí se borraría la próxima vez
 * que alguien explotara la orden y **el faltante volvería sin que nadie entendiera por qué**. Vive
 * en su propia tabla (`RequerimientoCubierto`), con una identidad DURABLE: *(orden, material,
 * color)*.
 *
 * ⚠️ **Y el COLOR está en esa identidad porque el neteo razona con él.** Desde V1-E3u (telas,
 * §Post-F9.89) y V1-E8c (avíos, §Post-F9.126) un renglón de explosión ES *(material, color)*: la
 * clave que usan el neteo y la agrupación es `claveMaterialColor`, y ésta cuelga de LA MISMA.
 * Una marca por material a secas cubriría el cierre rojo y seguiría pidiendo los otros tres — o
 * peor, los taparía todos.
 *
 * ⭐⭐ **fila 0.162 — LO QUE SE GUARDA NO CAMBIA; LO QUE CAMBIA ES CÓMO SE BUSCA.** El acto sigue
 * naciendo con su *(orden, material, color)* exacto. Lo que esta fila corrige es que el renglón
 * **puede cambiar de forma después** (se marca «se compra sin tomar en cuenta el color» en el avío,
 * se quita el amarre de color de la tela) y entonces la búsqueda por igualdad exacta dejaba las
 * marcas de color **sin dueño**: el faltante que alguien ya había cerrado volvía a perseguirlo.
 * El reparto vive en {@link repartirCubiertoPorColor}, con la misma regla —y la misma guarda— que
 * la fila 0.158 le dio al otro sumando del criterio.
 *
 * ⚠️ **Es un LIBRO de actos, no un estado que se pisa** (D3, el criterio del kardex): cada acto
 * INSERTA un renglón y lo cubierto es la **Σ de los vivos**. *"Volver a pedirlo"* sella
 * `canceladoEn` y deja de contar — nunca borra, así el rastro de A7 sobrevive a la corrección.
 *
 * ── UN CRITERIO, NO DOS ──────────────────────────────────────────────────────────────────────────
 *
 * El requerimiento queda satisfecho cuando **comprometido + dado-por-cubierto ≥ requerido**, y esa
 * resta se hace en UN solo sitio: {@link pendienteDeComprar} (`comprometido-en-oc.ts`, junto a la
 * única verdad sobre *"cuánto ya compré"*). Este módulo aporta el sumando; no calcula el pendiente
 * por su cuenta.
 *
 * ── 🔴 LO QUE ESTE MÓDULO **NO** GARANTIZA, DICHO EN VEZ DE CALLADO ───────────────────────────────
 *
 * **Dos actos SIMULTÁNEOS sobre el mismo renglón pueden cubrir de más.** No hay lock: los dos leen el
 * mismo pendiente y los dos escriben su acto, así que un renglón de 481 con dos compras de 480 a la
 * vez podría quedar con 2 cubiertos en vez de 1. **No rompe ninguna invariante** —la marca sólo
 * RESTA, nunca vuelve nada negativo, y `pendienteDeComprar` clampa en 0— y las dos personas
 * *pidieron* dejar de perseguirlo; lo peor que pasa es que se deje de comprar un pedacito más de lo
 * que una sola habría cerrado. Los dos actos quedan en la tabla con su autor, y **«volver a
 * pedirlo» los deshace**. Se declara en vez de meter un `pg_advisory_xact_lock` para proteger una
 * invariante que no existe.
 *
 * **Cancelar la OC NO deshace la marca.** El material vuelve a pedirse (la OC deja de cubrir) pero el
 * pedazo cerrado sigue cerrado, así que se compraría de menos. Atarlo exigiría decidir *qué marca*
 * muere con *qué OC* —algo que §Post-F9.99 no dice— y el camino honesto ya existe: «volver a pedirlo».
 *
 * Innegociables: A1 (toda la regla aquí; la ruta valida y delega) · A2 (una transacción) ·
 * A4 (`compras.administrar`, el MISMO permiso que genera las OC: quien compra, decide qué no se
 * compra) · A7 (quién, cuándo, contra qué requerido y con qué cantidad comprada) · A9 (la orden
 * tiene que ser de la empresa activa, o 404).
 */
import type { DatosDarPorCubierto, DarPorCubiertoSalida } from '../../contrato/index.js';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorNoEncontrado } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, enTransaccion, type ContextoBd } from '../../comun/transaccion.js';
import {
  canonizarColorPrenda,
  comprometidoEnOc,
  elSinColorSeLlevaLasHuerfanas,
  pendienteDeComprar,
  repartirComprometidoPorColor,
  colorDelRenglon,
  claveMaterial,
} from './comprometido-en-oc.js';
import { redondearCantidadCompra, seGuardaComoAlgo } from './reparto-ordenes.js';

/**
 * Lo dado por cubierto de un conjunto de órdenes:
 * `idOrden → (claveMaterial → (color del renglón → cantidad))`.
 *
 * La cantidad es la **Σ de los actos VIVOS** (los cancelados no cuentan, D3), a la escala de
 * `RequerimientoOrden.cantidadAComprar` (4 decimales) — la misma en la que se decidió.
 *
 * ⭐⭐ **fila 0.162 — POR QUÉ EL COLOR ES UNA CUBETA Y YA NO PARTE DE LA LLAVE.** Hasta esta fila el
 * mapa iba indexado por `claveMaterialColor` (`avio-9|3`) y cada renglón buscaba su marca por
 * IGUALDAD EXACTA. Eso deja **caer al piso** las marcas de un color que ningún renglón de la
 * explosión de hoy reclama —el mismo hueco que la fila 0.158 cerró en el otro sumando del criterio
 * ({@link ComprometidoMaterial.porColor})—, y el faltante que alguien ya había dado por cubierto
 * vuelve a perseguirlo. La forma es ahora la MISMA que la de lo comprometido, a propósito: los dos
 * sumandos de {@link pendienteDeComprar} se reparten con la misma regla y se leen igual.
 */
export type CubiertoPorOrden = Map<number, Map<string, Map<number | null, number>>>;

/**
 * ⭐ LA función de lectura: cuánto se dio por cubierto, por orden y por renglón *(material, color)*.
 * Lectura pura (no escribe nada): se puede llamar dentro o fuera de una transacción.
 *
 * ⚠️ **No filtra por empresa y no hace falta**, a diferencia de {@link comprometidoEnOc}: una marca
 * cuelga de UNA orden de producción, y quien llama ya verificó (A9) que esas órdenes son de la
 * empresa activa — es la misma razón por la que `estatusMaterialesOrden` lee su snapshot por
 * `idOrden` a secas. Se pide el parámetro igual para que la firma no invite a saltarse esa
 * verificación río arriba.
 *
 * @param idsOrden órdenes de producción a leer; vacío = mapa vacío (no consulta).
 */
export async function dadoPorCubierto(
  idsOrden: readonly number[],
  bd?: ContextoBd,
): Promise<CubiertoPorOrden> {
  const resultado: CubiertoPorOrden = new Map();
  if (idsOrden.length === 0) return resultado;

  const cliente = clienteLectura(bd);
  const crudas = await cliente.requerimientoCubierto.findMany({
    // D3: los actos deshechos («volver a pedirlo») siguen ahí para auditarlos, pero dejan de contar.
    where: { idOrden: { in: [...idsOrden] }, canceladoEn: null },
    select: {
      idOrden: true,
      idTela: true,
      idAvio: true,
      idTelaColor: true,
      idColorPrenda: true,
      cantidad: true,
    },
  });

  // ⭐⭐ fila 0.159 — en ESPACIO CANÓNICO, como el otro sumando del mismo criterio
  // (`comprometidoEnOc`). Un *«con esto queda cubierto»* decidido ANTES de fusionar dos colores
  // duplicados sigue contando después: la decisión de la persona no se pierde por una limpieza de
  // catálogo, y no hace falta reescribir la fila que la guarda (D3).
  const filas = await canonizarColorPrenda(crudas, bd);

  for (const f of filas) {
    const porMaterial = resultado.get(f.idOrden) ?? new Map<string, Map<number | null, number>>();
    const clave = claveMaterial(f);
    const porColor = porMaterial.get(clave) ?? new Map<number | null, number>();
    // ⭐⭐ fila 0.162: la cubeta es el COLOR DEL RENGLÓN —de tela en las telas, de prenda en los
    // avíos—, resuelto por la MISMA función que usan el neteo y la agrupación (`colorDelRenglon`).
    // La suma NO se redondea: la marca vive a la escala del snapshot (4 decimales), y recortarla
    // aquí a la de la OC tiraría precisión de una decisión que se tomó con ese número.
    const color = colorDelRenglon(f);
    porColor.set(color, (porColor.get(color) ?? 0) + Number(f.cantidad));
    porMaterial.set(clave, porColor);
    resultado.set(f.idOrden, porMaterial);
  }
  return resultado;
}

/** Un renglón de requerimiento visto desde el reparto de lo cubierto: sólo su color. */
export interface FilaParaCubierto {
  /**
   * El COLOR del renglón, ya resuelto con `colorDelRenglon`: de tela si es tela, de prenda si es
   * avío. `null` = el renglón no dice de qué color (la tela sin tono capturado, o el avío marcado
   * «se compra sin tomar en cuenta el color»).
   */
  idColor: number | null;
}

/**
 * ⭐⭐ **A QUÉ RENGLÓN LE CUBRE CADA MARCA, AHORA QUE EL RENGLÓN PUEDE CAMBIAR DE FORMA**
 * (fila 0.162) — función PURA. Es la gemela de `repartirComprometidoPorColor`, para el OTRO sumando
 * del mismo criterio ({@link pendienteDeComprar}).
 *
 * ── EL DEFECTO QUE CIERRA ────────────────────────────────────────────────────────────────────────
 *
 * La marca se guarda por *(orden, material, color)* y hasta esta fila se buscaba por igualdad
 * exacta. Pero **el color del renglón puede cambiar después de que alguien decidió**: se marca «se
 * compra sin tomar en cuenta el color» en un avío que ya tenía renglones por color (fila 0.158), o
 * se quita el amarre de color de una tela. En ese instante la explosión emite UN renglón sin color
 * y las marcas de Rojo/Azul/Negro **se quedan sin dueño**: nadie las encuentra y el faltante que
 * alguien ya había cerrado vuelve a pedirse. Es §Post-F9.99 deshecho por una casilla de catálogo.
 *
 * ── LA REGLA ─────────────────────────────────────────────────────────────────────────────────────
 *
 *  1. **Cada renglón se lleva lo de SU cubeta** (la de su color; el sin color, la de `null`). Es
 *     exactamente lo que hacía la búsqueda exacta, y sigue siendo lo único que de verdad le toca.
 *  2. **Las cubetas CON color que ningún renglón reclama van al renglón sin color, pero SÓLO si ese
 *     renglón es el ÚNICO del material** ({@link elSinColorSeLlevaLasHuerfanas}).
 *
 * 🔴 **Y POR QUÉ ESE «SÓLO SI» NO ES OPCIONAL** — es el mismo hallazgo del reviewer que sostiene la
 * regla 3 de `repartirComprometidoPorColor`, y aplica IGUAL aquí. La tentación es decir *«el renglón
 * sin color pide TODO el material de la orden, así que le tocan todas las marcas»*: cierto en un
 * avío colapsado (`OrdenAvio.@@unique([idOrden, idAvio])` ⇒ un solo renglón por orden) y **falso en
 * una tela**, donde los colores sin amarre caen en el grupo `sin` **junto a** los que sí lo tienen,
 * así que una misma tela emite a la vez renglones con color y uno sin color — y ese renglón sin
 * color es **una PARTE de la orden, no toda**. Acreditarle una marca que se decidió sobre OTRO tono
 * le baja el faltante sin que nadie lo haya dicho, y **ese material no se compra nunca**.
 * Una sobre-compra visible (la marca se queda en el piso, el faltante reaparece y el comprador
 * vuelve a cerrarlo con un clic) es mejor negocio que una **sub-compra silenciosa que para la
 * producción**.
 *
 * ── 🔴 LO QUE ESTA FUNCIÓN **NO** HACE, Y NO ES OLVIDO ────────────────────────────────────────────
 *
 * **La cubeta SIN color NO se reparte entre los renglones CON color.** `repartirComprometidoPorColor`
 * sí lo hace con su acervo sin color, y la diferencia tiene una razón medible: aquel reparto existe
 * para rescatar **el acervo de OC anterior al color** (las ~7,978 OC del Access; **554** tras el
 * corte de `ETL_DESDE`, `DECISIONES.md` §Post-F9.24) — un corpus heredado que, sin repartir,
 * haría re-comprar todo lo que se compró en la era anterior. `RequerimientoCubierto` **no tiene era
 * anterior**: nació (migración `20260827180000_con_esto_queda_cubierto`) ya con `id_tela_color` e
 * `id_color_prenda`, y explícitamente **SIN backfill**. Una marca sin color existe sólo porque su
 * renglón no tenía color al decidirla; que después el renglón se parta en colores no es un dato
 * viejo que rescatar, sino un cambio de la pregunta.
 *
 * ⚠️ **Y NO es que repartirla esté descartado: es que NO está decidido.** Hay una tercera salida
 * que no se eligió aquí — repartirla como hace `repartirComprometidoPorColor` con su acervo:
 * **topada por lo que cada renglón necesita** y **confesando la elección**, como su
 * `desdeAcervoSinColor`. Lo que impide elegirla sin preguntar es el TAMAÑO que puede tener la
 * marca: «dar por cubierto» desde la explosión cierra **todo el pendiente del renglón**, así que
 * una marca sin color puede valer un kilo suelto —repartirlo sería inocuo— o **la orden entera**,
 * y entonces dejaría a todos los colores nuevos en cero. **Dónde está esa raya es una decisión de
 * NEGOCIO** (§Post-F9.99 es de Daniel), no un hueco de búsqueda. Mientras nadie la trace, la marca
 * se queda en el piso y el faltante reaparece **visible** — el lado que se recupera con un clic.
 *
 * @returns lo cubierto de CADA fila, en el MISMO orden en que llegaron.
 */
export function repartirCubiertoPorColor(
  filas: readonly FilaParaCubierto[],
  porColor: ReadonlyMap<number | null, number> | undefined,
): number[] {
  if (filas.length === 0) return [];
  if (porColor === undefined) return filas.map(() => 0);

  // Regla 1. El sin color arranca en 0 y recibe su cubeta abajo: con dos renglones sin color del
  // mismo material (que la explosión no emite hoy, pero el tipo permite) darles la cubeta a los dos
  // la contaría DOBLE. Es la misma precaución que toma `repartirComprometidoPorColor`.
  const propio = filas.map((f) => (f.idColor === null ? 0 : (porColor.get(f.idColor) ?? 0)));

  const indiceSinColor = filas.findIndex((f) => f.idColor === null);
  if (indiceSinColor < 0) return propio;

  let huerfano = 0;
  if (elSinColorSeLlevaLasHuerfanas(filas)) {
    for (const [idColor, cantidad] of porColor) {
      if (idColor !== null) huerfano += cantidad;
    }
  }
  propio[indiceSinColor] = (propio[indiceSinColor] ?? 0) + (porColor.get(null) ?? 0) + huerfano;
  return propio;
}

// ── ⭐⭐ EL REPARTO POR OP DE LO QUE SE DA POR CUBIERTO (desde la revisión previa) ────────────────

/** Una línea del plan, vista por el reparto de lo que se da por cubierto. */
export interface LineaParaCubrir {
  idOrden: number;
  /** Lo que el SISTEMA proponía comprar para esa OP (= su pendiente, ya en escala de la columna). */
  cantidadPropuesta: number;
  /** Lo que se va a comprar de verdad para esa OP, tras el ajuste del comprador. */
  cantidad: number;
  /** ¿Esa línea SÍ se va a escribir? Una que no llega al mínimo guardable no compra nada. */
  seEscribe: boolean;
}

/** Lo que le toca dar por cubierto a UNA OP. */
export interface CubiertoDeUnaOrden {
  idOrden: number;
  cantidad: number;
}

/**
 * ⭐⭐ **A QUÉ OP LE TOCA CADA PEDAZO DEL FALTANTE** (V1-E8e) — función PURA.
 *
 * Un renglón de la revisión previa agrupa varias OP (§Post-F9.86: *se ve junto, se guarda
 * repartido*), pero la marca es de UNA orden. El faltante de cada OP es **lo que se le proponía
 * comprar menos lo que se le va a comprar de verdad**.
 *
 * 🔴 **Una línea que NO se escribe cuenta como comprada en CERO**, no como comprada. Es la
 * diferencia que hace que el renglón cierre de verdad: bajar el total puede dejar a una OP con
 * `0.004`, que la generación se salta (`seEscribe: false`, V1-E3z). Si esa OP se diera por cubierta
 * sólo por su diferencia, se quedaría con una astilla pendiente **para siempre** — el mismo defecto
 * que la etapa vino a cerrar, en chiquito.
 *
 * ⚠️ **Suma exactamente el faltante del renglón** y no hace falta cuadrar nada a mano: la propuesta
 * y el total se reparten entre las OP con la MISMA función (`repartirEntreOrdenes`), y el pendiente
 * de cada OP ya llega redondeado a la escala de la columna, así que `cantidadPropuesta` de una OP es
 * **exactamente** su pendiente. Repartir el faltante con una segunda regla propia sería justo la
 * clase de cálculo paralelo que se desincroniza.
 *
 * @returns una entrada por OP con faltante (> 0); las que se compran completas no aparecen.
 */
export function repartoDadoPorCubierto(lineas: readonly LineaParaCubrir[]): CubiertoDeUnaOrden[] {
  const salida: CubiertoDeUnaOrden[] = [];
  for (const l of lineas) {
    const comprada = l.seEscribe ? l.cantidad : 0;
    const faltante = redondearCantidadCompra(Math.max(0, l.cantidadPropuesta - comprada));
    if (!seGuardaComoAlgo(faltante)) continue;
    salida.push({ idOrden: l.idOrden, cantidad: faltante });
  }
  return salida;
}

// ── ⭐⭐ LA OPERACIÓN (la segunda puerta: dar por cubierto DESDE la explosión) ────────────────────

/**
 * ⭐⭐ **DAR POR CUBIERTO —o VOLVER A PEDIR— DESDE EL RENGLÓN DE LA EXPLOSIÓN** (§Post-F9.99).
 *
 * La decisión pide dos puertas, y ésta es la segunda: *"un «dar por cubierto» desde la explosión,
 * para los casos que **ya se escaparon** — como el que originó esto, que ya estaba generado"*. La
 * primera (la de la revisión previa) vive en `mrp.ts`, en el mismo acto de generar la OC.
 *
 * **Qué hace, exactamente:**
 *  • `cubierto: true` — da por cubierto **lo que hoy falta** de cada renglón nombrado. Lo que falta
 *    lo calcula el SERVIDOR con el criterio único ({@link pendienteDeComprar}), no la pantalla (A1):
 *    lo que el comprador está diciendo es *"esto ya no me lo pidas"*, no un número.
 *  • `cubierto: false` — **«volver a pedirlo»**: cancela (suave, D3) todos los actos vivos de esos
 *    renglones. El faltante reaparece tal cual, y el rastro de quién lo había cerrado se conserva.
 *
 * ⚠️ **Es idempotente por construcción.** Darlo por cubierto dos veces no escribe el segundo acto:
 * la segunda vez ya no falta nada (`pendiente = 0`) y no hay qué cubrir. No hace falta una guarda
 * aparte — el propio criterio es la guarda.
 *
 * ⚠️ **Los ids de snapshot son una DIRECCIÓN, no la identidad.** Se resuelven a *(orden, material,
 * color)* dentro de la misma transacción y lo que se guarda es eso: si alguien vuelve a explotar
 * después, los ids cambian pero la marca sigue en pie. (Es el mismo trato que ya reciben en
 * `generar-oc`: la selección viaja por id y el dominio la traduce.)
 *
 * A9: cualquier renglón cuya orden no sea de la empresa activa —o que no exista— responde 404 con
 * su id. Permiso `compras.administrar`.
 */
export async function darPorCubierto(
  sesion: SesionUsuario,
  datos: DatosDarPorCubierto,
  bd?: ContextoBd,
): Promise<DarPorCubiertoSalida> {
  verificarPermiso(sesion, 'compras.administrar');
  const idEmpresa = sesion.idEmpresaActiva;
  const ids = [...new Set(datos.idsRequerimiento)];

  return enTransaccion(async (tx) => {
    // A9 primero: el snapshot se filtra por la EMPRESA de su orden. Un renglón ajeno no existe.
    const filas = await tx.requerimientoOrden.findMany({
      where: { id: { in: ids }, orden: { idEmpresa } },
      select: {
        id: true,
        idOrden: true,
        idTela: true,
        idAvio: true,
        idTelaColor: true,
        idColorPrenda: true,
        unidad: true,
        cantidadAComprar: true,
        tela: { select: { nombre: true } },
        avio: { select: { clave: true, descripcion: true } },
        telaColor: { select: { nombre: true } },
        colorPrenda: { select: { nombre: true } },
        orden: { select: { folio: true } },
      },
      // Determinista: con dos renglones del mismo material la bitácora tiene que salir siempre igual.
      orderBy: [{ idOrden: 'asc' }, { id: 'asc' }],
    });
    const encontrados = new Set(filas.map((f) => f.id));
    const ajeno = ids.find((id) => !encontrados.has(id));
    if (ajeno !== undefined) {
      throw new ErrorNoEncontrado('Requerimiento', ajeno);
    }

    const idsOrden = [...new Set(filas.map((f) => f.idOrden))];
    const comprometido = await comprometidoEnOc(idEmpresa, idsOrden, { tx });
    const cubierto = await dadoPorCubierto(idsOrden, { tx });

    /**
     * ⚠️ El `enOc` de cada renglón se resuelve con la MISMA regla del acervo sin color que usan la
     * explosión y el plan (`repartirComprometidoPorColor`), y por eso hace falta ver JUNTOS a todos
     * los hermanos del mismo material de la misma OP. Calcularlo con `comprometidoDe` a secas —el
     * total del material— le daría a cada color el `enOc` de todos y el pendiente saldría en cero:
     * daríamos por cubierto **cero** y el comprador se quedaría con su faltante y sin aviso.
     */
    const enOcPorFila = new Map<number, number>();
    /** ⭐⭐ fila 0.162 — lo cubierto de cada fila, con el reparto que ve a todos sus hermanos. */
    const cubiertoPorFila = new Map<number, number>();
    /**
     * ⭐⭐ fila 0.162 — los renglones SIN color que se llevan las marcas huérfanas de su material
     * ({@link elSinColorSeLlevaLasHuerfanas}). «Volver a pedirlo» tiene que poder SOLTAR justo esas:
     * si la lectura las absorbe y el deshacer no, el comprador ve *«cubierto: 10»* y el botón no
     * hace nada — el faltante queda cerrado sin manera de reabrirlo.
     */
    const absorbeHuerfanas = new Set<number>();
    {
      // 🔴 Se leen TODOS los renglones de esas órdenes, no sólo los nombrados: los hermanos que el
      // comprador no marcó siguen siendo parte del reparto del acervo sin color.
      const hermanos = await tx.requerimientoOrden.findMany({
        where: { idOrden: { in: idsOrden } },
        select: {
          id: true,
          idOrden: true,
          idTela: true,
          idAvio: true,
          idTelaColor: true,
          idColorPrenda: true,
          cantidadAComprar: true,
        },
        orderBy: [{ idOrden: 'asc' }, { id: 'asc' }],
      });
      const porOrdenMaterial = new Map<string, typeof hermanos>();
      for (const f of hermanos) {
        const llave = `${String(f.idOrden)}|${claveMaterial(f)}`;
        const grupo = porOrdenMaterial.get(llave) ?? [];
        grupo.push(f);
        porOrdenMaterial.set(llave, grupo);
      }
      for (const grupo of porOrdenMaterial.values()) {
        const cabeza = grupo[0];
        if (cabeza === undefined) continue;
        const colores = grupo.map((f) => ({ idColor: colorDelRenglon(f) }));
        const repartido = repartirComprometidoPorColor(
          grupo.map((f) => ({
            idColor: colorDelRenglon(f),
            cantidadAComprar: Number(f.cantidadAComprar),
          })),
          comprometido.get(cabeza.idOrden)?.get(claveMaterial(cabeza)),
        );
        // ⭐⭐ fila 0.162: lo cubierto se reparte con la MISMA foto de hermanos y la misma regla que
        // lo comprometido — son los dos sumandos del mismo criterio y no pueden ver cosas distintas.
        const repartidoCubierto = repartirCubiertoPorColor(
          colores,
          cubierto.get(cabeza.idOrden)?.get(claveMaterial(cabeza)),
        );
        grupo.forEach((f, i) => {
          enOcPorFila.set(f.id, repartido[i]?.enOc ?? 0);
          cubiertoPorFila.set(f.id, repartidoCubierto[i] ?? 0);
        });
        if (elSinColorSeLlevaLasHuerfanas(colores)) {
          // El MISMO renglón que la lectura elige (`findIndex` allá, `find` aquí: los dos, el
          // primero sin color). Si divergieran, se leería sobre uno y se cancelaría sobre otro.
          const sinColor = grupo.find((f) => colorDelRenglon(f) === null);
          if (sinColor !== undefined) absorbeHuerfanas.add(sinColor.id);
        }
      }
    }

    const nombreDe = (f: (typeof filas)[number]): string => {
      const material =
        f.tela?.nombre ?? (f.avio === null ? '—' : `${f.avio.clave} — ${f.avio.descripcion}`);
      const color = f.telaColor?.nombre ?? f.colorPrenda?.nombre ?? null;
      return color === null ? material : `${material} · ${color}`;
    };

    const afectados: DarPorCubiertoSalida['afectados'] = [];

    for (const f of filas) {
      const enOc = enOcPorFila.get(f.id) ?? 0;
      const yaCubierto = cubiertoPorFila.get(f.id) ?? 0;
      if (datos.cubierto) {
        const pendiente = pendienteDeComprar(Number(f.cantidadAComprar), enOc, yaCubierto);
        // Nada que cubrir = nada que escribir. Es lo que vuelve idempotente a la operación, y
        // también lo que evita guardar un acto de cero que después nadie sabría interpretar.
        if (!seGuardaComoAlgo(pendiente)) continue;
        await tx.requerimientoCubierto.create({
          data: {
            idOrden: f.idOrden,
            idTela: f.idTela,
            idAvio: f.idAvio,
            idTelaColor: f.idTelaColor,
            idColorPrenda: f.idColorPrenda,
            cantidad: pendiente,
            // RASTRO (A7): contra qué requerido y con qué comprado se tomó la decisión. NO se usa
            // para calcular después —el cálculo lee siempre el snapshot vivo—, se guarda para poder
            // reconstruir la decisión tal como se tomó.
            cantidadRequerida: Number(f.cantidadAComprar),
            cantidadComprada: enOc,
            origen: 'explosion',
            ...datosCreacion(sesion),
          },
        });
        afectados.push({
          idRequerimiento: f.id,
          idOrden: f.idOrden,
          folioOrden: Number(f.orden.folio),
          material: nombreDe(f),
          unidad: f.unidad,
          cantidad: pendiente,
        });
        continue;
      }
      // ── VOLVER A PEDIRLO: cancelación SUAVE de los actos vivos de ESE renglón (D3) ──
      //
      // ⭐⭐ **fila 0.162 — LO QUE LA LECTURA ABSORBE, EL DESHACER LO SUELTA.** Cuando este renglón
      // es el ÚNICO del material y no dice color, `repartirCubiertoPorColor` le atribuyó también
      // las marcas de colores que ya nadie reclama; entonces «volver a pedirlo» tiene que cancelar
      // TODAS las del material —con color o sin él— o el comprador vería *«cubierto: 10»* y el
      // botón se quedaría mudo, con el faltante cerrado y sin manera de reabrirlo. En cualquier
      // otro caso se cancela sólo lo de SU color exacto: soltar la marca de otro tono sería
      // reabrir un faltante que su dueño no pidió reabrir.
      const soloSuColor = !absorbeHuerfanas.has(f.id);
      const vivos = await tx.requerimientoCubierto.findMany({
        where: {
          idOrden: f.idOrden,
          idTela: f.idTela,
          idAvio: f.idAvio,
          ...(soloSuColor ? { idTelaColor: f.idTelaColor, idColorPrenda: f.idColorPrenda } : {}),
          canceladoEn: null,
        },
        select: { id: true, cantidad: true },
      });
      if (vivos.length === 0) continue;
      await tx.requerimientoCubierto.updateMany({
        where: { id: { in: vivos.map((v) => v.id) } },
        data: {
          canceladoEn: new Date(),
          canceladoPorId: sesion.id,
          ...datosModificacion(sesion),
        },
      });
      afectados.push({
        idRequerimiento: f.id,
        idOrden: f.idOrden,
        folioOrden: Number(f.orden.folio),
        material: nombreDe(f),
        unidad: f.unidad,
        cantidad: redondearCantidadCompra(vivos.reduce((s, v) => s + Number(v.cantidad), 0)),
      });
    }

    if (afectados.length > 0) {
      await registrarBitacora(tx, sesion, {
        entidad: 'Orden',
        // La bitácora cuelga de la PRIMERA orden tocada y nombra a todas: es un solo acto del
        // comprador aunque roce varias OP (el mismo criterio que el acto en bloque de §Post-F9.88).
        idEntidad: afectados[0]?.idOrden ?? 0,
        accion: datos.cubierto ? 'OTRO' : 'CANCELAR',
        datos: {
          dadoPorCubierto: datos.cubierto,
          origen: 'explosion',
          renglones: afectados.map((a) => ({
            idOrden: a.idOrden,
            folioOrden: a.folioOrden,
            material: a.material,
            cantidad: a.cantidad,
          })),
        },
      });
    }

    return { cubierto: datos.cubierto, afectados };
  }, bd);
}
