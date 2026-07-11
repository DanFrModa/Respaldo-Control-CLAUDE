import { Download } from 'lucide-react';
import { useState } from 'react';

import { descargarExcelVentas, useVentas } from '@/api/ventas';
import type { VentasQuery } from '@/api/tipos';
import { BuscadorToolbar } from '@/components/dominio/BuscadorToolbar';
import { KpiTiles, type Kpi } from '@/components/dominio/KpiTiles';
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
import { SelectNativo } from '@/components/ui/native-select';
import { useDebounce } from '@/lib/useDebounce';

import { moneda } from '../edr/comun';

/** Renglones por página del listado. */
const POR_PAGINA = 50;

/** Nombres cortos de mes (índice 0 = Enero) para el selector y la columna. */
const MESES_CORTOS = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
];

/** Etiqueta corta del mes de una línea (1-12); "—" si viene fuera de rango. */
function mesCorto(mes: number): string {
  return MESES_CORTOS[mes - 1] ?? '—';
}

/**
 * VENTAS (Comercial › Clientes › Ventas; proto `vVentas`): la facturación por MODELO que alimenta el
 * EDR (F7-E2; D2 #5), vista como lista operativa por período. page-head + 4 KPIs de vistazo (ventas,
 * unidades, ticket promedio, # de líneas — TODOS Σ del SERVIDOR, A1) + tabla densa (folio de la OP,
 * cliente, modelo, cantidad, precio, importe, mes), con selector de período (mes + año) + búsqueda +
 * export a Excel. Solo lectura; se protege con `edr.ver` (es data del EDR). v2 no tiene folio de
 * factura en el EDR → la columna identificadora es el FOLIO DE LA OP (o "—" en líneas manuales).
 */
