import { Printer, Sheet } from 'lucide-react';
import { useState } from 'react';

import {
  exportarReporteFiscalExcel,
  imprimirReporteFiscal,
  useReporteFiscal,
  useSaludFiscal,
} from '@/api/reportes-fiscales';
import type { ReporteFiscalQuery } from '@/api/tipos';
import { KpiTiles, type Kpi } from '@/components/dominio/KpiTiles';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

import { etiquetaOrigen, moneda } from './comun';

type TipoTercero = '' | 'proveedor' | 'cliente';
type TipoMov = '' | 'cargos' | 'abonos';
type Cfdi = '' | 'con' | 'sin';

/**
 * REPORTES FISCALES para el contador (F9-E5; D12/R13): la VISTA FISCAL del libro de terceros
 * (movimientos con CFDI de CxP y CxC) con su detalle (folio, RFC, UUID, total), + un tablero de SALUD
 * FISCAL (% conciliado, pendientes de CFDI/XML, saldos por tercero) y exports a Excel/PDF. Todo el
 * cálculo es SERVER-SIDE (A1); la pantalla solo pinta. Gated `terceros.fiscal` (el riel y el backend lo
 * imponen). Los importes salen en "—" sin `consultas.ver-importes`.
 */
export function ReportesFiscalesPagina(): React.JSX.Element {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [tipoTercero, setTipoTercero] = useState<TipoTercero>('');
  const [tipo, setTipo] = useState<TipoMov>('');
  const [cfdi, setCfdi] = useState<Cfdi>('');
  const [pagina, setPagina] = useState(1);

  /** Al cambiar un filtro se vuelve a la página 1. */
  function cambiar<T>(set: (v: T) => void): (v: T) => void {
    return (v: T) => {
      set(v);
      setPagina(1);
    };
  }

  const periodo = {
    ...(desde !== '' ? { desde } : {}),
    ...(hasta !== '' ? { hasta } : {}),
  };
  const query: ReporteFiscalQuery = {
    pagina,
    ...periodo,
    ...(tipoTercero !== '' ? { tipoTercero } : {}),
    ...(tipo !== '' ? { tipo } : {}),
    ...(cfdi !== '' ? { cfdi } : {}),
  };

  const reporteConsulta = useReporteFiscal(query);
  const saludConsulta = useSaludFiscal(periodo);
  const reporte = reporteConsulta.data;
  const salud = saludConsulta.data;
  const filas = reporte?.filas ?? [];

  const kpis: Kpi[] = [
    {
      clave: 'fiscales',
      etiqueta: 'Movimientos fiscales',
      valor: (salud?.totalFiscales ?? 0).toLocaleString('es-MX'),
      pie: 'en el periodo',
    },
    {
      clave: 'conciliado',
      etiqueta: 'Conciliados',
      valor: salud?.pctConciliado == null ? '—' : salud.pctConciliado.toLocaleString('es-MX'),
      ...(salud?.pctConciliado == null ? {} : { sufijo: '%' }),
      pie: 'con CFDI',
    },
    {
      clave: 'pendientes',
      etiqueta: 'Pendientes de CFDI',
      valor: (salud?.sinCfdi ?? 0).toLocaleString('es-MX'),
      pie: 'sin UUID',
    },
    {
      clave: 'sin-xml',
      etiqueta: 'Sin XML',
      valor: (salud?.sinXml ?? 0).toLocaleString('es-MX'),
      pie: 'no guardado en R2',
    },
  ];

  return (
    <div className="h-full overflow-y-auto space-y-6 p-4 md:p-6" data-testid="reportes-fiscales">
      {/* ── Encabezado + exports ─────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Reportes fiscales
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Información fiscal para el contador: movimientos con CFDI de clientes y proveedores
            (D12, R13). CONTROL no lleva contabilidad.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => exportarReporteFiscalExcel(query)}
          data-testid="reporte-fiscal-excel"
        >
          <Sheet aria-hidden /> Excel
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => imprimirReporteFiscal(query)}
          data-testid="reporte-fiscal-pdf"
        >
          <Printer aria-hidden /> PDF
        </Button>
      </header>

      {/* ── Tablero de salud fiscal ──────────────────────────────────────────── */}
      <KpiTiles kpis={kpis} />

      {/* ── Filtros ──────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Field>
              <FieldLabel htmlFor="rf-desde">Desde</FieldLabel>
              <Input
                id="rf-desde"
                type="date"
                value={desde}
                onChange={(e) => cambiar(setDesde)(e.target.value)}
                data-testid="rf-desde"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="rf-hasta">Hasta</FieldLabel>
              <Input
                id="rf-hasta"
                type="date"
                value={hasta}
                onChange={(e) => cambiar(setHasta)(e.target.value)}
                data-testid="rf-hasta"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="rf-tercero">Tercero</FieldLabel>
              <SelectNativo
                id="rf-tercero"
                value={tipoTercero}
                onChange={(e) => cambiar(setTipoTercero)(e.target.value as TipoTercero)}
                data-testid="rf-tercero"
              >
                <option value="">Todos</option>
                <option value="proveedor">Proveedores (CxP)</option>
                <option value="cliente">Clientes (CxC)</option>
              </SelectNativo>
            </Field>
            <Field>
              <FieldLabel htmlFor="rf-tipo">Tipo</FieldLabel>
              <SelectNativo
                id="rf-tipo"
                value={tipo}
                onChange={(e) => cambiar(setTipo)(e.target.value as TipoMov)}
                data-testid="rf-tipo"
              >
                <option value="">Todos</option>
                <option value="cargos">Cargos</option>
                <option value="abonos">Abonos</option>
              </SelectNativo>
            </Field>
            <Field>
              <FieldLabel htmlFor="rf-cfdi">CFDI</FieldLabel>
              <SelectNativo
                id="rf-cfdi"
                value={cfdi}
                onChange={(e) => cambiar(setCfdi)(e.target.value as Cfdi)}
                data-testid="rf-cfdi"
              >
                <option value="">Todos</option>
                <option value="con">Con CFDI</option>
                <option value="sin">Pendientes (sin CFDI)</option>
              </SelectNativo>
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* ── Reporte (movimientos fiscales + totales) ─────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Movimientos fiscales</CardTitle>
        </CardHeader>
        <CardContent>
          {reporteConsulta.isPending ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : reporteConsulta.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {reporteConsulta.error.message}
            </p>
          ) : filas.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No hay movimientos fiscales para los filtros elegidos.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <TablaDensa data-testid="rf-tabla">
                <TablaDensaEncabezado>
                  <TablaDensaFila>
                    <TablaDensaHead>Folio</TablaDensaHead>
                    <TablaDensaHead>Fecha</TablaDensaHead>
                    <TablaDensaHead>Cuenta</TablaDensaHead>
                    <TablaDensaHead>Tercero</TablaDensaHead>
                    <TablaDensaHead>RFC</TablaDensaHead>
                    <TablaDensaHead>Concepto</TablaDensaHead>
                    <TablaDensaHead>UUID (CFDI)</TablaDensaHead>
                    <TablaDensaHead>XML</TablaDensaHead>
                    <TablaDensaHead numerica>Importe</TablaDensaHead>
                  </TablaDensaFila>
                </TablaDensaEncabezado>
                <TablaDensaCuerpo>
                  {filas.map((f) => (
                    <TablaDensaFila
                      key={f.id}
                      className={f.cancelado ? 'text-muted-foreground line-through' : undefined}
                      data-testid="rf-fila"
                    >
                      <TablaDensaCelda>{f.folio}</TablaDensaCelda>
                      <TablaDensaCelda>{f.fecha}</TablaDensaCelda>
                      <TablaDensaCelda>
                        <Badge variant="secondary">
                          {f.tipoTercero === 'cliente' ? 'CxC' : 'CxP'}
                        </Badge>
                      </TablaDensaCelda>
                      <TablaDensaCelda className="max-w-[16rem] truncate font-medium">
                        {f.tercero}
                      </TablaDensaCelda>
                      <TablaDensaCelda className="num">{f.rfcTercero ?? '—'}</TablaDensaCelda>
                      <TablaDensaCelda>{etiquetaOrigen(f.origen)}</TablaDensaCelda>
                      <TablaDensaCelda className="num max-w-[16rem] truncate">
                        {f.uuidCfdi ?? <span className="text-warn">Pendiente</span>}
                      </TablaDensaCelda>
                      <TablaDensaCelda>
                        {f.tieneXml ? (
                          <Badge variant="outline">Sí</Badge>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </TablaDensaCelda>
                      <TablaDensaCelda
                        numerica
                        className={`font-medium ${f.esCargo ? '' : 'text-crit'}`}
                      >
                        {moneda(f.monto)}
                      </TablaDensaCelda>
                    </TablaDensaFila>
                  ))}
                </TablaDensaCuerpo>
              </TablaDensa>
            </div>
          )}

          {/* ── Totales del periodo ────────────────────────────────────────── */}
          {reporte ? (
            <div
              className="mt-4 flex flex-wrap justify-end gap-6 border-t pt-3 text-sm"
              data-testid="rf-totales"
            >
              <Total etiqueta="Cargos" valor={moneda(reporte.totales.cargos)} />
              <Total etiqueta="Abonos" valor={moneda(reporte.totales.abonos)} />
              <Total etiqueta="Neto" valor={moneda(reporte.totales.neto)} fuerte />
              <Total
                etiqueta="Movimientos"
                valor={reporte.totales.movimientos.toLocaleString('es-MX')}
              />
            </div>
          ) : null}

          {/* ── Paginación ─────────────────────────────────────────────────── */}
          {reporte && reporte.totalPaginas > 1 ? (
            <div className="mt-3 flex items-center justify-end gap-2 text-xs">
              <span className="text-faint">
                Página {reporte.pagina} de {reporte.totalPaginas}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={reporte.pagina <= 1}
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
                data-testid="rf-anterior"
              >
                Anterior
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={reporte.pagina >= reporte.totalPaginas}
                onClick={() => setPagina((p) => p + 1)}
                data-testid="rf-siguiente"
              >
                Siguiente
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ── Saldos fiscales por tercero (conciliación consolidada) ───────────── */}
      {salud && salud.saldos.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Saldos fiscales por tercero</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-80 overflow-auto">
              <TablaDensa data-testid="rf-saldos">
                <TablaDensaEncabezado>
                  <TablaDensaFila>
                    <TablaDensaHead>Cuenta</TablaDensaHead>
                    <TablaDensaHead>Tercero</TablaDensaHead>
                    <TablaDensaHead>RFC</TablaDensaHead>
                    <TablaDensaHead numerica>Movs.</TablaDensaHead>
                    <TablaDensaHead numerica>Saldo fiscal</TablaDensaHead>
                  </TablaDensaFila>
                </TablaDensaEncabezado>
                <TablaDensaCuerpo>
                  {salud.saldos.map((s) => (
                    <TablaDensaFila key={`${s.tipoTercero}-${s.idTercero}`}>
                      <TablaDensaCelda>
                        {s.tipoTercero === 'cliente' ? 'CxC' : 'CxP'}
                      </TablaDensaCelda>
                      <TablaDensaCelda className="font-medium">{s.tercero}</TablaDensaCelda>
                      <TablaDensaCelda className="num">{s.rfc ?? '—'}</TablaDensaCelda>
                      <TablaDensaCelda numerica>{s.movimientos}</TablaDensaCelda>
                      <TablaDensaCelda numerica className="font-medium">
                        {moneda(s.saldoFiscal)}
                      </TablaDensaCelda>
                    </TablaDensaFila>
                  ))}
                </TablaDensaCuerpo>
              </TablaDensa>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/** Un total del pie (etiqueta + valor). */
function Total({
  etiqueta,
  valor,
  fuerte = false,
}: {
  etiqueta: string;
  valor: string;
  fuerte?: boolean;
}): React.JSX.Element {
  return (
    <div className="text-right">
      <span className="text-xs font-semibold tracking-[0.04em] text-muted-foreground uppercase">
        {etiqueta}
      </span>
      <p className={`num ${fuerte ? 'text-lg font-bold text-primary' : 'font-semibold'}`}>
        {valor}
      </p>
    </div>
  );
}
