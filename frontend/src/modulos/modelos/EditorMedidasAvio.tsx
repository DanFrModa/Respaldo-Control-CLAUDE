import { AlertTriangleIcon, ChevronDown, ChevronRight, Loader2Icon, Ruler } from 'lucide-react';
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

/** Una talla en captura (cantidad como texto + la medida amarrada). */
interface RenglonTalla {
  idTalla: number;
  etiquetaTalla: string;
  /** CANTIDAD como texto (el `<input type=number>` entrega string). */
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
 * Captura POR TALLA de un avío del BOM (F8-E1, R18 + amarre de medida R5/B11). Panel colapsable
 * dentro del renglón de avío del editor de receta.
 *
 * ⭐ **V1-E3g (§Post-F9.66): hay DOS cosas capturables por talla y nunca las dos a la vez.** Es el
 * hallazgo de Daniel capturando un cierre — *"lo que hay que poner por talla no es el consumo, sino
 * la medida a la que hay que pedir ese cierre"*:
 *
 *  • **modo `consumo`** (elástico, jareta) — se captura CUÁNTO se gasta en cada talla, en la unidad
 *    del avío (0.75 m en CH), que se muestra PEGADA al campo. Se multiplica por piezas y precio.
 *  • **modo `medida`** (cierres) — el avío tiene un catálogo de medidas: por talla se elige QUÉ se
 *    pide. La cantidad no varía (es el consumo por prenda del renglón), así que el campo numérico
 *    ni se muestra ni se manda: el servidor lo resuelve solo.
 *
 * El modo lo decide el SERVIDOR (`modoCaptura`), no esta pantalla: es el mismo hecho con el que el
 * precosto decide promediar las medidas del avío. Los `avisos` (número absurdo para la unidad,
 * contradicción heredada) se muestran pero **NO bloquean**.
 *
 * ⭐ V1-E3c: los renglones los trae el servidor DESDE LA CURVA del modelo, y el aviso "el modelo no
 * tiene curva de tallas" solo sale cuando de verdad no la tiene (`tieneCurva`).
 *
 * Solo se monta para avíos YA guardados en el BOM (el endpoint requiere el renglón). El estado de
 * captura vive aquí (sembrado desde el GET); el backend valida y es la autoridad (A1). Sin
 * `puedeAdministrar` el panel queda en solo lectura.
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

  // El MODO lo manda el servidor. Mientras no llega la respuesta se asume `consumo` (lo que había
  // antes de V1-E3g): así el panel nunca se queda en blanco esperando.
  const modo = datos?.modoCaptura ?? 'consumo';
  const porMedida = modo === 'medida';
  const unidadConsumo = datos?.unidadConsumo ?? null;
  const avisos = datos?.avisos ?? [];
  const titulo = porMedida ? 'Medida por talla' : 'Consumo por talla';

