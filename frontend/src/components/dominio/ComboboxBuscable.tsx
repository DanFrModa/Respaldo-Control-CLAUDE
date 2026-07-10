import { Check, ChevronDown, Loader2Icon, Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * COMBOBOX BUSCABLE del rediseño (R2, §4.4.1 — proto `comboHTML`/`wireCombo`): selector con
 * búsqueda por teclado para listas con HOMÓNIMOS (Óscar Jiménez / Óscar Hernández / Óscar López).
 * Escribir "óscar" muestra los tres; "her" deja solo a Hernández. La búsqueda IGNORA acentos y
 * mayúsculas ({@link normalizarTexto}).
 *
 * Es el ÚNICO typeahead del kit (R9 absorbió al `ComboboxEntidad` de inventarios): además del
 * modo clásico con filtro local admite el modo {@link PropsComboboxBuscable.busquedaServidor}
 * de los selectores de entidad (modelo/tela/avío/orden), con opción rica ({@link OpcionRica}),
 * error de consulta en el popover y anti-carrera estricta mientras la búsqueda no resuelve.
 *
 * SOLO se elige de la lista (default del proyecto: NO texto libre — el proveedor nuevo se da de
 * alta en su catálogo; cuando exista un alta rápida se conectará vía `accionCrear`).
 *
 * El CICLO de edición (escribir → elegir → cambiar de opinión) es coherente:
 * - Enfocar con selección SELECCIONA todo el texto (se teclea encima sin borrar letra por letra)
 *   y muestra el catálogo completo, no solo la opción elegida.
 * - Borrar TODO el texto borra también la selección (el filtro vuelve a "Todos").
 * - Salir (blur/Escape) con texto que no coincide RESTAURA la etiqueta de la selección vigente
 *   (o deja vacío si no había) y resetea la búsqueda server-side: nunca queda texto fantasma.
 * - La etiqueta de la selección se persiste APARTE de `opciones`: con typeahead server-side la
 *   página filtrada puede dejar fuera a la opción elegida sin que el input se rompa.
 *
 * Presentación PURA (A1): no conoce proveedores ni ninguna entidad; trabaja con `{ id, nombre }`
 * (los selectores de entidad extienden la opción con sus campos y la pintan vía `renderOpcion`).
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
export function filtrarOpciones<O extends OpcionCombobox>(
  opciones: readonly O[],
  texto: string,
): O[] {
  const consulta = normalizarTexto(texto.trim());
  if (consulta === '') {
    return [...opciones];
  }
  return opciones.filter((opcion) => normalizarTexto(opcion.nombre).includes(consulta));
}

/**
 * Contenido RICO de una opción (línea principal + secundaria atenuada + adorno a la derecha):
 * el markup que usaban las opciones del `ComboboxEntidad` (código/clave arriba, descripción
 * abajo, badge "Genérico"…). Se pasa desde `renderOpcion` de los selectores de entidad.
 */
export function OpcionRica({
  principal,
  secundario,
  extra,
}: {
  principal: string;
  /** Texto secundario atenuado (descripción), si lo hay. */
  secundario?: string | null | undefined;
  /** Adorno opcional a la derecha (p. ej. badge "Genérico"). */
  extra?: React.ReactNode;
}): React.JSX.Element {
  return (
    <>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{principal}</span>
        {secundario != null ? (
          <span className="truncate text-xs text-muted-foreground">{secundario}</span>
        ) : null}
      </span>
      {extra ?? null}
    </>
  );
}

/** Props de {@link ComboboxBuscable}. */
export interface PropsComboboxBuscable<O extends OpcionCombobox = OpcionCombobox> {
  /** Opciones disponibles (el padre las trae del API). */
  opciones: readonly O[];
  /** Id seleccionado, o null si no hay selección. Controlado por el padre. */
  valor: number | null;
  /** Emite el id elegido (o null al limpiar). */
  onChange: (id: number | null) => void;
  /**
   * Emite CADA cambio del texto tecleado (también '' al limpiar/elegir/restaurar): el padre lo
   * cablea con debounce al parámetro `busqueda` server-side de su API para que el typeahead
   * alcance TODO el catálogo, no solo la página cargada (§4.4.1 — hay >1,700 proveedores reales).
   */
  alCambiarTexto?: (texto: string) => void;
  /**
   * MODO SERVIDOR (selectores de entidad, ex-`ComboboxEntidad`): las opciones ya vienen filtradas
   * por el API del padre (que busca en campos que la opción ni muestra, p. ej. la descripción) →
   * NO se re-filtran en cliente, y mientras `cargando` NO se ofrece NINGUNA — ni por clic ni por
   * teclado. Sin esto hay una CARRERA real: al teclear y elegir rápido, la lista vieja del
   * catálogo general seguía clickeable y se seleccionaba la entidad equivocada (lo cazó el e2e
   * de inventario PT en CI). Default false = filtro local del kit (ahí las opciones viejas
   * siguen siendo válidas porque el filtro local las acota a lo tecleado).
   */
  busquedaServidor?: boolean;
  /**
   * Render RICO del contenido de la opción ({@link OpcionRica}); el default pinta `nombre`
   * truncado. La palomita de la opción seleccionada la pone el combobox en ambos casos.
   */
  renderOpcion?: ((opcion: O) => React.ReactNode) | undefined;
  /** Error de la consulta del padre: se pinta dentro del popover (role="alert"). */
  mensajeError?: string | undefined;
  /** Lupa a la izquierda del input (el look de los selectores de entidad). */
  conLupa?: boolean;
  /**
   * false = campo REQUERIDO: sin botón ✕ y borrar el texto NO limpia la selección (el blur la
   * restaura) — el uso del selector de orden de producción. Default true (ciclo del kit).
   */
  permitirLimpiar?: boolean;
  /** Placeholder del input. */
  placeholder?: string;
  /** Texto cuando el filtro no encuentra nada. */
  textoVacio?: string;
  /**
   * Señal de carga del catálogo (típicamente `isFetching` del query del padre): pinta un spinner
   * discreto y evita el "Sin coincidencias" en falso mientras la respuesta viene en camino. En
   * modo `busquedaServidor` además OCULTA las opciones viejas (anti-carrera, ver arriba).
   */
  cargando?: boolean;
  /**
   * Atajo opcional "crear nuevo" al final de la lista (cuando exista un alta rápida). Si no
   * viene, el combobox es SOLO de lista.
   */
  accionCrear?: { etiqueta: string; onCrear: () => void };
  deshabilitado?: boolean;
  /** Base de los `data-testid` (default "combobox"). */
  testid?: string;
  /**
   * data-testid del INPUT (default `${testid}-input`). Los selectores de entidad históricos
   * exponen `${testid}-busqueda` — los e2e de inventarios/producción lo usan tal cual.
   */
  testidInput?: string;
  /** Etiqueta accesible del input. */
  etiqueta?: string;
}

/**
 * Combobox con búsqueda por teclado: abre al enfocar/teclear, filtra sin acentos, navega con
 * ↑/↓/Enter/Esc y solo acepta opciones de la lista. Con selección muestra el nombre y un botón ✕
 * para limpiar; borrar el texto a vacío también limpia (salvo `permitirLimpiar: false`).
 */
export function ComboboxBuscable<O extends OpcionCombobox = OpcionCombobox>({
  opciones,
  valor,
  onChange,
  alCambiarTexto,
  busquedaServidor = false,
  renderOpcion,
  mensajeError,
  conLupa = false,
  permitirLimpiar = true,
  placeholder = 'Escribe para buscar…',
  textoVacio = 'Sin coincidencias.',
  cargando = false,
  accionCrear,
  deshabilitado = false,
  testid = 'combobox',
  testidInput,
  etiqueta,
}: PropsComboboxBuscable<O>): React.JSX.Element {
  const contenedorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const idLista = useId();

  // La opción del `valor` en la página ACTUAL (con typeahead server-side puede no venir en ella).
  const opcionDeValor = useMemo(
    () => (valor === null ? null : (opciones.find((o) => o.id === valor) ?? null)),
    [opciones, valor],
  );

  // Etiqueta de la selección, PERSISTIDA aparte de `opciones`: si la búsqueda server-side deja a
  // la opción elegida fuera de la página, la última etiqueta conocida sobrevive.
  const [etiquetaValor, setEtiquetaValor] = useState(opcionDeValor?.nombre ?? '');
  const [texto, setTexto] = useState(opcionDeValor?.nombre ?? '');
  const [abierto, setAbierto] = useState(false);
  const [enfocado, setEnfocado] = useState(false);
  const [activo, setActivo] = useState(0);
  // Tras enfocar con selección se selecciona todo el texto; el mouseup del mismo clic NO debe
  // colapsar esa selección (comportamiento default del navegador).
  const conservarSeleccionRef = useRef(false);

  useEffect(() => {
    if (valor === null) {
      setEtiquetaValor('');
    } else if (opcionDeValor !== null) {
      setEtiquetaValor(opcionDeValor.nombre);
    }
  }, [valor, opcionDeValor]);

  // Sincroniza el texto visible con la selección SOLO cuando el usuario NO está editando. (Causa
  // raíz del "borro y reaparece": el efecto anterior colgaba del objeto derivado de `opciones`,
  // y cada respuesta del typeahead server-side pisaba lo tecleado/borrado a media edición.)
  useEffect(() => {
    if (!enfocado) {
      setTexto(etiquetaValor);
    }
  }, [etiquetaValor, enfocado]);

  // Con selección y texto == etiqueta, el texto NO es una búsqueda (es la etiqueta): se lista el
  // catálogo completo para poder cambiar de opción sin borrar primero.
  const consulta = valor !== null && texto === etiquetaValor ? '' : texto;
  const filtradas = useMemo(
    () =>
      busquedaServidor
        ? // Búsqueda sin resolver: las opciones viejas NO son elegibles (anti-carrera) — la lista
          // efectiva queda vacía y el popover pinta "Buscando…" hasta que lleguen las reales.
          cargando
          ? []
          : [...opciones]
        : filtrarOpciones(opciones, consulta),
    [busquedaServidor, cargando, opciones, consulta],
  );
  const activoSeguro = filtradas.length === 0 ? 0 : Math.min(activo, filtradas.length - 1);

  // Clic fuera: cierra VÍA blur (una sola ruta de salida) — cubre overlays que hacen
  // preventDefault del mousedown y no moverían el foco por sí solos.
  useEffect(() => {
    function alClicFuera(evento: MouseEvent): void {
      if (contenedorRef.current && !contenedorRef.current.contains(evento.target as Node)) {
        inputRef.current?.blur();
      }
    }
    document.addEventListener('mousedown', alClicFuera);
    return () => document.removeEventListener('mousedown', alClicFuera);
  }, []);

  function elegir(opcion: O): void {
    onChange(opcion.id);
    setEtiquetaValor(opcion.nombre);
    setTexto(opcion.nombre);
    // Resetea la búsqueda server-side: la etiqueta ya no depende de que la opción siga en la
    // página filtrada, y la próxima apertura muestra el catálogo completo.
    alCambiarTexto?.('');
    setAbierto(false);
  }

  function limpiar(): void {
    onChange(null);
    setEtiquetaValor('');
    setTexto('');
    alCambiarTexto?.('');
    setAbierto(false);
  }

  /** Repone la etiqueta de la selección vigente (o vacío) y resetea la búsqueda a medias. */
  function restaurarEtiqueta(): void {
    if (texto !== etiquetaValor) {
      setTexto(etiquetaValor);
      alCambiarTexto?.('');
    }
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
      restaurarEtiqueta();
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
      {conLupa ? (
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
      ) : null}
      <Input
        ref={inputRef}
        type="text"
        role="combobox"
        value={texto}
        disabled={deshabilitado}
        onChange={(e) => {
          const nuevo = e.target.value;
          setTexto(nuevo);
          alCambiarTexto?.(nuevo);
          setAbierto(true);
          setActivo(0);
          // Borrar TODO el texto borra también la selección (el filtro vuelve a "Todos"): antes
          // quedaba pegada y el texto borrado reaparecía al llegar la respuesta del server.
          if (nuevo === '' && valor !== null && permitirLimpiar) {
            onChange(null);
          }
        }}
        onFocus={() => {
          setEnfocado(true);
          setAbierto(true);
          if (valor !== null) {
            // Selecciona todo el texto: se teclea encima de la selección de una, sin tener que
            // borrar letra por letra; la lista arranca posicionada en la opción elegida.
            inputRef.current?.select();
            conservarSeleccionRef.current = true;
            const indice = filtradas.findIndex((o) => o.id === valor);
            setActivo(indice === -1 ? 0 : indice);
          }
        }}
        onMouseUp={(e) => {
          if (conservarSeleccionRef.current) {
            e.preventDefault();
            conservarSeleccionRef.current = false;
          }
        }}
        onBlur={() => {
          setEnfocado(false);
          setAbierto(false);
          conservarSeleccionRef.current = false;
          // El efecto de sincronía repone el texto; aquí solo se resetea la búsqueda a medias.
          if (texto !== etiquetaValor) {
            alCambiarTexto?.('');
          }
        }}
        onKeyDown={alTeclado}
        placeholder={placeholder}
        aria-label={etiqueta ?? placeholder}
        aria-expanded={abierto}
        aria-controls={idLista}
        autoComplete="off"
        className={cn('pr-8', conLupa && 'pl-8', valor !== null && 'font-medium')}
        data-testid={testidInput ?? `${testid}-input`}
      />
      {valor !== null && !deshabilitado && permitirLimpiar ? (
        <button
          type="button"
          // mousedown-preventDefault: no le roba el foco al input (no dispara su blur).
          onMouseDown={(e) => e.preventDefault()}
          onClick={limpiar}
          aria-label="Limpiar selección"
          data-testid={`${testid}-limpiar`}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : cargando ? (
        <Loader2Icon
          className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
          aria-hidden
          data-testid={`${testid}-cargando`}
        />
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
          className="absolute top-full left-0 z-50 mt-1 max-h-64 w-full min-w-56 overflow-y-auto rounded-lg border bg-popover p-1 shadow-md"
          data-testid={`${testid}-lista`}
        >
          {mensajeError !== undefined ? (
            <p className="px-3 py-2 text-sm text-destructive" role="alert">
              {mensajeError}
            </p>
          ) : filtradas.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {cargando ? 'Buscando…' : textoVacio}
            </p>
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
                {renderOpcion !== undefined ? (
                  renderOpcion(opcion)
                ) : (
                  <span className="min-w-0 truncate">{opcion.nombre}</span>
                )}
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
