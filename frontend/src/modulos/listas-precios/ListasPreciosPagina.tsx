import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeft,
  ChevronRightIcon,
  FileDown,
  FileText,
  Info,
  LockIcon,
  MessagesSquareIcon,
  PencilIcon,
  Plus,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useDepartamentosCliente } from '@/api/clientes';
import { useEstadosLista } from '@/api/estados-lista';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { FiltroCliente } from '@/components/dominio/FiltroCliente';
import {
  descargarListaExcel,
  imprimirListaPdf,
  useAjustarPrecioLinea,
  useAprobarLinea,
  useEliminarLista,
  useQuitarLineaLista,
  useDesgloseCostoLinea,
  useListaPrecios,
  useListasPrecios,
  type ListaLinea,
  type ListasQuery,
} from '@/api/listas-precios';
import { ChipEstado, type TonoEstado } from '@/components/dominio/ChipEstado';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Avatar } from '@/components/dominio/visuales';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { formatearFecha, formatearMoneda } from '@/lib/formato';
import { BuscadorToolbar } from '@/components/dominio/BuscadorToolbar';
import { ChipsFiltro } from '@/components/dominio/ChipsFiltro';
import { Historial } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { CotizacionesDeLista } from './CotizacionesDeLista';
import { DialogoCrearLista } from './DialogoCrearLista';
import { DialogoEditarFactoresLista } from './DialogoEditarFactoresLista';
import { DialogoNegociacionRenglon } from './DialogoNegociacionRenglon';
import { SelectorEstadoLista } from './SelectorEstadoLista';

/** Query de estados (para los chips): ordenados por su `orden`. */
const QUERY_ESTADOS = {
  pagina: 1,
  porPagina: 100,
  ordenarPor: 'orden',
  direccion: 'asc',
  incluirInactivos: 'false',
} as const;

/** Tono del chip por código de estado (proto `ESTADO_LISTA`); desconocidos en neutro. */
const TONO_ESTADO_LISTA: Record<string, TonoEstado> = {
  abierta: 'ok',
  autorizada: 'info',
  'en-negociacion': 'warn',
  cerrada: 'neutro',
  'ya-pedida': 'info',
};

/** Chip de estado de una lista (tonos del kit, proto `.badge`). */
function BadgeEstadoLista({
  codigo,
  nombre,
  className,
}: {
  codigo: string;
  nombre: string;
  className?: string;
}): React.JSX.Element {
  return (
    <ChipEstado tono={TONO_ESTADO_LISTA[codigo] ?? 'neutro'} {...(className ? { className } : {})}>
      {nombre}
    </ChipEstado>
  );
}

/**
 * Módulo "Listas de precios" (F8-E4) — re-vestido R9 FIEL al proto `vListasLista` + `vListaDetalle`:
 * page-head + banner informativo (la lista NO dispara pedidos) + card tabla-first (chips por estado,
 * filtros por cliente/departamento, buscador local, conteo) y, al hacer clic, la lista se abre a
 * PÁGINA COMPLETA (drill-in) con el panel de FACTORES del cliente (snapshot), la tabla de APROBACIÓN
 * renglón por renglón (precio calculado → Aprobar / Teclear, desglose expandible) y la negociación.
 *
 * FIDELIDAD vs proto: las columnas «Temporada» y «Valor Σ» del listado no existen en el resumen del
 * API → se omiten (huecos reportados). `listas.ver` gobierna el acceso; `listas.administrar` crea y
 * edita factores; `listas.aprobar` aprueba/teclea; `listas.negociar` mueve el estado (A1).
 */
