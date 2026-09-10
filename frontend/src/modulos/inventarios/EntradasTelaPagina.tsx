import { Ban, CheckCircle2, Pencil, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import {
  useCancelarEntradaTela,
  useConfirmarEntradaTela,
  useEntradasTela,
  type EntradaTela,
  type EntradasTelaQuery,
} from '@/api/entradas-tela';
import { CajonDetalle } from '@/components/dominio/CajonDetalle';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import { ChipsFiltro } from '@/components/dominio/ChipsFiltro';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatearFecha } from '@/lib/formato';
import { useDebounce } from '@/lib/useDebounce';
import { useSesion } from '@/sesion/useSesion';

import { AdjuntosEntradaTela } from './AdjuntosEntradaTela';

/** Renglones por página del listado. */
const POR_PAGINA = 20;

/** Valor del filtro de estado que significa "todos". */
const ESTATUS_TODOS = 'TODOS';

/** Tono del chip según el estado del documento. */
function tonoEstatus(estatus: EntradaTela['estatus']): 'ok' | 'warn' | 'crit' {
  if (estatus === 'confirmada') return 'ok';
  if (estatus === 'cancelada') return 'crit';
  return 'warn';
}

/** Etiqueta legible del estado. */
function etiquetaEstatus(estatus: EntradaTela['estatus']): string {
  if (estatus === 'confirmada') return 'Confirmada';
  if (estatus === 'cancelada') return 'Cancelada';
  return 'Borrador';
}

/** Formatea un número con separadores es-MX (o "—" si no hay dato). */
function num(valor: number | null): string {
  return valor === null ? '—' : valor.toLocaleString('es-MX');
}

/**
 * ENTRADAS DE TELA por FACTURA/REMISIÓN del proveedor, SIEMPRE contra su orden de compra (etapa B1;
 * §Post-F9.159(a) cerró la vía sin OC que permitía §Post-F9.9 punto 7):
 * la lista tabla-first de los documentos con su estado, y el CAJÓN de detalle con sus PARTIDAS, el
 * PDF de la factura adjunto y las acciones del ciclo: editar (sólo borrador), CONFIRMAR (crea las
 * partidas y da la entrada al inventario) y CANCELAR (si ya estaba confirmada, el backend genera el
 * movimiento INVERSO auditado — nada se edita ni se borra, D3).
 *
 * `inventario-telas.ver` gobierna el acceso; `inventario-telas.mover` decide las acciones de
 * escritura (el backend re-decide, A1). Los precios/importes vienen en null sin `telas.ver-totales`
 * (ex-acceso #7): la UI simplemente no los pinta.
 */
