import { Boxes, Hash, Package, Ruler, Star, Tag, Truck, Wallet } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useAvios,
  useDesactivarAvio,
  useReactivarAvio,
  type Avio,
  type AviosQuery,
} from '@/api/avios';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { Avatar, TipoBadge } from '@/components/dominio/visuales';
import { SelectNativo } from '@/components/ui/native-select';
import { useDebounce } from '@/lib/useDebounce';
import { ListaDetalle, type PaginacionListaDetalle } from '@/modulos/ListaDetalle';
import {
  CampoDetalle,
  Historial,
  RejillaCampos,
  SeccionDetalle,
  ValorVacio,
} from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoAvio } from './DialogoAvio';
import { MedidasAvio } from './MedidasAvio';

/** Renglones por página del listado. */
const POR_PAGINA = 10;

/** Valor del filtro de género que significa "todos" (sin filtrar). */
const GENERO_TODOS = 'TODOS';

/** ¿La cadena tiene contenido real (no null ni vacía)? */
function hayTexto(valor: string | null): valor is string {
  return valor !== null && valor.trim() !== '';
}

/** Formatea un precio (number | null) como moneda corta es-MX, o "—". */
function formatearPrecio(valor: number | null): string {
  if (valor === null) {
    return '—';
  }
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  }).format(valor);
}

/**
 * Pantalla de Avíos — CRUD del catálogo (F1-E3, R1) sobre el motor LISTA + DETALLE
 * (rediseño "Teal fresco"). Lista con búsqueda (debounce), **filtro por género (genérico/
 * no, R4)**, paginación de servidor y toggle de inactivos; el detalle muestra los datos del
 * avío y su tabla de **proveedores con precios** (R1), y permite editar / desactivar /
 * reactivar. Borrado suave reversible (desactivar con confirmación, reactivar directo);
 * toasts; consciente de permisos. El listado DISTINGUE los avíos genéricos con un badge.
 *
 * `avios.ver` gobierna el acceso a la pantalla; `avios.administrar` decide las acciones de
 * escritura. La decisión real la toma el backend (A1).
 */
