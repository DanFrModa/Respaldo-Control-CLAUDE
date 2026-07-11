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
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useClientes, useDesactivarCliente, useReactivarCliente } from '@/api/clientes';
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
import { EditorDepartamentosCliente } from './EditorDepartamentosCliente';
import { EditorFactoresCliente } from './EditorFactoresCliente';

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
  // El cajón guarda el ID; el cliente mostrado se DERIVA de la lista viva (estado fresco al
  // activar/desactivar, igual que Proveedores).
  const [seleccionId, setSeleccionId] = useState<number | null>(null);

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

  const datos = consulta.data;
  const filas = datos?.datos ?? [];
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
          if (!abierto) setSeleccionId(null);
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
          <DetalleCliente cliente={seleccion} puedeAdministrar={puedeAdministrar} />
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
}: {
  cliente: Cliente;
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const { tienePermiso } = useSesion();
  // Los factores de lista viven en el módulo de listas: se ven con `listas.ver` y se editan con
  // `listas.administrar` (permisos distintos de los del cliente).
  const puedeVerFactores = tienePermiso('listas.ver');
  const puedeAdministrarFactores = tienePermiso('listas.administrar');

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

      <SeccionDetalle titulo="Departamentos (D13/R16)" icono={Building2}>
        {/* Los departamentos no van embebidos en el cliente: el editor los lista siempre
            (solo lectura sin permiso o cliente inactivo) y habilita el CRUD para administrar. */}
        <EditorDepartamentosCliente
          idCliente={cliente.id}
          deshabilitado={!puedeAdministrar || !cliente.activo}
        />
      </SeccionDetalle>

      {puedeVerFactores ? (
        <SeccionDetalle titulo="Factores de lista de precios (D13/R20a)" icono={Percent}>
          <EditorFactoresCliente
            idCliente={cliente.id}
            deshabilitado={!puedeAdministrarFactores || !cliente.activo}
          />
        </SeccionDetalle>
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
