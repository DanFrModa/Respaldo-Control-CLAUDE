import { MoonIcon, SunIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { useTema } from './useTema';

/**
 * Boton para alternar entre tema claro y oscuro. Construido con el `Button` de
 * shadcn (variante fantasma, tamaño icono) para combinar con la app. Es
 * accesible: `aria-label` en español describe la accion que ocurrira al
 * pulsarlo, y el icono (sol/luna) refleja a que tema se cambiara.
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
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={alternar}
      aria-label={etiqueta}
      title={etiqueta}
      data-testid="alternar-tema"
    >
      {vaAOscuro ? <MoonIcon aria-hidden /> : <SunIcon aria-hidden />}
    </Button>
  );
}
