import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useTela, type Tela } from '@/api/telas';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { SelectorTela } from './SelectorTela';

/** Un renglón capturado del flujo por COLOR: tela+color con AMBAS cantidades juntas. */
export interface RenglonTelaColor {
  idTelaColor: number;
  tela: string;
  color: string;
  /** null = la tela NO lleva complemento (no se captura esa cantidad). */
  nombreComplemento: string | null;
  /** Cantidad del CUERPO (puede ser 0 si la entrada es solo complemento). */
  cantidad: number;
  /** Cantidad del COMPLEMENTO (solo telas que lo llevan). */
  cantidadComplemento: number;
  /** Número de lote del PROVEEDOR (solo entradas — dato de la partida). */
  loteProveedor?: string;
  /** Precio por unidad del CUERPO (solo con `conPrecios`; viaja al kardex como costo, D1). */
  precioUnit?: number;
  /** Precio por unidad del COMPLEMENTO (solo con `conPrecios`; vive en el documento). */
  precioUnitComplemento?: number;
  /** Renglón de OC que SURTE este renglón (§Post-F9.14; solo la entrada por factura). */
  idOrdenCompraLinea?: number;
}

/** Renglón de OC pendiente de recibir, tal como lo ofrece el selector (§Post-F9.14). */
export interface LineaOcPendiente {
  idOrdenCompraLinea: number;
  numCompra: number;
  idTela: number;
  tela: string;
  /** ⭐⭐ V1-E3u (§Post-F9.89): color con el que la OC pidió la tela; null = renglón sin color. */
  idTelaColor: number | null;
  telaColor: string | null;
  pantoneTelaColor: string | null;
  unidad: string | null;
  pendiente: number;
  precio: number;
  /** Cómo se llama el complemento de esa tela ("Cardigan"), o null si no lleva (§Post-F9.19). */
  nombreComplemento: string | null;
  /** Complemento que pidió la OC, y lo que falta por recibir de él. */
  cantidadComplemento: number | null;
  pendienteComplemento: number;
}

/**
 * 🔴 **§Post-F9.159(a) — EL SEGUNDO EJE: qué tiene pendiente de recibir el PROVEEDOR.**
 *
 * Es información **distinta** de `lineasOc` (lo que esta pantalla ofrece capturar ahora mismo), y
 * confundirlas fue un defecto real de la primera versión de esta etapa: por el camino del XML
 * (§Post-F9.20) `lineasOc` sale de los conceptos de la factura que CRUZARON, así que puede venir
 * vacía **mientras el proveedor sí tiene órdenes abiertas** — y la pantalla acusaba de no haber
 * comprado a quien sí había comprado, mandándolo a levantar una OC que ya existía.
 *
 * Por eso el estado de la CONSULTA viaja aparte y con sus valores: `sin-proveedor` (todavía no hay
 * a quién preguntarle) · `consultando` · `error` (se preguntó y NO se sabe) · `ninguno` (se
 * preguntó por TODO el proveedor y de verdad no hay) · `ninguno-en-esta-oc` (se preguntó SÓLO por
 * una orden y esa no tiene nada) · `hay`.
 *
 * 🔴 **Y el sexto valor existe por el ALCANCE, no por el estatus** (segundo hallazgo del reviewer):
 * los cinco primeros agotaban en qué situación quedó la CONSULTA —respondió, falló, va en camino—,
 * pero no POR QUÉ SE PREGUNTÓ. Llegando desde una orden de compra (deep-link) la consulta va
 * ACOTADA a ESA orden, así que una respuesta vacía significa «esta orden no tiene nada pendiente»
 * y **no** «este proveedor no tiene nada»: leerla como `ninguno` mandaba a levantar una OC estando
 * parado dentro de una OC que ya existe y ya está autorizada.
 *
 * **Sólo `ninguno` autoriza a decir "este proveedor no tiene nada pendiente"**, y sólo lo produce
 * la consulta SIN acotar. `hay` sí sobrevive al acotamiento (si esa orden tiene pendiente, el
 * proveedor también: es un subconjunto), y `error`/`consultando`/`sin-proveedor` no afirman nada.
 */
export type EstadoPendientesOc =
  | 'sin-proveedor'
  | 'consultando'
  | 'error'
  | 'ninguno'
  | 'ninguno-en-esta-oc'
  | 'hay';

