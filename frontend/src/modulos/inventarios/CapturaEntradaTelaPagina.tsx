import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import {
  useActualizarEntradaTela,
  useCrearEntradaTela,
  useEntradaTela,
  type EntradaTelaCrear,
} from '@/api/entradas-tela';
import { COD_ROL_PROVEEDOR, useProveedoresPorRol } from '@/api/proveedores';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useSesion } from '@/sesion/useSesion';

import { CapturaRenglonesTelaColor, type RenglonTelaColor } from './CapturaRenglonesTelaColor';

/** Fecha de hoy en YYYY-MM-DD (zona local). */
function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

type TipoDocumento = 'factura' | 'remision';

/**
 * CAPTURA de una ENTRADA DE TELA por FACTURA/REMISIÓN, sin orden de compra (etapa B1 — Daniel
 * §Post-F9.9 punto 7). Un documento = una CABECERA (factura|remisión + su número + proveedor +
 * fecha + almacén destino) y N PARTIDAS: cada renglón lleva su color, sus cantidades de cuerpo y
 * complemento (juntas) y sus precios, y al confirmar crea SU partida.
 *
 * El documento se GUARDA en BORRADOR (no toca el inventario): así se le puede adjuntar el PDF de la
 * factura y revisarlo antes de confirmarlo desde la lista. La misma pantalla EDITA un borrador
 * (ruta `…/:id/editar`); una entrada confirmada ya no se edita (D3, lo rechaza el backend).
 * Permiso `inventario-telas.mover`.
 */
