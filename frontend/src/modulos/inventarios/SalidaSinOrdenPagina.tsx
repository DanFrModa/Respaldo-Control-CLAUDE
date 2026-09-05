import { useState } from 'react';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { useSalidaAvioSinOrden, useSalidaTelaColorSinOrden } from '@/api/inventario-materiales';
import type { ConceptoSalidaSinOrden } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useSesion } from '@/sesion/useSesion';

import { CapturaRenglonesAvio, type RenglonAvio } from './CapturaRenglonesAvio';
import { CapturaRenglonesTelaColor, type RenglonTelaColor } from './CapturaRenglonesTelaColor';
import { PestanasSegmentadas } from './PestanasSegmentadas';

/** Qué material se está sacando. */
type Dimension = 'tela' | 'avio';

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Los tres conceptos del contrato, con el texto que ve quien captura. */
const CONCEPTOS: readonly { valor: ConceptoSalidaSinOrden; etiqueta: string }[] = [
  { valor: 'devolucion-proveedor', etiqueta: 'Devolución al proveedor' },
  { valor: 'venta', etiqueta: 'Venta de material que ya no se usa' },
  { valor: 'otro', etiqueta: 'Otra causa' },
];

/**
 * ⭐⭐ LA SALIDA QUE NO ES POR OP (fila 0.104) — telas y avíos.
 *
 * DANIEL, 2-sep-2026: *«el 99 % sale por medio de una OP pero deberíamos tener la opción de sacar
 * alguna venta o cualquier otra cosa»*; y al cerrarlo (§Post-F9.193 resp. 12): *«sacar por ejemplo
 * una devolución, o una venta de avíos que ya no se usen… que no sea mediante la descarga o
 * aplicación a una OP. Esto autorizado siempre por mí. Lo mismo en telas»*.
 *
 * **Sólo ajusta inventario.** No genera nota de crédito, no toca la cuenta del proveedor ni la
 * facturación: eso Daniel lo dejó fuera («por ahora que toque sólo inventarios»). A quién se le
 * devolvió o se le vendió va en el MOTIVO, que es obligatorio.
 *
 * 🔴 **Quién puede.** El permiso propio `salida-material.registrar`, que sólo lleva el
 * administrador — NO el `inventario-*.mover` de los ajustes. Esta pantalla lo respeta escondiendo
 * los controles, pero eso es cortesía: la guarda de verdad está en el dominio (A1), y el mismo
 * permiso hace falta para CANCELAR una de estas salidas (el inverso devuelve el material).
 *
 * Las DOS dimensiones viven aquí, en pestañas, porque la decisión de Daniel es UNA y el permiso
 * también. Cada pestaña habla con su propio endpoint y con su propio almacén (uno de TELA, otro de
 * AVIO — el backend rechaza el cruce).
 */
