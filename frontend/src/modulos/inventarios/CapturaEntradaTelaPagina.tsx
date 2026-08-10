import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import {
  useActualizarEntradaTela,
  useCrearEntradaTela,
  useEntradaTela,
  useLeerCfdiEntradaTela,
  type EntradaTelaCrear,
  type PropuestaCfdiEntradaTela,
} from '@/api/entradas-tela';
import { useLineasTelaPendientes } from '@/api/compras-lineas-tela';
import { COD_ROL_PROVEEDOR, useProveedoresPorRol } from '@/api/proveedores';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useSesion } from '@/sesion/useSesion';

import { CapturaRenglonesTelaColor, type RenglonTelaColor } from './CapturaRenglonesTelaColor';
import type { LineaOcPendiente } from './CapturaRenglonesTelaColor';

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
 *
 * §Post-F9.15 — DOS puntos de partida, y el bueno es el segundo:
 *  • **desde cero** (menú): la factura de tela SUELTA, sin orden de compra;
 *  • **desde la ORDEN DE COMPRA** (deep-link `state.idOrdenCompra`, botón "Dar entrada a la tela"):
 *    llega con el PROVEEDOR FIJO —lo define la orden— y con el panel de lo que falta por recibir de
 *    esa OC, de donde se capturan los renglones con un clic. Es lo que pidió Daniel: *"mejor recibir
 *    las telas a partir de las OC. La buscamos ahí y damos la entrada desde allá"*.
 *
 * En ambos casos el buscador de telas se acota a las telas del PROVEEDOR DUEÑO (§Post-F9.15): *"cada
 * proveedor de telas tiene sus telas definidas. No puedo meter una felpa alsatex en el proveedor
 * bloom"*.
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
  /**
   * §Post-F9.20 — propuesta leída del XML de la factura (Daniel: *"que la información la tomes del
   * XML"*). Mientras exista, el panel de captura ofrece los CONCEPTOS DE LA FACTURA en vez de los
   * pendientes de la OC: las cantidades y precios que valen son los que el proveedor facturó.
   */
  const [propuesta, setPropuesta] = useState<PropuestaCfdiEntradaTela | null>(null);
  /**
   * §Post-F9.21 — el CONTENIDO del XML viaja también al GUARDAR: el servidor lo vuelve a parsear
   * (el total fiscal nunca se acepta del cliente), lo guarda y con eso nace la cuenta por pagar al
   * confirmar la entrada.
   */
  const [xmlCfdi, setXmlCfdi] = useState<string | null>(null);

  // DEEP-LINK desde la orden de compra (§Post-F9.15). Se lee UNA vez al montar. El PROVEEDOR viaja
  // en el mismo enlace (la pantalla de la OC ya lo tiene) para no gastar otra consulta en algo que
  // el emisor sabe; y queda FIJO, porque cambiarlo dejaría los renglones ligados a otra orden.
  const location = useLocation();
  const [deepLinkOc] = useState<{ idOrdenCompra: number; idProveedor: number } | null>(() => {
    const state: unknown = location.state;
    if (typeof state !== 'object' || state === null) return null;
    const datos = state as Record<string, unknown>;
    const idOrdenCompra = datos.idOrdenCompra;
    const idProveedor = datos.idProveedor;
    const entero = (v: unknown): v is number =>
      typeof v === 'number' && Number.isInteger(v) && v > 0;
    return entero(idOrdenCompra) && entero(idProveedor) ? { idOrdenCompra, idProveedor } : null;
  });
  const idOcDeepLink = deepLinkOc?.idOrdenCompra ?? null;

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
  // §Post-F9.14 — renglones de OC pendientes de ESTE proveedor, para amarrar cada renglón de la
  // factura a su orden de compra. Sin proveedor elegido todavía no hay nada que ofrecer.
  const lineasOc = useLineasTelaPendientes(
    idProveedor === '' ? undefined : Number(idProveedor),
    idOcDeepLink ?? undefined,
  );
  const existente = useEntradaTela(idEditar);
  const crear = useCrearEntradaTela();
  const actualizar = useActualizarEntradaTela();
  const leerCfdi = useLeerCfdiEntradaTela();

  /**
   * §Post-F9.20 — lee el XML de la factura y llena la captura: proveedor (por RFC), fecha, número de
   * documento y los renglones con la cantidad y el precio que el proveedor FACTURÓ. Lo único que no
   * se puede leer del CFDI es el COLOR, que es justo lo que queda por capturar.
   */
  function alElegirXml(archivo: File | undefined): void {
    if (archivo === undefined) return;
    void archivo.text().then(
      (xml) => {
        leerCfdi.mutate(
          { xml, ...(idOcDeepLink === null ? {} : { idOrdenCompra: idOcDeepLink }) },
          {
            onSuccess: (datos) => {
              setPropuesta(datos);
              setXmlCfdi(xml);
              setTipoDocumento('factura');
              if (datos.numeroDocumento !== '') setNumeroDocumento(datos.numeroDocumento);
              setFecha(datos.fecha);
              // El proveedor solo se toca si NO viene fijo por la orden de compra.
              if (datos.idProveedor !== null && idOcDeepLink === null) {
                setIdProveedor(String(datos.idProveedor));
              }
              for (const aviso of datos.avisos) {
                toast.warning(aviso, { duration: 10000 });
              }
              const conCruce = datos.conceptos.filter((c) => c.sugerencia !== null).length;
              toast.success(
                conCruce > 0
                  ? `Factura leída: ${String(conCruce)} renglón(es) listos para capturar (solo falta el color).`
                  : 'Factura leída. Captura los renglones a mano: no se pudo cruzar ningún concepto.',
              );
            },
            onError: (error) => toast.error(error.message),
          },
        );
      },
      () => toast.error('No se pudo leer el archivo.'),
    );
  }

  /**
   * Lo que el panel de captura ofrece para precargar renglones: los CONCEPTOS de la factura si ya se
   * leyó el XML (con SU cantidad y SU precio — es lo que llegó y lo que se va a pagar), o los
   * pendientes de la orden de compra si se está capturando a mano desde ella (§Post-F9.15).
   */
  const lineasParaCapturar: LineaOcPendiente[] | undefined =
    propuesta !== null
      ? propuesta.conceptos
          .filter((c) => c.sugerencia !== null)
          .map((c) => {
            const s = c.sugerencia as NonNullable<typeof c.sugerencia>;
            return {
              idOrdenCompraLinea: s.idOrdenCompraLinea,
              numCompra: s.numCompra,
              idTela: s.idTela,
              tela: s.tela,
              unidad: s.unidad,
              // La cantidad y el precio salen de la FACTURA, no de lo que faltaba en la orden.
              pendiente: c.cantidad,
              precio: c.valorUnitario,
              nombreComplemento: s.nombreComplemento,
              cantidadComplemento: s.nombreComplemento === null ? null : s.pendienteComplemento,
              pendienteComplemento: s.pendienteComplemento,
            };
          })
      : idOcDeepLink === null
        ? undefined
        : (lineasOc.data ?? []);

  // Llegando DESDE la OC: el proveedor se fija con el de la orden (una vez, sin pisar lo que ya
  // hubiera en un borrador que se esté editando).
  const proveedorDeLaOc = deepLinkOc?.idProveedor;
  useEffect(() => {
    if (proveedorDeLaOc === undefined) return;
    setIdProveedor((actual) => (actual === '' ? String(proveedorDeLaOc) : actual));
  }, [proveedorDeLaOc]);

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
        ...(l.idOrdenCompraLinea === null ? {} : { idOrdenCompraLinea: l.idOrdenCompraLinea }),
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

  // §Post-F9.22 — los dos tipos de proveedor (Daniel, 10-ago-2026): el que factura y el que no. La
  // casilla vive en el catálogo del proveedor y aquí decide el camino. `undefined` (proveedor sin
  // elegir, o fuera de la lista cargada) = no se sabe: se deja el flujo completo, no se esconde nada
  // por una duda.
  const proveedorElegido = listaProveedores.find((p) => String(p.id) === idProveedor);
  const proveedorSinFactura = proveedorElegido?.factura === false;

  // El que no factura no ampara con factura: su documento es remisión. Se corrige aquí para que la
  // pantalla no mande al servidor algo que este va a rechazar.
  useEffect(() => {
    if (proveedorSinFactura) setTipoDocumento('remision');
  }, [proveedorSinFactura]);

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
      // §Post-F9.20: si la captura nació de leer el XML, la entrada recuerda de qué factura salió
      // (y el servidor impide recibir la misma dos veces).
      ...(propuesta === null ? {} : { uuidCfdi: propuesta.uuid }),
      ...(xmlCfdi === null ? {} : { xmlCfdi }),
      idProveedor: Number(idProveedor),
      fecha,
      idAlmacen: Number(idAlmacen),
      ...(observaciones.trim().length > 0 ? { observaciones: observaciones.trim() } : {}),
      lineas: renglones.map((r) => ({
        idTelaColor: r.idTelaColor,
        cantidad: r.cantidad,
        ...(r.nombreComplemento !== null ? { cantidadComplemento: r.cantidadComplemento } : {}),
        ...(r.loteProveedor === undefined ? {} : { loteProveedor: r.loteProveedor }),
        ...(r.idOrdenCompraLinea === undefined ? {} : { idOrdenCompraLinea: r.idOrdenCompraLinea }),
        ...(r.precioUnit === undefined ? {} : { precioUnit: r.precioUnit }),
        ...(r.precioUnitComplemento === undefined
          ? {}
          : { precioUnitComplemento: r.precioUnitComplemento }),
      })),
    };
  }, [
    tipoDocumento,
    numeroDocumento,
    idProveedor,
    fecha,
    idAlmacen,
    observaciones,
    renglones,
    propuesta,
    xmlCfdi,
  ]);

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
          {/* §Post-F9.20 — LEER LA FACTURA. Del XML del CFDI salen exactos el proveedor (por su
              RFC), la fecha, el número y cada concepto con su cantidad y precio; el PDF se sigue
              adjuntando aparte, como referencia para consultar la factura tal cual. */}
          {editable && proveedorSinFactura ? (
            <p
              className="rounded-md border border-input bg-muted/40 p-3 text-xs text-muted-foreground"
              data-testid="entrada-proveedor-sin-factura"
            >
              <strong className="font-medium text-foreground">
                Este proveedor no emite factura.
              </strong>{' '}
              Captura el documento a mano (remisión o nota): no hay XML que leer. Al confirmar la
              entrada se le genera igual su cuenta por pagar, con el importe de los renglones.
            </p>
          ) : null}

          {editable && !proveedorSinFactura ? (
            <div
              className="flex flex-wrap items-center gap-3 rounded-md border border-primary/40 bg-primary-soft p-3"
              data-testid="entrada-leer-cfdi"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Leer la factura (XML)</p>
                <p className="text-xs text-muted-foreground">
                  {propuesta === null
                    ? 'Sube el XML del CFDI y se llenan solos el proveedor, la fecha, el número y los renglones. Solo tendrás que elegir el color.'
                    : `Factura ${propuesta.numeroDocumento === '' ? propuesta.uuid.slice(0, 8) : propuesta.numeroDocumento} leída · ${propuesta.emisorNombre ?? propuesta.emisorRfc} · ${propuesta.conceptos.length} concepto(s).`}
                </p>
              </div>
              <label className="shrink-0">
                <span className="sr-only">Archivo XML de la factura</span>
                <input
                  type="file"
                  accept=".xml,text/xml,application/xml"
                  disabled={leerCfdi.isPending}
                  onChange={(e) => alElegirXml(e.target.files?.[0])}
                  className="block w-full text-xs file:mr-2 file:cursor-pointer file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-xs"
                  data-testid="entrada-xml-archivo"
                />
              </label>
            </div>
          ) : null}

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
                {/* El proveedor que no factura no puede amparar con factura (§Post-F9.22). */}
                {proveedorSinFactura ? null : <option value="factura">Factura</option>}
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
                // Llegando desde la OC el proveedor NO se cambia: lo define la orden.
                disabled={!editable || idOcDeepLink !== null}
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
                {idOcDeepLink === null
                  ? 'Solo proveedores con el rol «Vende telas».'
                  : 'Lo define la orden de compra desde la que entraste.'}
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
            // §Post-F9.15: el panel "Pendiente de la orden de compra" solo tiene sentido llegando
            // desde una OC; en la captura suelta (tela sin orden) no se pinta.
            {...(lineasParaCapturar === undefined ? {} : { lineasOc: lineasParaCapturar })}
            // Y el buscador de telas se acota a las del proveedor DUEÑO.
            {...(idProveedor === '' ? {} : { idProveedorTelas: Number(idProveedor) })}
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
