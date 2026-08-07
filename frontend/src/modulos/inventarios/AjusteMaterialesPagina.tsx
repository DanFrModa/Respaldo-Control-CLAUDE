import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { useColores } from '@/api/colores';
import { useTiposMovimiento } from '@/api/inventarios';
import { useAjustarAvio, useAjustarTela } from '@/api/inventario-materiales';
import { COD_ROL_PROVEEDOR, useProveedoresPorRol } from '@/api/proveedores';
import type { Tela } from '@/api/telas';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSesion } from '@/sesion/useSesion';

import { CapturaRenglonesAvio, type RenglonAvio } from './CapturaRenglonesAvio';
import { CapturaRenglonesTela, type RenglonTela } from './CapturaRenglonesTela';
import { PestanasSegmentadas } from './PestanasSegmentadas';
import { SelectorTela } from './SelectorTela';

type Dimension = 'tela' | 'avio';
type Direccion = 'entrada' | 'salida';

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Un componente de lote en captura (tela + cantidad + peso). */
interface ComponenteCaptura {
  idTela: number;
  tela: string;
  cantidad: string;
  peso: string;
}

/**
 * AJUSTE / INVENTARIO FÍSICO de materiales (F4-E1, doc 04-Inventarios §B). Sustituye el viejo
 * `SalidasModificar`: toda corrección es un MOVIMIENTO auditado (D3), nunca una edición de la
 * existencia. Motivo OBLIGATORIO (A7). Dos dimensiones (toggle): TELA y AVÍO; dos direcciones
 * (Entrada/Salida). En TELA-Entrada se captura un LOTE NUEVO con sus 1..N componentes (D5: la UI no
 * estorba con 1 componente). En TELA-Salida/AVÍO se capturan renglones sobre lo existente. El backend
 * valida no-negativo en salidas (bajo lock). Captura PC. Permisos `inventario-telas.mover`/
 * `inventario-avios.mover`.
 */
