import { Ban, BookOpenText, ChevronRight, Printer, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import {
  urlImpresoTraspasoTela,
  useCancelarTelaColor,
  useExistenciasTelaColor,
  useKardexTelaColor,
  usePartidasTela,
} from '@/api/inventario-materiales';
import { useProveedores } from '@/api/proveedores';
import { etiquetaUnidadTela, useTelasCategorias } from '@/api/telas';
import type {
  ExistenciaTelaAgrupada,
  ExistenciaTelaColorHijo,
  ExistenciasTelaColorQuery,
  KardexTelaColorRenglon,
} from '@/api/tipos';
import { CajonDetalle } from '@/components/dominio/CajonDetalle';
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
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useDebounce } from '@/lib/useDebounce';
import { useSesion } from '@/sesion/useSesion';

import { DialogoCancelarMaterial } from './DialogoCancelarMaterial';

/** Valor del filtro que significa "todos". */
const TODOS = 'TODOS';

/** Formatea una cantidad con separador local. */
function num(valor: number): string {
  return valor.toLocaleString('es-MX');
}

/** El color elegido para el cajón de kardex (con el contexto de su tela padre). */
interface ColorKardex {
  idTelaColor: number;
  color: string;
  tela: string;
  nombreCuerpo: string | null;
  nombreComplemento: string | null;
  unidadMedida: 'KG' | 'M';
}

/**
 * EXISTENCIAS DE TELAS del inventario NUEVO por COLOR (etapa A2 — Daniel §Post-F9.9/§Post-F9.11):
 * tabla-first con las TELAS PADRE desplegables → renglones de COLOR con la existencia de CUERPO y
 * COMPLEMENTO JUNTAS (dos columnas; la de complemento con "—" cuando la tela no lo lleva), pantone
 * visible, unidad (kg/m) y desglose por almacén. Filtros server-side: búsqueda (tela / proveedor /
 * color / pantone), tipo, proveedor, almacén y ceros. DOBLE CLIC (o el botón explícito, para
 * móvil) en un renglón de color → CAJÓN con el KARDEX de ese color (saldo corrido de ambos
 * componentes). La vista vieja por lote sigue viva en "Existencias por lote (legado)".
 * `inventario-telas.ver` gobierna el acceso. Existencia = Σ de movimientos (D3), nunca editable.
 */
