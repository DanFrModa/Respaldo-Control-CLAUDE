import {
  Building2,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Factory,
  FileText,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  ShoppingCart,
  Truck,
  UserRound,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  imprimirOc,
  useAutorizarOc,
  useDuplicarOc,
  useOrdenesCompra,
  useResumenOc,
} from '@/api/ordenes-compra';
import { useProveedores } from '@/api/proveedores';
import type {
  EstatusOrdenCompra,
  OrdenCompra,
  OrdenesCompraQuery,
  ResumenComprasQuery,
} from '@/api/tipos';
import { CajonDetalle } from '@/components/dominio/CajonDetalle';
import { KpiTiles, type Kpi } from '@/components/dominio/KpiTiles';
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
import { formatearMoneda } from '@/lib/formato';
import { useDebounce } from '@/lib/useDebounce';
import { cn } from '@/lib/utils';
import { CampoDetalle, Historial, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DetalleRenglonesOc } from './DetalleRenglonesOc';
import { DialogoCancelarOc } from './DialogoCancelarOc';
import { DialogoEditarOc } from './DialogoEditarOc';
import { ETIQUETA_ESTATUS_OC, EstatusOcBadge, fechaCortaOc } from './piezas';

/** Renglones por página del listado. */
const POR_PAGINA = 10;

/** Estatus para el filtro (todos los del enum). */
const ESTATUS_FILTRO: readonly EstatusOrdenCompra[] = [
  'borrador',
  'pendiente_autorizacion',
  'autorizada',
  'recibida_parcial',
  'recibida_total',
  'cancelada',
];

/**
 * ÓRDENES DE COMPRA (F4-E2, proto `vCompras` — re-vestido R9 a TABLA-FIRST): compras a proveedores
 * (make-to-order) con filtros arriba (proveedor, estatus, rango de fechas, búsqueda), tabla densa con
 * su estatus y órdenes de producción ligadas, barra de totales al pie (importe de la página) y un
 * CAJÓN de detalle al hacer clic (encabezado, renglones con su matriz talla×color, órdenes ligadas y
 * total DERIVADO). Crear/editar/duplicar exigen `compras.administrar`; autorizar `compras.autorizar`;
 * cancelar `compras.cancelar`. Las acciones se ocultan sin permiso; la decisión real la toma el
 * backend (A1). Reemplaza OrdCompraVer / OrdCompra / OrdCompraDet del sistema viejo.
 *
 * FIDELIDAD vs proto: los KPIs "OC abiertas" y "$ por recibir" los sirve ahora el resumen de cabecera
 * (`GET /api/ordenes-compra/resumen`, agregado EN SERVIDOR bajo el mismo filtro — A1, sin pivote en
 * cliente): `$ por recibir` = Σ (cantidad − recibido) × precio de las líneas de las OC abiertas, con el
 * MISMO criterio de `recibido` que la recepción. Los otros dos KPIs del proto (faltantes MRP · recibido
 * a tiempo) viven donde está su dato: el banner de faltantes en Explosión/Estatus de materiales; el
 * "a tiempo" es de Indicadores. La barra de avance de recepción por OC la comunica el estatus
 * (parcial/total). Nada se deriva/pivotea en cliente.
 */
