import { Download, PackagePlus, Warehouse } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAlmacenes } from '@/api/almacenes';
import { useColores } from '@/api/colores';
import { useExistenciasPt } from '@/api/inventarios';
import type { Modelo } from '@/api/modelos';
import { useTallas } from '@/api/tallas';
import { KpiTiles, type Kpi } from '@/components/dominio/KpiTiles';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Button } from '@/components/ui/button';
import { SelectNativo } from '@/components/ui/native-select';
import { useSesion } from '@/sesion/useSesion';

import { PestanasInventarioPt } from './PestanasInventarioPt';
import { SelectorModelo } from './SelectorModelo';

/**
 * EXISTENCIAS de producto terminado (F3-E3, proto `vInventarios` — re-vestido R9). Tabla DENSA con la
 * existencia por modelo×color×talla×almacén (Σ de movimientos, D3), filtros arriba (modelo, color,
 * talla, almacén, ceros), KPIs de vistazo y barra de totales al pie. Es la consulta MÓVIL del módulo:
 * tabla en escritorio, tarjetas apiladas en móvil.
 *
 * FIDELIDAD vs proto: el proto pinta columnas "Comprometido/Disponible" y una barra "Nivel"
 * (disponible/existencia); el endpoint real `existencias-pt` solo devuelve `existencia` (a grano
 * color×talla), sin comprometido/disponible, y NO se pivotea en cliente (regla R9). Por eso los KPIs
 * son Existencia total + Renglones y no hay columna Nivel — falta un endpoint de resumen con
 * comprometido para lograrlo (hueco reportado al cerrar el lote).
 *
 * `inventario-pt.ver` gobierna el acceso a la pantalla; `inventario-pt.mover` habilita las pestañas
 * de captura (Movimientos/Traspasos) y el botón "Movimiento".
 */

/** Valor del filtro que significa "todos". */
const TODOS = 'TODOS';

/** Etiqueta de la orden de un renglón de existencia (F6-E2: PT por orden). null = bucket sin orden. */
function etiquetaOrden(folioOrden: number | null): string {
  return folioOrden === null ? 'Sin orden (hist./ajuste)' : `Orden #${String(folioOrden)}`;
}

