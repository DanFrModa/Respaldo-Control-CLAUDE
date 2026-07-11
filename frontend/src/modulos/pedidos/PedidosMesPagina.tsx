import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Route,
  Upload,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useClientes } from '@/api/clientes';
import { useEmpresas } from '@/api/empresas';
import { imprimirOrden } from '@/api/ordenes-consulta';
import { usePedidosPorMes } from '@/api/pedidos-mes';
import type { PedidoMesFila, PedidoMesRenglon, PedidosPorMesQuery } from '@/api/tipos';
import { CadenaTrazabilidad, type NodoTraza } from '@/components/dominio/CadenaTrazabilidad';
import { CajonDetalle } from '@/components/dominio/CajonDetalle';
import { ChipEstado, type TonoEstado } from '@/components/dominio/ChipEstado';
import { ChipsFiltro } from '@/components/dominio/ChipsFiltro';
import { ComboboxBuscable } from '@/components/dominio/ComboboxBuscable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useDebounce } from '@/lib/useDebounce';
import { cn } from '@/lib/utils';
import { useSesion } from '@/sesion/useSesion';

import { AdjuntosPedido } from './AdjuntosPedido';
import { ConstructorPedido } from './ConstructorPedido';
import { ImportadorPedido } from './ImportadorPedido';
import { PanelGenerarOP } from './PanelGenerarOP';

/**
 * PEDIDOS POR MES (rediseño R3, §4.1 — proto `vPedidos`): la pantalla nueva de Pedidos. Tabs
 * Ene–Dic + Todos (mes de ENTREGA del pedido) · filtros Cliente/Año/Empresa/estatus/Cantidades ·
 * TABLA AGRUPADA expandible (cabecera del pedido `-F` con el chip de la OC del cliente y sus
 * totales; debajo los renglones/modelos con Cant. · Precio · Importe · No. orden · Corte ·
 * Estatus) · BARRA DE TOTALES al pie (importes gated `pedidos.importes` — el backend ya los manda
 * en null). Click en un renglón → cajón con el detalle + "Va junto con" + cadena de trazabilidad.
 *
 * El botón "Generar OP" de cada renglón sin orden abre la SALIDA A PRODUCCIÓN (matriz + liga +
 * nº de producción + RC sola). "Nuevo pedido" abre el CONSTRUCTOR (también lo abren los botones
 * "Nueva orden" de Órdenes e Inicio vía `state.abrirConstructor` — la OP no se crea suelta). La
 * edición fina F2 (renglones/pedidos reales/copiar) se conserva en /pedidos/administrar.
 */

/** Meses de las tabs (proto `MESES_PED`). */
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/** Tab de mes (proto `.mtab`): 12.5px seminegrita, radio 8; activo = RELLENO de marca + sombra. */
const CLASE_MTAB =
  'cursor-pointer rounded-lg border px-[15px] py-[7px] text-[12.5px] font-semibold transition-colors';
const CLASE_MTAB_ON =
  'border-transparent bg-primary text-primary-foreground shadow-[0_6px_14px_-6px_color-mix(in_srgb,var(--primary)_70%,transparent)]';
const CLASE_MTAB_OFF =
  'border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground';

/** Pedidos por página. */
const POR_PAGINA = 50;

/** Formato de moneda MXN. */
const FORMATO_MONEDA = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

/** Chip de estatus del PEDIDO (cabecera agrupada). */
function chipPedido(estatus: PedidoMesFila['estatus']): { tono: TonoEstado; texto: string } {
  if (estatus === 'cancelado') return { tono: 'crit', texto: 'Cancelado' };
  if (estatus === 'entregado') return { tono: 'info', texto: 'Entregado' };
  return { tono: 'ok', texto: 'Vigente' };
}

/** Chip de estatus del RENGLÓN (derivado de orden/corte, como `estatusDeFila` del centro R2). */
export function chipRenglon(
  renglon: Pick<PedidoMesRenglon, 'numOrdenes' | 'cortado' | 'cantidad'>,
): {
  tono: TonoEstado;
  texto: string;
} {
  if (renglon.numOrdenes === 0) return { tono: 'neutro', texto: 'Sin OP' };
  if (renglon.cortado === 0) return { tono: 'neutro', texto: 'Sin cortar' };
  if (renglon.cantidad > 0 && renglon.cortado >= renglon.cantidad) {
    return { tono: 'ok', texto: 'Cortada' };
  }
  return { tono: 'warn', texto: 'En proceso' };
}

