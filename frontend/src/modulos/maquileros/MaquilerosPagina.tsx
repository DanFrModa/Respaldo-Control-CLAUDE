import {
  Factory,
  MapPin,
  Phone,
  ShieldCheck,
  StickyNote,
  User,
  Wallet,
  Wrench,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useDesactivarMaquilero,
  useMaquileros,
  useReactivarMaquilero,
  useTiposProceso,
} from '@/api/maquileros';
import type { Maquilero, MaquilerosQuery } from '@/api/tipos';
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

import { DialogoMaquilero } from './DialogoMaquilero';

/** Renglones por pagina del listado. */
const POR_PAGINA = 10;

/** Valor del filtro de tipo de proceso que significa "todos" (sin filtrar). */
const TIPO_TODOS = 'TODOS';

/** ¿La cadena tiene contenido real (no null ni vacía)? */
function hayTexto(valor: string | null): valor is string {
  return valor !== null && valor.trim() !== '';
}

/** Nombre completo (corto + nombre + apellidos) para el avatar y la búsqueda visual. */
function nombreCompleto(m: Maquilero): string {
  return hayTexto(m.apellidos) ? `${m.nombre} ${m.apellidos}` : m.nombre;
}

/**
 * Campo de DETALLE que solo se pinta si hay texto (no null/vacío). Evita llenar el panel
 * de campos vacíos: los datos sin capturar simplemente no aparecen (M2).
 */
function CampoTextoSiHay({
  icono,
  etiqueta,
  valor,
  anchoCompleto = false,
}: {
  icono: typeof Phone;
  etiqueta: string;
  valor: string | null;
  anchoCompleto?: boolean;
}): React.JSX.Element | null {
  if (!hayTexto(valor)) {
    return null;
  }
  return (
    <CampoDetalle icono={icono} etiqueta={etiqueta} anchoCompleto={anchoCompleto}>
      {valor}
    </CampoDetalle>
  );
}

/**
 * Pantalla de Maquileros — CRUD del catálogo (maquila unificada, F1-E2) sobre el motor
 * LISTA + DETALLE (rediseño "Teal fresco"). Lista con búsqueda (debounce), **filtro por
 * tipo de proceso**, paginación de servidor y toggle de inactivos; el detalle muestra los
 * datos del maquilero y sus capacidades (tipos), y permite editar / desactivar /
 * reactivar. Borrado suave reversible (desactivar con confirmación, reactivar directo);
 * toasts; consciente de permisos.
 *
 * `maquileros.ver` gobierna el acceso a la pantalla; `maquileros.administrar` decide las
 * acciones de escritura. La decisión real la toma el backend (A1).
 */
