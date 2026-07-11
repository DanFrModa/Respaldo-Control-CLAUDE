import { AlertTriangle, FileCode2, Upload } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { usePrevisualizarCfdiVenta, useImportarCfdiVenta } from '@/api/cfdi-ventas';
import type {
  CfdiCandidatoPedido,
  CfdiVentaDatos,
  CfdiVentaPrevisualizacion,
  Cliente,
} from '@/api/tipos';
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
import { useSesion } from '@/sesion/useSesion';

import { SelectorCliente } from './SelectorCliente';
import { moneda } from './comun';

/** Etiqueta del tipo de comprobante. */
function etiquetaTipo(tipo: string): string {
  return tipo === 'E' ? 'Egreso (nota de crédito)' : 'Ingreso (factura)';
}

/**
 * IMPORTAR CFDI de VENTA (F9-E4; R12): subir el XML ya timbrado de la venta propia → previsualizar los
 * datos extraídos (emisor, receptor, conceptos, impuestos, total, UUID) + los candidatos de
 * conciliación (cliente por RFC del receptor, pedido por total cercano) → elegir cliente y pedido →
 * confirmar. Al importar nace el cargo FISCAL de CxC por el total del CFDI (I → cargo, E → nota de
 * crédito) y el XML se guarda en R2.
 *
 * Todo el parseo/validación/conciliación es BACKEND (A1); esta pantalla solo orquesta. Gated
 * `cxc.administrar` (el backend re-verifica). Es importación, NO emisión.
 */
