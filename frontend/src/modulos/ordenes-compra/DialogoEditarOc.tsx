import { Loader2Icon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useAvios } from '@/api/avios';
import { useDireccionesEntregaActivas } from '@/api/direcciones-entrega';
import { useActualizarOc, useCrearOc } from '@/api/ordenes-compra';
import { COD_ROL_PROVEEDOR } from '@/api/proveedores';
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
import { SelectorProveedor } from '@/modulos/cxp/SelectorProveedor';

import { AvisoOrdenCerrada } from '@/components/dominio/AvisoOrdenCerrada';
import { InterruptorCerradas } from '@/components/dominio/InterruptorCerradas';
import { estaCerrada } from '@/lib/orden-cerrada';
import {
  ordenesConElegidas,
  useOrdenesDeCaptura,
  type OrdenElegible,
} from '@/modulos/produccion/ordenes-de-captura';
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
 * alta. Encabezado (proveedor, fecha de entrega OBLIGATORIA, dirección de entrega del CATÁLOGO,
 * observaciones, correspondeA — la fecha de emisión la pone el servidor, §Post-F9.18) + renglones (editor
 * con matriz). Una OC autorizada, sin `compras.editar-autorizada`, va en `soloLectura` (el backend igual bloquea,
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
  /** Bloquea toda edición (OC autorizada sin `compras.editar-autorizada`); el backend re-valida. */
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
  const tallas = useTallasActivas();
  // Órdenes de producción no canceladas para ligar por línea (R7). ⭐ 0.227: sólo las ABIERTAS
  // salvo «Mostrar cerradas» (filtro en el servidor) — ligar una OC a una cerrada es comprarle
  // material a una orden que ya no admite movimientos.
  const [mostrarCerradas, setMostrarCerradas] = useState(false);
  const ordenes = useOrdenesDeCaptura(mostrarCerradas);

  // ── Estado del encabezado. ───────────────────────────────────────────────────
  const [idProveedor, setIdProveedor] = useState<number | null>(null);
  const [fechaEntrega, setFechaEntrega] = useState('');
  /**
   * §Post-F9.18: la dirección de entrega sale de un CATÁLOGO (antes era texto libre y la misma
   * bodega salía escrita distinto en cada orden). En una OC nueva se preselecciona la FAVORITA.
   */
  const [idDireccionEntrega, setIdDireccionEntrega] = useState<number | null>(null);
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

  // Catálogo de direcciones de entrega (§Post-F9.18). El servidor las manda con la FAVORITA
  // primero, así que preseleccionarla es tomar la primera.
  const direcciones = useDireccionesEntregaActivas();
  // `useMemo` para que la lista tenga identidad estable: el efecto de abajo depende de ella y con
  // un arreglo nuevo por render volvería a correr en cada pintada.
  const listaDirecciones = useMemo(() => direcciones.data?.datos ?? [], [direcciones.data]);
  useEffect(() => {
    if (!abierto || oc !== undefined || idDireccionEntrega !== null) {
      return;
    }
    const favorita = listaDirecciones.find((d) => d.favorita) ?? listaDirecciones[0];
    if (favorita !== undefined) {
      setIdDireccionEntrega(favorita.id);
    }
  }, [abierto, oc, idDireccionEntrega, listaDirecciones]);
  const direccionElegida = listaDirecciones.find((d) => d.id === idDireccionEntrega);

  // Rol al que se acota la lista, recalculado con cada cambio de renglones. La CONSULTA ya no vive
  // aquí: la hace el `SelectorProveedor` (búsqueda server-side), que además conserva al proveedor
  // capturado fuera del rol vigente mostrando su `nombreSeleccionado`.
  const rolProveedor = useMemo(() => rolSegunRenglones(renglones), [renglones]);

  /**
   * Fija el proveedor del encabezado. §Post-F9.15: las telas ya capturadas son de OTRO proveedor,
   * así que se limpian (el renglón se conserva) y se avisa, en vez de dejar que el servidor
   * rechace el guardado al final con la orden entera ya tecleada.
   */
  function cambiarProveedor(id: number | null, nombre: string): void {
    setIdProveedor(id);
    setNombreProveedor(nombre);
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
  }

  // Al abrir, carga los datos de la OC (edición) o limpia (alta).
  useEffect(() => {
    if (!abierto) {
      return;
    }
    setMostrarCerradas(false);
    if (oc !== undefined) {
      setIdProveedor(oc.idProveedor);
      setNombreProveedor(oc.proveedor);
      setFechaEntrega(oc.fechaEntrega ?? '');
      setIdDireccionEntrega(oc.idDireccionEntrega);
      setObservaciones(oc.observaciones ?? '');
      setCorrespondeA(oc.correspondeA ?? '');
      setRenglones(capturaDesdeOc(oc));
    } else {
      setIdProveedor(null);
      setNombreProveedor('');
      setFechaEntrega('');
      setIdDireccionEntrega(null);
      setObservaciones('');
      setCorrespondeA('');
      setRenglones([renglonVacio()]);
    }
  }, [abierto, oc]);

  /**
   * ⭐ 0.226b (§Post-F9.244): las órdenes CERRADAS que tocan los renglones. No se le compra a una
   * orden cerrada (el servidor rechaza la OC, A1): se avisa ARRIBA de los renglones y se apaga el
   * guardar hasta quitarlos. Se sabe por la orden de la lista (`estado`) y, en una OC ya guardada,
   * por el `ordenCerrada` de cada renglón (por si su orden no viene en la página de órdenes).
   */
  const foliosCerrados = useMemo(() => {
    const cerradas = new Map<number, number | string>();
    // ⭐ 0.227: TODAS las órdenes vistas en el diálogo, no sólo la página actual — si alguien elige
    // una cerrada con «Mostrar cerradas» y luego lo apaga, la pantalla sigue sabiendo que lo está.
    for (const o of ordenes.vistas.values()) {
      if (estaCerrada(o)) cerradas.set(o.id, o.folio ?? o.id);
    }
    for (const l of oc?.lineas ?? []) {
      if (l.ordenCerrada && l.idOrden !== null) cerradas.set(l.idOrden, l.folioOrden ?? l.idOrden);
    }
    const folios: (number | string)[] = [];
    for (const r of renglones) {
      const folio = r.idOrden === null ? undefined : cerradas.get(r.idOrden);
      if (folio !== undefined) folios.push(folio);
    }
    return [...new Set(folios)];
  }, [renglones, ordenes.vistas, oc]);

  /**
   * ⭐ 0.227: el desplegable de cada renglón = las abiertas (o todas, con el interruptor) + las YA
   * elegidas que la página no trae — un renglón de una OC vieja ligado a una cerrada se sigue viendo
   * ligado (y marcado), en vez de leerse «Sin ligar».
   */
  const ordenesDelEditor = useMemo(() => {
    const conocidas = new Map<number, OrdenElegible>(ordenes.vistas);
    for (const l of oc?.lineas ?? []) {
      if (l.idOrden !== null && !conocidas.has(l.idOrden)) {
        conocidas.set(l.idOrden, {
          id: l.idOrden,
          folio: l.folioOrden ?? l.idOrden,
          ordenCerrada: l.ordenCerrada,
        });
      }
    }
    return ordenesConElegidas(
      ordenes.lista,
      renglones.map((r) => r.idOrden),
      conocidas,
    );
  }, [ordenes.lista, ordenes.vistas, oc, renglones]);

  function confirmar(): void {
    if (idProveedor === null) {
      toast.error('Elige el proveedor de la orden de compra.');
      return;
    }
    // §Post-F9.18: fecha de entrega y dirección son OBLIGATORIAS. Se avisa aquí para no mandar el
    // formulario entero y que el servidor lo rechace (él igual re-valida, A1).
    if (fechaEntrega === '') {
      toast.error('Captura la fecha de entrega: es obligatoria.');
      return;
    }
    if (idDireccionEntrega === null) {
      toast.error('Elige la dirección de entrega del catálogo.');
      return;
    }
    const encabezado = {
      idProveedor,
      // La fecha de EMISIÓN no se manda: la pone el servidor con el día de la captura.
      fechaEntrega,
      idDireccionEntrega,
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
              {/* V1-E7g (§Post-F9.52 punto 7): el proveedor se busca por CUALQUIER PALABRA. Un
                  `<select>` nativo solo deja teclear el PREFIJO (typeahead del navegador) y encima
                  topaba en 100 proveedores; el combobox busca en el SERVIDOR (`LIKE %texto%`). */}
              <SelectorProveedor
                rol={rolProveedor}
                idSeleccionado={idProveedor ?? undefined}
                nombreSeleccionado={nombreProveedor === '' ? undefined : nombreProveedor}
                alSeleccionar={(p) => {
                  cambiarProveedor(p.id, p.nombre);
                }}
                alLimpiar={() => {
                  cambiarProveedor(null, '');
                }}
                deshabilitado={soloLectura}
                idInput="oc-proveedor"
                testid="oc-proveedor"
              />
              {rolProveedor !== undefined ? (
                <p className="text-xs text-muted-foreground" data-testid="oc-proveedor-ayuda">
                  {AYUDA_POR_ROL[rolProveedor]}
                </p>
              ) : null}
            </Field>
            {/* §Post-F9.18: la fecha de emisión NO se captura — es el día en que se hace la OC.
                Se muestra para que se vea, nunca como campo editable. */}
            <Field>
              <FieldLabel htmlFor="oc-fecha">Fecha de emisión</FieldLabel>
              <p
                id="oc-fecha"
                className="flex h-9 items-center text-sm text-muted-foreground"
                data-testid="oc-fecha"
              >
                {esEdicion
                  ? (oc?.fecha ?? 'Sin fecha (orden migrada)')
                  : 'Hoy — la pone el sistema al crearla'}
              </p>
            </Field>
            <Field>
              <FieldLabel htmlFor="oc-fecha-entrega">Fecha de entrega *</FieldLabel>
              <Input
                id="oc-fecha-entrega"
                type="date"
                required
                disabled={soloLectura}
                value={fechaEntrega}
                onChange={(e) => setFechaEntrega(e.target.value)}
                data-testid="oc-fecha-entrega"
              />
            </Field>
            {/* La dirección sale del CATÁLOGO: siempre escrita igual, y se ve completa debajo. */}
            <Field>
              <FieldLabel htmlFor="oc-direccion-entrega">Entregar en *</FieldLabel>
              <SelectNativo
                id="oc-direccion-entrega"
                disabled={soloLectura || direcciones.isPending}
                value={idDireccionEntrega === null ? '' : String(idDireccionEntrega)}
                onChange={(e) =>
                  setIdDireccionEntrega(e.target.value === '' ? null : Number(e.target.value))
                }
                data-testid="oc-direccion-entrega"
              >
                <option value="">
                  {listaDirecciones.length === 0
                    ? 'No hay direcciones: dalas de alta en Compras › Direcciones de entrega'
                    : 'Elige la dirección…'}
                </option>
                {/* Una OC migrada (o de una dirección ya desactivada) no pierde la suya. */}
                {idDireccionEntrega !== null && direccionElegida === undefined ? (
                  <option value={String(idDireccionEntrega)}>
                    {oc?.direccionEntregaNombre ?? 'Dirección actual'}
                  </option>
                ) : null}
                {listaDirecciones.map((d) => (
                  <option key={d.id} value={String(d.id)}>
                    {d.nombre}
                    {d.favorita ? ' (la de siempre)' : ''}
                  </option>
                ))}
              </SelectNativo>
              <p className="text-xs text-muted-foreground" data-testid="oc-direccion-entrega-texto">
                {direccionElegida?.direccion ?? oc?.entregaEn ?? 'Se llena sola al elegirla.'}
              </p>
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

          {!soloLectura && foliosCerrados.length > 0 ? (
            <AvisoOrdenCerrada
              folios={foliosCerrados}
              detalle="Quita sus renglones para poder guardar la orden de compra."
            />
          ) : null}

          {/* Renglones */}
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-muted-foreground">Renglones</h3>
              {/* ⭐ 0.227: el desplegable «Orden ligada» oculta las cerradas por omisión. */}
              {!soloLectura ? (
                <InterruptorCerradas
                  activo={mostrarCerradas}
                  alCambiar={setMostrarCerradas}
                  testid="oc-mostrar-cerradas"
                />
              ) : null}
            </div>
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
              ordenes={ordenesDelEditor}
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
              disabled={guardando || idProveedor === null || foliosCerrados.length > 0}
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
