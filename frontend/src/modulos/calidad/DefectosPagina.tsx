import { ClipboardList, Star, Tag } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useDefectos, useDesactivarDefecto, useReactivarDefecto } from '@/api/calidad';
import {
  ETIQUETAS_SEVERIDAD_DEFECTO,
  SEVERIDADES_DEFECTO,
  type SeveridadDefectoClave,
} from '@/api/esquemas';
import type { Defecto, DefectosQuery } from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { Avatar, TipoBadge } from '@/components/dominio/visuales';
import { Badge } from '@/components/ui/badge';
import { SelectNativo } from '@/components/ui/native-select';
import { useDebounce } from '@/lib/useDebounce';
import { ListaDetalle, type PaginacionListaDetalle } from '@/modulos/ListaDetalle';
import { CampoDetalle, Historial, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoDefecto } from './DialogoDefecto';

const POR_PAGINA = 10;
const TODOS_NIVELES = 'TODOS';
const TODAS_SEVERIDADES = 'TODAS';

/**
 * Pantalla de Defectos — CRUD completo (patron ListaDetalle). Lista con busqueda
 * (debounce), filtros (nivelAQL, severidad, soloFavoritos), toggle inactivos,
 * paginacion de servidor y detalle. `calidad.ver` gobierna el acceso;
 * `calidad.administrar-catalogo` las acciones de escritura (A1).
 */
