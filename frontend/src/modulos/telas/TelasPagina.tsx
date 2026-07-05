import { Layers, Palette, Ruler, Star, Tag, Truck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useDesactivarTela,
  useReactivarTela,
  useTelas,
  useTelasCategorias,
  type Tela,
  type TelaCategoria,
  type TelaColor,
  type TelasQuery,
  type TipoComponenteTela,
} from '@/api/telas';
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

import { DialogoTela } from './DialogoTela';
import { EditorProveedoresTela } from './EditorProveedoresTela';

/** Renglones por pagina del listado. */
const POR_PAGINA = 10;

/** Valor del filtro de categoria que significa "todas" (sin filtrar). */
const CATEGORIA_TODAS = 'TODAS';

/** Formato de precio en pesos mexicanos (igual que Cortadores/Etiquetas). */
const FORMATO_MONEDA = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
});

/** Etiqueta legible del tipo de componente (D5). */
const ETIQUETA_TIPO_COMPONENTE: Record<TipoComponenteTela, string> = {
  CUERPO: 'Cuerpo',
  CARDIGAN: 'Cardigán',
  OTRO: 'Otro',
};

/** ¿La cadena tiene contenido real (no null ni vacia)? */
function hayTexto(valor: string | null): valor is string {
  return valor !== null && valor.trim() !== '';
}

/**
 * Pantalla de Telas — CRUD del catalogo UNIFICADO (BOM + inventario, F1-E3) sobre el motor
 * LISTA + DETALLE (rediseño "Teal fresco"). Lista con busqueda (debounce), **filtro por
 * categoria**, paginacion de servidor y toggle de inactivos; el detalle muestra los datos de
 * la tela y su grid de colores con precio, y permite editar / desactivar / reactivar.
 * Borrado suave reversible; toasts; consciente de permisos.
 *
 * `telas.ver` gobierna el acceso a la pantalla; `telas.administrar` decide las acciones de
 * escritura (y las categorias, que no tienen permiso propio). La decision real la toma el
 * backend (A1).
 */
