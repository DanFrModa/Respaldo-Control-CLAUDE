import { useState } from 'react';
import { toast } from 'sonner';

import { useColores, useCrearColor } from '@/api/colores';
import { ComboboxBuscable } from '@/components/dominio/ComboboxBuscable';
import { useDebounce } from '@/lib/useDebounce';

/**
 * AGREGAR COLOR a la matriz de la OP, con ALTA AL VUELO (§Post-F9.11 punto de UX de la
 * matriz): hoy capturar un color nuevo obligaba a salir a Catálogos → Colores y volver.
 * Este combobox busca los colores de PRENDA existentes EN EL SERVIDOR (patrón
 * `SelectorProveedor`: typeahead con debounce + anti-carrera del kit — el catálogo puede
 * rebasar cualquier página cargada, y sugerir solo la página 1 invitaría a duplicar
 * "Verde bandera" nada más por no verlo). Los colores ya usados en la matriz no se
 * ofrecen. Si lo tecleado NO existe según la búsqueda YA RESUELTA y el usuario TIENE el
 * permiso que exige el endpoint de crear color (`colores.administrar` — la opción NO se
 * muestra sin él), ofrece "Crear color …": llama el endpoint EXISTENTE `POST /api/colores`
 * y agrega la fila con el color recién creado. El backend valida y autoriza (A1); crear
 * inválido/duplicado se reporta con su mensaje en un toast.
 *
 * Reemplaza al `<select>` nativo de la matriz vía el `slotAgregarColor` de
 * `MatrizColorTalla` SOLO en la OP; los demás flujos (corte, envíos, recibos…) conservan
 * su selector de siempre. El padre lo REMONTA (`key`) tras agregar, para que el texto
 * tecleado no quede pegado al siguiente uso.
 */
export function AgregarColorMatriz({
  idsUsados,
  alAgregar,
  puedeCrear,
  deshabilitado = false,
}: {
  /** Ids de color de PRENDA que YA están en la matriz (no se vuelven a ofrecer). */
  idsUsados: ReadonlySet<number>;
  /** Agrega la fila del color elegido/creado a la matriz. */
  alAgregar: (idColor: number, nombre: string) => void;
  /** ¿Tiene `colores.administrar`? Sin él, la opción de crear NO aparece. */
  puedeCrear: boolean;
  deshabilitado?: boolean;
}): React.JSX.Element {
  const crear = useCrearColor();
  const [texto, setTexto] = useState('');
  const busqueda = useDebounce(texto.trim(), 300);
  const consulta = useColores({
    pagina: 1,
    porPagina: 10,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });

  const encontrados = consulta.data?.datos ?? [];
  const opciones = encontrados.filter((c) => !idsUsados.has(c.id));
  // Lo TECLEADO aún no está resuelto (debounce en vuelo o consulta cargando): no ofrecer
  // opciones viejas NI la acción de crear (podría "crear" algo que sí existe más abajo).
  const resolviendo = texto.trim() !== busqueda || consulta.isPending || consulta.isFetching;

  const nombreNuevo = texto.trim();
  // "Crear" SOLO cuando la búsqueda YA RESUELTA no encuentra ese nombre (insensible) — ni
  // entre los ofrecidos ni entre los ya usados en la matriz.
  const yaExiste = encontrados.some(
    (c) => c.nombre.trim().toLowerCase() === nombreNuevo.toLowerCase(),
  );
  const ofrecerCrear = puedeCrear && nombreNuevo !== '' && !resolviendo && !yaExiste;

  function crearColorAlVuelo(): void {
    if (nombreNuevo === '' || crear.isPending) {
      return;
    }
    crear.mutate(
      { nombre: nombreNuevo },
      {
        onSuccess: (color) => {
          toast.success(`Color "${color.nombre}" creado.`);
          alAgregar(color.id, color.nombre);
          setTexto('');
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <div className="w-60">
      <ComboboxBuscable
        opciones={opciones.map((o) => ({ id: o.id, nombre: o.nombre }))}
        valor={null}
        onChange={(id) => {
          if (id === null) {
            return;
          }
          const opcion = opciones.find((o) => o.id === id);
          if (opcion !== undefined) {
            alAgregar(opcion.id, opcion.nombre);
          }
        }}
        alCambiarTexto={setTexto}
        busquedaServidor
        mensajeError={consulta.isError ? consulta.error.message : undefined}
        placeholder="Agregar color…"
        etiqueta="Agregar color"
        textoVacio={
          puedeCrear ? 'Sin coincidencias: créalo con la opción de abajo.' : 'Sin coincidencias.'
        }
        deshabilitado={deshabilitado || crear.isPending}
        cargando={resolviendo || crear.isPending}
        testid="matriz-color-al-vuelo"
        {...(ofrecerCrear
          ? {
              accionCrear: {
                etiqueta: `+ Crear color "${nombreNuevo}"`,
                onCrear: crearColorAlVuelo,
              },
            }
          : {})}
      />
    </div>
  );
}
