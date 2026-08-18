import { Loader2Icon, PencilIcon, PlusIcon, PowerIcon, PowerOffIcon, Truck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { numeroOpcionalACuerpo } from '@/api/esquemas';
import {
  useActualizarTelaProveedor,
  useCrearTelaProveedor,
  useDesactivarTelaProveedor,
  useReactivarTelaProveedor,
  useTelaProveedores,
  type TelaProveedor,
  type TelaProveedorColorEntrada,
  type TelaProveedorCrear,
  type TelaProveedorEditar,
} from '@/api/tela-proveedores';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { EstadoPunto } from '@/components/dominio/visuales';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { SelectorProveedor } from '@/modulos/cxp/SelectorProveedor';

/** Un color de la tela (para el grid de precio por color). */
export interface ColorTela {
  idColor: number;
  nombre: string;
}

/** Formato de precio en pesos MXN. */
const FORMATO_MONEDA = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

/**
 * Presenta un precio (o "—" si es null / no se puede ver importes). Los importes se ocultan sin
 * `consultas.ver-importes` (el backend ya los puede nular; aquí además se respeta el permiso).
 */
function precioTexto(precio: number | null, puedeVerImportes: boolean): string {
  if (!puedeVerImportes) {
    return '—';
  }
  return precio === null ? 'Sin precio' : FORMATO_MONEDA.format(precio);
}

/**
 * "Precios por proveedor" de una tela (F8-E1, R17) — espejo del editor de proveedores del avío,
 * pero como sub-recurso REST de la tela (endpoints propios). Vive en el panel de DETALLE de la
 * tela. Lista a quién se le compra la tela y a qué precio; permite agregar/editar/desactivar/
 * reactivar renglones, cada uno con su precio base, condiciones y, opcional, un grid de precio
 * POR COLOR (`manejaPrecioPorColor`).
 *
 * `deshabilitado` (sin `telas.administrar` o tela inactiva) deja el listado en solo lectura.
 * `puedeVerImportes` oculta los precios cuando la sesión no tiene `consultas.ver-importes`.
 */
export function EditorProveedoresTela({
  idTela,
  colores,
  deshabilitado = false,
  puedeVerImportes,
}: {
  idTela: number;
  /** Colores de la tela (base del grid de precio por color). */
  colores: readonly ColorTela[];
  deshabilitado?: boolean;
  puedeVerImportes: boolean;
}): React.JSX.Element {
  const consulta = useTelaProveedores(idTela);
  const desactivar = useDesactivarTelaProveedor();
  const reactivar = useReactivarTelaProveedor();

  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [enEdicion, setEnEdicion] = useState<TelaProveedor | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<TelaProveedor | null>(null);

  function abrirAlta(): void {
    setEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(proveedor: TelaProveedor): void {
    setEnEdicion(proveedor);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(
      { idTela, id: objetivo.id },
      {
        onSuccess: () => {
          toast.success(`Proveedor "${objetivo.nombreProveedor}" quitado de la tela.`);
          setADesactivar(null);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function reactivarProveedor(proveedor: TelaProveedor): void {
    reactivar.mutate(
      { idTela, id: proveedor.id },
      {
        onSuccess: () => toast.success(`Proveedor "${proveedor.nombreProveedor}" reactivado.`),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const proveedores = consulta.data ?? [];
  // Ids de proveedores ya asignados y ACTIVOS (para no ofrecerlos de nuevo en el alta).
  const idsAsignados = new Set(proveedores.filter((p) => p.activo).map((p) => p.idProveedor));

  return (
    <div className="space-y-3" data-testid="editor-proveedores-tela">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          A quién se le compra esta tela y a qué precio (opcional por color).
        </p>
        {deshabilitado ? null : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={abrirAlta}
            data-testid="nuevo-proveedor-tela"
          >
            <PlusIcon aria-hidden />
            Agregar proveedor
          </Button>
        )}
      </div>

      {consulta.isPending ? (
        <div className="space-y-2" data-testid="proveedores-tela-cargando">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : consulta.isError ? (
        <p className="text-sm text-destructive">{consulta.error.message}</p>
      ) : proveedores.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="proveedores-tela-vacio">
          Esta tela no tiene proveedores con precio.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="lista-proveedores-tela">
          {proveedores.map((proveedor) => (
            <li
              key={proveedor.id}
              data-testid="fila-proveedor-tela"
              data-activo={proveedor.activo}
              className="rounded-lg border p-3"
            >
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"
                >
                  <Truck className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">
                      {proveedor.nombreProveedor}
                    </span>
                    {proveedor.activo ? null : <EstadoPunto activo={false} />}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {proveedor.manejaPrecioPorColor
                      ? 'Precio por color'
                      : precioTexto(proveedor.precio, puedeVerImportes)}
                    {proveedor.condiciones ? ` · ${proveedor.condiciones}` : ''}
                  </span>
                </div>
                {deshabilitado ? null : (
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => abrirEdicion(proveedor)}
                      aria-label={`Editar proveedor ${proveedor.nombreProveedor}`}
                      data-testid="editar-proveedor-tela"
                    >
                      <PencilIcon aria-hidden />
                    </Button>
                    {proveedor.activo ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setADesactivar(proveedor)}
                        aria-label={`Quitar proveedor ${proveedor.nombreProveedor}`}
                        data-testid="desactivar-proveedor-tela"
                      >
                        <PowerOffIcon className="text-destructive" aria-hidden />
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => reactivarProveedor(proveedor)}
                        aria-label={`Reactivar proveedor ${proveedor.nombreProveedor}`}
                        data-testid="activar-proveedor-tela"
                      >
                        <PowerIcon aria-hidden />
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* Grid de precio por color (solo lectura, cuando aplica). */}
              {proveedor.manejaPrecioPorColor && proveedor.colores.length > 0 ? (
                <ul
                  className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2"
                  data-testid={`colores-proveedor-tela-${proveedor.id}`}
                >
                  {proveedor.colores.map((color) => (
                    <li
                      key={color.idColor}
                      className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs"
                    >
                      <span className="truncate">{color.nombre}</span>
                      <span className="text-muted-foreground">
                        {precioTexto(color.precio, puedeVerImportes)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <DialogoProveedorTela
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        idTela={idTela}
        proveedor={enEdicion}
        colores={colores}
        idsAsignados={idsAsignados}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Quitar proveedor de la tela"
        descripcion={
          <>
            ¿Seguro que quieres quitar a{' '}
            <span className="font-medium text-foreground">{aDesactivar?.nombreProveedor}</span> de
            esta tela? Podrás volver a agregarlo después.
          </>
        }
        textoConfirmar="Quitar"
        variante="destructive"
        procesando={desactivar.isPending}
        alConfirmar={confirmarDesactivar}
      />
    </div>
  );
}

/** Un renglón del grid de precio por color EN CAPTURA (precio como texto). */
interface RenglonColorCaptura {
  idColor: number;
  nombre: string;
  /** Precio como texto (vacío = sin precio). */
  precio: string;
}

/**
 * Arma el grid de captura de precio por color: usa los colores ACTUALES de la tela como lista
 * canónica y rellena el precio desde el renglón tela–proveedor en edición (por `idColor`).
 */
function armarGridColores(
  colores: readonly ColorTela[],
  proveedor: TelaProveedor | undefined,
): RenglonColorCaptura[] {
  const preciosPorColor = new Map<number, number | null>(
    (proveedor?.colores ?? []).map((c) => [c.idColor, c.precio]),
  );
  return colores.map((color) => {
    const precio = preciosPorColor.get(color.idColor);
    return {
      idColor: color.idColor,
      nombre: color.nombre,
      precio: precio === undefined || precio === null ? '' : String(precio),
    };
  });
}

/**
 * Diálogo de alta/edición de un proveedor–precio de la tela. En ALTA se elige un proveedor del
 * catálogo (no repetible); en EDICIÓN el proveedor es fijo. Toggle "maneja precio por color" que,
 * al activarse, despliega el grid color × precio con los colores de la tela. Al guardar con éxito
 * cierra y avisa; el error del backend (proveedor repetido, permiso) se muestra como toast.
 */
function DialogoProveedorTela({
  abierto,
  alCambiarAbierto,
  idTela,
  proveedor,
  colores,
  idsAsignados,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  idTela: number;
  /** Renglón a editar; `undefined` -> alta. */
  proveedor: TelaProveedor | undefined;
  colores: readonly ColorTela[];
  /** Ids de proveedores ya asignados y activos (para no repetir en el alta). */
  idsAsignados: ReadonlySet<number>;
}): React.JSX.Element {
  const esEdicion = proveedor !== undefined;
  const crear = useCrearTelaProveedor();
  const actualizar = useActualizarTelaProveedor();
  const guardando = crear.isPending || actualizar.isPending;

  // V1-E3f: el catálogo completo ya no se carga aquí — el `SelectorProveedor` busca en el
  // SERVIDOR (§Post-F9.52 punto 7), así que no hay lista de 100 que traer ni que filtrar.
  const [idProveedor, setIdProveedor] = useState<string>('');
  /** Nombre del proveedor elegido en el buscador (puede venir de fuera de la primera página). */
  const [nombreElegido, setNombreElegido] = useState<string | undefined>(undefined);
  const [precio, setPrecio] = useState('');
  const [condiciones, setCondiciones] = useState('');
  const [manejaPrecioPorColor, setManejaPrecioPorColor] = useState(false);
  const [grid, setGrid] = useState<RenglonColorCaptura[]>([]);

  // Al abrir, siembra los campos desde el renglón en edición (o limpia para el alta).
  useEffect(() => {
    if (!abierto) {
      return;
    }
    if (proveedor) {
      setIdProveedor(String(proveedor.idProveedor));
      setPrecio(proveedor.precio === null ? '' : String(proveedor.precio));
      setCondiciones(proveedor.condiciones ?? '');
      setManejaPrecioPorColor(proveedor.manejaPrecioPorColor);
    } else {
      setIdProveedor('');
      setPrecio('');
      setCondiciones('');
      setManejaPrecioPorColor(false);
    }
    setGrid(armarGridColores(colores, proveedor));
  }, [abierto, proveedor, colores]);

  function cambiarPrecioColor(idColor: number, valor: string): void {
    setGrid((prev) => prev.map((r) => (r.idColor === idColor ? { ...r, precio: valor } : r)));
  }

  /** Renglones de color con precio para el cuerpo (solo los que tienen precio capturado). */
  function coloresCuerpo(): TelaProveedorColorEntrada[] {
    return grid.flatMap((r) => {
      const p = numeroOpcionalACuerpo(r.precio);
      const renglon: TelaProveedorColorEntrada = { idColor: r.idColor };
      if (p !== undefined) {
        renglon.precio = p;
      }
      return [renglon];
    });
  }

  function enviar(evento: React.FormEvent): void {
    evento.preventDefault();
    if (guardando) {
      return;
    }

    const precioNum = numeroOpcionalACuerpo(precio);
    const condicionesLimpio = condiciones.trim();
    const coloresBody = manejaPrecioPorColor ? coloresCuerpo() : [];

    if (esEdicion) {
      const cuerpo: TelaProveedorEditar = {
        precio: precioNum ?? null,
        condiciones: condicionesLimpio.length > 0 ? condicionesLimpio : null,
        manejaPrecioPorColor,
        colores: coloresBody,
      };
      actualizar.mutate(
        { idTela, id: proveedor.id, cuerpo },
        {
          onSuccess: (r) => {
            toast.success(`Precio de "${r.nombreProveedor}" actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }

    const id = Number(idProveedor);
    if (!Number.isFinite(id) || id <= 0) {
      toast.error('Elige un proveedor.');
      return;
    }
    const cuerpo: TelaProveedorCrear = {
      idProveedor: id,
      manejaPrecioPorColor,
      colores: coloresBody,
    };
    if (precioNum !== undefined) {
      cuerpo.precio = precioNum;
    }
    if (condicionesLimpio.length > 0) {
      cuerpo.condiciones = condicionesLimpio;
    }
    crear.mutate(
      { idTela, cuerpo },
      {
        onSuccess: (r) => {
          toast.success(`Proveedor "${r.nombreProveedor}" agregado a la tela.`);
          alCambiarAbierto(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={enviar} noValidate>
          <DialogHeader>
            <DialogTitle>{esEdicion ? 'Editar precio' : 'Agregar proveedor'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? `Cambia el precio y las condiciones de ${proveedor.nombreProveedor}.`
                : 'A quién se le compra esta tela y a qué precio (R17).'}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto py-4 pr-1">
            <FieldGroup>
              {esEdicion ? (
                <Field>
                  <FieldLabel>Proveedor</FieldLabel>
                  <p className="text-sm font-medium">{proveedor.nombreProveedor}</p>
                </Field>
              ) : (
                <Field>
                  <FieldLabel htmlFor="tp-proveedor">Proveedor</FieldLabel>
                  {/* V1-E3f (§Post-F9.52 punto 7): buscador en el SERVIDOR, no un desplegable con
                      tope de 100 — con más de cien proveedores el que se busca no aparecía. */}
                  <SelectorProveedor
                    idInput="tp-proveedor"
                    idSeleccionado={idProveedor === '' ? undefined : Number(idProveedor)}
                    nombreSeleccionado={nombreElegido}
                    alSeleccionar={(p) => {
                      setIdProveedor(String(p.id));
                      setNombreElegido(p.nombre);
                    }}
                    alLimpiar={() => {
                      setIdProveedor('');
                      setNombreElegido(undefined);
                    }}
                    excluirIds={idsAsignados}
                    testid="selector-proveedor-tela"
                  />
                </Field>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="tp-precio">Precio base</FieldLabel>
                  <Input
                    id="tp-precio"
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    placeholder="0.00"
                    disabled={guardando || manejaPrecioPorColor}
                    value={precio}
                    onChange={(e) => setPrecio(e.target.value)}
                    data-testid="precio-proveedor-tela"
                  />
                  <FieldDescription>
                    {manejaPrecioPorColor ? 'Se usa el precio por color de abajo.' : 'Opcional.'}
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="tp-condiciones">Condiciones</FieldLabel>
                  <Input
                    id="tp-condiciones"
                    type="text"
                    placeholder="p. ej. contado, mín. 1 rollo…"
                    disabled={guardando}
                    value={condiciones}
                    onChange={(e) => setCondiciones(e.target.value)}
                    data-testid="condiciones-proveedor-tela"
                  />
                </Field>
              </div>

              {/* R2-2 (§Post-F9.11): el precio POR COLOR de R17 cuelga del catálogo de color
                  de PRENDA vía la liga LEGACY de los colores migrados. Las telas NUEVAS no
                  tienen colores ligados → el modo por-color NO aplica y la UI lo dice tal
                  cual (checkbox deshabilitado), en vez de ofrecer un grid vacío que miente.
                  DEUDA: con el proveedor dueño, R17 va camino a simplificarse/retirarse —
                  registrada en HOJA-DE-RUTA §4 (decisión del lead, ronda 2 opción b). */}
              <Field orientation="horizontal">
                <input
                  id="tp-por-color"
                  type="checkbox"
                  className="size-4 rounded border-input accent-primary"
                  disabled={guardando || colores.length === 0}
                  title={
                    colores.length === 0
                      ? 'El precio por color solo aplica a telas migradas del sistema viejo.'
                      : undefined
                  }
                  checked={manejaPrecioPorColor}
                  onChange={(e) => setManejaPrecioPorColor(e.target.checked)}
                  data-testid="maneja-precio-por-color"
                />
                <FieldLabel htmlFor="tp-por-color" className="font-normal">
                  ¿El precio cambia por color?
                </FieldLabel>
              </Field>
              {colores.length === 0 ? (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="aviso-por-color-solo-migradas"
                >
                  El precio por color solo aplica a telas migradas del sistema viejo. En telas
                  nuevas, usa el precio base del proveedor.
                </p>
              ) : null}

              {/* Grid color × precio (solo si maneja precio por color). */}
              {manejaPrecioPorColor ? (
                grid.length === 0 ? (
                  <p
                    className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground"
                    data-testid="grid-color-sin-colores"
                  >
                    Esta tela no tiene colores ligados al catálogo de prenda: el precio por color no
                    aplica aquí.
                  </p>
                ) : (
                  <ul className="space-y-2" data-testid="grid-precio-por-color">
                    {grid.map((renglon) => (
                      <li
                        key={renglon.idColor}
                        className="flex items-center gap-2 rounded-lg border p-2"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm">{renglon.nombre}</span>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          inputMode="decimal"
                          className="w-28"
                          placeholder="Precio"
                          aria-label={`Precio del color ${renglon.nombre}`}
                          disabled={guardando}
                          value={renglon.precio}
                          onChange={(e) => cambiarPrecioColor(renglon.idColor, e.target.value)}
                          data-testid={`precio-color-proveedor-${renglon.idColor}`}
                        />
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </FieldGroup>
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
            <Button type="submit" disabled={guardando} data-testid="guardar-proveedor-tela">
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Agregar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