export function ExistenciasTelasColorPagina(): React.JSX.Element {
  const [texto, setTexto] = useState('');
  const busqueda = useDebounce(texto.trim(), 300);
  const [idCategoria, setIdCategoria] = useState<string>(TODOS);
  const [idProveedor, setIdProveedor] = useState<string>(TODOS);
  const [idAlmacen, setIdAlmacen] = useState<string>(TODOS);
  const [incluirCeros, setIncluirCeros] = useState(false);
  const [colapsadas, setColapsadas] = useState<Set<number>>(new Set());
  const [colorKardex, setColorKardex] = useState<ColorKardex | undefined>(undefined);

  const categorias = useTelasCategorias({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });
  const proveedores = useProveedores({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });
  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });

  const filtros: ExistenciasTelaColorQuery = {
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(idCategoria !== TODOS ? { idCategoria: Number(idCategoria) } : {}),
    ...(idProveedor !== TODOS ? { idProveedor: Number(idProveedor) } : {}),
    ...(idAlmacen !== TODOS ? { idAlmacen: Number(idAlmacen) } : {}),
    ...(incluirCeros ? { incluirCeros: 'true' as const } : {}),
  };
  const consulta = useExistenciasTelaColor(filtros);
  const telas = consulta.data?.telas ?? [];
  const totalCuerpo = consulta.data?.totalCuerpo ?? 0;
  const totalComplemento = consulta.data?.totalComplemento ?? 0;
  const totalColores = telas.reduce((suma, t) => suma + t.colores.length, 0);

  const kpis: Kpi[] = [
    { clave: 'telas', etiqueta: 'Telas', valor: num(telas.length), pie: 'con existencia' },
    { clave: 'colores', etiqueta: 'Colores', valor: num(totalColores), pie: 'tela × color' },
    {
      clave: 'cuerpo',
      etiqueta: 'Existencia (cuerpo)',
      valor: num(totalCuerpo),
      pie: 'suma de movimientos (kardex)',
    },
    {
      clave: 'complemento',
      etiqueta: 'Complemento',
      valor: num(totalComplemento),
      pie: 'cardigan y similares',
    },
  ];

  /** Las telas arrancan DESPLEGADAS (lo que se busca son los colores); el toggle las colapsa. */
  function alternarTela(idTela: number): void {
    setColapsadas((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(idTela)) siguiente.delete(idTela);
      else siguiente.add(idTela);
      return siguiente;
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 md:p-5 lg:overflow-visible">
      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Inventario de telas
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Existencia por tela y color (cuerpo y complemento juntos, suma de movimientos) · doble
            clic en un color para su kardex
          </p>
        </div>
      </header>

      {/* ── KPIs ────────────────────────────────────────────────────────────── */}
      <KpiTiles kpis={kpis} className="shrink-0" />

      {/* ── Card: filtros + tabla + totales ─────────────────────────────────── */}
      <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border bg-card lg:min-h-0 lg:flex-1 lg:shrink">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          <div className="relative w-56">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="h-8 pl-8 text-sm"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Tela, proveedor, color, pantone…"
              aria-label="Buscar"
              data-testid="telas-color-busqueda"
            />
          </div>
          <SelectNativo
            className="h-8 w-40 text-sm"
            aria-label="Filtrar por tipo"
            value={idCategoria}
            onChange={(e) => setIdCategoria(e.target.value)}
            data-testid="telas-color-categoria"
          >
            <option value={TODOS}>Todos los tipos</option>
            {(categorias.data?.datos ?? []).map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.nombre}
              </option>
            ))}
          </SelectNativo>
          <SelectNativo
            className="h-8 w-44 text-sm"
            aria-label="Filtrar por proveedor"
            value={idProveedor}
            onChange={(e) => setIdProveedor(e.target.value)}
            data-testid="telas-color-proveedor"
          >
            <option value={TODOS}>Todos los proveedores</option>
            {(proveedores.data?.datos ?? []).map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.nombre}
              </option>
            ))}
          </SelectNativo>
          <SelectNativo
            className="h-8 w-44 text-sm"
            aria-label="Filtrar por almacén"
            value={idAlmacen}
            onChange={(e) => setIdAlmacen(e.target.value)}
            data-testid="telas-color-almacen"
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
              data-testid="telas-color-ceros"
            />
            Incluir ceros
          </label>
          <span className="ml-auto text-xs text-faint">{num(totalColores)} colores</span>
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
          ) : telas.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground" data-testid="telas-color-vacio">
              No hay existencias de tela para el filtro seleccionado.
            </p>
          ) : (
            <>
              {/* Móvil: tarjetas apiladas tela → colores (el kardex por botón; no hay doble clic). */}
              <div className="space-y-3 p-3 md:hidden" data-testid="telas-color-tarjetas">
                {telas.map((t) => (
                  <TarjetaTela key={t.idTela} tela={t} alAbrirKardex={setColorKardex} />
                ))}
              </div>

              {/* Escritorio: tabla densa con fila padre por tela y renglones de color. */}
              <div className="hidden md:block" data-testid="telas-color-tabla">
                <TablaDensa>
                  <TablaDensaEncabezado>
                    <TablaDensaFila>
                      <TablaDensaHead className="w-8" />
                      <TablaDensaHead>Tela / color</TablaDensaHead>
                      <TablaDensaHead>Pantone</TablaDensaHead>
                      <TablaDensaHead>Almacenes</TablaDensaHead>
                      <TablaDensaHead className="w-14">Unidad</TablaDensaHead>
                      <TablaDensaHead numerica>Cuerpo</TablaDensaHead>
                      <TablaDensaHead numerica>Complemento</TablaDensaHead>
                      <TablaDensaHead className="w-10" />
                    </TablaDensaFila>
                  </TablaDensaEncabezado>
                  <TablaDensaCuerpo>
                    {telas.map((t) => {
                      const abierta = !colapsadas.has(t.idTela);
                      return (
                        <RenglonesDeTela
                          key={t.idTela}
                          tela={t}
                          abierta={abierta}
                          onToggle={() => alternarTela(t.idTela)}
                          alAbrirKardex={setColorKardex}
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
            <span className="text-[10.5px] font-medium text-faint uppercase">Cuerpo:</span>
            <b className="num text-primary">{num(totalCuerpo)}</b>
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10.5px] font-medium text-faint uppercase">Complemento:</span>
            <b className="num text-primary">{num(totalComplemento)}</b>
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10.5px] font-medium text-faint uppercase">Colores</span>
            <b className="num">{num(totalColores)}</b>
          </span>
        </div>
      </div>

      {/* ── Cajón: kardex del color elegido ─────────────────────────────────── */}
      <CajonKardexTelaColor
        color={colorKardex}
        alCerrar={() => setColorKardex(undefined)}
        idAlmacen={idAlmacen === TODOS ? undefined : Number(idAlmacen)}
      />
    </div>
  );
}

/** Fila PADRE de una tela + sus renglones de color (escritorio). */
function RenglonesDeTela({
  tela,
  abierta,
  onToggle,
  alAbrirKardex,
}: {
  tela: ExistenciaTelaAgrupada;
  abierta: boolean;
  onToggle: () => void;
  alAbrirKardex: (color: ColorKardex) => void;
}): React.JSX.Element {
  const llevaComplemento = tela.nombreComplemento !== null;
  return (
    <>
      <TablaDensaFila className="bg-muted/40">
        <TablaDensaCelda className="p-0 pl-2">
          <button
            type="button"
            onClick={onToggle}
            className="grid size-7 place-items-center rounded hover:bg-muted"
            aria-label={abierta ? 'Ocultar colores' : 'Ver colores'}
            aria-expanded={abierta}
            data-testid={`telas-color-toggle-${tela.idTela}`}
          >
            <ChevronRight
              className={`size-4 transition-transform ${abierta ? 'rotate-90' : ''}`}
              aria-hidden
            />
          </button>
        </TablaDensaCelda>
        <TablaDensaCelda>
          <div className="flex items-center gap-2">
            <Avatar nombre={tela.nombre} tono="telas" tamano="sm">
              T
            </Avatar>
            <div className="min-w-0">
              <p className="font-medium">{tela.nombre}</p>
              <p className="truncate text-xs text-muted-foreground">
                {[
                  tela.categoria,
                  tela.proveedor,
                  tela.nombreProveedor,
                  // Los NOMBRES de los componentes de ESTA tela ("Felpa + Cardigan").
                  llevaComplemento
                    ? `${tela.nombreCuerpo ?? 'Cuerpo'} + ${tela.nombreComplemento ?? ''}`
                    : tela.nombreCuerpo,
                ]
                  .filter((parte): parte is string => parte !== null && parte !== undefined)
                  .join(' · ') || '—'}
              </p>
            </div>
          </div>
        </TablaDensaCelda>
        <TablaDensaCelda />
        <TablaDensaCelda className="text-xs text-muted-foreground">
          {tela.colores.length} color(es)
        </TablaDensaCelda>
        <TablaDensaCelda className="text-xs">
          {etiquetaUnidadTela(tela.unidadMedida)}
        </TablaDensaCelda>
        <TablaDensaCelda numerica className="font-semibold">
          {num(tela.totalCuerpo)}
        </TablaDensaCelda>
        <TablaDensaCelda numerica className="font-semibold">
          {llevaComplemento ? num(tela.totalComplemento) : '—'}
        </TablaDensaCelda>
        <TablaDensaCelda />
      </TablaDensaFila>
      {abierta
        ? tela.colores.map((c) => (
            <RenglonColor key={c.idTelaColor} tela={tela} color={c} alAbrirKardex={alAbrirKardex} />
          ))
        : null}
    </>
  );
}

/** Renglón de COLOR: doble clic (o el botón) abre el kardex de ese color. */
function RenglonColor({
  tela,
  color,
  alAbrirKardex,
}: {
  tela: ExistenciaTelaAgrupada;
  color: ExistenciaTelaColorHijo;
  alAbrirKardex: (color: ColorKardex) => void;
}): React.JSX.Element {
  const llevaComplemento = tela.nombreComplemento !== null;
  function abrir(): void {
    alAbrirKardex({
      idTelaColor: color.idTelaColor,
      color: color.nombre,
      tela: tela.nombre,
      nombreCuerpo: tela.nombreCuerpo,
      nombreComplemento: tela.nombreComplemento,
      unidadMedida: tela.unidadMedida,
    });
  }
  return (
    <TablaDensaFila
      className="cursor-pointer"
      onDoubleClick={abrir}
      data-testid={`telas-color-fila-${color.idTelaColor}`}
    >
      <TablaDensaCelda />
      <TablaDensaCelda className="pl-8">{color.nombre}</TablaDensaCelda>
      <TablaDensaCelda className="text-xs text-muted-foreground">
        {color.pantone ?? '—'}
      </TablaDensaCelda>
      <TablaDensaCelda className="text-xs text-muted-foreground">
        {color.almacenes
          .map((a) =>
            llevaComplemento
              ? `${a.almacen}: ${num(a.cuerpo)} / ${num(a.complemento)}`
              : `${a.almacen}: ${num(a.cuerpo)}`,
          )
          .join(' · ')}
      </TablaDensaCelda>
      <TablaDensaCelda className="text-xs">{etiquetaUnidadTela(tela.unidadMedida)}</TablaDensaCelda>
      <TablaDensaCelda numerica>{num(color.existenciaCuerpo)}</TablaDensaCelda>
      <TablaDensaCelda numerica>
        {llevaComplemento ? num(color.existenciaComplemento) : '—'}
      </TablaDensaCelda>
      <TablaDensaCelda className="p-0 pr-2 text-right">
        <button
          type="button"
          onClick={abrir}
          className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`Kardex de ${tela.nombre} ${color.nombre}`}
          data-testid={`telas-color-kardex-${color.idTelaColor}`}
        >
          <BookOpenText className="size-4" aria-hidden />
        </button>
      </TablaDensaCelda>
    </TablaDensaFila>
  );
}

