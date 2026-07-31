import { ChevronDown, ChevronRight, Loader2Icon, Ruler } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useMedidasAvio, useReemplazarMedidasAvio, type MedidaTalla } from '@/api/modelo-medidas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

/** Una talla en captura (consumo como texto). */
interface RenglonTalla {
  idTalla: number;
  etiquetaTalla: string;
  /** Consumo como texto (el `<input type=number>` entrega string). */
  consumo: string;
}

/** Convierte una talla del API a su forma de captura. */
function aRenglon(t: MedidaTalla): RenglonTalla {
  return { idTalla: t.idTalla, etiquetaTalla: t.etiquetaTalla, consumo: String(t.consumo) };
}

/**
 * Medidas por talla de un avío del BOM (F8-E1, R18). Panel colapsable dentro del renglón de avío
 * del editor de receta: al abrirlo carga las medidas (GET), muestra un checkbox "consumo por
 * talla" y, si está activo, la tabla de las TALLAS DE LA CURVA del modelo con un input de consumo
 * por talla. "Guardar" reemplaza el set completo (PUT).
 *
 * Solo se monta para avíos YA guardados en el BOM (el endpoint requiere el renglón). El estado de
 * captura vive aquí (sembrado desde el GET); el backend valida que las tallas sean de la curva y
 * es la autoridad (A1). Sin `puedeAdministrar` el panel queda en solo lectura.
 */
export function EditorMedidasAvio({
  idModelo,
  idAvio,
  puedeAdministrar,
}: {
  idModelo: number;
  idAvio: number;
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const [abierto, setAbierto] = useState(false);
  const consulta = useMedidasAvio(idModelo, idAvio, abierto);
  const guardar = useReemplazarMedidasAvio();

  const [consumoPorTalla, setConsumoPorTalla] = useState(false);
  const [tallas, setTallas] = useState<RenglonTalla[]>([]);

  // Sembrar la captura desde el GET cada vez que llega/cambia.
  const datos = consulta.data;
  useEffect(() => {
    if (!datos) {
      return;
    }
    setConsumoPorTalla(datos.consumoPorTalla);
    setTallas(datos.tallas.map(aRenglon));
  }, [datos]);

  function cambiarConsumo(idTalla: number, valor: string): void {
    setTallas((prev) => prev.map((r) => (r.idTalla === idTalla ? { ...r, consumo: valor } : r)));
  }

  function guardarMedidas(): void {
    guardar.mutate(
      {
        idModelo,
        idAvio,
        cuerpo: {
          consumoPorTalla,
          tallas: tallas.map((r) => ({
            idTalla: r.idTalla,
            // Vacío = 0 (consumo por talla no capturado).
            consumo: r.consumo.trim() === '' ? 0 : Number(r.consumo),
          })),
        },
      },
      {
        onSuccess: () => toast.success('Medidas por talla guardadas.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <div className="mt-2 border-t pt-2" data-testid={`medidas-avio-${idAvio}`}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-1 text-xs text-muted-foreground"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
        data-testid={`toggle-medidas-avio-${idAvio}`}
      >
        {abierto ? (
          <ChevronDown className="size-3.5" aria-hidden />
        ) : (
          <ChevronRight className="size-3.5" aria-hidden />
        )}
        <Ruler className="size-3.5" aria-hidden />
        Medidas por talla
      </Button>

      {abierto ? (
        <div className="mt-2 space-y-3" data-testid={`panel-medidas-avio-${idAvio}`}>
          {consulta.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : consulta.isError ? (
            <p className="text-sm text-destructive">{consulta.error.message}</p>
          ) : (
            <>
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  className="size-4 rounded border-input accent-primary"
                  checked={consumoPorTalla}
                  disabled={!puedeAdministrar || guardar.isPending}
                  onChange={(e) => setConsumoPorTalla(e.target.checked)}
                  data-testid={`consumo-por-talla-${idAvio}`}
                />
                ¿Este avío se consume por talla?
              </label>

              {consumoPorTalla ? (
                tallas.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    El modelo no tiene curva de tallas. Asígnale una curva para capturar consumo por
                    talla.
                  </p>
                ) : (
                  <ul
                    className="grid grid-cols-2 gap-2 sm:grid-cols-3"
                    data-testid={`tabla-tallas-avio-${idAvio}`}
                  >
                    {tallas.map((r) => (
                      <li key={r.idTalla} className="space-y-1">
                        <label
                          htmlFor={`consumo-talla-${idAvio}-${r.idTalla}`}
                          className="block text-xs text-muted-foreground"
                        >
                          {r.etiquetaTalla}
                        </label>
                        <Input
                          id={`consumo-talla-${idAvio}-${r.idTalla}`}
                          type="number"
                          min={0}
                          step="0.0001"
                          inputMode="decimal"
                          placeholder="0"
                          value={r.consumo}
                          disabled={!puedeAdministrar || guardar.isPending}
                          onChange={(e) => cambiarConsumo(r.idTalla, e.target.value)}
                          data-testid={`consumo-talla-${idAvio}-${r.idTalla}`}
                        />
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <p className="text-xs text-muted-foreground">
                  El avío usa un consumo único (el del renglón). Actívalo para capturar consumo por
                  talla.
                </p>
              )}

              {puedeAdministrar ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={guardarMedidas}
                  disabled={guardar.isPending}
                  data-testid={`guardar-medidas-avio-${idAvio}`}
                >
                  {guardar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
                  Guardar medidas
                </Button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
