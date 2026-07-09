import { Lock, PencilIcon, SaveIcon, ShieldCheck, Trash2Icon, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  useAsignarPermisos,
  useEliminarRol,
  usePermisosCatalogo,
  useRoles,
  type CatalogoPermisos,
} from '@/api/roles';
import type { Rol } from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { CajonDetalle } from '@/components/dominio/CajonDetalle';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Avatar, TipoBadge } from '@/components/dominio/visuales';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CampoDetalle, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoRol } from './DialogoRol';

/**
 * Pantalla de Roles y permisos (administración, RBAC A4) — re-vestida R9 a TABLA-FIRST + CAJÓN
 * (coherente con Usuarios/Clientes; el proto llega aquí por el atajo «Roles» de `vUsuarios`). La tabla
 * densa lista los roles (Rol · Usuarios · Sistema); al hacer clic en un renglón se abre un cajón ANCHO
 * con los datos del rol y el ÁRBOL DE PERMISOS agrupado por módulo (checkboxes = lo que queda,
 * semántica de REEMPLAZO) + botón Guardar. Alta/edición/eliminación en diálogos.
 *
 * Un rol de SISTEMA no se renombra ni se elimina (el backend es la autoridad, A1): la UI deshabilita
 * esas acciones con su razón, pero SÍ permite editar sus permisos. Los roles con usuarios asignados
 * tampoco se eliminan. Todo va gobernado por `roles.administrar` (no existe `.ver`).
 */