export function ListasPreciosPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('listas.administrar');

  const [idClienteFiltro, setIdClienteFiltro] = useState('');
  const [idDepartamentoFiltro, setIdDepartamentoFiltro] = useState('');
  const [idEstadoFiltro, setIdEstadoFiltro] = useState('');
  const [crearAbierto, setCrearAbierto] = useState(false);
  // Drill-in: la lista abierta a página completa (null = listado).
  const [seleccionId, setSeleccionId] = useState<number | null>(null);

  const estados = useEstadosLista(QUERY_ESTADOS);
  const departamentosFiltro = useDepartamentosCliente(
    idClienteFiltro === '' ? undefined : Number(idClienteFiltro),
  );

  const query: ListasQuery = {
    ...(idClienteFiltro === '' ? {} : { idCliente: Number(idClienteFiltro) }),
    ...(idDepartamentoFiltro === '' ? {} : { idClienteDepartamento: Number(idDepartamentoFiltro) }),
    ...(idEstadoFiltro === '' ? {} : { idEstadoLista: Number(idEstadoFiltro) }),
  };

  const consulta = useListasPrecios(query);
  const listas = consulta.data ?? [];

  // Búsqueda local por folio o cliente (el listado no pagina en servidor: es acotado por empresa).
  const [busqueda, setBusqueda] = useState('');
  const filtradas = busqueda.trim()
    ? listas.filter(
        (l) =>
          String(l.folio).includes(busqueda.trim()) ||
          l.nombreCliente.toLowerCase().includes(busqueda.trim().toLowerCase()),
      )
    : listas;

  function cambiarClienteFiltro(valor: string): void {
    setIdClienteFiltro(valor);
    setIdDepartamentoFiltro('');
  }

  // ── Drill-in: la lista abierta ocupa TODA la página (proto vListaDetalle) ──
  if (seleccionId !== null) {
    return <PaginaLista idLista={seleccionId} alRegresar={() => setSeleccionId(null)} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 md:p-5 lg:overflow-visible">
      {/* ── Encabezado (proto .page-head) ────────────────────────────────────── */}
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Cotizaciones / Listas de precios
          </h1>
          <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
            Desarrollo (F8) · factores del cliente · aprobación modelo por modelo · negociación por
            versiones
          </p>
        </div>
        {puedeAdministrar ? (
          <Button size="sm" onClick={() => setCrearAbierto(true)} data-testid="nuevo-lista-precios">
            <Plus aria-hidden />
            Nueva lista
          </Button>
        ) : null}
      </header>

      {/* ── Banner del proto: la lista NO dispara pedidos ────────────────────── */}
      <div className="flex shrink-0 items-center gap-2.5 rounded-[10px] bg-info-soft px-3 py-2 text-[12.5px] text-info">
        <Info className="size-4 shrink-0" aria-hidden />
        <span>
          La lista toma el <b>costo del pre-costeo</b> y le aplica los <b>factores del cliente</b>;{' '}
          <b>el dueño</b> aprueba <b>modelo por modelo</b> y comercial la manda ya autorizada.{' '}
          <b>La lista NO dispara pedidos</b> (el pedido nace de la OC del cliente).
        </span>
      </div>

      {/* ── Card: toolbar + tabla + totales ─────────────────────────────────── */}
      <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border bg-card lg:min-h-0 lg:flex-1 lg:shrink">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2.5">
          <ChipsFiltro
            etiqueta="Filtrar por estado de la lista"
            opciones={[
              { valor: '', etiqueta: 'Todas', testid: 'chip-todas' },
              ...(estados.data?.datos ?? []).map((e) => ({
                valor: String(e.id),
                etiqueta: e.nombre,
              })),
            ]}
            valor={idEstadoFiltro}
            alCambiar={setIdEstadoFiltro}
          />
          <span className="w-40" data-testid="filtros-listas">
            {/* V1-E4 (punto 7): búsqueda server-side en vez del <select> topado a 100. */}
            <FiltroCliente
              idCliente={idClienteFiltro === '' ? null : Number(idClienteFiltro)}
              alCambiar={(c) => cambiarClienteFiltro(c === null ? '' : String(c.id))}
            />
          </span>
          <SelectNativo
            className="w-44 h-[30px] text-xs"
            aria-label="Filtrar por departamento"
            value={idDepartamentoFiltro}
            disabled={idClienteFiltro === ''}
            onChange={(e) => setIdDepartamentoFiltro(e.target.value)}
          >
            <option value="">Todos los departamentos</option>
            {(departamentosFiltro.data ?? [])
              .filter((d) => d.activo)
              .map((d) => (
                <option key={d.id} value={String(d.id)}>
                  {d.nombre}
                </option>
              ))}
          </SelectNativo>
          <BuscadorToolbar
            valor={busqueda}
            alCambiar={setBusqueda}
            placeholder="Buscar lista, cliente…"
            etiqueta="Buscar lista"
            testid="buscar-lista-precios"
          />
          <span className="ml-auto text-xs text-faint">
            {filtradas.length.toLocaleString('es-MX')} listas
          </span>
        </div>

        {/* ── Cuerpo scrolleable ─────────────────────────────────────────── */}
        <div className="overflow-auto lg:min-h-0 lg:flex-1">
          {consulta.isError ? (
            <div className="space-y-2 p-6">
              <p className="text-sm text-destructive" role="alert">
                {consulta.error.message}
              </p>
              <Button variant="outline" size="sm" onClick={() => void consulta.refetch()}>
                Reintentar
              </Button>
            </div>
          ) : consulta.isPending ? (
            <p className="p-6 text-sm text-muted-foreground">Cargando listas…</p>
          ) : filtradas.length === 0 ? (
            <p
              className="m-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
              data-testid="lista-precios-vacio"
            >
              No hay listas de precios que coincidan.
            </p>
          ) : (
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Lista</TablaDensaHead>
                  <TablaDensaHead>Cliente / Departamento</TablaDensaHead>
                  <TablaDensaHead numerica>Modelos</TablaDensaHead>
                  <TablaDensaHead numerica>Aprobados</TablaDensaHead>
                  <TablaDensaHead>Estado</TablaDensaHead>
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {filtradas.map((l) => (
                  <TablaDensaFila
                    key={l.id}
                    className="cursor-pointer"
                    onClick={() => setSeleccionId(l.id)}
                    data-testid="fila-lista-precios"
                  >
                    <TablaDensaCelda>
                      <div className="flex items-center gap-2">
                        <Avatar nombre="L P" tono="pt" tamano="sm" />
                        <div className="min-w-0">
                          <div className="num truncate font-semibold">#{l.folio}</div>
                          <div className="num truncate text-xs text-muted-foreground">
                            {formatearFecha(l.fecha)}
                          </div>
                        </div>
                      </div>
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      <span className="font-semibold">{l.nombreCliente}</span>{' '}
                      <span className="text-muted-foreground">/ {l.nombreDepartamento}</span>
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica>
                      {l.totalRenglones.toLocaleString('es-MX')}
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica>
                      {l.renglonesAprobados.toLocaleString('es-MX')}/
                      {l.totalRenglones.toLocaleString('es-MX')}
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      <BadgeEstadoLista codigo={l.codigoEstado} nombre={l.nombreEstado} />
                    </TablaDensaCelda>
                  </TablaDensaFila>
                ))}
              </TablaDensaCuerpo>
            </TablaDensa>
          )}
        </div>

        {/* ── Barra de totales al pie ────────────────────────────────────── */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-t bg-secondary px-3 py-1.5 text-xs">
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10.5px] font-medium text-faint uppercase">Listas (filtro)</span>
            <b className="num">{filtradas.length.toLocaleString('es-MX')}</b>
          </span>
        </div>
      </div>

      <DialogoCrearLista
        abierto={crearAbierto}
        alCambiarAbierto={setCrearAbierto}
        alCreada={() => {
          void consulta.refetch();
        }}
      />
    </div>
  );
}

