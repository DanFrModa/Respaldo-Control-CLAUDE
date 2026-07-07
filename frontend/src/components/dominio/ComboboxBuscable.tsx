import { Check, ChevronDown, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * COMBOBOX BUSCABLE del rediseño (R2, §4.4.1 — proto `comboHTML`/`wireCombo`): selector con
 * búsqueda por teclado para listas con HOMÓNIMOS (Óscar Jiménez / Óscar Hernández / Óscar López).
 * Escribir "óscar" muestra los tres; "her" deja solo a Hernández. La búsqueda IGNORA acentos y
 * mayúsculas ({@link normalizarTexto}).
 *
 * SOLO se elige de la lista (default del proyecto: NO texto libre — el proveedor nuevo se da de
 * alta en su catálogo; cuando exista un alta rápida se conectará vía `accionCrear`). Si el texto
 * no coincide con la opción elegida al salir, el valor se LIMPIA (no se inventa).
 *
 * Presentación PURA (A1): no conoce proveedores ni ninguna entidad; trabaja con `{ id, nombre }`.
 */

/** Una opción del combobox. */
export interface OpcionCombobox {
  id: number;
  nombre: string;
}

/** Quita acentos/diacríticos y pasa a minúsculas (para comparar "óscar" con "Oscar"). */
export function normalizarTexto(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Filtra opciones por texto normalizado (contiene, sin acentos ni mayúsculas). */
export function filtrarOpciones(
  opciones: readonly OpcionCombobox[],
  texto: string,
): OpcionCombobox[] {
  const consulta = normalizarTexto(texto.trim());
  if (consulta === '') {
    return [...opciones];
  }
  return opciones.filter((opcion) => normalizarTexto(opcion.nombre).includes(consulta));
}

/** Props de {@link ComboboxBuscable}. */
export interface PropsComboboxBuscable {
  /** Opciones disponibles (el padre las trae del API). */
  opciones: readonly OpcionCombobox[];
  /** Id seleccionado, o null si no hay selección. Controlado por el padre. */
  valor: number | null;
  /** Emite el id elegido (o null al limpiar). */
  onChange: (id: number | null) => void;
  /**
   * Emite CADA cambio del texto tecleado (también '' al limpiar/elegir): el padre lo cablea con
   * debounce al parámetro `busqueda` server-side de su API para que el typeahead alcance TODO el
   * catálogo, no solo la página cargada (§4.4.1 — hay >1,700 proveedores en datos reales).
   */
  alCambiarTexto?: (texto: string) => void;
  /** Placeholder del input. */
  placeholder?: string;
  /** Texto cuando el filtro no encuentra nada. */
  textoVacio?: string;
  /**
   * Atajo opcional "crear nuevo" al final de la lista (cuando exista un alta rápida). Si no
   * viene, el combobox es SOLO de lista.
   */
  accionCrear?: { etiqueta: string; onCrear: () => void };
  deshabilitado?: boolean;
  /** Base de los `data-testid` (default "combobox"). */
  testid?: string;
  /** Etiqueta accesible del input. */
  etiqueta?: string;
}

/**
 * Combobox con búsqueda por teclado: abre al enfocar/teclear, filtra sin acentos, navega con
 * ↑/↓/Enter/Esc y solo acepta opciones de la lista. Con selección muestra el nombre y un botón ✕
 * para limpiar.
 */
export function ComboboxBuscable({
  opciones,
  valor,
  onChange,
  alCambiarTexto,
  placeholder = 'Escribe para buscar…',
  textoVacio = 'Sin coincidencias.',
  accionCrear,
  deshabilitado = false,
  testid = 'combobox',
  etiqueta,
}: PropsComboboxBuscable): React.JSX.Element {
  const contenedorRef = useRef<HTMLDivElement>(null);
  const idLista = useId();

  const seleccionada = useMemo(
    () => opciones.find((o) => o.id === valor) ?? null,
    [opciones, valor],
  );

  const [texto, setTexto] = useState(seleccionada?.nombre ?? '');
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);

  // Si el padre cambia la selección (o llegan las opciones), sincroniza el texto visible.
  useEffect(() => {
    setTexto(seleccionada?.nombre ?? '');
  }, [seleccionada]);

  const filtradas = useMemo(() => filtrarOpciones(opciones, texto), [opciones, texto]);
  const activoSeguro = filtradas.length === 0 ? 0 : Math.min(activo, filtradas.length - 1);

  // Cierra al hacer clic fuera; si el texto quedó sin coincidir con la selección, lo repone/limpia.
  useEffect(() => {
    function alClicFuera(evento: MouseEvent): void {
      if (contenedorRef.current && !contenedorRef.current.contains(evento.target as Node)) {
        setAbierto(false);
        setTexto(seleccionada?.nombre ?? '');
      }
    }
    document.addEventListener('mousedown', alClicFuera);
    return () => document.removeEventListener('mousedown', alClicFuera);
  }, [seleccionada]);

  function elegir(opcion: OpcionCombobox): void {
    onChange(opcion.id);
    setTexto(opcion.nombre);
    // El padre busca por el nombre elegido: la opción seleccionada sigue en su lista filtrada.
    alCambiarTexto?.(opcion.nombre);
    setAbierto(false);
  }

  function limpiar(): void {
    onChange(null);
    setTexto('');
    alCambiarTexto?.('');
    setAbierto(false);
  }

  function alTeclado(evento: React.KeyboardEvent<HTMLInputElement>): void {
    if (evento.key === 'Escape') {
      // Con la lista ABIERTA, Esc solo la cierra y NO debe llegar a los listeners de arriba
      // (el panel de Avance cierra con Esc global: sin este stop, cerrar la lista tiraría el
      // panel entero y se perdería la matriz tecleada).
      if (abierto) {
        evento.stopPropagation();
      }
      setAbierto(false);
      setTexto(seleccionada?.nombre ?? '');
      return;
    }
    if (!abierto && (evento.key === 'ArrowDown' || evento.key === 'ArrowUp')) {
      setAbierto(true);
      return;
    }
    if (filtradas.length === 0) {
      return;
    }
    if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      setActivo((i) => (i + 1) % filtradas.length);
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault();
      setActivo((i) => (i - 1 + filtradas.length) % filtradas.length);
    } else if (evento.key === 'Enter') {
      evento.preventDefault();
      const opcion = filtradas[activoSeguro];
      if (opcion !== undefined && abierto) {
        elegir(opcion);
      }
    }
  }

  return (
    <div ref={contenedorRef} className="relative" data-testid={testid}>
      <Input
        type="text"
        role="combobox"
        value={texto}
        disabled={deshabilitado}
        onChange={(e) => {
          setTexto(e.target.value);
          alCambiarTexto?.(e.target.value);
          setAbierto(true);
          setActivo(0);
        }}
        onFocus={() => setAbierto(true)}
        onKeyDown={alTeclado}
        placeholder={placeholder}
        aria-label={etiqueta ?? placeholder}
        aria-expanded={abierto}
        aria-controls={idLista}
        autoComplete="off"
        className={cn('pr-8', seleccionada !== null && 'font-medium')}
        data-testid={`${testid}-input`}
      />
      {seleccionada !== null && !deshabilitado ? (
        <button
          type="button"
          onClick={limpiar}
          aria-label="Limpiar selección"
          data-testid={`${testid}-limpiar`}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : (
        <ChevronDown
          className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
      )}

      {abierto && !deshabilitado ? (
        <div
          id={idLista}
          role="listbox"
          className="absolute top-full left-0 z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border bg-popover p-1 shadow-md"
          data-testid={`${testid}-lista`}
        >
          {filtradas.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">{textoVacio}</p>
          ) : (
            filtradas.map((opcion, indice) => (
              <button
                key={opcion.id}
                type="button"
                role="option"
                aria-selected={opcion.id === valor}
                onMouseEnter={() => setActivo(indice)}
                // mousedown (no click): gana antes del blur del input.
                onMouseDown={(e) => {
                  e.preventDefault();
                  elegir(opcion);
                }}
                data-testid={`${testid}-opcion`}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md px-3 py-1.5 text-left text-sm',
                  indice === activoSeguro
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent/60',
                )}
              >
                <span className="min-w-0 truncate">{opcion.nombre}</span>
                {opcion.id === valor ? (
                  <Check className="size-3.5 shrink-0 text-primary" aria-hidden />
                ) : null}
              </button>
            ))
          )}
          {accionCrear !== undefined ? (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                setAbierto(false);
                accionCrear.onCrear();
              }}
              data-testid={`${testid}-crear`}
              className="mt-1 flex w-full items-center gap-2 rounded-md border-t px-3 py-1.5 pt-2 text-left text-sm text-primary hover:bg-accent/60"
            >
              {accionCrear.etiqueta}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
