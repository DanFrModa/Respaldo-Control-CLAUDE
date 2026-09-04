import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { FilaCorrida, RenglonCorrida } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { TablaDensaCelda, TablaDensaFila } from '@/components/dominio/TablaDensa';

import { ETIQUETA_FORMA, moneda, montoEditable, textoReferencia } from './comun';

/**
 * ⭐ UN RENGLÓN DE LA PANTALLA DE TRABAJO: el beneficiario, su REFERENCIA al lado, y el campo
 * abierto donde Daniel teclea lo que se le paga esta semana.
 *
 * Es literalmente lo que él dibujó (§Post-F9.189(f)): *«en la pantalla donde están los saldos de
 * todos los proveedores **con un campo abierto a un lado** para capturar lo que se le va a pagar esa
 * semana»*.
 *
 * ⚠️ **La referencia NUNCA llena el campo.** El saldo, lo que espera revisión, lo vencido y lo
 * recibido en la semana están para que él decida, no para proponerle un número: *«yo voy decidiendo
 * los montos a pagar de cada uno. Manualmente»*.
 *
 * El monto se guarda al SALIR del campo (blur) o con Enter, no en cada tecla: son ~150 beneficiarios
 * y una llamada por pulsación haría inusable la pantalla más importante del sistema.
 */
export interface RenglonPagoProps {
  fila: FilaCorrida;
  /** El renglón que este control edita, o `null` si la fila todavía no tiene ninguno. */
  renglon: RenglonCorrida | null;
  /** ¿Se puede capturar? (borrador + permiso de armar). En cerrada/ejecutada va sólo lectura. */
  editable: boolean;
  /** ¿Hay una mutación en vuelo? Deshabilita los controles sin desmontarlos. */
  guardando: boolean;
  /** Guarda el renglón (crea si `renglon` es null, reemplaza si no). */
  onGuardar: (valores: {
    monto: number;
    formaPago: 'efectivo' | 'transferencia';
    idCuenta: number | null;
    concepto: string | null;
    referencia: string | null;
    idRenglon?: number;
  }) => void;
  /** Quita el renglón (sólo cuando ya existe). */
  onEliminar: (idRenglon: number) => void;
}

