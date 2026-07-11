import { useState } from 'react';
import { toast } from 'sonner';

import { useClientes } from '@/api/clientes';
import {
  useCancelarMuestrario,
  useCrearMuestrario,
  useCumplimientoMuestrarios,
  useEntregarMuestrario,
  useMuestrarios,
} from '@/api/muestrarios';
import { useTemporadas } from '@/api/temporadas';
import type { Muestrario, MuestrariosQuery } from '@/api/tipos';
import { ChipEstado } from '@/components/dominio/ChipEstado';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

import { atajosFecha, porcentaje } from './comun';

type EstadoFiltro = '' | 'pendiente' | 'entregado' | 'cancelado';

/**
 * MUESTRARIOS pendientes (F7-E4; doc 05 §A.3; proto `vIndicadores` — re-vestida R9): solicitud →
 * seguimiento → entrega. page-head + KPIs de vistazo (Σ de SERVIDOR: cumplimiento) + toolbar (estado) +
 * TABLA DENSA. Bajo `indicadores.ip-muestrarios` (el backend re-verifica, A1).
 */
export function MuestrariosPagina(): React.JSX.Element {
  const [estado, setEstado] = useState<EstadoFiltro>('pendiente');
  const query: MuestrariosQuery = { porPagina: 100, ...(estado === '' ? {} : { estado }) };
  const consulta = useMuestrarios(query);
  const kpi = useCumplimientoMuestrarios();
  const [solicitar, setSolicitar] = useState(false);
  const [entregar, setEntregar] = useState<Muestrario | null>(null);
  const cancelar = useCancelarMuestrario();

  const filas = consulta.data?.datos ?? [];

  const kpis: Kpi[] = [
    { clave: 'total', etiqueta: 'Total', valor: (kpi.data?.total ?? 0).toLocaleString('es-MX') },
    {
      clave: 'pendientes',
      etiqueta: 'Pendientes',
      valor: (kpi.data?.pendientes ?? 0).toLocaleString('es-MX'),
    },
    {
      clave: 'entregados',
      etiqueta: 'Entregados',
      valor: (kpi.data?.entregados ?? 0).toLocaleString('es-MX'),
    },
    {
      clave: 'a-tiempo-tarde',
      etiqueta: 'A tiempo / tarde',
      valor: `${kpi.data?.aTiempo ?? 0} / ${kpi.data?.tarde ?? 0}`,
    },
    {
      clave: 'cumplimiento',
      etiqueta: '% cumplimiento',
      valor: porcentaje(kpi.data?.porcentaje),
      ...((kpi.data?.porcentaje ?? 0) >= 0.9 ? { tonoPie: 'ok' as const } : {}),
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 md:p-5" data-testid="muestrarios">
      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">Muestrarios</h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Boards y muestras solicitados, con su cumplimiento
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => setSolicitar(true)}
          data-testid="mu-solicitar"
        >
          Solicitar muestrario
        </Button>
      </header>

      {/* ── KPIs ────────────────────────────────────────────────────────────── */}
      <KpiTiles kpis={kpis} className="shrink-0" />

      {/* ── Card: filtros + tabla ───────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          <SelectNativo
            className="h-8 w-auto text-sm"
            value={estado}
            onChange={(e) => setEstado(e.target.value as EstadoFiltro)}
            aria-label="Filtrar por estado"
            data-testid="mu-estado"
          >
            <option value="">Todos</option>
            <option value="pendiente">Pendientes</option>
            <option value="entregado">Entregados</option>
            <option value="cancelado">Cancelados</option>
          </SelectNativo>
          <div className="ml-auto">
            <span className="text-[12px] text-faint">
              {filas.length.toLocaleString('es-MX')} muestrarios
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {consulta.isPending ? (
            <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
          ) : filas.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Sin muestrarios.</p>
          ) : (
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Cliente</TablaDensaHead>
                  <TablaDensaHead>Categoría</TablaDensaHead>
                  <TablaDensaHead numerica>Boards</TablaDensaHead>
                  <TablaDensaHead numerica>Muestras</TablaDensaHead>
                  <TablaDensaHead>Requerida</TablaDensaHead>
                  <TablaDensaHead>Entregado</TablaDensaHead>
                  <TablaDensaHead>Estado</TablaDensaHead>
                  <TablaDensaHead className="text-right">Acciones</TablaDensaHead>
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {filas.map((m) => (
                  <TablaDensaFila key={m.id} data-testid={`mu-fila-${m.id}`}>
                    <TablaDensaCelda>{m.cliente}</TablaDensaCelda>
                    <TablaDensaCelda className="text-muted-foreground">
                      {m.categoria ?? '—'}
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica>
                      {m.boardsOK}/{m.cantBoards}
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica>
                      {m.muestrasOK}/{m.cantMuestras}
                    </TablaDensaCelda>
                    <TablaDensaCelda>{m.fechaRequerida}</TablaDensaCelda>
                    <TablaDensaCelda>{m.fechaEntregado ?? '—'}</TablaDensaCelda>
                    <TablaDensaCelda>
                      <EstadoBadge muestrario={m} />
                    </TablaDensaCelda>
                    <TablaDensaCelda className="text-right">
                      {m.estado === 'pendiente' && (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setEntregar(m)}
                          >
                            Entregar
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const motivo = window.prompt('Motivo de la cancelación:');
                              if (motivo === null || motivo.trim().length < 3) return;
                              cancelar.mutate(
                                { id: m.id, motivo: motivo.trim() },
                                {
                                  onSuccess: () => toast.success('Muestrario cancelado.'),
                                  onError: (err) => toast.error(err.message),
                                },
                              );
                            }}
                          >
                            Cancelar
                          </Button>
                        </>
                      )}
                    </TablaDensaCelda>
                  </TablaDensaFila>
                ))}
              </TablaDensaCuerpo>
            </TablaDensa>
          )}
        </div>
      </div>

      <DialogoSolicitar abierto={solicitar} alCerrar={() => setSolicitar(false)} />
      <DialogoEntregar muestrario={entregar} alCerrar={() => setEntregar(null)} />
    </div>
  );
}

function EstadoBadge({ muestrario }: { muestrario: Muestrario }): React.JSX.Element {
  if (muestrario.estado === 'cancelado') return <ChipEstado tono="crit">Cancelado</ChipEstado>;
  if (muestrario.estado === 'entregado')
    return muestrario.aTiempo ? (
      <ChipEstado tono="ok">A tiempo</ChipEstado>
    ) : (
      <ChipEstado tono="warn">Tarde</ChipEstado>
    );
  return <ChipEstado tono="neutro">Pendiente</ChipEstado>;
}

function DialogoSolicitar({
  abierto,
  alCerrar,
}: {
  abierto: boolean;
  alCerrar: () => void;
}): React.JSX.Element {
  const crear = useCrearMuestrario();
  const clientes = useClientes({ porPagina: 100 });
  const temporadas = useTemporadas({ porPagina: 100 });
  const [idCliente, setIdCliente] = useState('');
  const [categoria, setCategoria] = useState('');
  const [idTemporada, setIdTemporada] = useState('');
  const [cantBoards, setCantBoards] = useState('0');
  const [cantMuestras, setCantMuestras] = useState('0');
  const [fechaRequerida, setFechaRequerida] = useState('');

  function guardar(e: React.FormEvent): void {
    e.preventDefault();
    if (idCliente === '' || fechaRequerida === '') {
      toast.error('El cliente y la fecha requerida son obligatorios.');
      return;
    }
    crear.mutate(
      {
        idCliente: Number(idCliente),
        cantBoards: Number(cantBoards),
        cantMuestras: Number(cantMuestras),
        fechaRequerida,
        ...(categoria.trim() === '' ? {} : { categoria: categoria.trim() }),
        ...(idTemporada === '' ? {} : { idTemporada: Number(idTemporada) }),
      },
      {
        onSuccess: () => {
          toast.success('Muestrario solicitado.');
          alCerrar();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && alCerrar()}>
      <DialogContent>
        <form onSubmit={guardar}>
          <DialogHeader>
            <DialogTitle>Solicitar muestrario</DialogTitle>
            <DialogDescription>Boards y muestras a preparar.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Field>
              <FieldLabel htmlFor="mu-cliente">Cliente</FieldLabel>
              <SelectNativo
                id="mu-cliente"
                value={idCliente}
                onChange={(e) => setIdCliente(e.target.value)}
                data-testid="mu-cliente"
              >
                <option value="">Selecciona…</option>
                {(clientes.data?.datos ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            <Field>
              <FieldLabel htmlFor="mu-categoria">Categoría</FieldLabel>
              <Input
                id="mu-categoria"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="mu-temporada">Temporada</FieldLabel>
              <SelectNativo
                id="mu-temporada"
                value={idTemporada}
                onChange={(e) => setIdTemporada(e.target.value)}
              >
                <option value="">Sin temporada</option>
                {(temporadas.data?.datos ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="mu-boards">Boards</FieldLabel>
                <Input
                  id="mu-boards"
                  type="number"
                  min={0}
                  value={cantBoards}
                  onChange={(e) => setCantBoards(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="mu-muestras">Muestras</FieldLabel>
                <Input
                  id="mu-muestras"
                  type="number"
                  min={0}
                  value={cantMuestras}
                  onChange={(e) => setCantMuestras(e.target.value)}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="mu-requerida">Fecha requerida</FieldLabel>
              <Input
                id="mu-requerida"
                type="date"
                value={fechaRequerida}
                onChange={(e) => setFechaRequerida(e.target.value)}
                data-testid="mu-requerida"
              />
            </Field>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={crear.isPending} data-testid="mu-guardar">
              Solicitar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DialogoEntregar({
  muestrario,
  alCerrar,
}: {
  muestrario: Muestrario | null;
  alCerrar: () => void;
}): React.JSX.Element {
  const entregar = useEntregarMuestrario();
  const [fechaEntregado, setFechaEntregado] = useState(atajosFecha.hoy());
  const [boardsOK, setBoardsOK] = useState('');
  const [muestrasOK, setMuestrasOK] = useState('');

  function guardar(e: React.FormEvent): void {
    e.preventDefault();
    if (muestrario === null) return;
    entregar.mutate(
      {
        id: muestrario.id,
        cuerpo: {
          fechaEntregado,
          ...(boardsOK === '' ? {} : { boardsOK: Number(boardsOK) }),
          ...(muestrasOK === '' ? {} : { muestrasOK: Number(muestrasOK) }),
        },
      },
      {
        onSuccess: () => {
          toast.success('Muestrario entregado.');
          alCerrar();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={muestrario !== null} onOpenChange={(v) => !v && alCerrar()}>
      <DialogContent>
        <form onSubmit={guardar}>
          <DialogHeader>
            <DialogTitle>Entregar muestrario</DialogTitle>
            <DialogDescription>Registra la entrega y lo que quedó listo.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Field>
              <FieldLabel htmlFor="mu-fecha-ent">Fecha de entrega</FieldLabel>
              <Input
                id="mu-fecha-ent"
                type="date"
                value={fechaEntregado}
                onChange={(e) => setFechaEntregado(e.target.value)}
                data-testid="mu-fecha-ent"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="mu-boardsok">Boards OK</FieldLabel>
                <Input
                  id="mu-boardsok"
                  type="number"
                  min={0}
                  value={boardsOK}
                  onChange={(e) => setBoardsOK(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="mu-muestrasok">Muestras OK</FieldLabel>
                <Input
                  id="mu-muestrasok"
                  type="number"
                  min={0}
                  value={muestrasOK}
                  onChange={(e) => setMuestrasOK(e.target.value)}
                />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={entregar.isPending} data-testid="mu-entregar-guardar">
              Entregar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
