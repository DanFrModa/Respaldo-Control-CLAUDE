import { Printer } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { urlImpresoTraspasoTela, useTraspasarTelaColor } from '@/api/inventario-materiales';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useSesion } from '@/sesion/useSesion';

import { CapturaRenglonesTelaColor, type RenglonTelaColor } from './CapturaRenglonesTelaColor';

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * TRASPASO de telas por COLOR entre almacenes (inventario NUEVO, etapa A2): dos patas ATÓMICAS
 * (salida del origen + entrada al destino) con AMBAS cantidades (cuerpo y complemento) juntas en
 * cada renglón. El backend valida que el ORIGEN aguante los dos componentes (bajo lock, D3).
 * Permiso `inventario-telas.mover`. El traspaso del flujo viejo por lote sigue en "Traspaso de
 * materiales".
 *
 * Es la pantalla del flujo que describió Daniel (§Post-F9.13): *"recibo la tela en el almacén
 * Naucalpan (que es el principal) y de ahí le mando la tela a un cortador y en ese momento debo de
 * hacer el movimiento entre almacenes al almacén del cortador para poder descargarlo de ese
 * almacén"*. Por eso: los selectores solo listan almacenes de TELA, cada uno dice de qué cortador
 * es, y acepta el deep-link `state.idCortador` del avance de producción para llegar con el destino
 * ya puesto.
 *
 * §Post-F9.38 — al guardar ofrece la HOJA DEL TRASPASO (el papel que acompaña la tela). NO es un
 * documento nuevo: imprime el folio que el traspaso YA tiene (Daniel: *"no debe de generar otro
 * folio de nada"*). Y no es la única vía: la REIMPRESIÓN vive en el kardex del color («Existencias
 * de telas»), para que cerrar esta pantalla no pierda el papel.
 */