export function RolesPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('roles.administrar');

  const consulta = useRoles();
  const catalogo = usePermisosCatalogo();
  const eliminar = useEliminarRol();

  const [textoBusqueda, setTextoBusqueda] = useState('');
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [enEdicion, setEnEdicion] = useState<Rol | undefined>(undefined);
  const [aEliminar, setAEliminar] = useState<Rol | null>(null);
  // El cajón guarda el ID; el rol mostrado se DERIVA de la lista viva.
  const [seleccionId, setSeleccionId] = useState<number | null>(null);

  // Los roles son pocos: se filtran en cliente por nombre/descripción (sin paginación).
  const registros = useMemo(() => {
    const roles = consulta.data ?? [];
    const q = textoBusqueda.trim().toLowerCase();
    if (q.length === 0) {
      return roles;
    }
    return roles.filter(
      (r) => r.nombre.toLowerCase().includes(q) || r.descripcion.toLowerCase().includes(q),
    );
  }, [consulta.data, textoBusqueda]);

  function abrirAlta(): void {
    setEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(rol: Rol): void {
    setEnEdicion(rol);
    setDialogoAbierto(true);
  }

  function confirmarEliminar(): void {
    if (aEliminar === null) {
      return;
    }
    const objetivo = aEliminar;
    eliminar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Rol "${objetivo.nombre}" eliminado.`);
        setAEliminar(null);
        setSeleccionId(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  const seleccion = registros.find((r) => r.id === seleccionId) ?? null;
  const total = registros.length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 md:p-5">
      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">Roles y permisos</h1>
          <p className="truncate text-xs text-muted-foreground">
            Roles del sistema y los permisos que otorga cada uno
          </p>
        </div>
        {puedeAdministrar ? (
          <Button size="sm" onClick={abrirAlta} data-testid="nuevo-rol">
            <ShieldCheck aria-hidden />
            Nuevo rol
          </Button>
        ) : null}
      </header>

      {/* ── Card: filtro + tabla + totales ──────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          <Input
            type="search"
            className="h-8 w-52 text-sm"
            placeholder="Buscar rol…"
            value={textoBusqueda}
            onChange={(e) => setTextoBusqueda(e.target.value)}
            data-testid="buscar-rol"
          />
          <div className="ml-auto">
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {total.toLocaleString('es-MX')} roles
            </span>
          </div>
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
            <p className="p-6 text-sm text-muted-foreground">Cargando roles…</p>
          ) : registros.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground" data-testid="rol-vacio">
              No hay roles que coincidan con la búsqueda.
            </p>
          ) : (
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Rol</TablaDensaHead>
                  <TablaDensaHead>Usuarios</TablaDensaHead>
                  <TablaDensaHead>Tipo</TablaDensaHead>
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {registros.map((r) => (
                  <TablaDensaFila
                    key={r.id}
                    seleccionada={seleccion?.id === r.id}
                    className="cursor-pointer"
                    onClick={() => setSeleccionId(r.id)}
                    data-testid="fila-rol"
                  >
                    <TablaDensaCelda>
                      <div className="flex items-center gap-2">
                        <Avatar nombre={r.nombre} tono="pt" tamano="sm">
                          <ShieldCheck className="size-4" aria-hidden />
                        </Avatar>
                        <div className="min-w-0">
                          <div className="truncate font-medium">{r.nombre}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {r.descripcion.length > 0 ? r.descripcion : 'Sin descripción'}
                          </div>
                        </div>
                      </div>
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      <Badge variant="secondary">
                        <Users className="size-3.5" aria-hidden />
                        {r.totalUsuarios}
                      </Badge>
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      {r.esSistema ? (
                        <TipoBadge tono="pt">Sistema</TipoBadge>
                      ) : (
                        <span className="text-muted-foreground">Propio</span>
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
            <span className="text-[10.5px] font-medium text-faint uppercase">Roles</span>
            <b className="num">{total.toLocaleString('es-MX')}</b>
          </span>
        </div>
      </div>

      {/* ── Cajón de detalle del rol (ancho: el árbol de permisos necesita espacio) ── */}
      <CajonDetalle
        className="sm:max-w-2xl lg:max-w-3xl"
        abierto={seleccion !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) setSeleccionId(null);
        }}
        titulo={
          seleccion !== null ? (
            <span className="flex flex-wrap items-center gap-2">
              {seleccion.nombre}
              {seleccion.esSistema ? <TipoBadge tono="pt">Sistema</TipoBadge> : null}
              <Badge variant="secondary">
                <Users className="size-3.5" aria-hidden />
                {seleccion.totalUsuarios} usuario{seleccion.totalUsuarios === 1 ? '' : 's'}
              </Badge>
            </span>
          ) : (
            ''
          )
        }
        acciones={
          seleccion !== null && puedeAdministrar ? (
            <AccionesRol rol={seleccion} alEditar={abrirEdicion} alEliminar={setAEliminar} />
          ) : undefined
        }
      >
        {seleccion !== null ? (
          <div data-testid="detalle-rol">
            <SeccionDetalle titulo="Datos del rol">
              <RejillaCampos>
                <CampoDetalle icono={ShieldCheck} etiqueta="Nombre">
                  {seleccion.nombre}
                </CampoDetalle>
                <CampoDetalle icono={Users} etiqueta="Usuarios con este rol">
                  {seleccion.totalUsuarios}
                </CampoDetalle>
                <CampoDetalle icono={Lock} etiqueta="Descripción" anchoCompleto>
                  {seleccion.descripcion.length > 0 ? seleccion.descripcion : 'Sin descripción'}
                </CampoDetalle>
              </RejillaCampos>
            </SeccionDetalle>

            {/* El editor se remonta al cambiar de rol (key) → arranca del set del rol. */}
            <EditorPermisos
              key={seleccion.id}
              rol={seleccion}
              catalogo={catalogo.data}
              cargandoCatalogo={catalogo.isPending}
              errorCatalogo={catalogo.isError ? catalogo.error.message : null}
              puedeAdministrar={puedeAdministrar}
            />
          </div>
        ) : null}
      </CajonDetalle>

      <DialogoRol abierto={dialogoAbierto} alCambiarAbierto={setDialogoAbierto} rol={enEdicion} />
      <DialogoConfirmacion
        abierto={aEliminar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setAEliminar(null);
          }
        }}
        titulo="Eliminar rol"
        descripcion={
          <>
            ¿Seguro que quieres eliminar el rol{' '}
            <span className="font-medium text-foreground">{aEliminar?.nombre}</span>? Esta acción no
            se puede deshacer.
          </>
        }
        textoConfirmar="Eliminar"
        variante="destructive"
        procesando={eliminar.isPending}
        alConfirmar={confirmarEliminar}
      />
    </div>
  );
}

/**
 * Acciones del hero de un rol: Editar y Eliminar. Un rol de SISTEMA no se
 * renombra ni se elimina; un rol con usuarios asignados tampoco se elimina — esos
 * botones se muestran deshabilitados con su razón (el backend es la autoridad, A1).
 */
function AccionesRol({
  rol,
  alEditar,
  alEliminar,
}: {
  rol: Rol;
  alEditar: (r: Rol) => void;
  alEliminar: (r: Rol) => void;
}): React.JSX.Element {
  const tieneUsuarios = rol.totalUsuarios > 0;
  const razonNoEliminar = rol.esSistema
    ? 'Los roles de sistema no se pueden eliminar.'
    : tieneUsuarios
      ? 'Reasigna a sus usuarios antes de eliminarlo.'
      : undefined;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => alEditar(rol)}
        title={
          rol.esSistema
            ? 'Los roles de sistema no se renombran (sí puedes editar su descripción).'
            : undefined
        }
        data-testid="editar-rol"
      >
        <PencilIcon aria-hidden />
        Editar
      </Button>
      <Button
        variant="destructive"
        size="sm"
        disabled={rol.esSistema || tieneUsuarios}
        title={razonNoEliminar}
        onClick={() => alEliminar(rol)}
        data-testid="eliminar-rol"
      >
        <Trash2Icon aria-hidden />
        Eliminar
      </Button>
    </>
  );
}

/**
 * Árbol de permisos de un rol agrupado por módulo (checkboxes). Lo marcado es lo
 * que QUEDA (semántica de reemplazo): al Guardar, se envía el conjunto completo a
 * `asignarPermisos`. Mantiene su propio estado local; el padre lo remonta (key)
 * al cambiar de rol para partir siempre del set del rol seleccionado.
 */
function EditorPermisos({
  rol,
  catalogo,
  cargandoCatalogo,
  errorCatalogo,
  puedeAdministrar,
}: {
  rol: Rol;
  catalogo: CatalogoPermisos | undefined;
  cargandoCatalogo: boolean;
  errorCatalogo: string | null;
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const asignar = useAsignarPermisos();
  const [seleccion, setSeleccion] = useState<Set<string>>(() => new Set(rol.clavesPermisos));

  // ¿Cambió el set respecto a lo que tiene el rol? (habilita Guardar).
  const sucio = useMemo(() => {
    const original = rol.clavesPermisos;
    if (original.length !== seleccion.size) {
      return true;
    }
    return original.some((clave) => !seleccion.has(clave));
  }, [rol.clavesPermisos, seleccion]);

  function alternar(clave: string): void {
    setSeleccion((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(clave)) {
        siguiente.delete(clave);
      } else {
        siguiente.add(clave);
      }
      return siguiente;
    });
  }

  function guardar(): void {
    asignar.mutate(
      { id: rol.id, clavesPermisos: [...seleccion] },
      {
        onSuccess: () => toast.success(`Permisos de "${rol.nombre}" actualizados.`),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <SeccionDetalle titulo="Permisos" icono={ShieldCheck}>
      {cargandoCatalogo ? (
        <p className="text-sm text-muted-foreground">Cargando catálogo de permisos…</p>
      ) : errorCatalogo !== null ? (
        <p className="text-sm text-destructive">{errorCatalogo}</p>
      ) : catalogo === undefined || catalogo.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay permisos en el catálogo.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Marca los permisos que otorga este rol. Lo marcado es lo que queda (reemplaza al
            conjunto actual).
          </p>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {catalogo.map((grupo) => {
              const marcadosModulo = grupo.permisos.filter((p) => seleccion.has(p.clave)).length;
              return (
                <fieldset
                  key={grupo.modulo}
                  className="rounded-xl ring-1 ring-foreground/10 p-3"
                  data-testid="grupo-permisos"
                >
                  <legend className="flex items-center gap-2 px-1 text-sm font-medium">
                    {grupo.etiqueta}
                    <span className="text-xs text-muted-foreground">
                      {marcadosModulo}/{grupo.permisos.length}
                    </span>
                  </legend>
                  <ul className="mt-1 space-y-1.5">
                    {grupo.permisos.map((permiso) => (
                      <li key={permiso.clave}>
                        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-1.5 py-1 hover:bg-muted">
                          <input
                            type="checkbox"
                            className="mt-0.5 size-4 shrink-0 accent-primary"
                            checked={seleccion.has(permiso.clave)}
                            disabled={!puedeAdministrar || asignar.isPending}
                            onChange={() => alternar(permiso.clave)}
                            data-testid="permiso-checkbox"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm leading-tight">
                              {permiso.descripcion}
                            </span>
                            <span className="block font-mono text-[11px] text-muted-foreground">
                              {permiso.clave}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              );
            })}
          </div>

          {puedeAdministrar ? (
            <div className="flex justify-end pt-1">
              <Button
                size="sm"
                onClick={guardar}
                disabled={!sucio || asignar.isPending}
                data-testid="guardar-permisos"
              >
                <SaveIcon aria-hidden />
                Guardar permisos
              </Button>
            </div>
          ) : null}
        </>
      )}
    </SeccionDetalle>
  );
}
