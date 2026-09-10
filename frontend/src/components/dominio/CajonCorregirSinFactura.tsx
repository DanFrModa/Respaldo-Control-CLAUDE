import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { CajonDetalle } from './CajonDetalle';

/** Lo que el renglón dice de sí mismo cuando se abre para corregirlo. */
export interface ValoresACorregir {
  /**
   * ⭐⭐ El importe GUARDADO del movimiento, que el servidor manda **ya en POSITIVO**
   * (`importeGuardadoDe`) — incluidos los movimientos MIGRADOS, que están guardados en negativo. En
   * un renglón corregible, `null` significa **una sola cosa**: quien mira no puede ver importes.
   *
   * ⚠️ Este cajón **no vuelve a normalizarlo**, y es deliberado: si aplicara su propio `Math.abs`,
   * un servidor que mandara mal el dato se vería bien aquí y el defecto viviría escondido en la
   * pantalla. La positividad se garantiza —y se prueba— donde se decide.
   *
   * 🔴 NO es el `monto` del renglón, y la diferencia era un defecto: `monto` es la *aportación al
   * saldo*, así que lleva signo y viaja vacío también cuando el movimiento **aún no está revisado**
   * —que es, por definición, el caso de lo «capturado por error»—. Arrancando de ahí, el cajón
   * deshabilitaba el importe justo en el caso central de la fila y encima lo explicaba con un
   * mensaje sobre permisos **falso**.
   */
  importeGuardado: number | null;
  /** Fecha del movimiento (YYYY-MM-DD). */
  fecha: string;
  /** Observaciones actuales, o null. */
  observaciones: string | null;
  /** ¿Se le puede cambiar el importe? (`false` en un pago de EsMa ya aplicado a cargos.) */
  importeCorregible: boolean;
}

/** Lo que el cajón manda al guardar (el cuerpo de la corrección). */
export interface CuerpoCorreccion {
  importe?: number;
  fecha?: string;
  observaciones?: string | null;
  motivo: string;
}

/**
 * ⭐⭐ CAJÓN DE CORRECCIÓN de un movimiento SIN FACTURA (fila 0.145; §Post-F9.203).
 *
 * DANIEL: *«Quiero tener manera de modificar cualquier registro que se meta en cualquier estado de
 * cuenta de los proveedores sin factura»* — y sobre la forma: *«Sí, está bien **con rastro**.»*
 *
 * En pantalla se comporta como EDITAR y es **un solo gesto**: se abre el renglón con sus valores, se
 * cambia lo que haga falta, se guarda. Por dentro el servidor anula el viejo y captura el bueno en
 * una transacción, ligados — pero eso no es problema de quien corrige, y por eso el cajón no lo
 * disfraza de «cancelar y volver a capturar». Lo único que sí se le pide de más es el **motivo**,
 * que es la otra mitad del rastro.
 *
 * Lo vive el mismo componente en los DOS estados de cuenta del proveedor —el de CxP y el de
 * maquila— porque el acto es el mismo; lo que cambia es a qué endpoint lo manda cada pantalla.
 *
 * Dos casos que el cajón respeta y no discute, porque los decide el servidor:
 *  • `importeCorregible: false` → el importe se enseña, pero no se toca (un pago de EsMa aplicado a
 *    cargos vale lo que valen las prendas aplicadas). Se dice con todas sus letras, no se esconde.
 *  • `importeGuardado: null` en un renglón corregible → quien mira no puede ver importes; se corrigen
 *    fecha y observaciones y nada más. ⚠️ Ese mensaje **sólo** sale por esa razón: decirlo cuando no
 *    es cierto sería mentirle al usuario sobre sus propios permisos (defecto de la ronda 1).
 *
 * 🔴 Y una regla suya, que no es del servidor: **el importe sólo se valida cuando el usuario propone
 * uno**. Validarlo siempre dejaba el cajón inservible sobre cualquier renglón cuyo importe guardado no
 * fuera mayor que 0 —el ETL de EsMa carga los montos vacíos como **0**—, cortando con un mensaje
 * sobre algo que el usuario ni había tocado. Ver `enviar` y el `min` del campo.
 */
