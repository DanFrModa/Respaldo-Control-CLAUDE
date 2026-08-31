import { AlertTriangle, Maximize2, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useRecetasPorRevisar, type RecetaPorRevisar } from '@/api/modelos';
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
 * ⭐⭐ BANDEJA «RECETAS POR REVISAR» — V1-E8r (§Post-F9.140, DANIEL 29-ago-2026).
 *
 * *"Creo que despues de una negociacion, tiene que haber una validadcion de la receta original. O
 * sea, de alguna manera deberia de pasar un filtro para ver lo que se negocio con el cliente. y como
 * se cerro."*
 *
 * EL PROBLEMA QUE RESUELVE. La FIRMA de la receta negociada **ya existía** (V1-E7d), pero no había
 * forma de *ver* la cola: sólo te topabas con ella cuando ya querías generar la OP. Esto es la cola.
 *
 * 🔴 **V1-E9c (§Post-F9.169) — Y AHORA ES LO ÚNICO QUE HAY.** Daniel disolvió el muro que había
 * detrás: *"todo lo que no está firmado simplemente no se puede comprar, **pero no detiene ni la
 * producción** ni los demás renglones ya firmados"*. La revisión pasó a ser un REGISTRO, así que
 * esta lista es lo único que hace que se levante — y por eso **también salen las versiones que ya
 * están en producción**: son las que están corriendo sin que nadie las haya revisado.
 *
 * 🔴 **LA BANDEJA NO FIRMA: LLEVA.** Es la regla que Daniel fijó sobre la bandeja hermana «Recetas
 * por liberar» cuando le quitó el botón de aprobar en bloque: *"siempre se debe liberar uno por
 * uno… no tiene sentido liberar las cosas sin ver"* (§Post-F9.80). Aquí no hay ningún botón que
 * apruebe desde la lista: el código y «Ver la receta» abren la ficha del modelo, que es donde vive
 * la firma y donde se ve la receta completa antes de firmarla.
 *
 * CÓMO SE LEE:
 *  • **Una fila por VERSIÓN** — lo que una persona resuelve de una sentada.
 *  • **Ordenada por lo que ESTORBA PRIMERO**: la fecha comprometida del pedido que está detenido
 *    detrás de esta receta; las que nadie ha pedido, al final, y entre ellas la más vieja arriba.
 *  • **«Ya frena un pedido»** marca las versiones que el cliente YA ordenó: ahí hay dinero
 *    comprometido esperando esta receta. No es lo mismo que una versión recién negociada.
 *  • **«De»** es el modelo padre — *"la receta original"* contra la que Daniel quiere cotejar.
 *
 * A1: la fecha comprometida, las piezas y la marca las AGREGA EL SERVIDOR (misma regla que la
 * bandeja hermana y el concentrado de F5-E7); esta pantalla no suma nada.
 *
 * Permisos: el MENÚ y la RUTA exigen `modelos.ver` — el mismo que abre la ficha a la que lleva, así
 * que el camino nunca es un enlace muerto. Firmar exige `modelos.aprobar-receta` y no se hace aquí.
 */
