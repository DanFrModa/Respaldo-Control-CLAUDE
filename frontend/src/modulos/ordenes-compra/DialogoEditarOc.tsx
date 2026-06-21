import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useAvios } from '@/api/avios';
import { useColores } from '@/api/colores';
import { useActualizarOc, useCrearOc } from '@/api/ordenes-compra';
import { useConsultaOrdenes } from '@/api/ordenes-consulta';
import { useProveedores } from '@/api/proveedores';
import { useTallasActivas } from '@/api/tallas';
import { useTelas } from '@/api/telas';
import type { OrdenCompra, OrdenCompraCrear, OrdenCompraEditar } from '@/api/tipos';
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
import { SelectNativo } from '@/components/ui/native-select';

import { capturaDesdeOc, renglonApi, renglonVacio, type RenglonOcCaptura } from './captura';
import { EditorLineasOc } from './EditorLineasOc';

/**
 * Diálogo de CAPTURA / EDICIÓN de una orden de compra (F4-E2). Si recibe `oc`, edita; si no, da de
 * alta. Encabezado (proveedor, fechas, entregaEn, observaciones, correspondeA) + renglones (editor
 * con matriz). Una OC autorizada (y usuario no admin) va en `soloLectura` (el backend igual bloquea,
 * A1). Acciones de escritura gobernadas por `compras.administrar` (la pantalla oculta el botón que
 * abre el diálogo); el backend es la autoridad.
 */
