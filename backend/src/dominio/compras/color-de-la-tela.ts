/**
 * ⭐⭐ **LA TELA SE COMPRA POR COLOR** (V1-E3u, `DECISIONES.md` §Post-F9.89).
 *
 * Daniel: *"se selecciona una tela con la que se desarrolla el producto, de ahí nos piden esas
 * telas para distintas órdenes en diferentes colores. Cuando se hace la receta no lleva el color,
 * solo lleva la tela. Pero al pedir la tela, no puedo pedir esa tela solamente, tengo que pedir el
 * color en cada modelo"*.
 *
 * ## Qué vive aquí
 *
 *  1. **Leer** los colores de la orden por renglón de tela, con lo que ya está amarrado, lo que el
 *     sistema PROPONE (`casar-color-de-tela.ts`) y lo elegible del catálogo.
 *  2. **Amarrar** (o quitar) el color de tela que le toca a un color de prenda EN ESTA ORDEN.
 *  3. **Corregir el precio del color — que ACTUALIZA EL CATÁLOGO** (decisión (b) de Daniel).
 *
 * ## Dónde vive el amarre y por qué
 *
 * En la **orden**, no en el catálogo ni en el BOM: `OrdenTelaColor` cuelga de `OrdenTela`. Es el
 * mismo criterio de §Post-F9.82 (`idProveedorCompra`) y de toda la receta congelada de V1-E3d: *el
 * catálogo propone, la orden manda*. El modelo define la TELA —y eso está bien, es lo que Daniel
 * dijo—; el COLOR es de cada pedido, así que dos OP del mismo modelo compran colores distintos sin
 * pisarse nunca.
 *
 * ## El permiso: `compras.administrar`, y por qué NO uno nuevo
 *
 * Es el mismo que genera las OC y el mismo que §Post-F9.82 le dio a Compras para desatorar. Un
 * permiso propio para esto nacería **sin asignar a nadie** y cerraría en silencio justo el camino
 * que la decisión vino a abrir — la cicatriz de §Post-F9.17/.85 (*un arreglo que necesita que
 * alguien haga algo no está terminado hasta que alguien lo hace*). Y `telas.administrar` tampoco
 * sirve: obligaría al comprador a esperar al dueño del catálogo, que es exactamente la espera que
 * §Post-F9.82 quitó.
 *
 * Innegociables: A1 (toda la regla aquí; la pantalla no calcula nada) · A2 (transacción) ·
 * A4 (RBAC) · A7 (bitácora con el ANTES y el DESPUÉS) · A9 (orden ajena → 404) · D3 (quitar un
 * amarre se audita; nada desaparece callado).
 */
import type {
  ColorDeLaOrden,
  ColoresDeTelaSalida,
  DatosAsignarColorTela,
  DatosFijarPrecioColor,
  FijarPrecioColorSalida,
  TelaConColores,
} from '../../contrato/index.js';

import type { Prisma } from '../../datos/index.js';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { enTransaccion, type ContextoBd, type Tx } from '../../comun/transaccion.js';
import { numOrNull } from '../costos/decimales.js';
import { algunaRecibida, ESTATUS_OC_COMPROMETIDA } from './comprometido-en-oc.js';
import { proponerColorDeTela, type ColorDeTelaCandidato } from './casar-color-de-tela.js';

/** Selección de la orden con lo que hace falta para armar el desglose por color. */
const seleccionOrden = {
  id: true,
  folio: true,
  lineas: {
    orderBy: { idColor: 'asc' },
    select: {
      idColor: true,
      pantone: true,
      color: { select: { nombre: true } },
      tallas: { select: { cantidad: true } },
    },
  },
  recetaTelas: {
    orderBy: { id: 'asc' },
    select: {
      id: true,
      idTela: true,
      consumoPorPrenda: true,
      excluido: true,
      liberadoEn: true,
      tela: {
        select: {
          nombre: true,
          unidadMedida: true,
          // ⭐ V1-E6b (§Post-F9.106): la pantalla de compra necesita saber si la tela LLEVA
          // complemento para decidir si pregunta su precio al dar de alta un color.
          nombreComplemento: true,
          colores: {
            orderBy: { nombre: 'asc' },
            select: {
              id: true,
              nombre: true,
              pantone: true,
              precio: true,
              precioComplemento: true,
              idColor: true,
            },
          },
        },
      },
      colores: { select: { idColor: true, idTelaColor: true } },
    },
  },
} satisfies Prisma.OrdenSelect;

