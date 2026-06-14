import {
  Banknote,
  Clock,
  ClipboardList,
  Coins,
  CreditCard,
  FileText,
  Hash,
  Landmark,
  Mail,
  MapPin,
  Paperclip,
  Percent,
  Phone,
  Receipt,
  ScrollText,
  StickyNote,
  Tag,
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
import { Avatar, TipoBadge } from '@/components/dominio/visuales';
import { SelectNativo } from '@/components/ui/native-select';
import { useDebounce } from '@/lib/useDebounce';
import type { Tono } from '@/lib/tono';
import { ListaDetalle, type PaginacionListaDetalle } from '@/modulos/ListaDetalle';
import {
  CampoDetalle,
  Historial,
  RejillaCampos,
  SeccionDetalle,
  ValorVacio,
} from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

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

/**
 * Pantalla de Proveedores — CRUD del catalogo sobre el motor LISTA + DETALLE
 * (rediseño "Teal fresco"). Lista con busqueda (debounce), **filtro por tipo**,
 * paginacion de servidor y toggle de inactivos; el detalle muestra los datos del
 * proveedor y permite editar / desactivar / reactivar. Borrado suave reversible
 * (desactivar con confirmacion, reactivar directo); toasts; consciente de permisos.
 *
 * `proveedores.ver` gobierna el acceso a la pantalla; `proveedores.administrar`
 * decide las acciones de escritura. La decision real la toma el backend (A1).
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
  function alBuscar(valor: string): void {
    setTextoBusqueda(valor);
    setPagina(1);
  }

  function alCambiarTipo(valor: string): void {
    setTipoFiltro(valor as TipoProveedorClave | typeof TIPO_TODOS);
    setPagina(1);
  }

  function alCambiarRol(valor: string): void {
    setRolFiltro(valor);
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
      <ListaDetalle<Proveedor>
        testid="proveedor"
        titulo="Proveedores"
        descripcion="Proveedores de telas, avíos y servicios."
        icono={ClipboardList}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(p) => p.id}
        obtenerTitulo={(p) => p.nombre}
        obtenerActivo={(p) => p.activo}
        obtenerSecundaria={(p) => p.contacto ?? ETIQUETAS_TIPO_PROVEEDOR[p.tipo]}
        renderAvatarLista={(p) => (
          <Avatar nombre={p.nombre} tono={TONO_POR_TIPO[p.tipo]} tamano="sm" />
        )}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        filtros={
          <div className="flex flex-col gap-2">
            <SelectNativo
              value={tipoFiltro}
              onChange={(e) => alCambiarTipo(e.target.value)}
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
              value={rolFiltro}
              onChange={(e) => alCambiarRol(e.target.value)}
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
          </div>
        }
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={alAlternarInactivos}
        textoVacio="No hay proveedores que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nuevo proveedor"
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={reactivarProveedor}
        renderAvatarDetalle={(p) => (
          <Avatar nombre={p.nombre} tono={TONO_POR_TIPO[p.tipo]} tamano="lg" />
        )}
        renderMeta={(p) => (
          <TipoBadge tono={TONO_POR_TIPO[p.tipo]}>{ETIQUETAS_TIPO_PROVEEDOR[p.tipo]}</TipoBadge>
        )}
        renderDetalle={(p) => <DetalleProveedor p={p} />}
      />

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
    </>
  );
}

/** Convierte una bandera (`true`/`false`/`null`) a texto: Sí / No / null si no aplica. */
function siNo(valor: boolean | null): string | null {
  return valor === null ? null : valor ? 'Sí' : 'No';
}

/**
 * Panel de DETALLE de un proveedor (M2): muestra TODOS los datos R15 agrupados en
 * secciones —General · Fiscal · Pago · Operativo— y el conteo de adjuntos. Cada
 * sección y cada campo solo se pinta si tiene dato (no se llena de vacíos); una sección
 * sin nada capturado no aparece. La sección General siempre se muestra (tipo/roles
 * existen). Usa las piezas de `@/modulos/detalle` para verse igual que el resto.
 */
function DetalleProveedor({ p }: { p: Proveedor }): React.JSX.Element {
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
    <>
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

      <Historial creadoEn={p.creadoEn} modificadoEn={p.modificadoEn} />
    </>
  );
}
