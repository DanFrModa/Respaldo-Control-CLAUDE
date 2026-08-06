import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { claveNombreColor, type RenglonColor } from './colores-tela';

/**
 * Editor del GRID DE COLORES de una tela (F1-E3; reestructura A1 §Post-F9.11): los colores
 * son HIJOS de la tela — NOMBRE LIBRE ("Marino Alsa 3040") + PANTONE (texto buscable) +
 * precio del cuerpo y — solo si la tela LLEVA COMPLEMENTO — precio del complemento
 * (Daniel: *"el cardigan es otro precio que la tela"*; la columna se esconde si no lleva y
 * su etiqueta usa el nombre capturado, p. ej. "Precio Cardigan"). El catálogo global
 * `Color` es SOLO el color de la PRENDA: aquí NO participa (dar de alta un color de tela
 * no lo mete a ese catálogo). El estado vive en el diálogo padre (`colores` + `alCambiar`),
 * que lo envía INLINE en el cuerpo del API (alta/edición, misma transacción A2).
 *
 * El nombre es la IDENTIDAD del color dentro de la tela: no se puede agregar dos veces el
 * mismo (insensible a mayúsculas); el backend re-valida y es la autoridad (A1). El grid
 * PUEDE ir vacío. Los precios se capturan como texto en un `<input type="number">` y la
 * conversión a número la hace el diálogo al armar el cuerpo. Los helpers puros
 * (`aRenglones`/`aColoresCuerpo`) y el tipo `RenglonColor` viven en `./colores-tela`
 * (regla fast-refresh: este archivo solo exporta un componente).
 */
