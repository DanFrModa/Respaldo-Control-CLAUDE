import { Building2, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';

import { AlternadorTema } from '@/AlternadorTema';
import { Marca } from '@/components/Marca';
import { Avatar } from '@/components/dominio/visuales';
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
import { filtrarGruposVisibles } from '@/modulos/catalogo';
import { NavegacionModulos } from '@/modulos/NavegacionModulos';
import { PaletaComandos } from '@/modulos/PaletaComandos';
import { BuscadorGlobal } from '@/modulos/ordenes-consulta/BuscadorGlobal';
import { BadgeAlertasRc } from '@/modulos/ruta-critica/BadgeAlertasRc';
import { useSesion } from '@/sesion/useSesion';

/**
 * CASCARON del sistema (rediseño R1, fiel al prototipo aprobado): RIEL OSCURO a
 * la izquierda (216px, colapsable a 62px con Ctrl/⌘+B, persistido) + barra
 * superior con paleta de comandos Ctrl/⌘+K, buscador de ordenes, empresa
 * activa, alertas RC, tema y usuario. El riel queda verde-oscuro en AMBOS temas
 * (ancla de marca); en movil vive dentro de un Sheet.
 *
 * La raiz ocupa el alto de la ventana y NO scrollea (`h-svh overflow-hidden`):
 * el `<main>` llena el resto y cada pantalla maneja su propio scroll.
 *
 * El menu lista SOLO lo que los permisos del usuario hacen visible (A4); la
 * sesion la provee `ProveedorSesion` (`GET /api/sesion`). El guard
 * `RutaProtegida` garantiza que aqui ya hay sesion.
 */
export function CascaronSistema(): React.JSX.Element {
  const navigate = useNavigate();
  const { sesion, permisos, refrescar } = useSesion();
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);
  const [paletaAbierta, setPaletaAbierta] = useState(false);
  const { colapsado, alternar: alternarColapso, expandir } = useColapsoSidebar();

  // Atajos globales del cascaron: Ctrl/⌘+K abre la paleta, Ctrl/⌘+B alterna el
  // riel (igual que el prototipo). Se registran una vez; alternar/expandir son
  // callbacks estables del hook.
  useEffect(() => {
    function alTeclear(evento: KeyboardEvent): void {
      if (!(evento.ctrlKey || evento.metaKey)) {
        return;
      }
      const tecla = evento.key.toLowerCase();
      if (tecla === 'k') {
        evento.preventDefault();
        setPaletaAbierta((abierta) => !abierta);
      } else if (tecla === 'b') {
        evento.preventDefault();
        alternarColapso();
      }
    }
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [alternarColapso]);

  // RutaProtegida ya garantizo sesion; este guard defensivo satisface el tipo.
  if (sesion === null) {
    return <Outlet />;
  }

  const grupos = filtrarGruposVisibles(permisos);
  const etiquetaColapso = colapsado ? 'Expandir menú (Ctrl+B)' : 'Contraer menú (Ctrl+B)';

  async function cerrarSesion(): Promise<void> {
    await authClient.signOut();
    await refrescar();
    // navigate() es asincrono en React Router 7; no necesitamos esperarlo.
    void navigate('/login', { replace: true });
  }

  return (
    <TooltipProvider>
      <div className="flex h-svh w-full overflow-hidden">
        {/* ── RIEL de escritorio (oscuro en ambos temas, colapsable) ────────── */}
        <aside
          className={cn(
            'hidden shrink-0 flex-col border-r border-rail-border bg-rail text-rail-fg transition-[width] duration-200 ease-in-out lg:flex',
            colapsado ? 'w-[62px]' : 'w-[216px]',
          )}
        >
          {/* Marca + boton contraer SIEMPRE en el header (la flecha nunca baja a
              otra fila): al colapsar, el wordmark se desvanece y queda [logo]
              [flecha] en el riel. */}
          <div
            className={cn(
              'flex h-13 shrink-0 items-center justify-between border-b border-rail-border',
              colapsado ? 'px-2' : 'px-3',
            )}
          >
            <Marca tamano="md" colapsado={colapsado} enRiel />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg text-rail-fg transition-colors hover:bg-white/5 hover:text-rail-fg-strong"
                  onClick={alternarColapso}
                  aria-label={etiquetaColapso}
                  title={etiquetaColapso}
                  data-testid="contraer-menu"
                >
                  {colapsado ? (
                    <PanelLeftOpen className="size-4" aria-hidden />
                  ) : (
                    <PanelLeftClose className="size-4" aria-hidden />
                  )}
                </button>
              </TooltipTrigger>
              {colapsado ? <TooltipContent side="right">{etiquetaColapso}</TooltipContent> : null}
            </Tooltip>
          </div>

          {/* Navegacion agrupada (desplegables de 2 niveles). */}
          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
            <NavegacionModulos
              grupos={grupos}
              colapsado={colapsado}
              alExpandirColapsado={expandir}
            />
          </div>

          {/* Bloque de usuario abajo (colores del riel). El Avatar va SIEMPRE
              dentro del mismo Tooltip/Trigger (no se remonta); el nombre se
              anima a ancho 0 al colapsar. */}
          <div className="border-t border-rail-border p-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    'flex items-center rounded-lg py-1.5 transition-[padding] duration-200',
                    colapsado ? 'justify-center px-0' : 'px-2',
                  )}
                >
                  <Avatar nombre={sesion.nombre} tono="pt" tamano="sm" />
                  <div
                    className={cn(
                      'flex min-w-0 flex-col overflow-hidden leading-tight whitespace-nowrap transition-[max-width,opacity,margin] duration-200 ease-in-out',
                      colapsado ? 'ml-0 max-w-0 opacity-0' : 'ml-2.5 max-w-[12rem] opacity-100',
                    )}
                  >
                    <span className="truncate text-sm font-medium text-rail-fg-strong">
                      {sesion.nombre}
                    </span>
                    <span className="truncate text-xs text-rail-fg/70">@{sesion.username}</span>
                  </div>
                </div>
              </TooltipTrigger>
              {colapsado ? <TooltipContent side="right">{sesion.nombre}</TooltipContent> : null}
            </Tooltip>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* ── Barra superior (52px, proto `.topbar`) ─────────────────────── */}
          <header className="flex h-13 shrink-0 items-center gap-2 border-b bg-card px-3 sm:gap-3 sm:px-4">
            {/* Menu movil (el riel oscuro dentro de un Sheet). */}
            <Sheet open={menuMovilAbierto} onOpenChange={setMenuMovilAbierto}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abrir menú">
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-72 border-rail-border bg-rail p-0 text-rail-fg [&>button]:text-rail-fg"
              >
                <SheetHeader className="border-b border-rail-border px-4 py-3">
                  <SheetTitle className="text-left">
                    <Marca tamano="md" enRiel />
                  </SheetTitle>
                </SheetHeader>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <NavegacionModulos grupos={grupos} alNavegar={() => setMenuMovilAbierto(false)} />
                </div>
              </SheetContent>
            </Sheet>

            {/* Marca pequeña en movil (en escritorio ya esta en el riel). */}
            <div className="lg:hidden">
              <Marca tamano="sm" conSubtitulo={false} />
            </div>

            {/* Buscador global de ordenes (F2-E4): solo visible con `ordenes.ver`. */}
            <BuscadorGlobal />

            {/* Disparador de la paleta ⌘K (busca pantallas/modulos). */}
            <button
              type="button"
              onClick={() => setPaletaAbierta(true)}
              data-testid="abrir-paleta"
              aria-label="Buscar pantalla o módulo (Ctrl+K)"
              className="hidden h-8 cursor-text items-center gap-2 rounded-lg border bg-panel-2 px-2.5 text-faint transition-colors hover:border-border-strong md:flex md:w-56"
            >
              <Search className="size-3.5 shrink-0" aria-hidden />
              <span className="flex-1 truncate text-left text-xs">Ir a pantalla…</span>
              <kbd className="mono rounded-sm border bg-card px-1.5 py-px text-[11px] text-muted-foreground">
                Ctrl K
              </kbd>
            </button>

            <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
              {/* Empresa activa (chip suave de marca, proto `.company`). */}
              <span
                className="hidden h-8 items-center gap-2 rounded-lg bg-primary-soft px-2.5 text-xs font-semibold text-primary-soft-foreground sm:flex"
                data-testid="empresa-activa"
              >
                <Building2 className="size-3.5" aria-hidden />
                {sesion.empresaActiva.nombre}
              </span>
              <BadgeAlertasRc />
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

      {/* Paleta de comandos global (Ctrl/⌘+K). */}
      <PaletaComandos abierta={paletaAbierta} alCambiarAbierta={setPaletaAbierta} />
    </TooltipProvider>
  );
}