/** La orden cargada con lo que el desglose por color necesita. */
type OrdenParaColores = Prisma.OrdenGetPayload<{ select: typeof seleccionOrden }>;

/** Carga la orden de la empresa activa (A9: la ajena responde 404 y no se dice nada más de ella). */
async function cargarOrden(tx: Tx, idOrden: number, idEmpresa: number): Promise<OrdenParaColores> {
  const orden = await tx.orden.findFirst({
    where: { id: idOrden, idEmpresa },
    select: seleccionOrden,
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }
  return orden;
}

// ── ⭐ V1-E4c — HASTA CUÁNDO SE PUEDE CAMBIAR EL COLOR (§Post-F9.79, misma regla) ───────────────

/**
 * Lo que UNA compra ya comprometida dice de un color: en qué OC está y si alguna ya se RECIBIÓ.
 * La llave del mapa es `idTela|idTelaColor`, que es exactamente lo que la línea de OC amarra.
 */
export interface CompraDelColor {
  folios: number[];
  recibida: boolean;
}

/** Llave del mapa de compras comprometidas: la tela y el color de tela de la línea de OC. */
function llaveColorComprado(idTela: number, idTelaColor: number): string {
  return `${String(idTela)}|${String(idTelaColor)}`;
}

/**
 * ⭐ **QUÉ COLORES DE ESTA ORDEN YA ESTÁN COMPRADOS EN FIRME.**
 *
 * Lee las líneas de OC de ESTA orden de producción cuya OC está en {@link ESTATUS_OC_COMPROMETIDA}
 * —la MISMA lista que usa la guarda de la receta (§Post-F9.79), no un criterio paralelo— y las
 * agrupa por (tela, color de tela).
 *
 * 🔴 **Las líneas SIN color (`idTelaColor = null`) NO entran, y es una decisión, no un olvido.** Son
 * el acervo de todo lo anterior a §Post-F9.89 (7,978 OC migradas): una OC que dice *"esta tela"* sin
 * decir el tono **no se contradice** con que alguien capture después de qué color era —no afirma
 * nada sobre el color—, y si bloquearan, ninguna orden histórica podría capturar jamás sus colores.
 * Eso cerraría justo el camino que esta etapa vino a abrir. Lo que esas OC sí producen (que el
 * neteo tenga que ELEGIR a qué color atribuirlas) ya se dice en la explosión
 * (`cantidadEnOcSinColor`) en vez de callarse.
 *
 * A9: la OC tiene que ser de la misma empresa (una ajena no bloquea nada ni se nombra).
 */
async function comprasComprometidasDeColores(
  tx: Tx,
  idOrden: number,
  idEmpresa: number,
): Promise<Map<string, CompraDelColor>> {
  const lineas = await tx.ordenCompraLinea.findMany({
    where: {
      idOrden,
      idTela: { not: null },
      idTelaColor: { not: null },
      ordenCompra: { idEmpresa, estatus: { in: [...ESTATUS_OC_COMPROMETIDA] } },
    },
    select: {
      idTela: true,
      idTelaColor: true,
      ordenCompra: { select: { numCompra: true, estatus: true } },
    },
    orderBy: { id: 'asc' },
  });

  const mapa = new Map<string, CompraDelColor>();
  for (const l of lineas) {
    if (l.idTela === null || l.idTelaColor === null) continue; // imposible por el `where`
    const llave = llaveColorComprado(l.idTela, l.idTelaColor);
    const acum = mapa.get(llave) ?? { folios: [], recibida: false };
    acum.folios.push(Number(l.ordenCompra.numCompra));
    acum.recibida = acum.recibida || algunaRecibida([l.ordenCompra.estatus]);
    mapa.set(llave, acum);
  }
  return mapa;
}

/**
 * ⭐ **EL MOTIVO, DICHO CON LETRAS** — o `null` si el color sí se puede cambiar. Función PURA (se
 * exporta para poder probarla sin base de datos).
 *
 * Es la MISMA frase en los dos lados: la que la lectura entrega en `motivoNoCambiar` para que la
 * pantalla la pinte ANTES, y la que el rechazo del `PUT` lanza si alguien lo intenta igual. Una
 * segunda redacción sería una segunda regla.
 *
 * Los dos caminos, y por qué se distinguen (Daniel, 20-ago-2026: *"una vez recibido no se puede
 * desautorizar"*): una OC **autorizada** se des-autoriza y listo; una **recibida** ya metió el
 * material al almacén, así que ese camino NO existe y decirlo sería mandar a la persona a un botón
 * que no la va a dejar.
 */
export function motivoNoCambiarColor(
  nombreTelaColor: string,
  compra: CompraDelColor | undefined,
): string | null {
  if (compra === undefined || compra.folios.length === 0) return null;
  const folios = [...new Set(compra.folios)].sort((a, b) => a - b);
  const lista = folios.map((f) => `#${String(f)}`).join(', ');
  const plural = folios.length > 1;
  if (compra.recibida) {
    return (
      `El color "${nombreTelaColor}" ya se RECIBIÓ contra ${plural ? 'las órdenes de compra' : 'la orden de compra'} ` +
      `${lista} de esta orden de producción: ya no se puede cambiar. El material ya entró al ` +
      `inventario, y des-autorizar una OC recibida NO es posible — el camino honesto es una ` +
      `devolución o un ajuste de inventario, no deshacer la firma.`
    );
  }
  return (
    `El color "${nombreTelaColor}" ya está COMPRADO para esta orden en ` +
    `${plural ? 'las órdenes de compra' : 'la orden de compra'} ${lista} ` +
    `(autorizada${plural ? 's' : ''}): no se puede cambiar. Si de verdad va otro color, hay que ` +
    `DES-AUTORIZAR ${plural ? 'esas órdenes de compra' : 'esa orden de compra'} en Compras › ` +
    `Órdenes de compra y volver aquí. Ese botón es del perfil de Dirección: si no te aparece, ` +
    `pídeselo a quien lo tenga. Mientras la OC sea un BORRADOR, el color se cambia libremente.`
  );
}

/**
 * ⭐ **¿DE QUÉ COLOR SE COMPRA LA TELA DE ESTA ORDEN?** Devuelve, por renglón de TELA de la receta
 * congelada, un elemento por cada color de la matriz color×talla de la OP, con:
 *  • las **piezas** de ese color y la **tela que pide** (piezas × consumo por prenda) — el cálculo
 *    lo hace el SERVIDOR (A1: la pantalla no reparte);
 *  • el color de tela **ya amarrado**, si lo hay;
 *  • el que el sistema **propone**, con la razón por la que lo propone;
 *  • y los colores **elegibles** de esa tela, con su precio (decisión (b) los necesita a la vista).
 *
 * Permiso `compras.ver`: es una lectura del comprador, la misma puerta que la explosión.
 */
export async function coloresDeTelaDeOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<ColoresDeTelaSalida> {
  verificarPermiso(sesion, 'compras.ver');
  return enTransaccion(async (tx) => {
    const orden = await cargarOrden(tx, idOrden, sesion.idEmpresaActiva);
    return proyectarColores(
      orden,
      await comprasComprometidasDeColores(tx, idOrden, sesion.idEmpresaActiva),
    );
  }, bd);
}

/**
 * Arma la salida a partir de la orden ya leída (separada para poder reusarla y probarla).
 *
 * ⭐ V1-E4c: recibe además las compras ya comprometidas (mapa `idTela|idTelaColor`) para poder
 * decir, color por color, **si todavía se puede cambiar y por qué no** — que es lo que hace que la
 * pantalla pueda pintar la regla sin deducirla (A1).
 */
function proyectarColores(
  orden: OrdenParaColores,
  compradosEnFirme: Map<string, CompraDelColor>,
): ColoresDeTelaSalida {
  const coloresDeLaOrden = orden.lineas.map((l) => ({
    idColor: l.idColor,
    nombre: l.color.nombre,
    pantone: l.pantone,
    piezas: l.tallas.reduce((s, t) => s + t.cantidad, 0),
  }));

  const telas: TelaConColores[] = orden.recetaTelas.map((mt) => {
    const opciones: ColorDeTelaCandidato[] = mt.tela.colores.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      pantone: c.pantone,
      idColor: c.idColor,
    }));
    const amarrados = new Map(mt.colores.map((c) => [c.idColor, c.idTelaColor]));
    const nombrePorId = new Map(mt.tela.colores.map((c) => [c.id, c.nombre]));
    const consumo = Number(mt.consumoPorPrenda);

    const colores: ColorDeLaOrden[] = coloresDeLaOrden.map((c) => {
      const idTelaColor = amarrados.get(c.idColor) ?? null;
      const propuesta = proponerColorDeTela(opciones, c, coloresDeLaOrden.length);
      // ⭐ V1-E4c: sólo el color YA AMARRADO puede estar comprado. Un color de prenda sin amarre
      // no tiene nada que contradecir, así que siempre se puede capturar — que es el caso normal
      // y el que esta etapa vino a destrabar.
      const motivo =
        idTelaColor === null
          ? null
          : motivoNoCambiarColor(
              nombrePorId.get(idTelaColor) ?? 'ese color',
              compradosEnFirme.get(llaveColorComprado(mt.idTela, idTelaColor)),
            );
      return {
        idColor: c.idColor,
        color: c.nombre,
        pantone: c.pantone,
        piezas: c.piezas,
        cantidadRequerida: c.piezas * consumo,
        idTelaColor,
        telaColor: idTelaColor === null ? null : (nombrePorId.get(idTelaColor) ?? null),
        propuestaIdTelaColor: propuesta.idTelaColor,
        propuestaTelaColor: propuesta.nombre,
        origenPropuesta: propuesta.origen,
        puedeCambiar: motivo === null,
        motivoNoCambiar: motivo,
      };
    });

    return {
      idOrdenTela: mt.id,
      idTela: mt.idTela,
      tela: mt.tela.nombre,
      unidad: mt.tela.unidadMedida,
      nombreComplemento: mt.tela.nombreComplemento,
      consumoPorPrenda: consumo,
      excluido: mt.excluido,
      liberado: mt.liberadoEn !== null,
      colores,
      opciones: mt.tela.colores.map((c) => ({
        idTelaColor: c.id,
        nombre: c.nombre,
        pantone: c.pantone,
        precio: numOrNull(c.precio),
        precioComplemento: numOrNull(c.precioComplemento),
      })),
    };
  });

  return {
    idOrden: orden.id,
    folio: Number(orden.folio),
    telas,
    // 🔴 ⭐ V1-E4c — sin matriz color×talla NO HAY `idColor` del que colgar el amarre: el dato no es
    // difícil de capturar, es IMPOSIBLE de guardar. Se dice para que la pantalla mande a capturar la
    // matriz en vez de ofrecer un control muerto.
    sinMatrizColores: orden.lineas.length === 0,
  };
}

