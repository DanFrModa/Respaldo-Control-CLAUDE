import {
  AtSign,
  ChevronLeft,
  ChevronRight,
  Info,
  KeyRoundIcon,
  LockOpenIcon,
  Mail,
  Pencil,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import type { Usuario, UsuariosQuery } from '@/api/tipos';
import {
  useDesactivarUsuario,
  useDesbloquearUsuario,
  useReactivarUsuario,
  useUsuarios,
} from '@/api/usuarios';
import { useRoles } from '@/api/roles';
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
import { Avatar, EstadoBadge, TipoBadge } from '@/components/dominio/visuales';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDebounce } from '@/lib/useDebounce';
import { BuscadorToolbar } from '@/components/dominio/BuscadorToolbar';
import { ChipFiltro, ChipsFiltro } from '@/components/dominio/ChipsFiltro';
import {
  CampoDetalle,
  Historial,
  RejillaCampos,
  SeccionDetalle,
  ValorVacio,
} from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoContrasena } from './DialogoContrasena';
import { DialogoUsuario } from './DialogoUsuario';
import { AvisoQuitaAdministracion } from './AvisoQuitaAdministracion';
import { capacidadesDeGobierno } from './gobierno';

/** Renglones por pagina del listado. */
const POR_PAGINA = 10;

/** Columna por la que ordena el backend (fija: por usuario, ascendente). */
const ORDENAR_POR: NonNullable<UsuariosQuery['ordenarPor']> = 'username';

/**
 * Pantalla de Usuarios y accesos (RBAC A4) — re-vestida R9 a TABLA-FIRST fiel al proto `vUsuarios`:
 * page-head (con atajo a Roles + «Nuevo usuario») + toolbar (búsqueda, inactivos, solo bloqueados) +
 * TABLA DENSA (Usuario · Roles · Estado) + barra de totales al pie. Al hacer clic en un renglón se abre
 * un CAJÓN con los datos del usuario, sus roles y las acciones (editar · desactivar/activar · cambiar
 * contraseña · desbloquear si aplica). Alta/edición en diálogo con selector múltiple de roles.
 *
 * FIDELIDAD vs proto: el proto pinta columnas «Nivel», «Módulos con acceso» y «Último acceso», pero el
 * v2 usa RBAC por ROLES (no niveles en cascada) y la lista NO trae los módulos derivados ni la última
 * sesión → esas columnas se omiten (huecos reportados; los roles sí se muestran y de ellos cuelgan los
 * permisos). `usuarios.administrar` gobierna TODO (no hay `.ver`); la autoridad real es el backend (A1).
 */
