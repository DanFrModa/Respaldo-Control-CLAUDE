import { Loader2Icon, StarIcon } from 'lucide-react';
import { toast } from 'sonner';

import { useAceptarAviosFavoritos, useAviosFavoritosBom } from '@/api/modelos';
import { Button } from '@/components/ui/button';

/**
 * ⭐ V1-E3v (§Post-F9.90) — LA SUGERENCIA de avíos favoritos al armar la receta del MODELO.
 *
 * > Daniel: *"cuando damos de alta una receta, deberíamos de tener algunos avíos «favoritos». Todo
 * > lleva etiqueta de lavado, por ejemplo. (…) los favoritos aparecen como sugerencia. **Pero solo
 * > hay que aceptarlos y ya.**"*
 *
 * Ni precarga silenciosa (nadie los vería) ni palomear uno por uno (§Post-F9.36 punto 3: obligar a
 * ocho clics entrena a la gente a clickear sin leer). **Se ven antes de entrar y entran de un
 * clic**: la tarjeta los enseña con su cantidad y UN botón los acepta todos.
 *
 * 🔴 **Aquí no hay ni una lista de avíos ni un número.** Quién es favorito, con cuánto, cuáles le
 * faltan a ESTA receta y cuáles ya están lo dice el servidor (A1,
 * `dominio/modelos/avios-favoritos.ts`). Si Daniel no ha marcado ninguno en el catálogo, la
 * tarjeta no aparece — y eso es correcto, no un error.
 *
 * Se pinta SOLO en la sección de Avíos de la receta del modelo (la de la OP tiene su propia vida:
 * cada orden lleva su receta CONGELADA, §Post-F9.43).
 */
export function SugerenciaAviosFavoritos({
  idModelo,
  puedeAdministrar,
  hayCambiosSinGuardar,
  deshabilitado = false,
}: {
  idModelo: number;
  /**
   * Aceptar ESCRIBE en la receta, así que sin `modelos.administrar` la tarjeta no se pinta —
   * y el servidor rechaza el POST de todos modos (§Post-F9.68: esconder Y bloquear).
   */
  puedeAdministrar: boolean;
  /**
   * ¿La captura de avíos tiene cambios que aún no se guardan? Aceptar escribe en el servidor y
   * recarga la ficha, lo que RESIEMBRA la captura: si se dejara pulsar ahora, lo tecleado y no
   * guardado se perdería sin avisar. Se bloquea con la razón a la vista en vez de tragárselo.
   */
  hayCambiosSinGuardar: boolean;
  /** Hay otro guardado en vuelo: no encimar escrituras sobre el mismo BOM. */
  deshabilitado?: boolean;
}): React.JSX.Element | null {
  const sugerencia = useAviosFavoritosBom(puedeAdministrar ? idModelo : undefined);
  const aceptar = useAceptarAviosFavoritos();

  if (!puedeAdministrar) return null;
  const datos = sugerencia.data;
  if (datos === undefined) return null;

  const { sugeridos, yaEnLaReceta, sinCantidad } = datos;
  // Nada marcado como favorito en el catálogo (o nada que decir): la tarjeta no estorba.
  if (sugeridos.length === 0 && sinCantidad.length === 0 && yaEnLaReceta.length === 0) return null;

  function aceptarTodos(): void {
    aceptar.mutate(idModelo, {
      onSuccess: (r) => {
        toast.success(
          r.agregados === 0
            ? 'Los avíos favoritos ya estaban en la receta.'
            : r.agregados === 1
              ? `Se agregó «${r.clavesAgregadas[0] ?? ''}» a la receta.`
              : `Se agregaron ${r.agregados} avíos favoritos a la receta.`,
        );
      },
      onError: (error) => toast.error(error.message),
    });
  }

  const enCurso = aceptar.isPending;

  return (
    <div
      className="space-y-2 rounded-lg border border-primary/40 bg-primary-soft p-3"
      data-testid="sugerencia-avios-favoritos"
    >
      {sugeridos.length > 0 ? (
        <>
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <StarIcon className="size-4" aria-hidden />
            {sugeridos.length === 1
              ? 'Un avío favorito no está en esta receta'
              : `${sugeridos.length} avíos favoritos no están en esta receta`}
          </p>
          <p className="text-xs text-muted-foreground">
            Son los que se marcaron como favoritos en el catálogo de avíos, con la cantidad que ahí
            se les puso. Aceptarlos los agrega a la receta; después se pueden ajustar o quitar como
            cualquier renglón.
          </p>
          <ul className="space-y-1.5">
            {sugeridos.map((a) => (
              <li
                key={a.idAvio}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border bg-background px-2 py-1.5 text-xs"
                data-testid={`avio-favorito-${a.idAvio}`}
              >
                <span className="min-w-0">
                  <span className="font-medium">{a.clave}</span>
                  <span className="text-muted-foreground"> — {a.descripcion}</span>
                </span>
                {/* La cantidad es `Avio.cantFav` del catálogo, tal como la manda el servidor. */}
                <span className="font-medium tabular-nums">
                  {a.cantidadSugerida}
                  {a.unidad === null || a.unidad === '' ? '' : ` ${a.unidad}`}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={aceptarTodos}
              disabled={enCurso || deshabilitado || hayCambiosSinGuardar}
              aria-busy={enCurso}
              data-testid="aceptar-avios-favoritos"
            >
              {enCurso ? <Loader2Icon className="size-3.5 animate-spin" aria-hidden /> : null}
              {sugeridos.length === 1 ? 'Aceptar el favorito' : `Aceptar los ${sugeridos.length}`}
            </Button>
            {hayCambiosSinGuardar ? (
              <span className="text-xs text-warn" data-testid="favoritos-bloqueado-sin-guardar">
                Guarda primero la receta: aceptar la vuelve a leer del servidor y perderías lo que
                acabas de capturar.
              </span>
            ) : null}
          </div>
        </>
      ) : yaEnLaReceta.length > 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="favoritos-ya-puestos">
          {yaEnLaReceta.length === 1
            ? 'El avío favorito del catálogo ya está en esta receta.'
            : `Los ${yaEnLaReceta.length} avíos favoritos del catálogo ya están en esta receta.`}
        </p>
      ) : null}

      {/* Un favorito SIN cantidad preestablecida no se sugiere (inventarle el consumo sería
          escribir una suposición como hecho), pero tampoco se calla: se dice quién es. */}
      {sinCantidad.length > 0 ? (
        <p className="text-xs text-warn" data-testid="favoritos-sin-cantidad">
          {sinCantidad.length === 1
            ? 'Este avío está marcado como favorito sin cantidad preestablecida, así que no se sugiere: '
            : 'Estos avíos están marcados como favoritos sin cantidad preestablecida, así que no se sugieren: '}
          {sinCantidad.map((a) => a.clave).join(', ')}. Captúrala en el catálogo de avíos.
        </p>
      ) : null}
    </div>
  );
}
