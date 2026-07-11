import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { useClientes } from '@/api/clientes';
import { useActualizarPedido, useCrearPedido } from '@/api/pedidos';
import type { Pedido, PedidoCrear, PedidoEditar, PedidoLineaEntrada } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  LeyendaObligatorios,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

import { EditorRenglones } from './EditorRenglones';
import {
  esquemaPedidoFormulario,
  fechaACuerpo,
  fechaACuerpoEditar,
  type DatosPedidoFormulario,
  type DatosRenglonFormulario,
} from './esquemas';

/** Tope alto: trae los clientes activos para el selector. */
const QUERY_CLIENTES = {
  pagina: 1,
  porPagina: 100,
  ordenarPor: 'nombre',
  direccion: 'asc',
  incluirInactivos: 'false',
} as const;

/** Valores por defecto de un alta (todo vacío). */
const VALORES_INICIALES: DatosPedidoFormulario = {
  idCliente: '',
  fechaPedido: '',
  fechaDe: '',
  fechaHasta: '',
  fechaTela: '',
  fechaElaboracion: '',
  renglones: [],
};

/**
 * Convierte un renglón del formulario al cuerpo del API (cantidad/precio a número). El `precio`
 * se OMITE cuando la sesión no puede ver importes (`puedeVerImportes=false`) o cuando el campo
 * quedó vacío: así nunca viaja un 0 falso que el backend escribiría encima del precio real
 * (defensa en profundidad del fix de importes; el backend lo re-asegura, A1).
 */
function aRenglonCuerpo(r: DatosRenglonFormulario, puedeVerImportes: boolean): PedidoLineaEntrada {
  const base: PedidoLineaEntrada = {
    idModelo: Number(r.idModelo),
    cantidadPedida: Number(r.cantidadPedida),
  };
  if (puedeVerImportes && r.precio.trim() !== '') {
    base.precio = Number(r.precio);
  }
  return r.id === undefined ? base : { ...base, id: r.id };
}

/**
 * Diálogo de alta/edición de un pedido interno (react-hook-form + Zod). Si recibe un `pedido`
 * edita (PATCH con el set completo de renglones); si no, da de alta (POST). El precio solo se
 * captura si `puedeVerImportes` (doc 02 §3). La validación de captura es solo UX: el backend
 * re-valida y es la autoridad (A1).
 */