export function OrdenesCompraPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('compras.administrar');
  const puedeAutorizar = tienePermiso('compras.autorizar');
  const puedeCancelar = tienePermiso('compras.cancelar');
  // El backend permite editar una OC autorizada SOLO a admin (`roles.administrar`), igual que el
  // precedente del proyecto (TiposProcesoPagina). Debe coincidir con el permiso del backend para no
  // ofrecer un "Editar" que se coma un 409.
  const esAdmin = tienePermiso('roles.administrar');

  // ── Estado de la vista ─────────────────────────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [incluirCanceladas, setIncluirCanceladas] = useState(false);
  const [idProveedor, setIdProveedor] = useState<number | null>(null);
  const [estatus, setEstatus] = useState<EstatusOrdenCompra | ''>('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [pagina, setPagina] = useState(1);

  const proveedores = useProveedores({ pagina: 1, porPagina: 100, ordenarPor: 'nombre' });

  const query: OrdenesCompraQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'numCompra',
    direccion: 'desc',
    incluirCanceladas: incluirCanceladas ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(idProveedor !== null ? { idProveedor } : {}),
    ...(estatus !== '' ? { estatus } : {}),
    ...(fechaDesde !== '' ? { fechaDesde } : {}),
    ...(fechaHasta !== '' ? { fechaHasta } : {}),
  };

  const consulta = useOrdenesCompra(query);
  const autorizar = useAutorizarOc();
  const duplicar = useDuplicarOc();

  // Resumen de cabecera (KPIs): mismo universo por proveedor/fecha/búsqueda, pero SOLO OC abiertas
  // (el servidor fuerza `autorizada`/`recibida_parcial`); no toma estatus/incluir-canceladas.
  const resumenQuery: ResumenComprasQuery = {
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(idProveedor !== null ? { idProveedor } : {}),
    ...(fechaDesde !== '' ? { fechaDesde } : {}),
    ...(fechaHasta !== '' ? { fechaHasta } : {}),
  };
  const resumen = useResumenOc(resumenQuery);
  const kpis: Kpi[] = [
    {
      clave: 'oc-abiertas',
      etiqueta: 'OC abiertas',
      valor: (resumen.data?.ocAbiertas ?? 0).toLocaleString('es-MX'),
      pie: 'autorizadas o con recepción parcial',
    },
    {
      clave: 'por-recibir',
      etiqueta: '$ por recibir',
      valor: formatearMoneda(resumen.data?.porRecibir ?? 0),
      pie: 'pendiente de recepción (a precio de OC)',
    },
  ];

  // ── Diálogos + cajón ─────────────────────────────────────────────────────────
  const [editar, setEditar] = useState<{ oc?: OrdenCompra; soloLectura: boolean } | null>(null);
  const [aCancelar, setACancelar] = useState<OrdenCompra | null>(null);
  const [seleccion, setSeleccion] = useState<OrdenCompra | null>(null);

  function reiniciar(): void {
    setPagina(1);
  }

  function autorizarOc(oc: OrdenCompra): void {
    autorizar.mutate(oc.id, {
      onSuccess: (guardada) => toast.success(`Orden de compra ${guardada.numCompra} autorizada.`),
      onError: (error) => toast.error(error.message),
    });
  }

  function duplicarOc(oc: OrdenCompra): void {
    duplicar.mutate(oc.id, {
      onSuccess: (nueva) => {
        toast.success(`Orden de compra ${nueva.numCompra} creada (copia en borrador).`);
        setPagina(1);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  /** ¿La OC se puede editar desde la UI? (el backend re-decide; admin puede tocar autorizadas). */
  function puedeEditar(oc: OrdenCompra): boolean {
    if (!puedeAdministrar || oc.estatus === 'cancelada') {
      return false;
    }
    return oc.estatus !== 'autorizada' &&
      oc.estatus !== 'recibida_parcial' &&
      oc.estatus !== 'recibida_total'
      ? true
      : esAdmin;
  }

  const datos = consulta.data;
  const filas = datos?.datos ?? [];
  const total = datos?.total ?? 0;
  const totalPaginas = datos?.totalPaginas ?? 1;
  // Suma de PRESENTACIÓN de los importes visibles (cada `total` ya lo derivó el servidor, A1).
  const importePagina = filas.reduce((a, o) => a + o.total, 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 md:p-5">
      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">Órdenes de compra</h1>
          <p className="truncate text-xs text-muted-foreground">
            Compras a proveedores (make-to-order) · sus renglones, órdenes ligadas y total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void consulta.refetch()}
            data-testid="actualizar-oc"
          >
            <RefreshCw className={cn(consulta.isFetching && 'animate-spin')} aria-hidden />
            Actualizar
          </Button>
          {puedeAdministrar ? (
            <Button
              size="sm"
              onClick={() => setEditar({ soloLectura: false })}
              data-testid="nuevo-oc"
            >
              <Plus aria-hidden />
              Nueva OC
            </Button>
          ) : null}
        </div>
      </header>

      {/* ── KPIs de vistazo (resumen de cabecera, agregado en servidor) ──────── */}
      <KpiTiles kpis={kpis} className="shrink-0" />

      {/* ── Card: filtros + tabla + totales ─────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          <SelectNativo
            className="h-8 w-auto text-sm"
            aria-label="Filtrar por proveedor"
            value={idProveedor === null ? '' : String(idProveedor)}
            onChange={(e) => {
              setIdProveedor(e.target.value === '' ? null : Number(e.target.value));
              reiniciar();
            }}
            data-testid="filtro-proveedor-oc"
          >
            <option value="">Todos los proveedores</option>
            {(proveedores.data?.datos ?? []).map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.nombre}
              </option>
            ))}
          </SelectNativo>
          <SelectNativo
            className="h-8 w-auto text-sm"
            aria-label="Filtrar por estatus"
            value={estatus}
            onChange={(e) => {
              setEstatus(e.target.value as EstatusOrdenCompra | '');
              reiniciar();
            }}
            data-testid="filtro-estatus-oc"
          >
            <option value="">Todos los estatus</option>
            {ESTATUS_FILTRO.map((s) => (
              <option key={s} value={s}>
                {ETIQUETA_ESTATUS_OC[s]}
              </option>
            ))}
          </SelectNativo>
          <Input
            type="date"
            className="h-8 w-auto text-sm"
            aria-label="Fecha desde"
            value={fechaDesde}
            onChange={(e) => {
              setFechaDesde(e.target.value);
              reiniciar();
            }}
            data-testid="filtro-fecha-desde-oc"
          />
          <Input
            type="date"
            className="h-8 w-auto text-sm"
            aria-label="Fecha hasta"
            value={fechaHasta}
            onChange={(e) => {
              setFechaHasta(e.target.value);
              reiniciar();
            }}
            data-testid="filtro-fecha-hasta-oc"
          />
          <Input
            type="search"
            className="h-8 w-48 text-sm"
            placeholder="Buscar folio o proveedor…"
            value={textoBusqueda}
            onChange={(e) => {
              setTextoBusqueda(e.target.value);
              reiniciar();
            }}
            data-testid="buscar-oc"
          />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={incluirCanceladas}
              onChange={() => {
                setIncluirCanceladas((v) => !v);
                reiniciar();
              }}
              data-testid="incluir-canceladas-oc"
            />
            Incluir canceladas
          </label>
          <div className="ml-auto">
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {total.toLocaleString('es-MX')} OC
            </span>
          </div>
        </div>

        {/* ── Cuerpo scrolleable ─────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-auto">
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
            <p className="p-6 text-sm text-muted-foreground">Cargando órdenes de compra…</p>
          ) : filas.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground" data-testid="oc-vacio">
              No hay órdenes de compra que coincidan con la búsqueda.
            </p>
          ) : (
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>OC</TablaDensaHead>
                  <TablaDensaHead>Proveedor</TablaDensaHead>
                  <TablaDensaHead>Emisión</TablaDensaHead>
                  <TablaDensaHead>Entrega</TablaDensaHead>
                  <TablaDensaHead>Contra orden</TablaDensaHead>
                  <TablaDensaHead>Estado</TablaDensaHead>
                  <TablaDensaHead numerica>Total</TablaDensaHead>
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {filas.map((oc) => (
                  <TablaDensaFila
                    key={oc.id}
                    seleccionada={seleccion?.id === oc.id}
                    className="cursor-pointer"
                    onClick={() => setSeleccion(oc)}
                    data-testid="fila-oc"
                  >
                    <TablaDensaCelda className="num font-medium">OC {oc.numCompra}</TablaDensaCelda>
                    <TablaDensaCelda className="font-medium">{oc.proveedor}</TablaDensaCelda>
                    <TablaDensaCelda className="num text-muted-foreground">
                      {fechaCortaOc(oc.fecha)}
                    </TablaDensaCelda>
                    <TablaDensaCelda className="num text-muted-foreground">
                      {fechaCortaOc(oc.fechaEntrega)}
                    </TablaDensaCelda>
                    <TablaDensaCelda className="num text-muted-foreground">
                      {oc.ordenesLigadas.length === 0
                        ? '—'
                        : `${oc.ordenesLigadas[0]?.folio ?? ''}${
                            oc.ordenesLigadas.length > 1
                              ? ` (+${oc.ordenesLigadas.length - 1})`
                              : ''
                          }`}
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      <EstatusOcBadge estatus={oc.estatus} />
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica className="font-semibold">
                      {formatearMoneda(oc.total)}
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
            <span className="text-[10.5px] font-medium text-faint uppercase">OC (filtro)</span>
            <b className="num">{total.toLocaleString('es-MX')}</b>
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10.5px] font-medium text-faint uppercase">Importe (página)</span>
            <b className="num text-primary">{formatearMoneda(importePagina)}</b>
          </span>
          <span className="ml-auto flex items-center gap-1 text-muted-foreground">
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

      {/* ── Cajón de detalle de la OC ───────────────────────────────────────── */}
      <CajonDetalle
        abierto={seleccion !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) setSeleccion(null);
        }}
        titulo={seleccion !== null ? `OC ${seleccion.numCompra}` : ''}
        subtitulo={seleccion !== null ? seleccion.proveedor : undefined}
      >
        {seleccion !== null ? (
          <div className="space-y-4" data-testid="detalle-oc">
            {/* Acciones (según permiso + estatus). */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => imprimirOc(seleccion.id)}
                data-testid="imprimir-oc"
              >
                <Printer aria-hidden />
                Imprimir
              </Button>
              {puedeEditar(seleccion) ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditar({ oc: seleccion, soloLectura: false })}
                  data-testid="editar-oc"
                >
                  <Pencil aria-hidden />
                  Editar
                </Button>
              ) : puedeAdministrar ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditar({ oc: seleccion, soloLectura: true })}
                  data-testid="ver-oc"
                >
                  <FileText aria-hidden />
                  Ver
                </Button>
              ) : null}
              {puedeAdministrar ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => duplicarOc(seleccion)}
                  disabled={duplicar.isPending}
                  data-testid="duplicar-oc"
                >
                  <Copy aria-hidden />
                  Duplicar
                </Button>
              ) : null}
              {puedeAutorizar && seleccion.estatus === 'pendiente_autorizacion' ? (
                <Button
                  size="sm"
                  onClick={() => autorizarOc(seleccion)}
                  disabled={autorizar.isPending}
                  data-testid="autorizar-oc"
                >
                  <CheckCircle2 aria-hidden />
                  Autorizar
                </Button>
              ) : null}
              {puedeCancelar && seleccion.estatus !== 'cancelada' ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setACancelar(seleccion)}
                  data-testid="cancelar-oc"
                >
                  <XCircle aria-hidden />
                  Cancelar
                </Button>
              ) : null}
            </div>

            <DetalleOc oc={seleccion} />
          </div>
        ) : null}
      </CajonDetalle>

      {editar !== null ? (
        <DialogoEditarOc
          abierto
          alCambiarAbierto={(abierto) => {
            if (!abierto) {
              setEditar(null);
            }
          }}
          oc={editar.oc}
          soloLectura={editar.soloLectura}
          alGuardada={() => {
            setTextoBusqueda('');
            setPagina(1);
          }}
        />
      ) : null}

      <DialogoCancelarOc
        abierto={aCancelar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setACancelar(null);
          }
        }}
        oc={aCancelar ?? undefined}
      />
    </div>
  );
}

