import { Archive, ArchiveRestore, Loader2Icon, Pencil, Plus, Star, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useActualizarCuentaPagoProveedor,
  useCrearCuentaPagoProveedor,
  useCuentasPagoProveedor,
} from '@/api/proveedores';
import type { ProveedorCuentaPago, ProveedorCuentaPagoEditar } from '@/api/tipos';
import { TipoBadge } from '@/components/dominio/visuales';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

import {
  etiquetaTipoCuenta,
  motivoCuentaInvalida,
  numeroLegible,
  type TipoCuenta,
} from './cuentas-pago';

/**
 * EDITOR de las CUENTAS / DESTINOS DE PAGO de un proveedor (0.112).
 *
 * 🔒 Los nombres del ejemplo son INVENTADOS: los reales son personas físicas y el repo es PÚBLICO
 * (fila 0.123). No los "restaures".
 *
 * 🔴 Nació de leer el Excel con el que Daniel paga cada semana: **el beneficiario casi nunca es el
 * proveedor** («TALLER NORTE 1» se deposita a otra persona) y **«TALLER NORTE 1 / 2 / 3» no son
 * tres proveedores: es uno con tres cuentas**, partido en tres renglones porque Excel no sabe
 * modelar otra cosa. Daniel: *«Estaría bien poder tener más de una cuenta, definir una como default,
 * pero tener las demás como historial de cuentas, para poder reutilizarlas.»*
 *
 * Vive dentro del diálogo del proveedor y sólo en EDICIÓN (necesita el id, igual que contactos y
 * adjuntos). Cada alta/cambio/promoción/retiro es su propia llamada al API —no viaja en el cuerpo
 * del proveedor—, así que no depende de que se guarde el formulario.
 *
 * ⭐ **UNA SOLA FUENTE DE VERDAD, y es FRESCA.** Todas las cuentas (activas y retiradas) salen de
 * `useCuentasPagoProveedor`, que las mutaciones invalidan. El `cuentasPago` de la ficha entra sólo
 * como semilla mientras carga, para que no parpadee. Antes la lista activa venía de la ficha —una
 * FOTO CONGELADA del momento en que se abrió el diálogo— y el historial de una consulta fresca: al
 * retirar una cuenta con el historial desplegado, la misma cuenta se pintaba **a la vez** como
 * activa y como retirada, y capturando 150 no había forma de ver qué llevabas.
 *
 * ⭐ **Se puede EDITAR lo capturado.** El beneficiario es el nombre que va en la transferencia y se
 * teclean ~150 en un día: los errores de dedo son certeza. Sin editar, el callejón era sin salida —
 * retirar la cuenta **no libera su número** (`@@unique(idProveedor, cuenta)`), así que recapturarla
 * rebotaba y reactivarla la devolvía con el nombre mal.
 *
 * Nada se BORRA (D3): retirar deja la cuenta como HISTORIAL REUTILIZABLE y se puede revivir.
 * Presentación pura (A1): el backend valida el número, decide la default y es la autoridad.
 */