export function ExistenciasPtPagina(): React.JSX.Element {
  const navigate = useNavigate();
  const { tienePermiso } = useSesion();
  const puedeMover = tienePermiso('inventario-pt.mover');

  const [modelo, setModelo] = useState<Modelo | undefined>(undefined);
  const [idColor, setIdColor] = useState<string>(TODOS);
  const [idTalla, setIdTalla] = useState<string>(TODOS);
  const [idAlmacen, setIdAlmacen] = useState<string>(TODOS);
  const [incluirCeros, setIncluirCeros] = useState(false);

  const colores = useColores({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: 'false',
  });
  const tallasCat = useTallas({ pagina: 1, porPagina: 100, ordenarPor: 'orden', direccion: 'asc' });
  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });

  const consulta = useExistenciasPt({
    ...(modelo !== undefined ? { idModelo: modelo.id } : {}),
    ...(idColor !== TODOS ? { idColor: Number(idColor) } : {}),
    ...(idTalla !== TODOS ? { idTalla: Number(idTalla) } : {}),
    ...(idAlmacen !== TODOS ? { idAlmacen: Number(idAlmacen) } : {}),
    // El querystring espera stringbool ("true"/"false"); solo se manda cuando se piden los ceros.
    ...(incluirCeros ? { incluirCeros: 'true' } : {}),
  });
  const filas = consulta.data?.filas ?? [];
  const totalExistencia = consulta.data?.totalExistencia ?? 0;
  // Sub-título fiel al proto ("· 3 almacenes"): la cuenta REAL sale del catálogo ya cargado
  // para los filtros; mientras no llega, el sufijo simplemente no se pinta.
  const numAlmacenes = (almacenes.data?.datos ?? []).length;

  const kpis: Kpi[] = [
    {
      clave: 'total',
      etiqueta: 'Existencia total',
      valor: totalExistencia.toLocaleString('es-MX'),
      sufijo: 'pzas',
      pie: 'suma de movimientos (kardex)',
    },
    {
      clave: 'renglones',
      etiqueta: 'Renglones',
      valor: filas.length.toLocaleString('es-MX'),
      pie: 'modelo × color × talla × almacén',
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 md:p-5">
      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Inventario · Producto terminado
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Existencias = suma de movimientos (kardex)
            {numAlmacenes > 0
              ? ` · ${String(numAlmacenes)} ${numAlmacenes === 1 ? 'almacén' : 'almacenes'}`
              : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void navigate('/inventarios/kardex')}
            data-testid="exist-ir-kardex"
          >
            <Download aria-hidden />
            Kardex
          </Button>
          {puedeMover ? (
            <Button
              size="sm"
              onClick={() => void navigate('/inventarios/movimientos')}
              data-testid="exist-ir-movimiento"
            >
              <PackagePlus aria-hidden />
              Movimiento
            </Button>
          ) : null}
        </div>
      </header>

      {/* ── KPIs ────────────────────────────────────────────────────────────── */}
      <KpiTiles kpis={kpis} className="shrink-0" />

      {/* ── Card: pestañas + filtros + tabla + totales ──────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          {/* Pestañas del módulo (proto `.tabs`): riel compartido de las tres pantallas PT. */}
          <PestanasInventarioPt activa="existencias" />

          {/* Búsqueda de modelo (proto `.tool-search`): combobox POPOVER — la lista ya no vive
              inline (inflaba el toolbar entero y descuadraba la tarjeta, feedback de Gabriel). */}
          <div className="w-56 [&_input]:h-8 [&_input]:text-sm">
            <SelectorModelo
              idSeleccionado={modelo?.id}
              alSeleccionar={setModelo}
              alLimpiar={() => setModelo(undefined)}
            />
          </div>
          {/* Los selects van en cajas de ancho FIJO: el envoltorio interno de `SelectNativo` es
              w-full y, suelto en un toolbar flex-wrap, se roba el renglón entero (y su chevron
              queda huérfano a la derecha). */}
          <SelectNativo
            className="w-40 h-8 text-sm"
            aria-label="Filtrar por color"
            value={idColor}
            onChange={(e) => setIdColor(e.target.value)}
            data-testid="exist-color"
          >
            <option value={TODOS}>Todos los colores</option>
            {(colores.data?.datos ?? []).map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.nombre}
              </option>
            ))}
          </SelectNativo>
          <SelectNativo
            className="w-40 h-8 text-sm"
            aria-label="Filtrar por talla"
            value={idTalla}
            onChange={(e) => setIdTalla(e.target.value)}
            data-testid="exist-talla"
          >
            <option value={TODOS}>Todas las tallas</option>
            {(tallasCat.data?.datos ?? []).map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.etiqueta}
              </option>
            ))}
          </SelectNativo>
          <SelectNativo
            className="w-44 h-8 text-sm"
            aria-label="Filtrar por almacén"
            value={idAlmacen}
            onChange={(e) => setIdAlmacen(e.target.value)}
            data-testid="exist-almacen"
          >
            <option value={TODOS}>Todos los almacenes</option>
            {(almacenes.data?.datos ?? []).map((a) => (
              <option key={a.id} value={String(a.id)}>
                {a.nombre}
              </option>
            ))}
          </SelectNativo>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={incluirCeros}
              onChange={(e) => setIncluirCeros(e.target.checked)}
              data-testid="exist-ceros"
            />
            Incluir ceros
          </label>
          {/* Conteo a la derecha (proto `.count`: texto plano atenuado, sin pastilla). */}
          <span className="ml-auto text-xs text-faint">
            {filas.length.toLocaleString('es-MX')} renglones
          </span>
        </div>

        {/* ── Cuerpo scrolleable ─────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-auto">
          {consulta.isError ? (
            <div className="space-y-2 p-6">
              <p className="text-sm text-destructive" role="alert">
                {consulta.error.message}
              </p>
              <Button variant="outline" size="sm" onClick={() => void consulta.refetch()}>
                Reintentar
              </Button>
            </div>
          ) : consulta.isPending ? (
            <p className="p-6 text-sm text-muted-foreground">Cargando existencias…</p>
          ) : filas.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground" data-testid="exist-vacio">
              No hay existencias para el filtro seleccionado.
            </p>
          ) : (
            <>
              {/* Móvil: tarjetas apiladas. */}
              <div className="space-y-3 p-3 md:hidden" data-testid="exist-tarjetas">
                {filas.map((f) => (
                  <div
                    key={`${f.idModelo}-${f.idColor}-${f.idTalla}-${f.idAlmacen}-${f.idOrden ?? 'sin'}`}
                    className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">
                        {f.modelo} · {f.color} · {f.etiquetaTalla}
                      </p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Warehouse className="size-3.5" aria-hidden />
                        {f.almacen}
                      </p>
                      <p className="text-xs text-faint">{etiquetaOrden(f.folioOrden)}</p>
                    </div>
                    <span className="num text-lg font-semibold">
                      {f.existencia.toLocaleString('es-MX')}
                    </span>
                  </div>
                ))}
              </div>

              {/* Escritorio: tabla densa. */}
              <div className="hidden md:block" data-testid="exist-tabla">
                <TablaDensa>
                  <TablaDensaEncabezado>
                    <TablaDensaFila>
                      <TablaDensaHead>Modelo</TablaDensaHead>
                      <TablaDensaHead>Color</TablaDensaHead>
                      <TablaDensaHead>Talla</TablaDensaHead>
                      <TablaDensaHead>Almacén</TablaDensaHead>
                      <TablaDensaHead>Orden</TablaDensaHead>
                      <TablaDensaHead numerica>Existencia</TablaDensaHead>
                    </TablaDensaFila>
                  </TablaDensaEncabezado>
                  <TablaDensaCuerpo>
                    {filas.map((f) => (
                      <TablaDensaFila
                        key={`${f.idModelo}-${f.idColor}-${f.idTalla}-${f.idAlmacen}-${f.idOrden ?? 'sin'}`}
                      >
                        <TablaDensaCelda className="font-medium">{f.modelo}</TablaDensaCelda>
                        <TablaDensaCelda>{f.color}</TablaDensaCelda>
                        <TablaDensaCelda>{f.etiquetaTalla}</TablaDensaCelda>
                        <TablaDensaCelda>{f.almacen}</TablaDensaCelda>
                        <TablaDensaCelda className="text-muted-foreground">
                          {etiquetaOrden(f.folioOrden)}
                        </TablaDensaCelda>
                        <TablaDensaCelda numerica className="font-semibold">
                          {f.existencia.toLocaleString('es-MX')}
                        </TablaDensaCelda>
                      </TablaDensaFila>
                    ))}
                  </TablaDensaCuerpo>
                </TablaDensa>
              </div>
            </>
          )}
        </div>

        {/* ── Barra de totales al pie ────────────────────────────────────── */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-t bg-secondary px-3 py-1.5 text-xs">
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10.5px] font-medium text-faint uppercase">Total:</span>
            <b className="num text-primary">{totalExistencia.toLocaleString('es-MX')} pzas</b>
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10.5px] font-medium text-faint uppercase">Renglones</span>
            <b className="num">{filas.length.toLocaleString('es-MX')}</b>
          </span>
        </div>
      </div>
    </div>
  );
}
