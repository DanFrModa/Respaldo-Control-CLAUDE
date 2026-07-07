import { CheckIcon, Loader2Icon, Paperclip, PlusIcon, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useSubirAdjuntoPedido } from '@/api/adjuntos-pedido';
import { useClientes } from '@/api/clientes';
import { useCandidatosDesarrollo } from '@/api/pedidos-mes';
import { useCrearPedido } from '@/api/pedidos';
import type { CandidatoDesarrollo, Pedido, PedidoCrear } from '@/api/tipos';
import { ComboboxBuscable } from '@/components/dominio/ComboboxBuscable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/lib/useDebounce';
import { useSesion } from '@/sesion/useSesion';

/** Formato de moneda MXN. */
const FORMATO_MONEDA = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

/** Un renglón en captura del constructor. */
interface RenglonCaptura {
  /** Clave local estable de la fila (para el `key` de React). */
  claveLocal: number;
  /** Candidato de desarrollo elegido (trae idModelo/idDesarrollo/etiquetas), o null. */
  candidato: CandidatoDesarrollo | null;
  cantidad: string;
  precio: string;
}

/** Fila vacía del constructor. */
function filaVacia(claveLocal: number): RenglonCaptura {
  return { claveLocal, candidato: null, cantidad: '', precio: '' };
}

/** Etiqueta del candidato en el selector: nº desarrollo + nombre + proyecto/cliente. */
function etiquetaCandidato(candidato: CandidatoDesarrollo): string {
  const descripcion =
    candidato.descripcionModelo === null ? '' : ` — ${candidato.descripcionModelo}`;
  return `${candidato.codigoModelo}${descripcion} · ${candidato.nombreProyecto} / ${candidato.nombreCliente}`;
}

/**
 * CONSTRUCTOR "NUEVO PEDIDO INTERNO" (rediseño R3, §4.1 — proto `renderPedBuilder`): encabezado
 * (cliente · empresa · fecha de entrega · OC del cliente + su archivo) + N renglones, cada uno con
 * el SELECTOR de modelos de DESARROLLO (ya no texto libre; muestra nombre + proyecto/cliente,
 * búsqueda server-side sin acentos) + cantidad + precio (importe en vivo). **SIN color×talla**
 * (aclaración Daniel 7-jul): la matriz NACE al Generar OP. Folio `-F` automático al guardar
 * (secuencia A3 del backend).
 *
 * La EMPRESA del pedido es la de la sesión activa (A9) — se muestra fija (el selector del proto
 * cambiaría de empresa, que aquí es el switch global del encabezado). El archivo de la OC se sube
 * a `PedidoArchivo` (R2 presigned) DESPUÉS de crear el pedido (necesita su id); si la subida
 * falla, el pedido ya existe y el archivo se reintenta desde su detalle.
 */
