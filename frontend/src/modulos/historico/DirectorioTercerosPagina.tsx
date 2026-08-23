import { useState } from 'react';

import { useDirectorioTerceros } from '@/api/directorio-terceros';
import type { DirectorioTercero, DirectorioTercerosQuery } from '@/api/tipos';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import { Field, FieldLabel } from '@/components/ui/field';
import { SelectNativo } from '@/components/ui/native-select';
import { useDebounce } from '@/lib/useDebounce';
import {
  TablaCatalogo,
  type ColumnaCatalogo,
  type PaginacionCatalogo,
} from '@/modulos/TablaCatalogo';

/** Renglones por página. */
const POR_PAGINA = 25;

/**
 * DIRECTORIO HISTÓRICO DE TERCEROS del sistema viejo (§Post-F9.28).
 *
 * Daniel (10-ago-2026): *"Al no pasar la información de los maquileros, ¿qué hacemos con la
 * información de ellos si quisiera encontrar algún teléfono o nombre?… ¿Podríamos guardarlo en algún
 * otro repositorio que no sea el catálogo de proveedores?"*
 *
 * Es la libreta de direcciones del Access: los 1,052 terceros con su teléfono y su dirección,
 * FUERA del catálogo de proveedores. La depuración sigue valiendo (esos ~897 no estorban al
 * capturar) pero el dato de contacto no se perdió.
 *
 * SOLO CONSULTA — y sin botón de "pasar al catálogo", a propósito: si un taller vuelve, se da de
 * alta limpio copiando de aquí lo que sirva.
 */
export function DirectorioTercerosPagina(): React.JSX.Element {
  const [texto, setTexto] = useState('');
  const busqueda = useDebounce(texto.trim(), 300);
  const [servicio, setServicio] = useState('');
  // Se tipa como el literal (no como el opcional del query) para que `exactOptionalPropertyTypes`
  // no vea un `undefined` que este estado nunca toma.
  const [enCatalogo, setEnCatalogo] = useState<'todos' | 'solo-catalogo' | 'solo-fuera'>('todos');
  const [pagina, setPagina] = useState(1);

  const query: DirectorioTercerosQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'nombre',
    direccion: 'asc',
    enCatalogo,
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(servicio === '' ? {} : { servicio }),
  };

  const consulta = useDirectorioTerceros(query);

  function cambiarFiltro(aplicar: () => void): void {
    aplicar();
    setPagina(1);
  }

  const datos = consulta.data;
  const totalPaginas = datos === undefined ? 0 : Math.ceil(datos.total / datos.porPagina);
  const paginacion: PaginacionCatalogo | undefined = datos
    ? {
        total: datos.total,
        pagina: datos.pagina,
        totalPaginas,
        ocupado: consulta.isFetching,
        alAnterior: () => setPagina((p) => Math.max(1, p - 1)),
        alSiguiente: () => setPagina((p) => Math.min(totalPaginas, p + 1)),
      }
    : undefined;

  const columnas: ColumnaCatalogo<DirectorioTercero>[] = [
    {
      encabezado: 'Nombre',
      render: (t) => (
        <span className="flex flex-col">
          <span className="font-medium">{t.nombre}</span>
          {t.razonSocial === null || t.razonSocial === t.nombre ? null : (
            <span className="text-xs text-muted-foreground">{t.razonSocial}</span>
          )}
        </span>
      ),
    },
    {
      encabezado: 'Teléfono',
      // `whitespace-pre-line`: en el viejo varios traen DOS teléfonos separados por salto de línea.
      render: (t) => <span className="whitespace-pre-line">{t.telefono ?? '—'}</span>,
    },
    { encabezado: 'Contacto', render: (t) => t.contacto ?? '—' },
    {
      encabezado: 'Dirección',
      render: (t) => (
        <span className="whitespace-pre-line text-muted-foreground">{t.direccion ?? '—'}</span>
      ),
    },
    {
      encabezado: 'Hacía',
      render: (t) => <span className="text-muted-foreground">{t.servicios ?? '—'}</span>,
    },
    {
      encabezado: 'Último trabajo',
      render: (t) => (
        <span className="flex flex-col">
          <span>{t.ultimaActividad ?? '—'}</span>
          {t.documentos > 0 ? (
            <span className="text-xs text-muted-foreground">
              {t.documentos.toLocaleString('es-MX')} documentos
            </span>
          ) : null}
        </span>
      ),
    },
    {
      encabezado: '',
      render: (t) =>
        t.enCatalogo ? (
          <ChipEstado tono="ok" sinPunto>
            En el catálogo
          </ChipEstado>
        ) : null,
    },
  ];

  const filtros = (
    <>
      <Field className="w-40">
        <FieldLabel htmlFor="dir-servicio">Hacía</FieldLabel>
        <SelectNativo
          id="dir-servicio"
          value={servicio}
          onChange={(e) => cambiarFiltro(() => setServicio(e.target.value))}
          data-testid="dir-servicio"
        >
          <option value="">Todos</option>
          <option value="Costura">Costura</option>
          <option value="Corte">Corte</option>
          <option value="Estampado">Estampado</option>
          <option value="Vende telas">Vende telas</option>
          <option value="Vende avíos">Vende avíos</option>
          <option value="Servicios">Servicios</option>
        </SelectNativo>
      </Field>
      <Field className="w-48">
        <FieldLabel htmlFor="dir-catalogo">Dado de alta en v2</FieldLabel>
        <SelectNativo
          id="dir-catalogo"
          value={enCatalogo}
          onChange={(e) =>
            cambiarFiltro(() =>
              setEnCatalogo(e.target.value as 'todos' | 'solo-catalogo' | 'solo-fuera'),
            )
          }
          data-testid="dir-catalogo"
        >
          <option value="todos">Todos</option>
          <option value="solo-fuera">Solo los que ya no están</option>
          <option value="solo-catalogo">Solo los del catálogo</option>
        </SelectNativo>
      </Field>
    </>
  );

  return (
    <TablaCatalogo<DirectorioTercero>
      testid="directorio-tercero"
      titulo="Directorio histórico"
      descripcion="Teléfonos y direcciones del sistema anterior · solo consulta"
      unidad="terceros"
      registros={datos?.datos ?? []}
      cargando={consulta.isPending}
      error={consulta.isError ? consulta.error.message : null}
      alReintentar={() => void consulta.refetch()}
      obtenerId={(t) => t.id}
      obtenerActivo={() => true}
      ocultarEstado
      ocultarToggleInactivos
      columnas={columnas}
      busqueda={texto}
      alBuscar={(v) => cambiarFiltro(() => setTexto(v))}
      filtros={filtros}
      incluirInactivos={false}
      alAlternarInactivos={() => undefined}
      textoVacio="No hay terceros que coincidan con la búsqueda."
      paginacion={paginacion}
      puedeAdministrar={false}
      textoNuevo=""
    />
  );
}
