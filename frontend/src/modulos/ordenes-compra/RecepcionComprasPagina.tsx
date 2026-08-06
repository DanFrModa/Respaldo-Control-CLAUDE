import { RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { useOrdenesCompra } from '@/api/ordenes-compra';
import { useRecepcionesDeOc, useRecibir, useReversarRecepcion } from '@/api/recepciones';
import { useTela } from '@/api/telas';
import type { OrdenCompra, OrdenCompraLinea, Recepcion, RecepcionLineaEntrada } from '@/api/tipos';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useSesion } from '@/sesion/useSesion';

import { descripcionMaterial, EstatusOcBadge, fechaCortaOc } from './piezas';

/** Fecha de hoy en YYYY-MM-DD (zona local). */
function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Tipo del material de un renglón de OC (decide qué captura pide la recepción). */
function tipoLinea(linea: OrdenCompraLinea): 'tela' | 'avio' | 'libre' {
  if (linea.idTela !== null) return 'tela';
  if (linea.idAvio !== null) return 'avio';
  return 'libre';
}

/** Estado de captura de UN renglón de OC en la recepción. */
interface CapturaRenglon {
  /** ¿Se incluye este renglón en la recepción? */
  incluir: boolean;
  /** Cantidad de CUERPO a recibir (en la presentación de la OC). */
  cantidad: string;
  /** COLOR de la tela que llegó (B1: obligatorio en telas — la OC no lo define). */
  idTelaColor: string;
  /** Cantidad del COMPLEMENTO (cardigan) que llegó junto (solo telas que lo llevan). */
  cantidadComplemento: string;
  /** Número de lote del PROVEEDOR de la partida (opcional). */
  loteProveedor: string;
  /** Precio unitario del COMPLEMENTO (el cardigan tiene su propio precio; la OC trae uno solo). */
  precioComplemento: string;
}

/**
 * Captura POR COLOR de una línea de TELA de la recepción (B1). Lee la tela EXACTA de la línea de OC
 * por su id (`GET /telas/:id`, que ya trae sus colores hijos) — NO por búsqueda paginada: con
 * cientos de telas la página podía no traer la buscada y el select de color se quedaba vacío
 * mintiendo con "esta tela no tiene colores". Pide:
 *  • el COLOR que llegó — OBLIGATORIO: la OC se pide por tela y no lo determina (regla explícita
 *    de B1, el backend la re-exige);
 *  • la cantidad del COMPLEMENTO (cardigan), sólo si la tela lo lleva (viaja JUNTO al cuerpo);
 *  • su PRECIO unitario (la OC trae un solo precio por línea, que es el del cuerpo) — opcional,
 *    prellenado con el del catálogo del color como sugerencia; viaja al kardex como
 *    `costoUnitComplemento`;
 *  • el número de lote del PROVEEDOR de la partida que se creará (opcional, buscable después).
 * Presentación pura (A1): valida el backend.
 */