/**
 * ⭐ **AMARRA** el color de tela que le toca a un color de prenda EN ESTA ORDEN (o lo QUITA con
 * `idTelaColor: null`). Idempotente: mandar dos veces lo mismo deja lo mismo.
 *
 * Qué rechaza, y por qué cada cosa:
 *  • **orden de otra empresa** → 404 (A9);
 *  • **tela que no está en la receta** → se dice, con el camino alterno (la receta se edita en la
 *    orden; esta pantalla no es esa puerta);
 *  • **renglón EXCLUIDO** (la lápida de §Post-F9.43) → 409: esta orden decidió que no lo lleva;
 *  • **color de prenda que la orden no tiene en su matriz** → se dice: comprar un color que la OP
 *    no produce no es un caso de negocio, es un error de captura;
 *  • **color de tela de OTRA tela** → se dice con los dos nombres. Es el error que ya no puede
 *    llegar al almacén: hoy quien recibe tiene que inventar la correspondencia.
 */
export async function asignarColorDeTela(
  sesion: SesionUsuario,
  idOrden: number,
  datos: DatosAsignarColorTela,
  bd?: ContextoBd,
): Promise<ColoresDeTelaSalida> {
  verificarPermiso(sesion, 'compras.administrar');
  const idEmpresa = sesion.idEmpresaActiva;

  return enTransaccion(async (tx) => {
    const orden = await cargarOrden(tx, idOrden, idEmpresa);

    const renglon = orden.recetaTelas.find((t) => t.idTela === datos.idTela);
    if (renglon === undefined) {
      throw new ErrorValidacion(
        'Esa tela no está en la receta de esta orden, así que no se le puede decir de qué color ' +
          'comprarla. Si de verdad va en la orden, agrégala primero a la receta.',
      );
    }
    if (renglon.excluido) {
      throw new ErrorConflicto(
        `"${renglon.tela.nombre}" está EXCLUIDA de la receta de la orden ${String(orden.folio)}: ` +
          `esta orden no la lleva, así que no hay color que pedir. Si sí se necesita, restaura el ` +
          `renglón en la receta.`,
      );
    }
    const linea = orden.lineas.find((l) => l.idColor === datos.idColor);
    if (linea === undefined) {
      throw new ErrorValidacion(
        `La orden ${String(orden.folio)} no produce ese color: su matriz de color×talla no lo ` +
          `tiene. Captura el color en la orden antes de decir de qué color se compra su tela.`,
      );
    }

    let nombreNuevo: string | null = null;
    if (datos.idTelaColor !== null) {
      const color = await tx.telaColor.findUnique({
        where: { id: datos.idTelaColor },
        select: { id: true, nombre: true, idTela: true, tela: { select: { nombre: true } } },
      });
      if (color === null) {
        throw new ErrorValidacion('Ese color de tela no existe.');
      }
      // 🔴 EL CERROJO de la etapa: el color tiene que ser de LA TELA del renglón. Sin esto se
      // podría pedir el "Marino" de una felpa contra un renglón de cardigan, y la recepción —que
      // sí exige color— tendría que aceptarlo o inventar la correspondencia otra vez.
      if (color.idTela !== renglon.idTela) {
        throw new ErrorValidacion(
          `El color "${color.nombre}" es de la tela "${color.tela.nombre}", no de ` +
            `"${renglon.tela.nombre}": elige un color dado de alta en la tela que pide la receta.`,
        );
      }
      nombreNuevo = color.nombre;
    }

    const previo = renglon.colores.find((c) => c.idColor === datos.idColor) ?? null;
    const idAnterior = previo?.idTelaColor ?? null;

    // ── ⭐⭐ V1-E4c — **CON LA OC AUTORIZADA YA NO SE CAMBIA EL COLOR** ────────────────────────
    //
    // ⚠️ **DE QUIÉN ES ESTA REGLA:** la propuso el LEAD el 23-ago-2026 como default de la etapa y
    // Daniel NO la objetó (`DECISIONES.md` §Post-F9.96(f)) — **no es una frase suya**, a diferencia
    // de las que sí van entrecomilladas en este módulo. Se dice porque aquí una cita atribuida al
    // dueño es fuente de verdad del negocio, y ponerle en la boca lo que no dijo es cómo una
    // suposición acaba pasando por hecho (§Post-F9.86, la lección de la etapa anterior).
    //
    // Es la misma regla con la que §Post-F9.79 protegió la receta. Mientras la OC
    // sea un BORRADOR (o esté esperando autorización) el color se mueve libre: ahí todavía no hay
    // compromiso con el proveedor. Una vez AUTORIZADA, cambiarlo dejaría a la OC diciendo un tono y
    // a la orden pidiendo otro — y quien recibe volvería a tener que inventar la correspondencia,
    // que es justo lo que §Post-F9.89 vino a quitar.
    //
    // ⚠️ Sólo se comprueba cuando el amarre DE VERDAD cambia: reenviar lo mismo sigue siendo
    // idempotente (mandar dos veces lo mismo deja lo mismo, y no "cambia" nada que proteger).
    if (idAnterior !== null && datos.idTelaColor !== idAnterior) {
      const comprados = await comprasComprometidasDeColores(tx, idOrden, idEmpresa);
      const motivo = motivoNoCambiarColor(
        renglon.tela.colores.find((c) => c.id === idAnterior)?.nombre ?? 'ese color',
        comprados.get(llaveColorComprado(renglon.idTela, idAnterior)),
      );
      if (motivo !== null) {
        throw new ErrorConflicto(motivo);
      }
    }

    if (datos.idTelaColor === null) {
      // D3: quitar NO es borrar en silencio — se audita el ANTES. La fila sí se borra (es un amarre
      // derivado, no un hecho de negocio), pero la bitácora conserva de qué color venía.
      await tx.ordenTelaColor.deleteMany({
        where: { idOrdenTela: renglon.id, idColor: datos.idColor },
      });
    } else {
      await tx.ordenTelaColor.upsert({
        where: {
          idOrdenTela_idColor: { idOrdenTela: renglon.id, idColor: datos.idColor },
        },
        create: {
          idOrdenTela: renglon.id,
          idColor: datos.idColor,
          idTelaColor: datos.idTelaColor,
          ...datosCreacion(sesion),
        },
        update: { idTelaColor: datos.idTelaColor, ...datosModificacion(sesion) },
      });
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: idOrden,
      accion: 'OTRO',
      datos: {
        colorDeLaTela: true,
        idTela: datos.idTela,
        tela: renglon.tela.nombre,
        idColor: datos.idColor,
        color: linea.color.nombre,
        // El ANTES y el DESPUÉS, los dos (A7): quitar un amarre es tan auditable como ponerlo.
        idTelaColorAnterior: idAnterior,
        idTelaColorNuevo: datos.idTelaColor,
        telaColorNuevo: nombreNuevo,
      },
    });

    // Se responde la vista COMPLETA (releída) y no sólo el renglón tocado: la pantalla pinta el
    // desglose entero y una respuesta parcial la obligaría a recomponerlo por su cuenta (A1).
    return proyectarColores(
      await cargarOrden(tx, idOrden, idEmpresa),
      await comprasComprometidasDeColores(tx, idOrden, idEmpresa),
    );
  }, bd);
}

