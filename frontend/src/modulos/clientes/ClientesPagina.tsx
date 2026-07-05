import { Building2, Contact, ListChecks, Mail, MapPin, Phone, UserRound } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useClientes, useDesactivarCliente, useReactivarCliente } from '@/api/clientes';
import type { Cliente, ClientesQuery } from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { Avatar } from '@/components/dominio/visuales';
import { useDebounce } from '@/lib/useDebounce';
import { ListaDetalle, type PaginacionListaDetalle } from '@/modulos/ListaDetalle';
import { CampoDetalle, Historial, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoCliente } from './DialogoCliente';
import { EditorCamposCliente } from './EditorCamposCliente';
import { EditorDepartamentosCliente } from './EditorDepartamentosCliente';

/** Renglones por pagina del listado. */
const POR_PAGINA = 10;

/** ¿La cadena tiene contenido real (no null ni vacía)? */
function hayTexto(valor: string | null): valor is string {
  return valor !== null && valor.trim() !== '';
}

/**
 * Campo de DETALLE que solo se pinta si hay texto (no null/vacío): el panel no se llena
 * de campos de contacto sin capturar.
 */
function CampoTextoSiHay({
  icono,
  etiqueta,
  valor,
  anchoCompleto = false,
}: {
  icono: typeof Mail;
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
 * Pantalla de Clientes (F1-E2, D7) — CRUD del catálogo sobre el motor LISTA + DETALLE
 * (rediseño "Teal fresco"). Lista con búsqueda (debounce), paginación de servidor y
 * toggle de inactivos; el detalle muestra el contacto del cliente y, sobre todo, sus
 * CAMPOS DE REFERENCIA (D7), que se administran inline con `EditorCamposCliente`.
 * Borrado suave reversible (desactivar con confirmación, reactivar directo); toasts;
 * consciente de permisos.
 *
 * `clientes.ver` gobierna el acceso a la pantalla; `clientes.administrar` decide las
 * acciones de escritura. La decisión real la toma el backend (A1).
 */
export function ClientesPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('clientes.administrar');

  // ── Estado de la vista ─────────────────────────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);

  const query: ClientesQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  };

  const consulta = useClientes(query);
  const desactivar = useDesactivarCliente();
  const reactivar = useReactivarCliente();

  // ── Dialogos ───────────────────────────────────────────────────────────────
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [clienteEnEdicion, setClienteEnEdicion] = useState<Cliente | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<Cliente | null>(null);

  function abrirAlta(): void {
    setClienteEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(cliente: Cliente): void {
    setClienteEnEdicion(cliente);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Cliente "${objetivo.nombre}" desactivado.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  // Reactivar es NO destructivo: se aplica directo, sin diálogo de confirmación.
  function reactivarCliente(cliente: Cliente): void {
    reactivar.mutate(cliente.id, {
      onSuccess: () => toast.success(`Cliente "${cliente.nombre}" activado.`),
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
      <ListaDetalle<Cliente>
        testid="cliente"
        titulo="Clientes"
        descripcion="Clientes y sus campos de referencia (D7)."
        icono={Contact}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(c) => c.id}
        obtenerTitulo={(c) => c.nombre}
        obtenerActivo={(c) => c.activo}
        obtenerSecundaria={(c) => c.contacto ?? '—'}
        renderAvatarLista={(c) => <Avatar nombre={c.nombre} tono="neutro" tamano="sm" />}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={alAlternarInactivos}
        textoVacio="No hay clientes que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nuevo cliente"
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={reactivarCliente}
        renderAvatarDetalle={(c) => <Avatar nombre={c.nombre} tono="neutro" tamano="lg" />}
        renderDetalle={(c) => <DetalleCliente cliente={c} puedeAdministrar={puedeAdministrar} />}
      />

      {/* Dialogos */}
      <DialogoCliente
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        cliente={clienteEnEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar cliente"
        descripcion={
          <>
            ¿Seguro que quieres desactivar el cliente{' '}
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

/**
 * Panel de DETALLE de un cliente: sus datos de contacto (solo los capturados) y la
 * sección "Campos de referencia" (D7) con el editor inline. El editor solo se monta si
 * el cliente está ACTIVO y el usuario puede administrar; si no, se muestran los campos
 * en modo lectura (o un aviso). El editor mismo necesita el id del cliente.
 */
function DetalleCliente({
  cliente,
  puedeAdministrar,
}: {
  cliente: Cliente;
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const hayContacto =
    hayTexto(cliente.contacto) ||
    hayTexto(cliente.telefono) ||
    hayTexto(cliente.email) ||
    hayTexto(cliente.direccion);

  return (
    <>
      {hayContacto ? (
        <SeccionDetalle titulo="Datos de contacto" icono={Contact}>
          <RejillaCampos>
            <CampoTextoSiHay icono={UserRound} etiqueta="Contacto" valor={cliente.contacto} />
            <CampoTextoSiHay icono={Phone} etiqueta="Teléfono" valor={cliente.telefono} />
            <CampoTextoSiHay icono={Mail} etiqueta="Email" valor={cliente.email} />
            <CampoTextoSiHay
              icono={MapPin}
              etiqueta="Dirección"
              valor={cliente.direccion}
              anchoCompleto
            />
          </RejillaCampos>
        </SeccionDetalle>
      ) : null}

      <SeccionDetalle titulo="Campos de referencia (D7)" icono={ListChecks}>
        {puedeAdministrar && cliente.activo ? (
          <EditorCamposCliente idCliente={cliente.id} />
        ) : (
          <CamposSoloLectura cliente={cliente} />
        )}
      </SeccionDetalle>

      <SeccionDetalle titulo="Departamentos (D13/R16)" icono={Building2}>
        {/* Los departamentos no van embebidos en el cliente: el editor los lista siempre
            (solo lectura sin permiso o cliente inactivo) y habilita el CRUD para administrar. */}
        <EditorDepartamentosCliente
          idCliente={cliente.id}
          deshabilitado={!puedeAdministrar || !cliente.activo}
        />
      </SeccionDetalle>

      <Historial creadoEn={cliente.creadoEn} modificadoEn={cliente.modificadoEn} />
    </>
  );
}

/**
 * Vista de SOLO LECTURA de los campos de referencia (cuando no se puede editar: sin
 * permiso de administrar, o el cliente está desactivado). Lista los campos activos que
 * trae el cliente embebidos; sin acciones.
 */
function CamposSoloLectura({ cliente }: { cliente: Cliente }): React.JSX.Element {
  const activos = cliente.campos.filter((campo) => campo.activo);
  if (activos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Este cliente no tiene campos de referencia.</p>
    );
  }
  return (
    <ul className="space-y-1.5" data-testid="campos-solo-lectura">
      {activos.map((campo) => (
        <li key={campo.id} className="text-sm">
          <span className="font-medium">{campo.etiqueta}</span>
          <span className="text-muted-foreground"> · {campo.tipo}</span>
        </li>
      ))}
    </ul>
  );
}
