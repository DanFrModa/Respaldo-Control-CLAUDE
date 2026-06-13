import { Building2, ChevronsLeft, ChevronsRight, LogOut, Menu } from 'lucide-react';
import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';

import { AlternadorTema } from '@/AlternadorTema';
import { Marca } from '@/components/Marca';
import { Avatar } from '@/components/dominio/visuales';
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { authClient } from '@/lib/auth-client';
import { useColapsoSidebar } from '@/lib/useColapsoSidebar';
import { cn } from '@/lib/utils';
import { filtrarModulosVisibles } from '@/modulos/catalogo';
import { NavegacionModulos } from '@/modulos/NavegacionModulos';
import { useSesion } from '@/sesion/useSesion';

/**
 * Cascaron del sistema (rediseño "Teal fresco"): sidebar COLAPSABLE en escritorio
 * (lista + detalle viven dentro de cada pantalla), Sheet en movil. La raiz ocupa
 * el alto de la ventana y NO scrollea (`h-svh overflow-hidden`): el `<main>` llena
 * el resto y cada pantalla maneja su propio scroll. Encabezado con empresa activa,
 * alternador de tema y menu de usuario; las pantallas se renderizan en el `Outlet`.
 *
 * El menu lista SOLO los modulos que los permisos del usuario hacen visibles (A4);
 * la sesion la provee `ProveedorSesion` (`GET /api/sesion`). El guard
 * `RutaProtegida` garantiza que aqui ya hay sesion.
 */
export function CascaronSistema(): React.JSX.Element {
  const navigate = useNavigate();
  const { sesion, permisos, refrescar } = useSesion();
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);
  const { colapsado, alternar: alternarColapso } = useColapsoSidebar();

  // RutaProtegida ya garantizo sesion; este guard defensivo satisface el tipo.
  if (sesion === null) {
    return <Outlet />;
  }

  const modulos = filtrarModulosVisibles(permisos);
  const etiquetaColapso = colapsado ? 'Expandir menú' : 'Contraer menú';

  async function cerrarSesion(): Promise<void> {
    await authClient.signOut();
    await refrescar();
    // navigate() es asincrono en React Router 7; no necesitamos esperarlo.
    void navigate('/login', { replace: true });
  }

  return (
    <TooltipProvider>
      <div className="flex h-svh w-full overflow-hidden">
        {/* Sidebar de escritorio (colapsable). */}
        <aside
          className={cn(
            'hidden shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200 ease-in-out lg:flex',
            colapsado ? 'w-19' : 'w-64',
          )}
        >
          {/* Marca + boton contraer */}
          <div
            className={cn(
              'flex h-14 items-center border-b',
              colapsado ? 'justify-center px-2' : 'justify-between px-4',
            )}
          >
            {colapsado ? <Marca soloIcono /> : <Marca tamano="md" />}
            {colapsado ? null : (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={alternarColapso}
                aria-label={etiquetaColapso}
                title={etiquetaColapso}
                data-testid="contraer-menu"
              >
                <ChevronsLeft className="size-4" aria-hidden />
              </Button>
            )}
          </div>

          {/* Boton expandir (solo visible colapsado, bajo la marca) */}
          {colapsado ? (
            <div className="flex justify-center border-b py-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={alternarColapso}
                    aria-label={etiquetaColapso}
                    data-testid="contraer-menu"
                  >
                    <ChevronsRight className="size-4" aria-hidden />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">{etiquetaColapso}</TooltipContent>
              </Tooltip>
            </div>
          ) : null}

          {/* Navegacion */}
          <div className="flex-1 overflow-y-auto">
            <NavegacionModulos modulos={modulos} colapsado={colapsado} />
          </div>

          {/* Bloque de usuario abajo */}
          <div className={cn('border-t p-2', colapsado && 'flex justify-center')}>
            {colapsado ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Avatar nombre={sesion.nombre} tono="pt" tamano="sm" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right">{sesion.nombre}</TooltipContent>
              </Tooltip>
            ) : (
              <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                <Avatar nombre={sesion.nombre} tono="pt" tamano="sm" />
                <div className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-sm font-medium">{sesion.nombre}</span>
                  <span className="truncate text-xs text-muted-foreground">@{sesion.username}</span>
                </div>
              </div>
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4">
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
                    <Marca tamano="md" />
                  </SheetTitle>
                </SheetHeader>
                <div className="overflow-y-auto">
                  <NavegacionModulos
                    modulos={modulos}
                    alNavegar={() => setMenuMovilAbierto(false)}
                  />
                </div>
              </SheetContent>
            </Sheet>

            {/* Marca pequeña en movil (en escritorio ya esta en el sidebar). */}
            <div className="lg:hidden">
              <Marca tamano="sm" conSubtitulo={false} />
            </div>

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
                  <Button
                    variant="ghost"
                    className="gap-2 px-1.5"
                    data-testid="menu-usuario"
                    aria-label="Menú de usuario"
                  >
                    <Avatar nombre={sesion.nombre} tono="pt" tamano="sm" />
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

          {/* El main NO scrollea: cada pantalla maneja su propio scroll. */}
          <main className="min-h-0 flex-1 overflow-hidden">
            <Outlet />
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
