import { AlertTriangle, FileCode2, Upload } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { usePrevisualizarCfdi, useImportarCfdi } from '@/api/cfdi';
import type { CfdiCandidatoOc, CfdiDatos, CfdiPrevisualizacion, Proveedor } from '@/api/tipos';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';

import { SelectorProveedor } from './SelectorProveedor';
import { moneda } from './comun';

/** Etiqueta del tipo de comprobante. */
function etiquetaTipo(tipo: string): string {
  return tipo === 'E' ? 'Egreso (nota de crédito)' : 'Ingreso (factura)';
}

/**
 * IMPORTAR CFDI de proveedor (F9-E3; R11): subir el XML ya sellado → previsualizar los datos extraídos
 * (emisor, receptor, conceptos, impuestos, total, UUID) + los candidatos de conciliación (proveedor
 * por RFC, OC por total cercano) → elegir proveedor y OC → confirmar. Al importar nace el cargo FISCAL
 * de CxP por el total del CFDI (I → cargo, E → nota de crédito) y el XML se guarda en R2.
 *
 * Todo el parseo/validación/conciliación es BACKEND (A1); esta pantalla solo orquesta. La cierra la CAPA
 * DE RUTA con `cxp.administrar` (`catalogo.ts`, §Post-F9.68): quien no lo tiene NO la ve —ni el botón
 * que lleva aquí ni la pantalla—, en vez de entrar y leer un letrero de permiso. El backend
 * re-verifica igual (A4). Es importación, NO emisión.
 */
