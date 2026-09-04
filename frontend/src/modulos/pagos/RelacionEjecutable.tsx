import { useConcentrado } from '@/api/pagos';
import { numeroLegible } from '@/modulos/proveedores/cuentas-pago';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';

import { ETIQUETA_FORMA, ETIQUETA_RUBRO, moneda } from './comun';

/**
 * ⭐ LA RELACIÓN EJECUTABLE: lo que finanzas tiene en la mano para hacer las transferencias.
 *
 * Es la salida que sustituye a la hoja «Transfers Concentrado» del Excel: **sólo los renglones con
 * monto**, por rubro, ordenados por monto descendente, con los totales de efectivo y transferencia
 * por sección y el gran total. El servidor la arma entera (`GET …/concentrado`); aquí sólo se pinta.
 *
 * 🔴 **Por qué existe esta vista** (hallazgo B5 de la revisión): el endpoint del concentrado estaba
 * construido y su hook también, pero **no lo llamaba nadie**. O sea: el único lugar del sistema
 * donde vive el NÚMERO DE CUENTA COMPLETO —el dato sin el cual no se puede transferir— no tenía
 * botón. Quien tenía `pagos.corrida-ver` podía mirar la corrida y aun así no podía pagar. Una
 * relación que no se puede ejecutar no es una relación.
 *
 * ⚠️ **Aquí sí va la cuenta completa, y es a propósito.** En la pantalla de trabajo se enseñan sólo
 * los últimos 4 (basta para distinguir dos cuentas del mismo beneficiario); aquí se necesita entera
 * porque es de donde se copia al banco. El servidor la protege exigiendo `consultas.ver-importes`
 * además del permiso de ver: sin poder ver dinero, esta pantalla no tendría sentido.
 *
 * ⚠️ Y los renglones **no se agrupan por beneficiario**: un pago partido en dos cuentas son dos
 * renglones, *«así debe salir en la relación para poder hacer las dos transferencias»*.
 */
export interface RelacionEjecutableProps {
  /** Corrida a mostrar, o `null` si no hay ninguna seleccionada. */
  idCorrida: number | null;
  /** Sólo se pide al servidor cuando la vista está abierta (es una consulta cara y con dinero). */
  abierta: boolean;
}

/** La relación ejecutable de una corrida (sólo lo que lleva monto). */
export function RelacionEjecutable({
  idCorrida,
  abierta,
}: RelacionEjecutableProps): React.JSX.Element | null {
  const consulta = useConcentrado(idCorrida, abierta);

  if (!abierta) {
    return null;
  }
  if (consulta.isPending) {
    return <p className="text-sm text-muted-foreground">Cargando la relación…</p>;
  }
  if (consulta.isError) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {consulta.error.message}
      </p>
    );
  }

  const datos = consulta.data;
  if (datos === undefined || datos.secciones.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        Esta corrida no tiene ningún renglón con monto: no hay nada que transferir.
      </p>
    );
  }

  return (
    <div className="space-y-4" data-testid="relacion-ejecutable">
      <p className="text-sm text-muted-foreground">
        Lo que se paga esta semana, listo para el banco. Un renglón = una transferencia (o un pago
        en efectivo).
      </p>

      {datos.secciones.map((seccion) => (
        <section key={seccion.rubro} data-testid={`relacion-seccion-${seccion.rubro}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h3 className="text-[14px] font-semibold">
              {ETIQUETA_RUBRO[seccion.rubro] ?? seccion.rubro}
            </h3>
            <span className="text-xs text-muted-foreground tabular-nums">
              {moneda(seccion.totales.efectivo)} efectivo · {moneda(seccion.totales.transferencia)}{' '}
              transferencia
            </span>
          </div>
          <div className="overflow-x-auto">
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Nombre</TablaDensaHead>
                  <TablaDensaHead>Concepto</TablaDensaHead>
                  <TablaDensaHead>Refs.</TablaDensaHead>
                  <TablaDensaHead>Forma</TablaDensaHead>
                  <TablaDensaHead>Beneficiario</TablaDensaHead>
                  <TablaDensaHead>Banco</TablaDensaHead>
                  <TablaDensaHead>Cuenta</TablaDensaHead>
                  <TablaDensaHead numerica>Monto</TablaDensaHead>
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {seccion.renglones.map((r, i) => (
                  <TablaDensaFila
                    key={`${r.nombre}-${r.beneficiario}-${String(i)}`}
                    data-testid="relacion-renglon"
                  >
                    <TablaDensaCelda className="font-medium">{r.nombre}</TablaDensaCelda>
                    <TablaDensaCelda className="text-xs">{r.concepto ?? ''}</TablaDensaCelda>
                    <TablaDensaCelda className="text-xs text-muted-foreground">
                      {r.referencia ?? ''}
                    </TablaDensaCelda>
                    <TablaDensaCelda>{ETIQUETA_FORMA[r.formaPago] ?? r.formaPago}</TablaDensaCelda>
                    <TablaDensaCelda>{r.beneficiario}</TablaDensaCelda>
                    <TablaDensaCelda>{r.banco ?? ''}</TablaDensaCelda>
                    {/* ⭐ El número COMPLETO: es de donde se copia al banco. */}
                    <TablaDensaCelda className="font-mono text-xs tabular-nums">
                      {r.cuenta === null ? '' : numeroLegible(r.cuenta)}
                      {r.aliasCuenta === null ? null : (
                        <span className="ml-1 text-muted-foreground">({r.aliasCuenta})</span>
                      )}
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica className="font-semibold">
                      {moneda(r.monto)}
                    </TablaDensaCelda>
                  </TablaDensaFila>
                ))}
              </TablaDensaCuerpo>
            </TablaDensa>
          </div>
        </section>
      ))}

      <div
        className="rounded-md border bg-primary-soft p-3 text-sm"
        data-testid="relacion-gran-total"
      >
        <strong>Total de la semana:</strong> {moneda(datos.totales.efectivo)} en efectivo ·{' '}
        {moneda(datos.totales.transferencia)} por transferencia ·{' '}
        <strong>{moneda(datos.totales.total)}</strong> en {String(datos.totales.renglones)} pago(s).
      </div>
    </div>
  );
}
