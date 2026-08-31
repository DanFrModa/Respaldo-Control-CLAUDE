import {
  AlertTriangleIcon,
  BanIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeft,
  ChevronRightIcon,
  FileDown,
  FileText,
  Info,
  LockIcon,
  MessagesSquareIcon,
  PencilIcon,
  Plus,
  TargetIcon,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useDepartamentosCliente } from '@/api/clientes';
import { useEstadosLista } from '@/api/estados-lista';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { FiltroCliente } from '@/components/dominio/FiltroCliente';
import {
  descargarListaExcel,
  imprimirListaPdf,
  useAjustarPrecioLinea,
  useAprobarLinea,
  useEliminarLista,
  useFijarPrecioTarget,
  useQuitarLineaLista,
  useDesgloseCostoLinea,
  useListaPrecios,
  useListasPrecios,
  type ListaLinea,
  type ListasQuery,
} from '@/api/listas-precios';
import { useCambiarEstadoRenglon } from '@/api/negociacion';
import { ChipEstado, type TonoEstado } from '@/components/dominio/ChipEstado';
import {
  destinosDesde,
  diagnosticarPapel,
  ETIQUETA_ESTADO_RENGLON,
  TONO_ESTADO_RENGLON,
  type EstadoRenglon,
} from './estados-renglon';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { formatearFecha, formatearMoneda } from '@/lib/formato';
import { BuscadorToolbar } from '@/components/dominio/BuscadorToolbar';
import { ChipsFiltro } from '@/components/dominio/ChipsFiltro';
import { Historial } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { CotizacionesDeLista } from './CotizacionesDeLista';
import { DialogoCrearLista } from './DialogoCrearLista';
import { DialogoEditarFactoresLista } from './DialogoEditarFactoresLista';
import { DialogoNegociacionRenglon } from './DialogoNegociacionRenglon';
import { puedeIrAPrecosteos, RUTA_PRECOSTEOS } from './puerta-precosteos';
import { SelectorEstadoLista } from './SelectorEstadoLista';

/** Query de estados (para los chips): ordenados por su `orden`. */
const QUERY_ESTADOS = {
  pagina: 1,
  porPagina: 100,
  ordenarPor: 'orden',
  direccion: 'asc',
  incluirInactivos: 'false',
} as const;

/** Tono del chip por código de estado (proto `ESTADO_LISTA`); desconocidos en neutro. */
const TONO_ESTADO_LISTA: Record<string, TonoEstado> = {
  abierta: 'ok',
  autorizada: 'info',
  'en-negociacion': 'warn',
  cerrada: 'neutro',
  'ya-pedida': 'info',
};

/** Chip de estado de una lista (tonos del kit, proto `.badge`). */
function BadgeEstadoLista({
  codigo,
  nombre,
  className,
}: {
  codigo: string;
  nombre: string;
  className?: string;
}): React.JSX.Element {
  return (
    <ChipEstado
      tono={TONO_ESTADO_LISTA[codigo] ?? 'neutro'}
      // ⭐ V1-E8x: «En negociación» es el MISMO string en los dos ejes y los dos chips conviven en
      // esta pantalla. Aquí se dice de cuál es —y el del renglón, además, se pinta con contorno.
      title={`Estado de la LISTA (el documento): ${nombre}`}
      {...(className ? { className } : {})}
    >
      {nombre}
    </ChipEstado>
  );
}

/**
 * ⭐⭐ V1-E8x (§Post-F9.151) — CHIP del estado de un **MODELO** dentro de la lista.
 *
 * 🔴 Se ve DISTINTO del de la lista a propósito: **contorno, no relleno**. Los dos chips comparten
 * pantalla y uno de los cuatro nombres —«En negociación»— es idéntico carácter por carácter en los
 * dos ejes; el color solo no basta para separarlos (y ni siquiera es fiable: el mismo tono aparece
 * en los dos catálogos). El rótulo de la columna dice «Estado del modelo» y el `title` lo repite
 * para quien llegue por lector de pantalla.
 */
function BadgeEstadoRenglon({ linea }: { linea: ListaLinea }): React.JSX.Element {
  return (
    <ChipEstado
      tono={TONO_ESTADO_RENGLON[linea.estado]}
      sinPunto
      className="border border-current/40 bg-transparent"
      // El `title` dice de qué eje es Y desde cuándo: `estadoEn` es la FIRMA vigente (quién lo dejó
      // así y cuándo) — el rastro completo del dropeo y del revivir vive en el historial del
      // renglón, que es donde se lee con autor y texto (§Post-F9.155 punto 3).
      title={
        linea.estadoEn === null
          ? `Estado del MODELO dentro de la lista: ${linea.nombreEstado}`
          : `Estado del MODELO dentro de la lista: ${linea.nombreEstado} · desde ${formatearFecha(linea.estadoEn)}`
      }
      data-testid="chip-estado-renglon"
      data-estado={linea.estado}
    >
      {linea.nombreEstado}
    </ChipEstado>
  );
}

/**
 * Módulo "Listas de precios" (F8-E4) — re-vestido R9 FIEL al proto `vListasLista` + `vListaDetalle`:
 * page-head + banner informativo (la lista NO dispara pedidos) + card tabla-first (chips por estado,
 * filtros por cliente/departamento, buscador local, conteo) y, al hacer clic, la lista se abre a
 * PÁGINA COMPLETA (drill-in) con el panel de FACTORES del cliente (snapshot), la tabla de APROBACIÓN
 * renglón por renglón (precio calculado → Aprobar / Teclear, desglose expandible) y la negociación.
 *
 * FIDELIDAD vs proto: las columnas «Temporada» y «Valor Σ» del listado no existen en el resumen del
 * API → se omiten (huecos reportados). `listas.ver` gobierna el acceso; `listas.administrar` crea y
 * edita factores; `listas.aprobar` aprueba/teclea; `listas.negociar` mueve el estado (A1).
 */
