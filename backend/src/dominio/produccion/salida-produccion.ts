/**
 * SALIDA A PRODUCCIÓN (rediseño R3, B4 — proto §4.1 "Generar OP"): la operación CENTRAL del flujo
 * nuevo de captura. Desde un RENGLÓN de pedido interno (que el constructor eligió por su modelo DE
 * DESARROLLO), aquí NACE la matriz color×talla y, en UNA transacción (A2):
 *
 *  1. Se resuelve **EL MODELO DE PRODUCCIÓN DE LA OP** (V1-E3, §Post-F9.172(b)): si el renglón
 *     apunta a un modelo de DESARROLLO, se REUSA —o, si no existe, NACE— el modelo de producción
 *     **de ese color**, con su propio nº de 5 dígitos y **compartiendo la receta del desarrollo**.
 *     Si el renglón ya apunta a un modelo de producción (todo el histórico del Access), la OP lo
 *     lleva tal cual y nada nace.
 *  2. Se crea la ORDEN de producción REUSANDO `crearOrden` (F2-E2: autorrelleno cliente/empresa del
 *     renglón→pedido, folio por secuencia atómica A3, snapshot `ocCliente` B3 y el evento outbox
 *     `orden-creada` B5 — la RC se programa SOLA en segundo plano), **sellada con el modelo del
 *     paso 1**.
 *  3. Se capturan las REFERENCIAS del cliente (D7) si vienen (helpers compartidos de `ordenes.ts`).
 *  4. Se LIGA la orden a su desarrollo (`DesarrolloOrden`) REUSANDO el núcleo de `ligarOrden`
 *     (F8-E6) — si el renglón NO tiene desarrollo, la OP nace SIN liga (caso legado, proto §4.1).
 *
 * ---
 * ## ⭐⭐ QUÉ CAMBIÓ EN V1-E3, Y POR QUÉ ERA LO QUE FALTABA
 *
 * DANIEL: *cuatro órdenes de compra del cliente para **cuatro colores del mismo modelo** tienen que
 * producir **cuatro modelos de producción** —uno por color, cada uno con su número de 5 dígitos— y
 * **una sola receta**, la del desarrollo del que salieron.*
 *
 * Hasta aquí este paso llamaba a `promoverAProduccionNucleo`, que **TRANSFORMA la fila** del
 * desarrollo (le cambia el código, le pone el número y lo muda de catálogo). Con eso, la 1ª OC se
 * llevaba el modelo entero y las otras tres **heredaban el mismo**: sus cuatro OC daban **UN**
 * modelo. Ahora llama a `obtenerODerivarModeloDeProduccion`, que **crea una fila NUEVA** por color y
 * deja el desarrollo intacto y en su catálogo — que es lo único que permite que de un mismo
 * desarrollo salgan cuatro.
 *
 * ⚠️ **UNA salida hace nacer UN modelo, no N.** Los cuatro salen de CUATRO llamadas (una OC = un
 * PDF = un renglón = una OP), que es como llega el caso real de C&A. Una sola OP puede llevar varios
 * colores en su matriz (`OrdenLinea` es por color) y entonces **no hay "el color del que nació"**:
 * ese hijo se guarda SIN color y cubre todos los de su matriz — exactamente como se comportaba el
 * sistema antes de esta etapa. Ver {@link colorDeIdentidad}.
 *
 * 🔴 **LA RAMA LEGADO SE CONSERVA, Y NO ES UN DETALLE.** `derivarModeloDeProduccion` exige que el
 * padre sea de DESARROLLO y lanza 409 si ya es de producción. Sin el `else` de abajo, **ninguno de
 * los ~4,987 modelos migrados del Access podría generar una OP**.
 *
 * 🔴 **Y LA IDEMPOTENCIA HAY QUE PONERLA, PORQUE ANTES ERA UN EFECTO DE BORDE.** El freno del doble
 * clic era que la 1ª salida dejaba el modelo en `produccion` y la 2ª ya no promovía. Con el linaje,
 * el desarrollo **se queda en desarrollo para siempre** ⇒ cada llamada derivaría. Quien lo impide es
 * `obtenerODerivarModeloDeProduccion` (lock + llave `(desarrollo, color)`), no este archivo.
 *
 * ---
 * Reglas deliberadas (diferencias vs el prototipo, documentadas):
 *  • El proto AJUSTABA la cantidad del renglón del pedido al total de la matriz; aquí NO se
 *    re-escribe `PedidoLinea.cantidadPedida` — el backend F2 modela N órdenes por renglón
 *    (resurtidos) y el pedido es el compromiso comercial, no un espejo de la matriz. La validación
 *    cuadra/faltan/sobran es GUÍA de la UI.
 *  • El renglón del pedido **NO se re-apunta** al modelo nuevo: sigue apuntando a su DESARROLLO, que
 *    es de donde salen la receta y el precio negociado. El hijo vive en la ORDEN.
 *
 * Permiso: `ordenes.administrar` (el MISMO con que hoy nacen órdenes — sin permisos nuevos). La
 * liga al desarrollo es un EFECTO de crear la OP (no una edición del expediente de Desarrollo),
 * por eso no exige `desarrollo.administrar` (el núcleo compartido valida las mismas reglas A1).
 */
