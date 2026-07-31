import { Layers, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useClientes } from '@/api/clientes';
import { useWipOrden, useTableroWip } from '@/api/wip';
import type { TableroWipQuery, WipOrden, WipOrdenFila, WipProcesoPendiente } from '@/api/tipos';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { useDebounce } from '@/lib/useDebounce';
import { useSesion } from '@/sesion/useSesion';

/** Renglones por página del tablero. */
const POR_PAGINA = 20;

/** Valor del filtro de cliente que significa "todos". */
const TODOS = 'TODOS';

/** Formatea un entero con separadores de miles (es-MX). */
function fmt(n: number): string {
  return n.toLocaleString('es-MX');
}

/**
 * TABLERO WIP (F3-E5, form `Proceso` del viejo; proto `vProduccion` — re-vestido R9). Avance de cada
 * orden por etapa, DERIVADO en el servidor (suma de etapas, sin acumuladores). Kit tabla-first del
 * rediseño: page-head + KPIs de vistazo + card con barra de herramientas (búsqueda folio/modelo/
 * cliente/referencia D7 + filtro por cliente + "solo pendientes") + TABLA DENSA + barra de totales al
 * pie con paginación. Al abrir una orden se ve el drill-down color×talla ("faltan 12 pzas talla 6
 * color rojo"). RESPONSIVE: tabla en escritorio, tarjetas en móvil (las consultas también son móviles).
 *
 * FIDELIDAD vs proto: los KPIs de PIEZAS por etapa los sirve ahora el propio endpoint `/produccion/wip`
 * en su `totales` (agregado EN SERVIDOR sobre TODO el universo filtrado, mismo criterio D3/D4 que las
 * filas y que `kpisWip` de Indicadores — A1, sin pivote en cliente). Se muestran las cuatro etapas
 * pendientes reales del pipeline (Por cortar / Por enviar / Por recibir / Por entregar) — las mismas que
 * rotula la tabla; el desglose fino del proto "en maquila vs en estampado" (por TipoProceso) vive en el
 * drill-down de la orden. Se conserva "Órdenes en piso" para el contexto de conteo.
 *
 * `produccion.wip-ver` gobierna el acceso a la pantalla.
 */
