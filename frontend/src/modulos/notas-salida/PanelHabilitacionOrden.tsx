import { Boxes, FileText, Plus, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useHabilitacionOrden } from '@/api/habilitacion';
import type { HabilitacionAvio } from '@/api/tipos';
import { CajonDetalle } from '@/components/dominio/CajonDetalle';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSesion } from '@/sesion/useSesion';

import { DialogoEditarNota, type PrefillNota } from './DialogoEditarNota';
import {
  ETIQUETA_ESTADO_HAB,
  aSurtirDefault,
  claseBarraHab,
  tonoEstadoHab,
} from './habilitacion-piezas';

/** Encabezado que el llamador ya tiene (por si la habilitación aún no carga). */
export interface EncabezadoHabilitacion {
  folio?: number | string;
  modelo?: string;
}

/** Estado de captura de un renglón: marcado + cuánto surtir (texto). */
interface FilaSurtido {
  chk: boolean;
  qty: string;
}

/** Número a texto ≥ 0 (vacío/negativo → 0). */
function aNum(texto: string): number {
  const v = Number(texto.trim());
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * PANEL "Habilitación de avíos — Orden N" (rediseño R6, §4.6 ⭐): cajón deslizante con el tablero de
 * SURTIDO de la orden — por avío de la receta, Requerido vs. Enviado vs. Falta con barra + estado
 * (Completo/Parcial/Pendiente/**Sobre-surtido**), % global, y los avíos **Extra** (fuera de receta).
 * **Surtido selectivo + re-envío:** cada renglón trae un check + input "A surtir" (default = la
 * falta; escribir auto-marca; re-envío permitido aunque la falta sea 0 → sobre-surtido). **"Pasar a
 * nota de salida (N)"** abre el constructor PRE-CARGADO con lo seleccionado + el maquilero de la
 * orden. Se abre desde el tile "Habilitación" del centro de Órdenes (R2) y desde el banner de notas.
 * CERO lógica de negocio (A1): requerido/enviado/estado/% los agrega el backend (B13).
 */
export function PanelHabilitacionOrden({
  idOrden,
  abierto,
  alCerrar,
  encabezado,
}: {
  idOrden: number | undefined;
  abierto: boolean;
  alCerrar: () => void;
  encabezado?: EncabezadoHabilitacion | undefined;
}): React.JSX.Element {
  const navigate = useNavigate();
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('notas.administrar');

  const consulta = useHabilitacionOrden(idOrden, { habilitado: abierto && idOrden !== undefined });
  const hab = consulta.data;

  // Captura por avío (default: A surtir = la falta; sin marcar).
  const [seleccion, setSeleccion] = useState<Record<number, FilaSurtido>>({});
  const [prefill, setPrefill] = useState<PrefillNota | null>(null);

  useEffect(() => {
    if (hab === undefined) return;
    const inicial: Record<number, FilaSurtido> = {};
    for (const a of hab.avios) {
      const def = aSurtirDefault(a);
      inicial[a.idAvio] = { chk: false, qty: def > 0 ? String(def) : '' };
    }
    setSeleccion(inicial);
  }, [hab]);

  function marcar(idAvio: number, chk: boolean): void {
    setSeleccion((prev) => ({
      ...prev,
      [idAvio]: { ...prev[idAvio], chk, qty: prev[idAvio]?.qty ?? '' },
    }));
  }
  function cambiarQty(idAvio: number, qty: string): void {
    // Escribir una cantidad > 0 auto-marca el renglón (§4.6).
    setSeleccion((prev) => ({
      ...prev,
      [idAvio]: { qty, chk: aNum(qty) > 0 ? true : (prev[idAvio]?.chk ?? false) },
    }));
  }
  function marcarTodos(chk: boolean): void {
    setSeleccion((prev) => {
      const sig: Record<number, FilaSurtido> = {};
      for (const [k, v] of Object.entries(prev)) sig[Number(k)] = { ...v, chk };
      return sig;
    });
  }

  // Renglones elegibles = marcados con cantidad > 0.
  const elegibles = useMemo(() => {
    if (hab === undefined) return [];
    return hab.avios.filter((a) => {
      const s = seleccion[a.idAvio];
      return s !== undefined && s.chk && aNum(s.qty) > 0;
    });
  }, [hab, seleccion]);

  function pasarANota(): void {
    if (hab === undefined || elegibles.length === 0) {
      toast.error('Marca un avío y pon cuánto surtir.');
      return;
    }
    const payload: PrefillNota = {
      idMaquilero: hab.idMaquilero,
      renglones: elegibles.map((a) => ({
        idOrden: hab.idOrden,
        idAvio: a.idAvio,
        cantidad: aNum(seleccion[a.idAvio]?.qty ?? ''),
        unidad: a.unidad,
      })),
      recetaPorOrden: {
        [hab.idOrden]: hab.avios.filter((a) => !a.esExtra).map((a) => a.idAvio),
      },
    };
    setPrefill(payload);
  }

  function verNotas(): void {
    if (idOrden === undefined) return;
    alCerrar();
    void navigate('/produccion/notas-salida/por-orden', { state: { idOrden } });
  }

  const titulo = (
    <span className="inline-flex items-center gap-2">
      <Boxes className="size-4 text-primary" aria-hidden />
      {`Habilitación de avíos — Orden ${String(hab?.folioOrden ?? encabezado?.folio ?? '')}`}
    </span>
  );
  const subtitulo = [
    hab?.modelo ?? encabezado?.modelo,
    hab !== undefined ? `${hab.totalPiezas.toLocaleString('es-MX')} pzas` : undefined,
    hab?.maquilero !== undefined && hab.maquilero !== null
      ? `Maquilero ${hab.maquilero}`
      : undefined,
  ]
    .filter((x): x is string => x !== undefined && x !== '')
    .join(' · ');

  const marcados = elegibles.length;
  const todosMarcados =
    hab !== undefined && hab.avios.length > 0 && hab.avios.every((a) => seleccion[a.idAvio]?.chk);

  return (
    <>
      <CajonDetalle
        abierto={abierto}
        alCambiarAbierto={(a) => {
          if (!a) alCerrar();
        }}
        titulo={titulo}
        subtitulo={subtitulo === '' ? undefined : subtitulo}
        className="sm:max-w-2xl"
      >
        {consulta.isPending ? (
          <p className="p-2 text-sm text-muted-foreground" data-testid="hab-cargando">
            Cargando habilitación…
          </p>
        ) : consulta.isError ? (
          <p className="p-2 text-sm text-destructive" data-testid="hab-error">
            {consulta.error.message}
          </p>
        ) : hab === undefined ? null : (
          <div className="space-y-4" data-testid="panel-habilitacion">
            {/* Resumen: % global + barra + stats. */}
            <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-panel-2 p-3">
              <div className="flex flex-col items-center">
                <span
                  className={`text-2xl font-bold tabular-nums ${hab.porcentajeGlobal >= 100 ? 'text-ok' : 'text-primary'}`}
                  data-testid="hab-pct-global"
                >
                  {Math.round(hab.porcentajeGlobal)}%
                </span>
                <span className="text-[11px] text-muted-foreground">surtido</span>
              </div>
              <div className="min-w-40 flex-1">
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.min(100, hab.porcentajeGlobal)}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-muted-foreground tabular-nums">
                  <span>{hab.totalEnviado.toLocaleString('es-MX')} enviado</span>
                  <span>{hab.totalRequerido.toLocaleString('es-MX')} requerido</span>
                </div>
              </div>
              <div className="flex gap-4 text-center text-xs">
                <div>
                  <div className="font-bold text-ok">{hab.completos}</div>
                  <div className="text-muted-foreground">Completos</div>
                </div>
                <div>
                  <div className="font-bold text-warn">{hab.parciales}</div>
                  <div className="text-muted-foreground">Parciales</div>
                </div>
                <div>
                  <div className="font-bold text-muted-foreground">{hab.pendientes}</div>
                  <div className="text-muted-foreground">Pendientes</div>
                </div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Avíos de la orden · pon cuánto surtir de cada uno y pásalos a una nota.
            </p>

            {/* Tabla de surtido. */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="tabla-surtido">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-2">
                      <input
                        type="checkbox"
                        aria-label="Marcar todos"
                        checked={todosMarcados}
                        onChange={(e) => marcarTodos(e.target.checked)}
                        disabled={!puedeAdministrar}
                        data-testid="surtido-marcar-todos"
                      />
                    </th>
                    <th className="py-2 pr-3">Avío</th>
                    <th className="py-2 pr-3 text-right">Requerido</th>
                    <th className="py-2 pr-3 text-right">Enviado</th>
                    <th className="py-2 pr-3 text-right">Falta</th>
                    <th className="py-2 pr-3 text-right">A surtir</th>
                    <th className="py-2 pr-3">Avance</th>
                    <th className="py-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {hab.avios.map((a) => (
                    <FilaHab
                      key={a.idAvio}
                      avio={a}
                      fila={seleccion[a.idAvio] ?? { chk: false, qty: '' }}
                      puedeAdministrar={puedeAdministrar}
                      onMarcar={(chk) => marcar(a.idAvio, chk)}
                      onQty={(qty) => cambiarQty(a.idAvio, qty)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Re-envío + extras. */}
            <p className="flex items-start gap-1.5 rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
              <RefreshCw className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              ¿Se extravió o dañó un avío ya enviado? Re-envíalo: escribe la cantidad en "A surtir"
              aunque esté completo. El enviado puede pasar del 100% (queda como Sobre-surtido).
            </p>
            {hab.avios.some((a) => a.esExtra) ? (
              <p
                className="rounded-md border border-info/30 bg-info-soft p-2 text-xs text-info"
                data-testid="hab-aviso-extra"
              >
                Los renglones Extra son avíos que se enviaron a esta orden aunque no están en su
                receta.
              </p>
            ) : null}

            {/* Pie: faltante total + acciones. */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <span className="text-xs text-muted-foreground" data-testid="hab-faltante">
                {hab.faltaTotal > 0 ? (
                  <>
                    Faltan por enviar{' '}
                    <b className="text-warn tabular-nums">
                      {hab.faltaTotal.toLocaleString('es-MX')}
                    </b>{' '}
                    en <b>{hab.faltanAvios}</b> avío(s)
                  </>
                ) : (
                  <span className="font-medium text-ok">Orden surtida por completo ✓</span>
                )}
              </span>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={verNotas} data-testid="hab-ver-notas">
                  <FileText aria-hidden />
                  Ver notas de esta orden
                </Button>
                {puedeAdministrar ? (
                  <Button
                    size="sm"
                    onClick={pasarANota}
                    disabled={marcados === 0}
                    data-testid="hab-pasar-nota"
                  >
                    <Plus aria-hidden />
                    Pasar a nota de salida{marcados > 0 ? ` (${String(marcados)})` : ''}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </CajonDetalle>

      {prefill !== null ? (
        <DialogoEditarNota
          abierto
          alCambiarAbierto={(a) => {
            if (!a) setPrefill(null);
          }}
          prefill={prefill}
          alGuardada={() => {
            setPrefill(null);
            alCerrar();
          }}
        />
      ) : null}
    </>
  );
}

/** Un renglón de la tabla de surtido (avío). */
function FilaHab({
  avio,
  fila,
  puedeAdministrar,
  onMarcar,
  onQty,
}: {
  avio: HabilitacionAvio;
  fila: FilaSurtido;
  puedeAdministrar: boolean;
  onMarcar: (chk: boolean) => void;
  onQty: (qty: string) => void;
}): React.JSX.Element {
  const un = avio.unidad ?? '';
  return (
    <tr
      className={`border-b ${fila.chk ? 'bg-primary-soft/40' : avio.esExtra ? 'bg-info-soft/40' : ''}`}
      data-testid="surtido-fila"
    >
      <td className="py-2 pr-2">
        <input
          type="checkbox"
          aria-label={`Surtir ${avio.clave}`}
          checked={fila.chk}
          onChange={(e) => onMarcar(e.target.checked)}
          disabled={!puedeAdministrar}
          data-testid="surtido-chk"
        />
      </td>
      <td className="py-2 pr-3">
        <div className="font-medium">{avio.clave}</div>
        <div className="text-xs text-muted-foreground">
          {avio.descripcion}
          {avio.esExtra ? ' · fuera de receta' : ''}
        </div>
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">
        {avio.esExtra ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <>
            {avio.requerido.toLocaleString('es-MX')}
            <span className="ml-1 text-xs text-muted-foreground">{un}</span>
          </>
        )}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">
        {avio.enviado.toLocaleString('es-MX')}
        <span className="ml-1 text-xs text-muted-foreground">{un}</span>
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">
        {avio.esExtra ? (
          <span className="text-muted-foreground">—</span>
        ) : avio.falta > 0 ? (
          <span className="font-semibold text-warn">{avio.falta.toLocaleString('es-MX')}</span>
        ) : (
          <span className="text-ok">0</span>
        )}
      </td>
      <td className="py-2 pr-3 text-right">
        <Input
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          className="ml-auto h-8 w-20 text-right"
          aria-label={`A surtir de ${avio.clave}`}
          value={fila.qty}
          onChange={(e) => onQty(e.target.value)}
          placeholder="0"
          disabled={!puedeAdministrar}
          data-testid="surtido-qty"
        />
      </td>
      <td className="py-2 pr-3">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
            <span
              className={`block h-full rounded-full ${claseBarraHab(avio.estado)}`}
              style={{ width: `${Math.min(100, avio.porcentaje)}%` }}
            />
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {Math.round(avio.porcentaje)}%
          </span>
        </div>
      </td>
      <td className="py-2">
        <ChipEstado tono={tonoEstadoHab(avio.estado)} data-testid="surtido-estado">
          {ETIQUETA_ESTADO_HAB[avio.estado]}
        </ChipEstado>
      </td>
    </tr>
  );
}
