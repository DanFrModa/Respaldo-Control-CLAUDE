import { Trash2Icon } from 'lucide-react';

import type { Avio } from '@/api/avios';
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
 * EDITOR DE RENGLONES de una nota de salida (F4-E5; rediseño R6 §4.6). La nota de salida es **DE
 * AVÍOS**: al armar/editar un borrador solo se AGREGAN renglones de AVÍO (del catálogo +
 * cantidad/unidad).
 *
 * §Post-F9.38 (V1-E3b) — LA TELA NO LLEVA NOTA. Daniel lo cerró: *"Está bien el movimiento de tela
 * sin la nota de salida cuando sea para consumo de una orden"*. La tela sale a una orden por
 * «Salida de tela a orden» (por color, `/inventarios/telas/salida-orden`) y basta el movimiento de
 * kardex; lo que sí lleva papel es el TRASPASO entre almacenes, y ese se imprime desde el propio
 * traspaso. Por eso aquí se RETIRÓ la captura del renglón de tela —que además era incapturable: el
 * dominio exige lote y las salidas nuevas por color no lo tienen—. Los renglones de TELA que
 * quedaron en notas viejas se muestran en **SOLO LECTURA**, sin selectores, para no romperlas ni
 * perderlas al editar (el editor manda el SET COMPLETO de renglones).
 *
 * Rediseño R6: el renglón de AVÍO marca si el avío está **✓ en la receta de la orden** / **⚠ fuera
 * de la receta — se enviará igual** (la nota PROPONE, no LIMITA) y muestra la **existencia
 * disponible** del almacén origen en rojo si la cantidad la excede. Presentación pura (A1): el
 * backend re-valida (no-negativo del avío al confirmar).
 */
export function EditorRenglonesNota({
  renglones,
  alCambiar,
  avios,
  ordenes,
  recetaPorOrden,
  existenciaPorAvio,
  soloLectura = false,
}: {
  renglones: RenglonNotaCaptura[];
  alCambiar: (renglones: RenglonNotaCaptura[]) => void;
  avios: readonly Avio[];
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

              {/* Orden destino. La nota es de AVÍOS y no lleva selector de tipo: la tela se registra
                  en «Salida de tela a orden» (por color) y NO lleva nota (§Post-F9.38). El renglón
                  de tela solo aparece en notas viejas y va en SOLO LECTURA (su orden queda fija). */}
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="text-xs text-muted-foreground">
                  Orden destino (R7)
                  <SelectNativo
                    className="mt-1"
                    aria-label={`Orden destino del renglón ${indice + 1}`}
                    disabled={soloLectura || renglon.tipo !== 'avio'}
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

              {/* AVÍO (editable) · TELA de una nota vieja · renglón MIGRADO del sistema anterior:
                  los dos últimos van en SOLO LECTURA (ya no se capturan). */}
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
              ) : renglon.tipo === 'tela' ? (
                <RenglonTelaHistorico renglon={renglon} />
              ) : (
                <RenglonMigrado renglon={renglon} />
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
 * Un renglón de TELA que quedó en una nota vieja (§Post-F9.38: la tela ya no lleva nota). Se muestra
 * en SOLO LECTURA —sin selectores y sin consultar el kardex— porque su captura se retiró: el
 * dominio exige lote y las salidas de tela nuevas van por COLOR, sin lote, así que ese selector
 * jamás podía ofrecer nada. No se borra ni se oculta: el editor manda el SET COMPLETO de renglones
 * al guardar, y esconderlo lo borraría de la nota sin decirlo.
 */
function RenglonTelaHistorico({ renglon }: { renglon: RenglonNotaCaptura }): React.JSX.Element {
  return (
    <div className="mt-2 space-y-1" data-testid="renglon-tela-historico">
      <p className="text-sm">
        {renglon.telaNombre ?? 'Tela'}
        {renglon.loteClave !== null ? ` · lote ${renglon.loteClave}` : ''} ·{' '}
        <span className="tabular-nums">{Number(renglon.cantidad).toLocaleString('es-MX')}</span>
        {renglon.unidad !== '' ? ` ${renglon.unidad}` : ''}
      </p>
      <p className="text-xs text-muted-foreground">
        Renglón de TELA de una nota anterior (no editable). La salida de tela a una orden ya no
        lleva nota: basta su movimiento de inventario.
      </p>
    </div>
  );
}

/**
 * Un renglón MIGRADO del sistema anterior: no apunta a ningún catálogo —el viejo guardaba los
 * renglones como TEXTO LIBRE— así que lo único que tiene es su `descripcionLegacy`. Antes de V1-E3b
 * se etiquetaba como "Tela" y se pintaba con el material EN BLANCO: parecía que la migración había
 * perdido el dato. Aquí se muestra el texto tal cual, en solo lectura.
 */
function RenglonMigrado({ renglon }: { renglon: RenglonNotaCaptura }): React.JSX.Element {
  return (
    <div className="mt-2 space-y-1" data-testid="renglon-migrado">
      <p className="text-sm">
        {renglon.descripcionLegacy ?? 'Sin descripción en el sistema viejo'}
      </p>
      <p className="text-xs text-muted-foreground">
        Renglón migrado del sistema anterior (texto libre, no editable). Ese sistema no desglosaba
        cantidad por renglón.
      </p>
    </div>
  );
}
