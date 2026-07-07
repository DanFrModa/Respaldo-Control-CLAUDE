import { History, Loader2, Lock, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useCapturarPrecio, useEventosPrecioOrden, usePreciosOrden } from '@/api/ordenes-centro';
import { useProveedores, useRolesProveedor } from '@/api/proveedores';
import type { CampoPrecioOrden, OrdenPrecios } from '@/api/tipos';
import { ComboboxBuscable } from '@/components/dominio/ComboboxBuscable';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/lib/useDebounce';
import { cn } from '@/lib/utils';
import { useSesion } from '@/sesion/useSesion';

/**
 * PANEL DE PRECIOS de la orden (rediseño R2, §4.4.3 — proto `precioEditable`): venta / maquila /
 * aplicación / costo 🔒. El precio REAL capturado se pinta VERDE con el tag "real"; sin captura se
 * muestra la REFERENCIA (heredada del modelo) en gris con el tag "referencia". Debajo, el rastro
 * "capturó [usuario] · fecha · proveedor" del último evento (historial inmutable D3/A7).
 *
 * Permisos (la pantalla esconde; el servidor decide, A1):
 *  - `ordenes.precio-maquila` → botón "editar" (capturar el precio real negociado).
 *  - `ordenes.ver-precio-real-maquila` → ver los montos reales (si falta, el API los manda null y
 *    aquí se pintan •••••).
 *  - `pedidos.importes` → ver el precio de venta.
 */
export function PanelPreciosOrden({ idOrden }: { idOrden: number }): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeEditar = tienePermiso('ordenes.precio-maquila');
  const puedeVerImportes = tienePermiso('pedidos.importes');
  const precios = usePreciosOrden(idOrden);
  const [editando, setEditando] = useState<CampoPrecioOrden | null>(null);
  const [historialAbierto, setHistorialAbierto] = useState(false);

  if (precios.isPending) {
    return <p className="text-sm text-muted-foreground">Cargando precios…</p>;
  }
  if (precios.isError) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {precios.error.message}
      </p>
    );
  }
  const datos = precios.data;

  return (
    <>
      <div className="grid grid-cols-2 gap-3" data-testid="panel-precios">
        {/* ••••• SOLO cuando el monto está oculto por PERMISO; si el pedido no trae precio se
            dice "Sin precio" (no es un secreto, es una ausencia — hallazgo del reviewer). */}
        <CampoPrecio
          etiqueta="Precio de venta"
          monto={datos.precioVenta}
          oculto={!puedeVerImportes}
          textoOculto="•••••"
        />
        <CampoPrecioEditable
          etiqueta="Precio maquila"
          campo="maquila"
          real={datos.maquilaReal}
          referencia={datos.maquilaReferencia}
          puedeVerReales={datos.puedeVerReales}
          evento={datos.ultimoEventoMaquila}
          puedeEditar={puedeEditar}
          alEditar={() => setEditando('maquila')}
        />
        <CampoPrecioEditable
          etiqueta="Precio aplicación"
          campo="aplicacion"
          real={datos.aplicacionReal}
          referencia={null}
          puedeVerReales={datos.puedeVerReales}
          evento={datos.ultimoEventoAplicacion}
          puedeEditar={puedeEditar}
          alEditar={() => setEditando('aplicacion')}
        />
        <CampoPrecio
          etiqueta={
            <span className="inline-flex items-center gap-1">
              Costo
              <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
                <Lock className="size-2.5" aria-hidden />
                restringido
              </span>
            </span>
          }
          monto={null}
          oculto
          textoOculto="•••••"
        />
      </div>

      {/* Historial inmutable (D3/A7): cierra el ciclo del rastro que pidió Daniel §4.4.3. Solo
          para quien puede ver montos reales (el endpoint exige el permiso). */}
      {datos.puedeVerReales ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setHistorialAbierto((v) => !v)}
            className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
            data-testid="precios-ver-historial"
          >
            <History className="size-3" aria-hidden />
            {historialAbierto ? 'Ocultar historial de precios' : 'Ver historial de precios'}
          </button>
          {historialAbierto ? <HistorialPrecios idOrden={idOrden} /> : null}
        </div>
      ) : null}

      {editando !== null ? (
        <DialogoEditarPrecio
          idOrden={idOrden}
          campo={editando}
          datos={datos}
          alCerrar={() => setEditando(null)}
        />
      ) : null}
    </>
  );
}

