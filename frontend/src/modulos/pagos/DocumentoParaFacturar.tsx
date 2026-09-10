import { FileTextIcon } from 'lucide-react';

import { imprimirDocumentoFacturacion, useDocumentoFacturacion } from '@/api/pagos';
import type { ConcentradoRenglon, DocumentoParaFacturar as Documento } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { moneda } from './comun';

/**
 * ⭐ EL DOCUMENTO PARA FACTURAR (fila 0.118, §Post-F9.186(k)).
 *
 * Daniel: *«Nadie me factura si no le mando yo un documento con los datos con los que me tiene que
 * facturar… no al revés.»* Es lo que su cliente le hace a él, y ahora sale del sistema.
 *
 * Dos piezas:
 *  • {@link BotonDocumentoFacturar} — el botón de cada renglón de la relación ejecutable. Si el
 *    renglón NO es facturable sale **deshabilitado, con el motivo y los faltantes a la vista**: el
 *    aviso viene ya redactado del servidor (el concentrado lo trae por renglón), así que la pantalla
 *    no inventa ni una palabra.
 *  • {@link DialogoDocumentoFacturar} — lo que se ve antes de imprimir: los dos lados, el concepto y
 *    el IVA **explícito**. Se mira, se comprueba, y de ahí sale el PDF.
 *
 * ⚠️ El número de cuenta NO aparece por ningún lado: el documento se le manda al proveedor, y sus
 * datos bancarios (o los nuestros) no tienen nada que hacer ahí. Eso vive en la relación ejecutable.
 */

/** Un renglón etiqueta/valor del cuadro de una de las dos partes. */
function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-xs text-muted-foreground">{etiqueta}</span>
      <span className="text-right text-[13px] font-medium">{valor}</span>
    </div>
  );
}

/** El cuadro de una de las dos partes (quién factura / a quién se le factura). */
function Parte({
  titulo,
  parte,
  extra,
}: {
  titulo: string;
  parte: NonNullable<Documento['documento']>['emisor'];
  extra?: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="rounded-md border p-3">
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">{titulo}</h4>
      <Dato etiqueta="Razón social" valor={parte.razonSocial} />
      <Dato etiqueta="RFC" valor={parte.rfc} />
      <Dato etiqueta="Régimen fiscal" valor={parte.regimenFiscalSat} />
      <Dato etiqueta="Código postal" valor={parte.codigoPostal} />
      {extra}
    </section>
  );
}

/** El cuerpo del diálogo cuando el documento SÍ se emite. */
function Emitido({
  doc,
  idCorrida,
  idRenglon,
}: {
  doc: NonNullable<Documento['documento']>;
  idCorrida: number;
  idRenglon: number;
}): React.JSX.Element {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2" data-testid="documento-facturar-partes">
        <Parte titulo="Emisor — quien factura" parte={doc.emisor} />
        <Parte
          titulo="Receptor — a quien se factura"
          parte={doc.receptor}
          extra={
            <Dato
              etiqueta="Uso de CFDI"
              valor={doc.usoCfdiSugerido ? `${doc.usoCfdi} (sugerido)` : doc.usoCfdi}
            />
          }
        />
      </div>

      <div className="mt-3 space-y-1 rounded-md border p-3">
        <Dato etiqueta="Concepto" valor={doc.concepto} />
        {doc.referencia === null ? null : <Dato etiqueta="Referencia" valor={doc.referencia} />}
        <Dato etiqueta="Forma de pago" valor={`${doc.formaPagoSat} ${doc.formaPagoTexto}`} />
        <Dato etiqueta="Método de pago" valor={`${doc.metodoPagoSat} ${doc.metodoPagoTexto}`} />
        <Dato etiqueta="Moneda" valor={doc.moneda} />
      </div>

      {/* ⭐ El IVA EXPLÍCITO: los tres números, y sumando. No escondido dentro del total. */}
      <div
        className="mt-3 space-y-1 rounded-md border bg-primary-soft p-3"
        data-testid="documento-facturar-importes"
      >
        <Dato etiqueta="Subtotal" valor={moneda(doc.subtotal)} />
        <Dato etiqueta={`IVA trasladado ${doc.tasaIvaTexto}`} valor={moneda(doc.iva)} />
        <div className="flex items-baseline justify-between gap-3 border-t pt-1">
          <span className="text-sm font-semibold">Total a facturar</span>
          <span className="text-base font-semibold tabular-nums">{moneda(doc.total)}</span>
        </div>
      </div>

      <DialogFooter className="mt-4">
        <Button
          type="button"
          onClick={() => {
            imprimirDocumentoFacturacion(idCorrida, idRenglon);
          }}
          data-testid="documento-facturar-pdf"
        >
          <FileTextIcon aria-hidden />
          Abrir PDF para mandarlo
        </Button>
      </DialogFooter>
    </>
  );
}

