import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';

/**
 * Página "no encontrada" (404 del cliente): una ruta que de verdad NO EXISTE.
 * Ofrece volver al inicio. Scroll propio (el cascarón deja el `<main>` sin
 * scroll).
 *
 * §Post-F9.68 — antes decía "no existe o no tienes permiso para verla", y esa
 * cláusula era a la vez el ÚNICO texto de la app que le hablaba de permisos al
 * usuario y FALSA en el único caso en que se veía: desde que existe la capa de
 * ruta, lo que no le toca al usuario lo atiende `PantallaNoDisponible` y aquí
 * solo llegan URLs inexistentes. La pantalla oculta por permisos ya no pasa por
 * aquí (la sirve `Proximamente` con el texto aprobado).
 */
export function NoEncontrado(): React.JSX.Element {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 py-16 text-center">
        <p className="font-heading text-6xl font-bold tracking-tight text-primary">404</p>
        <h1 className="mt-4 text-[21px] leading-tight font-semibold tracking-tight">
          Página no encontrada
        </h1>
        <p className="mt-2 max-w-md text-[12.5px] text-muted-foreground">
          La página que buscas no existe.
        </p>
        <Button asChild className="mt-6">
          <Link to="/">Volver al inicio</Link>
        </Button>
      </div>
    </div>
  );
}