/**
 * PÁGINA de una lista (drill-in, proto `vListaDetalle`): regreso al listado, encabezado con el
 * estado, panel de FACTORES (snapshot editable por diálogo), tabla de APROBACIÓN renglón por
 * renglón con desglose expandible, y el control de cambio de estado (negociación). Mantiene los
 * testids del flujo e2e (`detalle-lista-precios`, `fila-renglon-lista`, `aprobar-renglon`,
 * `teclear-precio`, `precio-aprobado`, `alternar-desglose`, `desglose-*`, `abrir-negociacion`…).
 */
function PaginaLista({
  idLista,
  alRegresar,
}: {
  idLista: number;
  alRegresar: () => void;
}): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const verImportes = tienePermiso('consultas.ver-importes');
  const puedeAprobar = tienePermiso('listas.aprobar');
  const puedeAdministrar = tienePermiso('listas.administrar');
  const puedeNegociar = tienePermiso('listas.negociar');
  // ⭐ V1-E8b (§Post-F9.125(a)+(b)): los CUATRO factores —verlos y moverlos— son del dueño. Antes el
  // panel se pintaba con `consultas.ver-importes` y el botón con `listas.administrar`, los dos
  // permisos que Desarrollo tiene. El backend ya los manda en `null`; aquí no se pinta el panel, que
  // es lo que evita cuatro guiones sin explicación.
  const puedeVerFactores = puedeAprobar;
  const [borrarListaAbierto, setBorrarListaAbierto] = useState(false);
  const borrarLista = useEliminarLista();

  const consulta = useListaPrecios(idLista);
  const [editarFactoresAbierto, setEditarFactoresAbierto] = useState(false);

  const lista = consulta.data;

  const regreso = (
    <Button
      variant="ghost"
      size="sm"
      onClick={alRegresar}
      className="mb-2 -ml-2"
      data-testid="regresar-listas"
    >
      <ChevronLeft aria-hidden />
      Listas
    </Button>
  );

  if (consulta.isPending) {
    return (
      <div className="p-4 md:p-5">
        {regreso}
        <p className="text-sm text-muted-foreground">Cargando lista…</p>
      </div>
    );
  }
  if (consulta.isError || lista === undefined) {
    return (
      <div className="p-4 md:p-5">
        {regreso}
        <p className="text-sm text-destructive" role="alert">
          {consulta.error?.message ?? 'No se pudo cargar la lista.'}
        </p>
      </div>
    );
  }

  // §Post-F9.125(c): de una lista sin aprobar no sale papel. `aprobado` es un hecho del renglón
  // (no depende de ver importes), así que el aviso dice lo mismo para todos los que llegan aquí.
  const sinAprobar = lista.lineas.filter((ln) => !ln.aprobado);
  const listaCompletamenteAprobada = lista.lineas.length > 0 && sinAprobar.length === 0;
  const sinAprobarTexto =
    lista.lineas.length === 0
      ? 'la lista no tiene renglones'
      : sinAprobar.length === 1
        ? `falta ${sinAprobar[0]?.codigoModelo ?? ''}`
        : `faltan ${sinAprobar.map((ln) => ln.codigoModelo).join(', ')}`;

  // Σ del pie del card (sobre los renglones ya cargados; el cálculo de precios es del backend).
  const sumaCosto = lista.lineas.reduce((a, ln) => a + (ln.costoUnit ?? 0), 0);
  const sumaPrecio = lista.lineas.reduce(
    (a, ln) => a + (ln.precioAprobado ?? ln.precioCalculado ?? 0),
    0,
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 md:p-5"
      data-testid="detalle-lista-precios"
    >
      {/* ── Encabezado (proto: regreso + título con estado + acciones) ──────── */}
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 flex-1">
          {regreso}
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Lista #{lista.folio} · {lista.nombreCliente}{' '}
            <span className="font-medium text-muted-foreground">/ {lista.nombreDepartamento}</span>
            <BadgeEstadoLista
              codigo={lista.codigoEstado}
              nombre={lista.nombreEstado}
              className="ml-2 align-middle"
            />
          </h1>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {lista.lineas.length} modelos · {formatearFecha(lista.fecha)}
          </p>
          {lista.notas === null || lista.notas === '' ? null : (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileText className="size-3.5 shrink-0" aria-hidden />
              {lista.notas}
            </p>
          )}
        </div>
        {verImportes ? (
          <div className="flex flex-wrap items-center gap-2">
            {/* ⭐ V1-E8b (§Post-F9.125(c)): de una lista sin aprobar NO sale papel — ni borrador.
                El servidor lo NIEGA (409 nombrando los modelos que faltan); aquí los botones se
                deshabilitan y se dice por qué, para que no queden dos controles que fallan al
                pulsarlos (la cicatriz de «esconder, no negar» es la contraria: aquí se niega en el
                servidor Y se explica en la pantalla). */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!listaCompletamenteAprobada}
              onClick={() => imprimirListaPdf(lista.id)}
              data-testid="descargar-lista-pdf"
            >
              <FileText aria-hidden />
              Lista PDF
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!listaCompletamenteAprobada}
              onClick={() => descargarListaExcel(lista.id)}
              data-testid="descargar-lista-excel"
            >
              <FileDown aria-hidden />
              Excel
            </Button>
            {/* V1-E4 (punto 4): una lista creada por error retenía a TODOS sus desarrollos —el
                `@@unique([idDesarrollo])` impide que entren a otra— y no había cómo borrarla.
                Queda íntegra en la bitácora (D3); una lista en estado de cierre se rechaza. */}
            {puedeAdministrar ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setBorrarListaAbierto(true)}
                data-testid="borrar-lista"
              >
                <Trash2 aria-hidden />
                Borrar lista
              </Button>
            ) : null}
            {listaCompletamenteAprobada ? null : (
              <p
                className="flex w-full items-start gap-1.5 text-[11.5px] text-muted-foreground"
                data-testid="aviso-sin-aprobar"
              >
                <LockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  No se puede bajar el PDF ni el Excel: {sinAprobarTexto} sin precio aprobado por el
                  dueño. Un papel con precios que nadie autorizó confunde al cliente.
                </span>
              </p>
            )}
          </div>
        ) : null}
      </header>

      {/* ── Negociación: cambio de estado (permiso listas.negociar) ─────────── */}
      {puedeNegociar ? (
        <div className="shrink-0 rounded-xl border bg-card px-3.5 py-2.5">
          <SelectorEstadoLista lista={lista} />
        </div>
      ) : null}

      {/* ── Cotizaciones emitidas (V1-E7c): el papel que salió de esta mesa ── */}
      <CotizacionesDeLista lista={lista} />

      {/* ── Panel de factores del cliente (proto .lp-factores) ──────────────── */}
      {/* §Post-F9.125(b): sólo el dueño. Para los demás la sección entera NO se pinta —ni su
          rótulo—, en vez de dejarla con cuatro guiones o un letrero de permiso adentro
          (§Post-F9.68, mismo criterio que la ficha del cliente). */}
      {puedeVerFactores ? (
        <section className="shrink-0 rounded-xl border bg-card px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-[13px] font-semibold">Factores del cliente</h4>
            {puedeAprobar ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary-soft-foreground">
                <PencilIcon className="size-3" aria-hidden />
                se editan por diálogo, queda auditado
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary-soft-foreground">
                <LockIcon className="size-3" aria-hidden />
                bloqueados
              </span>
            )}
          </div>
          <p className="num mt-1 text-[11.5px] text-muted-foreground">
            Precio = costo ÷ (1 − margen) ÷ (1 − descuentos − regalías − costo ventas), redondeado
            al alza. <b>Moverlos invalida las aprobaciones</b> de esta lista.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <FactorLectura etiqueta="Margen" valor={lista.margenPct} />
            <FactorLectura etiqueta="Descuentos" valor={lista.descuentosPct} />
            <FactorLectura etiqueta="Regalías" valor={lista.regaliasPct} />
            <FactorLectura etiqueta="Costo de ventas" valor={lista.costoVentasPct} />
            {puedeAprobar ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditarFactoresAbierto(true)}
                data-testid="editar-factores-lista"
              >
                <PencilIcon aria-hidden />
                Editar factores
              </Button>
            ) : null}
            <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <Info className="size-3.5 shrink-0 text-primary" aria-hidden />
              Vienen predefinidos de <b>{lista.nombreCliente}</b>; el snapshot vive en esta lista.
            </span>
          </div>
        </section>
      ) : null}

      {/* ── Card: precios por modelo (aprobación renglón por renglón) ───────── */}
      <div className="flex min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center gap-2.5 border-b px-3.5 py-3">
          <h3 className="text-[13.5px] font-semibold">Precios por modelo</h3>
          {verImportes ? (
            <span className="ml-auto text-[11.5px] text-faint">
              Costo Σ <b className="num text-foreground">{formatearMoneda(sumaCosto)}</b> · Precio Σ{' '}
              <b className="num text-ok">{formatearMoneda(sumaPrecio)}</b>
            </span>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <TablaDensa>
            <TablaDensaEncabezado>
              <TablaDensaFila>
                <TablaDensaHead>Modelo</TablaDensaHead>
                <TablaDensaHead numerica>Costo</TablaDensaHead>
                <TablaDensaHead numerica>Precio calculado</TablaDensaHead>
                <TablaDensaHead numerica>Precio aprobado</TablaDensaHead>
                <TablaDensaHead>Estado</TablaDensaHead>
                <TablaDensaHead className="text-right" />
              </TablaDensaFila>
            </TablaDensaEncabezado>
            <TablaDensaCuerpo>
              {lista.lineas.map((linea) => (
                <FilaRenglon
                  key={linea.id}
                  linea={linea}
                  verImportes={verImportes}
                  puedeAprobar={puedeAprobar}
                  puedeNegociar={puedeNegociar}
                  puedeAdministrar={puedeAdministrar}
                />
              ))}
            </TablaDensaCuerpo>
          </TablaDensa>
        </div>
        {puedeAprobar ? (
          <div className="m-3 flex items-center gap-1.5 rounded-lg border bg-secondary px-3 py-2 text-[11.5px] text-muted-foreground">
            <LockIcon className="size-3.5 shrink-0" aria-hidden />
            {/* §Post-F9.68: se le dice a QUIÉN le toca, no cómo se llama el
                permiso por dentro — la forma interna del sistema no es del
                usuario. (Este aviso solo lo ve quien SÍ puede aprobar.) */}
            <span>
              Aprobar/teclear precios y mover los factores es facultad del <b>dueño</b>. Queda
              registrado quién y cuándo — y <b>mover un factor tumba las aprobaciones</b>, que se
              vuelven a firmar.
            </span>
          </div>
        ) : null}
      </div>

      <div className="mt-auto shrink-0">
        <Historial creadoEn={lista.creadoEn} modificadoEn={lista.modificadoEn} />
      </div>

      <DialogoEditarFactoresLista
        abierto={editarFactoresAbierto}
        alCambiarAbierto={setEditarFactoresAbierto}
        lista={lista}
      />

      {/* V1-E4 (punto 4): borrar la lista completa. */}
      <DialogoConfirmacion
        abierto={borrarListaAbierto}
        alCambiarAbierto={setBorrarListaAbierto}
        titulo="Borrar lista de precios"
        descripcion={
          <>
            Se borra la <b>lista #{lista.folio}</b> con sus {lista.lineas.length} renglón(es) y su
            historial de negociación. Queda <b>íntegra en la bitácora</b> y sus desarrollos vuelven
            a quedar disponibles para otra lista. No se puede deshacer desde la pantalla.
          </>
        }
        textoConfirmar="Borrar lista"
        variante="destructive"
        procesando={borrarLista.isPending}
        alConfirmar={() =>
          borrarLista.mutate(lista.id, {
            onSuccess: () => {
              toast.success(`Lista #${String(lista.folio)} borrada.`);
              setBorrarListaAbierto(false);
              alRegresar();
            },
            onError: (error) => toast.error(error.message),
          })
        }
      />
    </div>
  );
}

