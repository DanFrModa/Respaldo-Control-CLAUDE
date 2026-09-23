import { TriangleAlert } from 'lucide-react';
import { Fragment } from 'react';

import type { LineaPendienteOc } from '@/api/recepciones';
import type { OrdenCompra, OrdenCompraLinea } from '@/api/tipos';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import { formatearMoneda } from '@/lib/formato';

import { descripcionMaterial } from './piezas';

/**
 * ⭐ **LO QUE YA LLEGÓ Y LO QUE FALTA, POR RENGLÓN** (DANIEL, 23-sep-2026: *"estoy viendo las
 * órdenes con recibo parcial; no veo dónde diga que ya se recibió y qué falta por recibir"*).
 *
 * 🔴 **Nada de esto se calcula aquí.** Los tres números salen del MISMO servicio de dominio que
 * precarga la captura de la recepción (`lineasPendientesDeOC` → `GET /api/ordenes-compra/{id}/
 * lineas-pendientes`), que a su vez usa `faltantePorRecibir` — el MISMO criterio con el que el
 * estatus de la OC decide «parcial/total» y con el que el KPI «Por recibir» valúa lo que falta
 * (§Post-F9.19). Restar aquí `cantidad − recibido` sería una SEGUNDA verdad: se leería distinto
 * del estatus en cuanto la banda de tolerancia entrara en juego (V1-E3q, §Post-F9.85).
 *
 * `undefined` = esta OC no está en un estatus donde haya recepciones (borrador, pendiente o
 * cancelada: el dominio las deja sin recepciones activas), así que las columnas ni se pintan.
 */
export interface AvanceRecepcionOc {
  /** Pendiente por renglón tal como lo sirvió el dominio, o `undefined` mientras no llega. */
  porLinea: LineaPendienteOc[] | undefined;
  /** La consulta sigue en vuelo. */
  cargando: boolean;
  /** La consulta falló: se DICE, no se adivina con una resta local. */
  error: boolean;
}

/**
 * Tabla de RENGLONES de una OC en el detalle (solo lectura, F4-E2). Lista material, cantidad,
 * unidad, precio, subtotal y la orden ligada; los renglones con matriz talla×color la muestran
 * impresa como tabla bajo el renglón. Todos los importes son DERIVADOS por el backend (A1).
 *
 * Con `recepcion` presente añade las columnas **Recibido** y **Falta** (ver {@link AvanceRecepcionOc}).
 */