export function VentasPagina(): React.JSX.Element {
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  // 0 = "Todos" (todos los meses del año). Default: el mes corriente.
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [pagina, setPagina] = useState(1);

  const query: VentasQuery = {
    anio,
    ...(mes > 0 ? { mes } : {}),
    ...(busqueda.length > 0 ? { busqueda } : {}),
    pagina,
    porPagina: POR_PAGINA,
  };
  const consulta = useVentas(query);
  const datos = consulta.data;
  const lineas = datos?.lineas ?? [];
  const resumen = datos?.resumen;

  function reiniciarPagina(): void {
    setPagina(1);
  }

  const kpis: Kpi[] = [
    {
      clave: 'ventas',
      etiqueta: 'Ventas del período',
      valor: moneda(resumen?.importe ?? 0),
      pie: mes > 0 ? 'facturado' : 'facturado en el año',
    },
    {
      clave: 'unidades',
      etiqueta: 'Unidades',
      valor: (resumen?.unidades ?? 0).toLocaleString('es-MX'),
      pie: 'piezas',
    },
    {
      clave: 'ticket',
      etiqueta: 'Ticket promedio',
      valor: moneda(resumen?.ticketPromedio ?? 0),
      pie: 'por pieza',
    },
    {
      clave: 'lineas',
      etiqueta: 'Líneas',
      valor: (resumen?.lineas ?? 0).toLocaleString('es-MX'),
      pie: 'en el período',
    },
  ];

  const totalPaginas = datos?.totalPaginas ?? 1;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 md:p-5" data-testid="ventas">
      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">Ventas</h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Facturación por modelo · base del EDR
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            descargarExcelVentas({
              anio,
              ...(mes > 0 ? { mes } : {}),
              ...(busqueda.length > 0 ? { busqueda } : {}),
            })
          }
          data-testid="ventas-exportar"
        >
          <Download aria-hidden />
          Exportar
        </Button>
      </header>

      {/* ── KPIs ────────────────────────────────────────────────────────────── */}
      <KpiTiles kpis={kpis} className="shrink-0" />

      {/* ── Card: filtros + tabla ───────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          <SelectNativo
            className="h-8 w-36 text-sm"
            aria-label="Mes del período"
            value={mes === 0 ? '' : String(mes)}
            onChange={(e) => {
              setMes(e.target.value === '' ? 0 : Number(e.target.value));
              reiniciarPagina();
            }}
            data-testid="ventas-mes"
          >
            <option value="">Todos los meses</option>
            {MESES_CORTOS.map((nombre, i) => (
              <option key={nombre} value={String(i + 1)}>
                {nombre}
              </option>
            ))}
          </SelectNativo>
          <Input
            type="number"
            className="h-8 w-24 text-sm"
            value={anio}
            onChange={(e) => {
              setAnio(Number(e.target.value) || hoy.getFullYear());
              reiniciarPagina();
            }}
            aria-label="Año del período"
            data-testid="ventas-anio"
          />
          <BuscadorToolbar
            valor={textoBusqueda}
            alCambiar={(v) => {
              setTextoBusqueda(v);
              reiniciarPagina();
            }}
            placeholder="Buscar cliente, modelo o folio…"
            etiqueta="Buscar ventas"
            testid="ventas-busqueda"
          />
          <span className="ml-auto shrink-0 whitespace-nowrap text-[12px] text-faint">
            {(datos?.total ?? 0).toLocaleString('es-MX')} líneas
          </span>
        </div>

        {/* ── Cuerpo scrolleable ─────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-auto">
          {consulta.isPending ? (
            <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
          ) : consulta.isError ? (
            <p className="p-6 text-sm text-destructive" role="alert">
              {consulta.error.message}
            </p>
          ) : lineas.length === 0 ? (
            <p className="m-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No hay ventas para el período elegido.
            </p>
          ) : (
            <TablaDensa data-testid="ventas-tabla">
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>OP</TablaDensaHead>
                  <TablaDensaHead>Cliente</TablaDensaHead>
                  <TablaDensaHead>Modelo</TablaDensaHead>
                  <TablaDensaHead numerica>Cantidad</TablaDensaHead>
                  <TablaDensaHead numerica>Precio</TablaDensaHead>
                  <TablaDensaHead numerica>Importe</TablaDensaHead>
                  <TablaDensaHead>Mes</TablaDensaHead>
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {lineas.map((l) => (
                  <TablaDensaFila key={l.id} data-testid="ventas-fila">
                    <TablaDensaCelda className="num font-semibold text-primary">
                      {l.folioOrden ?? <span className="text-faint">—</span>}
                    </TablaDensaCelda>
                    <TablaDensaCelda className="font-medium">
                      {l.cliente ?? <span className="text-faint">—</span>}
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      <span className="num">{l.modelo ?? '—'}</span>
                      {l.descripcion !== null && l.descripcion !== '' ? (
                        <span className="block text-xs text-muted-foreground">{l.descripcion}</span>
                      ) : null}
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica>{l.cantidad.toLocaleString('es-MX')}</TablaDensaCelda>
                    <TablaDensaCelda numerica>{moneda(l.precio)}</TablaDensaCelda>
                    <TablaDensaCelda numerica className="font-semibold">
                      {moneda(l.importe)}
                    </TablaDensaCelda>
                    <TablaDensaCelda className="text-muted-foreground">
                      {mesCorto(l.mes)}
                    </TablaDensaCelda>
                  </TablaDensaFila>
                ))}
              </TablaDensaCuerpo>
            </TablaDensa>
          )}
        </div>

        {/* ── Paginación ─────────────────────────────────────────────────── */}
        {datos && totalPaginas > 1 ? (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t px-3 py-1.5 text-xs">
            <span className="text-faint">
              Página {datos.pagina} de {totalPaginas}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={datos.pagina <= 1 || consulta.isFetching}
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              data-testid="ventas-anterior"
            >
              Anterior
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={datos.pagina >= totalPaginas || consulta.isFetching}
              onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              data-testid="ventas-siguiente"
            >
              Siguiente
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
