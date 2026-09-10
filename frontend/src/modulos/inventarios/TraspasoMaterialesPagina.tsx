import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { useTraspasarAvio } from '@/api/inventario-materiales';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useSesion } from '@/sesion/useSesion';

import { CapturaRenglonesAvio, type RenglonAvio } from './CapturaRenglonesAvio';

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * TRASPASO de AVÍOS entre almacenes (F4-E1, doc 04-Inventarios §B.3 — Transferencia entre
 * almacenes). Mueve avío de un almacén ORIGEN a uno DESTINO (distintos) en UNA operación (el
 * backend la materializa como salida + entrada atómicas, A2). El servidor valida que el origen no
 * quede negativo (D3, bajo lock). Captura PC. Permiso `inventario-avios.mover`.
 *
 * 🔴 SOLO AVÍOS desde v0.098 (fila 0.098). Esta pantalla tenía además una pestaña de TELAS atada al
 * motor LEGADO por lote —y ARRANCABA EN ELLA—, así que quien traspasaba tela desde aquí NO veía
 * moverse «Inventario de telas»: los renglones se graban con `id_tela_color = NULL` y la vista
 * `existencia_tela_color` los excluye (`WHERE d."id_tela_color" IS NOT NULL`, migración
 * 20260806130000_a2_partidas_telas). Es EXACTAMENTE el defecto que el 13-ago-2026 se corrigió en
 * «Ajuste de materiales» (hoy «Ajuste de avíos») y que aquí se dejó igual; se aplica el MISMO
 * criterio: se retira, la pantalla se queda con lo vivo, se muda al menú de Avíos, su gate se
 * estrecha al permiso que de verdad usa (A4) y deja un puntero a la pantalla vigente.
 *
 * ⚠️ LA RAZÓN EXACTA POR LA QUE ESTA PATA SE RETIRA Y LA DEL KARDEX NO — porque las dos operan la
 * MISMA dimensión legada, así que «está muerta» no las distinguiría:
 *
 *  • **Este traspaso TIENE REEMPLAZO VIGENTE**, y lo dictó Daniel por su nombre: «El traspaso se
 *    hace por color. No siempre hay un lote completo para traspasar» (`DECISIONES.md §Post-F9.32`).
 *    Todo lo que se quiere hacer aquí se hace mejor en «Traspaso de telas por color». Dejarlo era
 *    ofrecer, por defecto, el camino que Daniel descartó.
 *  • **El kardex por lote NO tiene reemplazo**: es la ÚNICA ventana a los movimientos migrados de
 *    Access (F4-E6 cargó Entradas/Salidas del sistema viejo como lotes `LEGACY-TELA-*`) y el kardex
 *    por color no los ve. Retirarlo no habría movido a nadie a otra pantalla: habría borrado la
 *    única. Por eso ése se queda, y sólo se le quitó la mentira.
 *
 * O sea: no se retira lo viejo por viejo, se retira lo que tiene a dónde mandar al usuario.
 *
 * El traspaso de TELA se hace por COLOR en «Traspaso de telas por color»
 * (`/inventarios/telas/traspaso`) — lo dictó Daniel: «El traspaso se hace por color. No siempre hay
 * un lote completo para traspasar» (`DECISIONES.md §Post-F9.32`). El endpoint legado por lote sigue
 * vivo en el backend; para tocarlo hay que llamarlo a mano.
 */