/** Tarjeta móvil de una tela con sus colores (el kardex se abre con el botón explícito). */
function TarjetaTela({
  tela,
  alAbrirKardex,
}: {
  tela: ExistenciaTelaAgrupada;
  alAbrirKardex: (color: ColorKardex) => void;
}): React.JSX.Element {
  const llevaComplemento = tela.nombreComplemento !== null;
  return (
    <div className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{tela.nombre}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[tela.categoria, tela.proveedor].filter((x) => x !== null).join(' · ') || '—'}
          </p>
        </div>
        <span className="num text-lg font-semibold">
          {num(tela.totalCuerpo)}
          <span className="text-xs font-normal text-muted-foreground">
            {' '}
            {etiquetaUnidadTela(tela.unidadMedida)}
          </span>
        </span>
      </div>
      <ul className="space-y-1 rounded-md bg-muted/40 p-2 text-xs">
        {tela.colores.map((c) => (
          <li key={c.idTelaColor} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">
              {c.nombre}
              {c.pantone !== null ? (
                <span className="text-muted-foreground"> · {c.pantone}</span>
              ) : null}
            </span>
            <span className="num shrink-0">
              {num(c.existenciaCuerpo)}
              {llevaComplemento ? ` / ${num(c.existenciaComplemento)}` : ''}
            </span>
            <button
              type="button"
              onClick={() =>
                alAbrirKardex({
                  idTelaColor: c.idTelaColor,
                  color: c.nombre,
                  tela: tela.nombre,
                  nombreCuerpo: tela.nombreCuerpo,
                  nombreComplemento: tela.nombreComplemento,
                  unidadMedida: tela.unidadMedida,
                })
              }
              className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted"
              aria-label={`Kardex de ${tela.nombre} ${c.nombre}`}
            >
              <BookOpenText className="size-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {llevaComplemento ? (
        <p className="text-[11px] text-muted-foreground">
          {tela.nombreCuerpo ?? 'Cuerpo'} / {tela.nombreComplemento} · {num(tela.totalComplemento)}{' '}
          de complemento
        </p>
      ) : null}
    </div>
  );
}