export function DefectosPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('calidad.administrar-catalogo');

  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [nivelFiltro, setNivelFiltro] = useState<string>(TODOS_NIVELES);
  const [severidadFiltro, setSeveridadFiltro] = useState<string>(TODAS_SEVERIDADES);
  const [soloFavoritos, setSoloFavoritos] = useState(false);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);

  const query: DefectosQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'clave',
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(nivelFiltro !== TODOS_NIVELES ? { nivelAQL: Number(nivelFiltro) } : {}),
    ...(severidadFiltro !== TODAS_SEVERIDADES
      ? { severidad: severidadFiltro as SeveridadDefectoClave }
      : {}),
    ...(soloFavoritos ? { soloFavoritos: 'true' } : {}),
  };

  const consulta = useDefectos(query);
  const desactivar = useDesactivarDefecto();
  const reactivar = useReactivarDefecto();

  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [defectoEnEdicion, setDefectoEnEdicion] = useState<Defecto | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<Defecto | null>(null);

  function abrirAlta(): void {
    setDefectoEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(defecto: Defecto): void {
    setDefectoEnEdicion(defecto);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) return;
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Defecto "${objetivo.clave}" desactivado.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  function reactivarDefecto(defecto: Defecto): void {
    reactivar.mutate(defecto.id, {
      onSuccess: () => toast.success(`Defecto "${defecto.clave}" activado.`),
      onError: (error) => toast.error(error.message),
    });
  }

  function alBuscar(valor: string): void {
    setTextoBusqueda(valor);
    setPagina(1);
  }

  function alCambiarNivel(valor: string): void {
    setNivelFiltro(valor);
    setPagina(1);
  }

  function alCambiarSeveridad(valor: string): void {
    setSeveridadFiltro(valor);
    setPagina(1);
  }

  function alAlternarFavoritos(): void {
    setSoloFavoritos((v) => !v);
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
      <ListaDetalle<Defecto>
        testid="defecto"
        titulo="Catálogo de defectos"
        descripcion="Defectos del sistema de calidad AQL con severidad y tipos de producto."
        icono={ClipboardList}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(d) => d.id}
        obtenerTitulo={(d) => d.clave}
        obtenerActivo={(d) => d.activo}
        obtenerSecundaria={(d) => d.descripcion}
        renderAvatarLista={(d) => (
          <Avatar nombre={d.clave} tono="servicios" tamano="sm">
            <ClipboardList className="size-4" aria-hidden />
          </Avatar>
        )}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        filtros={
          <div className="flex flex-wrap gap-2">
            <SelectNativo
              value={nivelFiltro}
              onChange={(e) => alCambiarNivel(e.target.value)}
              aria-label="Filtrar por nivel AQL"
              data-testid="filtro-nivel-aql"
            >
              <option value={TODOS_NIVELES}>Todos los niveles</option>
              <option value="1">AQL 1</option>
              <option value="2.5">AQL 2.5</option>
              <option value="10">AQL 10</option>
            </SelectNativo>
            <SelectNativo
              value={severidadFiltro}
              onChange={(e) => alCambiarSeveridad(e.target.value)}
              aria-label="Filtrar por severidad"
              data-testid="filtro-severidad"
            >
              <option value={TODAS_SEVERIDADES}>Todas las severidades</option>
              {SEVERIDADES_DEFECTO.map((s) => (
                <option key={s} value={s}>
                  {ETIQUETAS_SEVERIDAD_DEFECTO[s]}
                </option>
              ))}
            </SelectNativo>
            <button
              type="button"
              className={`flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm transition-colors ${soloFavoritos ? 'border-primary bg-primary/10 text-primary' : 'border-input bg-background hover:bg-accent'}`}
              onClick={alAlternarFavoritos}
              aria-pressed={soloFavoritos}
              data-testid="filtro-favoritos"
            >
              <Star className="size-3.5" aria-hidden />
              Favoritos
            </button>
          </div>
        }
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={alAlternarInactivos}
        textoVacio="No hay defectos que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nuevo defecto"
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={reactivarDefecto}
        renderAvatarDetalle={(d) => (
          <Avatar nombre={d.clave} tono="servicios" tamano="lg">
            <ClipboardList className="size-7" aria-hidden />
          </Avatar>
        )}
        renderMeta={(d) => (
          <TipoBadge tono="servicios">{ETIQUETAS_SEVERIDAD_DEFECTO[d.severidad]}</TipoBadge>
        )}
        renderDetalle={(d) => (
          <>
            <SeccionDetalle titulo="Datos del defecto">
              <RejillaCampos>
                <CampoDetalle icono={Tag} etiqueta="Clave">
                  <span className="font-mono text-sm">{d.clave}</span>
                </CampoDetalle>
                <CampoDetalle icono={ClipboardList} etiqueta="Nivel AQL">
                  AQL {d.nivelAQL}
                </CampoDetalle>
                <CampoDetalle icono={Tag} etiqueta="Severidad">
                  {ETIQUETAS_SEVERIDAD_DEFECTO[d.severidad]}
                </CampoDetalle>
                {d.categoria !== null && (
                  <CampoDetalle icono={Tag} etiqueta="Categoría">
                    {d.categoria}
                  </CampoDetalle>
                )}
                {d.pag !== null && (
                  <CampoDetalle icono={Tag} etiqueta="Página">
                    {d.pag}
                  </CampoDetalle>
                )}
                <CampoDetalle icono={Star} etiqueta="Favorito">
                  {d.favorito ? 'Sí (pre-cargado)' : 'No'}
                </CampoDetalle>
                <CampoDetalle icono={Tag} etiqueta="Ámbito">
                  {d.aplicaGeneral ? (
                    'General (todos los tipos)'
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {d.tiposProducto.length === 0
                        ? '—'
                        : d.tiposProducto.map((t) => (
                            <Badge key={t.id} variant="secondary">
                              {t.nombre}
                            </Badge>
                          ))}
                    </span>
                  )}
                </CampoDetalle>
              </RejillaCampos>
            </SeccionDetalle>
            <Historial creadoEn={d.creadoEn} modificadoEn={d.modificadoEn} />
          </>
        )}
      />

      <DialogoDefecto
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        defecto={defectoEnEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) setADesactivar(null);
        }}
        titulo="Desactivar defecto"
        descripcion={
          <>
            ¿Seguro que quieres desactivar el defecto{' '}
            <span className="font-medium text-foreground">{aDesactivar?.clave}</span>? Podrás volver
            a activarlo después; el historial se conserva.
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
