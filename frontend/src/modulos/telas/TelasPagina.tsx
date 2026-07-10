import { ChevronLeft, ChevronRight, Pencil, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useDesactivarTela,
  useReactivarTela,
  useTelas,
  useTelasCategorias,
  type Tela,
  type TelaCategoria,
  type TelaColor,
  type TelasQuery,
  type TipoComponenteTela,
} from '@/api/telas';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Avatar, EstadoBadge, TipoBadge } from '@/components/dominio/visuales';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useDebounce } from '@/lib/useDebounce';
import { cn } from '@/lib/utils';
import { useSesion } from '@/sesion/useSesion';

import { DialogoTela } from './DialogoTela';
import { EditorProveedoresTela } from './EditorProveedoresTela';

/** Renglones por página del listado. */
const POR_PAGINA = 10;

/** Valor del filtro de categoría que significa "todas" (sin filtrar). */
const CATEGORIA_TODAS = 'TODAS';

/** Etiqueta legible del tipo de componente del lote (D5). */
const ETIQUETA_TIPO_COMPONENTE: Record<TipoComponenteTela, string> = {
  CUERPO: 'Cuerpo',
  CARDIGAN: 'Cardigán',
  OTRO: 'Otro',
};

/** Formatea un precio (number | null) como moneda es-MX, o "—". */
function formatearPrecio(valor: number | null): string {
  if (valor === null) {
    return '—';
  }
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
  }).format(valor);
}

/** ¿La cadena tiene contenido real (no null ni vacía)? */
function hayTexto(valor: string | null): valor is string {
  return valor !== null && valor.trim() !== '';
}

/**
 * TELAS — catálogo unificado (BOM + inventario, F1-E3) re-vestido R9 a TABLA-FIRST fiel al proto
 * `vTelas`: page-head + toolbar (filtro por categoría, búsqueda, inactivos) + TABLA DENSA con filas
 * EXPANDIBLES (chevron) + barra de totales al pie. El renglón colapsado muestra la categoría, el tipo
 * de componente del lote (D5), su cuenta de colores y el precio sugerido; al expandir despliega los
 * datos de la tela, sus COLORES con precio y los PRECIOS POR PROVEEDOR (con precio por color, R17,
 * reutilizando `EditorProveedoresTela` tal cual), más las acciones de administración. Borrado suave
 * reversible; toasts; consciente de permisos.
 *
 * FIDELIDAD vs proto: (1) el proto pinta un "valor de inventario", "costo por lote" y un umbral de
 * "mínimos" por tela; ninguno vive en el endpoint del catálogo (la existencia/valuación es de
 * Inventario de telas y no hay campo de mínimos) → no se inventan en cliente (hueco reportado). (2) La
 * cuenta de PROVEEDORES no se muestra en el renglón colapsado porque los proveedores son un
 * SUB-RECURSO REST por tela (`GET /telas/{id}/proveedores`), no viajan inline en la lista; se cargan y
 * muestran al expandir (mostrar el conteo colapsado exigiría N consultas o un agregado que el endpoint
 * no da). (3) Alta/baja de proveedores va por el editor del detalle (atómico), no con ✕ inline. El
 * lado PROVEEDOR ("Telas que surte") es de otro lote.
 *
 * `telas.ver` gobierna el acceso; `telas.administrar` decide las acciones de escritura (y las
 * categorías, que no tienen permiso propio). La decisión real la toma el backend (A1).
 */
