import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileEdit,
  Medal,
  Plus,
  Printer,
  UserRound,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { imprimirAuditoria, useAuditorias, useResumenAuditorias } from '@/api/calidad';
import {
  ETIQUETAS_RESULTADO_AUDITORIA,
  ETIQUETAS_TIPO_AUDITORIA,
  RESULTADOS_AUDITORIA,
  TIPOS_AUDITORIA,
} from '@/api/esquemas';
import type {
  AuditoriaResumen,
  AuditoriasQuery,
  ResultadoAuditoria,
  TipoAuditoria,
} from '@/api/tipos';
import { CajonDetalle } from '@/components/dominio/CajonDetalle';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import { KpiTiles, type Kpi } from '@/components/dominio/KpiTiles';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useDebounce } from '@/lib/useDebounce';
import { cn } from '@/lib/utils';
import { BuscadorToolbar } from '@/components/dominio/BuscadorToolbar';
import { FiltroProveedor } from '@/components/dominio/FiltroProveedor';
import { ChipFiltro } from '@/components/dominio/ChipsFiltro';
import { CampoDetalle, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoCancelarAuditoria } from './DialogoCancelarAuditoria';
import { DialogoModificarAuditoria } from './DialogoModificarAuditoria';

/** Renglones por página del listado. */
const POR_PAGINA = 15;

/** Chip del resultado (aprobado=verde / reprobado=rojo / sin calificar=gris), sobre los tonos del kit. */
export function ResultadoBadge({
  resultado,
}: {
  resultado: ResultadoAuditoria;
}): React.JSX.Element {
  const tono = resultado === 'aprobado' ? 'ok' : resultado === 'reprobado' ? 'crit' : 'neutro';
  return <ChipEstado tono={tono}>{ETIQUETAS_RESULTADO_AUDITORIA[resultado]}</ChipEstado>;
}

/**
 * CONSULTA DE AUDITORÍAS (F6-E3; proto `vCalidad` — re-vestida R9 a TABLA-FIRST + CAJÓN). page-head +
 * KPIs de vistazo + card con barra de herramientas (búsqueda por folio de orden + filtros de servidor:
 * maquilero, resultado, tipo, fechas, incluir canceladas) + TABLA DENSA (Auditoría · Orden · Modelo ·
 * Maquilero · Muestra · Defectos · AQL · Resultado) + barra de totales al pie con paginación. Al hacer
 * clic en un renglón se abre un CAJÓN con el detalle y las acciones (ver/capturar, imprimir PDF,
 * modificar, cancelar) gateadas por `calidad.modificar-auditorias`. La búsqueda, los filtros y la
 * paginación los hace el SERVIDOR (A1 — jamás pivote en cliente).
 *
 * FIDELIDAD vs proto: el KPI "Defecto principal" lo sirve el resumen de cabecera
 * (`GET /api/calidad/auditorias/resumen`, agregado EN SERVIDOR bajo el mismo filtro — un groupBy de
 * fallas por defecto, top-1); la columna "AQL" es el `nivelAqlPrincipal` que el listado ya trae por fila
 * (nivel del defecto con más fallas de esa auditoría; empate → el más estricto). Los otros KPIs
 * (Aceptación % / Auditorías / Rechazos) siguen siendo conteos de servidor. Nada se pivotea en cliente.
 *
 * El cajón guarda el ID (`seleccionId`) y el registro se DERIVA de la lista viva (patrón del rediseño:
 * `abierto` por ID, no por objeto, para no reabrirse solo cuando el renglón sale del filtro).
 */
