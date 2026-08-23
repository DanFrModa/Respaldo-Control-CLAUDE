import { useCallback, useEffect, useMemo, useState } from 'react';

import { useCamposCliente } from '@/api/clientes';
import { useGuardarReferencias } from '@/api/ordenes';
import type { Orden, OrdenReferencias, TipoCampoCliente } from '@/api/tipos';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { useReinicioBloqueado, useSeccionGuardable, type EjecutorGuardado } from './guardado-orden';

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

/** Set completo a mandar: un renglón por campo activo CON valor (los vacíos no viajan). */
function setReferencias(
  activos: readonly { id: number }[],
  valores: Record<number, string>,
): OrdenReferencias['referencias'] {
  return activos
    .map((campo) => ({ idClienteCampo: campo.id, valor: (valores[campo.id] ?? '').trim() }))
    .filter((r) => r.valor.length > 0);
}

/** Valores tal como los tiene el SERVIDOR, un renglón por campo activo (vacío si no hay). */
function valoresDelServidor(
  activos: readonly { id: number }[],
  valoresOrden: ReadonlyMap<number, string>,
): Record<number, string> {
  const inicial: Record<number, string> = {};
  for (const campo of activos) {
    inicial[campo.id] = valoresOrden.get(campo.id) ?? '';
  }
  return inicial;
}

/** FIRMA del set de referencias, para saber si hay cambios sin guardar. */
function firmaReferencias(
  activos: readonly { id: number }[],
  valores: Record<number, string>,
): string {
  return JSON.stringify(setReferencias(activos, valores));
}

/**
 * Panel de REFERENCIAS D7 de una orden (F2-E3): muestra UN input por cada `ClienteCampo` ACTIVO del
 * cliente de la orden (el tipo del campo decide el tipo de input). Al guardar manda el SET COMPLETO
 * (`PUT .../referencias`) incluyendo solo los campos con valor no vacío. Si la orden es de otro
 * cliente, los campos cambian (la consulta se lleva por `idCliente`). El backend re-valida que cada
 * campo sea del cliente de la orden y esté activo (A1).
 *
 * NO tiene botón propio de guardar (Daniel 24-jul-2026): se registra en el guardado ÚNICO del
 * diálogo (`useSeccionGuardable`).
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
  // FIRMA del set tal como se cargó del servidor. `null` = todavía no se cargó nada, así que no hay
  // contra qué comparar (si no, al abrir se anunciarían cambios que nadie hizo). Es la referencia
  // del "¿hay cambios?" — a propósito NO se deriva de `orden`, que puede refrescarse a media tanda
  // de guardado y dejaría de reflejar lo que el usuario tiene en pantalla.
  const [firmaCargada, setFirmaCargada] = useState<string | null>(null);

  // Mientras se guarda (o tras un guardado a medias) NO se re-inicializa: si no, la respuesta del
  // encabezado tiraría las referencias que el usuario acaba de capturar y aún no se mandan.
  const reinicioBloqueado = useReinicioBloqueado();

  // Reinicializa al cambiar de orden, al llegar los campos del cliente o cuando el SERVIDOR ya
  // trae otras referencias.
  //
  // ⚠️ La clave mira `modificadoEn` Y LOS VALORES del servidor. Son DOS PUNTAS COMPLEMENTARIAS del
  // mismo arreglo (jul-2026: sin ellas la sección quedaba "sucia" para siempre tras guardar —
  // botón único del pie habilitado y "Tienes cambios sin guardar" eternos):
  //   • `modificadoEn`: `guardarReferenciasOrden` SÍ sella la auditoría de la orden (A7, igual que
  //     la matriz), así que un guardado siempre mueve la clave — incluso cuando NO cambia ninguna
  //     referencia (re-guardar exactamente lo mismo), caso que la firma de valores no vería.
  //   • firma de valores: cubre lo contrario — que el servidor traiga OTRAS referencias sin que
  //     `modificadoEn` se haya movido para nosotros (refetch que trae el guardado de otro usuario,
  //     el importador de pedidos, un ETL…). Ahí la firma es lo único que delata el cambio.
  // Ninguna de las dos, sola, cubre los dos casos: no quitar una "porque la otra basta".
  const delServidor = useMemo(
    () => valoresDelServidor(activos, valoresOrden),
    [activos, valoresOrden],
  );
  const claveReset = `${orden.id}:${orden.modificadoEn}:${activos
    .map((c) => c.id)
    .join(',')}:${firmaReferencias(activos, delServidor)}`;
  useEffect(() => {
    if (reinicioBloqueado) {
      return;
    }
    setValores(delServidor);
    setFirmaCargada(firmaReferencias(activos, delServidor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveReset, reinicioBloqueado]);

  // Set completo a mandar (solo los campos con valor).
  const referencias = useMemo<OrdenReferencias['referencias']>(
    () => setReferencias(activos, valores),
    [activos, valores],
  );
  const sucio = firmaCargada !== null && JSON.stringify(referencias) !== firmaCargada;

  // Guardado ÚNICO del diálogo: se captura el set AHORA y se devuelve el ejecutor.
  const idOrden = orden.id;
  const preparar = useCallback((): Promise<EjecutorGuardado | null> => {
    const capturado = referencias;
    return Promise.resolve(async () => {
      await guardar.mutateAsync({ id: idOrden, cuerpo: { referencias: capturado } });
    });
  }, [referencias, guardar, idOrden]);

  useSeccionGuardable('referencias', 'las referencias', !soloLectura && sucio, preparar);

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
  );
}
