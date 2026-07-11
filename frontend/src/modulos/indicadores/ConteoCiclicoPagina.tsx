import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { useCapturarConteo, useConteoCiclico } from '@/api/inventario-ciclico';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

/**
 * CONTEO CIEGO de un inventario cíclico (F7-E5; doc 05 §Almacén). Móvil primero: el capturista anota
 * la cantidad FÍSICA de cada artículo SIN ver el teórico (D6 — la respuesta ni lo trae). Permiso
 * `indicadores.ciclicos-conteo` (el backend re-verifica, A1).
 */
export function ConteoCiclicoPagina(): React.JSX.Element {
  const { id: idParam } = useParams<{ id: string }>();
  const id = Number(idParam);
  const consulta = useConteoCiclico(Number.isNaN(id) ? null : id);
  const capturar = useCapturarConteo();
  const [valores, setValores] = useState<Record<number, string>>({});

  const renglones = useMemo(() => consulta.data?.renglones ?? [], [consulta.data]);

  // Inicializa/sincroniza los campos con el servidor (tras guardar, refleja lo capturado).
  useEffect(() => {
    const inicial: Record<number, string> = {};
    for (const r of renglones) inicial[r.idDet] = r.cantReal === null ? '' : String(r.cantReal);
    setValores(inicial);
  }, [renglones]);

  const cerrado = consulta.data?.estado === 'cerrado' || consulta.data?.estado === 'cancelado';

  function guardar(): void {
    const capturados = renglones
      .filter((r) => (valores[r.idDet] ?? '') !== '')
      .map((r) => ({ idDet: r.idDet, cantReal: Number(valores[r.idDet]) }));
    if (capturados.length === 0) {
      toast.error('Captura al menos una cantidad.');
      return;
    }
    if (capturados.some((c) => !Number.isInteger(c.cantReal) || c.cantReal < 0)) {
      toast.error('Las cantidades deben ser enteros ≥ 0.');
      return;
    }
    capturar.mutate(
      { id, cuerpo: { renglones: capturados } },
      {
        onSuccess: () => toast.success('Conteo guardado.'),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <div className="h-full overflow-y-auto space-y-6 p-4 md:p-6" data-testid="ciclico-conteo">
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Conteo cíclico{consulta.data ? ` #${consulta.data.folio}` : ''}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {consulta.data ? `Almacén: ${consulta.data.almacen}` : 'Captura la cantidad física.'}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/indicadores/ciclicos">Volver</Link>
        </Button>
      </header>

      {consulta.isPending ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : consulta.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {consulta.error.message}
        </p>
      ) : cerrado ? (
        <p className="text-sm text-muted-foreground">
          Este inventario ya está {consulta.data?.estado} y no admite más conteo.
        </p>
      ) : (
        <>
          <div className="space-y-3">
            {renglones.map((r) => (
              <Card key={r.idDet} data-testid={`cc-fila-${r.idDet}`}>
                <CardContent className="flex items-center justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.modelo}</p>
                    <p className="text-sm text-muted-foreground">
                      {r.color} · {r.etiquetaTalla}
                      {r.folioOrden !== null ? ` · Orden #${r.folioOrden}` : ' · Sin orden'}
                    </p>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    className="w-24"
                    aria-label={`Cantidad contada de ${r.modelo} ${r.color} ${r.etiquetaTalla}`}
                    value={valores[r.idDet] ?? ''}
                    onChange={(e) => setValores((prev) => ({ ...prev, [r.idDet]: e.target.value }))}
                    data-testid={`cc-cant-${r.idDet}`}
                  />
                </CardContent>
              </Card>
            ))}
            {renglones.length === 0 && (
              <p className="text-sm text-muted-foreground">Sin artículos que contar.</p>
            )}
          </div>

          {renglones.length > 0 && (
            <div className="sticky bottom-0 flex justify-end gap-3 border-t bg-background/95 py-3 backdrop-blur">
              <Button
                type="button"
                onClick={guardar}
                disabled={capturar.isPending}
                data-testid="cc-guardar"
              >
                Guardar conteo
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
