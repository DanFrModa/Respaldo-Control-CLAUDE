import { ChevronLeft, ChevronRight, Pencil, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useAvios,
  useDesactivarAvio,
  useReactivarAvio,
  type Avio,
  type AviosQuery,
} from '@/api/avios';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import { ChipFiltro, ChipsFiltro } from '@/components/dominio/ChipsFiltro';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Avatar, EstadoBadge } from '@/components/dominio/visuales';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/lib/useDebounce';
import { cn } from '@/lib/utils';
import { useSesion } from '@/sesion/useSesion';

import { DialogoAvio } from './DialogoAvio';
import { MedidasAvio } from './MedidasAvio';

/** Renglones por página del listado. */
const POR_PAGINA = 10;

/** Valor del filtro de género que significa "todos" (sin filtrar). */
const GENERO_TODOS = 'TODOS';

/** Formatea un precio (number | null) como moneda corta es-MX, o "—". */
function formatearPrecio(valor: number | null): string {
  if (valor === null) {
    return '—';
  }
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  }).format(valor);
}

/**
 * AVÍOS — catálogo (F1-E3, R1) re-vestido R9 a TABLA-FIRST fiel al proto `vAvios`: page-head + toolbar
 * (CHIPS excluyentes por género R4 como el proto, búsqueda, chip "Incluir inactivos") + TABLA DENSA
 * con filas EXPANDIBLES (chevron) + barra de totales al pie. Cada avío distingue Genérico·stock / Por orden (chip), lleva su cuenta de
 * PROVEEDORES (badge) y su precio de referencia; al expandir muestra los PROVEEDORES con su precio
 * (el más barato marcado) y las MEDIDAS del avío "por medida" (promedio del precosteo, R5/B11), más las
 * acciones de administración (editar/desactivar/activar). Borrado suave reversible.
 *
 * FIDELIDAD vs proto: (1) el proto pinta KPIs (SKU · multi-proveedor · genéricos · sin proveedor) y una
 * columna de EXISTENCIA + estado "Bajo mín."; esos agregados/umbrales NO viven en el endpoint del
 * catálogo (la existencia vive en Inventario de avíos, y el conteo por atributo necesita un endpoint de
 * resumen) → no se inventan en cliente (hueco reportado). (2) El badge "Por medida" del renglón
 * colapsado necesita un flag en el payload del avío; hoy las medidas solo se conocen al expandir (se
 * muestra ahí). (3) Alta/baja de proveedores va por "Editar" (el API actualiza el set de proveedores
 * del avío de forma atómica), no con ✕ inline. El lado PROVEEDOR ("Avíos que surte", B17) es de otro lote.
 *
 * `avios.ver` gobierna el acceso; `avios.administrar` decide las acciones de escritura (el backend
 * re-decide, A1).
 */