/** El cuerpo del diálogo cuando NO se emite: el motivo y, si aplica, qué falta y de quién. */
function NoEmitido({ salida }: { salida: Documento }): React.JSX.Element {
  return (
    <div className="space-y-2" role="alert" data-testid="documento-facturar-no-emitido">
      <p className="text-sm">{salida.motivoTexto ?? 'Este renglón no produce documento.'}</p>
      {salida.faltantes.length === 0 ? null : (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {salida.faltantes.map((f) => (
            <li key={`${f.quien}-${f.campo}`}>{f.texto}</li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Ningún dato fiscal se inventa: mientras falte alguno, el documento no sale.
      </p>
    </div>
  );
}

/** Props del diálogo del documento. */
export interface DialogoDocumentoFacturarProps {
  idCorrida: number;
  /** Renglón a mostrar, o `null` cuando no hay ninguno abierto. */
  idRenglon: number | null;
  alCerrar: () => void;
}

/** El documento de un pago, en pantalla, antes de imprimirlo. */
export function DialogoDocumentoFacturar({
  idCorrida,
  idRenglon,
  alCerrar,
}: DialogoDocumentoFacturarProps): React.JSX.Element {
  const consulta = useDocumentoFacturacion(idCorrida, idRenglon, idRenglon !== null);
  const salida = consulta.data;

  return (
    <Dialog
      open={idRenglon !== null}
      onOpenChange={(abierto) => {
        if (!abierto) alCerrar();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Documento para facturar</DialogTitle>
          <DialogDescription>
            Los datos con los que el proveedor debe emitir su factura de este pago.
          </DialogDescription>
        </DialogHeader>

        {consulta.isPending ? (
          <p className="text-sm text-muted-foreground">Armando el documento…</p>
        ) : consulta.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {consulta.error.message}
          </p>
        ) : salida === undefined ? null : salida.documento === null ? (
          <NoEmitido salida={salida} />
        ) : (
          // `idRenglon as number`: aquí no puede ser null — el diálogo sólo está abierto (`open`)
          // cuando lo trae, y la consulta que produjo `salida` va `enabled` por esa misma condición.
          <Emitido doc={salida.documento} idCorrida={idCorrida} idRenglon={idRenglon as number} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Props del botón por renglón. */
export interface BotonDocumentoFacturarProps {
  renglon: ConcentradoRenglon;
  alAbrir: (idRenglon: number) => void;
}

/**
 * El botón de un renglón. Deshabilitado cuando no hay documento que emitir, con el motivo y los
 * faltantes en el `title` (que es lo que el navegador enseña al pasar por encima — un tooltip de
 * Radix no se dispara sobre un botón deshabilitado).
 */
export function BotonDocumentoFacturar({
  renglon,
  alAbrir,
}: BotonDocumentoFacturarProps): React.JSX.Element {
  const { facturable, motivoTexto, faltantes } = renglon.facturacion;
  const aviso = [motivoTexto ?? '', ...faltantes.map((f) => f.texto)].filter(Boolean).join(' · ');
  return (
    <span title={facturable ? 'Ver el documento para facturar de este pago' : aviso}>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={!facturable}
        onClick={() => {
          alAbrir(renglon.id);
        }}
        data-testid="boton-documento-facturar"
        aria-label={
          facturable
            ? `Documento para facturar de ${renglon.nombre}`
            : `No se puede facturar ${renglon.nombre}: ${aviso}`
        }
      >
        <FileTextIcon aria-hidden />
        Facturar
      </Button>
    </span>
  );
}
