import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Contact,
  Info,
  ListChecks,
  Mail,
  MapPin,
  Pencil,
  Percent,
  Phone,
  Plus,
  RotateCcw,
  Trash2,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useCliente, useClientes, useDesactivarCliente, useReactivarCliente } from '@/api/clientes';
import type { Cliente, ClientesQuery } from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { CajonDetalle } from '@/components/dominio/CajonDetalle';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Avatar, EstadoBadge } from '@/components/dominio/visuales';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/lib/useDebounce';
import { CampoDetalle, Historial, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoCliente } from './DialogoCliente';
import { EditorCamposCliente } from './EditorCamposCliente';
import { EditorContactosCliente } from './EditorContactosCliente';
import { EditorDepartamentosCliente } from './EditorDepartamentosCliente';
import { EditorFactoresCliente } from './EditorFactoresCliente';
import { leerDeepLinkFactores, puedeVerFactoresDePrecio } from './factores-precio';

/** Renglones por pagina del listado. */
const POR_PAGINA = 10;

/**
 * Devuelve los renglones a mostrar, inyectando al principio el cliente del DEEP-LINK si su ficha ya
 * cargó y NO está en la página visible (así el cajón puede abrirlo aunque la paginación o la
 * búsqueda lo dejen fuera). Sin deep-link, o si ya está, devuelve la lista tal cual.
 *
 * Copiado del deep-link de Modelos (`conDeepLinkInyectado` en `ModelosPagina`), a propósito: es el
 * mismo problema (listado paginado + cajón que deriva su contenido de la página visible) y merece
 * la misma forma.
 */
function conDeepLinkInyectado(
  visibles: readonly Cliente[],
  fichaDeepLink: Cliente | undefined,
  idAbrir: number | null,
): readonly Cliente[] {
  if (idAbrir === null || fichaDeepLink === undefined || fichaDeepLink.id !== idAbrir) {
    return visibles;
  }
  if (visibles.some((c) => c.id === idAbrir)) {
    return visibles;
  }
  return [fichaDeepLink, ...visibles];
}

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
 * Pantalla de Clientes (F1-E2, D7) — re-vestida R9 a TABLA-FIRST fiel al proto `vClientes`: banner de
 * factores + page-head + toolbar (búsqueda, inactivos) + TABLA DENSA (Cliente · Contacto · Estado) +
 * barra de totales al pie. Al hacer clic en un renglón se abre un CAJÓN de detalle con: contacto,
 * campos de referencia (D7), departamentos (D13/R16) y factores de lista de precios (D13/R20a, con
 * `listas.ver`). Alta/edición vía el diálogo existente; desactivar con confirmación, reactivar directo.
 *
 * FIDELIDAD vs proto: el proto pinta columnas de factores (Margen/Desc./Regalías/C.ventas) y de
 * departamentos/proyectos en la TABLA, pero esos datos NO vienen en el payload de la lista de clientes
 * (los factores viven en el módulo de listas; los departamentos y su conteo son un endpoint aparte) →
 * no se inventan en la tabla; se muestran DENTRO del cajón (donde sí hay endpoint). Hueco reportado.
 *
 * `clientes.ver` gobierna el acceso; `clientes.administrar` decide las acciones (A1).
 */
