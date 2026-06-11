import { Building2, CircleUser, LogOut, Menu } from 'lucide-react';
import { useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';

import { AlternadorTema } from '@/AlternadorTema';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { authClient } from '@/lib/auth-client';
import { filtrarModulosVisibles } from '@/modulos/catalogo';
import { NavegacionModulos } from '@/modulos/NavegacionModulos';
import { useSesion } from '@/sesion/useSesion';

/**
 * Cascaron del sistema: sidebar fijo en escritorio, Sheet en movil (responsive,
 * PLANMAESTRO: captura en PC y consulta tambien en celular). Encabezado con
 * empresa activa, alternador de tema y menu de usuario con cierre de sesion. Las
 * pantallas de cada modulo se renderizan en el `Outlet`.
 *
 * El menu lista SOLO los modulos que los permisos del usuario hacen visibles
 * (A4); la sesion la provee `ProveedorSesion` (`GET /api/sesion`). El guard
 * `RutaProtegida` garantiza que aqui ya hay sesion.
 */
export function CascaronSistema(): React.JSX.Element {
  const navigate = useNavigate();
  const { sesion, permisos, refrescar } = useSesion();
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);

  // RutaProtegida ya garantizo sesion; este guard defensivo satisface el tipo.
  if (sesion === null) {
    return <Outlet />;
  }

  const modulos = filtrarModulosVisibles(permisos);

  async function cerrarSesion(): Promise<void> {
    await authClient.signOut();
    await refrescar();
    // navigate() es asincrono en React Router 7; no necesitamos esperarlo.
    void navigate('/login', { replace: true });
  }

  return (
    <div className="flex min-h-svh w-full">
      {/* Sidebar de escritorio */}
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar lg:flex">
        <div className="flex h-14 items-center border-b px-4">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            CONTROL <span className="text-muted-foreground">v2</span>
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto">
          <NavegacionModulos modulos={modulos} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-background px-4">
          {/* Menu movil */}
          <Sheet open={menuMovilAbierto} onOpenChange={setMenuMovilAbierto}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abrir menú">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetHeader className="border-b px-4 py-3">
                <SheetTitle className="text-left">
                  CONTROL <span className="text-muted-foreground">v2</span>
                </SheetTitle>
              </SheetHeader>
              <div className="overflow-y-auto">
                <NavegacionModulos modulos={modulos} alNavegar={() => setMenuMovilAbierto(false)} />
              </div>
            </SheetContent>
          </Sheet>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <Badge
              variant="secondary"
              className="hidden gap-1.5 sm:inline-flex"
              data-testid="empresa-activa"
            >
              <Building2 className="size-3.5" aria-hidden />
              {sesion.empresaActiva.nombre}
            </Badge>
            <AlternadorTema />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 px-2" data-testid="menu-usuario">
                  <CircleUser className="size-5" aria-hidden />
                  <span className="hidden max-w-40 truncate text-sm sm:inline">
                    {sesion.nombre}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span>{sesion.nombre}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      @{sesion.username} · {sesion.empresaActiva.nombre}
                    </span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  data-testid="cerrar-sesion"
                  onSelect={() => void cerrarSesion()}
                >
                  <LogOut className="size-4" aria-hidden />
                  Cerrar sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
