import { MoonIcon, SunIcon } from 'lucide-react';

import { claseBotonIcono } from '@/lib/utils';

import { useTema } from './useTema';

/**
 * Boton para alternar entre tema claro y oscuro, con el look EXACTO del
 * prototipo (`.icon-btn`, fidelidad R9): 32px, icono de 17px atenuado que al
 * hover recupera color + borde. Es accesible: `aria-label` en español describe
 * la accion que ocurrira al pulsarlo, y el icono (sol/luna) refleja a que tema
 * se cambiara.
 *
 * El sistema de tema subyacente —clase `dark` en `<html>` + tokens CSS, default
 * claro, persistido en localStorage— es el de E1.1 (`tema.ts`/`useTema`), aqui
 * solo cambia la presentacion del boton.
 */
export function AlternadorTema(): React.JSX.Element {
  const { tema, alternar } = useTema();
  const vaAOscuro = tema === 'claro';
  const etiqueta = vaAOscuro ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro';

  return (
    <button
      type="button"
      onClick={alternar}
      aria-label={etiqueta}
      title={etiqueta}
      data-testid="alternar-tema"
      className={claseBotonIcono}
    >
      {vaAOscuro ? (
        <MoonIcon className="size-[17px]" aria-hidden />
      ) : (
        <SunIcon className="size-[17px]" aria-hidden />
      )}
    </button>
  );
}