export function ClientesPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('clientes.administrar');

  // ── Estado de la vista ─────────────────────────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);
  // ⭐ V1-E8t (§Post-F9.145) — DEEP-LINK desde la puerta «Capturar factores» del diálogo de crear
  // lista: `state.idCliente` + `seccion: 'factores'` abre la ficha de ESE cliente con su sección de
  // factores a la vista. Mismo patrón que el deep-link de Modelos (§Post-F9.140).
  const navegar = useNavigate();
  const ubicacion = useLocation();
  const idDeepLink = leerDeepLinkFactores(ubicacion.state);
  // Se guarda en estado local para que sobreviva al `navigate(..., { state: null })` que limpia el
  // historial (si no, un refresh o un "atrás" lo volverían a disparar).
  const [idAbrir, setIdAbrir] = useState<number | null>(idDeepLink);
  // El cajón guarda el ID; el cliente mostrado se DERIVA de la lista viva (estado fresco al
  // activar/desactivar, igual que Proveedores). Arranca en el deep-link.
  const [seleccionId, setSeleccionId] = useState<number | null>(idDeepLink);
  useEffect(() => {
    if (idDeepLink !== null) {
      setIdAbrir(idDeepLink);
      setSeleccionId(idDeepLink);
      // Consume el state para que no se re-aplique al refrescar o al volver.
      void navegar(ubicacion.pathname, { replace: true, state: null });
    }
  }, [idDeepLink, ubicacion.pathname, navegar]);

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

  function reiniciar(): void {
    setPagina(1);
  }

  // Ficha del cliente del deep-link: sirve para SELECCIONARLO aunque la búsqueda/paginación lo
  // dejen fuera de la página visible (hay ~117 clientes y el listado trae 10). Deshabilitada sin
  // deep-link.
  const fichaDeepLink = useCliente(idAbrir ?? undefined);

  const datos = consulta.data;
  const filas = conDeepLinkInyectado(datos?.datos ?? [], fichaDeepLink.data, idAbrir);
  const total = datos?.total ?? 0;
  const totalPaginas = datos?.totalPaginas ?? 1;
  const seleccion = filas.find((c) => c.id === seleccionId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 md:p-5 lg:overflow-visible">
      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">Clientes</h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Catálogo · departamentos propios · factores de lista de precios (heredan a la lista)
          </p>
        </div>
        {puedeAdministrar ? (
          <Button size="sm" onClick={abrirAlta} data-testid="nuevo-cliente">
            <Plus aria-hidden />
            Nuevo cliente
          </Button>
        ) : null}
      </header>

      {/* ── Banner explicativo (proto vClientes) ───────────────────────────── */}
      <div className="flex shrink-0 items-start gap-2 rounded-lg border bg-primary-soft/40 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>
          Cada cliente trae sus <b className="text-foreground">factores</b> (margen · descuentos ·
          regalías · costo de ventas) — con posible{' '}
          <b className="text-foreground">override por departamento</b>. Al generar una lista de
          precios se copian como snapshot editable.
        </span>
      </div>

      {/* ── Card: filtros + tabla + totales ─────────────────────────────────── */}
      <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border bg-card lg:min-h-0 lg:flex-1 lg:shrink">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          <Input
            type="search"
            className="h-8 w-52 text-sm"
            placeholder="Buscar cliente…"
            value={textoBusqueda}
            onChange={(e) => {
              setTextoBusqueda(e.target.value);
              reiniciar();
            }}
            data-testid="buscar-cliente"
          />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={incluirInactivos}
              onChange={() => {
                setIncluirInactivos((v) => !v);
                reiniciar();
              }}
              data-testid="mostrar-desactivados"
            />
            Incluir inactivos
          </label>
          <div className="ml-auto">
            <span className="text-[12px] text-faint">{total.toLocaleString('es-MX')} clientes</span>
          </div>
        </div>

        {/* ── Cuerpo scrolleable ─────────────────────────────────────────── */}
        <div className="overflow-auto lg:min-h-0 lg:flex-1">
          {consulta.isError ? (
            <div className="space-y-2 p-6">
              <p className="text-sm text-destructive" role="alert">
                {consulta.error.message}
              </p>
              <Button variant="outline" size="sm" onClick={() => void consulta.refetch()}>
                Reintentar
              </Button>
            </div>
          ) : consulta.isPending ? (
            <p className="p-6 text-sm text-muted-foreground">Cargando clientes…</p>
          ) : filas.length === 0 ? (
            <p
              className="m-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
              data-testid="cliente-vacio"
            >
              No hay clientes que coincidan con la búsqueda.
            </p>
          ) : (
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Cliente</TablaDensaHead>
                  <TablaDensaHead>Contacto</TablaDensaHead>
                  <TablaDensaHead>Estado</TablaDensaHead>
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {filas.map((c) => (
                  <TablaDensaFila
                    key={c.id}
                    seleccionada={seleccion?.id === c.id}
                    className="cursor-pointer"
                    onClick={() => setSeleccionId(c.id)}
                    data-testid="fila-cliente"
                  >
                    <TablaDensaCelda>
                      <div className="flex items-center gap-2">
                        {/* Proto: thumb teal uniforme (mismo degradado para todos los clientes). */}
                        <Avatar nombre={c.nombre} tono="pt" tamano="sm" />
                        <span className="font-semibold">{c.nombre}</span>
                      </div>
                    </TablaDensaCelda>
                    <TablaDensaCelda className="text-muted-foreground">
                      {c.contacto ?? '—'}
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      <EstadoBadge activo={c.activo} />
                    </TablaDensaCelda>
                  </TablaDensaFila>
                ))}
              </TablaDensaCuerpo>
            </TablaDensa>
          )}
        </div>

        {/* ── Barra de totales al pie ────────────────────────────────────── */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-t bg-secondary px-3 py-1.5 text-xs">
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10.5px] font-medium text-faint uppercase">
              Clientes (filtro)
            </span>
            <b className="num">{total.toLocaleString('es-MX')}</b>
          </span>
          <span className="ml-auto flex items-center gap-1 text-muted-foreground">
            Página {pagina} de {totalPaginas}
            <Button
              variant="ghost"
              size="icon"
              disabled={pagina <= 1 || consulta.isFetching}
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              aria-label="Página anterior"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={pagina >= totalPaginas || consulta.isFetching}
              onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              aria-label="Página siguiente"
            >
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </span>
        </div>
      </div>

      {/* ── Cajón de detalle del cliente ────────────────────────────────────── */}
      <CajonDetalle
        abierto={seleccionId !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setSeleccionId(null);
            // Al cerrar se suelta también el cliente inyectado: la lista vuelve a ser la de la
            // búsqueda, sin un renglón colado de un deep-link ya consumido.
            setIdAbrir(null);
          }
        }}
        titulo={
          seleccion !== null ? (
            <span className="flex items-center gap-2">
              {seleccion.nombre}
              <EstadoBadge activo={seleccion.activo} />
            </span>
          ) : (
            ''
          )
        }
        acciones={
          seleccion !== null && puedeAdministrar ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => abrirEdicion(seleccion)}
                data-testid="editar-cliente"
              >
                <Pencil aria-hidden />
                Editar
              </Button>
              {seleccion.activo ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setADesactivar(seleccion)}
                  data-testid="desactivar-cliente"
                >
                  <Trash2 aria-hidden />
                  Desactivar
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => reactivarCliente(seleccion)}
                  data-testid="activar-cliente"
                >
                  <RotateCcw aria-hidden />
                  Activar
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        {seleccion !== null ? (
          <DetalleCliente
            cliente={seleccion}
            puedeAdministrar={puedeAdministrar}
            enfocarFactores={idAbrir !== null && idAbrir === seleccion.id}
          />
        ) : null}
      </CajonDetalle>

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
    </div>
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
  enfocarFactores = false,
}: {
  cliente: Cliente;
  puedeAdministrar: boolean;
  /** Llegó por el deep-link «Capturar factores»: trae esa sección a la vista al abrirse. */
  enfocarFactores?: boolean;
}): React.JSX.Element {
  const { tienePermiso } = useSesion();
  // ⭐ V1-E8b (§Post-F9.125) — LOS CUATRO FACTORES SON SÓLO DEL DUEÑO. Daniel: *"los factores sólo
  // yo los puedo mover y no son visibles para nadie más"*. Hasta V1-E8a se veían con
  // `consultas.ver-importes` y se editaban con `listas.administrar`, los dos permisos que
  // Desarrollo (Aurora) tiene — así que la reja no era reja: podía mover el precio de la próxima
  // lista de ese cliente sin pasar por él.
  //
  // Sin el permiso la sección entera —con su rótulo— NO se pinta, en vez de dejar cuatro guiones o
  // un letrero de permiso adentro (§Post-F9.68). El backend además los manda en `null` (A1).
  //
  // ⭐ V1-E8t: el criterio ya no se teclea aquí — lo dice `puedeVerFactoresDePrecio`, la MISMA
  // función con la que el diálogo de crear lista decide si pinta la puerta que trae hasta acá. Una
  // puerta que se enciende con un criterio y un destino que se abre con otro es una puerta a una
  // sección que no existe.
  const puedeVerFactores = puedeVerFactoresDePrecio(tienePermiso);
  const puedeAdministrarFactores = tienePermiso('listas.aprobar');

  // El deep-link llega al cliente, pero lo que se venía a llenar son los FACTORES, que están al
  // final del cajón: se traen a la vista. Si la sección no se pinta (sin permiso), no hay nada que
  // enfocar y el efecto no hace nada.
  const refFactores = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const seccion = refFactores.current;
    // jsdom no implementa `scrollIntoView`: se protege para no truncar las pruebas (mismo guard
    // que `CentroOrdenesPagina`).
    if (enfocarFactores && seccion !== null && typeof seccion.scrollIntoView === 'function') {
      seccion.scrollIntoView({ block: 'start' });
    }
  }, [enfocarFactores, puedeVerFactores]);

  const hayContacto =
    hayTexto(cliente.contacto) ||
    hayTexto(cliente.telefono) ||
    hayTexto(cliente.email) ||
    hayTexto(cliente.direccion);

  return (
    <div data-testid="detalle-cliente">
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

      {/* ⭐ V1-E8y (§Post-F9.152) — LAS PERSONAS del cliente. Va ANTES de los departamentos porque
          es lo que se busca cuando se abre la ficha en una cita: con quién se habla.
          ⚠️ Se llama «Personas del cliente» y NO «Contactos»: justo arriba está «Datos de contacto»
          (los tres campos sueltos de la ficha, que la REGLA 0-B deja donde están), y dos secciones
          seguidas con el mismo nombre y el mismo icono no se distinguen de un vistazo. El icono
          también cambia, por lo mismo. */}
      <SeccionDetalle titulo="Personas del cliente (la compradora)" icono={UsersRound}>
        <EditorContactosCliente
          idCliente={cliente.id}
          deshabilitado={!puedeAdministrar || !cliente.activo}
        />
      </SeccionDetalle>

      <SeccionDetalle titulo="Departamentos (D13/R16)" icono={Building2}>
        {/* Los departamentos no van embebidos en el cliente: el editor los lista siempre
            (solo lectura sin permiso o cliente inactivo) y habilita el CRUD para administrar. */}
        <EditorDepartamentosCliente
          idCliente={cliente.id}
          deshabilitado={!puedeAdministrar || !cliente.activo}
        />
      </SeccionDetalle>

      {puedeVerFactores ? (
        <div ref={refFactores} data-testid="seccion-factores-cliente">
          <SeccionDetalle titulo="Factores de lista de precios (D13/R20a)" icono={Percent}>
            <EditorFactoresCliente
              idCliente={cliente.id}
              deshabilitado={!puedeAdministrarFactores || !cliente.activo}
            />
          </SeccionDetalle>
        </div>
      ) : null}

      <Historial creadoEn={cliente.creadoEn} modificadoEn={cliente.modificadoEn} />
    </div>
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