/**
 * CAJÓN con el kardex del color elegido: saldo corrido de cuerpo y complemento, filtro opcional
 * por PARTIDA (la traza de entrada — el backend filtra `idPartida`) y CANCELACIÓN del movimiento
 * (inverso auditado D3, mismo diálogo/contrato que el kardex de materiales legado).
 */
function CajonKardexTelaColor({
  color,
  alCerrar,
  idAlmacen,
}: {
  color: ColorKardex | undefined;
  alCerrar: () => void;
  idAlmacen: number | undefined;
}): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeMover = tienePermiso('inventario-telas.mover');
  const [idPartida, setIdPartida] = useState<string>(TODOS);
  const [aCancelar, setACancelar] = useState<KardexTelaColorRenglon | null>(null);
  const cancelar = useCancelarTelaColor();

  // Al cambiar de color se resetea el filtro de partida (las partidas son de ESE color).
  const idTelaColor = color?.idTelaColor;
  useEffect(() => {
    setIdPartida(TODOS);
  }, [idTelaColor]);

  const consulta = useKardexTelaColor(
    color === undefined
      ? undefined
      : {
          idTelaColor: color.idTelaColor,
          ...(idAlmacen === undefined ? {} : { idAlmacen }),
          ...(idPartida === TODOS ? {} : { idPartida: Number(idPartida) }),
        },
  );
  // Las partidas del color, para el selector del filtro (folio + lote del proveedor).
  const partidas = usePartidasTela(idTelaColor === undefined ? {} : { idTelaColor }, {
    habilitado: idTelaColor !== undefined,
  });
  const kardex = consulta.data;
  const llevaComplemento = color?.nombreComplemento !== null && color !== undefined;
  const encCuerpo = color?.nombreCuerpo ?? 'Cuerpo';
  const encComplemento = color?.nombreComplemento ?? 'Complemento';

  return (
    <CajonDetalle
      abierto={color !== undefined}
      alCambiarAbierto={(abierto) => {
        if (!abierto) alCerrar();
      }}
      titulo={color === undefined ? '' : `Kardex · ${color.tela} · ${color.color}`}
      subtitulo="Movimientos cronológicos con saldo corrido (suma de movimientos, D3)"
      ancho="maximo"
    >
      {(partidas.data?.datos.length ?? 0) > 0 ? (
        <div className="mb-3 flex items-center gap-2">
          <SelectNativo
            className="h-8 w-64 text-sm"
            aria-label="Filtrar por partida"
            value={idPartida}
            onChange={(e) => setIdPartida(e.target.value)}
            data-testid="kardex-color-partida"
          >
            <option value={TODOS}>Todas las partidas</option>
            {(partidas.data?.datos ?? []).map((p) => (
              <option key={p.id} value={String(p.id)}>
                Partida #{p.folio}
                {p.loteProveedor !== null ? ` · ${p.loteProveedor}` : ''}
                {p.factura !== null ? ` · ${p.factura}` : ''}
              </option>
            ))}
          </SelectNativo>
        </div>
      ) : null}
      {consulta.isError ? (
        <p className="p-4 text-sm text-destructive" role="alert">
          {consulta.error.message}
        </p>
      ) : consulta.isPending ? (
        <p className="p-4 text-sm text-muted-foreground">Cargando kardex…</p>
      ) : kardex === undefined || kardex.renglones.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground" data-testid="kardex-color-vacio">
          Este color aún no tiene movimientos.
        </p>
      ) : (
        <div className="overflow-x-auto" data-testid="kardex-color-tabla">
          <TablaDensa>
            <TablaDensaEncabezado>
              <TablaDensaFila>
                <TablaDensaHead>Folio</TablaDensaHead>
                <TablaDensaHead>Fecha</TablaDensaHead>
                <TablaDensaHead>Movimiento</TablaDensaHead>
                <TablaDensaHead>Almacén</TablaDensaHead>
                <TablaDensaHead>Partida</TablaDensaHead>
                <TablaDensaHead numerica>{`${encCuerpo} +`}</TablaDensaHead>
                <TablaDensaHead numerica>{`${encCuerpo} −`}</TablaDensaHead>
                <TablaDensaHead numerica>Saldo</TablaDensaHead>
                {llevaComplemento ? (
                  <>
                    <TablaDensaHead numerica>{`${encComplemento} +`}</TablaDensaHead>
                    <TablaDensaHead numerica>{`${encComplemento} −`}</TablaDensaHead>
                    <TablaDensaHead numerica>Saldo</TablaDensaHead>
                  </>
                ) : null}
                {/* Acciones: imprimir la hoja del traspaso (§Post-F9.38, con `inventario-telas.ver`)
                    y cancelar (con `.mover`). */}
                <TablaDensaHead className="w-16" />
              </TablaDensaFila>
            </TablaDensaEncabezado>
            <TablaDensaCuerpo>
              {kardex.renglones.map((r) => (
                <TablaDensaFila
                  key={`${r.idMovimiento}-${r.idAlmacen}-${r.folio}`}
                  className={r.cancelado ? 'opacity-50' : undefined}
                >
                  <TablaDensaCelda className="num">#{r.folio}</TablaDensaCelda>
                  <TablaDensaCelda>{r.fecha}</TablaDensaCelda>
                  <TablaDensaCelda>
                    {r.tipoMov}
                    {r.cancelado ? (
                      <span className="ml-1 text-xs text-destructive">(cancelado)</span>
                    ) : null}
                  </TablaDensaCelda>
                  <TablaDensaCelda>{r.almacen}</TablaDensaCelda>
                  <TablaDensaCelda className="text-xs text-muted-foreground">
                    {r.partidaFolio !== null
                      ? `#${r.partidaFolio}${r.loteProveedor !== null ? ` · ${r.loteProveedor}` : ''}`
                      : '—'}
                  </TablaDensaCelda>
                  <TablaDensaCelda numerica>
                    {r.entradaCuerpo > 0 ? num(r.entradaCuerpo) : ''}
                  </TablaDensaCelda>
                  <TablaDensaCelda numerica>
                    {r.salidaCuerpo > 0 ? num(r.salidaCuerpo) : ''}
                  </TablaDensaCelda>
                  <TablaDensaCelda numerica className="font-semibold">
                    {num(r.saldoCuerpo)}
                  </TablaDensaCelda>
                  {llevaComplemento ? (
                    <>
                      <TablaDensaCelda numerica>
                        {r.entradaComplemento > 0 ? num(r.entradaComplemento) : ''}
                      </TablaDensaCelda>
                      <TablaDensaCelda numerica>
                        {r.salidaComplemento > 0 ? num(r.salidaComplemento) : ''}
                      </TablaDensaCelda>
                      <TablaDensaCelda numerica className="font-semibold">
                        {num(r.saldoComplemento)}
                      </TablaDensaCelda>
                    </>
                  ) : null}
                  <TablaDensaCelda className="p-0 pr-1 text-right">
                    <span className="flex items-center justify-end">
                      {/* REIMPRESIÓN de la hoja del traspaso (§Post-F9.38): el papel que se fue con
                          la tela se recupera desde aquí, no solo al guardarlo. Un traspaso
                          CANCELADO no se imprime — su papel no vuelve a salir con un bulto (el
                          backend también lo rechaza; hoy además una pata de traspaso no se puede
                          anular sola: se revierte con un traspaso inverso, que trae su propia hoja). */}
                      {r.origenTipo === 'traspaso' && !r.cancelado ? (
                        <button
                          type="button"
                          onClick={() =>
                            window.open(
                              urlImpresoTraspasoTela(r.idMovimiento),
                              '_blank',
                              'noopener',
                            )
                          }
                          className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label={`Hoja del traspaso #${r.folio}`}
                          title="Hoja del traspaso"
                          data-testid={`kardex-color-imprimir-${r.idMovimiento}`}
                        >
                          <Printer className="size-4" aria-hidden />
                        </button>
                      ) : null}
                      {puedeMover && !r.cancelado ? (
                        <button
                          type="button"
                          onClick={() => setACancelar(r)}
                          className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label={`Cancelar movimiento #${r.folio}`}
                          data-testid={`kardex-color-cancelar-${r.idMovimiento}`}
                        >
                          <Ban className="size-4" aria-hidden />
                        </button>
                      ) : null}
                    </span>
                  </TablaDensaCelda>
                </TablaDensaFila>
              ))}
            </TablaDensaCuerpo>
          </TablaDensa>
        </div>
      )}

      {/* Cancelar = INVERSO auditado (D3): mismo diálogo/contrato que el kardex de materiales. */}
      <DialogoCancelarMaterial
        abierto={aCancelar !== null}
        folio={aCancelar?.folio ?? null}
        cargando={cancelar.isPending}
        alCerrar={() => setACancelar(null)}
        alConfirmar={(motivo) => {
          if (aCancelar === null) return;
          cancelar.mutate(
            { id: aCancelar.idMovimiento, cuerpo: { motivo } },
            {
              onSuccess: () => {
                toast.success(`Movimiento #${aCancelar.folio} cancelado (inverso registrado).`);
                setACancelar(null);
              },
              onError: (error) => toast.error(error.message),
            },
          );
        }}
      />
    </CajonDetalle>
  );
}
