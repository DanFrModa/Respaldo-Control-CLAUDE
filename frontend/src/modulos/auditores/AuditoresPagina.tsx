import { useState } from 'react';
import { toast } from 'sonner';

import { useAuditores, useDesactivarAuditor, useReactivarAuditor } from '@/api/auditores';
import type { RolAuditorClave } from '@/api/esquemas';
import type { Auditor, AuditoresQuery } from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { TipoBadge } from '@/components/dominio/visuales';
import type { Tono } from '@/lib/tono';
import { useDebounce } from '@/lib/useDebounce';
import {
  TablaCatalogo,
  type ColumnaCatalogo,
  type PaginacionCatalogo,
} from '@/modulos/TablaCatalogo';
import { useSesion } from '@/sesion/useSesion';

import { DialogoAuditor } from './DialogoAuditor';

/** Renglones por página del listado. */
const POR_PAGINA = 10;

/** Tono explicativo (color del avatar/chip) por rol: el senior destaca en verde de marca. */
const TONO_POR_ROL: Record<RolAuditorClave, Tono> = {
  'Sr. Auditor': 'pt',
  Auditor: 'neutro',
};

/**
 * Pantalla de Auditores (catálogo de Calidad, rediseño R9 — proto `CAT_AUDITORES`): tabla densa con
 * el auditor, su rol (badge), su nivel AQL de certificación y el CONTEO de
 * auditorías (derivado del histórico, solo lectura), con acciones inline (editar/desactivar/activar).
 * Borrado suave reversible; consciente de permisos: `calidad.ver` gobierna el acceso y
 * `calidad.administrar-catalogo` decide las acciones (A1).
 */
export function AuditoresPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('calidad.administrar-catalogo');

  // ── Estado de la vista ─────────────────────────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);

  const query: AuditoresQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  };

  const consulta = useAuditores(query);
  const desactivar = useDesactivarAuditor();
  const reactivar = useReactivarAuditor();

  // ── Diálogos ───────────────────────────────────────────────────────────────
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [auditorEnEdicion, setAuditorEnEdicion] = useState<Auditor | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<Auditor | null>(null);

  function abrirAlta(): void {
    setAuditorEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(auditor: Auditor): void {
    setAuditorEnEdicion(auditor);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Auditor "${objetivo.nombre}" desactivado.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  // Reactivar es NO destructivo: se aplica directo, sin diálogo de confirmación.
  function reactivarAuditor(auditor: Auditor): void {
    reactivar.mutate(auditor.id, {
      onSuccess: () => toast.success(`Auditor "${auditor.nombre}" activado.`),
      onError: (error) => toast.error(error.message),
    });
  }

  // Cambiar búsqueda o el filtro de inactivos reinicia a la página 1.
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

  // Proto `CAT_AUDITORES`: renglón plano (sin thumb) — nombre en `cell-strong` + badge de rol.
  const columnas: ColumnaCatalogo<Auditor>[] = [
    {
      encabezado: 'Auditor',
      render: (a) => <span className="font-semibold">{a.nombre}</span>,
    },
    {
      encabezado: 'Rol',
      render: (a) => <TipoBadge tono={TONO_POR_ROL[a.rol]}>{a.rol}</TipoBadge>,
    },
    {
      encabezado: 'Nivel AQL',
      render: (a) => <span className="num">{a.nivelAql}</span>,
    },
    {
      encabezado: 'Auditorías',
      numerica: true,
      render: (a) => <span className="num">{a.numeroAuditorias.toLocaleString('es-MX')}</span>,
    },
  ];

  return (
    <>
      <TablaCatalogo<Auditor>
        testid="auditor"
        titulo="Auditores"
        descripcion="Control de calidad · auditores AQL"
        unidad="auditores"
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(a) => a.id}
        obtenerActivo={(a) => a.activo}
        columnas={columnas}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={alAlternarInactivos}
        textoVacio="No hay auditores que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nuevo auditor"
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={reactivarAuditor}
      />

      {/* Diálogos */}
      <DialogoAuditor
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        auditor={auditorEnEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar auditor"
        descripcion={
          <>
            ¿Seguro que quieres desactivar al auditor{' '}
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