export function ListasPreciosPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('listas.administrar');
  const navegar = useNavigate();

  const [idClienteFiltro, setIdClienteFiltro] = useState('');
  const [idDepartamentoFiltro, setIdDepartamentoFiltro] = useState('');
  const [idEstadoFiltro, setIdEstadoFiltro] = useState('');
  const [crearAbierto, setCrearAbierto] = useState(false);
  // Drill-in: la lista abierta a página completa (null = listado).
  const [seleccionId, setSeleccionId] = useState<number | null>(null);

  const estados = useEstadosLista(QUERY_ESTADOS);
  const departamentosFiltro = useDepartamentosCliente(
    idClienteFiltro === '' ? undefined : Number(idClienteFiltro),
  );

  const query: ListasQuery = {
    ...(idClienteFiltro === '' ? {} : { idCliente: Number(idClienteFiltro) }),
    ...(idDepartamentoFiltro === '' ? {} : { idClienteDepartamento: Number(idDepartamentoFiltro) }),
    ...(idEstadoFiltro === '' ? {} : { idEstadoLista: Number(idEstadoFiltro) }),
  };

  const consulta = useListasPrecios(query);
  const listas = consulta.data ?? [];

  /**
   * 🔴 ¿Hay algún filtro DE SERVIDOR puesto? Sin esto, el vacío MIENTE.
   *
   * `listas` ya viene filtrado por `query`, así que filtrar por un cliente que no tiene listas
   * dejaba el arreglo en cero y la pantalla contestaba *"todavía no hay ninguna lista… ve a congelar
   * precostos"* — mandando a arreglar algo que no está roto.
   *
   * Lo cazó el reviewer de V1-E8f, y duele porque **es el muro de Daniel construido otra vez, tres
   * pantallas más allá, dentro de la etapa que existe para cerrarlo** (§Post-F9.96: un aviso sólo
   * cuando de verdad no se puede). *Distinguir "no hay nada" de "no hay nada AQUÍ" es la diferencia
   * entre orientar y desorientar.*
   */
  const hayFiltroDeServidor =
    idClienteFiltro !== '' || idDepartamentoFiltro !== '' || idEstadoFiltro !== '';
  // ⭐ V1-E8t: *"no hay NINGUNA lista todavía"* (≠ *"no hay ninguna con este filtro"*). Se calcula
  // UNA vez porque gobierna DOS cosas —el texto y su puerta a Pre-costeos—, y dos copias de la
  // misma condición son exactamente cómo un aviso y su botón acaban discrepando.
  const vacioDeUniverso = listas.length === 0 && !hayFiltroDeServidor;

  // Búsqueda local por folio o cliente (el listado no pagina en servidor: es acotado por empresa).
  const [busqueda, setBusqueda] = useState('');
  const filtradas = busqueda.trim()
    ? listas.filter(
        (l) =>
          String(l.folio).includes(busqueda.trim()) ||
          l.nombreCliente.toLowerCase().includes(busqueda.trim().toLowerCase()),
      )
    : listas;

  function cambiarClienteFiltro(valor: string): void {
    setIdClienteFiltro(valor);
    setIdDepartamentoFiltro('');
  }

  // ── Drill-in: la lista abierta ocupa TODA la página (proto vListaDetalle) ──
  if (seleccionId !== null) {
    return <PaginaLista idLista={seleccionId} alRegresar={() => setSeleccionId(null)} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 md:p-5 lg:overflow-visible">
      {/* ── Encabezado (proto .page-head) ────────────────────────────────────── */}
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Cotizaciones / Listas de precios
          </h1>
          <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
            Desarrollo (F8) · factores del cliente · aprobación modelo por modelo · negociación por
            versiones
          </p>
        </div>
        {puedeAdministrar ? (
          <Button size="sm" onClick={() => setCrearAbierto(true)} data-testid="nuevo-lista-precios">
            <Plus aria-hidden />
            Nueva lista
          </Button>
        ) : null}
      </header>

      {/* ── Banner del proto: la lista NO dispara pedidos ────────────────────── */}
      <div className="flex shrink-0 items-center gap-2.5 rounded-[10px] bg-info-soft px-3 py-2 text-[12.5px] text-info">
        <Info className="size-4 shrink-0" aria-hidden />
        <span>
          La lista toma el <b>costo del pre-costeo</b> y le aplica los <b>factores del cliente</b>;{' '}
          <b>el dueño</b> aprueba <b>modelo por modelo</b> y comercial la manda ya autorizada.{' '}
          <b>La lista NO dispara pedidos</b> (el pedido nace de la OC del cliente).
        </span>
      </div>

      {/* ── Card: toolbar + tabla + totales ─────────────────────────────────── */}
      <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border bg-card lg:min-h-0 lg:flex-1 lg:shrink">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2.5">
          <ChipsFiltro
            etiqueta="Filtrar por estado de la lista"
            opciones={[
              { valor: '', etiqueta: 'Todas', testid: 'chip-todas' },
              ...(estados.data?.datos ?? []).map((e) => ({
                valor: String(e.id),
                etiqueta: e.nombre,
              })),
            ]}
            valor={idEstadoFiltro}
            alCambiar={setIdEstadoFiltro}
          />
          <span className="w-40" data-testid="filtros-listas">
            {/* V1-E4 (punto 7): búsqueda server-side en vez del <select> topado a 100. */}
            <FiltroCliente
              idCliente={idClienteFiltro === '' ? null : Number(idClienteFiltro)}
              alCambiar={(c) => cambiarClienteFiltro(c === null ? '' : String(c.id))}
            />
          </span>
          <SelectNativo
            className="w-44 h-[30px] text-xs"
            aria-label="Filtrar por departamento"
            value={idDepartamentoFiltro}
            disabled={idClienteFiltro === ''}
            onChange={(e) => setIdDepartamentoFiltro(e.target.value)}
          >
            <option value="">Todos los departamentos</option>
            {(departamentosFiltro.data ?? [])
              .filter((d) => d.activo)
              .map((d) => (
                <option key={d.id} value={String(d.id)}>
                  {d.nombre}
                </option>
              ))}
          </SelectNativo>
          <BuscadorToolbar
            valor={busqueda}
            alCambiar={setBusqueda}
            placeholder="Buscar lista, cliente…"
            etiqueta="Buscar lista"
            testid="buscar-lista-precios"
          />
          <span className="ml-auto text-xs text-faint">
            {filtradas.length.toLocaleString('es-MX')} listas
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
            <p className="p-6 text-sm text-muted-foreground">Cargando listas…</p>
          ) : filtradas.length === 0 ? (
            <div
              className="m-4 space-y-3 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
              data-testid="lista-precios-vacio"
            >
              <p>
                {vacioDeUniverso
                  ? 'Todavía no hay ninguna lista de precios. Una lista se arma con modelos que ya tienen su PRECOSTO CONGELADO: congélalos en Desarrollo › Pre-costeos y vuelve aquí con «Nueva lista».'
                  : 'No hay listas de precios que coincidan con el filtro.'}
              </p>
              {/* ⭐ V1-E8t (§Post-F9.145): el texto NOMBRABA el lugar («Desarrollo › Pre-costeos»)
                  y dejaba al usuario buscarlo en el menú. La misma puerta que ya tenía el diálogo
                  de crear lista, con la misma función que la mide (`puerta-precosteos.ts`). */}
              {vacioDeUniverso && puedeIrAPrecosteos(tienePermiso) ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void navegar(RUTA_PRECOSTEOS)}
                  data-testid="ir-a-precosteos-desde-vacio"
                >
                  Ir a Pre-costeos
                </Button>
              ) : null}
            </div>
          ) : (
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Lista</TablaDensaHead>
                  <TablaDensaHead>Cliente / Departamento</TablaDensaHead>
                  <TablaDensaHead numerica>Modelos</TablaDensaHead>
                  <TablaDensaHead numerica>Aprobados</TablaDensaHead>
                  <TablaDensaHead>Estado</TablaDensaHead>
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {filtradas.map((l) => (
                  <TablaDensaFila
                    key={l.id}
                    className="cursor-pointer"
                    onClick={() => setSeleccionId(l.id)}
                    data-testid="fila-lista-precios"
                  >
                    <TablaDensaCelda>
                      <div className="flex items-center gap-2">
                        <Avatar nombre="L P" tono="pt" tamano="sm" />
                        <div className="min-w-0">
                          <div className="num truncate font-semibold">#{l.folio}</div>
                          <div className="num truncate text-xs text-muted-foreground">
                            {formatearFecha(l.fecha)}
                          </div>
                        </div>
                      </div>
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      <span className="font-semibold">{l.nombreCliente}</span>{' '}
                      <span className="text-muted-foreground">/ {l.nombreDepartamento}</span>
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica>
                      {l.totalRenglones.toLocaleString('es-MX')}
                      {/* ⭐ V1-E8x: cuántos se cayeron, ahí mismo — si no, «10 modelos / 8
                          aprobados» parece una lista a medias cuando en realidad ya está lista. */}
                      {l.renglonesDropeados > 0 ? (
                        <span
                          className="ml-1 text-[11px] text-crit"
                          data-testid="dropeados-listado"
                        >
                          (−{l.renglonesDropeados.toLocaleString('es-MX')})
                        </span>
                      ) : null}
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica>
                      {/* ⭐ V1-E8x (§Post-F9.155): aprobados sobre VIGENTES — el mismo par que el
                          guard del papel evalúa. Contra el total, un dropeado sin firmar dejaba
                          este conteo clavado en «8/10» aunque el PDF ya pudiera bajarse. */}
                      {l.renglonesAprobados.toLocaleString('es-MX')}/
                      {(l.totalRenglones - l.renglonesDropeados).toLocaleString('es-MX')}
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      <BadgeEstadoLista codigo={l.codigoEstado} nombre={l.nombreEstado} />
                    </TablaDensaCelda>
                  </TablaDensaFila>
                ))}
              </TablaDensaCuerpo>
            </TablaDensa>
          )}
        </div>

        {/* ── Barra de totales al pie ────────────────────────────────────── */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-t bg-secondary px-3 py-1.5 text-xs">
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10.5px] font-medium text-faint uppercase">Listas (filtro)</span>
            <b className="num">{filtradas.length.toLocaleString('es-MX')}</b>
          </span>
        </div>
      </div>

      <DialogoCrearLista
        abierto={crearAbierto}
        alCambiarAbierto={setCrearAbierto}
        alCreada={() => {
          void consulta.refetch();
        }}
      />
    </div>
  );
}

