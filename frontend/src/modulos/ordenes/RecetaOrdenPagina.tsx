import { ArrowLeft, ClipboardList, ExternalLink } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

import { useRecetaOrden } from '@/api/receta-orden';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import { Button } from '@/components/ui/button';
import { useSesion } from '@/sesion/useSesion';

import { PanelRecetaOrden } from './PanelRecetaOrden';

/**
 * ⭐⭐ V1-E3j — **LA RECETA DE LA ORDEN, EN SU PROPIA PANTALLA** (`/produccion/ordenes/:id/receta`).
 *
 * DE DÓNDE SALE. Daniel probó la 0.005 con una orden real, buscando meterle unos avíos que el modelo
 * había ganado después. El mecanismo funcionaba; **lo que falló fue que no se veía**: el bloque de la
 * receta —dentro del cajón angosto del detalle de la OP— le decía *"la receta de esta orden está
 * vacía"*, y ese mensaje se llevó toda la atención mientras JUSTO DEBAJO estaba el aviso «El modelo
 * ahora lleva X» con su botón. Su petición, textual: *"debería de haber una pantalla especial para ir
 * liberando. Ahí mismo en el cuadrito chiquito no se ve toda la información. Me gustaría que de ese
 * botón te mande a una pantalla más grande con la información más clara."* Y al día siguiente, sobre
 * la bandeja: *"solo está… un botón para liberar todas juntas. No veo dónde pueda ver todo completo e
 * ir liberando una por una."*
 *
 * UNA SOLA PANTALLA, Y ES LA MISMA desde los dos lados (instrucción de Daniel): se llega desde el
 * RESUMEN del detalle de la OP y desde la bandeja «Recetas por liberar», y las dos caen aquí. No hay
 * una vista para cada entrada — eso volvería a partir la lógica en dos copias que se separan.
 *
 * PERMISOS (§Post-F9.68, las tres capas). La gobierna `desarrollo.ver` (ruta declarada en
 * `catalogo.ts`, no `ordenes.ver`: §Post-F9.72 sacó de en medio el permiso sobre la OP entera,
 * *"nadie va a tener permiso de modificar la OP más que yo"*), y editar/firmar exige
 * `desarrollo.administrar`. El backend re-decide las dos cosas (A1).
 *
 * A1: aquí no se calcula NADA. Encabezado, conteos, estado de firma y desalineación vienen armados
 * del servidor en la misma respuesta de la receta.
 */
export function RecetaOrdenPagina(): React.JSX.Element {
  const { id: idParam } = useParams<{ id: string }>();
  const numero = idParam === undefined ? undefined : Number(idParam);
  // ⚠️ `Number('abc')` es NaN, y NaN NO es `undefined`: sin este filtro el hook se daba por
  // habilitado y salía una petición a `/api/ordenes/NaN/receta` mientras la pantalla ya estaba
  // diciendo que la dirección no sirve (hallazgo del reviewer de V1-E3j).
  const idOrden = numero !== undefined && Number.isFinite(numero) ? numero : undefined;
  const navigate = useNavigate();
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('desarrollo.administrar');
  // Volver a la OP exige `ordenes.ver`: sin él no se ofrece un enlace muerto (§Post-F9.68).
  const puedeAbrirLaOrden = tienePermiso('ordenes.ver');

  // MISMA consulta que monta el panel (misma clave de TanStack Query): una sola petición de red,
  // y el encabezado y las tablas no pueden discrepar entre sí.
  const consulta = useRecetaOrden(idOrden);

  const receta = consulta.data;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b bg-background px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex flex-wrap items-center gap-2 text-[21px] leading-tight font-semibold tracking-tight">
              <ClipboardList className="size-5 text-muted-foreground" aria-hidden />
              Receta de la OP {receta === undefined ? '' : receta.folio}
              {receta?.estado === 'cancelada' ? (
                <ChipEstado tono="crit" data-testid="receta-orden-cancelada">
                  Orden cancelada
                </ChipEstado>
              ) : null}
            </h1>
            <p className="text-[12.5px] text-muted-foreground">
              Lo que ESTA orden lleva: telas, avíos y arte, con su consumo, su precio y su firma.
              Sin firmar, ese material no se compra — cortar y producir NO se bloquean.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void navigate('/desarrollo/recetas-por-liberar')}
              data-testid="receta-ir-bandeja"
            >
              <ArrowLeft aria-hidden /> Recetas por liberar
            </Button>
            {puedeAbrirLaOrden && idOrden !== undefined ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void navigate('/produccion/ordenes', { state: { idOrden } })}
                data-testid="receta-ir-orden"
              >
                <ExternalLink aria-hidden /> Ver la orden
              </Button>
            ) : null}
          </div>
        </div>

        {/* ⭐ EL ENCABEZADO DE LA ORDEN — *"para saber en qué OP estás sin volver atrás"*. Viaja en
            la MISMA respuesta de la receta (V1-E3j), no en una segunda llamada que ataría esta
            pantalla a `ordenes.ver`. */}
        {receta === undefined ? null : (
          <dl
            className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4"
            data-testid="receta-encabezado-orden"
          >
            <Dato k="Modelo">{receta.codigoModelo}</Dato>
            <Dato k="Cliente">{receta.cliente}</Dato>
            <Dato k="Cantidad">
              <span className="num">{receta.totalPiezas.toLocaleString('es-MX')}</span> pzas
            </Dato>
            <Dato k="Entrega">{receta.fechaEntrega ?? '—'}</Dato>
          </dl>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        {idOrden === undefined ? (
          <p className="text-sm text-destructive" role="alert" data-testid="receta-orden-invalida">
            La dirección no trae una orden válida.
          </p>
        ) : (
          <PanelRecetaOrden idOrden={idOrden} puedeAdministrar={puedeAdministrar} />
        )}
      </div>
    </div>
  );
}

/** Un dato del encabezado (etiqueta arriba, valor abajo). */
function Dato({ k, children }: { k: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {k}
      </dt>
      <dd className="truncate">{children}</dd>
    </div>
  );
}