function CapturaTelaPorColor({
  idLinea,
  idTela,
  idTelaColor,
  cantidadComplemento,
  precioComplemento,
  loteProveedor,
  soloLectura,
  alCambiar,
}: {
  idLinea: number;
  idTela: number;
  idTelaColor: string;
  cantidadComplemento: string;
  precioComplemento: string;
  loteProveedor: string;
  soloLectura: boolean;
  alCambiar: (cambios: Partial<CapturaRenglon>) => void;
}): React.JSX.Element {
  // La tela EXACTA de la línea de OC, con sus colores hijos (endpoint por id, sin búsquedas).
  const consulta = useTela(idTela);
  const tela = consulta.data;
  const colores = tela?.colores ?? [];
  const llevaComplemento = tela?.nombreComplemento != null;

  /** Al elegir el color, sugiere el precio del complemento del catálogo (editable). */
  function elegirColor(valor: string): void {
    const color = colores.find((c) => String(c.id) === valor);
    alCambiar({
      idTelaColor: valor,
      precioComplemento: color?.precioComplemento == null ? '' : String(color.precioComplemento),
    });
  }

  return (
    <>
      <Field>
        <FieldLabel htmlFor={`rec-color-${idLinea}`}>Color que llegó</FieldLabel>
        <SelectNativo
          id={`rec-color-${idLinea}`}
          value={idTelaColor}
          onChange={(e) => elegirColor(e.target.value)}
          disabled={soloLectura || consulta.isError}
          data-testid={`rec-color-${idLinea}`}
        >
          {/* El estado de ERROR se distingue del de "sin colores": si la lectura de la tela falló
              (403/500/red), decirle al usuario que no hay colores sería MENTIRLE. */}
          <option value="">
            {consulta.isPending
              ? 'Cargando colores…'
              : consulta.isError
                ? 'No se pudo cargar la tela'
                : colores.length === 0
                  ? 'Esta tela no tiene colores capturados'
                  : 'Elige el color…'}
          </option>
          {colores.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.nombre}
              {c.pantone != null ? ` · ${c.pantone}` : ''}
            </option>
          ))}
        </SelectNativo>
        {consulta.isError ? (
          <div
            className="flex flex-wrap items-center gap-2 text-xs text-destructive"
            role="alert"
            data-testid={`rec-color-error-${idLinea}`}
          >
            <span>No se pudieron cargar los colores de la tela: {consulta.error.message}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void consulta.refetch()}
              data-testid={`rec-color-reintentar-${idLinea}`}
            >
              Reintentar
            </Button>
          </div>
        ) : null}
      </Field>
      {llevaComplemento ? (
        <Field>
          <FieldLabel htmlFor={`rec-compl-${idLinea}`}>
            {tela?.nombreComplemento} recibido
          </FieldLabel>
          <Input
            id={`rec-compl-${idLinea}`}
            type="number"
            min="0"
            step="any"
            value={cantidadComplemento}
            onChange={(e) => alCambiar({ cantidadComplemento: e.target.value })}
            placeholder="0"
            disabled={soloLectura}
            data-testid={`rec-compl-${idLinea}`}
          />
        </Field>
      ) : null}
      {llevaComplemento ? (
        <Field>
          <FieldLabel htmlFor={`rec-precio-compl-${idLinea}`}>
            Precio {(tela?.nombreComplemento ?? '').toLowerCase()}
          </FieldLabel>
          <Input
            id={`rec-precio-compl-${idLinea}`}
            type="number"
            min="0"
            step="any"
            value={precioComplemento}
            onChange={(e) => alCambiar({ precioComplemento: e.target.value })}
            placeholder="Del catálogo"
            disabled={soloLectura}
            data-testid={`rec-precio-compl-${idLinea}`}
          />
        </Field>
      ) : null}
      <Field>
        <FieldLabel htmlFor={`rec-lote-prov-${idLinea}`}>Lote del proveedor</FieldLabel>
        <Input
          id={`rec-lote-prov-${idLinea}`}
          value={loteProveedor}
          onChange={(e) => alCambiar({ loteProveedor: e.target.value })}
          placeholder="Opcional"
          disabled={soloLectura}
          data-testid={`rec-lote-prov-${idLinea}`}
        />
      </Field>
    </>
  );
}

/**
 * RECEPCIÓN de compras (F4-E3, R7; reescrita en B1). Selecciona una OC AUTORIZADA (o recibida
 * parcial) y recibe su material (parcial o total): captura factura, almacén destino y la cantidad
 * por renglón. Para los renglones de TELA la captura es POR COLOR (el inventario de telas opera por
 * tela+color desde A2): se EXIGE el color que llegó — la OC se pide por tela y no lo define —, se
 * captura junto el COMPLEMENTO (cardigan) si la tela lo lleva y, opcionalmente, el lote del
 * proveedor; el backend crea la PARTIDA, convierte a unidad de consumo (R1), mueve el kardex por
 * color y recalcula el estatus de la OC. El historial de recepciones se muestra abajo (con su
 * reverso auditado, D3). `compras.recibir` gobierna.
 */