/**
 * PÁGINA de una lista (drill-in, proto `vListaDetalle`): regreso al listado, encabezado con el
 * estado, panel de FACTORES (snapshot editable por diálogo), tabla de APROBACIÓN renglón por
 * renglón con desglose expandible, y el control de cambio de estado (negociación). Mantiene los
 * testids del flujo e2e (`detalle-lista-precios`, `fila-renglon-lista`, `aprobar-renglon`,
 * `teclear-precio`, `precio-aprobado`, `alternar-desglose`, `desglose-*`, `abrir-negociacion`…).
 */
function PaginaLista({
  idLista,
  alRegresar,
}: {
  idLista: number;
  alRegresar: () => void;
}): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const verImportes = tienePermiso('consultas.ver-importes');
  const puedeAprobar = tienePermiso('listas.aprobar');
  const puedeAdministrar = tienePermiso('listas.administrar');
  const puedeNegociar = tienePermiso('listas.negociar');
  // ⭐ V1-E8b (§Post-F9.125(a)+(b)): los CUATRO factores —verlos y moverlos— son del dueño. Antes el
  // panel se pintaba con `consultas.ver-importes` y el botón con `listas.administrar`, los dos
  // permisos que Desarrollo tiene. El backend ya los manda en `null`; aquí no se pinta el panel, que
  // es lo que evita cuatro guiones sin explicación.
  // (b) VERLOS y (a) MOVERLOS son DOS reglas de Daniel, no una. Hoy caen en el mismo permiso, y por
  // eso se nombran aparte en vez de reusar una sola bandera: si mañana se separan —"que los vea, que
  // no los mueva"— el cambio es de UNA línea aquí y no una cacería por la pantalla.
  // ⚠️ Consecuencia declarada: como el botón vive DENTRO del panel, su guarda `puedeMoverFactores`
  // es hoy inalcanzable-en-falso y NINGUNA prueba puede matarla (lo comprobó una mutación: revertirla
  // deja la suite en verde). Se conserva porque expresa la regla (a), no por defensa en profundidad.
  const puedeVerFactores = puedeAprobar;
  const puedeMoverFactores = puedeAprobar;
  const [borrarListaAbierto, setBorrarListaAbierto] = useState(false);
  const borrarLista = useEliminarLista();

  const consulta = useListaPrecios(idLista);
  const [editarFactoresAbierto, setEditarFactoresAbierto] = useState(false);

  const lista = consulta.data;

  const regreso = (
    <Button
      variant="ghost"
      size="sm"
      onClick={alRegresar}
      className="mb-2 -ml-2"
      data-testid="regresar-listas"
    >
      <ChevronLeft aria-hidden />
      Listas
    </Button>
  );

  if (consulta.isPending) {
    return (
      <div className="p-4 md:p-5">
        {regreso}
        <p className="text-sm text-muted-foreground">Cargando lista…</p>
      </div>
    );
  }
  if (consulta.isError || lista === undefined) {
    return (
      <div className="p-4 md:p-5">
        {regreso}
        <p className="text-sm text-destructive" role="alert">
          {consulta.error?.message ?? 'No se pudo cargar la lista.'}
        </p>
      </div>
    );
  }

  // §Post-F9.125(c): de una lista sin aprobar no sale papel. `aprobado` es un hecho del renglón
  // (no depende de ver importes), así que el aviso dice lo mismo para todos los que llegan aquí.
  //
  // ⭐⭐ V1-E8x (§Post-F9.155): el criterio ya no es «todos los renglones», es «todos los VIGENTES»
  // — un modelo dropeado nunca se va a aprobar, y exigirle firma dejaba la lista sin papel para
  // siempre. El diagnóstico entero (quiénes van, quiénes se cayeron, a quién le falta firma) lo
  // arma `diagnosticarPapel`, que espeja el guard del servidor renglón por renglón.
  const papel = diagnosticarPapel(lista.lineas);
  const listaCompletamenteAprobada = papel.puedeSalir;
  const sinAprobarTexto = papel.motivo ?? '';

  // ⭐ V1-E8d (§Post-F9.127): los renglones cuyo costo congelado quedó VIEJO porque la receta del
  // modelo se movió después. La FRASE la arma el servidor (`costo-viejo.ts`), aquí sólo se cuentan
  // para el resumen de arriba — el detalle de cada uno va pegado a SU renglón, que es donde sirve.
  //
  // ⭐ V1-E8x: se cuenta sobre los **VIGENTES**, igual que en el diálogo de emitir cotización. Un
  // dropeado con la receta movida levantaba un aviso sin consecuencia —no va en ningún papel— y,
  // peor, las dos pantallas decían cosas distintas del mismo hecho. Un solo criterio.
  //
  // ⚠️ El aviso PEGADO a su renglón sí se sigue pintando en un dropeado, y es a propósito: ahí es
  // información local del modelo, y al revivirlo vuelve a importar. Lo que se acota es el RESUMEN,
  // que habla de lo que afecta al papel.
  const conCostoViejo = papel.vigentes.filter((ln) => ln.avisoCostoViejo !== null);

  // Σ del pie del card. ⭐ V1-E8x: sobre los VIGENTES — sumar un modelo dropeado inflaría el total
  // de la oferta con algo que el cliente no va a ver en ningún papel.
  const sumaCosto = papel.vigentes.reduce((a, ln) => a + (ln.costoUnit ?? 0), 0);
  const sumaPrecio = papel.vigentes.reduce(
    (a, ln) => a + (ln.precioAprobado ?? ln.precioCalculado ?? 0),
    0,
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 md:p-5"
      data-testid="detalle-lista-precios"
    >
      {/*
        ── Encabezado (proto: regreso + título con estado + acciones) ────────

        ⭐ V1-E8w — **EL TÍTULO YA NO SE PARTE PALABRA POR PALABRA.** Daniel mandó la foto: «Lista #1
        · C&A / Dama» bajaba una palabra por renglón y se comía media pantalla. No era el texto: era
        el acomodo. `flex-1` es `flex: 1 1 0%`, o sea **base cero**, y con base cero este bloque
        SIEMPRE "cabe" en la línea — así que el `flex-wrap` del `<header>` nunca llegaba a
        dispararse y, en su lugar, el título se encogía hasta su ancho MÍNIMO (la palabra más larga)
        para dejarle sitio a los botones. Se arregla dándole una base real (`basis-80`) y dejando que
        las acciones se vayan al renglón de abajo (`shrink-0` + `basis-full sm:basis-auto`), que es
        lo que el usuario espera cuando la ventana se angosta. `text-pretty` remata el reparto de
        palabras cuando el título sí tiene que ocupar dos líneas.
      */}
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 flex-1 sm:basis-80" data-testid="encabezado-lista">
          {regreso}
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight text-pretty">
            Lista #{lista.folio} · {lista.nombreCliente}{' '}
            <span className="font-medium text-muted-foreground">/ {lista.nombreDepartamento}</span>
            <BadgeEstadoLista
              codigo={lista.codigoEstado}
              nombre={lista.nombreEstado}
              className="ml-2 align-middle"
            />
          </h1>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {lista.lineas.length} modelos
            {papel.dropeados.length > 0
              ? ` (${String(papel.vigentes.length)} vigentes · ${String(papel.dropeados.length)} dropeados)`
              : ''}{' '}
            · {formatearFecha(lista.fecha)}
          </p>
          {lista.notas === null || lista.notas === '' ? null : (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileText className="size-3.5 shrink-0" aria-hidden />
              {lista.notas}
            </p>
          )}
        </div>
        {verImportes ? (
          <div
            className="flex shrink-0 basis-full flex-wrap items-center gap-2 sm:basis-auto"
            data-testid="acciones-lista"
          >
            {/* ⭐ V1-E8b (§Post-F9.125(c)): de una lista sin aprobar NO sale papel — ni borrador.
                El servidor lo NIEGA (409 nombrando los modelos que faltan); aquí los botones se
                deshabilitan y se dice por qué, para que no queden dos controles que fallan al
                pulsarlos (la cicatriz de «esconder, no negar» es la contraria: aquí se niega en el
                servidor Y se explica en la pantalla). */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!listaCompletamenteAprobada}
              onClick={() => imprimirListaPdf(lista.id)}
              data-testid="descargar-lista-pdf"
            >
              <FileText aria-hidden />
              Lista PDF
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!listaCompletamenteAprobada}
              onClick={() => descargarListaExcel(lista.id)}
              data-testid="descargar-lista-excel"
            >
              <FileDown aria-hidden />
              Excel
            </Button>
            {/* V1-E4 (punto 4): una lista creada por error retenía a TODOS sus desarrollos —el
                `@@unique([idDesarrollo])` impide que entren a otra— y no había cómo borrarla.
                Queda íntegra en la bitácora (D3); una lista en estado de cierre se rechaza. */}
            {puedeAdministrar ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setBorrarListaAbierto(true)}
                data-testid="borrar-lista"
              >
                <Trash2 aria-hidden />
                Borrar lista
              </Button>
            ) : null}
            {listaCompletamenteAprobada ? null : (
              <p
                className="flex w-full items-start gap-1.5 text-[11.5px] text-muted-foreground"
                data-testid="aviso-sin-aprobar"
              >
                <LockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  No se puede bajar el PDF ni el Excel: {sinAprobarTexto}
                  {papel.sinAprobar.length > 0
                    ? ' sin precio aprobado por el dueño. Un papel con precios que nadie autorizó confunde al cliente.'
                    : '.'}
                </span>
              </p>
            )}
            {/* ⭐⭐ V1-E8x (§Post-F9.155): los dropeados NO salen en el papel, y eso se DICE — si
                no, quien baja el PDF cuenta 8 modelos donde la lista enseña 10 y no sabe por qué. */}
            {papel.dropeados.length > 0 ? (
              <p
                className="flex w-full items-start gap-1.5 text-[11.5px] text-muted-foreground"
                data-testid="aviso-dropeados"
              >
                <BanIcon className="mt-0.5 size-3.5 shrink-0 text-crit" aria-hidden />
                <span>
                  {papel.dropeados.length === 1
                    ? 'Un modelo está DROPEADO y no sale'
                    : `${String(papel.dropeados.length)} modelos están DROPEADOS y no salen`}{' '}
                  en el PDF, el Excel ni la cotización:{' '}
                  {papel.dropeados.map((ln) => ln.codigoModelo).join(', ')}. Revívelos si el cliente
                  se arrepiente — su historial se conserva.
                </span>
              </p>
            ) : null}
          </div>
        ) : null}
      </header>

      {/* ── Negociación: cambio de estado (permiso listas.negociar) ─────────── */}
      {puedeNegociar ? (
        <div className="shrink-0 rounded-xl border bg-card px-3.5 py-2.5">
          <SelectorEstadoLista lista={lista} />
        </div>
      ) : null}

      {/* ── Cotizaciones emitidas (V1-E7c): el papel que salió de esta mesa ── */}
      <CotizacionesDeLista lista={lista} />

      {/* ── Panel de factores del cliente (proto .lp-factores) ──────────────── */}
      {/* §Post-F9.125(b): sólo el dueño. Para los demás la sección entera NO se pinta —ni su
          rótulo—, en vez de dejarla con cuatro guiones o un letrero de permiso adentro
          (§Post-F9.68, mismo criterio que la ficha del cliente). */}
      {puedeVerFactores ? (
        <section className="shrink-0 rounded-xl border bg-card px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-[13px] font-semibold">Factores del cliente</h4>
            {puedeAprobar ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary-soft-foreground">
                <PencilIcon className="size-3" aria-hidden />
                se editan por diálogo, queda auditado
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary-soft-foreground">
                <LockIcon className="size-3" aria-hidden />
                bloqueados
              </span>
            )}
          </div>
          <p className="num mt-1 text-[11.5px] text-muted-foreground">
            Precio = costo ÷ (1 − margen) ÷ (1 − descuentos − regalías − costo ventas), redondeado
            al alza. <b>Moverlos invalida las aprobaciones</b> de esta lista.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <FactorLectura etiqueta="Margen" valor={lista.margenPct} />
            <FactorLectura etiqueta="Descuentos" valor={lista.descuentosPct} />
            <FactorLectura etiqueta="Regalías" valor={lista.regaliasPct} />
            <FactorLectura etiqueta="Costo de ventas" valor={lista.costoVentasPct} />
            {puedeMoverFactores ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditarFactoresAbierto(true)}
                data-testid="editar-factores-lista"
              >
                <PencilIcon aria-hidden />
                Editar factores
              </Button>
            ) : null}
            <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <Info className="size-3.5 shrink-0 text-primary" aria-hidden />
              Vienen predefinidos de <b>{lista.nombreCliente}</b>; el snapshot vive en esta lista.
            </span>
          </div>
        </section>
      ) : null}

      {/* ── Card: precios por modelo (aprobación renglón por renglón) ───────── */}
      <div className="flex min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center gap-2.5 border-b px-3.5 py-3">
          <h3 className="text-[13.5px] font-semibold">Precios por modelo</h3>
          {verImportes ? (
            <span className="ml-auto text-[11.5px] text-faint">
              Costo Σ <b className="num text-foreground">{formatearMoneda(sumaCosto)}</b> · Precio Σ{' '}
              <b className="num text-ok">{formatearMoneda(sumaPrecio)}</b>
            </span>
          ) : null}
        </div>
        {/* ⭐ V1-E8d (§Post-F9.127) — Daniel: *"Si. Ok. Que me avise."* El resumen dice CUÁNTOS y
            CUÁLES; el porqué de cada uno va pegado a su renglón. Es un AVISO, no un candado:
            aprobar y bajar el papel siguen funcionando. */}
        {conCostoViejo.length > 0 ? (
          <div
            className="mx-3 mt-3 flex items-start gap-2 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-[11.5px]"
            role="status"
            data-testid="aviso-costo-viejo-resumen"
          >
            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
            <span>
              <b>
                {conCostoViejo.length === 1
                  ? 'Un renglón está costeado con una receta vieja'
                  : `${String(conCostoViejo.length)} renglones están costeados con una receta vieja`}
              </b>
              : {conCostoViejo.map((ln) => ln.codigoModelo).join(', ')}. Les cambiaron la receta
              DESPUÉS de congelarse el costo con el que está calculado su precio. Cada renglón dice
              abajo qué cambió y cuándo.
            </span>
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <TablaDensa>
            <TablaDensaEncabezado>
              <TablaDensaFila>
                <TablaDensaHead>Modelo</TablaDensaHead>
                <TablaDensaHead numerica>Costo</TablaDensaHead>
                {/* ⭐ V1-E8w (§Post-F9.150): el TARGET que dio el cliente. Va ANTES del precio
                    calculado porque es contra lo que se compara, y Aurora lo captura aquí. */}
                <TablaDensaHead numerica>Target cliente</TablaDensaHead>
                <TablaDensaHead numerica>Precio calculado</TablaDensaHead>
                <TablaDensaHead numerica>Precio aprobado</TablaDensaHead>
                {/* ⭐ V1-E8x: la columna se NOMBRA («del modelo») porque arriba, en el encabezado
                    del detalle, vive el chip de la LISTA con nombres que se repiten. */}
                <TablaDensaHead>Estado del modelo</TablaDensaHead>
                <TablaDensaHead className="text-right" />
              </TablaDensaFila>
            </TablaDensaEncabezado>
            <TablaDensaCuerpo>
              {lista.lineas.map((linea) => (
                <FilaRenglon
                  key={linea.id}
                  linea={linea}
                  verImportes={verImportes}
                  puedeAprobar={puedeAprobar}
                  puedeNegociar={puedeNegociar}
                  puedeAdministrar={puedeAdministrar}
                />
              ))}
            </TablaDensaCuerpo>
          </TablaDensa>
        </div>
        {puedeAprobar ? (
          <div className="m-3 flex items-center gap-1.5 rounded-lg border bg-secondary px-3 py-2 text-[11.5px] text-muted-foreground">
            <LockIcon className="size-3.5 shrink-0" aria-hidden />
            {/* §Post-F9.68: se le dice a QUIÉN le toca, no cómo se llama el
                permiso por dentro — la forma interna del sistema no es del
                usuario. (Este aviso solo lo ve quien SÍ puede aprobar.) */}
            <span>
              Aprobar/teclear precios y mover los factores es facultad del <b>dueño</b>. Queda
              registrado quién y cuándo — y <b>mover un factor tumba las aprobaciones</b>, que se
              vuelven a firmar.
            </span>
          </div>
        ) : null}
      </div>

      <div className="mt-auto shrink-0">
        <Historial creadoEn={lista.creadoEn} modificadoEn={lista.modificadoEn} />
      </div>

      <DialogoEditarFactoresLista
        abierto={editarFactoresAbierto}
        alCambiarAbierto={setEditarFactoresAbierto}
        lista={lista}
      />

      {/* V1-E4 (punto 4): borrar la lista completa. */}
      <DialogoConfirmacion
        abierto={borrarListaAbierto}
        alCambiarAbierto={setBorrarListaAbierto}
        titulo="Borrar lista de precios"
        descripcion={
          <>
            Se borra la <b>lista #{lista.folio}</b> con sus {lista.lineas.length} renglón(es) y su
            historial de negociación. Queda <b>íntegra en la bitácora</b> y sus desarrollos vuelven
            a quedar disponibles para otra lista. No se puede deshacer desde la pantalla.
          </>
        }
        textoConfirmar="Borrar lista"
        variante="destructive"
        procesando={borrarLista.isPending}
        alConfirmar={() =>
          borrarLista.mutate(lista.id, {
            onSuccess: () => {
              toast.success(`Lista #${String(lista.folio)} borrada.`);
              setBorrarListaAbierto(false);
              alRegresar();
            },
            onError: (error) => toast.error(error.message),
          })
        }
      />
    </div>
  );
}

