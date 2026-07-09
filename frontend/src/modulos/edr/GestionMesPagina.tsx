import { CalendarCog, ListChecks, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { useActualizarEncabezado, useEdrPorMes, useGenerarEdr } from '@/api/edr';
import { KpiTiles, type Kpi } from '@/components/dominio/KpiTiles';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useSesion } from '@/sesion/useSesion';

import { etiquetaMes, MESES, moneda } from './comun';

/** Texto de input a número (vacío/no numérico → 0). */
function num(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}

/**
 * GESTIÓN DEL MES (F7-E2; doc 06-Costos-y-EDR §4; re-vestida R9): crea/selecciona un mes del EDR,
 * captura el encabezado GLOBAL (gastos/intereses/bonificaciones/otros) y GENERA/reconcilia las ventas
 * del mes desde las entregas a cliente. page-head (periodo + generar) + KPIs de vistazo (Σ de SERVIDOR)
 * + formulario del encabezado. Ver con `edr.ver`; generar/capturar con `edr.capturar`.
 */
export function GestionMesPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeCapturar = tienePermiso('edr.capturar');
  const hoy = new Date();
  const [anio, setAnio] = useState(String(hoy.getFullYear()));
  const [mes, setMes] = useState(String(hoy.getMonth() + 1));

  const anioN = num(anio);
  const mesN = num(mes);
  const consulta = useEdrPorMes(anioN > 0 ? anioN : null, mesN > 0 ? mesN : null);
  const generar = useGenerarEdr();
  const guardar = useActualizarEncabezado();

  const edr = consulta.data?.edr ?? null;
  const idEdr = edr?.encabezado.id ?? null;

  const [gastos, setGastos] = useState('');
  const [intereses, setIntereses] = useState('');
  const [bonificaciones, setBonificaciones] = useState('');
  const [otros, setOtros] = useState('');
  const [descOtros, setDescOtros] = useState('');
  const [observaciones, setObservaciones] = useState('');

  // Sincroniza el formulario con el encabezado cargado.
  useEffect(() => {
    if (!edr) return;
    const e = edr.encabezado;
    setGastos(String(e.gastos ?? 0));
    setIntereses(String(e.intereses ?? 0));
    setBonificaciones(String(e.bonificaciones ?? 0));
    setOtros(String(e.otros ?? 0));
    setDescOtros(e.descOtros ?? '');
    setObservaciones(e.observaciones ?? '');
  }, [edr]);

  function alGenerar(): void {
    if (anioN <= 0 || mesN <= 0) return;
    generar.mutate(
      { anio: anioN, mes: mesN },
      {
        onSuccess: () => toast.success(`EDR de ${etiquetaMes(mesN, anioN)} generado.`),
        onError: (e) => toast.error(e.message),
      },
    );
  }

  function alGuardar(): void {
    if (idEdr === null) return;
    guardar.mutate(
      {
        idEdr,
        cuerpo: {
          gastos: num(gastos),
          intereses: num(intereses),
          bonificaciones: num(bonificaciones),
          otros: num(otros),
          descOtros: descOtros === '' ? null : descOtros,
          observaciones: observaciones === '' ? null : observaciones,
        },
      },
      {
        onSuccess: () => toast.success('Encabezado guardado.'),
        onError: (e) => toast.error(e.message),
      },
    );
  }

  const kpis: Kpi[] = edr
    ? [
        { clave: 'ventas', etiqueta: 'Ventas', valor: moneda(edr.ventas), pie: 'del mes' },
        { clave: 'costo', etiqueta: 'Costo (actual)', valor: moneda(edr.costo), pie: 'D1' },
        {
          clave: 'resultado',
          etiqueta: 'Resultado',
          valor: moneda(edr.resultado),
          pie: 'neto',
          ...(edr.resultado >= 0 ? { tonoPie: 'ok' as const } : { tonoPie: 'crit' as const }),
        },
        {
          clave: 'lineas',
          etiqueta: 'Líneas',
          valor: edr.totalLineas.toLocaleString('es-MX'),
          pie: `${edr.lineasSinCosto} sin costo`,
          ...(edr.lineasSinCosto > 0 ? { tonoPie: 'crit' as const } : {}),
        },
      ]
    : [];

  return (
    <div className="h-full overflow-y-auto" data-testid="edr-gestion-mes">
      <div className="flex flex-col gap-3 p-4 md:p-5">
        {/* ── Encabezado ─────────────────────────────────────────────────────── */}
        <header className="flex shrink-0 flex-wrap items-center gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"
          >
            <CalendarCog className="size-4.5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">Gestión del mes</h1>
            <p className="truncate text-xs text-muted-foreground">
              Captura el encabezado global y genera las ventas del mes desde las entregas a cliente
            </p>
          </div>
          <SelectNativo
            className="h-8 w-24 text-sm"
            value={anio}
            onChange={(e) => setAnio(e.target.value)}
            aria-label="Año"
            data-testid="edr-anio"
          >
            {Array.from({ length: 6 }, (_, i) => hoy.getFullYear() - i).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </SelectNativo>
          <SelectNativo
            className="h-8 w-auto text-sm"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            aria-label="Mes"
            data-testid="edr-mes"
          >
            {MESES.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </SelectNativo>
          {puedeCapturar && (
            <Button
              type="button"
              size="sm"
              onClick={alGenerar}
              disabled={generar.isPending || anioN <= 0}
              data-testid="edr-generar"
            >
              <RefreshCw aria-hidden />
              {generar.isPending
                ? 'Generando…'
                : consulta.data?.existe
                  ? 'Re-generar'
                  : 'Generar mes'}
            </Button>
          )}
        </header>

        {consulta.isPending ? (
          <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
        ) : consulta.isError ? (
          <p className="p-6 text-sm text-destructive" role="alert">
            {consulta.error.message}
          </p>
        ) : !consulta.data?.existe ? (
          <p
            className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground"
            data-testid="edr-no-generado"
          >
            El EDR de {etiquetaMes(mesN, anioN)} aún no se ha generado.
            {puedeCapturar ? ' Usa el botón “Generar mes”.' : ''}
          </p>
        ) : (
          edr && (
            <div className="flex flex-col gap-3" data-testid="edr-detalle">
              {/* ── KPIs ────────────────────────────────────────────────────── */}
              <KpiTiles kpis={kpis} className="shrink-0" />

              {/* ── Encabezado global del EDR ───────────────────────────────── */}
              <div className="rounded-xl border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold">Encabezado global del mes</h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <CampoNumero
                    id="edr-gastos"
                    label="Gastos"
                    value={gastos}
                    onChange={setGastos}
                    disabled={!puedeCapturar}
                  />
                  <CampoNumero
                    id="edr-intereses"
                    label="Intereses"
                    value={intereses}
                    onChange={setIntereses}
                    disabled={!puedeCapturar}
                  />
                  <CampoNumero
                    id="edr-bonificaciones"
                    label="Bonificaciones"
                    value={bonificaciones}
                    onChange={setBonificaciones}
                    disabled={!puedeCapturar}
                  />
                  <CampoNumero
                    id="edr-otros"
                    label="Otros (±)"
                    value={otros}
                    onChange={setOtros}
                    disabled={!puedeCapturar}
                  />
                  <Field className="sm:col-span-2">
                    <FieldLabel htmlFor="edr-desc-otros">Descripción de otros</FieldLabel>
                    <Input
                      id="edr-desc-otros"
                      value={descOtros}
                      onChange={(e) => setDescOtros(e.target.value)}
                      disabled={!puedeCapturar}
                      data-testid="edr-desc-otros"
                    />
                  </Field>
                  <Field className="sm:col-span-2 lg:col-span-3">
                    <FieldLabel htmlFor="edr-obs">Observaciones</FieldLabel>
                    <Input
                      id="edr-obs"
                      value={observaciones}
                      onChange={(e) => setObservaciones(e.target.value)}
                      disabled={!puedeCapturar}
                      data-testid="edr-obs"
                    />
                  </Field>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {puedeCapturar && (
                    <Button
                      type="button"
                      onClick={alGuardar}
                      disabled={guardar.isPending}
                      data-testid="edr-guardar-encabezado"
                    >
                      {guardar.isPending ? 'Guardando…' : 'Guardar encabezado'}
                    </Button>
                  )}
                  <Button variant="outline" asChild>
                    <Link to={`/edr/conciliacion?anio=${anioN}&mes=${mesN}`}>
                      <ListChecks className="mr-2 size-4" aria-hidden />
                      Conciliar ventas
                    </Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link to={`/edr/por-mes?anio=${anioN}&mes=${mesN}`}>Ver EDR por mes</Link>
                  </Button>
                </div>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function CampoNumero(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}): React.JSX.Element {
  return (
    <Field>
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <Input
        id={props.id}
        type="number"
        step="0.01"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled}
        data-testid={props.id}
      />
    </Field>
  );
}