export function AviosPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('avios.administrar');

  // ── Estado de la vista ─────────────────────────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [generoFiltro, setGeneroFiltro] = useState<string>(GENERO_TODOS);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [expandidas, setExpandidas] = useState<ReadonlySet<number>>(new Set());

  const query: AviosQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'clave',
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(generoFiltro === 'generico'
      ? { esGenerico: 'true' }
      : generoFiltro === 'normal'
        ? { esGenerico: 'false' }
        : {}),
  };

  const consulta = useAvios(query);
  const desactivar = useDesactivarAvio();
  const reactivar = useReactivarAvio();

  // ── Diálogos ───────────────────────────────────────────────────────────────
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [avioEnEdicion, setAvioEnEdicion] = useState<Avio | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<Avio | null>(null);

  function abrirAlta(): void {
    setAvioEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(avio: Avio): void {
    setAvioEnEdicion(avio);
    setDialogoAbierto(true);
  }

  // Chevron = TOGGLE (abre/cierra). Clic en el cuerpo del renglón = EXPANDIR (idempotente): así un
  // segundo clic en un renglón ya abierto NO lo cierra (colapsar es tarea del chevron).
  function alternarExpandida(id: number): void {
    setExpandidas((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(id)) siguiente.delete(id);
      else siguiente.add(id);
      return siguiente;
    });
  }

  function expandir(id: number): void {
    setExpandidas((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Avío "${objetivo.clave}" desactivado.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  // Reactivar es NO destructivo: se aplica directo, sin diálogo de confirmación.
  function reactivarAvio(avio: Avio): void {
    reactivar.mutate(avio.id, {
      onSuccess: () => toast.success(`Avío "${avio.clave}" activado.`),
      onError: (error) => toast.error(error.message),
    });
  }

  function reiniciar(): void {
    setPagina(1);
  }

  const datos = consulta.data;
  const filas = datos?.datos ?? [];
  const total = datos?.total ?? 0;
  const totalPaginas = datos?.totalPaginas ?? 1;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 md:p-5 lg:overflow-visible">
      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">Avíos</h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Catálogo · cada avío puede tener varios proveedores con su precio (R1) · el proveedor se
            amarra en la compra
          </p>
        </div>
        {puedeAdministrar ? (
          <Button size="sm" onClick={abrirAlta} data-testid="nuevo-avio">
            <Plus aria-hidden />
            Nuevo avío
          </Button>
        ) : null}
      </header>

      {/* ── Card: filtros + tabla + totales ─────────────────────────────────── */}
      <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border bg-card lg:min-h-0 lg:flex-1 lg:shrink">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          {/* Fila de chips excluyentes (proto `.chip`/`.chip.active`), en lugar del select. */}
          <ChipsFiltro
            opciones={[
              { valor: GENERO_TODOS, etiqueta: 'Todos', testid: 'filtro-genero-todos' },
              { valor: 'generico', etiqueta: 'Genérico · stock', testid: 'filtro-genero-generico' },
              { valor: 'normal', etiqueta: 'Por orden', testid: 'filtro-genero-normal' },
            ]}
            valor={generoFiltro}
            alCambiar={(valor) => {
              setGeneroFiltro(valor);
              reiniciar();
            }}
            etiqueta="Filtrar avíos por género"
          />
          {/* Búsqueda con lupa (proto `.tool-search`). */}
          <div className="relative w-52">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              className="h-8 pl-8 text-sm"
              placeholder="Buscar avío…"
              value={textoBusqueda}
              onChange={(e) => {
                setTextoBusqueda(e.target.value);
                reiniciar();
              }}
              data-testid="buscar-avio"
            />
          </div>
          <ChipFiltro
            activo={incluirInactivos}
            onClick={() => {
              setIncluirInactivos((v) => !v);
              reiniciar();
            }}
            data-testid="mostrar-desactivados"
          >
            Incluir inactivos
          </ChipFiltro>
          {/* Conteo a la derecha (proto `.count`: "visibles de total", texto plano atenuado). */}
          <span className="ml-auto text-xs text-faint">
            {filas.length.toLocaleString('es-MX')} de {total.toLocaleString('es-MX')}
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
            <p className="p-6 text-sm text-muted-foreground">Cargando avíos…</p>
          ) : filas.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground" data-testid="avio-vacio">
              No hay avíos que coincidan con la búsqueda.
            </p>
          ) : (
            <>
              {/* Móvil (<lg): tarjetas resumen de solo lectura — la tabla se apachurra en teléfono.
                  El detalle expandible (proveedores, medidas, edición) vive en la tabla de
                  escritorio; en móvil la tarjeta muestra lo clave sin abrir editores pesados. */}
              <div className="space-y-2 p-3 lg:hidden" data-testid="avio-tarjetas">
                {filas.map((avio) => {
                  const provs = avio.proveedores;
                  return (
                    <div
                      key={avio.id}
                      data-testid="fila-avio-tarjeta"
                      className="rounded-lg border bg-card p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <Avatar nombre={avio.clave} tono="avios" tamano="sm">
                            AV
                          </Avatar>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-medium">{avio.descripcion}</span>
                              <ChipEstado tono={avio.esGenerico ? 'info' : 'neutro'}>
                                {avio.esGenerico ? 'Genérico · stock' : 'Por orden'}
                              </ChipEstado>
                            </div>
                            <div className="num text-xs text-faint">{avio.clave}</div>
                          </div>
                        </div>
                        <EstadoBadge activo={avio.activo} />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
                        {provs.length > 0 ? (
                          <ChipEstado tono="info">
                            {provs.length} proveedor{provs.length > 1 ? 'es' : ''}
                          </ChipEstado>
                        ) : (
                          <ChipEstado tono="warn">Sin proveedor</ChipEstado>
                        )}
                        <span className="num text-muted-foreground">
                          Precio ref. {formatearPrecio(avio.precioReferencia)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Escritorio (≥lg): tabla densa con filas expandibles completa. */}
              <div className="hidden lg:block" data-testid="avio-tabla">
                <TablaDensa>
                  <TablaDensaEncabezado>
                    <TablaDensaFila>
                      <TablaDensaHead className="w-8" />
                      <TablaDensaHead>Avío</TablaDensaHead>
                      <TablaDensaHead>Proveedores</TablaDensaHead>
                      <TablaDensaHead numerica>Precio ref.</TablaDensaHead>
                      <TablaDensaHead>Estado</TablaDensaHead>
                    </TablaDensaFila>
                  </TablaDensaEncabezado>
                  <TablaDensaCuerpo>
                    {filas.map((avio) => (
                      <RenglonAvio
                        key={avio.id}
                        avio={avio}
                        abierta={expandidas.has(avio.id)}
                        puedeAdministrar={puedeAdministrar}
                        onToggle={() => alternarExpandida(avio.id)}
                        onExpandir={() => expandir(avio.id)}
                        onEditar={() => abrirEdicion(avio)}
                        onDesactivar={() => setADesactivar(avio)}
                        onReactivar={() => reactivarAvio(avio)}
                      />
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
            <span className="text-[10.5px] font-medium text-faint uppercase">Avíos (filtro)</span>
            <b className="num">{total.toLocaleString('es-MX')}</b>
          </span>
          <span className="ml-auto flex items-center gap-1 text-muted-foreground">
            Página {pagina} de {totalPaginas}
            <Button
              variant="ghost"
              size="icon"
              disabled={pagina <= 1 || consulta.isFetching}
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              aria-label="Página anterior"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={pagina >= totalPaginas || consulta.isFetching}
              onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              aria-label="Página siguiente"
            >
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </span>
        </div>
      </div>

      {/* Diálogos */}
      <DialogoAvio
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        avio={avioEnEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar avío"
        descripcion={
          <>
            ¿Seguro que quieres desactivar el avío{' '}
            <span className="font-medium text-foreground">{aDesactivar?.clave}</span>? Podrás volver
            a activarlo después; su historial se conserva.
          </>
        }
        textoConfirmar="Desactivar"
        variante="destructive"
        procesando={desactivar.isPending}
        alConfirmar={confirmarDesactivar}
      />
    </div>
  );
}

/**
 * Un renglón del catálogo de avíos + su fila EXPANDIBLE (proveedores con precio + medidas + acciones).
 * El renglón colapsado muestra el chip Genérico/Por orden, la cuenta de proveedores, el precio de
 * referencia y el estado (activo/inactivo). Clic en el renglón (o el chevron) lo expande.
 */
function RenglonAvio({
  avio,
  abierta,
  puedeAdministrar,
  onToggle,
  onExpandir,
  onEditar,
  onDesactivar,
  onReactivar,
}: {
  avio: Avio;
  abierta: boolean;
  puedeAdministrar: boolean;
  onToggle: () => void;
  onExpandir: () => void;
  onEditar: () => void;
  onDesactivar: () => void;
  onReactivar: () => void;
}): React.JSX.Element {
  const provs = avio.proveedores;
  // El más barato ENTRE LOS PROVEEDORES DEL AVÍO (presentación sobre el propio renglón, no dato oculto).
  const preciosProv = provs.map((p) => p.precio).filter((p): p is number => p !== null);
  const barato = preciosProv.length > 0 ? Math.min(...preciosProv) : null;

  return (
    <>
      <TablaDensaFila
        seleccionada={abierta}
        className="cursor-pointer"
        onClick={onExpandir}
        data-testid="fila-avio"
      >
        <TablaDensaCelda className="p-0 pl-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className="grid size-7 place-items-center rounded hover:bg-muted"
            aria-label={abierta ? 'Ocultar detalle' : 'Ver detalle'}
            aria-expanded={abierta}
            data-testid="expandir-avio"
          >
            <ChevronRight
              className={cn('size-4 transition-transform', abierta && 'rotate-90')}
              aria-hidden
            />
          </button>
        </TablaDensaCelda>
        <TablaDensaCelda>
          <div className="flex items-center gap-2">
            {/* Proto: el thumb del avío es la sigla FIJA "AV" (cian), no las iniciales de la clave. */}
            <Avatar nombre={avio.clave} tono="avios" tamano="sm">
              AV
            </Avatar>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium">{avio.descripcion}</span>
                <ChipEstado
                  tono={avio.esGenerico ? 'info' : 'neutro'}
                  title={
                    avio.esGenerico
                      ? 'Genérico de stock · se netea en el MRP'
                      : 'Se compra contra la orden'
                  }
                >
                  {avio.esGenerico ? 'Genérico · stock' : 'Por orden'}
                </ChipEstado>
              </div>
              <div className="num text-xs text-faint">{avio.clave}</div>
            </div>
          </div>
        </TablaDensaCelda>
        <TablaDensaCelda>
          {provs.length > 0 ? (
            <ChipEstado tono="info">
              {provs.length} proveedor{provs.length > 1 ? 'es' : ''}
            </ChipEstado>
          ) : (
            <ChipEstado tono="warn">Sin proveedor</ChipEstado>
          )}
        </TablaDensaCelda>
        <TablaDensaCelda numerica>{formatearPrecio(avio.precioReferencia)}</TablaDensaCelda>
        <TablaDensaCelda>
          <EstadoBadge activo={avio.activo} />
        </TablaDensaCelda>
      </TablaDensaFila>

      {abierta ? (
        <TablaDensaFila className="bg-muted/20 hover:bg-muted/20">
          <TablaDensaCelda />
          <TablaDensaCelda colSpan={4} className="py-3">
            <div className="space-y-4" data-testid="detalle-avio">
              {/* Proveedores y precios (R1). */}
              <section>
                <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Proveedores y precios
                </h4>
                {provs.length === 0 ? (
                  <p className="text-sm text-muted-foreground" data-testid="avio-sin-proveedores">
                    Este avío no tiene proveedores asignados — se costea al{' '}
                    <b>precio de referencia</b> ({formatearPrecio(avio.precioReferencia)}) y la
                    explosión de compras se queda <b>sin a quién comprarle</b>. Agrégale su
                    proveedor habitual desde «Editar» (§Post-F9.82).
                  </p>
                ) : (
                  <ul
                    className="flex max-w-xl flex-col gap-1.5"
                    data-testid="avio-proveedores-detalle"
                  >
                    {provs.map((p) => (
                      <li
                        key={p.idProveedor}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-1.5"
                      >
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-medium">{p.nombreProveedor}</span>
                          {/* ⭐ V1-E3m (§Post-F9.82): el HABITUAL es el que la explosión propone —
                              antes proponía el más barato—, así que se ve primero y aparte. */}
                          {p.habitual ? (
                            <ChipEstado tono="info" sinPunto data-testid="avio-proveedor-habitual">
                              habitual
                            </ChipEstado>
                          ) : null}
                          {p.precio !== null && p.precio === barato && provs.length > 1 ? (
                            <ChipEstado tono="ok" sinPunto>
                              más barato
                            </ChipEstado>
                          ) : null}
                          {p.condiciones !== null && p.condiciones.trim() !== '' ? (
                            <span className="text-xs text-faint">· {p.condiciones}</span>
                          ) : null}
                        </span>
                        <span className="num shrink-0 text-sm font-medium">
                          {formatearPrecio(p.precio)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Medidas del avío "por medida" (R5, B11) — promedio del precosteo. */}
              <section>
                <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Medidas del avío
                </h4>
                <MedidasAvio idAvio={avio.id} puedeAdministrar={puedeAdministrar} />
              </section>

              {/* Acciones de administración. */}
              {puedeAdministrar ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={onEditar} data-testid="editar-avio">
                    <Pencil aria-hidden />
                    Editar
                  </Button>
                  {avio.activo ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onDesactivar}
                      data-testid="desactivar-avio"
                    >
                      <Trash2 aria-hidden />
                      Desactivar
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onReactivar}
                      data-testid="activar-avio"
                    >
                      <RotateCcw aria-hidden />
                      Activar
                    </Button>
                  )}
                </div>
              ) : null}
            </div>
          </TablaDensaCelda>
        </TablaDensaFila>
      ) : null}
    </>
  );
}
