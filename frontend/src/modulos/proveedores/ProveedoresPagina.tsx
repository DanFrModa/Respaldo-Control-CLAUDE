import {
  Banknote,
  ChevronLeft,
  ChevronRight,
  Clock,
  ClipboardList,
  Coins,
  CreditCard,
  FileText,
  Hash,
  Landmark,
  Mail,
  MapPin,
  Package,
  Paperclip,
  Pencil,
  Percent,
  Phone,
  Plus,
  Receipt,
  RotateCcw,
  ScrollText,
  StickyNote,
  Tag,
  Trash2,
  Wallet,
  Wrench,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useDesactivarProveedor,
  useProveedores,
  useReactivarProveedor,
  useRolesProveedor,
} from '@/api/proveedores';
import {
  ETIQUETAS_METODO_PAGO,
  ETIQUETAS_MONEDA,
  ETIQUETAS_TIPO_PROVEEDOR,
  TIPOS_PROVEEDOR,
  type MetodoPagoClave,
  type MonedaClave,
  type TipoProveedorClave,
} from '@/api/esquemas';
import type { Proveedor, ProveedoresQuery } from '@/api/tipos';
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
import { ChipEstado } from '@/components/dominio/ChipEstado';
import { Avatar, EstadoBadge, TipoBadge } from '@/components/dominio/visuales';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useDebounce } from '@/lib/useDebounce';
import type { Tono } from '@/lib/tono';
import {
  CampoDetalle,
  Historial,
  RejillaCampos,
  SeccionDetalle,
  ValorVacio,
} from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { AviosQueSurte } from './AviosQueSurte';
import { DialogoProveedor } from './DialogoProveedor';

/** Renglones por pagina del listado. */
const POR_PAGINA = 10;

/** Valor del filtro de tipo que significa "todos" (sin filtrar). */
const TIPO_TODOS = 'TODOS';

/** Valor del filtro de rol que significa "todos" (sin filtrar). */
const ROL_TODOS = 'TODOS';

/** Tono explicativo (color del avatar/chip) por tipo de proveedor. */
const TONO_POR_TIPO: Record<TipoProveedorClave, Tono> = {
  TELAS: 'telas',
  AVIOS: 'avios',
  SERVICIOS: 'servicios',
  SIN_CLASIFICAR: 'neutro',
};

/** ¿La cadena tiene contenido real (no null ni vacía)? */
function hayTexto(valor: string | null): valor is string {
  return valor !== null && valor.trim() !== '';
}

/** Etiqueta legible de la moneda (clave conocida -> nombre; desconocida -> la clave). */
function etiquetaMoneda(moneda: string): string {
  return ETIQUETAS_MONEDA[moneda as MonedaClave] ?? moneda;
}

/** Etiqueta legible del método de pago CFDI (clave conocida -> nombre; otra -> la clave). */
function etiquetaMetodoPago(metodo: string): string {
  return ETIQUETAS_METODO_PAGO[metodo as MetodoPagoClave] ?? metodo;
}

/** Formatea un límite de crédito en su moneda (MXN por defecto). */
function formatearLimite(monto: number, moneda: string | null): string {
  const divisa = moneda === 'USD' ? 'USD' : 'MXN';
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: divisa }).format(monto);
}

/**
 * Días de crédito a texto legible: `null`/`0` = "Contado"; >0 = "N días". Centraliza
 * la regla de negocio (null/0 = contado) para el detalle.
 */
function textoDiasCredito(dias: number | null): string {
  return dias === null || dias === 0 ? 'Contado' : `${dias} ${dias === 1 ? 'día' : 'días'}`;
}

/**
 * Campo de DETALLE que solo se pinta si hay texto (no null/vacío). Evita llenar el
 * panel de proveedor de campos vacíos: los datos R15 sin capturar simplemente no
 * aparecen (M2). Para valores no-string (badges, montos) se usa `CampoDetalle` directo
 * con su propia guarda.
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

/** Resumen legible de lo que surte el proveedor (roles) para la columna "Surte". */
function textoSurte(p: Proveedor): string {
  if (p.roles.length > 0) {
    return p.roles.map((r) => r.nombre).join(' · ');
  }
  return ETIQUETAS_TIPO_PROVEEDOR[p.tipo];
}