/** Un factor del snapshot en solo lectura (proto `.lp-fac`): etiqueta + valor mono + «%». */
function FactorLectura({
  etiqueta,
  valor,
}: {
  etiqueta: string;
  valor: number | null;
}): React.JSX.Element {
  return (
    <label className="flex w-32 flex-col gap-1.5">
      <span className="text-[11.5px] font-semibold text-muted-foreground">{etiqueta}</span>
      <span className="flex items-center gap-1.5">
        <input
          readOnly
          className="num h-[34px] w-full rounded-lg border border-input bg-background px-2.5 text-right text-[12.5px]"
          value={valor === null ? '—' : String(valor)}
          aria-label={etiqueta}
        />
        <span className="text-[12.5px] text-muted-foreground">%</span>
      </span>
    </label>
  );
}

/** Un renglón de la tabla de aprobación (modelo, precios, aprobar/teclear y negociación). */
function FilaRenglon({
  linea,
  verImportes,
  puedeAprobar,
  puedeNegociar,
  puedeAdministrar,
}: {
  linea: ListaLinea;
  verImportes: boolean;
  puedeAprobar: boolean;
  puedeNegociar: boolean;
  /** `listas.administrar` — habilita QUITAR el renglón (V1-E4 punto 4). */
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const aprobar = useAprobarLinea();
  const quitar = useQuitarLineaLista();
  const [quitarAbierto, setQuitarAbierto] = useState(false);
  const [targetAbierto, setTargetAbierto] = useState(false);
  const [tecleoAbierto, setTecleoAbierto] = useState(false);
  const [negociacionAbierta, setNegociacionAbierta] = useState(false);
  const [expandido, setExpandido] = useState(false);

  function alAprobar(): void {
    aprobar.mutate(linea.id, {
      onSuccess: () => toast.success(`Renglón "${linea.codigoModelo}" aprobado.`),
      onError: (error) => toast.error(error.message),
    });
  }

  return (
    <>
      <TablaDensaFila
        data-testid="fila-renglon-lista"
        data-aprobado={linea.aprobado}
        data-estado={linea.estado}
        // ⭐ V1-E8x: un modelo dropeado se APAGA. No se esconde (sigue siendo parte de la
        // negociación y se puede revivir), pero tiene que leerse como lo que es: fuera del papel.
        className={linea.estado === 'dropeado' ? 'opacity-60' : undefined}
      >
        <TablaDensaCelda>
          <div className="flex items-center gap-2">
            {/* lp-exp del proto: botoncito con chevron para el desglose de costo. */}
            <button
              type="button"
              onClick={() => setExpandido((v) => !v)}
              aria-label={expandido ? 'Ocultar desglose de costo' : 'Ver desglose de costo'}
              aria-expanded={expandido}
              className="grid size-[22px] shrink-0 place-items-center rounded-md border bg-card text-muted-foreground hover:text-foreground"
              data-testid="alternar-desglose"
            >
              {expandido ? (
                <ChevronDownIcon className="size-3.5" aria-hidden />
              ) : (
                <ChevronRightIcon className="size-3.5" aria-hidden />
              )}
            </button>
            <div className="min-w-0">
              <div
                className={
                  linea.estado === 'dropeado'
                    ? 'truncate font-semibold line-through decoration-crit/60'
                    : 'truncate font-semibold'
                }
              >
                {linea.descripcionModelo ?? linea.codigoModelo}
              </div>
              <div className="num truncate text-xs text-muted-foreground">
                Nuestro {linea.codigoModelo}
                {linea.numeroCliente === null ? '' : ` · ${linea.numeroCliente}`}
              </div>
            </div>
          </div>
        </TablaDensaCelda>
        <TablaDensaCelda numerica>
          {verImportes ? formatearMoneda(linea.costoUnit) : '—'}
        </TablaDensaCelda>
        {/* ⭐ V1-E8w (§Post-F9.150) — EL TARGET DEL CLIENTE. Lo captura **Aurora al armar la lista**
            (`listas.administrar`), no el dueño en la mesa; de ahí que el botón cuelgue de ese
            permiso y no de `listas.aprobar`. Sin target se ve el hueco, que también es un dato
            ("no nos lo dio"), no un error. INFORMA, NO BLOQUEA. */}
        <TablaDensaCelda numerica>
          <div className="flex items-center justify-end gap-1">
            <span className={linea.tieneTarget ? '' : 'text-faint'} data-testid="target-cliente">
              {linea.tieneTarget ? (verImportes ? formatearMoneda(linea.precioTarget) : 'Sí') : '—'}
            </span>
            {puedeAdministrar ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title="Capturar el target price que dio el cliente"
                aria-label={`Target del cliente para ${linea.codigoModelo}`}
                onClick={() => setTargetAbierto(true)}
                data-testid="capturar-target"
              >
                <TargetIcon className="size-4" aria-hidden />
              </Button>
            ) : null}
          </div>
        </TablaDensaCelda>
        <TablaDensaCelda numerica>
          {verImportes ? formatearMoneda(linea.precioCalculado) : '—'}
        </TablaDensaCelda>
        <TablaDensaCelda numerica>
          {linea.aprobado ? (
            <b className="num font-bold text-ok" data-testid="precio-aprobado">
              {verImportes ? formatearMoneda(linea.precioAprobado) : 'Aprobado'}
            </b>
          ) : (
            <span className="text-faint">—</span>
          )}
        </TablaDensaCelda>
        <TablaDensaCelda>
          <div className="flex flex-wrap items-center gap-1">
            {/* ⭐⭐ V1-E8x: PRIMERO el estado del modelo (el eje nuevo, el que Daniel pidió para
                *«saber los modelos que ya cerre»*), y luego la firma del precio. Son DOS ejes que
                conviven: un modelo cerrado puede seguir sin firmar, y un dropeado conserva su firma
                vieja intacta — por eso revivirlo no pierde nada. */}
            <BadgeEstadoRenglon linea={linea} />
            {linea.aprobado ? (
              <ChipEstado tono="ok">Aprobado</ChipEstado>
            ) : (
              <ChipEstado tono="neutro">Pendiente</ChipEstado>
            )}
            {/* ⭐ V1-E8d: el chip es para BUSCARLO de un vistazo en una lista larga; el QUÉ y el
                CUÁNDO van en el renglón de abajo, que es lo que de verdad avisa. */}
            {linea.avisoCostoViejo === null ? null : (
              <ChipEstado tono="warn" data-testid="chip-costo-viejo">
                Costo viejo
              </ChipEstado>
            )}
          </div>
          {/* El selector sólo para quien negocia (el servidor re-verifica, A1). Va PEGADO al chip:
              Daniel cierra cinco modelos de diez de corrido, y mandarlo a un diálogo por renglón
              convertiría eso en quince clics. */}
          {puedeNegociar ? <SelectorEstadoRenglon linea={linea} /> : null}
        </TablaDensaCelda>
        <TablaDensaCelda className="text-right whitespace-nowrap">
          <div className="flex justify-end gap-1">
            {puedeAprobar ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  onClick={alAprobar}
                  disabled={aprobar.isPending}
                  data-testid="aprobar-renglon"
                >
                  <CheckIcon aria-hidden />
                  Aprobar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setTecleoAbierto(true)}
                  data-testid="teclear-precio"
                >
                  Teclear
                </Button>
              </>
            ) : null}
            {/* La negociación (historial + comparador) la ve cualquiera con `listas.ver`; las acciones
              de negociar dentro del panel se gobiernan por `listas.negociar`. */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setNegociacionAbierta(true)}
              data-testid="abrir-negociacion"
            >
              <MessagesSquareIcon aria-hidden />
              Negociación
            </Button>
            {/* V1-E4 (punto 4): quitar el renglón. Sin esto, un desarrollo metido por error
                quedaba atrapado para siempre (`@@unique([idDesarrollo])` a nivel BD). */}
            {puedeAdministrar ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title="Quitar este renglón de la lista (queda en la bitácora)"
                aria-label={`Quitar ${linea.codigoModelo} de la lista`}
                onClick={() => setQuitarAbierto(true)}
                data-testid="quitar-renglon-lista"
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            ) : null}
          </div>
          <DialogoAjustarPrecio
            abierto={tecleoAbierto}
            alCambiarAbierto={setTecleoAbierto}
            linea={linea}
          />
          <DialogoPrecioTarget
            abierto={targetAbierto}
            alCambiarAbierto={setTargetAbierto}
            linea={linea}
          />
          <DialogoNegociacionRenglon
            abierto={negociacionAbierta}
            alCambiarAbierto={setNegociacionAbierta}
            linea={linea}
            verImportes={verImportes}
            puedeNegociar={puedeNegociar}
          />
          {/* V1-E4 (punto 4): confirmación de quitar el renglón. */}
          <DialogoConfirmacion
            abierto={quitarAbierto}
            alCambiarAbierto={setQuitarAbierto}
            titulo="Quitar renglón de la lista"
            descripcion={
              <>
                Se quita <b>{linea.codigoModelo}</b> de esta lista, con su precio y su historial de
                negociación. Queda <b>íntegro en la bitácora</b> y el desarrollo vuelve a quedar
                disponible para otra lista.
              </>
            }
            textoConfirmar="Quitar renglón"
            variante="destructive"
            procesando={quitar.isPending}
            alConfirmar={() =>
              quitar.mutate(linea.id, {
                onSuccess: () => {
                  toast.success(`Renglón "${linea.codigoModelo}" quitado de la lista.`);
                  setQuitarAbierto(false);
                },
                onError: (error) => toast.error(error.message),
              })
            }
          />
        </TablaDensaCelda>
      </TablaDensaFila>
      {/* ⭐ V1-E8d (§Post-F9.127) — LA FRASE DEL SERVIDOR, ENTERA Y PEGADA A SU RENGLÓN. No se
          recorta ni se resume aquí: dice QUÉ parte de la receta cambió, CUÁNDO, contra qué versión
          del precosto, y qué hacer. Un semáforo mudo no avisa de nada. */}
      {linea.avisoCostoViejo === null ? null : (
        <TablaDensaFila data-testid="aviso-costo-viejo">
          <TablaDensaCelda colSpan={7} className="bg-warn-soft">
            <div className="flex items-start gap-2 text-[11.5px]">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
              <span>
                <b>Costo viejo — {linea.codigoModelo}.</b> {linea.avisoCostoViejo}
              </span>
            </div>
          </TablaDensaCelda>
        </TablaDensaFila>
      )}
      {expandido ? (
        <TablaDensaFila data-testid="desglose-renglon">
          <TablaDensaCelda colSpan={7} className="bg-muted/30">
            <DesgloseCosto idLinea={linea.id} verImportes={verImportes} />
          </TablaDensaCelda>
        </TablaDensaFila>
      ) : null}
    </>
  );
}

