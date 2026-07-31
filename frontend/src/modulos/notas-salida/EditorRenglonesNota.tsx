import { Trash2Icon } from 'lucide-react';

import { useKardexTela } from '@/api/inventario-materiales';
import type { Avio } from '@/api/avios';
import type { Tela } from '@/api/telas';
import type { OrdenLigera } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

import { aNumero, renglonVacio, type RenglonNotaCaptura } from './captura';

/** Existencia de un avío en el almacén origen elegido (para el aviso "excede", §4.6). */
export interface ExistenciaAvioNota {
  existencia: number;
  unidad: string | null;
}

/**
 * EDITOR DE RENGLONES de una nota de salida (F4-E5; rediseño R6 §4.6). Este constructor es
 * **SOLO-AVÍOS** (§4.6 dec. 2): al armar/editar un borrador solo se AGREGAN renglones de AVÍO (del
 * catálogo + cantidad/unidad); para enviar TELA a una orden está la "Nueva nota de telas" (reusa la
 * salida-a-orden de F4). Por eso ya NO hay selector "Tipo de material". Los renglones de TELA solo
 * aparecen en notas legacy/migradas (E6) y se renderizan en **SOLO LECTURA** (no editables) para no
 * romperlas. Rediseño R6: el renglón de AVÍO marca si el avío está **✓ en la receta de la orden** / **⚠
 * fuera de la receta — se enviará igual** (la nota PROPONE, no LIMITA) y muestra la **existencia
 * disponible** del almacén origen en rojo si la cantidad la excede. Presentación pura (A1): el backend
 * re-valida (XOR avío/tela, liga del renglón de tela, no-negativo del avío al confirmar).
 */
