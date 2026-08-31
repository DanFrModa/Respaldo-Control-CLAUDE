import { AlertTriangle, Lock, Maximize2, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useRecetasPorLiberar } from '@/api/receta-orden';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/lib/useDebounce';

/**
 * BANDEJA «RECETAS POR LIBERAR» — V1-E3h (§Post-F9.72). DANIEL, 19-ago-2026: *"está buenísima"*.
 *
 * EL PROBLEMA QUE RESUELVE. Con la firma por renglón, para saber qué le falta autorizar Desarrollo
 * tendría que abrir **orden por orden**. Nadie hace eso: el resultado real es que **solo se libera lo
 * que alguien viene a reclamar**, y lo que nadie reclama se detiene solo — que es exactamente lo que
 * le pasó a Daniel con los avíos.
 *
 * CÓMO SE LEE, y por qué así:
 *  • **Una fila por ORDEN**, no por material: así recorre Daniel el trabajo (abre una orden y la
 *    resuelve entera).
 *  • **Ordenada por FECHA DE ENTREGA**, no por folio: lo que estorba primero, arriba.
 *  • **«Ya frena compras»** marca las órdenes que YA tienen OC por otra parte de su receta: ahí
 *    alguien ya compró y está esperando la firma. No es lo mismo que una orden recién nacida.
 *  • ⭐ **Se ENTRA a ver el detalle**: el folio y «Ver la receta» llevan a la pantalla propia de la
 *    receta (V1-E3j) —la MISMA a la que llega el detalle de la OP—, donde se firma renglón por
 *    renglón. Daniel, 19-ago-2026: *"solo está la OC con un botón para liberar todas juntas. No veo
 *    dónde pueda ver todo completo e ir liberando una por una."*
 *
 * ⭐⭐ V1-E3k (§Post-F9.80) — **ESTA BANDEJA YA NO FIRMA: LLEVA.** Tenía un botón «Revisar y
 * liberar» que daba por buena la receta entera de una orden **desde aquí**, viendo solo *"3 avíos, 1
 * tela"* — sin la lista enfrente. Era el peor de los tres botones de bloque que existían: nació de
 * un defecto (§Post-F9.75) y el lead ya había señalado su consecuencia de negocio. DANIEL,
 * 20-ago-2026: *"siempre se debe liberar uno por uno, para que se revise lo que se está haciendo.
 * **No tiene sentido liberar las cosas sin ver**."* Así que la bandeja hace ahora solo lo que debe:
 * decir en qué órdenes hay firma pendiente y **llevar a la receta**, donde se firma viendo. El
 * backend tampoco acepta ya una firma en bloque (§Post-F9.68: esconder *y* bloquear).
 *
 * A1: los conteos por tipo y la marca de "ya frena compras" los AGREGA EL SERVIDOR (misma regla que
 * el concentrado de F5-E7); esta pantalla no suma nada.
 *
 * Permisos (§Post-F9.68): el MENÚ y la RUTA exigen `desarrollo.ver`. Firmar exige
 * `desarrollo.administrar` y ya no se hace aquí, así que esta pantalla no consulta ese permiso.
 */
