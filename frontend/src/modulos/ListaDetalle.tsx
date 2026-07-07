import {
  ArrowLeft,
  PencilIcon,
  PlusIcon,
  PowerIcon,
  PowerOffIcon,
  SearchIcon,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { EstadoBadge, EstadoPunto } from '@/components/dominio/visuales';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Motor LISTA + DETALLE (rediseño R1: verde y denso): el armazon comun de toda
 * pantalla de catalogo. A la izquierda una lista buscable/filtrable; a la derecha
 * el detalle del registro seleccionado (hero + secciones que arma cada pantalla).
 *
 * Es generico sobre la entidad `T`: cada pantalla aporta como leer el id, el
 * titulo, la linea secundaria, el estado y el avatar de un registro, y como pintar
 * su detalle. La logica de datos (busqueda con debounce, filtros, paginacion de
 * servidor, mutaciones) sigue viviendo en la pantalla; aqui solo se PRESENTA y se
 * gobierna la seleccion. Las acciones de escritura se muestran solo si
 * `puedeAdministrar` (y el backend decide en ultima instancia, A1).
 *
 * Responsive: en escritorio ambos paneles son visibles; en movil la lista ocupa
 * todo y, al tocar un registro, se muestra el detalle con un boton "Volver" (un
 * solo arbol de DOM; la visibilidad la decide CSS + estado, sin doble render).
 */

/** Paginacion de servidor (opcional) que la pantalla controla. */
export interface PaginacionListaDetalle {
  total: number;
  pagina: number;
  totalPaginas: number;
  /** ¿Hay una peticion en curso? (deshabilita los botones). */
  ocupado: boolean;
  alAnterior: () => void;
  alSiguiente: () => void;
}

/** Props del motor lista + detalle. */
export interface PropsListaDetalle<T> {
  /** Base de los `data-testid` (p. ej. "proveedor" -> `nuevo-proveedor`, `fila-proveedor`). */
  testid: string;
  /** Encabezado de la pantalla. */
  titulo: string;
  descripcion: string;
  icono: LucideIcon;

  // ── Datos ──────────────────────────────────────────────────────────────────
  registros: readonly T[];
  cargando: boolean;
  /** Mensaje de error (si la consulta fallo). */
  error?: string | null | undefined;
  alReintentar?: (() => void) | undefined;

  obtenerId: (registro: T) => string | number;
  obtenerTitulo: (registro: T) => string;
  obtenerActivo: (registro: T) => boolean;
  /** Linea secundaria del renglon de lista (contacto, etc.). */
  obtenerSecundaria?: ((registro: T) => React.ReactNode) | undefined;
  /** Avatar del renglon de lista. */
  renderAvatarLista: (registro: T) => React.ReactNode;

  // ── Controles de la lista ────────────────────────────────────────────────────
  busqueda: string;
  alBuscar: (valor: string) => void;
  /** Slot de filtros (p. ej. selector de tipo). */
  filtros?: React.ReactNode;
  incluirInactivos: boolean;
  alAlternarInactivos: () => void;
  /**
   * Oculta el botón "Mostrar/Ocultar desactivados": para entidades SIN borrado
   * suave (p. ej. Roles, que se borran de verdad), donde el toggle no aplica.
   * Por defecto se muestra.
   */
  ocultarToggleInactivos?: boolean | undefined;
  /** Texto del estado vacio (cuando no hay coincidencias). */
  textoVacio: string;
  paginacion?: PaginacionListaDetalle | undefined;
  /**
   * Id a seleccionar al montar (o cuando cambia): para deep-links (p. ej. abrir la ficha de UN
   * modelo desde la galeria). Solo surte efecto si ese id esta entre los `registros` visibles;
   * la pantalla es responsable de asegurarlo (p. ej. inyectando el registro). `null`/`undefined`
   * = sin seleccion forzada (comportamiento por defecto: el primero). Se respeta la seleccion
   * manual posterior del usuario (solo dispara cuando el id cambia).
   */
  seleccionInicialId?: string | number | null | undefined;

  // ── Detalle / acciones ───────────────────────────────────────────────────────
  puedeAdministrar: boolean;
  alNuevo: () => void;
  textoNuevo: string;
  /**
   * Muestra el botón "Nuevo" del encabezado (además de `puedeAdministrar`). Para pantallas cuyo
   * ALTA exige un permiso ADICIONAL al de administrar (p. ej. Órdenes/captura R3: "Nueva orden"
   * abre el constructor de PEDIDO, que exige `pedidos.administrar`). Por defecto se muestra.
   */
  mostrarNuevo?: boolean | undefined;
  /**
   * Acciones EXTRA del encabezado de la pantalla (botones secundarios junto a
   * "Nuevo"): se pintan a la izquierda del botón "Nuevo", solo si
   * `puedeAdministrar`. P. ej. "Fusionar" en Colores. Opcional: las pantallas que
   * no la pasan ven el encabezado idéntico.
   */
  accionesEncabezado?: React.ReactNode;
  alEditar: (registro: T) => void;
  alDesactivar: (registro: T) => void;
  alReactivar: (registro: T) => void;
  /** Avatar grande del hero del detalle. */
  renderAvatarDetalle: (registro: T) => React.ReactNode;
  /** Meta del hero (badges bajo el nombre: tipo, etc.). */
  renderMeta?: ((registro: T) => React.ReactNode) | undefined;
  /**
   * Acciones EXTRA del hero (botones secundarios junto a Editar/Desactivar): se
   * pintan al final del grupo de acciones, solo si `puedeAdministrar`. P. ej.
   * "Cambiar contraseña" en Usuarios o "Configurar" en Empresas. Opcional: las
   * pantallas que no la pasan ven el hero idéntico.
   */
  accionesExtra?: ((registro: T) => React.ReactNode) | undefined;
  /**
   * Oculta los botones BASE del hero (Editar y Desactivar/Activar): para pantallas cuyo flujo no
   * encaja en el CRUD genérico (p. ej. Órdenes edita el encabezado en el cuerpo del detalle y
   * cancela con un diálogo que exige motivo, vía `accionesExtra`). Por defecto se muestran.
   */
  ocultarAccionesBase?: boolean | undefined;
  /** Cuerpo del detalle (secciones que arma la pantalla). */
  renderDetalle: (registro: T) => React.ReactNode;
}

export function ListaDetalle<T>(props: PropsListaDetalle<T>): React.JSX.Element {
  const {
    testid,
    titulo,
    descripcion,
    icono: Icono,
    registros,
    cargando,
    error,
    alReintentar,
    obtenerId,
    obtenerTitulo,
    obtenerActivo,
    obtenerSecundaria,
    renderAvatarLista,
    busqueda,
    alBuscar,
    filtros,
    incluirInactivos,
    alAlternarInactivos,
    ocultarToggleInactivos = false,
    textoVacio,
    paginacion,
    seleccionInicialId,
    puedeAdministrar,
    alNuevo,
    textoNuevo,
    mostrarNuevo = true,
    accionesEncabezado,
    alEditar,
    alDesactivar,
    alReactivar,
    renderAvatarDetalle,
    renderMeta,
    accionesExtra,
    ocultarAccionesBase = false,
    renderDetalle,
  } = props;

  // Seleccion interna: id del registro mostrado en el detalle.
  const [seleccionadoId, setSeleccionadoId] = useState<string | number | null>(null);
  // En movil, que panel se ve (en escritorio ambos son visibles por CSS).
  const [vistaMovil, setVistaMovil] = useState<'lista' | 'detalle'>('lista');
  // Ultimo deep-link aplicado: evita re-forzar la seleccion tras un cambio manual del usuario
  // (solo se aplica cuando `seleccionInicialId` cambia a un valor nuevo no nulo).
  const [ultimoDeepLink, setUltimoDeepLink] = useState<string | number | null>(null);

  // ¿Hay un deep-link nuevo (no aplicado aun) y ese registro esta visible? Tiene PRIORIDAD sobre
  // la seleccion derivada para que no la pise el fallback "cae al primero" (evita una carrera
  // entre efectos). La pantalla asegura que el registro este en `registros` (inyectandolo).
  const deepLinkPendiente =
    seleccionInicialId !== null &&
    seleccionInicialId !== undefined &&
    seleccionInicialId !== ultimoDeepLink &&
    registros.some((registro) => obtenerId(registro) === seleccionInicialId)
      ? seleccionInicialId
      : null;

  // Registro seleccionado derivado: el deep-link pendiente (prioridad), luego `seleccionadoId`,
  // y si ese ya no esta (se filtro/desactivo) cae al primero. `undefined` si la lista esta vacia.
  const idEfectivo = deepLinkPendiente ?? seleccionadoId;
  const seleccionado =
    registros.find((registro) => obtenerId(registro) === idEfectivo) ?? registros[0];

  // Aplica el deep-link UNA vez (marca `ultimoDeepLink`, fija la seleccion y abre el detalle en
  // movil). Al marcarlo, `deepLinkPendiente` pasa a null y la seleccion la gobierna ya el usuario.
  useEffect(() => {
    if (deepLinkPendiente === null) {
      return;
    }
    setSeleccionadoId(deepLinkPendiente);
    setVistaMovil('detalle');
    setUltimoDeepLink(deepLinkPendiente);
  }, [deepLinkPendiente]);

  // Si el seleccionado desaparece de la lista, cae al primero (o a ninguno).
  useEffect(() => {
    if (seleccionado === undefined) {
      if (seleccionadoId !== null) {
        setSeleccionadoId(null);
      }
      return;
    }
    const idActual = obtenerId(seleccionado);
    if (idActual !== seleccionadoId) {
      setSeleccionadoId(idActual);
    }
  }, [seleccionado, seleccionadoId, obtenerId]);

  function seleccionar(registro: T): void {
    setSeleccionadoId(obtenerId(registro));
    setVistaMovil('detalle');
  }

  return (
    <div className="flex h-full flex-col">
      {/* Encabezado (denso, R1). */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 lg:px-5">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"
          >
            <Icono className="size-4.5" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{titulo}</h1>
            <p className="text-xs text-muted-foreground">{descripcion}</p>
          </div>
        </div>
        {puedeAdministrar ? (
          <div className="flex flex-wrap items-center gap-2">
            {accionesEncabezado}
            {mostrarNuevo ? (
              <Button onClick={alNuevo} data-testid={`nuevo-${testid}`}>
                <PlusIcon aria-hidden />
                {textoNuevo}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Cuerpo: lista (izq) + detalle (der) */}
      <div className="grid min-h-0 flex-1 lg:grid-cols-[21rem_1fr]">
        {/* LISTA */}
        <div
          className={cn(
            'min-h-0 flex-col border-r lg:flex',
            vistaMovil === 'detalle' ? 'hidden' : 'flex',
          )}
        >
          {/* Barra de herramientas */}
          <div className="space-y-3 border-b p-3">
            <div className="relative">
              <SearchIcon
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                placeholder="Buscar por nombre…"
                className="pl-8"
                value={busqueda}
                onChange={(e) => alBuscar(e.target.value)}
                aria-label={`Buscar ${titulo.toLowerCase()} por nombre`}
                data-testid={`buscar-${testid}`}
              />
            </div>
            {filtros}
            {ocultarToggleInactivos ? null : (
              <Button
                type="button"
                variant={incluirInactivos ? 'secondary' : 'outline'}
                size="sm"
                className="w-full"
                onClick={alAlternarInactivos}
                aria-pressed={incluirInactivos}
                data-testid="mostrar-desactivados"
              >
                {incluirInactivos ? 'Ocultar desactivados' : 'Mostrar desactivados'}
              </Button>
            )}
          </div>

          {/* Renglones / estados */}
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {cargando ? (
              <ListaEsqueleto />
            ) : error ? (
              <div className="px-2 py-10 text-center">
                <p className="text-sm font-medium text-destructive">{error}</p>
                {alReintentar ? (
                  <Button variant="outline" size="sm" className="mt-3" onClick={alReintentar}>
                    Reintentar
                  </Button>
                ) : null}
              </div>
            ) : registros.length === 0 ? (
              <p className="px-2 py-10 text-center text-sm text-muted-foreground">{textoVacio}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {registros.map((registro) => {
                  const id = obtenerId(registro);
                  const activo = obtenerActivo(registro);
                  const esActual = seleccionado !== undefined && obtenerId(seleccionado) === id;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        data-testid={`fila-${testid}`}
                        data-activo={activo}
                        aria-current={esActual ? 'true' : undefined}
                        onClick={() => seleccionar(registro)}
                        className={cn(
                          // Renglon denso (R1): ~30px por fila con el avatar sm.
                          'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors',
                          esActual ? 'bg-primary-soft' : 'hover:bg-muted',
                        )}
                      >
                        {renderAvatarLista(registro)}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium">
                              {obtenerTitulo(registro)}
                            </span>
                            {activo ? null : <EstadoPunto activo={false} />}
                          </span>
                          {obtenerSecundaria ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {obtenerSecundaria(registro)}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Paginacion (servidor) */}
          {paginacion && paginacion.total > 0 ? (
            <div className="flex items-center justify-between gap-2 border-t p-2.5 text-xs">
              <span className="num text-muted-foreground" data-testid="resumen-paginacion">
                {paginacion.total} · pág. {paginacion.pagina}/{paginacion.totalPaginas}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={paginacion.alAnterior}
                  disabled={paginacion.pagina <= 1 || paginacion.ocupado}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={paginacion.alSiguiente}
                  disabled={paginacion.pagina >= paginacion.totalPaginas || paginacion.ocupado}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {/* DETALLE */}
        <div
          data-testid={`detalle-${testid}`}
          className={cn(
            'min-h-0 flex-col overflow-y-auto lg:flex',
            vistaMovil === 'detalle' ? 'flex' : 'hidden',
          )}
        >
          {seleccionado === undefined ? (
            <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-muted-foreground">
              Selecciona un registro de la lista para ver su detalle.
            </div>
          ) : (
            <Detalle
              testid={testid}
              registro={seleccionado}
              activo={obtenerActivo(seleccionado)}
              titulo={obtenerTitulo(seleccionado)}
              puedeAdministrar={puedeAdministrar}
              alVolver={() => setVistaMovil('lista')}
              alEditar={alEditar}
              alDesactivar={alDesactivar}
              alReactivar={alReactivar}
              renderAvatarDetalle={renderAvatarDetalle}
              renderMeta={renderMeta}
              accionesExtra={accionesExtra}
              ocultarAccionesBase={ocultarAccionesBase}
              renderDetalle={renderDetalle}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Cuerpo del detalle (hero + acciones + secciones). Aislado para tipar `T`. */
function Detalle<T>({
  testid,
  registro,
  activo,
  titulo,
  puedeAdministrar,
  alVolver,
  alEditar,
  alDesactivar,
  alReactivar,
  renderAvatarDetalle,
  renderMeta,
  accionesExtra,
  ocultarAccionesBase = false,
  renderDetalle,
}: {
  testid: string;
  registro: T;
  activo: boolean;
  titulo: string;
  puedeAdministrar: boolean;
  alVolver: () => void;
  alEditar: (registro: T) => void;
  alDesactivar: (registro: T) => void;
  alReactivar: (registro: T) => void;
  renderAvatarDetalle: (registro: T) => React.ReactNode;
  renderMeta?: ((registro: T) => React.ReactNode) | undefined;
  accionesExtra?: ((registro: T) => React.ReactNode) | undefined;
  ocultarAccionesBase?: boolean | undefined;
  renderDetalle: (registro: T) => React.ReactNode;
}): React.JSX.Element {
  return (
    <>
      {/* Volver (solo movil). */}
      <div className="border-b p-3 lg:hidden">
        <Button variant="ghost" size="sm" onClick={alVolver}>
          <ArrowLeft aria-hidden />
          Volver
        </Button>
      </div>

      {/* Hero (denso, R1). */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b p-4 lg:p-5">
        <div className="flex min-w-0 items-center gap-3.5">
          {renderAvatarDetalle(registro)}
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight break-words">{titulo}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <EstadoBadge activo={activo} />
              {renderMeta ? renderMeta(registro) : null}
            </div>
          </div>
        </div>
        {puedeAdministrar ? (
          <div className="flex flex-wrap items-center gap-2">
            {ocultarAccionesBase ? null : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => alEditar(registro)}
                  data-testid={`editar-${testid}`}
                >
                  <PencilIcon aria-hidden />
                  Editar
                </Button>
                {activo ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => alDesactivar(registro)}
                    data-testid={`desactivar-${testid}`}
                  >
                    <PowerOffIcon aria-hidden />
                    Desactivar
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => alReactivar(registro)}
                    data-testid={`activar-${testid}`}
                  >
                    <PowerIcon aria-hidden />
                    Activar
                  </Button>
                )}
              </>
            )}
            {accionesExtra ? accionesExtra(registro) : null}
          </div>
        ) : null}
      </div>

      {/* Cuerpo (secciones que arma la pantalla) */}
      <div className="space-y-5 p-4 lg:p-5">{renderDetalle(registro)}</div>
    </>
  );
}

/** Renglones de carga (skeleton) mientras llega la primera pagina. */
function ListaEsqueleto(): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="flex items-center gap-2.5 px-2.5 py-1.5">
          <Skeleton className="size-8 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </li>
      ))}
    </ul>
  );
}
