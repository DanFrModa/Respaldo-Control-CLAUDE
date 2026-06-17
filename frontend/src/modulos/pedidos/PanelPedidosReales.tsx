import { PackageCheck, PencilIcon, PlusIcon, Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  useActualizarPedidoReal,
  useActualizarSeguimiento,
  useCrearPedidoReal,
  usePedidosReales,
} from '@/api/pedidos';
import type {
  PedidoReal,
  PedidoRealCrear,
  PedidoRealEditar,
  PedidoRealSeguimiento,
} from '@/api/tipos';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatearFecha } from '@/lib/formato';

/** Campos del ENCABEZADO de un pedido real, en el formulario (todo texto del input). */
interface DatosEncabezadoReal {
  numPedReal: string;
  cedis: string;
  apertura: string;
  fechaPedPR: string;
  fechaInicio: string;
  fechaFin: string;
}

/** Encabezado vacío (alta). */
const ENCABEZADO_VACIO: DatosEncabezadoReal = {
  numPedReal: '',
  cedis: '',
  apertura: '',
  fechaPedPR: '',
  fechaInicio: '',
  fechaFin: '',
};

/** Texto de un campo opcional en el cuerpo de ALTA: omite si está vacío. */
function textoCrear(valor: string): string | undefined {
  const limpio = valor.trim();
  return limpio.length > 0 ? limpio : undefined;
}

/** Texto de un campo opcional en el cuerpo de EDICIÓN: `null` si quedó vacío (M1, vaciar). */
function textoEditar(valor: string): string | null {
  const limpio = valor.trim();
  return limpio.length > 0 ? limpio : null;
}

/**
 * Panel de PEDIDOS REALES de un pedido (doc 02 §1, §4.4): lista las liberaciones del cliente,
 * permite crear una nueva (réplica automática de renglones en el backend), EDITAR su encabezado
 * (número/CEDIS/apertura/fechas) y capturar el seguimiento por renglón (cantidades enviada/
 * entregada). Solo se muestran las acciones de escritura si `puedeAdministrarReales`
 * (`pedidos-reales.administrar`); el backend decide (A1).
 *
 * NOTA F2-E1: la CANCELACIÓN de un pedido real está DIFERIDA (pendiente de decisión de Daniel):
 * no hay botón de cancelar aquí.
 */
export function PanelPedidosReales({
  idPedido,
  puedeAdministrarReales,
}: {
  idPedido: number;
  puedeAdministrarReales: boolean;
}): React.JSX.Element {
  const consulta = usePedidosReales(idPedido);
  const [altaAbierta, setAltaAbierta] = useState(false);

  if (consulta.isPending) {
    return <p className="text-sm text-muted-foreground">Cargando pedidos reales…</p>;
  }
  if (consulta.isError) {
    return <p className="text-sm text-destructive">{consulta.error.message}</p>;
  }

  const reales = consulta.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {reales.length === 0
            ? 'Este pedido aún no tiene pedidos reales.'
            : `${reales.length} pedido(s) real(es).`}
        </p>
        {puedeAdministrarReales ? (
          <Button size="sm" onClick={() => setAltaAbierta(true)} data-testid="nuevo-pedido-real">
            <PlusIcon aria-hidden />
            Nuevo pedido real
          </Button>
        ) : null}
      </div>

      <ul className="space-y-3" data-testid="lista-pedidos-reales">
        {reales.map((real) => (
          <PedidoRealItem
            key={real.id}
            idPedido={idPedido}
            real={real}
            puedeAdministrarReales={puedeAdministrarReales}
          />
        ))}
      </ul>

      <DialogoAltaPedidoReal
        idPedido={idPedido}
        abierto={altaAbierta}
        alCambiarAbierto={setAltaAbierta}
      />
    </div>
  );
}