export function AjusteMaterialesPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const [dimension, setDimension] = useState<Dimension>('tela');
  const [direccion, setDireccion] = useState<Direccion>('entrada');

  const puedeMover =
    dimension === 'tela'
      ? tienePermiso('inventario-telas.mover')
      : tienePermiso('inventario-avios.mover');

  const [idAlmacen, setIdAlmacen] = useState<string>('');
  const [fecha, setFecha] = useState(hoy());
  const [motivo, setMotivo] = useState('');

  // Tela-entrada: lote nuevo.
  const [idColor, setIdColor] = useState<string>('');
  const [idProveedor, setIdProveedor] = useState<string>('');
  const [factura, setFactura] = useState('');
  const [componentes, setComponentes] = useState<ComponenteCaptura[]>([]);
  const [telaParaComponente, setTelaParaComponente] = useState<Tela | undefined>(undefined);

  // Tela-salida y avío: renglones sobre lo existente.
  const [renglonesTela, setRenglonesTela] = useState<RenglonTela[]>([]);
  const [renglonesAvio, setRenglonesAvio] = useState<RenglonAvio[]>([]);

  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });
  const colores = useColores({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: 'false',
  });
  // Proveedor del lote: SOLO los que venden telas (decisión P.2, 7-ago-2026), igual que la captura
  // de entrada del flujo nuevo por color.
  const proveedores = useProveedoresPorRol(COD_ROL_PROVEEDOR.vendeTelas);
  const tiposMov = useTiposMovimiento();
  const ajustarTela = useAjustarTela();
  const ajustarAvio = useAjustarAvio();

  // Resuelve el idTipoMov del ajuste por código (ajuste-entrada/ajuste-salida).
  const idTipoMov = useMemo(() => {
    const codigo = direccion === 'entrada' ? 'ajuste-entrada' : 'ajuste-salida';
    return tiposMov.data?.datos.find((t) => t.codigo === codigo)?.id;
  }, [tiposMov.data, direccion]);

  const cargando = ajustarTela.isPending || ajustarAvio.isPending;
  const motivoOk = motivo.trim().length >= 3;
  const esTelaEntrada = dimension === 'tela' && direccion === 'entrada';

  function limpiar(): void {
    setComponentes([]);
    setRenglonesTela([]);
    setRenglonesAvio([]);
    setIdColor('');
    setIdProveedor('');
    setFactura('');
    setMotivo('');
  }

  function agregarComponente(): void {
    if (telaParaComponente === undefined) return;
    setComponentes((prev) => {
      if (prev.some((c) => c.idTela === telaParaComponente.id)) return prev;
      return [
        ...prev,
        { idTela: telaParaComponente.id, tela: telaParaComponente.nombre, cantidad: '', peso: '' },
      ];
    });
    setTelaParaComponente(undefined);
  }

  function setComponente(idTela: number, campo: 'cantidad' | 'peso', valor: string): void {
    setComponentes((prev) => prev.map((c) => (c.idTela === idTela ? { ...c, [campo]: valor } : c)));
  }

  const componentesValidos = componentes.filter((c) => Number(c.cantidad) > 0);
  const puedeGuardar =
    puedeMover &&
    idAlmacen !== '' &&
    motivoOk &&
    idTipoMov !== undefined &&
    !cargando &&
    (esTelaEntrada
      ? idColor !== '' && componentesValidos.length > 0
      : dimension === 'tela'
        ? renglonesTela.length > 0
        : renglonesAvio.length > 0);

  function guardar(): void {
    if (idAlmacen === '' || idTipoMov === undefined) return;
    const baseTela = {
      idTipoMov,
      idAlmacen: Number(idAlmacen),
      fecha,
      motivo: motivo.trim(),
    };
    if (dimension === 'tela' && direccion === 'entrada') {
      ajustarTela.mutate(
        {
          ...baseTela,
          lote: {
            idColor: Number(idColor),
            ...(idProveedor !== '' ? { idProveedor: Number(idProveedor) } : {}),
            ...(factura.trim().length > 0 ? { factura: factura.trim() } : {}),
            componentes: componentesValidos.map((c) => ({
              idTela: c.idTela,
              cantidad: Number(c.cantidad),
              ...(Number(c.peso) > 0 ? { peso: Number(c.peso) } : {}),
            })),
          },
        },
        {
          onSuccess: (m) => {
            toast.success(`Ajuste de entrada registrado (lote nuevo, folio #${m.folio}).`);
            limpiar();
          },
          onError: (error) => toast.error(error.message),
        },
      );
    } else if (dimension === 'tela') {
      ajustarTela.mutate(
        {
          ...baseTela,
          lineas: renglonesTela.map((r) => ({
            idTela: r.idTela,
            idLote: r.idLote,
            cantidad: r.cantidad,
          })),
        },
        {
          onSuccess: (m) => {
            toast.success(`Ajuste de tela registrado (folio #${m.folio}).`);
            limpiar();
          },
          onError: (error) => toast.error(error.message),
        },
      );
    } else {
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
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4 md:p-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Ajuste / inventario físico
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Toda corrección es un movimiento auditado (nunca se edita la existencia) · el motivo es
            obligatorio
          </p>
        </div>
      </header>

      <div className="flex flex-wrap gap-3">
        <PestanasSegmentadas<Dimension>
          opciones={[
            { valor: 'tela', etiqueta: 'Telas', testid: 'ajuste-dim-tela' },
            { valor: 'avio', etiqueta: 'Avíos', testid: 'ajuste-dim-avio' },
          ]}
          valor={dimension}
          alCambiar={setDimension}
          etiqueta="Tipo de material"
        />
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
            {esTelaEntrada
              ? 'Entrada de tela: se crea un lote nuevo con su color y componentes (D5).'
              : 'Captura los renglones a ajustar sobre lo existente.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="ajuste-almacen">Almacén</FieldLabel>
              <SelectNativo
                id="ajuste-almacen"
                value={idAlmacen}
                onChange={(e) => {
                  setIdAlmacen(e.target.value);
                  setRenglonesTela([]); // los lotes dependen del almacén
                }}
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

          {esTelaEntrada ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="ajuste-color">Color del lote</FieldLabel>
                  <SelectNativo
                    id="ajuste-color"
                    value={idColor}
                    onChange={(e) => setIdColor(e.target.value)}
                    disabled={!puedeMover}
                    data-testid="ajuste-color"
                  >
                    <option value="">Elige el color…</option>
                    {(colores.data?.datos ?? []).map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.nombre}
                      </option>
                    ))}
                  </SelectNativo>
                </Field>
                <Field>
                  <FieldLabel htmlFor="ajuste-proveedor">Proveedor de telas (opcional)</FieldLabel>
                  <SelectNativo
                    id="ajuste-proveedor"
                    value={idProveedor}
                    onChange={(e) => setIdProveedor(e.target.value)}
                    disabled={!puedeMover}
                    data-testid="ajuste-proveedor"
                  >
                    <option value="">—</option>
                    {(proveedores.data?.datos ?? []).map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.nombre}
                      </option>
                    ))}
                  </SelectNativo>
                  <p className="text-xs text-muted-foreground">
                    Solo proveedores con el rol «Vende telas».
                  </p>
                </Field>
                <Field>
                  <FieldLabel htmlFor="ajuste-factura">Factura (opcional)</FieldLabel>
                  <Input
                    id="ajuste-factura"
                    value={factura}
                    onChange={(e) => setFactura(e.target.value)}
                    disabled={!puedeMover}
                    data-testid="ajuste-factura"
                  />
                </Field>
              </div>

              <div className="space-y-3 rounded-md border p-3">
                <p className="text-sm font-medium">Componentes del lote (1 o varias telas, D5)</p>
                <SelectorTela
                  idSeleccionado={telaParaComponente?.id}
                  alSeleccionar={setTelaParaComponente}
                  testid="ajuste-tela-componente"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={agregarComponente}
                  disabled={!puedeMover || telaParaComponente === undefined}
                  data-testid="ajuste-agregar-componente"
                >
                  <Plus className="mr-1.5 size-4" aria-hidden /> Agregar componente
                </Button>

                {componentes.length === 0 ? (
                  <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                    Agrega al menos una tela como componente del lote.
                  </p>
                ) : (
                  <div
                    className="overflow-x-auto rounded-md border"
                    data-testid="ajuste-componentes-tabla"
                  >
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Tela</TableHead>
                          <TableHead className="w-40">Cantidad</TableHead>
                          <TableHead className="w-40">Peso (kg)</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {componentes.map((c) => (
                          <TableRow key={c.idTela}>
                            <TableCell className="font-medium">{c.tela}</TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min={0}
                                step="any"
                                value={c.cantidad}
                                onChange={(e) =>
                                  setComponente(c.idTela, 'cantidad', e.target.value)
                                }
                                disabled={!puedeMover}
                                data-testid={`ajuste-comp-cantidad-${c.idTela}`}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min={0}
                                step="any"
                                value={c.peso}
                                onChange={(e) => setComponente(c.idTela, 'peso', e.target.value)}
                                disabled={!puedeMover}
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setComponentes((prev) =>
                                    prev.filter((x) => x.idTela !== c.idTela),
                                  )
                                }
                                disabled={!puedeMover}
                                data-testid={`ajuste-comp-quitar-${c.idTela}`}
                              >
                                <Trash2 className="size-4" aria-hidden />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>
          ) : dimension === 'tela' ? (
            <div>
              <h3 className="mb-2 text-sm font-medium">Telas a ajustar (por lote)</h3>
              <CapturaRenglonesTela
                idAlmacen={idAlmacen === '' ? undefined : Number(idAlmacen)}
                renglones={renglonesTela}
                onChange={setRenglonesTela}
                soloLectura={!puedeMover}
              />
            </div>
          ) : (
            <div>
              <h3 className="mb-2 text-sm font-medium">Avíos a ajustar</h3>
              <CapturaRenglonesAvio
                renglones={renglonesAvio}
                onChange={setRenglonesAvio}
                soloLectura={!puedeMover}
              />
            </div>
          )}

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
