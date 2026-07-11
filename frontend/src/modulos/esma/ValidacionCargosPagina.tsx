import { BadgeCheck, Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useValidarCargoEsMa, useCargosEsMa } from '@/api/esma';
import type { CargoEsMaFila, CargosEsMaQuery } from '@/api/tipos';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useSesion } from '@/sesion/useSesion';

import { moneda } from './comun';

/** Estados posibles de un cargo, para el filtro. */
type EstadoCargo = NonNullable<CargosEsMaQuery['estado']>;

const BADGE_ESTADO: Record<EstadoCargo, { texto: string; variant: 'secondary' | 'default' }> = {
  propuesto: { texto: 'Propuesto', variant: 'secondary' },
  validado: { texto: 'Validado', variant: 'default' },
  cancelado: { texto: 'Cancelado', variant: 'secondary' },
};

/**
 * COLA DE VALIDACIÓN de CARGOS EsMa (F3-E4, doc 07-EsMa). Cada recibo de maquila propone un cargo a
 * la cuenta corriente del maquilero (cantidad y precio del envío); aquí el admin lo REVISA y VALIDA
 * (puede ajustar cantidad/precio reales). RESPONSIVE: tarjetas en móvil, tabla en escritorio. El
 * filtro por estado (propuesto/validado/cancelado, default propuesto) acota la cola.
 *
 * `esma.cargo-validar` gobierna ver y validar; el botón se deshabilita sin el permiso (el menú ya la
 * esconde, pero el servidor es la AUTORIDAD).
 */
export function ValidacionCargosPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeValidar = tienePermiso('esma.cargo-validar');

  const [estado, setEstado] = useState<EstadoCargo>('propuesto');
  const [aValidar, setAValidar] = useState<CargoEsMaFila | null>(null);

  const consulta = useCargosEsMa({ estado });
  const filas = consulta.data?.filas ?? [];

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <div>
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Validación de cargos de maquila
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Revisa y valida los cargos a la cuenta del maquilero que proponen los recibos.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Filtro</CardTitle>
          <CardDescription>Acota por el estado del cargo.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="estado">Estado</FieldLabel>
              <SelectNativo
                id="estado"
                value={estado}
                onChange={(e) => setEstado(e.target.value as EstadoCargo)}
                data-testid="cargos-estado"
              >
                <option value="propuesto">Propuestos</option>
                <option value="validado">Validados</option>
                <option value="cancelado">Cancelados</option>
              </SelectNativo>
            </Field>
          </div>
        </CardContent>
      </Card>

      {consulta.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {consulta.error.message}
        </p>
      ) : null}

      {consulta.isPending ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : filas.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No hay cargos {BADGE_ESTADO[estado].texto.toLowerCase()}s.
        </p>
      ) : (
        <>
          {/* Móvil: tarjetas apiladas. */}
          <div className="space-y-3 md:hidden" data-testid="cargos-tarjetas">
            {filas.map((c) => (
              <Card key={c.id}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{c.maquilero}</p>
                      <p className="text-xs text-muted-foreground">
                        Orden #{c.folioOrden} · {c.tipoProceso}
                        {c.folioRecibo !== null ? ` · recibo #${c.folioRecibo}` : ''}
                      </p>
                    </div>
                    <Badge variant={BADGE_ESTADO[c.estado].variant}>
                      {BADGE_ESTADO[c.estado].texto}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Propuesto: {c.cantidadPropuesta.toLocaleString('es-MX')} pzas ×{' '}
                    {moneda(c.precioPropuesto)} = {moneda(c.importePropuesto)}
                  </p>
                  {c.estado === 'validado' ? (
                    <p className="text-xs text-muted-foreground">
                      Real: {(c.cantidadReal ?? 0).toLocaleString('es-MX')} pzas ×{' '}
                      {moneda(c.precioReal)} = {moneda(c.importeReal)}
                    </p>
                  ) : null}
                  {c.estado === 'propuesto' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!puedeValidar}
                      onClick={() => setAValidar(c)}
                      data-testid="cargo-validar"
                    >
                      <BadgeCheck className="mr-1.5 size-4" aria-hidden /> Validar
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Escritorio: tabla. */}
          <div
            className="hidden overflow-x-auto rounded-md border md:block"
            data-testid="cargos-tabla"
          >
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Maquilero</TablaDensaHead>
                  <TablaDensaHead>Orden</TablaDensaHead>
                  <TablaDensaHead>Proceso</TablaDensaHead>
                  <TablaDensaHead numerica>Cant. prop.</TablaDensaHead>
                  <TablaDensaHead numerica>Importe prop.</TablaDensaHead>
                  <TablaDensaHead numerica>Importe real</TablaDensaHead>
                  <TablaDensaHead>Estado</TablaDensaHead>
                  <TablaDensaHead numerica>Acción</TablaDensaHead>
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {filas.map((c) => (
                  <TablaDensaFila key={c.id}>
                    <TablaDensaCelda className="font-medium">{c.maquilero}</TablaDensaCelda>
                    <TablaDensaCelda>#{c.folioOrden}</TablaDensaCelda>
                    <TablaDensaCelda>{c.tipoProceso}</TablaDensaCelda>
                    <TablaDensaCelda numerica>
                      {c.cantidadPropuesta.toLocaleString('es-MX')}
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica>{moneda(c.importePropuesto)}</TablaDensaCelda>
                    <TablaDensaCelda numerica>{moneda(c.importeReal)}</TablaDensaCelda>
                    <TablaDensaCelda>
                      <Badge variant={BADGE_ESTADO[c.estado].variant}>
                        {BADGE_ESTADO[c.estado].texto}
                      </Badge>
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica>
                      {c.estado === 'propuesto' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!puedeValidar}
                          onClick={() => setAValidar(c)}
                          data-testid="cargo-validar"
                        >
                          <BadgeCheck className="mr-1.5 size-4" aria-hidden /> Validar
                        </Button>
                      ) : null}
                    </TablaDensaCelda>
                  </TablaDensaFila>
                ))}
              </TablaDensaCuerpo>
            </TablaDensa>
          </div>
        </>
      )}

      <DialogoValidarCargo cargo={aValidar} alCerrar={() => setAValidar(null)} />
    </div>
  );
}