/** Un factor del snapshot en solo lectura (proto `.lp-fac`): etiqueta + valor mono + «%». */
function FactorLectura({
  etiqueta,
  valor,
}: {
  etiqueta: string;
  valor: number | null;
}): React.JSX.Element {
  return (
    <label className="flex w-32 flex-col gap-1.5">
      <span className="text-[11.5px] font-semibold text-muted-foreground">{etiqueta}</span>
      <span className="flex items-center gap-1.5">
        <input
          readOnly
          className="num h-[34px] w-full rounded-lg border border-input bg-background px-2.5 text-right text-[12.5px]"
          value={valor === null ? '—' : String(valor)}
          aria-label={etiqueta}
        />
        <span className="text-[12.5px] text-muted-foreground">%</span>
      </span>
    </label>
  );
}

/** Un renglón de la tabla de aprobación (modelo, precios, aprobar/teclear y negociación). */
function FilaRenglon({
  linea,
  verImportes,
  puedeAprobar,
  puedeNegociar,
  puedeAdministrar,
}: {
  linea: ListaLinea;
  verImportes: boolean;
  puedeAprobar: boolean;
  puedeNegociar: boolean;
  /** `listas.administrar` — habilita QUITAR el renglón (V1-E4 punto 4). */
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const aprobar = useAprobarLinea();
  const quitar = useQuitarLineaLista();
  const [quitarAbierto, setQuitarAbierto] = useState(false);
  const [tecleoAbierto, setTecleoAbierto] = useState(false);
  const [negociacionAbierta, setNegociacionAbierta] = useState(false);
  const [expandido, setExpandido] = useState(false);

  function alAprobar(): void {
    aprobar.mutate(linea.id, {
      onSuccess: () => toast.success(`Renglón "${linea.codigoModelo}" aprobado.`),
      onError: (error) => toast.error(error.message),
    });
  }

  return (
    <>
      <TablaDensaFila data-testid="fila-renglon-lista" data-aprobado={linea.aprobado}>
        <TablaDensaCelda>
          <div className="flex items-center gap-2">
            {/* lp-exp del proto: botoncito con chevron para el desglose de costo. */}
            <button
              type="button"
              onClick={() => setExpandido((v) => !v)}
              aria-label={expandido ? 'Ocultar desglose de costo' : 'Ver desglose de costo'}
              aria-expanded={expandido}
              className="grid size-[22px] shrink-0 place-items-center rounded-md border bg-card text-muted-foreground hover:text-foreground"
              data-testid="alternar-desglose"
            >
              {expandido ? (
                <ChevronDownIcon className="size-3.5" aria-hidden />
              ) : (
                <ChevronRightIcon className="size-3.5" aria-hidden />
              )}
            </button>
            <div className="min-w-0">
              <div className="truncate font-semibold">
                {linea.descripcionModelo ?? linea.codigoModelo}
              </div>
              <div className="num truncate text-xs text-muted-foreground">
                Nuestro {linea.codigoModelo}
                {linea.numeroCliente === null ? '' : ` · ${linea.numeroCliente}`}
              </div>
            </div>
          </div>
        </TablaDensaCelda>
        <TablaDensaCelda numerica>
          {verImportes ? formatearMoneda(linea.costoUnit) : '—'}
        </TablaDensaCelda>
        <TablaDensaCelda numerica>
          {verImportes ? formatearMoneda(linea.precioCalculado) : '—'}
        </TablaDensaCelda>
        <TablaDensaCelda numerica>
          {linea.aprobado ? (
            <b className="num font-bold text-ok" data-testid="precio-aprobado">
              {verImportes ? formatearMoneda(linea.precioAprobado) : 'Aprobado'}
            </b>
          ) : (
            <span className="text-faint">—</span>
          )}
        </TablaDensaCelda>
        <TablaDensaCelda>
          {linea.aprobado ? (
            <ChipEstado tono="ok">Aprobado</ChipEstado>
          ) : (
            <ChipEstado tono="neutro">Pendiente</ChipEstado>
          )}
        </TablaDensaCelda>
        <TablaDensaCelda className="text-right whitespace-nowrap">
          <div className="flex justify-end gap-1">
            {puedeAprobar ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  onClick={alAprobar}
                  disabled={aprobar.isPending}
                  data-testid="aprobar-renglon"
                >
                  <CheckIcon aria-hidden />
                  Aprobar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setTecleoAbierto(true)}
                  data-testid="teclear-precio"
                >
                  Teclear
                </Button>
              </>
            ) : null}
            {/* La negociación (historial + comparador) la ve cualquiera con `listas.ver`; las acciones
              de negociar dentro del panel se gobiernan por `listas.negociar`. */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setNegociacionAbierta(true)}
              data-testid="abrir-negociacion"
            >
              <MessagesSquareIcon aria-hidden />
              Negociación
            </Button>
            {/* V1-E4 (punto 4): quitar el renglón. Sin esto, un desarrollo metido por error
                quedaba atrapado para siempre (`@@unique([idDesarrollo])` a nivel BD). */}
            {puedeAdministrar ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title="Quitar este renglón de la lista (queda en la bitácora)"
                aria-label={`Quitar ${linea.codigoModelo} de la lista`}
                onClick={() => setQuitarAbierto(true)}
                data-testid="quitar-renglon-lista"
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            ) : null}
          </div>
          <DialogoAjustarPrecio
            abierto={tecleoAbierto}
            alCambiarAbierto={setTecleoAbierto}
            linea={linea}
          />
          <DialogoNegociacionRenglon
            abierto={negociacionAbierta}
            alCambiarAbierto={setNegociacionAbierta}
            linea={linea}
            verImportes={verImportes}
            puedeNegociar={puedeNegociar}
          />
          {/* V1-E4 (punto 4): confirmación de quitar el renglón. */}
          <DialogoConfirmacion
            abierto={quitarAbierto}
            alCambiarAbierto={setQuitarAbierto}
            titulo="Quitar renglón de la lista"
            descripcion={
              <>
                Se quita <b>{linea.codigoModelo}</b> de esta lista, con su precio y su historial de
                negociación. Queda <b>íntegro en la bitácora</b> y el desarrollo vuelve a quedar
                disponible para otra lista.
              </>
            }
            textoConfirmar="Quitar renglón"
            variante="destructive"
            procesando={quitar.isPending}
            alConfirmar={() =>
              quitar.mutate(linea.id, {
                onSuccess: () => {
                  toast.success(`Renglón "${linea.codigoModelo}" quitado de la lista.`);
                  setQuitarAbierto(false);
                },
                onError: (error) => toast.error(error.message),
              })
            }
          />
        </TablaDensaCelda>
      </TablaDensaFila>
      {expandido ? (
        <TablaDensaFila data-testid="desglose-renglon">
          <TablaDensaCelda colSpan={6} className="bg-muted/30">
            <DesgloseCosto idLinea={linea.id} verImportes={verImportes} />
          </TablaDensaCelda>
        </TablaDensaFila>
      ) : null}
    </>
  );
}

