import { Loader2Icon, PlusIcon, RefreshCwIcon, SnowflakeIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useConceptosCosto } from '@/api/conceptos-costo';
import type { Desarrollo } from '@/api/desarrollos';
import {
  useAgregarLinea,
  useCongelarPrecosto,
  useEditarLinea,
  useEliminarLinea,
  useGenerarPrecosto,
  usePrecosto,
  usePrecostosDesarrollo,
  useRecalcularPrecosto,
  useRestaurarLinea,
  type Precosto,
  type PrecostoLinea,
  type PrecostoResumen,
} from '@/api/precostos';
import { Badge } from '@/components/ui/badge';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { moneda } from '@/modulos/costos/comun';
import { useSesion } from '@/sesion/useSesion';

import { TechPackDesarrollo } from './TechPackDesarrollo';

/** Catálogo de conceptos activos (para el selector de renglones manuales). */
const QUERY_CONCEPTOS = {
  pagina: 1,
  porPagina: 100,
  ordenarPor: 'orden',
  direccion: 'asc',
  incluirInactivos: 'false',
} as const;

/** Un grupo de renglones por concepto (para agrupar en el editor). */
interface GrupoConcepto {
  codigo: string;
  nombre: string;
  orden: number;
  lineas: PrecostoLinea[];
}

/** Agrupa los renglones por concepto (ya vienen ordenados por `conceptoOrden` del servidor). */
function agruparPorConcepto(lineas: PrecostoLinea[]): GrupoConcepto[] {
  const porCodigo = new Map<string, GrupoConcepto>();
  for (const linea of lineas) {
    const grupo = porCodigo.get(linea.conceptoCodigo);
    if (grupo === undefined) {
      porCodigo.set(linea.conceptoCodigo, {
        codigo: linea.conceptoCodigo,
        nombre: linea.conceptoNombre,
        orden: linea.conceptoOrden,
        lineas: [linea],
      });
    } else {
      grupo.lineas.push(linea);
    }
  }
  return [...porCodigo.values()].sort((a, b) => a.orden - b.orden);
}

/**
 * Editor del PRECOSTO PERSISTIDO de un desarrollo (F8-E3). Muestra el HISTORIAL de versiones y, sobre
 * la versión seleccionada, el precosto vivo con sus renglones AGRUPADOS por concepto. En un BORRADOR
 * (con `desarrollo.precostear`) se puede editar/agregar/quitar renglones manuales, editar la maquila,
 * RE-CALCULAR desde el BOM (con confirmación) y CONGELAR la versión (inmutable). Las versiones
 * congeladas son sólo lectura. Los importes salen "—" sin `consultas.ver-importes` (lo decide el
 * backend).
 */
