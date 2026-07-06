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
import { Avatar, TipoBadge } from '@/components/dominio/visuales';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ListaDetalle } from '@/modulos/ListaDetalle';
import { CampoDetalle, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoRol } from './DialogoRol';

/**
 * Pantalla de Roles y permisos (administración, RBAC A4) sobre el motor LISTA +
 * DETALLE. La lista muestra los roles (nombre, descripción, badge "Sistema" y
 * conteo de usuarios); el detalle presenta el árbol de permisos agrupado por
 * módulo (checkboxes = lo que queda, semántica de REEMPLAZO) con un botón
 * Guardar, más los diálogos de alta/edición/eliminación.
 *
 * Un rol de SISTEMA no se renombra ni se elimina (el backend es la autoridad,
 * A1): la UI deshabilita esas acciones con su razón, pero SÍ permite editar sus
 * permisos. Los roles con usuarios asignados tampoco se eliminan. Todo va
 * gobernado por `roles.administrar` (no existe `.ver`): sin él, ni la pantalla se
 * alcanza ni hay acciones.
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
      },
      onError: (error) => toast.error(error.message),
    });
  }

  return (
    <>
      <ListaDetalle<Rol>
        testid="rol"
        titulo="Roles y permisos"
        descripcion="Roles del sistema y los permisos que otorga cada uno."
        icono={ShieldCheck}
        registros={registros}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(r) => r.id}
        obtenerTitulo={(r) => r.nombre}
        // Los roles no tienen estado de borrado suave: siempre "vigentes".
        obtenerActivo={() => true}
        obtenerSecundaria={(r) => (r.descripcion.length > 0 ? r.descripcion : 'Sin descripción')}
        renderAvatarLista={(r) => (
          <Avatar nombre={r.nombre} tono="pt" tamano="sm">
            <ShieldCheck className="size-4" aria-hidden />
          </Avatar>
        )}
        busqueda={textoBusqueda}
        alBuscar={setTextoBusqueda}
        // Los roles se borran de verdad (sin borrado suave): no hay estado
        // "desactivado" que filtrar, así que se oculta ese toggle.
        incluirInactivos={false}
        alAlternarInactivos={() => undefined}
        ocultarToggleInactivos
        textoVacio="No hay roles que coincidan con la búsqueda."
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nuevo rol"
        // El CRUD de roles es especial (sistema no renombra/elimina, con usuarios no
        // elimina): se ocultan las acciones base y se arman a medida.
        ocultarAccionesBase
        alEditar={abrirEdicion}
        alDesactivar={() => undefined}
        alReactivar={() => undefined}
        accionesExtra={(r) => (
          <AccionesRol rol={r} alEditar={abrirEdicion} alEliminar={setAEliminar} />
        )}
        renderAvatarDetalle={(r) => (
          <Avatar nombre={r.nombre} tono="pt" tamano="lg">
            <ShieldCheck className="size-7" aria-hidden />
          </Avatar>
        )}
        renderMeta={(r) => (
          <>
            {r.esSistema ? <TipoBadge tono="pt">Sistema</TipoBadge> : null}
            <Badge variant="secondary">
              <Users className="size-3.5" aria-hidden />
              {r.totalUsuarios} usuario{r.totalUsuarios === 1 ? '' : 's'}
            </Badge>
          </>
        )}
        renderDetalle={(r) => (
          <>
            <SeccionDetalle titulo="Datos del rol">
              <RejillaCampos>
                <CampoDetalle icono={ShieldCheck} etiqueta="Nombre">
                  {r.nombre}
                </CampoDetalle>
                <CampoDetalle icono={Users} etiqueta="Usuarios con este rol">
                  {r.totalUsuarios}
                </CampoDetalle>
                <CampoDetalle icono={Lock} etiqueta="Descripción" anchoCompleto>
                  {r.descripcion.length > 0 ? r.descripcion : 'Sin descripción'}
                </CampoDetalle>
              </RejillaCampos>
            </SeccionDetalle>

            {/* El editor se remonta al cambiar de rol (key) → arranca del set del rol. */}
            <EditorPermisos
              key={r.id}
              rol={r}
              catalogo={catalogo.data}
              cargandoCatalogo={catalogo.isPending}
              errorCatalogo={catalogo.isError ? catalogo.error.message : null}
              puedeAdministrar={puedeAdministrar}
            />
          </>
        )}
      />

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
    </>
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