export function ImportarCfdiVentaPagina(): React.JSX.Element {
  const navigate = useNavigate();
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('cxc.administrar');

  const [xml, setXml] = useState('');
  const [nombreArchivo, setNombreArchivo] = useState('');
  const [prev, setPrev] = useState<CfdiVentaPrevisualizacion | null>(null);
  const [idCliente, setIdCliente] = useState<number | null>(null);
  const [nombreCliente, setNombreCliente] = useState('');
  const [idPedido, setIdPedido] = useState<number | null>(null);

  const previsualizar = usePrevisualizarCfdiVenta();
  const importarCfdi = useImportarCfdiVenta();
  const ocupado = previsualizar.isPending || importarCfdi.isPending;

  // Los pedidos candidatos son del cliente SUGERIDO (match por RFC). Si el usuario elige otro cliente,
  // no aplican → se ocultan y se limpia la liga.
  const idClienteSugerido = prev?.candidatoCliente?.idCliente ?? null;
  const pedidosAplican = prev !== null && idCliente !== null && idCliente === idClienteSugerido;

  async function alElegirArchivo(archivo: File | undefined): Promise<void> {
    if (archivo === undefined) return;
    try {
      const texto = await archivo.text();
      setXml(texto);
      setNombreArchivo(archivo.name);
      setPrev(null);
      setIdCliente(null);
      setNombreCliente('');
      setIdPedido(null);
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
        setIdCliente(res.candidatoCliente?.idCliente ?? null);
        setNombreCliente(res.candidatoCliente?.nombre ?? '');
        setIdPedido(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  function alSeleccionarCliente(cliente: Cliente): void {
    setIdCliente(cliente.id);
    setNombreCliente(cliente.nombre);
    if (cliente.id !== idClienteSugerido) setIdPedido(null);
  }

  function alImportar(): void {
    if (prev === null || idCliente === null) {
      toast.error('Elige el cliente del CFDI.');
      return;
    }
    importarCfdi.mutate(
      {
        xml,
        idCliente,
        ...(pedidosAplican && idPedido !== null
          ? { refTipo: 'pedido' as const, refId: idPedido }
          : {}),
      },
      {
        onSuccess: (salida) => {
          const tipo = etiquetaTipo(salida.movimiento.origen === 'nota_credito' ? 'E' : 'I');
          toast.success(`CFDI importado (${tipo}). El cargo fiscal quedó en el estado de cuenta.`);
          void navigate('/cxc/estado-cuenta', { state: { idCliente } });
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  if (!puedeAdministrar) {
    return (
      <div className="p-6" data-testid="cfdi-venta-importar">
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No tienes permiso para importar CFDI de venta (requiere administrar CxC).
        </p>
      </div>
    );
  }

  const datos = prev?.datos ?? null;
  const yaImportado = prev?.yaImportado ?? false;

  return (
    <div className="h-full overflow-y-auto space-y-6 p-4 md:p-6" data-testid="cfdi-venta-importar">
      {/* ── Encabezado (page-head sin icono) ─────────────────────────────────── */}
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Importar CFDI de venta
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Sube el XML timbrado de tu venta → concilia con el pedido → el cargo fiscal entra en CxC
            (R12).
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void navigate('/cxc')}
          data-testid="cfdi-venta-volver"
        >
          Volver a CxC
        </Button>
      </header>

      {/* ── Cargar XML ───────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>1 · Cargar el XML</CardTitle>
          <CardDescription>
            Elige el archivo .xml del CFDI 4.0 timbrado de tu venta.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label
            className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center text-sm transition-colors hover:border-primary hover:bg-primary-soft/40"
            data-testid="cfdi-venta-dropzone"
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
              data-testid="cfdi-venta-archivo"
              onChange={(e) => void alElegirArchivo(e.target.files?.[0] ?? undefined)}
            />
          </label>
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={alPrevisualizar}
              disabled={ocupado || xml.trim() === ''}
              data-testid="cfdi-venta-previsualizar"
            >
              Previsualizar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Avisos ───────────────────────────────────────────────────────────── */}
      {prev !== null && prev.avisos.length > 0 ? (
        <div className="space-y-2" data-testid="cfdi-venta-avisos">
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
                Elige el cliente y (opcional) el pedido al que corresponde el CFDI.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field>
                <FieldLabel htmlFor="cfdi-venta-cliente-busqueda">Cliente</FieldLabel>
                <SelectorCliente
                  idSeleccionado={idCliente ?? undefined}
                  alSeleccionar={alSeleccionarCliente}
                  alLimpiar={() => {
                    setIdCliente(null);
                    setNombreCliente('');
                    setIdPedido(null);
                  }}
                  testid="cfdi-venta-cliente"
                />
                {idCliente !== null ? (
                  <p className="text-[12px] text-faint">
                    Se cargará a <b>{nombreCliente}</b>.
                  </p>
                ) : null}
              </Field>

              {pedidosAplican && (prev?.candidatosPedido.length ?? 0) > 0 ? (
                <Field>
                  <FieldLabel htmlFor="cfdi-venta-pedido-ninguno">Pedido (opcional)</FieldLabel>
                  <div className="space-y-1" data-testid="cfdi-venta-pedidos">
                    <OpcionPedido
                      seleccionada={idPedido === null}
                      onSeleccionar={() => setIdPedido(null)}
                      etiqueta="Sin pedido (cargo directo)"
                      testid="cfdi-venta-pedido-ninguno"
                    />
                    {prev?.candidatosPedido.map((p) => (
                      <OpcionPedido
                        key={p.idPedido}
                        seleccionada={idPedido === p.idPedido}
                        onSeleccionar={() => setIdPedido(p.idPedido)}
                        etiqueta={etiquetaPedido(p)}
                        testid={`cfdi-venta-pedido-${p.idPedido}`}
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
                  disabled={ocupado || idCliente === null || yaImportado}
                  data-testid="cfdi-venta-importar-confirmar"
                >
                  Importar a CxC
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

/** Etiqueta de un pedido candidato con su total y diferencia. */
function etiquetaPedido(p: CfdiCandidatoPedido): string {
  const dif = p.diferencia === null ? '' : ` · dif ${moneda(p.diferencia)}`;
  const oc = p.ocCliente ? ` · OC ${p.ocCliente}` : '';
  return `Pedido ${p.folio}${oc}${p.total === null ? '' : ` · ${moneda(p.total)}`}${dif}`;
}

/** Una opción de pedido (radio accesible). */
function OpcionPedido({
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
        name="cfdi-venta-pedido"
        checked={seleccionada}
        onChange={onSeleccionar}
        data-testid={testid}
      />
      <span>{etiqueta}</span>
    </label>
  );
}

/** Tarjeta con los datos fiscales extraídos del CFDI. */
function DatosCfdi({ datos }: { datos: CfdiVentaDatos }): React.JSX.Element {
  return (
    <Card data-testid="cfdi-venta-datos">
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
            <TablaDensa data-testid="cfdi-venta-conceptos">
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
