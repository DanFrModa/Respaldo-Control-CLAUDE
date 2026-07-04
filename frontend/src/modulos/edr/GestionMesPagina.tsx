import { CalendarCog, ListChecks, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { useActualizarEncabezado, useEdrPorMes, useGenerarEdr } from '@/api/edr';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
 * GESTIÓN DEL MES (F7-E2; doc 06-Costos-y-EDR §4): crea/selecciona un mes del EDR, captura el
 * encabezado GLOBAL (gastos/intereses/bonificaciones/otros) y GENERA/reconcilia las ventas del mes
 * desde las entregas a cliente. Ver con `edr.ver`; generar/capturar con `edr.capturar`.
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

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="edr-gestion-mes">
      <header className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
          <CalendarCog className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Gestión del mes</h1>
          <p className="text-sm text-muted-foreground">
            Captura el encabezado global y genera las ventas del mes desde las entregas a cliente.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>Periodo</CardTitle>
              <CardDescription>Elige el mes del estado de resultados.</CardDescription>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field className="w-28">
                <FieldLabel htmlFor="edr-anio">Año</FieldLabel>
                <Input
                  id="edr-anio"
                  type="number"
                  value={anio}
                  onChange={(e) => setAnio(e.target.value)}
                  data-testid="edr-anio"
                />
              </Field>
              <Field className="w-40">
                <FieldLabel htmlFor="edr-mes">Mes</FieldLabel>
                <SelectNativo
                  id="edr-mes"
                  value={mes}
                  onChange={(e) => setMes(e.target.value)}
                  data-testid="edr-mes"
                >
                  {MESES.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </SelectNativo>
              </Field>
              {puedeCapturar && (
                <Button
                  type="button"
                  onClick={alGenerar}
                  disabled={generar.isPending || anioN <= 0}
                  data-testid="edr-generar"
                >
                  <RefreshCw className="mr-2 size-4" aria-hidden />
                  {generar.isPending
                    ? 'Generando…'
                    : consulta.data?.existe
                      ? 'Re-generar (reconciliar)'
                      : 'Generar mes'}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {consulta.isPending ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : consulta.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {consulta.error.message}
            </p>
          ) : !consulta.data?.existe ? (
            <p
              className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
              data-testid="edr-no-generado"
            >
              El EDR de {etiquetaMes(mesN, anioN)} aún no se ha generado.
              {puedeCapturar ? ' Usa el botón “Generar mes”.' : ''}
            </p>
          ) : (
            edr && (
              <div className="space-y-6" data-testid="edr-detalle">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <ResumenDato titulo="Ventas" valor={moneda(edr.ventas)} />
                  <ResumenDato titulo="Costo (actual)" valor={moneda(edr.costo)} />
                  <ResumenDato titulo="Resultado" valor={moneda(edr.resultado)} destacar />
                  <ResumenDato
                    titulo="Líneas"
                    valor={`${edr.totalLineas} (${edr.lineasSinCosto} sin costo)`}
                  />
                </div>

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

                <div className="flex flex-wrap items-center gap-3">
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
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ResumenDato(props: {
  titulo: string;
  valor: string;
  destacar?: boolean;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{props.titulo}</p>
      <p
        className={props.destacar ? 'text-lg font-semibold text-primary' : 'text-lg font-semibold'}
      >
        {props.valor}
      </p>
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