import type { DatosSalidaProduccion, SalidaProduccionSalida } from '../../contrato/index.js';
import { esquemaSalidaProduccionCuerpo } from '../../contrato/index.js';

import { registrarBitacora } from '../../comun/auditoria.js';
import { dispararPublicacion } from '../../comun/cola-eventos.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { CODIGO_PRISMA, codigoErrorPrisma } from '../../comun/prisma-errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { enTransaccion, type ContextoBd, type Tx } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { ligarOrdenNucleo } from '../desarrollo/liga-orden.js';
import { obtenerODerivarModeloDeProduccion } from '../modelos/nomenclatura.js';

import { crearOrden, obtenerOrden, sincronizarReferencias, validarReferencias } from './ordenes.js';

/** Qué pasó con el modelo de producción de la OP (el `describe` del contrato lo explica). */
type EstadoModeloDeProduccion = SalidaProduccionSalida['modeloDeProduccion'];

/** Lo que el paso 1 deja resuelto para los pasos 2-4 y para la respuesta. */
interface ModeloDeLaOp {
  idModelo: number;
  codigo: string;
  numeroProduccion: number | null;
  idModeloDesarrollo: number | null;
  codigoModeloDesarrollo: string | null;
  avisos: string[];
  estado: EstadoModeloDeProduccion;
}

/**
 * ⭐⭐ **EL COLOR DEL QUE NACE EL MODELO** — la mitad de su identidad (V1-E3, §Post-F9.172(b)).
 *
 * Devuelve el color de la matriz **cuando hay exactamente uno con piezas**, y `null` cuando hay
 * varios. No es una simplificación: es que la frase *"el color del que nació"* **no tiene
 * referente** en una OP multicolor, y el modelo no puede llevar dos.
 *
 * ⚠️ **Las dos poblaciones son reales, medidas, y no una teórica:**
 *  • el importador de OC por **PDF (C&A)** arma **UN SOLO renglón de color por OP** — es el caso de
 *    Daniel, y por él salen los cuatro modelos de los cuatro colores;
 *  • el importador por **Excel** agrupa **por modelo**, así que su matriz trae todos los colores del
 *    modelo en una sola OP ⇒ un hijo SIN color, que cubre esos colores igual que antes de V1-E3.
 *
 * Sólo cuentan los colores CON piezas: un renglón que quedó en ceros (o con `tallas: []`, que es
 * como llega desde la pantalla cuando se agrega un color y no se le captura nada) no es un color de
 * la orden, y dejar que decidiera la identidad del modelo haría que agregar y vaciar una fila
 * cambiara qué modelo nace. Se dedupe por si la matriz repitiera un color: quien rechaza el
 * repetido es `sincronizarMatriz`, más adelante y en la misma transacción.
 *
 * ---
 * ## ⚠️ LA FRONTERA DE ESTA DECISIÓN, ESCRITA PARA QUE NO SORPRENDA
 *
 * Los dos tipos de hijo **conviven bajo el mismo desarrollo**, y eso tiene una consecuencia que hay
 * que poder explicar: si una OC llegó por **Excel** con Rojo y Azul en la misma OP, nació un hijo
 * MULTICOLOR (sin color) que cubre los dos; si después llega una OC por **PDF** sólo de Rojo, nace
 * un hijo de Rojo con **su propio número** — porque la llave `(desarrollo, color)` no encuentra
 * ninguno para Rojo. ⇒ **el Rojo queda produciéndose bajo dos números**, uno por cada camino.
 *
 * 🔑 **No es un defecto: es el precio de la decisión, y el barato.** La alternativa —que el hijo
 * multicolor "cubra" también las OC de un solo color— le daría **un número a varias prendas**, que
 * es justo lo contrario de lo que Daniel pidió (*«un número por prenda real»*). Entre repetir un
 * número de más para el mismo color y tener un número que significa varias cosas, esta etapa elige
 * lo primero, porque lo primero se ve y lo segundo no.
 *
 * ⚠️ Y la frontera se estrecha sola: el camino que Daniel usa —el PDF de C&A— trae **un color por
 * OP**, así que el multicolor sólo aparece por el importador de Excel.
 */