  function guardarMedidas(): void {
    guardar.mutate(
      {
        idModelo,
        idAvio,
        cuerpo: porMedida
          ? {
              // En modo MEDIDA la cantidad no se captura por talla: el toggle va apagado y sólo
              // viajan las tallas que SÍ tienen medida elegida (set-completo: lo que no viene, no
              // está — así se des-captura una talla dejándola en "Sin medida").
              consumoPorTalla: false,
              tallas: tallas
                .filter((r) => r.idAvioMedida !== null)
                .map((r) => ({ idTalla: r.idTalla, idAvioMedida: r.idAvioMedida })),
            }
          : {
              consumoPorTalla,
              // ⚠️ Las tallas en BLANCO NO se mandan: el PUT es SET-COMPLETO, así que "no viene" =
              // "no hay fila". Mandarlas como 0 creaba una cantidad de cero REAL que el precosto
              // metía al promedio y que apagaba el aviso de talla sin medida. Un 0 TECLEADO sí
              // viaja: es un cero a propósito. Y vaciar una talla ya capturada la BORRA.
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
        onSuccess: () => toast.success(`${titulo} guardado.`),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  // Con curva SIEMPRE hay matriz que capturar: el servidor manda una fila por talla de la curva.
  const tieneCurva = datos?.tieneCurva ?? tieneCurvaModelo ?? false;
  const medidasCatalogo = (catalogoMedidas.data?.datos ?? []).filter((m) => m.activo);
  // En modo MEDIDA la matriz se muestra siempre que haya tallas; en modo CONSUMO sólo si el avío
  // está marcado como "se consume por talla".
  const mostrarMatriz = porMedida || consumoPorTalla;

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
        {titulo}
      </Button>

      {abierto ? (
        <div className="mt-2 space-y-3" data-testid={`panel-medidas-avio-${idAvio}`}>
          {consulta.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : consulta.isError ? (
            <p className="text-sm text-destructive">{consulta.error.message}</p>
          ) : (
            <>
              {avisos.length > 0 ? (
                <ul
                  className="space-y-1 rounded-md border border-warn/40 bg-warn-soft px-2 py-1.5 text-xs"
                  data-testid={`avisos-medidas-avio-${idAvio}`}
                >
                  {avisos.map((a) => (
                    <li key={a} className="flex gap-1.5">
                      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {porMedida ? (
                <p className="text-xs text-muted-foreground" data-testid={`modo-medida-${idAvio}`}>
                  Este avío se compra POR MEDIDA: por talla se elige <strong>qué medida</strong> se
                  pide, no cuánto se gasta. La cantidad es la del renglón (consumo por prenda) y no
                  cambia entre tallas.
                </p>
              ) : (
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
              )}

              {mostrarMatriz ? (
                !tieneCurva && tallas.length === 0 ? (
                  <p className="text-xs text-muted-foreground" data-testid={`sin-curva-${idAvio}`}>
                    El modelo no tiene curva de tallas. Asígnale una curva (en los datos del modelo)
                    para capturar {porMedida ? 'la medida' : 'el consumo'} por talla.
                  </p>
                ) : porMedida && medidasCatalogo.length === 0 ? (
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid={`sin-medidas-catalogo-${idAvio}`}
                  >
                    Este avío no tiene medidas activas en su catálogo. Captúralas en la pantalla de
                    Avíos para poder elegir cuál lleva cada talla.
                  </p>
                ) : (
                  <ul className="space-y-1.5" data-testid={`tabla-tallas-avio-${idAvio}`}>
                    {tallas.map((r) => (
                      <li
                        key={r.idTalla}
                        className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-2 py-1.5"
                      >
                        <label
                          htmlFor={
                            porMedida
                              ? `medida-talla-${String(idAvio)}-${String(r.idTalla)}`
                              : `consumo-talla-${String(idAvio)}-${String(r.idTalla)}`
                          }
                          className="flex w-24 shrink-0 items-center gap-1.5 text-xs font-medium"
                        >
                          {r.etiquetaTalla}
                          {r.enCurva ? null : (
                            <ChipEstado tono="warn" sinPunto>
                              fuera de curva
                            </ChipEstado>
                          )}
                        </label>
                        {porMedida ? null : (
                          <span className="flex items-center gap-1.5">
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
                            {/* La unidad, PEGADA al campo: la defensa contra capturar en la unidad
                                equivocada (0.75 m ≠ 75 cm). */}
                            {unidadConsumo === null ? null : (
                              <span className="text-xs text-muted-foreground" aria-hidden>
                                {unidadConsumo}
                              </span>
                            )}
                          </span>
                        )}
                        {medidasCatalogo.length > 0 ? (
                          <SelectNativo
                            id={`medida-talla-${idAvio}-${r.idTalla}`}
                            className="w-56"
                            aria-label={`Medida del avío para la talla ${r.etiquetaTalla}`}
                            // En modo CONSUMO el amarre VIVE en la fila de la cantidad, y esa fila
                            // solo existe si hay cantidad capturada: sin ella no hay dónde
                            // guardarlo. En modo MEDIDA la fila la crea el propio amarre.
                            title={
                              !porMedida && r.consumo.trim() === ''
                                ? 'Captura primero el consumo de esta talla para poder amarrarle una medida.'
                                : undefined
                            }
                            disabled={
                              !puedeAdministrar ||
                              guardar.isPending ||
                              (!porMedida && r.consumo.trim() === '')
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
                  Guardar {porMedida ? 'medida por talla' : 'consumo por talla'}
                </Button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
