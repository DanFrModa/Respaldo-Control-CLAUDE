import { ChevronLeft, ChevronRight, ClipboardList } from 'lucide-react';
import { useState } from 'react';

import { useBitacora } from '@/api/bitacora';
import { ETIQUETAS_ACCION_BITACORA } from '@/api/esquemas';
import type { BitacoraQuery } from '@/api/tipos';

/** Tipo de accion para el filtro de la bitacora (solo las claves literales). */
type AccionFiltro = NonNullable<BitacoraQuery['accion']>;
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';

const POR_PAGINA = 20;

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
 * Pantalla de Bitacora — SOLO LECTURA (sin acciones de escritura). Tabla paginada
 * en servidor con filtros por entidad, idEntidad, idUsuario, accion, desde/hasta.
 * El campo `datos` JSON se muestra como texto expandible. Requiere `admin.ver-bitacora`.
 */
export function BitacoraPagina(): React.JSX.Element {
  const [entidad, setEntidad] = useState('');
  const [idEntidad, setIdEntidad] = useState('');
  const [idUsuario, setIdUsuario] = useState('');
  const [accionFiltro, setAccionFiltro] = useState<AccionFiltro | ''>('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [pagina, setPagina] = useState(1);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

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

  function toggleExpandido(id: string): void {
    setExpandidos((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(id)) {
        nuevo.delete(id);
      } else {
        nuevo.add(id);
      }
      return nuevo;
    });
  }

  const datos = consulta.data;
  const totalPaginas = datos?.totalPaginas ?? 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl p-4 lg:p-6">
        {/* Encabezado */}
        <div className="flex items-center gap-3">
          <ClipboardList className="size-6 text-teal-600" aria-hidden />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Bitácora</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
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

        {/* Tabla */}
        <div className="mt-4 overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Entidad</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                  Id registro
                </th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Acción</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Usuario</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Fecha</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Datos</th>
              </tr>
            </thead>
            <tbody>
              {consulta.isPending ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-t">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-3 py-2">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : consulta.isError ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-destructive">
                    {consulta.error.message}
                  </td>
                </tr>
              ) : datos?.datos.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-6 text-center text-muted-foreground"
                    data-testid="bitacora-vacia"
                  >
                    No hay registros en la bitácora con los filtros actuales.
                  </td>
                </tr>
              ) : (
                (datos?.datos ?? []).map((registro) => (
                  <tr key={registro.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">{registro.entidad}</td>
                    <td className="px-3 py-2 font-mono text-xs">{registro.idEntidad}</td>
                    <td className="px-3 py-2">
                      <Badge
                        variant={
                          registro.accion === 'CREAR'
                            ? 'default'
                            : registro.accion === 'DESACTIVAR' || registro.accion === 'CANCELAR'
                              ? 'destructive'
                              : 'secondary'
                        }
                      >
                        {ETIQUETAS_ACCION_BITACORA[registro.accion] ?? registro.accion}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {registro.nombreUsuario ?? registro.idUsuario ?? '(sistema)'}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatearFecha(registro.fecha)}
                    </td>
                    <td className="px-3 py-2">
                      {registro.datos !== null ? (
                        <div>
                          <button
                            type="button"
                            className="text-xs text-primary underline-offset-2 hover:underline"
                            onClick={() => toggleExpandido(registro.id)}
                          >
                            {expandidos.has(registro.id) ? 'Ocultar' : 'Ver datos'}
                          </button>
                          {expandidos.has(registro.id) && (
                            <pre className="mt-1 max-w-xs overflow-x-auto rounded bg-muted p-1 text-xs">
                              {JSON.stringify(registro.datos, null, 2)}
                            </pre>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Paginacion */}
        {datos && datos.totalPaginas > 1 && (
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
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
