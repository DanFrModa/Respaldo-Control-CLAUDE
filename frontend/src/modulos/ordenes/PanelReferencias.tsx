import { Loader2Icon, SaveIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useCamposCliente } from '@/api/clientes';
import { useGuardarReferencias } from '@/api/ordenes';
import type { Orden, OrdenReferencias, TipoCampoCliente } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/** Mapea el tipo del campo (TEXTO/NUMERO/FECHA) al `type` del `<input>` para mejor UX. */
function tipoInput(tipo: TipoCampoCliente): React.HTMLInputTypeAttribute {
  if (tipo === 'NUMERO') {
    return 'number';
  }
  if (tipo === 'FECHA') {
    return 'date';
  }
  return 'text';
}

/**
 * Panel de REFERENCIAS D7 de una orden (F2-E3): muestra UN input por cada `ClienteCampo` ACTIVO del
 * cliente de la orden (el tipo del campo decide el tipo de input). Al guardar manda el SET COMPLETO
 * (`PUT .../referencias`) incluyendo solo los campos con valor no vacío. Si la orden es de otro
 * cliente, los campos cambian (la consulta se lleva por `idCliente`). El backend re-valida que cada
 * campo sea del cliente de la orden y esté activo (A1).
 *
 * Solo lectura si la orden está cancelada o sin `ordenes.administrar`.
 */
export function PanelReferencias({
  orden,
  puedeAdministrar,
}: {
  orden: Orden;
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const soloLectura = orden.estado === 'cancelada' || !puedeAdministrar;
  const campos = useCamposCliente(orden.idCliente);
  const guardar = useGuardarReferencias();

  // Solo los campos ACTIVOS del cliente, en su orden.
  const activos = useMemo(() => (campos.data ?? []).filter((c) => c.activo), [campos.data]);

  // Valores actuales por idClienteCampo (los que ya tiene la orden).
  const valoresOrden = useMemo(
    () => new Map(orden.referencias.map((r) => [r.idClienteCampo, r.valor])),
    [orden.referencias],
  );

  // Estado de captura: { [idClienteCampo]: valor } (texto del input).
  const [valores, setValores] = useState<Record<number, string>>({});

  // Reinicializa al cambiar de orden o cuando llegan los campos del cliente.
  const claveReset = `${orden.id}:${orden.modificadoEn}:${activos.map((c) => c.id).join(',')}`;
  useEffect(() => {
    const inicial: Record<number, string> = {};
    for (const campo of activos) {
      inicial[campo.id] = valoresOrden.get(campo.id) ?? '';
    }
    setValores(inicial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveReset]);

  function alGuardar(): void {
    const referencias: OrdenReferencias['referencias'] = activos
      .map((campo) => ({ idClienteCampo: campo.id, valor: (valores[campo.id] ?? '').trim() }))
      .filter((r) => r.valor.length > 0);
    guardar.mutate(
      { id: orden.id, cuerpo: { referencias } },
      {
        onSuccess: () => toast.success('Referencias guardadas.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  if (campos.isPending) {
    return <p className="text-sm text-muted-foreground">Cargando campos del cliente…</p>;
  }
  if (campos.isError) {
    return <p className="text-sm text-destructive">{campos.error.message}</p>;
  }

  if (activos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Este cliente no tiene campos de referencia activos.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {activos.map((campo) => (
          <Field key={campo.id}>
            <FieldLabel htmlFor={`ref-${campo.id}`}>{campo.etiqueta}</FieldLabel>
            <Input
              id={`ref-${campo.id}`}
              type={tipoInput(campo.tipo)}
              value={valores[campo.id] ?? ''}
              disabled={soloLectura}
              onChange={(e) => setValores((prev) => ({ ...prev, [campo.id]: e.target.value }))}
              data-testid="referencia-campo"
              aria-label={campo.etiqueta}
            />
          </Field>
        ))}
      </div>

      {!soloLectura ? (
        <Button
          type="button"
          size="sm"
          onClick={alGuardar}
          disabled={guardar.isPending}
          data-testid="guardar-referencias"
        >
          {guardar.isPending ? (
            <Loader2Icon className="animate-spin" aria-hidden />
          ) : (
            <SaveIcon aria-hidden />
          )}
          Guardar referencias
        </Button>
      ) : null}
    </div>
  );
}
