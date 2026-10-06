import { DownloadIcon, InfoIcon, Loader2Icon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { useHabilitacionOrden } from '@/api/habilitacion';
import { useActualizarNota, useCrearNota } from '@/api/notas-salida';
import type { HabilitacionOrden, NotaSalida, NotaSalidaCrear, NotaSalidaEditar } from '@/api/tipos';
import { hoy } from '@/lib/fecha-negocio';
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
import { useStockAvioEnAlmacen } from '@/modulos/inventarios/useStockAvioEnAlmacen';

import {
  capturaDesdeNota,
  nuevaClaveRenglon,
  renglonApi,
  renglonCompleto,
  renglonVacio,
  type RenglonNotaCaptura,
} from './captura';
import { AvisoOrdenCerrada } from '@/components/dominio/AvisoOrdenCerrada';
import { InterruptorCerradas } from '@/components/dominio/InterruptorCerradas';
import { estaCerrada } from '@/lib/orden-cerrada';
import {
  ordenesConElegidas,
  rotuloOrdenElegible,
  useOrdenesDeCaptura,
  type OrdenElegible,
} from '@/modulos/produccion/ordenes-de-captura';
import { EditorRenglonesNota } from './EditorRenglonesNota';
import { cantidadEnNotaPorAvio, type FilaPreliminarAvio } from './preliminar-avios';
import { PreliminarAviosOrden } from './PreliminarAviosOrden';

/** Un renglón para pre-cargar el constructor (viene del panel de habilitación, §4.6). */
export interface PrefillRenglonNota {
  idOrden: number;
  idAvio: number;
  /** Clave del avío (la trae la habilitación): la muestra el combobox del renglón. */
  clave?: string | null;
  cantidad: number;
  unidad: string | null;
}

/** Datos para PRE-CARGAR el constructor desde la habilitación ("Pasar a nota de salida"). */
export interface PrefillNota {
  idMaquilero?: number | null;
  idAlmacen?: number | null;
  renglones?: PrefillRenglonNota[];
  /** Recetas conocidas (idOrden → ids de avío de su receta) para el flag ✓/⚠ ya pre-cargado. */
  recetaPorOrden?: Record<number, number[]>;
  /**
   * ⭐ 0.226b: órdenes CERRADAS que el llamador ya conoce (la habilitación lo sabe por su orden).
   * Sin esto, el constructor sólo sabría del cierre si la orden viniera en su página de órdenes.
   */
  ordenesCerradas?: { idOrden: number; folio: number }[];
}

/**
 * Diálogo de CAPTURA / EDICIÓN de una nota de salida (F4-E5; rediseño R6 §4.6). Si recibe `nota`,
 * edita; si recibe `prefill`, da de alta PRE-CARGADO (desde "Pasar a nota de salida" de la
 * habilitación); si no, alta vacía. Encabezado (maquilero, almacén origen [decisión g], fechas,
 * observaciones) + **"Traer avíos de la orden"** (preliminar de la receta con lo que le falta a la orden, PROPONE
 * no LIMITA) + renglones de AVÍO (con flag de receta ✓/⚠ y existencia; la tela ya no se captura
 * aquí — §Post-F9.38: la salida de tela a una orden NO lleva nota). Una nota
 * confirmada/cancelada va en `soloLectura`. Acciones gobernadas por `notas.administrar`; el backend
 * es la autoridad (A1).
 */
export function DialogoEditarNota({
  abierto,
  alCambiarAbierto,
  nota,
  prefill,
  soloLectura = false,
  alGuardada,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Nota a editar; `undefined` = alta de un borrador nuevo. */
  nota?: NotaSalida | undefined;
  /** Datos para pre-cargar el alta (desde la habilitación); ignorado en edición. */
  prefill?: PrefillNota | undefined;
  /** Bloquea toda edición (nota confirmada/cancelada); el backend re-valida. */
  soloLectura?: boolean;
  /** Callback con el id de la nota guardada (para enfocarla en la lista). */
  alGuardada: (id: number) => void;
}): React.JSX.Element {
  const crear = useCrearNota();
  const actualizar = useActualizarNota();
  const guardando = crear.isPending || actualizar.isPending;
  const esEdicion = nota !== undefined;

  // ── Catálogos para los selectores. ───────────────────────────────────────────
  // Solo almacenes de AVIO: la nota de salida es SOLO de avíos (§Post-F9.38) y el dominio exige
  // que su almacén origen sea de ese tipo (fila 0.137).
  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    tipo: 'AVIO',
  });
  // ⭐ 0.227: los desplegables de orden (renglón y «Traer avíos») ofrecen sólo las ABIERTAS salvo
  // «Mostrar cerradas» (filtro en el servidor): a una orden cerrada no se le surten avíos.
  const [mostrarCerradas, setMostrarCerradas] = useState(false);
  const ordenes = useOrdenesDeCaptura(mostrarCerradas);

  // ── Estado del encabezado. ───────────────────────────────────────────────────
  const [idMaquilero, setIdMaquilero] = useState<number | null>(null);
  // Nombre del maquilero elegido: con búsqueda server-side el combobox sólo conoce su página, así
  // que al EDITAR una nota vieja el campo se vería en blanco sin esto.
  const [nombreMaquilero, setNombreMaquilero] = useState<string | undefined>(undefined);
  const [idAlmacen, setIdAlmacen] = useState<number | null>(null);
  const [fechaElaboracion, setFechaElaboracion] = useState('');
  const [fechaEnvio, setFechaEnvio] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [renglones, setRenglones] = useState<RenglonNotaCaptura[]>([]);
  // Recetas conocidas por orden (idOrden → ids de avío) para el flag ✓/⚠ del editor.
  const [recetas, setRecetas] = useState<Record<number, number[]>>({});
  // Orden elegida en el selector "Traer avíos de la orden".
  const [ordenTraer, setOrdenTraer] = useState<number | null>(null);
  // ⭐ Fila 0.220: la orden cuyo PRELIMINAR está abierto (null = cerrado).
  const [idOrdenPreliminar, setIdOrdenPreliminar] = useState<number | null>(null);

  // Habilitación de la orden elegida para "Traer avíos" (trae la receta + lo que le falta).
  const habTraer = useHabilitacionOrden(ordenTraer ?? undefined);
  const habLista =
    habTraer.data !== undefined && ordenTraer !== null && habTraer.data.idOrden === ordenTraer;
  /**
   * ⭐ Fila 0.220 (reviewer): ¿se puede CREER lo que trae la habilitación? No mientras se refresca
   * en segundo plano —tras confirmar una nota la caché se invalida y TanStack entrega los datos
   * VIEJOS con `isPending=false`— ni si ese refresco falló (se quedan los viejos). Abrir el
   * preliminar ahí propondría una falta que ya no es.
   */
  const habCreible = habLista && !habTraer.isFetching && !habTraer.isError;
  const errorReceta =
    ordenTraer !== null && habTraer.isError
      ? `No se pudo leer la receta de la orden: ${habTraer.error.message}`
      : null;
  /**
   * La habilitación que ve el preliminar: la de la consulta, EN VIVO, mientras sea de su orden — no
   * una foto tomada al abrir (si la consulta se refresca con el preliminar abierto, la falta se
   * actualiza ahí mismo).
   */
  const habPreliminar: HabilitacionOrden | undefined =
    idOrdenPreliminar !== null && habTraer.data?.idOrden === idOrdenPreliminar
      ? habTraer.data
      : undefined;
  /** Lo que ESTA nota ya lleva de cada avío para la orden del preliminar (se le descuenta). */
  const enNotaPreliminar = useMemo(
    () =>
      idOrdenPreliminar === null
        ? new Map<number, number>()
        : cantidadEnNotaPorAvio(renglones, idOrdenPreliminar),
    [renglones, idOrdenPreliminar],
  );

  /**
   * Existencia por avío en el almacén origen — o `undefined` cuando **no se sabe** (sin almacén, en
   * vuelo, con los datos del almacén ANTERIOR o con la consulta en error). La diferencia entre «mapa
   * vacío» y `undefined` es la que evita que la pantalla frene una captura por un cero que se
   * inventó: con `undefined`, ni se pinta existencia ni se bloquea nada, y decide el servidor al
   * confirmar (A1).
   *
   * ⭐ Fila 0.216, y desde la 0.233 en un hook compartido con las otras tres pantallas que sacan
   * avíos: las cuatro condiciones de «ya se sabe qué hay» viven en {@link useStockAvioEnAlmacen}.
   */
  const existenciaPorAvio = useStockAvioEnAlmacen(idAlmacen);
  /** ¿Ya se sabe qué hay en el almacén origen? Decide si «Traer avíos» puede filtrar. */
  const stockConocido = existenciaPorAvio !== undefined;

  const recetaPorOrden = useMemo(() => {
    const mapa = new Map<number, Set<number>>();
    for (const [clave, ids] of Object.entries(recetas)) mapa.set(Number(clave), new Set(ids));
    return mapa;
  }, [recetas]);

  // Al abrir, carga los datos de la nota (edición), el prefill (alta pre-cargada) o limpia (alta).
  useEffect(() => {
    if (!abierto) {
      return;
    }
    setOrdenTraer(null);
    setIdOrdenPreliminar(null);
    setMostrarCerradas(false);
    if (nota !== undefined) {
      setIdMaquilero(nota.idMaquilero);
      setNombreMaquilero(nota.maquilero);
      setIdAlmacen(nota.idAlmacen);
      setFechaElaboracion(nota.fechaElaboracion);
      setFechaEnvio(nota.fechaEnvio ?? '');
      setObservaciones(nota.observaciones ?? '');
      setRenglones(capturaDesdeNota(nota));
      setRecetas({});
    } else if (prefill !== undefined) {
      setIdMaquilero(prefill.idMaquilero ?? null);
      // El prefill sólo trae el id; el nombre lo repone el combobox al resolver su página.
      setNombreMaquilero(undefined);
      setIdAlmacen(prefill.idAlmacen ?? null);
      setFechaElaboracion(hoy());
      // 🔴 LA FECHA DE ENVÍO NACE VACÍA, Y ESO NO ES UN DESCUIDO: es un ESTADO del negocio
      // («todavía no ha salido»). El contrato la declara opcional *«cuando salga el envío»*
      // (`contrato/esquemas/nota-salida.ts`), dos pantallas pintan «pendiente» cuando es `null`
      // (`ConsultaNotasPagina`, `NotasSalidaPagina`), sale IMPRESA en el papel que acompaña las
      // prendas (`impreso-nota-salida.ts`) y `confirmarNotaSalida` NUNCA la escribe. Ponerla en
      // «hoy» por default borraba ese estado para toda nota nueva. ⏳ Fila 0.216: queda pendiente la
      // decisión de Daniel (con el costo a la vista) sobre escribirla al CONFIRMAR la nota — que le
      // daría la fecha sin teclearla y conservaría el «pendiente» del borrador.
      setFechaEnvio('');
      setObservaciones('');
      setRenglones(
        (prefill.renglones ?? []).map((r) => ({
          clave: nuevaClaveRenglon(),
          tipo: 'avio' as const,
          idOrden: r.idOrden,
          idAvio: r.idAvio,
          avioEtiqueta: r.clave ?? null,
          idTela: null,
          telaNombre: null,
          idLote: null,
          loteClave: null,
          idMovimientoSalidaTela: null,
          cantidad: String(r.cantidad),
          unidad: r.unidad ?? '',
          descripcionLegacy: null,
        })),
      );
      setRecetas(prefill.recetaPorOrden ?? {});
    } else {
      setIdMaquilero(null);
      setIdAlmacen(null);
      setFechaElaboracion(hoy());
      // 🔴 Vacía también en el alta sin pre-carga: ver el porqué en la rama del prefill de arriba.
      setFechaEnvio('');
      setObservaciones('');
      setRenglones([renglonVacio()]);
      setRecetas({});
    }
  }, [abierto, nota, prefill]);

  /**
   * «Traer avíos de la orden»: abre el PRELIMINAR con la receta de la orden elegida (fila 0.220).
   *
   * ⭐⭐ FILA 0.216 — **sólo se puede mandar lo que HAY en el almacén origen.** Daniel: *«como me jala
   * avíos que no hay stock, no me deja… que no deje meter los avíos que no hay stock, ANTES de
   * meterlos»* (§Post-F9.243, punto 07c).
   *
   * ⭐⭐ FILA 0.220 — **y antes de meterlos, se escogen.** Daniel (punto 07b): *«estaría bien ver un
   * preliminar y seleccionar qué avíos son los que se van a mandar (obviamente tendría que validar
   * que sólo te ofrezca los que ya se recibieron en almacén)»*. Ya no se meten de golpe: se abre
   * {@link PreliminarAviosOrden} con TODA la receta, los que no hay se ven deshabilitados y entran
   * sólo los marcados ({@link agregarDesdePreliminar}).
   *
   * 🔒 Y por eso el ALMACÉN —con su existencia ya leída— es requisito de este botón: el stock es *de
   * un almacén*, así que sin él no hay nada contra lo que comparar (`hayStockDeAvio` dejaría marcar
   * todo) y volvería el defecto de la 0.216.
   */
  function traerAvios(): void {
    if (errorReceta !== null) {
      toast.error(errorReceta);
      return;
    }
    if (!habCreible || habTraer.data === undefined) {
      toast.error('Elige una orden y espera a que cargue su receta.');
      return;
    }
    if (idAlmacen === null) {
      toast.error('Elige primero el almacén origen: de ahí se sabe qué avíos hay para mandar.');
      return;
    }
    if (!stockConocido) {
      toast.error(
        'Todavía no se sabe qué hay en el almacén origen: espera a que cargue su existencia.',
      );
      return;
    }
    const data = habTraer.data;
    if (!data.avios.some((a) => !a.esExtra)) {
      toast.error('La orden no tiene avíos en su receta.');
      return;
    }
    setIdOrdenPreliminar(data.idOrden);
  }

  /**
   * Mete a la nota los avíos MARCADOS en el preliminar (cantidad = lo que le FALTA a la orden, fila
   * 0.220; PROPONE, no LIMITA: el renglón la deja editar).
   *
   * 🔴 EL FILTRO DE LAS FILAS 0.216 Y 0.220 vive en `aviosAEnviar` (lo aplica el preliminar antes de
   * llamar aquí): sólo los marcados y que tienen existencia. Si se quitara, la nota volvería a nacer
   * con renglones que el servidor rechaza al confirmar — el callejón sin salida que Daniel reportó.
   *
   * `sinExistencia` viene de las MISMAS filas del preliminar (`faltantesSinExistencia`): una sola
   * fuente para lo que se avisa como faltante.
   */
  function agregarDesdePreliminar(
    seleccionados: FilaPreliminarAvio[],
    sinExistencia: FilaPreliminarAvio[],
  ): void {
    if (habPreliminar === undefined) return;
    const data = habPreliminar;
    setIdOrdenPreliminar(null);
    const deReceta = data.avios.filter((a) => !a.esExtra);
    const nuevos: RenglonNotaCaptura[] = seleccionados.map((a) => ({
      clave: nuevaClaveRenglon(),
      tipo: 'avio',
      idOrden: data.idOrden,
      idAvio: a.idAvio,
      avioEtiqueta: a.clave,
      idTela: null,
      telaNombre: null,
      idLote: null,
      loteClave: null,
      idMovimientoSalidaTela: null,
      cantidad: String(a.cantidad),
      unidad: a.unidad ?? '',
      descripcionLegacy: null,
    }));
    // Conserva los renglones ya capturados (descarta los vacíos, como en el proto).
    setRenglones((prev) => {
      const conContenido = prev.filter(
        (r) => r.idAvio !== null || r.idTela !== null || r.idOrden !== null || r.cantidad !== '',
      );
      return [...conContenido, ...nuevos];
    });
    // La RECETA completa (no sólo lo traído): el flag ✓/⚠ dice si el avío pertenece a la receta de
    // la orden, y eso no cambia porque hoy no haya existencia de él ni porque no se haya marcado.
    setRecetas((prev) => ({ ...prev, [data.idOrden]: deReceta.map((a) => a.idAvio) }));
    if (idMaquilero === null && data.idMaquilero !== null) setIdMaquilero(data.idMaquilero);
    toast.success(
      nuevos.length === 1
        ? `1 avío de la orden ${String(data.folioOrden)} agregado desde su receta.`
        : `${String(nuevos.length)} avíos de la orden ${String(data.folioOrden)} agregados desde su receta.`,
    );
    // Un aviso APARTE del éxito, y con las claves: los que la receta pide y no hay en el almacén.
    // El preliminar ya los enseñaba; se repite aquí porque al cerrarlo se pierde de vista y alguien
    // tiene que ir a comprarlos. Los que se DESMARCARON a propósito no se avisan (fue una decisión),
    // ni lo ya surtido o lo que ya va en esta nota (no falta comprarlos).
    if (sinExistencia.length > 0) {
      const claves = sinExistencia.map((a) => a.clave).join(', ');
      toast.warning(
        sinExistencia.length === 1
          ? `No se trajo 1 avío de la receta porque no hay existencia en este almacén: ${claves}.`
          : `No se trajeron ${String(sinExistencia.length)} avíos de la receta porque no hay existencia en este almacén: ${claves}.`,
      );
    }
  }

  /**
   * ⭐ 0.226b (§Post-F9.244): las órdenes CERRADAS que tocan los renglones. Una nota no se guarda
   * con un renglón que surta a una orden cerrada (el servidor la rechaza, A1): se avisa ARRIBA de
   * los renglones y se apaga el guardar hasta quitarlos. Se sabe por dos lados: la orden de la
   * lista (`estado`) y, en una nota ya guardada, el `ordenCerrada` que trae cada renglón (por si su
   * orden no viene en la página de órdenes).
   */
  const idsOrdenCerradas = useMemo(() => {
    const ids = new Set<number>();
    // 0.227: TODAS las vistas en el diálogo (no sólo la página actual): apagar «Mostrar cerradas»
    // no hace olvidar que la orden elegida está cerrada.
    for (const o of ordenes.vistas.values()) if (estaCerrada(o)) ids.add(o.id);
    for (const l of nota?.lineas ?? []) if (l.ordenCerrada) ids.add(l.idOrden);
    for (const o of prefill?.ordenesCerradas ?? []) ids.add(o.idOrden);
    return ids;
  }, [ordenes.vistas, nota, prefill]);
  const foliosCerrados = useMemo(() => {
    const folioPorId = new Map<number, number>();
    for (const o of ordenes.vistas.values()) folioPorId.set(o.id, o.folio ?? o.id);
    for (const l of nota?.lineas ?? []) {
      if (l.folioOrden !== null) folioPorId.set(l.idOrden, l.folioOrden);
    }
    for (const o of prefill?.ordenesCerradas ?? []) folioPorId.set(o.idOrden, o.folio);
    const folios: (number | string)[] = [];
    for (const r of renglones) {
      if (r.idOrden !== null && idsOrdenCerradas.has(r.idOrden)) {
        folios.push(folioPorId.get(r.idOrden) ?? r.idOrden);
      }
    }
    return [...new Set(folios)];
  }, [renglones, idsOrdenCerradas, ordenes.vistas, nota, prefill]);

  /**
   * ⭐ 0.227: lo que se sabe de cada orden que el diálogo puede tener elegida aunque la página no la
   * traiga (una cerrada de una nota vieja o del prefill): así su renglón se sigue viendo ligado —y
   * marcado— en vez de «Elige una orden…».
   */
  const conocidas = useMemo(() => {
    const mapa = new Map<number, OrdenElegible>(ordenes.vistas);
    for (const l of nota?.lineas ?? []) {
      if (!mapa.has(l.idOrden)) {
        mapa.set(l.idOrden, {
          id: l.idOrden,
          folio: l.folioOrden ?? l.idOrden,
          ordenCerrada: l.ordenCerrada,
        });
      }
    }
    for (const o of prefill?.ordenesCerradas ?? []) {
      if (!mapa.has(o.idOrden))
        mapa.set(o.idOrden, { id: o.idOrden, folio: o.folio, ordenCerrada: true });
    }
    return mapa;
  }, [ordenes.vistas, nota, prefill]);
  const ordenesDeRenglones = useMemo(
    () =>
      ordenesConElegidas(
        ordenes.lista,
        renglones.map((r) => r.idOrden),
        conocidas,
      ),
    [ordenes.lista, renglones, conocidas],
  );
  const ordenesDeTraer = useMemo(
    () => ordenesConElegidas(ordenes.lista, [ordenTraer], conocidas),
    [ordenes.lista, ordenTraer, conocidas],
  );
  const ordenTraerCerrada = ordenTraer !== null && idsOrdenCerradas.has(ordenTraer);

  const renglonesValidos = renglones.length > 0 && renglones.every(renglonCompleto);
  const puedeGuardar =
    foliosCerrados.length === 0 &&
    !guardando &&
    idMaquilero !== null &&
    idAlmacen !== null &&
    fechaElaboracion !== '' &&
    renglonesValidos;

  // Totales vivos (# órdenes distintas · # renglones), §4.6.
  const numOrdenes = new Set(renglones.map((r) => r.idOrden).filter((o) => o !== null)).size;

  function confirmar(): void {
    if (idMaquilero === null) {
      toast.error('Elige el maquilero destino de la nota.');
      return;
    }
    if (idAlmacen === null) {
      toast.error('Elige el almacén origen de la nota.');
      return;
    }
    if (!renglonesValidos) {
      toast.error('Completa todos los renglones (orden + material + cantidad).');
      return;
    }
    const cuerpo = {
      idMaquilero,
      idAlmacen,
      fechaElaboracion,
      fechaEnvio: fechaEnvio === '' ? null : fechaEnvio,
      observaciones: observaciones.trim() || null,
      lineas: renglones.map(renglonApi),
    };

    if (esEdicion && nota !== undefined) {
      const cuerpoEditar: NotaSalidaEditar = cuerpo;
      actualizar.mutate(
        { id: nota.id, cuerpo: cuerpoEditar },
        {
          onSuccess: (guardada) => {
            toast.success(`Nota de salida ${guardada.numNota} actualizada.`);
            alCambiarAbierto(false);
            alGuardada(guardada.id);
          },
          onError: (error) => toast.error(error.message),
        },
      );
    } else {
      const cuerpoCrear: NotaSalidaCrear = cuerpo;
      crear.mutate(cuerpoCrear, {
        onSuccess: (guardada) => {
          toast.success(`Nota de salida ${guardada.numNota} creada en borrador.`);
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
              ? `Nota de salida ${nota?.numNota ?? ''}`
              : esEdicion
                ? `Editar nota de salida ${nota?.numNota ?? ''}`
                : 'Nueva nota de salida'}
          </DialogTitle>
          <DialogDescription>
            {soloLectura
              ? 'Esta nota ya no está en borrador: se muestra en solo lectura.'
              : 'Captura el encabezado y los renglones. El folio lo asigna el sistema; los avíos se descuentan al confirmar.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Encabezado */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="nota-maquilero">Maquilero</FieldLabel>
              {/* V1-E7g (§Post-F9.52 punto 7): el maquilero se busca por CUALQUIER palabra, en el
                  SERVIDOR. El `<select>` de aquí sólo dejaba teclear el prefijo y topaba en 100. */}
              <SelectorProveedor
                idSeleccionado={idMaquilero ?? undefined}
                nombreSeleccionado={nombreMaquilero}
                alSeleccionar={(p) => {
                  setIdMaquilero(p.id);
                  setNombreMaquilero(p.nombre);
                }}
                alLimpiar={() => {
                  setIdMaquilero(null);
                  setNombreMaquilero(undefined);
                }}
                deshabilitado={soloLectura}
                placeholder="Elige un maquilero…"
                etiqueta="Maquilero"
                idInput="nota-maquilero"
                testid="nota-maquilero"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="nota-almacen">Almacén origen</FieldLabel>
              <SelectNativo
                id="nota-almacen"
                disabled={soloLectura || almacenes.isPending}
                value={idAlmacen === null ? '' : String(idAlmacen)}
                onChange={(e) =>
                  setIdAlmacen(e.target.value === '' ? null : Number(e.target.value))
                }
                data-testid="nota-almacen"
              >
                <option value="">Elige un almacén…</option>
                {(almacenes.data?.datos ?? []).map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            <Field>
              <FieldLabel htmlFor="nota-fecha-elaboracion">Fecha de elaboración</FieldLabel>
              <Input
                id="nota-fecha-elaboracion"
                type="date"
                disabled={soloLectura}
                value={fechaElaboracion}
                onChange={(e) => setFechaElaboracion(e.target.value)}
                data-testid="nota-fecha-elaboracion"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="nota-fecha-envio">Fecha de envío</FieldLabel>
              <Input
                id="nota-fecha-envio"
                type="date"
                disabled={soloLectura}
                value={fechaEnvio}
                onChange={(e) => setFechaEnvio(e.target.value)}
                data-testid="nota-fecha-envio"
              />
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="nota-observaciones">Observaciones</FieldLabel>
              <Input
                id="nota-observaciones"
                disabled={soloLectura}
                placeholder="Notas del envío"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                data-testid="nota-observaciones"
              />
            </Field>
          </div>

          {/* Traer avíos de la orden (la receta PROPONE, no LIMITA — §4.6). */}
          {!soloLectura ? (
            <div
              className="flex flex-col gap-2 rounded-md border bg-panel-2 p-3 sm:flex-row sm:items-end"
              data-testid="nota-traer-avios"
            >
              {/* ⭐ Fila 0.216 — el texto DICE las dos cosas nuevas: que hace falta el almacén, y
                  que sólo se trae lo que hay ahí. El aviso llega ANTES de capturar, no al
                  confirmar, que es justo lo que Daniel pidió. */}
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground sm:flex-1">
                <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                La receta del modelo ya dice qué avíos lleva la orden. Tráelos con lo que le falta
                por surtir y escoge cuáles mandar. Elige antes el almacén origen: sólo se pueden
                mandar los avíos que hay ahí.
              </p>
              <div className="flex items-end gap-2">
                <label className="text-xs text-muted-foreground">
                  Orden
                  <SelectNativo
                    className="mt-1"
                    aria-label="Orden para traer sus avíos"
                    value={ordenTraer === null ? '' : String(ordenTraer)}
                    onChange={(e) =>
                      setOrdenTraer(e.target.value === '' ? null : Number(e.target.value))
                    }
                    data-testid="nota-traer-orden"
                  >
                    <option value="">Elige una orden…</option>
                    {ordenesDeTraer.map((o) => (
                      <option key={o.id} value={String(o.id)}>
                        {/* « · Cerrada» sólo con «Mostrar cerradas» o si ya estaba elegida (0.227). */}
                        {rotuloOrdenElegible(o)}
                      </option>
                    ))}
                  </SelectNativo>
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={traerAvios}
                  disabled={
                    ordenTraer === null ||
                    ordenTraerCerrada ||
                    habTraer.isPending ||
                    // ⭐ 0.220 (reviewer): ni con un refresco en vuelo ni con la consulta en error.
                    habTraer.isFetching ||
                    habTraer.isError
                  }
                  data-testid="nota-traer-boton"
                >
                  <DownloadIcon aria-hidden />
                  Traer avíos de la orden
                </Button>
                {/* ⭐ 0.227: UN interruptor para los dos desplegables de orden (éste y el de cada
                    renglón): por omisión sólo ofrecen órdenes ABIERTAS. */}
                <InterruptorCerradas
                  activo={mostrarCerradas}
                  alCambiar={setMostrarCerradas}
                  className="pb-2"
                  testid="nota-mostrar-cerradas"
                />
              </div>
            </div>
          ) : null}

          {/* ⭐ 0.220: si la receta de la orden no se pudo leer, el botón se apaga y aquí se dice por
              qué (no «espera a que cargue»: no va a cargar sola). */}
          {!soloLectura && errorReceta !== null ? (
            <p
              className="rounded-md bg-crit-soft px-2.5 py-1.5 text-xs text-crit"
              role="note"
              data-testid="nota-traer-error"
            >
              {errorReceta}
            </p>
          ) : null}

          {!soloLectura && foliosCerrados.length > 0 ? (
            <AvisoOrdenCerrada
              folios={foliosCerrados}
              detalle="Quita sus renglones para poder guardar la nota."
            />
          ) : null}

          {/* Renglones */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-medium text-muted-foreground">Renglones</h3>
              <span className="text-xs text-muted-foreground" data-testid="nota-totales">
                {numOrdenes} {numOrdenes === 1 ? 'orden' : 'órdenes'} · {renglones.length}{' '}
                {renglones.length === 1 ? 'renglón' : 'renglones'}
              </span>
            </div>
            <EditorRenglonesNota
              renglones={renglones}
              alCambiar={setRenglones}
              ordenes={ordenesDeRenglones}
              recetaPorOrden={recetaPorOrden}
              existenciaPorAvio={existenciaPorAvio}
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
              disabled={!puedeGuardar}
              data-testid="confirmar-nota"
            >
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear nota de salida'}
            </Button>
          ) : null}
        </DialogFooter>
        {/* ⭐ Fila 0.220: el preliminar (diálogo anidado) se monta sólo cuando se pide, así su
            selección inicial sale de la existencia de ESE momento. */}
        {habPreliminar !== undefined ? (
          <PreliminarAviosOrden
            folioOrden={habPreliminar.folioOrden}
            avios={habPreliminar.avios}
            stock={existenciaPorAvio}
            enNota={enNotaPreliminar}
            avisoDatos={
              habTraer.isError
                ? 'No se pudo volver a leer la orden: lo que falta puede haber cambiado. Cierra y vuelve a intentarlo.'
                : habTraer.isFetching
                  ? 'Actualizando lo que le falta a la orden…'
                  : null
            }
            alConfirmar={agregarDesdePreliminar}
            alCancelar={() => setIdOrdenPreliminar(null)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