export function TableroWipPagina(): React.JSX.Element {
  const navigate = useNavigate();
  const { tienePermiso } = useSesion();
  const puedeCortar = tienePermiso('produccion.corte');

  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [idCliente, setIdCliente] = useState<string>(TODOS);
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [ordenDrill, setOrdenDrill] = useState<number | undefined>(undefined);

  const clientes = useClientes({ pagina: 1, porPagina: 100, ordenarPor: 'nombre' });

  /** Filtros comunes (búsqueda + cliente), compartidos por la consulta y el conteo de pendientes. */
  const filtrosComunes = {
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(idCliente !== TODOS ? { idCliente: Number(idCliente) } : {}),
  } as const;

  const query: TableroWipQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'folio',
    direccion: 'desc',
    // El querystring espera stringbool ("true"/"false"); solo se manda cuando se piden pendientes.
    ...(soloPendientes ? { soloPendientes: 'true' } : {}),
    ...filtrosComunes,
  };

  const consulta = useTableroWip(query);
  const datos = consulta.data;
  const filas = datos?.datos ?? [];
  const totalPaginas = datos?.totalPaginas ?? 0;

  // Agregado de PIEZAS por etapa (Σ de servidor sobre el universo filtrado; nunca pivote en cliente).
  const totales = datos?.totales;
  const kpis: Kpi[] = [
    {
      clave: 'ordenes',
      etiqueta: 'Órdenes en piso',
      valor: fmt(datos?.total ?? 0),
      pie: 'coinciden con el filtro',
    },
    {
      clave: 'por-cortar',
      etiqueta: 'Por cortar',
      valor: fmt(totales?.porCortar ?? 0),
      sufijo: 'pzas',
      pie: 'pedido − cortado',
    },
    {
      clave: 'por-enviar',
      etiqueta: 'Por enviar',
      valor: fmt(totales?.cortadoPorEnviar ?? 0),
      sufijo: 'pzas',
      pie: 'cortado − enviado a maquila',
    },
    {
      clave: 'por-recibir',
      etiqueta: 'Por recibir',
      valor: fmt(totales?.porRecibir ?? 0),
      sufijo: 'pzas',
      pie: 'en poder de maquila',
    },
    {
      clave: 'por-entregar',
      etiqueta: 'Por entregar',
      valor: fmt(totales?.porEntregar ?? 0),
      sufijo: 'pzas',
      pie: 'recibido − entregado a cliente',
    },
  ];

  /** Reinicia la paginación al cambiar un filtro. */
  function reiniciar(): void {
    setPagina(1);
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 md:p-5 lg:overflow-visible"
      data-testid="tablero-wip"
    >
      {/* ── Encabezado (proto `page-head`: sin mosaico de icono) ───────────── */}
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Producción · WIP
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Trabajo en proceso por etapa · tiempo real (derivado de los movimientos)
          </p>
        </div>
        {puedeCortar ? (
          <Button
            size="sm"
            onClick={() => void navigate('/produccion/corte')}
            data-testid="wip-ir-corte"
          >
            <Plus aria-hidden />
            Registrar corte
          </Button>
        ) : null}
      </header>

      {/* ── KPIs ────────────────────────────────────────────────────────────── */}
      <KpiTiles kpis={kpis} className="shrink-0" />

      {/* ── Card: filtros + tabla + totales ─────────────────────────────────── */}
      <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border bg-card lg:min-h-0 lg:flex-1 lg:shrink">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          <div className="relative w-64">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={textoBusqueda}
              onChange={(e) => {
                setTextoBusqueda(e.target.value);
                reiniciar();
              }}
              placeholder="Folio, modelo, cliente o referencia"
              className="h-8 pl-8 text-sm"
              data-testid="wip-busqueda"
              aria-label="Buscar órdenes"
            />
          </div>
          {/* SelectNativo envuelve el <select> en un div w-full: sin ancho fijo alrededor se roba
              un renglón completo de la barra (visto en la foto de fidelidad R9). */}
          <SelectNativo
            className="w-44 h-8 text-sm"
            value={idCliente}
            onChange={(e) => {
              setIdCliente(e.target.value);
              reiniciar();
            }}
            aria-label="Filtrar por cliente"
            data-testid="wip-cliente"
          >
            <option value={TODOS}>Todos los clientes</option>
            {(clientes.data?.datos ?? []).map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.nombre}
              </option>
            ))}
          </SelectNativo>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={soloPendientes}
              onChange={(e) => {
                setSoloPendientes(e.target.checked);
                reiniciar();
              }}
              data-testid="wip-solo-pendientes"
            />
            Solo con pendientes
          </label>
          <div className="ml-auto">
            <span className="text-[12px] text-faint">{fmt(datos?.total ?? 0)} órdenes</span>
          </div>
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
            <p className="p-6 text-sm text-muted-foreground">Cargando órdenes…</p>
          ) : filas.length === 0 ? (
            <p
              className="m-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
              data-testid="wip-vacio"
            >
              No hay órdenes que coincidan con los filtros.
            </p>
          ) : (
            <>
              {/* Móvil: tarjetas apiladas. */}
              <div className="space-y-3 p-3 md:hidden" data-testid="wip-tarjetas">
                {filas.map((f) => (
                  <div key={f.idOrden} className="space-y-2 rounded-lg border bg-card p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">
                          #{f.folio} · {f.codigoModelo}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{f.cliente}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setOrdenDrill(f.idOrden)}
                        data-testid="wip-detalle"
                      >
                        <Layers className="size-4" aria-hidden />
                        Detalle
                      </Button>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      <Metrica etiqueta="Pedido" valor={f.pedido} />
                      <Metrica etiqueta="Por cortar" valor={f.porCortar} resaltar />
                      <Metrica etiqueta="Por enviar" valor={f.cortadoPorEnviar} resaltar />
                      <Metrica etiqueta="Por recibir" valor={f.porRecibir} resaltar />
                      <Metrica etiqueta="Por entregar" valor={f.porEntregar} resaltar />
                    </dl>
                  </div>
                ))}
              </div>

              {/* Escritorio: tabla densa. */}
              <div className="hidden md:block" data-testid="wip-tabla">
                <TablaDensa>
                  <TablaDensaEncabezado>
                    <TablaDensaFila>
                      <TablaDensaHead>Orden</TablaDensaHead>
                      <TablaDensaHead>Modelo</TablaDensaHead>
                      <TablaDensaHead>Cliente</TablaDensaHead>
                      <TablaDensaHead numerica>Pedido</TablaDensaHead>
                      <TablaDensaHead numerica>Por cortar</TablaDensaHead>
                      <TablaDensaHead numerica>Por enviar</TablaDensaHead>
                      <TablaDensaHead numerica>Por recibir</TablaDensaHead>
                      <TablaDensaHead numerica>Por entregar</TablaDensaHead>
                      <TablaDensaHead className="text-right">Detalle</TablaDensaHead>
                    </TablaDensaFila>
                  </TablaDensaEncabezado>
                  <TablaDensaCuerpo>
                    {filas.map((f) => (
                      <FilaWip
                        key={f.idOrden}
                        fila={f}
                        seleccionada={ordenDrill === f.idOrden}
                        alAbrir={() => setOrdenDrill(f.idOrden)}
                      />
                    ))}
                  </TablaDensaCuerpo>
                </TablaDensa>
              </div>
            </>
          )}
        </div>

        {/* ── Barra de totales al pie ────────────────────────────────────── */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-t bg-secondary px-3 py-1.5 text-xs">
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10.5px] font-medium text-faint uppercase">Órdenes (filtro)</span>
            <b className="num">{fmt(datos?.total ?? 0)}</b>
          </span>
          {datos && datos.total > 0 ? (
            <span
              className="ml-auto flex items-center gap-2 text-muted-foreground"
              data-testid="wip-paginacion"
            >
              Página {datos.pagina} de {totalPaginas}
              <Button
                variant="ghost"
                size="sm"
                disabled={datos.pagina <= 1 || consulta.isFetching}
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
              >
                Anterior
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={datos.pagina >= totalPaginas || consulta.isFetching}
                onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              >
                Siguiente
              </Button>
            </span>
          ) : null}
        </div>
      </div>

      <DrillDownOrden idOrden={ordenDrill} alCerrar={() => setOrdenDrill(undefined)} />
    </div>
  );
}