/**
 * 🔴 **LA FRASE QUE SIGUE AL BLOQUEO, cada una atada a SU disparador.** Se decide con los DOS ejes
 * —lo que hay ofrecido aquí y lo que el proveedor tiene pendiente— porque colapsarlos en uno es lo
 * que hacía que la pantalla acusara de no haber comprado a quien sí había comprado.
 *
 * ⚠️ Ninguna rama afirma más de lo que su entrada sostiene: «este proveedor no tiene nada
 * pendiente» **sólo** con `'ninguno'` (se preguntó por TODO el proveedor y venía vacía); con
 * `'ninguno-en-esta-oc'` la respuesta vacía sólo cubre UNA orden, así que la frase habla de esa
 * orden y de nada más; con `'error'` se dice que NO se sabe, que es lo único honesto; y sin
 * proveedor no se le atribuye nada a nadie.
 */
function textoDeLaSalida(hayOfrecidos: boolean, estado: EstadoPendientesOc): string {
  if (hayOfrecidos) {
    return 'Captúralo con «Capturar» desde su renglón pendiente, aquí arriba.';
  }
  switch (estado) {
    case 'hay':
      // Hay compras abiertas pero aquí no se está ofreciendo ninguna: pasa por el camino del XML
      // cuando ningún concepto de la factura cruzó. Lo que NO se puede es culpar a la compra.
      return (
        'Este proveedor SÍ tiene tela pendiente de recibir en sus órdenes de compra, pero aquí no ' +
        'se está ofreciendo ninguno de esos renglones: suelta la factura leída y captura desde lo ' +
        'que tenga pendiente.'
      );
    case 'ninguno':
      return 'Y este proveedor no tiene nada pendiente de recibir: lo que falta es levantar (o autorizar) su orden de compra.';
    case 'ninguno-en-esta-oc':
      // 🔴 La consulta iba ACOTADA a la orden desde la que se entró, así que aquí NO se puede
      // hablar del proveedor (no se le preguntó por él) ni mandar a «levantar o autorizar»: a esta
      // pantalla se llega desde el botón «Dar entrada a la tela», que SÓLO aparece en órdenes ya
      // autorizadas — sería mandar a hacer lo que ya está hecho.
      return (
        'Y esta orden de compra ya no tiene tela pendiente de recibir (aquí sólo se preguntó por ' +
        'ella, no por todo el proveedor). Si la tela que llegó es de OTRA orden, captúrala desde ' +
        '«Entradas de tela por factura › Nueva entrada», eligiendo el proveedor.'
      );
    case 'error':
      return 'Y no se pudo consultar lo que este proveedor tiene pendiente de recibir: vuelve a cargar la pantalla antes de dar nada por hecho.';
    case 'consultando':
      return 'Consultando lo que este proveedor tiene pendiente de recibir…';
    case 'sin-proveedor':
      return 'Todavía no hay órdenes de compra que ofrecer aquí: hasta que la entrada tenga proveedor no se sabe qué tiene pendiente de recibir.';
  }
}

/**
 * CAPTURA DE RENGLONES por TELA+COLOR (inventario NUEVO, etapa A2): el usuario elige la tela
 * (typeahead server-side), luego UNO de SUS colores (hijos de la tela, §Post-F9.11) y las DOS
 * cantidades — cuerpo y complemento — que viajan JUNTAS en el mismo renglón (Daniel: el
 * complemento es parte de la misma tela; comprar solo cardigan = cuerpo en 0). Con
 * `conLoteProveedor` (ajustes de ENTRADA) se captura además el número de lote del proveedor de la
 * partida, y con `conPrecios` (documento de entrada por factura/remisión, B1) los DOS precios
 * unitarios — prellenados con los del catálogo del color como SUGERENCIA (la fuente de verdad del
 * costo es lo que se captura aquí, D1). Presentación pura (A1): el backend valida.
 *
 * Con `lineasOc` (entrada por factura, §Post-F9.14) cada renglón se AMARRA a su renglón de orden
 * de compra pulsando **Capturar** en el panel "Pendiente de la orden de compra": la tela, el color,
 * la cantidad y el precio salen de la orden. (Aquí decía que además "deja elegir «sin orden de
 * compra» para la tela suelta" — eso **nunca fue cierto en este componente**, que ya sólo amarra
 * por ese botón, y desde §Post-F9.159(a) además está PROHIBIDO.)
 *
 * 🔴 Con `exigirOrdenCompra` (§Post-F9.159(a), Daniel: *«sin OC no podemos recibir tela. ¿De quién
 * recibiríamos sin OC?»*) el renglón suelto **no se puede agregar**: el botón se apaga y la
 * pantalla explica QUÉ SIGNIFICA —que falta la compra—, en vez de dejar mandar al servidor algo que
 * va a rechazar. Es el "callejón convertido en diagnóstico" de §Post-F9.144(d).
 */
