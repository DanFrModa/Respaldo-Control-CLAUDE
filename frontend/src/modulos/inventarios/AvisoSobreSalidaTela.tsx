import { TriangleAlert } from 'lucide-react';

import type { PreviaSalidaTelaColor } from '@/api/tipos';

/**
 * ⭐⭐ **AVISO (a) — LO QUE SE SACA CONTRA LO QUE LA ORDEN PIDE** (fila 0.101, Daniel §Post-F9.193
 * dec. 8).
 *
 * Lo comparten LAS DOS pantallas que sacan tela a una orden —la vigente por color y la LEGADA por
 * lote— porque es **el mismo aviso**: mismo veredicto, mismo servidor y mismas palabras. Vive aquí
 * para que arreglar la frase o el formato no haya que hacerlo dos veces (y para que no puedan
 * divergir sin que nadie lo note).
 *
 * 🔴 **No decide nada.** `sobreSalida`, `requerido`, `yaSalido` y `excedente` los calcula el dominio
 * (`inventarios/previa-salida-tela-orden.ts`) contra el snapshot de la explosión —la MISMA cifra que
 * ve el comprador— y contra TODO lo que ya había salido antes de esa orden. Este componente sólo
 * filtra los renglones marcados y los pinta.
 *
 * ⭐ **Y dice también cuando NO PUEDE comparar.** El aviso (a) es *silencio o alarma*, así que un
 * silencio que en realidad significa *«no sé»* se lee como *«voy bien»* — el mismo defecto que esta
 * fila vino a corregir, con el signo cambiado. Si la orden **no tiene explosión guardada** (las
 * migradas de Access no la tienen), se dice con una línea sobria: no hay contra qué comparar.
 *
 * 🔴 **AVISA, nunca bloquea:** no apaga ningún botón ni impide guardar. El almacén sabe cosas que el
 * sistema no sabe, y a veces de verdad hace falta más tela.
 */
export function AvisoSobreSalidaTela({
  datos,
  testId,
}: {
  /** La previa que devolvió el servidor; `undefined` mientras no hay nada capturado. */
  datos: PreviaSalidaTelaColor | undefined;
  /** `data-testid` del bloque; cada renglón usa `${testId}-<idTela>`. */
  testId: string;
}): React.JSX.Element | null {
  if (datos === undefined) {
    return null;
  }
  const seSalen = datos.telas.filter((t) => t.sobreSalida);

  // Nada que comparar: la orden no tiene explosión. Se dice en tono NEUTRO (no es una alarma: es la
  // ausencia de una), para que el silencio del aviso no se confunda con un visto bueno.
  if (seSalen.length === 0) {
    if (datos.tieneExplosion) {
      return null;
    }
    return (
      <p
        className="text-xs text-muted-foreground"
        role="note"
        data-testid={`${testId}-sin-explosion`}
      >
        Esta orden todavía no tiene explosión de materiales guardada: no hay contra qué comparar lo
        que estás sacando.
      </p>
    );
  }

  return (
    <div
      className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400"
      role="note"
      data-testid={testId}
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="space-y-1">
        <p>
          <strong>Sacas más de lo que la orden pide.</strong> Se compara el <strong>cuerpo</strong>:
          la orden no dice cuánto complemento lleva la tela. Este aviso no bloquea la salida: si de
          verdad hace falta más tela, regístrala.
        </p>
        <ul className="list-disc space-y-0.5 pl-4">
          {seSalen.map((t) => (
            <li key={t.idTela} data-testid={`${testId}-${String(t.idTela)}`}>
              <strong>{t.tela}</strong>: la orden pide{' '}
              {t.requerido === null ? '—' : t.requerido.toLocaleString('es-MX')}
              {t.unidad === null ? '' : ` ${t.unidad}`}
              {t.yaSalido > 0
                ? `, ya habían salido ${t.yaSalido.toLocaleString('es-MX')} de cuerpo`
                : ''}{' '}
              y ahora sacas {t.aSacar.toLocaleString('es-MX')} de cuerpo → te pasas por{' '}
              <strong>{t.excedente.toLocaleString('es-MX')}</strong>.
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
