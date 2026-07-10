import { Warehouse } from 'lucide-react';
import { useState } from 'react';

import { useAlmacenes } from '@/api/almacenes';
import type { Avio } from '@/api/avios';
import { useExistenciasAvio } from '@/api/inventario-materiales';
import { ChipEstado } from '@/components/dominio/ChipEstado';
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

import { SelectorAvio } from './SelectorAvio';

/** Valor del filtro que significa "todos". */
const TODOS = 'TODOS';

/**
 * EXISTENCIAS de AVÍOS (F4-E1, proto `vAvios` — re-vestido R9; R4). Inventario MULTI-ALMACÉN: existencia
 * por avío×almacén (Σ de movimientos, D3), en tabla DENSA con filtros arriba (búsqueda de avío por
 * combobox popover `idAvio` server-side, almacén, genéricos, ceros), KPIs de vistazo y barra de
 * totales al pie. Distingue los DOS conceptos de genérico (aclaración de Daniel §4.7): "Genérico" =
 * genérico de STOCK (se netea en MRP) vs "Por orden" (se compra contra la orden). Consulta MÓVIL:
 * tabla en escritorio, tarjetas en móvil.
 *
 * FIDELIDAD vs proto: el proto `vAvios` es el CATÁLOGO (proveedores con precio expandibles + "Por
 * medida" con promedio + precio de referencia). Esos datos NO viajan en el endpoint de existencias
 * (solo `existencia/esGenerico/unidad`); viven en el catálogo de avíos (`modulos/avios/AviosPagina`).
 * Aquí se re-viste el INVENTARIO y se conserva la distinción Genérico/Por orden que sí trae el dato.
 *
 * `inventario-avios.ver` gobierna el acceso.
 */
export function ExistenciasAviosPagina(): React.JSX.Element {
  const [avio, setAvio] = useState<Avio | undefined>(undefined);
  const [idAlmacen, setIdAlmacen] = useState<string>(TODOS);
  const [soloGenericos, setSoloGenericos] = useState(false);
  const [incluirCeros, setIncluirCeros] = useState(false);

  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });

  const consulta = useExistenciasAvio({
    ...(avio !== undefined ? { idAvio: avio.id } : {}),
    ...(idAlmacen !== TODOS ? { idAlmacen: Number(idAlmacen) } : {}),
    ...(soloGenericos ? { soloGenericos: 'true' } : {}),
    ...(incluirCeros ? { incluirCeros: 'true' } : {}),
  });
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
      pie: 'avío × almacén',
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 md:p-5">
      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Inventario de avíos
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Existencia por avío y almacén (suma de movimientos) · los genéricos de stock se netean
            en el MRP
          </p>
        </div>
      </header>

      {/* ── KPIs ────────────────────────────────────────────────────────────── */}
      <KpiTiles kpis={kpis} className="shrink-0" />

      {/* ── Card: filtros + tabla + totales ─────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          {/* Búsqueda de avío (proto `.tool-search`): combobox POPOVER que filtra por `idAvio`
              server-side (la lista no vive inline: no infla el toolbar). */}
          <div className="w-56 [&_input]:h-8 [&_input]:text-sm">
            <SelectorAvio
              idSeleccionado={avio?.id}
              alSeleccionar={setAvio}
              alLimpiar={() => setAvio(undefined)}
            />
          </div>
          {/* El select va en caja de ancho FIJO: el envoltorio interno de `SelectNativo` es
              w-full y, suelto en un toolbar flex-wrap, se roba el renglón entero (y su chevron
              queda huérfano a la derecha). */}
          <SelectNativo
            className="w-44 h-8 text-sm"
            aria-label="Filtrar por almacén"
            value={idAlmacen}
            onChange={(e) => setIdAlmacen(e.target.value)}
            data-testid="avios-almacen"
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
              checked={soloGenericos}
              onChange={(e) => setSoloGenericos(e.target.checked)}
              data-testid="avios-genericos"
            />
            Solo genéricos de stock
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={incluirCeros}
              onChange={(e) => setIncluirCeros(e.target.checked)}
              data-testid="avios-ceros"
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
            <p className="p-6 text-sm text-muted-foreground" data-testid="avios-vacio">
              No hay existencias de avío para el filtro seleccionado.
            </p>
          ) : (
            <>
              {/* Móvil: tarjetas apiladas. */}
              <div className="space-y-3 p-3 md:hidden" data-testid="avios-tarjetas">
                {filas.map((f) => (
                  <div
                    key={`${f.idAvio}-${f.idAlmacen}`}
                    className="flex items-start justify-between gap-3 rounded-lg border bg-card p-3"
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 font-medium">
                        {f.avio}
                        <ChipEstado
                          tono={f.esGenerico ? 'info' : 'neutro'}
                          title={
                            f.esGenerico
                              ? 'Genérico de stock · se netea en el MRP'
                              : 'Se compra contra la orden'
                          }
                        >
                          {f.esGenerico ? 'Genérico · stock' : 'Por orden'}
                        </ChipEstado>
                      </p>
                      <p className="text-xs text-muted-foreground">{f.descripcion}</p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Warehouse className="size-3.5" aria-hidden />
                        {f.almacen}
                      </p>
                    </div>
                    <span className="num text-lg font-semibold">
                      {f.existencia.toLocaleString('es-MX')}
                      {f.unidad !== null ? (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          {f.unidad}
                        </span>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>

              {/* Escritorio: tabla densa. */}
              <div className="hidden md:block" data-testid="avios-tabla">
                <TablaDensa>
                  <TablaDensaEncabezado>
                    <TablaDensaFila>
                      <TablaDensaHead>Avío</TablaDensaHead>
                      <TablaDensaHead>Descripción</TablaDensaHead>
                      <TablaDensaHead>Tipo</TablaDensaHead>
                      <TablaDensaHead>Almacén</TablaDensaHead>
                      <TablaDensaHead numerica>Existencia</TablaDensaHead>
                    </TablaDensaFila>
                  </TablaDensaEncabezado>
                  <TablaDensaCuerpo>
                    {filas.map((f) => (
                      <TablaDensaFila key={`${f.idAvio}-${f.idAlmacen}`}>
                        <TablaDensaCelda>
                          <div className="flex items-center gap-2">
                            {/* Proto `vAvios`: thumb con la sigla FIJA "AV" (cian de avíos). */}
                            <Avatar nombre={f.avio} tono="avios" tamano="sm">
                              AV
                            </Avatar>
                            <span className="font-medium">{f.avio}</span>
                          </div>
                        </TablaDensaCelda>
                        <TablaDensaCelda>{f.descripcion}</TablaDensaCelda>
                        <TablaDensaCelda>
                          <ChipEstado
                            tono={f.esGenerico ? 'info' : 'neutro'}
                            title={
                              f.esGenerico
                                ? 'Genérico de stock · se netea en el MRP'
                                : 'Se compra contra la orden'
                            }
                          >
                            {f.esGenerico ? 'Genérico · stock' : 'Por orden'}
                          </ChipEstado>
                        </TablaDensaCelda>
                        <TablaDensaCelda>{f.almacen}</TablaDensaCelda>
                        <TablaDensaCelda numerica className="font-semibold">
                          {f.existencia.toLocaleString('es-MX')}
                          {f.unidad !== null ? (
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                              {f.unidad}
                            </span>
                          ) : null}
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