/**
 * Pantalla de Proveedores (catálogo enriquecido R15) — re-vestida R9 a TABLA-FIRST fiel al proto
 * `vProveedores`/`drawerProveedor`: page-head + toolbar (filtro por tipo y rol, búsqueda, inactivos)
 * + TABLA DENSA (Proveedor · Tipo · Contacto · Surte · Estado) + barra de totales al pie. Al hacer
 * clic en un renglón se abre un CAJÓN de detalle (contacto, fiscal/pago/operativo R15, estado de
 * cuenta CxP —placeholder de F9—, y **"Avíos que surte"** con asignar/quitar, B17). Alta/edición vía
 * el diálogo existente; desactivar con confirmación, reactivar directo.
 *
 * FIDELIDAD vs proto: (1) la columna "Saldo CxP" del proto NO tiene backend (las CxP son la fase F9);
 * en su lugar el cajón muestra un placeholder "Llega con Finanzas (F9)" — no se inventa un saldo en la
 * tabla. (2) Los chips del proto (Todos/Materiales/Maquila) se implementan como selects de tipo y rol
 * (funcionales, sobre el filtro del servidor). (3) Como el proto, la TABLA usa thumb teal uniforme y
 * badge NEUTRAL con punto para el tipo (el cajón conserva los tonos explicativos por tipo).
 *
 * `proveedores.ver` gobierna el acceso; `proveedores.administrar` decide las acciones de escritura
 * (el backend re-decide, A1).
 */