/** Un par etiqueta/valor de las tarjetas móviles. `resaltar` marca los pendientes ≠ 0. */
function Metrica({
  etiqueta,
  valor,
  resaltar = false,
}: {
  etiqueta: string;
  valor: number;
  resaltar?: boolean;
}): React.JSX.Element {
  const fuerte = resaltar && valor !== 0;
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{etiqueta}</dt>
      <dd className={`num ${fuerte ? 'font-semibold text-warn' : ''}`}>{fmt(valor)}</dd>
    </div>
  );
}

/** Celda numérica de la tabla; resalta los pendientes ≠ 0 (ámbar = falta trabajo). */
function CeldaPendiente({ valor }: { valor: number }): React.JSX.Element {
  return (
    <TablaDensaCelda
      numerica
      className={valor !== 0 ? 'font-semibold text-warn' : 'text-muted-foreground'}
    >
      {fmt(valor)}
    </TablaDensaCelda>
  );
}

/** Una fila del tablero (escritorio). */
function FilaWip({
  fila,
  seleccionada,
  alAbrir,
}: {
  fila: WipOrdenFila;
  seleccionada: boolean;
  alAbrir: () => void;
}): React.JSX.Element {
  return (
    <TablaDensaFila seleccionada={seleccionada} data-testid="wip-fila">
      <TablaDensaCelda className="font-medium">#{fila.folio}</TablaDensaCelda>
      <TablaDensaCelda>{fila.codigoModelo}</TablaDensaCelda>
      <TablaDensaCelda className="text-muted-foreground">{fila.cliente}</TablaDensaCelda>
      <TablaDensaCelda numerica>{fmt(fila.pedido)}</TablaDensaCelda>
      <CeldaPendiente valor={fila.porCortar} />
      <CeldaPendiente valor={fila.cortadoPorEnviar} />
      <CeldaPendiente valor={fila.porRecibir} />
      <CeldaPendiente valor={fila.porEntregar} />
      <TablaDensaCelda className="text-right">
        <Button variant="ghost" size="sm" onClick={alAbrir} data-testid="wip-detalle">
          <Layers className="size-4" aria-hidden />
          Ver
        </Button>
      </TablaDensaCelda>
    </TablaDensaFila>
  );
}

