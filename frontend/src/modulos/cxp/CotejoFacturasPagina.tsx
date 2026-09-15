import { AlertTriangle, CheckCircle2, Link2, ShieldCheck } from 'lucide-react';
import { Fragment, useState } from 'react';
import { toast } from 'sonner';

import {
  useAplicarCotejo,
  useAtenderCotejo,
  useBandejaCotejo,
  useDocumentosEmitidos,
} from '@/api/cotejo';
import type { DocumentoEmitido, FacturaCotejo } from '@/api/tipos';
import { ChipsFiltro, type OpcionChip } from '@/components/dominio/ChipsFiltro';
import { KpiTiles, type Kpi } from '@/components/dominio/KpiTiles';
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
import { Input } from '@/components/ui/input';
import { useSesion } from '@/sesion/useSesion';

import { moneda } from './comun';

/** Filtros de la bandeja. */
const CHIPS: OpcionChip<'pendientes' | 'todas'>[] = [
  { valor: 'pendientes', etiqueta: 'Frenan un pago' },
  { valor: 'todas', etiqueta: 'Todas' },
];

/**
 * El CAJÓN de una factura: elegir qué documentos cubre y, si hace falta, atender el descuadre.
 *
 * ⚠️ La lista de documentos se envía COMPLETA (el backend reemplaza las ligas), así que lo que se
 * teclea aquí es el estado final y no un incremento. Los importes se proponen —lo que le queda por
 * cubrir a cada documento, sin pasarse de lo que le falta a la factura— pero se pueden corregir a
 * mano: una factura puede cubrir sólo una parte de un documento (§Post-F9.232 (d), «como venga»).
 */
