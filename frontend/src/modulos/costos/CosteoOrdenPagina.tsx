import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { useCostoOrden, useGuardarCostoOrden } from '@/api/costos';
import { useBuscarOrdenes } from '@/api/ordenes-consulta';
import type { BaseProrrateo, CostoOrdenGuardar } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useDebounce } from '@/lib/useDebounce';
import { useSesion } from '@/sesion/useSesion';

import { etiquetaBase, moneda } from './comun';

/** Convierte un texto de input a número (vacío/no numérico → 0). */
function num(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}

/**
 * COSTEO DE ORDEN (F7-E1; doc 06-Costos-y-EDR §3): busca una orden y captura su costo real. Muestra el
 * teórico (receta × precios vigentes) y el GUARDADO LADO A LADO; el total se arma con el guardado y el
 * costo unitario se prorratea sobre la base elegida (cortado por defecto). Respeta `noCostear` (no
 * deja guardar). Ver con `costos.ver`; guardar con `costos.capturar`. Importes en "—" sin
 * `consultas.ver-importes`.
 */
export function CosteoOrdenPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeCapturar = tienePermiso('costos.capturar');
  const [params, setParams] = useSearchParams();
  const idParam = params.get('idOrden');
  const idOrden = idParam !== null && /^\d+$/.test(idParam) ? Number(idParam) : null;

  const [busqueda, setBusqueda] = useState('');
  const debounced = useDebounce(busqueda, 300);
  const hits = useBuscarOrdenes(debounced);
  const costo = useCostoOrden(idOrden);
  const guardar = useGuardarCostoOrden();

  const [telaCost, setTelaCost] = useState('');
  const [procesosCost, setProcesosCost] = useState('');
  const [aviosCost, setAviosCost] = useState('');
  const [otros, setOtros] = useState('');
  const [descOtros, setDescOtros] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [base, setBase] = useState<BaseProrrateo>('cortado');

  // Sincroniza el formulario con el costo cargado (guardado si existe; si no, el teórico).
  const data = costo.data;
  useEffect(() => {
    if (!data) return;
    const g = data.guardado;
    setTelaCost(String(g?.telaCost ?? data.teorico.tela ?? ''));
    setProcesosCost(String(g?.procesosCost ?? data.teorico.procesos ?? ''));
    setAviosCost(String(g?.aviosCost ?? data.teorico.avios ?? ''));
    setOtros(String(g?.otros ?? ''));
    setDescOtros(g?.descOtros ?? '');
    setObservaciones(g?.observaciones ?? '');
    setBase(g?.baseProrrateo ?? 'cortado');
  }, [data]);

  function elegir(id: number): void {
    setParams({ idOrden: String(id) });
    setBusqueda('');
  }

  function alGuardar(): void {
    if (idOrden === null) return;
    const cuerpo: CostoOrdenGuardar = {
      telaCost: telaCost === '' ? null : num(telaCost),
      procesosCost: procesosCost === '' ? null : num(procesosCost),
      aviosCost: aviosCost === '' ? null : num(aviosCost),
      otros: otros === '' ? null : num(otros),
      descOtros: descOtros === '' ? null : descOtros,
      baseProrrateo: base,
      observaciones: observaciones === '' ? null : observaciones,
    };
    guardar.mutate(
      { idOrden, cuerpo },
      {
        onSuccess: () => toast.success('Costo guardado.'),
        onError: (e) => toast.error(e.message),
      },
    );
  }

  const cantBase =
    data === undefined
      ? 0
      : base === 'cortado'
        ? data.cantidades.cortado
        : base === 'recibido'
          ? data.cantidades.recibido
          : data.cantidades.vendido;
  const totalPreview = num(telaCost) + num(procesosCost) + num(aviosCost) + num(otros);
  const unitPreview = cantBase > 0 ? totalPreview / cantBase : null;

  return (
    <div className="h-full overflow-y-auto space-y-6 p-4 md:p-6" data-testid="costeo-orden">
      <header className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Costeo de orden
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Teórico (receta × precios) vs guardado; el total se arma con el guardado
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Elige una orden</CardTitle>
          <CardDescription>Busca por folio, modelo, cliente o referencia.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field className="max-w-md">
            <FieldLabel htmlFor="costeo-buscar">Orden</FieldLabel>
            <Input
              id="costeo-buscar"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Folio, modelo, cliente…"
              data-testid="costeo-buscar"
            />
          </Field>
          {debounced.length > 0 && (hits.data?.datos.length ?? 0) > 0 && (
            <ul className="max-w-md divide-y rounded-md border">
              {hits.data?.datos.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => elegir(o.id)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                    data-testid={`costeo-opcion-${o.id}`}
                  >
                    <span className="font-medium">#{o.folio}</span>
                    <span className="text-muted-foreground">
                      {o.codigoModelo} · {o.cliente}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {idOrden !== null && costo.isPending ? (
        <p className="text-sm text-muted-foreground">Cargando costo…</p>
      ) : idOrden !== null && costo.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {costo.error.message}
        </p>
      ) : data ? (
        <Card data-testid="costeo-detalle">
          <CardHeader>
            <CardTitle>
              Orden #{data.folio} · {data.codigoModelo}
            </CardTitle>
            <CardDescription>
              {data.cliente} · Pedido {data.cantidades.pedido} · Cortado {data.cantidades.cortado} ·
              Recibido {data.cantidades.recibido} · Vendido {data.cantidades.vendido}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.noCostear && (
              <p
                className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
                role="alert"
                data-testid="costeo-no-costear"
              >
                <AlertTriangle className="size-4" aria-hidden />
                Esta orden está marcada como &quot;no costear&quot;: no se puede capturar su costo.
              </p>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Componente</TableHead>
                  <TableHead className="text-right">Teórico</TableHead>
                  <TableHead className="text-right">Guardado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Tela</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {moneda(data.teorico.tela)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      step="0.01"
                      value={telaCost}
                      onChange={(e) => setTelaCost(e.target.value)}
                      disabled={!puedeCapturar || data.noCostear}
                      className="ml-auto w-32 text-right"
                      data-testid="costeo-tela"
                    />
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Procesos (maquila/estampado/bordado)</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {moneda(data.teorico.procesos)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      step="0.01"
                      value={procesosCost}
                      onChange={(e) => setProcesosCost(e.target.value)}
                      disabled={!puedeCapturar || data.noCostear}
                      className="ml-auto w-32 text-right"
                      data-testid="costeo-procesos"
                    />
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Avíos (costura + empaque)</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {moneda(data.teorico.avios)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      step="0.01"
                      value={aviosCost}
                      onChange={(e) => setAviosCost(e.target.value)}
                      disabled={!puedeCapturar || data.noCostear}
                      className="ml-auto w-32 text-right"
                      data-testid="costeo-avios"
                    />
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <div className="space-y-1">
                      <span>Otros</span>
                      <Input
                        value={descOtros}
                        onChange={(e) => setDescOtros(e.target.value)}
                        placeholder="Descripción"
                        disabled={!puedeCapturar || data.noCostear}
                        className="w-56"
                        data-testid="costeo-desc-otros"
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">—</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      step="0.01"
                      value={otros}
                      onChange={(e) => setOtros(e.target.value)}
                      disabled={!puedeCapturar || data.noCostear}
                      className="ml-auto w-32 text-right"
                      data-testid="costeo-otros"
                    />
                  </TableCell>
                </TableRow>
                <TableRow className="font-semibold">
                  <TableCell>Costo total</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {moneda(data.teorico.total)}
                  </TableCell>
                  <TableCell className="text-right" data-testid="costeo-total">
                    {moneda(totalPreview)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>

            <div className="flex flex-wrap items-end gap-4">
              <Field className="w-56">
                <FieldLabel htmlFor="costeo-base">Base de prorrateo</FieldLabel>
                <SelectNativo
                  id="costeo-base"
                  value={base}
                  onChange={(e) => setBase(e.target.value as BaseProrrateo)}
                  disabled={!puedeCapturar || data.noCostear}
                  data-testid="costeo-base"
                >
                  <option value="cortado">{etiquetaBase('cortado')}</option>
                  <option value="recibido">{etiquetaBase('recibido')}</option>
                  <option value="vendido">{etiquetaBase('vendido')}</option>
                </SelectNativo>
              </Field>
              <div className="pb-2 text-sm">
                <span className="text-muted-foreground">Costo unitario ({cantBase} pzas): </span>
                <span className="text-lg font-semibold" data-testid="costeo-unitario">
                  {moneda(unitPreview)}
                </span>
              </div>
            </div>

            <Field className="max-w-xl">
              <FieldLabel htmlFor="costeo-obs">Observaciones</FieldLabel>
              <Input
                id="costeo-obs"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                disabled={!puedeCapturar || data.noCostear}
                data-testid="costeo-obs"
              />
            </Field>

            {puedeCapturar && (
              <Button
                type="button"
                onClick={alGuardar}
                disabled={data.noCostear || guardar.isPending}
                data-testid="costeo-guardar"
              >
                {guardar.isPending ? 'Guardando…' : 'Guardar costo'}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