/**
 * ⭐⭐ **CORREGIR EL PRECIO DE UN COLOR — Y ESO ACTUALIZA EL CATÁLOGO** (decisión (b) de Daniel:
 * *"corregir ahí actualiza el catálogo"*).
 *
 * ⚠️ **Lo que hay que tener presente al leer esto: corregir un precio en UNA compra lo cambia para
 * TODOS.** Es lo que Daniel eligió —el precio del color es del color, no de la compra— pero es una
 * escritura de catálogo disparada desde una pantalla de operación, así que tiene que cumplir dos
 * cosas o no vale:
 *  • **quedar auditada** (A7): quién, cuándo, **de cuánto a cuánto** y **desde dónde** (la OP o la
 *    OC desde la que se corrigió). El `origen` no es decoración: es la respuesta a la pregunta que
 *    se hace quien mañana ve otro precio.
 *  • **verse**: la respuesta trae el ANTES y el DESPUÉS para que la pantalla lo pueda enseñar. Un
 *    cambio de catálogo que ocurre callado es exactamente lo que D3 prohíbe.
 *
 * Permiso: `compras.administrar` (ver el encabezado del módulo). El precio del complemento sólo se
 * acepta si la tela lleva complemento — si no, se estaría guardando un número que no significa nada.
 */