export function EntradasTelaPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeMover = tienePermiso('inventario-telas.mover');
  const navegar = useNavigate();

  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [estatus, setEstatus] = useState<string>(ESTATUS_TODOS);
  const [pagina, setPagina] = useState(1);
  const [seleccionada, setSeleccionada] = useState<EntradaTela | null>(null);

  const query: EntradasTelaQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'folio',
    direccion: 'desc',
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(estatus === ESTATUS_TODOS ? {} : { estatus: estatus as EntradaTela['estatus'] }),
  };
  const consulta = useEntradasTela(query);
  const confirmar = useConfirmarEntradaTela();
  const cancelar = useCancelarEntradaTela();

  const filas = consulta.data?.datos ?? [];
  const total = consulta.data?.total ?? 0;
  // El detalle se re-lee de la página (así refleja el cambio de estado tras confirmar/cancelar).
  const detalle =
    seleccionada === null ? null : (filas.find((f) => f.id === seleccionada.id) ?? seleccionada);

  function confirmarEntrada(entrada: EntradaTela): void {
    confirmar.mutate(entrada.id, {
      onSuccess: (actualizada) => {
        toast.success(
          `Entrada ${actualizada.folio} confirmada: ${actualizada.lineas.length} partida(s) entraron al inventario.`,
        );
        // Aviso SUAVE del backend (factura repetida): informa, no bloquea.
        for (const aviso of actualizada.avisos) {
          toast.warning(aviso, { duration: 10000 });
        }
        setSeleccionada(actualizada);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  function cancelarEntrada(entrada: EntradaTela): void {
    const motivo = window.prompt('Motivo de la cancelación:');
    if (motivo === null || motivo.trim().length < 3) return;
    cancelar.mutate(
      { id: entrada.id, cuerpo: { motivo: motivo.trim() } },
      {
        onSuccess: (actualizada) => {
          toast.success(
            entrada.estatus === 'confirmada'
              ? `Entrada ${actualizada.folio} cancelada: se registró el movimiento inverso.`
              : `Entrada ${actualizada.folio} cancelada.`,
          );
          setSeleccionada(actualizada);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 md:p-5 lg:overflow-visible">
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Entradas de tela por factura
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Un documento del proveedor (factura o remisión) con N partidas, cada una contra su orden
            de compra · entra al inventario al confirmarse
          </p>
        </div>
        {puedeMover ? (
          <Button
            size="sm"
            onClick={() => void navegar('/inventarios/telas/entradas/nueva')}
            data-testid="nueva-entrada-tela"
          >
            <Plus aria-hidden /> Nueva entrada
          </Button>
        ) : null}
      </header>

      <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border bg-card lg:min-h-0 lg:flex-1 lg:shrink">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          <ChipsFiltro
            opciones={[
              { valor: ESTATUS_TODOS, etiqueta: 'Todas', testid: 'filtro-entrada-todas' },
              { valor: 'borrador', etiqueta: 'Borrador', testid: 'filtro-entrada-borrador' },
              { valor: 'confirmada', etiqueta: 'Confirmadas', testid: 'filtro-entrada-confirmada' },
              { valor: 'cancelada', etiqueta: 'Canceladas', testid: 'filtro-entrada-cancelada' },
            ]}
            valor={estatus}
            alCambiar={(valor) => {
              setEstatus(valor);
              setPagina(1);
            }}
            etiqueta="Filtrar entradas por estado"
          />
          <div className="relative w-56">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              className="h-8 pl-8 text-sm"
              placeholder="Folio, factura o proveedor…"
              value={textoBusqueda}
              onChange={(e) => {
                setTextoBusqueda(e.target.value);
                setPagina(1);
              }}
              data-testid="buscar-entrada-tela"
            />
          </div>
          <span className="ml-auto text-xs text-faint">
            {filas.length.toLocaleString('es-MX')} de {total.toLocaleString('es-MX')}
          </span>
        </div>

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
            <p className="p-6 text-sm text-muted-foreground">Cargando entradas…</p>
          ) : filas.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground" data-testid="entrada-tela-vacio">
              No hay entradas que coincidan.
            </p>
          ) : (
            <TablaDensa data-testid="entradas-tela-tabla">
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead numerica>Folio</TablaDensaHead>
                  <TablaDensaHead>Documento</TablaDensaHead>
                  <TablaDensaHead>Proveedor</TablaDensaHead>
                  <TablaDensaHead>Fecha</TablaDensaHead>
                  <TablaDensaHead>Almacén</TablaDensaHead>
                  <TablaDensaHead numerica>Partidas</TablaDensaHead>
                  <TablaDensaHead numerica>Cuerpo</TablaDensaHead>
                  <TablaDensaHead>Estado</TablaDensaHead>
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {filas.map((entrada) => (
                  <TablaDensaFila
                    key={entrada.id}
                    seleccionada={detalle?.id === entrada.id}
                    onClick={() => setSeleccionada(entrada)}
                    className="cursor-pointer"
                    data-testid={`fila-entrada-${entrada.id}`}
                  >
                    <TablaDensaCelda numerica className="font-medium">
                      {entrada.folio}
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      {entrada.tipoDocumento === 'factura' ? 'Factura' : 'Remisión'}{' '}
                      <span className="text-muted-foreground">{entrada.numeroDocumento}</span>
                    </TablaDensaCelda>
                    <TablaDensaCelda>{entrada.proveedor}</TablaDensaCelda>
                    <TablaDensaCelda>{formatearFecha(entrada.fecha)}</TablaDensaCelda>
                    <TablaDensaCelda>{entrada.almacen}</TablaDensaCelda>
                    <TablaDensaCelda numerica>{entrada.lineas.length}</TablaDensaCelda>
                    <TablaDensaCelda numerica>{num(entrada.totalCuerpo)}</TablaDensaCelda>
                    <TablaDensaCelda>
                      <ChipEstado tono={tonoEstatus(entrada.estatus)}>
                        {etiquetaEstatus(entrada.estatus)}
                      </ChipEstado>
                    </TablaDensaCelda>
                  </TablaDensaFila>
                ))}
              </TablaDensaCuerpo>
            </TablaDensa>
          )}
        </div>

        {total > POR_PAGINA ? (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t px-3 py-2 text-xs">
            <Button
              variant="outline"
              size="sm"
              disabled={pagina <= 1}
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
            >
              Anterior
            </Button>
            <span className="text-muted-foreground">
              Página {pagina} de {consulta.data?.totalPaginas ?? 1}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={pagina >= (consulta.data?.totalPaginas ?? 1)}
              onClick={() => setPagina((p) => p + 1)}
            >
              Siguiente
            </Button>
          </div>
        ) : null}
      </div>

      <CajonDetalle
        abierto={detalle !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) setSeleccionada(null);
        }}
        ancho="amplio"
        titulo={detalle === null ? '' : `Entrada ${detalle.folio}`}
        subtitulo={
          detalle === null
            ? undefined
            : `${detalle.tipoDocumento === 'factura' ? 'Factura' : 'Remisión'} ${detalle.numeroDocumento} · ${detalle.proveedor} · ${formatearFecha(detalle.fecha)}`
        }
        acciones={
          detalle === null || !puedeMover ? null : (
            <div className="flex flex-wrap items-center gap-2">
              {detalle.estatus === 'borrador' ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void navegar(`/inventarios/telas/entradas/${String(detalle.id)}/editar`)
                    }
                    data-testid="entrada-editar"
                  >
                    <Pencil aria-hidden /> Editar
                  </Button>
                  <Button
                    size="sm"
                    disabled={confirmar.isPending}
                    onClick={() => confirmarEntrada(detalle)}
                    data-testid="entrada-confirmar"
                  >
                    <CheckCircle2 aria-hidden /> Confirmar
                  </Button>
                </>
              ) : null}
              {detalle.estatus !== 'cancelada' ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={cancelar.isPending}
                  onClick={() => cancelarEntrada(detalle)}
                  data-testid="entrada-cancelar"
                >
                  <Ban aria-hidden /> Cancelar
                </Button>
              ) : null}
            </div>
          )
        }
      >
        {detalle === null ? null : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <ChipEstado tono={tonoEstatus(detalle.estatus)}>
                {etiquetaEstatus(detalle.estatus)}
              </ChipEstado>
              <span className="text-xs text-muted-foreground">Almacén: {detalle.almacen}</span>
              {detalle.folioMovimiento !== null ? (
                <span className="text-xs text-muted-foreground">
                  Movimiento de kardex #{detalle.folioMovimiento}
                </span>
              ) : null}
            </div>

            {detalle.avisos.map((aviso) => (
              <p
                key={aviso}
                className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs"
                role="status"
                data-testid="entrada-aviso"
              >
                {aviso}
              </p>
            ))}

            {detalle.motivoCancelacion !== null ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
                Cancelada: {detalle.motivoCancelacion}
              </p>
            ) : null}
            {detalle.observaciones !== null ? (
              <p className="text-xs text-muted-foreground">{detalle.observaciones}</p>
            ) : null}

            <section className="space-y-2">
              <h3 className="text-sm font-medium">Partidas del documento</h3>
              <div className="overflow-x-auto rounded-md border">
                <TablaDensa>
                  <TablaDensaEncabezado>
                    <TablaDensaFila>
                      <TablaDensaHead>Tela · color</TablaDensaHead>
                      <TablaDensaHead>Lote prov.</TablaDensaHead>
                      <TablaDensaHead numerica>Cuerpo</TablaDensaHead>
                      <TablaDensaHead numerica>Complemento</TablaDensaHead>
                      <TablaDensaHead numerica>Importe</TablaDensaHead>
                      <TablaDensaHead numerica>Partida</TablaDensaHead>
                    </TablaDensaFila>
                  </TablaDensaEncabezado>
                  <TablaDensaCuerpo>
                    {detalle.lineas.map((linea) => (
                      <TablaDensaFila key={linea.id}>
                        <TablaDensaCelda>
                          <span className="font-medium">{linea.tela}</span>{' '}
                          <span className="text-muted-foreground">· {linea.telaColor}</span>
                        </TablaDensaCelda>
                        <TablaDensaCelda className="text-xs text-muted-foreground">
                          {linea.loteProveedor ?? '—'}
                        </TablaDensaCelda>
                        <TablaDensaCelda numerica>{num(linea.cantidad)}</TablaDensaCelda>
                        <TablaDensaCelda numerica>
                          {linea.nombreComplemento === null
                            ? '—'
                            : num(linea.cantidadComplemento ?? 0)}
                        </TablaDensaCelda>
                        <TablaDensaCelda numerica>{num(linea.importe)}</TablaDensaCelda>
                        <TablaDensaCelda numerica>
                          {linea.partidaFolio === null ? '—' : `#${linea.partidaFolio}`}
                        </TablaDensaCelda>
                      </TablaDensaFila>
                    ))}
                  </TablaDensaCuerpo>
                </TablaDensa>
              </div>
              <div className="flex flex-wrap justify-end gap-4 text-xs text-muted-foreground">
                <span>Cuerpo: {num(detalle.totalCuerpo)}</span>
                <span>Complemento: {num(detalle.totalComplemento)}</span>
                {detalle.totalImporte !== null ? (
                  <span>Importe: {num(detalle.totalImporte)}</span>
                ) : null}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-medium">Factura escaneada</h3>
              <AdjuntosEntradaTela idEntrada={detalle.id} puedeAdministrar={puedeMover} />
            </section>
          </div>
        )}
      </CajonDetalle>
    </div>
  );
}
