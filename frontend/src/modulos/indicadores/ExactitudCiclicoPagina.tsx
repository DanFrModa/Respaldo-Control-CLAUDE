import { ScanLine } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { useExactitudCiclico, useGenerarAjusteCiclico } from '@/api/inventario-ciclico';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * EXACTITUD + generación del AJUSTE de un inventario cíclico (F7-E5; doc 05 §Almacén). Muestra
 * teórico/real/exactitud (=real−teórico) por artículo y aplica el ajuste como MOVIMIENTO de kardex
 * (D3). Permiso `indicadores.ciclicos-consulta` (el backend re-verifica, A1).
 */
export function ExactitudCiclicoPagina(): React.JSX.Element {
  const { id: idParam } = useParams<{ id: string }>();
  const id = Number(idParam);
  const consulta = useExactitudCiclico(Number.isNaN(id) ? null : id);
  const generar = useGenerarAjusteCiclico();
  const [confirmando, setConfirmando] = useState(false);

  const datos = consulta.data;
  const puedeAjustar = datos?.estado === 'contado';

  function ajustar(): void {
    generar.mutate(id, {
      onSuccess: () => {
        toast.success('Ajuste generado como movimiento de kardex.');
        setConfirmando(false);
      },
      onError: (err) => {
        toast.error(err.message);
        setConfirmando(false);
      },
    });
  }

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="ciclico-exactitud">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
            <ScanLine className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold">
              Exactitud{datos ? ` · Cíclico #${datos.folio}` : ''}
            </h1>
            <p className="text-sm text-muted-foreground">
              {datos ? `Almacén: ${datos.almacen} · ${datos.fecha}` : 'Teórico vs. real.'}
            </p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/indicadores/ciclicos">Volver</Link>
        </Button>
      </header>

      {consulta.isPending ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : consulta.isError || datos === undefined ? (
        <p className="text-sm text-destructive" role="alert">
          {consulta.error?.message ?? 'No se pudo cargar el inventario.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metrica etiqueta="Artículos" valor={datos.totales.total} />
            <Metrica etiqueta="Contados" valor={datos.totales.contados} />
            <Metrica etiqueta="Exactos" valor={datos.totales.exactos} />
            <Metrica etiqueta="Diferencias" valor={datos.totales.diferencias} />
            <Metrica etiqueta="Teórico" valor={datos.totales.teorico} />
            <Metrica etiqueta="Real (contado)" valor={datos.totales.real} />
          </div>

          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2">
                Renglones <EstadoBadge estado={datos.estado} />
              </CardTitle>
              {puedeAjustar &&
                (confirmando ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      ¿Aplicar el ajuste al kardex?
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      onClick={ajustar}
                      disabled={generar.isPending}
                      data-testid="ex-confirmar-ajuste"
                    >
                      Sí, generar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmando(false)}
                    >
                      Cancelar
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    onClick={() => setConfirmando(true)}
                    data-testid="ex-generar-ajuste"
                  >
                    Generar ajuste
                  </Button>
                ))}
              {datos.estado === 'abierto' && (
                <span className="text-sm text-muted-foreground">Faltan renglones por contar.</span>
              )}
              {datos.estado === 'cerrado' && (
                <span className="text-sm text-muted-foreground">Ajuste ya aplicado al kardex.</span>
              )}
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Modelo</TableHead>
                      <TableHead>Color</TableHead>
                      <TableHead>Talla</TableHead>
                      <TableHead>Orden</TableHead>
                      <TableHead className="text-right">Teórico</TableHead>
                      <TableHead className="text-right">Real</TableHead>
                      <TableHead className="text-right">Exactitud</TableHead>
                      <TableHead className="text-right">Ajuste</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {datos.renglones.map((r) => (
                      <TableRow key={r.idDet} data-testid={`ex-fila-${r.idDet}`}>
                        <TableCell className="font-medium">{r.modelo}</TableCell>
                        <TableCell>{r.color}</TableCell>
                        <TableCell>{r.etiquetaTalla}</TableCell>
                        <TableCell>{r.folioOrden === null ? '—' : `#${r.folioOrden}`}</TableCell>
                        <TableCell className="text-right">{r.cantTeorica}</TableCell>
                        <TableCell className="text-right">{r.cantReal ?? '—'}</TableCell>
                        <TableCell className="text-right">
                          <Exactitud valor={r.exactitud} />
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {r.folioMovimientoAjuste === null ? '—' : `#${r.folioMovimientoAjuste}`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Exactitud({ valor }: { valor: number | null }): React.JSX.Element {
  if (valor === null) return <span className="text-muted-foreground">—</span>;
  if (valor === 0) return <span>0</span>;
  return (
    <span className={valor > 0 ? 'font-medium text-emerald-600' : 'font-medium text-destructive'}>
      {valor > 0 ? `+${valor}` : valor}
    </span>
  );
}

function EstadoBadge({ estado }: { estado: string }): React.JSX.Element {
  if (estado === 'cancelado') return <Badge variant="destructive">Cancelado</Badge>;
  if (estado === 'cerrado') return <Badge variant="secondary">Cerrado (ajustado)</Badge>;
  if (estado === 'contado') return <Badge variant="outline">Contado</Badge>;
  return <Badge variant="outline">Abierto</Badge>;
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
