import { AlertTriangle, ShoppingCart } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { useCostoOrden, useCostoRealOrden, useGuardarCostoOrden } from '@/api/costos';
import { useBuscarOrdenes } from '@/api/ordenes-consulta';
import type { BaseProrrateo, CostoOrden, CostoOrdenGuardar, CostoRealMaterial } from '@/api/tipos';
import { CajonDetalle } from '@/components/dominio/CajonDetalle';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { AvisoAlta } from '@/components/ui/aviso-alta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { formatearFecha } from '@/lib/formato';
import { useDebounce } from '@/lib/useDebounce';
import { useSesion } from '@/sesion/useSesion';

import { etiquetaBase, moneda } from './comun';

/** Convierte un texto de input a número (vacío/no numérico → 0). */
function num(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}

/** Formatea una cantidad de material (hasta 4 decimales, sin ceros de relleno). */
function cantidad(valor: number, unidad?: string | null): string {
  const n = valor.toLocaleString('es-MX', { maximumFractionDigits: 4 });
  return unidad === null || unidad === undefined || unidad === '' ? n : `${n} ${unidad}`;
}

/**
 * Frase en lenguaje de negocio de DÓNDE salió la base del cálculo del real (lo que el backend manda
 * en `origenRequerido` + `piezasBase`). Daniel tiene que poder leer, sin jerga, sobre qué se calculó.
 */
function fraseBaseDelCalculo(
  origen: CostoOrden['real']['origenRequerido'],
  piezas: number,
): string {
  const sobre = `sobre ${piezas.toLocaleString('es-MX')} pzas cortadas`;
  if (piezas <= 0) {
    return 'La orden aún no tiene corte: solo cuenta lo comprado';
  }
  return origen === 'snapshot-mrp'
    ? `Consumo de la explosión de materiales, ajustado ${sobre}`
    : origen === 'receta'
      ? `Consumo de la receta del modelo, ${sobre}`
      : `El modelo no tiene receta de costo: solo cuenta lo comprado`;
}

/** Etiqueta en español del origen del precio con el que se valuó un material. */
function etiquetaOrigen(origen: CostoRealMaterial['origenPrecio']): string {
  return origen === 'compra-directa'
    ? 'Comprado para esta orden'
    : origen === 'ultimo-precio-compra'
      ? 'Último precio de compra'
      : origen === 'catalogo'
        ? 'Precio de catálogo'
        : 'Sin precio';
}