/** Dialog con el drill-down de una orden (pendientes por etapa, color×talla). */
function DrillDownOrden({
  idOrden,
  alCerrar,
}: {
  idOrden: number | undefined;
  alCerrar: () => void;
}): React.JSX.Element {
  const consulta = useWipOrden(idOrden);
  const detalle = consulta.data;

  return (
    <Dialog open={idOrden !== undefined} onOpenChange={(abierto) => (!abierto ? alCerrar() : null)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl" data-testid="wip-drill">
        <DialogHeader>
          <DialogTitle>
            {detalle ? `Avance de la orden #${detalle.folio}` : 'Avance de la orden'}
          </DialogTitle>
          <DialogDescription>
            {detalle
              ? `${detalle.codigoModelo} · ${detalle.cliente}`
              : 'Pendientes por etapa y color × talla.'}
          </DialogDescription>
        </DialogHeader>

        {consulta.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {consulta.error.message}
          </p>
        ) : consulta.isPending || detalle === undefined ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : (
          <DetalleAvance detalle={detalle} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Cuerpo del drill-down: totales + matrices de pendientes por etapa. */
function DetalleAvance({ detalle }: { detalle: WipOrden }): React.JSX.Element {
  return (
    <div className="space-y-5">
      {/* Resumen de totales. */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        <Metrica etiqueta="Pedido" valor={detalle.pedido} />
        <Metrica etiqueta="Cortado" valor={detalle.cortado} />
        <Metrica etiqueta="Enviado" valor={detalle.enviado} />
        <Metrica etiqueta="Recibido" valor={detalle.recibido} />
        <Metrica etiqueta="Recibido costura" valor={detalle.recibidoCostura} />
        <Metrica etiqueta="Entregado" valor={detalle.entregado} />
        <Metrica etiqueta="Por entregar" valor={detalle.porEntregar} resaltar />
      </dl>

      {/* Por cortar (color×talla). */}
      <MatrizPendiente
        titulo="Por cortar"
        celdas={detalle.porCortar.filter((c) => c.cantidad !== 0)}
        vacio="Todo lo pedido está cortado."
      />

      {/* Cortado por enviar, por proceso. */}
      <SeccionProcesos titulo="Cortado por enviar" procesos={detalle.cortadoPorEnviar} />

      {/* Por recibir, por proceso. */}
      <SeccionProcesos titulo="Por recibir" procesos={detalle.porRecibir} />

      {/* Entregado a cliente (color×talla). */}
      <MatrizPendiente
        titulo="Entregado a cliente"
        celdas={detalle.entregadoCeldas}
        vacio="Aún no hay entregas al cliente."
      />
    </div>
  );
}

/** Una matriz de celdas color×talla pendientes (o un mensaje si no hay). */
function MatrizPendiente({
  titulo,
  celdas,
  vacio,
}: {
  titulo: string;
  celdas: WipOrden['porCortar'];
  vacio: string;
}): React.JSX.Element {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{titulo}</h3>
      {celdas.length === 0 ? (
        <p className="text-xs text-muted-foreground">{vacio}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Color</TableHead>
                <TableHead>Talla</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {celdas.map((c) => (
                <TableRow key={`${c.idColor}-${c.idTalla}`}>
                  <TableCell>{c.color}</TableCell>
                  <TableCell>{c.etiquetaTalla}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {fmt(c.cantidad)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

/** Las matrices de pendientes de varios procesos (cortado por enviar / por recibir). */
function SeccionProcesos({
  titulo,
  procesos,
}: {
  titulo: string;
  procesos: WipProcesoPendiente[];
}): React.JSX.Element {
  const conPendiente = procesos.filter((p) => p.celdas.length > 0);
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{titulo}</h3>
      {conPendiente.length === 0 ? (
        <p className="text-xs text-muted-foreground">No hay pendientes en esta etapa.</p>
      ) : (
        conPendiente.map((p) => (
          <MatrizPendiente
            key={p.idTipoProceso}
            titulo={`${p.tipoProceso}${p.generaEntradaPt ? ' (entra a PT)' : ''}`}
            celdas={p.celdas}
            vacio="Sin pendientes."
          />
        ))
      )}
    </section>
  );
}
