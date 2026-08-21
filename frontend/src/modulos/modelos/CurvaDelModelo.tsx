import { AlertTriangleIcon, Loader2Icon, Ruler } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useAsignarCurvaDesdeOrdenes,
  useCurvasSugeridas,
  type CurvaSugerida,
  type ModeloFicha,
} from '@/api/modelos';
import { Button } from '@/components/ui/button';

/**
 * ⭐ **LA CURVA DEL MODELO CONTRA LA DE SUS ÓRDENES** (V1-E3r, §Post-F9.81). Dos caras del mismo
 * asunto, y por eso viven en el mismo bloque de la ficha:
 *
 *  1. **Si el modelo TIENE curva y no coincide con la de sus OP → AVISA.** El texto lo redacta el
 *     SERVIDOR (`avisosCurva`, A1): esta pantalla no arma la frase, no resuelve el plural y no
 *     decide qué talla sobra. Si lo hiciera, la ficha y la receta de la OP acabarían diciendo cosas
 *     distintas del mismo desajuste. 🔴 NUNCA bloquea (§Post-F9.64: la curva es una guía, no una
 *     jaula).
 *  2. **Si el modelo NO tiene curva y sus OP sí → la PROPONE.** *"Si el modelo no tiene curva y ya
 *     tiene una OP, que jale la curva de la OP"* (Daniel). Se propone y **la persona confirma**:
 *     asignarla escribe el catálogo y lo hereda todo lo posterior (D3).
 *
 * ⚠️ **Si varias OP usan curvas distintas se enseñan TODAS**, con cuántas OP usa cada una y sus
 * folios. Elegir por el usuario ("la más reciente") fallaría en silencio justo en el caso que dio
 * origen a la decisión: un modelo de bebés con la receta capturada en tallas de caballero.
 */
export function CurvaDelModelo({
  ficha,
  puedeAdministrar,
}: {
  ficha: ModeloFicha;
  puedeAdministrar: boolean;
}): React.JSX.Element | null {
  const tieneCurva = ficha.tallasCurva.length > 0;
  // La propuesta sólo se pide cuando puede servir de algo: sin curva. Con curva, el servidor
  // devuelve la lista vacía de todas formas — pedirla sería una llamada que no se va a usar.
  const sugeridas = useCurvasSugeridas(ficha.id, !tieneCurva);
  const asignar = useAsignarCurvaDesdeOrdenes();
  const [elegida, setElegida] = useState<number | null>(null);

  const propuestas: CurvaSugerida[] = tieneCurva ? [] : (sugeridas.data?.sugerencias ?? []);
  const avisos = ficha.avisosCurva;

  if (avisos.length === 0 && propuestas.length === 0) {
    return null;
  }

  function confirmar(sugerencia: CurvaSugerida): void {
    asignar.mutate(
      { id: ficha.id, idsTalla: sugerencia.idsTalla },
      {
        onSuccess: (resultado) => {
          toast.success(
            resultado.curvaCreada
              ? `Curva «${resultado.nombreCurva}» creada y asignada al modelo.`
              : `Curva «${resultado.nombreCurva}» asignada al modelo.`,
          );
          setElegida(null);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <div className="space-y-3" data-testid="curva-del-modelo">
      {avisos.length > 0 ? (
        <div
          className="space-y-1 rounded-lg border border-warn/50 bg-warn/5 p-3"
          data-testid="modelo-avisos-curva"
        >
          <p className="flex items-center gap-1.5 text-sm font-medium text-warn">
            <AlertTriangleIcon className="size-4" aria-hidden />
            La curva de tallas del modelo no es la que piden sus órdenes
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs">
            {avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {propuestas.length > 0 ? (
        <div
          className="space-y-2 rounded-lg border border-primary/40 bg-primary-soft p-3"
          data-testid="modelo-curva-sugerida"
        >
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Ruler className="size-4" aria-hidden />
            {propuestas.length === 1
              ? 'Este modelo no tiene curva de tallas, pero sus órdenes sí'
              : 'Este modelo no tiene curva, y sus órdenes usan curvas distintas'}
          </p>
          <p className="text-xs text-muted-foreground">
            {propuestas.length === 1
              ? 'Puedes asignarle la que ya usa su producción. Se guarda en el catálogo del modelo y la heredan la receta, el precosteo y las OP siguientes, así que lo confirmas tú.'
              : 'Elige cuál es la buena: se guarda en el catálogo del modelo y la heredan la receta, el precosteo y las OP siguientes.'}
          </p>
          <ul className="space-y-1.5">
            {propuestas.map((s) => {
              const clave = s.idsTalla.join('-');
              const seleccionada = elegida === s.idsTalla[0] && propuestas.length === 1;
              return (
                <li
                  key={clave}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-2 py-1.5"
                  data-testid={`curva-sugerida-${clave}`}
                >
                  <div className="min-w-0 text-xs">
                    <p className="font-medium">{s.etiquetas.join(' · ')}</p>
                    <p className="text-muted-foreground">
                      «{s.nombre}» — la usan {s.ordenes === 1 ? '1 orden' : `${s.ordenes} órdenes`}
                      {s.folios.length > 0
                        ? ` (folio${s.folios.length === 1 ? '' : 's'} ${s.folios.join(', ')})`
                        : ''}
                      {s.idCurvaExistente === null ? ' · se creará en el catálogo' : ''}
                    </p>
                  </div>
                  {puedeAdministrar ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={asignar.isPending}
                      aria-busy={asignar.isPending && seleccionada}
                      onClick={() => {
                        setElegida(s.idsTalla[0] ?? null);
                        confirmar(s);
                      }}
                    >
                      {asignar.isPending ? (
                        <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
                      ) : null}
                      Asignar esta curva
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
