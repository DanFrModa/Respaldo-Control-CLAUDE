import { ListChecks, Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { useClientes } from '@/api/clientes';
import {
  useAgregarLineaManual,
  useAjustarLinea,
  useEdrLineas,
  useEdrPorMes,
  useEliminarLinea,
} from '@/api/edr';
import { useEmpresas } from '@/api/empresas';
import type { EdrLinea, EdrLineasQuery, EdrOrigenLinea } from '@/api/tipos';
import { ChipEstado, type TonoEstado } from '@/components/dominio/ChipEstado';
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
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useSesion } from '@/sesion/useSesion';

import { etiquetaMes, etiquetaOrigen, MESES, moneda } from './comun';

function num(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}

/** Tono del chip por origen de la línea. */
const TONO_ORIGEN: Record<EdrLinea['origen'], TonoEstado> = {
  automatica: 'neutro',
  ajustada: 'warn',
  manual: 'info',
};

/**
 * CONCILIACIÓN DE VENTAS (F7-E2; doc 06-Costos-y-EDR §4, D2 #5; re-vestida R9 a TABLA-FIRST): las líneas
 * se PROPONEN al generar el mes; aquí el usuario ajusta el precio a lo FACTURADO y las cantidades,
 * agrega/borra líneas manuales, con filtros por empresa/origen. page-head + KPIs de vistazo (Σ de
 * SERVIDOR) + toolbar + TABLA DENSA con celdas editables. Ver con `edr.ver`; editar con `edr.capturar`.
 */