/** Panel de DETALLE de una OC: encabezado, renglones (con matriz), órdenes ligadas y total. */
function DetalleOc({ oc }: { oc: OrdenCompra }): React.JSX.Element {
  return (
    <>
      <SeccionDetalle titulo="Datos de la orden de compra" icono={ShoppingCart}>
        <RejillaCampos>
          <CampoDetalle icono={UserRound} etiqueta="Proveedor">
            <span className="font-medium">{oc.proveedor}</span>
          </CampoDetalle>
          <CampoDetalle icono={Building2} etiqueta="Estatus">
            <EstatusOcBadge estatus={oc.estatus} />
          </CampoDetalle>
          <CampoDetalle icono={Calendar} etiqueta="Emisión">
            {fechaCortaOc(oc.fecha)}
          </CampoDetalle>
          <CampoDetalle icono={Calendar} etiqueta="Entrega">
            {fechaCortaOc(oc.fechaEntrega)}
          </CampoDetalle>
          <CampoDetalle icono={Truck} etiqueta="Entregar en">
            {oc.entregaEn ?? '—'}
          </CampoDetalle>
          <CampoDetalle icono={FileText} etiqueta="Corresponde a">
            {oc.correspondeA ?? '—'}
          </CampoDetalle>
        </RejillaCampos>

        {oc.observaciones ? (
          <p className="rounded-md border bg-muted/30 p-3 text-sm">{oc.observaciones}</p>
        ) : null}

        {oc.estatus === 'cancelada' && oc.motivoCancelacion ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <span className="font-medium text-destructive">Cancelada:</span> {oc.motivoCancelacion}
          </p>
        ) : null}
      </SeccionDetalle>

      <SeccionDetalle titulo="Renglones" icono={ShoppingCart}>
        <DetalleRenglonesOc oc={oc} />
      </SeccionDetalle>

      {oc.ordenesLigadas.length > 0 ? (
        <SeccionDetalle titulo="Órdenes de producción ligadas" icono={Factory}>
          <ul className="flex flex-wrap gap-2">
            {oc.ordenesLigadas.map((liga) => (
              <li
                key={liga.idOrden}
                className="rounded-md border bg-muted/30 px-2.5 py-1 text-sm"
                data-testid="orden-ligada-oc"
              >
                Orden {liga.folio}
              </li>
            ))}
          </ul>
        </SeccionDetalle>
      ) : null}

      <Historial creadoEn={oc.creadoEn} modificadoEn={oc.modificadoEn} />
    </>
  );
}
