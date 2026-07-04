import { Boxes } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import {
  useCancelarCiclico,
  useCrearCiclico,
  useInventariosCiclicos,
} from '@/api/inventario-ciclico';
import type { InventarioCiclicoResumen, InventariosCiclicosQuery } from '@/api/tipos';
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
import type { Modelo } from '@/api/modelos';

import { SelectorModelo } from '@/modulos/inventarios/SelectorModelo';

type EstadoFiltro = '' | 'abierto' | 'contado' | 'cerrado' | 'cancelado';

/**
 * INVENTARIOS CÍCLICOS — lista + alta (F7-E5; doc 05 §Almacén). El ALTA congela el teórico (D6); el
 * conteo es CIEGO (otra pantalla) y el ajuste se aplica como MOVIMIENTO de kardex (D3). Bajo
 * `indicadores.ciclicos-*` (el backend re-verifica cada acción, A1).
 */
export function InventariosCiclicosPagina(): React.JSX.Element {
  const [estado, setEstado] = useState<EstadoFiltro>('');
  const query: InventariosCiclicosQuery = { porPagina: 100, ...(estado === '' ? {} : { estado }) };
  const consulta = useInventariosCiclicos(query);
  const [alta, setAlta] = useState(false);
  const cancelar = useCancelarCiclico();

  const filas = consulta.data?.datos ?? [];

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="ciclicos">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
            <Boxes className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold">Inventarios cíclicos</h1>
            <p className="text-sm text-muted-foreground">
              Conteo físico contra el kardex: el alta congela el teórico y el ajuste es un
              movimiento.
            </p>
          </div>
        </div>
        <Button type="button" onClick={() => setAlta(true)} data-testid="ic-nuevo">
          Nuevo inventario
        </Button>
      </header>

      <Card>
        <CardHeader className="flex-row flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle>Inventarios</CardTitle>
            <CardDescription>Filtra por estado.</CardDescription>
          </div>
          <Field className="w-44">
            <FieldLabel htmlFor="ic-estado">Estado</FieldLabel>
            <SelectNativo
              id="ic-estado"
              value={estado}
              onChange={(e) => setEstado(e.target.value as EstadoFiltro)}
              data-testid="ic-estado"
            >
              <option value="">Todos</option>
              <option value="abierto">Abiertos</option>
              <option value="contado">Contados</option>
              <option value="cerrado">Cerrados</option>
              <option value="cancelado">Cancelados</option>
            </SelectNativo>
          </Field>
        </CardHeader>
        <CardContent>
          {consulta.isPending ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : filas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin inventarios cíclicos.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Folio</TableHead>
                    <TableHead>Almacén</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Avance</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filas.map((c) => (
                    <TableRow key={c.id} data-testid={`ic-fila-${c.id}`}>
                      <TableCell className="font-medium">#{c.folio}</TableCell>
                      <TableCell>{c.almacen}</TableCell>
                      <TableCell>{c.fecha}</TableCell>
                      <TableCell>
                        <EstadoBadge estado={c.estado} />
                      </TableCell>
                      <TableCell className="text-right">
                        {c.renglonesContados}/{c.totalRenglones}
                      </TableCell>
                      <TableCell className="text-right">
                        <Acciones
                          ciclico={c}
                          onCancelar={(motivo) =>
                            cancelar.mutate(
                              { id: c.id, motivo },
                              {
                                onSuccess: () => toast.success('Inventario cíclico cancelado.'),
                                onError: (err) => toast.error(err.message),
                              },
                            )
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <DialogoAlta abierto={alta} alCerrar={() => setAlta(false)} />
    </div>
  );
}

function EstadoBadge({
  estado,
}: {
  estado: InventarioCiclicoResumen['estado'];
}): React.JSX.Element {
  if (estado === 'cancelado') return <Badge variant="destructive">Cancelado</Badge>;
  if (estado === 'cerrado') return <Badge variant="secondary">Cerrado (ajustado)</Badge>;
  if (estado === 'contado') return <Badge variant="outline">Contado</Badge>;
  return <Badge variant="outline">Abierto</Badge>;
}

function Acciones({
  ciclico,
  onCancelar,
}: {
  ciclico: InventarioCiclicoResumen;
  onCancelar: (motivo: string) => void;
}): React.JSX.Element {
  const vivo = ciclico.estado === 'abierto' || ciclico.estado === 'contado';
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {ciclico.estado !== 'cancelado' && (
        <Button asChild variant="ghost" size="sm">
          <Link
            to={`/indicadores/ciclicos/${ciclico.id}/exactitud`}
            data-testid={`ic-exactitud-${ciclico.id}`}
          >
            Exactitud
          </Link>
        </Button>
      )}
      {vivo && (
        <>
          <Button asChild variant="ghost" size="sm">
            <Link
              to={`/indicadores/ciclicos/${ciclico.id}/conteo`}
              data-testid={`ic-conteo-${ciclico.id}`}
            >
              Conteo
            </Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              window.open(
                `/api/indicadores/ciclicos/${ciclico.id}/hoja-conteo`,
                '_blank',
                'noopener',
              )
            }
          >
            Hoja PDF
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const motivo = window.prompt('Motivo de la cancelación:');
              if (motivo === null || motivo.trim().length < 3) return;
              onCancelar(motivo.trim());
            }}
          >
            Cancelar
          </Button>
        </>
      )}
    </div>
  );
}