export function TraspasoTelaColorPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeMover = tienePermiso('inventario-telas.mover');

  const [idAlmacenOrigen, setIdAlmacenOrigen] = useState<string>('');
  const [idAlmacenDestino, setIdAlmacenDestino] = useState<string>('');
  const [fecha, setFecha] = useState(hoy());
  const [observaciones, setObservaciones] = useState('');
  const [renglones, setRenglones] = useState<RenglonTelaColor[]>([]);
  // §Post-F9.38 — el traspaso recién guardado, para imprimir la hoja que va con la tela. NO es la
  // única vía: la reimpresión vive en el kardex del color (historial), como en producción (V1-E3a).
  const [recienGuardado, setRecienGuardado] = useState<{ id: number; folio: number } | null>(null);

  // Solo almacenes de TELA: un traspaso de tela nunca sale ni entra a una bodega de PT o de avíos.
  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
    tipo: 'TELA',
  });
  const traspasar = useTraspasarTelaColor();

  // DEEP-LINK "Mandar tela al cortador" (§Post-F9.13): llega el cortador y se traduce a SU almacén
  // como DESTINO. El origen lo elige el usuario (de dónde sale la tela es decisión suya).
  const location = useLocation();
  const navigate = useNavigate();
  const [idCortadorDeepLink] = useState<number | null>(() => {
    const state: unknown = location.state;
    if (typeof state !== 'object' || state === null || !('idCortador' in state)) return null;
    const id = (state as Record<string, unknown>).idCortador;
    return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
  });
  const listaAlmacenes = almacenes.data?.datos;
  // El deep-link se atiende UNA sola vez. El candado es un ref y no una dependencia porque la
  // lista de almacenes puede llegar con identidad nueva en cada render: sin él, el `navigate` de
  // adentro dispararía otro render, que volvería a entrar al efecto — un bucle.
  const cortadorAtendido = useRef(false);
  useEffect(() => {
    if (idCortadorDeepLink === null || listaAlmacenes === undefined || cortadorAtendido.current) {
      return;
    }
    cortadorAtendido.current = true;
    const suyo = listaAlmacenes.find((a) => a.idCortador === idCortadorDeepLink);
    if (suyo !== undefined) {
      setIdAlmacenDestino((actual) => (actual === '' ? String(suyo.id) : actual));
    }
    // Se limpia aunque el cortador no tenga almacén ligado: el deep-link ya se atendió.
    void navigate(location.pathname, { replace: true, state: null });
  }, [idCortadorDeepLink, listaAlmacenes, location.pathname, navigate]);

  /** Etiqueta del almacén en los selectores: dice de qué cortador es, si lo tiene. */
  function etiquetaAlmacen(a: { nombre: string; cortador: string | null }): string {
    return a.cortador === null ? a.nombre : `${a.nombre} · ${a.cortador}`;
  }

  const almacenesDistintos =
    idAlmacenOrigen !== '' && idAlmacenDestino !== '' && idAlmacenOrigen !== idAlmacenDestino;
  const puedeGuardar =
    puedeMover && almacenesDistintos && renglones.length > 0 && !traspasar.isPending;

  function guardar(): void {
    if (!almacenesDistintos) return;
    traspasar.mutate(
      {
        idAlmacenOrigen: Number(idAlmacenOrigen),
        idAlmacenDestino: Number(idAlmacenDestino),
        fecha,
        ...(observaciones.trim().length > 0 ? { observaciones: observaciones.trim() } : {}),
        lineas: renglones.map((r) => ({
          idTelaColor: r.idTelaColor,
          cantidad: r.cantidad,
          ...(r.nombreComplemento !== null ? { cantidadComplemento: r.cantidadComplemento } : {}),
        })),
      },
      {
        onSuccess: (t) => {
          toast.success(
            `Traspaso registrado (salida #${t.salida.folio} → entrada #${t.entrada.folio}).`,
          );
          setRenglones([]);
          setObservaciones('');
          // El folio del traspaso es el de la pata de SALIDA (no se genera ninguno nuevo).
          setRecienGuardado({ id: t.salida.id, folio: t.salida.folio });
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4 md:p-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Traspaso de telas por color
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Dos movimientos atómicos (salida del origen + entrada al destino) · cuerpo y complemento
            viajan juntos
          </p>
        </div>
      </header>

      {/* Hoja del traspaso RECIÉN guardado (§Post-F9.38): el papel que va con la tela. Se imprime
          el folio QUE YA EXISTE — no se genera documento nuevo. Si esta pantalla se cierra, la hoja
          se recupera desde el kardex del color (Existencias de telas → kardex → imprimir). */}
      {recienGuardado !== null ? (
        <div
          className="flex flex-wrap items-center gap-3 rounded-md border bg-primary-soft px-3 py-2"
          data-testid="traspaso-color-guardado"
        >
          <span className="text-sm">
            Traspaso <b className="num">#{recienGuardado.folio}</b> registrado. Imprime la hoja que
            va con la tela.
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              window.open(urlImpresoTraspasoTela(recienGuardado.id), '_blank', 'noopener')
            }
            data-testid="traspaso-color-imprimir"
          >
            <Printer className="size-4" aria-hidden />
            Hoja del traspaso
          </Button>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Datos del traspaso</CardTitle>
          <CardDescription>
            El origen debe tener existencia suficiente de AMBOS componentes (el servidor valida).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="traspaso-color-origen">Almacén de origen</FieldLabel>
              <SelectNativo
                id="traspaso-color-origen"
                value={idAlmacenOrigen}
                onChange={(e) => setIdAlmacenOrigen(e.target.value)}
                disabled={!puedeMover}
                data-testid="traspaso-color-origen"
              >
                <option value="">Elige el origen…</option>
                {(almacenes.data?.datos ?? []).map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {etiquetaAlmacen(a)}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            <Field>
              <FieldLabel htmlFor="traspaso-color-destino">Almacén de destino</FieldLabel>
              <SelectNativo
                id="traspaso-color-destino"
                value={idAlmacenDestino}
                onChange={(e) => setIdAlmacenDestino(e.target.value)}
                disabled={!puedeMover}
                data-testid="traspaso-color-destino"
              >
                <option value="">Elige el destino…</option>
                {(almacenes.data?.datos ?? []).map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {etiquetaAlmacen(a)}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            <Field>
              <FieldLabel htmlFor="traspaso-color-fecha">Fecha</FieldLabel>
              <Input
                id="traspaso-color-fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                disabled={!puedeMover}
                data-testid="traspaso-color-fecha"
              />
            </Field>
          </div>
          {idAlmacenOrigen !== '' && idAlmacenOrigen === idAlmacenDestino ? (
            <p className="text-xs text-destructive" data-testid="traspaso-color-iguales">
              El origen y el destino deben ser almacenes distintos.
            </p>
          ) : null}

          <Field>
            <FieldLabel htmlFor="traspaso-color-obs">Observaciones (opcional)</FieldLabel>
            <Input
              id="traspaso-color-obs"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              disabled={!puedeMover}
              data-testid="traspaso-color-obs"
            />
          </Field>

          <CapturaRenglonesTelaColor
            renglones={renglones}
            onChange={setRenglones}
            soloLectura={!puedeMover}
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Dónde se recupera el papel si esta pantalla ya se cerró (§Post-F9.38: reimprimible
                desde el historial, no solo al guardar). */}
            <p className="text-xs text-muted-foreground">
              La hoja del traspaso se reimprime desde «Existencias de telas» → kardex del color.
            </p>
            <Button onClick={guardar} disabled={!puedeGuardar} data-testid="traspaso-color-guardar">
              {traspasar.isPending ? 'Guardando…' : 'Registrar traspaso'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