export function RecetasPorRevisarPagina(): React.JSX.Element {
  const navigate = useNavigate();
  const [texto, setTexto] = useState('');
  const busqueda = useDebounce(texto.trim(), 300);
  const [soloConPedido, setSoloConPedido] = useState(false);
  const [pagina, setPagina] = useState(1);

  const consulta = useRecetasPorRevisar({
    pagina,
    porPagina: 20,
    soloConPedido,
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });
  const datos = consulta.data;
  const filas = datos?.datos ?? [];
  const totalPaginas = datos?.totalPaginas ?? 0;

  /**
   * A la FICHA del modelo, donde se revisa la receta y se firma. Se usa el deep-link por `state`
   * que ya entiende `ModelosPagina`: abre ESE modelo aunque el filtro o la paginación lo dejen
   * fuera de la página visible.
   */
  function abrirModelo(idModelo: number): void {
    void navigate('/modelos', { state: { idModelo } });
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b bg-background px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
              Recetas por revisar
            </h1>
            <p className="text-[12.5px] text-muted-foreground">
              Versiones que nacieron de una negociación y cuya receta todavía no se revisa. «Ver la
              receta» abre la ficha del modelo, que es donde se revisa y se firma viéndola.
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
              placeholder="Buscar por modelo, modelo original o cliente…"
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value);
                setPagina(1);
              }}
              data-testid="rpr-buscar"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-input accent-primary"
              checked={soloConPedido}
              onChange={(e) => {
                setSoloConPedido(e.target.checked);
                setPagina(1);
              }}
              data-testid="rpr-solo-con-pedido"
            />
            Solo las que ya frenan un pedido
          </label>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        {consulta.isPending ? (
          <p className="text-sm text-muted-foreground" data-testid="rpr-cargando">
            Cargando pendientes…
          </p>
        ) : consulta.isError ? (
          <div className="space-y-2" role="alert">
            <p className="text-sm text-destructive" data-testid="rpr-error">
              {consulta.error.message}
            </p>
            <Button variant="outline" size="sm" onClick={() => void consulta.refetch()}>
              Reintentar
            </Button>
          </div>
        ) : filas.length === 0 ? (
          <div
            className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
            data-testid="rpr-vacio"
          >
            No hay recetas negociadas esperando revisión. Todo lo que se negoció, ya se revisó.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Modelo</TablaDensaHead>
                  <TablaDensaHead>De</TablaDensaHead>
                  <TablaDensaHead>Cliente</TablaDensaHead>
                  <TablaDensaHead>Entrega</TablaDensaHead>
                  <TablaDensaHead>Estado</TablaDensaHead>
                  <TablaDensaHead className="w-40" />
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {filas.map((f) => (
                  <TablaDensaFila
                    key={f.idModelo}
                    data-testid="rpr-fila"
                    data-id-modelo={f.idModelo}
                  >
                    <TablaDensaCelda>
                      <button
                        type="button"
                        className="font-medium underline decoration-dotted underline-offset-2"
                        onClick={() => {
                          abrirModelo(f.idModelo);
                        }}
                        data-testid={`rpr-abrir-${String(f.idModelo)}`}
                      >
                        {f.codigo}
                      </button>
                      {f.descripcion === null ? null : (
                        <span className="block text-[12px] text-muted-foreground">
                          {f.descripcion}
                        </span>
                      )}
                    </TablaDensaCelda>
                    {/* La «receta original» de la que salió esta versión: lo que Daniel quiere cotejar. */}
                    <TablaDensaCelda>{f.codigoPadre ?? '—'}</TablaDensaCelda>
                    <TablaDensaCelda>{f.cliente ?? '—'}</TablaDensaCelda>
                    <TablaDensaCelda>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm">{f.fechaCompromiso ?? '—'}</span>
                        {/* ⭐ La marca que Daniel pidió: aquí YA hay un pedido detenido. */}
                        {f.conPedido ? (
                          <ChipEstado tono="crit" data-testid="rpr-frena-dinero">
                            <AlertTriangle className="size-3" aria-hidden />{' '}
                            {textoPedidoDetenido(f)}
                          </ChipEstado>
                        ) : null}
                      </span>
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      <span className="flex flex-col gap-1">
                        <ChipEstado tono={f.estado === 'rechazada' ? 'crit' : 'warn'}>
                          {f.estado === 'rechazada' ? 'Rechazada' : 'Sin revisar'}
                        </ChipEstado>
                        {/* La nota es lo ÚNICO que le dice al que vuelve a revisar por qué sigue
                            aquí (rechazo, o la firma que se cayó sola al cambiar la receta). */}
                        {f.revisionNota === null ? null : (
                          <span className="text-[12px] text-crit" data-testid="rpr-nota">
                            «{f.revisionNota}»
                          </span>
                        )}
                      </span>
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      <span className="flex flex-wrap justify-end gap-1.5">
                        {/* 🔴 ÚNICA acción de la fila, y NO firma: lleva. La bandeja hermana tuvo
                            un botón que aprobaba desde aquí y Daniel lo quitó (§Post-F9.80). */}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          title="Abrir la ficha del modelo: revisar la receta completa y firmarla"
                          onClick={() => {
                            abrirModelo(f.idModelo);
                          }}
                          data-testid={`rpr-ver-${String(f.idModelo)}`}
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
            <span className="text-muted-foreground" data-testid="rpr-total">
              {datos.total} {datos.total === 1 ? 'versión' : 'versiones'}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pagina <= 1 || consulta.isFetching}
                onClick={() => {
                  setPagina((p) => Math.max(1, p - 1));
                }}
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
                onClick={() => {
                  setPagina((p) => Math.min(totalPaginas, p + 1));
                }}
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
 * «Frena 1,200 pzas» — el dinero que ya está esperando, enunciado. El número viene AGREGADO del
 * servidor; aquí sólo se formatea (A1).
 */
export function textoPedidoDetenido(f: Pick<RecetaPorRevisar, 'piezasPedidas'>): string {
  return `Frena ${f.piezasPedidas.toLocaleString('es-MX')} pzas`;
}