export function ProveedoresPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('proveedores.administrar');

  // ── Estado de la vista ─────────────────────────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [tipoFiltro, setTipoFiltro] = useState<TipoProveedorClave | typeof TIPO_TODOS>(TIPO_TODOS);
  // Filtro por rol: el id del rol como texto del `<select>` (vacio "TODOS" = sin filtrar).
  const [rolFiltro, setRolFiltro] = useState<string>(ROL_TODOS);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);
  // El cajón guarda el ID; el proveedor mostrado se DERIVA de la lista viva, para que al
  // activar/desactivar el encabezado del cajón refleje el estado fresco (no un snapshot).
  const [seleccionId, setSeleccionId] = useState<number | null>(null);

  const rolesCatalogo = useRolesProveedor();

  const query: ProveedoresQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(tipoFiltro !== TIPO_TODOS ? { tipo: tipoFiltro } : {}),
    ...(rolFiltro !== ROL_TODOS ? { rol: Number(rolFiltro) } : {}),
  };

  const consulta = useProveedores(query);
  const desactivar = useDesactivarProveedor();
  const reactivar = useReactivarProveedor();

  // ── Dialogos ───────────────────────────────────────────────────────────────
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [proveedorEnEdicion, setProveedorEnEdicion] = useState<Proveedor | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<Proveedor | null>(null);

  function abrirAlta(): void {
    setProveedorEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(proveedor: Proveedor): void {
    setProveedorEnEdicion(proveedor);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Proveedor "${objetivo.nombre}" desactivado.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  // Reactivar es NO destructivo: se aplica directo, sin dialogo de confirmacion.
  function reactivarProveedor(proveedor: Proveedor): void {
    reactivar.mutate(proveedor.id, {
      onSuccess: () => toast.success(`Proveedor "${proveedor.nombre}" activado.`),
      onError: (error) => toast.error(error.message),
    });
  }

  // Cambiar busqueda, tipo o el filtro de inactivos reinicia a la pagina 1.
  function reiniciar(): void {
    setPagina(1);
  }

  const datos = consulta.data;
  const filas = datos?.datos ?? [];
  const total = datos?.total ?? 0;
  const totalPaginas = datos?.totalPaginas ?? 1;
  const seleccion = filas.find((p) => p.id === seleccionId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 md:p-5">
      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">Proveedores</h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Catálogo enriquecido · maquileros y materiales · CxP
          </p>
        </div>
        {puedeAdministrar ? (
          <Button size="sm" onClick={abrirAlta} data-testid="nuevo-proveedor">
            <Plus aria-hidden />
            Nuevo proveedor
          </Button>
        ) : null}
      </header>

      {/* ── Card: filtros + tabla + totales ─────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          {/* SelectNativo envuelve el <select> en un div `w-full`: se acota AQUÍ el ancho para
              que el toolbar quede en UN renglón compacto como el proto (chips/filtros en línea). */}
          <SelectNativo
            className="w-40 h-8 text-sm"
            value={tipoFiltro}
            onChange={(e) => {
              setTipoFiltro(e.target.value as TipoProveedorClave | typeof TIPO_TODOS);
              reiniciar();
            }}
            aria-label="Filtrar proveedores por tipo"
            data-testid="filtro-tipo-proveedor"
          >
            <option value={TIPO_TODOS}>Todos los tipos</option>
            {TIPOS_PROVEEDOR.map((tipo) => (
              <option key={tipo} value={tipo}>
                {ETIQUETAS_TIPO_PROVEEDOR[tipo]}
              </option>
            ))}
          </SelectNativo>
          <SelectNativo
            className="w-40 h-8 text-sm"
            value={rolFiltro}
            onChange={(e) => {
              setRolFiltro(e.target.value);
              reiniciar();
            }}
            aria-label="Filtrar proveedores por rol o servicio"
            data-testid="filtro-rol-proveedor"
            disabled={rolesCatalogo.isPending || rolesCatalogo.isError}
          >
            <option value={ROL_TODOS}>Todos los roles</option>
            {(rolesCatalogo.data ?? []).map((rol) => (
              <option key={rol.id} value={String(rol.id)}>
                {rol.nombre}
              </option>
            ))}
          </SelectNativo>
          <Input
            type="search"
            className="h-8 w-52 text-sm"
            placeholder="Buscar proveedor…"
            value={textoBusqueda}
            onChange={(e) => {
              setTextoBusqueda(e.target.value);
              reiniciar();
            }}
            data-testid="buscar-proveedor"
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
            {/* Conteo del proto (`.count`): "visibles de total". */}
            <span className="text-[12px] text-faint">
              {filas.length.toLocaleString('es-MX')} de {total.toLocaleString('es-MX')} proveedores
            </span>
          </div>
        </div>

        {/* ── Cuerpo scrolleable ─────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-auto">
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
            <p className="p-6 text-sm text-muted-foreground">Cargando proveedores…</p>
          ) : filas.length === 0 ? (
            <p
              className="m-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
              data-testid="proveedor-vacio"
            >
              No hay proveedores que coincidan con la búsqueda.
            </p>
          ) : (
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Proveedor</TablaDensaHead>
                  <TablaDensaHead>Tipo</TablaDensaHead>
                  <TablaDensaHead>Contacto</TablaDensaHead>
                  <TablaDensaHead>Surte</TablaDensaHead>
                  <TablaDensaHead>Estado</TablaDensaHead>
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {filas.map((p) => (
                  <TablaDensaFila
                    key={p.id}
                    seleccionada={seleccion?.id === p.id}
                    className="cursor-pointer"
                    onClick={() => setSeleccionId(p.id)}
                    data-testid="fila-proveedor"
                  >
                    <TablaDensaCelda>
                      <div className="flex items-center gap-2">
                        {/* Proto: thumb ÚNICO teal para todos los proveedores (no por tipo). */}
                        <Avatar nombre={p.nombre} tono="pt" tamano="sm" />
                        <span className="font-semibold">{p.nombre}</span>
                      </div>
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      {/* Proto: `badge neutral` con punto para el tipo (gris uniforme). */}
                      <ChipEstado tono="neutro">{ETIQUETAS_TIPO_PROVEEDOR[p.tipo]}</ChipEstado>
                    </TablaDensaCelda>
                    <TablaDensaCelda className="text-muted-foreground">
                      {hayTexto(p.contacto) ? p.contacto : '—'}
                    </TablaDensaCelda>
                    <TablaDensaCelda className="text-xs text-faint">
                      {textoSurte(p)}
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      <EstadoBadge activo={p.activo} />
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
              Proveedores (filtro)
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

      {/* ── Cajón de detalle del proveedor ──────────────────────────────────── */}
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
        subtitulo={seleccion !== null ? ETIQUETAS_TIPO_PROVEEDOR[seleccion.tipo] : undefined}
        acciones={
          seleccion !== null && puedeAdministrar ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => abrirEdicion(seleccion)}
                data-testid="editar-proveedor"
              >
                <Pencil aria-hidden />
                Editar
              </Button>
              {seleccion.activo ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setADesactivar(seleccion)}
                  data-testid="desactivar-proveedor"
                >
                  <Trash2 aria-hidden />
                  Desactivar
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => reactivarProveedor(seleccion)}
                  data-testid="activar-proveedor"
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
          <DetalleProveedor p={seleccion} puedeAdministrar={puedeAdministrar} />
        ) : null}
      </CajonDetalle>

      {/* Dialogos */}
      <DialogoProveedor
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        proveedor={proveedorEnEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar proveedor"
        descripcion={
          <>
            ¿Seguro que quieres desactivar el proveedor{' '}
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

/** Convierte una bandera (`true`/`false`/`null`) a texto: Sí / No / null si no aplica. */
function siNo(valor: boolean | null): string | null {
  return valor === null ? null : valor ? 'Sí' : 'No';
}

/**
 * Panel de DETALLE de un proveedor (M2), dentro del cajón: muestra TODOS los datos R15 agrupados en
 * secciones —General · Fiscal · Pago · Operativo—, el estado de cuenta CxP (placeholder de F9) y los
 * **avíos que surte** (B17). Cada sección/campo solo se pinta si tiene dato (no se llena de vacíos);
 * la sección General siempre se muestra (tipo/roles existen). Usa las piezas de `@/modulos/detalle`.
 */
function DetalleProveedor({
  p,
  puedeAdministrar,
}: {
  p: Proveedor;
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const hayFiscal =
    p.factura !== null ||
    p.retieneIva !== null ||
    p.retieneIsr !== null ||
    hayTexto(p.rfc) ||
    hayTexto(p.regimenFiscalSat) ||
    hayTexto(p.usoCfdiHabitual) ||
    hayTexto(p.codigoPostalExpedicion);

  const hayPago =
    p.diasCredito !== null ||
    p.limiteCredito !== null ||
    hayTexto(p.moneda) ||
    hayTexto(p.formaPago) ||
    hayTexto(p.metodoPago) ||
    hayTexto(p.banco) ||
    hayTexto(p.clabe) ||
    hayTexto(p.condiciones);

  const hayOperativo = p.leadTimeDias !== null || hayTexto(p.notas) || p.cantidadAdjuntos > 0;

  return (
    <div className="space-y-4" data-testid="detalle-proveedor">
      {/* ── General (siempre: tipo y roles existen) ──────────────────────────── */}
      <SeccionDetalle titulo="Datos del proveedor" icono={ClipboardList}>
        <RejillaCampos>
          <CampoDetalle icono={Tag} etiqueta="Tipo">
            <TipoBadge tono={TONO_POR_TIPO[p.tipo]}>{ETIQUETAS_TIPO_PROVEEDOR[p.tipo]}</TipoBadge>
          </CampoDetalle>
          <CampoTextoSiHay icono={ClipboardList} etiqueta="Razón social" valor={p.razonSocial} />
          <CampoTextoSiHay icono={Mail} etiqueta="Contacto" valor={p.contacto} />
          <CampoTextoSiHay icono={Phone} etiqueta="Teléfono" valor={p.telefono} />
          <CampoTextoSiHay icono={Mail} etiqueta="Email" valor={p.email} />
          <CampoTextoSiHay icono={MapPin} etiqueta="Dirección" valor={p.direccion} anchoCompleto />
          <CampoDetalle icono={Wrench} etiqueta="Roles / servicios" anchoCompleto>
            {p.roles.length > 0 ? (
              <span className="flex flex-wrap gap-1.5" data-testid="roles-proveedor-detalle">
                {p.roles.map((rol) => (
                  <TipoBadge key={rol.id} tono="servicios">
                    {rol.nombre}
                  </TipoBadge>
                ))}
              </span>
            ) : (
              <ValorVacio />
            )}
          </CampoDetalle>
        </RejillaCampos>
      </SeccionDetalle>

      {/* ── Fiscal ───────────────────────────────────────────────────────────── */}
      {hayFiscal ? (
        <SeccionDetalle titulo="Fiscal" icono={Receipt}>
          <RejillaCampos>
            {siNo(p.factura) !== null ? (
              <CampoDetalle icono={Receipt} etiqueta="¿Emite factura (CFDI)?">
                {siNo(p.factura)}
              </CampoDetalle>
            ) : null}
            <CampoTextoSiHay icono={FileText} etiqueta="RFC" valor={p.rfc} />
            <CampoTextoSiHay
              icono={FileText}
              etiqueta="Régimen fiscal"
              valor={p.regimenFiscalSat}
            />
            <CampoTextoSiHay icono={FileText} etiqueta="Uso de CFDI" valor={p.usoCfdiHabitual} />
            <CampoTextoSiHay
              icono={MapPin}
              etiqueta="CP de expedición"
              valor={p.codigoPostalExpedicion}
            />
            {siNo(p.retieneIva) !== null ? (
              <CampoDetalle icono={Percent} etiqueta="Retiene IVA">
                {siNo(p.retieneIva)}
              </CampoDetalle>
            ) : null}
            {siNo(p.retieneIsr) !== null ? (
              <CampoDetalle icono={Percent} etiqueta="Retiene ISR">
                {siNo(p.retieneIsr)}
              </CampoDetalle>
            ) : null}
          </RejillaCampos>
        </SeccionDetalle>
      ) : null}

      {/* ── Pago ─────────────────────────────────────────────────────────────── */}
      {hayPago ? (
        <SeccionDetalle titulo="Pago" icono={CreditCard}>
          <RejillaCampos>
            {p.diasCredito !== null ? (
              <CampoDetalle icono={CreditCard} etiqueta="Días de crédito">
                {textoDiasCredito(p.diasCredito)}
              </CampoDetalle>
            ) : null}
            {hayTexto(p.moneda) ? (
              <CampoDetalle icono={Coins} etiqueta="Moneda">
                {etiquetaMoneda(p.moneda)}
              </CampoDetalle>
            ) : null}
            <CampoTextoSiHay icono={Wallet} etiqueta="Forma de pago" valor={p.formaPago} />
            {hayTexto(p.metodoPago) ? (
              <CampoDetalle icono={Wallet} etiqueta="Método de pago (CFDI)">
                {etiquetaMetodoPago(p.metodoPago)}
              </CampoDetalle>
            ) : null}
            <CampoTextoSiHay icono={Landmark} etiqueta="Banco" valor={p.banco} />
            <CampoTextoSiHay icono={Hash} etiqueta="CLABE" valor={p.clabe} />
            {p.limiteCredito !== null ? (
              <CampoDetalle icono={Banknote} etiqueta="Límite de crédito">
                {formatearLimite(p.limiteCredito, p.moneda)}
              </CampoDetalle>
            ) : null}
            <CampoTextoSiHay
              icono={ScrollText}
              etiqueta="Condiciones de pago"
              valor={p.condiciones}
              anchoCompleto
            />
          </RejillaCampos>
        </SeccionDetalle>
      ) : null}

      {/* ── Operativo ────────────────────────────────────────────────────────── */}
      {hayOperativo ? (
        <SeccionDetalle titulo="Operativo" icono={Clock}>
          <RejillaCampos>
            {p.leadTimeDias !== null ? (
              <CampoDetalle icono={Clock} etiqueta="Lead time (días)">
                {`${p.leadTimeDias} ${p.leadTimeDias === 1 ? 'día' : 'días'}`}
              </CampoDetalle>
            ) : null}
            {p.cantidadAdjuntos > 0 ? (
              <CampoDetalle icono={Paperclip} etiqueta="Adjuntos">
                {`${p.cantidadAdjuntos} ${p.cantidadAdjuntos === 1 ? 'archivo' : 'archivos'}`}
              </CampoDetalle>
            ) : null}
            <CampoTextoSiHay icono={StickyNote} etiqueta="Notas" valor={p.notas} anchoCompleto />
          </RejillaCampos>
        </SeccionDetalle>
      ) : null}

      {/* ── Estado de cuenta (CxP) — placeholder hasta F9 (Finanzas) ──────────── */}
      <SeccionDetalle titulo="Estado de cuenta (CxP)" icono={Banknote}>
        <p className="text-sm text-muted-foreground" data-testid="cxp-placeholder">
          Las cuentas por pagar (saldo, vencidos, pagos) llegan con{' '}
          <span className="font-medium text-foreground">Finanzas (F9)</span>.
        </p>
      </SeccionDetalle>

      {/* ── Avíos que surte (B17) ─────────────────────────────────────────────── */}
      <SeccionDetalle titulo="Avíos que surte" icono={Package}>
        <AviosQueSurte idProveedor={p.id} puedeAdministrar={puedeAdministrar && p.activo} />
      </SeccionDetalle>

      <Historial creadoEn={p.creadoEn} modificadoEn={p.modificadoEn} />
    </div>
  );
}
