import {
  ChevronLeft,
  ChevronRight,
  FileText,
  ListPlus,
  Pencil,
  Plus,
  PowerIcon,
  RotateCcw,
  Shirt,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useDepartamentosCliente } from '@/api/clientes';
import { useReactivarDesarrollo, type Desarrollo, type EstadoDesarrollo } from '@/api/desarrollos';
import { useTableroDesarrollos } from '@/api/liga-orden';
import { useCandidatosLista } from '@/api/listas-precios';
import {
  useArchivarProyecto,
  useDesarchivarProyecto,
  useProyecto,
  useProyectos,
} from '@/api/proyectos';
import type { Proyecto, ProyectosQuery } from '@/api/proyectos';
import { useTemporadas } from '@/api/temporadas';
import { FiltroCliente } from '@/components/dominio/FiltroCliente';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { ChipEstado, type TonoEstado } from '@/components/dominio/ChipEstado';
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
import { formatearFecha, formatearFechaHora } from '@/lib/formato';
import { useDebounce } from '@/lib/useDebounce';
import { BuscadorToolbar } from '@/components/dominio/BuscadorToolbar';
import { ChipsFiltro } from '@/components/dominio/ChipsFiltro';
import { Historial } from '@/modulos/detalle';
import { DialogoCrearLista } from '@/modulos/listas-precios/DialogoCrearLista';
import { useSesion } from '@/sesion/useSesion';

import { DialogoApagarDesarrollo } from './DialogoApagarDesarrollo';
import { DialogoDesarrollo } from './DialogoDesarrollo';
import { DialogoPrecosto } from './DialogoPrecosto';
import { DialogoProyecto } from './DialogoProyecto';

/** Renglones por página del listado. */
const POR_PAGINA = 10;

/** Tope alto para los selectores de filtro. */
const QUERY_CATALOGO = {
  pagina: 1,
  porPagina: 100,
  ordenarPor: 'nombre',
  direccion: 'asc',
  incluirInactivos: 'false',
} as const;

/** Etiqueta legible por estado derivado del desarrollo. */
const ETIQUETA_ESTADO: Record<EstadoDesarrollo, string> = {
  'en-desarrollo': 'En desarrollo',
  cotizado: 'Cotizado',
  'en-lista': 'En lista',
  'ligado-produccion': 'Ligado a producción',
  apagado: 'Apagado',
};

/** Tono del chip por estado derivado (proto `EST_MODELO`: proceso=warn, completo=info, aprobado=ok). */
const TONO_ESTADO: Record<EstadoDesarrollo, TonoEstado> = {
  'en-desarrollo': 'warn',
  cotizado: 'info',
  'en-lista': 'ok',
  'ligado-produccion': 'ok',
  apagado: 'neutro',
};

/**
 * ¿Por qué NO se puede generar la lista de precios de este proyecto? Devuelve el motivo EN TEXTO
 * (o `null` si sí se puede). Regla §Post-F9.16: un botón que no se puede usar NO se esconde — se
 * explica.
 *
 * QUIÉN MANDA (corrección de la revisión): el habilitado lo decide `hayCandidatos`, que sale de la
 * CONSULTA DE CANDIDATOS del servidor (la misma que abre el diálogo, ya acotada por `idProyecto`),
 * NUNCA el estado derivado del desarrollo. El estado NO sirve para eso porque va por PRECEDENCIA y
 * `ligado-produccion` PISA a `en-lista`/`cotizado`: un modelo con precosto congelado, ligado a una
 * orden y SIN renglón de lista es candidato para el backend (`candidatosParaLista` filtra
 * `listaLineas: none` y nunca mira las órdenes) y aquí se veía bloqueado con un motivo FALSO.
 *
 * El estado sólo se usa para AFINAR el texto cuando ya se sabe que no hay candidatos, y sólo en lo
 * que es verdad con certeza: `en-desarrollo` es el default de la precedencia, así que si TODOS los
 * activos están ahí, ninguno tiene precosto congelado. En cualquier otra mezcla no se puede separar
 * "ya está en una lista" de "le falta congelar" sin mentir, y el texto lo dice como disyunción.
 */