export function EditorRenglonesNota({
  renglones,
  alCambiar,
  avios,
  telas,
  ordenes,
  recetaPorOrden,
  existenciaPorAvio,
  soloLectura = false,
}: {
  renglones: RenglonNotaCaptura[];
  alCambiar: (renglones: RenglonNotaCaptura[]) => void;
  avios: readonly Avio[];
  telas: readonly Tela[];
  ordenes: readonly OrdenLigera[];
  /** Recetas conocidas por orden (idOrden → ids de avío de su receta) para el flag ✓/⚠. */
  recetaPorOrden?: Map<number, Set<number>> | undefined;
  /** Existencia por avío en el almacén origen elegido (para el aviso "excede"). */
  existenciaPorAvio?: Map<number, ExistenciaAvioNota> | undefined;
  soloLectura?: boolean;
}): React.JSX.Element {
  function actualizar(clave: string, cambios: Partial<RenglonNotaCaptura>): void {
    alCambiar(renglones.map((r) => (r.clave === clave ? { ...r, ...cambios } : r)));
  }

  function quitar(clave: string): void {
    alCambiar(renglones.filter((r) => r.clave !== clave));
  }

  function agregar(): void {
    // Las notas de avíos son SOLO-AVÍOS (§4.6 dec. 2): un renglón nuevo siempre es avío.
    alCambiar([...renglones, renglonVacio()]);
  }

  return (
    <div className="space-y-4" data-testid="editor-renglones-nota">
      {renglones.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          {soloLectura ? 'Esta nota no tiene renglones.' : 'Agrega un renglón para empezar.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {renglones.map((renglon, indice) => (
            <li key={renglon.clave} className="rounded-lg border p-3" data-testid="renglon-nota">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium text-muted-foreground">
                  Renglón {indice + 1}
                </span>
                {!soloLectura ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-destructive"
                    onClick={() => quitar(renglon.clave)}
                    aria-label={`Quitar renglón ${indice + 1}`}
                    data-testid="quitar-renglon-nota"
                  >
                    <Trash2Icon className="size-4" aria-hidden />
                  </Button>
                ) : null}
              </div>

              {/* Orden destino. Las notas de avíos NO llevan selector de tipo (solo-avíos, §4.6 dec. 2);
                  para una tela usa la "Nueva nota de telas". El renglón de tela solo aparece en notas
                  legacy/migradas y se muestra en SOLO LECTURA (su orden queda fija). */}
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="text-xs text-muted-foreground">
                  Orden destino (R7)
                  <SelectNativo
                    className="mt-1"
                    aria-label={`Orden destino del renglón ${indice + 1}`}
                    disabled={soloLectura || renglon.tipo === 'tela'}
                    value={renglon.idOrden === null ? '' : String(renglon.idOrden)}
                    onChange={(e) =>
                      actualizar(renglon.clave, {
                        idOrden: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                    data-testid="selector-orden-nota"
                  >
                    <option value="">Elige una orden…</option>
                    {ordenes.map((o) => (
                      <option key={o.id} value={String(o.id)}>
                        Orden {o.folio} · {o.codigoModelo}
                      </option>
                    ))}
                  </SelectNativo>
                </label>
              </div>

              {/* Renglón de AVÍO (editable) o de TELA legacy (SOLO LECTURA, no editable). */}
              {renglon.tipo === 'avio' ? (
                <RenglonAvio
                  renglon={renglon}
                  indice={indice}
                  avios={avios}
                  recetaPorOrden={recetaPorOrden}
                  existenciaPorAvio={existenciaPorAvio}
                  soloLectura={soloLectura}
                  actualizar={actualizar}
                />
              ) : (
                <RenglonTela
                  renglon={renglon}
                  indice={indice}
                  telas={telas}
                  soloLectura
                  actualizar={actualizar}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {!soloLectura ? (
        <Button
          type="button"
          variant="outline"
          onClick={agregar}
          data-testid="agregar-renglon-nota"
        >
          Agregar renglón
        </Button>
      ) : null}
    </div>
  );
}

/** Sub-captura de un renglón de AVÍO: avío del catálogo + cantidad + unidad + flag de receta + existencia. */
function RenglonAvio({
  renglon,
  indice,
  avios,
  recetaPorOrden,
  existenciaPorAvio,
  soloLectura,
  actualizar,
}: {
  renglon: RenglonNotaCaptura;
  indice: number;
  avios: readonly Avio[];
  recetaPorOrden?: Map<number, Set<number>> | undefined;
  existenciaPorAvio?: Map<number, ExistenciaAvioNota> | undefined;
  soloLectura: boolean;
  actualizar: (clave: string, cambios: Partial<RenglonNotaCaptura>) => void;
}): React.JSX.Element {
  // ¿El avío está en la receta de su orden? (la nota PROPONE, no LIMITA — §4.6).
  const receta = renglon.idOrden === null ? undefined : recetaPorOrden?.get(renglon.idOrden);
  const flagReceta =
    receta === undefined || renglon.idAvio === null
      ? null
      : receta.has(renglon.idAvio)
        ? 'en'
        : 'fuera';

  // Existencia del avío en el almacén origen (aviso si la cantidad la excede).
  const existencia = renglon.idAvio === null ? undefined : existenciaPorAvio?.get(renglon.idAvio);
  const excede = existencia !== undefined && aNumero(renglon.cantidad) > existencia.existencia;

  return (
    <div className="mt-2 space-y-1.5">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_6rem_6rem]">
        <label className="text-xs text-muted-foreground">
          Avío
          <SelectNativo
            className="mt-1"
            aria-label={`Avío del renglón ${indice + 1}`}
            disabled={soloLectura}
            value={renglon.idAvio === null ? '' : String(renglon.idAvio)}
            onChange={(e) =>
              actualizar(renglon.clave, {
                idAvio: e.target.value === '' ? null : Number(e.target.value),
              })
            }
            data-testid="selector-avio-nota"
          >
            <option value="">Elige un avío…</option>
            {avios.map((a) => (
              <option key={a.id} value={String(a.id)}>
                {a.clave} — {a.descripcion}
              </option>
            ))}
          </SelectNativo>
        </label>
        <label className="text-xs text-muted-foreground">
          Cantidad
          <Input
            className="mt-1"
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            aria-label={`Cantidad del renglón ${indice + 1}`}
            disabled={soloLectura}
            value={renglon.cantidad}
            onChange={(e) => actualizar(renglon.clave, { cantidad: e.target.value })}
            data-testid="cantidad-nota"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Unidad
          <Input
            className="mt-1"
            aria-label={`Unidad del renglón ${indice + 1}`}
            disabled={soloLectura}
            placeholder="pza, m…"
            value={renglon.unidad}
            onChange={(e) => actualizar(renglon.clave, { unidad: e.target.value })}
            data-testid="unidad-nota"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {flagReceta === 'en' ? (
          <span className="font-medium text-ok" data-testid="flag-receta-nota">
            ✓ en la receta de la orden
          </span>
        ) : flagReceta === 'fuera' ? (
          <span className="font-medium text-warn" data-testid="flag-receta-nota">
            ⚠ fuera de la receta — se enviará igual
          </span>
        ) : null}
        {existencia !== undefined ? (
          excede ? (
            <span className="font-semibold text-crit" data-testid="existencia-nota">
              Excede · hay {existencia.existencia.toLocaleString('es-MX')}
              {existencia.unidad !== null ? ` ${existencia.unidad}` : ''}
            </span>
          ) : (
            <span className="text-muted-foreground" data-testid="existencia-nota">
              Existencia {existencia.existencia.toLocaleString('es-MX')}
              {existencia.unidad !== null ? ` ${existencia.unidad}` : ''}
            </span>
          )
        ) : null}
      </div>
    </div>
  );
}

/**
 * Sub-captura de un renglón de TELA: tela del catálogo + selección de una salida-a-orden YA
 * registrada (E1) de esa orden/tela (decisión e). El selector de salidas-a-orden lee el kardex de la
 * tela elegida y se queda con los movimientos `salida-tela-orden` (no cancelados) de la orden del
 * renglón: cada uno aporta `idLote` + `idMovimientoSalidaTela` + la cantidad enviada (la nota
 * documenta el envío; no descuenta tela).
 */
function RenglonTela({
  renglon,
  indice,
  telas,
  soloLectura,
  actualizar,
}: {
  renglon: RenglonNotaCaptura;
  indice: number;
  telas: readonly Tela[];
  soloLectura: boolean;
  actualizar: (clave: string, cambios: Partial<RenglonNotaCaptura>) => void;
}): React.JSX.Element {
  // Kardex de la tela elegida (solo cuando hay tela): de ahí salen las salidas-a-orden.
  const kardex = useKardexTela(renglon.idTela === null ? undefined : { idTela: renglon.idTela });

  // Movimientos de salida-a-orden de ESTA orden/tela, no cancelados (decisión e).
  const salidas =
    renglon.idOrden === null
      ? []
      : (kardex.data?.renglones ?? []).filter(
          (m) =>
            m.origenTipo === 'salida-tela-orden' &&
            m.origenId === String(renglon.idOrden) &&
            !m.cancelado,
        );

  return (
    <div className="mt-2 space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs text-muted-foreground">
          Tela
          <SelectNativo
            className="mt-1"
            aria-label={`Tela del renglón ${indice + 1}`}
            disabled={soloLectura}
            value={renglon.idTela === null ? '' : String(renglon.idTela)}
            onChange={(e) =>
              actualizar(renglon.clave, {
                idTela: e.target.value === '' ? null : Number(e.target.value),
                idLote: null,
                idMovimientoSalidaTela: null,
                cantidad: '',
              })
            }
            data-testid="selector-tela-nota"
          >
            <option value="">Elige una tela…</option>
            {telas.map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.nombre}
              </option>
            ))}
          </SelectNativo>
        </label>

        <label className="text-xs text-muted-foreground">
          Salida de tela a la orden (decisión e)
          <SelectNativo
            className="mt-1"
            aria-label={`Salida de tela referenciada del renglón ${indice + 1}`}
            disabled={
              soloLectura || renglon.idTela === null || renglon.idOrden === null || kardex.isPending
            }
            value={
              renglon.idMovimientoSalidaTela === null ? '' : String(renglon.idMovimientoSalidaTela)
            }
            onChange={(e) => {
              const idMov = e.target.value === '' ? null : Number(e.target.value);
              const mov = salidas.find((m) => m.idMovimiento === idMov);
              actualizar(renglon.clave, {
                idMovimientoSalidaTela: idMov,
                idLote: mov?.idLote ?? null,
                cantidad: mov === undefined ? '' : String(mov.salida),
              });
            }}
            data-testid="selector-salida-tela-nota"
          >
            <option value="">
              {renglon.idTela === null || renglon.idOrden === null
                ? 'Elige tela y orden primero…'
                : 'Elige la salida-a-orden…'}
            </option>
            {salidas.map((m) => (
              <option key={m.idMovimiento} value={String(m.idMovimiento)}>
                Folio {m.folio} · lote {m.loteClave ?? '—'} · {m.salida.toLocaleString('es-MX')} ·{' '}
                {m.fecha}
              </option>
            ))}
          </SelectNativo>
        </label>
      </div>

      {/* Cantidad documentada (viene de la salida elegida; no es editable). */}
      <p className="text-xs text-muted-foreground" data-testid="cantidad-tela-nota">
        Cantidad enviada (de la salida-a-orden):{' '}
        <span className="font-medium tabular-nums">
          {renglon.idMovimientoSalidaTela === null
            ? '—'
            : Number(renglon.cantidad).toLocaleString('es-MX')}
        </span>
      </p>

      {renglon.idTela !== null &&
      renglon.idOrden !== null &&
      !kardex.isPending &&
      salidas.length === 0 ? (
        <p className="text-xs text-amber-600" data-testid="sin-salidas-tela-nota">
          No hay salidas de esta tela a esa orden todavía. Registra primero la salida de tela a la
          orden.
        </p>
      ) : null}
    </div>
  );
}