export function SalidaSinOrdenPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeSacar = tienePermiso('salida-material.registrar');

  const [dimension, setDimension] = useState<Dimension>('tela');
  const [concepto, setConcepto] = useState<ConceptoSalidaSinOrden>('devolucion-proveedor');
  const [idAlmacen, setIdAlmacen] = useState<string>('');
  const [fecha, setFecha] = useState(hoy());
  const [motivo, setMotivo] = useState('');
  const [renglonesTela, setRenglonesTela] = useState<RenglonTelaColor[]>([]);
  const [renglonesAvio, setRenglonesAvio] = useState<RenglonAvio[]>([]);

  // El almacén tiene que ser del tipo del material (el backend lo exige, fila 0.137): al cambiar de
  // pestaña se vacía la selección para no mandar una bodega de telas en una salida de avíos.
  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
    tipo: dimension === 'tela' ? 'TELA' : 'AVIO',
  });

  const salidaTela = useSalidaTelaColorSinOrden();
  const salidaAvio = useSalidaAvioSinOrden();
  const guardando = salidaTela.isPending || salidaAvio.isPending;

  const motivoOk = motivo.trim().length >= 3;
  const hayRenglones = dimension === 'tela' ? renglonesTela.length > 0 : renglonesAvio.length > 0;
  const puedeGuardar = puedeSacar && idAlmacen !== '' && motivoOk && hayRenglones && !guardando;

  function cambiarDimension(nueva: Dimension): void {
    setDimension(nueva);
    setIdAlmacen('');
  }

  function limpiar(): void {
    setRenglonesTela([]);
    setRenglonesAvio([]);
    setMotivo('');
  }

  function guardar(): void {
    if (idAlmacen === '') return;
    const encabezado = { concepto, idAlmacen: Number(idAlmacen), fecha, motivo: motivo.trim() };
    const alTerminar = {
      onSuccess: (m: { folio: number }) => {
        toast.success(`Salida registrada (folio #${m.folio}).`);
        limpiar();
      },
      onError: (error: Error) => {
        toast.error(error.message);
      },
    };

    if (dimension === 'tela') {
      salidaTela.mutate(
        {
          ...encabezado,
          lineas: renglonesTela.map((r) => ({
            idTelaColor: r.idTelaColor,
            cantidad: r.cantidad,
            ...(r.nombreComplemento !== null ? { cantidadComplemento: r.cantidadComplemento } : {}),
          })),
        },
        alTerminar,
      );
      return;
    }
    salidaAvio.mutate(
      {
        ...encabezado,
        lineas: renglonesAvio.map((r) => ({ idAvio: r.idAvio, cantidad: r.cantidad })),
      },
      alTerminar,
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4 md:p-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Salida de material sin orden
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Devolución al proveedor, venta de material que ya no se usa u otra causa · sólo ajusta
            inventario · el motivo es obligatorio
          </p>
        </div>
      </header>

      {!puedeSacar ? (
        <p
          className="rounded-md border border-dashed p-4 text-sm text-muted-foreground"
          data-testid="salida-sin-orden-sin-permiso"
        >
          Esta salida la autoriza sólo la dirección. Para descontar material de una orden de
          producción usa «Salida de tela a orden»; para corregir el inventario, el ajuste.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <PestanasSegmentadas<Dimension>
              opciones={[
                { valor: 'tela', etiqueta: 'Telas', testid: 'salida-sin-orden-dim-tela' },
                { valor: 'avio', etiqueta: 'Avíos', testid: 'salida-sin-orden-dim-avio' },
              ]}
              valor={dimension}
              alCambiar={cambiarDimension}
              etiqueta="Material de la salida"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Datos de la salida</CardTitle>
              <CardDescription>
                Se registra como un movimiento de inventario auditado: no genera nota de crédito ni
                toca la cuenta del proveedor.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="salida-sin-orden-concepto">Concepto</FieldLabel>
                  <SelectNativo
                    id="salida-sin-orden-concepto"
                    value={concepto}
                    onChange={(e) => {
                      setConcepto(e.target.value as ConceptoSalidaSinOrden);
                    }}
                    data-testid="salida-sin-orden-concepto"
                  >
                    {CONCEPTOS.map((c) => (
                      <option key={c.valor} value={c.valor}>
                        {c.etiqueta}
                      </option>
                    ))}
                  </SelectNativo>
                </Field>
                <Field>
                  <FieldLabel htmlFor="salida-sin-orden-almacen">Almacén</FieldLabel>
                  <SelectNativo
                    id="salida-sin-orden-almacen"
                    value={idAlmacen}
                    onChange={(e) => {
                      setIdAlmacen(e.target.value);
                    }}
                    data-testid="salida-sin-orden-almacen"
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
                  <FieldLabel htmlFor="salida-sin-orden-fecha">Fecha</FieldLabel>
                  <Input
                    id="salida-sin-orden-fecha"
                    type="date"
                    value={fecha}
                    onChange={(e) => {
                      setFecha(e.target.value);
                    }}
                    data-testid="salida-sin-orden-fecha"
                  />
                </Field>
              </div>

              <Field data-invalid={!motivoOk}>
                <FieldLabel htmlFor="salida-sin-orden-motivo">Motivo (obligatorio)</FieldLabel>
                <Input
                  id="salida-sin-orden-motivo"
                  value={motivo}
                  onChange={(e) => {
                    setMotivo(e.target.value);
                  }}
                  placeholder="A quién se le devolvió o se le vendió, y por qué"
                  data-testid="salida-sin-orden-motivo"
                />
              </Field>

              <div>
                <h3 className="mb-2 text-sm font-medium">
                  {dimension === 'tela' ? 'Telas a sacar (por color)' : 'Avíos a sacar'}
                </h3>
                {dimension === 'tela' ? (
                  <CapturaRenglonesTelaColor
                    renglones={renglonesTela}
                    onChange={setRenglonesTela}
                  />
                ) : (
                  <CapturaRenglonesAvio renglones={renglonesAvio} onChange={setRenglonesAvio} />
                )}
              </div>

              <div className="flex items-center justify-end gap-3">
                <Button
                  onClick={guardar}
                  disabled={!puedeGuardar}
                  data-testid="salida-sin-orden-guardar"
                >
                  {guardando ? 'Guardando…' : 'Registrar salida'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
