import { Info, LockOpen, Printer, ShoppingCart } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useDireccionesEntregaActivas } from '@/api/direcciones-entrega';
import { useExplosion, useGenerarOc, imprimirExplosion } from '@/api/mrp';
import { useConsultaOrdenes } from '@/api/ordenes-consulta';
import type { Requerimiento } from '@/api/tipos';
import { Badge } from '@/components/ui/badge';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatearMoneda } from '@/lib/formato';
import { useDebounce } from '@/lib/useDebounce';
import { useSesion } from '@/sesion/useSesion';

/**
 * EXPLOSIÓN DE MATERIALES por orden (F4-E4, R3): se elige una orden de producción y el backend
 * explosiona su BOM contra la matriz color×talla → qué/cuánto comprar, AGRUPADO por proveedor
 * sugerido (R1), con el neteo de genéricos visible (decisión d) y las DIFERENCIAS contra el snapshot
 * previo marcadas. Desde aquí se generan las OC (una por proveedor) con selección múltiple en un clic.
 * Solo presenta: el cálculo, el neteo, el snapshot y la generación los hace el SERVIDOR (A1).
 *
 * ⭐ V1-E3h (§Post-F9.72): desde que la receta se libera POR PARTES, esta explosión sale SOLO de los
 * renglones que Desarrollo firmó — y lo que quedó fuera se enseña aquí, con nombre y cantidad. Es
 * requisito textual de Daniel: que el comprador vea *"transparentemente qué le falta de liberar"*.
 * No es un "no se puede": es un **qué** y un **cuánto**, con el camino a donde se resuelve.
 */
