import {
  ArrowLeft,
  ClipboardCheck,
  LockOpen,
  Palette,
  Plus,
  Printer,
  ShoppingCart,
  TriangleAlert,
  UserPlus,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useDireccionesEntregaActivas } from '@/api/direcciones-entrega';
import {
  useAsignarColorTela,
  useAsignarProveedor,
  useAsignarProveedorEnBloque,
  useColoresDeVariasOrdenes,
  useExplosion,
  useGenerarOc,
  useOrdenesDelPedido,
  usePrevioCompra,
  imprimirExplosion,
} from '@/api/mrp';
import { useConsultaOrdenes } from '@/api/ordenes-consulta';
import { DialogoColoresDeTela } from './DialogoColoresDeTela';
// ⭐ V1-E4d (§Post-F9.96): el alta de dirección se hace con EL MISMO diálogo del catálogo. Una
// segunda forma de capturar lo mismo es cómo dos pantallas acaban validando distinto.
import { DialogoDireccionEntrega } from '@/modulos/direcciones-entrega/DialogoDireccionEntrega';
// ⭐⭐ V1-E6b (§Post-F9.106): el alta de un COLOR de la tela, desde el renglón de la compra. Vive en
// el módulo de Telas (el catálogo al que escribe), igual que el de dirección vive en el suyo.
import { DialogoNuevoColorDeTela } from '@/modulos/telas/DialogoNuevoColorDeTela';
import type {
  AsignarProveedorEnBloqueCuerpo,
  ColorDeLaOrden,
  GenerarOcCuerpo,
  OrdenExplosionada,
  PlanCompra,
  Proveedor,
  Requerimiento,
} from '@/api/tipos';
import { Badge } from '@/components/ui/badge';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatearMoneda } from '@/lib/formato';
import { useDebounce } from '@/lib/useDebounce';
import { SelectorProveedor } from '@/modulos/cxp/SelectorProveedor';
import { useSesion } from '@/sesion/useSesion';

/**
 * ⭐ V1-E4f — Lo MÍNIMO que una línea de orden de compra puede guardar (`Decimal(12,2)`): por debajo
 * de esto no hay línea, así que tampoco hay OC que reclame fecha.
 *
 * ⚠️ **NO es el mismo número que el del servidor, y decir que lo era estaba mal** (hallazgo del
 * reviewer): allá `MINIMO_CANTIDAD_COMPRA` (`reparto-ordenes.ts`) es **0.005** —media unidad del
 * último dígito guardable, el corte del REDONDEO—, aquí es **0.01**. Éste es **más estricto**, y ésa
 * es justo la dirección segura: lo que la pantalla cuenta como comprable es un subconjunto de lo que
 * el servidor cuenta, así que puede callarse de más, **nunca reclamar una fecha para una OC que no
 * va a nacer** (ver `ocSinFechaDeEntrega`).
 *
 * 🔴 **Y qué lo rompería, para que quien toque el servidor lo vea:** los dos cortes son
 * *equivalentes* sólo porque el pendiente de CADA OP llega ya **redondeado a 2 decimales**
 * (`redondearCantidadCompra` en `mrp.ts`), y por eso una suma de esos pendientes que llegue a 0.01
 * garantiza que al menos una OP aporta ≥ 0.01 por sí sola. Si ese redondeo previo desapareciera, la
 * pantalla sumaría astillas (cinco de 0.002 hacen 0.01) que el servidor descarta una por una — y
 * empezaría a **bloquear de más**, el único error que esta comprobación no se puede permitir.
 */
const MINIMO_GUARDABLE = 0.01;

/**
 * ⭐⭐ **V1-E4f (§Post-F9.104)** — el valor con el que el desplegable «Entregar en» dice *"quiero dar
 * de alta una dirección nueva"*. NO es un id: se compara ANTES de convertir a número, porque
 * `Number('nueva')` es `NaN` y un `NaN` viajando como `idDireccionEntrega` sería exactamente la
 * clase de dato inventado que §Post-F9.86 prohíbe.
 */
const OPCION_NUEVA_DIRECCION = 'nueva';

/**
 * ⭐⭐ **V1-E6b (§Post-F9.104 + §Post-F9.106)** — el valor con el que el desplegable de color de la
 * tela dice *"quiero dar de alta un color nuevo"*. Mismo truco (y misma razón) que
 * {@link OPCION_NUEVA_DIRECCION}: NO es un id, se compara ANTES de convertir a número, porque un
 * `Number('nuevo')` sería `NaN` viajando como `idTelaColor`. Se llama distinto que el de dirección
 * a propósito: son dos desplegables distintos y confundirlos sería guardar un color en la dirección.
 */
const OPCION_NUEVO_COLOR = 'nuevo-color';

/**
 * EXPLOSIÓN DE MATERIALES (F4-E4, R3): el backend explosiona la receta congelada contra la matriz
 * color×talla → qué/cuánto comprar, AGRUPADO por proveedor sugerido (R1), con el neteo de genéricos
 * visible (decisión d) y las DIFERENCIAS contra el snapshot previo marcadas. Solo presenta: el
 * cálculo, el neteo, el plan y la generación los hace el SERVIDOR (A1).
 *
 * ⭐⭐ **V1-E3q (§Post-F9.85 / §Post-F9.86) — LAS TRES COSAS QUE DANIEL PIDIÓ EL 20-AGO:**
 *
 *  1. **La compra es de VARIAS OP, no de una.** *"¿Cómo hacemos cuando una OC cubre varias OP? Es
 *     muy muy común"*. Al elegir una OP se **precargan todas las OP de su pedido interno** (los
 *     avíos del 1515) y se pueden quitar; y se pueden **agregar OP sueltas** con el buscador (las
 *     cajas, que cruzan pedidos). Es el MISMO control llenado de dos maneras.
 *  2. **La REVISIÓN PREVIA.** *"Al darle «generar OC desde la explosión», te mande a una pantalla
 *     previa, antes de generar la OC. Una revisión previa es indispensable"*. El paso 3 enseña las
 *     OC completas —proveedor, renglones, cantidades y **de qué OP es cada cantidad**— y lo que se
 *     va a OMITIR con su razón, antes de comprometer nada.
 *  3. **No volver a comprar lo ya comprado.** Cada renglón trae `cantidadEnOc`/`cantidadPendiente`
 *     del servidor: lo que ya está en una OC viva sale marcado y NO se vuelve a proponer.
 *
 * ⭐ V1-E3h (§Post-F9.72): la explosión sale SOLO de los renglones que Desarrollo firmó — y lo que
 * quedó fuera se enseña aquí, con nombre y cantidad.
 */