export function colorDeIdentidad(lineas: DatosSalidaProduccion['lineas']): number | null {
  const conPiezas = new Set(
    lineas
      .filter((linea) => linea.tallas.reduce((suma, talla) => suma + talla.cantidad, 0) > 0)
      .map((linea) => linea.idColor),
  );
  return conPiezas.size === 1 ? [...conPiezas][0]! : null;
}

/**
 * Genera la OP de un renglón de pedido (la "salida a producción", B4). Ver el encabezado del
 * módulo para el detalle de los pasos; todo ocurre en UNA transacción (A2) — si el modelo, la
 * matriz o la liga fallan, NADA persiste (ni la orden, ni el modelo nuevo, ni su número).
 */
export async function salidaAProduccion(
  sesion: SesionUsuario,
  idPedidoLinea: number,
  entrada: DatosSalidaProduccion,
  bd?: ContextoBd,
): Promise<SalidaProduccionSalida> {
  verificarPermiso(sesion, 'ordenes.administrar');
  const datos = validarEntrada(esquemaSalidaProduccionCuerpo, entrada);

  // La matriz nace aquí: debe traer PIEZAS (>0). El desglose exacto lo valida `crearOrden`
  // (colores activos, tallas del catálogo, sin repetidos).
  const totalPiezas = datos.lineas.reduce(
    (suma, linea) => suma + linea.tallas.reduce((s, t) => s + t.cantidad, 0),
    0,
  );
  if (totalPiezas <= 0) {
    throw new ErrorValidacion('Captura las cantidades por color y talla de la orden.');
  }

  const resultado = await enTransaccion(async (tx) => {
    // Renglón + pedido (empresa activa, A9) + su desarrollo: la fuente del flujo.
    const linea = await tx.pedidoLinea.findFirst({
      where: { id: idPedidoLinea, pedido: { idEmpresa: sesion.idEmpresaActiva } },
      select: {
        id: true,
        idModelo: true,
        idDesarrollo: true,
        pedido: { select: { id: true, folio: true, fechaDe: true, fechaHasta: true } },
      },
    });
    if (linea === null) {
      throw new ErrorNoEncontrado('Renglón de pedido', idPedidoLinea);
    }

    // 1) EL MODELO DE LA OP (V1-E3). Ver `resolverModeloDeLaOp`: derivar/reusar por color, o —si el
    //    renglón ya apunta a producción— heredarlo tal cual (rama legado, los 4,987 del Access).
    const modeloOp = await resolverModeloDeLaOp(tx, sesion, linea.idModelo, datos);

    // 2) La orden nace por el alta F2 (folio A3 + autorrelleno + snapshot ocCliente B3 + evento
    //    outbox orden-creada B5), UNIDA a esta transacción (composición A2) y SELLADA con el modelo
    //    del paso 1 — no con el del renglón, que sigue siendo el de desarrollo.
    const orden = await crearOrden(
      sesion,
      {
        idPedidoLinea,
        lineas: datos.lineas,
        fecha: datos.fecha ?? aFechaIso(new Date()),
        // Sin fecha explícita, la OP hereda la ventana de entrega del pedido (la RC automática
        // la usa como fecha de entrega de la ruta).
        fechaEntrega:
          datos.fechaEntrega ??
          aFechaIso(linea.pedido.fechaHasta) ??
          aFechaIso(linea.pedido.fechaDe),
      },
      { tx },
      { idModeloDeLaOrden: modeloOp.idModelo },
    );

    // 3) Referencias del cliente (D7), si vienen: helpers compartidos con `guardarReferenciasOrden`.
    let ordenSalida = orden;
    if (datos.referencias !== undefined && datos.referencias.length > 0) {
      await validarReferencias(tx, orden.idCliente, datos.referencias);
      await sincronizarReferencias(tx, sesion, orden.id, datos.referencias);
      // La salida de `crearOrden` se LEYÓ antes de escribir las referencias (fallo del CI): se
      // relee EN LA MISMA tx para que la respuesta las traiga (la promesa de B4 es "refs D7 en la
      // misma operación", también en el payload que consume la UI).
      ordenSalida = await obtenerOrden(sesion, orden.id, { tx });
    }

    // 4) Liga al desarrollo (núcleo de F8-E6) — solo si el renglón tiene desarrollo.
    //    ⚠️ Este paso es el que reventaba: `ligarOrdenNucleo` exigía `desarrollo.idModelo ===
    //    orden.idModelo`, y desde V1-E3 la orden lleva el HIJO mientras el desarrollo apunta al
    //    PADRE. Ahora compara contra el LINAJE de la orden (ver esa función).
    let ligaCreada = false;
    if (linea.idDesarrollo !== null) {
      await ligarOrdenNucleo(tx, sesion, orden.id, linea.idDesarrollo, sesion.idEmpresaActiva);
      ligaCreada = true;
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: orden.id,
      accion: 'OTRO',
      datos: {
        operacion: 'salida-a-produccion',
        idPedidoLinea,
        folioPedido: Number(linea.pedido.folio),
        folioOrden: orden.folio,
        idDesarrollo: linea.idDesarrollo,
        // De qué modelo salió la OP y de dónde salió ÉL: sin las dos cosas, la bitácora no puede
        // contestar "¿por qué esta OP dice 71004 si el pedido decía CYA-26-71-001?".
        idModeloRenglon: linea.idModelo,
        idModeloOrden: modeloOp.idModelo,
        codigoModeloOrden: modeloOp.codigo,
        numeroProduccion: modeloOp.numeroProduccion,
        modeloDeProduccion: modeloOp.estado,
        idModeloDesarrollo: modeloOp.idModeloDesarrollo,
        referencias: datos.referencias?.length ?? 0,
        totalPiezas,
      },
    });

    return {
      orden: ordenSalida,
      idModeloProduccion: modeloOp.idModelo,
      codigoModeloProduccion: modeloOp.codigo,
      numeroProduccion: modeloOp.numeroProduccion,
      modeloDeProduccion: modeloOp.estado,
      idModeloDesarrollo: modeloOp.idModeloDesarrollo,
      codigoModeloDesarrollo: modeloOp.codigoModeloDesarrollo,
      avisosNumeroProduccion: modeloOp.avisos,
      idDesarrollo: linea.idDesarrollo,
      ligaCreada,
    };
  }, bd);

  // El evento outbox lo escribió `crearOrden` en la MISMA tx; aquí (ya commiteada) se dispara la
  // publicación best-effort (dentro de la tx el relay no ve la fila; el barrido la recuperaría).
  dispararPublicacion();

  return resultado;
}

