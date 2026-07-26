import {
  BarChart3,
  Calculator,
  ChevronLeft,
  ChevronRight,
  Layers,
  Package,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Route,
  Scissors,
  Search,
  Send,
  Shirt,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useClientes } from '@/api/clientes';
import { useEmpresas } from '@/api/empresas';
import { useExpedienteOrden, useSugerenciaLiga } from '@/api/liga-orden';
import { useOrden } from '@/api/ordenes';
import { useOrdenesCentro } from '@/api/ordenes-centro';
import { imprimirOrden } from '@/api/ordenes-consulta';
import { useProveedores, useRolesProveedor } from '@/api/proveedores';
import type { Orden, OrdenCentro, OrdenesCentroQuery } from '@/api/tipos';
import { CadenaTrazabilidad, type NodoTraza } from '@/components/dominio/CadenaTrazabilidad';
import { CajonDetalle } from '@/components/dominio/CajonDetalle';
import { ComboboxBuscable } from '@/components/dominio/ComboboxBuscable';
import { ChipEstado, type TonoEstado } from '@/components/dominio/ChipEstado';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useDebounce } from '@/lib/useDebounce';
import { cn } from '@/lib/utils';
import { AvanceProduccion } from '@/modulos/produccion/AvanceProduccion';
import { PanelHabilitacionOrden } from '@/modulos/notas-salida/PanelHabilitacionOrden';
import { PanelRutaOrden } from '@/modulos/ruta-critica/PanelRutaOrden';
import { useSesion } from '@/sesion/useSesion';

import { DialogoOrden } from './DialogoOrden';
import { FotosModeloOrden } from './FotosModeloOrden';
import { PanelPreciosOrden } from './PanelPreciosOrden';
import { textoFaltantes } from './requisitos';
import { SeccionDesarrolloOrden } from './SeccionDesarrolloOrden';

/**
 * ÓRDENES DE PRODUCCIÓN — CENTRO DE COMANDO (rediseño R2, §4.2 ⭐): LA pantalla principal de la
 * operación (proto `vOrdenes`). Filtros arriba (buscador + Cliente/Maquilero/Estampador/Empresa/
 * OC-tela) + tabs de MES DE ENTREGA; tabla densa con las 13 columnas del proto (todas AGREGADAS en
 * el servidor, brecha B2); panel de detalle PERSISTENTE a la derecha con lo ESENCIAL fijo arriba
 * (encabezado + fotos + mosaicos + botón de avance) y el resto con scroll AMPLIO, empezando por la
 * matriz color×talla (ajuste jul-2026: antes la matriz iba fija y aplastaba la trazabilidad).
 *
 * Doble clic en una fila (o el botón "Registrar avance") abre el AVANCE DE PRODUCCIÓN (§4.3). La
 * captura/edición completa de la orden (F2-E3) se abre con el mosaico "Modificar" en el diálogo
 * `DialogoOrden` (antes vivía en la página `/produccion/ordenes/captura`, ya retirada). En móvil el
 * panel colapsa a un cajón deslizante.
 */

/** Meses de entrega para el selector y la columna (proto `MESES_PED`). */
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/** Renglones por página (tabla densa de operación). */
const POR_PAGINA = 50;

/** Chip de estatus derivado de la fila (proto `opEstatus`): corte 0/parcial/completo o cancelada. */
export function estatusDeFila(fila: Pick<OrdenCentro, 'estado' | 'cantOrdenada' | 'cantCortada'>): {
  tono: TonoEstado;
  texto: string;
} {
  if (fila.estado === 'cancelada') {
    return { tono: 'crit', texto: 'Cancelada' };
  }
  if (fila.cantCortada === 0) {
    return { tono: 'neutro', texto: 'Sin cortar' };
  }
  if (fila.cantOrdenada > 0 && fila.cantCortada >= fila.cantOrdenada) {
    return { tono: 'ok', texto: 'Cortada' };
  }
  return { tono: 'warn', texto: 'En proceso' };
}

/** Color de la celda "Cortada" (gris 0 / ámbar parcial / verde completa — proto). */
function claseCortada(fila: Pick<OrdenCentro, 'cantOrdenada' | 'cantCortada'>): string {
  if (fila.cantCortada === 0) return 'text-faint';
  if (fila.cantOrdenada > 0 && fila.cantCortada >= fila.cantOrdenada) return 'text-ok';
  return 'text-warn';
}

