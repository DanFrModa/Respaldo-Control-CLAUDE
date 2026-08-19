import { AlertTriangle, LockOpen, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useLiberarReceta, useRecetasPorLiberar } from '@/api/receta-orden';
import type { RecetaPorLiberar } from '@/api/tipos';
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
import { useSesion } from '@/sesion/useSesion';

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
 *  • **Se libera desde aquí**, sin dar la vuelta por el Centro de Órdenes — que es el punto entero
 *    de la bandeja.
 *
 * A1: los conteos por tipo y la marca de "ya frena compras" los AGREGA EL SERVIDOR (misma regla que
 * el concentrado de F5-E7); esta pantalla no suma nada. Y qué se puede firmar —que no queden
 * renglones sin revisar— también lo decide el backend: si no se puede, lo dice y aquí se enseña tal
 * cual, con el enlace a la orden para resolverlo a mano.
 *
 * Permisos (§Post-F9.68, las tres capas): el MENÚ y la RUTA exigen `desarrollo.ver`; el botón de
 * liberar solo se pinta con `desarrollo.administrar`, y el backend lo re-verifica.
 */
export function RecetasPorLiberarPagina(): React.JSX.Element {
  const navigate = useNavigate();
  const { tienePermiso } = useSesion();
  const puedeLiberar = tienePermiso('desarrollo.administrar');
  // El destino del enlace es el panel de la OP, que exige `ordenes.ver` para abrirse: si la sesión
  // no lo tiene, la fila no ofrece un enlace muerto (§Post-F9.68).
  const puedeAbrirLaOrden = tienePermiso('ordenes.ver');

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
  const liberar = useLiberarReceta();

  const datos = consulta.data;
  const filas = datos?.datos ?? [];
  const totalPaginas = datos?.totalPaginas ?? 0;

  /**
   * ⭐ REVISAR **Y** FIRMAR, en un solo acto (§Post-F9.72).
   *
   * `revisarPendientes: true` es lo que hace que este botón sirva **en el caso normal**: una orden
   * recién creada copia la receta del modelo y sus renglones nacen `sin_revisar`, así que un
   * «liberar» a secas rebotaría con *"quedan 3 renglones sin revisar"* y obligaría a ir al Centro
   * de Órdenes a marcarlos y volver — la vuelta que esta bandeja existe para evitar, y justo para
   * las órdenes que nadie ha tocado, que son las que la llenan.
   *
   * La regla NO se relaja aquí (A1): es el servidor quien marca y firma en la misma transacción, y
   * quien sigue rechazando lo que no se puede firmar (una receta vacía, por ejemplo).
   */
  function revisarYLiberar(fila: RecetaPorLiberar): void {
    liberar.mutate(
      { idOrden: fila.idOrden, cuerpo: { alcance: 'todo', revisarPendientes: true } },
      {
        onSuccess: (r) =>
          toast.success(
            r.resumen.porLiberar === 0
              ? `OP ${fila.folio}: receta liberada completa.`
              : `OP ${fila.folio}: liberado. Quedan ${r.resumen.porLiberar} por firmar.`,
          ),
        // Si el backend frena de todos modos, se dice TAL CUAL: la bandeja no adivina ni esconde el
        // motivo, y la fila sigue ahí con su enlace a la orden para resolverlo a mano.
        onError: (error) => toast.error(`OP ${fila.folio}: ${error.message}`),
      },
    );
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
              compra. «Revisar y liberar» da por buena la receta de esa orden y la firma completa;
              para ajustar algo antes, abre la orden.
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
                  <TablaDensaHead className="w-44" />
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {filas.map((f) => (
                  <TablaDensaFila key={f.idOrden} data-testid="rpl-fila" data-id-orden={f.idOrden}>
                    <TablaDensaCelda>
                      {puedeAbrirLaOrden ? (
                        <button
                          type="button"
                          className="font-medium underline decoration-dotted underline-offset-2"
                          onClick={() =>
                            void navigate('/produccion/ordenes', {
                              state: { idOrden: f.idOrden },
                            })
                          }
                          data-testid={`rpl-abrir-${f.idOrden}`}
                        >
                          {f.folio}
                        </button>
                      ) : (
                        <span className="font-medium">{f.folio}</span>
                      )}
                    </TablaDensaCelda>
                    <TablaDensaCelda>{f.modelo}</TablaDensaCelda>
                    <TablaDensaCelda>{f.cliente}</TablaDensaCelda>
                    <TablaDensaCelda>{f.fechaEntrega ?? '—'}</TablaDensaCelda>
                    <TablaDensaCelda>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm">{textoFalta(f)}</span>
                        {/* ⭐ La marca que Daniel pidió: aquí YA hay dinero esperando la firma. */}
                        {f.conOrdenCompra ? (
                          <ChipEstado tono="crit" data-testid="rpl-frena-dinero">
                            <AlertTriangle className="size-3" aria-hidden /> Ya frena compras
                          </ChipEstado>
                        ) : null}
                      </span>
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      {puedeLiberar ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={liberar.isPending}
                          title="Da por revisada la receta de esta orden y la firma completa"
                          onClick={() => revisarYLiberar(f)}
                          data-testid={`rpl-liberar-${f.idOrden}`}
                        >
                          <LockOpen aria-hidden /> Revisar y liberar
                        </Button>
                      ) : null}
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
  return partes.length === 0 ? `${f.porLiberar} renglones` : partes.join(', ');
}
