import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';

/**
 * Pagina "no encontrada" (404 del cliente): ruta inexistente, o modulo que los
 * permisos del usuario no hacen visible (sin permiso -> oculto, A4). Ofrece
 * volver al inicio.
 */
export function NoEncontrado(): React.JSX.Element {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center py-16 text-center">
      <p className="text-6xl font-bold tracking-tight text-muted-foreground">404</p>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Página no encontrada</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        La página que buscas no existe o no tienes permiso para verla.
      </p>
      <Button asChild className="mt-6">
        <Link to="/">Volver al inicio</Link>
      </Button>
    </div>
  );
}