export function CajonCorregirSinFactura({
  valores,
  titulo,
  subtitulo,
  enviando,
  alCerrar,
  alGuardar,
}: {
  /** Valores del renglón, o `null` cuando el cajón está cerrado. */
  valores: ValoresACorregir | null;
  titulo: string;
  subtitulo?: string | undefined;
  enviando: boolean;
  alCerrar: () => void;
  alGuardar: (cuerpo: CuerpoCorreccion) => void;
}): React.JSX.Element {
  const [importe, setImporte] = useState('');
  const [fecha, setFecha] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [motivo, setMotivo] = useState('');

  // Al abrirse (o al cambiar de renglón) el formulario arranca con LO QUE EL RENGLÓN YA DICE: eso es
  // lo que lo hace sentirse una edición y no una captura desde cero.
  const idValores = valores === null ? null : `${String(valores.importeGuardado)}|${valores.fecha}`;
  useEffect(() => {
    if (valores === null) {
      return;
    }
    setImporte(valores.importeGuardado === null ? '' : String(valores.importeGuardado));
    setFecha(valores.fecha);
    setObservaciones(valores.observaciones ?? '');
    setMotivo('');
    // `idValores` identifica el renglón abierto; re-sincronizar en cada render pisaría lo tecleado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idValores]);

  const puedeTocarImporte =
    valores !== null && valores.importeCorregible && valores.importeGuardado !== null;

  function enviar(e: React.FormEvent): void {
    e.preventDefault();
    if (valores === null) {
      return;
    }
    if (motivo.trim() === '') {
      toast.error('Escribe por qué se corrige: queda en la bitácora.');
      return;
    }

    const cuerpo: CuerpoCorreccion = { motivo: motivo.trim() };

    // 🔴 EL IMPORTE SÓLO SE VALIDA CUANDO EL USUARIO PROPONE UNO. Se validaba SIEMPRE, y eso dejaba
    // el cajón inservible sobre todo renglón cuyo importe guardado no fuera mayor que 0: el ETL de
    // EsMa carga un monto vacío como **0** —`migracion/loaders/esma-cargos.ts:545`,
    // `parsearDinero(...) ?? 0`, compartido por abonos, pagos y descuentos— y esos movimientos llegan
    // con `conFactura = null` ⇒ son CORREGIBLES. Con el campo intacto en 0, guardar cortaba
    // con «Captura un importe mayor a 0» **aunque sólo se hubiera cambiado la fecha**, hablando de
    // algo que el usuario ni tocó. La regla que queda: ese mensaje es sobre el importe NUEVO, así que
    // sólo puede salir cuando de verdad hay uno nuevo.
    //
    // ⚠️ Es el GEMELO del defecto del negativo (que se curó en el servidor con `importeGuardadoDe`),
    // y por eso se arregla aquí y no allá: a un 0 no lo endereza ningún `Math.abs`.
    const textoOriginal = valores.importeGuardado === null ? '' : String(valores.importeGuardado);
    if (puedeTocarImporte && importe.trim() !== textoOriginal) {
      const nuevo = Number(importe);
      if (!Number.isFinite(nuevo) || nuevo <= 0) {
        toast.error('Captura un importe mayor a 0.');
        return;
      }
      // Sólo se manda lo que de verdad cambió: así el servidor no recibe «cambios» que no lo son
      // (teclear «500.00» sobre «500» se valida, pero no viaja).
      if (nuevo !== valores.importeGuardado) {
        cuerpo.importe = nuevo;
      }
    }
    if (fecha !== valores.fecha) {
      cuerpo.fecha = fecha;
    }
    const obsNueva = observaciones.trim();
    if (obsNueva !== (valores.observaciones ?? '')) {
      cuerpo.observaciones = obsNueva === '' ? null : obsNueva;
    }

    if (
      cuerpo.importe === undefined &&
      cuerpo.fecha === undefined &&
      cuerpo.observaciones === undefined
    ) {
      toast.error('No cambiaste nada: ajusta el importe, la fecha o las observaciones.');
      return;
    }
    alGuardar(cuerpo);
  }

  return (
    <CajonDetalle
      abierto={valores !== null}
      alCambiarAbierto={(v) => {
        if (!v) alCerrar();
      }}
      titulo={titulo}
      subtitulo={subtitulo}
    >
      <form className="space-y-4" onSubmit={enviar} data-testid="corregir-form">
        <p className="text-sm text-muted-foreground">
          Se guarda el valor corregido y queda el rastro de lo anterior: el movimiento original no
          se borra, se anula con su contra-asiento y este renglón lo sustituye.
        </p>
        <Field>
          <FieldLabel htmlFor="corregir-importe">Importe</FieldLabel>
          <Input
            id="corregir-importe"
            type="number"
            // `min="0"`, no `"0.01"`: el suelo del CAMPO es lo que el dato puede valer
            // legítimamente (el importe guardado es |monto|, y el ETL deja ceros). Con `0.01` un
            // renglón migrado en 0 nacía `:invalid` y el navegador bloqueaba el envío ANTES de que
            // el formulario pudiera decidir nada. Que un importe NUEVO tenga que ser mayor que 0 es
            // una regla de la corrección, y vive en `enviar` (y en el servidor), no en el atributo.
            min="0"
            step="0.01"
            value={importe}
            disabled={!puedeTocarImporte}
            onChange={(e) => setImporte(e.target.value)}
            data-testid="corregir-importe"
          />
          {valores !== null && !valores.importeCorregible ? (
            <p className="text-xs text-muted-foreground">
              Este pago está aplicado a cargos: su importe sale de las prendas aplicadas por el
              precio de cada cargo. Aquí se corrigen la fecha y las observaciones.
            </p>
          ) : null}
          {valores !== null && valores.importeCorregible && valores.importeGuardado === null ? (
            <p className="text-xs text-muted-foreground">
              No tienes permiso para ver importes, así que este no se puede cambiar.
            </p>
          ) : null}
        </Field>
        <Field>
          <FieldLabel htmlFor="corregir-fecha">Fecha</FieldLabel>
          <Input
            id="corregir-fecha"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            data-testid="corregir-fecha"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="corregir-obs">Observaciones</FieldLabel>
          <Input
            id="corregir-obs"
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            data-testid="corregir-obs"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="corregir-motivo">¿Por qué se corrige?</FieldLabel>
          <Input
            id="corregir-motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Queda en la bitácora"
            data-testid="corregir-motivo"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={alCerrar}>
            Cerrar
          </Button>
          <Button type="submit" disabled={enviando} data-testid="corregir-guardar">
            Guardar corrección
          </Button>
        </div>
      </form>
    </CajonDetalle>
  );
}