export function RecetasPorLiberarPagina(): React.JSX.Element {
  const navigate = useNavigate();
  // ⭐ V1-E3j: el destino de la fila es la RECETA de la orden, gobernada por `desarrollo.ver` — el
  // mismo permiso que abre esta bandeja, así que el camino nunca es un enlace muerto (§Post-F9.68).
  // Antes apuntaba al panel de la OP y por eso pedía `ordenes.ver`.
  const [texto, setTexto] = useState('');
  const busqueda = useDebounce(texto.trim(), 300);
  const [soloConOrdenCompra, setSoloConOrdenCompra] = useState(false);
  const [pagina, setPagina] = useState(1);

  const consulta = useRecetasPorLiberar({
    pagina,
    porPagina: 20,
    soloConOrdenCompra,
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });
  const datos = consulta.data;
  const filas = datos?.datos ?? [];
  const totalPaginas = datos?.totalPaginas ?? 0;

  /** A la pantalla propia de la receta (V1-E3j) — la misma que abre el detalle de la OP. */
  function abrirReceta(idOrden: number): void {
    void navigate(`/produccion/ordenes/${String(idOrden)}/receta`);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b bg-background px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
              Recetas por liberar
            </h1>
            <p className="text-[12.5px] text-muted-foreground">
              Órdenes cuya receta espera la firma de Desarrollo. Sin firmar, ese material no se
              compra. «Ver la receta» abre la orden completa: ahí se revisa y se firma renglón por
              renglón, que es la única forma de liberar. Aquí salen también, arriba y marcadas{' '}
              <strong>En corrección</strong>, las recetas que alguien reabrió: ésas tienen la compra
              de toda su orden congelada hasta que se cierren.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-xs">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="pl-8"
              placeholder="Buscar por folio, modelo o cliente…"
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value);
                setPagina(1);
              }}
              data-testid="rpl-buscar"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-input accent-primary"
              checked={soloConOrdenCompra}
              onChange={(e) => {
                setSoloConOrdenCompra(e.target.checked);
                setPagina(1);
              }}
              data-testid="rpl-solo-con-oc"
            />
            Solo las que ya frenan compras
          </label>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        {consulta.isPending ? (
          <p className="text-sm text-muted-foreground" data-testid="rpl-cargando">
            Cargando pendientes…
          </p>
        ) : consulta.isError ? (
          <div className="space-y-2" role="alert">
            <p className="text-sm text-destructive" data-testid="rpl-error">
              {consulta.error.message}
            </p>
            <Button variant="outline" size="sm" onClick={() => void consulta.refetch()}>
              Reintentar
            </Button>
          </div>
        ) : filas.length === 0 ? (
          <div
            className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
            data-testid="rpl-vacio"
          >
            No hay recetas pendientes de liberar. Todo lo que se puede comprar, está autorizado.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>OP</TablaDensaHead>
                  <TablaDensaHead>Modelo</TablaDensaHead>
                  <TablaDensaHead>Cliente</TablaDensaHead>
                  <TablaDensaHead>Entrega</TablaDensaHead>
                  <TablaDensaHead>Falta liberar</TablaDensaHead>
                  <TablaDensaHead className="w-40" />
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {filas.map((f) => (
                  <TablaDensaFila key={f.idOrden} data-testid="rpl-fila" data-id-orden={f.idOrden}>
                    <TablaDensaCelda>
                      <button
                        type="button"
                        className="font-medium underline decoration-dotted underline-offset-2"
                        onClick={() => abrirReceta(f.idOrden)}
                        data-testid={`rpl-abrir-${f.idOrden}`}
                      >
                        {f.folio}
                      </button>
                    </TablaDensaCelda>
                    <TablaDensaCelda>{f.modelo}</TablaDensaCelda>
                    <TablaDensaCelda>{f.cliente}</TablaDensaCelda>
                    <TablaDensaCelda>{f.fechaEntrega ?? '—'}</TablaDensaCelda>
                    <TablaDensaCelda>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm">{textoFalta(f)}</span>
                        {/* ⭐⭐ V1-E8z (§Post-F9.165 punto 7) — EL DISTINTIVO SIN EL CUAL LA ETAPA NO
                            SIRVE. Reabrir sólo marca (no desfirma), así que estas órdenes NO tienen
                            renglones pendientes: sin este chip la fila se leería como una más, y
                            sin la fila la orden quedaría con la compra congelada e invisible. */}
                        {f.abiertaEn !== null ? (
                          <ChipEstado
                            tono="crit"
                            data-testid="rpl-en-correccion"
                            title={
                              f.abiertaMotivo === null
                                ? 'La compra de esta orden está congelada hasta que se cierre la receta'
                                : `Motivo: ${f.abiertaMotivo}`
                            }
                          >
                            <Lock className="size-3" aria-hidden /> En corrección · compra congelada
                          </ChipEstado>
                        ) : null}
                        {/* ⭐ La marca que Daniel pidió: aquí YA hay dinero esperando la firma. */}
                        {f.conOrdenCompra ? (
                          <ChipEstado tono="crit" data-testid="rpl-frena-dinero">
                            <AlertTriangle className="size-3" aria-hidden /> Ya frena compras
                          </ChipEstado>
                        ) : null}
                      </span>
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      <span className="flex flex-wrap justify-end gap-1.5">
                        {/* ⭐ V1-E3j — EL CAMINO AL DETALLE, explícito. Sin él la fila solo ofrecía
                            firmar TODO junto, y quien quería revisar antes no tenía por dónde. */}
                        {/* ⭐ V1-E3k (§Post-F9.80): ÚNICA acción de la fila. Al lado vivía «Revisar
                            y liberar», que firmaba la receta entera sin enseñarla; se retiró. */}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          title="Abrir la receta completa: revisar y liberar renglón por renglón"
                          onClick={() => abrirReceta(f.idOrden)}
                          data-testid={`rpl-ver-${f.idOrden}`}
                        >
                          <Maximize2 aria-hidden /> Ver la receta
                        </Button>
                      </span>
                    </TablaDensaCelda>
                  </TablaDensaFila>
                ))}
              </TablaDensaCuerpo>
            </TablaDensa>
          </div>
        )}

        {datos !== undefined && totalPaginas > 1 ? (
          <div className="mt-4 flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground" data-testid="rpl-total">
              {datos.total} {datos.total === 1 ? 'orden' : 'órdenes'}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pagina <= 1 || consulta.isFetching}
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
              >
                Anterior
              </Button>
              <span className="num text-muted-foreground">
                {pagina} / {totalPaginas}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={pagina >= totalPaginas || consulta.isFetching}
                onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              >
                Siguiente
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * "3 avíos, 1 tela" — el conteo POR TIPO que pidió Daniel, ya redactado. Los números vienen
 * agregados del servidor; aquí solo se enuncian (A1).
 */
export function textoFalta(f: {
  telas: number;
  avios: number;
  artes: number;
  porLiberar: number;
}): string {
  const partes: string[] = [];
  if (f.telas > 0) partes.push(`${f.telas} ${f.telas === 1 ? 'tela' : 'telas'}`);
  if (f.avios > 0) partes.push(`${f.avios} ${f.avios === 1 ? 'avío' : 'avíos'}`);
  if (f.artes > 0) partes.push(`${f.artes} ${f.artes === 1 ? 'arte' : 'artes'}`);
  if (partes.length > 0) return partes.join(', ');
  // ⭐⭐ V1-E8z: desde esta etapa una fila puede NO tener nada pendiente de firma — es una receta
  // REABIERTA, que entra a la bandeja por el candado y no por los renglones. Decir «0 renglones»
  // sería un número inútil justo donde el chip «En corrección» ya dice lo que pasa.
  return f.porLiberar === 0 ? 'Nada por firmar: falta cerrarla' : `${f.porLiberar} renglones`;
}
