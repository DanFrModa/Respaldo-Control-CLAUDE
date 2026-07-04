import { PackageCheck } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { atajosFecha, porcentaje } from './comun';

type EstadoFiltro = '' | 'pendiente' | 'entregado' | 'cancelado';

/**
 * MUESTRARIOS pendientes (F7-E4; doc 05 §A.3). Solicitud → seguimiento → entrega, con KPI de
 * cumplimiento (entregado ≤ requerido). Bajo `indicadores.ip-muestrarios` (el backend re-verifica, A1).
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

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="muestrarios">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
            <PackageCheck className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold">Muestrarios</h1>
            <p className="text-sm text-muted-foreground">
              Boards y muestras solicitados, con su cumplimiento.
            </p>
          </div>
        </div>
        <Button type="button" onClick={() => setSolicitar(true)} data-testid="mu-solicitar">
          Solicitar muestrario
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Metrica etiqueta="Total" valor={kpi.data?.total ?? 0} />
        <Metrica etiqueta="Pendientes" valor={kpi.data?.pendientes ?? 0} />
        <Metrica etiqueta="Entregados" valor={kpi.data?.entregados ?? 0} />
        <Metrica
          etiqueta="A tiempo / tarde"
          valor={`${kpi.data?.aTiempo ?? 0} / ${kpi.data?.tarde ?? 0}`}
        />
        <Metrica etiqueta="% cumplimiento" valor={porcentaje(kpi.data?.porcentaje)} />
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle>Muestrarios</CardTitle>
            <CardDescription>Filtra por estado.</CardDescription>
          </div>
          <Field className="w-44">
            <FieldLabel htmlFor="mu-estado">Estado</FieldLabel>
            <SelectNativo
              id="mu-estado"
              value={estado}
              onChange={(e) => setEstado(e.target.value as EstadoFiltro)}
              data-testid="mu-estado"
            >
              <option value="">Todos</option>
              <option value="pendiente">Pendientes</option>
              <option value="entregado">Entregados</option>
              <option value="cancelado">Cancelados</option>
            </SelectNativo>
          </Field>
        </CardHeader>
        <CardContent>
          {consulta.isPending ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : filas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin muestrarios.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead className="text-right">Boards</TableHead>
                    <TableHead className="text-right">Muestras</TableHead>
                    <TableHead>Requerida</TableHead>
                    <TableHead>Entregado</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filas.map((m) => (
                    <TableRow key={m.id} data-testid={`mu-fila-${m.id}`}>
                      <TableCell>{m.cliente}</TableCell>
                      <TableCell>{m.categoria ?? '—'}</TableCell>
                      <TableCell className="text-right">
                        {m.boardsOK}/{m.cantBoards}
                      </TableCell>
                      <TableCell className="text-right">
                        {m.muestrasOK}/{m.cantMuestras}
                      </TableCell>
                      <TableCell>{m.fechaRequerida}</TableCell>
                      <TableCell>{m.fechaEntregado ?? '—'}</TableCell>
                      <TableCell>
                        <EstadoBadge muestrario={m} />
                      </TableCell>
                      <TableCell className="text-right">
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
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <DialogoSolicitar abierto={solicitar} alCerrar={() => setSolicitar(false)} />
      <DialogoEntregar muestrario={entregar} alCerrar={() => setEntregar(null)} />
    </div>
  );
}

function EstadoBadge({ muestrario }: { muestrario: Muestrario }): React.JSX.Element {
  if (muestrario.estado === 'cancelado') return <Badge variant="destructive">Cancelado</Badge>;
  if (muestrario.estado === 'entregado')
    return muestrario.aTiempo ? (
      <Badge variant="secondary">A tiempo</Badge>
    ) : (
      <Badge variant="outline">Tarde</Badge>
    );
  return <Badge variant="outline">Pendiente</Badge>;
}

function Metrica({
  etiqueta,
  valor,
}: {
  etiqueta: string;
  valor: string | number;
}): React.JSX.Element {
  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
      <p className="text-lg font-semibold">{valor}</p>
    </div>
  );
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