function CajonFactura({
  factura,
  puedeAdministrar,
}: {
  factura: FacturaCotejo;
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const documentos = useDocumentosEmitidos(factura.idProveedor);
  const aplicar = useAplicarCotejo();
  const atender = useAtenderCotejo();
  const [nota, setNota] = useState('');
  // Lo tecleado por documento, en pesos y como TEXTO (un input numérico vacío no es 0).
  const [importes, setImportes] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      factura.aplicaciones.map((a) => [a.idRenglon, a.importe === null ? '' : String(a.importe)]),
    ),
  );
  const ocupado = aplicar.isPending || atender.isPending;

  const lista = documentos.data?.documentos ?? [];

  /** Lo que quedaría aplicado con lo tecleado ahora mismo. */
  function totalTecleado(): number {
    return Object.values(importes).reduce((s, v) => s + (Number(v) || 0), 0);
  }

  /** Propone el importe de un documento: lo que le falta, sin pasarse de lo que le falta a la factura. */
  function proponer(doc: DocumentoEmitido): void {
    const restaFactura = (factura.total ?? 0) - totalTecleado();
    const propuesto = Math.min(doc.disponible ?? 0, Math.max(restaFactura, 0));
    setImportes((p) => ({ ...p, [doc.idRenglon]: propuesto > 0 ? propuesto.toFixed(2) : '' }));
  }

  function guardar(): void {
    const aplicaciones = Object.entries(importes)
      .map(([id, valor]) => ({ idRenglon: Number(id), importe: Number(valor) }))
      .filter((a) => Number.isFinite(a.importe) && a.importe > 0);
    aplicar.mutate(
      { idMovimiento: factura.idMovimiento, cuerpo: { aplicaciones } },
      {
        onSuccess: () => toast.success('Listo: se actualizó qué documentos cubre esta factura.'),
        onError: (e) => toast.error(e.message),
      },
    );
  }

  return (
    <div className="space-y-3 p-3" data-testid={`cotejo-cajon-${String(factura.idMovimiento)}`}>
      {documentos.isPending ? (
        <p className="text-sm text-muted-foreground">Buscando los documentos que le emitimos…</p>
      ) : lista.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="cotejo-sin-documentos">
          A este proveedor no le hemos emitido ningún documento para facturar. Revisa si la factura
          es suya, o atiéndela explicando de qué es.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <TablaDensa>
            <TablaDensaEncabezado>
              <TablaDensaFila>
                <TablaDensaHead>Documento</TablaDensaHead>
                <TablaDensaHead>Semana</TablaDensaHead>
                <TablaDensaHead>Concepto</TablaDensaHead>
                <TablaDensaHead className="text-right">Total</TablaDensaHead>
                <TablaDensaHead className="text-right">Por cubrir</TablaDensaHead>
                <TablaDensaHead className="text-right">Esta factura cubre</TablaDensaHead>
              </TablaDensaFila>
            </TablaDensaEncabezado>
            <TablaDensaCuerpo>
              {lista.map((doc) => (
                <TablaDensaFila key={doc.idRenglon}>
                  <TablaDensaCelda>#{doc.folioDocumento}</TablaDensaCelda>
                  <TablaDensaCelda>{doc.semana}</TablaDensaCelda>
                  <TablaDensaCelda>{doc.concepto}</TablaDensaCelda>
                  <TablaDensaCelda className="text-right">{moneda(doc.total)}</TablaDensaCelda>
                  <TablaDensaCelda className="text-right">{moneda(doc.disponible)}</TablaDensaCelda>
                  <TablaDensaCelda className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="w-28 text-right"
                        aria-label={`Importe cubierto del documento ${String(doc.folioDocumento)}`}
                        data-testid={`cotejo-importe-${String(doc.idRenglon)}`}
                        disabled={!puedeAdministrar || ocupado}
                        value={importes[doc.idRenglon] ?? ''}
                        onChange={(e) =>
                          setImportes((p) => ({ ...p, [doc.idRenglon]: e.target.value }))
                        }
                      />
                      {puedeAdministrar ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={ocupado}
                          onClick={() => proponer(doc)}
                          data-testid={`cotejo-proponer-${String(doc.idRenglon)}`}
                        >
                          Todo
                        </Button>
                      ) : null}
                    </div>
                  </TablaDensaCelda>
                </TablaDensaFila>
              ))}
            </TablaDensaCuerpo>
          </TablaDensa>
        </div>
      )}

      {puedeAdministrar ? (
        <div className="flex flex-wrap items-end gap-3">
          <Button
            type="button"
            size="sm"
            disabled={ocupado || lista.length === 0}
            onClick={guardar}
            data-testid={`cotejo-guardar-${String(factura.idMovimiento)}`}
          >
            <Link2 className="size-4" /> Guardar lo que cubre
          </Button>

          {factura.frenaElPago ? (
            <div className="flex flex-1 flex-wrap items-end gap-2">
              <Field className="min-w-60 flex-1">
                <FieldLabel htmlFor={`nota-${String(factura.idMovimiento)}`}>
                  …o explica la diferencia y déjala atendida
                </FieldLabel>
                <Input
                  id={`nota-${String(factura.idMovimiento)}`}
                  value={nota}
                  disabled={ocupado}
                  placeholder="Por qué se acepta esta diferencia"
                  onChange={(e) => setNota(e.target.value)}
                  data-testid={`cotejo-nota-${String(factura.idMovimiento)}`}
                />
              </Field>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={ocupado || nota.trim().length < 3}
                onClick={() =>
                  atender.mutate(
                    { idMovimiento: factura.idMovimiento, cuerpo: { nota: nota.trim() } },
                    {
                      onSuccess: () => toast.success('Atendida: ya no frena el pago.'),
                      onError: (e) => toast.error(e.message),
                    },
                  )
                }
                data-testid={`cotejo-atender-${String(factura.idMovimiento)}`}
              >
                <ShieldCheck className="size-4" /> Atender
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * ⭐ COTEJO DE FACTURAS — la factura del proveedor contra el documento que nosotros le emitimos
 * (fila 0.117; §Post-F9.232).
 *
 * Daniel revisaba esto a mano, factura por factura. Aquí sale solo: cada CFDI que entra sin orden de
 * compra se compara con los documentos para facturar que le mandamos, **al peso** (un peso fijo de
 * tolerancia, decisión (b)). La que no cuadra **entra igual, marcada y en ROJO**, y mientras esté
 * así a ese proveedor **no se le puede ejecutar la relación con factura** — hasta que alguien le
 * ligue los documentos que cubre o explique la diferencia (decisión (c)).
 *
 * Todo el veredicto lo calcula el SERVIDOR (A1): la pantalla no compara importes ni decide qué es
 * rojo, sólo lo pinta. Lectura con `cxp.ver`; ligar y atender, con `cxp.administrar`.
 */
export function CotejoFacturasPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('cxp.administrar');
  const [filtro, setFiltro] = useState<'pendientes' | 'todas'>('pendientes');
  const [abierta, setAbierta] = useState<number | null>(null);

  const bandeja = useBandejaCotejo({ filtro });
  const facturas = bandeja.data?.facturas ?? [];

  const kpis: Kpi[] = [
    {
      clave: 'en-rojo',
      etiqueta: 'FRENAN UN PAGO',
      valor: String(bandeja.data?.enRojo ?? 0),
      pie: 'en rojo y sin atender',
    },
    { clave: 'total', etiqueta: 'FACTURAS EN LA LISTA', valor: String(facturas.length) },
    {
      clave: 'tolerancia',
      etiqueta: 'SE ACEPTA HASTA',
      valor: moneda(bandeja.data?.toleranciaPesos ?? null),
      // El número lo manda el SERVIDOR: la pantalla nunca escribe «$1» por su cuenta, que es como
      // una tolerancia acaba diciendo dos cosas distintas en dos sitios.
      pie: 'de diferencia',
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Cotejo de facturas</CardTitle>
          <CardDescription>
            Cada factura que entra sin orden de compra se compara con los documentos para facturar
            que le mandamos al proveedor. La que no cuadra se queda en rojo y no se le puede pagar
            hasta que alguien la atienda.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <KpiTiles kpis={kpis} />
          <ChipsFiltro
            etiqueta="Qué facturas ver"
            opciones={CHIPS}
            valor={filtro}
            alCambiar={setFiltro}
          />

          {bandeja.isPending ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : facturas.length === 0 ? (
            <p
              className="flex items-center gap-2 text-sm text-muted-foreground"
              data-testid="cotejo-vacio"
            >
              <CheckCircle2 className="size-4 text-ok" />
              {filtro === 'pendientes'
                ? 'Ninguna factura está frenando un pago.'
                : 'Todavía no hay facturas sujetas a cotejo.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <TablaDensa>
                <TablaDensaEncabezado>
                  <TablaDensaFila>
                    <TablaDensaHead>Folio</TablaDensaHead>
                    <TablaDensaHead>Fecha</TablaDensaHead>
                    <TablaDensaHead>Proveedor</TablaDensaHead>
                    <TablaDensaHead className="text-right">Factura</TablaDensaHead>
                    <TablaDensaHead className="text-right">Amparado</TablaDensaHead>
                    <TablaDensaHead className="text-right">Diferencia</TablaDensaHead>
                    <TablaDensaHead>Estado</TablaDensaHead>
                    <TablaDensaHead />
                  </TablaDensaFila>
                </TablaDensaEncabezado>
                <TablaDensaCuerpo>
                  {facturas.map((f) => (
                    <Fragment key={f.idMovimiento}>
                      <TablaDensaFila data-testid={`cotejo-fila-${String(f.idMovimiento)}`}>
                        <TablaDensaCelda>{f.folio}</TablaDensaCelda>
                        <TablaDensaCelda>{f.fecha}</TablaDensaCelda>
                        <TablaDensaCelda>{f.proveedor}</TablaDensaCelda>
                        <TablaDensaCelda className="text-right">{moneda(f.total)}</TablaDensaCelda>
                        <TablaDensaCelda className="text-right">
                          {moneda(f.aplicado)}
                        </TablaDensaCelda>
                        <TablaDensaCelda className="text-right">
                          {moneda(f.diferencia)}
                        </TablaDensaCelda>
                        <TablaDensaCelda>
                          {f.frenaElPago ? (
                            <Badge variant="destructive" className="gap-1">
                              <AlertTriangle className="size-3" /> No cuadra
                            </Badge>
                          ) : f.atendida ? (
                            <Badge variant="outline" title={f.nota ?? undefined}>
                              Atendida
                            </Badge>
                          ) : (
                            <Badge variant="outline">Cuadra</Badge>
                          )}
                        </TablaDensaCelda>
                        <TablaDensaCelda>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setAbierta((p) => (p === f.idMovimiento ? null : f.idMovimiento))
                            }
                            data-testid={`cotejo-abrir-${String(f.idMovimiento)}`}
                          >
                            {abierta === f.idMovimiento ? 'Cerrar' : 'Revisar'}
                          </Button>
                        </TablaDensaCelda>
                      </TablaDensaFila>
                      {abierta === f.idMovimiento ? (
                        <TablaDensaFila>
                          <TablaDensaCelda colSpan={8} className="bg-primary-soft/40 p-0">
                            <CajonFactura factura={f} puedeAdministrar={puedeAdministrar} />
                          </TablaDensaCelda>
                        </TablaDensaFila>
                      ) : null}
                    </Fragment>
                  ))}
                </TablaDensaCuerpo>
              </TablaDensa>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