export function DialogoPrecosto({
  abierto,
  alCambiarAbierto,
  desarrollo,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  desarrollo: Desarrollo | undefined;
}): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedePrecostear = tienePermiso('desarrollo.precostear');
  const puedeAdministrar = tienePermiso('desarrollo.administrar');
  // `verImportes` se deriva del PERMISO real (no de que `costoTotal` venga null): así no depende de
  // la invariante de ocultación del backend y no se rompe si un precosto legítimo tuviera total 0.
  const verImportes = tienePermiso('consultas.ver-importes');

  const idDesarrollo = abierto ? (desarrollo?.id ?? null) : null;
  const historial = usePrecostosDesarrollo(idDesarrollo);
  const versiones = useMemo(() => historial.data ?? [], [historial.data]);
  const generar = useGenerarPrecosto();

  const [idSel, setIdSel] = useState<number | null>(null);

  // Al cerrar, se limpia la selección; al abrir, la fija el efecto de abajo.
  useEffect(() => {
    if (!abierto) {
      setIdSel(null);
    }
  }, [abierto]);
  // Selecciona por default la versión más nueva (o mantiene la elegida si sigue existiendo).
  useEffect(() => {
    const primera = versiones[0];
    if (!abierto || primera === undefined) {
      return;
    }
    setIdSel((actual) =>
      actual !== null && versiones.some((v) => v.id === actual) ? actual : primera.id,
    );
  }, [abierto, versiones]);

  const precosto = usePrecosto(abierto ? idSel : null);
  const hayBorrador = versiones.some((v) => v.estado === 'borrador');

  function alGenerar(): void {
    if (desarrollo === undefined) {
      return;
    }
    generar.mutate(desarrollo.id, {
      onSuccess: (nuevo) => {
        setIdSel(nuevo.id);
        toast.success(`Precosto v${nuevo.version} generado.`);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Precosto — {desarrollo?.codigoModelo ?? ''}</DialogTitle>
          <DialogDescription>
            Precosto persistido del desarrollo, versionable por congelado. Cada versión se calcula
            desde el BOM del modelo con los precios amarrados; la maquila y los conceptos manuales
            se editan a mano.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1" data-testid="dialogo-precosto">
          <HistorialVersiones
            versiones={versiones}
            cargando={historial.isPending}
            idSel={idSel}
            alSeleccionar={setIdSel}
          />

          {puedePrecostear && !hayBorrador ? (
            <Button
              type="button"
              onClick={alGenerar}
              disabled={generar.isPending}
              data-testid="generar-precosto"
            >
              {generar.isPending ? (
                <Loader2Icon className="animate-spin" aria-hidden />
              ) : (
                <PlusIcon aria-hidden />
              )}
              Generar {versiones.length === 0 ? 'precosto' : 'nueva versión'}
            </Button>
          ) : null}

          {idSel !== null ? (
            precosto.isPending ? (
              <p className="text-sm text-muted-foreground">Cargando precosto…</p>
            ) : precosto.isError ? (
              <p className="text-sm text-destructive" role="alert">
                {precosto.error.message}
              </p>
            ) : precosto.data ? (
              <EditorPrecosto
                precosto={precosto.data}
                puedePrecostear={puedePrecostear}
                verImportes={verImportes}
              />
            ) : null
          ) : versiones.length === 0 && !historial.isPending ? (
            <p className="text-sm text-muted-foreground">
              Este desarrollo aún no tiene precosto.
              {puedePrecostear ? ' Genera el primero para empezar.' : ''}
            </p>
          ) : null}

          {/* R5/B16: tech pack (PDFs de referencia + fotos de muestra) del desarrollo. */}
          {desarrollo !== undefined ? (
            <section className="space-y-2 border-t pt-3" data-testid="seccion-tech-pack">
              <h4 className="text-sm font-semibold">Tech pack y fotos</h4>
              <TechPackDesarrollo
                idDesarrollo={desarrollo.id}
                puedeAdministrar={puedeAdministrar}
              />
            </section>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => alCambiarAbierto(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Lista de versiones (historial), con el estado y el total; se puede seleccionar cuál ver. */
function HistorialVersiones({
  versiones,
  cargando,
  idSel,
  alSeleccionar,
}: {
  versiones: PrecostoResumen[];
  cargando: boolean;
  idSel: number | null;
  alSeleccionar: (id: number) => void;
}): React.JSX.Element {
  if (cargando) {
    return <p className="text-sm text-muted-foreground">Cargando versiones…</p>;
  }
  if (versiones.length === 0) {
    return <></>;
  }
  return (
    <div className="flex flex-wrap gap-2" data-testid="historial-precostos">
      {versiones.map((v) => (
        <button
          key={v.id}
          type="button"
          onClick={() => alSeleccionar(v.id)}
          aria-pressed={v.id === idSel}
          data-testid="version-precosto"
          className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-sm transition-colors ${
            v.id === idSel ? 'border-primary bg-primary/10' : 'hover:bg-accent'
          }`}
        >
          <span className="font-medium">v{v.version}</span>
          <Badge variant={v.congelado ? 'default' : 'secondary'}>
            {v.congelado ? 'Congelado' : 'Borrador'}
          </Badge>
          <span className="text-muted-foreground">{moneda(v.costoTotal)}</span>
        </button>
      ))}
    </div>
  );
}

/** Panel de la versión seleccionada: encabezado + acciones + renglones por concepto + alta manual. */
function EditorPrecosto({
  precosto,
  puedePrecostear,
  verImportes,
}: {
  precosto: Precosto;
  puedePrecostear: boolean;
  verImportes: boolean;
}): React.JSX.Element {
  const editable = puedePrecostear && !precosto.congelado;
  // Editar/agregar/eliminar renglones toca IMPORTES: sin `consultas.ver-importes` los precios salen
  // "—", así que se BLOQUEAN esos controles para no sobrescribir a ciegas el precio real oculto
  // (guarda de integridad/UX; el rol Ventas tiene `precostear` pero no `ver-importes`). Recalcular
  // (refresca del BOM) y congelar (no capturan precio) siguen disponibles bajo `editable`.
  const puedeEditarLineas = editable && verImportes;
  const grupos = useMemo(() => agruparPorConcepto(precosto.lineas), [precosto.lineas]);

  const recalcular = useRecalcularPrecosto();
  const congelar = useCongelarPrecosto();
  const eliminar = useEliminarLinea();
  const restaurar = useRestaurarLinea();

  const [confirmando, setConfirmando] = useState<'recalcular' | 'congelar' | null>(null);

  function subtotal(grupo: GrupoConcepto): number | null {
    if (!verImportes) {
      return null;
    }
    return grupo.lineas.reduce((suma, l) => suma + (l.importe ?? 0), 0);
  }

  function alRecalcular(): void {
    recalcular.mutate(precosto.id, {
      onSuccess: () => {
        toast.success('Precosto recalculado desde el BOM.');
        setConfirmando(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }
  function alCongelar(): void {
    congelar.mutate(precosto.id, {
      onSuccess: (p) => {
        toast.success(`Precosto v${p.version} congelado.`);
        setConfirmando(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }
  function alEliminar(linea: PrecostoLinea): void {
    eliminar.mutate(
      { id: precosto.id, idLinea: linea.id },
      {
        onSuccess: () => toast.success('Renglón quitado.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }
  function alRestaurar(linea: PrecostoLinea): void {
    restaurar.mutate(
      { id: precosto.id, idLinea: linea.id },
      {
        onSuccess: () => toast.success('Renglón restaurado al BOM.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const ocupado = recalcular.isPending || congelar.isPending;

  return (
    <div className="space-y-4" data-testid="editor-precosto">
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="flex items-center gap-2">
          <span className="font-medium">Versión {precosto.version}</span>
          <Badge variant={precosto.congelado ? 'default' : 'secondary'}>
            {precosto.congelado ? 'Congelado' : 'Borrador'}
          </Badge>
          <span className="text-sm text-muted-foreground">
            Total{' '}
            <span className="font-semibold text-foreground">{moneda(precosto.costoTotal)}</span>
          </span>
        </div>
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmando('recalcular')}
              disabled={ocupado}
              data-testid="recalcular-precosto"
            >
              <RefreshCwIcon aria-hidden />
              Recalcular desde BOM
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setConfirmando('congelar')}
              disabled={ocupado}
              data-testid="congelar-precosto"
            >
              <SnowflakeIcon aria-hidden />
              Congelar versión
            </Button>
          </div>
        ) : null}
      </div>

      {confirmando !== null ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm"
          data-testid="confirmar-accion-precosto"
        >
          <span>
            {confirmando === 'recalcular'
              ? 'Recalcular reemplaza los renglones de tela/avíos/bordado con los valores vigentes del BOM (respeta los manuales y los renglones AJUSTADOS en la negociación). ¿Continuar?'
              : 'Al congelar, esta versión queda INMUTABLE y sirve de base para la lista y la negociación. ¿Continuar?'}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmando(null)}
              disabled={ocupado}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={confirmando === 'recalcular' ? alRecalcular : alCongelar}
              disabled={ocupado}
              data-testid="confirmar-precosto"
            >
              {ocupado ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {confirmando === 'recalcular' ? 'Recalcular' : 'Congelar'}
            </Button>
          </div>
        </div>
      ) : null}

      {grupos.map((grupo) => (
        <section key={grupo.codigo} data-testid={`grupo-${grupo.codigo}`}>
          <div className="mb-1 flex items-center justify-between">
            <h4 className="text-sm font-semibold">{grupo.nombre}</h4>
            <span className="text-xs text-muted-foreground">
              Subtotal {moneda(subtotal(grupo))}
            </span>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Concepto / insumo</TableHead>
                  <TableHead className="text-right">Consumo</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead className="text-right">Importe</TableHead>
                  {puedeEditarLineas ? (
                    <TableHead className="text-right">Acciones</TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {grupo.lineas.map((linea) => (
                  <RenglonPrecosto
                    key={linea.id}
                    linea={linea}
                    idPrecosto={precosto.id}
                    editable={puedeEditarLineas}
                    eliminando={eliminar.isPending}
                    restaurando={restaurar.isPending}
                    alEliminar={() => alEliminar(linea)}
                    alRestaurar={() => alRestaurar(linea)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ))}

      {puedeEditarLineas ? <FormAgregarManual idPrecosto={precosto.id} /> : null}
    </div>
  );
}

/** Un renglón: en modo lectura muestra los valores; editable alterna a inputs en línea (B12: en un
 * borrador CUALQUIER renglón se edita/quita; los BOM editados quedan "ajustados" y se pueden restaurar). */
function RenglonPrecosto({
  linea,
  idPrecosto,
  editable,
  eliminando,
  restaurando,
  alEliminar,
  alRestaurar,
}: {
  linea: PrecostoLinea;
  idPrecosto: number;
  editable: boolean;
  eliminando: boolean;
  restaurando: boolean;
  alEliminar: () => void;
  alRestaurar: () => void;
}): React.JSX.Element {
  const editar = useEditarLinea();
  const [editando, setEditando] = useState(false);
  const [descripcion, setDescripcion] = useState(linea.descripcion);
  const [consumo, setConsumo] = useState(linea.consumo === null ? '' : String(linea.consumo));
  const [precio, setPrecio] = useState(linea.precioUnit === null ? '' : String(linea.precioUnit));

  function abrirEdicion(): void {
    setDescripcion(linea.descripcion);
    setConsumo(linea.consumo === null ? '' : String(linea.consumo));
    setPrecio(linea.precioUnit === null ? '' : String(linea.precioUnit));
    setEditando(true);
  }

  function guardar(): void {
    const descripcionLimpia = descripcion.trim();
    if (descripcionLimpia === '') {
      toast.error('La descripción es obligatoria.');
      return;
    }
    const precioNum = Number(precio);
    if (precio.trim() === '' || Number.isNaN(precioNum) || precioNum < 0) {
      toast.error('El precio debe ser un número ≥ 0.');
      return;
    }
    const consumoNum = consumo.trim() === '' ? null : Number(consumo);
    if (consumoNum !== null && (Number.isNaN(consumoNum) || consumoNum < 0)) {
      toast.error('El consumo debe ser un número ≥ 0.');
      return;
    }
    editar.mutate(
      {
        id: idPrecosto,
        idLinea: linea.id,
        cuerpo: { descripcion: descripcionLimpia, consumo: consumoNum, precioUnit: precioNum },
      },
      {
        onSuccess: () => {
          toast.success('Renglón actualizado.');
          setEditando(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  if (editable && editando) {
    return (
      <TableRow data-testid="linea-precosto">
        <TableCell>
          <Input
            aria-label="Descripción"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            data-testid="editar-linea-descripcion"
          />
        </TableCell>
        <TableCell className="text-right">
          <Input
            aria-label="Consumo"
            className="text-right"
            value={consumo}
            onChange={(e) => setConsumo(e.target.value)}
            placeholder="—"
          />
        </TableCell>
        <TableCell className="text-right">
          <Input
            aria-label="Precio"
            className="text-right"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            data-testid="editar-linea-precio"
          />
        </TableCell>
        <TableCell className="text-right text-muted-foreground">—</TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditando(false)}
              disabled={editar.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={guardar}
              disabled={editar.isPending}
              data-testid="guardar-linea"
            >
              {editar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Guardar
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow data-testid="linea-precosto">
      <TableCell>
        <span>{linea.descripcion}</span>
        {linea.ajustado ? (
          <Badge variant="outline" className="ml-2 text-amber-600" data-testid="linea-ajustada">
            Ajustado
          </Badge>
        ) : null}
      </TableCell>
      <TableCell className="text-right">{linea.consumo ?? '—'}</TableCell>
      <TableCell className="text-right">{moneda(linea.precioUnit)}</TableCell>
      <TableCell className="text-right">{moneda(linea.importe)}</TableCell>
      {editable ? (
        <TableCell className="text-right">
          <div className="flex justify-end gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={abrirEdicion}
              data-testid="editar-linea"
            >
              Editar
            </Button>
            {linea.ajustado ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={alRestaurar}
                disabled={restaurando}
                title="Restaurar al valor del BOM del modelo"
                data-testid="restaurar-linea"
              >
                <RefreshCwIcon aria-hidden />
              </Button>
            ) : null}
            {linea.eliminable ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={alEliminar}
                disabled={eliminando}
                data-testid="eliminar-linea"
              >
                <Trash2Icon aria-hidden />
              </Button>
            ) : null}
          </div>
        </TableCell>
      ) : null}
    </TableRow>
  );
}

/** Formulario de alta de un renglón MANUAL (concepto + descripción + consumo + precio). */
function FormAgregarManual({ idPrecosto }: { idPrecosto: number }): React.JSX.Element {
  const conceptos = useConceptosCosto(QUERY_CONCEPTOS);
  const agregar = useAgregarLinea();

  const [idConcepto, setIdConcepto] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [consumo, setConsumo] = useState('');
  const [precio, setPrecio] = useState('');

  function agregarLinea(): void {
    if (idConcepto === '') {
      toast.error('Elige un concepto.');
      return;
    }
    const precioNum = Number(precio);
    if (precio.trim() === '' || Number.isNaN(precioNum) || precioNum < 0) {
      toast.error('El precio debe ser un número ≥ 0.');
      return;
    }
    const consumoNum = consumo.trim() === '' ? null : Number(consumo);
    if (consumoNum !== null && (Number.isNaN(consumoNum) || consumoNum < 0)) {
      toast.error('El consumo debe ser un número ≥ 0.');
      return;
    }
    agregar.mutate(
      {
        id: idPrecosto,
        cuerpo: {
          idConceptoCosto: Number(idConcepto),
          ...(descripcion.trim() === '' ? {} : { descripcion: descripcion.trim() }),
          consumo: consumoNum,
          precioUnit: precioNum,
        },
      },
      {
        onSuccess: () => {
          toast.success('Renglón agregado.');
          setDescripcion('');
          setConsumo('');
          setPrecio('');
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <div className="rounded-lg border bg-muted/30 p-3" data-testid="form-agregar-manual">
      <p className="mb-2 text-sm font-semibold">Agregar renglón manual</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto_auto_auto] sm:items-end">
        <Field>
          <FieldLabel htmlFor="manual-concepto">Concepto</FieldLabel>
          <SelectNativo
            id="manual-concepto"
            value={idConcepto}
            onChange={(e) => setIdConcepto(e.target.value)}
            data-testid="agregar-linea-concepto"
          >
            <option value="">Elige…</option>
            {/* R5/B12: se puede agregar bajo cualquier concepto SALVO los anclas maquila/corte (ya
                tienen su renglón fijo por prenda). Tela/avíos sí, como renglón scratch de negociación. */}
            {(conceptos.data?.datos ?? [])
              .filter((c) => c.codigo !== 'maquila' && c.codigo !== 'corte')
              .map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.nombre}
                </option>
              ))}
          </SelectNativo>
        </Field>
        <Field>
          <FieldLabel htmlFor="manual-descripcion">Descripción</FieldLabel>
          <Input
            id="manual-descripcion"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="(opcional)"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="manual-consumo">Consumo</FieldLabel>
          <Input
            id="manual-consumo"
            className="text-right"
            value={consumo}
            onChange={(e) => setConsumo(e.target.value)}
            placeholder="—"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="manual-precio">Precio</FieldLabel>
          <Input
            id="manual-precio"
            className="text-right"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            data-testid="agregar-linea-precio"
          />
        </Field>
        <Button
          type="button"
          onClick={agregarLinea}
          disabled={agregar.isPending}
          data-testid="agregar-linea"
        >
          {agregar.isPending ? (
            <Loader2Icon className="animate-spin" aria-hidden />
          ) : (
            <PlusIcon aria-hidden />
          )}
          Agregar
        </Button>
      </div>
    </div>
  );
}
