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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSesion } from '@/sesion/useSesion';

import { etiquetaMes, etiquetaOrigen, MESES, moneda } from './comun';

function num(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}

/**
 * CONCILIACIÓN DE VENTAS (F7-E2; doc 06-Costos-y-EDR §4, D2 #5): las líneas se PROPONEN al generar el
 * mes; aquí el usuario ajusta el precio a lo FACTURADO y las cantidades, agrega/borra líneas manuales,
 * con filtros por empresa/origen. Marca el origen y las líneas "sin costo". Ver con `edr.ver`; editar
 * con `edr.capturar`.
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

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="edr-conciliacion">
      <header className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
          <ListChecks className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Conciliación de ventas</h1>
          <p className="text-sm text-muted-foreground">
            Ajusta el precio facturado y las cantidades de {etiquetaMes(mes, anio)}. El costo es
            actual (no editable aquí).
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>Líneas</CardTitle>
              <CardDescription>
                {lineas.data
                  ? `${filas.length} línea(s) · ${lineas.data.totalPiezas} pzas · Ventas ${moneda(lineas.data.totalVentas)} · Costo ${moneda(lineas.data.totalCosto)}`
                  : ''}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field className="w-24">
                <FieldLabel htmlFor="con-anio">Año</FieldLabel>
                <Input
                  id="con-anio"
                  type="number"
                  value={anio}
                  onChange={(e) => cambiarPeriodo(num(e.target.value), mes)}
                  data-testid="con-anio"
                />
              </Field>
              <Field className="w-36">
                <FieldLabel htmlFor="con-mes">Mes</FieldLabel>
                <SelectNativo
                  id="con-mes"
                  value={mes}
                  onChange={(e) => cambiarPeriodo(anio, num(e.target.value))}
                  data-testid="con-mes"
                >
                  {MESES.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </SelectNativo>
              </Field>
              <Field className="w-40">
                <FieldLabel htmlFor="con-origen">Origen</FieldLabel>
                <SelectNativo
                  id="con-origen"
                  value={origen}
                  onChange={(e) => setOrigen(e.target.value)}
                  data-testid="con-origen"
                >
                  <option value="">Todos</option>
                  <option value="automatica">Automática</option>
                  <option value="ajustada">Ajustada</option>
                  <option value="manual">Manual</option>
                </SelectNativo>
              </Field>
              <Field className="w-48">
                <FieldLabel htmlFor="con-empresa">Empresa</FieldLabel>
                <SelectNativo
                  id="con-empresa"
                  value={idEmpresa}
                  onChange={(e) => setIdEmpresa(e.target.value)}
                  data-testid="con-empresa"
                >
                  <option value="">Todas</option>
                  {empresasEdr.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nombre}
                    </option>
                  ))}
                </SelectNativo>
              </Field>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {porMes.isPending ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : !porMes.data?.existe ? (
            <p
              className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
              data-testid="con-no-generado"
            >
              El EDR de {etiquetaMes(mes, anio)} aún no se ha generado. Genera el mes primero.
            </p>
          ) : lineas.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {lineas.error.message}
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Orden</TableHead>
                      <TableHead>Empresa</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Modelo</TableHead>
                      <TableHead className="text-right">Cantidad</TableHead>
                      <TableHead className="text-right">Precio fact.</TableHead>
                      <TableHead className="text-right">Importe</TableHead>
                      <TableHead className="text-right">Costo</TableHead>
                      <TableHead>Origen</TableHead>
                      {puedeCapturar && <TableHead className="text-right">Acciones</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filas.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={puedeCapturar ? 10 : 9}
                          className="text-center text-sm text-muted-foreground"
                        >
                          Sin líneas para los filtros elegidos.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filas.map((l) => (
                        <FilaLinea key={l.id} linea={l} puedeCapturar={puedeCapturar} />
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {puedeCapturar && idEdr !== null && <AgregarManual idEdr={idEdr} />}
            </>
          )}
        </CardContent>
      </Card>
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
    <TableRow data-testid={`con-fila-${linea.id}`}>
      <TableCell className="font-medium">
        {linea.folioOrden ? `#${linea.folioOrden}` : '—'}
      </TableCell>
      <TableCell>{linea.empresa}</TableCell>
      <TableCell>{linea.cliente ?? linea.descripcion ?? '—'}</TableCell>
      <TableCell>{linea.modelo ?? '—'}</TableCell>
      <TableCell className="text-right">
        {puedeCapturar ? (
          <Input
            type="number"
            value={cant}
            onChange={(e) => setCant(e.target.value)}
            className="ml-auto w-20 text-right"
            data-testid={`con-cant-${linea.id}`}
          />
        ) : (
          linea.cantVendida
        )}
      </TableCell>
      <TableCell className="text-right">
        {puedeCapturar ? (
          <Input
            type="number"
            step="0.01"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            className="ml-auto w-24 text-right"
            data-testid={`con-precio-${linea.id}`}
          />
        ) : (
          moneda(linea.precioVenta)
        )}
      </TableCell>
      <TableCell className="text-right">{moneda(importe)}</TableCell>
      <TableCell className="text-right">
        {linea.sinCosto ? (
          <span className="text-destructive" title="Sin costo (revisa el costeo)">
            sin costo
          </span>
        ) : (
          moneda(linea.costoActual)
        )}
      </TableCell>
      <TableCell>
        <span className="rounded bg-muted px-2 py-0.5 text-xs">{etiquetaOrigen(linea.origen)}</span>
      </TableCell>
      {puedeCapturar && (
        <TableCell className="text-right">
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
        </TableCell>
      )}
    </TableRow>
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
      <div className="mt-4">
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
    <div className="mt-4 rounded-lg border p-4" data-testid="con-form-manual">
      <h3 className="mb-3 text-sm font-medium">Nueva línea manual</h3>
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