export function ExplosionMaterialesPagina(): React.JSX.Element {
  const navigate = useNavigate();
  const { tienePermiso } = useSesion();
  // §Post-F9.68 — el enlace a "donde se libera" solo se pinta si esta sesión puede abrir el destino
  // (el panel de la OP y, dentro, la receta). Un enlace muerto sería peor que no tenerlo.
  const puedeIrALiberar = tienePermiso('ordenes.ver') && tienePermiso('desarrollo.ver');
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [idOrden, setIdOrden] = useState<number | null>(null);
  // Selección de renglones a comprar; vacío = todo lo pendiente con proveedor.
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());

  const ordenes = useConsultaOrdenes({
    pagina: 1,
    porPagina: 20,
    incluirCanceladas: 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });

  const explosion = useExplosion(idOrden ?? undefined);
  const generar = useGenerarOc();

  /**
   * §Post-F9.18: toda OC nace con fecha de entrega y dirección del catálogo, incluidas las que
   * genera esta pantalla. Se piden AQUÍ para que el servidor nunca tenga que adivinarlas: si se
   * dejan en blanco, el dominio cae a la fecha de entrega de la orden y a la dirección favorita, y
   * si tampoco existen, dice qué falta.
   */
  const [fechaEntrega, setFechaEntrega] = useState('');
  const direcciones = useDireccionesEntregaActivas();
  const listaDirecciones = direcciones.data?.datos ?? [];
  const [idDireccionEntrega, setIdDireccionEntrega] = useState<number | null>(null);
  const direccionEfectiva =
    idDireccionEntrega ?? listaDirecciones.find((d) => d.favorita)?.id ?? null;
  /**
   * §Post-F9.16 — NO ESCONDER, EXPLICAR (y ofrecer el camino). Sin dirección de entrega el dominio
   * RECHAZA la generación (`generarOCDesdeExplosion`), y el catálogo nace VACÍO: el botón se veía
   * habilitado y el error llegaba del servidor, sin decir a dónde ir. Se dice qué falta y se enlaza
   * el catálogo. `null` = no hay nada que avisar.
   *
   * `bloquea` distingue el AVISO del BLOQUEO: si la consulta del catálogo FALLA no sabemos si hay
   * direcciones o no —decir "está vacío" sería mentir con el catálogo lleno—, así que se avisa del
   * error pero NO se bloquea: que decida el servidor al guardar (nunca se bloquea por un error de
   * LECTURA).
   *
   * ORDEN DE LAS RAMAS: "ya hay dirección" se pregunta ANTES que el error. Un refetch que falla con
   * datos previos en cache no borra la que el usuario ya eligió en el select — avisar ahí que "no
   * sabemos cuál usar" sería falso.
   */
  const avisoDireccion: { texto: string; bloquea: boolean; enlace: boolean } | null =
    direcciones.isPending || direccionEfectiva !== null
      ? null
      : direcciones.isError
        ? {
            texto:
              'No se pudo consultar el catálogo de direcciones de entrega, así que no sabemos cuál usar. ' +
              'Reintenta; si generas de todos modos, el servidor decide (y dirá si falta la dirección).',
            bloquea: false,
            enlace: false,
          }
        : listaDirecciones.length === 0
          ? {
              texto:
                'El catálogo de direcciones de entrega está vacío, y toda orden de compra necesita una.',
              bloquea: true,
              enlace: true,
            }
          : {
              texto:
                'Ninguna dirección está marcada como favorita: elige una arriba (o marca la de siempre en el catálogo).',
              bloquea: true,
              enlace: true,
            };

  function elegirOrden(id: number): void {
    setIdOrden(id);
    setSeleccion(new Set());
    generar.reset();
  }

  function alternar(id: number): void {
    setSeleccion((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(id)) {
        siguiente.delete(id);
      } else {
        siguiente.add(id);
      }
      return siguiente;
    });
  }

  function generarOc(): void {
    if (idOrden === null) {
      return;
    }
    generar.mutate(
      {
        idOrden,
        cuerpo: {
          idsRequerimiento: [...seleccion],
          ...(fechaEntrega === '' ? {} : { fechaEntrega }),
          ...(direccionEfectiva === null ? {} : { idDireccionEntrega: direccionEfectiva }),
        },
      },
      { onSuccess: () => setSeleccion(new Set()) },
    );
  }

  const datos = explosion.data;
  // Renglones COMPRABLES (con proveedor sugerido y cantidad a comprar > 0).
  const comprables = (datos?.grupos ?? [])
    .flatMap((g) => g.renglones)
    .filter((r) => r.idProveedorSugerido !== null && r.cantidadAComprar > 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b p-4 lg:px-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Explosión de materiales · MRP
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Qué y cuánto comprar para una orden (make-to-order), agrupado por proveedor
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
        {/* Paso 1: elegir orden */}
        <div className="max-w-xl space-y-2">
          <label htmlFor="exp-buscar-orden" className="text-sm font-medium">
            Orden de producción
          </label>
          <Input
            id="exp-buscar-orden"
            type="search"
            placeholder="Buscar por folio, modelo o cliente…"
            value={textoBusqueda}
            onChange={(e) => setTextoBusqueda(e.target.value)}
            data-testid="exp-buscar-orden"
          />
          <div className="max-h-48 overflow-y-auto rounded-md border">
            {ordenes.isPending ? (
              <p className="p-3 text-sm text-muted-foreground">Cargando órdenes…</p>
            ) : ordenes.isError ? (
              <p className="p-3 text-sm text-destructive">{ordenes.error.message}</p>
            ) : (ordenes.data?.datos ?? []).length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                No hay órdenes que coincidan con la búsqueda.
              </p>
            ) : (
              <ul data-testid="exp-lista-ordenes">
                {(ordenes.data?.datos ?? []).map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => elegirOrden(o.id)}
                      aria-pressed={idOrden === o.id}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                        idOrden === o.id ? 'bg-primary-soft' : ''
                      }`}
                      data-testid="exp-orden-opcion"
                      data-orden={o.id}
                    >
                      <span className="font-medium">Orden {o.folio}</span>
                      <span className="truncate text-muted-foreground">
                        {o.codigoModelo} · {o.cliente}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Paso 2: explosión */}
        {idOrden !== null ? (
          <div className="mt-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <ShoppingCart className="size-4" aria-hidden />
                Materiales requeridos
                {datos ? ` · orden ${datos.folioOrden} · ${datos.totalPiezas} pzas` : ''}
              </h2>
              <div className="flex items-center gap-2">
                {/* El impreso pasa por la MISMA puerta que la explosión (V1-E3d): sin receta
                    liberada el servidor contesta 409 y la descarga reventaba sin decir por qué.
                    Si la explosión no cargó, el botón se apaga y lo explica en el tooltip. */}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={datos === undefined}
                  title={
                    datos === undefined
                      ? 'Primero tiene que cargar la explosión (si la receta no está liberada, el impreso tampoco se puede generar).'
                      : undefined
                  }
                  onClick={() => imprimirExplosion(idOrden)}
                  data-testid="exp-imprimir"
                >
                  <Printer aria-hidden /> Imprimir
                </Button>
                {/* La OC que salga de aquí necesita fecha de entrega y dirección (§Post-F9.18).
                    En blanco, el servidor usa la fecha de la orden y la dirección favorita. */}
                <label className="text-xs text-muted-foreground">
                  Entrega
                  <Input
                    className="mt-1"
                    type="date"
                    value={fechaEntrega}
                    onChange={(e) => setFechaEntrega(e.target.value)}
                    data-testid="exp-fecha-entrega"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Entregar en
                  <SelectNativo
                    className="mt-1"
                    value={direccionEfectiva === null ? '' : String(direccionEfectiva)}
                    onChange={(e) =>
                      setIdDireccionEntrega(e.target.value === '' ? null : Number(e.target.value))
                    }
                    data-testid="exp-direccion-entrega"
                  >
                    <option value="">
                      {direcciones.isError
                        ? 'No se pudo consultar el catálogo'
                        : listaDirecciones.length === 0
                          ? 'Sin direcciones dadas de alta'
                          : 'La de siempre'}
                    </option>
                    {listaDirecciones.map((d) => (
                      <option key={d.id} value={String(d.id)}>
                        {d.nombre}
                      </option>
                    ))}
                  </SelectNativo>
                </label>
                <Button
                  size="sm"
                  onClick={generarOc}
                  disabled={
                    generar.isPending ||
                    comprables.length === 0 ||
                    (avisoDireccion?.bloquea ?? false)
                  }
                  data-testid="exp-generar-oc"
                >
                  Generar OC desde la explosión
                </Button>
              </div>
            </div>

            {/* El "por qué no se puede" va a la vista, con el enlace al catálogo (§Post-F9.16).
                Cuando el catálogo no se pudo consultar, el aviso lo dice tal cual —no inventa que
                está vacío— y ofrece reintentar en vez de bloquear. */}
            {avisoDireccion !== null ? (
              <p
                className="mb-3 rounded-md border border-warn/30 bg-warn-soft p-2 text-xs text-warn"
                data-testid="exp-falta-direccion"
              >
                {avisoDireccion.bloquea ? <b>No se pueden generar las OC todavía: </b> : null}
                {avisoDireccion.texto}{' '}
                {avisoDireccion.enlace ? (
                  <Link className="underline" to="/catalogos/direcciones-entrega">
                    Abrir el catálogo de direcciones de entrega
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void direcciones.refetch()}
                    data-testid="exp-reintentar-direcciones"
                  >
                    Reintentar
                  </button>
                )}
                .
              </p>
            ) : null}

            {comprables.length > 0 ? (
              <div
                className="mb-3 flex items-center gap-2 rounded-md border border-info/30 bg-info-soft px-3 py-2 text-xs text-info"
                data-testid="exp-banner-faltantes"
              >
                <Info className="size-4 shrink-0" aria-hidden />
                <span>
                  <b>{comprables.length}</b> material(es) por comprar para esta orden —
                  selecciónalos y genera las OC (una por proveedor).
                </span>
              </div>
            ) : null}

            {/* ⭐ V1-E3h — QUÉ NO ESTÁ AQUÍ Y POR QUÉ. Antes la explosión frenaba en seco (409) si la
                receta no estaba liberada, y ni siquiera decía a qué pantalla ir. Ahora sale lo
                firmado y lo que falta se lista con su cantidad. El servidor lo agrega (A1). */}
            {(datos?.pendientesLiberar ?? []).length > 0 ? (
              <div
                className="mb-3 rounded-md border border-warn/30 bg-warn-soft p-2 text-xs text-warn"
                data-testid="exp-pendientes-liberar"
              >
                <p className="flex items-center gap-1.5 font-medium">
                  <LockOpen className="size-4 shrink-0" aria-hidden />
                  Desarrollo todavía no libera {(datos?.pendientesLiberar ?? []).length}{' '}
                  material(es) de esta orden, así que NO entran en esta explosión:
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {(datos?.pendientesLiberar ?? []).map((p) => (
                    <li key={`${p.tipo}-${p.idRenglon}`} data-testid="exp-pendiente-liberar">
                      <b>{p.material}</b> — {formatearCantidad(p.consumoPorPrenda)}
                      {p.unidad === null ? '' : ` ${p.unidad}`} por prenda
                    </li>
                  ))}
                </ul>
                {puedeIrALiberar && idOrden !== null ? (
                  <button
                    type="button"
                    className="mt-1 underline"
                    onClick={() => void navigate('/produccion/ordenes', { state: { idOrden } })}
                    data-testid="exp-ir-a-liberar"
                  >
                    Abrir la orden para liberar su receta
                  </button>
                ) : (
                  <p className="mt-1">
                    Pídeselo a Desarrollo: se libera desde la receta de la orden.
                  </p>
                )}
              </div>
            ) : null}

            {datos?.huboCambios ? (
              <p
                className="mb-3 rounded-md border border-warn/30 bg-warn-soft p-2 text-xs text-warn"
                data-testid="exp-aviso-cambios"
              >
                El BOM cambió desde la última explosión: los renglones afectados están marcados.
              </p>
            ) : null}

            {/* ⭐ PRIMER AVISO de §Post-F9.43(d) (V1-E3d): la receta CONGELADA de esta orden contra el
                BOM VIVO del modelo, EN EL LUGAR DE LA DECISIÓN — aquí es donde se está a punto de
                gastar, así que el aviso va aquí y no escondido en otra pantalla. Lo calcula el
                servidor al vuelo (A1); la pantalla solo lo pinta, y los renglones afectados lo
                repiten en su propia fila. En ROJO solo cuando lo movió una PERSONA tocando el
                modelo: un movimiento del precio de compra se informa, pero no da la alarma. */}
            {(datos?.desalineacion.hayCambios ?? false) ? (
              <div
                className={
                  datos?.desalineacion.critico === true
                    ? 'mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive'
                    : 'mb-3 rounded-md border border-warn/30 bg-warn-soft p-2 text-xs text-warn'
                }
                data-testid="exp-desalineacion"
              >
                <p className="font-medium">
                  {datos?.desalineacion.critico === true
                    ? 'El modelo cambió DESPUÉS de que esta orden ya tiene compras — revísalo antes de seguir gastando:'
                    : 'Ojo: el modelo cambió desde que esta orden congeló su receta:'}
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {(datos?.desalineacion.cambios ?? []).map((c, i) => (
                    <li
                      key={`${c.tipo}-${String(c.idRenglon)}-${c.que}-${String(i)}`}
                      data-testid="exp-cambio-receta"
                    >
                      {c.detalle}
                    </li>
                  ))}
                </ul>
                <p className="mt-1">
                  La receta de esta orden NO se movió (para eso está congelada). Si algún cambio
                  debe entrar, se trae a mano desde la receta de la orden.
                </p>
              </div>
            ) : null}

            {/* Avisos del enganche (F8-E6): tela amarrada multi-color con precios distintos (se usó el
                precio base), avío por talla (R18) sin medida capturada, etc. Nada truena en silencio. */}
            {(datos?.avisos ?? []).length > 0 ? (
              <div
                className="mb-3 rounded-md border border-warn/30 bg-warn-soft p-2 text-xs text-warn"
                data-testid="exp-avisos"
              >
                <p className="font-medium">Avisos de la explosión:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {(datos?.avisos ?? []).map((aviso, i) => (
                    <li key={i} data-testid="exp-aviso">
                      {aviso}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {generar.isError ? (
              <p className="mb-3 text-sm text-destructive" data-testid="exp-error-generar">
                {generar.error.message}
              </p>
            ) : null}
            {generar.isSuccess ? (
              <p
                className="mb-3 rounded-md border border-ok/30 bg-ok-soft p-2 text-sm text-ok"
                data-testid="exp-ok-generar"
              >
                Se generaron {generar.data.ordenesCompra.length} orden(es) de compra:{' '}
                {generar.data.ordenesCompra
                  .map((oc) => `OC ${oc.numCompra} (${oc.proveedor})`)
                  .join(', ')}
                .
              </p>
            ) : null}

            {explosion.isPending ? (
              <div className="space-y-2" data-testid="exp-cargando">
                <Skeleton className="h-16 w-full rounded-lg" />
                <Skeleton className="h-16 w-full rounded-lg" />
              </div>
            ) : explosion.isError ? (
              <p className="text-sm text-destructive">{explosion.error.message}</p>
            ) : (datos?.grupos ?? []).length === 0 ? (
              <p
                className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground"
                data-testid="exp-vacio"
              >
                {/* No mentir sobre la causa: con renglones pendientes de firma, el vacío NO es un
                    BOM vacío — es que todavía no se autoriza nada de lo que esta orden lleva. */}
                {(datos?.pendientesLiberar ?? []).length > 0
                  ? 'Nada que comprar todavía: lo que esta orden lleva está pendiente de que Desarrollo lo libere (ver arriba).'
                  : 'Esta orden no requiere materiales (BOM vacío o sin piezas capturadas).'}
              </p>
            ) : (
              <div className="space-y-5" data-testid="exp-grupos">
                {(datos?.grupos ?? []).map((grupo) => (
                  <div
                    key={grupo.idProveedor ?? 'sin-proveedor'}
                    className="rounded-lg border"
                    data-testid="exp-grupo"
                  >
                    <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
                      <span className="font-medium">{grupo.proveedor}</span>
                      <span className="text-xs text-muted-foreground">
                        {grupo.renglones.length} material(es)
                      </span>
                    </div>
                    <ul>
                      {grupo.renglones.map((r) => (
                        <RenglonRequerimiento
                          key={r.id}
                          renglon={r}
                          seleccionado={seleccion.has(r.id)}
                          onToggle={() => alternar(r.id)}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Un renglón de material requerido (con su neteo, diff y casilla de selección). */
function RenglonRequerimiento({
  renglon,
  seleccionado,
  onToggle,
}: {
  renglon: Requerimiento;
  seleccionado: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const comprable = renglon.idProveedorSugerido !== null && renglon.cantidadAComprar > 0;
  return (
    <li
      className="flex flex-wrap items-start gap-3 border-t px-3 py-2 first:border-t-0"
      data-testid="exp-renglon"
    >
      <input
        type="checkbox"
        className="mt-1 size-4 shrink-0"
        checked={seleccionado}
        onChange={onToggle}
        disabled={!comprable}
        aria-label={`Seleccionar ${renglon.material}`}
        data-testid="exp-renglon-check"
      />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          <span className="truncate">{renglon.material}</span>
          <DiffBadge diff={renglon.diff} />
          <GenericoBadge renglon={renglon} />
          {/* V1-E3d: el renglón cuyo insumo se movió en el modelo lo dice EN SU FILA, para que el
              aviso de arriba tenga a dónde apuntar. */}
          {renglon.cambiosReceta.length > 0 ? (
            <Badge
              variant="outline"
              className="border-destructive text-[10px] text-destructive"
              data-testid="exp-renglon-desalineado"
            >
              {renglon.cambiosReceta.includes('precio-mercado') &&
              renglon.cambiosReceta.length === 1
                ? 'Cambió el precio de compra'
                : 'El modelo cambió'}
            </Badge>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground">
          Requerido {formatearCantidad(renglon.cantidadRequerida)}
          {renglon.unidad ? ` ${renglon.unidad}` : ''}
          {renglon.esGenerico ? ` · en stock ${formatearCantidad(renglon.existenciaStock)}` : ''}
        </p>
      </div>
      <div className="text-right">
        <p className="font-medium tabular-nums" data-testid="exp-renglon-comprar">
          {formatearCantidad(renglon.cantidadAComprar)}
          {renglon.unidad ? ` ${renglon.unidad}` : ''}
        </p>
        <p className="text-xs text-muted-foreground">
          {renglon.precioSugerido === null
            ? 'sin precio'
            : `${formatearMoneda(renglon.precioSugerido)} c/u`}
        </p>
      </div>
    </li>
  );
}

/** Cantidad con hasta 4 decimales (formato es-MX). */
function formatearCantidad(valor: number): string {
  return valor.toLocaleString('es-MX', { maximumFractionDigits: 4 });
}

/** Etiqueta del diff contra el snapshot previo (solo cuando hay cambio). */
function DiffBadge({ diff }: { diff: Requerimiento['diff'] }): React.JSX.Element | null {
  if (diff === 'sin-cambio') {
    return null;
  }
  const etiqueta =
    diff === 'nuevo' ? 'Nuevo' : diff === 'eliminado' ? 'Retirado' : 'Cantidad cambiada';
  return (
    <ChipEstado tono="warn" sinPunto data-testid="exp-diff-badge">
      {etiqueta}
    </ChipEstado>
  );
}

/** Etiqueta del estado de un genérico tras netear (decisión d). */
function GenericoBadge({ renglon }: { renglon: Requerimiento }): React.JSX.Element | null {
  if (!renglon.esGenerico) {
    return null;
  }
  const cubierto = renglon.estadoGenerico === 'cubierto-por-stock';
  return (
    <ChipEstado tono={cubierto ? 'ok' : 'info'} sinPunto data-testid="exp-generico-badge">
      {cubierto ? 'Cubierto por stock' : 'Genérico · faltante'}
    </ChipEstado>
  );
}
