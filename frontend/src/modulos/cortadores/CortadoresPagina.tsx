import { Phone, Scissors, Tag } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useCortadores, useDesactivarCortador, useReactivarCortador } from '@/api/cortadores';
import type { Cortador, CortadoresQuery } from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { Avatar } from '@/components/dominio/visuales';
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

import { DialogoCortador } from './DialogoCortador';

/** Renglones por pagina del listado. */
const POR_PAGINA = 10;

/** Formato del precio de referencia (pesos mexicanos). */
const FORMATO_MONEDA = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
});

/**
 * Pantalla de Cortadores — CRUD del catalogo de cortadores (talleres de corte)
 * sobre el motor LISTA + DETALLE (rediseño "Teal fresco"). Lista con busqueda
 * (debounce), paginacion de servidor y toggle de inactivos; el detalle muestra el
 * precio de referencia y los teléfonos, y permite editar / desactivar / reactivar.
 * Borrado suave reversible; toasts; consciente de permisos. `cortadores.ver`
 * gobierna el acceso; `cortadores.administrar` decide las acciones. El backend decide (A1).
 */
export function CortadoresPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('cortadores.administrar');

  // ── Estado de la vista ─────────────────────────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);

  const query: CortadoresQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  };

  const consulta = useCortadores(query);
  const desactivar = useDesactivarCortador();
  const reactivar = useReactivarCortador();

  // ── Dialogos ───────────────────────────────────────────────────────────────
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [cortadorEnEdicion, setCortadorEnEdicion] = useState<Cortador | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<Cortador | null>(null);

  function abrirAlta(): void {
    setCortadorEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(cortador: Cortador): void {
    setCortadorEnEdicion(cortador);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Cortador "${objetivo.nombre}" desactivado.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  // Reactivar es NO destructivo: se aplica directo, sin dialogo de confirmacion.
  function reactivarCortador(cortador: Cortador): void {
    reactivar.mutate(cortador.id, {
      onSuccess: () => toast.success(`Cortador "${cortador.nombre}" activado.`),
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
      <ListaDetalle<Cortador>
        testid="cortador"
        titulo="Cortadores"
        descripcion="Talleres de corte y su precio de referencia."
        icono={Scissors}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(c) => c.id}
        obtenerTitulo={(c) => c.nombre}
        obtenerActivo={(c) => c.activo}
        obtenerSecundaria={(c) => c.telefonos ?? undefined}
        renderAvatarLista={(c) => (
          <Avatar nombre={c.nombre} tono="neutro" tamano="sm">
            <Scissors className="size-4" aria-hidden />
          </Avatar>
        )}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={alAlternarInactivos}
        textoVacio="No hay cortadores que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nuevo cortador"
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={reactivarCortador}
        renderAvatarDetalle={(c) => (
          <Avatar nombre={c.nombre} tono="neutro" tamano="lg">
            <Scissors className="size-7" aria-hidden />
          </Avatar>
        )}
        renderDetalle={(c) => (
          <>
            <SeccionDetalle titulo="Datos del cortador">
              <RejillaCampos>
                <CampoDetalle icono={Tag} etiqueta="Precio de referencia">
                  {c.precioReferencia === null ? (
                    <ValorVacio />
                  ) : (
                    <span className="tabular-nums">
                      {FORMATO_MONEDA.format(c.precioReferencia)}
                    </span>
                  )}
                </CampoDetalle>
                <CampoDetalle icono={Phone} etiqueta="Teléfonos">
                  {c.telefonos ?? <ValorVacio />}
                </CampoDetalle>
              </RejillaCampos>
            </SeccionDetalle>
            <Historial creadoEn={c.creadoEn} modificadoEn={c.modificadoEn} />
          </>
        )}
      />

      {/* Dialogos */}
      <DialogoCortador
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        cortador={cortadorEnEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar cortador"
        descripcion={
          <>
            ¿Seguro que quieres desactivar el cortador{' '}
            <span className="font-medium text-foreground">{aDesactivar?.nombre}</span>? Podrás
            volver a activarlo después; su historial se conserva.
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
