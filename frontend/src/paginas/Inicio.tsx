import { Link } from 'react-router-dom';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { filtrarModulosVisibles } from '@/modulos/catalogo';
import { useSesion } from '@/sesion/useSesion';

/**
 * Inicio del sistema: saludo + acceso a los modulos visibles. Aqui viviran los
 * tableros (semaforos de la Ruta Critica y KPIs, D11) cuando se construyan los
 * indicadores; por ahora es un marcador de posicion.
 */
export function Inicio(): React.JSX.Element {
  const { sesion, permisos } = useSesion();
  const modulos = filtrarModulosVisibles(permisos);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Hola, {sesion?.nombre}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Empresa activa: {sesion?.empresaActiva.nombre}. Aquí aparecerán los tableros del negocio
        (avance de órdenes, semáforos de la Ruta Crítica e indicadores).
      </p>

      <h2 className="mt-8 text-sm font-medium text-muted-foreground">Módulos</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {modulos.map((modulo) => (
          <Link key={modulo.clave} to={modulo.ruta} className="group">
            <Card className="h-full transition-colors group-hover:ring-primary/40">
              <CardHeader>
                <CardTitle className="text-base">
                  {modulo.titulo}
                  {modulo.destacado ? ' ⭐' : ''}
                </CardTitle>
                <CardDescription>{modulo.descripcion}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
