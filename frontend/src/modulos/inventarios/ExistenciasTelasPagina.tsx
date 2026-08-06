import { ChevronDown, ChevronRight, FileDown, Warehouse } from 'lucide-react';
import { useState } from 'react';

import { useAlmacenes } from '@/api/almacenes';
import { urlImpresoInventarioTelas, useExistenciasTela } from '@/api/inventario-materiales';
import { useColores } from '@/api/colores';
import type { Tela } from '@/api/telas';
import type { ExistenciaTelaFila } from '@/api/tipos';
import { KpiTiles, type Kpi } from '@/components/dominio/KpiTiles';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Avatar } from '@/components/dominio/visuales';
import { Button } from '@/components/ui/button';
import { SelectNativo } from '@/components/ui/native-select';

import { SelectorTela } from './SelectorTela';

/** Valor del filtro que significa "todos". */
const TODOS = 'TODOS';

/** Clave única de una fila de existencia (tela×lote×almacén). */
function claveFila(f: ExistenciaTelaFila): string {
  return `${f.idTela}-${f.idLote ?? 'sl'}-${f.idAlmacen}`;
}

/**
 * EXISTENCIAS de TELAS (F4-E1, proto `vTelas` — re-vestido R9; D5). Tabla DENSA con la existencia por
 * tela×lote×almacén (Σ de movimientos, D3), filtros arriba (búsqueda de tela por combobox popover
 * `idTela` server-side, color, almacén, ceros), KPIs de vistazo, barra de totales al pie e IMPRESO
 * PDF (R9). Los COMPONENTES del lote (D5) se despliegan por fila
 * ("Felpa 100", "Cardigan 40"…). Consulta MÓVIL: tabla en escritorio, tarjetas apiladas en móvil.
 *
 * FIDELIDAD vs proto: el proto pinta KPIs de "Valor inventario" y "Por debajo de mínimo" y una columna
 * de "Costo/Valor"; el endpoint real de existencias de tela solo lleva CANTIDADES (sin costo ni umbral
 * de mínimos), así que los KPIs son Existencia total + Renglones y no hay columna de valor (hueco
 * reportado: valorizar telas necesita costo por lote y umbrales de mínimo en el catálogo).
 *
 * `inventario-telas.ver` gobierna el acceso.
 *
 * ⚠️ VISTA LEGADA (etapa A2): el inventario NUEVO opera por TELA+COLOR con partidas
 * (`ExistenciasTelasColorPagina`, la entrada principal del menú). Esta vista por LOTE queda viva
 * SOLO para consultar el flujo viejo (ruta `/inventarios/telas/existencias-lote`).
 */
