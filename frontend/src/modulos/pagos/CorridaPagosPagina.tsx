import { AlertTriangle, FileText, Lock, Plus, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  useCerrarCorrida,
  useConceptosPago,
  useCorrida,
  useCorridas,
  useCrearCorrida,
  useEjecutarCorrida,
  useEliminarRenglon,
  useGuardarRenglon,
} from '@/api/pagos';
import type { CorridaDetalle, FilaCorrida, RenglonCorrida, SeccionCorrida } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import {
  TablaDensa,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import { useSesion } from '@/sesion/useSesion';

import { RelacionEjecutable } from './RelacionEjecutable';
import { RenglonPago } from './RenglonPago';
import {
  ETIQUETA_ESTADO,
  ETIQUETA_RUBRO,
  lunesDeLaSemana,
  moneda,
  nombreSegmento,
  textoTotales,
  tituloCorrida,
} from './comun';

/**
 * ⭐ LA CORRIDA SEMANAL DE PAGOS (fila 0.113) — *«una de las pantallas más importantes dentro del
 * sistema. Debe estar muy bien hecha.»*
 *
 * Es la pantalla que Daniel dibujó (§Post-F9.189(f)): *«en la pantalla donde están los saldos de
 * todos los proveedores con un campo abierto a un lado para capturar lo que se le va a pagar esa
 * semana. Y en esa misma pantalla cargar por default estos conceptos que te comento, también con el
 * campo a un lado. Y tener la posibilidad de cargar el concepto que necesito del catálogo.»*
 *
 * **UNA sola pantalla, con SECCIONES por rubro** (maquileros · proveedores · los conceptos del
 * catálogo). Partirla en dos sería meter la unión a mano, que es donde nacen los errores de su
 * Excel; y los totales de efectivo/transferencia sólo tienen sentido sobre el conjunto.
 *
 * Lo que CAMBIA por sección son las columnas de REFERENCIA —maquileros: saldo, lo que espera
 * revisión y lo recibido en la semana; proveedores: saldo y vencido; conceptos: nada—. Lo que NO
 * cambia es el campo «a pagar esta semana» y el selector efectivo/transferencia: son iguales en las
 * tres.
 *
 * ⚠️ **La referencia nunca llena el campo** (§Post-F9.189(b)). Y **cero lógica de negocio aquí**
 * (A1): el servidor arma las secciones, calcula los totales, aplica la guarda fiscal y decide qué
 * importes se ven. Esta pantalla pinta y captura.
 */
export function CorridaPagosPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeArmar = tienePermiso('pagos.corrida-armar');
  // ⭐ La relación ejecutable EXIGE ver importes: el servidor la niega sin `consultas.ver-importes`
  // (es la lista con los montos y los números de cuenta completos). Si el botón se ofreciera igual,
  // el único camino a esa pantalla terminaría en un 403 — ofrecer lo que no se puede hacer.
  const puedeVerRelacion = tienePermiso('consultas.ver-importes');

  const [idCorrida, setIdCorrida] = useState<number | null>(null);
  // La relación ejecutable se pide sólo cuando se abre: trae los números de cuenta completos.
  const [verRelacion, setVerRelacion] = useState(false);
  // ⭐ Ejecutar NO tiene marcha atrás (hoy no existe cancelación de `PagoMaquilero`), así que se
  // confirma enseñando lo que se va a mover: cuántos pagos y cuánto, por rubro y en total.
  const [confirmandoEjecutar, setConfirmandoEjecutar] = useState(false);
  const [semanaNueva, setSemanaNueva] = useState(() => lunesDeLaSemana(new Date()));
  const [segmentoNuevo, setSegmentoNuevo] = useState<'sin' | 'con'>('sin');

  const listado = useCorridas({ pagina: 1, porPagina: 50 });
  const corridas = useMemo(() => listado.data?.filas ?? [], [listado.data]);
  // Sin selección explícita se abre la más reciente: es la que se está trabajando.
  const idActivo = idCorrida ?? corridas[0]?.id ?? null;
  const detalle = useCorrida(idActivo);

  const crear = useCrearCorrida();
  const guardar = useGuardarRenglon();
  const quitar = useEliminarRenglon();
  const cerrar = useCerrarCorrida();
  const ejecutar = useEjecutarCorrida();

  const corrida = detalle.data?.corrida ?? null;
  const enBorrador = corrida?.estado === 'borrador';
  const editable = puedeArmar && enBorrador;
  const ocupado = guardar.isPending || quitar.isPending || cerrar.isPending || ejecutar.isPending;
  const bloqueos = detalle.data?.bloqueos ?? [];

  function abrirCorrida(): void {
    crear.mutate(
      { semana: semanaNueva, conFactura: segmentoNuevo === 'con' },
      {
        onSuccess: (nueva) => {
          setIdCorrida(nueva.corrida.id);
          toast.success(`Corrida ${nombreSegmento(nueva.corrida.conFactura)} abierta.`);
        },
        onError: (e) => toast.error(e.message),
      },
    );
  }

  function guardarRenglon(
    fila: FilaCorrida,
    valores: {
      monto: number;
      formaPago: 'efectivo' | 'transferencia';
      idCuenta: number | null;
      concepto: string | null;
      referencia: string | null;
      idRenglon?: number;
    },
  ): void {
    if (idActivo === null) return;
    guardar.mutate(
      {
        idCorrida: idActivo,
        cuerpo: {
          // El `origen` NO se manda: lo deriva el servidor del beneficiario y sus roles (si lo
          // mandara el cliente, un cuerpo cruzado metería el pago en el libro equivocado).
          ...(fila.idProveedor === null ? {} : { idProveedor: fila.idProveedor }),
          ...(fila.idConcepto === null ? {} : { idConcepto: fila.idConcepto }),
          monto: valores.monto,
          formaPago: valores.formaPago,
          idCuenta: valores.idCuenta,
          concepto: valores.concepto,
          referencia: valores.referencia,
        },
        ...(valores.idRenglon === undefined ? {} : { idRenglon: valores.idRenglon }),
      },
      { onError: (e) => toast.error(e.message) },
    );
  }

  return (
    <div className="h-full overflow-y-auto space-y-6 p-4 md:p-6" data-testid="corrida-pagos">
      <header>
        <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
          Corrida semanal de pagos
        </h1>
        <p className="text-[12.5px] text-muted-foreground">
          A quién se le paga esta semana y cuánto. El saldo y lo recibido van al lado, como
          referencia: el monto lo decides tú.
        </p>
      </header>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>La relación de la semana</CardTitle>
              <CardDescription>
                Dos por semana: la de <strong>con factura</strong> y la de{' '}
                <strong>sin factura</strong>.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field className="w-64">
                <FieldLabel htmlFor="corrida-selector">Corrida</FieldLabel>
                <SelectNativo
                  id="corrida-selector"
                  value={idActivo === null ? '' : String(idActivo)}
                  onChange={(e) =>
                    setIdCorrida(e.target.value === '' ? null : Number(e.target.value))
                  }
                  data-testid="corrida-selector"
                >
                  {corridas.length === 0 ? <option value="">Sin corridas todavía</option> : null}
                  {corridas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {tituloCorrida(c)}
                    </option>
                  ))}
                </SelectNativo>
              </Field>
              {puedeArmar ? (
                <>
                  <Field className="w-40">
                    <FieldLabel htmlFor="corrida-semana">Semana</FieldLabel>
                    <Input
                      id="corrida-semana"
                      type="date"
                      className="h-9"
                      value={semanaNueva}
                      onChange={(e) => setSemanaNueva(e.target.value)}
                      data-testid="corrida-semana"
                    />
                  </Field>
                  <Field className="w-40">
                    <FieldLabel htmlFor="corrida-segmento">Relación</FieldLabel>
                    <SelectNativo
                      id="corrida-segmento"
                      value={segmentoNuevo}
                      onChange={(e) => setSegmentoNuevo(e.target.value as 'sin' | 'con')}
                      data-testid="corrida-segmento"
                    >
                      <option value="sin">Sin factura</option>
                      <option value="con">Con factura</option>
                    </SelectNativo>
                  </Field>
                  <Button
                    type="button"
                    size="sm"
                    disabled={crear.isPending}
                    onClick={abrirCorrida}
                    data-testid="corrida-abrir"
                  >
                    <Plus className="size-4" /> Abrir corrida
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {detalle.isPending && idActivo !== null ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : detalle.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {detalle.error.message}
            </p>
          ) : corrida === null ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Todavía no hay ninguna corrida. Abre la de esta semana para empezar.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <ChipEstado
                    tono={
                      corrida.estado === 'ejecutada'
                        ? 'ok'
                        : corrida.estado === 'cerrada'
                          ? 'info'
                          : 'neutro'
                    }
                  >
                    {ETIQUETA_ESTADO[corrida.estado] ?? corrida.estado}
                  </ChipEstado>
                  <span className="text-sm text-muted-foreground" data-testid="corrida-totales">
                    {textoTotales(corrida.totales)} · {String(corrida.totales.renglones)} pago(s)
                  </span>
                  {/*
                    ⭐ El acceso a la RELACIÓN EJECUTABLE. Sin este botón, el único sitio con el
                    número de cuenta completo era inalcanzable y quien tenía `pagos.corrida-ver` no
                    podía hacer las transferencias (hallazgo B5). Se ofrece en cuanto la corrida
                    deja de ser borrador: es lo que finanzas recibe.
                  */}
                  {!enBorrador && puedeVerRelacion ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setVerRelacion((v) => !v)}
                      data-testid="corrida-ver-relacion"
                    >
                      <FileText className="size-4" />
                      {verRelacion ? 'Ocultar la relación' : 'Relación ejecutable'}
                    </Button>
                  ) : null}
                </div>
                {puedeArmar ? (
                  <div className="flex gap-2">
                    {enBorrador ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={ocupado || bloqueos.length > 0}
                        onClick={() =>
                          cerrar.mutate(corrida.id, {
                            onSuccess: () => toast.success('Relación cerrada.'),
                            onError: (e) => toast.error(e.message),
                          })
                        }
                        data-testid="corrida-cerrar"
                      >
                        <Lock className="size-4" /> Cerrar relación
                      </Button>
                    ) : null}
                    {corrida.estado === 'cerrada' ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={ocupado}
                        onClick={() => setConfirmandoEjecutar(true)}
                        data-testid="corrida-ejecutar"
                      >
                        <Send className="size-4" /> Marcar como pagada
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* ⭐ La guarda fiscal, con NOMBRE: §Post-F9.189(d). */}
              {bloqueos.length > 0 ? (
                <div
                  role="alert"
                  className="rounded-md border border-crit/40 bg-crit/5 p-3 text-sm"
                  data-testid="corrida-bloqueos"
                >
                  <p className="flex items-center gap-2 font-medium text-crit">
                    <AlertTriangle className="size-4" />
                    No se puede cerrar todavía
                  </p>
                  <ul className="mt-1 list-disc pl-6 text-muted-foreground">
                    {bloqueos.map((b) => (
                      <li key={`${b.nombre}-${b.motivo}`}>
                        <strong>{b.nombre}</strong> — {b.motivo}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {(detalle.data?.secciones ?? []).map((seccion) => (
                <SeccionRelacion
                  key={seccion.rubro}
                  seccion={seccion}
                  editable={editable}
                  guardando={ocupado}
                  onGuardar={guardarRenglon}
                  onEliminar={(idRenglon) => {
                    if (idActivo === null) return;
                    quitar.mutate(
                      { idCorrida: idActivo, idRenglon },
                      { onError: (e) => toast.error(e.message) },
                    );
                  }}
                />
              ))}

              {verRelacion ? (
                <RelacionEjecutable idCorrida={idActivo} abierta={verRelacion} />
              ) : null}

              {confirmandoEjecutar ? (
                <ConfirmarEjecutar
                  detalle={detalle.data ?? null}
                  ocupado={ocupado}
                  onCancelar={() => setConfirmandoEjecutar(false)}
                  onConfirmar={() => {
                    setConfirmandoEjecutar(false);
                    ejecutar.mutate(corrida.id, {
                      onSuccess: () =>
                        toast.success('Corrida ejecutada: los pagos ya están en las cuentas.'),
                      onError: (e) => toast.error(e.message),
                    });
                  }}
                />
              ) : null}

              {editable ? (
                <AgregarConcepto
                  onAgregar={(idConcepto, formaPago, idCuenta) => {
                    if (idActivo === null) return;
                    guardar.mutate(
                      {
                        idCorrida: idActivo,
                        cuerpo: {
                          idConcepto,
                          monto: 0,
                          formaPago,
                          idCuenta,
                          concepto: null,
                          referencia: null,
                        },
                      },
                      { onError: (e) => toast.error(e.message) },
                    );
                  }}
                />
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Una SECCIÓN de la relación (un rubro), con sus filas y su total. */
function SeccionRelacion({
  seccion,
  editable,
  guardando,
  onGuardar,
  onEliminar,
}: {
  seccion: SeccionCorrida;
  editable: boolean;
  guardando: boolean;
  onGuardar: (
    fila: FilaCorrida,
    valores: {
      monto: number;
      formaPago: 'efectivo' | 'transferencia';
      idCuenta: number | null;
      concepto: string | null;
      referencia: string | null;
      idRenglon?: number;
    },
  ) => void;
  onEliminar: (idRenglon: number) => void;
}): React.JSX.Element {
  const esMaquila = seccion.rubro === 'maquila';
  const esConcepto = seccion.rubro !== 'maquila' && seccion.rubro !== 'proveedores';

  return (
    <section className="space-y-2" data-testid={`corrida-seccion-${seccion.rubro}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[14px] font-semibold">
          {ETIQUETA_RUBRO[seccion.rubro] ?? seccion.rubro}
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {moneda(seccion.totales.efectivo)} efectivo · {moneda(seccion.totales.transferencia)}{' '}
          transferencia
        </span>
      </div>
      <div className="overflow-x-auto">
        <TablaDensa>
          <TablaDensaEncabezado>
            <TablaDensaFila>
              <TablaDensaHead>{esConcepto ? 'Concepto' : 'Beneficiario'}</TablaDensaHead>
              <TablaDensaHead numerica>{esConcepto ? '' : 'Saldo'}</TablaDensaHead>
              <TablaDensaHead>
                {esMaquila ? 'Por revisar · recibió esta semana' : esConcepto ? '' : 'Vencido'}
              </TablaDensaHead>
              <TablaDensaHead numerica>A pagar esta semana</TablaDensaHead>
              {/* ⭐ La columna que finanzas lee para saber QUÉ se está pagando (archivo real). */}
              <TablaDensaHead>Concepto</TablaDensaHead>
              <TablaDensaHead>Refs.</TablaDensaHead>
              <TablaDensaHead>Forma</TablaDensaHead>
              <TablaDensaHead>Destino</TablaDensaHead>
              <TablaDensaHead />
            </TablaDensaFila>
          </TablaDensaEncabezado>
          <TablaDensaCuerpo>
            {seccion.filas
              .flatMap((fila) => filasDeTrabajo(fila))
              .map(({ fila, renglon, clave }) => (
                <RenglonPago
                  key={clave}
                  fila={fila}
                  renglon={renglon}
                  editable={editable}
                  guardando={guardando}
                  onGuardar={(valores) => onGuardar(fila, valores)}
                  onEliminar={onEliminar}
                />
              ))}
          </TablaDensaCuerpo>
        </TablaDensa>
      </div>
    </section>
  );
}

/**
 * Las filas de la tabla que salen de UNA fila de trabajo.
 *
 * ⭐ Un beneficiario con el pago PARTIDO tiene DOS renglones y sale en DOS filas (§Post-F9.185(e)):
 * *«así debe salir en la relación para poder hacer las dos transferencias»*. Sin renglones sale una
 * sola fila con el campo vacío, lista para capturar.
 */
function filasDeTrabajo(
  fila: FilaCorrida,
): { fila: FilaCorrida; renglon: RenglonCorrida | null; clave: string }[] {
  const id = `${fila.origen}-${String(fila.idProveedor ?? fila.idConcepto ?? 0)}`;
  if (fila.renglones.length === 0) {
    return [{ fila, renglon: null, clave: id }];
  }
  return fila.renglones.map((r) => ({ fila, renglon: r, clave: `${id}-${String(r.id)}` }));
}

/**
 * «Cargar el concepto que necesito del catálogo» (§Post-F9.189(f)). Los `predeterminado` ya vienen
 * cargados en cero al abrir la corrida; esto es para los demás.
 */
function AgregarConcepto({
  onAgregar,
}: {
  onAgregar: (
    idConcepto: number,
    formaPago: 'efectivo' | 'transferencia',
    idCuenta: number | null,
  ) => void;
}): React.JSX.Element {
  const [id, setId] = useState('');
  const consulta = useConceptosPago({ pagina: 1, porPagina: 100 });
  const conceptos = consulta.data?.datos ?? [];

  return (
    <div className="flex flex-wrap items-end gap-3 border-t pt-4">
      <Field className="w-72">
        <FieldLabel htmlFor="corrida-concepto">Agregar un concepto del catálogo</FieldLabel>
        <SelectNativo
          id="corrida-concepto"
          value={id}
          onChange={(e) => setId(e.target.value)}
          data-testid="corrida-concepto"
        >
          <option value="">Elige un concepto…</option>
          {conceptos.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre} ({ETIQUETA_RUBRO[c.rubro] ?? c.rubro})
            </option>
          ))}
        </SelectNativo>
      </Field>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={id === ''}
        onClick={() => {
          const concepto = conceptos.find((c) => String(c.id) === id);
          if (concepto === undefined) return;
          const cuenta = concepto.cuentas.find((c) => c.esDefault) ?? concepto.cuentas[0] ?? null;
          // Sin cuenta viva sólo cabe el efectivo (lo repite el servidor y un CHECK de la base).
          if (concepto.formaPagoPreferida === 'transferencia' && cuenta !== null) {
            onAgregar(concepto.id, 'transferencia', cuenta.id);
          } else {
            onAgregar(concepto.id, 'efectivo', null);
          }
          setId('');
        }}
        data-testid="corrida-agregar-concepto"
      >
        <Plus className="size-4" /> Agregar
      </Button>
    </div>
  );
}

/**
 * ⭐ CONFIRMACIÓN DE «marcar como pagada» — el único paso del ciclo SIN MARCHA ATRÁS.
 *
 * Ejecutar hace nacer los movimientos en los estados de cuenta, y **hoy no existe cancelación de un
 * `PagoMaquilero`**: si se ejecuta la corrida equivocada, deshacerlo pide capturar movimientos
 * inversos a mano, uno por uno. Cerrar sí se puede corregir (se hace otra corrida); esto no.
 *
 * Por eso el diálogo no pregunta «¿seguro?» a secas: **enseña lo que se va a mover** —cuántos pagos
 * y cuánto, por rubro y en total— para que la última mirada sea sobre las cifras, no sobre un botón.
 */
function ConfirmarEjecutar({
  detalle,
  ocupado,
  onCancelar,
  onConfirmar,
}: {
  detalle: CorridaDetalle | null;
  ocupado: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}): React.JSX.Element | null {
  if (detalle === null) {
    return null;
  }
  // Sólo las secciones que de verdad mueven dinero: una con todo en cero no dice nada.
  const conMonto = detalle.secciones.filter((s) => s.totales.renglones > 0);
  const totales = detalle.corrida.totales;

  return (
    <div
      role="alertdialog"
      aria-label="Confirmar que la corrida ya se pagó"
      className="rounded-md border border-crit/40 bg-crit/5 p-4 text-sm"
      data-testid="corrida-confirmar-ejecutar"
    >
      <p className="font-medium">
        Vas a marcar la corrida como pagada. Esto crea los pagos en los estados de cuenta y{' '}
        <strong>no se puede deshacer</strong>.
      </p>
      <ul className="mt-2 list-disc pl-6">
        {conMonto.map((s) => (
          <li key={s.rubro}>
            <strong>{ETIQUETA_RUBRO[s.rubro] ?? s.rubro}:</strong> {String(s.totales.renglones)}{' '}
            pago(s) · {moneda(s.totales.total)}
          </li>
        ))}
      </ul>
      <p className="mt-2" data-testid="corrida-confirmar-total">
        <strong>
          Total: {String(totales.renglones)} pago(s) · {moneda(totales.total)}
        </strong>{' '}
        ({moneda(totales.efectivo)} en efectivo, {moneda(totales.transferencia)} por transferencia).
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={ocupado}
          onClick={onConfirmar}
          data-testid="corrida-confirmar-si"
        >
          Sí, ya se pagó
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancelar}
          data-testid="corrida-confirmar-no"
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}
