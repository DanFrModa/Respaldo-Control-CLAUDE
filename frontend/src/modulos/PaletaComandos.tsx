import { useNavigate } from 'react-router-dom';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { useSesion } from '@/sesion/useSesion';

import { esModuloVisible, filtrarGruposVisibles, ICONOS_MODULO } from './catalogo';

/**
 * PALETA DE COMANDOS global (Ctrl/⌘+K, rediseño R1): encuentra y abre CUALQUIER
 * pantalla del menu — hojas de primer nivel y sub-vistas colgadas de un padre —
 * respetando los permisos de la sesion (A4). En R1 busca modulos/paginas; las
 * ordenes se buscan con el buscador de ordenes del encabezado (F2-E4).
 *
 * Controlada por el cascaron (estado `abierta`); al elegir, navega y cierra.
 */
export function PaletaComandos({
  abierta,
  alCambiarAbierta,
}: {
  abierta: boolean;
  alCambiarAbierta: (abierta: boolean) => void;
}): React.JSX.Element {
  const navigate = useNavigate();
  const { permisos } = useSesion();
  const grupos = filtrarGruposVisibles(permisos);

  function abrir(ruta: string): void {
    alCambiarAbierta(false);
    void navigate(ruta);
  }

  return (
    <CommandDialog
      open={abierta}
      onOpenChange={alCambiarAbierta}
      title="Buscar pantalla"
      description="Escribe el nombre de una pantalla o módulo para abrirla"
    >
      <CommandInput placeholder="Buscar pantalla o módulo…" data-testid="paleta-input" />
      <CommandList data-testid="paleta-resultados">
        <CommandEmpty>Sin coincidencias.</CommandEmpty>
        {grupos.map((grupo) => (
          <CommandGroup key={grupo.clave} heading={grupo.titulo ?? 'General'}>
            {grupo.entradas.flatMap((entrada) => {
              if (entrada.hijos === undefined) {
                const Icono = ICONOS_MODULO[entrada.icono];
                return [
                  <CommandItem
                    key={entrada.clave}
                    // La clave (unica) desambigua; las keywords dan la busqueda.
                    value={entrada.clave}
                    keywords={[entrada.titulo, entrada.descripcion]}
                    onSelect={() => abrir(entrada.ruta)}
                  >
                    <Icono aria-hidden />
                    <span className="truncate">{entrada.titulo}</span>
                    {entrada.proximamente === undefined ? null : (
                      <NotaProxima nota={entrada.proximamente} />
                    )}
                  </CommandItem>,
                ];
              }
              // Sub-vistas: se listan con el contexto de su padre ("Producción · Corte").
              return entrada.hijos
                .filter((hijo) => esModuloVisible(hijo, permisos))
                .map((hijo) => {
                  const Icono = ICONOS_MODULO[hijo.icono];
                  return (
                    <CommandItem
                      key={hijo.clave}
                      value={hijo.clave}
                      keywords={[hijo.titulo, entrada.titulo, hijo.descripcion]}
                      onSelect={() => abrir(hijo.ruta)}
                    >
                      <Icono aria-hidden />
                      <span className="truncate">
                        <span className="text-muted-foreground">{entrada.titulo} · </span>
                        {hijo.titulo}
                      </span>
                      {hijo.proximamente === undefined ? null : (
                        <NotaProxima nota={hijo.proximamente} />
                      )}
                    </CommandItem>
                  );
                });
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

/** Notita "próximamente" a la derecha del renglon de la paleta. */
function NotaProxima({ nota, className }: { nota: string; className?: string }): React.JSX.Element {
  return (
    <span
      className={cn(
        'ml-auto shrink-0 rounded-full bg-muted px-2 py-px text-[10.5px] font-medium text-muted-foreground',
        className,
      )}
    >
      {nota}
    </span>
  );
}