function DialogoAlta({
  abierto,
  alCerrar,
}: {
  abierto: boolean;
  alCerrar: () => void;
}): React.JSX.Element {
  const crear = useCrearCiclico();
  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });
  const [idAlmacen, setIdAlmacen] = useState('');
  const [modelo, setModelo] = useState<Modelo | null>(null);
  const [observaciones, setObservaciones] = useState('');

  function guardar(e: React.FormEvent): void {
    e.preventDefault();
    if (idAlmacen === '') {
      toast.error('El almacén es obligatorio.');
      return;
    }
    crear.mutate(
      {
        idAlmacen: Number(idAlmacen),
        ...(modelo === null ? {} : { idsModelo: [modelo.id] }),
        ...(observaciones.trim() === '' ? {} : { observaciones: observaciones.trim() }),
      },
      {
        onSuccess: (inv) => {
          toast.success(
            `Inventario cíclico #${inv.folio} creado (${inv.totalRenglones} artículos).`,
          );
          setIdAlmacen('');
          setModelo(null);
          setObservaciones('');
          alCerrar();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && alCerrar()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <form onSubmit={guardar}>
          <DialogHeader>
            <DialogTitle>Nuevo inventario cíclico</DialogTitle>
            <DialogDescription>
              El alta congela el teórico ahora mismo. Elige el almacén y, si quieres, acota a un
              modelo.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Field>
              <FieldLabel htmlFor="ic-almacen">Almacén</FieldLabel>
              <SelectNativo
                id="ic-almacen"
                value={idAlmacen}
                onChange={(e) => setIdAlmacen(e.target.value)}
                data-testid="ic-almacen"
              >
                <option value="">Selecciona…</option>
                {(almacenes.data?.datos ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            <Field>
              <FieldLabel>Alcance (modelo)</FieldLabel>
              {modelo === null ? (
                <SelectorModelo
                  idSeleccionado={undefined}
                  alSeleccionar={(m) => setModelo(m)}
                  testid="ic-selector-modelo"
                />
              ) : (
                <div className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm">
                  <span className="font-medium">{modelo.codigo}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setModelo(null)}>
                    Quitar (todo el almacén)
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Sin modelo = todo el almacén (artículos con existencia).
              </p>
            </Field>
            <Field>
              <FieldLabel htmlFor="ic-obs">Observaciones</FieldLabel>
              <Input
                id="ic-obs"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={crear.isPending} data-testid="ic-guardar">
              Dar de alta
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
