import { ChevronDown, ChevronRight, Loader2Icon, Ruler } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useMedidasAvio as useMedidasDelCatalogo } from '@/api/medidas-avio';
import { useMedidasAvio, useReemplazarMedidasAvio, type MedidaTalla } from '@/api/modelo-medidas';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatearMoneda } from '@/lib/formato';

/** Una talla en captura (consumo como texto + el amarre a la medida del avío). */
interface RenglonTalla {
  idTalla: number;
  etiquetaTalla: string;
  /** Consumo como texto (el `<input type=number>` entrega string). */
  consumo: string;
  /** ¿La talla es de la curva vigente del modelo? (false = quedó de una curva anterior). */
  enCurva: boolean;
  /** `AvioMedida` amarrada a esta talla (R5/B11), o null. */
  idAvioMedida: number | null;
}

/** Convierte una talla del API a su forma de captura. */
function aRenglon(t: MedidaTalla): RenglonTalla {
  return {
    idTalla: t.idTalla,
    etiquetaTalla: t.etiquetaTalla,
    // `null` = talla de la curva SIN capturar → campo vacío. Un 0 del servidor es un cero
    // CAPTURADO a propósito y se muestra como "0" (no se confunde con "sin capturar").
    consumo: t.consumo === null ? '' : String(t.consumo),
    enCurva: t.enCurva,
    idAvioMedida: t.idAvioMedida,
  };
}

/**
 * Consumo POR TALLA de un avío del BOM (F8-E1, R18 + amarre de medida R5/B11). Panel colapsable
 * dentro del renglón de avío del editor de receta: al abrirlo carga las medidas (GET), muestra un
 * checkbox "¿se consume por talla?" y, si está activo, la matriz de las TALLAS DE LA CURVA del
 * modelo con su consumo y —cuando el avío tiene medidas capturadas (cierres, elástico…)— la
 * medida real con la que se compra esa talla.
 *
 * ⭐ V1-E3c: los renglones ya NO dependen de que alguien los haya creado antes (nadie podía: no
 * existía forma de darlos de alta). Los trae el servidor DESDE LA CURVA del modelo, y el aviso
 * "el modelo no tiene curva de tallas" solo sale cuando de verdad no la tiene (`tieneCurva`) —
 * antes se deducía de una lista que SIEMPRE venía vacía, así que mentía con la curva puesta.
 *
 * Solo se monta para avíos YA guardados en el BOM (el endpoint requiere el renglón). El estado de
 * captura vive aquí (sembrado desde el GET); el backend valida tallas y medidas y es la autoridad
 * (A1). Sin `puedeAdministrar` el panel queda en solo lectura.
 */
