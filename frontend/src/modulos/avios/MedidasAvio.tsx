import { Loader2Icon, PlusIcon, RulerIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useGuardarMedidasAvio, useMedidasAvio, type MedidaAvio } from '@/api/medidas-avio';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { moneda } from '@/modulos/costos/comun';

/** Un renglón editable del set de medidas (etiqueta + precio, como texto para captura). */
interface RenglonMedida {
  medida: string;
  precio: string;
}

/**
 * Medidas de un avío "POR MEDIDA" (rediseño R5, B11) — cierres, elástico… Se administran como un SET
 * completo: el usuario agrega/quita/edita renglones (etiqueta + precio) y guarda. El precosto usa el
 * PROMEDIO de los precios de las medidas activas (lo calcula el backend y se muestra como "Promedio
 * (precosteo)"). En modo lectura (sin `puedeAdministrar`) sólo muestra la lista + el promedio.
 */
export function MedidasAvio({
  idAvio,
  puedeAdministrar,
}: {
  idAvio: number;
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const consulta = useMedidasAvio(idAvio);
  const guardar = useGuardarMedidasAvio();
  const [renglones, setRenglones] = useState<RenglonMedida[]>([]);

  // Sincroniza el borrador con las medidas ACTIVAS del servidor cuando cargan/cambian.
  useEffect(() => {
    const activas = (consulta.data?.datos ?? []).filter((m: MedidaAvio) => m.activo);
    setRenglones(activas.map((m) => ({ medida: m.medida, precio: String(m.precio) })));
  }, [consulta.data]);

  const promedio = consulta.data?.promedioPreCosto ?? null;
  const esPorMedida = (consulta.data?.datos ?? []).some((m) => m.activo);

  function actualizar(indice: number, campo: keyof RenglonMedida, valor: string): void {
    setRenglones((prev) => prev.map((r, i) => (i === indice ? { ...r, [campo]: valor } : r)));
  }
  function agregar(): void {
    setRenglones((prev) => [...prev, { medida: '', precio: '' }]);
  }
  function quitar(indice: number): void {
    setRenglones((prev) => prev.filter((_, i) => i !== indice));
  }

  function alGuardar(): void {
    const medidas: { medida: string; precio: number; orden: number }[] = [];
    for (let i = 0; i < renglones.length; i += 1) {
      const r = renglones[i];
      if (r === undefined) {
        continue;
      }
      const medida = r.medida.trim();
      const precioNum = Number(r.precio);
      if (medida === '') {
        toast.error('Cada medida necesita una etiqueta (ej. "15 cm").');
        return;
      }
      if (r.precio.trim() === '' || Number.isNaN(precioNum) || precioNum < 0) {
        toast.error(`El precio de "${medida}" debe ser un número ≥ 0.`);
        return;
      }
      medidas.push({ medida, precio: precioNum, orden: i });
    }
    if (new Set(medidas.map((m) => m.medida)).size !== medidas.length) {
      toast.error('Hay medidas repetidas.');
      return;
    }
    guardar.mutate(
      { idAvio, cuerpo: { medidas } },
      {
        onSuccess: () => toast.success('Medidas guardadas.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  if (consulta.isPending) {
    return <p className="text-sm text-muted-foreground">Cargando medidas…</p>;
  }
  if (consulta.isError) {
    return <p className="text-sm text-destructive">{consulta.error.message}</p>;
  }

  return (
    <div className="space-y-3" data-testid="medidas-avio">
      <div className="flex flex-wrap items-center gap-2">
        {esPorMedida ? (
          <Badge variant="secondary" data-testid="badge-por-medida">
            <RulerIcon className="size-3" aria-hidden /> Por medida
          </Badge>
        ) : null}
        {promedio !== null ? (
          <span className="text-sm text-muted-foreground" data-testid="promedio-precosteo">
            Promedio (precosteo):{' '}
            <span className="font-medium text-foreground">{moneda(promedio)}</span>
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">
            Este avío no maneja medidas (usa su precio de proveedor/referencia).
          </span>
        )}
      </div>

      {puedeAdministrar ? (
        <div className="space-y-2">
          {renglones.map((r, i) => (
            <div key={i} className="flex items-end gap-2" data-testid="renglon-medida">
              <div className="flex-1">
                <label className="mb-1 block text-xs text-muted-foreground">Medida</label>
                <Input
                  value={r.medida}
                  onChange={(e) => actualizar(i, 'medida', e.target.value)}
                  placeholder="ej. 15 cm"
                  aria-label={`Medida ${String(i + 1)}`}
                />
              </div>
              <div className="w-28">
                <label className="mb-1 block text-xs text-muted-foreground">Precio</label>
                <Input
                  className="text-right"
                  value={r.precio}
                  onChange={(e) => actualizar(i, 'precio', e.target.value)}
                  placeholder="0.00"
                  aria-label={`Precio de la medida ${String(i + 1)}`}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => quitar(i)}
                aria-label={`Quitar la medida ${String(i + 1)}`}
                data-testid="quitar-medida"
              >
                <Trash2Icon className="text-destructive" aria-hidden />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={agregar}
              data-testid="agregar-medida"
            >
              <PlusIcon aria-hidden /> Agregar medida
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={alGuardar}
              disabled={guardar.isPending}
              data-testid="guardar-medidas"
            >
              {guardar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Guardar medidas
            </Button>
          </div>
        </div>
      ) : esPorMedida ? (
        <ul className="flex flex-col gap-1" data-testid="lista-medidas-avio">
          {(consulta.data?.datos ?? [])
            .filter((m) => m.activo)
            .map((m) => (
              <li key={m.id} className="flex justify-between rounded-lg border px-3 py-1.5 text-sm">
                <span>{m.medida}</span>
                <span className="font-medium tabular-nums">{moneda(m.precio)}</span>
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}
