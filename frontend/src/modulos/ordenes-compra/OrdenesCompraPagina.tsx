import {
  Building2,
  Calendar,
  CheckCircle2,
  Copy,
  Factory,
  FileText,
  Pencil,
  Printer,
  ShoppingCart,
  Truck,
  UserRound,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { imprimirOc, useAutorizarOc, useDuplicarOc, useOrdenesCompra } from '@/api/ordenes-compra';
import { useProveedores } from '@/api/proveedores';
import type { EstatusOrdenCompra, OrdenCompra, OrdenesCompraQuery } from '@/api/tipos';
import { Avatar } from '@/components/dominio/visuales';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { formatearMoneda } from '@/lib/formato';
import { useDebounce } from '@/lib/useDebounce';
import { ListaDetalle, type PaginacionListaDetalle } from '@/modulos/ListaDetalle';
import { CampoDetalle, Historial, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoCancelarOc } from './DialogoCancelarOc';
import { DialogoEditarOc } from './DialogoEditarOc';
import { DetalleRenglonesOc } from './DetalleRenglonesOc';
import { ETIQUETA_ESTATUS_OC, EstatusOcBadge, fechaCortaOc } from './piezas';

/** Renglones por página del listado. */
const POR_PAGINA = 10;

/** Estatus para el filtro (todos los del enum). */
const ESTATUS_FILTRO: readonly EstatusOrdenCompra[] = [
  'borrador',
  'pendiente_autorizacion',
  'autorizada',
  'recibida_parcial',
  'recibida_total',
  'cancelada',
];

/**
 * Pantalla de ÓRDENES DE COMPRA (F4-E2) sobre el motor LISTA + DETALLE. La lista busca (folio /
 * proveedor) con paginación de servidor y filtros (proveedor, estatus, rango de fechas); el detalle
 * muestra el encabezado, los renglones (con su matriz talla×color), las órdenes ligadas y el total
 * DERIVADO. Crear/editar/duplicar exigen `compras.administrar`; autorizar `compras.autorizar`;
 * cancelar `compras.cancelar`. Las acciones de escritura se ocultan sin permiso; la decisión real la
 * toma el backend (A1). Reemplaza OrdCompraVer / OrdCompra / OrdCompraDet del sistema viejo.
 */
export function OrdenesCompraPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('compras.administrar');
  const puedeAutorizar = tienePermiso('compras.autorizar');
  const puedeCancelar = tienePermiso('compras.cancelar');
  // El backend permite editar una OC autorizada SOLO a admin (`roles.administrar`), igual que el
  // precedente del proyecto (TiposProcesoPagina). Debe coincidir con el permiso del backend para no
  // ofrecer un "Editar" que se coma un 409.
  const esAdmin = tienePermiso('roles.administrar');

  // ── Estado de la vista ─────────────────────────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [incluirCanceladas, setIncluirCanceladas] = useState(false);
  const [idProveedor, setIdProveedor] = useState<number | null>(null);
  const [estatus, setEstatus] = useState<EstatusOrdenCompra | ''>('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [pagina, setPagina] = useState(1);

  const proveedores = useProveedores({ pagina: 1, porPagina: 100, ordenarPor: 'nombre' });

  const query: OrdenesCompraQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'numCompra',
    direccion: 'desc',
    incluirCanceladas: incluirCanceladas ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(idProveedor !== null ? { idProveedor } : {}),
    ...(estatus !== '' ? { estatus } : {}),
    ...(fechaDesde !== '' ? { fechaDesde } : {}),
    ...(fechaHasta !== '' ? { fechaHasta } : {}),
  };

  const consulta = useOrdenesCompra(query);
  const autorizar = useAutorizarOc();
  const duplicar = useDuplicarOc();

  // ── Diálogos ───────────────────────────────────────────────────────────────
  const [editar, setEditar] = useState<{ oc?: OrdenCompra; soloLectura: boolean } | null>(null);
  const [aCancelar, setACancelar] = useState<OrdenCompra | null>(null);
  const [idAEnfocar, setIdAEnfocar] = useState<number | null>(null);

  function alGuardada(idNueva: number): void {
    setTextoBusqueda('');
    setPagina(1);
    setIdAEnfocar(idNueva);
  }

  function alBuscar(valor: string): void {
    setTextoBusqueda(valor);
    setPagina(1);
  }
  function alAlternarCanceladas(): void {
    setIncluirCanceladas((v) => !v);
    setPagina(1);
  }

  function autorizarOc(oc: OrdenCompra): void {
    autorizar.mutate(oc.id, {
      onSuccess: (guardada) => toast.success(`Orden de compra ${guardada.numCompra} autorizada.`),
      onError: (error) => toast.error(error.message),
    });
  }

  function duplicarOc(oc: OrdenCompra): void {
    duplicar.mutate(oc.id, {
      onSuccess: (nueva) => {
        toast.success(`Orden de compra ${nueva.numCompra} creada (copia en borrador).`);
        setIdAEnfocar(nueva.id);
        setPagina(1);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  /** ¿La OC se puede editar desde la UI? (el backend re-decide; admin puede tocar autorizadas). */
  function puedeEditar(oc: OrdenCompra): boolean {
    if (!puedeAdministrar || oc.estatus === 'cancelada') {
      return false;
    }
    return oc.estatus !== 'autorizada' &&
      oc.estatus !== 'recibida_parcial' &&
      oc.estatus !== 'recibida_total'
      ? true
      : esAdmin;
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

  const filtros = (
    <div className="space-y-2">
      <SelectNativo
        aria-label="Filtrar por proveedor"
        value={idProveedor === null ? '' : String(idProveedor)}
        onChange={(e) => {
          setIdProveedor(e.target.value === '' ? null : Number(e.target.value));
          setPagina(1);
        }}
        data-testid="filtro-proveedor-oc"
      >
        <option value="">Todos los proveedores</option>
        {(proveedores.data?.datos ?? []).map((p) => (
          <option key={p.id} value={String(p.id)}>
            {p.nombre}
          </option>
        ))}
      </SelectNativo>
      <SelectNativo
        aria-label="Filtrar por estatus"
        value={estatus}
        onChange={(e) => {
          setEstatus(e.target.value as EstatusOrdenCompra | '');
          setPagina(1);
        }}
        data-testid="filtro-estatus-oc"
      >
        <option value="">Todos los estatus</option>
        {ESTATUS_FILTRO.map((s) => (
          <option key={s} value={s}>
            {ETIQUETA_ESTATUS_OC[s]}
          </option>
        ))}
      </SelectNativo>
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="date"
          aria-label="Fecha desde"
          value={fechaDesde}
          onChange={(e) => {
            setFechaDesde(e.target.value);
            setPagina(1);
          }}
          data-testid="filtro-fecha-desde-oc"
        />
        <Input
          type="date"
          aria-label="Fecha hasta"
          value={fechaHasta}
          onChange={(e) => {
            setFechaHasta(e.target.value);
            setPagina(1);
          }}
          data-testid="filtro-fecha-hasta-oc"
        />
      </div>
    </div>
  );

  return (
    <>
      <ListaDetalle<OrdenCompra>
        testid="oc"
        titulo="Órdenes de compra"
        descripcion="Compras a proveedores con sus renglones y total."
        icono={ShoppingCart}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(o) => o.id}
        obtenerTitulo={(o) => `OC ${o.numCompra}`}
        obtenerActivo={(o) => o.estatus !== 'cancelada'}
        obtenerSecundaria={(o) => `${o.proveedor} · ${formatearMoneda(o.total)}`}
        renderAvatarLista={(o) => <Avatar nombre={o.proveedor} tono="neutro" tamano="sm" />}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        filtros={filtros}
        incluirInactivos={incluirCanceladas}
        alAlternarInactivos={alAlternarCanceladas}
        textoVacio="No hay órdenes de compra que coincidan con la búsqueda."
        paginacion={paginacion}
        seleccionInicialId={idAEnfocar}
        puedeAdministrar={puedeAdministrar}
        alNuevo={() => setEditar({ soloLectura: false })}
        textoNuevo="Nueva OC"
        alEditar={() => undefined}
        alDesactivar={() => undefined}
        alReactivar={() => undefined}
        renderAvatarDetalle={(o) => <Avatar nombre={o.proveedor} tono="neutro" tamano="lg" />}
        renderMeta={(o) => (
          <span className="flex flex-wrap items-center gap-2">
            <EstatusOcBadge estatus={o.estatus} />
            <span className="text-sm text-muted-foreground">{formatearMoneda(o.total)}</span>
          </span>
        )}
        ocultarAccionesBase
        accionesExtra={(o) => (
          <span className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => imprimirOc(o.id)}
              data-testid="imprimir-oc"
            >
              <Printer aria-hidden />
              Imprimir
            </Button>
            {puedeEditar(o) ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditar({ oc: o, soloLectura: false })}
                data-testid="editar-oc"
              >
                <Pencil aria-hidden />
                Editar
              </Button>
            ) : puedeAdministrar ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditar({ oc: o, soloLectura: true })}
                data-testid="ver-oc"
              >
                <FileText aria-hidden />
                Ver
              </Button>
            ) : null}
            {puedeAdministrar ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => duplicarOc(o)}
                disabled={duplicar.isPending}
                data-testid="duplicar-oc"
              >
                <Copy aria-hidden />
                Duplicar
              </Button>
            ) : null}
            {puedeAutorizar && o.estatus === 'pendiente_autorizacion' ? (
              <Button
                size="sm"
                onClick={() => autorizarOc(o)}
                disabled={autorizar.isPending}
                data-testid="autorizar-oc"
              >
                <CheckCircle2 aria-hidden />
                Autorizar
              </Button>
            ) : null}
            {puedeCancelar && o.estatus !== 'cancelada' ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setACancelar(o)}
                data-testid="cancelar-oc"
              >
                <XCircle aria-hidden />
                Cancelar
              </Button>
            ) : null}
          </span>
        )}
        renderDetalle={(o) => <DetalleOc oc={o} />}
      />

      {editar !== null ? (
        <DialogoEditarOc
          abierto
          alCambiarAbierto={(abierto) => {
            if (!abierto) {
              setEditar(null);
            }
          }}
          oc={editar.oc}
          soloLectura={editar.soloLectura}
          alGuardada={alGuardada}
        />
      ) : null}

      <DialogoCancelarOc
        abierto={aCancelar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setACancelar(null);
          }
        }}
        oc={aCancelar ?? undefined}
      />
    </>
  );
}