/**
 * Desglose de costo por concepto de un renglón (§4.8): Tela · Avíos · Procesos · Corte · Maquila =
 * costo total. Server-side (A1: no se pivotea aquí). Se carga sólo al expandir el renglón.
 */
function DesgloseCosto({
  idLinea,
  verImportes,
}: {
  idLinea: number;
  verImportes: boolean;
}): React.JSX.Element {
  const consulta = useDesgloseCostoLinea(idLinea);

  if (consulta.isPending) {
    return <p className="text-sm text-muted-foreground">Cargando desglose…</p>;
  }
  if (consulta.isError) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {consulta.error.message}
      </p>
    );
  }
  const desglose = consulta.data;
  return (
    <div className="space-y-1" data-testid="desglose-costo">
      <p className="text-xs font-medium text-muted-foreground">
        Desglose del precosto v{desglose.versionPrecosto}
      </p>
      <ul className="max-w-md space-y-0.5 text-sm">
        {desglose.grupos.map((g) => (
          <li key={g.codigo} className="flex justify-between gap-4" data-testid="desglose-concepto">
            <span>{g.nombre}</span>
            <span className="tabular-nums">{verImportes ? formatearMoneda(g.subtotal) : '—'}</span>
          </li>
        ))}
        <li className="mt-1 flex justify-between gap-4 border-t pt-1 font-semibold">
          <span>Costo total</span>
          <span className="tabular-nums" data-testid="desglose-total">
            {verImportes ? formatearMoneda(desglose.costoTotal) : '—'}
          </span>
        </li>
      </ul>
    </div>
  );
}

/** Diálogo para teclear el precio aprobado de un renglón. */
function DialogoAjustarPrecio({
  abierto,
  alCambiarAbierto,
  linea,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  linea: ListaLinea;
}): React.JSX.Element {
  const ajustar = useAjustarPrecioLinea();
  const [valor, setValor] = useState('');

  function guardar(): void {
    const precio = Number(valor);
    if (!Number.isFinite(precio) || precio <= 0) {
      toast.error('Captura un precio mayor a cero.');
      return;
    }
    ajustar.mutate(
      { idLinea: linea.id, cuerpo: { precio } },
      {
        onSuccess: () => {
          toast.success(`Precio de "${linea.codigoModelo}" actualizado.`);
          alCambiarAbierto(false);
          setValor('');
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Precio de {linea.codigoModelo}</DialogTitle>
          <DialogDescription>Teclea el precio aprobado para este renglón.</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Field>
            <FieldLabel htmlFor="teclear-precio-valor">Precio</FieldLabel>
            <Input
              id="teclear-precio-valor"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              autoFocus
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              data-testid="input-precio-teclear"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={ajustar.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={guardar}
            disabled={ajustar.isPending}
            data-testid="guardar-precio-teclear"
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