export function DialogoEditarOc({
  abierto,
  alCambiarAbierto,
  oc,
  soloLectura = false,
  alGuardada,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** OC a editar; `undefined` = alta de un borrador nuevo. */
  oc?: OrdenCompra | undefined;
  /** Bloquea toda edición (OC autorizada sin ser admin); el backend re-valida. */
  soloLectura?: boolean;
  /** Callback con el id de la OC guardada (para enfocarla en la lista). */
  alGuardada: (id: number) => void;
}): React.JSX.Element {
  const crear = useCrearOc();
  const actualizar = useActualizarOc();
  const guardando = crear.isPending || actualizar.isPending;
  const esEdicion = oc !== undefined;

  // ── Catálogos para los selectores (solo activos). ────────────────────────────
  const proveedores = useProveedores({ pagina: 1, porPagina: 200, ordenarPor: 'nombre' });
  const telas = useTelas({ pagina: 1, porPagina: 500, ordenarPor: 'nombre' });
  const avios = useAvios({ pagina: 1, porPagina: 500 });
  const colores = useColores({ pagina: 1, porPagina: 500, ordenarPor: 'nombre' });
  const tallas = useTallasActivas();
  // Órdenes de producción no canceladas para ligar por línea (R7).
  const ordenes = useConsultaOrdenes({ pagina: 1, porPagina: 200, incluirCanceladas: 'false' });

  // ── Estado del encabezado. ───────────────────────────────────────────────────
  const [idProveedor, setIdProveedor] = useState<number | null>(null);
  const [fecha, setFecha] = useState('');
  const [fechaEntrega, setFechaEntrega] = useState('');
  const [entregaEn, setEntregaEn] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [correspondeA, setCorrespondeA] = useState('');
  const [renglones, setRenglones] = useState<RenglonOcCaptura[]>([]);

  // Al abrir, carga los datos de la OC (edición) o limpia (alta).
  useEffect(() => {
    if (!abierto) {
      return;
    }
    if (oc !== undefined) {
      setIdProveedor(oc.idProveedor);
      setFecha(oc.fecha ?? '');
      setFechaEntrega(oc.fechaEntrega ?? '');
      setEntregaEn(oc.entregaEn ?? '');
      setObservaciones(oc.observaciones ?? '');
      setCorrespondeA(oc.correspondeA ?? '');
      setRenglones(capturaDesdeOc(oc));
    } else {
      setIdProveedor(null);
      setFecha('');
      setFechaEntrega('');
      setEntregaEn('');
      setObservaciones('');
      setCorrespondeA('');
      setRenglones([renglonVacio()]);
    }
  }, [abierto, oc]);

  function confirmar(): void {
    if (idProveedor === null) {
      toast.error('Elige el proveedor de la orden de compra.');
      return;
    }
    const encabezado = {
      idProveedor,
      fecha: fecha === '' ? null : fecha,
      fechaEntrega: fechaEntrega === '' ? null : fechaEntrega,
      entregaEn: entregaEn.trim() || null,
      observaciones: observaciones.trim() || null,
      correspondeA: correspondeA.trim() || null,
      lineas: renglones.map(renglonApi),
    };

    if (esEdicion && oc !== undefined) {
      const cuerpo: OrdenCompraEditar = encabezado;
      actualizar.mutate(
        { id: oc.id, cuerpo },
        {
          onSuccess: (guardada) => {
            toast.success(`Orden de compra ${guardada.numCompra} actualizada.`);
            alCambiarAbierto(false);
            alGuardada(guardada.id);
          },
          onError: (error) => toast.error(error.message),
        },
      );
    } else {
      const cuerpo: OrdenCompraCrear = encabezado;
      crear.mutate(cuerpo, {
        onSuccess: (guardada) => {
          toast.success(`Orden de compra ${guardada.numCompra} creada en borrador.`);
          alCambiarAbierto(false);
          alGuardada(guardada.id);
        },
        onError: (error) => toast.error(error.message),
      });
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {soloLectura
              ? `Orden de compra ${oc?.numCompra ?? ''}`
              : esEdicion
                ? `Editar orden de compra ${oc?.numCompra ?? ''}`
                : 'Nueva orden de compra'}
          </DialogTitle>
          <DialogDescription>
            {soloLectura
              ? 'Esta orden está autorizada: se muestra en solo lectura.'
              : 'Captura el encabezado y los renglones. El folio y el total los asigna el sistema.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Encabezado */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="oc-proveedor">Proveedor</FieldLabel>
              <SelectNativo
                id="oc-proveedor"
                disabled={soloLectura || proveedores.isPending}
                value={idProveedor === null ? '' : String(idProveedor)}
                onChange={(e) =>
                  setIdProveedor(e.target.value === '' ? null : Number(e.target.value))
                }
                data-testid="oc-proveedor"
              >
                <option value="">Elige un proveedor…</option>
                {(proveedores.data?.datos ?? []).map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            <Field>
              <FieldLabel htmlFor="oc-fecha">Fecha de emisión</FieldLabel>
              <Input
                id="oc-fecha"
                type="date"
                disabled={soloLectura}
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                data-testid="oc-fecha"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="oc-fecha-entrega">Fecha de entrega</FieldLabel>
              <Input
                id="oc-fecha-entrega"
                type="date"
                disabled={soloLectura}
                value={fechaEntrega}
                onChange={(e) => setFechaEntrega(e.target.value)}
                data-testid="oc-fecha-entrega"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="oc-entrega-en">Entregar en</FieldLabel>
              <Input
                id="oc-entrega-en"
                disabled={soloLectura}
                placeholder="Almacén / dirección de entrega"
                value={entregaEn}
                onChange={(e) => setEntregaEn(e.target.value)}
                data-testid="oc-entrega-en"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="oc-corresponde-a">Corresponde a</FieldLabel>
              <Input
                id="oc-corresponde-a"
                disabled={soloLectura}
                placeholder="A qué corresponde la compra"
                value={correspondeA}
                onChange={(e) => setCorrespondeA(e.target.value)}
                data-testid="oc-corresponde-a"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="oc-observaciones">Observaciones</FieldLabel>
              <Input
                id="oc-observaciones"
                disabled={soloLectura}
                placeholder="Notas generales"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                data-testid="oc-observaciones"
              />
            </Field>
          </div>

          {/* Renglones */}
          <div>
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">Renglones</h3>
            <EditorLineasOc
              renglones={renglones}
              alCambiar={setRenglones}
              telas={telas.data?.datos ?? []}
              avios={avios.data?.datos ?? []}
              ordenes={ordenes.data?.datos ?? []}
              colores={colores.data?.datos ?? []}
              tallas={tallas.data?.datos ?? []}
              soloLectura={soloLectura}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={guardando}
          >
            {soloLectura ? 'Cerrar' : 'Cancelar'}
          </Button>
          {!soloLectura ? (
            <Button
              type="button"
              onClick={confirmar}
              disabled={guardando || idProveedor === null}
              data-testid="confirmar-oc"
            >
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear orden de compra'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