export function TraspasoMaterialesPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeMover = tienePermiso('inventario-avios.mover');
  // El puntero al traspaso de TELA se ofrece solo a quien puede mover tela — mismo criterio (y
  // mismo permiso) que el enlace hermano de «Ajuste de avíos» (A4): mandar a una pantalla que le va
  // a aparecer toda deshabilitada no es "explicar", es pasear al usuario.
  const puedeMoverTela = tienePermiso('inventario-telas.mover');

  const [idAlmacenOrigen, setIdAlmacenOrigen] = useState<string>('');
  const [idAlmacenDestino, setIdAlmacenDestino] = useState<string>('');
  const [fecha, setFecha] = useState(hoy());
  const [observaciones, setObservaciones] = useState('');
  const [renglonesAvio, setRenglonesAvio] = useState<RenglonAvio[]>([]);

  // Solo almacenes de AVIO: los DOS extremos del traspaso de avíos tienen que serlo (fila 0.137).
  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
    tipo: 'AVIO',
  });
  const traspasarAvio = useTraspasarAvio();

  const mismoAlmacen = idAlmacenOrigen !== '' && idAlmacenOrigen === idAlmacenDestino;
  const totalAvio = renglonesAvio.reduce((s, r) => s + r.cantidad, 0);
  const cargando = traspasarAvio.isPending;
  const puedeGuardar =
    puedeMover &&
    idAlmacenOrigen !== '' &&
    idAlmacenDestino !== '' &&
    !mismoAlmacen &&
    renglonesAvio.length > 0 &&
    !cargando;

  function guardar(): void {
    if (idAlmacenOrigen === '' || idAlmacenDestino === '') return;
    traspasarAvio.mutate(
      {
        idAlmacenOrigen: Number(idAlmacenOrigen),
        idAlmacenDestino: Number(idAlmacenDestino),
        fecha,
        ...(observaciones.trim().length > 0 ? { observaciones: observaciones.trim() } : {}),
        lineas: renglonesAvio.map((r) => ({ idAvio: r.idAvio, cantidad: r.cantidad })),
      },
      {
        onSuccess: (t) => {
          toast.success(
            `Traspaso de avío guardado (salida #${t.salida.folio} → entrada #${t.entrada.folio}).`,
          );
          setRenglonesAvio([]);
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
            Traspaso de avíos
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Mueve avío de un almacén a otro, en una sola operación
          </p>
        </div>
      </header>

      {puedeMoverTela ? (
        <p className="text-[12.5px] text-muted-foreground" data-testid="traspaso-avios-nota-tela">
          ¿Vas a traspasar <b>tela</b>? Se hace por color en{' '}
          <Link className="text-primary underline" to="/inventarios/telas/traspaso">
            Traspaso de telas por color
          </Link>
          : ahí sí se mueve «Inventario de telas».
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Datos del traspaso</CardTitle>
          <CardDescription>
            Elige origen y destino (distintos) y captura los renglones a mover.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="origen">Almacén origen</FieldLabel>
              <SelectNativo
                id="origen"
                value={idAlmacenOrigen}
                onChange={(e) => setIdAlmacenOrigen(e.target.value)}
                disabled={!puedeMover}
                data-testid="traspaso-origen"
              >
                <option value="">Elige el origen…</option>
                {(almacenes.data?.datos ?? []).map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            <Field>
              <FieldLabel htmlFor="destino">Almacén destino</FieldLabel>
              <SelectNativo
                id="destino"
                value={idAlmacenDestino}
                onChange={(e) => setIdAlmacenDestino(e.target.value)}
                disabled={!puedeMover}
                data-testid="traspaso-destino"
              >
                <option value="">Elige el destino…</option>
                {(almacenes.data?.datos ?? []).map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            <Field>
              <FieldLabel htmlFor="fecha">Fecha</FieldLabel>
              <Input
                id="fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                disabled={!puedeMover}
                data-testid="traspaso-fecha"
              />
            </Field>
          </div>

          {mismoAlmacen ? (
            <p className="text-sm text-destructive" role="alert">
              El origen y el destino deben ser almacenes distintos.
            </p>
          ) : null}

          <Field>
            <FieldLabel htmlFor="obs">Observaciones</FieldLabel>
            <Input
              id="obs"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              placeholder="Opcional"
              disabled={!puedeMover}
            />
          </Field>

          <div>
            <h3 className="mb-2 text-sm font-medium">Renglones a traspasar</h3>
            <CapturaRenglonesAvio
              renglones={renglonesAvio}
              onChange={setRenglonesAvio}
              soloLectura={!puedeMover}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              Total a traspasar: <strong>{totalAvio.toLocaleString('es-MX')}</strong>
            </span>
            <Button onClick={guardar} disabled={!puedeGuardar} data-testid="traspaso-guardar">
              {cargando ? 'Guardando…' : 'Guardar traspaso'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
