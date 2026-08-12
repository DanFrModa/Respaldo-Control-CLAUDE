import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { useTiposMovimiento } from '@/api/inventarios';
import { useAjustarAvio } from '@/api/inventario-materiales';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useSesion } from '@/sesion/useSesion';

import { CapturaRenglonesAvio, type RenglonAvio } from './CapturaRenglonesAvio';
import { PestanasSegmentadas } from './PestanasSegmentadas';

type Direccion = 'entrada' | 'salida';

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * AJUSTE / INVENTARIO FÍSICO de AVÍOS (F4-E1, doc 04-Inventarios §B). Sustituye el viejo
 * `SalidasModificar`: toda corrección es un MOVIMIENTO auditado (D3), nunca una edición de la
 * existencia. Motivo OBLIGATORIO (A7). Dos direcciones (Entrada/Salida) sobre lo existente; el
 * backend valida el no-negativo de las salidas bajo lock. Captura PC. Permiso
 * `inventario-avios.mover`.
 *
 * SOLO AVÍOS: esta pantalla tenía además una pestaña de TELAS atada al motor LEGADO por lote —y
 * arrancaba EN ELLA—, así que lo que se capturaba ahí no aparecía en «Existencias de telas» (la
 * vista `existencia_tela_color` excluye los renglones con `id_tela_color = NULL`). El ajuste de
 * tela se hace en «Ajuste de telas por color» (`/inventarios/telas/ajuste`), que además crea la
 * partida al dar entrada — el camino del arranque sin conteo físico.
 */
export function AjusteMaterialesPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const [direccion, setDireccion] = useState<Direccion>('entrada');

  const puedeMover = tienePermiso('inventario-avios.mover');
  // El puntero al ajuste de TELA se ofrece solo a quien puede mover tela — mismo criterio (y mismo
  // permiso) que el enlace hermano de Notas de salida (A4): mandar a una pantalla que le va a
  // aparecer toda deshabilitada no es "explicar", es pasear al usuario.
  const puedeMoverTela = tienePermiso('inventario-telas.mover');

  const [idAlmacen, setIdAlmacen] = useState<string>('');
  const [fecha, setFecha] = useState(hoy());
  const [motivo, setMotivo] = useState('');
  const [renglonesAvio, setRenglonesAvio] = useState<RenglonAvio[]>([]);

  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });
  const tiposMov = useTiposMovimiento();
  const ajustarAvio = useAjustarAvio();

  // Resuelve el idTipoMov del ajuste por código (ajuste-entrada/ajuste-salida).
  const idTipoMov = useMemo(() => {
    const codigo = direccion === 'entrada' ? 'ajuste-entrada' : 'ajuste-salida';
    return tiposMov.data?.datos.find((t) => t.codigo === codigo)?.id;
  }, [tiposMov.data, direccion]);

  const cargando = ajustarAvio.isPending;
  const motivoOk = motivo.trim().length >= 3;

  function limpiar(): void {
    setRenglonesAvio([]);
    setMotivo('');
  }

  const puedeGuardar =
    puedeMover &&
    idAlmacen !== '' &&
    motivoOk &&
    idTipoMov !== undefined &&
    !cargando &&
    renglonesAvio.length > 0;

  function guardar(): void {
    if (idAlmacen === '' || idTipoMov === undefined) return;
    ajustarAvio.mutate(
      {
        idTipoMov,
        idAlmacen: Number(idAlmacen),
        fecha,
        motivo: motivo.trim(),
        lineas: renglonesAvio.map((r) => ({ idAvio: r.idAvio, cantidad: r.cantidad })),
      },
      {
        onSuccess: (m) => {
          toast.success(`Ajuste de avío registrado (folio #${m.folio}).`);
          limpiar();
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
            Ajuste de avíos / inventario físico
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Toda corrección es un movimiento auditado (nunca se edita la existencia) · el motivo es
            obligatorio
          </p>
        </div>
      </header>

      {/* No se esconde el camino de la TELA: se dice a dónde ir (§Post-F9.16) — a quien pueda ir. */}
      {puedeMoverTela ? (
        <p className="text-[12.5px] text-muted-foreground" data-testid="ajuste-avios-nota-tela">
          ¿Vas a ajustar <b>tela</b>? Se hace por color en{' '}
          <Link className="text-primary underline" to="/inventarios/telas/ajuste">
            Ajuste de telas por color
          </Link>
          : ahí la entrada crea la partida y sí mueve «Existencias de telas».
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <PestanasSegmentadas<Direccion>
          opciones={[
            { valor: 'entrada', etiqueta: 'Entrada', testid: 'ajuste-dir-entrada' },
            { valor: 'salida', etiqueta: 'Salida', testid: 'ajuste-dir-salida' },
          ]}
          valor={direccion}
          alCambiar={setDireccion}
          etiqueta="Dirección del ajuste"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datos del ajuste</CardTitle>
          <CardDescription>
            Captura los renglones de avío a ajustar sobre lo existente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="ajuste-almacen">Almacén</FieldLabel>
              <SelectNativo
                id="ajuste-almacen"
                value={idAlmacen}
                onChange={(e) => setIdAlmacen(e.target.value)}
                disabled={!puedeMover}
                data-testid="ajuste-almacen"
              >
                <option value="">Elige el almacén…</option>
                {(almacenes.data?.datos ?? []).map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            <Field>
              <FieldLabel htmlFor="ajuste-fecha">Fecha</FieldLabel>
              <Input
                id="ajuste-fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                disabled={!puedeMover}
                data-testid="ajuste-fecha"
              />
            </Field>
          </div>

          <Field data-invalid={!motivoOk}>
            <FieldLabel htmlFor="ajuste-motivo">Motivo (obligatorio)</FieldLabel>
            <Input
              id="ajuste-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por qué se ajusta (conteo físico, merma, corrección…)"
              disabled={!puedeMover}
              data-testid="ajuste-motivo"
            />
          </Field>

          <div>
            <h3 className="mb-2 text-sm font-medium">Avíos a ajustar</h3>
            <CapturaRenglonesAvio
              renglones={renglonesAvio}
              onChange={setRenglonesAvio}
              soloLectura={!puedeMover}
            />
          </div>

          <div className="flex items-center justify-end gap-3">
            <Button onClick={guardar} disabled={!puedeGuardar} data-testid="ajuste-guardar">
              {cargando ? 'Guardando…' : 'Registrar ajuste'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
