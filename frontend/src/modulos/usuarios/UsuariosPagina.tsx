import { AtSign, KeyRoundIcon, LockOpenIcon, Mail, ShieldCheck, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import type { Usuario, UsuariosQuery } from '@/api/tipos';
import {
  useDesactivarUsuario,
  useDesbloquearUsuario,
  useReactivarUsuario,
  useUsuarios,
} from '@/api/usuarios';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { Avatar, TipoBadge } from '@/components/dominio/visuales';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDebounce } from '@/lib/useDebounce';
import { ListaDetalle, type PaginacionListaDetalle } from '@/modulos/ListaDetalle';
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

/** Renglones por pagina del listado. */
const POR_PAGINA = 10;

/** Columna por la que ordena el backend (fija: por usuario, ascendente). */
const ORDENAR_POR: NonNullable<UsuariosQuery['ordenarPor']> = 'username';

/**
 * Pantalla de Usuarios — administracion de usuarios (RBAC A4) sobre el motor
 * LISTA + DETALLE (rediseño "Teal fresco"). La lista viene PAGINADA de servidor
 * (busqueda con debounce, toggle de inactivos y filtro "solo bloqueados"); el
 * detalle muestra los datos del usuario, sus roles y su estado, y ofrece editar /
 * desactivar / reactivar mas las acciones extra "Cambiar contraseña" y
 * "Desbloquear" (esta ultima solo si esta bloqueado). Alta/edicion en dialogo (con
 * selector multiple de roles); borrado suave reversible.
 *
 * TODO va gobernado por el permiso `usuarios.administrar` (no existe `.ver`): sin
 * el, ni la pantalla deberia alcanzarse ni hay acciones. La decision real la toma
 * el backend en cada ruta (A1).
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

  // Cambiar busqueda o filtros reinicia a la pagina 1.
  function alBuscar(valor: string): void {
    setTextoBusqueda(valor);
    setPagina(1);
  }

  function alAlternarInactivos(): void {
    setIncluirInactivos((v) => !v);
    setPagina(1);
  }

  function alAlternarBloqueados(): void {
    setSoloBloqueados((v) => !v);
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

  return (
    <>
      <ListaDetalle<Usuario>
        testid="usuario"
        titulo="Usuarios"
        descripcion="Usuarios del sistema, sus roles y su estado de acceso."
        icono={UsersRound}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(u) => u.id}
        obtenerTitulo={(u) => u.nombre}
        obtenerActivo={(u) => u.activo}
        obtenerSecundaria={(u) => `@${u.username}`}
        renderAvatarLista={(u) => <Avatar nombre={u.nombre} tono="neutro" tamano="sm" />}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        filtros={
          <Button
            type="button"
            variant={soloBloqueados ? 'secondary' : 'outline'}
            size="sm"
            className="w-full"
            onClick={alAlternarBloqueados}
            aria-pressed={soloBloqueados}
            data-testid="filtro-bloqueados"
          >
            {soloBloqueados ? 'Ver todos' : 'Solo bloqueados'}
          </Button>
        }
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={alAlternarInactivos}
        textoVacio="No hay usuarios que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nuevo usuario"
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={reactivarUsuario}
        renderAvatarDetalle={(u) => <Avatar nombre={u.nombre} tono="neutro" tamano="lg" />}
        renderMeta={(u) => (
          <>
            {u.bloqueado ? (
              <Badge variant="destructive" title={`${u.intentosFallidos} intentos fallidos`}>
                Bloqueado
              </Badge>
            ) : null}
            {u.esAuditor ? <TipoBadge tono="pt">Auditor de calidad</TipoBadge> : null}
          </>
        )}
        accionesExtra={(u) => (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setACambiarContrasena(u)}
              data-testid="contrasena-usuario"
            >
              <KeyRoundIcon aria-hidden />
              Cambiar contraseña
            </Button>
            {u.bloqueado ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => desbloquearUsuario(u)}
                data-testid="desbloquear-usuario"
              >
                <LockOpenIcon aria-hidden />
                Desbloquear
              </Button>
            ) : null}
          </>
        )}
        renderDetalle={(u) => (
          <>
            <SeccionDetalle titulo="Datos del usuario">
              <RejillaCampos>
                <CampoDetalle icono={AtSign} etiqueta="Usuario">
                  {u.username}
                </CampoDetalle>
                <CampoDetalle icono={Mail} etiqueta="Correo">
                  {u.email.length > 0 ? u.email : <ValorVacio />}
                </CampoDetalle>
              </RejillaCampos>
            </SeccionDetalle>

            <SeccionDetalle titulo="Roles" icono={ShieldCheck}>
              {u.roles.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin roles asignados.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {u.roles.map((rol) => (
                    <Badge key={rol.id} variant="secondary">
                      {rol.nombre}
                    </Badge>
                  ))}
                </div>
              )}
            </SeccionDetalle>

            <Historial creadoEn={u.creadoEn} modificadoEn={u.modificadoEn} />
          </>
        )}
      />

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
          </>
        }
        textoConfirmar="Desactivar"
        variante="destructive"
        procesando={desactivar.isPending}
        alConfirmar={confirmarDesactivar}
      />
    </>
  );
}