/** Vigencia corta "07-jul → 22-jul" (formato del proto) a partir de las fechas date-only. */
function vigencia(fila: Pick<PedidoMesFila, 'fechaDe' | 'fechaHasta'>): string {
  const corta = (valor: string | null): string | null => {
    if (valor === null) return null;
    const [a, m, d] = valor.split('-').map(Number);
    if (a === undefined || m === undefined || d === undefined) return null;
    const mes = new Date(a, m - 1, d)
      .toLocaleDateString('es-MX', { month: 'short' })
      .replace('.', '');
    return `${String(d).padStart(2, '0')}-${mes}`;
  };
  const de = corta(fila.fechaDe);
  const hasta = corta(fila.fechaHasta);
  if (de === null && hasta === null) return '—';
  if (de !== null && hasta !== null) return `${de} → ${hasta}`;
  return de ?? hasta ?? '—';
}

/** Lee `state.abrirConstructor` del deep-link ("Nueva orden" de Órdenes/Inicio abre AQUÍ). */
function leerAbrirConstructor(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    'abrirConstructor' in state &&
    state.abrirConstructor === true
  );
}

export function PedidosMesPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const navigate = useNavigate();
  const location = useLocation();
  const puedeAdministrar = tienePermiso('pedidos.administrar');
  const puedeCrearOp = tienePermiso('ordenes.administrar');
  const puedeVerImportes = tienePermiso('pedidos.importes');

  // ── Filtros (server-side) ──────────────────────────────────────────────────
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  // El proto abre en el MES ACTUAL (hallazgo del reviewer); "Todos" = 0 se elige con su tab.
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [idCliente, setIdCliente] = useState<number | null>(null);
  const [textoCliente, setTextoCliente] = useState('');
  const busquedaCliente = useDebounce(textoCliente.trim(), 250);
  const [idEmpresa, setIdEmpresa] = useState('');
  const [estatus, setEstatus] = useState<'vigentes' | 'entregados' | 'cancelados'>('vigentes');
  // Seg "Cantidades": Pedida muestra la cantidad pedida; Pendiente, lo que FALTA por cortar.
  const [cantidades, setCantidades] = useState<'pendiente' | 'pedida'>('pendiente');
  const [pagina, setPagina] = useState(1);

  const query: PedidosPorMesQuery = {
    pagina,
    porPagina: POR_PAGINA,
    anio,
    estatus,
    ...(mes > 0 ? { mes } : {}),
    ...(idCliente !== null ? { idCliente } : {}),
    ...(idEmpresa !== '' ? { idEmpresa: Number(idEmpresa) } : {}),
  };
  const consulta = usePedidosPorMes(query);
  const filas = useMemo(() => consulta.data?.datos ?? [], [consulta.data]);
  const totales = consulta.data?.totales;

  const clientes = useClientes({
    pagina: 1,
    porPagina: 100,
    ...(busquedaCliente === '' ? {} : { busqueda: busquedaCliente }),
  });
  const empresas = useEmpresas();

  // ── Expansión de grupos (por defecto TODOS expandidos, como el proto) ──────
  const [colapsados, setColapsados] = useState<ReadonlySet<number>>(new Set());
  function alternarGrupo(idPedido: number): void {
    setColapsados((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(idPedido)) siguiente.delete(idPedido);
      else siguiente.add(idPedido);
      return siguiente;
    });
  }

  // ── Cajón de detalle del renglón ───────────────────────────────────────────
  const [seleccion, setSeleccion] = useState<{ idPedido: number; idRenglon: number } | null>(null);
  const pedidoSeleccionado = filas.find((p) => p.id === seleccion?.idPedido);
  const renglonSeleccionado = pedidoSeleccionado?.renglones.find(
    (r) => r.id === seleccion?.idRenglon,
  );

  // ── Overlays: constructor + importador + Generar OP ────────────────────────
  const [constructorAbierto, setConstructorAbierto] = useState(false);
  const [importadorAbierto, setImportadorAbierto] = useState(false);
  const [generarOpDe, setGenerarOpDe] = useState<{
    pedido: PedidoMesFila;
    renglon: PedidoMesRenglon;
  } | null>(null);

  // Deep-link: "Nueva orden" de Órdenes/Inicio abre el constructor (la OP nace del pedido).
  // Gated con `pedidos.administrar` (hallazgo del reviewer): sin el permiso el state se consume
  // sin abrir nada (capturar pedidos exige ese permiso; el backend re-decide, A1).
  const abrirPorState = leerAbrirConstructor(location.state);
  useEffect(() => {
    if (abrirPorState) {
      if (puedeAdministrar) {
        setConstructorAbierto(true);
      }
      void navigate(location.pathname, { replace: true, state: null });
    }
  }, [abrirPorState, puedeAdministrar, location.pathname, navigate]);

  function reiniciar(): void {
    setPagina(1);
  }

  const total = consulta.data?.total ?? 0;
  const totalPaginas = consulta.data?.totalPaginas ?? 1;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 md:p-5 lg:overflow-visible">
      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      {/* En angosto (<sm) el título toma toda la línea y la barra de botones ENVUELVE
          debajo (flex-col); a partir de sm vuelve a la fila título-izquierda / barra-derecha. */}
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">Pedidos</h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Pedidos internos por mes · cada pedido agrupa varias órdenes de producción (van juntos
            en insumos y entrega)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void consulta.refetch()}
            data-testid="pedidos-actualizar"
          >
            <RefreshCw className={cn(consulta.isFetching && 'animate-spin')} aria-hidden />
            Actualizar
          </Button>
          {puedeAdministrar ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void navigate('/pedidos/administrar')}
                data-testid="pedidos-edicion-completa"
              >
                <Pencil aria-hidden />
                Edición completa
              </Button>
              {/* Importar de cliente CONFIRMA creando pedido + OPs → exige también `ordenes.administrar`
                  (el mismo gate del constructor/Generar OP). Sin ese permiso, ocultar el botón. */}
              {puedeCrearOp ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setImportadorAbierto(true)}
                  data-testid="importar-de-cliente"
                >
                  <Upload aria-hidden />
                  Importar de cliente
                </Button>
              ) : null}
              <Button
                size="sm"
                onClick={() => setConstructorAbierto(true)}
                data-testid="nuevo-pedido"
              >
                <Plus aria-hidden />
                Nuevo pedido
              </Button>
            </>
          ) : null}
        </div>
      </header>

      {/* ── Tabs de mes de entrega (proto `.mtab`: activo = relleno de marca) ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-[5px]" data-testid="pedidos-meses">
        {MESES.map((nombre, indice) => (
          <button
            key={nombre}
            type="button"
            onClick={() => {
              setMes(indice + 1);
              reiniciar();
            }}
            className={cn(CLASE_MTAB, mes === indice + 1 ? CLASE_MTAB_ON : CLASE_MTAB_OFF)}
          >
            {nombre}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setMes(0);
            reiniciar();
          }}
          className={cn(CLASE_MTAB, mes === 0 ? CLASE_MTAB_ON : CLASE_MTAB_OFF)}
          data-testid="pedidos-mes-todos"
        >
          Todos
        </button>
      </div>

      {/* ── Card: filtros + tabla agrupada + totales ────────────────────────── */}
      <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border bg-card lg:min-h-0 lg:flex-1 lg:shrink">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          <div className="w-44 [&_input]:h-8 [&_input]:text-sm">
            <ComboboxBuscable
              opciones={(clientes.data?.datos ?? []).map((c) => ({ id: c.id, nombre: c.nombre }))}
              valor={idCliente}
              onChange={(id) => {
                setIdCliente(id);
                reiniciar();
              }}
              alCambiarTexto={setTextoCliente}
              cargando={clientes.isFetching}
              placeholder="Todos los clientes"
              etiqueta="Filtrar por cliente"
              testid="pedidos-filtro-cliente"
            />
          </div>
          {/* Año LIBRE con <input type="number"> (regla del rediseño: nunca un select de años). */}
          <Input
            type="number"
            className="h-8 w-24 text-sm"
            value={anio}
            onChange={(e) => {
              const valor = Number(e.target.value);
              if (Number.isInteger(valor)) {
                setAnio(valor);
                reiniciar();
              }
            }}
            placeholder="Año"
            aria-label="Filtrar por año"
            data-testid="pedidos-filtro-anio"
          />
          {/* SelectNativo envuelve el <select> en un div w-full: sin ancho fijo alrededor se roba
              un renglón completo de la barra (visto en la foto de fidelidad R9). */}
          <SelectNativo
            className="w-44 h-8 text-sm"
            aria-label="Filtrar por empresa"
            value={idEmpresa}
            onChange={(e) => {
              setIdEmpresa(e.target.value);
              reiniciar();
            }}
            data-testid="pedidos-filtro-empresa"
          >
            <option value="">Todas las empresas</option>
            {(empresas.data ?? []).map((e) => (
              <option key={e.id} value={String(e.id)}>
                {e.nombre}
              </option>
            ))}
          </SelectNativo>
          <ChipsFiltro
            etiqueta="Filtrar por estatus"
            opciones={(['vigentes', 'entregados', 'cancelados'] as const).map((clave) => ({
              valor: clave,
              // El texto visible era `capitalize` sobre la clave: misma palabra capitalizada.
              etiqueta: clave.charAt(0).toUpperCase() + clave.slice(1),
              testid: `pedidos-estatus-${clave}`,
            }))}
            valor={estatus}
            alCambiar={(valor) => {
              setEstatus(valor);
              reiniciar();
            }}
          />
          <div className="ml-auto flex items-center gap-2">
            <div
              className="flex overflow-hidden rounded-md border text-xs"
              role="group"
              aria-label="Cantidades"
            >
              <button
                type="button"
                onClick={() => setCantidades('pendiente')}
                className={cn(
                  'cursor-pointer px-2 py-1 font-medium',
                  cantidades === 'pendiente'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted',
                )}
                data-testid="pedidos-seg-pendiente"
              >
                Pendiente
              </button>
              <button
                type="button"
                onClick={() => setCantidades('pedida')}
                className={cn(
                  'cursor-pointer px-2 py-1 font-medium',
                  cantidades === 'pedida'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted',
                )}
                data-testid="pedidos-seg-pedida"
              >
                Pedida
              </button>
            </div>
            <span className="text-[12px] text-faint">
              {total.toLocaleString('es-MX')} pedidos · {totales?.ordenes ?? 0} órdenes
            </span>
          </div>
        </div>

        {/* ── Tabla agrupada ─────────────────────────────────────────────── */}
        <div className="overflow-auto lg:min-h-0 lg:flex-1">
          {consulta.isPending ? (
            <p className="p-6 text-sm text-muted-foreground">Cargando pedidos…</p>
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
              data-testid="pedidos-vacio"
            >
              No hay pedidos que coincidan con los filtros.
            </p>
          ) : (
            <table className="w-full border-collapse text-sm" data-testid="pedidos-tabla">
              <thead className="sticky top-0 z-10 bg-secondary">
                <tr className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  <th className="px-3 py-1.5 text-left">Pedido / Modelo</th>
                  <th className="px-3 py-1.5 text-left">Cliente</th>
                  <th className="px-3 py-1.5 text-left">Vigencia</th>
                  <th className="px-3 py-1.5 text-left">No. orden</th>
                  <th className="px-3 py-1.5 text-right">
                    {cantidades === 'pendiente' ? 'Pendiente' : 'Cant.'}
                  </th>
                  {puedeVerImportes ? <th className="px-3 py-1.5 text-right">Precio</th> : null}
                  {puedeVerImportes ? <th className="px-3 py-1.5 text-right">Importe</th> : null}
                  <th className="px-3 py-1.5 text-right">Corte</th>
                  <th className="px-3 py-1.5 text-left">Estatus</th>
                </tr>
              </thead>
              {filas.map((pedido) => {
                const colapsado = colapsados.has(pedido.id);
                const chip = chipPedido(pedido.estatus);
                const cantCabecera =
                  cantidades === 'pendiente'
                    ? Math.max(0, pedido.cantidadTotal - pedido.cortadoTotal)
                    : pedido.cantidadTotal;
                return (
                  <tbody key={pedido.id} data-testid="pedidos-grupo">
                    {/* Cabecera del pedido (clic = expandir/colapsar). */}
                    <tr
                      className="cursor-pointer border-b bg-panel-2 hover:bg-muted/60"
                      onClick={() => alternarGrupo(pedido.id)}
                      data-testid="pedidos-grupo-cabecera"
                    >
                      <td className="px-3 py-[9px]">
                        <span className="flex items-center gap-2">
                          <ChevronDown
                            className={cn(
                              'size-[15px] shrink-0 text-muted-foreground transition-transform',
                              colapsado && '-rotate-90',
                            )}
                            aria-hidden
                          />
                          <b className="text-[13px] font-bold">{pedido.folio}-F</b>
                          <span className="rounded-full bg-muted px-[7px] text-[11px] font-semibold text-faint">
                            {pedido.renglones.length} mod.
                          </span>
                          {pedido.ocCliente !== null ? (
                            <span
                              className="num rounded-full border border-dashed border-primary px-[7px] text-[11px] font-semibold text-primary"
                              title="OC original del cliente"
                              data-testid="pedidos-chip-oc"
                            >
                              OC {pedido.ocCliente}
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-3 py-[9px] font-medium">{pedido.cliente}</td>
                      <td className="num px-3 py-[9px] text-muted-foreground">
                        {vigencia(pedido)}
                      </td>
                      <td className="px-3 py-[9px]" />
                      <td className="num px-3 py-[9px] text-right font-semibold">
                        {cantCabecera.toLocaleString('es-MX')}
                      </td>
                      {puedeVerImportes ? <td className="px-3 py-[9px]" /> : null}
                      {puedeVerImportes ? (
                        <td className="num px-3 py-[9px] text-right font-semibold">
                          {pedido.importeTotal === null
                            ? '—'
                            : FORMATO_MONEDA.format(pedido.importeTotal)}
                        </td>
                      ) : null}
                      <td className="num px-3 py-[9px] text-right text-muted-foreground">
                        {pedido.cortadoTotal.toLocaleString('es-MX')}
                      </td>
                      <td className="px-3 py-[9px]">
                        <ChipEstado tono={chip.tono}>{chip.texto}</ChipEstado>
                      </td>
                    </tr>
                    {/* Renglones/modelos (clic = cajón de detalle). */}
                    {!colapsado
                      ? pedido.renglones.map((renglon) => {
                          const chipR = chipRenglon(renglon);
                          const cant =
                            cantidades === 'pendiente'
                              ? Math.max(0, renglon.cantidad - renglon.cortado)
                              : renglon.cantidad;
                          return (
                            <tr
                              key={renglon.id}
                              className={cn(
                                'cursor-pointer border-b transition-colors hover:bg-muted/50',
                                seleccion?.idRenglon === renglon.id &&
                                  'bg-primary-soft hover:bg-primary-soft',
                              )}
                              onClick={() =>
                                setSeleccion({ idPedido: pedido.id, idRenglon: renglon.id })
                              }
                              data-testid="pedidos-renglon"
                            >
                              <td className="px-3 py-1.5 pl-9">
                                {/* Proto `.sub-mod`: el modelo con subrayado punteado abre su ficha
                                    de desarrollo; los históricos sin ficha van en texto plano. */}
                                {renglon.idDesarrollo !== null ? (
                                  <button
                                    type="button"
                                    className="num cursor-pointer font-medium underline decoration-dotted underline-offset-[3px]"
                                    title="Ver ficha de desarrollo"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void navigate('/desarrollo', {
                                        state: { idModelo: renglon.idModelo },
                                      });
                                    }}
                                    data-testid="pedidos-liga-desarrollo"
                                  >
                                    {renglon.codigoModelo}
                                  </button>
                                ) : (
                                  <span
                                    className="num font-medium"
                                    title="modelo anterior al módulo de Desarrollo"
                                  >
                                    {renglon.codigoModelo}
                                  </span>
                                )}
                                {renglon.numeroProduccion !== null ? (
                                  <span
                                    className="num ml-2 text-[10.5px] text-faint"
                                    title="Nº interno de producción"
                                  >
                                    prod. #{renglon.numeroProduccion}
                                  </span>
                                ) : null}
                                {renglon.descripcionModelo !== null ? (
                                  <span className="ml-2 text-[11px] text-faint">
                                    {renglon.descripcionModelo}
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-3 py-1.5" />
                              <td className="px-3 py-1.5" />
                              <td className="px-3 py-1.5">
                                {renglon.folioOrden !== null ? (
                                  <button
                                    type="button"
                                    className="num cursor-pointer font-semibold text-primary hover:underline"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void navigate('/produccion/ordenes', {
                                        state: { idOrden: renglon.idOrden },
                                      });
                                    }}
                                    title="Ver en el centro de Órdenes"
                                    data-testid="pedidos-liga-orden"
                                  >
                                    {renglon.folioOrden}
                                    {renglon.numOrdenes > 1 ? ` (+${renglon.numOrdenes - 1})` : ''}
                                  </button>
                                ) : puedeCrearOp && pedido.estatus === 'vigente' ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-6 px-2 text-xs"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setGenerarOpDe({ pedido, renglon });
                                    }}
                                    data-testid="pedidos-generar-op"
                                  >
                                    <Plus aria-hidden />
                                    Generar OP
                                  </Button>
                                ) : (
                                  <span className="text-faint">—</span>
                                )}
                              </td>
                              <td className="num px-3 py-1.5 text-right">
                                {cant.toLocaleString('es-MX')}
                              </td>
                              {puedeVerImportes ? (
                                <td className="num px-3 py-1.5 text-right">
                                  {renglon.precio === null
                                    ? '—'
                                    : FORMATO_MONEDA.format(renglon.precio)}
                                </td>
                              ) : null}
                              {puedeVerImportes ? (
                                <td className="num px-3 py-1.5 text-right">
                                  {renglon.importe === null
                                    ? '—'
                                    : FORMATO_MONEDA.format(renglon.importe)}
                                </td>
                              ) : null}
                              <td
                                className={cn(
                                  'num px-3 py-1.5 text-right',
                                  renglon.cortado >= renglon.cantidad && renglon.cantidad > 0
                                    ? 'text-ok'
                                    : renglon.cortado === 0
                                      ? 'text-faint'
                                      : 'text-warn',
                                )}
                              >
                                {renglon.cortado.toLocaleString('es-MX')}
                              </td>
                              <td className="px-3 py-1.5">
                                <ChipEstado tono={chipR.tono}>{chipR.texto}</ChipEstado>
                              </td>
                            </tr>
                          );
                        })
                      : null}
                  </tbody>
                );
              })}
            </table>
          )}
        </div>

        {/* ── Barra de totales (proto `.totbar`: fondo panel-2, pares etiqueta/valor apilados) ── */}
        <div
          className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-t bg-panel-2 px-4 py-2 text-xs"
          data-testid="pedidos-totales"
        >
          <TotalItem etiqueta="Pedidos" valor={(totales?.pedidos ?? 0).toLocaleString('es-MX')} />
          <TotalItem etiqueta="Órdenes" valor={(totales?.ordenes ?? 0).toLocaleString('es-MX')} />
          <TotalItem
            etiqueta="Piezas pedidas"
            valor={(totales?.piezas ?? 0).toLocaleString('es-MX')}
          />
          <TotalItem etiqueta="Cortado" valor={(totales?.cortado ?? 0).toLocaleString('es-MX')} />
          <span className="flex-1" />
          <TotalItem etiqueta="Avance" valor={`${Math.round(totales?.avancePct ?? 0)}%`} />
          {puedeVerImportes ? (
            <TotalItem
              etiqueta="Importe total"
              valor={totales?.importe == null ? '—' : FORMATO_MONEDA.format(totales.importe)}
              destacado
            />
          ) : null}
          <span className="ml-2 flex items-center gap-1 text-muted-foreground">
            Página {pagina} de {totalPaginas}
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

      {/* ── Cajón de detalle del renglón ────────────────────────────────────── */}
      <CajonDetalle
        ancho="amplio"
        abierto={seleccion !== null && renglonSeleccionado !== undefined}
        alCambiarAbierto={(abierto) => {
          if (!abierto) setSeleccion(null);
        }}
        titulo={
          renglonSeleccionado !== undefined ? `Modelo ${renglonSeleccionado.codigoModelo}` : ''
        }
        subtitulo={
          pedidoSeleccionado !== undefined && renglonSeleccionado !== undefined
            ? `Pedido ${pedidoSeleccionado.folio}-F · ${pedidoSeleccionado.cliente}` +
              (renglonSeleccionado.folioOrden !== null
                ? ` · Orden ${renglonSeleccionado.folioOrden}`
                : '') +
              (pedidoSeleccionado.ocCliente !== null
                ? ` · OC cliente ${pedidoSeleccionado.ocCliente}`
                : '')
            : undefined
        }
      >
        {pedidoSeleccionado !== undefined && renglonSeleccionado !== undefined ? (
          <DetalleRenglon
            pedido={pedidoSeleccionado}
            renglon={renglonSeleccionado}
            puedeVerImportes={puedeVerImportes}
            puedeCrearOp={puedeCrearOp}
            puedeAdministrar={puedeAdministrar}
            alVerRenglon={(idRenglon) =>
              setSeleccion({ idPedido: pedidoSeleccionado.id, idRenglon })
            }
            alGenerarOp={() =>
              setGenerarOpDe({ pedido: pedidoSeleccionado, renglon: renglonSeleccionado })
            }
          />
        ) : null}
      </CajonDetalle>

      {/* ── Overlays ────────────────────────────────────────────────────────── */}
      {constructorAbierto ? (
        <ConstructorPedido
          alCerrar={() => setConstructorAbierto(false)}
          alCreado={() => {
            setConstructorAbierto(false);
            void consulta.refetch();
          }}
        />
      ) : null}
      {importadorAbierto ? (
        <ImportadorPedido
          alCerrar={() => setImportadorAbierto(false)}
          alImportado={() => {
            setImportadorAbierto(false);
            void consulta.refetch();
          }}
        />
      ) : null}
      {generarOpDe !== null ? (
        <PanelGenerarOP
          pedido={generarOpDe.pedido}
          renglon={generarOpDe.renglon}
          alCerrar={() => setGenerarOpDe(null)}
          alCreada={() => {
            setGenerarOpDe(null);
            void consulta.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

/** Un total de la barra al pie (proto `.totitem`: etiqueta 10px ARRIBA, valor 15px negrita). */
function TotalItem({
  etiqueta,
  valor,
  destacado = false,
}: {
  etiqueta: string;
  valor: string;
  destacado?: boolean;
}): React.JSX.Element {
  return (
    <span className="flex flex-col">
      <span className="text-[10px] font-semibold tracking-wide text-faint uppercase">
        {etiqueta}
      </span>
      <b className={cn('num text-[15px] font-bold', destacado && 'text-primary')}>{valor}</b>
    </span>
  );
}

/**
 * Detalle del renglón en el cajón (proto `drawerOrden`): cadena de trazabilidad + datos de la
 * orden/renglón + barra de avance + "Va junto con" (los demás modelos del pedido, navegables).
 */
function DetalleRenglon({
  pedido,
  renglon,
  puedeVerImportes,
  puedeCrearOp,
  puedeAdministrar,
  alVerRenglon,
  alGenerarOp,
}: {
  pedido: PedidoMesFila;
  renglon: PedidoMesRenglon;
  puedeVerImportes: boolean;
  puedeCrearOp: boolean;
  /** `pedidos.administrar`: habilita subir/quitar adjuntos del pedido (B3). */
  puedeAdministrar: boolean;
  alVerRenglon: (idRenglon: number) => void;
  alGenerarOp: () => void;
}): React.JSX.Element {
  const navigate = useNavigate();
  const pct =
    renglon.cantidad > 0
      ? Math.min(100, Math.round((renglon.cortado / renglon.cantidad) * 100))
      : 0;
  const chip = chipRenglon(renglon);

  const nodos: NodoTraza[] = [
    ...(pedido.ocCliente !== null
      ? [
          {
            clave: 'oc' as const,
            etiqueta: 'OC cliente',
            valor: pedido.ocCliente,
            activo: true,
            titulo: 'Orden de compra original del cliente (referencia)',
          },
        ]
      : []),
    {
      clave: 'desarrollo',
      etiqueta: 'Desarrollo',
      valor: renglon.idDesarrollo !== null ? `#${renglon.codigoModelo}` : '—',
      activo: renglon.idDesarrollo !== null,
      ...(renglon.idDesarrollo !== null
        ? {
            onNavegar: () =>
              void navigate('/desarrollo', { state: { idModelo: renglon.idModelo } }),
          }
        : { titulo: 'modelo anterior al módulo de Desarrollo' }),
    },
    {
      clave: 'lista',
      etiqueta: 'Lista de precios',
      valor: 'cotización',
      activo: renglon.idDesarrollo !== null,
      ...(renglon.idDesarrollo !== null
        ? { onNavegar: () => void navigate('/listas-precios') }
        : {}),
    },
    { clave: 'pedido', etiqueta: 'Pedido interno', valor: `${pedido.folio}-F`, activo: true },
    {
      clave: 'op',
      etiqueta: 'OP · producción',
      valor:
        renglon.folioOrden !== null
          ? `#${renglon.folioOrden}` +
            (renglon.numeroProduccion !== null ? ` · mod. ${renglon.numeroProduccion}` : '')
          : 'por generar',
      activo: renglon.folioOrden !== null,
      ...(renglon.idOrden !== null
        ? {
            onNavegar: () =>
              void navigate('/produccion/ordenes', { state: { idOrden: renglon.idOrden } }),
          }
        : {}),
    },
  ];

  return (
    <div className="space-y-4">
      <CadenaTrazabilidad nodos={nodos} compacta />

      <section>
        <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Orden de producción
        </h4>
        <div className="grid grid-cols-1 gap-x-3 gap-y-2 text-xs sm:grid-cols-2">
          <Campo k="No. orden" v={renglon.folioOrden !== null ? String(renglon.folioOrden) : '—'} />
          <Campo k="OC del cliente" v={pedido.ocCliente ?? '—'} />
          <Campo
            k="Nº de producción"
            v={renglon.numeroProduccion !== null ? `#${renglon.numeroProduccion}` : '—'}
          />
          <Campo k="Cantidad pedida" v={renglon.cantidad.toLocaleString('es-MX')} />
          {puedeVerImportes ? (
            <Campo
              k="Precio unitario"
              v={renglon.precio === null ? '—' : FORMATO_MONEDA.format(renglon.precio)}
            />
          ) : null}
          {puedeVerImportes ? (
            <Campo
              k="Importe"
              v={renglon.importe === null ? '—' : FORMATO_MONEDA.format(renglon.importe)}
            />
          ) : null}
          <Campo k="Cortado" v={`${renglon.cortado.toLocaleString('es-MX')} · ${pct}%`} />
        </div>
      </section>

      <section>
        <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Avance de producción
        </h4>
        <div className="flex items-center gap-2">
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <span className="block h-full bg-primary" style={{ width: `${pct}%` }} />
          </span>
          <ChipEstado tono={chip.tono}>{chip.texto}</ChipEstado>
        </div>
      </section>

      <section>
        <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Va junto con
        </h4>
        <ul className="space-y-1" data-testid="cajon-va-junto">
          {pedido.renglones.map((otro) => (
            <li key={otro.id}>
              <button
                type="button"
                onClick={() => alVerRenglon(otro.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted/60',
                  otro.id === renglon.id && 'border-primary/50 bg-primary-soft',
                )}
              >
                <span className="num min-w-0 flex-1 truncate font-medium">
                  {otro.codigoModelo}
                  {otro.descripcionModelo !== null ? (
                    <span className="ml-1.5 font-normal text-faint">{otro.descripcionModelo}</span>
                  ) : null}
                </span>
                <span className="num text-muted-foreground">
                  {otro.folioOrden !== null ? `Orden ${otro.folioOrden}` : 'sin OP'}
                </span>
                <span className="num text-muted-foreground">
                  {otro.cantidad.toLocaleString('es-MX')} pz
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-faint">
          Todos los modelos de <b>{pedido.folio}-F</b> comparten insumos y se entregan juntos.
        </p>
      </section>

      {/* Adjuntos DEL PEDIDO (B3): aquí vive (y se reintenta) el documento de la OC del cliente. */}
      <section>
        <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Adjuntos del pedido (OC del cliente)
        </h4>
        <AdjuntosPedido idPedido={pedido.id} puedeAdministrar={puedeAdministrar} />
      </section>

      {/* Pie de acciones (proto `drawerOrden`): imprimir + ruta crítica cuando hay OP. */}
      <div className="flex flex-wrap gap-2">
        {renglon.idOrden !== null ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void navigate('/produccion/ordenes', { state: { idOrden: renglon.idOrden } })
              }
              data-testid="cajon-ver-orden"
            >
              <ExternalLink aria-hidden />
              Ver en Órdenes
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => imprimirOrden(renglon.idOrden as number)}
              data-testid="cajon-imprimir-orden"
            >
              <Printer aria-hidden />
              Imprimir orden
            </Button>
            <Button
              size="sm"
              onClick={() => void navigate(`/ruta-critica/ordenes/${renglon.idOrden}`)}
              data-testid="cajon-ver-rc"
            >
              <Route aria-hidden />
              Ver ruta crítica
            </Button>
          </>
        ) : puedeCrearOp && pedido.estatus === 'vigente' ? (
          <Button size="sm" onClick={alGenerarOp} data-testid="cajon-generar-op">
            <Plus aria-hidden />
            Generar OP
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Campo etiqueta/valor chico del cajón. */
function Campo({ k, v }: { k: string; v: string }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] font-medium text-faint">{k}</p>
      <p className="num truncate font-medium">{v}</p>
    </div>
  );
}