/**
 * Diálogo de VALIDACIÓN de un cargo. Pre-llena cantidad/precio reales con los propuestos; el admin
 * puede ajustarlos. Llama a `useValidarCargoEsMa`; el backend re-valida (estado propuesto→validado,
 * permiso `esma.cargo-validar`) y es la autoridad.
 */
function DialogoValidarCargo({
  cargo,
  alCerrar,
}: {
  cargo: CargoEsMaFila | null;
  alCerrar: () => void;
}): React.JSX.Element {
  const validar = useValidarCargoEsMa();
  const [cantidadReal, setCantidadReal] = useState('');
  const [precioReal, setPrecioReal] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [sinCosto, setSinCosto] = useState(false);
  // Tri-estado: '' = según la modalidad del proveedor (el backend decide); 'con'/'sin' fuerza.
  const [conFactura, setConFactura] = useState<'' | 'con' | 'sin'>('');

  useEffect(() => {
    if (cargo !== null) {
      setCantidadReal(String(cargo.cantidadPropuesta));
      setPrecioReal(cargo.precioPropuesto !== null ? String(cargo.precioPropuesto) : '');
      setObservaciones('');
      setSinCosto(cargo.sinCosto);
      setConFactura(cargo.conFactura === null ? '' : cargo.conFactura ? 'con' : 'sin');
    }
  }, [cargo]);

  const cantInvalida = cantidadReal.trim() === '' || Number(cantidadReal) < 0;
  // Sin costo → importe 0: el precio deja de exigirse (el backend lo excluye del saldo).
  const precioInvalido = !sinCosto && (precioReal.trim() === '' || Number(precioReal) < 0);

  function confirmar(): void {
    if (cargo === null || cantInvalida || precioInvalido) {
      return;
    }
    validar.mutate(
      {
        id: cargo.id,
        cuerpo: {
          cantidadReal: Number(cantidadReal),
          precioReal: sinCosto && precioReal.trim() === '' ? 0 : Number(precioReal),
          sinCosto,
          ...(conFactura !== '' ? { conFactura: conFactura === 'con' } : {}),
          ...(observaciones.trim().length > 0 ? { observaciones: observaciones.trim() } : {}),
        },
      },
      {
        onSuccess: () => {
          toast.success(`Cargo de ${cargo.maquilero} validado.`);
          alCerrar();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={cargo !== null} onOpenChange={(abierto) => (abierto ? undefined : alCerrar())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Validar cargo {cargo ? `de ${cargo.maquilero}` : ''}</DialogTitle>
          <DialogDescription>
            Confirma o ajusta la cantidad y el precio reales a pagar. El cargo pasa a validado y
            cuenta en el estado de cuenta del maquilero.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <Field data-invalid={cantInvalida}>
            <FieldLabel htmlFor="cargo-cantidad-real">Cantidad real (pzas)</FieldLabel>
            <Input
              id="cargo-cantidad-real"
              type="number"
              min={0}
              step="1"
              value={cantidadReal}
              onChange={(e) => setCantidadReal(e.target.value)}
              data-testid="cargo-cantidad-real"
            />
          </Field>
          <Field data-invalid={precioInvalido}>
            <FieldLabel htmlFor="cargo-precio-real">Precio real (unitario)</FieldLabel>
            <Input
              id="cargo-precio-real"
              type="number"
              min={0}
              step="0.01"
              value={precioReal}
              onChange={(e) => setPrecioReal(e.target.value)}
              disabled={sinCosto}
              data-testid="cargo-precio-real"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="cargo-con-factura">Facturación</FieldLabel>
            <SelectNativo
              id="cargo-con-factura"
              value={conFactura}
              onChange={(e) => setConFactura(e.target.value as '' | 'con' | 'sin')}
              data-testid="cargo-con-factura"
            >
              <option value="">Según proveedor</option>
              <option value="con">Con factura</option>
              <option value="sin">Sin factura</option>
            </SelectNativo>
          </Field>
          <label
            className="flex items-center gap-2 self-end pb-2 text-sm"
            htmlFor="cargo-sin-costo"
          >
            <input
              id="cargo-sin-costo"
              type="checkbox"
              className="size-4"
              checked={sinCosto}
              onChange={(e) => setSinCosto(e.target.checked)}
              data-testid="cargo-sin-costo"
            />
            Sin costo (segundas no pagadas)
          </label>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="cargo-obs">Observaciones</FieldLabel>
            <Input
              id="cargo-obs"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              placeholder="Opcional"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={alCerrar} disabled={validar.isPending}>
            Volver
          </Button>
          <Button
            type="button"
            onClick={confirmar}
            disabled={validar.isPending || cantInvalida || precioInvalido}
            data-testid="confirmar-validar-cargo"
          >
            {validar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Validar cargo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
