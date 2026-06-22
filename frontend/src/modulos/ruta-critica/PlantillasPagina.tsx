import { ListChecks, Route } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useDesactivarPlantillaRc,
  usePlantillasRc,
  useActualizarPlantillaRc,
} from '@/api/ruta-critica-plantillas';
import type { PlantillaRc } from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { Avatar, TipoBadge } from '@/components/dominio/visuales';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ListaDetalle } from '@/modulos/ListaDetalle';
import { CampoDetalle, Historial, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoPlantillaRc } from './DialogoPlantillaRc';

/**
 * Pantalla de PLANTILLAS DE RUTA (Módulo 8, F5-E2) — CRUD del catálogo de plantillas sobre el motor
 * LISTA + DETALLE (estándar teal). El detalle muestra los procesos de la plantilla con su tiempo
 * estándar y su encadenamiento PROPIO; la edición (incluida la familia/artículo y el set de
 * procesos) va en el diálogo. El rechazo de ciclos lo hace el backend (mensaje en vivo).
 *
 * `rc.catalogo-ver` gobierna el acceso; `rc.catalogo-administrar` las escrituras.
 */
export function PlantillasPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('rc.catalogo-administrar');

  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const consulta = usePlantillasRc(incluirInactivos);
  const desactivar = useDesactivarPlantillaRc();
  const reactivar = useActualizarPlantillaRc();

  // Filtro local: el catálogo de plantillas es corto (no paginado en servidor).
  const termino = busqueda.trim().toLowerCase();
  const plantillas = (consulta.data ?? []).filter(
    (p) =>
      termino === '' ||
      p.nombre.toLowerCase().includes(termino) ||
      (p.articulo ?? '').toLowerCase().includes(termino) ||
      (p.familia ?? '').toLowerCase().includes(termino),
  );

  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [enEdicion, setEnEdicion] = useState<PlantillaRc | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<PlantillaRc | null>(null);

  function abrirAlta(): void {
    setEnEdicion(undefined);
    setDialogoAbierto(true);
  }
  function abrirEdicion(plantilla: PlantillaRc): void {
    setEnEdicion(plantilla);
    setDialogoAbierto(true);
  }
  function confirmarDesactivar(): void {
    if (aDesactivar === null) return;
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Plantilla "${objetivo.nombre}" desactivada.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  return (
    <>
      <ListaDetalle<PlantillaRc>
        testid="plantilla-rc"
        titulo="Plantillas de ruta"
        descripcion="Qué procesos lleva cada artículo/familia, su tiempo estándar y su encadenamiento. El motor de fechas las usará en etapas posteriores."
        icono={Route}
        registros={plantillas}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(p) => p.id}
        obtenerTitulo={(p) => p.nombre}
        obtenerActivo={(p) => p.activo}
        obtenerSecundaria={(p) => p.articulo ?? p.familia ?? 'Todas las familias'}
        busqueda={busqueda}
        alBuscar={setBusqueda}
        renderAvatarLista={(p) => (
          <Avatar nombre={p.nombre} tono="servicios" tamano="sm">
            <Route className="size-4" aria-hidden />
          </Avatar>
        )}
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={() => setIncluirInactivos((v) => !v)}
        textoVacio="No hay plantillas de ruta."
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nueva plantilla"
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={(p) =>
          reactivar.mutate(
            { id: p.id, cuerpo: { activo: true } },
            {
              onSuccess: () => toast.success(`Plantilla "${p.nombre}" activada.`),
              onError: (error) => toast.error(error.message),
            },
          )
        }
        renderAvatarDetalle={(p) => (
          <Avatar nombre={p.nombre} tono="servicios" tamano="lg">
            <Route className="size-7" aria-hidden />
          </Avatar>
        )}
        renderMeta={(p) => (
          <div className="flex flex-wrap gap-1.5">
            {p.articulo ? <TipoBadge tono="pt">{p.articulo}</TipoBadge> : null}
            {p.familia ? <TipoBadge tono="avios">{p.familia}</TipoBadge> : null}
            <TipoBadge tono="neutro">{p.procesos.length} procesos</TipoBadge>
          </div>
        )}
        renderDetalle={(p) => (
          <>
            <SeccionDetalle titulo="A qué aplica">
              <RejillaCampos>
                <CampoDetalle icono={Route} etiqueta="Familia">
                  {p.familia ?? '—'}
                </CampoDetalle>
                <CampoDetalle icono={ListChecks} etiqueta="Artículo">
                  {p.articulo ?? '—'}
                </CampoDetalle>
              </RejillaCampos>
            </SeccionDetalle>

            <SeccionDetalle titulo="Procesos y encadenamiento">
              {p.procesos.length === 0 ? (
                <p className="text-sm text-muted-foreground">La plantilla aún no tiene procesos.</p>
              ) : (
                <Table data-testid="tabla-procesos-plantilla">
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Proceso</TableHead>
                      <TableHead>Días</TableHead>
                      <TableHead>Antecesores</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {p.procesos.map((r) => {
                      const nombresAntecesores = r.idsAntecesores
                        .map(
                          (id) =>
                            p.procesos.find((x) => x.idProcesoDef === id)?.nombreProceso ?? '',
                        )
                        .filter((x) => x !== '');
                      return (
                        <TableRow key={r.id}>
                          <TableCell>{r.orden + 1}</TableCell>
                          <TableCell>{r.nombreProceso}</TableCell>
                          <TableCell>{r.tiempoEstandar}</TableCell>
                          <TableCell>
                            {nombresAntecesores.length === 0 ? '—' : nombresAntecesores.join(', ')}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </SeccionDetalle>

            <Historial creadoEn={p.creadoEn} modificadoEn={p.modificadoEn} />
          </>
        )}
      />

      <DialogoPlantillaRc
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        plantilla={enEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) setADesactivar(null);
        }}
        titulo="Desactivar plantilla"
        descripcion={
          <>
            ¿Seguro que quieres desactivar la plantilla{' '}
            <span className="font-medium text-foreground">{aDesactivar?.nombre}</span>? Podrás
            volver a activarla después.
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
