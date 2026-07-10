import { Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * COMBOBOX DE ENTIDAD con búsqueda server-side (pulido R9 del grupo Inventarios). Base de los
 * selectores de modelo/tela/avío: un input con lupa cuya lista de opciones vive en un POPOVER
 * (absoluto, z-50) que abre al enfocar/teclear y cierra al elegir/clic fuera/Esc — antes la lista
 * se pintaba SIEMPRE inline y reventaba el layout de los toolbars (feedback de Gabriel).
 *
 * Presentación pura (A1): no consulta nada; el selector padre trae las opciones del API (con su
 * debounce) y este componente solo maneja abrir/cerrar, teclado y el texto visible. Conserva los
 * testids históricos de los selectores (`${testid}-busqueda` en el input, `${testid}-opcion` en
 * cada opción) para no romper los e2e que teclean y eligen.
 */
export function ComboboxEntidad<T>({
  opciones,
  obtenerId,
  principal,
  secundario,
  extraOpcion,
  idSeleccionado,
  etiquetaSeleccion,
  alSeleccionar,
  alLimpiar,
  alCambiarTexto,
  cargando = false,
  mensajeError,
  placeholder,
  etiqueta,
  textoVacio = 'Sin coincidencias.',
  testid,
}: {
  /** Opciones vigentes (el selector padre las trae del API, ya filtradas server-side). */
  opciones: readonly T[];
  obtenerId: (entidad: T) => number;
  /** Texto principal de la opción (y el que queda en el input al elegir: código/clave/nombre). */
  principal: (entidad: T) => string;
  /** Texto secundario atenuado de la opción (descripción), si lo hay. */
  secundario?: ((entidad: T) => string | null) | undefined;
  /** Adorno opcional a la derecha de la opción (p. ej. badge "Genérico"). */
  extraOpcion?: ((entidad: T) => React.ReactNode) | undefined;
  idSeleccionado: number | undefined;
  /** Texto visible en el input cuando hay selección (el padre conoce la entidad completa). */
  etiquetaSeleccion: string | undefined;
  alSeleccionar: (entidad: T) => void;
  /** Si viene, se muestra el botón ✕ para limpiar la selección (uso como FILTRO). */
  alLimpiar?: (() => void) | undefined;
  /** Cada cambio del texto tecleado (el padre lo cablea con debounce a su `busqueda`). */
  alCambiarTexto: (texto: string) => void;
  /**
   * Los resultados aún NO corresponden a lo tecleado (debounce en vuelo o consulta cargando):
   * el popover muestra "Buscando…" y NO ofrece opciones — ni por clic ni por teclado. Sin esto
   * había una CARRERA real (mismo patrón que el `cargando` de `ComboboxBuscable` del kit): al
   * teclear y elegir rápido, la lista vieja del catálogo GENERAL seguía clickeable y se
   * seleccionaba la entidad equivocada (lo cazó el e2e de inventario PT en CI).
   */
  cargando?: boolean | undefined;
  /** Error de la consulta del padre (se pinta dentro del popover). */
  mensajeError?: string | undefined;
  placeholder: string;
  /** Etiqueta accesible del input. */
  etiqueta: string;
  textoVacio?: string | undefined;
  testid: string;
}): React.JSX.Element {
  const contenedorRef = useRef<HTMLDivElement>(null);
  const idLista = useId();

  const [texto, setTexto] = useState(etiquetaSeleccion ?? '');
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);

  // Si el padre cambia la selección, el input muestra su etiqueta (o queda vacío al limpiar).
  useEffect(() => {
    setTexto(etiquetaSeleccion ?? '');
  }, [etiquetaSeleccion]);

  // Con la búsqueda sin resolver (`cargando`), las opciones viejas NO son elegibles: la lista
  // efectiva queda vacía y el popover pinta "Buscando…" hasta que lleguen las filtradas reales.
  const opcionesVisibles = cargando ? [] : opciones;
  const activoSeguro =
    opcionesVisibles.length === 0 ? 0 : Math.min(activo, opcionesVisibles.length - 1);

  // Cierra al hacer clic fuera; el texto se repone a la selección vigente (no se inventa).
  useEffect(() => {
    function alClicFuera(evento: MouseEvent): void {
      if (contenedorRef.current && !contenedorRef.current.contains(evento.target as Node)) {
        setAbierto(false);
        setTexto(etiquetaSeleccion ?? '');
      }
    }
    document.addEventListener('mousedown', alClicFuera);
    return () => document.removeEventListener('mousedown', alClicFuera);
  }, [etiquetaSeleccion]);

  function elegir(entidad: T): void {
    alSeleccionar(entidad);
    const nombre = principal(entidad);
    setTexto(nombre);
    // El padre re-busca por el texto elegido: al reabrir, la selección sigue en la lista.
    alCambiarTexto(nombre);
    setAbierto(false);
  }

  function limpiar(): void {
    alLimpiar?.();
    setTexto('');
    alCambiarTexto('');
    setAbierto(false);
  }

  function alTeclado(evento: React.KeyboardEvent<HTMLInputElement>): void {
    if (evento.key === 'Escape') {
      // Con la lista ABIERTA, Esc solo la cierra: no debe llegar a listeners globales de arriba.
      if (abierto) {
        evento.stopPropagation();
      }
      setAbierto(false);
      setTexto(etiquetaSeleccion ?? '');
      return;
    }
    if (!abierto && (evento.key === 'ArrowDown' || evento.key === 'ArrowUp')) {
      setAbierto(true);
      return;
    }
    if (opcionesVisibles.length === 0) {
      return;
    }
    if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      setActivo((i) => (i + 1) % opcionesVisibles.length);
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault();
      setActivo((i) => (i - 1 + opcionesVisibles.length) % opcionesVisibles.length);
    } else if (evento.key === 'Enter') {
      evento.preventDefault();
      const opcion = opcionesVisibles[activoSeguro];
      if (opcion !== undefined && abierto) {
        elegir(opcion);
      }
    }
  }

  return (
    <div ref={contenedorRef} className="relative" data-testid={testid}>
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="text"
        role="combobox"
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          alCambiarTexto(e.target.value);
          setAbierto(true);
          setActivo(0);
        }}
        onFocus={() => setAbierto(true)}
        onKeyDown={alTeclado}
        placeholder={placeholder}
        aria-label={etiqueta}
        aria-expanded={abierto}
        aria-controls={idLista}
        autoComplete="off"
        className={cn(
          'pl-8',
          alLimpiar !== undefined && 'pr-8',
          idSeleccionado !== undefined && 'font-medium',
        )}
        data-testid={`${testid}-busqueda`}
      />
      {alLimpiar !== undefined && idSeleccionado !== undefined ? (
        <button
          type="button"
          onClick={limpiar}
          aria-label="Limpiar selección"
          data-testid={`${testid}-limpiar`}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}

      {abierto ? (
        <div
          id={idLista}
          role="listbox"
          className="absolute top-full left-0 z-50 mt-1 max-h-64 w-full min-w-56 overflow-y-auto rounded-lg border bg-popover p-1 shadow-md"
          data-testid={`${testid}-lista`}
        >
          {mensajeError !== undefined ? (
            <p className="px-3 py-2 text-sm text-destructive" role="alert">
              {mensajeError}
            </p>
          ) : opcionesVisibles.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {cargando ? 'Buscando…' : textoVacio}
            </p>
          ) : (
            opcionesVisibles.map((entidad, indice) => {
              const id = obtenerId(entidad);
              const sec = secundario?.(entidad) ?? null;
              return (
                <button
                  key={id}
                  type="button"
                  role="option"
                  aria-selected={id === idSeleccionado}
                  onMouseEnter={() => setActivo(indice)}
                  // mousedown (no click): gana antes del blur del input.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    elegir(entidad);
                  }}
                  data-testid={`${testid}-opcion`}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-md px-3 py-1.5 text-left text-sm',
                    indice === activoSeguro
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/60',
                    id === idSeleccionado && 'font-medium',
                  )}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{principal(entidad)}</span>
                    {sec !== null ? (
                      <span className="truncate text-xs text-muted-foreground">{sec}</span>
                    ) : null}
                  </span>
                  {extraOpcion?.(entidad) ?? null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
