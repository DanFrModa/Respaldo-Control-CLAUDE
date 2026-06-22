import { CalendarClock, ListChecks, Route, Workflow } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  ETIQUETAS_CONDICION_APLICABILIDAD,
  ETIQUETAS_TIPO_DURACION_PROCESO,
  ETIQUETAS_TIPO_EVENTO_PROCESO,
} from '@/api/esquemas';
import { useDesactivarProcesoRc, useProcesosRc, useReactivarProcesoRc } from '@/api/ruta-critica';
import type { ProcesoRc, ProcesosRcQuery } from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { Avatar, TipoBadge } from '@/components/dominio/visuales';
import { useDebounce } from '@/lib/useDebounce';
import { ListaDetalle, type PaginacionListaDetalle } from '@/modulos/ListaDetalle';
import { CampoDetalle, Historial, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoProcesoRc } from './DialogoProcesoRc';
import { EditorChecklistProceso } from './EditorChecklistProceso';
import { EditorRolesProceso } from './EditorRolesProceso';

/** Renglones por página del listado. */
const POR_PAGINA = 10;

/**
 * Pantalla de PROCESOS de la Ruta Crítica (Módulo 8, F5-E1) — CRUD del catálogo configurable sobre
 * el motor LISTA + DETALLE (estándar teal). En el detalle se editan, además del proceso, sus ROLES
 * RESPONSABLES (multi-select N:M) y su CHECKLIST. Las DEPENDENCIAS (DAG) tienen su propia pantalla.
 *
 * `rc.catalogo-ver` gobierna el acceso a la pantalla; `rc.catalogo-administrar` las escrituras.
 */
export function ProcesosPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('rc.catalogo-administrar');

  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);

  const query: ProcesosRcQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  };

  const consulta = useProcesosRc(query);
  const desactivar = useDesactivarProcesoRc();
  const reactivar = useReactivarProcesoRc();

  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [enEdicion, setEnEdicion] = useState<ProcesoRc | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<ProcesoRc | null>(null);

  function abrirAlta(): void {
    setEnEdicion(undefined);
    setDialogoAbierto(true);
  }
  function abrirEdicion(proceso: ProcesoRc): void {
    setEnEdicion(proceso);
    setDialogoAbierto(true);
  }
  function confirmarDesactivar(): void {
    if (aDesactivar === null) return;
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Proceso "${objetivo.nombre}" desactivado.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }
  function reactivarProceso(proceso: ProcesoRc): void {
    reactivar.mutate(proceso.id, {
      onSuccess: () => toast.success(`Proceso "${proceso.nombre}" activado.`),
      onError: (error) => toast.error(error.message),
    });
  }
  function alBuscar(valor: string): void {
    setTextoBusqueda(valor);
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
      <ListaDetalle<ProcesoRc>
        testid="proceso-rc"
        titulo="Procesos de la Ruta Crítica"
        descripcion="Catálogo configurable de procesos (D10): banderas, roles responsables, dependencias y checklists. El motor por orden llega en etapas posteriores."
        icono={Route}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(p) => p.id}
        obtenerTitulo={(p) => p.nombre}
        obtenerActivo={(p) => p.activo}
        obtenerSecundaria={(p) => p.codigo}
        renderAvatarLista={(p) => (
          <Avatar nombre={p.nombre} tono="servicios" tamano="sm">
            <Route className="size-4" aria-hidden />
          </Avatar>
        )}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={alAlternarInactivos}
        textoVacio="No hay procesos que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nuevo proceso"
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={reactivarProceso}
        renderAvatarDetalle={(p) => (
          <Avatar nombre={p.nombre} tono="servicios" tamano="lg">
            <Route className="size-7" aria-hidden />
          </Avatar>
        )}
        renderMeta={(p) => (
          <div className="flex flex-wrap gap-1.5">
            {p.critico ? <TipoBadge tono="telas">Crítico</TipoBadge> : null}
            {p.ultimoProceso ? <TipoBadge tono="pt">Último proceso</TipoBadge> : null}
            {p.esResurtido ? <TipoBadge tono="avios">Resurtido</TipoBadge> : null}
          </div>
        )}
        renderDetalle={(p) => (
          <>
            <SeccionDetalle titulo="Datos del proceso">
              <RejillaCampos>
                <CampoDetalle icono={Route} etiqueta="Código">
                  {p.codigo}
                </CampoDetalle>
                <CampoDetalle icono={Workflow} etiqueta="Tipo de evento">
                  {ETIQUETAS_TIPO_EVENTO_PROCESO[p.tipoEvento]}
                </CampoDetalle>
                <CampoDetalle icono={CalendarClock} etiqueta="Duración">
                  {ETIQUETAS_TIPO_DURACION_PROCESO[p.tipoDuracion]}
                </CampoDetalle>
                <CampoDetalle icono={ListChecks} etiqueta="Aplicabilidad">
                  {ETIQUETAS_CONDICION_APLICABILIDAD[p.condicionAplicabilidad]}
                </CampoDetalle>
              </RejillaCampos>
            </SeccionDetalle>

            <SeccionDetalle titulo="Roles responsables">
              <EditorRolesProceso proceso={p} puedeAdministrar={puedeAdministrar} />
            </SeccionDetalle>

            <SeccionDetalle titulo="Dependencias (antecesores)">
              {p.antecesores.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Sin antecesores. Edita las dependencias en la pantalla «Dependencias».
                </p>
              ) : (
                <ul className="flex flex-wrap gap-1.5" data-testid="antecesores-proceso">
                  {p.antecesores.map((a) => (
                    <TipoBadge key={a.idProceso} tono="neutro">
                      {a.nombre}
                    </TipoBadge>
                  ))}
                </ul>
              )}
            </SeccionDetalle>

            <SeccionDetalle titulo="Checklist">
              <EditorChecklistProceso proceso={p} puedeAdministrar={puedeAdministrar} />
            </SeccionDetalle>

            <Historial creadoEn={p.creadoEn} modificadoEn={p.modificadoEn} />
          </>
        )}
      />

      <DialogoProcesoRc
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        proceso={enEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) setADesactivar(null);
        }}
        titulo="Desactivar proceso"
        descripcion={
          <>
            ¿Seguro que quieres desactivar el proceso{' '}
            <span className="font-medium text-foreground">{aDesactivar?.nombre}</span>? Podrás
            volver a activarlo después.
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