function motivoSinCandidatosLista(
  desarrollos: Desarrollo[],
  hayCandidatos: boolean,
): string | null {
  if (hayCandidatos) {
    return null;
  }
  const activos = desarrollos.filter((d) => !d.apagado);
  if (activos.length === 0) {
    // Sin modelos ACTIVOS hay dos situaciones distintas y el remedio NO es el mismo: un proyecto
    // vacío se arregla agregando; uno con todos los modelos apagados se arregla REACTIVANDO (y
    // decirle "no tiene modelos" sería falso: a un centímetro se está pintando el control
    // «Mostrar apagados (N)» que prueba lo contrario).
    return desarrollos.length === 0
      ? 'Este proyecto todavía no tiene modelos: agrega uno y congela su precosto para poder generar la lista.'
      : 'Todos los modelos de este proyecto están apagados: reactiva el que quieras cotizar (con «Mostrar apagados») y congela su precosto.';
  }
  if (activos.every((d) => d.estado === 'en-desarrollo')) {
    return 'Ninguno de los desarrollos tiene un precosto CONGELADO; ábrelo en «Precosto» y congela la versión para poder incluirlo en la lista.';
  }
  return 'Ningún modelo de este proyecto está disponible: los que ya están en una lista de precios no se vuelven a incluir, y a los demás les falta congelar su precosto («Precosto» → «Congelar versión»).';
}

/** Chip del estado derivado de un desarrollo (tonos del kit, proto `.badge`). */
function BadgeEstado({ estado }: { estado: EstadoDesarrollo }): React.JSX.Element {
  return <ChipEstado tono={TONO_ESTADO[estado]}>{ETIQUETA_ESTADO[estado]}</ChipEstado>;
}

/**
 * Pantalla de Desarrollo / PRE-COSTEOS (F8-E2) — re-vestida R9 FIEL al proto `vPrecosteosLista` +
 * `vPrecosteoProyecto`: page-head + KPIs de servidor (tablero de desarrollos por estado, F8-E6, y
 * conteo de proyectos abiertos) + card tabla-first de PROYECTOS (chips Abiertos/Todos, filtros por
 * cliente/departamento/temporada, buscador, conteo) y, al hacer clic, el proyecto se abre a PÁGINA
 * COMPLETA (drill-in) con sus DESARROLLOS como TARJETAS (`.pc-card`) + tarjeta punteada de agregar.
 *
 * FIDELIDAD vs proto: la columna «Avance» (% por proyecto) no existe en el API → se omite (hueco
 * reportado); las tarjetas no muestran tela/costo/maquilero porque el listado de desarrollos no trae
 * el precosto (vive en su diálogo). El botón «Generar lista de precios» del proyecto YA existe
 * (Daniel, ago-2026): abre el diálogo de la lista con cliente + departamento precargados y los
 * candidatos de ESE proyecto; si no hay ninguno NO se esconde — se explica por qué (§Post-F9.16).
 * `desarrollo.ver` gobierna el acceso; `desarrollo.administrar` las acciones y `listas.administrar`
 * la generación de la lista (el backend decide, A1/A4).
 */