/**
 * COSTEO DE ORDEN (F7-E1; doc 06-Costos-y-EDR §3): busca una orden y captura su costo. Muestra los
 * TRES números lado a lado —
 *  • **Real de compras**: lo que de verdad se compró en órdenes de compra para esta orden, más el
 *    material sin compra propia (genéricos, compras compartidas) valuado a último precio de compra.
 *    Es el default al guardar cuando la orden tiene compras (petición de Daniel, 26-jul-2026).
 *  • **Teórico**: la receta del modelo × los precios de catálogo (lo de siempre).
 *  • **Capturado**: lo que el usuario confirma o ajusta; con eso se arma el costo total y el unitario.
 * El desglose del real (qué se compró, a quién y a qué precio) se abre en un cajón, bajo demanda.
 * Respeta `noCostear` (no deja guardar). Ver con `costos.ver`; guardar con `costos.capturar`.
 * Importes en "—" sin `consultas.ver-importes`.
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

  const [desgloseAbierto, setDesgloseAbierto] = useState(false);
  const desglose = useCostoRealOrden(idOrden, desgloseAbierto);

  const [telaCost, setTelaCost] = useState('');
  const [procesosCost, setProcesosCost] = useState('');
  const [aviosCost, setAviosCost] = useState('');
  const [otros, setOtros] = useState('');
  const [descOtros, setDescOtros] = useState('');
  const [observaciones, setObservaciones] = useState('');
  // 0.061: el default es `recibido` (§Post-F9.154(b)) — las faltantes se le cobran al maquilero y
  // las incompletas son merma; primeras y segundas sí se venden.
  const [base, setBase] = useState<BaseProrrateo>('recibido');

  // Sincroniza el formulario con el costo cargado. Si aún no se ha costeado, el valor propuesto para
  // tela/avíos es el REAL de compras cuando la orden tiene compras (Daniel), y el teórico si no.
  const data = costo.data;
  useEffect(() => {
    if (!data) return;
    const g = data.guardado;
    const propuestaTela = data.real.hayCompras ? data.real.tela : data.teorico.tela;
    const propuestaAvios = data.real.hayCompras ? data.real.avios : data.teorico.avios;
    setTelaCost(String(g?.telaCost ?? propuestaTela ?? ''));
    setProcesosCost(String(g?.procesosCost ?? data.teorico.procesos ?? ''));
    setAviosCost(String(g?.aviosCost ?? propuestaAvios ?? ''));
    setOtros(String(g?.otros ?? ''));
    setDescOtros(g?.descOtros ?? '');
    setObservaciones(g?.observaciones ?? '');
    setBase(g?.baseProrrateo ?? 'recibido');
  }, [data]);

  function elegir(id: number): void {
    setParams({ idOrden: String(id) });
    setBusqueda('');
    setDesgloseAbierto(false);
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

  /** Copia a los campos capturables los materiales de un origen (real de compras o teórico). */
  function copiarMateriales(origen: 'real' | 'teorico'): void {
    if (!data) return;
    const tela = origen === 'real' ? data.real.tela : data.teorico.tela;
    const avios = origen === 'real' ? data.real.avios : data.teorico.avios;
    setTelaCost(String(tela ?? ''));
    setAviosCost(String(avios ?? ''));
  }

  // ⭐ 0.061: con la orden CERRADA el costo está CONGELADO. Se muestra el DIVISOR y el unitario que
  // devuelve el SERVIDOR (los del cierre), no la vista previa de lo que se teclea — porque ya no se
  // puede teclear. El backend rechaza la captura igual; esto sólo evita ofrecer campos que van a
  // rebotar.
  const ordenCerrada = data?.ordenCerrada === true;
  // Las piezas del divisor. ⚠️ Con la orden cerrada NO se re-derivan de las cantidades vivas: si
  // llegara otro recibo, el número de piezas junto al unitario cambiaría mientras el importe no
  // —y la pantalla estaría diciendo dos cosas incompatibles a la vez—.
  const cantBase =
    data === undefined
      ? 0
      : ordenCerrada
        ? data.unitario.cantidadBase
        : base === 'cortado'
          ? data.cantidades.cortado
          : base === 'recibido'
            ? data.cantidades.recibido
            : data.cantidades.vendido;
  const totalPreview = num(telaCost) + num(procesosCost) + num(aviosCost) + num(otros);
  const unitPreview = cantBase > 0 ? totalPreview / cantBase : null;
  // ⭐ Un SOLO booleano para todo lo que se puede capturar (0.061 le sumó la orden cerrada). Antes
  // cada campo repetía `!puedeCapturar || data.noCostear`, y agregar una tercera razón habría sido
  // siete oportunidades de olvidar una. El backend decide igual (A1): esto es la cortesía de no
  // ofrecer un campo que va a rebotar.
  const capturaBloqueada = !puedeCapturar || data?.noCostear === true || ordenCerrada;
  const congeladoEn = data?.unitario.congeladoEn ?? null;
  // ⭐ 0.061: cuando NO hay unitario, la frase la redacta el SERVIDOR (`textoSinUnitario`), no esta
  // pantalla: así la lista de costos y la ficha dicen exactamente lo mismo.
  const sinUnitario =
    (ordenCerrada ? data?.unitario.costoUnitario : unitPreview) === null
      ? (data?.unitario.textoSinUnitario ?? null)
      : null;

  return (
    <div className="h-full overflow-y-auto space-y-6 p-4 md:p-6" data-testid="costeo-orden">
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Costeo de orden
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Real de compras vs teórico; el total se arma con lo capturado
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

            {/* ⭐ 0.061: la orden CERRADA es de solo lectura y su costo está congelado. Se avisa
                arriba del todo para que nadie teclee y se entere al guardar. */}
            {ordenCerrada && (
              <p
                className="flex items-center gap-2 rounded-md border border-border bg-muted/50 p-3 text-sm"
                role="status"
                data-testid="costeo-orden-cerrada"
              >
                <AlertTriangle className="size-4" aria-hidden />
                Esta orden está <b>CERRADA</b>: su costo quedó congelado y no se puede capturar.
                Para cambiarlo hay que reabrirla desde la ficha de la orden (queda auditado).
              </p>
            )}

            <div className="overflow-x-auto">
              <TablaDensa>
                <TablaDensaEncabezado>
                  <TablaDensaFila>
                    <TablaDensaHead>Componente</TablaDensaHead>
                    <TablaDensaHead numerica>Real de compras</TablaDensaHead>
                    <TablaDensaHead numerica>Teórico</TablaDensaHead>
                    <TablaDensaHead numerica>Capturado</TablaDensaHead>
                  </TablaDensaFila>
                </TablaDensaEncabezado>
                <TablaDensaCuerpo>
                  <TablaDensaFila>
                    <TablaDensaCelda>Tela</TablaDensaCelda>
                    <TablaDensaCelda numerica data-testid="costeo-real-tela">
                      {moneda(data.real.tela)}
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica className="text-muted-foreground">
                      {moneda(data.teorico.tela)}
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica>
                      <Input
                        type="number"
                        step="0.01"
                        value={telaCost}
                        onChange={(e) => setTelaCost(e.target.value)}
                        disabled={capturaBloqueada}
                        className="ml-auto w-32 text-right"
                        data-testid="costeo-tela"
                      />
                    </TablaDensaCelda>
                  </TablaDensaFila>
                  <TablaDensaFila>
                    <TablaDensaCelda>Procesos (maquila/arte)</TablaDensaCelda>
                    <TablaDensaCelda numerica className="text-muted-foreground">
                      —
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica className="text-muted-foreground">
                      {moneda(data.teorico.procesos)}
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica>
                      <Input
                        type="number"
                        step="0.01"
                        value={procesosCost}
                        onChange={(e) => setProcesosCost(e.target.value)}
                        disabled={capturaBloqueada}
                        className="ml-auto w-32 text-right"
                        data-testid="costeo-procesos"
                      />
                    </TablaDensaCelda>
                  </TablaDensaFila>
                  <TablaDensaFila>
                    <TablaDensaCelda>Avíos (costura + empaque)</TablaDensaCelda>
                    <TablaDensaCelda numerica data-testid="costeo-real-avios">
                      {moneda(data.real.avios)}
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica className="text-muted-foreground">
                      {moneda(data.teorico.avios)}
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica>
                      <Input
                        type="number"
                        step="0.01"
                        value={aviosCost}
                        onChange={(e) => setAviosCost(e.target.value)}
                        disabled={capturaBloqueada}
                        className="ml-auto w-32 text-right"
                        data-testid="costeo-avios"
                      />
                    </TablaDensaCelda>
                  </TablaDensaFila>
                  <TablaDensaFila>
                    <TablaDensaCelda>
                      <div className="space-y-1">
                        <span>Otros</span>
                        <Input
                          value={descOtros}
                          onChange={(e) => setDescOtros(e.target.value)}
                          placeholder="Descripción"
                          disabled={capturaBloqueada}
                          className="w-56"
                          data-testid="costeo-desc-otros"
                        />
                      </div>
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica className="text-muted-foreground">
                      —
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica className="text-muted-foreground">
                      —
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica>
                      <Input
                        type="number"
                        step="0.01"
                        value={otros}
                        onChange={(e) => setOtros(e.target.value)}
                        disabled={capturaBloqueada}
                        className="ml-auto w-32 text-right"
                        data-testid="costeo-otros"
                      />
                    </TablaDensaCelda>
                  </TablaDensaFila>
                  <TablaDensaFila className="font-semibold">
                    <TablaDensaCelda>Costo total</TablaDensaCelda>
                    <TablaDensaCelda numerica>{moneda(data.real.total)}</TablaDensaCelda>
                    <TablaDensaCelda numerica className="text-muted-foreground">
                      {moneda(data.teorico.total)}
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica data-testid="costeo-total">
                      {moneda(totalPreview)}
                    </TablaDensaCelda>
                  </TablaDensaFila>
                </TablaDensaCuerpo>
              </TablaDensa>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDesgloseAbierto(true)}
                data-testid="costeo-ver-desglose"
              >
                <ShoppingCart className="size-4" aria-hidden />
                Ver de dónde sale el real
              </Button>
              {!capturaBloqueada && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => copiarMateriales('real')}
                    data-testid="costeo-usar-real"
                  >
                    Usar el real de compras
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => copiarMateriales('teorico')}
                    data-testid="costeo-usar-teorico"
                  >
                    Usar el teórico
                  </Button>
                </>
              )}
              {data.real.hayCompras ? (
                <Badge variant="secondary">Esta orden tiene compras registradas</Badge>
              ) : (
                <Badge variant="outline">Sin compras ligadas a esta orden</Badge>
              )}
              <span className="text-xs text-muted-foreground" data-testid="costeo-origen-requerido">
                {fraseBaseDelCalculo(data.real.origenRequerido, data.real.piezasBase)}
              </span>
            </div>

            {data.real.avisos.length > 0 && (
              <AvisoAlta data-testid="costeo-avisos-real">
                <p className="mb-1 font-medium text-foreground">Revisa el real de compras:</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {data.real.avisos.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </AvisoAlta>
            )}

            <div className="flex flex-wrap items-end gap-4">
              <Field className="w-56">
                <FieldLabel htmlFor="costeo-base">Base de prorrateo</FieldLabel>
                <SelectNativo
                  id="costeo-base"
                  value={base}
                  onChange={(e) => setBase(e.target.value as BaseProrrateo)}
                  disabled={capturaBloqueada}
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
                  {/* 0.061: cerrada ⇒ el número CONGELADO del servidor; abierta ⇒ la vista previa
                      de lo que se está tecleando. Y si no hay unitario, la frase del servidor. */}
                  {sinUnitario ?? moneda(ordenCerrada ? data.unitario.costoUnitario : unitPreview)}
                </span>
                {congeladoEn !== null && (
                  <p className="text-xs text-muted-foreground" data-testid="costeo-congelado">
                    Congelado al cerrar la orden el {formatearFecha(congeladoEn)}. Para recalcularlo
                    hay que reabrirla.
                  </p>
                )}
              </div>
            </div>

            <Field className="max-w-xl">
              <FieldLabel htmlFor="costeo-obs">Observaciones</FieldLabel>
              <Input
                id="costeo-obs"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                disabled={capturaBloqueada}
                data-testid="costeo-obs"
              />
            </Field>

            {puedeCapturar && (
              <Button
                type="button"
                onClick={alGuardar}
                disabled={capturaBloqueada || guardar.isPending}
                data-testid="costeo-guardar"
              >
                {guardar.isPending ? 'Guardando…' : 'Guardar costo'}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Cajón: de dónde sale el REAL — material por material, con sus compras y su valuación. */}
      <CajonDetalle
        abierto={desgloseAbierto}
        alCambiarAbierto={setDesgloseAbierto}
        ancho="maximo"
        titulo="De dónde sale el real de compras"
        subtitulo={
          data === undefined
            ? undefined
            : `Orden #${String(data.folio)} · ${data.codigoModelo} · ${data.cliente}`
        }
      >
        {desglose.isPending ? (
          <p className="text-sm text-muted-foreground">Cargando el desglose…</p>
        ) : desglose.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {desglose.error.message}
          </p>
        ) : desglose.data === undefined ? null : (
          <div className="space-y-4" data-testid="costeo-desglose">
            <AvisoAlta>
              <p>
                Cada material se cuenta primero por lo que se{' '}
                <strong>compró para esta orden</strong> (órdenes de compra autorizadas). Lo que la
                orden consume y no tiene compra propia — los avíos de stock y las compras que surten
                a varias órdenes — se valúa al <strong>último precio de compra</strong>, de modo que
                cada orden se lleva su parte.
              </p>
            </AvisoAlta>

            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground uppercase">Comprado para la orden</p>
                <p className="num text-lg font-semibold">{moneda(desglose.data.importeDirecto)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground uppercase">Valuado por consumo</p>
                <p className="num text-lg font-semibold">{moneda(desglose.data.importeValuado)}</p>
              </div>
              <div className="rounded-lg border p-3 bg-primary-soft">
                <p className="text-xs text-muted-foreground uppercase">Total de materiales</p>
                <p className="num text-lg font-semibold">{moneda(desglose.data.total)}</p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              {fraseBaseDelCalculo(desglose.data.origenRequerido, desglose.data.piezasBase)}.
            </p>

            <div className="overflow-x-auto">
              <TablaDensa>
                <TablaDensaEncabezado>
                  <TablaDensaFila>
                    <TablaDensaHead>Material</TablaDensaHead>
                    <TablaDensaHead numerica>Requerido</TablaDensaHead>
                    <TablaDensaHead numerica>Comprado</TablaDensaHead>
                    <TablaDensaHead numerica>Importe comprado</TablaDensaHead>
                    <TablaDensaHead numerica>Por valuar</TablaDensaHead>
                    <TablaDensaHead numerica>Precio</TablaDensaHead>
                    <TablaDensaHead numerica>Importe valuado</TablaDensaHead>
                    <TablaDensaHead numerica>Total</TablaDensaHead>
                  </TablaDensaFila>
                </TablaDensaEncabezado>
                <TablaDensaCuerpo>
                  {desglose.data.materiales.map((m, i) => (
                    <Fragment key={`m-${String(i)}-${m.material}`}>
                      <TablaDensaFila>
                        <TablaDensaCelda>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium">{m.material}</span>
                            {m.esGenerico && (
                              <Badge variant="outline" className="text-[10px]">
                                genérico
                              </Badge>
                            )}
                            {m.tipo === 'libre' && (
                              <Badge variant="outline" className="text-[10px]">
                                compra libre — no entra al total
                              </Badge>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {etiquetaOrigen(m.origenPrecio)}
                            {m.ultimaCompra === null
                              ? ''
                              : ` · OC ${String(m.ultimaCompra.numCompra)} · ${m.ultimaCompra.proveedor}`}
                          </span>
                        </TablaDensaCelda>
                        <TablaDensaCelda numerica>
                          {cantidad(m.requerido, m.unidad)}
                        </TablaDensaCelda>
                        <TablaDensaCelda numerica>{cantidad(m.comprado, m.unidad)}</TablaDensaCelda>
                        <TablaDensaCelda numerica>{moneda(m.importeDirecto)}</TablaDensaCelda>
                        <TablaDensaCelda numerica>
                          {cantidad(m.cantidadValuada, m.unidad)}
                        </TablaDensaCelda>
                        <TablaDensaCelda numerica>{moneda(m.precioValuado)}</TablaDensaCelda>
                        <TablaDensaCelda numerica>{moneda(m.importeValuado)}</TablaDensaCelda>
                        <TablaDensaCelda numerica className="font-semibold">
                          {moneda(m.importe)}
                        </TablaDensaCelda>
                      </TablaDensaFila>
                      {m.compras.map((c) => (
                        <TablaDensaFila key={`m-${String(i)}-c-${String(c.idOrdenCompra)}`}>
                          <TablaDensaCelda
                            colSpan={8}
                            className="py-1 pl-8 text-xs text-muted-foreground"
                          >
                            OC {c.numCompra} · {c.proveedor}
                            {c.fecha === null ? '' : ` · ${c.fecha}`} ·{' '}
                            {cantidad(c.cantidad, c.unidad)} × {moneda(c.precio)} ={' '}
                            {moneda(c.importe)}
                          </TablaDensaCelda>
                        </TablaDensaFila>
                      ))}
                    </Fragment>
                  ))}
                  {desglose.data.materiales.length === 0 && (
                    <TablaDensaFila>
                      <TablaDensaCelda colSpan={8} className="text-muted-foreground">
                        Esta orden no tiene materiales ni compras registradas.
                      </TablaDensaCelda>
                    </TablaDensaFila>
                  )}
                </TablaDensaCuerpo>
              </TablaDensa>
            </div>

            {desglose.data.importeLibre !== null && desglose.data.importeLibre > 0 && (
              <p className="text-sm text-muted-foreground">
                Compras libres ligadas a la orden: {moneda(desglose.data.importeLibre)} (no entran
                al costo de materiales).
              </p>
            )}

            {desglose.data.avisos.length > 0 && (
              <AvisoAlta>
                <ul className="list-disc space-y-0.5 pl-4">
                  {desglose.data.avisos.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </AvisoAlta>
            )}
          </div>
        )}
      </CajonDetalle>
    </div>
  );
}
