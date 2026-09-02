import { Maximize2, Search, TrendingDown } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { usePromesasIncumplidas, type PromesaIncumplida } from '@/api/modelos';
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
import { formatearFecha, formatearMoneda } from '@/lib/formato';
import { useDebounce } from '@/lib/useDebounce';

/**
 * ⭐⭐ «PROMESAS INCUMPLIDAS» — V1-E9p (§Post-F9.144(b), DANIEL 29-ago-2026).
 *
 * *«me quitan un cierre y yo le pongo que estimo que la maquila costará 5 pesos menos. Esa es mi
 * estimación en ese momento, pero ya en la oficina se tiene que **buscar** una maquila de ese costo
 * con las nuevas características de la prenda… **Todo eso se intentará hacer así, pero no es seguro
 * que se consiga**.»*
 *
 * 🔴 **EL PROBLEMA QUE RESUELVE, con las palabras de la decisión:** *«Desarrollo cuadra la receta
 * con la maquila que sí consiguió, el renglón se va de la bandeja como "resuelto", y **nadie se
 * entera de que el margen que Daniel vendió ya no existe**»*. Un cuadre que sólo puede terminar en
 * «listo» convierte un incumplimiento en un silencio. Esta pantalla es el otro final.
 *
 * ⚠️ **A QUIÉN le importa, y por eso existe aparte.** La bandeja «Recetas por revisar» es de quien
 * despacha la cola y **se vacía** al firmar. Esto es del **DUEÑO**, que ya le dio ese precio al
 * cliente, y **se queda**: un margen que se perdió no deja de haberse perdido porque alguien firme.
 *
 * 🔴 **NO FIRMA, NI BLOQUEA.** Sólo lectura, igual que la bandeja (§Post-F9.140 punto 4). *Avisar no
 * es bloquear* (§Post-F9.64): aquí no se impide nada, se hace que se vea.
 *
 * A1: **la brecha, el impacto y el total los agrega el SERVIDOR**; esta pantalla no multiplica ni
 * suma nada — y el total es el de TODA la cartera, no el de la página que estés viendo.
 *
 * Permisos: `modelos.ver` + `consultas.ver-importes`. Los dos, porque esta pantalla ES el dinero.
 */