export function ProyectosPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('desarrollo.administrar');

  // ── Estado de la vista ─────────────────────────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [incluirArchivados, setIncluirArchivados] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [idClienteFiltro, setIdClienteFiltro] = useState('');
  const [idDepartamentoFiltro, setIdDepartamentoFiltro] = useState('');
  const [idTemporadaFiltro, setIdTemporadaFiltro] = useState('');
  // Drill-in: el proyecto abierto a página completa (null = listado).
  const [seleccionId, setSeleccionId] = useState<number | null>(null);

  const temporadas = useTemporadas(QUERY_CATALOGO);
  const departamentosFiltro = useDepartamentosCliente(
    idClienteFiltro === '' ? undefined : Number(idClienteFiltro),
  );

  // Filtros compartidos por la lista y los KPIs (cliente/departamento/temporada).
  const filtrosBase = {
    ...(idClienteFiltro === '' ? {} : { idCliente: Number(idClienteFiltro) }),
    ...(idDepartamentoFiltro === '' ? {} : { idClienteDepartamento: Number(idDepartamentoFiltro) }),
    ...(idTemporadaFiltro === '' ? {} : { idTemporada: Number(idTemporadaFiltro) }),
  };

  const query: ProyectosQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'folio',
    direccion: 'desc',
    incluirArchivados: incluirArchivados ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...filtrosBase,
  };

  const consulta = useProyectos(query);
  const archivar = useArchivarProyecto();
  const desarchivar = useDesarchivarProyecto();

  // KPIs de SERVIDOR (proto `vPrecosteosLista`): tablero de desarrollos por estado (agregado
  // en el backend, F8-E6) + conteo de proyectos abiertos (porPagina:1 solo lee el total).
  const tablero = useTableroDesarrollos(filtrosBase);
  const kpiAbiertos = useProyectos({
    pagina: 1,
    porPagina: 1,
    ordenarPor: 'folio',
    direccion: 'desc',
    incluirArchivados: 'false',
    ...filtrosBase,
  });

  const conteos = tablero.data;
  const kpis: Kpi[] = [
    {
      clave: 'proyectos-abiertos',
      etiqueta: 'Proyectos abiertos',
      valor: (kpiAbiertos.data?.total ?? 0).toLocaleString('es-MX'),
      pie: 'en desarrollo',
    },
    {
      clave: 'modelos-en-desarrollo',
      etiqueta: 'Modelos en desarrollo',
      valor: (conteos?.enDesarrollo ?? 0).toLocaleString('es-MX'),
      pie: 'sin precosto congelado',
    },
    {
      clave: 'modelos-cotizados',
      etiqueta: 'Modelos cotizados',
      valor: (conteos?.cotizado ?? 0).toLocaleString('es-MX'),
      pie: 'con precosto congelado',
      ...(conteos !== undefined && conteos.cotizado > 0 ? { tonoPie: 'ok' as const } : {}),
    },
    {
      clave: 'total-modelos',
      etiqueta: 'Total de modelos',
      valor: (conteos?.total ?? 0).toLocaleString('es-MX'),
      pie: 'todos los proyectos',
    },
  ];

  // ── Diálogos ───────────────────────────────────────────────────────────────
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [proyectoEnEdicion, setProyectoEnEdicion] = useState<Proyecto | undefined>(undefined);
  const [aArchivar, setAArchivar] = useState<Proyecto | null>(null);

  function abrirAlta(): void {
    setProyectoEnEdicion(undefined);
    setDialogoAbierto(true);
  }
  function abrirEdicion(proyecto: Proyecto): void {
    setProyectoEnEdicion(proyecto);
    setDialogoAbierto(true);
  }

  function confirmarArchivar(): void {
    if (aArchivar === null) {
      return;
    }
    const objetivo = aArchivar;
    archivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Proyecto ${objetivo.folio} archivado.`);
        setAArchivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  function reactivarProyecto(proyecto: Proyecto): void {
    desarchivar.mutate(proyecto.id, {
      onSuccess: () => toast.success(`Proyecto ${proyecto.folio} desarchivado.`),
      onError: (error) => toast.error(error.message),
    });
  }

  function alBuscar(valor: string): void {
    setTextoBusqueda(valor);
    setPagina(1);
  }
  function cambiarClienteFiltro(valor: string): void {
    setIdClienteFiltro(valor);
    setIdDepartamentoFiltro('');
    setPagina(1);
  }

  const datos = consulta.data;
  const filas = datos?.datos ?? [];
  const total = datos?.total ?? 0;
  const totalPaginas = datos?.totalPaginas ?? 1;
  const seleccion = filas.find((p) => p.id === seleccionId) ?? null;

  // ── Drill-in: el proyecto abierto ocupa TODA la página (proto vPrecosteoProyecto) ──
  if (seleccion !== null) {
    return (
      <>
        <PaginaProyecto
          proyecto={seleccion}
          puedeAdministrar={puedeAdministrar}
          alRegresar={() => setSeleccionId(null)}
          alEditar={() => abrirEdicion(seleccion)}
          alArchivar={() => setAArchivar(seleccion)}
          alDesarchivar={() => reactivarProyecto(seleccion)}
        />
        <DialogoProyecto
          abierto={dialogoAbierto}
          alCambiarAbierto={setDialogoAbierto}
          proyecto={proyectoEnEdicion}
        />
        <DialogoConfirmacion
          abierto={aArchivar !== null}
          alCambiarAbierto={(abierto) => {
            if (!abierto) {
              setAArchivar(null);
            }
          }}
          titulo="Archivar proyecto"
          descripcion={
            <>
              ¿Archivar el{' '}
              <span className="font-medium text-foreground">proyecto {aArchivar?.folio}</span>? Se
              conserva (borrado suave) y puedes desarchivarlo después.
            </>
          }
          textoConfirmar="Archivar"
          variante="destructive"
          procesando={archivar.isPending}
          alConfirmar={confirmarArchivar}
        />
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 md:p-5 lg:overflow-visible">
      {/* ── Encabezado (proto .page-head) ────────────────────────────────────── */}
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">Pre-costeos</h1>
          <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
            Desarrollo · proyectos por cliente + departamento · costeo modelo por modelo
          </p>
        </div>
        {puedeAdministrar ? (
          <Button size="sm" onClick={abrirAlta} data-testid="nuevo-proyecto">
            <Plus aria-hidden />
            Nuevo proyecto
          </Button>
        ) : null}
      </header>

      {/* ── KPIs (agregados de servidor) ─────────────────────────────────────── */}
      <KpiTiles kpis={kpis} className="shrink-0" />

      {/* ── Card: toolbar + tabla + totales ─────────────────────────────────── */}
      <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border bg-card lg:min-h-0 lg:flex-1 lg:shrink">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2.5">
          <ChipsFiltro
            etiqueta="Filtrar proyectos"
            opciones={[
              { valor: 'abiertos', etiqueta: 'Abiertos' },
              { valor: 'todos', etiqueta: 'Todos', testid: 'mostrar-desactivados' },
            ]}
            valor={incluirArchivados ? 'todos' : 'abiertos'}
            alCambiar={(valor) => {
              setIncluirArchivados(valor === 'todos');
              setPagina(1);
            }}
          />
          <span className="w-40" data-testid="filtros-desarrollo">
            {/* V1-E4 (punto 7): búsqueda server-side; el <select> se alimentaba de la primera
                página del catálogo (100) y con ~117 clientes había inalcanzables. */}
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
            onChange={(e) => {
              setIdDepartamentoFiltro(e.target.value);
              setPagina(1);
            }}
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
          <SelectNativo
            className="w-40 h-[30px] text-xs"
            aria-label="Filtrar por temporada"
            value={idTemporadaFiltro}
            onChange={(e) => {
              setIdTemporadaFiltro(e.target.value);
              setPagina(1);
            }}
          >
            <option value="">Todas las temporadas</option>
            {(temporadas.data?.datos ?? []).map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.nombre}
              </option>
            ))}
          </SelectNativo>
          <BuscadorToolbar
            valor={textoBusqueda}
            alCambiar={alBuscar}
            placeholder="Buscar proyecto…"
            etiqueta="Buscar proyecto"
            testid="buscar-proyecto"
          />
          <span className="ml-auto text-xs text-faint">
            {total.toLocaleString('es-MX')} proyectos
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
            <p className="p-6 text-sm text-muted-foreground">Cargando proyectos…</p>
          ) : filas.length === 0 ? (
            <p
              className="m-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
              data-testid="proyecto-vacio"
            >
              No hay proyectos que coincidan con la búsqueda.
            </p>
          ) : (
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Proyecto</TablaDensaHead>
                  <TablaDensaHead>Cliente</TablaDensaHead>
                  <TablaDensaHead>Departamento</TablaDensaHead>
                  <TablaDensaHead>Temporada</TablaDensaHead>
                  <TablaDensaHead numerica>Modelos</TablaDensaHead>
                  <TablaDensaHead>Estatus</TablaDensaHead>
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {filas.map((p) => (
                  <TablaDensaFila
                    key={p.id}
                    className="cursor-pointer"
                    onClick={() => setSeleccionId(p.id)}
                    data-testid="fila-proyecto"
                  >
                    <TablaDensaCelda>
                      <div className="flex items-center gap-2">
                        <Avatar nombre="P C" tono="pt" tamano="sm" />
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{p.nombre}</div>
                          <div className="num truncate text-xs text-muted-foreground">
                            #{p.folio} · {formatearFecha(p.creadoEn)}
                          </div>
                        </div>
                      </div>
                    </TablaDensaCelda>
                    <TablaDensaCelda className="font-semibold">{p.cliente}</TablaDensaCelda>
                    <TablaDensaCelda>{p.departamento}</TablaDensaCelda>
                    <TablaDensaCelda>
                      {p.temporada === null ? (
                        <span className="text-faint">—</span>
                      ) : (
                        <ChipEstado tono="neutro">{p.temporada}</ChipEstado>
                      )}
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica>
                      {p.conteos.total.toLocaleString('es-MX')}
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      {p.archivado ? (
                        <ChipEstado tono="neutro">Archivado</ChipEstado>
                      ) : (
                        <ChipEstado tono="ok">Abierto</ChipEstado>
                      )}
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
            <span className="text-[10.5px] font-medium text-faint uppercase">
              Proyectos (filtro)
            </span>
            <b className="num">{total.toLocaleString('es-MX')}</b>
          </span>
          <span
            className="ml-auto flex items-center gap-1 text-muted-foreground"
            data-testid="resumen-paginacion"
          >
            Página {datos?.pagina ?? 1} de {totalPaginas}
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

      {/* Diálogos del listado */}
      <DialogoProyecto
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        proyecto={proyectoEnEdicion}
      />
    </div>
  );
}

/**
 * PÁGINA del proyecto abierto (drill-in, proto `vPrecosteoProyecto`): regreso al listado, encabezado
 * con cliente/departamento/temporada y los DESARROLLOS como tarjetas `.pc-card` + tarjeta punteada
 * de agregar. Mantiene los testids del flujo e2e (`detalle-proyecto`, `agregar-desarrollo`,
 * `fila-desarrollo`, `precostear-desarrollo`, `apagar-desarrollo`, `mostrar-apagados-desarrollos`,
 * `desarrollos-apagados`, `fila-desarrollo-apagado`, `reactivar-desarrollo`).
 */
function PaginaProyecto({
  proyecto,
  puedeAdministrar,
  alRegresar,
  alEditar,
  alArchivar,
  alDesarchivar,
}: {
  proyecto: Proyecto;
  puedeAdministrar: boolean;
  alRegresar: () => void;
  alEditar: () => void;
  alArchivar: () => void;
  alDesarchivar: () => void;
}): React.JSX.Element {
  // Trae el detalle completo (con sus desarrollos), como el panel anterior.
  const consulta = useProyecto(proyecto.id);
  const reactivar = useReactivarDesarrollo();
  const navegar = useNavigate();
  const { tienePermiso } = useSesion();
  // Crear una lista exige AMBOS permisos en el servidor (la ruta encadena `listas.administrar` +
  // `listas.ver`), y la consulta de candidatos de aquí abajo exige `listas.ver`: se piden los dos
  // para no ofrecer un botón que terminaría en 403 ni disparar una consulta sin permiso.
  const puedeGenerarLista = tienePermiso('listas.administrar') && tienePermiso('listas.ver');

  const [agregarAbierto, setAgregarAbierto] = useState(false);
  const [aApagar, setAApagar] = useState<Desarrollo | null>(null);
  const [aPrecostear, setAPrecostear] = useState<Desarrollo | null>(null);
  const [mostrarApagados, setMostrarApagados] = useState(false);
  const [crearListaAbierto, setCrearListaAbierto] = useState(false);

  const detalle = consulta.data;
  const desarrollos = detalle?.desarrollos ?? [];
  const activos = desarrollos.filter((d) => !d.apagado);
  const apagados = desarrollos.filter((d) => d.apagado);

  // ── ¿Se puede generar la lista? Lo dice el SERVIDOR, no el estado derivado ──────────
  // Los candidatos REALES de este proyecto (misma consulta que carga el diálogo, así que la
  // respuesta se comparte por cache y no se pide dos veces). Vive en el DRILL-IN, no en la tabla de
  // proyectos: es UNA llamada por proyecto abierto, no una por tarjeta. Sin permiso se pasa
  // `undefined` y la consulta queda deshabilitada.
  const candidatos = useCandidatosLista(
    puedeGenerarLista ? proyecto.idCliente : undefined,
    puedeGenerarLista ? proyecto.idClienteDepartamento : undefined,
    proyecto.id,
  );
  // Sigue cargando alguna de las dos consultas de las que depende el botón (el detalle trae los
  // desarrollos que afinan el texto; los candidatos deciden el habilitado).
  const cargandoParaLista = consulta.isPending || (puedeGenerarLista && candidatos.isPending);
  // Por qué NO se podría generar la lista (null = sí se puede). Mientras carga no se afirma nada:
  // el botón espera DESHABILITADO sin inventar un motivo (y sin habilitarse un instante en falso).
  const motivoSinLista = cargandoParaLista
    ? null
    : candidatos.isError
      ? `No se pudieron consultar los modelos disponibles: ${candidatos.error.message}`
      : motivoSinCandidatosLista(desarrollos, (candidatos.data ?? []).length > 0);

  function alReactivar(desarrollo: Desarrollo): void {
    reactivar.mutate(desarrollo.id, {
      onSuccess: () => toast.success(`Desarrollo "${desarrollo.codigoModelo}" reactivado.`),
      onError: (error) => toast.error(error.message),
    });
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 md:p-5"
      data-testid="detalle-proyecto"
    >
      {/* ── Encabezado del proyecto (proto: regreso + título + acciones) ───── */}
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 flex-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={alRegresar}
            className="mb-2 -ml-2"
            data-testid="regresar-proyectos"
          >
            <ChevronLeft aria-hidden />
            Proyectos
          </Button>
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            {proyecto.nombre} · {proyecto.cliente}{' '}
            <span className="font-medium text-muted-foreground">/ {proyecto.departamento}</span>
            {proyecto.archivado ? (
              <ChipEstado tono="neutro" className="ml-2 align-middle">
                Archivado
              </ChipEstado>
            ) : null}
          </h1>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            #{proyecto.folio}
            {proyecto.temporada === null ? '' : ` · Temporada ${proyecto.temporada}`} ·{' '}
            {proyecto.conteos.total} modelos · abierto {formatearFecha(proyecto.creadoEn)}
          </p>
          {proyecto.notas === null || proyecto.notas === '' ? null : (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileText className="size-3.5 shrink-0" aria-hidden />
              {proyecto.notas}
            </p>
          )}
        </div>
        {puedeAdministrar ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={alEditar} data-testid="editar-proyecto">
              <Pencil aria-hidden />
              Editar
            </Button>
            {proyecto.archivado ? (
              <Button
                variant="outline"
                size="sm"
                onClick={alDesarchivar}
                data-testid="activar-proyecto"
              >
                <RotateCcw aria-hidden />
                Desarchivar
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={alArchivar}
                data-testid="desactivar-proyecto"
              >
                <Trash2 className="text-destructive" aria-hidden />
                Archivar
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => setAgregarAbierto(true)}
              data-testid="agregar-desarrollo"
            >
              <Plus aria-hidden />
              Agregar modelo
            </Button>
          </div>
        ) : null}
        {/* Generar la lista de precios SIN salir del proyecto (Daniel, ago-2026): llega con cliente y
            departamento precargados y con los candidatos de ESTE proyecto. Si no hay candidatos el
            botón se deshabilita pero NO se esconde: al lado va el motivo (§Post-F9.16). */}
        {puedeGenerarLista ? (
          <div className="flex flex-col items-start gap-1 sm:w-full">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCrearListaAbierto(true)}
              disabled={cargandoParaLista || motivoSinLista !== null}
              data-testid="generar-lista-proyecto"
            >
              <ListPlus aria-hidden />
              Generar lista de precios
            </Button>
            {motivoSinLista === null ? null : (
              <p className="text-xs text-muted-foreground" data-testid="motivo-sin-lista">
                {motivoSinLista}
              </p>
            )}
          </div>
        ) : null}
      </header>

      {/* ── Rejilla de tarjetas de modelos (proto .pc-grid/.pc-card) ─────────── */}
      {consulta.isPending ? (
        <p className="text-sm text-muted-foreground">Cargando desarrollos…</p>
      ) : (
        <div className="grid shrink-0 grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3.5">
          {activos.map((d) => (
            <TarjetaDesarrollo
              key={d.id}
              desarrollo={d}
              puedeAdministrar={puedeAdministrar}
              alPrecostear={() => setAPrecostear(d)}
              alApagar={() => setAApagar(d)}
            />
          ))}
          {puedeAdministrar ? (
            <button
              type="button"
              onClick={() => setAgregarAbierto(true)}
              className="flex min-h-[158px] flex-col items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-border bg-transparent text-[13px] font-semibold text-muted-foreground transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary"
            >
              <Plus className="size-5.5" aria-hidden />
              <span>Agregar modelo</span>
            </button>
          ) : null}
          {activos.length === 0 && !puedeAdministrar ? (
            <p className="text-sm text-muted-foreground">Este proyecto aún no tiene desarrollos.</p>
          ) : null}
        </div>
      )}

      {/* ── Apagados (borrado suave): toggle + tarjetas atenuadas ───────────── */}
      {apagados.length > 0 ? (
        <div className="shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={mostrarApagados}
            onClick={() => setMostrarApagados((v) => !v)}
            data-testid="mostrar-apagados-desarrollos"
          >
            {mostrarApagados ? 'Ocultar apagados' : `Mostrar apagados (${apagados.length})`}
          </Button>
          {mostrarApagados ? (
            <div
              className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3.5"
              data-testid="desarrollos-apagados"
            >
              {apagados.map((d) => (
                <div
                  key={d.id}
                  className="rounded-[14px] border bg-card opacity-80"
                  data-testid="fila-desarrollo-apagado"
                >
                  <div className="flex items-center gap-2.5 border-b px-3.5 py-3">
                    <span className="grid size-11 shrink-0 place-items-center rounded-[10px] border bg-secondary text-faint">
                      <Shirt className="size-5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{d.codigoModelo}</div>
                      <div className="num truncate text-xs text-muted-foreground">
                        {d.descripcionModelo ?? '—'}
                      </div>
                    </div>
                    <BadgeEstado estado="apagado" />
                  </div>
                  <div className="space-y-1 px-3.5 py-3 text-xs text-muted-foreground">
                    <p>{d.motivoApagado ?? 'Sin motivo registrado'}</p>
                    <p className="num">
                      {formatearFechaHora(d.apagadoEn)}
                      {d.apagadoPorId === null ? '' : ` · por ${d.apagadoPorId}`}
                    </p>
                  </div>
                  {puedeAdministrar ? (
                    <div className="border-t bg-secondary px-3.5 py-2.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => alReactivar(d)}
                        disabled={reactivar.isPending}
                        data-testid="reactivar-desarrollo"
                      >
                        <PowerIcon aria-hidden />
                        Reactivar
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-auto shrink-0">
        <Historial creadoEn={proyecto.creadoEn} modificadoEn={proyecto.modificadoEn} />
      </div>

      {/* Diálogos del proyecto */}
      <DialogoDesarrollo
        abierto={agregarAbierto}
        alCambiarAbierto={setAgregarAbierto}
        idProyecto={proyecto.id}
      />
      <DialogoApagarDesarrollo
        abierto={aApagar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setAApagar(null);
          }
        }}
        desarrollo={aApagar ?? undefined}
      />
      <DialogoPrecosto
        abierto={aPrecostear !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setAPrecostear(null);
          }
        }}
        desarrollo={aPrecostear ?? undefined}
      />
      <DialogoCrearLista
        abierto={crearListaAbierto}
        alCambiarAbierto={setCrearListaAbierto}
        proyecto={{
          id: proyecto.id,
          folio: proyecto.folio,
          nombre: proyecto.nombre,
          idCliente: proyecto.idCliente,
          cliente: proyecto.cliente,
          idClienteDepartamento: proyecto.idClienteDepartamento,
          departamento: proyecto.departamento,
        }}
        // La lista nueva vive en Cotizaciones: se lleva ahí al usuario para seguir el flujo
        // (aprobar renglones / negociar), en vez de dejarlo en el proyecto sin señal.
        alCreada={() => {
          void navegar('/listas-precios');
        }}
      />
    </div>
  );
}

/** Tarjeta de un desarrollo activo (proto `.pc-card`): foto placeholder, códigos, estado y acciones. */
function TarjetaDesarrollo({
  desarrollo: d,
  puedeAdministrar,
  alPrecostear,
  alApagar,
}: {
  desarrollo: Desarrollo;
  puedeAdministrar: boolean;
  alPrecostear: () => void;
  alApagar: () => void;
}): React.JSX.Element {
  return (
    <div
      className="overflow-hidden rounded-[14px] border bg-card transition-shadow hover:border-primary hover:shadow-md"
      data-testid="fila-desarrollo"
    >
      {/* pc-card-top: foto + título + estado */}
      <div className="flex items-center gap-2.5 border-b px-3.5 py-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-[10px] border bg-secondary text-faint">
          <Shirt className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {d.descripcionModelo ?? d.codigoModelo}
          </div>
          <div className="num truncate text-xs text-muted-foreground">
            Nuestro {d.codigoModelo}
            {d.numeroCliente === null ? '' : ` · Nº cliente ${d.numeroCliente}`}
          </div>
          {/* El precosteo va DIRIGIDO a un cliente: la ficha lo dice (heredado del proyecto). */}
          <div className="truncate text-xs text-faint" data-testid="desarrollo-cliente">
            {d.cliente} / {d.departamento}
          </div>
        </div>
        <BadgeEstado estado={d.estado} />
      </div>
      {/* pc-card-foot: acciones (el costo/tela/maquilero viven en el precosto — diálogo) */}
      <div className="flex items-center gap-1.5 bg-secondary px-3.5 py-2.5">
        <Button
          variant="outline"
          size="sm"
          onClick={alPrecostear}
          data-testid="precostear-desarrollo"
        >
          Precosto
        </Button>
        {puedeAdministrar ? (
          <Button variant="outline" size="sm" onClick={alApagar} data-testid="apagar-desarrollo">
            Apagar
          </Button>
        ) : null}
      </div>
    </div>
  );
}
