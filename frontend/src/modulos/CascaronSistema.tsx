import { ChevronRight, LogOut, Menu, PanelLeft, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { AlternadorTema } from '@/AlternadorTema';
import { Marca } from '@/components/Marca';
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
import type { Sesion } from '@/api/tipos';
import { authClient } from '@/lib/auth-client';
import { iniciales } from '@/lib/tono';
import { useColapsoSidebar } from '@/lib/useColapsoSidebar';
import { claseBotonIcono, cn } from '@/lib/utils';
import { filtrarGruposVisibles, tituloPorRuta } from '@/modulos/catalogo';
import { NavegacionModulos } from '@/modulos/NavegacionModulos';
import { PaletaComandos } from '@/modulos/PaletaComandos';
import { BadgeAlertasRc } from '@/modulos/ruta-critica/BadgeAlertasRc';
import { useSesion } from '@/sesion/useSesion';

/**
 * CASCARON del sistema (rediseño R1 → fidelidad pixel-perfect R9, fiel al
 * prototipo aprobado): RIEL OSCURO a la izquierda (216px, colapsable a 62px con
 * Ctrl/⌘+B, persistido) con la marca arriba y la TARJETA DE USUARIO abajo (ahí
 * vive el menú de usuario/cerrar sesión, como el proto — el topbar NO lleva
 * avatar). Barra superior del proto: [colapsar riel] + breadcrumb
 * «Control v2 › vista», buscador ⌘K empujado a la derecha, chip de empresa con
 * puntito de marca, campana de alertas RC y alternador de tema.
 *
 * La raiz ocupa el alto de la ventana y NO scrollea (`h-svh overflow-hidden`):
 * el `<main>` llena el resto y es `overflow-hidden` a proposito, asi que CADA
 * pantalla es duena de su propio scroll. Toda pagina nueva DEBE envolver su
 * contenido en el wrapper estandar `<div className="h-full overflow-y-auto">`
 * (o construirse sobre un motor que ya lo hace por dentro: `ListaDetalle`,
 * `TablaCatalogo`). Sin eso, el contenido bajo el pliegue queda inalcanzable.
 *
 * El menu lista SOLO lo que los permisos del usuario hacen visible (A4); la
 * sesion la provee `ProveedorSesion` (`GET /api/sesion`). El guard
 * `RutaProtegida` garantiza que aqui ya hay sesion.
 */
export function CascaronSistema(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
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
  const tituloVista = tituloPorRuta(location.pathname);

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
          {/* Cabecera de marca (proto `.rail-head`): SOLO el logo + wordmark — el
              botón de colapso vive en la topbar, como el prototipo. */}
          <div
            className={cn(
              'flex h-13 shrink-0 items-center border-b border-rail-border',
              colapsado ? 'justify-center px-0' : 'pr-3 pl-3.5',
            )}
          >
            <Marca tamano="md" colapsado={colapsado} enRiel />
          </div>

          {/* Navegacion agrupada (desplegables de 2 niveles). */}
          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
            <NavegacionModulos
              grupos={grupos}
              colapsado={colapsado}
              alExpandirColapsado={expandir}
            />
          </div>

          {/* Tarjeta de usuario abajo (proto `.rail-foot`/`.rail-user`): aquí vive
              el menú de usuario (cerrar sesión). */}
          <UsuarioRiel
            sesion={sesion}
            colapsado={colapsado}
            alCerrarSesion={() => void cerrarSesion()}
          />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* ── Barra superior (52px, proto `.topbar`) ─────────────────────── */}
          <header className="flex h-13 shrink-0 items-center gap-2 border-b bg-card px-3 lg:gap-3 lg:px-4">
            {/* Menu movil (el riel oscuro dentro de un Sheet). */}
            <Sheet open={menuMovilAbierto} onOpenChange={setMenuMovilAbierto}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className={cn(claseBotonIcono, 'lg:hidden')}
                  aria-label="Abrir menú"
                >
                  <Menu className="size-[17px]" aria-hidden />
                </button>
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
                {/* En movil el menú de usuario también vive al pie del riel. */}
                <UsuarioRiel sesion={sesion} alCerrarSesion={() => void cerrarSesion()} />
              </SheetContent>
            </Sheet>

            {/* Marca pequeña en movil (en escritorio ya esta en el riel). */}
            <div className="lg:hidden">
              <Marca tamano="sm" conSubtitulo={false} />
            </div>

            {/* Colapsar/expandir el riel (proto `#railToggle`, primer elemento). */}
            <button
              type="button"
              className={cn(claseBotonIcono, 'hidden lg:grid')}
              onClick={alternarColapso}
              aria-label={etiquetaColapso}
              title={etiquetaColapso}
              data-testid="contraer-menu"
            >
              <PanelLeft className="size-[17px]" aria-hidden />
            </button>

            {/* Breadcrumb del proto (`.crumbs`): «Control v2 › vista actual». */}
            <div className="hidden min-w-0 items-center gap-[7px] text-sm text-muted-foreground lg:flex">
              <span className="font-semibold text-foreground">Control v2</span>
              {tituloVista !== undefined ? (
                <>
                  <ChevronRight className="size-3.5 shrink-0 opacity-40" aria-hidden />
                  <span className="truncate">{tituloVista}</span>
                </>
              ) : null}
            </div>

            {/* Disparador de la paleta ⌘K (proto `.searchbox`: empujado a la
                derecha con ml-auto, 34px de alto, chip de atajo adentro). */}
            <button
              type="button"
              onClick={() => setPaletaAbierta(true)}
              data-testid="abrir-paleta"
              aria-label="Buscar pantalla, módulo u orden (Ctrl+K)"
              className="ml-auto hidden h-[34px] w-[min(340px,34vw)] cursor-text items-center gap-2 rounded-lg border bg-panel-2 px-2.5 text-faint transition-colors hover:border-border-strong md:flex"
            >
              <Search className="size-[15px] shrink-0" aria-hidden />
              <span className="flex-1 truncate text-left text-[12.5px]">
                Buscar orden, modelo, cliente…
              </span>
              <kbd className="mono rounded-[5px] border bg-card px-1.5 py-px text-[11px] text-muted-foreground">
                Ctrl K
              </kbd>
            </button>

            <div className="ml-auto flex items-center gap-2 md:ml-0 lg:gap-3">
              {/* Empresa activa (proto `.company`: chip suave con puntito de marca). */}
              <span
                className="hidden h-[34px] items-center gap-[7px] rounded-lg bg-primary-soft px-2.5 text-[12.5px] font-semibold text-primary-soft-foreground sm:flex"
                data-testid="empresa-activa"
              >
                <span aria-hidden className="size-[7px] shrink-0 rounded-full bg-primary" />
                {sesion.empresaActiva.nombre}
              </span>
              <BadgeAlertasRc />
              <AlternadorTema />
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

/**
 * Tarjeta de usuario al pie del riel (proto `.rail-user`): avatar de 30px con
 * el degradado EXACTO del proto + nombre y @usuario. Es el disparador del menú
 * de usuario (cerrar sesión) — el topbar ya no lleva avatar, como el prototipo.
 * Al colapsar el riel, el texto se desvanece y queda solo el avatar (tooltip).
 */
function UsuarioRiel({
  sesion,
  colapsado = false,
  alCerrarSesion,
}: {
  sesion: Sesion;
  colapsado?: boolean;
  alCerrarSesion: () => void;
}): React.JSX.Element {
  return (
    <div className="border-t border-rail-border p-2">
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="menu-usuario"
                aria-label="Menú de usuario"
                className={cn(
                  'flex w-full cursor-pointer items-center rounded-[8px] py-1.5 transition-colors hover:bg-white/5',
                  colapsado ? 'justify-center px-0' : 'px-2',
                )}
              >
                {/* Avatar del proto (`.avatar`): 30px, radio 8px, degradado
                    150deg #7bd6a6 → #2f9c66, iniciales oscuras. */}
                <span
                  aria-hidden
                  className="grid size-7.5 shrink-0 place-items-center rounded-[8px] bg-linear-150 from-[#7bd6a6] to-[#2f9c66] text-[12px] font-bold text-[#04140c]"
                >
                  {iniciales(sesion.nombre)}
                </span>
                <span
                  className={cn(
                    'flex min-w-0 flex-col overflow-hidden text-left leading-tight whitespace-nowrap transition-[max-width,opacity,margin] duration-200 ease-in-out',
                    colapsado ? 'ml-0 max-w-0 opacity-0' : 'ml-2.5 max-w-[12rem] opacity-100',
                  )}
                >
                  <span className="truncate text-[12.5px] font-semibold text-rail-fg-strong">
                    {sesion.nombre}
                  </span>
                  <span className="truncate text-[11px] text-rail-fg/70">@{sesion.username}</span>
                </span>
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          {colapsado ? <TooltipContent side="right">{sesion.nombre}</TooltipContent> : null}
        </Tooltip>
        <DropdownMenuContent side="top" align="start" className="w-56">
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
            onSelect={alCerrarSesion}
          >
            <LogOut className="size-4" aria-hidden />
            Cerrar sesión
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