export function DialogoPedido({
  abierto,
  alCambiarAbierto,
  pedido,
  puedeVerImportes,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Pedido a editar; `undefined` -> alta. */
  pedido: Pedido | undefined;
  puedeVerImportes: boolean;
}): React.JSX.Element {
  const esEdicion = pedido !== undefined;
  const crear = useCrearPedido();
  const actualizar = useActualizarPedido();
  const guardando = crear.isPending || actualizar.isPending;

  const clientes = useClientes(QUERY_CLIENTES);

  const formulario = useForm<DatosPedidoFormulario>({
    resolver: zodResolver(esquemaPedidoFormulario),
    defaultValues: VALORES_INICIALES,
  });

  useEffect(() => {
    if (!abierto) {
      return;
    }
    formulario.reset(
      pedido
        ? {
            idCliente: String(pedido.idCliente),
            fechaPedido: pedido.fechaPedido ?? '',
            fechaDe: pedido.fechaDe ?? '',
            fechaHasta: pedido.fechaHasta ?? '',
            fechaTela: pedido.fechaTela ?? '',
            fechaElaboracion: pedido.fechaElaboracion ?? '',
            renglones: pedido.lineas.map((l) => ({
              id: l.id,
              idModelo: String(l.idModelo),
              cantidadPedida: String(l.cantidadPedida),
              // Si no puede ver importes, el precio viene null: el campo queda VACÍO (no se
              // captura ni viaja) y el backend conserva el precio almacenado.
              precio: l.precio === null ? '' : String(l.precio),
            })),
          }
        : VALORES_INICIALES,
    );
  }, [abierto, pedido, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    const lineas = datos.renglones.map((r) => aRenglonCuerpo(r, puedeVerImportes));
    if (esEdicion) {
      const cuerpo: PedidoEditar = {
        idCliente: Number(datos.idCliente),
        fechaPedido: fechaACuerpoEditar(datos.fechaPedido),
        fechaDe: fechaACuerpoEditar(datos.fechaDe),
        fechaHasta: fechaACuerpoEditar(datos.fechaHasta),
        fechaTela: fechaACuerpoEditar(datos.fechaTela),
        fechaElaboracion: fechaACuerpoEditar(datos.fechaElaboracion),
        lineas,
      };
      actualizar.mutate(
        { id: pedido.id, cuerpo },
        {
          onSuccess: (res) => {
            toast.success(`Pedido ${res.folio} actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    const cuerpo: PedidoCrear = {
      idCliente: Number(datos.idCliente),
      lineas,
    };
    const fp = fechaACuerpo(datos.fechaPedido);
    if (fp !== undefined) cuerpo.fechaPedido = fp;
    const fd = fechaACuerpo(datos.fechaDe);
    if (fd !== undefined) cuerpo.fechaDe = fd;
    const fh = fechaACuerpo(datos.fechaHasta);
    if (fh !== undefined) cuerpo.fechaHasta = fh;
    const ft = fechaACuerpo(datos.fechaTela);
    if (ft !== undefined) cuerpo.fechaTela = ft;
    const fe = fechaACuerpo(datos.fechaElaboracion);
    if (fe !== undefined) cuerpo.fechaElaboracion = fe;

    crear.mutate(cuerpo, {
      onSuccess: (res) => {
        toast.success(`Pedido ${res.folio} creado.`);
        alCambiarAbierto(false);
      },
      onError: (error) => toast.error(error.message),
    });
  });

  const { errors } = formulario.formState;
  const registrar = formulario.register;

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={(e) => void enviar(e)} noValidate>
          <DialogHeader>
            <DialogTitle>{esEdicion ? 'Editar pedido' : 'Nuevo pedido'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia el cliente, las fechas y los renglones del pedido.'
                : 'Captura el pedido del cliente con sus modelos y cantidades. El folio se asigna automáticamente.'}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] space-y-4 overflow-y-auto py-4 pr-1">
            <LeyendaObligatorios />

            <Field data-invalid={Boolean(errors.idCliente)}>
              <FieldLabel htmlFor="pedido-cliente" required>
                Cliente
              </FieldLabel>
              <SelectNativo
                id="pedido-cliente"
                disabled={guardando}
                aria-invalid={Boolean(errors.idCliente)}
                {...registrar('idCliente')}
              >
                <option value="">Elige un cliente…</option>
                {(clientes.data?.datos ?? []).map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.nombre}
                  </option>
                ))}
              </SelectNativo>
              <FieldError errors={[errors.idCliente]} />
            </Field>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="pedido-fecha">Fecha del pedido</FieldLabel>
                <Input
                  id="pedido-fecha"
                  type="date"
                  disabled={guardando}
                  {...registrar('fechaPedido')}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="pedido-de">Entrega desde</FieldLabel>
                <Input id="pedido-de" type="date" disabled={guardando} {...registrar('fechaDe')} />
                <FieldDescription>Ventana comprometida al cliente.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="pedido-hasta">Entrega hasta</FieldLabel>
                <Input
                  id="pedido-hasta"
                  type="date"
                  disabled={guardando}
                  {...registrar('fechaHasta')}
                />
                <FieldDescription>Ventana comprometida al cliente.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="pedido-tela">Fecha de tela</FieldLabel>
                <Input
                  id="pedido-tela"
                  type="date"
                  disabled={guardando}
                  {...registrar('fechaTela')}
                />
                <FieldDescription>Cuándo debe estar la tela para arrancar.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="pedido-elaboracion">Fecha de elaboración</FieldLabel>
                <Input
                  id="pedido-elaboracion"
                  type="date"
                  disabled={guardando}
                  {...registrar('fechaElaboracion')}
                />
                <FieldDescription>Inicio planeado.</FieldDescription>
              </Field>
            </div>

            <EditorRenglones
              control={formulario.control}
              registrar={registrar}
              errores={errors}
              puedeVerImportes={puedeVerImportes}
              deshabilitado={guardando}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => alCambiarAbierto(false)}
              disabled={guardando}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={guardando}
              data-testid="guardar-pedido"
              className="w-full sm:w-auto"
            >
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear pedido'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
