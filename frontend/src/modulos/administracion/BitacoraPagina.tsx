import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { useBitacora } from '@/api/bitacora';
import { ETIQUETAS_ACCION_BITACORA } from '@/api/esquemas';
import type { BitacoraQuery } from '@/api/tipos';
import { CajonDetalle } from '@/components/dominio/CajonDetalle';
import { ChipEstado, type TonoEstado } from '@/components/dominio/ChipEstado';
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
import { Skeleton } from '@/components/ui/skeleton';

/** Tipo de accion para el filtro de la bitacora (solo las claves literales). */
type AccionFiltro = NonNullable<BitacoraQuery['accion']>;

/** Un renglon de la bitacora (lo que entrega el API paginado). */
type RegistroBitacora = NonNullable<ReturnType<typeof useBitacora>['data']>['datos'][number];

const POR_PAGINA = 20;

/** Tono semantico del chip por accion (crear=ok, modificar=info, bajas=crit). */
const TONO_ACCION: Record<string, TonoEstado> = {
  CREAR: 'ok',
  MODIFICAR: 'info',
  DESACTIVAR: 'crit',
  CANCELAR: 'crit',
  OTRO: 'neutro',
};

/** Formatea una fecha ISO como dd/mm/yyyy hh:mm. */
function formatearFecha(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Pantalla de Bitacora — SOLO LECTURA (sin acciones de escritura), re-vestida al
 * rediseño R1: `TablaDensa` (tabla-first) + `CajonDetalle` para el JSON de cada
 * registro (antes un `<pre>` inline). Tabla paginada en servidor con filtros por
 * entidad, idEntidad, idUsuario, accion, desde/hasta. Requiere `admin.ver-bitacora`.
 */
export function BitacoraPagina(): React.JSX.Element {
  const [entidad, setEntidad] = useState('');
  const [idEntidad, setIdEntidad] = useState('');
  const [idUsuario, setIdUsuario] = useState('');
  const [accionFiltro, setAccionFiltro] = useState<AccionFiltro | ''>('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [pagina, setPagina] = useState(1);
  // Registro cuyo detalle (JSON de datos) esta abierto en el cajon lateral.
  const [detalle, setDetalle] = useState<RegistroBitacora | null>(null);

  const query: BitacoraQuery = {
    pagina,
    porPagina: POR_PAGINA,
    direccion: 'desc',
    ...(entidad.trim().length > 0 ? { entidad: entidad.trim() } : {}),
    ...(idEntidad.trim().length > 0 ? { idEntidad: idEntidad.trim() } : {}),
    ...(idUsuario.trim().length > 0 ? { idUsuario: idUsuario.trim() } : {}),
    ...(accionFiltro !== '' ? { accion: accionFiltro } : {}),
    // El <input type="date"> entrega "YYYY-MM-DD" pero el contrato exige ISO date-time completo
    // (format: date-time → 400 si no). Se convierte conservando el rango INCLUSIVO: `desde` desde
    // el inicio del día y `hasta` hasta el final del día (23:59:59.999).
    ...(desde.length > 0 ? { desde: new Date(`${desde}T00:00:00.000Z`).toISOString() } : {}),
    ...(hasta.length > 0 ? { hasta: new Date(`${hasta}T23:59:59.999Z`).toISOString() } : {}),
  };

  const consulta = useBitacora(query);

  function alCambiarFiltro(): void {
    setPagina(1);
  }

  const datos = consulta.data;
  const totalPaginas = datos?.totalPaginas ?? 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl p-4 lg:p-5">
        {/* Encabezado */}
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-[21px] leading-tight font-semibold tracking-tight">Bitácora</h1>
            <p className="text-[12.5px] text-muted-foreground">
              Auditoría de cambios del sistema (solo lectura, A7).
            </p>
          </div>
        </div>

        {/* Filtros */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Input
            placeholder="Entidad (ej. Almacen)"
            value={entidad}
            onChange={(e) => {
              setEntidad(e.target.value);
              alCambiarFiltro();
            }}
            aria-label="Filtrar por entidad"
            data-testid="filtro-entidad"
          />
          <Input
            placeholder="Id del registro"
            value={idEntidad}
            onChange={(e) => {
              setIdEntidad(e.target.value);
              alCambiarFiltro();
            }}
            aria-label="Filtrar por id de registro"
            data-testid="filtro-id-entidad"
          />
          <Input
            placeholder="Id de usuario"
            value={idUsuario}
            onChange={(e) => {
              setIdUsuario(e.target.value);
              alCambiarFiltro();
            }}
            aria-label="Filtrar por usuario"
            data-testid="filtro-id-usuario"
          />
          <SelectNativo
            value={accionFiltro}
            onChange={(e) => {
              setAccionFiltro(e.target.value as AccionFiltro | '');
              alCambiarFiltro();
            }}
            aria-label="Filtrar por acción"
            data-testid="filtro-accion"
          >
            <option value="">Todas las acciones</option>
            <option value="CREAR">Creó</option>
            <option value="MODIFICAR">Modificó</option>
            <option value="DESACTIVAR">Desactivó</option>
            <option value="CANCELAR">Canceló</option>
            <option value="OTRO">Otro</option>
          </SelectNativo>
          <Input
            type="date"
            value={desde}
            onChange={(e) => {
              setDesde(e.target.value);
              alCambiarFiltro();
            }}
            aria-label="Desde (fecha)"
            data-testid="filtro-desde"
          />
          <Input
            type="date"
            value={hasta}
            onChange={(e) => {
              setHasta(e.target.value);
              alCambiarFiltro();
            }}
            aria-label="Hasta (fecha)"
            data-testid="filtro-hasta"
          />
        </div>

        {/* Tabla densa (R1) */}
        <div className="mt-4 overflow-hidden rounded-lg border">
          <TablaDensa>
            <TablaDensaEncabezado>
              <tr>
                <TablaDensaHead>Entidad</TablaDensaHead>
                <TablaDensaHead>Id registro</TablaDensaHead>
                <TablaDensaHead>Acción</TablaDensaHead>
                <TablaDensaHead>Usuario</TablaDensaHead>
                <TablaDensaHead>Fecha</TablaDensaHead>
                <TablaDensaHead>Datos</TablaDensaHead>
              </tr>
            </TablaDensaEncabezado>
            <TablaDensaCuerpo>
              {consulta.isPending ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TablaDensaFila key={i}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <TablaDensaCelda key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TablaDensaCelda>
                    ))}
                  </TablaDensaFila>
                ))
              ) : consulta.isError ? (
                <TablaDensaFila>
                  <TablaDensaCelda colSpan={6} className="py-6 text-center text-destructive">
                    {consulta.error.message}
                  </TablaDensaCelda>
                </TablaDensaFila>
              ) : datos?.datos.length === 0 ? (
                <TablaDensaFila>
                  <TablaDensaCelda
                    colSpan={6}
                    className="py-6 text-center text-muted-foreground"
                    data-testid="bitacora-vacia"
                  >
                    No hay registros en la bitácora con los filtros actuales.
                  </TablaDensaCelda>
                </TablaDensaFila>
              ) : (
                (datos?.datos ?? []).map((registro) => (
                  <TablaDensaFila key={registro.id} seleccionada={detalle?.id === registro.id}>
                    <TablaDensaCelda className="mono text-xs">{registro.entidad}</TablaDensaCelda>
                    <TablaDensaCelda className="mono text-xs">{registro.idEntidad}</TablaDensaCelda>
                    <TablaDensaCelda>
                      <ChipEstado tono={TONO_ACCION[registro.accion] ?? 'neutro'}>
                        {ETIQUETAS_ACCION_BITACORA[registro.accion] ?? registro.accion}
                      </ChipEstado>
                    </TablaDensaCelda>
                    <TablaDensaCelda className="text-muted-foreground">
                      {registro.nombreUsuario ?? registro.idUsuario ?? '(sistema)'}
                    </TablaDensaCelda>
                    <TablaDensaCelda className="num text-muted-foreground">
                      {formatearFecha(registro.fecha)}
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      {registro.datos !== null ? (
                        <button
                          type="button"
                          className="cursor-pointer text-xs font-medium text-primary underline-offset-2 hover:underline"
                          onClick={() => setDetalle(registro)}
                        >
                          Ver datos
                        </button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TablaDensaCelda>
                  </TablaDensaFila>
                ))
              )}
            </TablaDensaCuerpo>
          </TablaDensa>
        </div>

        {/* Cajon lateral con el JSON del registro elegido. */}
        <CajonDetalle
          abierto={detalle !== null}
          alCambiarAbierto={(abierto) => {
            if (!abierto) setDetalle(null);
          }}
          ancho="amplio"
          titulo={detalle === null ? '' : `${detalle.entidad} · ${detalle.idEntidad}`}
          subtitulo={
            detalle === null
              ? undefined
              : `${ETIQUETAS_ACCION_BITACORA[detalle.accion] ?? detalle.accion} · ${
                  detalle.nombreUsuario ?? detalle.idUsuario ?? '(sistema)'
                } · ${formatearFecha(detalle.fecha)}`
          }
        >
          <pre className="mono overflow-x-auto rounded-lg bg-muted p-3 text-xs">
            {detalle === null ? '' : JSON.stringify(detalle.datos, null, 2)}
          </pre>
        </CajonDetalle>

        {/* Paginacion */}
        {datos && datos.totalPaginas > 1 && (
          <div className="num mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Página {datos.pagina} de {datos.totalPaginas} ({datos.total} registro
              {datos.total !== 1 ? 's' : ''})
            </span>
            <div className="flex gap-1">
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
