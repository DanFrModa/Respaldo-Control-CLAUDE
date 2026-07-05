import {
  Building2,
  CalendarRange,
  ClipboardList,
  FileText,
  Layers,
  PlusIcon,
  PowerIcon,
  Shirt,
  UserRound,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useClientes, useDepartamentosCliente } from '@/api/clientes';
import { useReactivarDesarrollo, type Desarrollo, type EstadoDesarrollo } from '@/api/desarrollos';
import {
  useArchivarProyecto,
  useDesarchivarProyecto,
  useProyecto,
  useProyectos,
} from '@/api/proyectos';
import type { Proyecto, ProyectosQuery } from '@/api/proyectos';
import { useTemporadas } from '@/api/temporadas';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { Avatar } from '@/components/dominio/visuales';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SelectNativo } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatearFechaHora } from '@/lib/formato';
import { useDebounce } from '@/lib/useDebounce';
import { ListaDetalle, type PaginacionListaDetalle } from '@/modulos/ListaDetalle';
import { CampoDetalle, Historial, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoApagarDesarrollo } from './DialogoApagarDesarrollo';
import { DialogoDesarrollo } from './DialogoDesarrollo';
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

/** Variante de badge por estado derivado. */
const VARIANTE_ESTADO: Record<EstadoDesarrollo, 'default' | 'secondary' | 'outline'> = {
  'en-desarrollo': 'secondary',
  cotizado: 'default',
  'en-lista': 'default',
  'ligado-produccion': 'default',
  apagado: 'outline',
};

/** Badge del estado derivado de un desarrollo. */
function BadgeEstado({ estado }: { estado: EstadoDesarrollo }): React.JSX.Element {
  return <Badge variant={VARIANTE_ESTADO[estado]}>{ETIQUETA_ESTADO[estado]}</Badge>;
}

