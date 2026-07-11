import {
  Building2,
  FileText,
  Pencil,
  Plus,
  RotateCcw,
  ScrollText,
  SettingsIcon,
  StarIcon,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useDesactivarEmpresa, useEmpresas, useReactivarEmpresa } from '@/api/empresas';
import type { Empresa } from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { BuscadorToolbar } from '@/components/dominio/BuscadorToolbar';
import { CajonDetalle } from '@/components/dominio/CajonDetalle';
import { ChipsFiltro } from '@/components/dominio/ChipsFiltro';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Avatar, EstadoBadge, TipoBadge } from '@/components/dominio/visuales';
import { Button } from '@/components/ui/button';
import { useDebounce } from '@/lib/useDebounce';
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

/** ¿Coincide la empresa con el texto buscado (nombre/razón/RFC)? */
function coincide(empresa: Empresa, texto: string): boolean {
  if (texto === '') {
    return true;
  }
  return [empresa.nombre, empresa.razonSocial, empresa.identificador]
    .filter((campo): campo is string => typeof campo === 'string')
    .some((campo) => campo.toLowerCase().includes(texto));
}

/**
 * Pantalla de Empresas (multi-empresa A9) — re-vestida R9 a TABLA-FIRST + CAJÓN, hermana de
 * Usuarios/Roles (el proto no tiene vista propia de empresas): page-head + toolbar (chips
 * Activas/Todas + buscador + conteo) + TABLA DENSA (Empresa · Identificador · Banderas · Estado) +
 * barra de totales al pie. Al hacer clic en un renglón se abre un CAJÓN con los datos de la empresa
 * y sus acciones (editar · desactivar/activar · configurar parámetros de costeo e inventario).
 *
 * La lista NO viene paginada del servidor (array plano, favorita primero): búsqueda y filtro de
 * inactivas EN CLIENTE. Todo va gobernado por `empresas.administrar`; la decisión real la toma el
 * backend en cada ruta (A1). OJO: el flag de borrado suave aquí es `activa` (femenino).
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
  // El cajón guarda el ID; la empresa mostrada se DERIVA de la lista viva (estado
  // fresco al activar/desactivar/editar).
  const [seleccionId, setSeleccionId] = useState<number | null>(null);

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
  // la busqueda por nombre/razon social/identificador.
  const empresas = useMemo(() => {
    const todas = consulta.data ?? [];
    return todas.filter(
      (empresa) => (incluirInactivas || empresa.activa) && coincide(empresa, busqueda),
    );
  }, [consulta.data, incluirInactivas, busqueda]);

  const total = empresas.length;
  const seleccion = empresas.find((e) => e.id === seleccionId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 md:p-5 lg:overflow-visible">
      {/* ── Encabezado (proto .page-head) ────────────────────────────────────── */}
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">Empresas</h1>
          <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
            Empresas del grupo y su configuración de costeo e inventario
          </p>
        </div>
        {puedeAdministrar ? (
          <Button size="sm" onClick={abrirAlta} data-testid="nuevo-empresa">
            <Plus aria-hidden />
            Nueva empresa
          </Button>
        ) : null}
      </header>

      {/* ── Card: filtros + tabla + totales ─────────────────────────────────── */}
      <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border bg-card lg:min-h-0 lg:flex-1 lg:shrink">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2.5">
          <ChipsFiltro
            etiqueta="Filtrar por estado"
            opciones={[
              { valor: 'activas', etiqueta: 'Activas' },
              { valor: 'todas', etiqueta: 'Todas', testid: 'mostrar-desactivados' },
            ]}
            valor={incluirInactivas ? 'todas' : 'activas'}
            alCambiar={(valor) => setIncluirInactivas(valor === 'todas')}
          />
          <BuscadorToolbar
            valor={textoBusqueda}
            alCambiar={setTextoBusqueda}
            placeholder="Buscar empresa…"
            etiqueta="Buscar empresa"
            testid="buscar-empresa"
          />
          <span className="ml-auto text-xs text-faint">
            {total.toLocaleString('es-MX')} registros
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
            <p className="p-6 text-sm text-muted-foreground">Cargando empresas…</p>
          ) : empresas.length === 0 ? (
            <p
              className="m-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
              data-testid="empresa-vacio"
            >
              No hay empresas que coincidan con la búsqueda.
            </p>
          ) : (
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Empresa</TablaDensaHead>
                  <TablaDensaHead>Identificador (RFC)</TablaDensaHead>
                  <TablaDensaHead>Banderas</TablaDensaHead>
                  <TablaDensaHead>Estado</TablaDensaHead>
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {empresas.map((e) => (
                  <TablaDensaFila
                    key={e.id}
                    seleccionada={seleccion?.id === e.id}
                    className="cursor-pointer"
                    onClick={() => setSeleccionId(e.id)}
                    data-testid="fila-empresa"
                  >
                    <TablaDensaCelda>
                      <div className="flex max-w-[52vw] items-center gap-2 lg:max-w-none">
                        <Avatar nombre={e.nombre} tono="pt" tamano="sm">
                          <Building2 className="size-4" aria-hidden />
                        </Avatar>
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{e.nombre}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {e.razonSocial ?? 'Sin razón social'}
                          </div>
                        </div>
                      </div>
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      {e.identificador !== null && e.identificador !== undefined ? (
                        <span className="num">{e.identificador}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {e.favorita ? <BadgeFavorita /> : null}
                        {e.paraIpt ? <TipoBadge tono="pt">IPT</TipoBadge> : null}
                        {e.paraEdr ? <TipoBadge tono="avios">EDR</TipoBadge> : null}
                        {!e.favorita && !e.paraIpt && !e.paraEdr ? (
                          <span className="text-muted-foreground">—</span>
                        ) : null}
                      </div>
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      <EstadoBadge activo={e.activa} />
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
              Empresas (filtro)
            </span>
            <b className="num">{total.toLocaleString('es-MX')}</b>
          </span>
        </div>
      </div>

      {/* ── Cajón de detalle de la empresa ──────────────────────────────────── */}
      <CajonDetalle
        abierto={seleccionId !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) setSeleccionId(null);
        }}
        titulo={
          seleccion !== null ? (
            <span className="flex flex-wrap items-center gap-2">
              {seleccion.nombre}
              <EstadoBadge activo={seleccion.activa} />
              {seleccion.favorita ? <BadgeFavorita /> : null}
            </span>
          ) : (
            ''
          )
        }
        subtitulo={seleccion !== null ? (seleccion.identificador ?? undefined) : undefined}
        acciones={
          seleccion !== null && puedeAdministrar ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => abrirEdicion(seleccion)}
                data-testid="editar-empresa"
              >
                <Pencil aria-hidden />
                Editar
              </Button>
              {seleccion.activa ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setADesactivar(seleccion)}
                  data-testid="desactivar-empresa"
                >
                  <Trash2 aria-hidden />
                  Desactivar
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => reactivarEmpresa(seleccion)}
                  data-testid="activar-empresa"
                >
                  <RotateCcw aria-hidden />
                  Activar
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAConfigurar(seleccion)}
                data-testid="configurar-empresa"
              >
                <SettingsIcon aria-hidden />
                Configurar
              </Button>
            </>
          ) : undefined
        }
      >
        {seleccion !== null ? (
          <div data-testid="detalle-empresa">
            <SeccionDetalle titulo="Datos de la empresa">
              <RejillaCampos>
                <CampoDetalle icono={ScrollText} etiqueta="Razón social" anchoCompleto>
                  {seleccion.razonSocial ?? <ValorVacio />}
                </CampoDetalle>
                <CampoDetalle icono={FileText} etiqueta="Identificador (RFC)">
                  {seleccion.identificador ?? <ValorVacio />}
                </CampoDetalle>
              </RejillaCampos>
            </SeccionDetalle>

            <SeccionDetalle titulo="Banderas">
              <div className="flex flex-wrap gap-1.5">
                {seleccion.favorita ? <BadgeFavorita /> : null}
                {seleccion.paraIpt ? <TipoBadge tono="pt">Inventario PT (IPT)</TipoBadge> : null}
                {seleccion.paraEdr ? (
                  <TipoBadge tono="avios">Estado de resultados (EDR)</TipoBadge>
                ) : null}
                {!seleccion.favorita && !seleccion.paraIpt && !seleccion.paraEdr ? (
                  <span className="text-sm text-muted-foreground">Sin banderas activas.</span>
                ) : null}
              </div>
            </SeccionDetalle>

            <Historial creadoEn={seleccion.creadoEn} modificadoEn={seleccion.modificadoEn} />
          </div>
        ) : null}
      </CajonDetalle>

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
    </div>
  );
}