/** Un renglón de la tabla de trabajo. */
export function RenglonPago({
  fila,
  renglon,
  editable,
  guardando,
  onGuardar,
  onEliminar,
}: RenglonPagoProps): React.JSX.Element {
  // ⭐ El valor del campo sale SÓLO del renglón capturado, nunca de la referencia. La regla vive en
  // `montoEditable` (pura y medible): dentro del componente, el `useEffect` de resincronización la
  // encubría y una mutación que leyera el saldo pasaba en verde.
  const montoServidor = montoEditable(renglon);
  const [monto, setMonto] = useState(montoServidor);
  const formaServidor = renglon?.formaPago ?? fila.formaPagoSugerida;
  const cuentaServidor = renglon?.idCuenta ?? fila.idCuentaSugerida;
  const [forma, setForma] = useState<'efectivo' | 'transferencia'>(formaServidor);
  const [idCuenta, setIdCuenta] = useState<number | null>(cuentaServidor);
  // ⭐ EL CONCEPTO: la explicación del pago. En el archivo real de finanzas es la columna que dice
  // QUÉ se está pagando («Nómina por fuera <fecha>», la compra, el servicio) y sin ella quien hace
  // la transferencia no sabe qué ejecuta. Por eso va en la pantalla, no escondida en un detalle.
  const conceptoServidor = renglon?.concepto ?? '';
  const referenciaServidor = renglon?.referencia ?? '';
  const [concepto, setConcepto] = useState(conceptoServidor);
  const [referencia, setReferencia] = useState(referenciaServidor);

  // Cuando el servidor devuelve la pantalla (tras guardar, cerrar o ejecutar), el control se
  // resincroniza: la autoridad es el servidor, no lo que quedó en el input.
  useEffect(() => {
    setMonto(montoServidor);
    setForma(formaServidor);
    setIdCuenta(cuentaServidor);
    setConcepto(conceptoServidor);
    setReferencia(referenciaServidor);
  }, [montoServidor, formaServidor, cuentaServidor, conceptoServidor, referenciaServidor]);

  // Ojo: `textoDeApoyo` es la REFERENCIA que se enseña al lado (saldo, recibos); `referencia`
  // (de arriba) es el campo capturable con los FOLIOS. Son cosas distintas y por eso no comparten
  // nombre.
  const textoDeApoyo = textoReferencia(fila);
  const cambiado =
    monto !== montoServidor ||
    forma !== formaServidor ||
    idCuenta !== cuentaServidor ||
    concepto !== conceptoServidor ||
    referencia !== referenciaServidor;

  function guardar(): void {
    // ⚠️ `guardando` corta un DOBLE ENVÍO real, no hipotético: al deshabilitar el input mientras la
    // mutación va en vuelo, el navegador dispara `blur` sobre el campo que tenía el foco — y en ese
    // instante el estado local todavía difiere del servidor, así que `cambiado` sigue siendo true.
    // Sin esta línea, ese blur mandaría un SEGUNDO renglón. Y como partir un pago son dos renglones
    // a propósito (§Post-F9.185(e)), el duplicado no lo atraparía ninguna unicidad: se vería como un
    // pago partido que nadie pidió.
    if (!editable || guardando || !cambiado) return;
    const valor = monto.trim() === '' ? 0 : Number(monto);
    if (!Number.isFinite(valor) || valor < 0) return;
    // Efectivo NUNCA lleva cuenta (lo repite el servidor y un CHECK de la base).
    const cuenta = forma === 'efectivo' ? null : idCuenta;
    onGuardar({
      monto: valor,
      formaPago: forma,
      idCuenta: cuenta,
      concepto: concepto.trim() === '' ? null : concepto.trim(),
      referencia: referencia.trim() === '' ? null : referencia.trim(),
      ...(renglon === null ? {} : { idRenglon: renglon.id }),
    });
  }

  return (
    <TablaDensaFila data-testid="corrida-renglon">
      <TablaDensaCelda className="font-medium">
        {fila.nombre}
        {fila.nombreCorto !== null ? (
          <span className="ml-1 text-xs text-muted-foreground">({fila.nombreCorto})</span>
        ) : null}
        {renglon !== null && renglon.aliasCuenta !== null ? (
          <span className="ml-1 text-xs text-muted-foreground">· cuenta {renglon.aliasCuenta}</span>
        ) : null}
      </TablaDensaCelda>

      {/* Referencia: lo que ayuda a decidir, jamás el número que se paga. */}
      <TablaDensaCelda numerica className="text-muted-foreground">
        {fila.origen === 'concepto' ? '' : moneda(fila.saldo)}
      </TablaDensaCelda>
      <TablaDensaCelda className="text-xs text-muted-foreground">{textoDeApoyo}</TablaDensaCelda>

      {/* ⭐ El campo abierto: lo que se le paga esta semana. */}
      <TablaDensaCelda numerica>
        {editable ? (
          <Input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            aria-label={`A pagar a ${fila.nombre}`}
            className="h-8 w-28 text-right tabular-nums"
            value={monto}
            disabled={guardando}
            onChange={(e) => setMonto(e.target.value)}
            onBlur={guardar}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }
            }}
            data-testid="corrida-monto"
          />
        ) : (
          <span className="font-semibold tabular-nums">{moneda(renglon?.monto ?? null)}</span>
        )}
      </TablaDensaCelda>

      {/* ⭐ EL CONCEPTO: lo que finanzas lee para saber QUÉ está pagando. */}
      <TablaDensaCelda>
        {editable ? (
          <Input
            aria-label={`Concepto del pago a ${fila.nombre}`}
            className="h-8 w-64"
            placeholder="Qué se está pagando"
            value={concepto}
            disabled={guardando}
            onChange={(e) => setConcepto(e.target.value)}
            onBlur={guardar}
            data-testid="corrida-concepto-texto"
          />
        ) : (
          <span className="text-xs">{renglon?.concepto ?? ''}</span>
        )}
      </TablaDensaCelda>

      <TablaDensaCelda>
        {editable ? (
          <Input
            aria-label={`Referencia del pago a ${fila.nombre}`}
            className="h-8 w-28"
            placeholder="Folios"
            value={referencia}
            disabled={guardando}
            onChange={(e) => setReferencia(e.target.value)}
            onBlur={guardar}
            data-testid="corrida-referencia"
          />
        ) : (
          <span className="text-xs text-muted-foreground">{renglon?.referencia ?? ''}</span>
        )}
      </TablaDensaCelda>

      <TablaDensaCelda>
        {editable ? (
          <SelectNativo
            aria-label={`Forma de pago de ${fila.nombre}`}
            className="h-8 w-36"
            value={forma}
            disabled={guardando}
            onChange={(e) => {
              const nueva = e.target.value as 'efectivo' | 'transferencia';
              setForma(nueva);
              // Al pasar a transferencia se propone su cuenta por omisión; al pasar a efectivo se
              // suelta la cuenta (el beneficiario pasa a ser el proveedor mismo).
              setIdCuenta(nueva === 'efectivo' ? null : (idCuenta ?? fila.idCuentaSugerida));
            }}
            data-testid="corrida-forma"
          >
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
          </SelectNativo>
        ) : (
          (ETIQUETA_FORMA[renglon?.formaPago ?? ''] ?? '')
        )}
      </TablaDensaCelda>

      <TablaDensaCelda>
        {forma === 'efectivo' ? (
          <span className="text-xs text-muted-foreground">{fila.nombre}</span>
        ) : editable ? (
          <SelectNativo
            aria-label={`Cuenta destino de ${fila.nombre}`}
            className="h-8 w-56"
            value={idCuenta === null ? '' : String(idCuenta)}
            disabled={guardando || fila.cuentas.length === 0}
            onChange={(e) => setIdCuenta(e.target.value === '' ? null : Number(e.target.value))}
            onBlur={guardar}
            data-testid="corrida-cuenta"
          >
            <option value="">
              {fila.cuentas.length === 0 ? 'Sin cuentas capturadas' : 'Elige la cuenta…'}
            </option>
            {fila.cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {[c.beneficiario, c.alias, `•••${c.ultimos4}`, c.esFiscal ? 'fiscal' : null]
                  .filter((x) => x !== null && x !== '')
                  .join(' · ')}
              </option>
            ))}
          </SelectNativo>
        ) : (
          <span className="text-xs text-muted-foreground">
            {[renglon?.beneficiario, renglon?.banco, `•••${renglon?.ultimos4 ?? ''}`]
              .filter((x) => x !== null && x !== undefined && x !== '')
              .join(' · ')}
          </span>
        )}
      </TablaDensaCelda>

      <TablaDensaCelda>
        {editable && renglon !== null ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Quitar el renglón de ${fila.nombre}`}
            disabled={guardando}
            onClick={() => onEliminar(renglon.id)}
            data-testid="corrida-quitar"
          >
            <Trash2 className="size-4" />
          </Button>
        ) : null}
      </TablaDensaCelda>
    </TablaDensaFila>
  );
}
