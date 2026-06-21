import { PackagePlus, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { useColores } from '@/api/colores';
import { useOrdenesCompra } from '@/api/ordenes-compra';
import { useRecepcionesDeOc, useRecibir, useReversarRecepcion } from '@/api/recepciones';
import { useTelas } from '@/api/telas';
import type { OrdenCompra, OrdenCompraLinea, Recepcion, RecepcionLineaEntrada } from '@/api/tipos';
import { Badge } from '@/components/ui/badge';
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

/** Un componente del lote en captura (tela + cantidad). */
interface ComponenteCaptura {
  idTela: number;
  cantidad: string;
}

/** Estado de captura de UN renglón de OC en la recepción. */
interface CapturaRenglon {
  /** ¿Se incluye este renglón en la recepción? */
  incluir: boolean;
  /** Cantidad a recibir (en la presentación de la OC). */
  cantidad: string;
  /** Color del lote (solo telas, D5). */
  idColor: string;
  /** Clave del lote (opcional; el backend la autogenera). */
  claveLote: string;
  /** Componentes del lote (solo telas; arranca con la tela de la OC). */
  componentes: ComponenteCaptura[];
}

/**
 * RECEPCIÓN de compras (F4-E3, R7). Selecciona una OC AUTORIZADA (o recibida parcial) y recibe su
 * material (parcial o total): captura factura, almacén destino y la cantidad por renglón; para los
 * renglones de TELA, captura el lote (color + 1..N componentes del mismo lote, D5 — arranca con 1
 * componente = la tela comprada, con un botón "+ componente"). El backend convierte a unidad de
 * consumo (R1), crea el lote, mueve el kardex y recalcula el estatus de la OC. El historial de
 * recepciones de la OC se muestra abajo (con su reverso auditado, D3). `compras.recibir` gobierna.
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
  const colores = useColores({ pagina: 1, porPagina: 500, ordenarPor: 'nombre', direccion: 'asc' });
  // Catálogo de telas para elegir los componentes ACOMPAÑANTES del lote (D5, M1): cualquier tela,
  // no solo la comprada en la línea.
  const telas = useTelas({ pagina: 1, porPagina: 500, ordenarPor: 'nombre', direccion: 'asc' });
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
        idColor: '',
        claveLote: '',
        componentes:
          linea.idTela !== null ? [{ idTela: linea.idTela, cantidad: String(linea.cantidad) }] : [],
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

  function agregarComponente(idLinea: number): void {
    setCaptura((prev) => {
      const r = prev[idLinea];
      if (r === undefined) return prev;
      return {
        ...prev,
        [idLinea]: { ...r, componentes: [...r.componentes, { idTela: 0, cantidad: '' }] },
      };
    });
  }

  function quitarComponente(idLinea: number, indice: number): void {
    setCaptura((prev) => {
      const r = prev[idLinea];
      if (r === undefined) return prev;
      return {
        ...prev,
        [idLinea]: { ...r, componentes: r.componentes.filter((_, i) => i !== indice) },
      };
    });
  }

  function actualizarComponente(
    idLinea: number,
    indice: number,
    cambios: Partial<ComponenteCaptura>,
  ): void {
    setCaptura((prev) => {
      const r = prev[idLinea];
      if (r === undefined) return prev;
      return {
        ...prev,
        [idLinea]: {
          ...r,
          componentes: r.componentes.map((c, i) => (i === indice ? { ...c, ...cambios } : c)),
        },
      };
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
        if (r.idColor === '') {
          toast.error(`Elige el color del lote de "${descripcionMaterial(linea)}".`);
          return;
        }
        const componentes = r.componentes
          .filter((c) => c.idTela > 0 && Number(c.cantidad) > 0)
          .map((c) => ({ idTela: c.idTela, cantidad: Number(c.cantidad) }));
        if (componentes.length === 0) {
          toast.error(
            `El lote de "${descripcionMaterial(linea)}" necesita al menos un componente.`,
          );
          return;
        }
        lineas.push({
          idOrdenCompraLinea: linea.id,
          cantidad,
          lote: {
            idColor: Number(r.idColor),
            ...(r.claveLote.trim().length > 0 ? { clave: r.claveLote.trim() } : {}),
            componentes,
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
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
          <PackagePlus className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Recepción de compra</h1>
          <p className="text-sm text-muted-foreground">
            Recibe (parcial o total) el material de una orden de compra autorizada: crea el lote de
            la tela y da entrada al inventario.
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
                            <Badge variant="outline">{tipo}</Badge>
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
                                <Field>
                                  <FieldLabel htmlFor={`rec-color-${linea.id}`}>
                                    Color del lote
                                  </FieldLabel>
                                  <SelectNativo
                                    id={`rec-color-${linea.id}`}
                                    value={r.idColor}
                                    onChange={(e) =>
                                      actualizar(linea.id, { idColor: e.target.value })
                                    }
                                    disabled={!puedeRecibir}
                                    data-testid={`rec-color-${linea.id}`}
                                  >
                                    <option value="">Elige el color…</option>
                                    {(colores.data?.datos ?? []).map((c) => (
                                      <option key={c.id} value={String(c.id)}>
                                        {c.nombre}
                                      </option>
                                    ))}
                                  </SelectNativo>
                                </Field>
                              ) : null}
                            </div>

                            {tipo === 'tela' ? (
                              <div className="rounded-md bg-muted/40 p-3">
                                <div className="mb-2 flex items-center justify-between">
                                  <span className="text-xs font-medium text-muted-foreground">
                                    Componentes del lote (mismo lote/color)
                                  </span>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => agregarComponente(linea.id)}
                                    disabled={!puedeRecibir}
                                    data-testid={`rec-add-comp-${linea.id}`}
                                  >
                                    <Plus className="size-4" aria-hidden /> componente
                                  </Button>
                                </div>
                                <div className="space-y-2">
                                  {r.componentes.map((comp, i) => (
                                    <div key={i} className="flex items-center gap-2">
                                      <SelectNativo
                                        aria-label="Tela del componente"
                                        value={comp.idTela > 0 ? String(comp.idTela) : ''}
                                        onChange={(e) =>
                                          actualizarComponente(linea.id, i, {
                                            idTela: Number(e.target.value),
                                          })
                                        }
                                        disabled={!puedeRecibir}
                                        className="flex-1"
                                      >
                                        <option value="">Elige la tela…</option>
                                        {/* Catálogo completo (M1): el primer componente arranca con
                                            la tela comprada, pero los acompañantes (D5) eligen
                                            cualquier tela (felpa + cardigan, etc.). */}
                                        {(telas.data?.datos ?? []).map((t) => (
                                          <option key={t.id} value={String(t.id)}>
                                            {t.nombre}
                                          </option>
                                        ))}
                                      </SelectNativo>
                                      <Input
                                        type="number"
                                        min="0"
                                        step="any"
                                        aria-label="Cantidad del componente"
                                        value={comp.cantidad}
                                        onChange={(e) =>
                                          actualizarComponente(linea.id, i, {
                                            cantidad: e.target.value,
                                          })
                                        }
                                        disabled={!puedeRecibir}
                                        className="w-32"
                                      />
                                      {r.componentes.length > 1 ? (
                                        <Button
                                          type="button"
                                          size="icon"
                                          variant="ghost"
                                          onClick={() => quitarComponente(linea.id, i)}
                                          disabled={!puedeRecibir}
                                          aria-label="Quitar componente"
                                        >
                                          <Trash2 className="size-4" aria-hidden />
                                        </Button>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
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
                        <Badge variant="destructive">Reversada</Badge>
                      ) : (
                        <Badge variant="secondary">Activa</Badge>
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
