import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useBandejaPorCobrar } from '@/api/cxc';
import type { CxcBandejaQuery } from '@/api/tipos';
import { BuscadorToolbar } from '@/components/dominio/BuscadorToolbar';
import { ChipsFiltro, type OpcionChip } from '@/components/dominio/ChipsFiltro';
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
import { useSesion } from '@/sesion/useSesion';

import { celdaAging, moneda } from './comun';

/** Chips del filtro (proto vCxc: "Con saldo | Todos"). */
const CHIPS: OpcionChip<'con-saldo' | 'todos'>[] = [
  { valor: 'con-saldo', etiqueta: 'Con saldo' },
  { valor: 'todos', etiqueta: 'Todos' },
];

/**
 * CUENTAS POR COBRAR — bandeja "por cobrar" (F9-E4; proto `vCxc`): los clientes con su saldo por cobrar
 * y su ANTIGÜEDAD de saldos (aging: corriente / 1–30 / 31–60 / +60 días), + KPIs de vistazo (cartera
 * total, vencido, % al corriente, clientes con saldo). Todo el aging y el resumen los calcula el
 * SERVIDOR (A1); la pantalla pinta escalares. A diferencia de CxP no hay columna "maquila" (los clientes
 * no maquilan). Click en un renglón → estado de cuenta. Solo lectura (`cxc.ver`); importes en "—" sin
 * `consultas.ver-importes`.
 */
export function CxcPagina(): React.JSX.Element {
  const navigate = useNavigate();
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('cxc.administrar');
  const [filtro, setFiltro] = useState<'con-saldo' | 'todos'>('con-saldo');
  const [busqueda, setBusqueda] = useState('');
  const [pagina, setPagina] = useState(1);

  const query: CxcBandejaQuery = {
    filtro,
    pagina,
    ...(busqueda.trim() === '' ? {} : { busqueda: busqueda.trim() }),
  };
  const consulta = useBandejaPorCobrar(query);
  const datos = consulta.data;
  const filas = datos?.filas ?? [];
  const resumen = datos?.resumen;
  // Cabeceras de aging DINÁMICAS según los límites configurables de la empresa (F9-E5/D15d).
  const l1 = datos?.limitesAging.limite1 ?? 30;
  const l2 = datos?.limitesAging.limite2 ?? 60;

  function verEstadoCuenta(idCliente: number): void {
    void navigate('/cxc/estado-cuenta', { state: { idCliente } });
  }

  const pct = resumen?.alCorrientePct ?? null;

  const kpis: Kpi[] = [
    {
      clave: 'cartera',
      etiqueta: 'Cartera total',
      valor: moneda(resumen?.carteraTotal ?? 0),
      pie: 'saldo vivo',
    },
    {
      clave: 'vencido',
      etiqueta: 'Vencido',
      valor: moneda(resumen?.vencido ?? 0),
      pie: '+1 día',
    },
    {
      clave: 'al-corriente',
      etiqueta: 'Al corriente',
      valor: pct === null ? '—' : pct.toLocaleString('es-MX'),
      ...(pct === null ? {} : { sufijo: '%' }),
      pie: 'de la cartera',
    },
    {
      clave: 'clientes',
      etiqueta: 'Clientes',
      valor: (resumen?.clientesConSaldo ?? 0).toLocaleString('es-MX'),
      pie: 'con saldo',
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 md:p-5" data-testid="cxc">
      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Cuentas por cobrar
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Finanzas · cuenta corriente de clientes (D12) · saldo = Σ cargos − Σ pagos
          </p>
        </div>
        {puedeAdministrar ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void navigate('/cxc/importar-cfdi')}
            data-testid="cxc-ir-importar-cfdi"
          >
            Importar CFDI
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          onClick={() => void navigate('/cxc/estado-cuenta')}
          data-testid="cxc-ir-estado-cuenta"
        >
          Estado de cuenta
        </Button>
      </header>

      {/* ── KPIs ────────────────────────────────────────────────────────────── */}
      <KpiTiles kpis={kpis} className="shrink-0" />

      {/* ── Card: filtros + tabla ───────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          <ChipsFiltro
            opciones={CHIPS}
            valor={filtro}
            alCambiar={(v) => {
              setFiltro(v);
              setPagina(1);
            }}
            etiqueta="Filtrar clientes"
          />
          <BuscadorToolbar
            valor={busqueda}
            alCambiar={(v) => {
              setBusqueda(v);
              setPagina(1);
            }}
            etiqueta="Buscar cliente"
            testid="cxc-busqueda"
          />
          <div className="ml-auto">
            <span className="text-[12px] text-faint">
              {(datos?.total ?? 0).toLocaleString('es-MX')} clientes
            </span>
          </div>
        </div>

        {/* ── Cuerpo scrolleable ─────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-auto">
          {consulta.isPending ? (
            <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
          ) : consulta.isError ? (
            <p className="p-6 text-sm text-destructive" role="alert">
              {consulta.error.message}
            </p>
          ) : filas.length === 0 ? (
            <p className="m-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No hay clientes para los filtros elegidos.
            </p>
          ) : (
            <TablaDensa data-testid="cxc-tabla">
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Cliente</TablaDensaHead>
                  <TablaDensaHead numerica>Saldo</TablaDensaHead>
                  <TablaDensaHead numerica>Corriente</TablaDensaHead>
                  <TablaDensaHead numerica>1–{l1} d</TablaDensaHead>
                  <TablaDensaHead numerica>
                    {l1 + 1}–{l2} d
                  </TablaDensaHead>
                  <TablaDensaHead numerica>+{l2} d</TablaDensaHead>
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {filas.map((f) => (
                  <TablaDensaFila
                    key={f.idCliente}
                    className="cursor-pointer"
                    onClick={() => verEstadoCuenta(f.idCliente)}
                    data-testid={`cxc-fila-${f.idCliente}`}
                  >
                    <TablaDensaCelda className="font-medium">{f.cliente}</TablaDensaCelda>
                    <TablaDensaCelda numerica className="font-semibold">
                      {moneda(f.saldo)}
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica>{celdaAging(f.corriente)}</TablaDensaCelda>
                    <TablaDensaCelda numerica className="text-warn">
                      {celdaAging(f.d1a30)}
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica className="text-warn">
                      {celdaAging(f.d31a60)}
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica className="text-crit">
                      {celdaAging(f.mas60)}
                    </TablaDensaCelda>
                  </TablaDensaFila>
                ))}
              </TablaDensaCuerpo>
            </TablaDensa>
          )}
        </div>

        {/* ── Paginación ─────────────────────────────────────────────────── */}
        {datos && datos.totalPaginas > 1 ? (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t px-3 py-1.5 text-xs">
            <span className="text-faint">
              Página {datos.pagina} de {datos.totalPaginas}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={datos.pagina <= 1}
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              data-testid="cxc-anterior"
            >
              Anterior
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={datos.pagina >= datos.totalPaginas}
              onClick={() => setPagina((p) => p + 1)}
              data-testid="cxc-siguiente"
            >
              Siguiente
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