/** Historial inmutable de cambios de precio (anterior→nuevo · proveedor · capturó · fecha). */
function HistorialPrecios({ idOrden }: { idOrden: number }): React.JSX.Element {
  const eventos = useEventosPrecioOrden(idOrden);
  if (eventos.isPending) {
    return <p className="mt-1 text-xs text-muted-foreground">Cargando historial…</p>;
  }
  if (eventos.isError) {
    return (
      <p className="mt-1 text-xs text-destructive" role="alert">
        {eventos.error.message}
      </p>
    );
  }
  const lista = eventos.data.eventos;
  if (lista.length === 0) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        Aún no se captura ningún precio real en esta orden.
      </p>
    );
  }
  const monto = (v: number | null): string => (v === null ? '—' : `$${v.toFixed(2)}`);
  return (
    <ul className="mt-1.5 space-y-1" data-testid="precios-historial">
      {lista.map((evento) => (
        <li
          key={evento.id}
          className="rounded-md border bg-panel-2 px-2.5 py-1.5 text-[11px]"
          data-testid="precios-evento"
        >
          <span className="font-semibold">
            {evento.campo === 'maquila' ? 'Maquila' : 'Aplicación'}
          </span>{' '}
          · <span className="num">{monto(evento.precioAnterior)}</span> →{' '}
          <span className="num font-semibold text-ok">{monto(evento.precioNuevo)}</span>
          {evento.proveedor !== null ? (
            <span className="text-muted-foreground"> · con {evento.proveedor}</span>
          ) : null}
          <span className="block text-[10.5px] text-faint">
            capturó {evento.capturadoPor ?? '—'} ·{' '}
            {new Date(evento.capturadoEn).toLocaleDateString('es-MX')}
            {evento.nota !== null ? ` · ${evento.nota}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Campo de precio simple (venta / costo restringido). Distingue OCULTO por permiso (•••••) de
 * AUSENTE (el dato simplemente no existe → "Sin precio").
 */
function CampoPrecio({
  etiqueta,
  monto,
  oculto,
  textoOculto,
}: {
  etiqueta: React.ReactNode;
  monto: number | null;
  oculto: boolean;
  textoOculto: string;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border bg-panel-2 px-3 py-2">
      <p className="text-[11px] font-medium text-muted-foreground">{etiqueta}</p>
      <p className="num text-sm font-semibold tracking-wide">
        {oculto ? (
          <span className="tracking-[2px] text-faint">{textoOculto}</span>
        ) : monto === null ? (
          <span className="font-normal text-faint">Sin precio</span>
        ) : (
          `$${monto.toFixed(2)}`
        )}
      </p>
    </div>
  );
}

/** Campo de precio con "real" (verde) vs "referencia" (gris), botón editar 🔒 y rastro A7. */
function CampoPrecioEditable({
  etiqueta,
  campo,
  real,
  referencia,
  puedeVerReales,
  evento,
  puedeEditar,
  alEditar,
}: {
  etiqueta: string;
  campo: CampoPrecioOrden;
  real: number | null;
  referencia: number | null;
  puedeVerReales: boolean;
  evento: OrdenPrecios['ultimoEventoMaquila'];
  puedeEditar: boolean;
  alEditar: () => void;
}): React.JSX.Element {
  // Hay captura real si existe un evento; el monto puede venir null por falta de permiso de ver.
  const hayReal = evento !== null || real !== null;
  const montoVisible = real ?? (hayReal ? null : referencia);
  return (
    <div className="rounded-lg border bg-panel-2 px-3 py-2" data-testid={`precio-${campo}`}>
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {etiqueta}
        {puedeEditar ? (
          <button
            type="button"
            onClick={alEditar}
            className="inline-flex cursor-pointer items-center gap-0.5 rounded px-1 text-[10.5px] font-semibold text-primary hover:bg-primary-soft"
            data-testid={`precio-${campo}-editar`}
          >
            <Pencil className="size-2.5" aria-hidden />
            editar
          </button>
        ) : null}
      </p>
      <p className="num text-sm font-semibold">
        {montoVisible === null ? (
          hayReal && !puedeVerReales ? (
            <span className="tracking-[2px] text-faint">•••••</span>
          ) : (
            <span className="text-faint">—</span>
          )
        ) : (
          <span className={cn(hayReal ? 'text-ok' : 'text-muted-foreground')}>
            ${montoVisible.toFixed(2)}
          </span>
        )}{' '}
        <span
          className={cn(
            'rounded-full px-1.5 text-[10px] font-medium',
            hayReal ? 'bg-ok-soft text-ok' : 'bg-muted text-muted-foreground',
          )}
        >
          {hayReal ? 'real' : 'referencia'}
        </span>
      </p>
      {evento !== null ? (
        <p
          className="mt-0.5 truncate text-[10.5px] text-faint"
          data-testid={`precio-${campo}-rastro`}
        >
          capturó {evento.capturadoPor ?? '—'} ·{' '}
          {new Date(evento.capturadoEn).toLocaleDateString('es-MX')}
          {evento.proveedor !== null ? ` · ${evento.proveedor}` : ''}
        </p>
      ) : null}
    </div>
  );
}

/** Diálogo de captura del precio real negociado (deja el rastro inmutable en el servidor). */
function DialogoEditarPrecio({
  idOrden,
  campo,
  datos,
  alCerrar,
}: {
  idOrden: number;
  campo: CampoPrecioOrden;
  datos: OrdenPrecios;
  alCerrar: () => void;
}): React.JSX.Element {
  const { sesion } = useSesion();
  const capturar = useCapturarPrecio();
  const esMaquila = campo === 'maquila';
  const referencia = esMaquila ? datos.maquilaReferencia : null;
  const realActual = esMaquila ? datos.maquilaReal : datos.aplicacionReal;

  const [precio, setPrecio] = useState(realActual === null ? '' : String(realActual));
  const [idProveedor, setIdProveedor] = useState<number | null>(null);
  const [nota, setNota] = useState('');
  // El typeahead busca EN SERVIDOR (>1,700 maquileros reales; la página local de 100 no basta).
  const [textoProveedor, setTextoProveedor] = useState('');
  const busquedaProveedor = useDebounce(textoProveedor.trim(), 250);

  useEffect(() => {
    setPrecio(realActual === null ? '' : String(realActual));
  }, [realActual]);

  // Con quién se negoció: maquila filtra por rol de costura; aplicación lista todos (el
  // estampador/bordador puede ser cualquier proveedor de servicio).
  const roles = useRolesProveedor();
  const idRolCostura = roles.data?.find((r) => r.codigo === 'maquila-costura')?.id;
  const proveedores = useProveedores({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
    ...(esMaquila && idRolCostura !== undefined ? { rol: idRolCostura } : {}),
    ...(busquedaProveedor === '' ? {} : { busqueda: busquedaProveedor }),
  });
  const opciones = (proveedores.data?.datos ?? []).map((p) => ({ id: p.id, nombre: p.nombre }));

  const monto = Number(precio);
  const valido = precio.trim() !== '' && Number.isFinite(monto) && monto >= 0;

  function guardar(): void {
    if (!valido) return;
    capturar.mutate(
      {
        idOrden,
        cuerpo: {
          campo,
          precio: monto,
          ...(idProveedor === null ? {} : { idProveedor }),
          ...(nota.trim() === '' ? {} : { nota: nota.trim() }),
        },
      },
      {
        onSuccess: () => {
          toast.success(`Precio actualizado · registrado por ${sesion?.nombre ?? 'la sesión'}`);
          alCerrar();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(abierto) => (abierto ? undefined : alCerrar())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Precio de {esMaquila ? 'maquila' : 'aplicación'} · OP {datos.folioOrden}
          </DialogTitle>
          <DialogDescription>
            El precio real negociado sustituye a la referencia y deja rastro de quién lo capturó.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <Field>
            <FieldLabel htmlFor="precio-referencia">Precio de referencia (del modelo)</FieldLabel>
            <Input
              id="precio-referencia"
              value={referencia === null ? 'Sin referencia' : `$${referencia.toFixed(2)}`}
              disabled
            />
          </Field>
          <Field data-invalid={!valido}>
            <FieldLabel htmlFor="precio-real">Precio real negociado ($) *</FieldLabel>
            <Input
              id="precio-real"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              data-testid="precio-real-input"
            />
          </Field>
          <Field>
            <FieldLabel>Negociado con</FieldLabel>
            <ComboboxBuscable
              opciones={opciones}
              valor={idProveedor}
              onChange={setIdProveedor}
              alCambiarTexto={setTextoProveedor}
              placeholder="Escribe el proveedor…"
              etiqueta="Proveedor con quien se negoció"
              testid="precio-proveedor"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="precio-nota">Nota</FieldLabel>
            <Input
              id="precio-nota"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Opcional"
            />
          </Field>
          <p className="flex items-center gap-1.5 rounded-md bg-panel-2 px-2.5 py-1.5 text-xs text-muted-foreground">
            <Lock className="size-3 shrink-0" aria-hidden />
            Quedará registrado que lo capturó <b>{sesion?.nombre ?? 'la sesión'}</b> hoy.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={alCerrar} disabled={capturar.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={guardar}
            disabled={!valido || capturar.isPending}
            data-testid="precio-guardar"
          >
            {capturar.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Guardar precio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