/**
 * Paso 1 — **de qué modelo es esta OP**. Las dos ramas de V1-E3, y las dos hacen falta:
 *
 *  • **`desarrollo`** → el modelo de producción **de este color** se reusa o nace
 *    (`obtenerODerivarModeloDeProduccion`): número propio de 5 dígitos, ficha heredada del padre y
 *    **la receta del padre, compartida, no copiada**. El desarrollo no recibe ni un `update`.
 *  • **`produccion`** → 🔴 **LA RAMA LEGADO**: el renglón ya apunta a un modelo de producción (los
 *    ~4,987 migrados del Access, o cualquiera ya derivado y elegido a mano en un pedido). La OP lo
 *    lleva tal cual y **nada nace**. Sin ella, `derivarModeloDeProduccion` lanzaría 409 —exige que
 *    el padre sea de desarrollo— y **ningún modelo migrado podría producir**.
 *
 * ⚠️ La descripción del hijo se arma con el nombre del color (*"Playera · Rojo"*) para que el
 * catálogo se pueda leer: cuatro renglones `71001…71004` con la MISMA descripción heredada serían
 * indistinguibles a la vista. En una matriz MULTICOLOR no hay color que nombrar y se hereda la del
 * padre tal cual.
 *
 * 🔴 **Y un `idColor` que NO EXISTE se rechaza AQUÍ, no más adelante.** Aquí decía que de eso ya se
 * encargaba `sincronizarMatriz` *"más adelante"* — **y era falso, medido**: desde V1-E3 el modelo
 * NACE antes que la matriz, así que el id inventado llega primero al `create` del hijo y lo que
 * salta es la **FK (P2003)**, que el `catch` de abajo no mapea (sólo mira unicidad) ⇒ escapaba como
 * *"Ocurrió un error inesperado"*, **HTTP 500**, donde antes de esta etapa había un 400 de dominio
 * limpio. El `findUnique` que arma la descripción ya sabía la respuesta: sólo le faltaba lanzarla.
 */