export function UsuariosPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('usuarios.administrar');

  // ── Estado de la vista ─────────────────────────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [soloBloqueados, setSoloBloqueados] = useState(false);
  const [pagina, setPagina] = useState(1);
  // El cajón guarda el ID; el usuario mostrado se DERIVA de la lista viva (estado fresco al
  // activar/desactivar/desbloquear).
  const [seleccionId, setSeleccionId] = useState<string | null>(null);

  const query: UsuariosQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: ORDENAR_POR,
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    soloBloqueados: soloBloqueados ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  };

  const consulta = useUsuarios(query);
  // Comparte queryKey con el selector de roles del diálogo: no es una petición extra.
  // Solo se usa para AVISAR (el servidor es quien bloquea); si falla, no se avisa y ya.
  const roles = useRoles();
  const desactivar = useDesactivarUsuario();
  const reactivar = useReactivarUsuario();
  const desbloquear = useDesbloquearUsuario();

  // ── Dialogos ───────────────────────────────────────────────────────────────
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [usuarioEnEdicion, setUsuarioEnEdicion] = useState<Usuario | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<Usuario | null>(null);
  const [aCambiarContrasena, setACambiarContrasena] = useState<Usuario | null>(null);

  function abrirAlta(): void {
    setUsuarioEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(usuario: Usuario): void {
    setUsuarioEnEdicion(usuario);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Usuario "${objetivo.username}" desactivado.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  // Reactivar es NO destructivo: se aplica directo, sin dialogo de confirmacion.
  function reactivarUsuario(usuario: Usuario): void {
    reactivar.mutate(usuario.id, {
      onSuccess: () => toast.success(`Usuario "${usuario.username}" activado.`),
      onError: (error) => toast.error(error.message),
    });
  }

  // Desbloquear tambien es directo (accion correctiva, no destructiva).
  function desbloquearUsuario(usuario: Usuario): void {
    desbloquear.mutate(usuario.id, {
      onSuccess: () => toast.success(`Usuario "${usuario.username}" desbloqueado.`),
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
  const seleccion = filas.find((u) => u.id === seleccionId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 md:p-5 lg:overflow-visible">
      {/* ── Encabezado (proto .page-head) ────────────────────────────────────── */}
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Usuarios y accesos
          </h1>
          <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
            RBAC granular · usuarios, sus roles y su estado de acceso
          </p>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/administracion/roles" data-testid="ir-a-roles">
            <ShieldCheck aria-hidden />
            Roles
          </Link>
        </Button>
        {puedeAdministrar ? (
          <Button size="sm" onClick={abrirAlta} data-testid="nuevo-usuario">
            <Plus aria-hidden />
            Nuevo usuario
          </Button>
        ) : null}
      </header>

      {/* ── Card: filtros + tabla + totales ─────────────────────────────────── */}
      <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border bg-card lg:min-h-0 lg:flex-1 lg:shrink">
        {/* Toolbar del proto: chips Activos/Todos + Solo bloqueados, buscador y conteo. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2.5">
          <ChipsFiltro
            etiqueta="Filtrar por estado"
            opciones={[
              { valor: 'activos', etiqueta: 'Activos' },
              { valor: 'todos', etiqueta: 'Todos', testid: 'mostrar-desactivados' },
            ]}
            valor={incluirInactivos ? 'todos' : 'activos'}
            alCambiar={(valor) => {
              setIncluirInactivos(valor === 'todos');
              reiniciar();
            }}
          />
          <ChipFiltro
            activo={soloBloqueados}
            onClick={() => {
              setSoloBloqueados((v) => !v);
              reiniciar();
            }}
            data-testid="filtro-bloqueados"
          >
            Solo bloqueados
          </ChipFiltro>
          <BuscadorToolbar
            valor={textoBusqueda}
            alCambiar={(valor) => {
              setTextoBusqueda(valor);
              reiniciar();
            }}
            placeholder="Buscar usuario…"
            etiqueta="Buscar usuario"
            testid="buscar-usuario"
          />
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
            <p className="p-6 text-sm text-muted-foreground">Cargando usuarios…</p>
          ) : filas.length === 0 ? (
            <p
              className="m-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
              data-testid="usuario-vacio"
            >
              No hay usuarios que coincidan con la búsqueda.
            </p>
          ) : (
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Usuario</TablaDensaHead>
                  <TablaDensaHead>Roles</TablaDensaHead>
                  <TablaDensaHead>Estado</TablaDensaHead>
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {filas.map((u) => (
                  <TablaDensaFila
                    key={u.id}
                    seleccionada={seleccion?.id === u.id}
                    className="cursor-pointer"
                    onClick={() => setSeleccionId(u.id)}
                    data-testid="fila-usuario"
                  >
                    <TablaDensaCelda>
                      {/* Proto vUsuarios: thumb verde con iniciales + nombre en cell-strong. */}
                      <div className="flex items-center gap-2">
                        <Avatar nombre={u.nombre} tono="pt" tamano="sm" />
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{u.nombre}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            @{u.username}
                          </div>
                        </div>
                      </div>
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      {u.roles.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {u.roles.map((rol) => (
                            <Badge key={rol.id} variant="secondary">
                              {rol.nombre}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <EstadoBadge activo={u.activo} />
                        {u.bloqueado ? (
                          <Badge
                            variant="destructive"
                            title={`${u.intentosFallidos} intentos fallidos`}
                          >
                            Bloqueado
                          </Badge>
                        ) : null}
                        {u.esAuditor ? <TipoBadge tono="pt">Auditor</TipoBadge> : null}
                      </div>
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
              Usuarios (filtro)
            </span>
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

      {/* ── Cajón de detalle del usuario ────────────────────────────────────── */}
      <CajonDetalle
        abierto={seleccionId !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) setSeleccionId(null);
        }}
        titulo={
          seleccion !== null ? (
            <span className="flex flex-wrap items-center gap-2">
              {seleccion.nombre}
              <EstadoBadge activo={seleccion.activo} />
              {seleccion.bloqueado ? (
                <Badge
                  variant="destructive"
                  title={`${seleccion.intentosFallidos} intentos fallidos`}
                >
                  Bloqueado
                </Badge>
              ) : null}
              {seleccion.esAuditor ? <TipoBadge tono="pt">Auditor de calidad</TipoBadge> : null}
            </span>
          ) : (
            ''
          )
        }
        subtitulo={seleccion !== null ? `@${seleccion.username}` : undefined}
        acciones={
          seleccion !== null && puedeAdministrar ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => abrirEdicion(seleccion)}
                data-testid="editar-usuario"
              >
                <Pencil aria-hidden />
                Editar
              </Button>
              {seleccion.activo ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setADesactivar(seleccion)}
                  data-testid="desactivar-usuario"
                >
                  <Trash2 aria-hidden />
                  Desactivar
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => reactivarUsuario(seleccion)}
                  data-testid="activar-usuario"
                >
                  <RotateCcw aria-hidden />
                  Activar
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setACambiarContrasena(seleccion)}
                data-testid="contrasena-usuario"
              >
                <KeyRoundIcon aria-hidden />
                Cambiar contraseña
              </Button>
              {seleccion.bloqueado ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => desbloquearUsuario(seleccion)}
                  data-testid="desbloquear-usuario"
                >
                  <LockOpenIcon aria-hidden />
                  Desbloquear
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      >
        {seleccion !== null ? (
          <div data-testid="detalle-usuario">
            <SeccionDetalle titulo="Datos del usuario">
              <RejillaCampos>
                <CampoDetalle icono={AtSign} etiqueta="Usuario">
                  {seleccion.username}
                </CampoDetalle>
                <CampoDetalle icono={Mail} etiqueta="Correo">
                  {seleccion.email.length > 0 ? seleccion.email : <ValorVacio />}
                </CampoDetalle>
              </RejillaCampos>
            </SeccionDetalle>

            <SeccionDetalle titulo="Roles" icono={ShieldCheck}>
              {seleccion.roles.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin roles asignados.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {seleccion.roles.map((rol) => (
                    <Badge key={rol.id} variant="secondary">
                      {rol.nombre}
                    </Badge>
                  ))}
                </div>
              )}
            </SeccionDetalle>

            {/* Nota de fidelidad: el proto muestra «Módulos con acceso», «Nivel» y «Último acceso».
                v2 los deriva de los ROLES (permisos) y no los sirve en la lista → se informa aquí. */}
            <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                El acceso a los módulos se hereda de los <b className="text-foreground">roles</b>{' '}
                (permisos granulares). CONTROL v2 no usa niveles en cascada.
              </span>
            </div>

            <Historial creadoEn={seleccion.creadoEn} modificadoEn={seleccion.modificadoEn} />
          </div>
        ) : null}
      </CajonDetalle>

      {/* Dialogos */}
      <DialogoUsuario
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        usuario={usuarioEnEdicion}
      />
      <DialogoContrasena
        usuario={aCambiarContrasena}
        alCerrar={() => setACambiarContrasena(null)}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar usuario"
        descripcion={
          <>
            ¿Seguro que quieres desactivar a{' '}
            <span className="font-medium text-foreground">{aDesactivar?.username}</span>? No podrá
            iniciar sesión hasta reactivarlo; su historial se conserva.
            {aDesactivar !== null ? (
              <span className="mt-3 block">
                <AvisoQuitaAdministracion
                  capacidades={capacidadesDeGobierno(
                    roles.data ?? [],
                    aDesactivar.roles.map((rol) => rol.id),
                  )}
                />
              </span>
            ) : null}
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