export function AviosPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('avios.administrar');

  // ── Estado de la vista ─────────────────────────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  // Filtro por género: "TODOS" | "generico" | "normal".
  const [generoFiltro, setGeneroFiltro] = useState<string>(GENERO_TODOS);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);

  const query: AviosQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'clave',
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(generoFiltro === 'generico'
      ? { esGenerico: 'true' }
      : generoFiltro === 'normal'
        ? { esGenerico: 'false' }
        : {}),
  };

  const consulta = useAvios(query);
  const desactivar = useDesactivarAvio();
  const reactivar = useReactivarAvio();

  // ── Diálogos ───────────────────────────────────────────────────────────────
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [avioEnEdicion, setAvioEnEdicion] = useState<Avio | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<Avio | null>(null);

  function abrirAlta(): void {
    setAvioEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(avio: Avio): void {
    setAvioEnEdicion(avio);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Avío "${objetivo.clave}" desactivado.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  // Reactivar es NO destructivo: se aplica directo, sin diálogo de confirmación.
  function reactivarAvio(avio: Avio): void {
    reactivar.mutate(avio.id, {
      onSuccess: () => toast.success(`Avío "${avio.clave}" activado.`),
      onError: (error) => toast.error(error.message),
    });
  }

  // Cambiar búsqueda, género o el filtro de inactivos reinicia a la página 1.
  function alBuscar(valor: string): void {
    setTextoBusqueda(valor);
    setPagina(1);
  }

  function alCambiarGenero(valor: string): void {
    setGeneroFiltro(valor);
    setPagina(1);
  }

  function alAlternarInactivos(): void {
    setIncluirInactivos((v) => !v);
    setPagina(1);
  }

  const datos = consulta.data;
  const totalPaginas = datos?.totalPaginas ?? 0;
  const paginacion: PaginacionListaDetalle | undefined = datos
    ? {
        total: datos.total,
        pagina: datos.pagina,
        totalPaginas,
        ocupado: consulta.isFetching,
        alAnterior: () => setPagina((p) => Math.max(1, p - 1)),
        alSiguiente: () => setPagina((p) => Math.min(totalPaginas, p + 1)),
      }
    : undefined;

  return (
    <>
      <ListaDetalle<Avio>
        testid="avio"
        titulo="Avíos"
        descripcion="Habilitación: botones, hilos, etiquetas… y sus proveedores."
        icono={Boxes}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(a) => a.id}
        obtenerTitulo={(a) => a.clave}
        obtenerActivo={(a) => a.activo}
        obtenerSecundaria={(a) => a.descripcion}
        renderAvatarLista={(a) => <Avatar nombre={a.clave} tono="avios" tamano="sm" />}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        filtros={
          <SelectNativo
            value={generoFiltro}
            onChange={(e) => alCambiarGenero(e.target.value)}
            aria-label="Filtrar avíos por género"
            data-testid="filtro-genero-avio"
          >
            <option value={GENERO_TODOS}>Todos los avíos</option>
            <option value="generico">Solo genéricos</option>
            <option value="normal">Solo por orden</option>
          </SelectNativo>
        }
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={alAlternarInactivos}
        textoVacio="No hay avíos que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nuevo avío"
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={reactivarAvio}
        renderAvatarDetalle={(a) => <Avatar nombre={a.clave} tono="avios" tamano="lg" />}
        renderMeta={(a) => (
          <span className="flex flex-wrap gap-1.5">
            {a.esGenerico ? <TipoBadge tono="neutro">Genérico</TipoBadge> : null}
            {a.favorito ? <TipoBadge tono="avios">Favorito</TipoBadge> : null}
          </span>
        )}
        renderDetalle={(a) => <DetalleAvio avio={a} puedeAdministrar={puedeAdministrar} />}
      />

      {/* Diálogos */}
      <DialogoAvio
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        avio={avioEnEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar avío"
        descripcion={
          <>
            ¿Seguro que quieres desactivar el avío{' '}
            <span className="font-medium text-foreground">{aDesactivar?.clave}</span>? Podrás volver
            a activarlo después; su historial se conserva.
          </>
        }
        textoConfirmar="Desactivar"
        variante="destructive"
        procesando={desactivar.isPending}
        alConfirmar={confirmarDesactivar}
      />
    </>
  );
}

/**
 * Panel de DETALLE de un avío (M2): muestra sus datos generales y su tabla de proveedores
 * con precios (R1). Los campos sin dato no se pintan (no se llena de vacíos). La sección
 * General siempre se muestra (clave/descripción existen). Usa las piezas de
 * `@/modulos/detalle` para verse igual que el resto.
 */
function DetalleAvio({
  avio,
  puedeAdministrar,
}: {
  avio: Avio;
  puedeAdministrar: boolean;
}): React.JSX.Element {
  return (
    <>
      {/* ── General (siempre: clave/descripción existen) ─────────────────────── */}
      <SeccionDetalle titulo="Datos del avío" icono={Package}>
        <RejillaCampos>
          <CampoDetalle icono={Hash} etiqueta="Clave">
            {avio.clave}
          </CampoDetalle>
          <CampoDetalle icono={Tag} etiqueta="Descripción">
            {avio.descripcion}
          </CampoDetalle>
          <CampoDetalle icono={Ruler} etiqueta="Unidad">
            {hayTexto(avio.unidad) ? avio.unidad : <ValorVacio />}
          </CampoDetalle>
          <CampoDetalle icono={Package} etiqueta="Presentación">
            {hayTexto(avio.presentacion) ? avio.presentacion : <ValorVacio />}
          </CampoDetalle>
          <CampoDetalle icono={Star} etiqueta="¿Favorito?">
            {avio.favorito ? `Sí (cantidad: ${avio.cantFav ?? '—'})` : 'No'}
          </CampoDetalle>
          <CampoDetalle icono={Boxes} etiqueta="¿Genérico? (R4)">
            {avio.esGenerico ? 'Sí (stock)' : 'No (por orden)'}
          </CampoDetalle>
          <CampoDetalle icono={Wallet} etiqueta="Precio de referencia" anchoCompleto>
            {avio.precioReferencia !== null ? (
              formatearPrecio(avio.precioReferencia)
            ) : (
              <ValorVacio />
            )}
          </CampoDetalle>
        </RejillaCampos>
      </SeccionDetalle>

      {/* ── Proveedores y precios (R1) ───────────────────────────────────────── */}
      <SeccionDetalle titulo="Proveedores y precios" icono={Truck}>
        {avio.proveedores.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="avio-sin-proveedores">
            Este avío no tiene proveedores asignados.
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="avio-proveedores-detalle">
            {avio.proveedores.map((proveedor) => (
              <li
                key={proveedor.idProveedor}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{proveedor.nombreProveedor}</p>
                  {hayTexto(proveedor.condiciones) ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {proveedor.condiciones}
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums">
                  {formatearPrecio(proveedor.precio)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SeccionDetalle>

      {/* ── Medidas del avío "por medida" (R5, B11) ──────────────────────────── */}
      <SeccionDetalle titulo="Medidas del avío (por medida)" icono={Ruler}>
        <MedidasAvio idAvio={avio.id} puedeAdministrar={puedeAdministrar} />
      </SeccionDetalle>

      <Historial creadoEn={avio.creadoEn} modificadoEn={avio.modificadoEn} />
    </>
  );
}