/** Una tarjeta de pedido real con su detalle, edición de encabezado y captura de seguimiento. */
function PedidoRealItem({
  idPedido,
  real,
  puedeAdministrarReales,
}: {
  idPedido: number;
  real: PedidoReal;
  puedeAdministrarReales: boolean;
}): React.JSX.Element {
  const seguimiento = useActualizarSeguimiento();
  const [edicionAbierta, setEdicionAbierta] = useState(false);
  // Estado local de captura: por renglón, las cantidades editadas (como texto).
  const [edicion, setEdicion] = useState<Record<number, { enviada: string; entregada: string }>>(
    () =>
      Object.fromEntries(
        real.lineas.map((l) => [
          l.id,
          { enviada: String(l.cantidadEnviada), entregada: String(l.cantidadEntregadaReal) },
        ]),
      ),
  );

  function guardar(): void {
    const lineas: PedidoRealSeguimiento['lineas'] = real.lineas.map((l) => ({
      id: l.id,
      cantidadEnviada: Number(edicion[l.id]?.enviada ?? l.cantidadEnviada),
      cantidadEntregadaReal: Number(edicion[l.id]?.entregada ?? l.cantidadEntregadaReal),
    }));
    seguimiento.mutate(
      { idPedido, idReal: real.id, cuerpo: { lineas } },
      {
        onSuccess: () => toast.success('Seguimiento guardado.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <li className="rounded-lg border p-3" data-testid="pedido-real">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="flex items-center gap-1.5 font-medium">
            <PackageCheck className="size-4 text-muted-foreground" aria-hidden />
            {real.numPedReal ?? 'Sin número'}
          </span>
          {real.cedis ? <span className="text-muted-foreground">CEDIS: {real.cedis}</span> : null}
          {real.apertura ? (
            <span className="text-muted-foreground">Apertura: {real.apertura}</span>
          ) : null}
          {real.fechaPedPR ? (
            <span className="text-muted-foreground">Fecha: {formatearFecha(real.fechaPedPR)}</span>
          ) : null}
        </div>
        {puedeAdministrarReales ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEdicionAbierta(true)}
            data-testid="editar-pedido-real"
          >
            <PencilIcon aria-hidden />
            Editar datos
          </Button>
        ) : null}
      </div>

      <div className="mt-3 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Modelo</TableHead>
              <TableHead className="text-right">Pedida</TableHead>
              <TableHead className="text-right">Enviada</TableHead>
              <TableHead className="text-right">Entregada</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {real.lineas.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="font-medium">{l.codigoModelo}</TableCell>
                <TableCell className="text-right">{l.cantidadPedida}</TableCell>
                <TableCell className="text-right">
                  {puedeAdministrarReales ? (
                    <Input
                      type="number"
                      min={0}
                      step="1"
                      className="ml-auto h-8 w-20 text-right"
                      aria-label={`Cantidad enviada de ${l.codigoModelo}`}
                      value={edicion[l.id]?.enviada ?? ''}
                      onChange={(e) =>
                        setEdicion((prev) => ({
                          ...prev,
                          [l.id]: {
                            ...prev[l.id],
                            entregada: prev[l.id]?.entregada ?? '0',
                            enviada: e.target.value,
                          },
                        }))
                      }
                    />
                  ) : (
                    l.cantidadEnviada
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {puedeAdministrarReales ? (
                    <Input
                      type="number"
                      min={0}
                      step="1"
                      className="ml-auto h-8 w-20 text-right"
                      aria-label={`Cantidad entregada de ${l.codigoModelo}`}
                      value={edicion[l.id]?.entregada ?? ''}
                      onChange={(e) =>
                        setEdicion((prev) => ({
                          ...prev,
                          [l.id]: {
                            ...prev[l.id],
                            enviada: prev[l.id]?.enviada ?? '0',
                            entregada: e.target.value,
                          },
                        }))
                      }
                    />
                  ) : (
                    l.cantidadEntregadaReal
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {puedeAdministrarReales ? (
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={guardar}
            disabled={seguimiento.isPending}
            data-testid="guardar-seguimiento"
          >
            {seguimiento.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Guardar seguimiento
          </Button>
        </div>
      ) : null}

      <DialogoEditarPedidoReal
        idPedido={idPedido}
        real={real}
        abierto={edicionAbierta}
        alCambiarAbierto={setEdicionAbierta}
      />
    </li>
  );
}

/** Campos del ENCABEZADO de un pedido real reutilizados por el alta y la edición. */
function CamposEncabezadoReal({
  datos,
  alCambiar,
  idPrefijo,
}: {
  datos: DatosEncabezadoReal;
  alCambiar: (campo: keyof DatosEncabezadoReal, valor: string) => void;
  idPrefijo: string;
}): React.JSX.Element {
  return (
    <div className="space-y-3 py-2">
      <Field>
        <FieldLabel htmlFor={`${idPrefijo}-num`}>Número del pedido real</FieldLabel>
        <Input
          id={`${idPrefijo}-num`}
          value={datos.numPedReal}
          onChange={(e) => alCambiar('numPedReal', e.target.value)}
          placeholder="Del cliente (opcional)"
        />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${idPrefijo}-cedis`}>CEDIS</FieldLabel>
          <Input
            id={`${idPrefijo}-cedis`}
            value={datos.cedis}
            onChange={(e) => alCambiar('cedis', e.target.value)}
            placeholder="Centro de distribución"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idPrefijo}-apertura`}>Apertura</FieldLabel>
          <Input
            id={`${idPrefijo}-apertura`}
            value={datos.apertura}
            onChange={(e) => alCambiar('apertura', e.target.value)}
            placeholder="Temporada/apertura"
          />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field>
          <FieldLabel htmlFor={`${idPrefijo}-fecha`}>Fecha del pedido real</FieldLabel>
          <Input
            id={`${idPrefijo}-fecha`}
            type="date"
            value={datos.fechaPedPR}
            onChange={(e) => alCambiar('fechaPedPR', e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idPrefijo}-inicio`}>Entrega desde</FieldLabel>
          <Input
            id={`${idPrefijo}-inicio`}
            type="date"
            value={datos.fechaInicio}
            onChange={(e) => alCambiar('fechaInicio', e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idPrefijo}-fin`}>Entrega hasta</FieldLabel>
          <Input
            id={`${idPrefijo}-fin`}
            type="date"
            value={datos.fechaFin}
            onChange={(e) => alCambiar('fechaFin', e.target.value)}
          />
        </Field>
      </div>
    </div>
  );
}

/** Diálogo de alta de un pedido real (encabezado completo; el backend replica los renglones). */
function DialogoAltaPedidoReal({
  idPedido,
  abierto,
  alCambiarAbierto,
}: {
  idPedido: number;
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
}): React.JSX.Element {
  const crear = useCrearPedidoReal();
  const [datos, setDatos] = useState<DatosEncabezadoReal>(ENCABEZADO_VACIO);

  useEffect(() => {
    if (abierto) {
      setDatos(ENCABEZADO_VACIO);
    }
  }, [abierto]);

  function alCambiar(campo: keyof DatosEncabezadoReal, valor: string): void {
    setDatos((prev) => ({ ...prev, [campo]: valor }));
  }

  function confirmar(): void {
    const cuerpo: PedidoRealCrear = {};
    const num = textoCrear(datos.numPedReal);
    if (num !== undefined) cuerpo.numPedReal = num;
    const cedis = textoCrear(datos.cedis);
    if (cedis !== undefined) cuerpo.cedis = cedis;
    const apertura = textoCrear(datos.apertura);
    if (apertura !== undefined) cuerpo.apertura = apertura;
    const fechaPedPR = textoCrear(datos.fechaPedPR);
    if (fechaPedPR !== undefined) cuerpo.fechaPedPR = fechaPedPR;
    const fechaInicio = textoCrear(datos.fechaInicio);
    if (fechaInicio !== undefined) cuerpo.fechaInicio = fechaInicio;
    const fechaFin = textoCrear(datos.fechaFin);
    if (fechaFin !== undefined) cuerpo.fechaFin = fechaFin;

    crear.mutate(
      { idPedido, cuerpo },
      {
        onSuccess: () => {
          toast.success('Pedido real creado.');
          alCambiarAbierto(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nuevo pedido real</DialogTitle>
          <DialogDescription>
            Se replicarán automáticamente los renglones del pedido. Después captura las cantidades
            enviadas/entregadas.
          </DialogDescription>
        </DialogHeader>

        <CamposEncabezadoReal datos={datos} alCambiar={alCambiar} idPrefijo="pr-alta" />

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={crear.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={confirmar}
            disabled={crear.isPending}
            data-testid="confirmar-pedido-real"
          >
            {crear.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Crear pedido real
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Diálogo de edición del ENCABEZADO de un pedido real (usa `useActualizarPedidoReal`). */
function DialogoEditarPedidoReal({
  idPedido,
  real,
  abierto,
  alCambiarAbierto,
}: {
  idPedido: number;
  real: PedidoReal;
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
}): React.JSX.Element {
  const actualizar = useActualizarPedidoReal();
  const [datos, setDatos] = useState<DatosEncabezadoReal>(ENCABEZADO_VACIO);

  // Al abrir, carga los valores actuales del pedido real (null → '').
  useEffect(() => {
    if (abierto) {
      setDatos({
        numPedReal: real.numPedReal ?? '',
        cedis: real.cedis ?? '',
        apertura: real.apertura ?? '',
        fechaPedPR: real.fechaPedPR ?? '',
        fechaInicio: real.fechaInicio ?? '',
        fechaFin: real.fechaFin ?? '',
      });
    }
  }, [abierto, real]);

  function alCambiar(campo: keyof DatosEncabezadoReal, valor: string): void {
    setDatos((prev) => ({ ...prev, [campo]: valor }));
  }

  function confirmar(): void {
    // En edición, los campos vacíos viajan como null (vaciar el dato, M1).
    const cuerpo: PedidoRealEditar = {
      numPedReal: textoEditar(datos.numPedReal),
      cedis: textoEditar(datos.cedis),
      apertura: textoEditar(datos.apertura),
      fechaPedPR: textoEditar(datos.fechaPedPR),
      fechaInicio: textoEditar(datos.fechaInicio),
      fechaFin: textoEditar(datos.fechaFin),
    };
    actualizar.mutate(
      { idPedido, idReal: real.id, cuerpo },
      {
        onSuccess: () => {
          toast.success('Pedido real actualizado.');
          alCambiarAbierto(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar pedido real</DialogTitle>
          <DialogDescription>
            Cambia el número, CEDIS, apertura y fechas del pedido real. Las cantidades se capturan
            en el seguimiento.
          </DialogDescription>
        </DialogHeader>

        <CamposEncabezadoReal
          datos={datos}
          alCambiar={alCambiar}
          idPrefijo={`pr-edit-${real.id}`}
        />

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={actualizar.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={confirmar}
            disabled={actualizar.isPending}
            data-testid="guardar-pedido-real"
          >
            {actualizar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Guardar cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
