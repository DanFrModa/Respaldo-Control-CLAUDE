import { GitCompareArrows } from 'lucide-react';

import type { FrenteAlGrupo } from '@/api/tipos';
import { cn } from '@/lib/utils';

/**
 * ⭐⭐ **EL AVISO DE LA OP QUE SE DESVÍA DEL GRUPO** (fila 0.068 (a), §Post-F9.146 pregunta 4).
 *
 * DANIEL: *«Normalmente todas las OP deben de ir iguales. Puede pasar que una OP del grupo se le
 * cambie algún avío (por ejemplo, no hubo cierre de ese tono y se compró otro tipo de cierre sólo
 * para la café)… **se debe de poder hacer, pero advirtiendo de la diferencia**»*.
 *
 * Este archivo existe para que las **tres superficies** —la pantalla de la receta, el resumen del
 * cajón de la OP y las filas del Centro de Órdenes— digan EXACTAMENTE lo mismo. El precedente es
 * `receta-piezas.tsx`: al partir la receta en dos vistas, los predicados se escribieron dos veces y
 * coincidían por casualidad. Aquí no hay dos copias que puedan separarse.
 *
 * 🔴 **A1: aquí no se compara NADA, y tampoco se CONJUGA nada.** El servidor manda `aviso`,
 * `diferencias` y `notaFueraDeLaComparacion` ya redactados —con los folios, el singular/plural y qué
 * lleva cada una—; estos componentes sólo los pintan. ⚠️ La primera versión decía esto mismo y
 * **seis líneas más abajo conjugaba «quedó/quedaron» a mano**: la nota se mudó al servidor para que
 * la frase deje de ser mentira. Si el texto se armara aquí, la receta y el Centro acabarían
 * diciendo cosas distintas del mismo hecho.
 *
 * 🔴 **TONO `info`, no `warn`, y es una decisión, no un descuido.** La diferencia **es legítima**:
 * Daniel la describe como algo que pasa y está bien. El ámbar de esta app significa *«algo va mal y
 * hay que arreglarlo»* (la desalineación contra el modelo, la curva que no cuadra); pintar esto
 * igual entrenaría a la gente a ignorar los dos. Esto **informa**: no bloquea, no pide un acto y no
 * hay nada que corregir.
 */

/**
 * EL BANNER COMPLETO — para la pantalla de la receta de la OP, que es donde hay sitio para leer.
 * Enseña **material por material** qué lleva esta OP y qué llevan sus hermanas: un aviso que sólo
 * dijera «va distinta» obligaría a abrir las otras OP y compararlas a mano, que es justo el trabajo
 * que esto viene a quitar.
 */
export function AvisoHermanas({
  frenteAlGrupo,
}: {
  /**
   * 🔴 **`| undefined` no es defensa de más: es la MISMA guarda que {@link ChipHermanas}, y sin ella
   * esta pantalla se cae entera.** Medido: con una respuesta de receta ANTERIOR a esta etapa —una
   * que el caché de TanStack Query todavía tenga, o el `data` viejo mientras la nueva consulta viaja—
   * `frenteAlGrupo` llega `undefined` y `frenteAlGrupo.aviso` revienta con un `TypeError`, tumbando
   * la pantalla de la receta completa. El tipo del contrato dice que el campo SIEMPRE viene, y en el
   * servidor es cierto; en el navegador, entre despliegues, no.
   *
   * ⚠️ Las dos gemelas de este archivo guardan IGUAL a propósito: que una lo hiciera y la otra no es
   * exactamente cómo se cuela un defecto que sólo se ve en una de las tres superficies.
   */
  frenteAlGrupo: FrenteAlGrupo | undefined;
}): React.JSX.Element | null {
  if (frenteAlGrupo === undefined) return null;
  const nota = frenteAlGrupo.notaFueraDeLaComparacion;

  /*
   * 🔴 **SIN diferencias pero CON hermanas apartadas: se dice igual.** Antes este componente
   * devolvía `null` en cuanto `aviso` era null, así que la nota de las apartadas era **inalcanzable
   * justo en el caso silencioso** — el único en el que hacía falta. Y con el histórico real (el ETL
   * sí escribe recetas congeladas) ése es el caso COMÚN, no la esquina: sin esta rama, «esta OP va
   * igual que su hermana» se leería como un visto bueno del grupo entero cuando la mitad de la
   * familia ni siquiera entró.
   *
   * Va en tono NEUTRO —no en el `info` del aviso— porque no es un aviso: es el alcance de lo que se
   * comparó.
   *
   * ⚠️ **Y es el ÚNICO sitio donde ese alcance se ve.** Los chips de lista lo llevan en su `title`,
   * así que sólo cuando el chip aparece —o sea, cuando hay aviso—: en el Centro de Órdenes, una
   * familia entera de histórico migrado sale con la fila LIMPIA. Declarado en el encabezado de
   * `dominio/produccion/hermanas-de-la-op.ts`; poner un chip en cada fila con historia migrada
   * llenaría de ruido la pantalla principal justo el día del arranque.
   */
  if (frenteAlGrupo.aviso === null) {
    return nota === null ? null : (
      <p
        className="rounded-lg border bg-muted/30 p-2 text-xs text-muted-foreground"
        data-testid="receta-hermanas-fuera"
      >
        {nota}
      </p>
    );
  }

  return (
    <div
      className="space-y-1 rounded-lg border border-info/50 bg-info/5 p-3"
      data-testid="receta-aviso-hermanas"
    >
      <p className="flex items-center gap-1.5 text-sm font-medium text-info">
        <GitCompareArrows className="size-4" aria-hidden />
        Esta OP no lleva lo mismo que las otras del mismo modelo
      </p>
      <ul className="list-disc space-y-0.5 pl-5 text-xs">
        {frenteAlGrupo.diferencias.map((d, i) => (
          <li key={`${d.tipo}-${d.material}-${d.que}-${String(i)}`}>{d.detalle}</li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        No es un error y no bloquea nada: una OP puede llevar algo distinto (un cierre de otro tono,
        una jareta que se quitó). Sólo se avisa para que la diferencia no pase inadvertida.
        {nota === null ? '' : ` ${nota}`}
      </p>
    </div>
  );
}

/**
 * EL CHIP — para las listas (el Centro de Órdenes) y para el resumen del cajón de la OP, donde no
 * cabe el detalle. El texto largo va en el `title`, así que quien pasa el cursor ve QUÉ difiere sin
 * salir de la lista.
 */
export function ChipHermanas({
  frenteAlGrupo,
  className,
}: {
  frenteAlGrupo: FrenteAlGrupo | undefined;
  className?: string;
}): React.JSX.Element | null {
  if (frenteAlGrupo === undefined || frenteAlGrupo.aviso === null) return null;
  // ⚠️ La nota de las hermanas APARTADAS viaja en el `title` junto al detalle: sin ella, quien lee
  // el chip en una lista creería que se comparó contra la familia entera.
  const detalle = [
    ...frenteAlGrupo.diferencias.map((d) => d.detalle),
    ...(frenteAlGrupo.notaFueraDeLaComparacion === null
      ? []
      : [frenteAlGrupo.notaFueraDeLaComparacion]),
  ].join('\n');
  return (
    <span
      className={cn('flex items-center gap-1 text-[10px] leading-tight text-info', className)}
      title={detalle}
      data-testid="chip-hermanas"
    >
      <GitCompareArrows className="size-3 shrink-0" aria-hidden />
      {frenteAlGrupo.aviso}
    </span>
  );
}