/**
 * Pantalla de Desarrollo (F8-E2) — proyectos por Cliente+Departamento sobre el motor LISTA +
 * DETALLE (teal). La lista tiene búsqueda (folio o nombre), filtros por cliente/departamento/
 * temporada, toggle de archivados y paginación de servidor; el detalle muestra el encabezado, los
 * conteos y la tabla de DESARROLLOS con su estado DERIVADO, más agregar/apagar/reactivar.
 *
 * `desarrollo.ver` gobierna el acceso; `desarrollo.administrar` las acciones (la decisión real la
 * toma el backend, A1).
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

  const clientes = useClientes(QUERY_CATALOGO);
  const temporadas = useTemporadas(QUERY_CATALOGO);
  const departamentosFiltro = useDepartamentosCliente(
    idClienteFiltro === '' ? undefined : Number(idClienteFiltro),
  );

  const query: ProyectosQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'folio',
    direccion: 'desc',
    incluirArchivados: incluirArchivados ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(idClienteFiltro === '' ? {} : { idCliente: Number(idClienteFiltro) }),
    ...(idDepartamentoFiltro === '' ? {} : { idClienteDepartamento: Number(idDepartamentoFiltro) }),
    ...(idTemporadaFiltro === '' ? {} : { idTemporada: Number(idTemporadaFiltro) }),
  };

  const consulta = useProyectos(query);
  const archivar = useArchivarProyecto();
  const desarchivar = useDesarchivarProyecto();

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
  function alAlternarArchivados(): void {
    setIncluirArchivados((v) => !v);
    setPagina(1);
  }
  function cambiarClienteFiltro(valor: string): void {
    setIdClienteFiltro(valor);
    setIdDepartamentoFiltro('');
    setPagina(1);
  }

  const datos = consulta.data;
  const totalPaginas = datos?.totalPaginas ?? 0;
  const paginacion: PaginacionListaDetalle | undefined = datos
    ? {
        total: datos.total,
        pagina: datos.pagina,
        totalPaginas,
        ocupado: consulta.isFetching,
        alAnterior: () => setPagina((p) => Math.max(1, p - 1)),
        alSiguiente: () => setPagina((p) => Math.min(totalPaginas, p + 1)),
      }
    : undefined;

  const filtros = (
    <div className="space-y-2" data-testid="filtros-desarrollo">
      <SelectNativo
        aria-label="Filtrar por cliente"
        value={idClienteFiltro}
        onChange={(e) => cambiarClienteFiltro(e.target.value)}
      >
        <option value="">Todos los clientes</option>
        {(clientes.data?.datos ?? []).map((c) => (
          <option key={c.id} value={String(c.id)}>
            {c.nombre}
          </option>
        ))}
      </SelectNativo>
      <SelectNativo
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
    </div>
  );

  return (
    <>
      <ListaDetalle<Proyecto>
        testid="proyecto"
        titulo="Desarrollo"
        descripcion="Proyectos de desarrollo por cliente y departamento, y sus desarrollos por modelo."
        icono={ClipboardList}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(p) => p.id}
        obtenerTitulo={(p) => `${p.nombre} · #${p.folio}`}
        // "activo" = no archivado (el archivo es el "borrado" suave del proyecto).
        obtenerActivo={(p) => !p.archivado}
        obtenerSecundaria={(p) =>
          `${p.cliente} · ${p.departamento} · ${p.conteos.total} desarrollos`
        }
        renderAvatarLista={(p) => <Avatar nombre={p.nombre} tono="pt" tamano="sm" />}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        filtros={filtros}
        incluirInactivos={incluirArchivados}
        alAlternarInactivos={alAlternarArchivados}
        textoVacio="No hay proyectos que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nuevo proyecto"
        alEditar={abrirEdicion}
        // Desactivar = archivar (suave); reactivar = desarchivar.
        alDesactivar={setAArchivar}
        alReactivar={reactivarProyecto}
        renderAvatarDetalle={(p) => <Avatar nombre={p.nombre} tono="pt" tamano="lg" />}
        renderMeta={(p) => (p.archivado ? <Badge variant="outline">Archivado</Badge> : null)}
        renderDetalle={(p) => <DetalleProyecto proyecto={p} puedeAdministrar={puedeAdministrar} />}
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

/** Panel de DETALLE de un proyecto: encabezado, conteos y la tabla de desarrollos. */
function DetalleProyecto({
  proyecto,
  puedeAdministrar,
}: {
  proyecto: Proyecto;
  puedeAdministrar: boolean;
}): React.JSX.Element {
  // Trae el detalle completo (con sus desarrollos), como PanelPedidosReales.
  const consulta = useProyecto(proyecto.id);
  const reactivar = useReactivarDesarrollo();

  const [agregarAbierto, setAgregarAbierto] = useState(false);
  const [aApagar, setAApagar] = useState<Desarrollo | null>(null);
  const [mostrarApagados, setMostrarApagados] = useState(false);

  const detalle = consulta.data;
  const desarrollos = detalle?.desarrollos ?? [];
  const activos = desarrollos.filter((d) => !d.apagado);
  const apagados = desarrollos.filter((d) => d.apagado);

  function alReactivar(desarrollo: Desarrollo): void {
    reactivar.mutate(desarrollo.id, {
      onSuccess: () => toast.success(`Desarrollo "${desarrollo.codigoModelo}" reactivado.`),
      onError: (error) => toast.error(error.message),
    });
  }

  return (
    <>
      <SeccionDetalle titulo="Datos del proyecto" icono={ClipboardList}>
        <RejillaCampos>
          <CampoDetalle icono={UserRound} etiqueta="Cliente">
            {proyecto.cliente}
          </CampoDetalle>
          <CampoDetalle icono={Building2} etiqueta="Departamento">
            {proyecto.departamento}
          </CampoDetalle>
          <CampoDetalle icono={CalendarRange} etiqueta="Temporada">
            {proyecto.temporada ?? '—'}
          </CampoDetalle>
          <CampoDetalle icono={Layers} etiqueta="Desarrollos">
            {proyecto.conteos.total} en total · {proyecto.conteos.enDesarrollo} en desarrollo ·{' '}
            {proyecto.conteos.apagado} apagados
          </CampoDetalle>
          {proyecto.notas ? (
            <CampoDetalle icono={FileText} etiqueta="Notas" anchoCompleto>
              {proyecto.notas}
            </CampoDetalle>
          ) : null}
        </RejillaCampos>
      </SeccionDetalle>

      <SeccionDetalle titulo="Desarrollos" icono={Shirt}>
        {puedeAdministrar ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              size="sm"
              onClick={() => setAgregarAbierto(true)}
              data-testid="agregar-desarrollo"
            >
              <PlusIcon aria-hidden />
              Agregar desarrollo
            </Button>
            {apagados.length > 0 ? (
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
            ) : null}
          </div>
        ) : null}

        {consulta.isPending ? (
          <p className="text-sm text-muted-foreground">Cargando desarrollos…</p>
        ) : activos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Este proyecto aún no tiene desarrollos.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Modelo (nuestro nº)</TableHead>
                  <TableHead>Nº del cliente</TableHead>
                  <TableHead>Estado</TableHead>
                  {puedeAdministrar ? <TableHead className="text-right">Acciones</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {activos.map((d) => (
                  <TableRow key={d.id} data-testid="fila-desarrollo">
                    <TableCell>
                      <span className="font-medium">{d.codigoModelo}</span>
                      {d.descripcionModelo ? (
                        <span className="block text-xs text-muted-foreground">
                          {d.descripcionModelo}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>{d.numeroCliente ?? '—'}</TableCell>
                    <TableCell>
                      <BadgeEstado estado={d.estado} />
                    </TableCell>
                    {puedeAdministrar ? (
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setAApagar(d)}
                          data-testid="apagar-desarrollo"
                        >
                          Apagar
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {mostrarApagados && apagados.length > 0 ? (
          <div className="overflow-x-auto" data-testid="desarrollos-apagados">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Apagados</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Modelo</TableHead>
                  <TableHead>Motivo / cuándo</TableHead>
                  {puedeAdministrar ? <TableHead className="text-right">Acciones</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {apagados.map((d) => (
                  <TableRow key={d.id} data-testid="fila-desarrollo-apagado">
                    <TableCell>
                      <span className="font-medium">{d.codigoModelo}</span>
                      <BadgeEstado estado="apagado" />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <span className="block">{d.motivoApagado ?? '—'}</span>
                      <span className="block">
                        {formatearFechaHora(d.apagadoEn)}
                        {d.apagadoPorId ? ` · por ${d.apagadoPorId}` : ''}
                      </span>
                    </TableCell>
                    {puedeAdministrar ? (
                      <TableCell className="text-right">
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
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </SeccionDetalle>

      <Historial creadoEn={proyecto.creadoEn} modificadoEn={proyecto.modificadoEn} />

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
    </>
  );
}
