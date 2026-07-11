import { Loader2Icon } from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';

import { useAbonosMaquilero, useCrearMovimientoEsMa, useDescuentosMaquilero } from '@/api/esma';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useSesion } from '@/sesion/useSesion';

import { SaldoMaquilero } from './SaldoMaquilero';
import { ComboboxMaquilero } from './SelectorMaquilero';
import { hoyISO, moneda, type PartidaInicial } from './comun';

/**
 * CAPTURA de un ABONO o un DESCUENTO a la cuenta de un maquilero (F6-E4). Formulario simple:
 * maquilero + monto + fecha + facturación + observaciones. El `concepto` (abono/descuento) distingue
 * a las dos pantallas, que comparten toda la lógica. Debajo, una tarjeta de saldo de apoyo y los
 * últimos movimientos del maquilero (solo lectura de cuenta).
 *
 * Capturar exige `esma.modificar` (el backend re-verifica, A1). El saldo y la lista de movimientos
 * son LECTURA DE CUENTA (`esma.ver-pagos`); los importes se ocultan sin `consultas.ver-importes`.
 */
export function CapturaMovimientoPagina({
  concepto,
}: {
  concepto: 'abonos' | 'descuentos';
}): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const location = useLocation();
  const puedeModificar = tienePermiso('esma.modificar');
  const verPagos = tienePermiso('esma.ver-pagos');

  const esAbono = concepto === 'abonos';
  const etiqueta = esAbono ? 'abono' : 'descuento';

  // "Duplicar partida" (F6-E5): valores iniciales por router state (pre-llenan el formulario).
  const inicial = (location.state ?? null) as PartidaInicial | null;
  const [idMaquilero, setIdMaquilero] = useState<string>(
    inicial?.idMaquilero !== undefined ? String(inicial.idMaquilero) : '',
  );
  const [monto, setMonto] = useState(inicial?.monto ?? '');
  const [fecha, setFecha] = useState(hoyISO());
  const [conFactura, setConFactura] = useState<'' | 'con' | 'sin'>(inicial?.conFactura ?? '');
  const [observaciones, setObservaciones] = useState(inicial?.observaciones ?? '');

  const idNum = idMaquilero === '' ? undefined : Number(idMaquilero);
  // Las listas de cuenta solo se piden si el usuario puede leerlas (`esma.ver-pagos`).
  const idParaLista = verPagos ? idNum : undefined;
  const abonos = useAbonosMaquilero(esAbono ? idParaLista : undefined);
  const descuentos = useDescuentosMaquilero(esAbono ? undefined : idParaLista);
  const lista = esAbono ? abonos : descuentos;

  const crear = useCrearMovimientoEsMa();

  const montoNum = Number(monto);
  const montoInvalido = monto.trim() === '' || !Number.isFinite(montoNum) || montoNum <= 0;
  const puedeGuardar = puedeModificar && idNum !== undefined && !montoInvalido && fecha !== '';

  function guardar(): void {
    if (!puedeGuardar || idNum === undefined) {
      return;
    }
    crear.mutate(
      {
        concepto,
        cuerpo: {
          idMaquilero: idNum,
          monto: montoNum,
          fecha,
          ...(conFactura !== '' ? { conFactura: conFactura === 'con' } : {}),
          ...(observaciones.trim().length > 0 ? { observaciones: observaciones.trim() } : {}),
        },
      },
      {
        onSuccess: () => {
          toast.success(`${esAbono ? 'Abono' : 'Descuento'} capturado.`);
          setMonto('');
          setObservaciones('');
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <div
      className="h-full overflow-y-auto space-y-6 p-4 md:p-6"
      data-testid={`captura-${concepto}`}
    >
      <header className="flex items-center gap-3">
        <div>
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            {esAbono ? 'Abonos' : 'Descuentos'}
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Captura un {etiqueta} a la cuenta corriente de un maquilero.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Nuevo {etiqueta}</CardTitle>
          <CardDescription>Elige el maquilero y captura el importe y la fecha.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="mov-maquilero">Maquilero</FieldLabel>
              <ComboboxMaquilero
                idMaquilero={idMaquilero}
                onCambioMaquilero={setIdMaquilero}
                testid="mov-maquilero"
              />
            </Field>
            <Field data-invalid={monto !== '' && montoInvalido}>
              <FieldLabel htmlFor="mov-monto">Importe</FieldLabel>
              <Input
                id="mov-monto"
                type="number"
                min={0}
                step="0.01"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                data-testid="mov-monto"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="mov-fecha">Fecha</FieldLabel>
              <Input
                id="mov-fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                data-testid="mov-fecha"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="mov-con-factura">Facturación</FieldLabel>
              <SelectNativo
                id="mov-con-factura"
                value={conFactura}
                onChange={(e) => setConFactura(e.target.value as '' | 'con' | 'sin')}
                data-testid="mov-con-factura"
              >
                <option value="">Según proveedor</option>
                <option value="con">Con factura</option>
                <option value="sin">Sin factura</option>
              </SelectNativo>
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="mov-obs">Observaciones</FieldLabel>
              <Input
                id="mov-obs"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                placeholder="Opcional"
              />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={guardar}
              disabled={!puedeGuardar || crear.isPending}
              data-testid="mov-guardar"
            >
              {crear.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Guardar {etiqueta}
            </Button>
          </div>
        </CardContent>
      </Card>

      {verPagos && idNum !== undefined ? (
        <>
          <SaldoMaquilero idMaquilero={idNum} />

          <Card>
            <CardHeader>
              <CardTitle>Últimos {esAbono ? 'abonos' : 'descuentos'}</CardTitle>
              <CardDescription>Movimientos capturados del maquilero elegido.</CardDescription>
            </CardHeader>
            <CardContent>
              {lista.isPending ? (
                <p className="text-sm text-muted-foreground">Cargando…</p>
              ) : lista.isError ? (
                <p className="text-sm text-destructive" role="alert">
                  {lista.error.message}
                </p>
              ) : (lista.data?.filas.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">Sin movimientos.</p>
              ) : (
                <div className="overflow-x-auto">
                  <TablaDensa>
                    <TablaDensaEncabezado>
                      <TablaDensaFila>
                        <TablaDensaHead>Fecha</TablaDensaHead>
                        <TablaDensaHead>Facturación</TablaDensaHead>
                        <TablaDensaHead>Observaciones</TablaDensaHead>
                        <TablaDensaHead numerica>Importe</TablaDensaHead>
                      </TablaDensaFila>
                    </TablaDensaEncabezado>
                    <TablaDensaCuerpo>
                      {(lista.data?.filas ?? []).map((m) => (
                        <TablaDensaFila key={m.id} data-testid="mov-fila">
                          <TablaDensaCelda>{m.fecha}</TablaDensaCelda>
                          <TablaDensaCelda>
                            {m.conFactura === null ? '—' : m.conFactura ? 'Con' : 'Sin'}
                          </TablaDensaCelda>
                          <TablaDensaCelda>{m.observaciones ?? '—'}</TablaDensaCelda>
                          <TablaDensaCelda numerica>{moneda(m.monto)}</TablaDensaCelda>
                        </TablaDensaFila>
                      ))}
                    </TablaDensaCuerpo>
                  </TablaDensa>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
