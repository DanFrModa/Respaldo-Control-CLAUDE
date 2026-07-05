import { Coins, Hash, Lock, PencilIcon, PowerIcon, PowerOffIcon, Tag } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useConceptosCosto,
  useDesactivarConceptoCosto,
  useReactivarConceptoCosto,
  type ConceptoCosto,
  type ConceptosCostoQuery,
} from '@/api/conceptos-costo';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { Avatar, TipoBadge } from '@/components/dominio/visuales';
import { Button } from '@/components/ui/button';
import { useDebounce } from '@/lib/useDebounce';
import { ListaDetalle, type PaginacionListaDetalle } from '@/modulos/ListaDetalle';
import { CampoDetalle, Historial, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoConceptoCosto } from './DialogoConceptoCosto';

/** Renglones por página del listado. */
const POR_PAGINA = 10;

/**
 * Pantalla de Conceptos de costo (F8-E1, Administración) — CRUD del catálogo GLOBAL de conceptos
 * del pre-costeo (además de los fijos tela/avíos/maquila) sobre el motor LISTA + DETALLE. Sigue el
 * molde de "Tipos de proceso": lista buscable/paginada, alta/edición por diálogo, borrado suave.
 *
 * Es ADMIN-ONLY: `concepto-costo.ver` gobierna el acceso y `concepto-costo.administrar` las
 * escrituras (el backend es la autoridad, A1). Los conceptos con bandera `fijo` NO se pueden
 * desactivar (el backend lo rechaza): la UI oculta su botón Desactivar y lo marca como "Fijo".
 */
export function ConceptosCostoPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('concepto-costo.administrar');

  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);

  const query: ConceptosCostoQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'orden',
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  };

  const consulta = useConceptosCosto(query);
  const desactivar = useDesactivarConceptoCosto();
  const reactivar = useReactivarConceptoCosto();

  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [enEdicion, setEnEdicion] = useState<ConceptoCosto | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<ConceptoCosto | null>(null);

  function abrirAlta(): void {
    setEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(concepto: ConceptoCosto): void {
    setEnEdicion(concepto);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Concepto de costo "${objetivo.nombre}" desactivado.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  function reactivarConcepto(concepto: ConceptoCosto): void {
    reactivar.mutate(concepto.id, {
      onSuccess: () => toast.success(`Concepto de costo "${concepto.nombre}" activado.`),
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
      <ListaDetalle<ConceptoCosto>
        testid="concepto-costo"
        titulo="Conceptos de costo"
        descripcion="Catálogo global de conceptos del pre-costeo. Los fijos (tela, avíos, maquila) no se pueden desactivar."
        icono={Coins}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(c) => c.id}
        obtenerTitulo={(c) => c.nombre}
        obtenerActivo={(c) => c.activo}
        obtenerSecundaria={(c) => c.codigo}
        renderAvatarLista={(c) => (
          <Avatar nombre={c.nombre} tono="servicios" tamano="sm">
            <Coins className="size-4" aria-hidden />
          </Avatar>
        )}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={alAlternarInactivos}
        textoVacio="No hay conceptos de costo que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nuevo concepto"
        // El CRUD de fijos es especial (no desactivables): se ocultan las acciones base y se
        // arman a la medida en `accionesExtra`.
        ocultarAccionesBase
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={reactivarConcepto}
        accionesExtra={(c) => (
          <AccionesConcepto
            concepto={c}
            alEditar={abrirEdicion}
            alDesactivar={setADesactivar}
            alReactivar={reactivarConcepto}
          />
        )}
        renderAvatarDetalle={(c) => (
          <Avatar nombre={c.nombre} tono="servicios" tamano="lg">
            <Coins className="size-7" aria-hidden />
          </Avatar>
        )}
        renderMeta={(c) =>
          c.fijo ? (
            <TipoBadge tono="pt">Fijo</TipoBadge>
          ) : (
            <TipoBadge tono="neutro">Abierto</TipoBadge>
          )
        }
        renderDetalle={(c) => (
          <>
            <SeccionDetalle titulo="Datos del concepto">
              <RejillaCampos>
                <CampoDetalle icono={Tag} etiqueta="Código">
                  {c.codigo}
                </CampoDetalle>
                <CampoDetalle icono={Hash} etiqueta="Orden">
                  {c.orden}
                </CampoDetalle>
                <CampoDetalle icono={Lock} etiqueta="¿Fijo?">
                  {c.fijo ? 'Sí (no se puede desactivar)' : 'No'}
                </CampoDetalle>
              </RejillaCampos>
            </SeccionDetalle>
            <Historial creadoEn={c.creadoEn} modificadoEn={c.modificadoEn} />
          </>
        )}
      />

      <DialogoConceptoCosto
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        concepto={enEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar concepto de costo"
        descripcion={
          <>
            ¿Seguro que quieres desactivar el concepto{' '}
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

/**
 * Acciones del hero de un concepto (Editar + Desactivar/Activar). Un concepto `fijo` NO se puede
 * desactivar (el backend lo rechaza): su botón Desactivar se muestra deshabilitado con la razón.
 */
function AccionesConcepto({
  concepto,
  alEditar,
  alDesactivar,
  alReactivar,
}: {
  concepto: ConceptoCosto;
  alEditar: (c: ConceptoCosto) => void;
  alDesactivar: (c: ConceptoCosto) => void;
  alReactivar: (c: ConceptoCosto) => void;
}): React.JSX.Element {
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => alEditar(concepto)}
        data-testid="editar-concepto-costo"
      >
        <PencilIcon aria-hidden />
        Editar
      </Button>
      {!concepto.activo ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => alReactivar(concepto)}
          data-testid="activar-concepto-costo"
        >
          <PowerIcon aria-hidden />
          Activar
        </Button>
      ) : concepto.fijo ? (
        <Button
          variant="destructive"
          size="sm"
          disabled
          title="Los conceptos fijos (tela/avíos/maquila) no se pueden desactivar."
          data-testid="desactivar-concepto-costo"
        >
          <PowerOffIcon aria-hidden />
          Desactivar
        </Button>
      ) : (
        <Button
          variant="destructive"
          size="sm"
          onClick={() => alDesactivar(concepto)}
          data-testid="desactivar-concepto-costo"
        >
          <PowerOffIcon aria-hidden />
          Desactivar
        </Button>
      )}
    </>
  );
}
