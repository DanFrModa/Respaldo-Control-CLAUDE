import { Loader2Icon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useAvios } from '@/api/avios';
import { useColores } from '@/api/colores';
import { useActualizarOc, useCrearOc } from '@/api/ordenes-compra';
import { useConsultaOrdenes } from '@/api/ordenes-consulta';
import { COD_ROL_PROVEEDOR, useProveedoresPorRol } from '@/api/proveedores';
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
 * Rol de proveedor (R15) que exigen los renglones capturados, o `undefined` si no hay que acotar.
 *
 * Una OC es de UN proveedor pero sus renglones pueden mezclar telas, avíos y líneas libres, y el
 * proveedor se captura ANTES que los renglones. Por eso la regla es por MAYORÍA de tipo, no por
 * bloqueo (decisión de Daniel, 07-ago-2026):
 *  • solo renglones de tela → proveedores con rol «Vende telas»;
 *  • solo renglones de avío → proveedores con rol «Vende avíos»;
 *  • mezclada, o solo líneas libres → NO se acota (mostrar todos: nunca estorbar una compra real).
 *
 * Cuenta el `tipo` del renglón aunque todavía no se haya elegido el material: el usuario ya declaró
 * qué va a comprar en esa línea.
 */
function rolSegunRenglones(renglones: readonly RenglonOcCaptura[]): string | undefined {
  const hayTela = renglones.some((renglon) => renglon.tipo === 'tela');
  const hayAvio = renglones.some((renglon) => renglon.tipo === 'avio');
  if (hayTela && !hayAvio) {
    return COD_ROL_PROVEEDOR.vendeTelas;
  }
  if (hayAvio && !hayTela) {
    return COD_ROL_PROVEEDOR.vendeAvios;
  }
  return undefined;
}

/** Texto de ayuda bajo el selector, según el rol al que quedó acotada la lista. */
const AYUDA_POR_ROL: Record<string, string> = {
  [COD_ROL_PROVEEDOR.vendeTelas]: 'La OC es de telas: solo proveedores con el rol «Vende telas».',
  [COD_ROL_PROVEEDOR.vendeAvios]: 'La OC es de avíos: solo proveedores con el rol «Vende avíos».',
};

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
  const avios = useAvios({ pagina: 1, porPagina: 100 });
  const colores = useColores({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    incluirInactivos: 'false',
  });
  const tallas = useTallasActivas();
  // Órdenes de producción no canceladas para ligar por línea (R7).
  const ordenes = useConsultaOrdenes({ pagina: 1, porPagina: 100, incluirCanceladas: 'false' });

  // ── Estado del encabezado. ───────────────────────────────────────────────────
  const [idProveedor, setIdProveedor] = useState<number | null>(null);
  const [fecha, setFecha] = useState('');
  const [fechaEntrega, setFechaEntrega] = useState('');
  const [entregaEn, setEntregaEn] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [correspondeA, setCorrespondeA] = useState('');
  const [renglones, setRenglones] = useState<RenglonOcCaptura[]>([]);
  /**
   * Nombre del proveedor elegido. Se guarda aparte porque la lista se acota en vivo: si el
   * proveedor ya capturado no trae el rol que piden los renglones (típico al EDITAR una OC vieja
   * o migrada), desaparecería del `<select>` y el valor se perdería en silencio. Con el nombre a
   * la mano se puede seguir mostrando como opción y respetar lo capturado.
   */
  const [nombreProveedor, setNombreProveedor] = useState('');

  // §Post-F9.15 — SOLO las telas de ESTE proveedor: la tela es DEL proveedor (su dueño es parte de
  // su identidad desde A1). Sin proveedor elegido todavía no hay universo, así que la consulta
  // queda apagada: pedir "todas" ofrecería telas que esta OC no puede comprar.
  const telas = useTelas(
    {
      pagina: 1,
      porPagina: 100,
      ordenarPor: 'nombre',
      ...(idProveedor === null ? {} : { idProveedor }),
    },
    { enabled: idProveedor !== null },
  );

  // Rol al que se acota la lista, recalculado con cada cambio de renglones.
  const rolProveedor = useMemo(() => rolSegunRenglones(renglones), [renglones]);
  const proveedores = useProveedoresPorRol(rolProveedor);
  const listaProveedores = proveedores.data?.datos ?? [];
  // El proveedor capturado no cumple el rol vigente → se conserva como opción extra.
  const seleccionadoFueraDelFiltro =
    idProveedor !== null && !listaProveedores.some((p) => p.id === idProveedor);

  // Al abrir, carga los datos de la OC (edición) o limpia (alta).
  useEffect(() => {
    if (!abierto) {
      return;
    }
    if (oc !== undefined) {
      setIdProveedor(oc.idProveedor);
      setNombreProveedor(oc.proveedor);
      setFecha(oc.fecha ?? '');
      setFechaEntrega(oc.fechaEntrega ?? '');
      setEntregaEn(oc.entregaEn ?? '');
      setObservaciones(oc.observaciones ?? '');
      setCorrespondeA(oc.correspondeA ?? '');
      setRenglones(capturaDesdeOc(oc));
    } else {
      setIdProveedor(null);
      setNombreProveedor('');
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
                onChange={(e) => {
                  const valor = e.target.value;
                  const id = valor === '' ? null : Number(valor);
                  setIdProveedor(id);
                  setNombreProveedor(listaProveedores.find((p) => p.id === id)?.nombre ?? '');
                  // §Post-F9.15: las telas ya capturadas son de OTRO proveedor. Se limpian (el
                  // renglón se conserva) y se avisa, en vez de dejar que el servidor rechace el
                  // guardado al final con la orden entera ya tecleada.
                  setRenglones((previos) => {
                    if (!previos.some((r) => r.tipo === 'tela' && r.idTela !== null)) {
                      return previos;
                    }
                    toast.warning(
                      'Cambiaste de proveedor: las telas capturadas eran de otro, hay que elegirlas de nuevo.',
                    );
                    return previos.map((r) =>
                      r.tipo === 'tela' && r.idTela !== null ? { ...r, idTela: null } : r,
                    );
                  });
                }}
                data-testid="oc-proveedor"
              >
                <option value="">Elige un proveedor…</option>
                {/* El proveedor ya capturado que no cumple el rol vigente sigue disponible. */}
                {seleccionadoFueraDelFiltro && idProveedor !== null ? (
                  <option value={String(idProveedor)}>
                    {nombreProveedor === '' ? 'Proveedor actual' : nombreProveedor}
                  </option>
                ) : null}
                {listaProveedores.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.nombre}
                  </option>
                ))}
              </SelectNativo>
              {rolProveedor !== undefined ? (
                <p className="text-xs text-muted-foreground" data-testid="oc-proveedor-ayuda">
                  {AYUDA_POR_ROL[rolProveedor]}
                </p>
              ) : null}
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
              mensajeSinTelas={
                idProveedor === null
                  ? 'Elige primero el proveedor…'
                  : 'Este proveedor no tiene telas dadas de alta'
              }
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
