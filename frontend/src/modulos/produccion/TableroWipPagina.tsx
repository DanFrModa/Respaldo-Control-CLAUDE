import { Factory, Layers, Search } from 'lucide-react';
import { useState } from 'react';

import { useClientes } from '@/api/clientes';
import { useWipOrden, useTableroWip } from '@/api/wip';
import type { TableroWipQuery, WipOrden, WipOrdenFila, WipProcesoPendiente } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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

/** Renglones por página del tablero. */
const POR_PAGINA = 20;

/** Valor del filtro de cliente que significa "todos". */
const TODOS = 'TODOS';

/** Formatea un entero con separadores de miles (es-MX). */
function fmt(n: number): string {
  return n.toLocaleString('es-MX');
}

/**
 * TABLERO WIP (F3-E5, form `Proceso` del viejo): avance de cada orden por etapa, DERIVADO en el
 * servidor (suma de etapas, sin acumuladores). Tabla resumen con búsqueda (folio/modelo/cliente/
 * referencia D7) + filtro por cliente y "solo pendientes". Al abrir una orden se ve el drill-down a
 * color×talla ("faltan 12 pzas talla 6 color rojo"). RESPONSIVE: tabla en escritorio, tarjetas en
 * móvil (las consultas también son móviles, regla del plan).
 *
 * `produccion.wip-ver` gobierna el acceso a la pantalla.
 */
export function TableroWipPagina(): React.JSX.Element {
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [idCliente, setIdCliente] = useState<string>(TODOS);
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [ordenDrill, setOrdenDrill] = useState<number | undefined>(undefined);

  const clientes = useClientes({ pagina: 1, porPagina: 100, ordenarPor: 'nombre' });

  const query: TableroWipQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'folio',
    direccion: 'desc',
    // El querystring espera stringbool ("true"/"false"); solo se manda cuando se piden pendientes.
    ...(soloPendientes ? { soloPendientes: 'true' } : {}),
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(idCliente !== TODOS ? { idCliente: Number(idCliente) } : {}),
  };

  const consulta = useTableroWip(query);
  const datos = consulta.data;
  const filas = datos?.datos ?? [];
  const totalPaginas = datos?.totalPaginas ?? 0;

  /** Reinicia la paginación al cambiar un filtro. */
  function reiniciar(): void {
    setPagina(1);
  }

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="tablero-wip">
      <header className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
          <Factory className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Tablero WIP</h1>
          <p className="text-sm text-muted-foreground">
            Avance de cada orden por etapa (corte, envío, recibo y entrega), derivado de las etapas.
          </p>
        </div>
      </header>

      {/* Filtros */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2 lg:col-span-2">
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
            className="pl-8"
            data-testid="wip-busqueda"
            aria-label="Buscar órdenes"
          />
        </div>
        <SelectNativo
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
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={soloPendientes}
            onChange={(e) => {
              setSoloPendientes(e.target.checked);
              reiniciar();
            }}
            data-testid="wip-solo-pendientes"
            className="size-4 rounded border-input"
          />
          Solo con pendientes
        </label>
      </div>

      {consulta.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {consulta.error.message}
        </p>
      ) : consulta.isPending ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : filas.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No hay órdenes que coincidan con los filtros.
        </p>
      ) : (
        <>
          {/* Móvil: tarjetas apiladas. */}
          <div className="space-y-3 md:hidden" data-testid="wip-tarjetas">
            {filas.map((f) => (
              <Card key={f.idOrden}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        #{f.folio} · {f.codigoModelo}
                      </p>
                      <p className="text-xs text-muted-foreground">{f.cliente}</p>
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
                    <Metrica etiqueta="Cortado" valor={f.cortado} />
                    <Metrica etiqueta="Por enviar" valor={f.cortadoPorEnviar} resaltar />
                    <Metrica etiqueta="Enviado" valor={f.enviado} />
                    <Metrica etiqueta="Por recibir" valor={f.porRecibir} resaltar />
                    <Metrica etiqueta="Recibido" valor={f.recibido} />
                    <Metrica etiqueta="Por entregar" valor={f.porEntregar} resaltar />
                  </dl>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Escritorio: tabla. */}
          <div
            className="hidden overflow-x-auto rounded-md border md:block"
            data-testid="wip-tabla"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Folio</TableHead>
                  <TableHead>Modelo</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Pedido</TableHead>
                  <TableHead className="text-right">Por cortar</TableHead>
                  <TableHead className="text-right">Por enviar</TableHead>
                  <TableHead className="text-right">Por recibir</TableHead>
                  <TableHead className="text-right">Por entregar</TableHead>
                  <TableHead className="text-right">Detalle</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.map((f) => (
                  <FilaWip key={f.idOrden} fila={f} alAbrir={() => setOrdenDrill(f.idOrden)} />
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Paginación */}
          {datos && datos.total > 0 ? (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {fmt(datos.total)} órdenes · página {datos.pagina} de {totalPaginas}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={datos.pagina <= 1 || consulta.isFetching}
                  onClick={() => setPagina((p) => Math.max(1, p - 1))}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={datos.pagina >= totalPaginas || consulta.isFetching}
                  onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}

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
      <dd className={`tabular-nums ${fuerte ? 'font-semibold text-foreground' : ''}`}>
        {fmt(valor)}
      </dd>
    </div>
  );
}

/** Celda numérica de la tabla; resalta los pendientes ≠ 0. */
function CeldaPendiente({ valor }: { valor: number }): React.JSX.Element {
  return (
    <TableCell
      className={`text-right tabular-nums ${valor !== 0 ? 'font-semibold' : 'text-muted-foreground'}`}
    >
      {fmt(valor)}
    </TableCell>
  );
}

/** Una fila del tablero (escritorio). */
function FilaWip({
  fila,
  alAbrir,
}: {
  fila: WipOrdenFila;
  alAbrir: () => void;
}): React.JSX.Element {
  return (
    <TableRow data-testid="wip-fila">
      <TableCell className="font-medium">#{fila.folio}</TableCell>
      <TableCell>{fila.codigoModelo}</TableCell>
      <TableCell>{fila.cliente}</TableCell>
      <TableCell className="text-right tabular-nums">{fmt(fila.pedido)}</TableCell>
      <CeldaPendiente valor={fila.porCortar} />
      <CeldaPendiente valor={fila.cortadoPorEnviar} />
      <CeldaPendiente valor={fila.porRecibir} />
      <CeldaPendiente valor={fila.porEntregar} />
      <TableCell className="text-right">
        <Button variant="ghost" size="sm" onClick={alAbrir} data-testid="wip-detalle">
          <Layers className="size-4" aria-hidden />
          Ver
        </Button>
      </TableCell>
    </TableRow>
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