/** Lee `state.idOrden` del deep-link (buscador ⌘K u otra pantalla). */
function leerIdOrdenState(state: unknown): number | null {
  if (typeof state !== 'object' || state === null || !('idOrden' in state)) {
    return null;
  }
  const id = state.idOrden;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

/** Capitaliza el nombre corto del mes de entrega de una fila. */
function mesDeFila(fila: OrdenCentro): string {
  if (fila.mesEntrega === null) return '—';
  return MESES[fila.mesEntrega - 1] ?? '—';
}

export function CentroOrdenesPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const navigate = useNavigate();
  const location = useLocation();
  const puedeAdministrar = tienePermiso('ordenes.administrar');
  // "Nueva orden" abre el CONSTRUCTOR DE PEDIDO (R3: la OP nace del pedido) → exige TAMBIÉN
  // `pedidos.administrar` (hallazgo del reviewer: sin él, el constructor solo cosecharía 403s).
  const puedeCrearPedido = tienePermiso('pedidos.administrar');
  const puedeVerDesarrollo = tienePermiso('desarrollo.ver');
  const puedeAdministrarDesarrollo = tienePermiso('desarrollo.administrar');
  const verImportes = tienePermiso('consultas.ver-importes');
  // Habilitación/surtido de avíos (R6, §4.6): el mosaico exige `ordenes.habilitacion` (mismo permiso
  // que el endpoint) — sin él el mosaico queda deshabilitado con tooltip, no cosecha 403s.
  const puedeVerHabilitacion = tienePermiso('ordenes.habilitacion');

  // ── Filtros (todo server-side, B2) ─────────────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  // Cliente/Maquilero/Estampador: combobox con typeahead SERVER-SIDE (hay 117 clientes y >1,700
  // maquileros reales: una pagina local de 100 dejaria opciones fuera, hallazgo del reviewer).
  const [idCliente, setIdCliente] = useState<number | null>(null);
  const [idMaquilero, setIdMaquilero] = useState<number | null>(null);
  const [idEstampador, setIdEstampador] = useState<number | null>(null);
  const [textoCliente, setTextoCliente] = useState('');
  const [textoMaquilero, setTextoMaquilero] = useState('');
  const [textoEstampador, setTextoEstampador] = useState('');
  const busquedaCliente = useDebounce(textoCliente.trim(), 250);
  const busquedaMaquilero = useDebounce(textoMaquilero.trim(), 250);
  const busquedaEstampador = useDebounce(textoEstampador.trim(), 250);
  const [idEmpresa, setIdEmpresa] = useState('');
  const [ocTela, setOcTela] = useState('');
  const [mes, setMes] = useState(0); // 0 = Todos
  const [pagina, setPagina] = useState(1);

  const query: OrdenesCentroQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'folio',
    direccion: 'desc',
    incluirCanceladas: 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(idCliente !== null ? { idCliente } : {}),
    ...(idMaquilero !== null ? { idMaquilero } : {}),
    ...(idEstampador !== null ? { idEstampador } : {}),
    ...(idEmpresa !== '' ? { idEmpresa: Number(idEmpresa) } : {}),
    ...(ocTela === 'con' || ocTela === 'sin' ? { ocTela } : {}),
    ...(mes > 0 ? { mesEntrega: mes } : {}),
  };
  const consulta = useOrdenesCentro(query);
  const filas = useMemo(() => consulta.data?.datos ?? [], [consulta.data]);

  // ── Selección + deep-link ──────────────────────────────────────────────────
  const [idSeleccionada, setIdSeleccionada] = useState<number | null>(null);
  const [cajonAbierto, setCajonAbierto] = useState(false);

  // Deep-link pendiente de "aterrizar" en la lista (petición Daniel, jul-2026): además de fijar la
  // selección, la orden debe VERSE seleccionada en la lista izquierda como si se hubiera clickeado.
  const [idDeepLinkPendiente, setIdDeepLinkPendiente] = useState<number | null>(null);

  const idDeepLink = leerIdOrdenState(location.state);
  useEffect(() => {
    if (idDeepLink !== null) {
      setIdSeleccionada(idDeepLink);
      setIdDeepLinkPendiente(idDeepLink);
      // En pantallas chicas el panel vive en el cajón: sin abrirlo, el deep-link "no se ve".
      if (window.innerWidth < 1024) {
        setCajonAbierto(true);
      }
      void navigate(location.pathname, { replace: true, state: null });
    }
  }, [idDeepLink, location.pathname, navigate]);

  // Si la fila del deep-link NO está en la página visible, se pone el BUSCADOR al folio de la orden
  // y se resetean los demás filtros/página para que el listado la traiga y se pinte seleccionada
  // (con su resaltado normal). El folio sale del detalle que el panel ya carga (`useOrden`, misma
  // clave de cache: cero peticiones extra). Se aplica UNA sola vez por deep-link y el "pendiente"
  // se apaga en cuanto se resuelve: al aplicar el folio, al confirmar que la fila ya es visible,
  // si la orden FALLA (404/sin permiso/otra empresa — sin esto la query quedaría habilitada
  // refetcheando para siempre), o si el usuario TECLEA en el buscador mientras el folio viene en
  // vuelo (su escritura manda: el deep-link pendiente se cancela, ver el onChange del buscador).
  // Limitación conocida y ACEPTADA: con un deep-link a una orden CANCELADA el buscador queda con
  // el folio pero la lista sale vacía (pide `incluirCanceladas: 'false'`); el panel derecho sí
  // muestra la orden, que es lo que importa del deep-link.
  const ordenDeepLink = useOrden(idDeepLinkPendiente ?? undefined);
  useEffect(() => {
    if (idDeepLinkPendiente === null) {
      return;
    }
    if (ordenDeepLink.isError) {
      // La orden no se pudo cargar: se apaga el pendiente SIN tocar el buscador ni los filtros.
      setIdDeepLinkPendiente(null);
      return;
    }
    if (filas.some((f) => f.id === idDeepLinkPendiente)) {
      // La fila ya está visible: nada que traer.
      setIdDeepLinkPendiente(null);
      return;
    }
    const folio = ordenDeepLink.data?.folio;
    if (folio === undefined || consulta.isPending) {
      // Aún no se conoce el folio (o la lista sigue cargando): se decide cuando lleguen.
      return;
    }
    setTextoBusqueda(String(folio));
    setIdCliente(null);
    setIdMaquilero(null);
    setIdEstampador(null);
    setTextoCliente('');
    setTextoMaquilero('');
    setTextoEstampador('');
    setIdEmpresa('');
    setOcTela('');
    setMes(0);
    setPagina(1);
    setIdDeepLinkPendiente(null);
  }, [idDeepLinkPendiente, filas, ordenDeepLink.data, ordenDeepLink.isError, consulta.isPending]);

  // Default: la primera fila de la página (panel persistente nunca vacío). La selección de un
  // deep-link se conserva aunque no esté en la página visible: el panel carga la orden directo.
  // Con un deep-link EN CURSO (`idDeepLink` aún en el location.state) NO se aplica el default:
  // en el primer render ambos efectos corren en el mismo flush y este pisaría la selección del
  // deep-link con la primera fila (carrera cazada por la prueba del deep-link).
  useEffect(() => {
    if (idSeleccionada === null && idDeepLink === null && filas.length > 0) {
      setIdSeleccionada(filas[0]?.id ?? null);
    }
  }, [filas, idSeleccionada, idDeepLink]);

  const filaSeleccionada = filas.find((f) => f.id === idSeleccionada);

  // ── Avance de producción (doble clic / botón) ──────────────────────────────
  const [avanceDe, setAvanceDe] = useState<{ id: number; folioPedido: number | null } | null>(null);
  // ── Editar la orden (mosaico "Modificar" → diálogo, antes página `/captura`) ─
  const [idAModificar, setIdAModificar] = useState<number | null>(null);

  function abrirAvance(fila: { id: number; folioPedido: number | null }): void {
    setAvanceDe({ id: fila.id, folioPedido: fila.folioPedido });
  }

  function alClicFila(fila: OrdenCentro): void {
    setIdSeleccionada(fila.id);
    // En pantallas chicas el panel vive en un cajón deslizante.
    if (window.innerWidth < 1024) {
      setCajonAbierto(true);
    }
  }

  // ── Navegación de la lista con las flechas del teclado (↑/↓) ────────────────
  // La selección sigue el MISMO camino que un clic (`idSeleccionada` es la única fuente de verdad):
  // las flechas solo mueven el índice dentro de `filas`, con clamp (sin envolver). Se guardan refs
  // a los renglones (escritorio) y a las tarjetas (móvil) para llevar el foco y desplazar la vista
  // al seleccionado. Se IGNORAN las flechas cuando el foco está en un control de texto (buscador,
  // combobox, selects) para no romper la captura.
  const refsFilaEscritorio = useRef(new Map<number, HTMLElement | null>());
  const refsFilaMovil = useRef(new Map<number, HTMLElement | null>());

  function enfocarFila(id: number): void {
    const mapa = window.innerWidth < 1024 ? refsFilaMovil : refsFilaEscritorio;
    const el = mapa.current.get(id);
    if (el === null || el === undefined) {
      return;
    }
    el.focus({ preventScroll: true });
    // jsdom no implementa `scrollIntoView`: se protege para no truncar las pruebas.
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }

  useEffect(() => {
    function alTecla(evento: KeyboardEvent): void {
      if (evento.key !== 'ArrowDown' && evento.key !== 'ArrowUp') {
        return;
      }
      // No actuar si hay un diálogo/sheet/overlay abierto (AvanceProduccion, DialogoOrden,
      // DialogoCancelarOrden, DialogoCopiarMatriz, cajón móvil…): si no, con el foco en un botón del
      // modal (no-input) la flecha cambiaría EN SILENCIO la orden del fondo. Radix marca sus
      // overlays con `role="dialog"` + `data-state="open"`. Se aborta SIN preventDefault: (a) si el
      // foco vive dentro de un diálogo, y (b) si existe cualquier diálogo abierto en el DOM (cubre
      // overlays de Radix que puedan no tener el foco).
      if (document.activeElement?.closest('[role="dialog"]') != null) {
        return;
      }
      if (document.querySelector('[role="dialog"][data-state="open"]') !== null) {
        return;
      }
      // No secuestrar las flechas si se está escribiendo en un campo (buscador/combobox/selects).
      const etiqueta = document.activeElement?.tagName;
      if (etiqueta === 'INPUT' || etiqueta === 'TEXTAREA' || etiqueta === 'SELECT') {
        return;
      }
      if (filas.length === 0) {
        return;
      }
      evento.preventDefault();
      const indiceActual = filas.findIndex((f) => f.id === idSeleccionada);
      // Sin selección previa (p. ej. deep-link fuera de la página): la primera flecha ancla arriba.
      const siguiente =
        indiceActual === -1
          ? 0
          : evento.key === 'ArrowDown'
            ? Math.min(filas.length - 1, indiceActual + 1)
            : Math.max(0, indiceActual - 1);
      const objetivo = filas[siguiente];
      if (objetivo === undefined) {
        return;
      }
      setIdSeleccionada(objetivo.id);
      enfocarFila(objetivo.id);
    }
    window.addEventListener('keydown', alTecla);
    return () => window.removeEventListener('keydown', alTecla);
  }, [filas, idSeleccionada]);

  // ── Catálogos de los filtros (typeahead server-side: `busqueda` va al API) ──
  const clientes = useClientes({
    pagina: 1,
    porPagina: 100,
    ...(busquedaCliente === '' ? {} : { busqueda: busquedaCliente }),
  });
  const empresas = useEmpresas();
  // La columna "Emp." pinta el IDENTIFICADOR corto de la empresa (proto: "FR"/"MF"), el mismo que
  // usan los folios/impresos; si la empresa no lo tiene capturado se cae al nombre completo.
  const identificadorEmpresa = useMemo(() => {
    const porId = new Map<number, string>();
    for (const e of empresas.data ?? []) {
      porId.set(e.id, e.identificador ?? e.nombre);
    }
    return porId;
  }, [empresas.data]);
  const roles = useRolesProveedor();
  const idRolCostura = roles.data?.find((r) => r.codigo === 'maquila-costura')?.id;
  const idRolEstampado = roles.data?.find((r) => r.codigo === 'estampado')?.id;
  const idRolBordado = roles.data?.find((r) => r.codigo === 'bordado')?.id;
  const maquileros = useProveedores({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
    ...(idRolCostura === undefined ? {} : { rol: idRolCostura }),
    ...(busquedaMaquilero === '' ? {} : { busqueda: busquedaMaquilero }),
  });
  const estampadores = useProveedores({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
    ...(idRolEstampado === undefined ? {} : { rol: idRolEstampado }),
    ...(busquedaEstampador === '' ? {} : { busqueda: busquedaEstampador }),
  });
  const bordadores = useProveedores({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
    ...(idRolBordado === undefined ? {} : { rol: idRolBordado }),
    ...(busquedaEstampador === '' ? {} : { busqueda: busquedaEstampador }),
  });
  // Estampador/bordador van juntos en el filtro (aplicación); sin duplicados.
  const aplicadores = useMemo(() => {
    const vistos = new Map<number, string>();
    for (const p of [...(estampadores.data?.datos ?? []), ...(bordadores.data?.datos ?? [])]) {
      vistos.set(p.id, p.nombre);
    }
    return [...vistos.entries()].map(([id, nombre]) => ({ id, nombre }));
  }, [estampadores.data, bordadores.data]);

  const total = consulta.data?.total ?? 0;
  const totalPaginas = consulta.data?.totalPaginas ?? 1;
  const abiertas = filas.filter(
    (f) => estatusDeFila(f).texto !== 'Cortada' && f.estado !== 'cancelada',
  ).length;

  function reiniciarPagina(): void {
    setPagina(1);
  }

  const detalle =
    filaSeleccionada !== undefined || idSeleccionada !== null ? (
      <DetalleCentroOrden
        idOrden={(filaSeleccionada?.id ?? idSeleccionada) as number}
        fila={filaSeleccionada}
        puedeVerDesarrollo={puedeVerDesarrollo}
        puedeAdministrarDesarrollo={puedeAdministrarDesarrollo}
        puedeAdministrarOrden={puedeAdministrar}
        puedeVerHabilitacion={puedeVerHabilitacion}
        verImportes={verImportes}
        alRegistrarAvance={(folioPedido) =>
          abrirAvance({ id: (filaSeleccionada?.id ?? idSeleccionada) as number, folioPedido })
        }
        alModificar={(id) => {
          setIdAModificar(id);
          // En móvil el detalle vive en el cajón (Sheet portalizado, sobre el diálogo inline): se
          // cierra para que el diálogo de edición a pantalla completa quede al frente.
          setCajonAbierto(false);
        }}
      />
    ) : (
      <p className="p-4 text-sm text-muted-foreground">Selecciona una orden para ver su detalle.</p>
    );

  return (
    // Verticalmente COMPACTO arriba (ajuste jul-2026, petición de Daniel: recuperar filas visibles
    // de la tabla): menos padding vertical y menos gap SOLO en esta página (el header global de la
    // app no se toca). El padding horizontal se conserva (p-4/md:px-5).
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-4 py-2.5 md:px-5 lg:overflow-visible">
      {/* ── Encabezado de página ─────────────────────────────────────────── */}
      {/* En angosto (<sm) el título toma toda la línea y la barra de botones ENVUELVE
          debajo (flex-col); a partir de sm vuelve a la fila título-izquierda / barra-derecha.
          Título y subtítulo comparten UNA línea base (más filas de tabla, sin quitar el título). */}
      <header className="flex shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Órdenes de producción
          </h1>
          {/* Subtítulo con el conteo del proto: filas EN PANTALLA y abiertas (el total del filtro
              vive en el contador de la barra de herramientas, como en el proto). */}
          <p className="min-w-0 truncate text-xs text-muted-foreground">
            Centro de operación · {filas.length.toLocaleString('es-MX')} en pantalla ·{' '}
            {abiertas.toLocaleString('es-MX')} abiertas · filtra por OP, modelo, pedido del cliente,
            maquilero…
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void consulta.refetch()}
            data-testid="centro-actualizar"
          >
            <RefreshCw className={cn(consulta.isFetching && 'animate-spin')} aria-hidden />
            Actualizar
          </Button>
          {/* "Concentrado" (proto): la consulta general de órdenes con todos los cortes. */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void navigate('/produccion/consulta')}
            data-testid="centro-concentrado"
          >
            <BarChart3 aria-hidden />
            Concentrado
          </Button>
          {puedeAdministrar && puedeCrearPedido ? (
            // La OP no se crea suelta: nace del PEDIDO (R3, §4.1). "Nueva orden" abre el
            // constructor de pedido interno en la pantalla de Pedidos.
            <Button
              size="sm"
              onClick={() => void navigate('/pedidos', { state: { abrirConstructor: true } })}
              data-testid="centro-nueva-orden"
            >
              <Plus aria-hidden />
              Nueva orden
            </Button>
          ) : null}
        </div>
      </header>

      {/* ── Filtros (server-side) ────────────────────────────────────────── */}
      {/* Los 7 controles caben en UNA sola línea a 1440px (petición de Gabriel): el buscador
          FLEXIONA (flex-1) para llenar el hueco y encogerse cuando falta espacio, con topes
          razonables; los selects/comboboxes llevan anchos modestos. En pantallas angostas la barra
          envuelve como el resto del sistema. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-1.5">
        <div className="relative min-w-[180px] max-w-[320px] flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={textoBusqueda}
            onChange={(e) => {
              setTextoBusqueda(e.target.value);
              reiniciarPagina();
              // Si el usuario teclea mientras el folio de un deep-link viene en vuelo, SU escritura
              // manda: se cancela el pendiente para no pisarle el texto al llegar la respuesta.
              setIdDeepLinkPendiente(null);
            }}
            placeholder="Buscar OP, modelo o pedido del cliente…"
            className="h-8 pl-8 text-sm"
            aria-label="Buscar órdenes"
            data-testid="centro-busqueda"
          />
        </div>
        {/* Cliente/Maquilero/Estampador: typeahead SERVER-SIDE (alcanza todo el catálogo). */}
        <div className="w-40 [&_input]:h-8 [&_input]:text-sm">
          <ComboboxBuscable
            opciones={(clientes.data?.datos ?? []).map((c) => ({ id: c.id, nombre: c.nombre }))}
            valor={idCliente}
            onChange={(id) => {
              setIdCliente(id);
              reiniciarPagina();
            }}
            alCambiarTexto={setTextoCliente}
            cargando={clientes.isFetching}
            placeholder="Cliente"
            etiqueta="Filtrar por cliente"
            testid="centro-filtro-cliente"
          />
        </div>
        <div className="w-40 [&_input]:h-8 [&_input]:text-sm">
          <ComboboxBuscable
            opciones={(maquileros.data?.datos ?? []).map((p) => ({ id: p.id, nombre: p.nombre }))}
            valor={idMaquilero}
            onChange={(id) => {
              setIdMaquilero(id);
              reiniciarPagina();
            }}
            alCambiarTexto={setTextoMaquilero}
            cargando={maquileros.isFetching}
            placeholder="Maquilero"
            etiqueta="Filtrar por maquilero"
            testid="centro-filtro-maquilero"
          />
        </div>
        <div className="w-40 [&_input]:h-8 [&_input]:text-sm">
          <ComboboxBuscable
            opciones={aplicadores}
            valor={idEstampador}
            onChange={(id) => {
              setIdEstampador(id);
              reiniciarPagina();
            }}
            alCambiarTexto={setTextoEstampador}
            cargando={estampadores.isFetching || bordadores.isFetching}
            placeholder="Prov. de Arte"
            etiqueta="Filtrar por prov. de arte"
            testid="centro-filtro-estampador"
          />
        </div>
        {/* SelectNativo envuelve el <select> en un div w-full: SIN un ancho fijo alrededor, cada
            filtro se roba un renglón completo de la barra (visto en la foto de fidelidad R9). */}
        <SelectNativo
          className="w-32 h-8 text-sm"
          aria-label="Filtrar por empresa"
          value={idEmpresa}
          onChange={(e) => {
            setIdEmpresa(e.target.value);
            reiniciarPagina();
          }}
          // ✕ para quitar el filtro (petición Daniel: TODOS los filtros con su tachita).
          alLimpiar={() => {
            setIdEmpresa('');
            reiniciarPagina();
          }}
          data-testid="centro-filtro-empresa"
        >
          <option value="">Empresa</option>
          {(empresas.data ?? []).map((e) => (
            <option key={e.id} value={String(e.id)}>
              {e.nombre}
            </option>
          ))}
        </SelectNativo>
        <SelectNativo
          className="w-28 h-8 text-sm"
          aria-label="Filtrar por OC de tela"
          value={ocTela}
          onChange={(e) => {
            setOcTela(e.target.value);
            reiniciarPagina();
          }}
          alLimpiar={() => {
            setOcTela('');
            reiniciarPagina();
          }}
          data-testid="centro-filtro-oc"
        >
          <option value="">OC tela</option>
          <option value="con">Con OC</option>
          <option value="sin">Sin OC</option>
        </SelectNativo>
        {/* Mes de entrega: antes era una fila de tabs (`.mtab`); ahora es UN filtro más en esta
            misma línea (petición de Gabriel: todo sube y queda una sola barra de filtros). */}
        <SelectNativo
          className="w-36 h-8 text-sm"
          aria-label="Filtrar por mes de entrega"
          value={mes === 0 ? '' : String(mes)}
          onChange={(e) => {
            setMes(e.target.value === '' ? 0 : Number(e.target.value));
            reiniciarPagina();
          }}
          alLimpiar={() => {
            setMes(0);
            reiniciarPagina();
          }}
          data-testid="centro-filtro-mes"
        >
          <option value="">Mes de entrega</option>
          {MESES.map((nombre, indice) => (
            <option key={nombre} value={String(indice + 1)}>
              {nombre}
            </option>
          ))}
        </SelectNativo>
        {/* El conteo total ya vive en la paginación de abajo ("Página X de Y · N órdenes"), así que
            NO se repite aquí arriba (petición de Gabriel). */}
      </div>

      {/* ── Split: tabla (izq) + panel persistente (der) ─────────────────── */}
      {/* El detalle de la derecha es más ANCHO (420px) y el centro se angosta a lo que resta
          (petición de Daniel): la tabla iba muy ancha y el detalle apretado. */}
      <div className="grid shrink-0 gap-3 lg:min-h-0 lg:flex-1 lg:shrink lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex flex-col overflow-hidden rounded-xl border bg-card lg:min-h-0">
          <div className="overflow-auto lg:min-h-0 lg:flex-1">
            {consulta.isPending ? (
              <p className="p-6 text-sm text-muted-foreground">Cargando órdenes…</p>
            ) : consulta.isError ? (
              <div className="space-y-2 p-6">
                <p className="text-sm text-destructive" role="alert">
                  {consulta.error.message}
                </p>
                <Button variant="outline" size="sm" onClick={() => void consulta.refetch()}>
                  Reintentar
                </Button>
              </div>
            ) : filas.length === 0 ? (
              <p
                className="m-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
                data-testid="centro-vacio"
              >
                No hay órdenes que coincidan con los filtros.
              </p>
            ) : (
              <>
                {/* Móvil (<lg): tarjetas apiladas — la tabla densa de 13 columnas solo
                    cabe en escritorio. Mismo clic (selecciona → panel) y doble clic
                    (registrar avance) que la fila de la tabla. */}
                <div className="space-y-2 p-3 lg:hidden" data-testid="centro-tarjetas">
                  {filas.map((fila) => {
                    const estatus = estatusDeFila(fila);
                    return (
                      <button
                        type="button"
                        key={fila.id}
                        ref={(el) => {
                          if (el === null) {
                            refsFilaMovil.current.delete(fila.id);
                          } else {
                            refsFilaMovil.current.set(fila.id, el);
                          }
                        }}
                        onClick={() => alClicFila(fila)}
                        onDoubleClick={() => abrirAvance(fila)}
                        data-testid="centro-tarjeta"
                        className={cn(
                          'w-full rounded-lg border bg-card p-3 text-left',
                          fila.id === idSeleccionada && 'ring-2 ring-primary',
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-primary">
                              OP {fila.folio}
                              <span className="ml-2 text-xs font-normal text-muted-foreground">
                                {identificadorEmpresa.get(fila.idEmpresa) ?? fila.empresa}
                              </span>
                            </p>
                            <p className="num text-sm">{fila.codigoModelo}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <ChipEstado tono={estatus.tono}>{estatus.texto}</ChipEstado>
                            {fila.estado === 'capturada' &&
                              textoFaltantes(fila.faltantes) !== null && (
                                <span className="mt-0.5 block text-[10px] leading-tight text-warn">
                                  {textoFaltantes(fila.faltantes)}
                                </span>
                              )}
                          </div>
                        </div>
                        <p className="mt-1 truncate text-sm font-medium">{fila.cliente}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          Pedido cliente: {fila.pedidoCliente ?? '—'}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                          <span>
                            Ordenada{' '}
                            <span className="num font-semibold">
                              {fila.cantOrdenada.toLocaleString('es-MX')}
                            </span>
                          </span>
                          <span>
                            Cortada{' '}
                            <span className={cn('num font-semibold', claseCortada(fila))}>
                              {fila.cantCortada.toLocaleString('es-MX')}
                            </span>
                          </span>
                          <span>
                            OC tela{' '}
                            {fila.ocTelaFolio !== null ? (
                              <span className="num text-ok">✓ {fila.ocTelaFolio}</span>
                            ) : (
                              <span className="text-warn">falta</span>
                            )}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>Maquilero: {fila.maquilero ?? '—'}</span>
                          <span>Prov. de Arte: {fila.estampador ?? '—'}</span>
                          <span>Entrega: {mesDeFila(fila)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {/* Escritorio (≥lg): tabla densa completa. */}
                <div className="hidden lg:block">
                  <TablaDensa data-testid="centro-tabla">
                    <TablaDensaEncabezado>
                      <TablaDensaFila>
                        <TablaDensaHead>Emp.</TablaDensaHead>
                        <TablaDensaHead>OP</TablaDensaHead>
                        <TablaDensaHead>Modelo</TablaDensaHead>
                        <TablaDensaHead>Pedido cliente</TablaDensaHead>
                        <TablaDensaHead numerica>Ordenada</TablaDensaHead>
                        <TablaDensaHead numerica>Cortada</TablaDensaHead>
                        <TablaDensaHead>Maquilero</TablaDensaHead>
                        <TablaDensaHead>Prov. de Arte</TablaDensaHead>
                        <TablaDensaHead numerica>P. int.</TablaDensaHead>
                        <TablaDensaHead>OC tela</TablaDensaHead>
                        <TablaDensaHead>Entrega</TablaDensaHead>
                        <TablaDensaHead>Cliente</TablaDensaHead>
                        <TablaDensaHead>Estatus</TablaDensaHead>
                      </TablaDensaFila>
                    </TablaDensaEncabezado>
                    <TablaDensaCuerpo>
                      {filas.map((fila) => {
                        const estatus = estatusDeFila(fila);
                        return (
                          <TablaDensaFila
                            key={fila.id}
                            ref={(el) => {
                              if (el === null) {
                                refsFilaEscritorio.current.delete(fila.id);
                              } else {
                                refsFilaEscritorio.current.set(fila.id, el);
                              }
                            }}
                            tabIndex={-1}
                            seleccionada={fila.id === idSeleccionada}
                            onClick={() => alClicFila(fila)}
                            onDoubleClick={() => abrirAvance(fila)}
                            className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                            data-testid="centro-fila"
                          >
                            <TablaDensaCelda className="text-xs text-muted-foreground">
                              {identificadorEmpresa.get(fila.idEmpresa) ?? fila.empresa}
                            </TablaDensaCelda>
                            <TablaDensaCelda className="font-semibold text-primary">
                              {fila.folio}
                            </TablaDensaCelda>
                            <TablaDensaCelda className="num">{fila.codigoModelo}</TablaDensaCelda>
                            <TablaDensaCelda className="num text-xs">
                              {fila.pedidoCliente ?? '—'}
                            </TablaDensaCelda>
                            <TablaDensaCelda numerica>
                              {fila.cantOrdenada.toLocaleString('es-MX')}
                            </TablaDensaCelda>
                            <TablaDensaCelda numerica className={claseCortada(fila)}>
                              {fila.cantCortada.toLocaleString('es-MX')}
                            </TablaDensaCelda>
                            <TablaDensaCelda>
                              {fila.maquilero !== null ? (
                                <span className="inline-flex items-center gap-1.5">
                                  {fila.maquilero}
                                  {fila.numMaquileros > 1 ? (
                                    <span
                                      className="rounded-full bg-info-soft px-1.5 text-[10px] font-semibold text-info"
                                      data-testid="centro-badge-maquileros"
                                    >
                                      ×{fila.numMaquileros}
                                    </span>
                                  ) : null}
                                </span>
                              ) : (
                                <span className="text-faint">—</span>
                              )}
                            </TablaDensaCelda>
                            <TablaDensaCelda>
                              {fila.estampador ?? <span className="text-faint">—</span>}
                            </TablaDensaCelda>
                            <TablaDensaCelda numerica className="text-xs">
                              {fila.folioPedido ?? '—'}
                            </TablaDensaCelda>
                            <TablaDensaCelda>
                              {fila.ocTelaFolio !== null ? (
                                <span className="num text-ok">✓ {fila.ocTelaFolio}</span>
                              ) : (
                                <span className="text-warn">falta</span>
                              )}
                            </TablaDensaCelda>
                            <TablaDensaCelda>{mesDeFila(fila)}</TablaDensaCelda>
                            <TablaDensaCelda className="font-medium">
                              {fila.cliente}
                            </TablaDensaCelda>
                            <TablaDensaCelda>
                              <ChipEstado tono={estatus.tono}>{estatus.texto}</ChipEstado>
                              {/* Transparencia del estado automático: qué le falta para estar
                                  completa (no ocupa columna nueva; va bajo el chip). Solo si el
                                  estado guardado es `capturada` — ver `EstadoOrdenBadge`. */}
                              {fila.estado === 'capturada' &&
                                textoFaltantes(fila.faltantes) !== null && (
                                  <span className="mt-0.5 block text-[10px] leading-tight text-warn">
                                    {textoFaltantes(fila.faltantes)}
                                  </span>
                                )}
                            </TablaDensaCelda>
                          </TablaDensaFila>
                        );
                      })}
                    </TablaDensaCuerpo>
                  </TablaDensa>
                </div>
              </>
            )}
          </div>
          {/* Paginación de servidor. */}
          <div className="flex shrink-0 items-center justify-between border-t px-3 py-1.5 text-xs text-muted-foreground">
            <span>
              Página {pagina} de {totalPaginas} · {total.toLocaleString('es-MX')} órdenes
            </span>
            <span className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                disabled={pagina <= 1 || consulta.isFetching}
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
                aria-label="Página anterior"
              >
                <ChevronLeft className="size-4" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={pagina >= totalPaginas || consulta.isFetching}
                onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                aria-label="Página siguiente"
              >
                <ChevronRight className="size-4" aria-hidden />
              </Button>
            </span>
          </div>
        </div>

        {/* Panel PERSISTENTE (escritorio). */}
        <aside
          className="hidden min-h-0 overflow-hidden rounded-xl border bg-card lg:flex lg:flex-col"
          data-testid="centro-panel"
        >
          {detalle}
        </aside>
      </div>

      {/* Cajón de detalle (móvil). */}
      <CajonDetalle
        abierto={cajonAbierto}
        alCambiarAbierto={setCajonAbierto}
        titulo={filaSeleccionada !== undefined ? `OP ${filaSeleccionada.folio}` : 'Orden'}
        subtitulo={
          filaSeleccionada !== undefined
            ? `${filaSeleccionada.codigoModelo} · ${filaSeleccionada.cliente}`
            : undefined
        }
        className="lg:hidden"
      >
        {detalle}
      </CajonDetalle>

      {/* Avance de producción (doble clic / botón). */}
      {avanceDe !== null ? (
        <AvanceProduccion
          idOrden={avanceDe.id}
          folioPedido={avanceDe.folioPedido}
          alCerrar={() => setAvanceDe(null)}
        />
      ) : null}

      {/* Edición completa de la orden (mosaico "Modificar"): un solo diálogo para toda la página
          (el panel de detalle se renderiza dos veces —escritorio + cajón—, por eso se hospeda aquí). */}
      {idAModificar !== null ? (
        <DialogoOrden abierto idOrden={idAModificar} alCerrar={() => setIdAModificar(null)} />
      ) : null}
    </div>
  );
}

/** Mosaico de acceso a un módulo relacionado (proto `.opd-act`). */
function Mosaico({
  icono: Icono,
  etiqueta,
  onClick,
  deshabilitado,
  tooltip,
  testid,
}: {
  icono: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  etiqueta: string;
  onClick?: () => void;
  deshabilitado?: boolean;
  tooltip?: string;
  testid?: string;
}): React.JSX.Element {
  const boton = (
    <button
      type="button"
      onClick={onClick}
      disabled={deshabilitado}
      data-testid={testid}
      className={cn(
        // Proto `.opd-act`: 10px seminegrita, icono 17px que HEREDA el color (muted → marca al pasar).
        'flex flex-col items-center gap-[5px] rounded-[9px] border bg-panel-2 px-1 py-[9px] text-center text-[10px] font-semibold text-muted-foreground transition-colors',
        deshabilitado
          ? 'cursor-not-allowed opacity-50'
          : 'cursor-pointer hover:border-primary hover:bg-primary-soft hover:text-primary',
      )}
    >
      <Icono className="size-[17px]" aria-hidden />
      <span className="truncate">{etiqueta}</span>
    </button>
  );
  if (tooltip === undefined) {
    return boton;
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* span envolvente: los tooltips no disparan sobre botones disabled. */}
          <span className="contents">{boton}</span>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Matriz color×talla COMPACTA de solo lectura (proto `opDetalle` — totales fila/columna/general). */
export function MatrizResumen({ orden }: { orden: Orden }): React.JSX.Element {
  const tallas = useMemo(() => {
    const vistas = new Map<number, string>();
    for (const linea of orden.lineas) {
      for (const t of linea.tallas) {
        if (!vistas.has(t.idTalla)) vistas.set(t.idTalla, t.etiquetaTalla);
      }
    }
    return [...vistas.entries()].map(([idTalla, etiqueta]) => ({ idTalla, etiqueta }));
  }, [orden]);

  if (orden.lineas.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
        Esta orden aún no tiene matriz capturada.
      </p>
    );
  }

  const totalesColumna = tallas.map((t) =>
    orden.lineas.reduce(
      (s, l) => s + (l.tallas.find((x) => x.idTalla === t.idTalla)?.cantidad ?? 0),
      0,
    ),
  );

  return (
    <div className="max-h-56 overflow-auto rounded-lg border" data-testid="centro-matriz">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b bg-secondary text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
            <th className="px-2 py-1 text-left">Color</th>
            {tallas.map((t) => (
              <th key={t.idTalla} className="px-1.5 py-1 text-center">
                {t.etiqueta}
              </th>
            ))}
            <th className="px-2 py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {orden.lineas.map((linea) => (
            <tr key={linea.id} className="border-b">
              <td className="px-2 py-1 whitespace-nowrap">
                <span className="font-medium">{linea.color}</span>
                {linea.pantone !== null && linea.pantone !== '' ? (
                  <span
                    className="block text-[10px] font-normal text-muted-foreground"
                    data-testid="centro-matriz-pantone"
                  >
                    PANTONE {linea.pantone}
                  </span>
                ) : null}
              </td>
              {tallas.map((t) => {
                const cantidad = linea.tallas.find((x) => x.idTalla === t.idTalla)?.cantidad ?? 0;
                return (
                  <td
                    key={t.idTalla}
                    className={cn('num px-1.5 py-1 text-center', cantidad === 0 && 'text-faint')}
                  >
                    {cantidad}
                  </td>
                );
              })}
              <td className="num px-2 py-1 text-right font-semibold">
                {linea.totalPiezas.toLocaleString('es-MX')}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-secondary font-semibold">
            <td className="px-2 py-1 text-muted-foreground">Total</td>
            {totalesColumna.map((totalColumna, indice) => (
              <td key={tallas[indice]?.idTalla ?? indice} className="num px-1.5 py-1 text-center">
                {totalColumna}
              </td>
            ))}
            <td className="num px-2 py-1 text-right" data-testid="centro-matriz-total">
              {orden.totalPiezas.toLocaleString('es-MX')}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * Cadena de trazabilidad COMPACTA del panel (R3, §4.1): `OC cliente → Desarrollo → Lista →
 * Pedido → OP`. El nodo de desarrollo/lista se resuelve con el expediente F8-E6 (mismas claves de
 * cache que `SeccionDesarrolloOrden`: cero peticiones extra); sin `desarrollo.ver` quedan
 * apagados. Los históricos sin ficha avisan "modelo anterior al módulo de Desarrollo".
 */
function CadenaTrazaOrden({
  orden,
  fila,
  puedeVerDesarrollo,
}: {
  orden: Orden;
  fila: OrdenCentro | undefined;
  puedeVerDesarrollo: boolean;
}): React.JSX.Element {
  const navigate = useNavigate();
  const sugerencia = useSugerenciaLiga(puedeVerDesarrollo ? orden.id : undefined);
  const yaLigada = sugerencia.data?.yaLigada === true;
  const expediente = useExpedienteOrden(puedeVerDesarrollo ? orden.id : undefined, yaLigada);

  const nodos: NodoTraza[] = [
    ...(orden.ocCliente !== null
      ? [
          {
            clave: 'oc' as const,
            etiqueta: 'OC cliente',
            valor: orden.ocCliente,
            activo: true,
            titulo: 'Orden de compra original del cliente (snapshot en la OP)',
          },
        ]
      : []),
    {
      clave: 'desarrollo',
      etiqueta: 'Desarrollo',
      valor: yaLigada ? `#${expediente.data?.codigoModelo ?? orden.codigoModelo}` : '—',
      activo: yaLigada,
      ...(yaLigada
        ? { onNavegar: () => void navigate('/desarrollo', { state: { idModelo: orden.idModelo } }) }
        : {
            titulo: puedeVerDesarrollo
              ? 'modelo anterior al módulo de Desarrollo (sin liga)'
              : 'Requiere permiso de Desarrollo',
          }),
    },
    {
      clave: 'lista',
      etiqueta: 'Lista de precios',
      valor: expediente.data?.lista != null ? `#${expediente.data.lista.folioLista}` : '—',
      activo: expediente.data?.lista != null,
      ...(expediente.data?.lista != null
        ? { onNavegar: () => void navigate('/listas-precios') }
        : {}),
    },
    {
      clave: 'pedido',
      etiqueta: 'Pedido interno',
      valor: fila?.folioPedido != null ? `${fila.folioPedido}-F` : '—',
      activo: fila?.folioPedido != null,
      ...(fila?.folioPedido != null ? { onNavegar: () => void navigate('/pedidos') } : {}),
    },
    { clave: 'op', etiqueta: 'OP · producción', valor: `#${orden.folio}`, activo: true },
  ];

  return <CadenaTrazabilidad nodos={nodos} compacta />;
}

/** Campo etiqueta/valor chico del panel (proto `.field`). */
function CampoPanel({ k, children }: { k: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] font-medium text-faint">{k}</p>
      <p className="truncate text-xs font-medium">{children}</p>
    </div>
  );
}

/**
 * PANEL DE DETALLE del centro (proto `opDetalle`): SOLO lo esencial fijo arriba (encabezado +
 * FOTOS + mosaicos + botón de avance; la foto arriba fue petición de Daniel, jul-2026); abajo,
 * con scroll AMPLIO: la MATRIZ color×talla primero (movida aquí en jul-2026 para que la
 * trazabilidad y el resto no queden aplastados), trazabilidad, precios (§4.4.3), datos del
 * encabezado, tela y compra y el expediente de Desarrollo (F8-E6).
 */
function DetalleCentroOrden({
  idOrden,
  fila,
  puedeVerDesarrollo,
  puedeAdministrarDesarrollo,
  puedeAdministrarOrden,
  puedeVerHabilitacion,
  verImportes,
  alRegistrarAvance,
  alModificar,
}: {
  idOrden: number;
  fila: OrdenCentro | undefined;
  puedeVerDesarrollo: boolean;
  puedeAdministrarDesarrollo: boolean;
  puedeAdministrarOrden: boolean;
  puedeVerHabilitacion: boolean;
  verImportes: boolean;
  alRegistrarAvance: (folioPedido: number | null) => void;
  alModificar: (idOrden: number) => void;
}): React.JSX.Element {
  const navigate = useNavigate();
  const consulta = useOrden(idOrden);
  const orden = consulta.data;
  // Panel "Ruta de la orden" (R4): el mosaico lo abre aquí mismo (sin navegar), reusando el
  // MISMO componente de Mis pendientes; el detalle completo sigue en /ruta-critica/ordenes/:id.
  const [rutaAbierta, setRutaAbierta] = useState(false);
  // Panel "Avíos" (R6, §4.6): el mosaico lo abre aquí mismo (sin navegar).
  const [habAbierta, setHabAbierta] = useState(false);

  if (consulta.isPending) {
    return <p className="p-4 text-sm text-muted-foreground">Cargando detalle…</p>;
  }
  if (consulta.isError) {
    return (
      <p className="p-4 text-sm text-destructive" role="alert">
        {consulta.error.message}
      </p>
    );
  }
  if (orden === undefined) {
    return <p className="p-4 text-sm text-muted-foreground">Sin detalle.</p>;
  }

  // El chip de avance (Sin cortar/En proceso/Cortada) SOLO se deriva con la fila agregada del
  // centro. Sin fila (deep-link a una orden fuera de la página visible) NO se inventa un avance:
  // se muestra el estado REAL de la orden (Cancelada/Completa/Capturada), que sí se conoce.
  const estatus =
    fila !== undefined
      ? estatusDeFila(fila)
      : orden.estado === 'cancelada'
        ? { tono: 'crit' as TonoEstado, texto: 'Cancelada' }
        : orden.estado === 'completa'
          ? { tono: 'info' as TonoEstado, texto: 'Completa' }
          : { tono: 'neutro' as TonoEstado, texto: 'Capturada' };
  const referencia = orden.referencias[0]?.valor ?? fila?.pedidoCliente ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="centro-detalle">
      {/* ── FIJO arriba: SOLO lo esencial — encabezado + FOTOS + mosaicos + avance (Daniel) ── */}
      <div className="shrink-0 space-y-3 border-b p-3" data-testid="centro-detalle-fijo">
        <div className="flex items-center gap-3">
          {/* Héroe del proto `.opd-hero`: cuadro 46px con degradado de marca y los 3 primeros
              dígitos del modelo en mono. */}
          <span
            aria-hidden
            className="num flex size-[46px] shrink-0 items-center justify-center rounded-[11px] bg-linear-150 from-primary-bright to-primary text-sm font-bold text-white"
          >
            {orden.codigoModelo.slice(0, 3)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2">
              <span className="text-base font-bold">OP {orden.folio}</span>
              <ChipEstado tono={estatus.tono}>{estatus.texto}</ChipEstado>
              {/* De dónde sale el estado (Daniel 26-jul-2026): si le falta algo, se dice aquí
                  mismo. Solo con estado `capturada`: una completa/cancelada no "debe" requisitos y
                  "Completa · Falta: arte" se leería como una contradicción. */}
              {orden.estado === 'capturada' &&
                textoFaltantes(orden.requisitos.faltantes) !== null && (
                  <ChipEstado tono="warn">{textoFaltantes(orden.requisitos.faltantes)}</ChipEstado>
                )}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              Modelo {orden.codigoModelo} · {orden.cliente}
              {fila !== undefined ? ` · ${fila.empresa}` : ''}
            </p>
          </div>
        </div>

        {/* FOTOS de la OP ARRIBA (petición de Daniel, jul-2026): tira de miniaturas que COMBINA las
            fotos del modelo con las imágenes subidas a la orden; clic para ver grandes y navegar; con
            `ordenes.administrar` se puede subir/quitar fotos de la orden. Si no hay fotos y no se
            puede administrar, no pinta nada (sin hueco). */}
        <FotosModeloOrden
          idModelo={orden.idModelo}
          codigoModelo={orden.codigoModelo}
          idOrden={orden.id}
          puedeAdministrar={puedeAdministrarOrden}
        />

        {/* Mosaicos a módulos relacionados (los existentes NAVEGAN de verdad). */}
        <div className="grid grid-cols-4 gap-1.5" data-testid="centro-mosaicos">
          <Mosaico
            icono={Shirt}
            etiqueta="Modelo"
            onClick={() => void navigate('/modelos', { state: { idModelo: orden.idModelo } })}
            testid="mosaico-modelo"
          />
          <Mosaico
            icono={Layers}
            etiqueta="Avíos"
            // Deshabilitado bloquea el click; solo se agrega el tooltip cuando falta el permiso.
            onClick={() => setHabAbierta(true)}
            deshabilitado={!puedeVerHabilitacion}
            {...(puedeVerHabilitacion ? {} : { tooltip: 'Requiere permiso de Avíos' })}
            testid="mosaico-habilitacion"
          />
          <Mosaico
            icono={Send}
            etiqueta="Notas salida"
            onClick={() =>
              void navigate('/produccion/notas-salida/por-orden', { state: { idOrden: orden.id } })
            }
            testid="mosaico-notas"
          />
          <Mosaico
            icono={Package}
            etiqueta="O.C."
            onClick={() => void navigate('/compras/por-orden', { state: { idOrden: orden.id } })}
            testid="mosaico-oc"
          />
          <Mosaico
            icono={Route}
            etiqueta="Ruta crítica"
            onClick={() => setRutaAbierta(true)}
            testid="mosaico-rc"
          />
          <Mosaico
            icono={Calculator}
            etiqueta="Consumo tela"
            onClick={() => void navigate('/inventarios/telas/salida-orden')}
            testid="mosaico-tela"
          />
          <Mosaico
            icono={Printer}
            etiqueta="Imprimir"
            onClick={() => imprimirOrden(orden.id)}
            testid="mosaico-imprimir"
          />
          <Mosaico
            icono={Pencil}
            etiqueta="Modificar"
            onClick={() => alModificar(orden.id)}
            testid="mosaico-modificar"
          />
        </div>

        <PanelRutaOrden
          idOrden={orden.id}
          abierto={rutaAbierta}
          alCerrar={() => setRutaAbierta(false)}
          encabezado={{
            folio: orden.folio,
            modelo: orden.codigoModelo,
            cliente: orden.cliente,
            fechaEntrega: orden.fechaEntrega ?? null,
          }}
        />

        {puedeVerHabilitacion ? (
          <PanelHabilitacionOrden
            idOrden={orden.id}
            abierto={habAbierta}
            alCerrar={() => setHabAbierta(false)}
            encabezado={{ folio: orden.folio, modelo: orden.codigoModelo }}
          />
        ) : null}

        <Button
          className="w-full"
          onClick={() => alRegistrarAvance(fila?.folioPedido ?? null)}
          data-testid="centro-registrar-avance"
        >
          <Scissors aria-hidden />
          Registrar avance de producción
        </Button>
      </div>

      {/* ── Con scroll: matriz, trazabilidad, precios, encabezado, tela y compra, desarrollo ── */}
      {/* La MATRIZ abre la zona con scroll (ajuste jul-2026, petición de Daniel): antes vivía en la
          zona fija y le comía casi toda la altura al scroll — la trazabilidad y lo demás quedaban
          "aplastados en un huequito". Al abrir una orden la matriz se sigue viendo de primera, pero
          el área scrolleable ahora dispone de mucha más altura. */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <div>
          <h4 className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Cantidades por color y talla · total {orden.totalPiezas.toLocaleString('es-MX')}
          </h4>
          <MatrizResumen orden={orden} />
        </div>

        {/* Cadena de trazabilidad (R3, §4.1): OC cliente → Desarrollo → Lista → Pedido → OP. */}
        <section>
          <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Trazabilidad
          </h4>
          <CadenaTrazaOrden orden={orden} fila={fila} puedeVerDesarrollo={puedeVerDesarrollo} />
        </section>

        <section>
          <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Precios
          </h4>
          <PanelPreciosOrden idOrden={orden.id} />
        </section>

        <section>
          <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Encabezado
          </h4>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <CampoPanel k="Fecha alta">{orden.fecha ?? '—'}</CampoPanel>
            <CampoPanel k="Fecha entrega">{orden.fechaEntrega ?? '—'}</CampoPanel>
            <CampoPanel k="Pedido del cliente">{referencia ?? '—'}</CampoPanel>
            <CampoPanel k="Pedido interno">
              {fila?.folioPedido != null ? `${fila.folioPedido}-F` : '—'}
            </CampoPanel>
            <CampoPanel k="Etiqueta / marca">{orden.etiquetaMarca ?? '—'}</CampoPanel>
            <CampoPanel k="Mes de entrega">{fila !== undefined ? mesDeFila(fila) : '—'}</CampoPanel>
          </div>
          {orden.observaciones !== null && orden.observaciones !== '' ? (
            <p className="mt-2 rounded-md bg-panel-2 px-2.5 py-1.5 text-xs text-muted-foreground">
              {orden.observaciones}
            </p>
          ) : null}
        </section>

        <section>
          <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Tela y compra
          </h4>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <CampoPanel k="Tela">{orden.tela ?? '—'}</CampoPanel>
            <CampoPanel k="OC de tela">
              {/* Sin la fila agregada (deep-link fuera de la página) NO se afirma "falta": el
                  agregado de OC solo existe en la fila del centro. */}
              {fila === undefined ? (
                '—'
              ) : fila.ocTelaFolio !== null ? (
                <ChipEstado tono="ok">Comprada · OC {fila.ocTelaFolio}</ChipEstado>
              ) : (
                <ChipEstado tono="warn">Falta comprar</ChipEstado>
              )}
            </CampoPanel>
            <CampoPanel k="Maquilero">
              {fila?.maquilero ?? orden.maquilero ?? '—'}
              {fila !== undefined && fila.numMaquileros > 1 ? ` (×${fila.numMaquileros})` : ''}
            </CampoPanel>
            <CampoPanel k="Prov. de Arte">{fila?.estampador ?? '—'}</CampoPanel>
          </div>
        </section>

        {/* Expediente Desarrollo↔Producción 360 (F8-E6), re-vestido al estándar del panel. */}
        {puedeVerDesarrollo ? (
          <section>
            <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Desarrollo
            </h4>
            <SeccionDesarrolloOrden
              orden={orden}
              puedeAdministrar={puedeAdministrarDesarrollo}
              verImportes={verImportes}
            />
          </section>
        ) : null}
      </div>
    </div>
  );
}