export function ConsultaAuditoriasPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeModificar = tienePermiso('calidad.modificar-auditorias');
  const puedeGenerar = tienePermiso('calidad.generar-auditorias');

  const [textoFolio, setTextoFolio] = useState('');
  const folioDebounce = useDebounce(textoFolio.trim(), 300);
  const [idMaquilero, setIdMaquilero] = useState<number | null>(null);
  // Nombre del maquilero filtrado: con búsqueda server-side el combobox sólo conoce su página.
  const [nombreMaquilero, setNombreMaquilero] = useState<string | undefined>(undefined);
  const [resultado, setResultado] = useState<ResultadoAuditoria | ''>('');
  const [tipo, setTipo] = useState<TipoAuditoria | ''>('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [incluirCanceladas, setIncluirCanceladas] = useState(false);
  const [pagina, setPagina] = useState(1);

  const [seleccionId, setSeleccionId] = useState<number | null>(null);
  const [modificar, setModificar] = useState<AuditoriaResumen | null>(null);
  const [cancelar, setCancelar] = useState<AuditoriaResumen | null>(null);

  const folioNum = Number(folioDebounce);
  const buscaFolio =
    folioDebounce !== '' && Number.isFinite(folioNum) && folioNum > 0
      ? { folioOrden: folioNum }
      : {};

  // Filtros base (sin el chip de resultado) que comparten la lista y los conteos de los KPIs.
  const filtrosBase = {
    incluirCanceladas: incluirCanceladas ? ('true' as const) : ('false' as const),
    ...buscaFolio,
    ...(idMaquilero !== null ? { idMaquilero } : {}),
    ...(tipo !== '' ? { tipoAuditoria: tipo } : {}),
    ...(desde !== '' ? { desde } : {}),
    ...(hasta !== '' ? { hasta } : {}),
  };

  const query: AuditoriasQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'numAuditoria',
    direccion: 'desc',
    ...filtrosBase,
    ...(resultado !== '' ? { resultado } : {}),
  };

  const consulta = useAuditorias(query);
  const datos = consulta.data;
  const filas = datos?.datos ?? [];
  const total = datos?.total ?? 0;
  const totalPaginas = datos?.totalPaginas ?? 0;
  const seleccion = filas.find((a) => a.id === seleccionId) ?? null;

  // KPIs por conteo de servidor (porPagina:1 solo lee el total; independientes del chip de resultado).
  const kpiTodas = useAuditorias({
    pagina: 1,
    porPagina: 1,
    ordenarPor: 'numAuditoria',
    direccion: 'desc',
    ...filtrosBase,
  });
  const kpiAprobadas = useAuditorias({
    pagina: 1,
    porPagina: 1,
    ordenarPor: 'numAuditoria',
    direccion: 'desc',
    ...filtrosBase,
    resultado: 'aprobado',
  });
  const kpiReprobadas = useAuditorias({
    pagina: 1,
    porPagina: 1,
    ordenarPor: 'numAuditoria',
    direccion: 'desc',
    ...filtrosBase,
    resultado: 'reprobado',
  });

  // Defecto principal del mismo universo (agregado en servidor; chip-independiente como los conteos).
  const resumen = useResumenAuditorias(filtrosBase);
  const defectoPrincipal = resumen.data?.defectoPrincipal ?? null;

  const totalAuditorias = kpiTodas.data?.total ?? 0;
  const aprobadas = kpiAprobadas.data?.total ?? 0;
  const reprobadas = kpiReprobadas.data?.total ?? 0;
  const aceptacion = totalAuditorias > 0 ? Math.round((aprobadas / totalAuditorias) * 100) : 0;

  const kpis: Kpi[] = [
    {
      clave: 'aceptacion',
      etiqueta: 'Aceptación',
      valor: String(aceptacion),
      sufijo: '%',
      pie: `${aprobadas.toLocaleString('es-MX')} aprobadas`,
      ...(aceptacion >= 90 ? { tonoPie: 'ok' as const } : {}),
    },
    {
      clave: 'auditorias',
      etiqueta: 'Auditorías',
      valor: totalAuditorias.toLocaleString('es-MX'),
      pie: 'coinciden con el filtro',
    },
    {
      clave: 'rechazos',
      etiqueta: 'Rechazos',
      valor: reprobadas.toLocaleString('es-MX'),
      pie: 'requieren reproceso',
      ...(reprobadas > 0 ? { tonoPie: 'crit' as const } : {}),
    },
    {
      clave: 'defecto-principal',
      etiqueta: 'Defecto principal',
      valor: defectoPrincipal === null ? '—' : defectoPrincipal.clave,
      pie:
        defectoPrincipal === null
          ? 'sin fallas registradas'
          : `${defectoPrincipal.descripcion} · ${defectoPrincipal.totalFallas.toLocaleString('es-MX')} fallas`,
      ...(defectoPrincipal !== null ? { tonoPie: 'crit' as const } : {}),
    },
  ];

  function reiniciar(): void {
    setPagina(1);
  }
  function alBuscar(valor: string): void {
    setTextoFolio(valor);
    reiniciar();
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 md:p-5 lg:overflow-visible">
      {/* ── Encabezado (proto .page-head de vCalidad) ────────────────────────── */}
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Control de calidad · AQL
          </h1>
          <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
            Auditorías por muestreo (MIL-STD-105 / ISO 2859)
          </p>
        </div>
        {puedeGenerar ? (
          <Button size="sm" asChild data-testid="nueva-auditoria-consulta">
            <Link to="/calidad/auditorias/nueva">
              <Plus aria-hidden />
              Nueva auditoría
            </Link>
          </Button>
        ) : null}
      </header>

      {/* ── KPIs ────────────────────────────────────────────────────────────── */}
      <KpiTiles kpis={kpis} className="shrink-0" />

      {/* ── Card: filtros + tabla + totales ─────────────────────────────────── */}
      <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border bg-card lg:min-h-0 lg:flex-1 lg:shrink">
        {/* Toolbar del proto (una sola franja): chip, filtros compactos, buscador y conteo. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2.5">
          <ChipFiltro
            activo={incluirCanceladas}
            onClick={() => {
              setIncluirCanceladas((v) => !v);
              reiniciar();
            }}
            data-testid="mostrar-desactivados"
          >
            Incluir canceladas
          </ChipFiltro>
          {/* V1-E7g (§Post-F9.52 punto 7): el proveedor se busca por CUALQUIER palabra, en el
              SERVIDOR. El `<select>` de aquí topaba en 100 y sólo dejaba teclear el prefijo. */}
          <div className="w-44">
            <FiltroProveedor
              idProveedor={idMaquilero}
              nombreInicial={nombreMaquilero}
              alCambiar={(maquilero) => {
                setIdMaquilero(maquilero?.id ?? null);
                setNombreMaquilero(maquilero?.nombre);
                reiniciar();
              }}
              etiqueta="Filtrar por maquilero"
              placeholder="Todos los maquileros"
              testid="filtro-maquilero-auditoria"
            />
          </div>
          <SelectNativo
            className="w-36 h-[30px] text-xs"
            aria-label="Filtrar por resultado"
            value={resultado}
            onChange={(e) => {
              setResultado(e.target.value as ResultadoAuditoria | '');
              reiniciar();
            }}
            data-testid="filtro-resultado-auditoria"
          >
            <option value="">Todo resultado</option>
            {RESULTADOS_AUDITORIA.map((r) => (
              <option key={r} value={r}>
                {ETIQUETAS_RESULTADO_AUDITORIA[r]}
              </option>
            ))}
          </SelectNativo>
          <SelectNativo
            className="w-32 h-[30px] text-xs"
            aria-label="Filtrar por tipo"
            value={tipo}
            onChange={(e) => {
              setTipo(e.target.value as TipoAuditoria | '');
              reiniciar();
            }}
            data-testid="filtro-tipo-auditoria"
          >
            <option value="">Todo tipo</option>
            {TIPOS_AUDITORIA.map((t) => (
              <option key={t} value={t}>
                {ETIQUETAS_TIPO_AUDITORIA[t]}
              </option>
            ))}
          </SelectNativo>
          <Input
            type="date"
            className="h-[30px] w-auto text-xs"
            aria-label="Desde (fecha de auditoría)"
            value={desde}
            onChange={(e) => {
              setDesde(e.target.value);
              reiniciar();
            }}
            data-testid="filtro-desde-auditoria"
          />
          <Input
            type="date"
            className="h-[30px] w-auto text-xs"
            aria-label="Hasta (fecha de auditoría)"
            value={hasta}
            onChange={(e) => {
              setHasta(e.target.value);
              reiniciar();
            }}
            data-testid="filtro-hasta-auditoria"
          />
          <BuscadorToolbar
            valor={textoFolio}
            alCambiar={alBuscar}
            placeholder="Folio de orden…"
            etiqueta="Buscar por folio de orden"
            testid="buscar-consulta-auditoria"
            className="w-40"
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
            <p className="p-6 text-sm text-muted-foreground">Cargando auditorías…</p>
          ) : filas.length === 0 ? (
            <p
              className="m-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
              data-testid="consulta-auditoria-vacio"
            >
              No hay auditorías que coincidan con la búsqueda.
            </p>
          ) : (
            <>
              {/* Móvil (<lg): tarjetas apiladas — la tabla densa de 8 columnas se apachurra en
                  teléfono. Mismo clic (selecciona → cajón) que la fila. */}
              <div className="space-y-2 p-3 lg:hidden" data-testid="consulta-auditoria-tarjetas">
                {filas.map((a) => (
                  <button
                    type="button"
                    key={a.id}
                    onClick={() => setSeleccionId(a.id)}
                    data-testid="consulta-auditoria-tarjeta"
                    className={cn(
                      'w-full rounded-lg border bg-card p-3 text-left',
                      seleccion?.id === a.id && 'ring-2 ring-primary',
                      a.cancelada && 'opacity-60',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">Auditoría #{a.numAuditoria}</p>
                        <p className="truncate text-sm">
                          Orden {a.folioOrden === null ? '—' : `#${a.folioOrden}`} ·{' '}
                          {a.codigoModelo ?? '—'}
                        </p>
                      </div>
                      {a.cancelada ? (
                        <ChipEstado tono="neutro">Cancelada</ChipEstado>
                      ) : (
                        <ResultadoBadge resultado={a.resultado} />
                      )}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {a.maquilero ?? 'sin maquilero'}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        Muestra{' '}
                        <span className="num font-medium text-foreground">
                          {a.tamanoMuestra.toLocaleString('es-MX')}
                        </span>
                      </span>
                      <span>
                        Defectos{' '}
                        <span
                          className={cn(
                            'num font-medium',
                            a.totalFallas > 0 ? 'text-warn' : 'text-foreground',
                          )}
                        >
                          {a.totalFallas.toLocaleString('es-MX')}
                        </span>
                      </span>
                      <span>
                        AQL{' '}
                        <span className="num font-medium text-foreground">
                          {a.nivelAqlPrincipal === null
                            ? '—'
                            : a.nivelAqlPrincipal.toLocaleString('es-MX')}
                        </span>
                      </span>
                    </div>
                  </button>
                ))}
              </div>
              {/* Escritorio (≥lg): tabla densa completa. */}
              <div className="hidden lg:block" data-testid="consulta-auditoria-tabla">
                <TablaDensa>
                  <TablaDensaEncabezado>
                    <TablaDensaFila>
                      <TablaDensaHead>Auditoría</TablaDensaHead>
                      <TablaDensaHead>Orden</TablaDensaHead>
                      <TablaDensaHead>Modelo</TablaDensaHead>
                      <TablaDensaHead>Maquilero</TablaDensaHead>
                      <TablaDensaHead numerica>Muestra</TablaDensaHead>
                      <TablaDensaHead numerica>Defectos</TablaDensaHead>
                      <TablaDensaHead numerica>AQL</TablaDensaHead>
                      <TablaDensaHead>Resultado</TablaDensaHead>
                    </TablaDensaFila>
                  </TablaDensaEncabezado>
                  <TablaDensaCuerpo>
                    {filas.map((a) => (
                      <TablaDensaFila
                        key={a.id}
                        seleccionada={seleccion?.id === a.id}
                        className={`cursor-pointer ${a.cancelada ? 'opacity-60' : ''}`}
                        onClick={() => setSeleccionId(a.id)}
                        data-testid="fila-consulta-auditoria"
                      >
                        <TablaDensaCelda className="font-medium">#{a.numAuditoria}</TablaDensaCelda>
                        <TablaDensaCelda className="text-muted-foreground">
                          {a.folioOrden === null ? '—' : `#${a.folioOrden}`}
                        </TablaDensaCelda>
                        <TablaDensaCelda>{a.codigoModelo ?? '—'}</TablaDensaCelda>
                        <TablaDensaCelda className="text-muted-foreground">
                          {a.maquilero ?? '—'}
                        </TablaDensaCelda>
                        <TablaDensaCelda numerica>
                          {a.tamanoMuestra.toLocaleString('es-MX')}
                        </TablaDensaCelda>
                        <TablaDensaCelda
                          numerica
                          className={a.totalFallas > 0 ? 'font-semibold text-warn' : ''}
                        >
                          {a.totalFallas.toLocaleString('es-MX')}
                        </TablaDensaCelda>
                        <TablaDensaCelda numerica className="text-muted-foreground">
                          {a.nivelAqlPrincipal === null
                            ? '—'
                            : a.nivelAqlPrincipal.toLocaleString('es-MX')}
                        </TablaDensaCelda>
                        <TablaDensaCelda>
                          {a.cancelada ? (
                            <ChipEstado tono="neutro">Cancelada</ChipEstado>
                          ) : (
                            <ResultadoBadge resultado={a.resultado} />
                          )}
                        </TablaDensaCelda>
                      </TablaDensaFila>
                    ))}
                  </TablaDensaCuerpo>
                </TablaDensa>
              </div>
            </>
          )}
        </div>

        {/* ── Barra de totales al pie ────────────────────────────────────── */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-t bg-secondary px-3 py-1.5 text-xs">
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10.5px] font-medium text-faint uppercase">
              Auditorías (filtro)
            </span>
            <b className="num">{total.toLocaleString('es-MX')}</b>
          </span>
          {datos && total > 0 ? (
            <span className="ml-auto flex items-center gap-1 text-muted-foreground">
              Página {datos.pagina} de {totalPaginas}
              <Button
                variant="ghost"
                size="icon"
                disabled={datos.pagina <= 1 || consulta.isFetching}
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
                aria-label="Página anterior"
              >
                <ChevronLeft className="size-4" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={datos.pagina >= totalPaginas || consulta.isFetching}
                onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                aria-label="Página siguiente"
              >
                <ChevronRight className="size-4" aria-hidden />
              </Button>
            </span>
          ) : null}
        </div>
      </div>

      {/* ── Cajón de detalle de la auditoría ────────────────────────────────── */}
      <CajonDetalle
        abierto={seleccionId !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) setSeleccionId(null);
        }}
        titulo={
          seleccion !== null ? (
            <span className="flex items-center gap-2">
              Auditoría #{seleccion.numAuditoria}
              {seleccion.cancelada ? (
                <ChipEstado tono="neutro">Cancelada</ChipEstado>
              ) : (
                <ResultadoBadge resultado={seleccion.resultado} />
              )}
            </span>
          ) : (
            ''
          )
        }
        subtitulo={
          seleccion !== null
            ? `Orden #${seleccion.folioOrden ?? '—'} · ${seleccion.maquilero ?? 'sin maquilero'}`
            : undefined
        }
        acciones={
          seleccion !== null ? (
            <>
              <Button variant="outline" size="sm" asChild>
                <Link
                  to={`/calidad/auditorias/${String(seleccion.id)}`}
                  data-testid="ver-capturar-auditoria"
                >
                  <ClipboardCheck aria-hidden />
                  Ver / capturar
                </Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => imprimirAuditoria(seleccion.id)}
                data-testid="imprimir-consulta-auditoria"
              >
                <Printer aria-hidden />
                Imprimir PDF
              </Button>
              {puedeModificar && !seleccion.cancelada ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setModificar(seleccion)}
                    data-testid="modificar-consulta-auditoria"
                  >
                    <FileEdit aria-hidden />
                    Modificar
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setCancelar(seleccion)}
                    data-testid="cancelar-consulta-auditoria"
                  >
                    <XCircle aria-hidden />
                    Cancelar
                  </Button>
                </>
              ) : null}
            </>
          ) : undefined
        }
      >
        {seleccion !== null ? <DetalleAuditoria auditoria={seleccion} /> : null}
      </CajonDetalle>

      <DialogoModificarAuditoria
        idAuditoria={modificar?.id}
        abierto={modificar !== null}
        alCambiarAbierto={(v) => {
          if (!v) setModificar(null);
        }}
      />
      <DialogoCancelarAuditoria
        idAuditoria={cancelar?.id}
        numAuditoria={cancelar?.numAuditoria}
        abierto={cancelar !== null}
        alCambiarAbierto={(v) => {
          if (!v) setCancelar(null);
        }}
      />
    </div>
  );
}