/**
 * ⭐⭐ V1-E8x (§Post-F9.151) — SELECTOR del estado de UN MODELO dentro de la lista. Daniel:
 *
 * > *«seria bueno saber los modelos que ya cerre…. a veces de una lista de 10 modelos, cierro 5 y
 * > los otros ya no los vendo»*
 *
 * 🔴 **Va en la fila y dispara al elegir, sin diálogo de confirmación.** Es deliberado: el caso de
 * uso es cerrar cinco modelos de diez de corrido, y un diálogo por renglón lo volvería quince
 * clics. Se puede hacer así porque **nada se pierde**: el cambio es REVERSIBLE (revivir conserva
 * toda la historia, §Post-F9.155) y queda AUDITADO con quién y cuándo, así que un clic de más se
 * deshace con otro clic y deja constancia de los dos.
 *
 * 🔴 Las opciones que ofrece ESPEJAN al servidor: desde un modelo cerrado o dropeado el único
 * camino es REVIVIR (Abierto / En negociación). El backend lo re-valida; esto sólo evita ofrecer
 * un movimiento que va a volver como 409.
 */
function SelectorEstadoRenglon({ linea }: { linea: ListaLinea }): React.JSX.Element {
  const cambiar = useCambiarEstadoRenglon();
  // El destino elegido se guarda en estado (y se limpia al terminar) en vez de dejar el select
  // clavado en «Mover a…»: un `value` constante hace que la opción elegida NUNCA quede marcada, y
  // eso confunde a quien lo usa —y a los navegadores automatizados— mientras la mutación viaja.
  const [destino, setDestino] = useState('');
  const destinos = destinosDesde(linea.estado);

  function alElegir(elegido: string): void {
    setDestino(elegido);
    if (elegido === '') {
      return;
    }
    cambiar.mutate(
      { idLinea: linea.id, cuerpo: { estado: elegido as EstadoRenglon } },
      {
        onSuccess: () => {
          toast.success(
            `"${linea.codigoModelo}" quedó en «${ETIQUETA_ESTADO_RENGLON[elegido as EstadoRenglon]}».`,
          );
          setDestino('');
        },
        onError: (error) => {
          toast.error(error.message);
          setDestino('');
        },
      },
    );
  }

  return (
    <SelectNativo
      aria-label={`Estado del modelo ${linea.codigoModelo}`}
      title="Mover este modelo: abierto · en negociación · cerrado · dropeado"
      className="mt-1 h-7 w-auto text-[11.5px]"
      value={destino}
      disabled={cambiar.isPending}
      onChange={(e) => alElegir(e.target.value)}
      data-testid="estado-renglon"
    >
      <option value="">Mover a…</option>
      {destinos.map((destino) => (
        <option key={destino} value={destino}>
          {ETIQUETA_ESTADO_RENGLON[destino]}
        </option>
      ))}
    </SelectNativo>
  );
}

