import { Warehouse } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Portada del modulo Catalogos: lista sus sub-catalogos. En F0 el unico
 * construido es **Almacenes** (el CRUD patron); el resto se iran agregando en
 * fases posteriores y por ahora se muestran como "Próximamente".
 *
 * Asi el CRUD de Almacenes es accesible navegando (Catalogos -> Almacenes), no
 * solo por URL directa, y queda demostrado el patron modulo -> sub-pantalla.
 */
const SUBCATALOGOS = [
  {
    clave: 'almacenes',
    titulo: 'Almacenes',
    descripcion: 'Catálogo de almacenes del kardex único (PT, telas y avíos).',
    ruta: '/catalogos/almacenes',
    icono: Warehouse,
    listo: true,
  },
  { clave: 'clientes', titulo: 'Clientes', descripcion: 'Catálogo de clientes y sus datos.' },
  { clave: 'maquileros', titulo: 'Maquileros', descripcion: 'Talleres de costura y estampado.' },
  { clave: 'proveedores', titulo: 'Proveedores', descripcion: 'Proveedores de telas y avíos.' },
  { clave: 'telas', titulo: 'Telas', descripcion: 'Catálogo de telas y composiciones.' },
  { clave: 'avios', titulo: 'Avíos', descripcion: 'Habilitación: hilos, botones, etiquetas…' },
  { clave: 'colores', titulo: 'Colores', descripcion: 'Catálogo de colores.' },
  { clave: 'tallas', titulo: 'Tallas', descripcion: 'Curvas de tallas (ilimitadas, D4).' },
] as const;

export function CatalogosPagina(): React.JSX.Element {
  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Catálogos</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Datos maestros del sistema. Elige un catálogo para administrarlo.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SUBCATALOGOS.map((sub) =>
          'listo' in sub && sub.listo ? (
            <Link key={sub.clave} to={sub.ruta} className="group">
              <Card className="h-full transition-colors group-hover:ring-primary/40">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <sub.icono className="size-4 text-muted-foreground" aria-hidden />
                    {sub.titulo}
                  </CardTitle>
                  <CardDescription>{sub.descripcion}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ) : (
            <Card key={sub.clave} className="h-full opacity-70">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  {sub.titulo}
                  <Badge variant="outline">Próximamente</Badge>
                </CardTitle>
                <CardDescription>{sub.descripcion}</CardDescription>
              </CardHeader>
            </Card>
          ),
        )}
      </div>
    </div>
  );
}
