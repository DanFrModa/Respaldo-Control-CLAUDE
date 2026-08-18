import { AlertTriangleIcon, Loader2Icon, PlusIcon, RulerIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useGuardarMedidasAvio, useMedidasAvio, type MedidaAvio } from '@/api/medidas-avio';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { moneda } from '@/modulos/costos/comun';

/** Un renglón editable del set de medidas (el NÚMERO + el precio, como texto para captura). */
interface RenglonMedida {
  /** Id de la medida existente (para corregirla en su lugar); `null` si es un alta. */
  id: number | null;
  /** El número de la medida, como texto (el `<input>` entrega string). */
  valor: string;
  precio: string;
  /** ¿Viene marcada para revisión manual? (etiqueta vieja que la migración no pudo convertir). */
  requiereRevision: boolean;
  /** Etiqueta ORIGINAL, para poder decir en pantalla qué decía antes de corregirse. */
  etiquetaOriginal: string;
  /**
   * El `valor` que la fila tiene GUARDADO (null = heredada sin normalizar). Es lo que distingue
   * "todavía no le pongo número, consérvala" de "borré el número de una medida ya buena", que sí
   * es un error. No se puede deducir del campo en pantalla: los dos se ven vacíos.
   */
  valorOriginal: number | null;
}

/**
 * Medidas de un avío "POR MEDIDA" (rediseño R5, B11) — cierres, elástico… Se administran como un SET
 * completo: el usuario agrega/quita/edita renglones y guarda. El precosto usa el PROMEDIO de los
 * precios de las medidas activas (lo calcula el backend y se muestra como "Promedio (precosteo)").
 * En modo lectura (sin `puedeAdministrar`) sólo muestra la lista + el promedio.
 *
 * ⭐ **V1-E3g (§Post-F9.66): la medida es un NÚMERO y la unidad se captura UNA vez.** Antes era texto
 * libre y `"53 cm"`, `"53cm"` y `"53"` eran tres medidas distintas — la orden de compra salía partida
 * en tres. Ahora el campo sólo admite el número, la unidad del avío (cm, mm…) va aparte y se ve
 * PEGADA al campo mientras se captura, y las medidas heredadas que no se pudieron normalizar salen
 * marcadas "revisar" en vez de haberse tirado o adivinado (D3). Los avisos del servidor (número
 * absurdo para la unidad, unidad faltante) se muestran pero NO bloquean.
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
  const [unidad, setUnidad] = useState('');

  // Sincroniza el borrador con las medidas ACTIVAS del servidor cuando cargan/cambian.
  useEffect(() => {
    const activas = (consulta.data?.datos ?? []).filter((m: MedidaAvio) => m.activo);
    setRenglones(
      activas.map((m) => ({
        id: m.id,
        // Una medida sin `valor` es una heredada que no se pudo convertir: su campo nace VACÍO
        // (nadie inventa el número) y el renglón queda marcado para revisión.
        valor: m.valor === null ? '' : String(m.valor),
        precio: String(m.precio),
        requiereRevision: m.requiereRevision,
        etiquetaOriginal: m.medida,
        valorOriginal: m.valor,
      })),
    );
    setUnidad(consulta.data?.unidadMedida ?? '');
  }, [consulta.data]);

  const promedio = consulta.data?.promedioPreCosto ?? null;
  const esPorMedida = (consulta.data?.datos ?? []).some((m) => m.activo);
  const avisos = consulta.data?.avisos ?? [];

  function actualizar(indice: number, campo: 'valor' | 'precio', valor: string): void {
    setRenglones((prev) => prev.map((r, i) => (i === indice ? { ...r, [campo]: valor } : r)));
  }
  function agregar(): void {
    setRenglones((prev) => [
      ...prev,
      {
        id: null,
        valor: '',
        precio: '',
        requiereRevision: false,
        etiquetaOriginal: '',
        valorOriginal: null,
      },
    ]);
  }
  function quitar(indice: number): void {
    setRenglones((prev) => prev.filter((_, i) => i !== indice));
  }

  function alGuardar(): void {
    const medidas: { id?: number; valor: number | null; precio: number; orden: number }[] = [];
    for (let i = 0; i < renglones.length; i += 1) {
      const r = renglones[i];
      if (r === undefined) {
        continue;
      }
      const valorNum = Number(r.valor);
      const precioNum = Number(r.precio);
      const sinNumero = r.valor.trim() === '' || Number.isNaN(valorNum) || valorNum <= 0;
      // ⭐ H4 del review — Una medida HEREDADA que todavía nadie normalizó viaja SIN número, para
      // CONSERVARSE. Antes cualquier campo vacío abortaba el guardado entero, así que una sola fila
      // marcada congelaba el avío completo: no se podía ni corregir el precio de otra medida. Y
      // dejarla fuera del set-completo tampoco era opción: la habría dado de baja en silencio.
      const conservar = sinNumero && r.id !== null && r.valorOriginal === null;
      if (sinNumero && !conservar) {
        toast.error('Cada medida necesita su número (ej. 53), mayor que cero.');
        return;
      }
      if (r.precio.trim() === '' || Number.isNaN(precioNum) || precioNum < 0) {
        toast.error(
          `El precio de la medida ${conservar ? r.etiquetaOriginal : String(valorNum)} debe ser un número ≥ 0.`,
        );
        return;
      }
      medidas.push({
        ...(r.id === null ? {} : { id: r.id }),
        valor: conservar ? null : valorNum,
        precio: precioNum,
        orden: i,
      });
    }
    const numeros = medidas.flatMap((m) => (m.valor === null ? [] : [m.valor]));
    if (new Set(numeros).size !== numeros.length) {
      toast.error('Hay medidas repetidas.');
      return;
    }
    if (numeros.length > 0 && unidad.trim() === '') {
      toast.error('Captura la unidad de las medidas (cm, mm…): sin ella el número no dice nada.');
      return;
    }
    guardar.mutate(
      { idAvio, cuerpo: { unidadMedida: unidad.trim() === '' ? null : unidad.trim(), medidas } },
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

      {avisos.length > 0 ? (
        <ul
          className="space-y-1 rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-xs"
          data-testid="avisos-medidas-avio"
        >
          {avisos.map((a) => (
            <li key={a} className="flex gap-1.5">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{a}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {puedeAdministrar ? (
        <div className="space-y-2">
          <div className="w-40">
            <label
              className="mb-1 block text-xs text-muted-foreground"
              htmlFor={`unidad-medidas-${String(idAvio)}`}
            >
              Unidad de las medidas
            </label>
            <Input
              id={`unidad-medidas-${String(idAvio)}`}
              value={unidad}
              onChange={(e) => setUnidad(e.target.value)}
              placeholder="cm"
              aria-label="Unidad de las medidas del avío"
              data-testid="unidad-medidas-avio"
            />
          </div>
          {renglones.map((r, i) => (
            <div key={i} className="flex items-end gap-2" data-testid="renglon-medida">
              <div className="flex-1">
                <label className="mb-1 block text-xs text-muted-foreground">
                  Medida (solo el número)
                </label>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    value={r.valor}
                    onChange={(e) => actualizar(i, 'valor', e.target.value)}
                    placeholder="53"
                    aria-label={`Medida ${String(i + 1)}`}
                  />
                  {/* La unidad, PEGADA al campo: es la defensa contra capturar en la unidad
                      equivocada, que es el riesgo que quedó al confiar en el avío. */}
                  <span className="shrink-0 text-xs text-muted-foreground" aria-hidden>
                    {unidad.trim() === '' ? '—' : unidad.trim()}
                  </span>
                </div>
                {r.requiereRevision ? (
                  <p className="mt-1 text-xs text-warn" data-testid="medida-por-revisar">
                    Revisar: venía como “{r.etiquetaOriginal}” y no se pudo convertir a número. Se
                    conserva tal cual hasta que le pongas el suyo — no frena guardar el resto.
                  </p>
                ) : null}
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
                <span>
                  {m.medida}
                  {m.requiereRevision ? (
                    <span className="ml-1.5 text-xs text-warn">(revisar)</span>
                  ) : null}
                </span>
                <span className="font-medium tabular-nums">{moneda(m.precio)}</span>
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}