export function PromesasIncumplidasPagina(): React.JSX.Element {
  const navigate = useNavigate();
  const [texto, setTexto] = useState('');
  const busqueda = useDebounce(texto.trim(), 300);
  const [pagina, setPagina] = useState(1);

  const consulta = usePromesasIncumplidas({
    pagina,
    porPagina: 20,
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });
  const datos = consulta.data;
  const filas = datos?.datos ?? [];
  const totalPaginas = datos?.totalPaginas ?? 0;

  /** A la FICHA del modelo (el mismo deep-link que usa la bandeja hermana). */
  function abrirModelo(idModelo: number): void {
    void navigate('/modelos', { state: { idModelo } });
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b bg-background px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
              Promesas incumplidas
            </h1>
            <p className="text-[12.5px] text-muted-foreground">
              Modelos que se vendieron con un costo estimado en la negociación y, al buscarlo de
              verdad, no se consiguió. La receta está revisada y firmada; lo que no se logró es el
              costo.
            </p>
          </div>
          {/* ⭐ EL NÚMERO QUE SE MIRA PRIMERO: el margen perdido de TODA la cartera, no el de esta
              página. Lo agrega el servidor (A1). */}
          {datos === undefined ? null : (
            <div className="rounded-lg border bg-crit-soft px-3 py-2 text-right">
              <p className="text-[11.5px] tracking-wide text-muted-foreground uppercase">
                Margen comprometido
              </p>
              <p className="num text-[19px] font-semibold text-crit" data-testid="pi-impacto-total">
                {formatearMoneda(datos.impactoTotal)}
              </p>
              <p className="text-[11.5px] text-muted-foreground" data-testid="pi-total">
                {datos.total} {datos.total === 1 ? 'modelo' : 'modelos'}
              </p>
            </div>
          )}
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
              data-testid="pi-buscar"
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        {consulta.isPending ? (
          <p className="text-sm text-muted-foreground" data-testid="pi-cargando">
            Cargando…
          </p>
        ) : consulta.isError ? (
          <div className="space-y-2" role="alert">
            <p className="text-sm text-destructive" data-testid="pi-error">
              {consulta.error.message}
            </p>
            <Button variant="outline" size="sm" onClick={() => void consulta.refetch()}>
              Reintentar
            </Button>
          </div>
        ) : filas.length === 0 ? (
          <div
            className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
            data-testid="pi-vacio"
          >
            No hay promesas incumplidas: todo lo que se negoció, se consiguió.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Modelo</TablaDensaHead>
                  <TablaDensaHead>Cliente</TablaDensaHead>
                  <TablaDensaHead className="text-right">Prometí</TablaDensaHead>
                  <TablaDensaHead className="text-right">Conseguí</TablaDensaHead>
                  <TablaDensaHead className="text-right">Brecha</TablaDensaHead>
                  <TablaDensaHead className="text-right">Piezas</TablaDensaHead>
                  <TablaDensaHead className="text-right">Margen</TablaDensaHead>
                  <TablaDensaHead>Por qué</TablaDensaHead>
                  <TablaDensaHead className="w-40" />
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {filas.map((f) => (
                  <TablaDensaFila
                    key={f.idModelo}
                    data-testid="pi-fila"
                    data-id-modelo={f.idModelo}
                  >
                    <TablaDensaCelda>
                      <button
                        type="button"
                        className="font-medium underline decoration-dotted underline-offset-2"
                        onClick={() => {
                          abrirModelo(f.idModelo);
                        }}
                        data-testid={`pi-abrir-${String(f.idModelo)}`}
                      >
                        {f.codigo}
                      </button>
                      <span className="block text-[12px] text-muted-foreground">
                        {f.codigoPadre === null ? '' : `de ${f.codigoPadre}`}
                        {f.revisadoEn === null ? '' : ` · ${formatearFecha(f.revisadoEn)}`}
                        {f.revisadoPor === null ? '' : ` · ${f.revisadoPor}`}
                      </span>
                    </TablaDensaCelda>
                    <TablaDensaCelda>{f.cliente ?? '—'}</TablaDensaCelda>
                    <TablaDensaCelda className="num text-right">
                      {f.costoPrometido === null ? (
                        <span className="text-muted-foreground" title={SIN_MESA}>
                          —
                        </span>
                      ) : (
                        formatearMoneda(f.costoPrometido)
                      )}
                    </TablaDensaCelda>
                    <TablaDensaCelda className="num text-right">
                      {formatearMoneda(f.costoConseguido)}
                    </TablaDensaCelda>
                    <TablaDensaCelda className="num text-right">
                      {/* ⭐ LA BRECHA. Positiva = costó MÁS de lo que se vendió. Sin los dos números
                          no hay brecha, y aquí un 0 diría «se cumplió exacto»: por eso va un guion. */}
                      {f.brecha === null ? (
                        <span className="text-muted-foreground" title={SIN_MESA}>
                          —
                        </span>
                      ) : (
                        <ChipEstado
                          tono={f.brecha > 0 ? 'crit' : 'ok'}
                          data-testid="pi-brecha"
                          sinPunto
                        >
                          {f.brecha > 0 ? <TrendingDown className="size-3" aria-hidden /> : null}
                          {textoBrecha(f)}
                        </ChipEstado>
                      )}
                    </TablaDensaCelda>
                    <TablaDensaCelda className="num text-right">
                      {f.piezasPedidas.toLocaleString('es-MX')}
                    </TablaDensaCelda>
                    <TablaDensaCelda className="num text-right">
                      {f.impacto === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span
                          className={f.impacto > 0 ? 'font-medium text-crit' : undefined}
                          data-testid="pi-impacto"
                        >
                          {formatearMoneda(f.impacto)}
                        </span>
                      )}
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      {f.nota === null ? (
                        '—'
                      ) : (
                        <span className="text-[12px]" data-testid="pi-nota">
                          «{f.nota}»
                        </span>
                      )}
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      <span className="flex flex-wrap justify-end gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          title="Abrir la ficha del modelo y ver la receta con la que quedó"
                          onClick={() => {
                            abrirModelo(f.idModelo);
                          }}
                          data-testid={`pi-ver-${String(f.idModelo)}`}
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
          <div className="mt-4 flex items-center justify-end gap-2 text-sm">
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
        ) : null}
      </div>
    </div>
  );
}

/** Lo que explica un guion en «Prometí»/«Brecha»: no se sabe, que no es lo mismo que «se cumplió». */
const SIN_MESA =
  'No se encontró la negociación de la que salió esta versión, así que no hay con qué comparar.';

/**
 * «+$2.00 por prenda» — la brecha, enunciada con su signo. El número viene del servidor; aquí sólo
 * se formatea (A1).
 */
export function textoBrecha(f: Pick<PromesaIncumplida, 'brecha'>): string {
  if (f.brecha === null) {
    return '—';
  }
  const signo = f.brecha > 0 ? '+' : '';
  return `${signo}${formatearMoneda(f.brecha)}`;
}