export function ExistenciasTelasPagina(): React.JSX.Element {
  const [tela, setTela] = useState<Tela | undefined>(undefined);
  const [idColor, setIdColor] = useState<string>(TODOS);
  const [idAlmacen, setIdAlmacen] = useState<string>(TODOS);
  const [incluirCeros, setIncluirCeros] = useState(false);
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());

  const colores = useColores({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: 'false',
  });
  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });

  const filtros = {
    ...(tela !== undefined ? { idTela: tela.id } : {}),
    ...(idColor !== TODOS ? { idColor: Number(idColor) } : {}),
    ...(idAlmacen !== TODOS ? { idAlmacen: Number(idAlmacen) } : {}),
    ...(incluirCeros ? { incluirCeros: 'true' as const } : {}),
  };
  const consulta = useExistenciasTela(filtros);
  const filas = consulta.data?.filas ?? [];
  const totalExistencia = consulta.data?.totalExistencia ?? 0;

  const kpis: Kpi[] = [
    {
      clave: 'total',
      etiqueta: 'Existencia total',
      valor: totalExistencia.toLocaleString('es-MX'),
      pie: 'suma de movimientos (kardex)',
    },
    {
      clave: 'renglones',
      etiqueta: 'Renglones',
      valor: filas.length.toLocaleString('es-MX'),
      pie: 'tela × lote × almacén',
    },
  ];

  function alternar(clave: string): void {
    setExpandidas((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(clave)) siguiente.delete(clave);
      else siguiente.add(clave);
      return siguiente;
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 md:p-5 lg:overflow-visible">
      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Existencias por lote (legado)
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Vista LEGADA del flujo viejo por lote · el inventario nuevo opera por tela y color en
            «Existencias de telas»
          </p>
        </div>
        <Button asChild variant="outline" size="sm" data-testid="telas-imprimir">
          <a href={urlImpresoInventarioTelas(filtros)} target="_blank" rel="noopener noreferrer">
            <FileDown aria-hidden /> Imprimir PDF
          </a>
        </Button>
      </header>

      {/* ── KPIs ────────────────────────────────────────────────────────────── */}
      <KpiTiles kpis={kpis} className="shrink-0" />

      {/* ── Card: filtros + tabla + totales ─────────────────────────────────── */}
      <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border bg-card lg:min-h-0 lg:flex-1 lg:shrink">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          {/* Búsqueda de tela (proto `.tool-search`): combobox POPOVER que filtra por `idTela`
              server-side (la lista no vive inline: no infla el toolbar). */}
          <div className="w-56 [&_input]:h-8 [&_input]:text-sm">
            <SelectorTela
              idSeleccionado={tela?.id}
              alSeleccionar={setTela}
              alLimpiar={() => setTela(undefined)}
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
            data-testid="telas-color"
          >
            <option value={TODOS}>Todos los colores</option>
            {(colores.data?.datos ?? []).map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.nombre}
              </option>
            ))}
          </SelectNativo>
          <SelectNativo
            className="w-44 h-8 text-sm"
            aria-label="Filtrar por almacén"
            value={idAlmacen}
            onChange={(e) => setIdAlmacen(e.target.value)}
            data-testid="telas-almacen"
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
              data-testid="telas-ceros"
            />
            Incluir ceros
          </label>
          {/* Conteo a la derecha (proto `.count`: texto plano atenuado, sin pastilla). */}
          <span className="ml-auto text-xs text-faint">
            {filas.length.toLocaleString('es-MX')} renglones
          </span>
        </div>

        {/* ── Cuerpo scrolleable ─────────────────────────────────────────── */}
        <div className="overflow-auto lg:min-h-0 lg:flex-1">
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
            <p className="p-6 text-sm text-muted-foreground" data-testid="telas-vacio">
              No hay existencias de tela para el filtro seleccionado.
            </p>
          ) : (
            <>
              {/* Móvil: tarjetas apiladas con componentes expandibles. */}
              <div className="space-y-3 p-3 md:hidden" data-testid="telas-tarjetas">
                {filas.map((f) => {
                  const clave = claveFila(f);
                  const abierta = expandidas.has(clave);
                  return (
                    <div key={clave} className="space-y-2 rounded-lg border bg-card p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium">{f.tela}</p>
                          <p className="text-xs text-muted-foreground">
                            Lote {f.loteClave ?? '(sin lote)'} · {f.color ?? '—'}
                          </p>
                          <p className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Warehouse className="size-3.5" aria-hidden />
                            {f.almacen}
                          </p>
                        </div>
                        <span className="num text-lg font-semibold">
                          {f.existencia.toLocaleString('es-MX')}
                        </span>
                      </div>
                      {f.componentes.length > 0 ? (
                        <BotonComponentes
                          abierta={abierta}
                          cantidad={f.componentes.length}
                          onToggle={() => alternar(clave)}
                          testid={`telas-componentes-toggle-${clave}`}
                        />
                      ) : null}
                      {abierta && f.componentes.length > 0 ? (
                        <ul
                          className="space-y-1 rounded-md bg-muted/40 p-2 text-xs"
                          data-testid={`telas-componentes-${clave}`}
                        >
                          {f.componentes.map((c) => (
                            <li key={c.idTela} className="flex justify-between">
                              <span>{c.tela}</span>
                              <span className="num">{c.cantidad.toLocaleString('es-MX')}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {/* Escritorio: tabla densa con fila de componentes expandible. */}
              <div className="hidden md:block" data-testid="telas-tabla">
                <TablaDensa>
                  <TablaDensaEncabezado>
                    <TablaDensaFila>
                      <TablaDensaHead className="w-8" />
                      <TablaDensaHead>Tela</TablaDensaHead>
                      <TablaDensaHead>Lote</TablaDensaHead>
                      <TablaDensaHead>Color</TablaDensaHead>
                      <TablaDensaHead>Proveedor</TablaDensaHead>
                      <TablaDensaHead>Almacén</TablaDensaHead>
                      <TablaDensaHead numerica>Existencia</TablaDensaHead>
                    </TablaDensaFila>
                  </TablaDensaEncabezado>
                  <TablaDensaCuerpo>
                    {filas.map((f) => {
                      const clave = claveFila(f);
                      const abierta = expandidas.has(clave);
                      const tieneComponentes = f.componentes.length > 0;
                      return (
                        <RenglonTela
                          key={clave}
                          fila={f}
                          clave={clave}
                          abierta={abierta}
                          tieneComponentes={tieneComponentes}
                          onToggle={() => alternar(clave)}
                        />
                      );
                    })}
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
            <b className="num text-primary">{totalExistencia.toLocaleString('es-MX')}</b>
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

/** Botón "ver/ocultar componentes" (D5) — solo cuando el lote tiene componentes. */
function BotonComponentes({
  abierta,
  cantidad,
  onToggle,
  testid,
}: {
  abierta: boolean;
  cantidad: number;
  onToggle: () => void;
  testid: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
      data-testid={testid}
      aria-expanded={abierta}
    >
      {abierta ? (
        <ChevronDown className="size-3.5" aria-hidden />
      ) : (
        <ChevronRight className="size-3.5" aria-hidden />
      )}
      {abierta ? 'Ocultar' : 'Ver'} {cantidad} componente(s) del lote
    </button>
  );
}

/** Una fila de la tabla de escritorio + su fila expandible con los componentes del lote (D5). */
function RenglonTela({
  fila,
  clave,
  abierta,
  tieneComponentes,
  onToggle,
}: {
  fila: ExistenciaTelaFila;
  clave: string;
  abierta: boolean;
  tieneComponentes: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <>
      <TablaDensaFila>
        <TablaDensaCelda className="p-0 pl-2">
          {tieneComponentes ? (
            <button
              type="button"
              onClick={onToggle}
              className="grid size-7 place-items-center rounded hover:bg-muted"
              aria-label={abierta ? 'Ocultar componentes' : 'Ver componentes'}
              aria-expanded={abierta}
              data-testid={`telas-fila-toggle-${clave}`}
            >
              <ChevronRight
                className={`size-4 transition-transform ${abierta ? 'rotate-90' : ''}`}
                aria-hidden
              />
            </button>
          ) : null}
        </TablaDensaCelda>
        <TablaDensaCelda>
          <div className="flex items-center gap-2">
            {/* Proto `vTelas`: thumb de tipo con la inicial fija "T" (índigo de telas). */}
            <Avatar nombre={fila.tela} tono="telas" tamano="sm">
              T
            </Avatar>
            <span className="font-medium">{fila.tela}</span>
          </div>
        </TablaDensaCelda>
        <TablaDensaCelda>{fila.loteClave ?? '(sin lote)'}</TablaDensaCelda>
        <TablaDensaCelda>{fila.color ?? '—'}</TablaDensaCelda>
        <TablaDensaCelda>{fila.proveedor ?? '—'}</TablaDensaCelda>
        <TablaDensaCelda>{fila.almacen}</TablaDensaCelda>
        <TablaDensaCelda numerica className="font-semibold">
          {fila.existencia.toLocaleString('es-MX')}
        </TablaDensaCelda>
      </TablaDensaFila>
      {abierta && tieneComponentes ? (
        <TablaDensaFila className="bg-muted/30" data-testid={`telas-fila-componentes-${clave}`}>
          <TablaDensaCelda />
          <TablaDensaCelda colSpan={6} className="py-2">
            <div className="flex flex-wrap gap-2 text-xs">
              {fila.componentes.map((c) => (
                <span key={c.idTela} className="num rounded-full border bg-background px-2.5 py-1">
                  {c.tela}: <strong>{c.cantidad.toLocaleString('es-MX')}</strong>
                  {c.peso !== null ? ` · ${c.peso.toLocaleString('es-MX')} kg` : ''}
                </span>
              ))}
            </div>
          </TablaDensaCelda>
        </TablaDensaFila>
      ) : null}
    </>
  );
}