export function ImportarCfdiPagina(): React.JSX.Element {
  const navigate = useNavigate();

  const [xml, setXml] = useState('');
  const [nombreArchivo, setNombreArchivo] = useState('');
  const [prev, setPrev] = useState<CfdiPrevisualizacion | null>(null);
  const [idProveedor, setIdProveedor] = useState<number | null>(null);
  const [nombreProveedor, setNombreProveedor] = useState('');
  const [idOc, setIdOc] = useState<number | null>(null);

  const previsualizar = usePrevisualizarCfdi();
  const importarCfdi = useImportarCfdi();
  const ocupado = previsualizar.isPending || importarCfdi.isPending;

  // Las OCs candidatas son del proveedor SUGERIDO (match por RFC). Si el usuario elige otro proveedor,
  // no aplican → se ocultan y se limpia la liga.
  const idProveedorSugerido = prev?.candidatoProveedor?.idProveedor ?? null;
  const ocsAplican = prev !== null && idProveedor !== null && idProveedor === idProveedorSugerido;

  async function alElegirArchivo(archivo: File | undefined): Promise<void> {
    if (archivo === undefined) return;
    try {
      const texto = await archivo.text();
      setXml(texto);
      setNombreArchivo(archivo.name);
      setPrev(null);
      setIdProveedor(null);
      setNombreProveedor('');
      setIdOc(null);
    } catch {
      toast.error('No se pudo leer el archivo.');
    }
  }

  function alPrevisualizar(): void {
    if (xml.trim() === '') {
      toast.error('Carga el XML del CFDI.');
      return;
    }
    previsualizar.mutate(xml, {
      onSuccess: (res) => {
        setPrev(res);
        setIdProveedor(res.candidatoProveedor?.idProveedor ?? null);
        setNombreProveedor(res.candidatoProveedor?.nombre ?? '');
        setIdOc(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  function alSeleccionarProveedor(proveedor: Proveedor): void {
    setIdProveedor(proveedor.id);
    setNombreProveedor(proveedor.nombre);
    if (proveedor.id !== idProveedorSugerido) setIdOc(null);
  }

  function alImportar(): void {
    if (prev === null || idProveedor === null) {
      toast.error('Elige el proveedor del CFDI.');
      return;
    }
    importarCfdi.mutate(
      {
        xml,
        idProveedor,
        ...(ocsAplican && idOc !== null ? { refTipo: 'orden-compra' as const, refId: idOc } : {}),
      },
      {
        onSuccess: (salida) => {
          const tipo = etiquetaTipo(salida.movimiento.origen === 'nota_credito' ? 'E' : 'I');
          toast.success(`CFDI importado (${tipo}). El cargo fiscal quedó en el estado de cuenta.`);
          void navigate('/cxp/estado-cuenta', { state: { idProveedor } });
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const datos = prev?.datos ?? null;
  const yaImportado = prev?.yaImportado ?? false;

  return (
    <div className="h-full overflow-y-auto space-y-6 p-4 md:p-6" data-testid="cfdi-importar">
      {/* ── Encabezado (page-head sin icono) ─────────────────────────────────── */}
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Importar CFDI de proveedor
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Sube el XML sellado del proveedor → concilia con la OC → el cargo fiscal entra en CxP
            (R11).
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void navigate('/cxp')}
          data-testid="cfdi-volver"
        >
          Volver a CxP
        </Button>
      </header>

      {/* ── Cargar XML ───────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>1 · Cargar el XML</CardTitle>
          <CardDescription>
            Elige el archivo .xml del CFDI 4.0 que mandó el proveedor.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label
            className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center text-sm transition-colors hover:border-primary hover:bg-primary-soft/40"
            data-testid="cfdi-dropzone"
          >
            {nombreArchivo === '' ? (
              <>
                <Upload className="size-6 text-muted-foreground" aria-hidden />
                <span className="text-muted-foreground">Elige el XML del CFDI (.xml)</span>
              </>
            ) : (
              <span className="flex items-center gap-2 font-medium">
                <FileCode2 className="size-5 text-primary" aria-hidden />
                {nombreArchivo}
                <span className="text-xs font-normal text-muted-foreground">
                  (clic para cambiar)
                </span>
              </span>
            )}
            <input
              type="file"
              accept=".xml,text/xml,application/xml"
              className="hidden"
              data-testid="cfdi-archivo"
              onChange={(e) => void alElegirArchivo(e.target.files?.[0] ?? undefined)}
            />
          </label>
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={alPrevisualizar}
              disabled={ocupado || xml.trim() === ''}
              data-testid="cfdi-previsualizar"
            >
              Previsualizar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Avisos ───────────────────────────────────────────────────────────── */}
      {prev !== null && prev.avisos.length > 0 ? (
        <div className="space-y-2" data-testid="cfdi-avisos">
          {prev.avisos.map((aviso, i) => (
            <p
              key={i}
              className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12.5px] text-warn-foreground"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
              <span>{aviso}</span>
            </p>
          ))}
        </div>
      ) : null}

      {/* ── Datos del CFDI + conciliación ────────────────────────────────────── */}
      {datos !== null ? (
        <>
          <DatosCfdi datos={datos} />

          <Card>
            <CardHeader>
              <CardTitle>3 · Conciliar y confirmar</CardTitle>
              <CardDescription>
                Elige el proveedor y (opcional) la OC a la que corresponde el CFDI.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field>
                <FieldLabel htmlFor="cfdi-proveedor-busqueda">Proveedor</FieldLabel>
                <SelectorProveedor
                  idSeleccionado={idProveedor ?? undefined}
                  alSeleccionar={alSeleccionarProveedor}
                  alLimpiar={() => {
                    setIdProveedor(null);
                    setNombreProveedor('');
                    setIdOc(null);
                  }}
                  testid="cfdi-proveedor"
                />
                {idProveedor !== null ? (
                  <p className="text-[12px] text-faint">
                    Se cargará a <b>{nombreProveedor}</b>.
                  </p>
                ) : null}
              </Field>

              {ocsAplican && (prev?.candidatosOc.length ?? 0) > 0 ? (
                <Field>
                  <FieldLabel htmlFor="cfdi-oc-ninguna">Orden de compra (opcional)</FieldLabel>
                  <div className="space-y-1" data-testid="cfdi-ocs">
                    <OpcionOc
                      seleccionada={idOc === null}
                      onSeleccionar={() => setIdOc(null)}
                      etiqueta="Sin OC (cargo directo)"
                      testid="cfdi-oc-ninguna"
                    />
                    {prev?.candidatosOc.map((oc) => (
                      <OpcionOc
                        key={oc.idOrdenCompra}
                        seleccionada={idOc === oc.idOrdenCompra}
                        onSeleccionar={() => setIdOc(oc.idOrdenCompra)}
                        etiqueta={etiquetaOc(oc)}
                        testid={`cfdi-oc-${oc.idOrdenCompra}`}
                      />
                    ))}
                  </div>
                </Field>
              ) : null}

              <div className="flex items-center justify-end gap-2">
                {yaImportado ? (
                  <span className="text-[12.5px] text-crit">Este CFDI ya fue importado.</span>
                ) : null}
                <Button
                  type="button"
                  onClick={alImportar}
                  disabled={ocupado || idProveedor === null || yaImportado}
                  data-testid="cfdi-importar-confirmar"
                >
                  Importar a CxP
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

/** Etiqueta de una OC candidata con su total y diferencia. */
function etiquetaOc(oc: CfdiCandidatoOc): string {
  const dif = oc.diferencia === null ? '' : ` · dif ${moneda(oc.diferencia)}`;
  return `OC ${oc.numCompra} · ${oc.estatus}${oc.total === null ? '' : ` · ${moneda(oc.total)}`}${dif}`;
}

/** Una opción de OC (radio accesible). */
function OpcionOc({
  seleccionada,
  onSeleccionar,
  etiqueta,
  testid,
}: {
  seleccionada: boolean;
  onSeleccionar: () => void;
  etiqueta: string;
  testid: string;
}): React.JSX.Element {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-secondary">
      <input
        type="radio"
        name="cfdi-oc"
        checked={seleccionada}
        onChange={onSeleccionar}
        data-testid={testid}
      />
      <span>{etiqueta}</span>
    </label>
  );
}

/** Tarjeta con los datos fiscales extraídos del CFDI. */
function DatosCfdi({ datos }: { datos: CfdiDatos }): React.JSX.Element {
  return (
    <Card data-testid="cfdi-datos">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          2 · Datos del CFDI
          <Badge variant="secondary">{etiquetaTipo(datos.tipoComprobante)}</Badge>
        </CardTitle>
        <CardDescription className="num">UUID {datos.uuid}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Dato
            etiqueta="Emisor"
            valor={datos.emisorNombre ?? datos.emisorRfc}
            pie={datos.emisorRfc}
          />
          <Dato
            etiqueta="Receptor"
            valor={datos.receptorNombre ?? datos.receptorRfc}
            pie={datos.receptorRfc}
          />
          <Dato etiqueta="Fecha" valor={datos.fecha} pie={datos.moneda} />
          <Dato etiqueta="Total" valor={moneda(datos.total)} pie="verdad fiscal" fuerte />
          <Dato etiqueta="Subtotal" valor={moneda(datos.subtotal)} />
          <Dato etiqueta="IVA trasladado" valor={moneda(datos.ivaTrasladado)} />
          <Dato etiqueta="ISR retenido" valor={moneda(datos.isrRetenido)} />
          <Dato etiqueta="IVA retenido" valor={moneda(datos.ivaRetenido)} />
        </div>

        {datos.conceptos.length > 0 ? (
          <div className="overflow-x-auto">
            <TablaDensa data-testid="cfdi-conceptos">
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Descripción</TablaDensaHead>
                  <TablaDensaHead numerica>Cantidad</TablaDensaHead>
                  <TablaDensaHead numerica>V. unitario</TablaDensaHead>
                  <TablaDensaHead numerica>Importe</TablaDensaHead>
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {datos.conceptos.map((c, i) => (
                  <TablaDensaFila key={i}>
                    <TablaDensaCelda>{c.descripcion}</TablaDensaCelda>
                    <TablaDensaCelda numerica>{c.cantidad.toLocaleString('es-MX')}</TablaDensaCelda>
                    <TablaDensaCelda numerica>{moneda(c.valorUnitario)}</TablaDensaCelda>
                    <TablaDensaCelda numerica>{moneda(c.importe)}</TablaDensaCelda>
                  </TablaDensaFila>
                ))}
              </TablaDensaCuerpo>
            </TablaDensa>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Una celda etiqueta/valor. */
function Dato({
  etiqueta,
  valor,
  pie,
  fuerte = false,
}: {
  etiqueta: string;
  valor: string;
  pie?: string;
  fuerte?: boolean;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border bg-card px-3.5 py-2.5">
      <span className="text-xs font-semibold tracking-[0.04em] text-muted-foreground uppercase">
        {etiqueta}
      </span>
      <p className={`mt-0.5 truncate ${fuerte ? 'text-lg font-bold text-primary' : 'font-medium'}`}>
        {valor}
      </p>
      {pie !== undefined ? <p className="num truncate text-[11px] text-faint">{pie}</p> : null}
    </div>
  );
}