export function TelasPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('telas.administrar');
  const puedeVerImportes = tienePermiso('consultas.ver-importes');

  // ── Estado de la vista ─────────────────────────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [categoriaFiltro, setCategoriaFiltro] = useState<string>(CATEGORIA_TODAS);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);

  const categoriasCatalogo = useTelasCategorias({ porPagina: 100 });

  const query: TelasQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(categoriaFiltro !== CATEGORIA_TODAS ? { idCategoria: Number(categoriaFiltro) } : {}),
  };

  const consulta = useTelas(query);
  const desactivar = useDesactivarTela();
  const reactivar = useReactivarTela();

  // ── Dialogos ───────────────────────────────────────────────────────────────
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [telaEnEdicion, setTelaEnEdicion] = useState<Tela | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<Tela | null>(null);

  function abrirAlta(): void {
    setTelaEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(tela: Tela): void {
    setTelaEnEdicion(tela);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Tela "${objetivo.nombre}" desactivada.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  // Reactivar es NO destructivo: se aplica directo, sin dialogo de confirmacion.
  function reactivarTela(tela: Tela): void {
    reactivar.mutate(tela.id, {
      onSuccess: () => toast.success(`Tela "${tela.nombre}" activada.`),
      onError: (error) => toast.error(error.message),
    });
  }

  function alBuscar(valor: string): void {
    setTextoBusqueda(valor);
    setPagina(1);
  }

  function alCambiarCategoria(valor: string): void {
    setCategoriaFiltro(valor);
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
      <ListaDetalle<Tela>
        testid="tela"
        titulo="Telas"
        descripcion="Catálogo unificado de telas (BOM e inventario) con sus colores."
        icono={Layers}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(t) => t.id}
        obtenerTitulo={(t) => t.nombre}
        obtenerActivo={(t) => t.activo}
        obtenerSecundaria={(t) => t.categoria ?? 'Sin categoría'}
        renderAvatarLista={(t) => <Avatar nombre={t.nombre} tono="telas" tamano="sm" />}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        filtros={
          <SelectNativo
            value={categoriaFiltro}
            onChange={(e) => alCambiarCategoria(e.target.value)}
            aria-label="Filtrar telas por categoría"
            data-testid="filtro-categoria-tela"
            disabled={categoriasCatalogo.isPending || categoriasCatalogo.isError}
          >
            <option value={CATEGORIA_TODAS}>Todas las categorías</option>
            {(categoriasCatalogo.data?.datos ?? []).map((cat: TelaCategoria) => (
              <option key={cat.id} value={String(cat.id)}>
                {cat.nombre}
              </option>
            ))}
          </SelectNativo>
        }
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={alAlternarInactivos}
        textoVacio="No hay telas que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nueva tela"
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={reactivarTela}
        renderAvatarDetalle={(t) => <Avatar nombre={t.nombre} tono="telas" tamano="lg" />}
        renderMeta={(t) => (
          <span className="flex flex-wrap items-center gap-1.5">
            {t.categoria !== null ? <TipoBadge tono="telas">{t.categoria}</TipoBadge> : null}
            {t.favorito ? <TipoBadge tono="pt">Favorita</TipoBadge> : null}
          </span>
        )}
        renderDetalle={(t) => (
          <DetalleTela
            t={t}
            puedeAdministrar={puedeAdministrar}
            puedeVerImportes={puedeVerImportes}
          />
        )}
      />

      <DialogoTela
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        tela={telaEnEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar tela"
        descripcion={
          <>
            ¿Seguro que quieres desactivar la tela{' '}
            <span className="font-medium text-foreground">{aDesactivar?.nombre}</span>? Podrás
            volver a activarla después; su historial y sus colores se conservan.
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
 * Panel de DETALLE de una tela (M2): sus datos generales y el grid de colores con precio.
 * Cada campo de texto solo se pinta si tiene dato. Usa las piezas de `@/modulos/detalle`
 * para verse igual que el resto.
 */
function DetalleTela({
  t,
  puedeAdministrar,
  puedeVerImportes,
}: {
  t: Tela;
  puedeAdministrar: boolean;
  puedeVerImportes: boolean;
}): React.JSX.Element {
  return (
    <>
      <SeccionDetalle titulo="Datos de la tela" icono={Layers}>
        <RejillaCampos>
          <CampoDetalle icono={Tag} etiqueta="Categoría">
            {t.categoria ?? <ValorVacio />}
          </CampoDetalle>
          <CampoDetalle icono={Ruler} etiqueta="Unidad de medida">
            {hayTexto(t.unidadMedida) ? t.unidadMedida : <ValorVacio />}
          </CampoDetalle>
          <CampoDetalle icono={Layers} etiqueta="Tipo de componente">
            {ETIQUETA_TIPO_COMPONENTE[t.tipoComponente]}
          </CampoDetalle>
          <CampoDetalle icono={Star} etiqueta="Precio sugerido">
            {t.precioSugerido === null ? <ValorVacio /> : FORMATO_MONEDA.format(t.precioSugerido)}
          </CampoDetalle>
          <CampoDetalle icono={Star} etiqueta="¿Favorita?">
            {t.favorito ? 'Sí' : 'No'}
          </CampoDetalle>
          <CampoDetalle icono={Layers} etiqueta="¿Para producción?">
            {t.paraProduccion ? 'Sí' : 'No'}
          </CampoDetalle>
          {hayTexto(t.descripcion) ? (
            <CampoDetalle icono={Tag} etiqueta="Descripción" anchoCompleto>
              {t.descripcion}
            </CampoDetalle>
          ) : null}
        </RejillaCampos>
      </SeccionDetalle>

      {/* Colores con precio */}
      <SeccionDetalle titulo="Colores" icono={Palette}>
        {t.colores.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="tela-sin-colores">
            Esta tela no tiene colores capturados.
          </p>
        ) : (
          <ul className="space-y-1.5" data-testid="tela-colores-detalle">
            {t.colores.map((color: TelaColor) => (
              <li
                key={color.idColor}
                className="flex items-center justify-between gap-3 rounded-lg border p-2.5 text-sm"
              >
                <span className="flex items-center gap-2">
                  <Palette className="size-4 text-muted-foreground" aria-hidden />
                  {color.nombre}
                </span>
                <span className="text-muted-foreground">
                  {color.precio === null ? 'Sin precio' : FORMATO_MONEDA.format(color.precio)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SeccionDetalle>

      {/* Precios por proveedor (R17): a quién se le compra la tela y a qué precio (por color). */}
      <SeccionDetalle titulo="Precios por proveedor" icono={Truck}>
        <EditorProveedoresTela
          idTela={t.id}
          colores={t.colores.map((color) => ({ idColor: color.idColor, nombre: color.nombre }))}
          deshabilitado={!puedeAdministrar || !t.activo}
          puedeVerImportes={puedeVerImportes}
        />
      </SeccionDetalle>

      <Historial creadoEn={t.creadoEn} modificadoEn={t.modificadoEn} />
    </>
  );
}
