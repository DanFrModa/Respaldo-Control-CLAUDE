import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { useAjustarTelaColor } from '@/api/inventario-materiales';
import { useTiposMovimiento } from '@/api/inventarios';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useSesion } from '@/sesion/useSesion';

import { CapturaRenglonesTelaColor, type RenglonTelaColor } from './CapturaRenglonesTelaColor';
import { PestanasSegmentadas } from './PestanasSegmentadas';

type Direccion = 'entrada' | 'salida';

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * AJUSTE / CONTEO FÍSICO del inventario de telas NUEVO por COLOR (etapa A2 — la puerta del
 * arranque desde cero, Daniel §Post-F9.9). Toda corrección es un MOVIMIENTO auditado (D3), nunca
 * una edición de la existencia; el motivo es OBLIGATORIO (A7). Una ENTRADA crea UNA PARTIDA por
 * renglón (folio propio por empresa + lote del proveedor opcional + factura del encabezado); una
 * SALIDA valida no-negativo de AMBOS componentes bajo lock (el backend es la autoridad). El
 * cuerpo y el complemento se capturan JUNTOS en el mismo renglón. Permiso
 * `inventario-telas.mover`. Es la ÚNICA pantalla que ajusta tela: el ajuste del flujo viejo POR
 * LOTE se quedó sin UI el 13-ago-2026 (vivía como pestaña de «Ajuste de materiales», hoy «Ajuste de
 * avíos» y solo-avíos) — grababa `id_tela_color = NULL` y la vista `existencia_tela_color` lo
 * excluye, así que ni movía las existencias que se ven aquí. El endpoint legado sigue vivo en el
 * backend; para tocarlo hay que llamarlo a mano.
 */
export function AjusteTelaColorPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeMover = tienePermiso('inventario-telas.mover');

  const [direccion, setDireccion] = useState<Direccion>('entrada');
  const [idAlmacen, setIdAlmacen] = useState<string>('');
  const [fecha, setFecha] = useState(hoy());
  const [motivo, setMotivo] = useState('');
  const [factura, setFactura] = useState('');
  const [renglones, setRenglones] = useState<RenglonTelaColor[]>([]);

  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });
  const tiposMov = useTiposMovimiento();
  const ajustar = useAjustarTelaColor();

  const idTipoMov = useMemo(() => {
    const codigo = direccion === 'entrada' ? 'ajuste-entrada' : 'ajuste-salida';
    return tiposMov.data?.datos.find((t) => t.codigo === codigo)?.id;
  }, [tiposMov.data, direccion]);

  const esEntrada = direccion === 'entrada';
  const motivoOk = motivo.trim().length >= 3;
  const puedeGuardar =
    puedeMover &&
    idAlmacen !== '' &&
    motivoOk &&
    idTipoMov !== undefined &&
    renglones.length > 0 &&
    !ajustar.isPending;

  function guardar(): void {
    if (idAlmacen === '' || idTipoMov === undefined) return;
    ajustar.mutate(
      {
        idTipoMov,
        idAlmacen: Number(idAlmacen),
        fecha,
        motivo: motivo.trim(),
        ...(esEntrada && factura.trim().length > 0 ? { factura: factura.trim() } : {}),
        lineas: renglones.map((r) => ({
          idTelaColor: r.idTelaColor,
          cantidad: r.cantidad,
          ...(r.nombreComplemento !== null ? { cantidadComplemento: r.cantidadComplemento } : {}),
          ...(esEntrada && r.loteProveedor !== undefined ? { loteProveedor: r.loteProveedor } : {}),
        })),
      },
      {
        onSuccess: (m) => {
          toast.success(
            esEntrada
              ? `Entrada registrada (folio #${m.folio}); se crearon ${m.renglones.length} partida(s).`
              : `Salida de ajuste registrada (folio #${m.folio}).`,
          );
          setRenglones([]);
          setMotivo('');
          setFactura('');
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
            Ajuste de telas por color
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Conteo físico / arranque desde cero · una entrada crea la partida de cada renglón · el
            motivo es obligatorio
          </p>
        </div>
      </header>

      <PestanasSegmentadas<Direccion>
        opciones={[
          { valor: 'entrada', etiqueta: 'Entrada', testid: 'ajuste-color-dir-entrada' },
          { valor: 'salida', etiqueta: 'Salida', testid: 'ajuste-color-dir-salida' },
        ]}
        valor={direccion}
        alCambiar={setDireccion}
        etiqueta="Dirección del ajuste"
      />

      <Card>
        <CardHeader>
          <CardTitle>Datos del ajuste</CardTitle>
          <CardDescription>
            {esEntrada
              ? 'Entrada por color: cada renglón crea su PARTIDA (folio propio + lote del proveedor opcional).'
              : 'Salida por color: valida que ni el cuerpo ni el complemento queden en negativo.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="ajuste-color-almacen">Almacén</FieldLabel>
              <SelectNativo
                id="ajuste-color-almacen"
                value={idAlmacen}
                onChange={(e) => setIdAlmacen(e.target.value)}
                disabled={!puedeMover}
                data-testid="ajuste-color-almacen"
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
              <FieldLabel htmlFor="ajuste-color-fecha">Fecha</FieldLabel>
              <Input
                id="ajuste-color-fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                disabled={!puedeMover}
                data-testid="ajuste-color-fecha"
              />
            </Field>
            {esEntrada ? (
              <Field>
                <FieldLabel htmlFor="ajuste-color-factura">Factura (opcional)</FieldLabel>
                <Input
                  id="ajuste-color-factura"
                  value={factura}
                  onChange={(e) => setFactura(e.target.value)}
                  placeholder="Factura/remisión de las partidas"
                  disabled={!puedeMover}
                  data-testid="ajuste-color-factura"
                />
              </Field>
            ) : null}
          </div>

          <Field data-invalid={!motivoOk}>
            <FieldLabel htmlFor="ajuste-color-motivo">Motivo (obligatorio)</FieldLabel>
            <Input
              id="ajuste-color-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por qué se ajusta (conteo físico, merma, corrección…)"
              disabled={!puedeMover}
              data-testid="ajuste-color-motivo"
            />
          </Field>

          <CapturaRenglonesTelaColor
            renglones={renglones}
            onChange={setRenglones}
            soloLectura={!puedeMover}
            conLoteProveedor={esEntrada}
          />

          <div className="flex items-center justify-end gap-3">
            <Button onClick={guardar} disabled={!puedeGuardar} data-testid="ajuste-color-guardar">
              {ajustar.isPending ? 'Guardando…' : 'Registrar ajuste'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