/** Panel de DETALLE de una OC: encabezado, renglones (con matriz), órdenes ligadas y total. */
function DetalleOc({ oc }: { oc: OrdenCompra }): React.JSX.Element {
  return (
    <>
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => imprimirOc(oc.id)}
          data-testid="imprimir-oc-detalle"
        >
          <Printer aria-hidden />
          Imprimir PDF
        </Button>
      </div>

      <SeccionDetalle titulo="Datos de la orden de compra" icono={ShoppingCart}>
        <RejillaCampos>
          <CampoDetalle icono={UserRound} etiqueta="Proveedor">
            <span className="font-medium">{oc.proveedor}</span>
          </CampoDetalle>
          <CampoDetalle icono={Building2} etiqueta="Estatus">
            <EstatusOcBadge estatus={oc.estatus} />
          </CampoDetalle>
          <CampoDetalle icono={Calendar} etiqueta="Emisión">
            {fechaCortaOc(oc.fecha)}
          </CampoDetalle>
          <CampoDetalle icono={Calendar} etiqueta="Entrega">
            {fechaCortaOc(oc.fechaEntrega)}
          </CampoDetalle>
          <CampoDetalle icono={Truck} etiqueta="Entregar en">
            {oc.entregaEn ?? '—'}
          </CampoDetalle>
          <CampoDetalle icono={FileText} etiqueta="Corresponde a">
            {oc.correspondeA ?? '—'}
          </CampoDetalle>
        </RejillaCampos>

        {oc.observaciones ? (
          <p className="rounded-md border bg-muted/30 p-3 text-sm">{oc.observaciones}</p>
        ) : null}

        {oc.estatus === 'cancelada' && oc.motivoCancelacion ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <span className="font-medium text-destructive">Cancelada:</span> {oc.motivoCancelacion}
          </p>
        ) : null}
      </SeccionDetalle>

      <SeccionDetalle titulo="Renglones" icono={ShoppingCart}>
        <DetalleRenglonesOc oc={oc} />
      </SeccionDetalle>

      {oc.ordenesLigadas.length > 0 ? (
        <SeccionDetalle titulo="Órdenes de producción ligadas" icono={Factory}>
          <ul className="flex flex-wrap gap-2">
            {oc.ordenesLigadas.map((liga) => (
              <li
                key={liga.idOrden}
                className="rounded-md border bg-muted/30 px-2.5 py-1 text-sm"
                data-testid="orden-ligada-oc"
              >
                Orden {liga.folio}
              </li>
            ))}
          </ul>
        </SeccionDetalle>
      ) : null}

      <Historial creadoEn={oc.creadoEn} modificadoEn={oc.modificadoEn} />
    </>
  );
}
