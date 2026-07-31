import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useBandejaPorPagar } from '@/api/cxp';
import type { CxpBandejaQuery } from '@/api/tipos';
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

/** Chips del filtro (proto vCxp: "Con saldo | Todos"). */
const CHIPS: OpcionChip<'con-saldo' | 'todos'>[] = [
  { valor: 'con-saldo', etiqueta: 'Con saldo' },
  { valor: 'todos', etiqueta: 'Todos' },
];

/**
 * CUENTAS POR PAGAR — bandeja "por pagar" (F9-E2; proto `vCxp`): los proveedores con su saldo por
 * pagar y su ANTIGÜEDAD de saldos (aging: corriente / 1–30 / 31–60 / +60 días) + la cubeta MAQUILA
 * (aporte EsMa, SIN antigüedad), + KPIs de vistazo (cartera total, vencido, % al corriente,
 * proveedores con saldo). Todo el aging y el resumen los calcula el SERVIDOR (A1); la pantalla pinta
 * escalares. La columna "Maquila" es el saldo de maquila de EsMa (F6, convivencia): no tiene
 * antigüedad por ítem, por eso va aparte — el aging fino de maquila llegará cuando EsMa registre por
 * el motor. Click en un renglón → estado de cuenta. Solo lectura (`cxp.ver`); importes en "—" sin
 * `consultas.ver-importes`.
 */