export function ExplosionMaterialesPagina(): React.JSX.Element {
  const navigate = useNavigate();
  const { tienePermiso } = useSesion();
  // §Post-F9.68 — el enlace a "donde se libera" solo se pinta si esta sesión puede abrir el destino
  // (el panel de la OP y, dentro, la receta). Un enlace muerto sería peor que no tenerlo.
  const puedeIrALiberar = tienePermiso('ordenes.ver') && tienePermiso('desarrollo.ver');
  // §Post-F9.68 — esconder Y bloquear: sin `compras.administrar` no se pinta la acción (y el
  // servidor la rechaza igual, que es donde de verdad se sostiene). Cubre revisar Y generar: la
  // revisión previa es la primera mitad de comprar, no una consulta más.
  const puedeComprar = tienePermiso('compras.administrar');
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  /**
   * ⭐ V1-E3q (§Post-F9.86) — **EL CONJUNTO DE OP QUE SE VA A COMPRAR.** La raíz del rediseño está
   * en qué pregunta hace la pantalla: antes era *"¿qué necesita ESTA OP?"* y el comprador hace
   * otra, *"¿qué necesito comprar hoy?"*.
   */
  const [idsOrden, setIdsOrden] = useState<number[]>([]);
  /** La OP con la que se arrancó: de ella sale la precarga por pedido interno. */
  const [idOrdenBase, setIdOrdenBase] = useState<number | null>(null);
  // Selección de renglones a comprar; vacío = todo lo pendiente con proveedor.
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  /**
   * ⭐ §Post-F9.71 (opción A de Daniel) — FECHA POR OC. Aquí nace UNA OC POR PROVEEDOR de un clic, y
   * *"cada OC interna va a tener una fecha de entrega diferente"*: la tela se necesita semanas antes
   * que los avíos. Sólo se guardan las fechas que el usuario TOCÓ; las demás siguen a la de arriba
   * (por eso es un mapa de excepciones y no una copia de todas: si cambia la de arriba, las que
   * nadie tocó se mueven con ella, que es lo que "valor inicial" significa).
   */
  const [fechasProveedor, setFechasProveedor] = useState<Record<number, string>>({});
  /**
   * ⭐ V1-E3q (§Post-F9.86) — EL SOBRANTE DE COMPRA. *"Comprar el rollo completo es una decisión del
   * comprador en el momento de comprar — es un hecho entonces, y por eso sí se reparte"*. La
   * pantalla sólo guarda el TOTAL que el comprador tecleó; **quién se lleva cuánto lo decide el
   * servidor** (`repartirEntreOrdenes`), que es donde vive la regla (A1).
   */
  const [ajustes, setAjustes] = useState<Record<string, string>>({});
  /**
   * ⭐⭐ V1-E3z (§Post-F9.94) — **EL PRECIO QUE CORRIGE EL COMPRADOR.** Daniel: *"acuérdate que al
   * final puedo modificar precio o cantidad antes de generar la OC"*. Va en un mapa aparte del de
   * la cantidad —con la MISMA clave— porque los dos ajustes son independientes: se puede corregir
   * sólo el precio sin tocar la cantidad, y al revés. Vacío = ese renglón sale con el precio que
   * resolvió el servidor.
   *
   * ⚠️ Igual que la cantidad, **esto no se calcula en la pantalla**: el número se manda al servidor
   * y lo que se repinta es el plan que él devuelve.
   */
  const [precios, setPrecios] = useState<Record<string, string>>({});
  /**
   * Contador de peticiones del plan: sólo la ÚLTIMA puede pintar (ver {@link pedirPlan}). Es un
   * `ref` y no estado porque cambiarlo NO debe repintar nada — sólo sirve para descartar una
   * respuesta que llegó tarde.
   */
  const peticionPrevio = useRef(0);
  /** ⭐⭐ La REVISIÓN PREVIA en pantalla (null = todavía estamos en la explosión). */
  const [plan, setPlan] = useState<PlanCompra | null>(null);
  /**
   * 🔴 **V1-E3z, 3ª vuelta — CUÁNTOS PLANES LLEVA SERVIDOS EL SERVIDOR.** Es la IDENTIDAD del plan
   * que se está pintando, y sube en CADA respuesta buena aunque los números vuelvan idénticos.
   *
   * Existe porque los campos de la previa no pueden reconciliarse contra el *valor*: cuando el
   * servidor redondea `2.004` y devuelve `2` —el número que el campo YA enseñaba antes de teclear—
   * el valor no cambia, y un campo que sólo mira el valor se queda enseñando lo tecleado. La
   * pantalla acabaría diciendo `2.004` con el chip «Precio ajustado», el reparto en `× $2.00` y la
   * OC naciendo a 2.00: **la única que miente es la previa**, que es todo lo que la previa es.
   * Es un ESTADO (y no un `ref` como {@link peticionPrevio}) justamente porque tiene que repintar.
   */
  const [revisionPlan, setRevisionPlan] = useState(0);
  /**
   * ⭐⭐ V1-E3u (§Post-F9.89) — LA ORDEN cuyos colores de tela se están diciendo (null = cerrado).
   * Se guarda el id de la OP y no un booleano porque la explosión puede traer VARIAS: el color se
   * captura en la receta de UNA orden, así que hay que saber en cuál.
   */
  const [idOrdenColores, setIdOrdenColores] = useState<number | null>(null);

  const ordenes = useConsultaOrdenes({
    pagina: 1,
    porPagina: 20,
    incluirCanceladas: 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });

  const delPedido = useOrdenesDelPedido(idOrdenBase ?? undefined);
  const explosion = useExplosion(idsOrden);
  const previo = usePrevioCompra();
  const generar = useGenerarOc();
  /**
   * ⭐ V1-E3m (§Post-F9.82) — EL COMPRADOR DESATORA DESDE AQUÍ. Daniel: *"el comprador podría
   * asignarle un proveedor y no esperar a que la gente de desarrollo se lo asigne"*, pero **solo
   * para esa OP**: el servidor guarda la asignación en la receta de la orden y NUNCA en el catálogo.
   */
  const asignar = useAsignarProveedor();
  /**
   * ⭐⭐ V1-E3x (§Post-F9.88) — EL MISMO PROVEEDOR A VARIOS DE UN GOLPE. Daniel: *"poder poner el
   * proveedor de manera más rápida a varios elementos que lleven el mismo proveedor"*. En bloque se
   * vale porque NO compromete dinero: la OC sigue pasando por la previa y su autorización.
   */
  const asignarBloque = useAsignarProveedorEnBloque();

  /**
   * ⭐ V1-E3x — **LA CONFIRMACIÓN SE DISPARA DESDE LA PÁGINA, NO DESDE EL PANEL.** Y no es un
   * detalle de estilo: el panel **se desmonta** en cuanto quedan menos de dos huecos, o sea que en
   * el caso que esta etapa vino a resolver —«Seleccionar todos» y llenarlos TODOS— un mensaje que
   * viviera dentro del panel **nunca se vería**. Justo cuando más importa. Por eso va a un `toast`,
   * que sobrevive al desmontaje: *hacer el trabajo y no decirlo es la mitad de no hacerlo*.
   */
  function asignarEnBloque(cuerpo: AsignarProveedorEnBloqueCuerpo): void {
    asignarBloque.mutate(cuerpo, {
      onSuccess: (r) =>
        toast.success(
          `Se le asignó «${r.proveedor}» a ${String(r.renglones)} renglón(es) de receta en ` +
            `${String(r.ordenes)} orden(es), en un solo acto.`,
        ),
    });
  }
  /** Renglón cuyo formulario de «asignar proveedor» está abierto (uno a la vez). */
  const [asignandoId, setAsignandoId] = useState<number | null>(null);
  const puedeAsignarProveedor = puedeComprar;
  /**
   * ⭐⭐ **V1-E4c** — renglón cuyo bloque de «de qué color se compra» está abierto (uno a la vez,
   * igual que el de proveedor). Daniel, 23-ago-2026: *"¿por qué no poner la opción directo en el
   * renglón de la tela?"* — el color se captura DONDE se ve el problema, no dentro de un aviso.
   *
   * 🔴 **Se guarda la CLAVE ESTABLE del renglón, no su `id` de snapshot**, y eso importa: decir un
   * color **invalida la explosión**, el servidor la vuelve a calcular y los `id` de snapshot son
   * OTROS. Con el `id` como llave, el bloque se cerraba solo en cuanto se guardaba el primer color
   * — o sea, justo cuando el comprador iba a decir el segundo. La clave (tela+color+proveedor) es
   * la misma que React usa para no reusar el DOM de un renglón en otro.
   */
  const [colorAbiertoId, setColorAbiertoId] = useState<string | null>(null);

  /**
   * ⭐ V1-E3q — LA PRECARGA POR PEDIDO INTERNO. Al elegir la primera OP se traen sus hermanas y se
   * marcan TODAS (menos las canceladas: comprar material para una orden cancelada es tirar el
   * dinero). El usuario quita las que no quiera — precargar y dejar quitar es más rápido que
   * obligarlo a buscar una por una, que es justo el trabajo que Daniel describió.
   */
  /**
   * ⚠️ La precarga corre **UNA SOLA VEZ por OP base**, y por eso lleva su propia marca en vez de
   * confiar en la forma del conjunto: si el usuario quita una hermana y luego React Query refresca
   * la consulta, un efecto que sólo mirara `idsOrden` volvería a meter la que acaban de quitar.
   * Una precarga que pisa lo que la persona decidió es un sabotaje, no una ayuda.
   */
  const precargadoPara = useRef<number | null>(null);
  useEffect(() => {
    const datos = delPedido.data;
    if (datos === undefined || idOrdenBase === null) return;
    if (precargadoPara.current === idOrdenBase) return;
    precargadoPara.current = idOrdenBase;
    const hermanas = datos.ordenes.filter((o) => !o.cancelada).map((o) => o.idOrden);
    if (hermanas.length > 0) {
      setIdsOrden(hermanas);
      // 🔴 ⭐ V1-E4c — **LA CUARTA PUERTA.** Ésta también cambia el conjunto de OP, y es la única
      // que no lo hace por un clic: la consulta de hermanas puede aterrizar TARDE (React Query
      // reintenta) con el comprador ya trabajando. Si eso pasa con un panel abierto, el panel
      // sobrevive a un conjunto que ya no existe — la regla que este archivo declara dos funciones
      // más abajo. Que hoy sea raro no la hace menos regla.
      olvidarPanelesDeRenglon();
    }
  }, [delPedido.data, idOrdenBase]);

  /**
   * §Post-F9.18: toda OC nace con fecha de entrega y dirección del catálogo, incluidas las que
   * genera esta pantalla. Se piden AQUÍ porque **el servidor no las adivina**: la dirección en
   * blanco cae a la FAVORITA del catálogo, pero la fecha —🔴 V1-E7f (§Post-F9.120)— **no cae a
   * ningún lado**. Sin capturarla (aquí o por proveedor) la compra NO se genera, y el servidor dice
   * a qué proveedores les falta.
   */
  const [fechaEntrega, setFechaEntrega] = useState('');
  /**
   * ⭐⭐ **V1-E4f (§Post-F9.103) — ¿YA INTENTÓ AVANZAR SIN FECHA?** Gemelo exacto de
   * {@link intentoSinDireccion}, y a propósito: Daniel pidió la fecha *"a fuerzas"* con el **mismo
   * trato** que la dirección, *"para que las dos se comporten igual y nadie tenga que aprender dos
   * reglas"*. Decide si el texto de la fecha se ve como **instrucción** (gris, al abrir) o como
   * **aviso** (amarillo, sólo después de intentar generar sin haberla llenado).
   *
   * ⚠️ Es estado de INTERFAZ, no de negocio: quién puede generar y con qué datos lo decide el
   * servidor (A1), que devuelve la falta de fecha como BLOQUEO de `planearCompra` y rechaza la
   * generación con esa misma frase.
   */
  const [intentoSinFecha, setIntentoSinFecha] = useState(false);
  /** El campo donde se llena: el mensaje de «falta la fecha» le lleva el foco. */
  const campoFecha = useRef<HTMLInputElement>(null);
  const direcciones = useDireccionesEntregaActivas();
  const listaDirecciones = direcciones.data?.datos ?? [];
  const [idDireccionEntrega, setIdDireccionEntrega] = useState<number | null>(null);
  /**
   * ⭐⭐ **V1-E4d (§Post-F9.96) — ¿YA INTENTÓ AVANZAR SIN DIRECCIÓN?** Es lo único que decide si el
   * texto de la dirección se ve como **instrucción** (gris, al abrir: *"elige a dónde se
   * entrega"*) o como **aviso** (amarillo, después de intentar generar sin haberlo llenado). La
   * regla de Daniel en una variable: *"primero que dé la opción de meterlo, y si no se hace,
   * entonces que mande los mensajes en amarillo"*.
   *
   * ⚠️ Es estado de INTERFAZ, no de negocio: quién puede generar y con qué datos lo decide el
   * servidor (A1), que rechaza igual la generación sin dirección.
   */
  const [intentoSinDireccion, setIntentoSinDireccion] = useState(false);
  /** ⭐ V1-E4d: el alta de dirección SIN salir de la compra (el catálogo puede estar vacío). */
  const [altaDireccion, setAltaDireccion] = useState(false);
  /** El campo donde se llena: el mensaje de «falta la dirección» le lleva el foco. */
  const selectDireccion = useRef<HTMLSelectElement>(null);
  /**
   * ⭐⭐ **V1-E4d (DANIEL, 23-ago-2026) — CON UNA SOLA DIRECCIÓN NO HAY NADA QUE DECIDIR.**
   *
   * Daniel: *"el lugar de entrega en el 99% de las órdenes es en el mismo lugar… dejar por default
   * siempre la dirección de entrega, podríamos modificarla si se requiere, pero siempre dejarla
   * fija"*. El default ya existía —la **favorita**, que el dominio garantiza única—, y lo que
   * frenaba era una casilla sin prender: con **una sola dirección activa** el sistema bloqueaba la
   * OC pidiendo que eligieran *"la favorita"* **entre una única opción**. Eso es exactamente la
   * fricción que §Post-F9.96 vino a quitar: primero se trabaja, y sólo se pregunta lo que de verdad
   * hay que decidir.
   *
   * 🔴 **Sólo con UNA.** Con dos o más sin favorita se sigue preguntando: ahí sí hay una decisión
   * real, y el sistema **no la inventa** (§Post-F9.86 — nunca escribir una suposición como si fuera
   * un hecho). Y elegirla para ESTA compra **no la marca favorita** en el catálogo: eso lo decide
   * la persona allá.
   *
   * La cascada, en orden: **la que eligió el comprador → la FAVORITA → la ÚNICA activa → pedirla**.
   */
  const unicaActiva = listaDirecciones.length === 1 ? (listaDirecciones[0]?.id ?? null) : null;
  const direccionEfectiva =
    idDireccionEntrega ?? listaDirecciones.find((d) => d.favorita)?.id ?? unicaActiva;
  /**
   * §Post-F9.16 — NO ESCONDER, EXPLICAR (y ofrecer el camino). Sin dirección de entrega el dominio
   * RECHAZA la generación (`generarOCDesdeExplosion`), y el catálogo nace VACÍO: el error llegaba
   * del servidor sin decir a dónde ir. Se dice qué falta, se ofrece el alta aquí mismo y se enlaza
   * el catálogo. `null` = no hay nada que decir.
   *
   * ⭐⭐ **V1-E4d (§Post-F9.96) — CUÁNDO se dice.** Esto ya no apaga el botón ni pinta un cartel al
   * abrir: mientras nadie ha intentado avanzar es una **instrucción** junto a su campo, y sólo se
   * vuelve **aviso amarillo** cuando el comprador intenta generar sin haberla llenado
   * ({@link intentoSinDireccion}). Quien lo frena entonces es {@link revisar} — y el servidor otra
   * vez, por su cuenta.
   *
   * `bloquea` distingue el AVISO del BLOQUEO: si la consulta del catálogo FALLA no sabemos si hay
   * direcciones o no —decir "está vacío" sería mentir con el catálogo lleno—, así que se avisa del
   * error pero NO se bloquea: que decida el servidor al guardar (nunca se bloquea por un error de
   * LECTURA).
   *
   * ORDEN DE LAS RAMAS: "ya hay dirección" se pregunta ANTES que el error. Un refetch que falla con
   * datos previos en cache no borra la que el usuario ya eligió en el select — avisar ahí que "no
   * sabemos cuál usar" sería falso.
   */
  const avisoDireccion: { texto: string; bloquea: boolean; enlace: boolean } | null =
    direcciones.isPending || direccionEfectiva !== null
      ? null
      : direcciones.isError
        ? {
            texto:
              'No se pudo consultar el catálogo de direcciones de entrega, así que no sabemos cuál usar. ' +
              'Reintenta; si generas de todos modos, el servidor decide (y dirá si falta la dirección).',
            bloquea: false,
            enlace: false,
          }
        : listaDirecciones.length === 0
          ? {
              // ⭐ V1-E4d: el catálogo vacío se resuelve AQUÍ, no mandando al comprador a otra
              // pantalla y de vuelta —con la explosión y las OP elegidas perdidas—. El enlace al
              // catálogo se queda como salida para lo demás (corregir, desactivar, marcar
              // favorita).
              // ⭐ V1-E4f (§Post-F9.104): el alta ya no es un botón suelto sino la ÚLTIMA opción
              // del desplegable, así que el texto manda ahí —y por eso esa opción se pinta
              // también con la lista vacía.
              texto:
                'No hay ninguna dirección de entrega activa, y toda orden de compra necesita una: ' +
                'dala de alta con «＋ Nueva dirección…», la última opción de «Entregar en» (no hace ' +
                'falta salir de la compra).',
              bloquea: true,
              enlace: true,
            }
          : {
              // ⚠️ Con este texto ya sólo se llega cuando hay **varias** y ninguna marcada: con una
              // sola, la cascada de arriba la usa y aquí no se entra. El mensaje lo dice, porque
              // decir "ninguna está marcada" con una sola dirección mandaba a prender una casilla
              // que no cambiaba nada.
              texto:
                `Hay ${String(listaDirecciones.length)} direcciones de entrega y ninguna marcada como favorita: ` +
                'elige en «Entregar en» a cuál va esta compra (o marca la de siempre en el catálogo y deja de elegir).',
              bloquea: true,
              enlace: true,
            };

  /**
   * 🔴 ⭐ **V1-E4c (3ª vuelta)** — cierra lo que estuviera ABIERTO DENTRO de un renglón (asignar
   * proveedor, decir el color). Cambiar el conjunto de OP declara muerto el contexto anterior —es
   * lo que dicen los `setAjustes({})`/`setPrecios({})` de al lado— y un panel montado sobre un
   * renglón de la compra anterior no puede sobrevivirle: reaparecería solo, ya apuntando a las OP
   * nuevas.
   *
   * ⚠️ Hasta esta etapa esto se "arreglaba" por accidente: los paneles se identificaban por el `id`
   * de SNAPSHOT y ese id moría con la explosión (que no es un GET: reescribe el snapshot y reparte
   * ids nuevos). Al pasar el bloque de color a una clave ESTABLE —lo que había que hacer para que
   * no se cerrara solo al guardar— ese accidente dejó de tapar el hueco. Se cierra a mano, en un
   * solo sitio y para los DOS paneles, porque la próxima vez que alguien toque esto va a olvidarse
   * de uno.
   *
   * ⚠️ **Honestidad sobre su cobertura.** Son CUATRO los sitios que mueven el conjunto de OP, y tres
   * tienen su prueba: `agregarOrden`, `quitarOrden` (quitando una de DOS: quitando la única, la
   * explosión se desmonta y la prueba pasaría sin probar nada) y la **precarga por pedido interno**
   * llegando tarde —el único que no nace de un clic—. La de `elegirOrdenBase` **no puede fijarla
   * ninguna**, y no por descuido: sólo corre con `idsOrden` vacío, el único camino de vuelta a vacío
   * pasa por `quitarOrden` (que ya limpió) y con el conjunto vacío no se pinta ningún renglón, así
   * que no hay panel que olvidar. Se deja por uniformidad —si mañana aparece otra manera de vaciar
   * el conjunto, el reset ya está— sabiendo que es defensiva.
   */
  function olvidarPanelesDeRenglon(): void {
    setAsignandoId(null);
    setColorAbiertoId(null);
  }

  /** Empieza de cero con una OP: se vuelve la base (y dispara la precarga de su pedido). */
  function elegirOrdenBase(id: number): void {
    precargadoPara.current = null;
    setIdOrdenBase(id);
    setIdsOrden([id]);
    setSeleccion(new Set());
    // Otro conjunto = otras entregas y otros ajustes: arrastrar los anteriores sería peor que no
    // proponer ninguno.
    setFechasProveedor({});
    setAjustes({});
    setPrecios({});
    olvidarPanelesDeRenglon();
    cerrarPrevia();
    // (el `previo.reset()` que vivía aquí ya lo hace `cerrarPrevia`, para los cinco sitios)
    generar.reset();
  }

  /** Agrega una OP suelta al conjunto (el caso de las cajas, que cruzan pedidos). */
  function agregarOrden(id: number): void {
    setIdsOrden((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setSeleccion(new Set());
    setAjustes({});
    setPrecios({});
    olvidarPanelesDeRenglon();
    cerrarPrevia();
    generar.reset();
  }

  /** Quita una OP del conjunto (quitar la última deja la pantalla en blanco, no en un estado raro). */
  function quitarOrden(id: number): void {
    setIdsOrden((prev) => {
      const siguiente = prev.filter((x) => x !== id);
      if (siguiente.length === 0) setIdOrdenBase(null);
      return siguiente;
    });
    setSeleccion(new Set());
    setAjustes({});
    setPrecios({});
    olvidarPanelesDeRenglon();
    cerrarPrevia();
    generar.reset();
  }

  /** Fecha efectiva de un proveedor: la suya si la tocaron, si no la de arriba (valor inicial). */
  function fechaDe(idProveedor: number): string {
    return fechasProveedor[idProveedor] ?? fechaEntrega;
  }

  /**
   * Cambia la fecha de UN proveedor. Vaciar el campo NO guarda una fecha vacía: BORRA la excepción,
   * o sea que ese proveedor vuelve a seguir a la de arriba. Guardar el vacío dejaría un estado que
   * se ve igual (campo en blanco) pero significa otra cosa según quién lo mire, y nadie podría
   * deshacer un cambio de fecha sin recargar.
   */
  function cambiarFechaDe(idProveedor: number, valor: string): void {
    // ⭐ V1-E4f: tocar CUALQUIER fecha baja la marca del intento — el amarillo es la consecuencia
    // de no llenarla, no una etiqueta pegada al comprador para el resto de la sesión.
    setIntentoSinFecha(false);
    setFechasProveedor((prev) => {
      const siguiente = { ...prev };
      if (valor === '') {
        delete siguiente[idProveedor];
      } else {
        siguiente[idProveedor] = valor;
      }
      return siguiente;
    });
  }

  /**
   * Marca o desmarca un renglón COMPLETO. ⭐ V1-E3q: un renglón de pantalla agrupa un snapshot POR
   * OP, así que se prenden o apagan **todos sus ids a la vez**. Voltear cada uno por separado
   * dejaría medio renglón marcado si alguna vez llegara desparejo — un estado que la casilla no
   * sabe dibujar y que el servidor compraría a medias.
   */
  function alternarRenglon(ids: readonly number[], marcado: boolean): void {
    setSeleccion((prev) => {
      const siguiente = new Set(prev);
      for (const id of ids) {
        if (marcado) siguiente.delete(id);
        else siguiente.add(id);
      }
      return siguiente;
    });
  }

  /**
   * Clave del ajuste de un renglón: material + **color** + proveedor (la misma que entiende el
   * servidor, `claveAjuste` de `mrp.ts`).
   *
   * ⭐⭐ V1-E3u (§Post-F9.89): el COLOR entra en la clave porque un renglón ES un color. Sin él, el
   * total que Compras teclea para el marino se aplicaría también al grana — y el desvío que ve
   * quien autoriza sería el de una compra que nadie hizo.
   */
  function claveAjuste(r: Requerimiento): string | null {
    const idMaterial = r.tipo === 'tela' ? r.idTela : r.idAvio;
    if (idMaterial === null || r.idProveedorSugerido === null) return null;
    // `== null` cubre null Y undefined: un renglón sin color tiene que producir SIEMPRE la misma
    // clave, y un `String(undefined)` acabaría mandando `NaN` al servidor.
    return claveDeAjuste(r.tipo, idMaterial, r.idTelaColor ?? null, r.idProveedorSugerido);
  }

  /**
   * ⭐⭐ V1-E3z (§Post-F9.94) — **CORREGIR UN NÚMERO DESDE LA REVISIÓN PREVIA.**
   *
   * Guarda lo que el comprador tecleó y **vuelve a pedirle el plan al servidor** con el cuerpo ya
   * corregido. La previa sigue sin calcular NADA (A1): el total que repinta es el que el servidor
   * devuelve, calculado por el MISMO código que luego genera.
   *
   * ⚠️ Se llama al SALIR del campo (o con Enter), no en cada tecla: con un rebote por pulsación,
   * teclear "1500" mandaría a planear una compra de **1** y la pantalla repintaría totales de
   * compras que nadie quiso hacer. Un campo terminado = una petición.
   *
   * Un valor VACÍO **borra** el ajuste (el renglón vuelve a lo que propone el sistema) — el mismo
   * criterio que ya usa la fecha por proveedor: guardar el vacío dejaría un estado que se ve igual
   * pero significa otra cosa, y nadie podría deshacer su cambio sin recargar.
   */
  function ajustarDesdeLaPrevia(clave: string, campo: 'cantidad' | 'precio', valor: string): void {
    const limpio = valor.trim();
    const nuevos = { ...(campo === 'cantidad' ? ajustes : precios) };
    if (limpio === '') delete nuevos[clave];
    else nuevos[clave] = limpio;
    const nuevosAjustes = campo === 'cantidad' ? nuevos : ajustes;
    const nuevosPrecios = campo === 'precio' ? nuevos : precios;
    setAjustes(nuevosAjustes);
    setPrecios(nuevosPrecios);
    // El cuerpo se arma con los valores NUEVOS y no con el estado: `setState` no es inmediato, y
    // leerlo aquí mandaría al servidor el número anterior (la previa diría una cosa y guardaría
    // otra — justo lo que §Post-F9.85 vino a impedir).
    pedirPlan(cuerpoDeCompra(nuevosAjustes, nuevosPrecios));
  }

  /**
   * 🔴 **V1-E3z, 2ª vuelta — SÓLO SE PINTA LA RESPUESTA DE LA ÚLTIMA PETICIÓN.** Dos ediciones
   * seguidas dejan dos `mutate` en vuelo, y si las respuestas llegan al revés la pantalla acabaría
   * enseñando el plan de la PRIMERA mientras el estado ya lleva las dos correcciones — un total que
   * no corresponde a lo que se ve en los campos, que es justo lo que esta pantalla no puede hacer.
   *
   * Se resuelve con un contador y no cancelando: la petición vieja igual llega, y lo único que hay
   * que garantizar es que **no pise** a la nueva.
   */
  function pedirPlan(cuerpo: GenerarOcCuerpo): void {
    const mia = peticionPrevio.current + 1;
    peticionPrevio.current = mia;
    previo.mutate(cuerpo, {
      onSuccess: (datos) => {
        if (mia !== peticionPrevio.current) return;
        setPlan(datos);
        // 🔴 Sube SIEMPRE, aunque el plan traiga los mismos números: es lo que les dice a los
        // campos «lo que ves ya es la respuesta del servidor» incluso cuando la respuesta coincide
        // con lo que estaban enseñando. Ver {@link revisionPlan}.
        setRevisionPlan((n) => n + 1);
      },
    });
  }

  /**
   * 🔴 **V1-E3z, 5ª vuelta — CERRAR LA PREVIA INVALIDA LO QUE VENGA EN VUELO.**
   *
   * `pedirPlan` ya descartaba las respuestas que llegan FUERA DE ORDEN, pero salir de la previa no
   * invalidaba nada: la petición **sobrevivía a la pantalla que la lanzó** y su respuesta tardía
   * **volvía a abrirla sola**. Medido: se cambia «Comprar» a 77, se hace clic en «Volver y
   * corregir» —el `mousedown` saca el foco, así que el campo confirma y sale una petición—, ya en
   * la explosión se quita una OP (lo cual además BORRA `ajustes`/`precios`), llega la respuesta y
   * la previa reaparece con el plan VIEJO: dice *«Surte las órdenes 7, 8»* mientras «Confirmar y
   * generar» manda `idsOrden: [51]`, porque el cuerpo se arma con el estado de AHORA. O sea: la
   * última pantalla antes de comprometer dinero, abierta sin que nadie la pida, para un conjunto de
   * OP que ya no es el elegido — el invariante que la previa existe para sostener (*lo que ves es
   * lo que se va a generar*), roto por el lado más caro.
   *
   * Subir el contador basta y es lo mismo que ya hace `pedirPlan`: la respuesta igual llega, pero
   * no pasa el filtro. Se usa en **los cinco** sitios donde se cierra la previa, porque en los
   * cinco «cerrar» significa exactamente lo mismo —el plan que estaba en vuelo ya no es de nadie—:
   * elegir otra OP base, agregar una OP, quitar una OP (los tres cambian el conjunto Y borran los
   * ajustes), generar las OC (ya se emitieron) y «Volver y corregir» (el comprador se arrepintió).
   *
   * ⚠️ Cuatro de los cinco tienen prueba que se pone roja si se revierten. El de `elegirOrdenBase`
   * **no la tiene, y hoy no puede tenerla**: es su único llamador, va detrás de
   * `idsOrden.length === 0`, y con la lista vacía no puede haber un plan en vuelo (`revisar` se
   * sale antes, y corregir un campo exige una previa abierta, o sea órdenes). Para llegar ahí con
   * la lista vacía hay que pasar por `quitarOrden`, que YA invalidó. Se deja igual —cuesta una
   * línea y deja el sitio correcto de antemano si algún día se entra por otra puerta—, pero queda
   * dicho que ninguna prueba lo vigila, en vez de aparentar una cobertura que no existe.
   *
   * 🔴 **Y se RESETEA la mutación, que es la otra mitad del mismo problema.** Antes de esta etapa
   * el único `previo.mutate` era el que ABRE la previa, así que un error del previo pintado en la
   * explosión (`exp-error-previo`) siempre correspondía a algo que la persona acababa de pedir. El
   * ajuste de campo agregó un segundo emisor, y con él el caso nuevo: **el fallo tardío de una
   * petición ABANDONADA** dejaba en la explosión un error sobre algo que el comprador ya no está
   * haciendo. No reabre nada y no cuesta dinero, pero es la misma familia de todo lo que esta etapa
   * vino a cerrar — la pantalla afirmando algo que no corresponde al estado real.
   *
   * ⚠️ Que `reset()` baste está VERIFICADO en la fuente instalada, no supuesto
   * (`@tanstack/query-core@5.101.0`): `MutationObserver.reset()` hace
   * `#currentMutation.removeObserver(this)`, y `Mutation.#dispatch` sólo avisa a los observadores
   * que siguen en su lista — o sea que cuando la petición abandonada se cae, este observador ya no
   * se entera: ni cambia su estado (`isError` se queda en falso) ni corren sus callbacks de esa
   * llamada. Es una segunda barrera, independiente del contador de arriba.
   *
   * Los cinco sitios lo quieren, y ninguno pierde información legítima: para GENERAR el botón tiene
   * que estar encendido, y un error del previo lo apaga (`planDesfasado`), así que en
   * `confirmarGeneracion` no hay error vivo que borrar; y en los tres que cambian el conjunto de OP
   * el error viejo habla de un conjunto que ya no existe. El único error que sí tiene que
   * sobrevivir —el de «Revisar y generar OC», que falla SIN abrir la previa— no pasa por aquí:
   * ahí no se cierra nada.
   */
  function cerrarPrevia(): void {
    peticionPrevio.current += 1;
    previo.reset();
    setPlan(null);
  }

  /** El cuerpo que va al servidor, IDÉNTICO en la revisión previa y en la generación. */
  function cuerpoDeCompra(
    ajustesActuales: Record<string, string> = ajustes,
    preciosActuales: Record<string, string> = precios,
  ): GenerarOcCuerpo {
    // Sólo viajan las fechas TOCADAS: las demás las resuelve el servidor con la de arriba. 🔴 Y si
    // tampoco hay, NO se resuelve con nada (V1-E7f, §Post-F9.120): el servidor RECHAZA la compra y
    // nombra a los proveedores que se quedarían sin fecha. Aquí decía que caía a *"la entrega más
    // próxima de las OP"* — la fecha del CLIENTE—, y ése es justo el camino por el que el respaldo
    // volvería: alguien lo lee, lo cree, y deja de mandar la fecha. (Vaciar la fecha de un grupo
    // BORRA su entrada, así que aquí nunca hay cadenas vacías: ver `cambiarFechaDe`.)
    const fechasPorProveedor = Object.entries(fechasProveedor).map(([id, fecha]) => ({
      idProveedor: Number(id),
      fechaEntrega: fecha,
    }));
    // ⭐⭐ V1-E3z (§Post-F9.94): un renglón puede traer AJUSTADA la cantidad, el precio, o los dos,
    // así que la lista se arma sobre la UNIÓN de las dos claves. Antes bastaba recorrer `ajustes`;
    // hacerlo hoy perdería, sin decir nada, el precio de un renglón cuya cantidad nadie tocó.
    const listaAjustes = [
      ...new Set([...Object.keys(ajustesActuales), ...Object.keys(preciosActuales)]),
    ]
      .map((clave) => {
        const [material, color, proveedor] = clave.split('|');
        const guion = (material ?? '').indexOf('-');
        const tipo = (material ?? '').slice(0, guion);
        // 🔴 **V1-E3z, 2ª vuelta — EL CLIENTE NO JUZGA EL VALOR: LO ENTREGA.** Aquí había un
        // filtro que descartaba `cantidad <= 0` y `precio < 0`… **en silencio**. Con la previa ya
        // editable eso era un defecto determinista: teclear `-5` en «Precio» guardaba el `-5` en el
        // campo, NO lo mandaba, no aparecía ningún aviso (el del error vive en la rama de la
        // explosión, que está desmontada), «Confirmar» seguía encendido y la OC nacía **al precio
        // anterior**. El mensaje del contrato —*"El precio no puede ser negativo"*— no se ejecutaba
        // nunca, porque el cliente jamás se lo entregaba.
        //
        // La regla se quitó en vez de moverse: **el servidor ya tiene las frases** y es el único
        // que puede tenerlas (A1). Duplicar aquí su criterio es cómo los dos se separan — y el que
        // calla es siempre el cliente. Ahora **todo lo que el usuario tecleó viaja**, y el rechazo
        // vuelve con su texto.
        //
        // Lo único que sigue sin viajar es el campo **VACÍO**, que no es un valor sino la ausencia
        // de uno (*"no lo toqué"*), y un valor **no finito** — que con `type="number"` no puede
        // salir del campo (el navegador lo deja en blanco), así que tratarlo como vacío dice
        // exactamente lo que la pantalla ya está enseñando.
        const cantidad = Number(ajustesActuales[clave] ?? '');
        const precio = Number(preciosActuales[clave] ?? '');
        const hayCantidad = (ajustesActuales[clave] ?? '') !== '' && Number.isFinite(cantidad);
        const hayPrecio = (preciosActuales[clave] ?? '') !== '' && Number.isFinite(precio);
        return {
          tipo: tipo === 'tela' ? ('tela' as const) : ('avio' as const),
          idMaterial: Number((material ?? '').slice(guion + 1)),
          // ⭐⭐ V1-E3u: el ajuste es POR COLOR (§Post-F9.89). Cualquier cosa que no sea un id
          // legible vuelve a "sin color": es mejor mandar el renglón sin color —que el servidor
          // entiende— que un `NaN` que rechazaría la compra entera.
          idTelaColor: Number.isFinite(Number(color)) ? Number(color) : null,
          idProveedor: Number(proveedor),
          ...(hayCantidad ? { cantidadTotal: cantidad } : {}),
          ...(hayPrecio ? { precioUnitario: precio } : {}),
        };
      })
      // Un ajuste que no quedó con ninguno de los dos campos no dice nada: el servidor lo rechaza
      // (el contrato lo exige), así que ni se manda.
      .filter((a) => a.cantidadTotal !== undefined || a.precioUnitario !== undefined);
    return {
      idsOrden,
      idsRequerimiento: [...seleccion],
      ...(fechaEntrega === '' ? {} : { fechaEntrega }),
      ...(direccionEfectiva === null ? {} : { idDireccionEntrega: direccionEfectiva }),
      ...(fechasPorProveedor.length === 0 ? {} : { fechasPorProveedor }),
      ...(listaAjustes.length === 0 ? {} : { ajustes: listaAjustes }),
    };
  }

  /**
   * ⭐⭐ Paso previo: pide al servidor el plan y lo enseña (§Post-F9.85). NO crea nada.
   *
   * ⭐⭐ **V1-E4d (§Post-F9.96) — Y AQUÍ ES DONDE SE RECLAMAN LOS DOS DATOS BLOQUEANTES: la
   * dirección y —desde V1-E4f (§Post-F9.103)— la FECHA DE ENTREGA.** Daniel confirmó que
   * **sin dirección de entrega no se genera una OC**; lo que esa etapa cambió es que el reclamo
   * llega **al intentar avanzar** y no al abrir la pantalla. Antes vivía en `disabled` + un cartel
   * amarillo de entrada: el comprador recibía el regaño antes de haber tenido oportunidad de
   * llenarlo, que es exactamente lo que Daniel describió como *"parecieran que estamos haciendo
   * algo mal"*.
   *
   * 🔴 **Bloquear se sigue bloqueando**: la petición NO sale. Y el servidor lo bloquea otra vez por
   * su cuenta —`planearCompra` devuelve los DOS como bloqueo, la dirección y la fecha—, que es
   * donde de verdad se sostiene la regla: esto es la manera de decirlo a tiempo, no la autoridad
   * (A1).
   */
  function revisar(): void {
    if (idsOrden.length === 0) return;
    // ⭐⭐ **V1-E4f (§Post-F9.103) — SON DOS LOS DATOS BLOQUEANTES DEL DOCUMENTO: la fecha de
    // entrega y la dirección.** Se evalúan LAS DOS antes de frenar (y no en cascada) porque con las
    // dos vacías un `return` temprano dejaría la segunda en gris: el comprador arreglaría una, daría
    // otro clic y se encontraría un amarillo nuevo. Se dice TODO lo que falta de un solo golpe.
    const faltaFecha = avisoFecha !== null;
    const faltaDireccion = avisoDireccion?.bloquea === true;
    if (faltaFecha || faltaDireccion) {
      setIntentoSinFecha(faltaFecha);
      setIntentoSinDireccion(faltaDireccion);
      // Se lleva el foco al lugar donde SE LLENA —el PRIMERO que falta, en el orden de la barra—.
      // Un mensaje que no señala su campo obliga a buscarlo, y estos campos viven en una barra que
      // en pantallas angostas se envuelve.
      if (faltaFecha) campoFecha.current?.focus();
      else selectDireccion.current?.focus();
      return;
    }
    setIntentoSinFecha(false);
    setIntentoSinDireccion(false);
    generar.reset();
    pedirPlan(cuerpoDeCompra());
  }

  /**
   * Confirma: genera las OC. El servidor VUELVE a planear — la pantalla nunca es la autoridad.
   *
   * ⚠️ **NO se puede llegar aquí con un teclazo sin mandar** (V1-E3z, 5ª vuelta: se comprobó en vez
   * de suponerlo). El clic en «Confirmar y generar» empieza por un `mousedown`, que **saca el foco
   * del campo antes que el `click`**, así que el `onBlur` de {@link CampoPrevia} corre SIEMPRE
   * primero, y de ahí salen los dos únicos desenlaces posibles:
   *
   * - el número cambió → confirma y pide plan → `previo.isPending` → el botón queda `disabled` y
   *   el `click` ni siquiera se dispara (lo fija la prueba «el clic … con un número sin mandar»);
   * - el número NO cambió → no hay nada sin mandar, por definición.
   *
   * En los dos casos el `onBlur` baja la marca de "sucio" **incondicionalmente**, así que ningún
   * clic aterriza con teclazos pendientes. Por teclado tampoco hay ventana: para pulsar el botón
   * con Enter hay que estar YA en el botón (el campo se soltó antes), y el Enter DENTRO del campo
   * lo intercepta su `onKeyDown`, que hace `blur()` y `preventDefault()` — nunca activa el botón.
   */
  function confirmarGeneracion(): void {
    if (idsOrden.length === 0) return;
    generar.mutate(cuerpoDeCompra(), {
      onSuccess: () => {
        setSeleccion(new Set());
        setAjustes({});
        setPrecios({});
        cerrarPrevia();
      },
    });
  }

  /** Asigna (o quita, con `null`) el proveedor de un material EN ESA ORDEN. */
  function guardarProveedor(
    renglon: Requerimiento,
    idOrden: number,
    idProveedor: number | null,
    precio: number | null,
  ): void {
    const idMaterial = renglon.tipo === 'tela' ? renglon.idTela : renglon.idAvio;
    if (idMaterial === null) {
      return;
    }
    asignar.mutate(
      {
        idOrden,
        cuerpo: {
          tipo: renglon.tipo,
          idMaterial,
          idProveedor,
          ...(precio === null ? {} : { precio }),
        },
      },
      { onSuccess: () => setAsignandoId(null) },
    );
  }

  const datos = explosion.data;
  const renglones = (datos?.grupos ?? []).flatMap((g) => g.renglones);
  // ⭐ V1-E3q — lo COMPRABLE es lo PENDIENTE (ya neteado contra las OC vivas), no lo requerido.
  const comprables = renglones.filter(
    (r) => r.idProveedorSugerido !== null && r.cantidadPendiente > 0,
  );
  /** Lo que hace falta comprar pero no tiene a quién comprárselo (el atorón de §Post-F9.82). */
  const sinProveedor = renglones.filter(
    (r) => r.idProveedorSugerido === null && r.cantidadPendiente > 0,
  );
  /** ⭐ V1-E3q: lo que ya está cubierto por una OC viva (se ve, pero no se vuelve a comprar). */
  const yaEnOc = renglones.filter((r) => r.cantidadEnOc > 0 && r.cantidadPendiente <= 0);
  /**
   * ⭐ V1-E3m — **NO SE PUEDE DEJAR AL COMPRADOR SIN SABER QUÉ LE FALTA.** Daniel se quedó mirando
   * un «Generar OC» muerto sin una sola pista de por qué (*"no me deja hacer nada"*). Se nombra la
   * causa y, cuando son materiales sin proveedor, se nombran LOS MATERIALES.
   *
   * ⭐⭐ **V1-E4d (§Post-F9.96) — dónde se dice.** Ya no es un cartel amarillo en la entrada: el
   * botón dejó de apagarse por esto, así que esta frase vive en su **título** (para quien pase el
   * ratón) y **el porqué completo lo da la revisión previa**, material por material y con las
   * palabras del servidor (`exp-previa-omitidos`) — en el momento de avanzar, no al llegar.
   */
  const motivoSinOc: string | null =
    datos === undefined
      ? null
      : comprables.length > 0
        ? null
        : sinProveedor.length > 0
          ? `${String(sinProveedor.length)} material(es) sin proveedor: ` +
            `${sinProveedor.map((r) => r.material).join(', ')}. Asígnale uno a cada uno aquí abajo ` +
            `(«Asignar proveedor»), o captúralo en el catálogo: la tela lleva proveedor dueño y el ` +
            `avío, proveedor habitual.`
          : renglones.length === 0
            ? 'Estas órdenes no tienen materiales que comprar.'
            : yaEnOc.length > 0
              ? // ⭐ V1-E3q: ÉSTE es el mensaje que faltaba. Antes la pantalla seguía ofreciendo
                // comprar lo que ya estaba comprado; ahora lo dice y explica cómo revertirlo.
                `Todo lo que falta ya está en órdenes de compra: no hay nada que volver a comprar. ` +
                `Si alguna de esas OC se cancela, sus materiales vuelven a aparecer aquí.`
              : 'No hay nada pendiente de comprar: lo requerido está cubierto por el stock.';

  const ordenesElegidas = datos?.ordenes ?? [];

  /**
   * ⭐⭐ **V1-E4f (§Post-F9.103) — LAS OC QUE NACERÍAN SIN FECHA, dicho ANTES de pedirlas.**
   *
   * Daniel: *"la de entrega no debería de poder estar vacía. **Tiene que tener fecha de entrega a
   * fuerzas**"*. Y con el matiz que §Post-F9.71 ya había fijado: **lo obligatorio es que cada OC
   * tenga fecha, no que se llene el campo de arriba**. Por eso esto se calcula sobre **el PLAN**
   * (qué OC van a salir, y con qué fecha queda cada una) y no sobre el formulario: un proveedor con su propia
   * fecha está completo aunque «Entrega (inicial)» esté en blanco.
   *
   * ⚠️ **Esto NO es la autoridad (A1).** Quien de verdad impide la compra es `planearCompra`, que
   * devuelve la falta de fecha como bloqueo y hace que `generarOCDesdeExplosion` la rechace —con o
   * sin pantalla de por medio—. Esto es la manera de **decirlo a tiempo**, junto al campo donde se
   * arregla, en vez de mandar al comprador a chocar contra un error del servidor tres clics después.
   *
   * ⚠️ **Su margen de error, dicho COMPLETO** (la primera redacción prometía de más y el reviewer lo
   * cazó): la pantalla no puede reproducir el plan entero (el servidor aplica además la firma de
   * Desarrollo y los ajustes del comprador), así que se le pide una sola cosa —lo contrario de la
   * precisión—: que **jamás bloquee de más**. Un grupo sólo cuenta cuando sus renglones son los que
   * la propia pantalla ya considera comprables (proveedor asignado, pendiente ≥ el mínimo guardable
   * y marcados si hay selección). Si aun así el servidor decidiera no generar esa OC, lo peor que
   * pasa es que se pidió una fecha de más.
   *
   * 🔴 **Pero el error del OTRO lado sí existe, y no se disimula:** la pantalla puede **callarse
   * mientras el servidor bloquea** (pedir de MENOS). Es tolerable justamente porque **la autoridad
   * es el servidor**: quien de verdad impide la compra sin fecha es `planearCompra`, y su bloqueo
   * sale en la revisión previa aunque esta barra no haya dicho nada. Lo que NO sería tolerable es lo
   * contrario —frenar una compra legítima por una OC que no existe—, y por eso todo el margen se
   * cargó a ese lado.
   *
   * 🔴🔴 **V1-E7f (§Post-F9.120) — Y LA FECHA DE LAS OP YA NO CUENTA.** Esta cuenta miraba también
   * la entrega de las OP que surte cada OC (el respaldo del servidor) y se CALLABA cuando alguna la
   * traía. Retirado el respaldo, callarse por eso sería el peor de los dos mundos: la pantalla en
   * silencio y el servidor rechazando. Ahora sólo se miran las dos fechas que una PERSONA captura
   * aquí: la de arriba y la de cada proveedor.
   */
  const ocSinFecha = ocSinFechaDeEntrega(
    ocPlaneadasEnPantalla(datos?.grupos ?? [], seleccion),
    fechaEntrega,
    fechasProveedor,
  );
  /** El texto de la falta de fecha, o `null` si no falta ninguna. */
  const avisoFecha: string | null =
    ocSinFecha.length === 0
      ? null
      : (ocSinFecha.length === 1
          ? `La orden de compra de «${ocSinFecha[0]?.proveedor ?? ''}» nacería sin fecha de entrega`
          : `Las órdenes de compra de ${ocSinFecha.map((o) => `«${o.proveedor}»`).join(', ')} ` +
            `nacerían sin fecha de entrega`) +
        ', y toda orden de compra la necesita: es CUÁNDO tiene que llegar el material. ' +
        'No se hereda de la orden de producción (ésa dice cuándo se le entrega al cliente): ' +
        'captúrala en «Entrega (inicial)», aquí arriba (vale para todas), o una por proveedor en su ' +
        'grupo de materiales.';

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b p-4 lg:px-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Explosión de materiales · MRP
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Qué y cuánto comprar (make-to-order), agrupado por proveedor — una compra puede cubrir
            varias órdenes de producción
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
        {plan !== null ? (
          <RevisionPrevia
            plan={plan}
            revision={revisionPlan}
            generando={generar.isPending}
            recalculando={previo.isPending}
            errorRecalculo={previo.isError ? previo.error.message : null}
            error={generar.isError ? generar.error.message : null}
            onVolver={cerrarPrevia}
            onConfirmar={confirmarGeneracion}
            onAjustar={ajustarDesdeLaPrevia}
          />
        ) : (
          <>
            {/* Paso 1: armar el conjunto de OP */}
            <div className="max-w-3xl space-y-2">
              <label htmlFor="exp-buscar-orden" className="text-sm font-medium">
                Órdenes de producción de esta compra
              </label>
              <Input
                id="exp-buscar-orden"
                type="search"
                placeholder="Buscar por folio, modelo o cliente…"
                value={textoBusqueda}
                onChange={(e) => setTextoBusqueda(e.target.value)}
                data-testid="exp-buscar-orden"
              />
              <div className="max-h-48 overflow-y-auto rounded-md border">
                {ordenes.isPending ? (
                  <p className="p-3 text-sm text-muted-foreground">Cargando órdenes…</p>
                ) : ordenes.isError ? (
                  <p className="p-3 text-sm text-destructive">{ordenes.error.message}</p>
                ) : (ordenes.data?.datos ?? []).length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">
                    No hay órdenes que coincidan con la búsqueda.
                  </p>
                ) : (
                  <ul data-testid="exp-lista-ordenes">
                    {(ordenes.data?.datos ?? []).map((o) => {
                      const yaEsta = idsOrden.includes(o.id);
                      return (
                        <li key={o.id}>
                          <button
                            type="button"
                            onClick={() =>
                              idsOrden.length === 0 ? elegirOrdenBase(o.id) : agregarOrden(o.id)
                            }
                            disabled={yaEsta}
                            aria-pressed={yaEsta}
                            className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50 ${
                              yaEsta ? 'bg-primary-soft' : ''
                            }`}
                            data-testid="exp-orden-opcion"
                            data-orden={o.id}
                          >
                            <span className="flex items-center gap-1.5 font-medium">
                              {idsOrden.length > 0 && !yaEsta ? (
                                <Plus className="size-3.5" aria-hidden />
                              ) : null}
                              Orden {o.folio}
                            </span>
                            <span className="truncate text-muted-foreground">
                              {o.codigoModelo} · {o.cliente}
                              {yaEsta ? ' · ya está en la compra' : ''}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* ⭐ V1-E3q — LAS OP ELEGIDAS, con su pedido interno y el botón de quitar. */}
              {idsOrden.length > 0 ? (
                <div className="space-y-1" data-testid="exp-ops-elegidas">
                  <p className="text-xs text-muted-foreground">
                    {idsOrden.length === 1
                      ? 'Comprando para 1 orden de producción.'
                      : `Comprando para ${String(idsOrden.length)} órdenes de producción — las cantidades se agrupan, pero cada una se guarda con su OP.`}
                    {delPedido.data?.folioPedido != null && idsOrden.length > 1
                      ? ` Precargadas del pedido interno ${String(delPedido.data.folioPedido)}; quita las que no vayan.`
                      : ''}
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {/* ⚠️ Los chips salen de `idsOrden` —lo que el usuario eligió—, NO de la
                        respuesta de la explosión: mientras ésta se recalcula (o si falla) la
                        respuesta trae el conjunto ANTERIOR, y pintar eso enseñaría OP que ya se
                        quitaron y escondería las recién agregadas. El nombre bonito se busca en la
                        respuesta cuando ya llegó; si no, se dice el id y no se inventa nada. */}
                    {idsOrden
                      .map((id) => {
                        const ficha = ordenesElegidas.find((o) => o.idOrden === id);
                        return {
                          id,
                          etiqueta:
                            ficha === undefined
                              ? `Orden #${String(id)}`
                              : `Orden ${String(ficha.folio)} · ${ficha.modelo}`,
                        };
                      })
                      .map((o) => (
                        <li
                          key={o.id}
                          className="flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs"
                          data-testid="exp-op-chip"
                          data-orden={o.id}
                        >
                          <span>{o.etiqueta}</span>
                          <button
                            type="button"
                            aria-label={`Quitar ${o.etiqueta} de la compra`}
                            onClick={() => quitarOrden(o.id)}
                            data-testid="exp-quitar-op"
                          >
                            <X className="size-3.5" aria-hidden />
                          </button>
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}
            </div>

            {/* Paso 2: explosión */}
            {idsOrden.length > 0 ? (
              <div className="mt-6">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <ShoppingCart className="size-4" aria-hidden />
                    Materiales requeridos
                    {datos
                      ? ` · ${String(datos.ordenes.length)} OP · ${datos.totalPiezas} pzas`
                      : ''}
                  </h2>
                  <div className="flex items-center gap-2">
                    {/* El impreso pasa por la MISMA puerta que la explosión (V1-E3d): sin receta
                        liberada el servidor contesta 409 y la descarga reventaba sin decir por qué.
                        Si la explosión no cargó, el botón se apaga y lo explica en el tooltip.
                        Con varias OP imprime la PRIMERA (el impreso es de una orden). */}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={datos === undefined}
                      title={
                        datos === undefined
                          ? 'Primero tiene que cargar la explosión (si la receta no está liberada, el impreso tampoco se puede generar).'
                          : idsOrden.length > 1
                            ? 'El impreso es por orden: se imprime la primera del conjunto.'
                            : undefined
                      }
                      onClick={() => {
                        if (datos !== undefined) imprimirExplosion(datos.idOrden);
                      }}
                      data-testid="exp-imprimir"
                    >
                      <Printer aria-hidden /> Imprimir
                    </Button>
                    {/* La OC que salga de aquí necesita fecha de entrega y dirección (§Post-F9.18).
                        §Post-F9.71: esta fecha es el VALOR INICIAL de todas; cada proveedor puede
                        llevar la suya en su propio grupo, y la suya GANA.

                        ⭐⭐ **V1-E4f (§Post-F9.103) — Y ES OBLIGATORIA.** Daniel: *"tiene que tener
                        fecha de entrega a fuerzas"*.

                        🔴🔴 **V1-E7f (§Post-F9.120) — EN BLANCO NO SE CAE A NINGÚN LADO.** Hasta
                        hoy, la OC sin fecha se llevaba la de las OP que surte; Daniel lo cazó
                        usando el sistema (*"tomó la fecha de entrega de la OC del cliente"*): ésa
                        dice cuándo se le entrega al CLIENTE, no cuándo tiene que llegar la TELA.
                        Ahora se reclama SIEMPRE que falte —gris al abrir, amarillo al intentar
                        generar (§Post-F9.96)—, traigan o no fecha las OP. */}
                    <label className="text-xs text-muted-foreground">
                      Entrega (inicial)
                      <Input
                        ref={campoFecha}
                        className="mt-1"
                        type="date"
                        value={fechaEntrega}
                        onChange={(e) => {
                          // Tocar la fecha baja la marca del intento: el amarillo es la consecuencia
                          // de no llenarla, no una etiqueta permanente (M12/M13 de V1-E4d).
                          setIntentoSinFecha(false);
                          setFechaEntrega(e.target.value);
                        }}
                        title="Valor inicial de todas las OC; cada proveedor puede llevar su propia fecha. Obligatoria: no se hereda de la orden de producción."
                        data-testid="exp-fecha-entrega"
                      />
                    </label>
                    {/* ⭐⭐ **V1-E4d (§Post-F9.96) — EL LUGAR PARA DECIR A DÓNDE SE ENTREGA ESTÁ
                        AQUÍ, NO EN OTRA PANTALLA.** Daniel: *"primero que dé la opción de meterlo"*.
                        El selector ya existía; lo que faltaba era **la salida cuando el catálogo
                        está vacío**, que hasta hoy era un enlace que te sacaba de la compra (y al
                        volver, la explosión y las OP elegidas ya no estaban). Se da de alta desde
                        aquí, con el MISMO diálogo del catálogo —no una segunda forma que se
                        desincronice— y la recién creada queda elegida.

                        ⭐⭐ **V1-E4f (§Post-F9.104) — Y EL ALTA VIVE DENTRO DEL DESPLEGABLE.** Daniel,
                        viéndolo funcionar como botón suelto: *"está mejor dentro del cuadro
                        desplegable. **Casi no se va a usar. No tiene caso tener un botón para
                        eso**"*.

                        ⚖️ No contradice §Post-F9.96, la AFINA: el lugar de captura sigue estando a
                        un clic, en el mismo control donde ya estás mirando. Lo que se corrige es el
                        **peso visual** — *la frecuencia manda sobre la barra*: un botón permanente
                        le quitaba espacio a lo que se usa a diario (el selector, la fecha, «Revisar
                        y generar OC») para servir a algo excepcional. Ruido permanente por un caso
                        raro es la misma falla que los nueve avisos amarillos.

                        La opción va **al final y separada** para que no se confunda con una
                        dirección real, y **se pinta aunque el catálogo esté vacío** —es justo
                        cuando más se necesita: esconder la única puerta detrás de una lista sin
                        elementos dejaría al comprador sin salida—. */}
                    <label className="text-xs text-muted-foreground">
                      Entregar en
                      <SelectNativo
                        ref={selectDireccion}
                        className="mt-1"
                        value={direccionEfectiva === null ? '' : String(direccionEfectiva)}
                        onChange={(e) => {
                          if (e.target.value === OPCION_NUEVA_DIRECCION) {
                            // No se elige nada: se abre el alta. El `value` sigue controlado por
                            // `direccionEfectiva`, así que si el diálogo se cancela el desplegable
                            // vuelve solo a lo que estaba —nunca se queda mostrando «＋ Nueva…».
                            setAltaDireccion(true);
                            return;
                          }
                          setIntentoSinDireccion(false);
                          setIdDireccionEntrega(
                            e.target.value === '' ? null : Number(e.target.value),
                          );
                        }}
                        data-testid="exp-direccion-entrega"
                      >
                        <option value="">
                          {direcciones.isError
                            ? 'No se pudo consultar el catálogo'
                            : listaDirecciones.length === 0
                              ? 'Sin direcciones dadas de alta'
                              : 'La de siempre'}
                        </option>
                        {listaDirecciones.map((d) => (
                          <option key={d.id} value={String(d.id)}>
                            {d.nombre}
                          </option>
                        ))}
                        {/* §Post-F9.68 — esconder Y bloquear: sin `compras.administrar` la opción
                            no se pinta (mismo trato que el botón al que sustituye), y el servidor
                            rechaza el alta igual. */}
                        {puedeComprar ? (
                          <>
                            {listaDirecciones.length > 0 ? (
                              <option disabled data-testid="exp-separador-direccion">
                                ──────────
                              </option>
                            ) : null}
                            <option value={OPCION_NUEVA_DIRECCION} data-testid="exp-alta-direccion">
                              ＋ Nueva dirección…
                            </option>
                          </>
                        ) : null}
                      </SelectNativo>
                    </label>
                    {/* ⭐⭐ §Post-F9.85 — YA NO GENERA DE UN CLIC: manda a la REVISIÓN PREVIA.
                     *"Una revisión previa es indispensable"* (Daniel). */}
                    {puedeComprar ? (
                      <Button
                        size="sm"
                        onClick={revisar}
                        /* ⭐⭐ **V1-E4d — EL BOTÓN YA NO SE APAGA POR NO TENER NADA QUE COMPRAR, Y
                           ÉSA ES LA MITAD DEL ARREGLO.** Mientras estuvo apagado, la única manera
                           de decir por qué era un cartel amarillo en la entrada
                           (`exp-motivo-sin-oc`) — el regaño antes del trabajo. Ahora el clic va al
                           servidor y **la revisión previa lo explica material por material**, con
                           las palabras del servidor y en el momento de avanzar (§Post-F9.96):
                           «no hay a quién comprarle X», «Y ya está en una OC viva»… Es más de lo
                           que decía el cartel, y llega cuando se pregunta.

                           Sigue apagado mientras el servidor prepara el plan (`isPending`): dos
                           planes en vuelo es justo lo que V1-E3z vino a cerrar. */
                        disabled={previo.isPending}
                        // V1-E3m: el botón dice qué falta también al pasar el ratón.
                        title={
                          avisoFecha !== null
                            ? 'Falta la fecha de entrega: captúrala en «Entrega (inicial)» o en la de cada proveedor.'
                            : (avisoDireccion?.bloquea ?? false)
                              ? 'Falta decir a dónde se entrega: elígela en «Entregar en» o da de alta una.'
                              : (motivoSinOc ?? undefined)
                        }
                        data-testid="exp-generar-oc"
                      >
                        <ClipboardCheck aria-hidden />
                        {previo.isPending ? 'Preparando…' : 'Revisar y generar OC'}
                      </Button>
                    ) : null}
                  </div>
                </div>

                {previo.isError ? (
                  <p className="mb-3 text-sm text-destructive" data-testid="exp-error-previo">
                    {previo.error.message}
                  </p>
                ) : null}

                {/* ⭐⭐ **V1-E4f (§Post-F9.103) — LA FECHA DE ENTREGA: EL SEGUNDO QUE BLOQUEA.**
                    Daniel: *"la de entrega no debería de poder estar vacía. **Tiene que tener fecha
                    de entrega a fuerzas**"*. Una OC sin fecha no le pide nada al proveedor: dice
                    *qué* y *cuánto*, pero no *cuándo* — y sin *cuándo* no hay compromiso que
                    reclamar, ni retraso que medir, ni nada que meter a la ruta crítica.

                    Se dice con la MISMA forma que la dirección, a propósito (§Post-F9.96):
                    instrucción gris al abrir, amarillo sólo al intentar generar sin llenarla, y el
                    foco al campo. Va justo encima de la dirección porque ése es el orden de la
                    barra. */}
                {avisoFecha !== null ? (
                  <p
                    className={
                      intentoSinFecha
                        ? 'mb-3 rounded-md border border-warn/30 bg-warn-soft p-2 text-xs text-warn'
                        : 'mb-3 text-xs text-muted-foreground'
                    }
                    data-testid="exp-falta-fecha"
                    data-tono={intentoSinFecha ? 'aviso' : 'instruccion'}
                  >
                    {intentoSinFecha ? <b>No se pueden generar las OC todavía: </b> : null}
                    {avisoFecha}
                  </p>
                ) : null}

                {/* ⭐⭐ **V1-E4d (§Post-F9.96) — LA DIRECCIÓN: EL OTRO QUE BLOQUEA (V1-E4f le sumó
                    la fecha, aquí arriba), Y SE RESUELVE AQUÍ.** Daniel, 23-ago-2026, confirmando
                    la regla: **no se genera una OC sin decir a dónde se entrega**. Lo que cambió no es que bloquee, es DÓNDE se
                    arregla y CUÁNDO se dice:

                     • el lugar para llenarlo está a dos dedos de aquí —el selector «Entregar en»,
                       con «＋ Nueva dirección…» al final para el catálogo vacío (V1-E4f)—;
                     • y el texto sale **en el tono de una instrucción** mientras nadie ha intentado
                       avanzar (`text-muted-foreground`), y sólo se pone **amarillo cuando el
                       comprador ya intentó generar** sin haberlo llenado. Que es, literalmente, lo
                       que Daniel dictó: *"primero que dé la opción de meterlo, y si no se hace,
                       entonces que mande los mensajes en amarillo"*.

                    🔴 No es cosmética: recibir de amarillo a alguien que **acaba de abrir la
                    pantalla** es afirmar que ya hizo algo mal. Va justo debajo de su control, NO
                    apilado antes del primer renglón con los demás. */}
                {avisoDireccion !== null ? (
                  <p
                    className={
                      avisoDireccion.bloquea && intentoSinDireccion
                        ? 'mb-3 rounded-md border border-warn/30 bg-warn-soft p-2 text-xs text-warn'
                        : 'mb-3 text-xs text-muted-foreground'
                    }
                    data-testid="exp-falta-direccion"
                    data-tono={
                      avisoDireccion.bloquea && intentoSinDireccion ? 'aviso' : 'instruccion'
                    }
                  >
                    {avisoDireccion.bloquea && intentoSinDireccion ? (
                      <b>No se pueden generar las OC todavía: </b>
                    ) : null}
                    {avisoDireccion.texto}{' '}
                    {avisoDireccion.enlace ? (
                      <Link className="underline" to="/catalogos/direcciones-entrega">
                        Abrir el catálogo de direcciones de entrega
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="underline"
                        onClick={() => void direcciones.refetch()}
                        data-testid="exp-reintentar-direcciones"
                      >
                        Reintentar
                      </button>
                    )}
                    .
                  </p>
                ) : null}

                {/* ⭐⭐ **V1-E4d (§Post-F9.96) — LOS TRES QUE NO ERAN AVISOS, EN UNA LÍNEA.**
                    Aquí vivían, en tres cajas de colores apiladas antes del primer renglón:
                    «N material(es) por comprar» (azul), «N ya están cubiertos por OC vivas» (verde)
                    y «El BOM cambió desde la última explosión» (AMARILLO). Ninguno reportaba un
                    problema: el primero es **la instrucción de la pantalla**, el segundo es
                    **información** —y buena— y el tercero es **la leyenda de las etiquetas** que
                    cada renglón afectado ya trae puestas. Pintados como alarma, eran tres cuartas
                    partes del *"salen muchos avisos y confunde lo que realmente se busca"*.

                    Ahora son UNA línea de texto normal. Lo que cada uno decía en detalle sigue
                    donde de verdad se usa: el nombre de lo ya comprado, en su renglón («Ya
                    comprado») y en los omitidos de la revisión previa; y qué cambió, en la etiqueta
                    del renglón. */}
                {datos !== undefined ? (
                  <p className="mb-3 text-xs text-muted-foreground" data-testid="exp-resumen">
                    {comprables.length > 0 ? (
                      <>
                        <b>{comprables.length}</b> material(es) por comprar — selecciónalos y revisa
                        las OC antes de generarlas (una por proveedor).
                      </>
                    ) : (
                      'No hay nada por comprar en esta selección; cada material dice abajo en qué situación está.'
                    )}
                    {/* 🔴 **V1-E4d, 2ª vuelta — EL HECHO QUE NO PODÍA PERDERSE: LA COMPRA PARCIAL.**
                        El aviso que se retiró (`exp-parcial-sin-proveedor`) NO era un duplicado del
                        otro: eran **mutuamente excluyentes** —uno salía con `comprables === 0` y
                        éste con `comprables > 0`— y decían cosas distintas. Éste es el caso
                        PELIGROSO: la OC **sí** se va a generar y N materiales **se quedan fuera**.
                        Con UN solo material sin proveedor no lo dice nadie más: el panel de a
                        varios exige dos o más, y el título del botón calla porque sí hay comprables.
                        El aviso amarillo no vuelve —Daniel tiene razón: no es un error, es un
                        hecho—, pero el HECHO sí, en gris y junto a los demás. */}
                    {sinProveedor.length > 0
                      ? ` · ${String(sinProveedor.length)} sin proveedor: NO entran en esta compra (asígnaselo en su renglón).`
                      : ''}
                    {yaEnOc.length > 0
                      ? ` · ${String(yaEnOc.length)} ya cubierto(s) por OC vivas: no se vuelven a proponer (si esa OC se cancela, reaparecen).`
                      : ''}
                    {datos.huboCambios
                      ? ' · El BOM cambió desde la última explosión: los renglones afectados están marcados.'
                      : ''}
                  </p>
                ) : null}

                {generar.isError ? (
                  <p className="mb-3 text-sm text-destructive" data-testid="exp-error-generar">
                    {generar.error.message}
                  </p>
                ) : null}
                {generar.isSuccess ? (
                  <div
                    className="mb-3 rounded-md border border-ok/30 bg-ok-soft p-2 text-sm text-ok"
                    data-testid="exp-ok-generar"
                  >
                    <p>
                      Se generaron {generar.data.ordenesCompra.length} orden(es) de compra:{' '}
                      {generar.data.ordenesCompra
                        .map((oc) => `OC ${oc.numCompra} (${oc.proveedor})`)
                        .join(', ')}
                      .
                    </p>
                    {/* ⭐ V1-E3q: lo que se quedó fuera se DICE. Antes se omitía en silencio. */}
                    {generar.data.omitidos.length > 0 ? (
                      <p className="mt-1 text-xs" data-testid="exp-omitidos-tras-generar">
                        Se quedaron fuera {generar.data.omitidos.length} renglón(es):{' '}
                        {generar.data.omitidos.map((o) => o.material).join(', ')}.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {/* ⭐⭐ V1-E3x (§Post-F9.88) — el mismo proveedor a VARIOS de un golpe. Sólo
                    con 2 o más huecos: con uno solo, la forma del renglón ya alcanza. */}
                {puedeAsignarProveedor && sinProveedor.length > 1 ? (
                  <PanelProveedorEnBloque
                    renglones={sinProveedor}
                    ordenes={ordenesElegidas}
                    guardando={asignarBloque.isPending}
                    error={asignarBloque.isError ? asignarBloque.error.message : null}
                    onAsignar={asignarEnBloque}
                  />
                ) : null}

                {explosion.isPending ? (
                  <div className="space-y-2" data-testid="exp-cargando">
                    <Skeleton className="h-16 w-full rounded-lg" />
                    <Skeleton className="h-16 w-full rounded-lg" />
                  </div>
                ) : explosion.isError ? (
                  <p className="text-sm text-destructive">{explosion.error.message}</p>
                ) : (datos?.grupos ?? []).length === 0 ? (
                  <p
                    className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground"
                    data-testid="exp-vacio"
                  >
                    {/* No mentir sobre la causa. */}
                    {(datos?.pendientesLiberar ?? []).length > 0
                      ? 'Nada que comprar todavía: lo que estas órdenes llevan está pendiente de que Desarrollo lo libere (ver abajo).'
                      : 'Estas órdenes no requieren materiales (BOM vacío o sin piezas capturadas).'}
                  </p>
                ) : (
                  <div className="space-y-5" data-testid="exp-grupos">
                    {(datos?.grupos ?? []).map((grupo) => (
                      <div
                        key={grupo.idProveedor ?? 'sin-proveedor'}
                        className="rounded-lg border"
                        data-testid="exp-grupo"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                          <span className="font-medium">{grupo.proveedor}</span>
                          <span className="flex items-center gap-3 text-xs text-muted-foreground">
                            {grupo.renglones.length} material(es)
                            {/* ⭐ §Post-F9.71 — LA FECHA DE ESTA OC. Sólo en los grupos que SÍ
                                generan OC: el grupo "sin proveedor sugerido" no nace de aquí. */}
                            {grupo.idProveedor !== null ? (
                              <label className="flex items-center gap-1.5">
                                Entrega
                                <Input
                                  type="date"
                                  className="h-8 w-[9.5rem]"
                                  value={fechaDe(grupo.idProveedor)}
                                  onChange={(e) =>
                                    cambiarFechaDe(grupo.idProveedor as number, e.target.value)
                                  }
                                  aria-label={`Fecha de entrega de la OC de ${grupo.proveedor}`}
                                  data-testid="exp-fecha-grupo"
                                  data-proveedor={grupo.idProveedor}
                                />
                              </label>
                            ) : null}
                          </span>
                        </div>
                        <ul>
                          {grupo.renglones.map((r) => {
                            const clave = claveAjuste(r);
                            return (
                              <RenglonRequerimiento
                                // ⭐⭐ V1-E3u: el COLOR entra en la clave. Desde §Post-F9.89 la
                                // misma tela sale en VARIOS renglones (uno por color) y con el
                                // mismo proveedor: sin el color, React ve dos hijos con la misma
                                // clave y reusa el DOM del uno para el otro.
                                key={claveRenglonExplosion(r)}
                                renglon={r}
                                multiOp={idsOrden.length > 1}
                                seleccionado={r.idsRequerimiento.some((id) => seleccion.has(id))}
                                onToggle={() =>
                                  alternarRenglon(
                                    r.idsRequerimiento,
                                    r.idsRequerimiento.some((id) => seleccion.has(id)),
                                  )
                                }
                                ajuste={clave === null ? '' : (ajustes[clave] ?? '')}
                                onAjuste={(valor) => {
                                  if (clave === null) return;
                                  setAjustes((prev) => {
                                    const siguiente = { ...prev };
                                    if (valor.trim() === '') delete siguiente[clave];
                                    else siguiente[clave] = valor;
                                    return siguiente;
                                  });
                                }}
                                puedeAsignar={puedeAsignarProveedor}
                                abierto={asignandoId === r.id}
                                guardando={asignar.isPending}
                                onAbrir={() => setAsignandoId(asignandoId === r.id ? null : r.id)}
                                onGuardar={(idOrden, idProveedor, precio) =>
                                  guardarProveedor(r, idOrden, idProveedor, precio)
                                }
                                // ⭐⭐ V1-E4c — DECIR (o CORREGIR) EL COLOR, EN EL RENGLÓN.
                                puedeDecirColor={puedeComprar}
                                colorAbierto={colorAbiertoId === claveRenglonExplosion(r)}
                                onAbrirColor={() =>
                                  setColorAbiertoId(
                                    colorAbiertoId === claveRenglonExplosion(r)
                                      ? null
                                      : claveRenglonExplosion(r),
                                  )
                                }
                                onVerTodosLosColores={setIdOrdenColores}
                              />
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── ⭐⭐ **V1-E4d (§Post-F9.96) — LO QUE NO ENTRA Y LO QUE HAY QUE SABER: AL
                    FINAL, DESPUÉS DEL TRABAJO.** Estos tres estaban arriba del primer renglón, en
                    amarillo. Ninguno se pierde: siguen completos, con su acción y sus nombres —pero
                    detrás de la lista, que es a lo que el comprador viene—. El único que conserva el
                    rojo es la desalineación CRÍTICA (el modelo cambió cuando ya hay compras), y lo
                    conserva porque §Post-F9.43(d) lo pide TEXTUALMENTE *"en el lugar de la
                    decisión"*: ahí sí hay dinero de por medio.

                    ⚠️ Los dos que tienen consecuencia real vuelven a levantarse **en la revisión
                    previa**, que es cuando se firma: lo que falta liberar lo redacta el servidor
                    (`avisosDeMaterialSinLiberar`, sólo por lo que de verdad se queda fuera) y las
                    telas sin color ya lo hacían desde V1-E4c. ── */}

                {/* ⭐ V1-E3h — QUÉ NO ESTÁ AQUÍ Y POR QUÉ (y a dónde ir a resolverlo). */}
                {(datos?.pendientesLiberar ?? []).length > 0 ? (
                  <div
                    className="mt-5 rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground"
                    data-testid="exp-pendientes-liberar"
                  >
                    <p className="flex items-center gap-1.5 font-medium text-foreground">
                      <LockOpen className="size-4 shrink-0" aria-hidden />
                      Desarrollo todavía no libera {(datos?.pendientesLiberar ?? []).length}{' '}
                      material(es), así que NO entran en esta explosión:
                    </p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {(datos?.pendientesLiberar ?? []).map((p) => (
                        <li key={`${p.tipo}-${p.idRenglon}`} data-testid="exp-pendiente-liberar">
                          <b>{p.material}</b> — {formatearCantidad(p.consumoPorPrenda)}
                          {p.unidad === null ? '' : ` ${p.unidad}`} por prenda (orden {p.folioOrden}
                          )
                        </li>
                      ))}
                    </ul>
                    {puedeIrALiberar ? (
                      <button
                        type="button"
                        className="mt-1 underline"
                        onClick={() =>
                          void navigate('/produccion/ordenes', {
                            state: { idOrden: datos?.pendientesLiberar[0]?.idOrden },
                          })
                        }
                        data-testid="exp-ir-a-liberar"
                      >
                        Abrir la orden para liberar su receta
                      </button>
                    ) : (
                      <p className="mt-1">
                        Pídeselo a Desarrollo: se libera desde la receta de la orden.
                      </p>
                    )}
                  </div>
                ) : null}

                {/* ⭐ PRIMER AVISO de §Post-F9.43(d) (V1-E3d). El caso CRÍTICO —el modelo cambió
                    cuando esta orden ya tiene compras— sigue en rojo: es el único de este bloque
                    donde el aviso vale más que el silencio. El resto es informativo. */}
                {(datos?.desalineacion.hayCambios ?? false) ? (
                  <div
                    className={
                      datos?.desalineacion.critico === true
                        ? 'mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive'
                        : 'mt-3 rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground'
                    }
                    data-testid="exp-desalineacion"
                  >
                    <p
                      className={
                        datos?.desalineacion.critico === true
                          ? 'font-medium'
                          : 'font-medium text-foreground'
                      }
                    >
                      {datos?.desalineacion.critico === true
                        ? 'El modelo cambió DESPUÉS de que esta orden ya tiene compras — revísalo antes de seguir gastando:'
                        : 'El modelo cambió desde que esta orden congeló su receta:'}
                    </p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {(datos?.desalineacion.cambios ?? []).map((c, i) => (
                        <li
                          key={`${c.tipo}-${String(c.idRenglon)}-${c.que}-${String(i)}`}
                          data-testid="exp-cambio-receta"
                        >
                          {c.detalle}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1">
                      La receta de la orden NO se movió (para eso está congelada). Si algún cambio
                      debe entrar, se trae a mano desde la receta de la orden.
                    </p>
                  </div>
                ) : null}

                {/* Notas del enganche (F8-E6): precios de referencia, proveedores inactivos, avíos
                    sin medida por talla… Nada truena en silencio, pero tampoco es una alarma: son
                    apuntes sobre CÓMO quedó valuada la explosión. */}
                {(datos?.avisos ?? []).length > 0 ? (
                  <div
                    className="mt-3 rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground"
                    data-testid="exp-avisos"
                  >
                    <p className="font-medium text-foreground">
                      Notas de la explosión (precios y proveedores):
                    </p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {(datos?.avisos ?? []).map((aviso, i) => (
                        <li key={i} data-testid="exp-aviso">
                          {aviso}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* ⭐⭐ V1-E4d (§Post-F9.96) — DAR DE ALTA LA DIRECCIÓN SIN SALIR DE LA COMPRA. Se monta
          sólo cuando se abre: es una forma completa (react-hook-form + Zod) y no tiene por qué
          vivir montada en una pantalla que casi siempre ya tiene su dirección. Al crearla queda
          ELEGIDA —para eso se pidió—, sin depender de que alguien acuerde marcarla favorita. */}
      {altaDireccion ? (
        <DialogoDireccionEntrega
          abierto
          alCambiarAbierto={(abierto) => {
            if (!abierto) setAltaDireccion(false);
          }}
          direccion={undefined}
          alCrear={(creada) => {
            setIdDireccionEntrega(creada.id);
            setIntentoSinDireccion(false);
          }}
        />
      ) : null}

      {/* ⭐⭐ V1-E3u (§Post-F9.89) — de qué color se compra cada tela de esta orden. */}
      <DialogoColoresDeTela
        abierto={idOrdenColores !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) setIdOrdenColores(null);
        }}
        idOrden={idOrdenColores ?? undefined}
        folioOrden={datos?.ordenes.find((o) => o.idOrden === idOrdenColores)?.folio ?? undefined}
        puedeEditar={puedeComprar}
      />
    </div>
  );
}

/**
 * Una OC del plan, vista desde la pantalla: quién la recibe.
 *
 * ⚠️ Aquí vivía `idsOrden` —las OP cuyas líneas entrarían en esta OC—, y existía por UNA razón: de
 * ellas salía la fecha de respaldo. Muerto el respaldo (🔴 V1-E7f, §Post-F9.120), el dato no lo
 * consulta nadie: la fecha de una OC sólo puede venir de lo que una persona capturó.
 */
export interface OcPlaneadaEnPantalla {
  idProveedor: number;
  proveedor: string;
}

/**
 * ⭐⭐ **V1-E4f (§Post-F9.103) — QUÉ OC SALDRÍAN DE LO QUE HAY EN PANTALLA.** Pura y exportada para
 * que una prueba unitaria pueda verla (la lección que este módulo aprendió tres veces).
 *
 * Un grupo cuenta como "va a generar OC" cuando tiene al menos un renglón que la propia pantalla ya
 * trata como COMPRABLE: con proveedor asignado, con pendiente que llegue al mínimo guardable y
 * —si el comprador marcó algo— marcado. Es exactamente lo que la casilla de cada renglón permite
 * hacer, así que no introduce una segunda idea de "qué se compra".
 *
 * 🔴 **NADA SIN PROVEEDOR GENERA OC, y eso se guarda DOS veces a propósito**: ni el grupo cuyo
 * `idProveedor` es `null` ni un renglón cuyo `idProveedorSugerido` es `null` paren documento alguno,
 * y pedirles fecha sería bloquear la compra por una OC que no existe. Con los datos que manda el
 * servidor **una guarda implica la otra** —`agruparPorProveedor` (`mrp.ts`) agrupa JUSTO por
 * `idProveedorSugerido`, así que el grupo `null` es exactamente el de los renglones `null`—, y por
 * eso neutralizar UNA sola no pone en rojo ninguna prueba de pantalla (lo midió el reviewer). No se
 * quita ninguna: **cada una queda fijada por separado** con una prueba DIRECTA de esta función, con
 * la forma incoherente que el servidor no produce pero el tipo sí permite.
 *
 * ⚠️ 🔴 V1-E7f (§Post-F9.120): esta función devolvía además **de qué OP vive cada OC**, y con ellas
 * llegaba un filtro por el pendiente de cada OP. Todo eso servía a la fecha de RESPALDO, que ya no
 * existe — se retiró entero en vez de dejarlo calculándose para nadie.
 */
export function ocPlaneadasEnPantalla(
  grupos: readonly {
    idProveedor: number | null;
    proveedor: string;
    renglones: readonly {
      idProveedorSugerido: number | null;
      cantidadPendiente: number;
      idsRequerimiento: readonly number[];
    }[];
  }[],
  seleccion: ReadonlySet<number>,
): OcPlaneadaEnPantalla[] {
  const planeadas: OcPlaneadaEnPantalla[] = [];
  for (const grupo of grupos) {
    const idProveedor = grupo.idProveedor;
    if (idProveedor === null) continue;
    // 🔴 **EL `>=` ES INVARIANTE, y tiene prueba propia** (V1-E7f la heredó del corte por OP, que
    // murió con el respaldo): `0.01` es justo lo mínimo que la columna guarda, así que ese renglón
    // SÍ genera línea. Con `>` el grupo entero se caería y la pantalla se **callaría** mientras el
    // servidor pide la fecha — el peor de los dos mundos ahora que nada se hereda.
    const entran = grupo.renglones.filter(
      (r) =>
        r.idProveedorSugerido !== null &&
        r.cantidadPendiente >= MINIMO_GUARDABLE &&
        (seleccion.size === 0 || r.idsRequerimiento.some((id) => seleccion.has(id))),
    );
    if (entran.length === 0) continue;
    planeadas.push({ idProveedor, proveedor: grupo.proveedor });
  }
  return planeadas;
}

/**
 * ⭐⭐ **V1-E4f (§Post-F9.103) — CUÁLES DE ESAS OC NACERÍAN SIN FECHA.**
 *
 * La cascada es la MISMA del servidor (`resolverFechasDeOc`), en su mismo orden, y ése es el punto
 * de §Post-F9.71: **la fecha propia del proveedor GANA** y la de arriba es sólo el *valor inicial de
 * todas*. Por eso la obligación es *"cada OC con fecha"* y no *"el campo de arriba lleno"*: pedir el
 * campo de arriba sería reclamar un dato que ya está capturado en otro lado.
 *
 * 🔴🔴 **V1-E7f (§Post-F9.120) — Y NO HAY TERCER PELDAÑO.** Aquí había uno: si alguna de las OP que
 * surte la OC traía fecha de entrega, esto se callaba (el servidor la heredaba). Ese respaldo se
 * retiró —la fecha de la OP es cuándo se le entrega al CLIENTE, no cuándo debe llegar la tela—, así
 * que la pantalla tiene que reclamarla **aunque las OP la traigan**: callarse ahora dejaría al
 * comprador chocando contra el rechazo del servidor tres clics después.
 */
export function ocSinFechaDeEntrega(
  planeadas: readonly OcPlaneadaEnPantalla[],
  fechaBase: string,
  fechasProveedor: Readonly<Record<number, string>>,
): OcPlaneadaEnPantalla[] {
  return planeadas.filter(
    (oc) => (fechasProveedor[oc.idProveedor] ?? '') === '' && fechaBase === '',
  );
}

/**
 * La clave de UN ajuste del comprador: material + color + proveedor — la MISMA que entiende el
 * servidor (`claveAjuste` de `mrp.ts`).
 *
 * ⚠️ Se escribe en UN SOLO lugar del frontend porque ahora la teclean DOS pantallas: el campo
 * «Comprar» de la explosión y —⭐⭐ V1-E3z— los campos de la revisión previa. Dos maneras de armar
 * la misma clave es exactamente cómo un ajuste "no se aplica" en silencio.
 */
function claveDeAjuste(
  tipo: 'tela' | 'avio',
  idMaterial: number,
  idTelaColor: number | null,
  idProveedor: number,
): string {
  const color = idTelaColor == null ? 'sin' : String(idTelaColor);
  return `${tipo}-${String(idMaterial)}|${color}|${String(idProveedor)}`;
}

/**
 * ⭐⭐ **V1-E4c — LA IDENTIDAD ESTABLE DE UN RENGLÓN DE LA EXPLOSIÓN**: material + color +
 * proveedor. Es lo que un renglón *es*, y sobrevive a que se vuelva a explotar; su `id` de snapshot
 * no (cada explosión escribe filas nuevas). La usan las dos cosas que necesitan que un renglón siga
 * siendo "el mismo" entre dos respuestas del servidor: la `key` de React y el bloque de color
 * abierto.
 */
function claveRenglonExplosion(r: Requerimiento): string {
  const material = String(r.idTela ?? r.idAvio);
  const color = r.idTelaColor == null ? 'sin' : String(r.idTelaColor);
  return `${r.tipo}-${material}-${color}-${String(r.idProveedorSugerido)}`;
}

/**
 * ⭐⭐ V1-E3z (§Post-F9.94) — **UN CAMPO NUMÉRICO DE LA REVISIÓN PREVIA.**
 *
 * Se teclea libre y se confirma al **salir del campo** (o con Enter). No hay rebote por pulsación a
 * propósito: cada confirmación dispara una petición al servidor, y con un rebote teclear "1500"
 * mandaría a planear compras de 1, de 15 y de 150 — totales de compras que nadie quiso hacer.
 *
 * El valor que pinta viene SIEMPRE del plan del servidor (`valor`): si el servidor redondea o clava
 * el número en otra cosa, el campo enseña lo que de verdad se va a comprar, no lo que se tecleó.
 */
function CampoPrevia({
  valor,
  revision,
  etiqueta,
  titulo,
  ancho,
  minimo,
  marcador,
  testid,
  onConfirmar,
}: {
  /** Lo que dice el PLAN del servidor (cadena vacía = ese renglón no tiene ese número). */
  valor: string;
  /** Identidad del plan que trajo ese `valor` (sube en cada respuesta buena del servidor). */
  revision: number;
  etiqueta: string;
  titulo: string;
  ancho: string;
  minimo: string;
  marcador?: string;
  testid: string;
  onConfirmar: (valor: string) => void;
}): React.JSX.Element {
  const [texto, setTexto] = useState(valor);
  /**
   * 🔴 **¿HAY TECLAZOS SIN CONFIRMAR EN ESTE CAMPO?** (V1-E3z, 4ª vuelta.) No es «¿tiene el cursor
   * dentro?»: es «¿lo que se ve lo escribió el comprador y todavía no lo ha mandado?».
   *
   * La diferencia es EL hallazgo de esta vuelta. Con la condición anterior —tener el foco— bastaba
   * el gesto más natural del mundo para que el campo volviera a mentir: teclear `2.004`, salir con
   * Tab (sale la petición, el botón dice «Recalculando…») y **hacer clic de vuelta en el campo para
   * revisar lo que uno puso**. La respuesta llegaba con el cursor dentro, la guardia la tapaba, y la
   * pantalla se quedaba enseñando `2.004` junto al chip «Precio ajustado (propuesto $2.00)» — la
   * misma pantalla por la que la etapa ya había sido rechazada. Y la ventana no era un instante:
   * era **todo lo que tardara el recálculo**, justo cuando la persona está mirando ese número.
   *
   * Se levanta al TECLEAR y se baja al SALIR del campo (ahí termina la edición: de ese momento en
   * adelante el plan vuelve a mandar). Volver a entrar sin teclear deja el campo limpio, así que la
   * respuesta del servidor lo repinta aunque el cursor siga dentro.
   */
  const sucio = useRef(false);
  /**
   * 🔴 **LA RECONCILIACIÓN CUELGA DE LA REVISIÓN DEL PLAN, NO DEL VALOR — y no es un detalle
   * estilístico: es EL defecto que esta vuelta vino a cerrar.** Si la dependencia fuera sólo
   * `valor`, el campo NO adoptaría el número del servidor justo cuando el servidor devuelve el
   * mismo que ya estaba pintado:
   *
   * - Redondeo (H1): el campo dice `2`, se teclea `2.004`, el servidor responde `2` con
   *   «Precio ajustado». `valor` no cambió → el efecto no corre → **el campo se queda en `2.004`**
   *   mientras el chip, el reparto y el importe dicen `2.00`. La OC nace bien; **la que miente es
   *   la pantalla**, y la pantalla es TODO lo que la previa es.
   * - Arrepentimiento tras un rechazo (H2): el campo dice `300`, se teclea `0`, el servidor lo
   *   rechaza (el plan NO cambia), se BORRA el campo para deshacer → el servidor devuelve otra vez
   *   `300` → `valor` no cambió → **el campo se queda en blanco para siempre**, y como `texto ('')`
   *   ya nunca iguala a `valor ('300')`, la guardia del `onBlur` deja de servir y **cada paso por
   *   el campo cuesta otra petición** (apagando «Confirmar» en cada una).
   *
   * Por eso la dependencia es `revision`: sube en CADA respuesta buena, coincidan o no los números,
   * que es exactamente la pregunta que hay que hacerse aquí («¿ya contestó el servidor?»), no
   * «¿cambió el número?». ⚠️ **Quitarla «porque `valor` ya está en la lista» reabre las dos.**
   */
  useEffect(() => {
    // …salvo si hay teclazos SIN confirmar: la respuesta a lo que se corrigió en OTRO campo llega
    // cuando el comprador ya está tecleando en éste (tabular entre «Comprar» y «Precio» es el
    // camino normal), y pisarle el texto a medio escribir sería otra manera de mentir. En cuanto
    // salga del campo, si lo que dejó escrito no es lo del plan, se confirma y el servidor
    // contesta: la reconciliación llega igual, sin arrancarle las teclas de la mano.
    if (sucio.current) return;
    setTexto(valor);
  }, [valor, revision]);
  return (
    <label className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
      {etiqueta}
      <Input
        type="number"
        step="0.01"
        min={minimo}
        inputMode="decimal"
        className={`h-8 ${ancho} text-right`}
        value={texto}
        {...(marcador === undefined ? {} : { placeholder: marcador })}
        onChange={(e) => {
          // Aquí —y sólo aquí— nace lo "sucio": `onChange` de un input controlado lo dispara el
          // usuario, nunca el `setTexto` del efecto. O sea que la marca distingue exactamente lo
          // que tiene que distinguir: teclazos de la persona vs. repintado del plan.
          sucio.current = true;
          setTexto(e.target.value);
        }}
        // Sólo se pide un plan nuevo si el número CAMBIÓ: pasar por el campo con el tabulador no
        // tiene por qué costar una petición ni repintar la pantalla.
        onBlur={() => {
          // Salir del campo TERMINA la edición: de aquí en adelante el plan vuelve a mandar sobre
          // lo que se ve, aunque el comprador entre otra vez a mirar. (El orden respecto de
          // `onConfirmar` da igual y no se finge que importe: React no corre los efectos a media
          // llamada del manejador, así que para cuando el de arriba se ejecuta la marca ya está
          // baja por cualquiera de los dos caminos.)
          sucio.current = false;
          if (texto !== valor) onConfirmar(texto);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        aria-label={titulo}
        title={titulo}
        data-testid={testid}
      />
    </label>
  );
}

/**
 * ⭐⭐ **LA REVISIÓN PREVIA** (V1-E3q, §Post-F9.85) — *"me gustaría que al darle «generar OC desde la
 * explosión», te mande a una pantalla previa, antes de generar la OC. Una revisión previa es
 * indispensable"* (Daniel, 20-ago-2026).
 *
 * Enseña, ANTES de comprometer nada: **qué OC va a salir, a qué proveedor, con qué renglones y
 * cantidades, y de qué OP es cada cantidad**; y lo que se va a **OMITIR con su razón** — que antes
 * se descartaba en silencio y sólo se sabía después, contando las OC que salieron.
 *
 * Todo lo que pinta viene del SERVIDOR (`POST /api/explosion/previo`), calculado por el MISMO código
 * que luego genera: una previa que calculara por su cuenta sería una promesa que el sistema no
 * cumple (A1).
 *
 * ⭐⭐ **V1-E3z (§Post-F9.94) — Y AQUÍ SE CORRIGEN CANTIDAD Y PRECIO.** Daniel, 23-ago-2026: *"ya hay
 * una pantalla previa, pero **no me deja poner el precio correcto ni la cantidad**… al final puedo
 * modificar precio o cantidad antes de generar la OC. **No me deja modificar nada**"*.
 *
 * 🔴 **La razón por la que nació de solo lectura NO se rompió, se conserva.** Al cambiar un número
 * la previa **vuelve a pedirle el plan al servidor** y repinta lo que él devuelva: sigue sin sumar,
 * sin multiplicar y sin repartir nada. Lo único que cambió es que ahora el comprador puede corregir
 * **donde tiene sentido corregir** — la última pantalla antes de comprometer el dinero, que es la
 * única donde ve el total.
 *
 * ⚠️ Mientras el servidor recalcula, «Confirmar y generar» se apaga: confirmar contra un plan que ya
 * no es el de la pantalla sería emitir un documento que nadie revisó.
 *
 * 🔴 **Y si el recálculo FALLA, se apaga igual y el error se pinta AQUÍ DENTRO** (2ª vuelta de
 * V1-E3z). El aviso de error del previo vivía sólo en la rama de la explosión —que está
 * **desmontada** mientras se ve la previa—, así que un rechazo del servidor no tenía dónde salir: el
 * campo se quedaba con el número tecleado, el renglón seguía enseñando el total VIEJO y «Confirmar»
 * seguía encendido. Es la misma trampa del *toast* que se desmontaba en V1-E3x: **el aviso no sirve
 * si no sigue vivo quien lo muestra**.
 */
function RevisionPrevia({
  plan,
  revision,
  generando,
  recalculando,
  errorRecalculo,
  error,
  onVolver,
  onConfirmar,
  onAjustar,
}: {
  plan: PlanCompra;
  /**
   * Cuántos planes lleva servidos el servidor. Los campos lo usan para saber que llegó una
   * respuesta NUEVA aunque traiga los mismos números (ver {@link CampoPrevia}).
   */
  revision: number;
  generando: boolean;
  /** ¿El servidor está recalculando el plan tras un cambio del comprador? */
  recalculando: boolean;
  /**
   * El rechazo del ÚLTIMO recálculo, con la frase del servidor (`null` = ninguno). Mientras haya
   * uno, el plan que se está pintando **no corresponde** a lo que dicen los campos.
   */
  errorRecalculo: string | null;
  error: string | null;
  onVolver: () => void;
  onConfirmar: () => void;
  /** Corrige un número de un renglón y vuelve a pedirle el plan al servidor (§Post-F9.94). */
  onAjustar: (clave: string, campo: 'cantidad' | 'precio', valor: string) => void;
}): React.JSX.Element {
  const bloqueado = plan.bloqueos.length > 0;
  const sinNada = plan.proveedores.length === 0;
  // 🔴 EL PLAN DE LA PANTALLA NO ES EL DE LOS CAMPOS: o el servidor está recalculando, o el último
  // recálculo lo rechazó. En los dos casos los totales que se ven son de ANTES de lo que se tecleó,
  // y confirmar emitiría una OC con un número que nadie revisó.
  const planDesfasado = recalculando || errorRecalculo !== null;
  return (
    <div className="space-y-4" data-testid="exp-revision-previa">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[17px] font-semibold">Revisión previa · antes de generar las OC</h2>
          <p className="text-[12.5px] text-muted-foreground">
            {plan.proveedores.length} orden(es) de compra para {plan.ordenes.length} orden(es) de
            producción — total {formatearMoneda(plan.totalGeneral)}. Todavía no se ha creado nada.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onVolver} data-testid="exp-volver-explosion">
            <ArrowLeft aria-hidden /> Volver y corregir
          </Button>
          <Button
            size="sm"
            onClick={onConfirmar}
            // ⭐ V1-E3z: no se confirma un plan que ya no corresponde a lo tecleado — ni mientras
            // el servidor recalcula, ni cuando el recálculo fue RECHAZADO.
            disabled={generando || bloqueado || sinNada || planDesfasado}
            title={
              bloqueado
                ? plan.bloqueos.join(' ')
                : sinNada
                  ? 'No hay nada que comprar con esta selección.'
                  : errorRecalculo !== null
                    ? `Corrige lo que marcaste: ${errorRecalculo}`
                    : recalculando
                      ? 'Espera a que se recalcule el plan con lo que cambiaste.'
                      : undefined
            }
            data-testid="exp-confirmar-generar"
          >
            {generando
              ? 'Generando…'
              : recalculando
                ? 'Recalculando…'
                : 'Confirmar y generar las OC'}
          </Button>
        </div>
      </div>

      {/* 🔴 EL RECHAZO DEL RECÁLCULO, con la frase del SERVIDOR — la única que sabe por qué. Aquí
          es donde aterrizan los números que la pantalla ya no juzga por su cuenta: un precio
          negativo, una cantidad en cero. Va DENTRO de la previa porque es la que está montada. */}
      {errorRecalculo !== null ? (
        <p
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          data-testid="exp-error-recalculo"
        >
          <b>No se pudo recalcular con lo que cambiaste:</b> {errorRecalculo} Los totales de abajo
          son los de ANTES de tu cambio.
        </p>
      ) : null}

      {error !== null ? (
        <p className="text-sm text-destructive" data-testid="exp-error-generar">
          {error}
        </p>
      ) : null}

      {/* Lo que IMPIDE generar, con las MISMAS palabras con las que el servidor lo rechazaría. */}
      {bloqueado ? (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive"
          data-testid="exp-bloqueos"
        >
          <p className="font-medium">No se puede generar todavía:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {plan.bloqueos.map((b, i) => (
              <li key={i} data-testid="exp-bloqueo">
                {b}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ⭐⭐ **V1-E4c — EL AVISO AMARILLO DEL COLOR, AQUÍ Y NO EN LA ENTRADA.**
          Daniel, 23-ago-2026: *"primero que dé la opción de meterlo, y si no se hace, entonces que
          mande los mensajes en amarillo"*. Capturar es el proceso NORMAL —y su lugar es el renglón
          de la tela—; esto es la CONSECUENCIA de no haberlo llenado, y sale cuando se va a
          avanzar. Lo redacta el servidor y sólo por lo que de verdad se va a escribir sin color
          (`avisosDeTelaSinColor`): no bloquea nada, igual que no lo bloqueaba antes. */}
      {plan.avisos.length > 0 ? (
        <div
          className="rounded-md border border-warn/30 bg-warn-soft p-3 text-xs text-warn"
          data-testid="exp-previa-avisos"
        >
          <p className="flex items-center gap-1.5 font-medium">
            {/* ⭐ V1-E4d: el icono deja de ser la paleta. Estos avisos ya no son sólo del color:
                desde esta etapa también dicen lo que NO entra por no estar liberado. */}
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            Se puede comprar así, pero revisa esto antes de firmar:
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {plan.avisos.map((a, i) => (
              <li key={i} data-testid="exp-previa-aviso">
                {a}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {sinNada ? (
        <p
          className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground"
          data-testid="exp-previa-vacia"
        >
          Con esta selección no sale ninguna orden de compra. Abajo está el porqué de cada renglón.
        </p>
      ) : null}

      {plan.proveedores.map((p) => (
        <div key={p.idProveedor} className="rounded-lg border" data-testid="exp-previa-oc">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
            <span className="font-medium">{p.proveedor}</span>
            <span className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>
                Entrega:{' '}
                {p.fechaEntrega ?? <b className="text-destructive">falta la fecha de entrega</b>}
              </span>
              <span data-testid="exp-previa-ops">
                Surte {p.ordenes.length === 1 ? 'la orden' : 'las órdenes'}{' '}
                {p.ordenes.map((f) => String(f)).join(', ')}
              </span>
              <span className="font-medium tabular-nums">{formatearMoneda(p.total)}</span>
            </span>
          </div>
          <ul>
            {p.renglones.map((r) => (
              <li
                // ⭐⭐ V1-E3u: idem — dos colores de la misma tela son dos renglones.
                key={`${r.tipo}-${String(r.idMaterial)}-${r.idTelaColor == null ? 'sin' : String(r.idTelaColor)}`}
                className="border-t px-3 py-2 first:border-t-0"
                data-testid="exp-previa-renglon"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {r.material}
                    {/* ⭐⭐ V1-E3u (§Post-F9.89) — EL COLOR, en la última pantalla antes de generar
                        la OC. Sin él, dos renglones de la misma tela en tonos distintos se ven
                        IDÉNTICOS justo donde se decide qué se compra. */}
                    {r.telaColor === null ? null : (
                      <ChipEstado tono="info" sinPunto data-testid="exp-previa-color">
                        {r.telaColor}
                      </ChipEstado>
                    )}
                    {r.ajustado ? (
                      <ChipEstado tono="info" sinPunto data-testid="exp-previa-ajustado">
                        Total ajustado (propuesto {formatearCantidad(r.cantidadPropuesta)})
                      </ChipEstado>
                    ) : null}
                    {/* ⭐⭐ V1-E3z (§Post-F9.94) — el MISMO aviso que la cantidad ya tenía, para el
                        precio. Quien autoriza la OC tiene que poder ver que el precio no es el que
                        el sistema resolvió, y contra cuál se cambió. */}
                    {r.precioAjustado ? (
                      <ChipEstado tono="info" sinPunto data-testid="exp-previa-precio-ajustado">
                        Precio ajustado
                        {r.precioPropuesto === null
                          ? ''
                          : ` (propuesto ${formatearMoneda(r.precioPropuesto)})`}
                      </ChipEstado>
                    ) : null}
                  </span>
                  {/* 🔴 V1-E3z, 3ª vuelta — ESTA FILA ENVUELVE. Era un texto de ~130 px y ahora
                      lleva DOS campos con sus etiquetas más el total (~490 px de mínimo): sin
                      `flex-wrap`, en un teléfono el `span` recibe el ancho de la tarjeta (~336 px)
                      y se sale por la derecha, contra el estándar responsive del proyecto. */}
                  <span className="flex flex-wrap items-center justify-end gap-3 tabular-nums">
                    {/* ⭐⭐ V1-E3z — LOS DOS CAMPOS QUE DANIEL PIDIÓ. Lo que se teclea NO se calcula
                        aquí: se manda al servidor y la pantalla repinta su respuesta (A1). */}
                    <CampoPrevia
                      valor={String(r.cantidadTotal)}
                      revision={revision}
                      etiqueta="Comprar"
                      // La orden de compra guarda la cantidad con DOS decimales: ofrecer más
                      // invitaría a teclear algo que el documento no puede guardar.
                      minimo="0.01"
                      ancho="w-24"
                      titulo={`Cantidad total a comprar de ${r.material}${
                        r.unidad === null ? '' : ` (${r.unidad})`
                      }. Se guarda con dos decimales; el sistema la reparte entre las órdenes.`}
                      testid="exp-previa-cantidad"
                      onConfirmar={(v) =>
                        onAjustar(
                          claveDeAjuste(r.tipo, r.idMaterial, r.idTelaColor, p.idProveedor),
                          'cantidad',
                          v,
                        )
                      }
                    />
                    <CampoPrevia
                      valor={r.precioUnitario === null ? '' : String(r.precioUnitario)}
                      revision={revision}
                      etiqueta="Precio"
                      // 0 SÍ se puede: significa "esta línea nace sin precio" (se captura después
                      // en la OC), que es lo que ya pasaba cuando no había ningún precio que usar.
                      minimo="0"
                      ancho="w-24"
                      {...(r.precioUnitario === null ? { marcador: 'varios' } : {})}
                      titulo={`Precio unitario de ${r.material}. Se aplica a todas las órdenes de este renglón y NO toca el catálogo. En blanco se usa el que resolvió el sistema; 0 deja la línea sin precio.`}
                      testid="exp-previa-precio"
                      onConfirmar={(v) =>
                        onAjustar(
                          claveDeAjuste(r.tipo, r.idMaterial, r.idTelaColor, p.idProveedor),
                          'precio',
                          v,
                        )
                      }
                    />
                    <span>
                      {formatearCantidad(r.cantidadTotal)}
                      {r.unidad === null ? '' : ` ${r.unidad}`} ·{' '}
                      <b>{formatearMoneda(r.importe)}</b>
                    </span>
                  </span>
                </div>
                {/* ⭐⭐ V1-E3u (§Post-F9.89) — EL MISMO AVISO QUE EN LA EXPLOSIÓN, aquí también.
                    Ésta es la ÚLTIMA pantalla antes de comprometer el dinero, y la cantidad que se
                    va a comprar salió de RESTAR ese número: si parte de él viene de una OC que no
                    dice de qué color era, la resta la decidió el sistema, no la orden. Es el mismo
                    criterio con el que el COLOR se enseña aquí y no sólo en la explosión. */}
                {r.cantidadEnOcSinColor > 0 ? (
                  <p className="mt-1 text-xs text-warn" data-testid="exp-previa-en-oc-sin-color">
                    ⚠ Se le restaron {formatearCantidad(r.cantidadEnOcSinColor)}
                    {r.unidad === null ? '' : ` ${r.unidad}`} que vienen de una orden de compra que
                    no dice de qué color era. El sistema se los atribuyó a este color; si en
                    realidad eran de otro tono, esto se está comprando de menos.
                  </p>
                ) : null}
                {/* ⭐ §Post-F9.86 — DE QUÉ OP ES CADA CANTIDAD. Es el dato que Daniel puso como
                    innegociable: sin él, el "qué falta" de cada OP deja de cuadrar. */}
                <ul className="mt-1 space-y-0.5 pl-4 text-xs text-muted-foreground">
                  {r.porOrden.map((l) => (
                    <li
                      key={l.idRequerimiento}
                      // 🔴 V1-E3z: una línea que no llega al mínimo guardable NO se va a escribir.
                      // Antes era invisible; ahora que la cantidad se baja DESDE AQUÍ, bajar un
                      // total puede dejar a una OP en cero y la previa tiene que decirlo en vez de
                      // prometer una línea que la generación se salta.
                      className={l.seEscribe ? undefined : 'text-warn'}
                      data-testid="exp-previa-reparto"
                      data-se-escribe={l.seEscribe ? 'si' : 'no'}
                    >
                      Orden {l.folioOrden}: {formatearCantidad(l.cantidad)}
                      {r.unidad === null ? '' : ` ${r.unidad}`} × {formatearMoneda(l.precio)} ={' '}
                      {formatearMoneda(l.importe)}
                      {l.seEscribe ? null : ' — no alcanza el mínimo: esta orden no lleva línea'}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {/* ⭐ LO QUE SE VA A OMITIR, Y POR QUÉ (§Post-F9.85). */}
      {plan.omitidos.length > 0 ? (
        <div className="rounded-lg border" data-testid="exp-previa-omitidos">
          <div className="border-b bg-muted/40 px-3 py-2 text-sm font-medium">
            No entran en esta compra ({plan.omitidos.length})
          </div>
          <ul>
            {plan.omitidos.map((o) => (
              <li
                key={o.idRequerimiento}
                // 🔴 V1-E3u: un omitido cuyo "ya está comprado" es una ELECCIÓN del sistema no se
                // lee igual que uno normal — ese renglón se queda sin comprar por ese número.
                className={`border-t px-3 py-1.5 text-xs first:border-t-0${
                  o.cantidadEnOcSinColor > 0 ? ' bg-warn-soft text-warn' : ''
                }`}
                data-testid="exp-previa-omitido"
                data-motivo={o.motivo}
                data-ambiguo={o.cantidadEnOcSinColor > 0 ? 'si' : undefined}
              >
                {o.detalle}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Un renglón de material requerido (con su neteo, diff, casilla de selección, el TOTAL ajustable
 * —el sobrante de compra de §Post-F9.86— y —V1-E3m— la asignación de proveedor PARA ESA ORDEN
 * cuando el catálogo no resolvió a quién comprarle).
 */
function RenglonRequerimiento({
  renglon,
  multiOp,
  seleccionado,
  onToggle,
  ajuste,
  onAjuste,
  puedeAsignar,
  abierto,
  guardando,
  onAbrir,
  onGuardar,
  puedeDecirColor,
  colorAbierto,
  onAbrirColor,
  onVerTodosLosColores,
}: {
  renglon: Requerimiento;
  /** ¿Hay varias OP en pantalla? Decide si se enseña el desglose por OP. */
  multiOp: boolean;
  seleccionado: boolean;
  onToggle: () => void;
  ajuste: string;
  onAjuste: (valor: string) => void;
  /** ¿Esta sesión puede asignar proveedor (`compras.administrar`)? §Post-F9.68: esconder Y bloquear. */
  puedeAsignar: boolean;
  abierto: boolean;
  guardando: boolean;
  onAbrir: () => void;
  onGuardar: (idOrden: number, idProveedor: number | null, precio: number | null) => void;
  /** ⭐⭐ V1-E4c: ¿esta sesión puede decir el color (`compras.administrar`)? Esconder Y bloquear. */
  puedeDecirColor: boolean;
  /** ⭐⭐ V1-E4c: ¿el bloque de color de ESTE renglón está abierto? */
  colorAbierto: boolean;
  onAbrirColor: () => void;
  /** Abre el diálogo con TODOS los colores (y sus precios) de una orden. */
  onVerTodosLosColores: (idOrden: number) => void;
}): React.JSX.Element {
  // ⭐ V1-E3q: comprable = queda PENDIENTE (lo que ya está en OC no se vuelve a comprar).
  const comprable = renglon.idProveedorSugerido !== null && renglon.cantidadPendiente > 0;
  // Se ofrece asignar donde hay HUECO, donde Compras ya puso algo (para corregirlo o quitarlo) y
  // —⭐ segunda vuelta de V1-E3m— donde el proveedor propuesto está DADO DE BAJA. Si el proveedor
  // viene vivo del catálogo o de Desarrollo, esta pantalla no es el lugar de cambiarlo.
  const asignadoPorCompras = renglon.origenProveedor === 'asignado-compras';
  const ofreceAsignar =
    puedeAsignar &&
    renglon.cantidadPendiente > 0 &&
    (renglon.idProveedorSugerido === null ||
      asignadoPorCompras ||
      renglon.proveedorSugeridoInactivo);
  return (
    <li
      className="flex flex-wrap items-start gap-3 border-t px-3 py-2 first:border-t-0"
      data-testid="exp-renglon"
    >
      <input
        type="checkbox"
        className="mt-1 size-4 shrink-0"
        checked={seleccionado}
        onChange={onToggle}
        disabled={!comprable}
        aria-label={`Seleccionar ${renglon.material}`}
        data-testid="exp-renglon-check"
      />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          <span className="truncate">{renglon.material}</span>
          {/* ⭐⭐ V1-E3u (§Post-F9.89): EL COLOR QUE SE PIDE. Un renglón de tela sin color todavía
              se puede comprar, pero se marca — quien reciba no va a tener con qué cruzarlo. */}
          {renglon.tipo === 'tela' ? (
            renglon.telaColor === null ? (
              <ChipEstado tono="warn" sinPunto data-testid="exp-sin-color">
                Sin color
              </ChipEstado>
            ) : (
              <ChipEstado tono="info" sinPunto data-testid="exp-color-tela">
                {renglon.telaColor}
              </ChipEstado>
            )
          ) : null}
          <DiffBadge diff={renglon.diff} />
          <GenericoBadge renglon={renglon} />
          {/* ⭐ V1-E3q — LO QUE YA ESTÁ COMPRADO SE VE EN SU FILA. */}
          {renglon.cantidadEnOc > 0 ? (
            <ChipEstado
              tono={renglon.cantidadPendiente > 0 ? 'info' : 'ok'}
              sinPunto
              data-testid="exp-en-oc-badge"
            >
              {renglon.cantidadPendiente > 0
                ? `Ya en OC: ${formatearCantidad(renglon.cantidadEnOc)}`
                : 'Ya comprado'}
            </ChipEstado>
          ) : null}
          {/* ⭐ V1-E3m: de dónde salió el proveedor. */}
          {asignadoPorCompras ? (
            <ChipEstado tono="info" sinPunto data-testid="exp-origen-compras">
              Proveedor asignado por Compras (solo esa orden)
            </ChipEstado>
          ) : null}
          {renglon.proveedorSugeridoInactivo ? (
            <ChipEstado tono="warn" sinPunto data-testid="exp-proveedor-inactivo">
              Proveedor dado de baja
            </ChipEstado>
          ) : null}
          {renglon.cambiosReceta.length > 0 ? (
            <Badge
              variant="outline"
              className="border-destructive text-[10px] text-destructive"
              data-testid="exp-renglon-desalineado"
            >
              {renglon.cambiosReceta.includes('precio-mercado') &&
              renglon.cambiosReceta.length === 1
                ? 'Cambió el precio de compra'
                : 'El modelo cambió'}
            </Badge>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground">
          Requerido {formatearCantidad(renglon.cantidadRequerida)}
          {renglon.unidad ? ` ${renglon.unidad}` : ''}
          {renglon.esGenerico ? ` · en stock ${formatearCantidad(renglon.existenciaStock)}` : ''}
          {renglon.cantidadEnOc > 0 ? ` · ya en OC ${formatearCantidad(renglon.cantidadEnOc)}` : ''}
        </p>
        {/* ⭐⭐ **§Post-F9.105 — EL AVISO QUE DICE POR QUÉ ESE NÚMERO ESTÁ INFLADO, PEGADO AL
            NÚMERO.** Daniel: *"la compra de los cierres me está dando una cantidad muchísimo mayor
            de la que necesito"* — el avío se compra por MEDIDA y arrastra encendido "se consume por
            talla", así que la longitud del cierre cuenta como cantidad.

            🔴 **Por qué NO va en la caja `exp-avisos` del pie.** Esa caja se titula «Notas de la
            explosión (precios y proveedores)», va en `text-muted-foreground` sobre `bg-muted/30` y
            vive después de todos los renglones: es un cajón de apuntes de valuación. Meter ahí un
            *"estás pidiendo 53 veces de más"* sería mostrarlo y esconderlo a la vez — exactamente el
            patrón que esta etapa vino a corregir (el aviso ya existía… dentro de un desplegable
            colapsado). Va **en la línea siguiente al requerido**, en tono de aviso, que es donde el
            ojo ya está cuando la cantidad no cuadra.

            Tono `warn` y no `destructive` a propósito: no truena nada ni bloquea la compra (§Post-
            F9.64 — avisar, nunca frenar producción legítima); lo que hace es que el número deje de
            poder leerse como si estuviera bien. Es el MISMO trato que `exp-en-oc-sin-color` de aquí
            abajo le da a su propia ambigüedad. */}
        {renglon.avisos.map((aviso) => (
          <p key={aviso} className="mt-0.5 text-xs text-warn" data-testid="exp-renglon-aviso">
            ⚠ {aviso}
          </p>
        ))}
        {/* ⭐⭐ V1-E3u (§Post-F9.89) — 🔴 CUANDO EL "YA EN OC" NO ES UN HECHO PLANO.
            Las OC anteriores a esta etapa piden la tela SIN decir el color. Al netear, esa cantidad
            hay que atribuírsela a ALGÚN color, y cuando no alcanza para todos **el orden de los
            renglones decide a quién le toca**: es una elección del sistema, no un dato de la OC.
            No se puede resolver bien —adivinar el color escribiría como HECHO una suposición
            (§Post-F9.86)— pero sí se puede NO CALLAR. Es el mismo trato que `pendientesColor` le da
            al hueco simétrico: lo que no se sabe, se dice. */}
        {renglon.cantidadEnOcSinColor > 0 ? (
          <p className="text-xs text-warn" data-testid="exp-en-oc-sin-color">
            ⚠ De ese &laquo;ya en OC&raquo;, {formatearCantidad(renglon.cantidadEnOcSinColor)}
            {renglon.unidad ? ` ${renglon.unidad}` : ''} vienen de una orden de compra que no dice
            de qué color era. El sistema se lo atribuyó a este color para no ofrecerte comprar de
            más; si en realidad era de otro tono, revísalo antes de comprar.
          </p>
        ) : null}
        {/* ⭐ §Post-F9.86 — DE QUÉ OP ES CADA CANTIDAD (sólo con varias OP en pantalla: con una
            sola sería repetir el renglón entero). */}
        {multiOp ? (
          <ul className="mt-0.5 text-xs text-muted-foreground" data-testid="exp-reparto-op">
            {renglon.porOrden.map((l) => (
              <li key={l.idRequerimiento}>
                Orden {l.folioOrden}: {formatearCantidad(l.cantidadPendiente)}
                {renglon.unidad ? ` ${renglon.unidad}` : ''} por comprar
                {l.cantidadEnOc > 0 ? ` (ya en OC ${formatearCantidad(l.cantidadEnOc)})` : ''}
              </li>
            ))}
          </ul>
        ) : null}
        {/* ⭐ V1-E3m — DESATORAR DESDE AQUÍ, solo para esa OP. */}
        {ofreceAsignar ? (
          <div className="mt-1">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs underline"
              onClick={onAbrir}
              data-testid="exp-asignar-proveedor"
              data-material={renglon.tipo === 'tela' ? renglon.idTela : renglon.idAvio}
            >
              <UserPlus className="size-3.5" aria-hidden />
              {asignadoPorCompras
                ? 'Cambiar el proveedor de esta orden'
                : renglon.proveedorSugeridoInactivo
                  ? 'Ese proveedor está de baja — asignar otro para esta orden'
                  : 'Asignar proveedor'}
            </button>
            {abierto ? (
              <FormaAsignarProveedor
                renglon={renglon}
                guardando={guardando}
                onGuardar={onGuardar}
                onCancelar={onAbrir}
              />
            ) : null}
          </div>
        ) : null}
        {/* ⭐⭐ **V1-E4c — DECIR DE QUÉ COLOR SE COMPRA, AQUÍ MISMO.**
            Daniel, 23-ago-2026: *"ya vi dónde está, pero no me gusta que sea ahí. ¿Por qué no
            poner la opción directo en el renglón de la tela?"*. La acción es la MISMA forma que
            «asignar proveedor» de dos renglones más arriba —a propósito: *"está muy rebuscado"* se
            arregla reusando lo que ya se entiende, no inventando un tercer patrón—.

            🔴 **Se ofrece SIEMPRE en las telas, no sólo cuando falta.** Hasta hoy, en cuanto se
            decía el color desaparecía el aviso y con él el único botón: corregir un color ya dicho
            no se veía por dónde. */}
        {renglon.tipo === 'tela' && puedeDecirColor ? (
          <div className="mt-1">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs underline"
              onClick={onAbrirColor}
              data-testid="exp-decir-color"
              data-material={renglon.idTela}
            >
              <Palette className="size-3.5" aria-hidden />
              {renglon.telaColor === null
                ? 'Decir de qué color se compra'
                : `Cambiar el color (${renglon.telaColor})`}
            </button>
            {colorAbierto ? (
              <FormaColorDeLaTela
                renglon={renglon}
                onCerrar={onAbrirColor}
                onVerTodosLosColores={onVerTodosLosColores}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="text-right">
        {/* ⭐ §Post-F9.86 — EL SOBRANTE DE COMPRA: el comprador puede pedir el rollo completo y el
            SERVIDOR lo reparte entre las OP (la pantalla no reparte nada, A1). Vacío = lo pendiente. */}
        {comprable ? (
          <label className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
            Comprar
            <Input
              type="number"
              // La orden de compra guarda la cantidad con DOS decimales, así que el paso es 0.01 y
              // el mínimo también: ofrecer diezmilésimas invitaría a teclear algo que el documento
              // no puede guardar (y que el servidor rechaza diciendo por qué).
              step="0.01"
              min="0.01"
              inputMode="decimal"
              className="h-8 w-28 text-right"
              placeholder={formatearCantidad(renglon.cantidadPendiente)}
              value={ajuste}
              onChange={(e) => onAjuste(e.target.value)}
              aria-label={`Cantidad total a comprar de ${renglon.material}`}
              title="En blanco se compra lo pendiente. Si compras de más (el rollo completo), el sistema lo reparte entre las órdenes. Se guarda con dos decimales."
              data-testid="exp-ajuste-cantidad"
            />
          </label>
        ) : null}
        <p className="font-medium tabular-nums" data-testid="exp-renglon-comprar">
          {formatearCantidad(renglon.cantidadPendiente)}
          {renglon.unidad ? ` ${renglon.unidad}` : ''}
        </p>
        <p className="text-xs text-muted-foreground">
          {renglon.precioSugerido === null
            ? 'sin precio'
            : `${formatearMoneda(renglon.precioSugerido)} c/u`}
        </p>
      </div>
    </li>
  );
}

/**
 * ⭐ V1-E3m (§Post-F9.82) — FORMULARIO DE «ASIGNAR PROVEEDOR» de UN material, dentro de su renglón.
 *
 * ⚠️ Lo que esta forma NO hace, y es su restricción central: **no toca el catálogo**. Daniel:
 * *"asigna un proveedor para esa OP en particular… no para siempre ni para todo"*. Con varias OP en
 * pantalla eso obliga a elegir A CUÁL: la asignación vive en la receta de UNA orden, así que si el
 * material viene de varias, se pregunta (poner "todas" sería inventar una decisión que Daniel
 * acotó explícitamente a una OP).
 */
function FormaAsignarProveedor({
  renglon,
  guardando,
  onGuardar,
  onCancelar,
}: {
  renglon: Requerimiento;
  guardando: boolean;
  onGuardar: (idOrden: number, idProveedor: number | null, precio: number | null) => void;
  onCancelar: () => void;
}): React.JSX.Element {
  const [elegido, setElegido] = useState<Proveedor | null>(null);
  // El precio se captura como TEXTO (un `<input type="number">` siempre entrega string; vacío = "que
  // lo resuelva el servidor", que NO es lo mismo que cero).
  const [precio, setPrecio] = useState('');
  const [idOrden, setIdOrden] = useState<number>(renglon.porOrden[0]?.idOrden ?? 0);
  const yaAsignado = renglon.origenProveedor === 'asignado-compras';

  function guardar(): void {
    if (elegido === null || idOrden === 0) {
      return;
    }
    const numero = precio.trim() === '' ? null : Number(precio);
    onGuardar(idOrden, elegido.id, numero !== null && Number.isFinite(numero) ? numero : null);
  }

  return (
    <div
      className="mt-2 space-y-2 rounded-md border bg-muted/30 p-2"
      data-testid="exp-forma-asignar"
    >
      <p className="text-xs text-muted-foreground">
        Solo para <b>una orden</b>: el catálogo no se modifica.
      </p>
      {renglon.porOrden.length > 1 ? (
        <label className="block text-xs text-muted-foreground">
          Orden de producción
          <SelectNativo
            className="mt-1"
            value={String(idOrden)}
            onChange={(e) => setIdOrden(Number(e.target.value))}
            data-testid="exp-asignar-orden"
          >
            {renglon.porOrden.map((l) => (
              <option key={l.idOrden} value={String(l.idOrden)}>
                Orden {l.folioOrden}
              </option>
            ))}
          </SelectNativo>
        </label>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
        <SelectorProveedor
          idSeleccionado={elegido?.id}
          nombreSeleccionado={elegido?.nombre}
          alSeleccionar={setElegido}
          testid="exp-selector-proveedor"
        />
        <Input
          type="number"
          step="0.0001"
          min="0"
          inputMode="decimal"
          placeholder="Precio (opcional)"
          value={precio}
          onChange={(e) => setPrecio(e.target.value)}
          aria-label={`Precio de compra de ${renglon.material}`}
          data-testid="exp-precio-asignar"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={elegido === null || guardando}
          onClick={guardar}
          title={elegido === null ? 'Elige primero un proveedor.' : undefined}
          data-testid="exp-guardar-proveedor"
        >
          Asignar a esta orden
        </Button>
        {yaAsignado ? (
          <Button
            size="sm"
            variant="outline"
            disabled={guardando}
            onClick={() => onGuardar(idOrden, null, null)}
            data-testid="exp-quitar-proveedor"
          >
            <X aria-hidden /> Quitar la asignación
          </Button>
        ) : null}
        <button
          type="button"
          className="text-xs underline"
          onClick={onCancelar}
          data-testid="exp-cancelar-asignar"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

/**
 * ⭐⭐ **V1-E4c — DE QUÉ COLOR SE COMPRA ESTA TELA, EN SU PROPIO RENGLÓN.**
 *
 * Daniel, 23-ago-2026, después de probar la 0.017: *"no puedo comprar las telas por color… ya vi
 * dónde está, pero no me gusta que sea ahí. **¿Por qué no poner la opción directo en el renglón de
 * la tela?**"*. Y la regla que rige toda la etapa: *"el proceso normal es llenar ahí la
 * información. Los mensajes amarillos parecieran que estamos haciendo algo mal. **Primero que dé la
 * opción de meterlo, y si no se hace, entonces que mande los mensajes en amarillo**"*.
 *
 * Por eso este bloque:
 *  • **está siempre disponible en los renglones de tela** —para decir el color Y para corregir uno
 *    ya dicho, que hasta hoy no se veía por dónde (al capturarlo desaparecía el aviso, y con él el
 *    único botón)—;
 *  • **lista TODOS los casos que el renglón abarca**, cada uno con su OP y su color de prenda,
 *    porque un renglón de la explosión puede cubrir varias OP y varios colores. 🔴 Nunca aplica
 *    "el mismo a todos" por su cuenta: escribir una suposición como si fuera un hecho es
 *    exactamente lo que §Post-F9.86 prohíbe;
 *  • y **no decide nada**: qué se puede cambiar, con qué colores y por qué no, lo dice el servidor
 *    (`puedeCambiar` / `motivoNoCambiar` / `sinMatrizColores`). Esta pantalla pregunta y pinta (A1).
 *
 * Filtra los colores de prenda a los que caen en ESTE renglón (los que hoy apuntan a
 * `renglon.idTelaColor`): el renglón «sin color» edita lo que falta, y el renglón «Grana» corrige
 * lo que ya dice Grana. Si listara todos, los dos renglones de la misma tela enseñarían la misma
 * lista y no se sabría cuál se está tocando.
 */
function FormaColorDeLaTela({
  renglon,
  onCerrar,
  onVerTodosLosColores,
}: {
  renglon: Requerimiento;
  onCerrar: () => void;
  onVerTodosLosColores: (idOrden: number) => void;
}): React.JSX.Element {
  const idTela = renglon.idTela;
  // Las OP que este renglón abarca, sin repetir y en el orden en que vienen del servidor.
  const idsOrden = [...new Set(renglon.porOrden.map((l) => l.idOrden))];
  const consultas = useColoresDeVariasOrdenes(idsOrden, true);
  const asignar = useAsignarColorTela();
  const folioDe = new Map(renglon.porOrden.map((l) => [l.idOrden, l.folioOrden]));

  /**
   * 🔴⭐⭐ **QUÉ CASOS SON DE ESTE RENGLÓN — CONGELADOS AL ABRIR, y ésa es la corrección.**
   *
   * La primera versión filtraba por el `idTelaColor` **vivo** del renglón (el de la explosión), y
   * eso rompía **el flujo principal**: al guardar, la caché de colores se actualiza al instante
   * (`setQueryData`) pero la explosión sólo se INVALIDA (viaje al servidor). En ese intervalo el
   * caso recién guardado ya no casa con el filtro y el bloque caía en la rama vacía: el único acuse
   * de recibo de un guardado correcto era **«la orden 7 ya no tiene colores en este renglón»** —
   * una frase falsa, y justo la que Daniel iba a ver al usar lo que pidió.
   *
   * Congelar los `(orden, color de prenda)` que el renglón abarcaba **al abrirse** arregla las dos
   * cosas a la vez: el caso guardado **se queda a la vista con su color nuevo** (acuse de recibo de
   * verdad) y los que faltan siguen listados para capturarlos de corrido, sin cerrar y reabrir.
   *
   * Se congela **por orden y en cuanto llega SU respuesta** (no cuando llegan todas): si una de las
   * OP falla, las demás no se quedan sin congelar — que sería volver al defecto por la puerta de al
   * lado.
   */
  const congelados = useRef(new Map<number, Set<number>>());
  idsOrden.forEach((idOrden, i) => {
    if (congelados.current.has(idOrden)) return;
    const datos = consultas[i]?.data;
    if (datos === undefined) return;
    const tela = datos.telas.find((t) => t.idTela === idTela);
    congelados.current.set(
      idOrden,
      new Set(
        (tela?.colores ?? [])
          .filter((c) => (c.idTelaColor ?? null) === renglon.idTelaColor)
          .map((c) => c.idColor),
      ),
    );
  });
  /** Los colores de prenda de ESE renglón en ESA orden (los congelados al abrir). */
  const mios = (idOrden: number, colores: readonly ColorDeLaOrden[]): ColorDeLaOrden[] => {
    const suyos = congelados.current.get(idOrden);
    return suyos === undefined ? [] : colores.filter((c) => suyos.has(c.idColor));
  };

  /** Los casos QUE ESTE RENGLÓN abarca: un (OP, color de prenda) por cada uno. */
  const casos = idsOrden.flatMap((idOrden, i) => {
    const tela = consultas[i]?.data?.telas.find((t) => t.idTela === idTela);
    return mios(idOrden, tela?.colores ?? []).map((c) => ({ idOrden, color: c }));
  });
  // Con UN solo caso se pide un dato y ya: no hace falta rotularlo con la OP ni con el color.
  const unSoloCaso = casos.length === 1;

  /**
   * ⭐⭐ **V1-E6b (§Post-F9.106) — EL CASO DESDE EL QUE SE ESTÁ DANDO DE ALTA UN COLOR.**
   *
   * Guarda los datos POR VALOR (no una referencia al caso) por dos razones: el diálogo se pinta
   * FUERA del árbol donde `idTela` está estrechado a `number`, y —más importante— el caso se va a
   * repintar en cuanto la escritura vuelva; leerlo del array a esas alturas sería leer otra cosa.
   */
  const [alta, setAlta] = useState<{
    idOrden: number;
    idTela: number;
    tela: string;
    nombreComplemento: string | null;
    idColor: number;
    colorPrenda: string;
    pantone: string | null;
  } | null>(null);

  return (
    <div className="mt-2 space-y-3 rounded-md border bg-muted/30 p-2" data-testid="exp-forma-color">
      {idTela === null ? (
        <p className="text-xs text-muted-foreground">Este renglón no es de tela.</p>
      ) : (
        idsOrden.map((idOrden, i) => {
          const consulta = consultas[i];
          const folio = folioDe.get(idOrden) ?? idOrden;
          const tela = consulta?.data?.telas.find((t) => t.idTela === idTela);
          const casosDeLaOrden = mios(idOrden, tela?.colores ?? []);
          return (
            <section key={idOrden} data-testid="exp-color-orden" data-orden={idOrden}>
              {idsOrden.length > 1 ? <h4 className="text-xs font-medium">Orden {folio}</h4> : null}
              {consulta?.isPending === true ? (
                <p className="text-xs text-muted-foreground">Cargando los colores…</p>
              ) : consulta?.isError === true ? (
                <p className="text-xs text-destructive" data-testid="exp-color-error">
                  {consulta.error.message}
                </p>
              ) : consulta?.data?.sinMatrizColores === true ? (
                /* 🔴 EL CASO QUE NO SE ARREGLA CON UN CAMPO. El amarre cuelga del color de la
                   PRENDA (`OrdenTelaColor` = orden×tela×color): sin matriz color×talla no hay
                   `idColor` del que colgarlo, así que el dato no es difícil de guardar — es
                   imposible. Ofrecer aquí un select sería justo el control muerto que esta etapa
                   vino a quitar. Se dice qué falta y dónde se captura. */
                <p className="text-xs text-warn" data-testid="exp-color-sin-matriz">
                  La orden {folio} todavía no tiene capturada su <b>matriz de color×talla</b>, así
                  que no hay ningún color de prenda al que amarrarle el color de la tela: aquí no
                  hay nada que llenar todavía. Captura los colores y las cantidades de la orden en
                  Producción › Órdenes y vuelve. Mientras tanto, esa tela se compra sin color.
                </p>
              ) : tela === undefined ? (
                <p className="text-xs text-muted-foreground" data-testid="exp-color-sin-renglon">
                  Esa tela ya no está en la receta de la orden {folio}.
                </p>
              ) : casosDeLaOrden.length === 0 ? (
                /* Ya no puede ser el acuse de un guardado (los casos se congelan al abrir): esto
                   es una orden que, al abrirse el bloque, no tenía ningún color de prenda en este
                   renglón — una explosión más vieja que la receta. */
                <p className="text-xs text-muted-foreground" data-testid="exp-color-sin-casos">
                  En la orden {folio} no hay ningún color de prenda que corresponda a este renglón.
                  La explosión pudo cambiar desde que se calculó: vuelve a explotar y reintenta.
                </p>
              ) : (
                <ul className="space-y-2">
                  {/* ⭐⭐ V1-E6b (§Post-F9.106) — con el catálogo VACÍO se dice qué falta **en tono
                      de instrucción**, no de regaño (§Post-F9.96: el amarillo es para quien ya
                      intentó avanzar). La salida está a un clic, en el desplegable de abajo. */}
                  {tela.opciones.length === 0 ? (
                    <li
                      className="text-xs text-muted-foreground"
                      data-testid="exp-color-sin-opciones-alta"
                    >
                      «{tela.tela}» todavía no tiene colores dados de alta: da de alta el que vas a
                      comprar con «＋ Nuevo color…», la última opción del desplegable.
                    </li>
                  ) : null}
                  {casosDeLaOrden.map((color) => (
                    <li
                      key={color.idColor}
                      data-testid="exp-color-caso"
                      data-orden={idOrden}
                      data-color={color.idColor}
                    >
                      <label className="block text-xs text-muted-foreground">
                        {unSoloCaso ? 'Color de la tela' : `Color «${color.color}»`}
                        <SelectNativo
                          className="mt-1"
                          value={color.idTelaColor === null ? '' : String(color.idTelaColor)}
                          disabled={!color.puedeCambiar || asignar.isPending}
                          data-testid="exp-color-select"
                          onChange={(e) => {
                            // ⭐⭐ V1-E6b — la ÚLTIMA opción no elige nada: abre el alta. El `value`
                            // sigue controlado por `color.idTelaColor`, así que si el diálogo se
                            // cancela el desplegable vuelve solo a lo que estaba (mismo trato que
                            // «＋ Nueva dirección…», §Post-F9.104).
                            if (e.target.value === OPCION_NUEVO_COLOR) {
                              setAlta({
                                idOrden,
                                idTela,
                                tela: tela.tela,
                                nombreComplemento: tela.nombreComplemento,
                                idColor: color.idColor,
                                colorPrenda: color.color,
                                pantone: color.pantone,
                              });
                              return;
                            }
                            asignar.mutate(
                              {
                                idOrden,
                                cuerpo: {
                                  idTela,
                                  idColor: color.idColor,
                                  idTelaColor:
                                    e.target.value === '' ? null : Number(e.target.value),
                                },
                              },
                              { onError: (error) => toast.error(error.message) },
                            );
                          }}
                        >
                          <option value="">— sin decir —</option>
                          {tela.opciones.map((o) => (
                            <option key={o.idTelaColor} value={o.idTelaColor}>
                              {o.nombre}
                              {o.pantone === null ? '' : ` (${o.pantone})`}
                            </option>
                          ))}
                          {/* ⭐⭐ **V1-E6b (§Post-F9.106) — «＋ Nuevo color…»: AL FINAL, SEPARADA,
                              y SIN guard propio de permiso.**

                              §Post-F9.68 (esconder Y bloquear) se cumple **una vez y arriba**: este
                              bloque entero sólo se pinta con `puedeDecirColor` —o sea
                              `compras.administrar`—, que desde el 25-ago-2026 es **el mismo permiso
                              que abre el alta**. Un segundo `if` con el mismo booleano no escondería
                              nada: sería una rama que ningún caso puede poner en `false`, y por
                              tanto que ninguna prueba puede ejercer. El BLOQUEAR de verdad lo hace
                              el servidor (`agregarColorATela` exige `compras.administrar`).

                              Va al final y separada para que no se confunda con un color real, y
                              **se pinta aunque la lista esté vacía** — que es cuando más se
                              necesita. */}
                          {tela.opciones.length > 0 ? (
                            <option disabled data-testid="exp-separador-color">
                              ──────────
                            </option>
                          ) : null}
                          <option value={OPCION_NUEVO_COLOR} data-testid="exp-alta-color">
                            ＋ Nuevo color…
                          </option>
                        </SelectNativo>
                      </label>
                      {/* La regla la REDACTA el servidor; aquí sólo se pinta (A1). */}
                      {color.motivoNoCambiar === null ? null : (
                        <p className="mt-1 text-xs text-warn" data-testid="exp-color-bloqueado">
                          {color.motivoNoCambiar}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {/* El precio del color (decisión (b) de §Post-F9.89) se corrige en la vista completa
                  de la orden: sigue viva y ahora se llega a ella desde aquí, no desde un aviso. */}
              <button
                type="button"
                className="mt-1 text-xs underline"
                onClick={() => onVerTodosLosColores(idOrden)}
                data-testid="exp-ver-colores-orden"
                data-orden={idOrden}
              >
                Ver todos los colores y precios de la orden {folio}
              </button>
            </section>
          );
        })
      )}
      {/* ⭐⭐ **V1-E6b (§Post-F9.106) — EL ALTA DEL COLOR, SIN SALIR DE LA COMPRA.** Se monta sólo
          cuando se abre (es una forma completa con react-hook-form + Zod) y viene PRECARGADA con el
          color de prenda de la OP y **el pantone que llegó de la OC del cliente**: ése es el punto
          entero de la petición de Daniel —el dato ya está en pantalla, no se teclea dos veces—.

          🔴 Al crearlo queda **ELEGIDO** para ese caso (misma escritura de siempre,
          `asignarColorTela`), que es lo que hace que la respuesta del servidor traiga la lista de
          `opciones` ya con el color nuevo dentro. Sin esto, el comprador daría de alta el color y
          tendría que volver a buscarlo — preguntar dos veces lo mismo. */}
      {alta !== null ? (
        <DialogoNuevoColorDeTela
          abierto
          alCambiarAbierto={(abierto) => {
            if (!abierto) setAlta(null);
          }}
          idTela={alta.idTela}
          tela={alta.tela}
          nombreComplemento={alta.nombreComplemento}
          nombrePrecargado={alta.colorPrenda}
          pantonePrecargado={alta.pantone}
          alCrear={(creado) => {
            asignar.mutate(
              {
                idOrden: alta.idOrden,
                cuerpo: {
                  idTela: alta.idTela,
                  idColor: alta.idColor,
                  idTelaColor: creado.id,
                },
              },
              { onError: (error) => toast.error(error.message) },
            );
          }}
        />
      ) : null}
      <button
        type="button"
        className="text-xs underline"
        onClick={onCerrar}
        data-testid="exp-cerrar-color"
      >
        Cerrar
      </button>
    </div>
  );
}

/**
 * Quita los pares `(orden, material)` repetidos conservando el orden — el espejo en pantalla de
 * `renglonesUnicos` del dominio. El tipo entra en la clave porque **la tela 7 y el avío 7 son
 * materiales distintos**. El servidor deduplica de todas formas (es quien manda, A1): esto existe
 * sólo para que el conteo del previo diga la verdad.
 */
function sinRepetir(
  pares: AsignarProveedorEnBloqueCuerpo['asignaciones'],
): AsignarProveedorEnBloqueCuerpo['asignaciones'] {
  const vistos = new Set<string>();
  return pares.filter((p) => {
    const clave = `${String(p.idOrden)}|${p.tipo}|${String(p.idMaterial)}`;
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
}

/**
 * ⭐⭐ **V1-E3x (§Post-F9.88) — EL MISMO PROVEEDOR A VARIOS RENGLONES, DE UN GOLPE.**
 *
 * Daniel, 21-ago-2026: *"cuando no tengan proveedor los avíos, ya en la pantalla de explosión,
 * podemos hacer una forma de poder poner el proveedor de manera más rápida a varios elementos que
 * lleven el mismo proveedor"*. Con seis avíos del mismo proveedor, la forma de a uno (§Post-F9.82)
 * son seis veces el mismo tecleo.
 *
 * **En bloque aquí SÍ se vale** porque *lo que se puede hacer en bloque es lo que **no compromete
 * dinero*** (§Post-F9.88): esto no compra — la OC sigue pasando por la revisión previa (§Post-F9.85)
 * y por su autorización. Por eso **liberar** la receta sigue siendo uno por uno (§Post-F9.80) y esto
 * no.
 *
 * ── ⬜ → ✅ **"QUE SUGIERA A QUIÉN AGRUPAR": NO SE SUGIERE PROVEEDOR. POR QUÉ** ────────────────
 * Daniel dejó abierto si el sistema podía **proponer** el agrupamiento *"por proveedor habitual, por
 * el más barato, por lo que se compró la vez pasada"*. Se decidió que **no**, y la razón es del
 * motor, no de presupuesto: **el habitual y el más barato YA SON escalones de la cascada** que elige
 * proveedor (`proveedor-material.ts`: amarre → habitual → más barato → asignación de Compras). Un
 * material sólo aparece en esta lista cuando **ninguno** de esos resolvió. O sea: el sistema no se
 * está callando una sugerencia que ya tiene — **no la tiene**. Proponerla sería inventarla.
 *
 * Y la tercera vía —*"lo que se compró la vez pasada"*— sería adivinar de un histórico y escribirlo
 * como HECHO en la receta congelada de la orden, que es exactamente la trampa de §Post-F9.86. El que
 * de verdad sabe *"estos seis son del mismo proveedor"* es el comprador; lo que le faltaba no era la
 * respuesta, era que decirla no costara seis formularios. Eso es lo que hace este panel:
 * **selección múltiple + un proveedor + un acto**, con «Seleccionar todos» para el caso común.
 *
 * ⚠️ Y se dice dónde se arregla PARA SIEMPRE: marcando el proveedor **habitual** del avío (o el
 * **dueño** de la tela) en el catálogo, el material deja de caer aquí — porque entonces sí hay
 * escalón que resuelva.
 */
function PanelProveedorEnBloque({
  renglones,
  ordenes,
  guardando,
  error,
  onAsignar,
}: {
  /** Los materiales SIN proveedor que siguen pendientes de comprar (los del atorón). */
  renglones: readonly Requerimiento[];
  /** Las OP que están en pantalla (para acotar el alcance del acto). */
  ordenes: readonly OrdenExplosionada[];
  guardando: boolean;
  error: string | null;
  /**
   * ⚠️ El panel **no** pinta la confirmación del éxito: la dispara la página con un `toast`. Este
   * panel se desmonta en cuanto se llenan los huecos —el caso normal del acto en bloque—, así que
   * un mensaje aquí adentro moriría con él antes de que nadie lo leyera.
   */
  onAsignar: (cuerpo: AsignarProveedorEnBloqueCuerpo) => void;
}): React.JSX.Element {
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  const [proveedor, setProveedor] = useState<Proveedor | null>(null);
  /**
   * En cuáles de las OP en pantalla se escribe. **Es una decisión del usuario, no del sistema**: la
   * de a uno pregunta a cuál orden va (§Post-F9.82: *"para esa OP en particular"*), y el acto en
   * bloque no puede inventar un "todas" que nadie eligió. El default es TODAS las de esta compra
   * porque son justo las que el comprador armó arriba, y dejar a medias las demás volvería a apagar
   * el botón de generar OC — el atorón que esto vino a quitar.
   */
  const [alcance, setAlcance] = useState<'todas' | number>('todas');

  /**
   * Los pares (orden, material) que se van a escribir: un renglón de receta cada uno.
   *
   * ⚠️ **Se quitan los repetidos AQUÍ también**, aunque el servidor los quite igual (`renglonesUnicos`,
   * quien manda). La razón no es la escritura sino **el previo**: desde §Post-F9.89 la misma tela sale
   * en VARIOS renglones —uno por color— y todos apuntan al mismo renglón de receta, así que sin esto
   * la pantalla diría *"se escribirán 2"* y el servidor escribiría 1. **Un previo que no cuadra con
   * el resultado es peor que no tener previo**, y ésta es la mitad barata de arreglarlo.
   */
  const pares: AsignarProveedorEnBloqueCuerpo['asignaciones'] = sinRepetir(
    renglones
      .filter((r) => marcados.has(r.id))
      .flatMap((r) => {
        const idMaterial = r.tipo === 'tela' ? r.idTela : r.idAvio;
        if (idMaterial === null) return [];
        return r.porOrden
          .filter((l) => alcance === 'todas' || l.idOrden === alcance)
          .map((l) => ({ idOrden: l.idOrden, tipo: r.tipo, idMaterial }));
      }),
  );
  const ordenesTocadas = new Set(pares.map((p) => p.idOrden)).size;

  function alternar(id: number): void {
    setMarcados((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(id)) siguiente.delete(id);
      else siguiente.add(id);
      return siguiente;
    });
  }

  function asignar(): void {
    if (proveedor === null || pares.length === 0) return;
    onAsignar({ asignaciones: pares, idProveedor: proveedor.id });
    // La selección se limpia sola: la explosión se recarga y esos materiales ya no estarán sin
    // proveedor. Dejarla marcada invitaría a repetir el acto sobre renglones que ya cambiaron.
    setMarcados(new Set());
    setProveedor(null);
  }

  return (
    <div
      className="mb-4 rounded-lg border border-warn/40 bg-warn-soft/40 p-3"
      data-testid="exp-bloque"
    >
      <p className="text-sm font-medium">
        {renglones.length} material(es) sin proveedor · ponles el mismo de un golpe
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Se guarda en la receta de las órdenes que elijas —<b>nunca en el catálogo</b>—. Si a un avío
        siempre se le compra al mismo proveedor, márcalo como <b>habitual</b> en el catálogo (o
        ponle <b>dueño</b> a la tela) y dejará de aparecer aquí.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <button
          type="button"
          className="underline"
          onClick={() => setMarcados(new Set(renglones.map((r) => r.id)))}
          data-testid="exp-bloque-todos"
        >
          Seleccionar todos
        </button>
        <button
          type="button"
          className="underline"
          onClick={() => setMarcados(new Set())}
          data-testid="exp-bloque-ninguno"
        >
          Quitar selección
        </button>
      </div>

      <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto" data-testid="exp-bloque-lista">
        {renglones.map((r) => (
          <li key={r.id} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-4 shrink-0"
              checked={marcados.has(r.id)}
              onChange={() => alternar(r.id)}
              aria-label={`Incluir ${r.material} en la asignación en bloque`}
              data-testid="exp-bloque-check"
              data-renglon={r.id}
            />
            <span className="min-w-0">
              <span className="font-medium">{r.material}</span>
              <span className="ml-1 text-xs text-muted-foreground">
                {formatearCantidad(r.cantidadPendiente)}
                {r.unidad ? ` ${r.unidad}` : ''}
                {ordenes.length > 1
                  ? ` · orden(es) ${r.porOrden.map((l) => l.folioOrden).join(', ')}`
                  : ''}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
        {ordenes.length > 1 ? (
          <label className="block text-xs text-muted-foreground sm:col-span-2">
            ¿En qué órdenes se guarda?
            <SelectNativo
              className="mt-1"
              value={alcance === 'todas' ? 'todas' : String(alcance)}
              onChange={(e) =>
                setAlcance(e.target.value === 'todas' ? 'todas' : Number(e.target.value))
              }
              data-testid="exp-bloque-alcance"
            >
              <option value="todas">Todas las órdenes de esta compra ({ordenes.length})</option>
              {ordenes.map((o) => (
                <option key={o.idOrden} value={String(o.idOrden)}>
                  Sólo la orden {o.folio}
                </option>
              ))}
            </SelectNativo>
          </label>
        ) : null}
        <SelectorProveedor
          idSeleccionado={proveedor?.id}
          nombreSeleccionado={proveedor?.nombre}
          alSeleccionar={setProveedor}
          testid="exp-bloque-proveedor"
        />
        <Button
          size="sm"
          disabled={proveedor === null || pares.length === 0 || guardando}
          onClick={asignar}
          title={
            proveedor === null
              ? 'Elige primero un proveedor.'
              : pares.length === 0
                ? 'Marca al menos un material que esté en la(s) orden(es) elegida(s).'
                : undefined
          }
          data-testid="exp-bloque-asignar"
        >
          <UserPlus aria-hidden />
          Asignar a los {marcados.size} seleccionados
        </Button>
      </div>

      {/* Lo que va a pasar, ANTES de que pase: cuántos renglones de receta y en cuántas órdenes. */}
      {pares.length > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="exp-bloque-previo">
          Se escribirán {pares.length} renglón(es) de receta en {ordenesTocadas} orden(es). Es todo
          o nada: si alguno no se puede, no se asigna ninguno y se dice cuál.
        </p>
      ) : null}

      {error !== null ? (
        <p className="mt-2 text-sm text-destructive" data-testid="exp-bloque-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Cantidad con hasta 4 decimales (formato es-MX). */
function formatearCantidad(valor: number): string {
  return valor.toLocaleString('es-MX', { maximumFractionDigits: 4 });
}

/** Etiqueta del diff contra el snapshot previo (solo cuando hay cambio). */
function DiffBadge({ diff }: { diff: Requerimiento['diff'] }): React.JSX.Element | null {
  if (diff === 'sin-cambio') {
    return null;
  }
  const etiqueta =
    diff === 'nuevo' ? 'Nuevo' : diff === 'eliminado' ? 'Retirado' : 'Cantidad cambiada';
  return (
    <ChipEstado tono="warn" sinPunto data-testid="exp-diff-badge">
      {etiqueta}
    </ChipEstado>
  );
}

/** Etiqueta del estado de un genérico tras netear (decisión d). */
function GenericoBadge({ renglon }: { renglon: Requerimiento }): React.JSX.Element | null {
  if (!renglon.esGenerico) {
    return null;
  }
  const cubierto = renglon.estadoGenerico === 'cubierto-por-stock';
  return (
    <ChipEstado tono={cubierto ? 'ok' : 'info'} sinPunto data-testid="exp-generico-badge">
      {cubierto ? 'Cubierto por stock' : 'Genérico · faltante'}
    </ChipEstado>
  );
}
