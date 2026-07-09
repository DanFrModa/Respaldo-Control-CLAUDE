import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileEdit,
  Medal,
  Printer,
  Search,
  UserRound,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { imprimirAuditoria, useAuditorias } from '@/api/calidad';
import {
  ETIQUETAS_RESULTADO_AUDITORIA,
  ETIQUETAS_TIPO_AUDITORIA,
  RESULTADOS_AUDITORIA,
  TIPOS_AUDITORIA,
} from '@/api/esquemas';
import { useProveedores } from '@/api/proveedores';
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
 * Maquilero · Muestra · Defectos · Resultado) + barra de totales al pie con paginación. Al hacer clic en
 * un renglón se abre un CAJÓN con el detalle y las acciones (ver/capturar, imprimir PDF, modificar,
 * cancelar) gateadas por `calidad.modificar-auditorias`. La búsqueda, los filtros y la paginación los
 * hace el SERVIDOR (A1 — jamás pivote en cliente).
 *
 * FIDELIDAD vs proto: el proto pinta un KPI "Defecto principal" y una columna "AQL" por renglón; NO hay
 * endpoint de frecuencia de defectos ni un AQL escalar por auditoría (el nivel AQL es por-defecto, en la
 * sugerencia). Por eso los KPIs son Auditorías / Aceptación % / Rechazos (Σ de servidor con conteos, sin
 * pivote) y la tabla omite AQL — huecos reportados al cerrar el lote.
 *
 * El cajón guarda el ID (`seleccionId`) y el registro se DERIVA de la lista viva (patrón del rediseño:
 * `abierto` por ID, no por objeto, para no reabrirse solo cuando el renglón sale del filtro).
 */
export function ConsultaAuditoriasPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeModificar = tienePermiso('calidad.modificar-auditorias');

  const [textoFolio, setTextoFolio] = useState('');
  const folioDebounce = useDebounce(textoFolio.trim(), 300);
  const [idMaquilero, setIdMaquilero] = useState<number | null>(null);
  const [resultado, setResultado] = useState<ResultadoAuditoria | ''>('');
  const [tipo, setTipo] = useState<TipoAuditoria | ''>('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [incluirCanceladas, setIncluirCanceladas] = useState(false);
  const [pagina, setPagina] = useState(1);

  const [seleccionId, setSeleccionId] = useState<number | null>(null);
  const [modificar, setModificar] = useState<AuditoriaResumen | null>(null);
  const [cancelar, setCancelar] = useState<AuditoriaResumen | null>(null);

  const proveedores = useProveedores({ pagina: 1, porPagina: 100, ordenarPor: 'nombre' });

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
  ];

  function reiniciar(): void {
    setPagina(1);
  }
  function alBuscar(valor: string): void {
    setTextoFolio(valor);
    reiniciar();
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 md:p-5">
      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-wrap items-center gap-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"
        >
          <ClipboardCheck className="size-4.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">Consulta de auditorías</h1>
          <p className="truncate text-xs text-muted-foreground">
            Auditorías por muestreo AQL (MIL-STD-105 / ISO 2859) con su resultado e impreso
          </p>
        </div>
      </header>

      {/* ── KPIs ────────────────────────────────────────────────────────────── */}
      <KpiTiles kpis={kpis} className="shrink-0" />

      {/* ── Card: filtros + tabla + totales ─────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          <div className="relative w-48">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              className="h-8 pl-8 text-sm"
              placeholder="Folio de orden…"
              value={textoFolio}
              onChange={(e) => alBuscar(e.target.value)}
              aria-label="Buscar por folio de orden"
              data-testid="buscar-consulta-auditoria"
            />
          </div>
          <SelectNativo
            className="h-8 w-auto text-sm"
            aria-label="Filtrar por maquilero"
            value={idMaquilero === null ? '' : String(idMaquilero)}
            onChange={(e) => {
              setIdMaquilero(e.target.value === '' ? null : Number(e.target.value));
              reiniciar();
            }}
            data-testid="filtro-maquilero-auditoria"
          >
            <option value="">Todos los maquileros</option>
            {(proveedores.data?.datos ?? []).map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.nombre}
              </option>
            ))}
          </SelectNativo>
          <SelectNativo
            className="h-8 w-auto text-sm"
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
            className="h-8 w-auto text-sm"
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
            className="h-8 w-auto text-sm"
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
            className="h-8 w-auto text-sm"
            aria-label="Hasta (fecha de auditoría)"
            value={hasta}
            onChange={(e) => {
              setHasta(e.target.value);
              reiniciar();
            }}
            data-testid="filtro-hasta-auditoria"
          />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={incluirCanceladas}
              onChange={() => {
                setIncluirCanceladas((v) => !v);
                reiniciar();
              }}
              data-testid="mostrar-desactivados"
            />
            Incluir canceladas
          </label>
          <div className="ml-auto">
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {total.toLocaleString('es-MX')} auditorías
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
            <p className="p-6 text-sm text-muted-foreground">Cargando auditorías…</p>
          ) : filas.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground" data-testid="consulta-auditoria-vacio">
              No hay auditorías que coincidan con la búsqueda.
            </p>
          ) : (
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Auditoría</TablaDensaHead>
                  <TablaDensaHead>Orden</TablaDensaHead>
                  <TablaDensaHead>Modelo</TablaDensaHead>
                  <TablaDensaHead>Maquilero</TablaDensaHead>
                  <TablaDensaHead numerica>Muestra</TablaDensaHead>
                  <TablaDensaHead numerica>Defectos</TablaDensaHead>
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