/** Cuerpo del cajón: encabezado de la auditoría (los botones viven en `acciones` del cajón). */
function DetalleAuditoria({ auditoria }: { auditoria: AuditoriaResumen }): React.JSX.Element {
  return (
    <SeccionDetalle titulo="Datos de la auditoría" icono={Medal}>
      <RejillaCampos>
        <CampoDetalle icono={ClipboardCheck} etiqueta="Orden">
          {auditoria.folioOrden === null ? '—' : `#${auditoria.folioOrden}`}
        </CampoDetalle>
        <CampoDetalle icono={Medal} etiqueta="Modelo">
          {auditoria.codigoModelo ?? '—'}
        </CampoDetalle>
        <CampoDetalle icono={UserRound} etiqueta="Maquilero">
          {auditoria.maquilero ?? '—'}
        </CampoDetalle>
        <CampoDetalle icono={Calendar} etiqueta="Fecha de auditoría">
          {auditoria.fechaAuditoria}
        </CampoDetalle>
        <CampoDetalle icono={ClipboardCheck} etiqueta="Tipo">
          {ETIQUETAS_TIPO_AUDITORIA[auditoria.tipoAuditoria]}
        </CampoDetalle>
        <CampoDetalle icono={ClipboardCheck} etiqueta="Muestra / fallas">
          {auditoria.tamanoMuestra} muestra · {auditoria.totalFallas} fallas
        </CampoDetalle>
      </RejillaCampos>
    </SeccionDetalle>
  );
}
