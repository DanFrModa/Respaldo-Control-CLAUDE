import { useState } from 'react';

import { useReferenciasCambiadas } from '@/api/referencias-maquila';
import type { ReferenciaCambio, ReferenciasCambiosQuery } from '@/api/tipos';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * ⭐ Fila 0.242 (§Post-F9.255) — REFERENCIAS DE MAQUILA CAMBIADAS y SOBREPRECIOS AUTORIZADOS.
 *
 * Producción captura el precio de maquila Y su referencia (el tope = referencia + 5 %). El control que
 * sostiene eso es que **todo cambio de referencia deja rastro** y que Daniel lo puede ver aquí, en la
 * misma lista que las veces que alguien con su autorización se pasó del tope: qué orden, qué proceso,
 * de cuánto a cuánto, quién y cuándo. Sin esta consulta el rastro existiría y nadie lo miraría.
 *
 * Sólo lectura, con la llave reservada `ordenes.autorizar-sobreprecio` (la decide el backend, A1).
 */
export function ReferenciasCambiadasPagina(): React.JSX.Element {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [folio, setFolio] = useState('');
  const [soloSobreprecios, setSoloSobreprecios] = useState(false);

  const folioNum = Number(folio);
  const query: ReferenciasCambiosQuery = {
    ...(desde === '' ? {} : { desde }),
    ...(hasta === '' ? {} : { hasta }),
    ...(folio.trim() !== '' && Number.isInteger(folioNum) && folioNum > 0
      ? { folio: folioNum }
      : {}),
    ...(soloSobreprecios ? { soloSobreprecios: 'true' } : {}),
  };
  const consulta = useReferenciasCambiadas(query);
  const eventos = consulta.data?.eventos ?? [];

  return (
    <div className="h-full overflow-y-auto" data-testid="referencias-cambiadas">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6">
        <div>
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Referencias de maquila cambiadas
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Cada cambio de la referencia de precio de una orden (el tope de lo que se le paga al
            taller) y cada precio que se autorizó por encima del tope.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Desde</span>
            <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Hasta</span>
            <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">OP</span>
            <Input
              inputMode="numeric"
              value={folio}
              onChange={(e) => setFolio(e.target.value)}
              placeholder="Folio"
              className="w-28"
              data-testid="referencias-filtro-folio"
            />
          </label>
          <label className="flex items-center gap-1.5 pb-2">
            <input
              type="checkbox"
              checked={soloSobreprecios}
              onChange={(e) => setSoloSobreprecios(e.target.checked)}
              data-testid="referencias-solo-sobreprecios"
            />
            Sólo sobreprecios autorizados
          </label>
        </div>

        {consulta.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {consulta.error.message}
          </p>
        ) : consulta.isPending ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : eventos.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="referencias-vacio">
            No hay cambios de referencia con esos filtros.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cuándo</TableHead>
                  <TableHead>OP</TableHead>
                  <TableHead>Proceso</TableHead>
                  <TableHead>Qué pasó</TableHead>
                  <TableHead className="text-right">De</TableHead>
                  <TableHead className="text-right">A</TableHead>
                  <TableHead>Quién</TableHead>
                  <TableHead>Nota</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eventos.map((e) => (
                  <FilaCambio key={e.id} evento={e} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {consulta.data?.truncado === true ? (
          <p className="text-xs text-warn">
            Se muestran los {consulta.data.limite} más recientes: afina los filtros para ver el
            resto.
          </p>
        ) : null}
      </div>
    </div>
  );
}

const ETIQUETA_PUNTO: Record<NonNullable<ReferenciaCambio['punto']>, string> = {
  orden_maquila: 'precio de maquila de la orden',
  orden_aplicacion: 'precio de aplicación de la orden',
  envio: 'salida a maquila',
  recibo: 'recibo de maquila',
  cargo_esma: 'validación del cargo EsMa',
};

/** Qué pasó, en palabras del negocio. */
function queTexto(e: ReferenciaCambio): string {
  switch (e.accion) {
    case 'prellenado':
      return 'Nació del precosto';
    case 'captura':
      return 'Referencia cambiada';
    case 'arte':
      return 'Precio de arte cambiado';
    case 'sobreprecio':
      return `Sobreprecio autorizado (${e.punto === null ? '—' : ETIQUETA_PUNTO[e.punto]})`;
  }
}

const pesos = (v: number | null): string => (v === null ? '—' : `$${v.toFixed(2)}`);

function FilaCambio({ evento }: { evento: ReferenciaCambio }): React.JSX.Element {
  const esSobre = evento.accion === 'sobreprecio';
  return (
    <TableRow data-testid="referencias-fila" className={cn(esSobre && 'bg-warn-soft/40')}>
      <TableCell className="text-xs whitespace-nowrap">
        {new Date(evento.capturadoEn).toLocaleString('es-MX', {
          dateStyle: 'short',
          timeStyle: 'short',
        })}
      </TableCell>
      <TableCell className="num">{evento.folioOrden}</TableCell>
      <TableCell>{evento.proceso ?? 'Todos los artes'}</TableCell>
      <TableCell className={cn('text-xs', esSobre && 'font-semibold text-warn')}>
        {queTexto(evento)}
      </TableCell>
      {/* En un sobreprecio, «De» es la referencia vigente y «A» el precio que se autorizó. */}
      <TableCell className="num text-right">
        {pesos(esSobre ? evento.referenciaNueva : evento.referenciaAnterior)}
      </TableCell>
      <TableCell className="num text-right font-semibold">
        {pesos(esSobre ? evento.precioAutorizado : evento.referenciaNueva)}
      </TableCell>
      <TableCell className="text-xs">{evento.capturadoPor ?? '—'}</TableCell>
      <TableCell className="max-w-56 truncate text-xs text-muted-foreground">
        {evento.nota ?? ''}
      </TableCell>
    </TableRow>
  );
}