export function EditorMedidasAvio({
  idModelo,
  idAvio,
  puedeAdministrar,
  tieneCurvaModelo,
}: {
  idModelo: number;
  idAvio: number;
  puedeAdministrar: boolean;
  /**
   * ¿El modelo tiene curva? Lo sabe la ficha (`tallasCurva`) y permite avisar SIN esperar al GET.
   * La autoridad sigue siendo el servidor (`tieneCurva` de la respuesta).
   */
  tieneCurvaModelo?: boolean;
}): React.JSX.Element {
  const [abierto, setAbierto] = useState(false);
  const consulta = useMedidasAvio(idModelo, idAvio, abierto);
  const guardar = useReemplazarMedidasAvio();
  // Medidas del CATÁLOGO del avío (tamaños reales con su precio): las opciones del amarre por
  // talla. Solo se consultan con el panel abierto.
  const catalogoMedidas = useMedidasDelCatalogo(abierto ? idAvio : undefined);

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

  function cambiarTalla(idTalla: number, cambios: Partial<RenglonTalla>): void {
    setTallas((prev) => prev.map((r) => (r.idTalla === idTalla ? { ...r, ...cambios } : r)));
  }

  function guardarMedidas(): void {
    guardar.mutate(
      {
        idModelo,
        idAvio,
        cuerpo: {
          consumoPorTalla,
          // ⚠️ Las tallas en BLANCO NO se mandan: el PUT es SET-COMPLETO, así que "no viene" =
          // "no hay fila". Mandarlas como 0 creaba una medida de cero REAL que el precosto metía
          // al promedio (5 tallas con 3 capturadas: 0.45 se convertía en 0.27) y que apagaba el
          // aviso `tallasSinMedida` del MRP. Un 0 TECLEADO sí viaja: es un cero a propósito.
          // Y como el set-completo borra lo que no viene, vaciar una talla ya capturada
          // (dejarla en blanco) también sirve para BORRAR su medida.
          tallas: tallas
            .filter((r) => r.consumo.trim() !== '')
            .map((r) => ({
              idTalla: r.idTalla,
              consumo: Number(r.consumo),
              idAvioMedida: r.idAvioMedida,
            })),
        },
      },
      {
        onSuccess: () => toast.success('Consumo por talla guardado.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  // Con curva SIEMPRE hay matriz que capturar: el servidor manda una fila por talla de la curva.
  const tieneCurva = datos?.tieneCurva ?? tieneCurvaModelo ?? false;
  const medidasCatalogo = (catalogoMedidas.data?.datos ?? []).filter((m) => m.activo);

  return (
    <div className="border-t pt-2" data-testid={`medidas-avio-${idAvio}`}>
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
        Consumo por talla
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
                !tieneCurva && tallas.length === 0 ? (
                  <p className="text-xs text-muted-foreground" data-testid={`sin-curva-${idAvio}`}>
                    El modelo no tiene curva de tallas. Asígnale una curva (en los datos del modelo)
                    para capturar el consumo por talla.
                  </p>
                ) : (
                  <ul className="space-y-1.5" data-testid={`tabla-tallas-avio-${idAvio}`}>
                    {tallas.map((r) => (
                      <li
                        key={r.idTalla}
                        className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-2 py-1.5"
                      >
                        <label
                          htmlFor={`consumo-talla-${idAvio}-${r.idTalla}`}
                          className="flex w-24 shrink-0 items-center gap-1.5 text-xs font-medium"
                        >
                          {r.etiquetaTalla}
                          {r.enCurva ? null : (
                            <ChipEstado tono="warn" sinPunto>
                              fuera de curva
                            </ChipEstado>
                          )}
                        </label>
                        <Input
                          id={`consumo-talla-${idAvio}-${r.idTalla}`}
                          type="number"
                          min={0}
                          step="0.0001"
                          inputMode="decimal"
                          className="h-7 w-28"
                          placeholder="0"
                          value={r.consumo}
                          disabled={!puedeAdministrar || guardar.isPending}
                          onChange={(e) => cambiarTalla(r.idTalla, { consumo: e.target.value })}
                          data-testid={`consumo-talla-${idAvio}-${r.idTalla}`}
                        />
                        {medidasCatalogo.length > 0 ? (
                          <SelectNativo
                            className="w-56"
                            aria-label={`Medida del avío para la talla ${r.etiquetaTalla}`}
                            // El amarre medida×talla VIVE en la fila `ModeloAvioTalla`, y esa fila
                            // solo existe si hay consumo capturado: sin consumo no hay dónde
                            // guardarlo, así que se pide primero el consumo en vez de aceptar una
                            // medida que se perdería al guardar.
                            title={
                              r.consumo.trim() === ''
                                ? 'Captura primero el consumo de esta talla para poder amarrarle una medida.'
                                : undefined
                            }
                            disabled={
                              !puedeAdministrar || guardar.isPending || r.consumo.trim() === ''
                            }
                            value={r.idAvioMedida === null ? '' : String(r.idAvioMedida)}
                            onChange={(e) =>
                              cambiarTalla(r.idTalla, {
                                idAvioMedida: e.target.value === '' ? null : Number(e.target.value),
                              })
                            }
                            data-testid={`medida-talla-${idAvio}-${r.idTalla}`}
                          >
                            <option value="">Sin medida amarrada</option>
                            {medidasCatalogo.map((m) => (
                              <option key={m.id} value={String(m.id)}>
                                {m.medida} — {formatearMoneda(m.precio)}
                              </option>
                            ))}
                          </SelectNativo>
                        ) : null}
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
                  Guardar consumo por talla
                </Button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
