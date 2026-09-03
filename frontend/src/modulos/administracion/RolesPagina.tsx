import {
  AlertTriangle,
  Lock,
  PencilIcon,
  SaveIcon,
  ShieldCheck,
  Trash2Icon,
  Users,
} from 'lucide-react';
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
 * esas acciones con su razón, pero SÍ permite editar sus permisos — con un AVISO de que el seed se
 * los va a restablecer en el siguiente deploy sembrado (ver `EditorPermisos`). Los roles con
 * usuarios asignados tampoco se eliminan. Todo va gobernado por `roles.administrar` (no existe
 * `.ver`).
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
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 md:p-5 lg:overflow-visible">
      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Roles y permisos
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
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
      <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border bg-card lg:min-h-0 lg:flex-1 lg:shrink">
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
            <span className="text-[12px] text-faint">{total.toLocaleString('es-MX')} roles</span>
          </div>
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
            <p className="p-6 text-sm text-muted-foreground">Cargando roles…</p>
          ) : registros.length === 0 ? (
            <p
              className="m-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
              data-testid="rol-vacio"
            >
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
                      <div className="flex max-w-[58vw] items-center gap-2 lg:max-w-none">
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

      {/* ── Cajón de detalle del rol (máximo: el árbol de permisos necesita todo el ancho) ── */}
      <CajonDetalle
        ancho="maximo"
        abierto={seleccionId !== null}
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
 *
 * ⚠️ Y AVISA cuando el rol es de SISTEMA: esos 9 los re-sincroniza el seed con su definición de
 * `prisma/seed.ts` en cada arranque con `SEED_ON_START=true` (`deleteMany` de lo que sobre +
 * `createMany` de lo que falte), así que un permiso palomeado a mano ahí se borra CALLADO en el
 * siguiente deploy. La pantalla no lo bloquea —guardar sigue sirviendo para probar algo en el
 * momento—, pero deja de mentir sobre cuánto dura. Para un permiso permanente: un rol propio.
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

          {/* ⚠️ Un perfil de SISTEMA se re-sincroniza con `definirRoles()` del seed en cada
              arranque con `SEED_ON_START=true`: lo que se palomee aquí se pierde CALLADO en el
              siguiente deploy. La pantalla no puede impedirlo (el backend sí lo permite, y hace
              bien: sirve para probar), pero sí puede decirlo antes de que alguien crea que quedó.

              🔴 Y TIENE QUE DECIR LA EXCEPCIÓN, que es donde durar es peligroso: `sembrarRoles`
              NUNCA revoca `usuarios.administrar` ni `roles.administrar` (guard anti-lockout, ver
              `prisma/seed.ts` → `deleteMany … notIn: [...idsPermisos, ...idsGobierno]`). O sea que
              el escenario que el propio seed describe —darle «administrar roles» a Gerencial desde
              ESTA pantalla— se queda para SIEMPRE. Un aviso que dijera «todo se borra» mentiría
              justo en los dos permisos que más pesan (y `roles.administrar` es además el marcador
              de «es admin» de la Ruta Crítica). */}
          {rol.esSistema ? (
            <p
              // `bg-warn-soft` + texto normal es el patrón de aviso del rediseño (ChipEstado,
              // EditorMedidasAvio). OJO: `text-warn-foreground` NO existe como token en index.css
              // —sólo hay `--color-warn` y `--color-warn-soft`—, así que esa clase no pinta nada.
              className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-[12.5px]"
              role="alert"
              data-testid="aviso-rol-sistema"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
              <span>
                <b>«{rol.nombre}» es un perfil de sistema.</b> Lo que marques aquí puede perderse:
                estos perfiles vuelven a su definición de fábrica cada vez que se actualiza el
                programa — <b>salvo administrar usuarios y administrar roles</b>, que el sistema
                nunca retira de un perfil. Si el cambio debe ser permanente, crea un perfil propio,
                dale los permisos que necesite y asígnaselo a la persona.
              </span>
            </p>
          ) : null}

          {/* Rejilla FLUIDA al ancho del cajón (auto-fit): 1 columna en móvil, 2-3 en
              amplio/máximo. `min(100%,…)` evita que la columna mínima desborde cuando el
              cajón es más angosto que 15rem — así las secciones nunca se enciman. */}
          <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))]">
            {catalogo.map((grupo) => {
              const marcadosModulo = grupo.permisos.filter((p) => seleccion.has(p.clave)).length;
              return (
                <fieldset
                  key={grupo.modulo}
                  // `min-w-0`: un <fieldset> trae `min-inline-size: min-content` de fábrica y, sin
                  // esto, se niega a encoger a su columna del grid y DESBORDA sobre la de al lado
                  // (era el encimado de las secciones de Finanzas).
                  className="min-w-0 rounded-xl ring-1 ring-foreground/10 p-3"
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
                            <span className="block font-mono text-[11px] break-words text-muted-foreground">
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