export function CapturaRenglonesTelaColor({
  renglones,
  onChange,
  soloLectura = false,
  conLoteProveedor = false,
  conPrecios = false,
  lineasOc,
  idProveedorTelas,
  exigirOrdenCompra = false,
  estadoPendientesOc = 'sin-proveedor',
}: {
  renglones: RenglonTelaColor[];
  onChange: (renglones: RenglonTelaColor[]) => void;
  soloLectura?: boolean;
  conLoteProveedor?: boolean;
  /** Muestra y captura los precios unitarios de cuerpo y complemento (B1). */
  conPrecios?: boolean;
  /**
   * Renglones de OC PENDIENTES de recibir (§Post-F9.14, replanteado en §Post-F9.15). `undefined` =
   * esta pantalla no liga a órdenes de compra (ajuste, traspaso, salida). Con un arreglo se pinta el
   * panel "Pendiente de la orden de compra": cada renglón trae su botón **Capturar**, que precarga
   * la tela, la cantidad que falta y el precio de la OC — así la liga NO se teclea ni se busca en un
   * combo, sale de la orden. 🔴 Con `exigirOrdenCompra` (§Post-F9.159(a)) ése es el ÚNICO camino:
   * el renglón "a mano", sin orden, dejó de poder agregarse.
   */
  lineasOc?: readonly LineaOcPendiente[] | undefined;
  /** Acota las telas del buscador al proveedor DUEÑO (§Post-F9.15). */
  idProveedorTelas?: number | undefined;
  /**
   * 🔴 §Post-F9.159(a) — esta pantalla RECIBE tela de un proveedor, así que **ningún renglón puede
   * ir sin su orden de compra**. La pone en `true` la captura de la entrada de tela; las demás
   * (ajuste, traspaso, salida) la dejan en `false` porque ahí la OC no pinta nada: un ajuste es una
   * corrección, no una recepción.
   */
  exigirOrdenCompra?: boolean;
  /**
   * Qué tiene pendiente de recibir el PROVEEDOR, según la consulta de la página — **no** según lo
   * que esta pantalla esté ofreciendo. Sólo se lee cuando `exigirOrdenCompra`; ver
   * {@link EstadoPendientesOc} para por qué son dos ejes y no uno.
   */
  estadoPendientesOc?: EstadoPendientesOc;
}): React.JSX.Element {
  const [tela, setTela] = useState<Tela | undefined>(undefined);
  const [idTelaColor, setIdTelaColor] = useState<string>('');
  const [cantidad, setCantidad] = useState<string>('');
  const [cantidadComplemento, setCantidadComplemento] = useState<string>('');
  const [loteProveedor, setLoteProveedor] = useState<string>('');
  const [precioUnit, setPrecioUnit] = useState<string>('');
  const [precioComplemento, setPrecioComplemento] = useState<string>('');
  const [idLineaOc, setIdLineaOc] = useState<string>('');
  /**
   * Renglón de OC cuyo "Capturar" se acaba de pulsar: se guarda mientras llega la tela por su id
   * (`useTela` trae sus colores, que el buscador paginado podría no tener a mano). En cuanto llega,
   * el efecto de abajo llena el formulario y esto se limpia.
   */
  const [pendientePrecargando, setPendientePrecargando] = useState<LineaOcPendiente | null>(null);
  const telaPrecargada = useTela(pendientePrecargando?.idTela);

  /**
   * 🔴 §Post-F9.159(a) — el renglón que se está armando NO viene de ninguna orden de compra. En la
   * entrada de tela eso lo vuelve incapturable (`exigirOrdenCompra`); en ajustes y traspasos, ni
   * siquiera aplica. `idLineaOc` sólo se llena pulsando **Capturar** en un pendiente de la OC.
   */
  const renglonSinOrdenDeCompra = exigirOrdenCompra && idLineaOc === '';
  /**
   * ¿Hay algo que capturar AQUÍ, ahora mismo? Es el eje de "lo ofrecido", y NO dice nada sobre lo
   * que el proveedor tiene pendiente: eso lo dice `estadoPendientesOc`, que llega aparte.
   */
  const hayOfrecidos = lineasOc !== undefined && lineasOc.length > 0;

  const llevaComplemento = tela !== undefined && tela.nombreComplemento !== null;
  const colorElegido = tela?.colores.find((c) => String(c.id) === idTelaColor);
  const cuerpoNum = cantidad === '' ? 0 : Number(cantidad);
  const complementoNum = cantidadComplemento === '' ? 0 : Number(cantidadComplemento);
  const cantidadesValidas =
    Number.isFinite(cuerpoNum) &&
    cuerpoNum >= 0 &&
    Number.isFinite(complementoNum) &&
    complementoNum >= 0 &&
    (cuerpoNum > 0 || (llevaComplemento && complementoNum > 0));

  function elegirTela(t: Tela): void {
    setTela(t);
    setIdTelaColor('');
    setCantidadComplemento('');
    setPrecioUnit('');
    setPrecioComplemento('');
  }

  /**
   * Al elegir el color, PRE-LLENA los precios con los del catálogo (sugerencia editable): el precio
   * real de la factura manda y es el que se guarda (el catálogo no es la fuente de verdad, D1).
   */
  function elegirColor(valor: string): void {
    setIdTelaColor(valor);
    if (!conPrecios) return;
    const color = tela?.colores.find((c) => String(c.id) === valor);
    setPrecioUnit(color?.precio == null ? '' : String(color.precio));
    setPrecioComplemento(color?.precioComplemento == null ? '' : String(color.precioComplemento));
  }

  // Aplica la precarga en cuanto llega la tela: cantidad = lo que FALTA de la OC y precio = el de la
  // orden (los dos editables — lo que llegó puede no ser lo pedido).
  //
  // ⭐⭐ V1-E3u (§Post-F9.89) — **EL COLOR TAMBIÉN SE PRECARGA, porque desde esta etapa la OC SÍ lo
  // dice.** Aquí decía *"el color NO se adivina: la OC no lo define"*, y eso dejó de ser cierto en
  // la misma rama que puso `idTelaColor` en el renglón de OC. 🔴 Y no era sólo un comentario viejo:
  // el confirmar CUADRA el color contra el de la OC y rechaza la factura entera si no coincide, así
  // que dejar el campo vacío obligaba a acertar a ciegas una validación que sí sabe la respuesta.
  //
  // ⚠️ Preseleccionar NO es decidir: el campo queda editable, porque **manda lo que de verdad
  // llegó** (D1: el catálogo no es la fuente de verdad). Si el proveedor mandó otro tono, se cambia
  // aquí y el confirmar lo dirá — que es una conversación distinta de adivinar.
  // Renglón sin color (lo anterior a la etapa y las OC migradas): se queda vacío, como siempre.
  useEffect(() => {
    const pendiente = pendientePrecargando;
    const datos = telaPrecargada.data;
    if (pendiente === null || datos === undefined || datos.id !== pendiente.idTela) {
      return;
    }
    setTela(datos);
    const colorDeLaOc =
      pendiente.idTelaColor !== null && datos.colores.some((c) => c.id === pendiente.idTelaColor)
        ? String(pendiente.idTelaColor)
        : '';
    setIdTelaColor(colorDeLaOc);
    setCantidad(String(pendiente.pendiente));
    // §Post-F9.19: si la OC pidió complemento, se precarga lo que falta de él (editable: lo que
    // llegó puede no ser lo pedido).
    setCantidadComplemento(
      pendiente.pendienteComplemento > 0 ? String(pendiente.pendienteComplemento) : '',
    );
    setPrecioUnit(String(pendiente.precio));
    setIdLineaOc(String(pendiente.idOrdenCompraLinea));
    setPendientePrecargando(null);
  }, [pendientePrecargando, telaPrecargada.data]);

  function agregar(): void {
    if (tela === undefined || colorElegido === undefined || !cantidadesValidas) return;
    // §Post-F9.159(a): el botón ya está apagado en este caso; esto es el cinturón, para que un
    // Enter o un cambio futuro del `disabled` no cuele un renglón que el servidor va a rechazar.
    if (renglonSinOrdenDeCompra) return;
    const precioCuerpoNum = precioUnit === '' ? undefined : Number(precioUnit);
    const precioComplNum = precioComplemento === '' ? undefined : Number(precioComplemento);
    const nuevo: RenglonTelaColor = {
      idTelaColor: colorElegido.id,
      tela: tela.nombre,
      color: colorElegido.nombre,
      nombreComplemento: tela.nombreComplemento,
      cantidad: cuerpoNum,
      cantidadComplemento: llevaComplemento ? complementoNum : 0,
      ...(conLoteProveedor && loteProveedor.trim().length > 0
        ? { loteProveedor: loteProveedor.trim() }
        : {}),
      ...(conPrecios && precioCuerpoNum !== undefined && Number.isFinite(precioCuerpoNum)
        ? { precioUnit: precioCuerpoNum }
        : {}),
      ...(conPrecios &&
      llevaComplemento &&
      precioComplNum !== undefined &&
      Number.isFinite(precioComplNum)
        ? { precioUnitComplemento: precioComplNum }
        : {}),
      ...(idLineaOc === '' ? {} : { idOrdenCompraLinea: Number(idLineaOc) }),
    };
    if (conLoteProveedor) {
      // ENTRADA: el MISMO tela+color PUEDE repetirse — una factura con dos lotes del mismo color
      // son DOS partidas (DECISIONES §Post-F9.11 punto 4). NUNCA se fusionan renglones (fusionar
      // perdería el lote del proveedor del renglón previo).
      onChange([...renglones, nuevo]);
    } else {
      // SALIDA/TRASPASO: sin partida no hay qué distinga dos renglones del mismo color — si ya
      // está, se SUMAN las cantidades (el backend rechaza el color duplicado).
      const previo = renglones.find((r) => r.idTelaColor === colorElegido.id);
      const sinDuplicado = renglones.filter((r) => r.idTelaColor !== colorElegido.id);
      onChange([
        ...sinDuplicado,
        {
          ...nuevo,
          cantidad: cuerpoNum + (previo?.cantidad ?? 0),
          cantidadComplemento: llevaComplemento
            ? complementoNum + (previo?.cantidadComplemento ?? 0)
            : 0,
        },
      ]);
    }
    setCantidad('');
    setCantidadComplemento('');
    setLoteProveedor('');
    setPrecioUnit('');
    setPrecioComplemento('');
    setIdLineaOc('');
  }

  function quitar(indice: number): void {
    onChange(renglones.filter((_, i) => i !== indice));
  }

  const hayComplementoEnTabla = renglones.some((r) => r.nombreComplemento !== null);

  return (
    <div className="space-y-4" data-testid="captura-renglones-tela-color">
      {/* §Post-F9.15 — PENDIENTE DE LA ORDEN DE COMPRA. Es el punto de partida que pidió Daniel
          ("mejor recibir las telas a partir de las OC"): la tela y la cantidad salen de la orden, no
          se eligen.
          ⭐⭐ V1-E3u (§Post-F9.89): **y el COLOR también sale de la orden.** Aquí decía que el color
          "es lo que la OC no define" — dejó de ser verdad en la misma rama que se lo puso al renglón
          de OC. Se enseña en la lista y se PRECARGA al capturar; sigue editable, porque lo que se
          guarda es lo que de verdad llegó. */}
      {lineasOc !== undefined && lineasOc.length > 0 ? (
        <div className="space-y-2 rounded-md border border-primary/40 bg-primary-soft p-3">
          <p className="text-sm font-medium">Pendiente de la orden de compra</p>
          <ul className="space-y-1.5" data-testid="captura-color-pendientes-oc">
            {lineasOc.map((l) => {
              const yaCapturado = renglones.some(
                (r) => r.idOrdenCompraLinea === l.idOrdenCompraLinea,
              );
              return (
                <li
                  key={l.idOrdenCompraLinea}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span>
                    <strong>{l.tela}</strong>
                    {/* ⭐⭐ V1-E3u: EL COLOR QUE PIDIÓ LA OC, con su pantone. Es el dato contra el
                        que el confirmar cuadra la factura; sin enseñarlo, quien recibe tenía que
                        acertarlo. Sin color se lee igual que antes de la etapa. */}
                    {l.telaColor === null ? null : (
                      <span data-testid="pendiente-color-oc">
                        {' · '}
                        <strong>{l.telaColor}</strong>
                        {l.pantoneTelaColor === null ? '' : ` (${l.pantoneTelaColor})`}
                      </span>
                    )}{' '}
                    · faltan {l.pendiente.toLocaleString('es-MX')}
                    {l.unidad === null ? '' : ` ${l.unidad}`}
                    {/* §Post-F9.19: si la OC pidió complemento, TAMBIÉN hay que recibirlo — la
                        orden no cierra sin él. Se dice aquí para que no se olvide al capturar. */}
                    {l.nombreComplemento !== null && l.cantidadComplemento !== null ? (
                      <span data-testid="pendiente-complemento-oc">
                        {' '}
                        + {l.pendienteComplemento.toLocaleString('es-MX')} de {l.nombreComplemento}
                      </span>
                    ) : null}
                    <span className="text-muted-foreground"> · OC {l.numCompra}</span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant={yaCapturado ? 'ghost' : 'outline'}
                    disabled={soloLectura}
                    onClick={() => setPendientePrecargando(l)}
                    data-testid={`captura-color-capturar-oc-${l.idOrdenCompraLinea}`}
                  >
                    {yaCapturado ? 'Capturar otro renglón' : 'Capturar'}
                  </Button>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            Al capturar, la tela y la cantidad salen de la orden. Solo elige el color que llegó (y
            el lote, si lo traes); las cantidades y el precio se pueden ajustar.
          </p>
        </div>
      ) : null}

      <div className="space-y-3 rounded-md border p-3">
        <p className="text-sm font-medium">Agregar renglón (tela → color → cantidades)</p>
        <SelectorTela
          idSeleccionado={tela?.id}
          etiquetaSeleccion={tela?.nombre}
          alSeleccionar={elegirTela}
          {...(idProveedorTelas === undefined ? {} : { idProveedor: idProveedorTelas })}
          testid="captura-color-tela"
        />
        {tela !== undefined ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field>
              <FieldLabel htmlFor="captura-color-color">Color de la tela</FieldLabel>
              <SelectNativo
                id="captura-color-color"
                value={idTelaColor}
                onChange={(e) => elegirColor(e.target.value)}
                disabled={soloLectura}
                data-testid="captura-color-color"
              >
                <option value="">
                  {tela.colores.length === 0 ? 'Esta tela no tiene colores' : 'Elige el color…'}
                </option>
                {tela.colores.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.nombre}
                    {c.pantone !== null ? ` · ${c.pantone}` : ''}
                  </option>
                ))}
              </SelectNativo>
              {/* ⭐⭐ **V1-E8o — LA TERCERA PUERTA DEL MISMO CALLEJÓN: por lo menos, un LETRERO.**
               *
               * 🔴 Hasta aquí, una tela sin colores capturados era un **callejón sin salida y sin
               * letrero**: el desplegable decía *«Esta tela no tiene colores»* y ahí se acababa —
               * ni alta, ni instrucción, ni destino—. Peor que las dos puertas que V1-E6b y V1-E8o
               * cerraron en la compra, que **al menos apuntaban a algún lado**.
               *
               * ⚠️ Y no es un rincón: desde §Post-F9.14 la tela **ya no se recibe desde la OC**, así
               * que esta captura está en el **camino obligatorio** de recibir tela (y la comparten
               * entrada, traspaso, ajuste y salida por orden).
               *
               * ⬜ **Lo que NO se hace aquí, y por qué:** dar de alta el color **desde esta
               * pantalla**, como sí se puede desde la compra. El permiso que exige el servidor
               * (`agregarColorATela` → `compras.administrar`) **no es el de esta pantalla**
               * (`inventario-telas.mover`): un almacenista pulsaría el botón y se comería un **403**.
               * Quién puede dar de alta un color desde el ALMACÉN es una decisión de Daniel que
               * todavía no existe, y **inventar un permiso está prohibido**.
               *
               * ⭐ Pero decir A DÓNDE IR no necesita ninguna decisión, y cuesta una frase. Eso sí
               * entra hoy. (Deuda con nombre en `HOJA-DE-RUTA.md` §4.) */}
              {tela.colores.length === 0 ? (
                <p className="text-xs text-warn" data-testid="captura-color-sin-colores">
                  «{tela.nombre}» no tiene colores capturados, así que no se puede recibir por
                  color. Dalos de alta en <b>Catálogos › Telas</b> y vuelve — o, si tú compras, en
                  el renglón de la explosión con «＋ Nuevo color…».
                  {/* §Post-F9.144(d) — el letrero de arriba dice A DÓNDE IR; esta frase dice QUÉ
                      SIGNIFICA, y sólo se pinta DONDE ES VERDAD: en la pantalla que recibe contra
                      una OC. En un ajuste o un traspaso no hay compra que verificar, así que
                      afirmarlo ahí sería mentira. */}
                  {exigirOrdenCompra ? (
                    <span data-testid="captura-color-sin-colores-diagnostico">
                      {' '}
                      Y si venías a <b>recibirla</b>: el color se da de alta en la orden de compra,
                      así que verifica que esa compra exista — no debería llegar material que no se
                      haya comprado.
                    </span>
                  ) : null}
                </p>
              ) : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="captura-color-cantidad">
                {tela.nombreCuerpo ?? 'Cuerpo'}
              </FieldLabel>
              <Input
                id="captura-color-cantidad"
                type="number"
                min={0}
                step="any"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                disabled={soloLectura}
                data-testid="captura-color-cantidad"
              />
            </Field>
            {llevaComplemento ? (
              <Field>
                <FieldLabel htmlFor="captura-color-complemento">
                  {tela.nombreComplemento}
                </FieldLabel>
                <Input
                  id="captura-color-complemento"
                  type="number"
                  min={0}
                  step="any"
                  value={cantidadComplemento}
                  onChange={(e) => setCantidadComplemento(e.target.value)}
                  disabled={soloLectura}
                  data-testid="captura-color-complemento"
                />
              </Field>
            ) : null}
            {conLoteProveedor ? (
              <Field>
                <FieldLabel htmlFor="captura-color-lote-prov">Lote del proveedor</FieldLabel>
                <Input
                  id="captura-color-lote-prov"
                  value={loteProveedor}
                  onChange={(e) => setLoteProveedor(e.target.value)}
                  placeholder="Opcional"
                  disabled={soloLectura}
                  data-testid="captura-color-lote-prov"
                />
              </Field>
            ) : null}
            {conPrecios ? (
              <Field>
                <FieldLabel htmlFor="captura-color-precio">
                  Precio {(tela.nombreCuerpo ?? 'cuerpo').toLowerCase()}
                </FieldLabel>
                <Input
                  id="captura-color-precio"
                  type="number"
                  min={0}
                  step="any"
                  value={precioUnit}
                  onChange={(e) => setPrecioUnit(e.target.value)}
                  placeholder="Del catálogo"
                  disabled={soloLectura}
                  data-testid="captura-color-precio"
                />
              </Field>
            ) : null}
            {conPrecios && llevaComplemento ? (
              <Field>
                <FieldLabel htmlFor="captura-color-precio-compl">
                  Precio {(tela.nombreComplemento ?? '').toLowerCase()}
                </FieldLabel>
                <Input
                  id="captura-color-precio-compl"
                  type="number"
                  min={0}
                  step="any"
                  value={precioComplemento}
                  onChange={(e) => setPrecioComplemento(e.target.value)}
                  placeholder="Del catálogo"
                  disabled={soloLectura}
                  data-testid="captura-color-precio-compl"
                />
              </Field>
            ) : null}
          </div>
        ) : null}
        {tela !== undefined && llevaComplemento ? (
          <p className="text-[11px] text-muted-foreground">
            {tela.nombreCuerpo ?? 'Cuerpo'} y {tela.nombreComplemento} viajan JUNTOS en el mismo
            renglón (solo {tela.nombreComplemento} = {tela.nombreCuerpo ?? 'cuerpo'} en 0).
          </p>
        ) : null}
        {/* ⭐⭐ §Post-F9.159(a) — **EL CALLEJÓN CONVERTIDO EN DIAGNÓSTICO**, en el único sitio
            donde la frase es CIERTA: aquí es donde alguien intentaría capturar un renglón que no
            viene de ninguna orden de compra.
            🔴 Ojo con dónde NO va: el letrero de «esta tela no tiene colores» se enciende con
            `tela.colores.length === 0`, o sea cuando NO HAY NINGÚN COLOR que contrastar contra
            ninguna OC — poner ahí «este color no viene de ninguna OC» sería afirmar lo que su
            disparador no sostiene.
            Las dos redacciones se reparten por su propio disparador: si hay pendientes de OC, lo
            que falta es capturar desde ellos; si no hay ninguno, lo que falta es la COMPRA. */}
        {renglonSinOrdenDeCompra ? (
          <p className="text-xs text-warn" data-testid="captura-color-exige-oc">
            Este renglón no viene de ninguna orden de compra, y así no se puede recibir:{' '}
            <b>no se recibe tela que no se haya comprado</b>.{' '}
            {textoDeLaSalida(hayOfrecidos, estadoPendientesOc)}
          </p>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          onClick={agregar}
          disabled={
            soloLectura ||
            colorElegido === undefined ||
            !cantidadesValidas ||
            renglonSinOrdenDeCompra
          }
          data-testid="captura-color-agregar"
        >
          <Plus className="mr-1.5 size-4" aria-hidden /> Agregar
        </Button>
      </div>

      {renglones.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          Aún no hay renglones. Elige la tela, su color y las cantidades.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border" data-testid="captura-color-tabla">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tela</TableHead>
                <TableHead>Color</TableHead>
                <TableHead className="text-right">Cuerpo</TableHead>
                {hayComplementoEnTabla ? (
                  <TableHead className="text-right">Complemento</TableHead>
                ) : null}
                {conLoteProveedor ? <TableHead>Lote prov.</TableHead> : null}
                {lineasOc !== undefined || exigirOrdenCompra ? (
                  <TableHead>Orden de compra</TableHead>
                ) : null}
                {conPrecios ? <TableHead className="text-right">Precio</TableHead> : null}
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* La llave va por ÍNDICE: en entradas el mismo tela+color puede repetirse (dos
                  lotes = dos partidas). */}
              {renglones.map((r, i) => (
                <TableRow key={`${r.idTelaColor}-${i}`}>
                  <TableCell className="font-medium">{r.tela}</TableCell>
                  <TableCell>{r.color}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.cantidad.toLocaleString('es-MX')}
                  </TableCell>
                  {hayComplementoEnTabla ? (
                    <TableCell className="text-right tabular-nums">
                      {r.nombreComplemento !== null
                        ? r.cantidadComplemento.toLocaleString('es-MX')
                        : '—'}
                    </TableCell>
                  ) : null}
                  {conLoteProveedor ? (
                    <TableCell className="text-xs text-muted-foreground">
                      {r.loteProveedor ?? '—'}
                    </TableCell>
                  ) : null}
                  {lineasOc !== undefined || exigirOrdenCompra ? (
                    <TableCell className="text-xs text-muted-foreground">
                      {r.idOrdenCompraLinea === undefined
                        ? '—'
                        : `OC ${String(
                            lineasOc?.find((l) => l.idOrdenCompraLinea === r.idOrdenCompraLinea)
                              ?.numCompra ?? '',
                          )}`}
                    </TableCell>
                  ) : null}
                  {conPrecios ? (
                    <TableCell className="text-right text-xs tabular-nums">
                      {r.precioUnit === undefined ? '—' : r.precioUnit.toLocaleString('es-MX')}
                      {r.precioUnitComplemento === undefined
                        ? ''
                        : ` / ${r.precioUnitComplemento.toLocaleString('es-MX')}`}
                    </TableCell>
                  ) : null}
                  <TableCell className="text-right">
                    {!soloLectura ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => quitar(i)}
                        data-testid={`captura-color-quitar-${i}`}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