/**
 * Desglose de costo por concepto de un renglón (§4.8): Tela · Avíos · Procesos · Corte · Maquila =
 * costo total. Server-side (A1: no se pivotea aquí). Se carga sólo al expandir el renglón.
 */
function DesgloseCosto({
  idLinea,
  verImportes,
}: {
  idLinea: number;
  verImportes: boolean;
}): React.JSX.Element {
  const consulta = useDesgloseCostoLinea(idLinea);

  if (consulta.isPending) {
    return <p className="text-sm text-muted-foreground">Cargando desglose…</p>;
  }
  if (consulta.isError) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {consulta.error.message}
      </p>
    );
  }
  const desglose = consulta.data;
  return (
    <div className="space-y-1" data-testid="desglose-costo">
      <p className="text-xs font-medium text-muted-foreground">
        Desglose del precosto v{desglose.versionPrecosto}
      </p>
      <ul className="max-w-md space-y-0.5 text-sm">
        {desglose.grupos.map((g) => (
          <li key={g.codigo} className="flex justify-between gap-4" data-testid="desglose-concepto">
            <span>{g.nombre}</span>
            <span className="tabular-nums">{verImportes ? formatearMoneda(g.subtotal) : '—'}</span>
          </li>
        ))}
        <li className="mt-1 flex justify-between gap-4 border-t pt-1 font-semibold">
          <span>Costo total</span>
          <span className="tabular-nums" data-testid="desglose-total">
            {verImportes ? formatearMoneda(desglose.costoTotal) : '—'}
          </span>
        </li>
      </ul>
    </div>
  );
}

