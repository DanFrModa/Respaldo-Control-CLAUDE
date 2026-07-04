import { Medal, Tag } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useDesactivarPlanAql, usePlanesAql, useReactivarPlanAql } from '@/api/calidad';
import type { PlanAql, PlanesAqlQuery } from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { Avatar } from '@/components/dominio/visuales';
import { Badge } from '@/components/ui/badge';
import { useDebounce } from '@/lib/useDebounce';
import { ListaDetalle, type PaginacionListaDetalle } from '@/modulos/ListaDetalle';
import { CampoDetalle, Historial, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoPlanAql } from './DialogoPlanAql';

const POR_PAGINA = 10;

/**
 * Pantalla de Planes AQL — CRUD con renglones (patron ListaDetalle + useFieldArray
 * en el dialogo). `calidad.ver` gobierna el acceso; `calidad.administrar-catalogo`
 * las acciones de escritura (A1).
 */
export function PlanesAqlPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('calidad.administrar-catalogo');

  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);

  const query: PlanesAqlQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  };

  const consulta = usePlanesAql(query);
  const desactivar = useDesactivarPlanAql();
  const reactivar = useReactivarPlanAql();

  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [planEnEdicion, setPlanEnEdicion] = useState<PlanAql | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<PlanAql | null>(null);

  function abrirAlta(): void {
    setPlanEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(plan: PlanAql): void {
    setPlanEnEdicion(plan);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) return;
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Plan "${objetivo.nombre}" desactivado.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  function reactivarPlan(plan: PlanAql): void {
    reactivar.mutate(plan.id, {
      onSuccess: () => toast.success(`Plan "${plan.nombre}" activado.`),
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
      <ListaDetalle<PlanAql>
        testid="plan-aql"
        titulo="Planes AQL"
        descripcion="Tablas de muestreo AQL: rangos de lote, tamaño de muestra y límites Ac/Re."
        icono={Medal}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(p) => p.id}
        obtenerTitulo={(p) => p.nombre}
        obtenerActivo={(p) => p.activo}
        obtenerSecundaria={(p) => `${p.renglones.length} renglon(es)`}
        renderAvatarLista={(p) => (
          <Avatar nombre={p.nombre} tono="telas" tamano="sm">
            <Medal className="size-4" aria-hidden />
          </Avatar>
        )}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={alAlternarInactivos}
        textoVacio="No hay planes AQL que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nuevo plan"
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={reactivarPlan}
        renderAvatarDetalle={(p) => (
          <Avatar nombre={p.nombre} tono="telas" tamano="lg">
            <Medal className="size-7" aria-hidden />
          </Avatar>
        )}
        renderDetalle={(p) => (
          <>
            <SeccionDetalle titulo="Datos del plan">
              <RejillaCampos>
                <CampoDetalle icono={Tag} etiqueta="Renglones">
                  {p.renglones.length}
                </CampoDetalle>
              </RejillaCampos>
            </SeccionDetalle>
            {p.renglones.length > 0 && (
              <SeccionDetalle titulo="Tabla de renglones">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="pb-1 pr-3 text-left font-medium">Lote mín.</th>
                        <th className="pb-1 pr-3 text-left font-medium">Lote máx.</th>
                        <th className="pb-1 pr-3 text-left font-medium">Muestra</th>
                        <th className="pb-1 text-left font-medium">Límites (Ac/Re)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.renglones.map((r) => (
                        <tr key={r.id} className="border-b last:border-0">
                          <td className="py-1 pr-3">{r.loteMin}</td>
                          <td className="py-1 pr-3">{r.loteMax ?? '∞'}</td>
                          <td className="py-1 pr-3">{r.tamanoMuestra}</td>
                          <td className="py-1">
                            <span className="flex flex-wrap gap-1">
                              {r.limites.map((l) => (
                                <Badge key={l.nivelAQL} variant="secondary" className="text-xs">
                                  AQL {l.nivelAQL}: {l.aceptar}/{l.rechazar}
                                </Badge>
                              ))}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SeccionDetalle>
            )}
            <Historial creadoEn={p.creadoEn} modificadoEn={p.modificadoEn} />
          </>
        )}
      />

      <DialogoPlanAql
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        plan={planEnEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) setADesactivar(null);
        }}
        titulo="Desactivar plan AQL"
        descripcion={
          <>
            ¿Seguro que quieres desactivar el plan{' '}
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