export function CapturaEntradaTelaPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeMover = tienePermiso('inventario-telas.mover');
  const navegar = useNavigate();
  const parametros = useParams<{ id?: string }>();
  const idEditar = parametros.id === undefined ? undefined : Number(parametros.id);

  const [tipoDocumento, setTipoDocumento] = useState<TipoDocumento>('factura');
  const [numeroDocumento, setNumeroDocumento] = useState('');
  const [idProveedor, setIdProveedor] = useState<string>('');
  const [fecha, setFecha] = useState(hoy());
  const [idAlmacen, setIdAlmacen] = useState<string>('');
  const [observaciones, setObservaciones] = useState('');
  const [renglones, setRenglones] = useState<RenglonTelaColor[]>([]);

  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });
  // Quien surte la tela: SOLO proveedores con el rol "vende-telas" (petición de Daniel, 7-ago-2026;
  // decisión P.2). Mismo criterio que Producción (Corte lista los de rol "corte"). El filtro lo
  // aplica el SERVIDOR (`?rol=`); mientras el rol no se resuelve, la consulta queda apagada.
  const proveedores = useProveedoresPorRol(COD_ROL_PROVEEDOR.vendeTelas);
  const existente = useEntradaTela(idEditar);
  const crear = useCrearEntradaTela();
  const actualizar = useActualizarEntradaTela();

  // Al EDITAR: precarga el borrador una vez que llega del servidor.
  useEffect(() => {
    const entrada = existente.data;
    if (entrada === undefined) return;
    setTipoDocumento(entrada.tipoDocumento);
    setNumeroDocumento(entrada.numeroDocumento);
    setIdProveedor(String(entrada.idProveedor));
    setFecha(entrada.fecha);
    setIdAlmacen(String(entrada.idAlmacen));
    setObservaciones(entrada.observaciones ?? '');
    setRenglones(
      entrada.lineas.map((l) => ({
        idTelaColor: l.idTelaColor,
        tela: l.tela,
        color: l.telaColor,
        nombreComplemento: l.nombreComplemento,
        cantidad: l.cantidad,
        cantidadComplemento: l.cantidadComplemento ?? 0,
        ...(l.loteProveedor === null ? {} : { loteProveedor: l.loteProveedor }),
        ...(l.precioUnit === null ? {} : { precioUnit: l.precioUnit }),
        ...(l.precioUnitComplemento === null
          ? {}
          : { precioUnitComplemento: l.precioUnitComplemento }),
      })),
    );
  }, [existente.data]);

  // Un documento CONFIRMADO o CANCELADO ya no se edita (D3: el backend lo rechaza con 409). Si se
  // llega por URL directa a `…/:id/editar` de uno así, la pantalla lo dice y se cierra la captura
  // en vez de dejar teclear un formulario que va a morir al guardar.
  const noEditable =
    existente.data !== undefined && existente.data.estatus !== 'borrador'
      ? existente.data.estatus
      : null;
  const editable = puedeMover && noEditable === null;

  // El proveedor ya capturado se RESPETA aunque no traiga el rol "vende-telas" (documento viejo o
  // proveedor al que le falta la casilla): se conserva como opción en vez de desaparecer del
  // selector y perder el dato en silencio.
  const listaProveedores = proveedores.data?.datos ?? [];
  const proveedorFueraDelFiltro =
    idProveedor !== '' && !listaProveedores.some((p) => String(p.id) === idProveedor);
  const nombreProveedorCargado =
    existente.data !== undefined && String(existente.data.idProveedor) === idProveedor
      ? existente.data.proveedor
      : 'Proveedor actual';

  const guardando = crear.isPending || actualizar.isPending;
  const puedeGuardar =
    editable &&
    numeroDocumento.trim().length > 0 &&
    idProveedor !== '' &&
    idAlmacen !== '' &&
    renglones.length > 0 &&
    !guardando;

  const cuerpo: EntradaTelaCrear | undefined = useMemo(() => {
    if (idProveedor === '' || idAlmacen === '') return undefined;
    return {
      tipoDocumento,
      numeroDocumento: numeroDocumento.trim(),
      idProveedor: Number(idProveedor),
      fecha,
      idAlmacen: Number(idAlmacen),
      ...(observaciones.trim().length > 0 ? { observaciones: observaciones.trim() } : {}),
      lineas: renglones.map((r) => ({
        idTelaColor: r.idTelaColor,
        cantidad: r.cantidad,
        ...(r.nombreComplemento !== null ? { cantidadComplemento: r.cantidadComplemento } : {}),
        ...(r.loteProveedor === undefined ? {} : { loteProveedor: r.loteProveedor }),
        ...(r.precioUnit === undefined ? {} : { precioUnit: r.precioUnit }),
        ...(r.precioUnitComplemento === undefined
          ? {}
          : { precioUnitComplemento: r.precioUnitComplemento }),
      })),
    };
  }, [tipoDocumento, numeroDocumento, idProveedor, fecha, idAlmacen, observaciones, renglones]);

  function guardar(): void {
    if (cuerpo === undefined) return;
    const alTerminar = {
      onSuccess: (entrada: { folio: number; avisos: string[] }) => {
        toast.success(
          idEditar === undefined
            ? `Entrada ${entrada.folio} guardada en borrador. Adjunta la factura y confírmala para que entre al inventario.`
            : `Entrada ${entrada.folio} actualizada.`,
        );
        // Aviso SUAVE del backend (factura repetida): se muestra, no bloquea.
        for (const aviso of entrada.avisos) {
          toast.warning(aviso, { duration: 10000 });
        }
        void navegar('/inventarios/telas/entradas');
      },
      onError: (error: Error) => toast.error(error.message),
    };
    if (idEditar === undefined) {
      crear.mutate(cuerpo, alTerminar);
    } else {
      actualizar.mutate({ id: idEditar, cuerpo }, alTerminar);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4 md:p-5">
      <header className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void navegar('/inventarios/telas/entradas')}
          data-testid="entrada-tela-volver"
        >
          <ArrowLeft aria-hidden /> Entradas
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            {idEditar === undefined ? 'Nueva entrada de tela' : 'Editar entrada de tela'}
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Factura o remisión del proveedor, sin orden de compra · cada renglón es una partida · se
            guarda en borrador y entra al inventario al confirmarla
          </p>
        </div>
      </header>

      {noEditable !== null ? (
        <p
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
          role="alert"
          data-testid="entrada-no-editable"
        >
          Esta entrada está <strong>{noEditable}</strong> y ya no se puede editar (una entrada
          confirmada es inmutable: se cancela y se captura otra). Vuelve a la lista para verla.
        </p>
      ) : null}
      {(existente.data?.avisos ?? []).map((aviso) => (
        <p
          key={aviso}
          className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
          role="status"
          data-testid="entrada-aviso"
        >
          {aviso}
        </p>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Documento del proveedor</CardTitle>
          <CardDescription>
            El número del documento queda en cada partida (así se busca después por factura).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="entrada-tipo">Tipo de documento</FieldLabel>
              <SelectNativo
                id="entrada-tipo"
                value={tipoDocumento}
                onChange={(e) => setTipoDocumento(e.target.value as TipoDocumento)}
                disabled={!editable}
                data-testid="entrada-tipo"
              >
                <option value="factura">Factura</option>
                <option value="remision">Remisión</option>
              </SelectNativo>
            </Field>
            <Field>
              <FieldLabel htmlFor="entrada-numero">Número</FieldLabel>
              <Input
                id="entrada-numero"
                value={numeroDocumento}
                onChange={(e) => setNumeroDocumento(e.target.value)}
                placeholder="Ej. A-10452"
                disabled={!editable}
                data-testid="entrada-numero"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="entrada-proveedor">Proveedor de telas</FieldLabel>
              <SelectNativo
                id="entrada-proveedor"
                value={idProveedor}
                onChange={(e) => setIdProveedor(e.target.value)}
                disabled={!editable}
                data-testid="entrada-proveedor"
              >
                <option value="">Elige el proveedor…</option>
                {proveedorFueraDelFiltro ? (
                  <option value={idProveedor}>{nombreProveedorCargado}</option>
                ) : null}
                {listaProveedores.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.nombre}
                  </option>
                ))}
              </SelectNativo>
              <p className="text-xs text-muted-foreground" data-testid="entrada-proveedor-ayuda">
                Solo proveedores con el rol «Vende telas».
              </p>
            </Field>
            <Field>
              <FieldLabel htmlFor="entrada-fecha">Fecha</FieldLabel>
              <Input
                id="entrada-fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                disabled={!editable}
                data-testid="entrada-fecha"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="entrada-almacen">Almacén destino</FieldLabel>
              <SelectNativo
                id="entrada-almacen"
                value={idAlmacen}
                onChange={(e) => setIdAlmacen(e.target.value)}
                disabled={!editable}
                data-testid="entrada-almacen"
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
              <FieldLabel htmlFor="entrada-obs">Observaciones</FieldLabel>
              <Input
                id="entrada-obs"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                placeholder="Opcional"
                disabled={!editable}
                data-testid="entrada-obs"
              />
            </Field>
          </div>

          <CapturaRenglonesTelaColor
            renglones={renglones}
            onChange={setRenglones}
            soloLectura={!puedeMover}
            conLoteProveedor
            conPrecios
          />

          <div className="flex items-center justify-end gap-3">
            <Button onClick={guardar} disabled={!puedeGuardar} data-testid="entrada-guardar">
              {guardando ? 'Guardando…' : 'Guardar borrador'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
