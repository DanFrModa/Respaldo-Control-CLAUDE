import { ClipboardCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  useFichaOrden,
  useFichasConfiables,
  useVerificarFichaOrden,
} from '@/api/fichas-confiables';
import { useBuscarOrdenes } from '@/api/ordenes-consulta';
import type { FichasConfiablesQuery } from '@/api/tipos';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useDebounce } from '@/lib/useDebounce';

import { porcentaje } from './comun';

/**
 * FICHAS CONFIABLES (F7-E4; doc 05 §A.2). Arriba, el checklist por orden: se busca la orden, se marcan
 * los reactivos OK y se guarda (upsert por filas, A6). Abajo, el indicador de % de fichas confiables
 * (global + por orden), agregado en el servidor. Todo bajo `indicadores.ip-confiabilidad`.
 */
export function FichasConfiablesPagina(): React.JSX.Element {
  const [busqueda, setBusqueda] = useState('');
  const [idOrden, setIdOrden] = useState<number | null>(null);
  const q = useDebounce(busqueda, 300);
  const resultados = useBuscarOrdenes(q);

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="fichas-confiables">
      <header className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
          <ClipboardCheck className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Fichas confiables</h1>
          <p className="text-sm text-muted-foreground">
            Verifica la confiabilidad de la ficha técnica por orden.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Checklist por orden</CardTitle>
          <CardDescription>Busca una orden por folio, modelo o cliente.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field className="max-w-md">
            <FieldLabel htmlFor="fc-buscar">Buscar orden</FieldLabel>
            <Input
              id="fc-buscar"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Folio, modelo o cliente…"
              data-testid="fc-buscar"
            />
          </Field>
          {q.length > 0 && (resultados.data?.datos.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-2" data-testid="fc-resultados">
              {resultados.data?.datos.map((o) => (
                <Button
                  key={o.id}
                  type="button"
                  variant={idOrden === o.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setIdOrden(o.id)}
                >
                  #{o.folio} · {o.codigoModelo} · {o.cliente}
                </Button>
              ))}
            </div>
          )}
          {idOrden !== null && <ChecklistOrden idOrden={idOrden} />}
        </CardContent>
      </Card>

      <IndicadorConfiables alSeleccionar={setIdOrden} />
    </div>
  );
}

/** Checklist editable de una orden. */
function ChecklistOrden({ idOrden }: { idOrden: number }): React.JSX.Element {
  const consulta = useFichaOrden(idOrden);
  const guardar = useVerificarFichaOrden();
  const [estado, setEstado] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (consulta.data) {
      const inicial: Record<number, boolean> = {};
      for (const item of consulta.data.items) inicial[item.idReactivo] = item.hecho;
      setEstado(inicial);
    }
  }, [consulta.data]);

  if (consulta.isPending)
    return <p className="text-sm text-muted-foreground">Cargando checklist…</p>;
  if (consulta.isError)
    return (
      <p className="text-sm text-destructive" role="alert">
        {consulta.error.message}
      </p>
    );
  const ficha = consulta.data;
  if (ficha === undefined) return <></>;

  return (
    <div className="rounded-lg border p-4" data-testid="fc-checklist">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          Orden #{ficha.folio} · {ficha.codigoModelo ?? '—'}
        </p>
        <Badge variant={ficha.porcentaje === 1 ? 'secondary' : 'outline'}>
          {ficha.hechos}/{ficha.totalReactivos} · {porcentaje(ficha.porcentaje)}
        </Badge>
      </div>
      <ul className="space-y-2">
        {ficha.items.map((item) => (
          <li key={item.idReactivo} className="flex items-center gap-2">
            <input
              id={`fc-r-${item.idReactivo}`}
              type="checkbox"
              className="size-4"
              checked={estado[item.idReactivo] ?? false}
              onChange={(e) =>
                setEstado((prev) => ({ ...prev, [item.idReactivo]: e.target.checked }))
              }
              data-testid={`fc-reactivo-${item.idReactivo}`}
            />
            <label htmlFor={`fc-r-${item.idReactivo}`}>{item.etiqueta}</label>
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <Button
          type="button"
          disabled={guardar.isPending}
          data-testid="fc-guardar"
          onClick={() =>
            guardar.mutate(
              {
                idOrden,
                cuerpo: {
                  items: ficha.items.map((i) => ({
                    idReactivo: i.idReactivo,
                    hecho: estado[i.idReactivo] ?? false,
                  })),
                },
              },
              {
                onSuccess: () => toast.success('Checklist guardado.'),
                onError: (err) => toast.error(err.message),
              },
            )
          }
        >
          Guardar checklist
        </Button>
      </div>
    </div>
  );
}

/** Indicador agregado de % de fichas confiables. */
function IndicadorConfiables({
  alSeleccionar,
}: {
  alSeleccionar: (idOrden: number) => void;
}): React.JSX.Element {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const query: FichasConfiablesQuery = {
    ...(desde === '' ? {} : { desde }),
    ...(hasta === '' ? {} : { hasta }),
  };
  const consulta = useFichasConfiables(query);
  const datos = consulta.data;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-end justify-between gap-3">
        <div>
          <CardTitle>% de fichas confiables</CardTitle>
          <CardDescription>
            Reactivos OK ÷ reactivos evaluados (global y por orden).
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field className="w-40">
            <FieldLabel htmlFor="fc-desde">Desde</FieldLabel>
            <Input
              id="fc-desde"
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
            />
          </Field>
          <Field className="w-40">
            <FieldLabel htmlFor="fc-hasta">Hasta</FieldLabel>
            <Input
              id="fc-hasta"
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
            />
          </Field>
        </div>
      </CardHeader>
      <CardContent>
        {consulta.isPending ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : datos === undefined ? null : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metrica etiqueta="Órdenes evaluadas" valor={datos.global.ordenesEvaluadas} />
              <Metrica etiqueta="Confiables (100%)" valor={datos.global.ordenesConfiables} />
              <Metrica
                etiqueta="Reactivos OK"
                valor={`${datos.global.reactivosOk}/${datos.global.reactivosTotales}`}
              />
              <Metrica etiqueta="% confiable" valor={porcentaje(datos.global.porcentaje)} />
            </div>
            {datos.datos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin órdenes evaluadas.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Folio</TableHead>
                      <TableHead>Modelo</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead className="text-right">OK</TableHead>
                      <TableHead className="text-right">%</TableHead>
                      <TableHead>Confiable</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {datos.datos.map((o) => (
                      <TableRow
                        key={o.idOrden}
                        className="cursor-pointer"
                        onClick={() => alSeleccionar(o.idOrden)}
                        data-testid={`fc-orden-${o.idOrden}`}
                      >
                        <TableCell>#{o.folio}</TableCell>
                        <TableCell>{o.codigoModelo}</TableCell>
                        <TableCell>{o.cliente}</TableCell>
                        <TableCell className="text-right">
                          {o.hechos}/{o.totalReactivos}
                        </TableCell>
                        <TableCell className="text-right">{porcentaje(o.porcentaje)}</TableCell>
                        <TableCell>
                          {o.confiable ? (
                            <Badge variant="secondary">Sí</Badge>
                          ) : (
                            <Badge variant="outline">No</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
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