export function TelasPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('telas.administrar');
  const puedeVerImportes = tienePermiso('consultas.ver-importes');

  // ── Estado de la vista ─────────────────────────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [categoriaFiltro, setCategoriaFiltro] = useState<string>(CATEGORIA_TODAS);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [expandidas, setExpandidas] = useState<ReadonlySet<number>>(new Set());

  const categoriasCatalogo = useTelasCategorias({ porPagina: 100 });

  const query: TelasQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(categoriaFiltro !== CATEGORIA_TODAS ? { idCategoria: Number(categoriaFiltro) } : {}),
  };

  const consulta = useTelas(query);
  const desactivar = useDesactivarTela();
  const reactivar = useReactivarTela();

  // ── Diálogos ───────────────────────────────────────────────────────────────
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [telaEnEdicion, setTelaEnEdicion] = useState<Tela | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<Tela | null>(null);

  function abrirAlta(): void {
    setTelaEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(tela: Tela): void {
    setTelaEnEdicion(tela);
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
        toast.success(`Tela "${objetivo.nombre}" desactivada.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  // Reactivar es NO destructivo: se aplica directo, sin diálogo de confirmación.
  function reactivarTela(tela: Tela): void {
    reactivar.mutate(tela.id, {
      onSuccess: () => toast.success(`Tela "${tela.nombre}" activada.`),
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
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 md:p-5">
      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">Telas</h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Catálogo unificado (BOM e inventario) · colores con precio · proveedores con precio por
            color (R17)
          </p>
        </div>
        {puedeAdministrar ? (
          <Button size="sm" onClick={abrirAlta} data-testid="nuevo-tela">
            <Plus aria-hidden />
            Nueva tela
          </Button>
        ) : null}
      </header>

      {/* ── Card: filtros + tabla + totales ─────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          {/* El select va en caja de ancho FIJO: el envoltorio interno de `SelectNativo` es
              w-full y, suelto en un toolbar flex-wrap, se roba el renglón entero (y su chevron
              queda huérfano a la derecha). */}
          <SelectNativo
            className="w-48 h-8 text-sm"
            value={categoriaFiltro}
            onChange={(e) => {
              setCategoriaFiltro(e.target.value);
              reiniciar();
            }}
            aria-label="Filtrar telas por categoría"
            data-testid="filtro-categoria-tela"
            disabled={categoriasCatalogo.isPending || categoriasCatalogo.isError}
          >
            <option value={CATEGORIA_TODAS}>Todas las categorías</option>
            {(categoriasCatalogo.data?.datos ?? []).map((cat: TelaCategoria) => (
              <option key={cat.id} value={String(cat.id)}>
                {cat.nombre}
              </option>
            ))}
          </SelectNativo>
          {/* Búsqueda con lupa (proto `.tool-search`). */}
          <div className="relative w-52">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              className="h-8 pl-8 text-sm"
              placeholder="Buscar tela…"
              value={textoBusqueda}
              onChange={(e) => {
                setTextoBusqueda(e.target.value);
                reiniciar();
              }}
              data-testid="buscar-tela"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={incluirInactivos}
              onChange={() => {
                setIncluirInactivos((v) => !v);
                reiniciar();
              }}
              data-testid="mostrar-desactivados"
            />
            Incluir inactivos
          </label>
          {/* Conteo a la derecha (proto `.count`: "visibles de total", texto plano atenuado). */}
          <span className="ml-auto text-xs text-faint">
            {filas.length.toLocaleString('es-MX')} de {total.toLocaleString('es-MX')}
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
            <p className="p-6 text-sm text-muted-foreground">Cargando telas…</p>
          ) : filas.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground" data-testid="tela-vacio">
              No hay telas que coincidan con la búsqueda.
            </p>
          ) : (
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead className="w-8" />
                  <TablaDensaHead>Tela</TablaDensaHead>
                  <TablaDensaHead>Componente</TablaDensaHead>
                  <TablaDensaHead>Colores</TablaDensaHead>
                  <TablaDensaHead numerica>Precio sug.</TablaDensaHead>
                  <TablaDensaHead>Estado</TablaDensaHead>
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {filas.map((tela) => (
                  <RenglonTela
                    key={tela.id}
                    tela={tela}
                    abierta={expandidas.has(tela.id)}
                    puedeAdministrar={puedeAdministrar}
                    puedeVerImportes={puedeVerImportes}
                    onToggle={() => alternarExpandida(tela.id)}
                    onExpandir={() => expandir(tela.id)}
                    onEditar={() => abrirEdicion(tela)}
                    onDesactivar={() => setADesactivar(tela)}
                    onReactivar={() => reactivarTela(tela)}
                  />
                ))}
              </TablaDensaCuerpo>
            </TablaDensa>
          )}
        </div>

        {/* ── Barra de totales al pie ────────────────────────────────────── */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-t bg-secondary px-3 py-1.5 text-xs">
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10.5px] font-medium text-faint uppercase">Telas (filtro)</span>
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
      <DialogoTela
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        tela={telaEnEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar tela"
        descripcion={
          <>
            ¿Seguro que quieres desactivar la tela{' '}
            <span className="font-medium text-foreground">{aDesactivar?.nombre}</span>? Podrás
            volver a activarla después; su historial y sus colores se conservan.
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
 * Un renglón del catálogo de telas + su fila EXPANDIBLE (datos + colores con precio + proveedores +
 * acciones). El renglón colapsado muestra la categoría, el tipo de componente del lote (D5), la cuenta
 * de colores, el precio sugerido y el estado (activo/inactivo). Clic en el renglón (o el chevron) lo
 * expande.
 */
function RenglonTela({
  tela,
  abierta,
  puedeAdministrar,
  puedeVerImportes,
  onToggle,
  onExpandir,
  onEditar,
  onDesactivar,
  onReactivar,
}: {
  tela: Tela;
  abierta: boolean;
  puedeAdministrar: boolean;
  puedeVerImportes: boolean;
  onToggle: () => void;
  onExpandir: () => void;
  onEditar: () => void;
  onDesactivar: () => void;
  onReactivar: () => void;
}): React.JSX.Element {
  const numColores = tela.colores.length;

  return (
    <>
      <TablaDensaFila
        seleccionada={abierta}
        className="cursor-pointer"
        onClick={onExpandir}
        data-testid="fila-tela"
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
            data-testid="expandir-tela"
          >
            <ChevronRight
              className={cn('size-4 transition-transform', abierta && 'rotate-90')}
              aria-hidden
            />
          </button>
        </TablaDensaCelda>
        <TablaDensaCelda>
          <div className="flex items-center gap-2">
            {/* Proto: el thumb del material es la letra FIJA de su tipo ("T" de tela, índigo),
                no las iniciales del nombre. */}
            <Avatar nombre={tela.nombre} tono="telas" tamano="sm">
              T
            </Avatar>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium">{tela.nombre}</span>
                {tela.categoria !== null ? (
                  <TipoBadge tono="telas">{tela.categoria}</TipoBadge>
                ) : null}
                {tela.favorito ? <TipoBadge tono="pt">Favorita</TipoBadge> : null}
              </div>
              {hayTexto(tela.unidadMedida) ? (
                <div className="text-xs text-faint">{tela.unidadMedida}</div>
              ) : null}
            </div>
          </div>
        </TablaDensaCelda>
        <TablaDensaCelda>
          <span className="text-xs text-muted-foreground">
            {ETIQUETA_TIPO_COMPONENTE[tela.tipoComponente]}
          </span>
        </TablaDensaCelda>
        <TablaDensaCelda>
          {numColores > 0 ? (
            <ChipEstado tono="info">
              {numColores} color{numColores > 1 ? 'es' : ''}
            </ChipEstado>
          ) : (
            <ChipEstado tono="neutro">Sin colores</ChipEstado>
          )}
        </TablaDensaCelda>
        <TablaDensaCelda numerica>{formatearPrecio(tela.precioSugerido)}</TablaDensaCelda>
        <TablaDensaCelda>
          <EstadoBadge activo={tela.activo} />
        </TablaDensaCelda>
      </TablaDensaFila>

      {abierta ? (
        <TablaDensaFila className="bg-muted/20 hover:bg-muted/20">
          <TablaDensaCelda />
          <TablaDensaCelda colSpan={5} className="py-3">
            <div className="space-y-4" data-testid="detalle-tela">
              {/* Datos generales de la tela. */}
              <section>
                <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Datos de la tela
                </h4>
                <dl className="grid max-w-2xl grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
                  <Dato etiqueta="Categoría">{tela.categoria ?? '—'}</Dato>
                  <Dato etiqueta="Unidad de medida">
                    {hayTexto(tela.unidadMedida) ? tela.unidadMedida : '—'}
                  </Dato>
                  <Dato etiqueta="Tipo de componente">
                    {ETIQUETA_TIPO_COMPONENTE[tela.tipoComponente]}
                  </Dato>
                  <Dato etiqueta="Precio sugerido">{formatearPrecio(tela.precioSugerido)}</Dato>
                  <Dato etiqueta="¿Favorita?">{tela.favorito ? 'Sí' : 'No'}</Dato>
                  <Dato etiqueta="¿Para producción?">{tela.paraProduccion ? 'Sí' : 'No'}</Dato>
                  {hayTexto(tela.descripcion) ? (
                    <div className="col-span-2 min-w-0 sm:col-span-3">
                      <dt className="text-[11px] text-faint uppercase">Descripción</dt>
                      <dd className="text-sm">{tela.descripcion}</dd>
                    </div>
                  ) : null}
                </dl>
              </section>

              {/* Colores con precio. */}
              <section>
                <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Colores
                </h4>
                {tela.colores.length === 0 ? (
                  <p className="text-sm text-muted-foreground" data-testid="tela-sin-colores">
                    Esta tela no tiene colores capturados.
                  </p>
                ) : (
                  <ul className="flex max-w-xl flex-col gap-1.5" data-testid="tela-colores-detalle">
                    {tela.colores.map((color: TelaColor) => (
                      <li
                        key={color.idColor}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-1.5"
                      >
                        <span className="text-sm font-medium">{color.nombre}</span>
                        <span className="num shrink-0 text-sm text-muted-foreground">
                          {color.precio === null ? 'Sin precio' : formatearPrecio(color.precio)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Precios por proveedor (R17): a quién se le compra la tela y a qué precio (por color). */}
              <section>
                <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Precios por proveedor
                </h4>
                <EditorProveedoresTela
                  idTela={tela.id}
                  colores={tela.colores.map((color) => ({
                    idColor: color.idColor,
                    nombre: color.nombre,
                  }))}
                  deshabilitado={!puedeAdministrar || !tela.activo}
                  puedeVerImportes={puedeVerImportes}
                />
              </section>

              {/* Acciones de administración. */}
              {puedeAdministrar ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={onEditar} data-testid="editar-tela">
                    <Pencil aria-hidden />
                    Editar
                  </Button>
                  {tela.activo ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onDesactivar}
                      data-testid="desactivar-tela"
                    >
                      <Trash2 aria-hidden />
                      Desactivar
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onReactivar}
                      data-testid="activar-tela"
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

/** Un par etiqueta/valor compacto para la rejilla de "Datos de la tela". */
function Dato({
  etiqueta,
  children,
}: {
  etiqueta: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-faint uppercase">{etiqueta}</dt>
      <dd className="truncate text-sm">{children}</dd>
    </div>
  );
}
