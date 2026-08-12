import {
  Ban,
  Calendar,
  CopyIcon,
  ListOrdered,
  PackageCheck,
  ShoppingCart,
  UserRound,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useCancelarPedido, usePedidos } from '@/api/pedidos';
import type { Pedido, PedidosQuery } from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { Avatar } from '@/components/dominio/visuales';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useDebounce } from '@/lib/useDebounce';
import { ListaDetalle, type PaginacionListaDetalle } from '@/modulos/ListaDetalle';
import { CampoDetalle, Historial, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoCopiarPedido } from './DialogoCopiarPedido';
import { DialogoPedido } from './DialogoPedido';
import { PanelPedidosReales } from './PanelPedidosReales';

/** Renglones por página del listado. */
const POR_PAGINA = 10;

/** Formato de moneda MXN. */
const FORMATO_MONEDA = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

/** Formatea una fecha date-only `YYYY-MM-DD` como "13 jun 2026" sin desfase de zona. */
function fechaCorta(valor: string | null): string {
  if (valor === null) {
    return '—';
  }
  const [a, m, d] = valor.split('-').map(Number);
  if (a === undefined || m === undefined || d === undefined) {
    return '—';
  }
  return new Date(a, m - 1, d).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Pantalla de Pedidos (F2-E1) — el módulo PEDIDOS sobre el motor LISTA + DETALLE (rediseño
 * "Teal fresco"). Lista con búsqueda (folio o cliente, debounce), paginación de servidor y
 * toggle de cancelados; el detalle muestra el encabezado, los RENGLONES y el panel de PEDIDOS
 * REALES. Copiar abre la selección múltiple de renglones; cancelar es suave (badge "Cancelado",
 * el pedido sigue visible). Los IMPORTES (precio/total) solo aparecen con `pedidos.importes`
 * (el backend ya los oculta — vienen en null).
 *
 * `pedidos.ver` gobierna el acceso; `pedidos.administrar` las acciones; `pedidos-reales.administrar`
 * la captura de pedidos reales. La decisión real la toma el backend (A1).
 */
export function PedidosPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('pedidos.administrar');
  const puedeVerImportes = tienePermiso('pedidos.importes');
  const puedeAdministrarReales = tienePermiso('pedidos-reales.administrar');

  // ── Estado de la vista ─────────────────────────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [incluirCancelados, setIncluirCancelados] = useState(false);
  const [pagina, setPagina] = useState(1);

  const query: PedidosQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'folio',
    direccion: 'desc',
    incluirCancelados: incluirCancelados ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  };

  const consulta = usePedidos(query);
  const cancelar = useCancelarPedido();

  // ── Diálogos ───────────────────────────────────────────────────────────────
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [pedidoEnEdicion, setPedidoEnEdicion] = useState<Pedido | undefined>(undefined);
  const [aCancelar, setACancelar] = useState<Pedido | null>(null);
  const [aCopiar, setACopiar] = useState<Pedido | null>(null);
  // Id a enfocar en la lista (deep-link de `ListaDetalle`): tras copiar, el pedido NUEVO.
  const [idAEnfocar, setIdAEnfocar] = useState<number | null>(null);

  /**
   * Tras copiar, enfoca el pedido NUEVO en la lista. Como la lista ordena por folio desc, el
   * nuevo encabeza la página 1: se limpia la búsqueda y se vuelve a la página 1 para garantizar
   * que esté visible (requisito de `seleccionInicialId` de `ListaDetalle`).
   */
  function alCopiado(idNuevo: number): void {
    setTextoBusqueda('');
    setPagina(1);
    setIdAEnfocar(idNuevo);
  }

  function abrirAlta(): void {
    setPedidoEnEdicion(undefined);
    setDialogoAbierto(true);
  }
  function abrirEdicion(pedido: Pedido): void {
    setPedidoEnEdicion(pedido);
    setDialogoAbierto(true);
  }

  function confirmarCancelar(): void {
    if (aCancelar === null) {
      return;
    }
    const objetivo = aCancelar;
    cancelar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Pedido ${objetivo.folio} cancelado.`);
        setACancelar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  function alBuscar(valor: string): void {
    setTextoBusqueda(valor);
    setPagina(1);
  }
  function alAlternarCancelados(): void {
    setIncluirCancelados((v) => !v);
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
      <ListaDetalle<Pedido>
        testid="pedido"
        titulo="Pedidos"
        descripcion="Pedidos internos del cliente y sus pedidos reales por CEDIS."
        icono={ShoppingCart}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(p) => p.id}
        obtenerTitulo={(p) => `Pedido ${p.folio}`}
        // "activo" = no cancelado (la cancelación suave es el "borrado" del pedido).
        obtenerActivo={(p) => !p.pedCancelado}
        obtenerSecundaria={(p) => p.cliente}
        renderAvatarLista={(p) => <Avatar nombre={p.cliente} tono="neutro" tamano="sm" />}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        incluirInactivos={incluirCancelados}
        alAlternarInactivos={alAlternarCancelados}
        textoVacio="No hay pedidos que coincidan con la búsqueda."
        paginacion={paginacion}
        seleccionInicialId={idAEnfocar}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nuevo pedido"
        alEditar={abrirEdicion}
        // Desactivar = cancelar (suave). Reactivar no aplica: la cancelación es definitiva.
        alDesactivar={setACancelar}
        alReactivar={() =>
          toast.info('Un pedido cancelado no se reactiva; crea uno nuevo o cópialo.')
        }
        renderAvatarDetalle={(p) => <Avatar nombre={p.cliente} tono="neutro" tamano="lg" />}
        renderMeta={(p) => (
          <>
            {p.pedCancelado ? <Badge variant="destructive">Cancelado</Badge> : null}
            {/* «No producir» a la vista (V1-E3a, §Post-F9.36 punto 3): es la bandera que hace que
                "Generar OP" sea rechazado por el servidor; sin verla, el bloqueo no tenía
                explicación. Se edita en el diálogo del pedido. */}
            {p.noProducir ? (
              <Badge variant="secondary" data-testid="pedido-badge-no-producir">
                No producir
              </Badge>
            ) : null}
          </>
        )}
        accionesExtra={(p) =>
          p.pedCancelado ? null : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setACopiar(p)}
              data-testid="copiar-pedido"
            >
              <CopyIcon aria-hidden />
              Copiar
            </Button>
          )
        }
        renderDetalle={(p) => (
          <DetallePedido
            pedido={p}
            puedeVerImportes={puedeVerImportes}
            puedeAdministrarReales={puedeAdministrarReales}
          />
        )}
      />

      <DialogoPedido
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        pedido={pedidoEnEdicion}
        puedeVerImportes={puedeVerImportes}
      />
      <DialogoCopiarPedido
        abierto={aCopiar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setACopiar(null);
          }
        }}
        pedido={aCopiar ?? undefined}
        alCopiado={alCopiado}
      />
      <DialogoConfirmacion
        abierto={aCancelar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setACancelar(null);
          }
        }}
        titulo="Cancelar pedido"
        descripcion={
          <>
            ¿Seguro que quieres cancelar el{' '}
            <span className="font-medium text-foreground">pedido {aCancelar?.folio}</span>? El
            pedido se conserva (cancelación suave), pero deja de producirse.
          </>
        }
        textoConfirmar="Cancelar pedido"
        variante="destructive"
        procesando={cancelar.isPending}
        alConfirmar={confirmarCancelar}
      />
    </>
  );
}

/** Panel de DETALLE de un pedido: encabezado, renglones y pedidos reales. */
function DetallePedido({
  pedido,
  puedeVerImportes,
  puedeAdministrarReales,
}: {
  pedido: Pedido;
  puedeVerImportes: boolean;
  puedeAdministrarReales: boolean;
}): React.JSX.Element {
  return (
    <>
      <SeccionDetalle titulo="Datos del pedido" icono={ShoppingCart}>
        <RejillaCampos>
          <CampoDetalle icono={UserRound} etiqueta="Cliente">
            {pedido.cliente}
          </CampoDetalle>
          <CampoDetalle icono={Calendar} etiqueta="Fecha del pedido">
            {fechaCorta(pedido.fechaPedido)}
          </CampoDetalle>
          <CampoDetalle icono={Calendar} etiqueta="Entrega comprometida">
            {fechaCorta(pedido.fechaDe)} – {fechaCorta(pedido.fechaHasta)}
          </CampoDetalle>
          <CampoDetalle icono={Calendar} etiqueta="Fecha de tela">
            {fechaCorta(pedido.fechaTela)}
          </CampoDetalle>
          <CampoDetalle icono={Calendar} etiqueta="Fecha de elaboración">
            {fechaCorta(pedido.fechaElaboracion)}
          </CampoDetalle>
          <CampoDetalle icono={Ban} etiqueta="No producir">
            {pedido.noProducir ? (
              <span className="text-warn">Sí — no se le pueden generar órdenes de producción</span>
            ) : (
              'No'
            )}
          </CampoDetalle>
          <CampoDetalle icono={PackageCheck} etiqueta="Total de piezas">
            {pedido.totalPiezas.toLocaleString('es-MX')}
            {puedeVerImportes && pedido.totalImporte !== null ? (
              <span className="text-muted-foreground">
                {' · '}
                {FORMATO_MONEDA.format(pedido.totalImporte)}
              </span>
            ) : null}
          </CampoDetalle>
        </RejillaCampos>
      </SeccionDetalle>

      <SeccionDetalle titulo="Renglones" icono={ListOrdered}>
        {pedido.lineas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Este pedido no tiene renglones.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Modelo</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  {puedeVerImportes ? <TableHead className="text-right">Precio</TableHead> : null}
                  {puedeVerImportes ? <TableHead className="text-right">Importe</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pedido.lineas.map((l) => (
                  <TableRow key={l.id} data-testid="renglon-pedido">
                    <TableCell>
                      <span className="font-medium">{l.codigoModelo}</span>
                      {l.descripcionModelo ? (
                        <span className="block text-xs text-muted-foreground">
                          {l.descripcionModelo}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      {l.cantidadPedida.toLocaleString('es-MX')}
                    </TableCell>
                    {puedeVerImportes ? (
                      <TableCell className="text-right">
                        {l.precio === null ? '—' : FORMATO_MONEDA.format(l.precio)}
                      </TableCell>
                    ) : null}
                    {puedeVerImportes ? (
                      <TableCell className="text-right">
                        {l.importe === null ? '—' : FORMATO_MONEDA.format(l.importe)}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SeccionDetalle>

      <SeccionDetalle titulo="Pedidos reales" icono={PackageCheck}>
        <PanelPedidosReales idPedido={pedido.id} puedeAdministrarReales={puedeAdministrarReales} />
      </SeccionDetalle>

      <Historial creadoEn={pedido.creadoEn} modificadoEn={pedido.modificadoEn} />
    </>
  );
}