export function EditorCuentasPagoProveedor({
  idProveedor,
  cuentas,
  nombreProveedor,
}: {
  idProveedor: number;
  /** Cuentas ACTIVAS de la ficha. SEMILLA mientras carga la consulta propia, no la fuente. */
  cuentas: ProveedorCuentaPago[];
  /** Nombre del proveedor: sólo como sugerencia del beneficiario (que casi nunca coincide). */
  nombreProveedor: string;
}): React.JSX.Element {
  const crear = useCrearCuentaPagoProveedor();
  const actualizar = useActualizarCuentaPagoProveedor();
  const consulta = useCuentasPagoProveedor(idProveedor);
  const [verHistorial, setVerHistorial] = useState(false);
  const ocupado = crear.isPending || actualizar.isPending;

  /** Activas y retiradas salen del MISMO arreglo: una cuenta no puede aparecer en las dos. */
  const todas = consulta.data ?? cuentas;
  const activas = todas.filter((c) => c.activo);
  const retiradas = todas.filter((c) => !c.activo);

  /** Cuenta que se está editando (`null` = el formulario está en modo ALTA). */
  const [editando, setEditando] = useState<ProveedorCuentaPago | null>(null);
  const [beneficiario, setBeneficiario] = useState('');
  const [alias, setAlias] = useState('');
  const [banco, setBanco] = useState('');
  const [tipoCuenta, setTipoCuenta] = useState<TipoCuenta>('clabe');
  const [cuenta, setCuenta] = useState('');
  const [esFiscal, setEsFiscal] = useState(false);
  const [notas, setNotas] = useState('');
  const [error, setError] = useState<string | null>(null);

  function limpiar(): void {
    setEditando(null);
    setBeneficiario('');
    setAlias('');
    setBanco('');
    setTipoCuenta('clabe');
    setCuenta('');
    setEsFiscal(false);
    setNotas('');
    setError(null);
  }

  /** Carga una cuenta en el formulario para corregirla (el mismo formulario, en modo edición). */
  function editar(c: ProveedorCuentaPago): void {
    setEditando(c);
    setBeneficiario(c.beneficiario);
    setAlias(c.alias ?? '');
    setBanco(c.banco ?? '');
    setTipoCuenta(c.tipoCuenta);
    setCuenta(c.cuenta);
    setEsFiscal(c.esFiscal);
    setNotas(c.notas ?? '');
    setError(null);
  }

  /** Reglas de captura (cortesía, NO la autoridad: el backend revalida y manda, A1). */
  function revisarCaptura(): string | null {
    if (beneficiario.trim() === '') {
      return 'Escribe a nombre de quién está la cuenta.';
    }
    return motivoCuentaInvalida(tipoCuenta, cuenta);
  }

  function guardar(): void {
    const motivo = revisarCaptura();
    if (motivo !== null) {
      setError(motivo);
      return;
    }
    setError(null);

    if (editando !== null) {
      // PATCH con los SIETE campos: los opcionales vacíos viajan como `null` para poder BORRARLOS
      // (en un PATCH parcial, omitirlos significaría "no tocar" y nunca se podrían vaciar).
      const cuerpo: ProveedorCuentaPagoEditar = {
        beneficiario: beneficiario.trim(),
        tipoCuenta,
        cuenta: cuenta.trim(),
        esFiscal,
        alias: alias.trim() === '' ? null : alias.trim(),
        banco: banco.trim() === '' ? null : banco.trim(),
        notas: notas.trim() === '' ? null : notas.trim(),
      };
      actualizar.mutate(
        { id: idProveedor, idCuenta: editando.id, cuerpo },
        {
          onSuccess: (c) => {
            toast.success(`Cuenta de "${c.beneficiario}" actualizada.`);
            limpiar();
          },
          onError: (e) => setError(e.message),
        },
      );
      return;
    }

    crear.mutate(
      {
        id: idProveedor,
        cuerpo: {
          beneficiario: beneficiario.trim(),
          tipoCuenta,
          cuenta: cuenta.trim(),
          esFiscal,
          ...(alias.trim() === '' ? {} : { alias: alias.trim() }),
          ...(banco.trim() === '' ? {} : { banco: banco.trim() }),
          ...(notas.trim() === '' ? {} : { notas: notas.trim() }),
        },
      },
      {
        onSuccess: (c) => {
          toast.success(`Cuenta de "${c.beneficiario}" agregada.`);
          limpiar();
        },
        onError: (e) => setError(e.message),
      },
    );
  }

  function cambiar(
    c: ProveedorCuentaPago,
    cuerpo: ProveedorCuentaPagoEditar,
    exito: string,
    aviso?: string,
  ): void {
    actualizar.mutate(
      { id: idProveedor, idCuenta: c.id, cuerpo },
      {
        onSuccess: () => {
          toast.success(exito);
          if (aviso !== undefined) {
            toast.warning(aviso);
          }
          // Si se estaba editando justo esa cuenta, el formulario ya no aplica.
          if (editando?.id === c.id) {
            limpiar();
          }
        },
        onError: (e) => toast.error(e.message),
      },
    );
  }

  function retirar(c: ProveedorCuentaPago): void {
    // R2: retirar la cuenta por omisión deja al proveedor SIN una, y eso hay que decirlo — el
    // backend a propósito NO promueve a nadie solo (elegir a ciegas es cómo un pago sale mal).
    const aviso = c.esDefault
      ? 'Era la cuenta por omisión: el proveedor se quedó sin una. Marca otra con la estrella.'
      : undefined;
    cambiar(c, { activo: false }, `Cuenta de "${c.beneficiario}" retirada.`, aviso);
  }

  return (
    <div className="space-y-3" data-testid="editor-cuentas-pago">
      {activas.length === 0 ? (
        <FieldDescription data-testid="sin-cuentas-pago">
          Todavía no hay cuentas. Agrega a nombre de quién se deposita —que casi nunca es el mismo
          proveedor— y su CLABE o tarjeta. La primera queda como cuenta por omisión.
        </FieldDescription>
      ) : (
        <ul className="divide-y rounded-lg border">
          {activas.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-2 px-3 py-2"
              data-testid="cuenta-pago-proveedor"
            >
              <RenglonCuenta cuenta={c} />
              <div className="flex shrink-0 items-center gap-1">
                {c.esDefault ? null : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={ocupado}
                    onClick={() =>
                      cambiar(
                        c,
                        { esDefault: true },
                        `"${c.beneficiario}" quedó como cuenta por omisión.`,
                      )
                    }
                    aria-label={`Dejar la cuenta de ${c.beneficiario} por omisión`}
                    data-testid="usar-cuenta-por-omision"
                  >
                    <Star aria-hidden />
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={ocupado}
                  onClick={() => editar(c)}
                  aria-label={`Editar la cuenta de ${c.beneficiario}`}
                  data-testid="editar-cuenta-pago"
                >
                  <Pencil aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={ocupado}
                  onClick={() => retirar(c)}
                  aria-label={`Retirar la cuenta de ${c.beneficiario}`}
                  data-testid="retirar-cuenta-pago"
                >
                  <Archive aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ── Historial reutilizable: las retiradas no se borraron (D3) ─────────── */}
      <div className="space-y-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setVerHistorial((v) => !v)}
          data-testid="ver-historial-cuentas"
        >
          {verHistorial ? 'Ocultar cuentas retiradas' : 'Ver cuentas retiradas (historial)'}
        </Button>

        {verHistorial ? (
          retiradas.length === 0 ? (
            <FieldDescription data-testid="sin-cuentas-retiradas">
              No hay cuentas retiradas.
            </FieldDescription>
          ) : (
            <ul className="divide-y rounded-lg border border-dashed">
              {retiradas.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 opacity-70"
                  data-testid="cuenta-pago-retirada"
                >
                  <RenglonCuenta cuenta={c} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={ocupado}
                    onClick={() =>
                      cambiar(c, { activo: true }, `Cuenta de "${c.beneficiario}" reactivada.`)
                    }
                    aria-label={`Reactivar la cuenta de ${c.beneficiario}`}
                    data-testid="reactivar-cuenta-pago"
                  >
                    <ArchiveRestore aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>

      {/* ── Alta / edición: el MISMO formulario, con `editando` como interruptor ── */}
      <div className="space-y-2 rounded-lg border p-3" data-testid="formulario-cuenta-pago">
        <p className="text-sm font-medium" data-testid="titulo-formulario-cuenta">
          {editando === null ? 'Agregar una cuenta' : `Editando: ${editando.beneficiario}`}
        </p>

        <div className="grid gap-2 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="cuenta-beneficiario" required>
              Beneficiario
            </FieldLabel>
            <Input
              id="cuenta-beneficiario"
              placeholder={nombreProveedor}
              value={beneficiario}
              disabled={ocupado}
              onChange={(e) => setBeneficiario(e.target.value)}
              data-testid="cuenta-beneficiario"
            />
            <FieldDescription>
              A nombre de quién se deposita. Casi nunca es el nombre del proveedor.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="cuenta-alias">Alias</FieldLabel>
            <Input
              id="cuenta-alias"
              placeholder="Ej. 1, 2, la de su esposa"
              value={alias}
              disabled={ocupado}
              onChange={(e) => setAlias(e.target.value)}
              data-testid="cuenta-alias"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="cuenta-banco">Banco</FieldLabel>
            <Input
              id="cuenta-banco"
              placeholder="Ej. BBVA"
              value={banco}
              disabled={ocupado}
              onChange={(e) => setBanco(e.target.value)}
              data-testid="cuenta-banco"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="cuenta-tipo">Tipo de cuenta</FieldLabel>
            <SelectNativo
              id="cuenta-tipo"
              value={tipoCuenta}
              disabled={ocupado}
              onChange={(e) => setTipoCuenta(e.target.value as TipoCuenta)}
              data-testid="cuenta-tipo"
            >
              <option value="clabe">CLABE interbancaria</option>
              <option value="tarjeta">Tarjeta de débito</option>
            </SelectNativo>
          </Field>
          <Field>
            <FieldLabel htmlFor="cuenta-numero" required>
              Número
            </FieldLabel>
            <Input
              id="cuenta-numero"
              inputMode="numeric"
              placeholder={tipoCuenta === 'clabe' ? '18 dígitos' : '15 a 19 dígitos'}
              value={cuenta}
              disabled={ocupado}
              onChange={(e) => setCuenta(e.target.value)}
              data-testid="cuenta-numero"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="cuenta-notas">Notas</FieldLabel>
            <Input
              id="cuenta-notas"
              placeholder="Lo que haya que recordar de esta cuenta"
              value={notas}
              disabled={ocupado}
              onChange={(e) => setNotas(e.target.value)}
              data-testid="cuenta-notas"
            />
          </Field>
          <Field orientation="horizontal">
            <input
              id="cuenta-es-fiscal"
              type="checkbox"
              className="size-4 rounded border-input accent-primary"
              checked={esFiscal}
              disabled={ocupado}
              onChange={(e) => setEsFiscal(e.target.checked)}
              data-testid="cuenta-es-fiscal"
            />
            <FieldLabel htmlFor="cuenta-es-fiscal" className="font-normal">
              Es la cuenta fiscal (a ella salen los pagos con factura)
            </FieldLabel>
          </Field>
        </div>

        <FieldError errors={error === null ? [] : [{ message: error }]} />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={ocupado}
            onClick={guardar}
            data-testid={editando === null ? 'agregar-cuenta-pago' : 'guardar-cuenta-pago'}
          >
            {crear.isPending || actualizar.isPending ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : editando === null ? (
              <Plus aria-hidden />
            ) : (
              <Pencil aria-hidden />
            )}
            {editando === null ? 'Agregar cuenta' : 'Guardar cambios'}
          </Button>

          {editando === null ? null : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={ocupado}
              onClick={limpiar}
              data-testid="cancelar-edicion-cuenta"
            >
              <X aria-hidden />
              Cancelar
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Un renglón de cuenta: beneficiario + sus marcas, y debajo banco · tipo · número. */
function RenglonCuenta({ cuenta }: { cuenta: ProveedorCuentaPago }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
        <span className="truncate">{cuenta.beneficiario}</span>
        {cuenta.alias === null || cuenta.alias === '' ? null : (
          <span className="text-xs font-normal text-muted-foreground">({cuenta.alias})</span>
        )}
        {cuenta.esDefault ? <TipoBadge tono="pt">Por omisión</TipoBadge> : null}
        {cuenta.esFiscal ? <TipoBadge tono="telas">Cuenta fiscal</TipoBadge> : null}
      </p>
      <p className="truncate text-xs text-muted-foreground">
        {[cuenta.banco, etiquetaTipoCuenta(cuenta.tipoCuenta), numeroLegible(cuenta.cuenta)]
          .filter((v) => v !== null && v !== '')
          .join(' · ')}
      </p>
    </div>
  );
}
