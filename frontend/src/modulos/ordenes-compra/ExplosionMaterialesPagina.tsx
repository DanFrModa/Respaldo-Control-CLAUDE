import {
  ArrowLeft,
  ClipboardCheck,
  Info,
  LockOpen,
  Palette,
  Plus,
  Printer,
  ShoppingCart,
  UserPlus,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useDireccionesEntregaActivas } from '@/api/direcciones-entrega';
import {
  useAsignarProveedor,
  useAsignarProveedorEnBloque,
  useExplosion,
  useGenerarOc,
  useOrdenesDelPedido,
  usePrevioCompra,
  imprimirExplosion,
} from '@/api/mrp';
import { useConsultaOrdenes } from '@/api/ordenes-consulta';
import { DialogoColoresDeTela } from './DialogoColoresDeTela';
import type {
  AsignarProveedorEnBloqueCuerpo,
  AsignarProveedorEnBloqueResultado,
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
  /** ⭐⭐ La REVISIÓN PREVIA en pantalla (null = todavía estamos en la explosión). */
  const [plan, setPlan] = useState<PlanCompra | null>(null);
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
  /** Renglón cuyo formulario de «asignar proveedor» está abierto (uno a la vez). */
  const [asignandoId, setAsignandoId] = useState<number | null>(null);
  const puedeAsignarProveedor = puedeComprar;

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
    if (hermanas.length > 0) setIdsOrden(hermanas);
  }, [delPedido.data, idOrdenBase]);

  /**
   * §Post-F9.18: toda OC nace con fecha de entrega y dirección del catálogo, incluidas las que
   * genera esta pantalla. Se piden AQUÍ para que el servidor nunca tenga que adivinarlas: si se
   * dejan en blanco, el dominio cae a la fecha de entrega más próxima de las OP y a la dirección
   * favorita, y si tampoco existen, dice qué falta.
   */
  const [fechaEntrega, setFechaEntrega] = useState('');
  const direcciones = useDireccionesEntregaActivas();
  const listaDirecciones = direcciones.data?.datos ?? [];
  const [idDireccionEntrega, setIdDireccionEntrega] = useState<number | null>(null);
  const direccionEfectiva =
    idDireccionEntrega ?? listaDirecciones.find((d) => d.favorita)?.id ?? null;
  /**
   * §Post-F9.16 — NO ESCONDER, EXPLICAR (y ofrecer el camino). Sin dirección de entrega el dominio
   * RECHAZA la generación (`generarOCDesdeExplosion`), y el catálogo nace VACÍO: el botón se veía
   * habilitado y el error llegaba del servidor, sin decir a dónde ir. Se dice qué falta y se enlaza
   * el catálogo. `null` = no hay nada que avisar.
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
              texto:
                'El catálogo de direcciones de entrega está vacío, y toda orden de compra necesita una.',
              bloquea: true,
              enlace: true,
            }
          : {
              texto:
                'Ninguna dirección está marcada como favorita: elige una arriba (o marca la de siempre en el catálogo).',
              bloquea: true,
              enlace: true,
            };

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
    setPlan(null);
    generar.reset();
    previo.reset();
  }

  /** Agrega una OP suelta al conjunto (el caso de las cajas, que cruzan pedidos). */
  function agregarOrden(id: number): void {
    setIdsOrden((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setSeleccion(new Set());
    setAjustes({});
    setPlan(null);
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
    setPlan(null);
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
    const color = r.idTelaColor == null ? 'sin' : String(r.idTelaColor);
    return `${r.tipo}-${String(idMaterial)}|${color}|${String(r.idProveedorSugerido)}`;
  }

  /** El cuerpo que va al servidor, IDÉNTICO en la revisión previa y en la generación. */
  function cuerpoDeCompra(): GenerarOcCuerpo {
    // Sólo viajan las fechas TOCADAS: las demás las resuelve el servidor con la de arriba o, si
    // tampoco hay, con la entrega más próxima de las OP. (Vaciar la fecha de un grupo BORRA su
    // entrada, así que aquí nunca hay cadenas vacías: ver `cambiarFechaDe`.)
    const fechasPorProveedor = Object.entries(fechasProveedor).map(([id, fecha]) => ({
      idProveedor: Number(id),
      fechaEntrega: fecha,
    }));
    const listaAjustes = Object.entries(ajustes)
      .map(([clave, valor]) => {
        const [material, color, proveedor] = clave.split('|');
        const guion = (material ?? '').indexOf('-');
        const tipo = (material ?? '').slice(0, guion);
        const cantidadTotal = Number(valor);
        return {
          tipo: tipo === 'tela' ? ('tela' as const) : ('avio' as const),
          idMaterial: Number((material ?? '').slice(guion + 1)),
          // ⭐⭐ V1-E3u: el ajuste es POR COLOR (§Post-F9.89). Cualquier cosa que no sea un id
          // legible vuelve a "sin color": es mejor mandar el renglón sin color —que el servidor
          // entiende— que un `NaN` que rechazaría la compra entera.
          idTelaColor: Number.isFinite(Number(color)) ? Number(color) : null,
          idProveedor: Number(proveedor),
          cantidadTotal,
        };
      })
      // Un campo vacío o con basura NO es un ajuste: se descarta y manda lo que el sistema propuso.
      // Enviarlo como 0 le diría al servidor "no compres nada de esto", que es otra cosa.
      .filter((a) => Number.isFinite(a.cantidadTotal) && a.cantidadTotal > 0);
    return {
      idsOrden,
      idsRequerimiento: [...seleccion],
      ...(fechaEntrega === '' ? {} : { fechaEntrega }),
      ...(direccionEfectiva === null ? {} : { idDireccionEntrega: direccionEfectiva }),
      ...(fechasPorProveedor.length === 0 ? {} : { fechasPorProveedor }),
      ...(listaAjustes.length === 0 ? {} : { ajustes: listaAjustes }),
    };
  }

  /** ⭐⭐ Paso previo: pide al servidor el plan y lo enseña (§Post-F9.85). NO crea nada. */
  function revisar(): void {
    if (idsOrden.length === 0) return;
    generar.reset();
    previo.mutate(cuerpoDeCompra(), { onSuccess: (datos) => setPlan(datos) });
  }

  /** Confirma: genera las OC. El servidor VUELVE a planear — la pantalla nunca es la autoridad. */
  function confirmarGeneracion(): void {
    if (idsOrden.length === 0) return;
    generar.mutate(cuerpoDeCompra(), {
      onSuccess: () => {
        setSeleccion(new Set());
        setAjustes({});
        setPlan(null);
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
   * ⭐ V1-E3m — **EL BOTÓN APAGADO TIENE QUE DECIR QUÉ LE FALTA.** Daniel se quedó mirando un
   * «Generar OC» muerto sin una sola pista de por qué (*"no me deja hacer nada"*). Ahora se nombra
   * la causa y, cuando son materiales sin proveedor, se nombran LOS MATERIALES.
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
            generando={generar.isPending}
            error={generar.isError ? generar.error.message : null}
            onVolver={() => setPlan(null)}
            onConfirmar={confirmarGeneracion}
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
                        En blanco, el servidor usa la entrega más próxima de las OP y la dirección
                        favorita. §Post-F9.71: esta fecha es el VALOR INICIAL de todas; cada
                        proveedor puede llevar la suya en su propio grupo. */}
                    <label className="text-xs text-muted-foreground">
                      Entrega (inicial)
                      <Input
                        className="mt-1"
                        type="date"
                        value={fechaEntrega}
                        onChange={(e) => setFechaEntrega(e.target.value)}
                        title="Valor inicial de todas las OC; cada proveedor puede llevar su propia fecha."
                        data-testid="exp-fecha-entrega"
                      />
                    </label>
                    <label className="text-xs text-muted-foreground">
                      Entregar en
                      <SelectNativo
                        className="mt-1"
                        value={direccionEfectiva === null ? '' : String(direccionEfectiva)}
                        onChange={(e) =>
                          setIdDireccionEntrega(
                            e.target.value === '' ? null : Number(e.target.value),
                          )
                        }
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
                      </SelectNativo>
                    </label>
                    {/* ⭐⭐ §Post-F9.85 — YA NO GENERA DE UN CLIC: manda a la REVISIÓN PREVIA.
                     *"Una revisión previa es indispensable"* (Daniel). */}
                    {puedeComprar ? (
                      <Button
                        size="sm"
                        onClick={revisar}
                        disabled={
                          previo.isPending ||
                          comprables.length === 0 ||
                          (avisoDireccion?.bloquea ?? false)
                        }
                        // V1-E3m: el botón apagado dice por qué, también al pasar el ratón.
                        title={motivoSinOc ?? undefined}
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

                {/* El "por qué no se puede" va a la vista, con el enlace al catálogo (§Post-F9.16). */}
                {avisoDireccion !== null ? (
                  <p
                    className="mb-3 rounded-md border border-warn/30 bg-warn-soft p-2 text-xs text-warn"
                    data-testid="exp-falta-direccion"
                  >
                    {avisoDireccion.bloquea ? <b>No se pueden generar las OC todavía: </b> : null}
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

                {/* ⭐ V1-E3m (§Post-F9.82) — POR QUÉ NO SE PUEDE GENERAR LA OC, con los nombres. */}
                {motivoSinOc !== null ? (
                  <p
                    className="mb-3 rounded-md border border-warn/30 bg-warn-soft p-2 text-xs text-warn"
                    data-testid="exp-motivo-sin-oc"
                  >
                    <b>No se pueden generar OC todavía: </b>
                    {motivoSinOc}
                  </p>
                ) : null}

                {sinProveedor.length > 0 && comprables.length > 0 ? (
                  <p
                    className="mb-3 rounded-md border border-warn/30 bg-warn-soft p-2 text-xs text-warn"
                    data-testid="exp-parcial-sin-proveedor"
                  >
                    Ojo: {sinProveedor.length} material(es) se van a quedar FUERA de las OC porque
                    no tienen proveedor — {sinProveedor.map((r) => r.material).join(', ')}.
                  </p>
                ) : null}

                {/* ⭐ V1-E3q (§Post-F9.85) — LO QUE YA SE COMPRÓ, DICHO CON LETRAS. */}
                {yaEnOc.length > 0 ? (
                  <p
                    className="mb-3 rounded-md border border-ok/30 bg-ok-soft p-2 text-xs text-ok"
                    data-testid="exp-ya-en-oc"
                  >
                    {yaEnOc.length} material(es) ya están cubiertos por órdenes de compra vivas y{' '}
                    <b>no se vuelven a proponer</b> — {yaEnOc.map((r) => r.material).join(', ')}. Si
                    una de esas OC se cancela, vuelven a aparecer como pendientes.
                  </p>
                ) : null}

                {comprables.length > 0 ? (
                  <div
                    className="mb-3 flex items-center gap-2 rounded-md border border-info/30 bg-info-soft px-3 py-2 text-xs text-info"
                    data-testid="exp-banner-faltantes"
                  >
                    <Info className="size-4 shrink-0" aria-hidden />
                    <span>
                      <b>{comprables.length}</b> material(es) por comprar — selecciónalos y revisa
                      las OC antes de generarlas (una por proveedor).
                    </span>
                  </div>
                ) : null}

                {/* ⭐ V1-E3h — QUÉ NO ESTÁ AQUÍ Y POR QUÉ. */}
                {(datos?.pendientesLiberar ?? []).length > 0 ? (
                  <div
                    className="mb-3 rounded-md border border-warn/30 bg-warn-soft p-2 text-xs text-warn"
                    data-testid="exp-pendientes-liberar"
                  >
                    <p className="flex items-center gap-1.5 font-medium">
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

                {/* ⭐⭐ V1-E3u (§Post-F9.89) — QUÉ TELAS SE VAN A COMPRAR SIN DECIR SU COLOR.
                    No frena nada (esa cantidad sigue yendo a compra, en un renglón sin color) pero
                    tampoco se calla: quien reciba no va a tener contra qué cruzar lo que llegue. */}
                {(datos?.pendientesColor ?? []).length > 0 ? (
                  <div
                    className="mb-3 rounded-md border border-warn/30 bg-warn-soft p-2 text-xs text-warn"
                    data-testid="exp-pendientes-color"
                  >
                    <p className="flex items-center gap-1.5 font-medium">
                      <Palette className="size-4 shrink-0" aria-hidden />
                      Falta decir de qué color se compra {
                        (datos?.pendientesColor ?? []).length
                      }{' '}
                      tela(s). Se compran igual, pero sin color la OC no le dice al proveedor qué
                      tono mandar ni le sirve a quien recibe.
                    </p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {/* ⭐ V1-E3u — CADA PENDIENTE ABRE **SU** ORDEN. Antes había un único enlace
                          que abría `idsOrden[0]`: con varias OP en pantalla —el caso que Daniel
                          llamó *"muy muy común"*— se leía «Orden 5560» y se aterrizaba en la 5558,
                          a decirle los colores a la orden equivocada. */}
                      {(datos?.pendientesColor ?? []).map((p, i) => (
                        <li
                          key={`${String(p.idOrden)}-${String(p.idTela)}-${String(i)}`}
                          data-testid="exp-pendiente-color"
                        >
                          <b>{p.tela}</b> — {p.colores.join(', ')} (
                          {formatearCantidad(p.cantidadRequerida)}
                          {p.unidad === null ? '' : ` ${p.unidad}`})
                          {puedeComprar ? (
                            <>
                              {' · '}
                              <button
                                type="button"
                                className="underline"
                                onClick={() => setIdOrdenColores(p.idOrden)}
                                data-testid="exp-decir-colores"
                              >
                                decir el color en la orden {p.folioOrden}
                              </button>
                            </>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {datos?.huboCambios ? (
                  <p
                    className="mb-3 rounded-md border border-warn/30 bg-warn-soft p-2 text-xs text-warn"
                    data-testid="exp-aviso-cambios"
                  >
                    El BOM cambió desde la última explosión: los renglones afectados están marcados.
                  </p>
                ) : null}

                {/* ⭐ PRIMER AVISO de §Post-F9.43(d) (V1-E3d). */}
                {(datos?.desalineacion.hayCambios ?? false) ? (
                  <div
                    className={
                      datos?.desalineacion.critico === true
                        ? 'mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive'
                        : 'mb-3 rounded-md border border-warn/30 bg-warn-soft p-2 text-xs text-warn'
                    }
                    data-testid="exp-desalineacion"
                  >
                    <p className="font-medium">
                      {datos?.desalineacion.critico === true
                        ? 'El modelo cambió DESPUÉS de que esta orden ya tiene compras — revísalo antes de seguir gastando:'
                        : 'Ojo: el modelo cambió desde que esta orden congeló su receta:'}
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

                {/* Avisos del enganche (F8-E6). Nada truena en silencio. */}
                {(datos?.avisos ?? []).length > 0 ? (
                  <div
                    className="mb-3 rounded-md border border-warn/30 bg-warn-soft p-2 text-xs text-warn"
                    data-testid="exp-avisos"
                  >
                    <p className="font-medium">Avisos de la explosión:</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {(datos?.avisos ?? []).map((aviso, i) => (
                        <li key={i} data-testid="exp-aviso">
                          {aviso}
                        </li>
                      ))}
                    </ul>
                  </div>
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
                    resultado={asignarBloque.data}
                    onAsignar={(cuerpo) => asignarBloque.mutate(cuerpo)}
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
                      ? 'Nada que comprar todavía: lo que estas órdenes llevan está pendiente de que Desarrollo lo libere (ver arriba).'
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
                                key={`${r.tipo}-${String(r.idTela ?? r.idAvio)}-${r.idTelaColor == null ? 'sin' : String(r.idTelaColor)}-${String(r.idProveedorSugerido)}`}
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
                              />
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>

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
 */
function RevisionPrevia({
  plan,
  generando,
  error,
  onVolver,
  onConfirmar,
}: {
  plan: PlanCompra;
  generando: boolean;
  error: string | null;
  onVolver: () => void;
  onConfirmar: () => void;
}): React.JSX.Element {
  const bloqueado = plan.bloqueos.length > 0;
  const sinNada = plan.proveedores.length === 0;
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
            disabled={generando || bloqueado || sinNada}
            title={
              bloqueado
                ? plan.bloqueos.join(' ')
                : sinNada
                  ? 'No hay nada que comprar con esta selección.'
                  : undefined
            }
            data-testid="exp-confirmar-generar"
          >
            {generando ? 'Generando…' : 'Confirmar y generar las OC'}
          </Button>
        </div>
      </div>

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
                  </span>
                  <span className="tabular-nums">
                    {formatearCantidad(r.cantidadTotal)}
                    {r.unidad === null ? '' : ` ${r.unidad}`} · <b>{formatearMoneda(r.importe)}</b>
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
                    <li key={l.idRequerimiento} data-testid="exp-previa-reparto">
                      Orden {l.folioOrden}: {formatearCantidad(l.cantidad)}
                      {r.unidad === null ? '' : ` ${r.unidad}`} × {formatearMoneda(l.precio)} ={' '}
                      {formatearMoneda(l.importe)}
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
  resultado,
  onAsignar,
}: {
  /** Los materiales SIN proveedor que siguen pendientes de comprar (los del atorón). */
  renglones: readonly Requerimiento[];
  /** Las OP que están en pantalla (para acotar el alcance del acto). */
  ordenes: readonly OrdenExplosionada[];
  guardando: boolean;
  error: string | null;
  resultado: AsignarProveedorEnBloqueResultado | undefined;
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

  /** Los pares (orden, material) que se van a escribir: un renglón de receta cada uno. */
  const pares: AsignarProveedorEnBloqueCuerpo['asignaciones'] = renglones
    .filter((r) => marcados.has(r.id))
    .flatMap((r) => {
      const idMaterial = r.tipo === 'tela' ? r.idTela : r.idAvio;
      if (idMaterial === null) return [];
      return r.porOrden
        .filter((l) => alcance === 'todas' || l.idOrden === alcance)
        .map((l) => ({ idOrden: l.idOrden, tipo: r.tipo, idMaterial }));
    });
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
      {resultado !== undefined ? (
        <p className="mt-2 text-sm text-ok" data-testid="exp-bloque-ok">
          Se le asignó «{resultado.proveedor}» a {resultado.renglones} renglón(es) de receta en{' '}
          {resultado.ordenes} orden(es), en un solo acto.
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