export function ConstructorPedido({
  alCerrar,
  alCreado,
}: {
  alCerrar: () => void;
  /** Callback con el pedido creado (refresca la consulta y enfoca). */
  alCreado: (pedido: Pedido) => void;
}): React.JSX.Element {
  const { sesion, tienePermiso } = useSesion();
  const puedeVerImportes = tienePermiso('pedidos.importes');
  const crear = useCrearPedido();
  const subirAdjunto = useSubirAdjuntoPedido();

  // ── Encabezado ─────────────────────────────────────────────────────────────
  const [idCliente, setIdCliente] = useState<number | null>(null);
  const [textoCliente, setTextoCliente] = useState('');
  const busquedaCliente = useDebounce(textoCliente.trim(), 250);
  const clientes = useClientes({
    pagina: 1,
    porPagina: 100,
    ...(busquedaCliente === '' ? {} : { busqueda: busquedaCliente }),
  });
  const [fechaEntrega, setFechaEntrega] = useState('');
  const [ocCliente, setOcCliente] = useState('');
  const [archivoOc, setArchivoOc] = useState<File | null>(null);

  // ── Renglones ──────────────────────────────────────────────────────────────
  const [renglones, setRenglones] = useState<RenglonCaptura[]>([filaVacia(1)]);
  const [siguienteClave, setSiguienteClave] = useState(2);

  function actualizarRenglon(claveLocal: number, cambios: Partial<RenglonCaptura>): void {
    setRenglones((filas) =>
      filas.map((f) => (f.claveLocal === claveLocal ? { ...f, ...cambios } : f)),
    );
  }
  function agregarRenglon(): void {
    setRenglones((filas) => [...filas, filaVacia(siguienteClave)]);
    setSiguienteClave((n) => n + 1);
  }
  function quitarRenglon(claveLocal: number): void {
    setRenglones((filas) => filas.filter((f) => f.claveLocal !== claveLocal));
  }

  const totalPiezas = renglones.reduce((s, f) => s + (Number(f.cantidad) || 0), 0);
  const totalImporte = renglones.reduce(
    (s, f) => s + (Number(f.cantidad) || 0) * (Number(f.precio) || 0),
    0,
  );

  const [guardando, setGuardando] = useState(false);

  async function guardar(): Promise<void> {
    if (idCliente === null) {
      toast.error('Elige el cliente del pedido.');
      return;
    }
    const validos = renglones.filter((f) => f.candidato !== null && (Number(f.cantidad) || 0) > 0);
    if (validos.length === 0) {
      toast.error('Agrega al menos un modelo de desarrollo con su cantidad.');
      return;
    }
    const cuerpo: PedidoCrear = {
      idCliente,
      ...(fechaEntrega === '' ? {} : { fechaHasta: fechaEntrega }),
      ...(ocCliente.trim() === '' ? {} : { ocCliente: ocCliente.trim() }),
      lineas: validos.map((f) => ({
        idModelo: (f.candidato as CandidatoDesarrollo).idModelo,
        idDesarrollo: (f.candidato as CandidatoDesarrollo).idDesarrollo,
        cantidadPedida: Number(f.cantidad),
        ...(puedeVerImportes && f.precio !== '' ? { precio: Number(f.precio) || 0 } : {}),
      })),
    };

    setGuardando(true);
    try {
      const pedido = await crear.mutateAsync(cuerpo);
      // El archivo de la OC se sube DESPUÉS (necesita el id). Best-effort para la UX: si falla,
      // el pedido YA existe y se avisa para reintentar.
      if (archivoOc !== null) {
        try {
          await subirAdjunto.mutateAsync({ idPedido: pedido.id, archivo: archivoOc });
        } catch {
          toast.warning(
            'El pedido se creó, pero el archivo de la OC no se pudo subir. Reinténtalo desde el pedido.',
          );
        }
      }
      toast.success(
        `Pedido ${pedido.folio}-F creado · genera la OP de cada modelo con el botón "Generar OP".`,
      );
      alCreado(pedido);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear el pedido.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/45"
      role="dialog"
      aria-modal="true"
      aria-label="Nuevo pedido interno"
      data-testid="constructor-pedido"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) alCerrar();
      }}
    >
      <div className="flex h-full w-full max-w-3xl flex-col overflow-hidden bg-background shadow-xl">
        {/* ── Encabezado del panel ───────────────────────────────────────── */}
        <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
            PI
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">Nuevo pedido interno</h2>
            <p className="truncate text-xs text-muted-foreground">
              Folio automático al crear · de cada modelo se genera su OP
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={alCerrar}
            aria-label="Cerrar"
            data-testid="constructor-cerrar"
          >
            <X className="size-5" aria-hidden />
          </Button>
        </header>

        {/* ── Cuerpo ─────────────────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Encabezado del pedido
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs">
                <span className="font-medium text-muted-foreground">Cliente</span>
                <ComboboxBuscable
                  opciones={(clientes.data?.datos ?? []).map((c) => ({
                    id: c.id,
                    nombre: c.nombre,
                  }))}
                  valor={idCliente}
                  onChange={setIdCliente}
                  alCambiarTexto={setTextoCliente}
                  placeholder="Escribe para buscar…"
                  etiqueta="Cliente del pedido"
                  testid="constructor-cliente"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-muted-foreground">Empresa</span>
                {/* A9: el pedido nace en la EMPRESA ACTIVA de la sesión (el switch global). */}
                <Input value={sesion?.empresaActiva.nombre ?? ''} disabled aria-label="Empresa" />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-muted-foreground">Fecha de entrega</span>
                <Input
                  type="date"
                  value={fechaEntrega}
                  onChange={(e) => setFechaEntrega(e.target.value)}
                  aria-label="Fecha de entrega"
                  data-testid="constructor-fecha"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-muted-foreground">
                  OC del cliente (referencia)
                </span>
                <Input
                  value={ocCliente}
                  onChange={(e) => setOcCliente(e.target.value)}
                  placeholder="OC-CA-4471"
                  className="num"
                  aria-label="OC del cliente"
                  data-testid="constructor-oc"
                />
              </label>
              <label className="space-y-1 text-xs sm:col-span-2">
                <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
                  <Paperclip className="size-3" aria-hidden />
                  Archivo de la OC (opcional)
                </span>
                <Input
                  type="file"
                  onChange={(e) => setArchivoOc(e.target.files?.[0] ?? null)}
                  aria-label="Archivo de la OC del cliente"
                  data-testid="constructor-archivo-oc"
                />
              </label>
            </div>
            <p className="rounded-md bg-panel-2 px-3 py-2 text-xs text-muted-foreground">
              El pedido referencia el <b>modelo de desarrollo</b> (su ficha con BOM/telas/avíos) con
              su <b>cantidad y precio</b>. <b>Desarrollo y Producción son bases distintas:</b> el nº
              interno de producción se asigna al <b>Generar la OP</b> (salida a producción). La{' '}
              <b>matriz color×talla nace en la OP</b>, no aquí.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Modelos del pedido
            </h3>
            <div className="space-y-2" data-testid="constructor-renglones">
              {renglones.map((fila) => (
                <RenglonConstructor
                  key={fila.claveLocal}
                  fila={fila}
                  idCliente={idCliente}
                  puedeVerImportes={puedeVerImportes}
                  puedeQuitar={renglones.length > 1}
                  alCambiar={(cambios) => actualizarRenglon(fila.claveLocal, cambios)}
                  alQuitar={() => quitarRenglon(fila.claveLocal)}
                />
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={agregarRenglon}
              data-testid="constructor-agregar-modelo"
            >
              <PlusIcon aria-hidden />
              Agregar modelo
            </Button>
          </section>
        </div>

        {/* ── Pie: total vivo + acciones ─────────────────────────────────── */}
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-3">
          <p className="text-xs text-muted-foreground" data-testid="constructor-total">
            {renglones.length} modelo{renglones.length === 1 ? '' : 's'} ·{' '}
            <b className="num">{totalPiezas.toLocaleString('es-MX')}</b> pz
            {puedeVerImportes ? (
              <>
                {' '}
                · <b className="num">{FORMATO_MONEDA.format(totalImporte)}</b>
              </>
            ) : null}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={alCerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button
              onClick={() => void guardar()}
              disabled={guardando}
              data-testid="confirmar-constructor"
            >
              {guardando ? (
                <Loader2Icon className="animate-spin" aria-hidden />
              ) : (
                <CheckIcon aria-hidden />
              )}
              Crear pedido interno
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/**
 * Renglón del constructor: selector de DESARROLLO (typeahead server-side, sin acentos) + cantidad
 * + precio + importe en vivo. Al elegir un desarrollo se PROPONE su precio de lista (editable) si
 * la sesión puede ver importes.
 */
function RenglonConstructor({
  fila,
  idCliente,
  puedeVerImportes,
  puedeQuitar,
  alCambiar,
  alQuitar,
}: {
  fila: RenglonCaptura;
  idCliente: number | null;
  puedeVerImportes: boolean;
  puedeQuitar: boolean;
  alCambiar: (cambios: Partial<RenglonCaptura>) => void;
  alQuitar: () => void;
}): React.JSX.Element {
  const [texto, setTexto] = useState('');
  const busqueda = useDebounce(texto.trim(), 250);
  const candidatos = useCandidatosDesarrollo(busqueda, idCliente ?? undefined);

  // Las opciones del combobox incluyen SIEMPRE el candidato elegido (aunque la búsqueda cambie).
  const lista = candidatos.data ?? [];
  const opciones = [
    ...(fila.candidato !== null &&
    !lista.some((c) => c.idDesarrollo === fila.candidato?.idDesarrollo)
      ? [fila.candidato]
      : []),
    ...lista,
  ].map((c) => ({ id: c.idDesarrollo, nombre: etiquetaCandidato(c) }));

  const importe = (Number(fila.cantidad) || 0) * (Number(fila.precio) || 0);

  function elegir(idDesarrollo: number | null): void {
    if (idDesarrollo === null) {
      alCambiar({ candidato: null });
      return;
    }
    const candidato =
      lista.find((c) => c.idDesarrollo === idDesarrollo) ??
      (fila.candidato?.idDesarrollo === idDesarrollo ? fila.candidato : null);
    if (candidato === null) return;
    alCambiar({
      candidato,
      // Propone el precio de la lista del desarrollo (editable) si aún no hay precio capturado.
      ...(puedeVerImportes && fila.precio === '' && candidato.precioSugerido !== null
        ? { precio: String(candidato.precioSugerido) }
        : {}),
    });
  }

  return (
    <div
      className="grid grid-cols-1 items-start gap-2 rounded-lg border p-2 sm:grid-cols-[minmax(0,1fr)_88px_100px_100px_32px]"
      data-testid="constructor-renglon"
    >
      <div className="space-y-1">
        <ComboboxBuscable
          opciones={opciones}
          valor={fila.candidato?.idDesarrollo ?? null}
          onChange={elegir}
          alCambiarTexto={setTexto}
          placeholder="Modelo de desarrollo…"
          etiqueta="Modelo de desarrollo"
          textoVacio={
            idCliente === null
              ? 'Elige primero el cliente (o busca en todos).'
              : 'Sin desarrollos que coincidan.'
          }
          testid="constructor-desarrollo"
        />
        <p className="text-[10.5px] text-faint">
          {fila.candidato !== null
            ? `${fila.candidato.nombreProyecto} / ${fila.candidato.nombreDepartamento}` +
              (fila.candidato.numeroCliente !== null
                ? ` · nº cliente ${fila.candidato.numeroCliente}`
                : '')
            : 'elige el modelo de desarrollo'}
        </p>
      </div>
      <Input
        type="number"
        min={0}
        inputMode="numeric"
        value={fila.cantidad}
        onChange={(e) => alCambiar({ cantidad: e.target.value })}
        placeholder="Cantidad"
        className="num text-right"
        aria-label="Cantidad del renglón"
        data-testid="constructor-cantidad"
      />
      {puedeVerImportes ? (
        <Input
          type="number"
          min={0}
          step="any"
          value={fila.precio}
          onChange={(e) => alCambiar({ precio: e.target.value })}
          placeholder="Precio"
          className="num text-right"
          aria-label="Precio del renglón"
          data-testid="constructor-precio"
        />
      ) : (
        <span className="self-center text-center text-xs text-faint">—</span>
      )}
      <span className="num self-center text-right text-xs font-semibold">
        {puedeVerImportes ? FORMATO_MONEDA.format(importe) : '—'}
      </span>
      <div className="self-center">
        {puedeQuitar ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={alQuitar}
            aria-label="Quitar renglón"
            data-testid="constructor-quitar-renglon"
          >
            <X className="size-4" aria-hidden />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
