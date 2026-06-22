import { Trash2Icon } from 'lucide-react';

import { useKardexTela } from '@/api/inventario-materiales';
import type { Avio } from '@/api/avios';
import type { Tela } from '@/api/telas';
import type { OrdenLigera } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

import { renglonVacio, type RenglonNotaCaptura, type TipoMaterialNota } from './captura';

/**
 * EDITOR DE RENGLONES de una nota de salida (F4-E5): cada renglón liga una orden de producción
 * destino y un material — AVÍO (del catálogo + cantidad/unidad) o TELA. El renglón de TELA NO captura
 * una cantidad libre de descuento (decisión e): se ELIGE una salida-a-orden YA registrada (E1) de esa
 * orden/tela, que aporta el lote, el movimiento (`idMovimientoSalidaTela`) y la cantidad enviada — la
 * nota solo DOCUMENTA ese envío. Presentación pura (A1): no valida reglas de negocio; el backend
 * re-valida (XOR avío/tela, liga del renglón de tela, no-negativo del avío al confirmar).
 */
export function EditorRenglonesNota({
  renglones,
  alCambiar,
  avios,
  telas,
  ordenes,
  soloLectura = false,
}: {
  renglones: RenglonNotaCaptura[];
  alCambiar: (renglones: RenglonNotaCaptura[]) => void;
  avios: readonly Avio[];
  telas: readonly Tela[];
  ordenes: readonly OrdenLigera[];
  soloLectura?: boolean;
}): React.JSX.Element {
  function actualizar(clave: string, cambios: Partial<RenglonNotaCaptura>): void {
    alCambiar(renglones.map((r) => (r.clave === clave ? { ...r, ...cambios } : r)));
  }

  function quitar(clave: string): void {
    alCambiar(renglones.filter((r) => r.clave !== clave));
  }

  function agregar(): void {
    alCambiar([...renglones, renglonVacio()]);
  }

  /** Cambia el tipo de material y limpia los campos del tipo anterior. */
  function cambiarTipo(clave: string, tipo: TipoMaterialNota): void {
    actualizar(clave, {
      tipo,
      idAvio: null,
      idTela: null,
      idLote: null,
      idMovimientoSalidaTela: null,
      cantidad: '',
    });
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

              {/* Orden destino + tipo de material. */}
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="text-xs text-muted-foreground">
                  Orden destino (R7)
                  <SelectNativo
                    className="mt-1"
                    aria-label={`Orden destino del renglón ${indice + 1}`}
                    disabled={soloLectura}
                    value={renglon.idOrden === null ? '' : String(renglon.idOrden)}
                    onChange={(e) =>
                      actualizar(renglon.clave, {
                        idOrden: e.target.value === '' ? null : Number(e.target.value),
                        // La salida-a-orden depende de la orden: límpiala al cambiar de orden.
                        idLote: null,
                        idMovimientoSalidaTela: null,
                        ...(renglon.tipo === 'tela' ? { cantidad: '' } : {}),
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

                <label className="text-xs text-muted-foreground">
                  Tipo de material
                  <SelectNativo
                    className="mt-1"
                    aria-label={`Tipo de material del renglón ${indice + 1}`}
                    disabled={soloLectura}
                    value={renglon.tipo}
                    onChange={(e) => cambiarTipo(renglon.clave, e.target.value as TipoMaterialNota)}
                    data-testid="tipo-material-nota"
                  >
                    <option value="avio">Avío</option>
                    <option value="tela">Tela</option>
                  </SelectNativo>
                </label>
              </div>

              {/* Selector del material según el tipo. */}
              {renglon.tipo === 'avio' ? (
                <RenglonAvio
                  renglon={renglon}
                  indice={indice}
                  avios={avios}
                  soloLectura={soloLectura}
                  actualizar={actualizar}
                />
              ) : (
                <RenglonTela
                  renglon={renglon}
                  indice={indice}
                  telas={telas}
                  soloLectura={soloLectura}
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

/** Sub-captura de un renglón de AVÍO: avío del catálogo + cantidad + unidad. */
function RenglonAvio({
  renglon,
  indice,
  avios,
  soloLectura,
  actualizar,
}: {
  renglon: RenglonNotaCaptura;
  indice: number;
  avios: readonly Avio[];
  soloLectura: boolean;
  actualizar: (clave: string, cambios: Partial<RenglonNotaCaptura>) => void;
}): React.JSX.Element {
  return (
    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_6rem_6rem]">
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