export function CxpPagina(): React.JSX.Element {
  const navigate = useNavigate();
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('cxp.administrar');
  const [filtro, setFiltro] = useState<'con-saldo' | 'todos'>('con-saldo');
  const [busqueda, setBusqueda] = useState('');
  const [pagina, setPagina] = useState(1);

  const query: CxpBandejaQuery = {
    filtro,
    pagina,
    ...(busqueda.trim() === '' ? {} : { busqueda: busqueda.trim() }),
  };
  const consulta = useBandejaPorPagar(query);
  const datos = consulta.data;
  const filas = datos?.filas ?? [];
  const resumen = datos?.resumen;
  // Cabeceras de aging DINÁMICAS según los límites configurables de la empresa (F9-E5/D15d).
  const l1 = datos?.limitesAging.limite1 ?? 30;
  const l2 = datos?.limitesAging.limite2 ?? 60;

  function verEstadoCuenta(idProveedor: number): void {
    void navigate('/cxp/estado-cuenta', { state: { idProveedor } });
  }

  // El % al corriente es SOLO sobre la cartera clasificable (la del motor); la maquila (EsMa) no tiene
  // antigüedad, así que se muestra APARTE y el % viaja en null ("—") cuando no hay cartera del motor.
  const pct = resumen?.alCorrientePct ?? null;
  const maquilaTotal = resumen?.maquilaTotal ?? null;
  const pieMaquila =
    typeof maquilaTotal === 'number' && Math.abs(maquilaTotal) >= 0.005
      ? `Maquila sin antig.: ${moneda(maquilaTotal)}`
      : 'saldo vivo';

  const kpis: Kpi[] = [
    {
      clave: 'cartera',
      etiqueta: 'Cartera total',
      valor: moneda(resumen?.carteraTotal ?? 0),
      pie: pieMaquila,
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
      pie: 'cartera del motor',
    },
    {
      clave: 'proveedores',
      etiqueta: 'Proveedores',
      valor: (resumen?.proveedoresConSaldo ?? 0).toLocaleString('es-MX'),
      pie: 'con saldo',
    },
  ];

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 md:p-5 lg:overflow-visible"
      data-testid="cxp"
    >
      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Cuentas por pagar
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Finanzas · cuenta corriente de proveedores (D12) · generaliza EsMa
          </p>
        </div>
        {puedeAdministrar ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void navigate('/cxp/importar-cfdi')}
            data-testid="cxp-ir-importar-cfdi"
          >
            Importar CFDI
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          onClick={() => void navigate('/cxp/estado-cuenta')}
          data-testid="cxp-ir-estado-cuenta"
        >
          Estado de cuenta
        </Button>
      </header>

      {/* ── KPIs ────────────────────────────────────────────────────────────── */}
      <KpiTiles kpis={kpis} className="shrink-0" />

      {/* ── Card: filtros + tabla ───────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border bg-card lg:min-h-0 lg:flex-1 lg:shrink">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          <ChipsFiltro
            opciones={CHIPS}
            valor={filtro}
            alCambiar={(v) => {
              setFiltro(v);
              setPagina(1);
            }}
            etiqueta="Filtrar proveedores"
          />
          <BuscadorToolbar
            valor={busqueda}
            alCambiar={(v) => {
              setBusqueda(v);
              setPagina(1);
            }}
            etiqueta="Buscar proveedor"
            testid="cxp-busqueda"
          />
          <div className="ml-auto">
            <span className="text-[12px] text-faint">
              {(datos?.total ?? 0).toLocaleString('es-MX')} proveedores
            </span>
          </div>
        </div>

        {/* ── Cuerpo scrolleable ─────────────────────────────────────────── */}
        <div className="overflow-auto lg:min-h-0 lg:flex-1">
          {consulta.isPending ? (
            <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
          ) : consulta.isError ? (
            <p className="p-6 text-sm text-destructive" role="alert">
              {consulta.error.message}
            </p>
          ) : filas.length === 0 ? (
            <p className="m-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No hay proveedores para los filtros elegidos.
            </p>
          ) : (
            <>
              {/* Móvil (<lg): tarjetas apiladas — el aging de 7 columnas corta los montos en
                  teléfono. Mismo clic (→ estado de cuenta) que la fila. */}
              <div className="space-y-2 p-3 lg:hidden" data-testid="cxp-tarjetas">
                {filas.map((f) => (
                  <button
                    type="button"
                    key={f.idProveedor}
                    onClick={() => verEstadoCuenta(f.idProveedor)}
                    data-testid={`cxp-tarjeta-${f.idProveedor}`}
                    className="w-full rounded-lg border bg-card p-3 text-left"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate font-medium">
                        {f.proveedor}
                        {f.corto ? (
                          <span className="ml-1 text-xs text-muted-foreground">({f.corto})</span>
                        ) : null}
                      </p>
                      <span className="num shrink-0 font-semibold">{moneda(f.saldo)}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <span className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Corriente</span>
                        <span className="num">{celdaAging(f.corriente)}</span>
                      </span>
                      <span className="flex justify-between gap-2">
                        <span className="text-muted-foreground">1–{l1} d</span>
                        <span className="num text-warn">{celdaAging(f.d1a30)}</span>
                      </span>
                      <span className="flex justify-between gap-2">
                        <span className="text-muted-foreground">
                          {l1 + 1}–{l2} d
                        </span>
                        <span className="num text-warn">{celdaAging(f.d31a60)}</span>
                      </span>
                      <span className="flex justify-between gap-2">
                        <span className="text-muted-foreground">+{l2} d</span>
                        <span className="num text-crit">{celdaAging(f.mas60)}</span>
                      </span>
                      <span className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Maquila</span>
                        <span className="num text-muted-foreground">{celdaAging(f.maquila)}</span>
                      </span>
                    </div>
                  </button>
                ))}
              </div>
              {/* Escritorio (≥lg): tabla densa completa. */}
              <div className="hidden lg:block">
                <TablaDensa data-testid="cxp-tabla">
                  <TablaDensaEncabezado>
                    <TablaDensaFila>
                      <TablaDensaHead>Proveedor</TablaDensaHead>
                      <TablaDensaHead numerica>Saldo</TablaDensaHead>
                      <TablaDensaHead numerica>Corriente</TablaDensaHead>
                      <TablaDensaHead numerica>1–{l1} d</TablaDensaHead>
                      <TablaDensaHead numerica>
                        {l1 + 1}–{l2} d
                      </TablaDensaHead>
                      <TablaDensaHead numerica>+{l2} d</TablaDensaHead>
                      <TablaDensaHead numerica title="Saldo de maquila (EsMa), sin antigüedad">
                        Maquila
                      </TablaDensaHead>
                    </TablaDensaFila>
                  </TablaDensaEncabezado>
                  <TablaDensaCuerpo>
                    {filas.map((f) => (
                      <TablaDensaFila
                        key={f.idProveedor}
                        className="cursor-pointer"
                        onClick={() => verEstadoCuenta(f.idProveedor)}
                        data-testid={`cxp-fila-${f.idProveedor}`}
                      >
                        <TablaDensaCelda className="font-medium">
                          {f.proveedor}
                          {f.corto ? (
                            <span className="ml-1 text-xs text-muted-foreground">({f.corto})</span>
                          ) : null}
                        </TablaDensaCelda>
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
                        <TablaDensaCelda numerica className="text-muted-foreground">
                          {celdaAging(f.maquila)}
                        </TablaDensaCelda>
                      </TablaDensaFila>
                    ))}
                  </TablaDensaCuerpo>
                </TablaDensa>
              </div>
            </>
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
              data-testid="cxp-anterior"
            >
              Anterior
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={datos.pagina >= datos.totalPaginas}
              onClick={() => setPagina((p) => p + 1)}
              data-testid="cxp-siguiente"
            >
              Siguiente
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