/** Diálogo para teclear el precio aprobado de un renglón. */
/**
 * ⭐ V1-E8w (§Post-F9.150) — CAPTURA del **TARGET PRICE del cliente**. Daniel:
 *
 * > *«aveces los clientes nos dan sus target prices…. y es importante saberlo a la hora de la
 * > negociacion. Eso lo debe de poner Aurora desde que hace la lista de precios… Debe de tener un
 * > liugar para poner el target que le dio el cliente si es que nos lo dio.»*
 *
 * 🔴 Es **de Aurora**, no del dueño: el botón cuelga de `listas.administrar` (la misma puerta con la
 * que se agrega y se quita un renglón), no de `listas.aprobar`. Y **se puede BORRAR**: *"si es que
 * nos lo dio"* — un número capturado por error no puede atrapar a nadie, porque un target falso en
 * la mesa es peor que ninguno.
 */
function DialogoPrecioTarget({
  abierto,
  alCambiarAbierto,
  linea,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  linea: ListaLinea;
}): React.JSX.Element {
  const fijar = useFijarPrecioTarget();
  const [valor, setValor] = useState(linea.precioTarget === null ? '' : String(linea.precioTarget));

  function guardar(precioTarget: number | null): void {
    fijar.mutate(
      { idLinea: linea.id, cuerpo: { precioTarget } },
      {
        onSuccess: () => {
          toast.success(
            precioTarget === null
              ? `Target de "${linea.codigoModelo}" borrado.`
              : `Target de "${linea.codigoModelo}" guardado.`,
          );
          alCambiarAbierto(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Target del cliente — {linea.codigoModelo}</DialogTitle>
          <DialogDescription>
            El precio objetivo que <b>nos dio el cliente</b>, si nos lo dio. Aparece en la mesa de
            negociación como referencia: <b>informa, no bloquea</b> nada.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Field>
            <FieldLabel htmlFor="target-valor">Target</FieldLabel>
            <Input
              id="target-valor"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              autoFocus
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              data-testid="input-target"
            />
          </Field>
        </div>
        <DialogFooter>
          {linea.tieneTarget ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => guardar(null)}
              disabled={fijar.isPending}
              data-testid="borrar-target"
            >
              Borrar target
            </Button>
          ) : null}
          <Button
            type="button"
            onClick={() => {
              const precio = Number(valor);
              if (!Number.isFinite(precio) || precio <= 0) {
                toast.error('Captura un target mayor a cero (o bórralo si no lo dieron).');
                return;
              }
              guardar(precio);
            }}
            disabled={fijar.isPending}
            data-testid="guardar-target"
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogoAjustarPrecio({
  abierto,
  alCambiarAbierto,
  linea,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  linea: ListaLinea;
}): React.JSX.Element {
  const ajustar = useAjustarPrecioLinea();
  const [valor, setValor] = useState('');

  function guardar(): void {
    const precio = Number(valor);
    if (!Number.isFinite(precio) || precio <= 0) {
      toast.error('Captura un precio mayor a cero.');
      return;
    }
    ajustar.mutate(
      { idLinea: linea.id, cuerpo: { precio } },
      {
        onSuccess: () => {
          toast.success(`Precio de "${linea.codigoModelo}" actualizado.`);
          alCambiarAbierto(false);
          setValor('');
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Precio de {linea.codigoModelo}</DialogTitle>
          <DialogDescription>Teclea el precio aprobado para este renglón.</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Field>
            <FieldLabel htmlFor="teclear-precio-valor">Precio</FieldLabel>
            <Input
              id="teclear-precio-valor"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              autoFocus
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              data-testid="input-precio-teclear"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={ajustar.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={guardar}
            disabled={ajustar.isPending}
            data-testid="guardar-precio-teclear"
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