export function DetalleRenglonesOc({
  oc,
  recepcion,
}: {
  oc: OrdenCompra;
  recepcion?: AvanceRecepcionOc | undefined;
}): React.JSX.Element {
  if (oc.lineas.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
        Esta orden de compra no tiene renglones.
      </p>
    );
  }

  // El avance de recepción sólo se pinta cuando el llamador lo trae (OC en un estatus con
  // recepciones). Se indexa por id de renglón: el servidor manda una fila por renglón de la OC.
  const muestraRecepcion = recepcion !== undefined;
  const avancePorLinea = new Map((recepcion?.porLinea ?? []).map((p) => [p.idOrdenCompraLinea, p]));
  /** Columnas de la tabla (para los `colSpan` de las filas a todo lo ancho). */
  const columnas = muestraRecepcion ? 9 : 7;

  return (
    <div className="space-y-4">
      {/* Si lo YA RECIBIDO no se pudo consultar se DICE, y las celdas quedan en «—»: restar aquí
          `cantidad − recibido` daría un número que NO coincide con el estatus (la banda de
          tolerancia vive en el dominio), y un número que miente es peor que un hueco. */}
      {recepcion?.error === true ? (
        <p
          className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive"
          role="alert"
          data-testid="avance-recepcion-error"
        >
          No se pudo consultar lo ya recibido de esta orden. Lo recibido y lo que falta no se
          muestran; consúltalos en <em>Compras › Recepción</em>.
        </p>
      ) : null}
      {/* `min-w` da aire a la columna Material y ACTIVA el scroll-x del contenedor en pantallas
          angostas (el cajón móvil son 390px): sin él, `w-full` encoge la tabla y parte el material
          en ~10 líneas. En escritorio el cajón es más ancho que este mínimo, así que no cambia. */}
      <div className="overflow-x-auto">
        <table
          className={
            muestraRecepcion
              ? 'w-full min-w-[760px] border-collapse text-sm'
              : 'w-full min-w-[600px] border-collapse text-sm'
          }
          data-testid="tabla-renglones-oc"
        >
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-2 py-1.5 font-medium">Material</th>
              {/* §Post-F9.16: el TIPO del renglón. Sin esto, un renglón de "texto libre" (todas las
                  OCs migradas) se veía IGUAL que uno de tela del catálogo — y no había forma de
                  entender por qué la orden no ofrece "Dar entrada a la tela". */}
              <th className="px-2 py-1.5 font-medium">Tipo</th>
              <th className="px-2 py-1.5 text-right font-medium">Cantidad</th>
              {/* ⭐ Las dos columnas que Daniel echaba de menos. Van pegadas a «Cantidad» porque se
                  leen juntas (pedido → recibido → falta) y comparten la unidad de la derecha. */}
              {muestraRecepcion ? (
                <>
                  <th className="px-2 py-1.5 text-right font-medium">Recibido</th>
                  <th className="px-2 py-1.5 text-right font-medium">Falta</th>
                </>
              ) : null}
              <th className="px-2 py-1.5 font-medium">Unidad</th>
              <th className="px-2 py-1.5 text-right font-medium">Precio</th>
              <th className="px-2 py-1.5 text-right font-medium">Subtotal</th>
              <th className="px-2 py-1.5 font-medium">Orden</th>
            </tr>
          </thead>
          <tbody>
            {oc.lineas.map((linea) => {
              const avance = avancePorLinea.get(linea.id);
              return (
                <Fragment key={linea.id}>
                  <tr className="border-b align-top" data-testid="fila-renglon-oc">
                    <td className="px-2 py-1.5">
                      {descripcionMaterial(linea)}
                      {/* §Post-F9.18: el COMPLEMENTO (Cardigan) va en el MISMO renglón que el cuerpo,
                      con su propia cantidad y precio, y su importe está dentro del subtotal. Se
                      dice aquí para que no parezca que falta un renglón. */}
                      {linea.nombreComplementoTela !== null ? (
                        <span
                          className="block text-xs text-muted-foreground"
                          data-testid="complemento-detalle-oc"
                        >
                          + {linea.nombreComplementoTela}:{' '}
                          {linea.cantidadComplemento === null
                            ? 'falta capturar la cantidad'
                            : `${linea.cantidadComplemento.toLocaleString('es-MX')} ${linea.unidad ?? ''}` +
                              (linea.precioComplemento === null
                                ? ' (al precio del cuerpo)'
                                : ` a ${formatearMoneda(linea.precioComplemento)}`)}
                          {/* El COMPLEMENTO tiene su propio avance (la OC lo pide aparte y puede
                          llegar sin el cuerpo, o al revés): va pegado a su cantidad, que es donde
                          ya vive. Los dos números los sirve el dominio, igual que los del cuerpo. */}
                          {avance !== undefined && linea.cantidadComplemento !== null ? (
                            <span data-testid="complemento-avance-oc">
                              {' · recibido '}
                              {avance.recibidoComplemento.toLocaleString('es-MX')}
                              {' · falta '}
                              {avance.pendienteComplemento.toLocaleString('es-MX')}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                      {/* ⭐⭐ V1-E8c (§Post-F9.126) — EL DESGLOSE POR MEDIDA, pegado a su renglón.
                      Daniel: *"al hacer la OC no me aparece cantidad por medida… sólo veo un solo
                      renglón"*. Va aquí y no en una tabla aparte porque **es del renglón**: la
                      medida no se recibe por separado, sólo se le dice al proveedor. Vacío = este
                      avío no se pide por medida. */}
                      {linea.medidas.length > 0 ? (
                        <span
                          className="block text-xs text-muted-foreground"
                          data-testid="medidas-detalle-oc"
                        >
                          Por medida:{' '}
                          {linea.medidas
                            .map((m) => `${m.etiqueta}: ${m.cantidad.toLocaleString('es-MX')}`)
                            .join(' · ')}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5">
                      <ChipEstado tono={linea.idTela !== null ? 'ok' : 'neutro'} sinPunto>
                        {linea.idTela !== null
                          ? 'Tela'
                          : linea.idAvio !== null
                            ? 'Avío'
                            : 'Texto libre'}
                      </ChipEstado>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {linea.cantidad.toLocaleString('es-MX')}
                      {/* ⭐ V1-E3u (§Post-F9.89(a)): LO QUE EL SISTEMA CALCULÓ, al lado de lo que se
                      pidió. Daniel pidió que *"compras capture cada cantidad"*, y una cantidad
                      capturada sólo se puede juzgar contra la que se propuso. `null` = la línea se
                      capturó a mano y no hay contra qué compararla — entonces no se inventa nada. */}
                      {linea.cantidadSugerida !== null &&
                      linea.cantidadSugerida !== linea.cantidad ? (
                        <span
                          className="block text-xs font-normal text-muted-foreground"
                          data-testid="sugerida-detalle-oc"
                        >
                          calculado: {linea.cantidadSugerida.toLocaleString('es-MX')}
                        </span>
                      ) : null}
                    </td>
                    {/* 🔴 Los dos números vienen ENTEROS del dominio: aquí no se resta nada. «Falta»
                      ya trae la banda de tolerancia aplicada (§Post-F9.19) — por eso un renglón
                      puede estar surtido con menos de lo pedido, y lo dice con todas sus letras. */}
                    {muestraRecepcion ? (
                      <>
                        <td
                          className="px-2 py-1.5 text-right tabular-nums"
                          data-testid="recibido-renglon-oc"
                        >
                          {avance === undefined
                            ? recepcion?.cargando === true
                              ? '…'
                              : '—'
                            : avance.recibido.toLocaleString('es-MX')}
                        </td>
                        <td className="px-2 py-1.5 text-right" data-testid="falta-renglon-oc">
                          {avance === undefined ? (
                            <span className="tabular-nums">
                              {recepcion?.cargando === true ? '…' : '—'}
                            </span>
                          ) : avance.surtido ? (
                            <ChipEstado tono="ok" sinPunto>
                              Ya surtido
                            </ChipEstado>
                          ) : (
                            <span className="font-medium tabular-nums">
                              {avance.pendiente.toLocaleString('es-MX')}
                            </span>
                          )}
                        </td>
                      </>
                    ) : null}
                    <td className="px-2 py-1.5">{linea.unidad ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatearMoneda(linea.precio)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-medium tabular-nums">
                      {formatearMoneda(linea.subtotal)}
                    </td>
                    <td className="px-2 py-1.5">
                      {linea.folioOrden !== null ? `Orden ${linea.folioOrden}` : '—'}
                    </td>
                  </tr>
                  {/* ⭐⭐ V1-E3u (§Post-F9.89(a)) — 🔴 EL AVISO PARA QUIEN AUTORIZA. Daniel: *"si el
                  sistema encuentra algún desvío grande que le notifique a la persona que va a
                  autorizar la OC"*. Va en su propia fila, a todo lo ancho, porque es una frase
                  —no un número— y en una celda de tabla se parte en seis líneas.
                  🔴 **No bloquea nada**: el botón de autorizar ni se entera de esto. El control es
                  la autorización que ya existe, no una tranca (§Post-F9.64, guía no jaula). */}
                  {linea.avisoDesvio === null ? null : (
                    <tr className="border-b" data-testid="fila-aviso-desvio-oc">
                      <td colSpan={columnas} className="px-2 pb-2">
                        <p className="flex items-start gap-1.5 rounded-md border border-warn/30 bg-warn-soft p-2 text-xs text-warn">
                          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                          <span>{linea.avisoDesvio}</span>
                        </p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              {/* Todas las columnas MENOS las dos últimas (Subtotal, que lleva el importe, y Orden,
                  que va vacía): el `-2` sigue siendo cierto con o sin las de recepción. */}
              <td className="px-2 py-1.5" colSpan={columnas - 2}>
                Total
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums" data-testid="total-detalle-oc">
                {formatearMoneda(oc.total)}
              </td>
              <td aria-hidden />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Por qué un renglón puede decir «Ya surtido» con menos de lo pedido. Sin esta línea, el
          número se lee como un error de captura — y es justo lo contrario: es la regla que Daniel
          pidió (*"la cantidad que se recibe nunca va a coincidir exacto con la OC"*). */}
      {muestraRecepcion ? (
        <p className="text-xs text-muted-foreground" data-testid="nota-banda-recepcion">
          «Falta» es lo que el sistema sigue esperando. Un renglón cuya entrega quedó dentro de la
          banda de tolerancia de su material se da por <strong>surtido</strong> aunque no cuadre
          exacto — el mismo criterio con el que la orden pasa a «recibida total».
        </p>
      ) : null}

      {/* Matrices talla×color de los renglones que la usan (impresas como tabla). */}
      {oc.lineas
        .filter((linea) => linea.tallas.length > 0)
        .map((linea) => (
          <MatrizRenglon key={linea.id} linea={linea} />
        ))}
    </div>
  );
}

/** Imprime la matriz talla×color de un renglón como una tabla (filas=color, columnas=talla). */
function MatrizRenglon({ linea }: { linea: OrdenCompraLinea }): React.JSX.Element {
  // Tallas únicas (columnas), en el orden en que aparecen.
  const tallas: { idTalla: number; etiqueta: string }[] = [];
  const vistas = new Set<number>();
  for (const celda of linea.tallas) {
    if (!vistas.has(celda.idTalla)) {
      vistas.add(celda.idTalla);
      tallas.push({ idTalla: celda.idTalla, etiqueta: celda.etiquetaTalla });
    }
  }
  // Filas (color) -> { [idTalla]: cantidad }.
  const filas = new Map<number, { color: string; cantidades: Record<number, number> }>();
  for (const celda of linea.tallas) {
    const fila = filas.get(celda.idColor) ?? { color: celda.color, cantidades: {} };
    fila.cantidades[celda.idTalla] = celda.cantidad;
    filas.set(celda.idColor, fila);
  }

  return (
    <div className="rounded-md border p-3" data-testid="matriz-detalle-oc">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        Detalle por talla × color — {descripcionMaterial(linea)}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="px-2 py-1 text-left font-medium">Color</th>
              {tallas.map((t) => (
                <th key={t.idTalla} className="px-1 py-1 text-center font-medium">
                  {t.etiqueta}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...filas.values()].map((fila) => (
              <tr key={fila.color} className="border-b">
                <td className="px-2 py-1 font-medium whitespace-nowrap">{fila.color}</td>
                {tallas.map((t) => (
                  <td key={t.idTalla} className="px-1 py-1 text-center tabular-nums">
                    {(fila.cantidades[t.idTalla] ?? 0).toLocaleString('es-MX')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
