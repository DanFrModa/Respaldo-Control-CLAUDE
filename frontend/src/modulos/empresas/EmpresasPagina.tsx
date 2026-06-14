import { Barcode, Building2, FileText, ScrollText, SettingsIcon, StarIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useDesactivarEmpresa, useEmpresas, useReactivarEmpresa } from '@/api/empresas';
import type { Empresa } from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { Avatar, TipoBadge } from '@/components/dominio/visuales';
import { Button } from '@/components/ui/button';
import { useDebounce } from '@/lib/useDebounce';
import { ListaDetalle } from '@/modulos/ListaDetalle';
import {
  CampoDetalle,
  Historial,
  RejillaCampos,
  SeccionDetalle,
  ValorVacio,
} from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoConfiguracion } from './DialogoConfiguracion';
import { DialogoEmpresa } from './DialogoEmpresa';

/** Badge de "Favorita" (estrella ámbar): la empresa predeterminada al iniciar sesión. */
function BadgeFavorita(): React.JSX.Element {
  return (
    <span className="inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 text-xs font-medium text-amber-700 dark:bg-amber-400/15 dark:text-amber-300">
      <StarIcon className="size-3 fill-current" aria-hidden />
      Favorita
    </span>
  );
}

/** ¿Coincide la empresa con el texto buscado (nombre/razón/RFC/UPC)? */
function coincide(empresa: Empresa, texto: string): boolean {
  if (texto === '') {
    return true;
  }
  return [empresa.nombre, empresa.razonSocial, empresa.identificador, empresa.upc]
    .filter((campo): campo is string => typeof campo === 'string')
    .some((campo) => campo.toLowerCase().includes(texto));
}

/**
 * Pantalla de Empresas — administracion de empresas (multi-empresa A9) sobre el
 * motor LISTA + DETALLE (rediseño "Teal fresco"). A diferencia de los catalogos,
 * la lista NO viene paginada del servidor (array plano, favorita primero), asi que
 * la busqueda y el filtro de inactivas se hacen EN CLIENTE y se le pasan al motor
 * los registros ya filtrados (sin `paginacion`). El detalle muestra los datos de
 * la empresa y sus banderas (favorita/IPT/EDR); ofrece editar / desactivar /
 * reactivar y la accion extra "Configurar" (parametros de costeo e inventario).
 *
 * Todo va gobernado por `empresas.administrar`. La decision real la toma el
 * backend en cada ruta (A1). OJO: aqui el flag de borrado suave es `activa`
 * (femenino), por eso `obtenerActivo={(e) => e.activa}`.
 */
export function EmpresasPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('empresas.administrar');

  const consulta = useEmpresas();
  const desactivar = useDesactivarEmpresa();
  const reactivar = useReactivarEmpresa();

  // ── Estado de la vista (filtrado en cliente) ────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim().toLowerCase(), 300);
  const [incluirInactivas, setIncluirInactivas] = useState(false);

  // ── Dialogos ───────────────────────────────────────────────────────────────
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [empresaEnEdicion, setEmpresaEnEdicion] = useState<Empresa | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<Empresa | null>(null);
  const [aConfigurar, setAConfigurar] = useState<Empresa | null>(null);

  function abrirAlta(): void {
    setEmpresaEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(empresa: Empresa): void {
    setEmpresaEnEdicion(empresa);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Empresa "${objetivo.nombre}" desactivada.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  // Reactivar es NO destructivo: directo, sin dialogo de confirmacion.
  function reactivarEmpresa(empresa: Empresa): void {
    reactivar.mutate(empresa.id, {
      onSuccess: () => toast.success(`Empresa "${empresa.nombre}" activada.`),
      onError: (error) => toast.error(error.message),
    });
  }

  // Registros filtrados en cliente: oculta inactivas (salvo que se pidan) y aplica
  // la busqueda por nombre/razon social/identificador/UPC.
  const empresas = useMemo(() => {
    const todas = consulta.data ?? [];
    return todas.filter(
      (empresa) => (incluirInactivas || empresa.activa) && coincide(empresa, busqueda),
    );
  }, [consulta.data, incluirInactivas, busqueda]);

  return (
    <>
      <ListaDetalle<Empresa>
        testid="empresa"
        titulo="Empresas"
        descripcion="Empresas del grupo y su configuración de costeo e inventario."
        icono={Building2}
        registros={empresas}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(e) => e.id}
        obtenerTitulo={(e) => e.nombre}
        obtenerActivo={(e) => e.activa}
        obtenerSecundaria={(e) => e.identificador ?? e.razonSocial ?? undefined}
        renderAvatarLista={(e) => (
          <Avatar nombre={e.nombre} tono="pt" tamano="sm">
            <Building2 className="size-4" aria-hidden />
          </Avatar>
        )}
        busqueda={textoBusqueda}
        alBuscar={setTextoBusqueda}
        incluirInactivos={incluirInactivas}
        alAlternarInactivos={() => setIncluirInactivas((v) => !v)}
        textoVacio="No hay empresas que coincidan con la búsqueda."
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nueva empresa"
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={reactivarEmpresa}
        renderAvatarDetalle={(e) => (
          <Avatar nombre={e.nombre} tono="pt" tamano="lg">
            <Building2 className="size-7" aria-hidden />
          </Avatar>
        )}
        renderMeta={(e) => (e.favorita ? <BadgeFavorita /> : null)}
        accionesExtra={(e) => (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAConfigurar(e)}
            data-testid="configurar-empresa"
          >
            <SettingsIcon aria-hidden />
            Configurar
          </Button>
        )}
        renderDetalle={(e) => (
          <>
            <SeccionDetalle titulo="Datos de la empresa">
              <RejillaCampos>
                <CampoDetalle icono={ScrollText} etiqueta="Razón social" anchoCompleto>
                  {e.razonSocial ?? <ValorVacio />}
                </CampoDetalle>
                <CampoDetalle icono={FileText} etiqueta="Identificador (RFC)">
                  {e.identificador ?? <ValorVacio />}
                </CampoDetalle>
                <CampoDetalle icono={Barcode} etiqueta="UPC">
                  {e.upc ?? <ValorVacio />}
                </CampoDetalle>
              </RejillaCampos>
            </SeccionDetalle>

            <SeccionDetalle titulo="Banderas">
              <div className="flex flex-wrap gap-1.5">
                {e.favorita ? <BadgeFavorita /> : null}
                {e.paraIpt ? <TipoBadge tono="pt">Inventario PT (IPT)</TipoBadge> : null}
                {e.paraEdr ? <TipoBadge tono="avios">Estado de resultados (EDR)</TipoBadge> : null}
                {!e.favorita && !e.paraIpt && !e.paraEdr ? (
                  <span className="text-sm text-muted-foreground">Sin banderas activas.</span>
                ) : null}
              </div>
            </SeccionDetalle>

            <Historial creadoEn={e.creadoEn} modificadoEn={e.modificadoEn} />
          </>
        )}
      />

      {/* Dialogos */}
      <DialogoEmpresa
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        empresa={empresaEnEdicion}
      />
      <DialogoConfiguracion empresa={aConfigurar} alCerrar={() => setAConfigurar(null)} />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar empresa"
        descripcion={
          <>
            ¿Seguro que quieres desactivar la empresa{' '}
            <span className="font-medium text-foreground">{aDesactivar?.nombre}</span>? Podrás
            volver a activarla después; su historial se conserva.
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
