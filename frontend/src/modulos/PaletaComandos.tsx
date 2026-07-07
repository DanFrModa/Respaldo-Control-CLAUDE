import { Factory } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useBuscarOrdenes } from '@/api/ordenes-consulta';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useDebounce } from '@/lib/useDebounce';
import { cn } from '@/lib/utils';
import { useSesion } from '@/sesion/useSesion';

import { esModuloVisible, filtrarGruposVisibles, ICONOS_MODULO } from './catalogo';

/**
 * PALETA DE COMANDOS global (Ctrl/⌘+K, rediseño R1→R2): encuentra y abre CUALQUIER pantalla del
 * menú (hojas y sub-vistas, respetando permisos A4) y además busca DATOS: las ÓRDENES por folio,
 * modelo, cliente o referencia del cliente (D7) — la paleta ABSORBIÓ el buscador global de la
 * topbar (F2-E4): un solo lugar para "ir a" (desviación (e) de R1, resuelta en R2). Solo quien
 * tiene `ordenes.ver` ve el grupo de órdenes; el backend re-decide (A1).
 *
 * Controlada por el cascarón (estado `abierta`); al elegir, navega y cierra.
 */
export function PaletaComandos({
  abierta,
  alCambiarAbierta,
}: {
  abierta: boolean;
  alCambiarAbierta: (abierta: boolean) => void;
}): React.JSX.Element {
  const navigate = useNavigate();
  const { permisos, tienePermiso } = useSesion();
  const grupos = filtrarGruposVisibles(permisos);

  // Búsqueda de DATOS (órdenes): mismo backend del viejo buscador global (tope 20 hits).
  const [texto, setTexto] = useState('');
  const consultaTexto = useDebounce(texto.trim(), 250);
  const puedeVerOrdenes = tienePermiso('ordenes.ver');
  const ordenes = useBuscarOrdenes(puedeVerOrdenes && abierta ? consultaTexto : '');
  const hits = ordenes.data?.datos ?? [];

  function abrir(ruta: string): void {
    alCambiarAbierta(false);
    setTexto('');
    void navigate(ruta);
  }

  function abrirOrden(id: number): void {
    alCambiarAbierta(false);
    setTexto('');
    void navigate('/produccion/ordenes', { state: { idOrden: id } });
  }

  return (
    <CommandDialog
      open={abierta}
      onOpenChange={(abiertaNueva) => {
        alCambiarAbierta(abiertaNueva);
        if (!abiertaNueva) {
          setTexto('');
        }
      }}
      title="Buscar"
      description="Escribe una pantalla, un módulo o una orden (folio, modelo, cliente o referencia)"
    >
      <CommandInput
        placeholder="Buscar pantalla, módulo u orden…"
        value={texto}
        onValueChange={setTexto}
        data-testid="paleta-input"
      />
      <CommandList data-testid="paleta-resultados">
        <CommandEmpty>Sin coincidencias.</CommandEmpty>

        {/* ── Órdenes (datos, D7): la paleta absorbió el buscador global ── */}
        {puedeVerOrdenes && hits.length > 0 ? (
          <CommandGroup heading="Órdenes">
            {hits.map((hit) => (
              <CommandItem
                key={`orden-${hit.id}`}
                value={`orden-${hit.id}`}
                // El texto actual va en las keywords: el hit YA pasó el filtro del servidor y
                // cmdk no debe descartarlo por no parecerse al valor.
                keywords={[consultaTexto, String(hit.folio), hit.codigoModelo, hit.cliente]}
                onSelect={() => abrirOrden(hit.id)}
                data-testid="paleta-orden"
              >
                <Factory aria-hidden />
                <span className="truncate">
                  <span className="font-medium">Orden {hit.folio}</span>
                  <span className="text-muted-foreground"> · {hit.codigoModelo}</span>
                </span>
                <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">
                  {hit.cliente}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

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