export function RecepcionComprasPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeRecibir = tienePermiso('compras.recibir');

  const [idOc, setIdOc] = useState<string>('');
  const [idAlmacen, setIdAlmacen] = useState<string>('');
  const [factura, setFactura] = useState('');
  const [fecha, setFecha] = useState(hoy());
  const [observaciones, setObservaciones] = useState('');
  const [captura, setCaptura] = useState<Record<number, CapturaRenglon>>({});

  // OC recibibles: autorizadas o recibidas parcialmente (lo que el backend acepta, decisión b).
  const ocsAutorizadas = useOrdenesCompra({
    pagina: 1,
    porPagina: 100,
    estatus: 'autorizada',
    ordenarPor: 'numCompra',
    direccion: 'desc',
  });
  const ocsParciales = useOrdenesCompra({
    pagina: 1,
    porPagina: 100,
    estatus: 'recibida_parcial',
    ordenarPor: 'numCompra',
    direccion: 'desc',
  });
  const ocsRecibibles = useMemo<OrdenCompra[]>(
    () => [...(ocsAutorizadas.data?.datos ?? []), ...(ocsParciales.data?.datos ?? [])],
    [ocsAutorizadas.data, ocsParciales.data],
  );

  const ocSeleccionada = ocsRecibibles.find((o) => String(o.id) === idOc);

  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });
  const recepciones = useRecepcionesDeOc(ocSeleccionada?.id);
  const recibir = useRecibir();
  const reversar = useReversarRecepcion();

  /** Reinicia la captura al elegir una OC (un renglón por línea, telas con su componente base). */
  function elegirOc(valor: string): void {
    setIdOc(valor);
    setCaptura({});
    const oc = ocsRecibibles.find((o) => String(o.id) === valor);
    if (oc === undefined) return;
    const inicial: Record<number, CapturaRenglon> = {};
    for (const linea of oc.lineas) {
      inicial[linea.id] = {
        incluir: false,
        cantidad: String(linea.cantidad),
        idTelaColor: '',
        cantidadComplemento: '',
        precioComplemento: '',
        loteProveedor: '',
      };
    }
    setCaptura(inicial);
  }

  function actualizar(idLinea: number, cambios: Partial<CapturaRenglon>): void {
    setCaptura((prev) => {
      const r = prev[idLinea];
      if (r === undefined) return prev;
      return { ...prev, [idLinea]: { ...r, ...cambios } };
    });
  }

  const lineasIncluidas = ocSeleccionada
    ? ocSeleccionada.lineas.filter((l) => captura[l.id]?.incluir)
    : [];

  function guardar(): void {
    if (ocSeleccionada === undefined || idAlmacen === '') return;
    const lineas: RecepcionLineaEntrada[] = [];
    for (const linea of ocSeleccionada.lineas) {
      const r = captura[linea.id];
      if (r === undefined || !r.incluir) continue;
      const cantidad = Number(r.cantidad);
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        toast.error(`Captura una cantidad válida para "${descripcionMaterial(linea)}".`);
        return;
      }
      if (tipoLinea(linea) === 'tela') {
        // B1: el color es OBLIGATORIO (el backend lo re-exige; aquí sólo evitamos el viaje).
        if (r.idTelaColor === '') {
          toast.error(`Elige el color que llegó de "${descripcionMaterial(linea)}".`);
          return;
        }
        const complemento = Number(r.cantidadComplemento);
        const precioComplemento = Number(r.precioComplemento);
        lineas.push({
          idOrdenCompraLinea: linea.id,
          cantidad,
          telaColor: {
            idTelaColor: Number(r.idTelaColor),
            ...(r.cantidadComplemento.trim().length > 0 && Number.isFinite(complemento)
              ? { cantidadComplemento: complemento }
              : {}),
            // El precio del cardigan (la OC sólo trae el del cuerpo): opcional, va al kardex.
            ...(r.precioComplemento.trim().length > 0 && Number.isFinite(precioComplemento)
              ? { precioUnitComplemento: precioComplemento }
              : {}),
            ...(r.loteProveedor.trim().length > 0 ? { loteProveedor: r.loteProveedor.trim() } : {}),
          },
        });
      } else {
        lineas.push({ idOrdenCompraLinea: linea.id, cantidad });
      }
    }
    if (lineas.length === 0) {
      toast.error('Marca al menos un renglón para recibir.');
      return;
    }
    recibir.mutate(
      {
        idOrdenCompra: ocSeleccionada.id,
        cuerpo: {
          idOrdenCompra: ocSeleccionada.id,
          idAlmacen: Number(idAlmacen),
          fecha,
          ...(factura.trim().length > 0 ? { factura: factura.trim() } : {}),
          ...(observaciones.trim().length > 0 ? { observaciones: observaciones.trim() } : {}),
          lineas,
        },
      },
      {
        onSuccess: (rec) => {
          toast.success(`Recepción #${rec.folio} registrada (OC ${ocSeleccionada.numCompra}).`);
          // Reinicia la captura tras recibir (la OC puede pasar a parcial/total).
          elegirOc(idOc);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function reversarRecepcion(rec: Recepcion): void {
    if (ocSeleccionada === undefined) return;
    const motivo = window.prompt('Motivo del reverso de la recepción:');
    if (motivo === null || motivo.trim().length === 0) return;
    reversar.mutate(
      { id: rec.id, idOrdenCompra: ocSeleccionada.id, cuerpo: { motivo: motivo.trim() } },
      {
        onSuccess: () => toast.success(`Recepción #${rec.folio} reversada.`),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const totalRecibir = lineasIncluidas.reduce(
    (s, l) => s + Number(captura[l.id]?.cantidad || 0),
    0,
  );
  const puedeGuardar =
    puedeRecibir &&
    ocSeleccionada !== undefined &&
    idAlmacen !== '' &&
    lineasIncluidas.length > 0 &&
    !recibir.isPending;

  return (
    <div className="h-full overflow-y-auto space-y-6 p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Recepción de compra
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Recibe (parcial o total) el material de una OC autorizada: crea el lote de la tela y da
            entrada al inventario
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Orden de compra</CardTitle>
            <CardDescription>
              Solo se reciben OC autorizadas o recibidas parcialmente.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field>
              <FieldLabel htmlFor="rec-oc">Orden de compra</FieldLabel>
              <SelectNativo
                id="rec-oc"
                value={idOc}
                onChange={(e) => elegirOc(e.target.value)}
                disabled={!puedeRecibir}
                data-testid="rec-oc"
              >
                <option value="">Elige la OC…</option>
                {ocsRecibibles.map((o) => (
                  <option key={o.id} value={String(o.id)}>
                    OC {o.numCompra} · {o.proveedor}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            {ocSeleccionada !== undefined ? (
              <div className="space-y-2 rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Estatus</span>
                  <EstatusOcBadge estatus={ocSeleccionada.estatus} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Proveedor</span>
                  <span>{ocSeleccionada.proveedor}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Fecha</span>
                  <span>{fechaCortaOc(ocSeleccionada.fecha)}</span>
                </div>
              </div>
            ) : null}

            <Field>
              <FieldLabel htmlFor="rec-almacen">Almacén destino</FieldLabel>
              <SelectNativo
                id="rec-almacen"
                value={idAlmacen}
                onChange={(e) => setIdAlmacen(e.target.value)}
                disabled={!puedeRecibir}
                data-testid="rec-almacen"
              >
                <option value="">Elige el almacén…</option>
                {(almacenes.data?.datos ?? []).map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="rec-factura">Factura</FieldLabel>
                <Input
                  id="rec-factura"
                  value={factura}
                  onChange={(e) => setFactura(e.target.value)}
                  placeholder="Opcional"
                  disabled={!puedeRecibir}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="rec-fecha">Fecha</FieldLabel>
                <Input
                  id="rec-fecha"
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  disabled={!puedeRecibir}
                  data-testid="rec-fecha"
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="rec-obs">Observaciones</FieldLabel>
              <Input
                id="rec-obs"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                placeholder="Opcional"
                disabled={!puedeRecibir}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {ocSeleccionada ? `Renglones de la OC ${ocSeleccionada.numCompra}` : 'Renglones'}
            </CardTitle>
            <CardDescription>
              {ocSeleccionada
                ? 'Marca lo que llegó y captura la cantidad; para telas, captura el lote.'
                : 'Selecciona una orden de compra para capturar su recepción.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {ocSeleccionada === undefined ? (
              <p className="text-sm text-muted-foreground">Sin orden seleccionada.</p>
            ) : (
              <>
                <ul className="space-y-3">
                  {ocSeleccionada.lineas.map((linea) => {
                    const r = captura[linea.id];
                    if (r === undefined) return null;
                    const tipo = tipoLinea(linea);
                    return (
                      <li key={linea.id} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label className="flex items-center gap-2 text-sm font-medium">
                            <input
                              type="checkbox"
                              checked={r.incluir}
                              onChange={(e) => actualizar(linea.id, { incluir: e.target.checked })}
                              disabled={!puedeRecibir}
                              data-testid={`rec-incluir-${linea.id}`}
                            />
                            {descripcionMaterial(linea)}
                            <ChipEstado tono="neutro" sinPunto>
                              {tipo}
                            </ChipEstado>
                          </label>
                          <span className="text-xs text-muted-foreground">
                            Pedido: {Number(linea.cantidad).toLocaleString('es-MX')}{' '}
                            {linea.unidad ?? ''}
                          </span>
                        </div>

                        {r.incluir ? (
                          <div className="mt-3 space-y-3">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Field>
                                <FieldLabel htmlFor={`rec-cant-${linea.id}`}>
                                  Cantidad recibida
                                </FieldLabel>
                                <Input
                                  id={`rec-cant-${linea.id}`}
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={r.cantidad}
                                  onChange={(e) =>
                                    actualizar(linea.id, { cantidad: e.target.value })
                                  }
                                  disabled={!puedeRecibir}
                                  data-testid={`rec-cant-${linea.id}`}
                                />
                              </Field>
                              {tipo === 'tela' ? (
                                <CapturaTelaPorColor
                                  idLinea={linea.id}
                                  idTela={linea.idTela as number}
                                  idTelaColor={r.idTelaColor}
                                  cantidadComplemento={r.cantidadComplemento}
                                  precioComplemento={r.precioComplemento}
                                  loteProveedor={r.loteProveedor}
                                  soloLectura={!puedeRecibir}
                                  alCambiar={(cambios) => actualizar(linea.id, cambios)}
                                />
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>

                <div className="flex items-center justify-between gap-3 border-t pt-3">
                  <span className="text-sm text-muted-foreground">
                    Renglones a recibir: <strong>{lineasIncluidas.length}</strong> · Total:{' '}
                    <strong>{totalRecibir.toLocaleString('es-MX')}</strong>
                  </span>
                  <Button onClick={guardar} disabled={!puedeGuardar} data-testid="rec-guardar">
                    {recibir.isPending ? 'Recibiendo…' : 'Registrar recepción'}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {ocSeleccionada !== undefined ? (
        <Card>
          <CardHeader>
            <CardTitle>Historial de recepciones</CardTitle>
            <CardDescription>
              Recepciones de la OC {ocSeleccionada.numCompra} (la reversa neutraliza el inventario
              sin borrar nada).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(recepciones.data?.recepciones ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin recepciones todavía.</p>
            ) : (
              <ul className="space-y-2" data-testid="rec-historial">
                {(recepciones.data?.recepciones ?? []).map((rec) => (
                  <li
                    key={rec.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">Recepción #{rec.folio}</span>
                      <span className="text-muted-foreground">{fechaCortaOc(rec.fecha)}</span>
                      {rec.factura !== null ? (
                        <span className="text-muted-foreground">· Factura {rec.factura}</span>
                      ) : null}
                      <span className="text-muted-foreground">· {rec.almacen}</span>
                      <span className="text-muted-foreground">
                        · {rec.lineas.length} renglón(es)
                      </span>
                      {rec.reversada ? (
                        <ChipEstado tono="crit">Reversada</ChipEstado>
                      ) : (
                        <ChipEstado tono="ok">Activa</ChipEstado>
                      )}
                    </div>
                    {!rec.reversada && puedeRecibir ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => reversarRecepcion(rec)}
                        disabled={reversar.isPending}
                        data-testid={`rec-reversar-${rec.id}`}
                      >
                        <RotateCcw className="size-4" aria-hidden /> Reversar
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