export function MaquilerosPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('maquileros.administrar');

  // ── Estado de la vista ─────────────────────────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  // Filtro por tipo de proceso: id como texto del `<select>` ("TODOS" = sin filtrar).
  const [tipoFiltro, setTipoFiltro] = useState<string>(TIPO_TODOS);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);

  const tiposCatalogo = useTiposProceso();

  const query: MaquilerosQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'corto',
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(tipoFiltro !== TIPO_TODOS ? { tipoProceso: Number(tipoFiltro) } : {}),
  };

  const consulta = useMaquileros(query);
  const desactivar = useDesactivarMaquilero();
  const reactivar = useReactivarMaquilero();

  // ── Dialogos ───────────────────────────────────────────────────────────────
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [maquileroEnEdicion, setMaquileroEnEdicion] = useState<Maquilero | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<Maquilero | null>(null);

  function abrirAlta(): void {
    setMaquileroEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(maquilero: Maquilero): void {
    setMaquileroEnEdicion(maquilero);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Maquilero "${objetivo.corto}" desactivado.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  // Reactivar es NO destructivo: se aplica directo, sin dialogo de confirmacion.
  function reactivarMaquilero(maquilero: Maquilero): void {
    reactivar.mutate(maquilero.id, {
      onSuccess: () => toast.success(`Maquilero "${maquilero.corto}" activado.`),
      onError: (error) => toast.error(error.message),
    });
  }

  // Cambiar busqueda, tipo o el filtro de inactivos reinicia a la pagina 1.
  function alBuscar(valor: string): void {
    setTextoBusqueda(valor);
    setPagina(1);
  }

  function alCambiarTipo(valor: string): void {
    setTipoFiltro(valor);
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
      <ListaDetalle<Maquilero>
        testid="maquilero"
        titulo="Maquileros"
        descripcion="Talleres de costura y estampado (maquila unificada)."
        icono={Factory}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(m) => m.id}
        obtenerTitulo={(m) => m.corto}
        obtenerActivo={(m) => m.activo}
        obtenerSecundaria={(m) => nombreCompleto(m)}
        renderAvatarLista={(m) => <Avatar nombre={m.corto} tono="servicios" tamano="sm" />}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        filtros={
          <SelectNativo
            value={tipoFiltro}
            onChange={(e) => alCambiarTipo(e.target.value)}
            aria-label="Filtrar maquileros por tipo de proceso"
            data-testid="filtro-tipo-proceso"
            disabled={tiposCatalogo.isPending || tiposCatalogo.isError}
          >
            <option value={TIPO_TODOS}>Todos los procesos</option>
            {(tiposCatalogo.data ?? []).map((tipo) => (
              <option key={tipo.id} value={String(tipo.id)}>
                {tipo.nombre}
              </option>
            ))}
          </SelectNativo>
        }
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={alAlternarInactivos}
        textoVacio="No hay maquileros que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nuevo maquilero"
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={reactivarMaquilero}
        renderAvatarDetalle={(m) => <Avatar nombre={m.corto} tono="servicios" tamano="lg" />}
        renderMeta={(m) => (
          <span className="flex flex-wrap gap-1.5">
            {m.tipos.map((tipo) => (
              <TipoBadge key={tipo.id} tono="servicios">
                {tipo.nombre}
              </TipoBadge>
            ))}
          </span>
        )}
        renderDetalle={(m) => <DetalleMaquilero m={m} />}
      />

      {/* Dialogos */}
      <DialogoMaquilero
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        maquilero={maquileroEnEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar maquilero"
        descripcion={
          <>
            ¿Seguro que quieres desactivar el maquilero{' '}
            <span className="font-medium text-foreground">{aDesactivar?.corto}</span>? Podrás volver
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
 * Panel de DETALLE de un maquilero (M2): muestra sus datos y sus capacidades (tipos de
 * proceso) como chips. Cada campo de texto solo se pinta si tiene dato (no se llena de
 * vacíos). La sección General siempre se muestra (corto/nombre/tipos existen). Usa las
 * piezas de `@/modulos/detalle` para verse igual que el resto.
 */
function DetalleMaquilero({ m }: { m: Maquilero }): React.JSX.Element {
  return (
    <>
      {/* ── General (siempre: corto/nombre/tipos existen) ────────────────────── */}
      <SeccionDetalle titulo="Datos del maquilero" icono={Factory}>
        <RejillaCampos>
          <CampoDetalle icono={User} etiqueta="Nombre">
            {nombreCompleto(m)}
          </CampoDetalle>
          <CampoTextoSiHay icono={Phone} etiqueta="Teléfonos" valor={m.telefonos} />
          <CampoTextoSiHay icono={MapPin} etiqueta="Dirección" valor={m.direccion} anchoCompleto />
          <CampoDetalle icono={ShieldCheck} etiqueta="¿Asegurado?">
            {m.asegurado ? 'Sí' : 'No'}
          </CampoDetalle>
          <CampoDetalle icono={Wrench} etiqueta="Tipos de proceso" anchoCompleto>
            {m.tipos.length > 0 ? (
              <span className="flex flex-wrap gap-1.5" data-testid="tipos-maquilero-detalle">
                {m.tipos.map((tipo) => (
                  <TipoBadge key={tipo.id} tono="servicios">
                    {tipo.nombre}
                  </TipoBadge>
                ))}
              </span>
            ) : (
              <ValorVacio />
            )}
          </CampoDetalle>
        </RejillaCampos>
      </SeccionDetalle>

      {/* ── Observaciones (solo si hay algo) ─────────────────────────────────── */}
      {hayTexto(m.observaciones) || hayTexto(m.obsPago) ? (
        <SeccionDetalle titulo="Observaciones" icono={StickyNote}>
          <RejillaCampos>
            <CampoTextoSiHay
              icono={StickyNote}
              etiqueta="Observaciones"
              valor={m.observaciones}
              anchoCompleto
            />
            <CampoTextoSiHay
              icono={Wallet}
              etiqueta="Observaciones de pago"
              valor={m.obsPago}
              anchoCompleto
            />
          </RejillaCampos>
        </SeccionDetalle>
      ) : null}

      <Historial creadoEn={m.creadoEn} modificadoEn={m.modificadoEn} />
    </>
  );
}