export function ConciliacionPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeCapturar = tienePermiso('edr.capturar');
  const [params, setParams] = useSearchParams();
  const hoy = new Date();
  const anio = num(params.get('anio') ?? '') || hoy.getFullYear();
  const mes = num(params.get('mes') ?? '') || hoy.getMonth() + 1;

  const [origen, setOrigen] = useState('');
  const [idEmpresa, setIdEmpresa] = useState('');

  const porMes = useEdrPorMes(anio, mes);
  const idEdr = porMes.data?.edr?.encabezado.id ?? null;

  const query: EdrLineasQuery = {
    ...(origen === '' ? {} : { origen: origen as EdrOrigenLinea }),
    ...(idEmpresa === '' ? {} : { idEmpresa: Number(idEmpresa) }),
  };
  const lineas = useEdrLineas(idEdr, query);
  const empresas = useEmpresas();
  const empresasEdr = (empresas.data ?? []).filter((e) => e.paraEdr);

  function cambiarPeriodo(a: number, m: number): void {
    setParams({ anio: String(a), mes: String(m) });
  }

  const filas = lineas.data?.lineas ?? [];

  const kpis: Kpi[] = [
    {
      clave: 'lineas',
      etiqueta: 'Líneas',
      valor: filas.length.toLocaleString('es-MX'),
      pie: 'con los filtros',
    },
    {
      clave: 'piezas',
      etiqueta: 'Piezas',
      valor: (lineas.data?.totalPiezas ?? 0).toLocaleString('es-MX'),
      pie: 'vendidas',
    },
    {
      clave: 'ventas',
      etiqueta: 'Ventas',
      valor: moneda(lineas.data?.totalVentas ?? 0),
      pie: 'facturado',
    },
    {
      clave: 'costo',
      etiqueta: 'Costo',
      valor: moneda(lineas.data?.totalCosto ?? 0),
      pie: 'actual',
    },
  ];

  return (
    <div className="h-full overflow-y-auto" data-testid="edr-conciliacion">
      <div className="flex flex-col gap-3 p-4 md:p-5">
        {/* ── Encabezado ─────────────────────────────────────────────────────── */}
        <header className="flex shrink-0 flex-wrap items-center gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"
          >
            <ListChecks className="size-4.5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">Conciliación de ventas</h1>
            <p className="truncate text-xs text-muted-foreground">
              Ajusta el precio facturado y las cantidades de {etiquetaMes(mes, anio)} · el costo es
              actual
            </p>
          </div>
        </header>

        {/* ── KPIs ────────────────────────────────────────────────────────────── */}
        {porMes.data?.existe ? <KpiTiles kpis={kpis} className="shrink-0" /> : null}

        {/* ── Card: filtros + tabla ───────────────────────────────────────────── */}
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
            <SelectNativo
              className="h-8 w-24 text-sm"
              value={anio}
              onChange={(e) => cambiarPeriodo(num(e.target.value), mes)}
              aria-label="Año"
              data-testid="con-anio"
            >
              {Array.from({ length: 6 }, (_, i) => hoy.getFullYear() - i).map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </SelectNativo>
            <SelectNativo
              className="h-8 w-auto text-sm"
              value={mes}
              onChange={(e) => cambiarPeriodo(anio, num(e.target.value))}
              aria-label="Mes"
              data-testid="con-mes"
            >
              {MESES.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </SelectNativo>
            <SelectNativo
              className="h-8 w-auto text-sm"
              value={origen}
              onChange={(e) => setOrigen(e.target.value)}
              aria-label="Origen"
              data-testid="con-origen"
            >
              <option value="">Todo origen</option>
              <option value="automatica">Automática</option>
              <option value="ajustada">Ajustada</option>
              <option value="manual">Manual</option>
            </SelectNativo>
            <SelectNativo
              className="h-8 w-auto text-sm"
              value={idEmpresa}
              onChange={(e) => setIdEmpresa(e.target.value)}
              aria-label="Empresa"
              data-testid="con-empresa"
            >
              <option value="">Todas las empresas</option>
              {empresasEdr.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </SelectNativo>
            <div className="ml-auto">
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {filas.length.toLocaleString('es-MX')} líneas
              </span>
            </div>
          </div>

          {porMes.isPending ? (
            <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
          ) : !porMes.data?.existe ? (
            <p
              className="p-6 text-center text-sm text-muted-foreground"
              data-testid="con-no-generado"
            >
              El EDR de {etiquetaMes(mes, anio)} aún no se ha generado. Genera el mes primero.
            </p>
          ) : lineas.isError ? (
            <p className="p-6 text-sm text-destructive" role="alert">
              {lineas.error.message}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <TablaDensa>
                <TablaDensaEncabezado>
                  <TablaDensaFila>
                    <TablaDensaHead>Orden</TablaDensaHead>
                    <TablaDensaHead>Empresa</TablaDensaHead>
                    <TablaDensaHead>Cliente</TablaDensaHead>
                    <TablaDensaHead>Modelo</TablaDensaHead>
                    <TablaDensaHead numerica>Cantidad</TablaDensaHead>
                    <TablaDensaHead numerica>Precio fact.</TablaDensaHead>
                    <TablaDensaHead numerica>Importe</TablaDensaHead>
                    <TablaDensaHead numerica>Costo</TablaDensaHead>
                    <TablaDensaHead>Origen</TablaDensaHead>
                    {puedeCapturar && (
                      <TablaDensaHead className="text-right">Acciones</TablaDensaHead>
                    )}
                  </TablaDensaFila>
                </TablaDensaEncabezado>
                <TablaDensaCuerpo>
                  {filas.length === 0 ? (
                    <TablaDensaFila>
                      <TablaDensaCelda
                        colSpan={puedeCapturar ? 10 : 9}
                        className="text-center text-muted-foreground"
                      >
                        Sin líneas para los filtros elegidos.
                      </TablaDensaCelda>
                    </TablaDensaFila>
                  ) : (
                    filas.map((l) => (
                      <FilaLinea key={l.id} linea={l} puedeCapturar={puedeCapturar} />
                    ))
                  )}
                </TablaDensaCuerpo>
              </TablaDensa>
            </div>
          )}
        </div>

        {puedeCapturar && porMes.data?.existe && idEdr !== null && <AgregarManual idEdr={idEdr} />}
      </div>
    </div>
  );
}

/** Una fila editable de la conciliación (cantidad + precio facturado). */
function FilaLinea(props: { linea: EdrLinea; puedeCapturar: boolean }): React.JSX.Element {
  const { linea, puedeCapturar } = props;
  const [cant, setCant] = useState(String(linea.cantVendida));
  const [precio, setPrecio] = useState(String(linea.precioVenta));
  const ajustar = useAjustarLinea();
  const eliminar = useEliminarLinea();

  const importe = num(cant) * num(precio);

  function guardar(): void {
    ajustar.mutate(
      { idLinea: linea.id, cuerpo: { cantVendida: num(cant), precioVenta: num(precio) } },
      {
        onSuccess: () => toast.success('Línea ajustada.'),
        onError: (e) => toast.error(e.message),
      },
    );
  }

  function borrar(): void {
    eliminar.mutate(linea.id, {
      onSuccess: () => toast.success('Línea eliminada.'),
      onError: (e) => toast.error(e.message),
    });
  }

  return (
    <TablaDensaFila data-testid={`con-fila-${linea.id}`}>
      <TablaDensaCelda className="font-medium">
        {linea.folioOrden ? `#${linea.folioOrden}` : '—'}
      </TablaDensaCelda>
      <TablaDensaCelda>{linea.empresa}</TablaDensaCelda>
      <TablaDensaCelda>{linea.cliente ?? linea.descripcion ?? '—'}</TablaDensaCelda>
      <TablaDensaCelda>{linea.modelo ?? '—'}</TablaDensaCelda>
      <TablaDensaCelda numerica>
        {puedeCapturar ? (
          <Input
            type="number"
            value={cant}
            onChange={(e) => setCant(e.target.value)}
            className="ml-auto h-7 w-20 text-right"
            data-testid={`con-cant-${linea.id}`}
          />
        ) : (
          linea.cantVendida
        )}
      </TablaDensaCelda>
      <TablaDensaCelda numerica>
        {puedeCapturar ? (
          <Input
            type="number"
            step="0.01"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            className="ml-auto h-7 w-24 text-right"
            data-testid={`con-precio-${linea.id}`}
          />
        ) : (
          moneda(linea.precioVenta)
        )}
      </TablaDensaCelda>
      <TablaDensaCelda numerica>{moneda(importe)}</TablaDensaCelda>
      <TablaDensaCelda numerica>
        {linea.sinCosto ? (
          <span className="text-crit" title="Sin costo (revisa el costeo)">
            sin costo
          </span>
        ) : (
          moneda(linea.costoActual)
        )}
      </TablaDensaCelda>
      <TablaDensaCelda>
        <ChipEstado tono={TONO_ORIGEN[linea.origen]} sinPunto>
          {etiquetaOrigen(linea.origen)}
        </ChipEstado>
      </TablaDensaCelda>
      {puedeCapturar && (
        <TablaDensaCelda className="text-right">
          <div className="flex justify-end gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={guardar}
              disabled={ajustar.isPending}
              data-testid={`con-guardar-${linea.id}`}
            >
              <Save className="size-4" aria-hidden />
            </Button>
            {linea.origen === 'manual' && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={borrar}
                disabled={eliminar.isPending}
                data-testid={`con-borrar-${linea.id}`}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            )}
          </div>
        </TablaDensaCelda>
      )}
    </TablaDensaFila>
  );
}

/** Formulario para agregar una línea manual (empresa paraEdr + cliente + cantidad + precio). */
function AgregarManual(props: { idEdr: number }): React.JSX.Element {
  const [abierto, setAbierto] = useState(false);
  const [idEmpresa, setIdEmpresa] = useState('');
  const [idCliente, setIdCliente] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [cant, setCant] = useState('');
  const [precio, setPrecio] = useState('');

  const empresas = useEmpresas();
  const empresasEdr = (empresas.data ?? []).filter((e) => e.paraEdr);
  const clientes = useClientes({ porPagina: 100 });
  const agregar = useAgregarLineaManual();

  function guardar(): void {
    if (idEmpresa === '' || idCliente === '') {
      toast.error('Elige empresa y cliente.');
      return;
    }
    agregar.mutate(
      {
        idEdr: props.idEdr,
        cuerpo: {
          idEmpresa: Number(idEmpresa),
          idCliente: Number(idCliente),
          descripcion: descripcion === '' ? null : descripcion,
          cantVendida: num(cant),
          precioVenta: num(precio),
        },
      },
      {
        onSuccess: () => {
          toast.success('Línea manual agregada.');
          setDescripcion('');
          setCant('');
          setPrecio('');
        },
        onError: (e) => toast.error(e.message),
      },
    );
  }

  if (!abierto) {
    return (
      <div>
        <Button
          type="button"
          variant="outline"
          onClick={() => setAbierto(true)}
          data-testid="con-abrir-manual"
        >
          <Plus className="mr-2 size-4" aria-hidden />
          Agregar línea manual
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-4" data-testid="con-form-manual">
      <h3 className="mb-3 text-sm font-semibold">Nueva línea manual</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field>
          <FieldLabel htmlFor="man-empresa">Empresa</FieldLabel>
          <SelectNativo
            id="man-empresa"
            value={idEmpresa}
            onChange={(e) => setIdEmpresa(e.target.value)}
            data-testid="man-empresa"
          >
            <option value="">Elige…</option>
            {empresasEdr.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </SelectNativo>
        </Field>
        <Field>
          <FieldLabel htmlFor="man-cliente">Cliente</FieldLabel>
          <SelectNativo
            id="man-cliente"
            value={idCliente}
            onChange={(e) => setIdCliente(e.target.value)}
            data-testid="man-cliente"
          >
            <option value="">Elige…</option>
            {(clientes.data?.datos ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </SelectNativo>
        </Field>
        <Field>
          <FieldLabel htmlFor="man-desc">Descripción</FieldLabel>
          <Input
            id="man-desc"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            data-testid="man-desc"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="man-cant">Cantidad</FieldLabel>
          <Input
            id="man-cant"
            type="number"
            value={cant}
            onChange={(e) => setCant(e.target.value)}
            data-testid="man-cant"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="man-precio">Precio facturado</FieldLabel>
          <Input
            id="man-precio"
            type="number"
            step="0.01"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            data-testid="man-precio"
          />
        </Field>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          onClick={guardar}
          disabled={agregar.isPending}
          data-testid="man-guardar"
        >
          {agregar.isPending ? 'Agregando…' : 'Agregar'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setAbierto(false)}>
          Cerrar
        </Button>
      </div>
    </div>
  );
}