async function resolverModeloDeLaOp(
  tx: Tx,
  sesion: SesionUsuario,
  idModeloRenglon: number,
  datos: DatosSalidaProduccion,
): Promise<ModeloDeLaOp> {
  const modelo = await tx.modelo.findUniqueOrThrow({
    where: { id: idModeloRenglon },
    select: { origen: true, numeroProduccion: true, codigo: true, descripcion: true },
  });

  if (modelo.origen !== 'desarrollo') {
    return {
      idModelo: idModeloRenglon,
      codigo: modelo.codigo,
      numeroProduccion: modelo.numeroProduccion,
      idModeloDesarrollo: null,
      codigoModeloDesarrollo: null,
      avisos: [],
      estado: 'heredado',
    };
  }

  const idColor = colorDeIdentidad(datos.lineas);
  let color: { nombre: string } | null = null;
  if (idColor !== null) {
    color = await tx.color.findUnique({ where: { id: idColor }, select: { nombre: true } });
    if (color === null) {
      // 🔴 Ver el encabezado: sin esto el id inventado viaja hasta el `create` del hijo y sale como
      // un 500 por violación de FK. El color de la matriz lo VUELVE a validar `sincronizarMatriz`
      // (también su estado activo); esto no lo sustituye, sólo llega antes porque desde V1-E3 el
      // modelo nace primero.
      throw new ErrorNoEncontrado('Color', idColor);
    }
  }
  const descripcion =
    color === null ? undefined : [modelo.descripcion, color.nombre].filter(Boolean).join(' · ');

  // El núcleo ya rechaza el número repetido con un conflicto claro; el `catch` cubre la CARRERA
  // residual (dos nacimientos simultáneos con el mismo número desde pares distintos, que el lock
  // del par no serializa) para que salga como 409 y no como un P2002 crudo en 500.
  let resuelto;
  try {
    resuelto = await obtenerODerivarModeloDeProduccion(tx, sesion, idModeloRenglon, {
      idColor,
      ...(datos.numeroProduccion === undefined ? {} : { numeroCapturado: datos.numeroProduccion }),
      ...(descripcion === undefined ? {} : { descripcion }),
    });
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ese número de producción ya está ocupado por otro modelo.', {
        causa: error,
      });
    }
    throw error;
  }

  return {
    idModelo: resuelto.idModelo,
    codigo: resuelto.codigo,
    numeroProduccion: resuelto.numeroProduccion,
    idModeloDesarrollo: resuelto.idModeloDesarrollo,
    codigoModeloDesarrollo: modelo.codigo,
    avisos: resuelto.avisos,
    estado: resuelto.reusado ? 'reusado' : 'nacido',
  };
}

/** Convierte un `Date` (o null) a `YYYY-MM-DD` para el contrato del alta de orden. */
function aFechaIso(fecha: Date | null): string | undefined {
  return fecha === null ? undefined : fecha.toISOString().slice(0, 10);
}