export async function fijarPrecioDeColor(
  sesion: SesionUsuario,
  idTelaColor: number,
  datos: DatosFijarPrecioColor,
  bd?: ContextoBd,
): Promise<FijarPrecioColorSalida> {
  verificarPermiso(sesion, 'compras.administrar');
  const idEmpresa = sesion.idEmpresaActiva;

  return enTransaccion(async (tx) => {
    const color = await tx.telaColor.findUnique({
      where: { id: idTelaColor },
      select: {
        id: true,
        nombre: true,
        idTela: true,
        precio: true,
        precioComplemento: true,
        tela: { select: { nombre: true, nombreComplemento: true } },
      },
    });
    if (color === null) {
      throw new ErrorNoEncontrado('TelaColor', idTelaColor);
    }
    if (
      datos.precioComplemento !== undefined &&
      datos.precioComplemento !== null &&
      color.tela.nombreComplemento === null
    ) {
      throw new ErrorValidacion(
        `La tela "${color.tela.nombre}" no lleva complemento: no se le puede poner precio de ` +
          `complemento a su color "${color.nombre}".`,
      );
    }

    // A9 en las TRAZAS: una orden o una OC de otra empresa no se puede citar como origen (sería
    // filtrar que existe). Se validan antes de escribir nada.
    let folioOrden: number | null = null;
    if (datos.idOrden != null) {
      const orden = await tx.orden.findFirst({
        where: { id: datos.idOrden, idEmpresa },
        select: { folio: true },
      });
      if (orden === null) {
        throw new ErrorNoEncontrado('Orden', datos.idOrden);
      }
      folioOrden = Number(orden.folio);
    }
    let numCompra: number | null = null;
    if (datos.idOrdenCompra != null) {
      const oc = await tx.ordenCompra.findFirst({
        where: { id: datos.idOrdenCompra, idEmpresa },
        select: { numCompra: true },
      });
      if (oc === null) {
        throw new ErrorNoEncontrado('OrdenCompra', datos.idOrdenCompra);
      }
      numCompra = Number(oc.numCompra);
    }

    const precioAnterior = numOrNull(color.precio);
    const complementoAnterior = numOrNull(color.precioComplemento);

    const actualizado = await tx.telaColor.update({
      where: { id: idTelaColor },
      data: {
        precio: datos.precio,
        // Omitir ≠ mandar null: omitido deja el que estaba, `null` lo borra a propósito.
        ...(datos.precioComplemento === undefined
          ? {}
          : { precioComplemento: datos.precioComplemento }),
        ...datosModificacion(sesion),
      },
      select: { precio: true, precioComplemento: true },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'TelaColor',
      idEntidad: idTelaColor,
      accion: 'MODIFICAR',
      datos: {
        precioDelColorDesdeLaCompra: true,
        idTela: color.idTela,
        tela: color.tela.nombre,
        color: color.nombre,
        // DE CUÁNTO A CUÁNTO (A7) — no basta con decir que cambió.
        precioAnterior,
        precioNuevo: numOrNull(actualizado.precio),
        precioComplementoAnterior: complementoAnterior,
        precioComplementoNuevo: numOrNull(actualizado.precioComplemento),
        // DESDE DÓNDE se corrigió (§Post-F9.89(b)).
        idOrden: datos.idOrden ?? null,
        folioOrden,
        idOrdenCompra: datos.idOrdenCompra ?? null,
        numCompra,
      },
    });

    return {
      idTelaColor,
      idTela: color.idTela,
      tela: color.tela.nombre,
      color: color.nombre,
      precioAnterior,
      precio: numOrNull(actualizado.precio),
      precioComplementoAnterior: complementoAnterior,
      precioComplemento: numOrNull(actualizado.precioComplemento),
    };
  }, bd);
}