export function EditorColoresTela({
  colores,
  alCambiar,
  deshabilitado = false,
  llevaComplemento = false,
  nombreComplemento = '',
}: {
  colores: RenglonColor[];
  alCambiar: (colores: RenglonColor[]) => void;
  deshabilitado?: boolean;
  /** Si la tela lleva complemento, cada color muestra también el precio del complemento. */
  llevaComplemento?: boolean;
  /** Nombre del complemento ("Cardigan") para etiquetar su precio; vacío = "complemento". */
  nombreComplemento?: string;
}): React.JSX.Element {
  // Nombre tecleado del color a agregar (texto libre, §Post-F9.11).
  const [aAgregar, setAAgregar] = useState('');
  const [errorAgregar, setErrorAgregar] = useState<string | null>(null);

  const etiquetaComplemento =
    nombreComplemento.trim() === '' ? 'complemento' : nombreComplemento.trim();

  function agregar(): void {
    const nombre = aAgregar.trim();
    if (nombre === '') {
      return;
    }
    if (colores.some((c) => claveNombreColor(c.nombre) === claveNombreColor(nombre))) {
      setErrorAgregar(`Esta tela ya tiene el color "${nombre}".`);
      return;
    }
    setErrorAgregar(null);
    alCambiar([
      ...colores,
      { nombre, precioTexto: '', precioComplementoTexto: '', pantoneTexto: '' },
    ]);
    setAAgregar('');
  }

  function quitar(indice: number): void {
    alCambiar(colores.filter((_, i) => i !== indice));
  }

  function cambiar(indice: number, cambios: Partial<RenglonColor>): void {
    alCambiar(colores.map((c, i) => (i === indice ? { ...c, ...cambios } : c)));
  }

  // Nombres repetidos EN VIVO (p. ej. al renombrar en sitio): se avisa aquí; el contrato
  // del backend lo re-valida al guardar (A1).
  const clavesVistas = new Map<string, number>();
  for (const c of colores) {
    const clave = claveNombreColor(c.nombre);
    clavesVistas.set(clave, (clavesVistas.get(clave) ?? 0) + 1);
  }
  const hayRepetidos = [...clavesVistas.values()].some((n) => n > 1);

  return (
    <Field role="group" aria-labelledby="editor-colores-titulo">
      <FieldLabel id="editor-colores-titulo" asChild>
        <span>Colores de la tela</span>
      </FieldLabel>
      <FieldDescription>
        Colores PROPIOS de esta tela (nombre libre, como los llama su proveedor), con su pantone y
        su precio por unidad (opcionales). Puede no tener ninguno; no son los colores de prenda.
      </FieldDescription>

      {/* Agregar color por nombre (texto libre) */}
      <div className="flex items-center gap-2">
        <Input
          type="text"
          value={aAgregar}
          maxLength={80}
          placeholder="Ej. Marino Alsa 3040"
          aria-label="Nombre del color a agregar a la tela"
          data-testid="nombre-agregar-color"
          disabled={deshabilitado}
          onChange={(e) => {
            setAAgregar(e.target.value);
            setErrorAgregar(null);
          }}
          onKeyDown={(e) => {
            // Enter agrega el color, sin disparar el submit del diálogo.
            if (e.key === 'Enter') {
              e.preventDefault();
              agregar();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={agregar}
          disabled={deshabilitado || aAgregar.trim() === ''}
          data-testid="agregar-color"
        >
          <PlusIcon aria-hidden />
          Agregar
        </Button>
      </div>
      {errorAgregar !== null ? (
        <p className="text-sm text-destructive" role="alert" data-testid="error-agregar-color">
          {errorAgregar}
        </p>
      ) : null}

      {/* Grid de colores agregados */}
      {colores.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground" data-testid="colores-vacio">
          Esta tela no tiene colores. Agrega los que apliquen.
        </p>
      ) : (
        <>
          <ul className="mt-1 space-y-2" data-testid="grid-colores-tela">
            {/* Claves y testids por ÍNDICE (R2-8): el nombre es texto libre del usuario y
                además EDITABLE en sitio (R2-7) — corregir "NEGRRO" ya no obliga a quitar y
                recapturar (y en casing, el dominio actualiza en sitio conservando la liga). */}
            {colores.map((renglon, indice) => (
              <li
                key={indice}
                data-testid="renglon-color"
                className="space-y-1.5 rounded-lg border p-2"
              >
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    className="min-w-0 flex-1 font-medium"
                    maxLength={80}
                    aria-label={`Nombre del color ${String(indice + 1)}`}
                    aria-invalid={renglon.nombre.trim() === ''}
                    value={renglon.nombre}
                    disabled={deshabilitado}
                    onChange={(e) => cambiar(indice, { nombre: e.target.value })}
                    data-testid={`nombre-color-${indice}`}
                  />
                  <Input
                    type="text"
                    className="w-32"
                    placeholder="PANTONE"
                    maxLength={50}
                    aria-label={`Pantone del color ${renglon.nombre}`}
                    value={renglon.pantoneTexto}
                    disabled={deshabilitado}
                    onChange={(e) => cambiar(indice, { pantoneTexto: e.target.value })}
                    data-testid={`pantone-color-${indice}`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => quitar(indice)}
                    disabled={deshabilitado}
                    aria-label={`Quitar el color ${renglon.nombre}`}
                    data-testid={`quitar-color-${indice}`}
                  >
                    <Trash2Icon className="text-destructive" aria-hidden />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    className="w-28"
                    placeholder="Precio"
                    aria-label={`Precio del color ${renglon.nombre}`}
                    value={renglon.precioTexto}
                    disabled={deshabilitado}
                    onChange={(e) => cambiar(indice, { precioTexto: e.target.value })}
                    data-testid={`precio-color-${indice}`}
                  />
                  {llevaComplemento ? (
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      className="w-36"
                      placeholder={`Precio ${etiquetaComplemento}`}
                      aria-label={`Precio del ${etiquetaComplemento} en el color ${renglon.nombre}`}
                      value={renglon.precioComplementoTexto}
                      disabled={deshabilitado}
                      onChange={(e) => cambiar(indice, { precioComplementoTexto: e.target.value })}
                      data-testid={`precio-complemento-color-${indice}`}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {hayRepetidos ? (
            <p
              className="text-sm text-destructive"
              role="alert"
              data-testid="error-colores-repetidos"
            >
              Hay colores con el mismo nombre en esta tela; corrígelos antes de guardar.
            </p>
          ) : null}
        </>
      )}

      <FieldError errors={[]} />
    </Field>
  );
}
