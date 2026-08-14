import { z } from 'zod';

/**
 * Esquema y constantes de captura del formulario del ARTE del modelo (V1-E3d). Viven en el
 * módulo (no en `api/esquemas.ts` compartido) para que esta pieza sea autónoma.
 *
 * Refleja las reglas de captura del backend (`backend/src/contrato/esquemas/arte.ts`),
 * pero es SOLO para la experiencia de usuario: el servidor SIEMPRE re-valida y es la
 * autoridad (A1). Los numericos opcionales se capturan como texto (vacio = sin valor) y
 * se convierten a numero al ARMAR EL CUERPO del API (mismo patron `numeroOpcional` que
 * usa `api/esquemas.ts`).
 */

/** Tipos de arte (espejo del backend). */
export const TIPOS_ARTE = ['BORDADO', 'ESTAMPADO'] as const;
/** Clave de tipo de arte. */
export type TipoArteClave = (typeof TIPOS_ARTE)[number];
/** Etiquetas para UI de cada tipo de arte. */
export const ETIQUETAS_TIPO_ARTE: Record<TipoArteClave, string> = {
  BORDADO: 'Bordado',
  ESTAMPADO: 'Estampado / aplicación',
};

/**
 * Helper de captura para un numero OPCIONAL en un `<input type="number">`: el valor es
 * texto (vacio = sin valor). Valida que, si hay algo, sea un numero dentro de
 * `[min, max]`. Entrada y salida son `string`; la conversion a `number` la hace
 * `numeroOpcionalACuerpo`. Replica el patron de `api/esquemas.ts`.
 */
function numeroOpcional(opciones: {
  min?: number;
  max?: number;
  mensajeNoNumero: string;
  mensajeMin?: string;
  mensajeMax?: string;
}): z.ZodString {
  let esquema = z
    .string()
    .refine((valor) => valor.trim() === '' || Number.isFinite(Number(valor)), {
      error: opciones.mensajeNoNumero,
    });
  if (opciones.min !== undefined) {
    const min = opciones.min;
    esquema = esquema.refine((valor) => valor.trim() === '' || Number(valor) >= min, {
      error: opciones.mensajeMin ?? opciones.mensajeNoNumero,
    });
  }
  if (opciones.max !== undefined) {
    const max = opciones.max;
    esquema = esquema.refine((valor) => valor.trim() === '' || Number(valor) <= max, {
      error: opciones.mensajeMax ?? opciones.mensajeNoNumero,
    });
  }
  return esquema;
}

/** Convierte el texto de un campo numerico opcional a `number`, o `undefined` si esta vacio. */
export function numeroOpcionalACuerpo(valor: string): number | undefined {
  const texto = valor.trim();
  return texto === '' ? undefined : Number(texto);
}

/**
 * Captura del formulario del ARTE (alta y edición comparten forma). El `nombre` es obligatorio;
 * `descripcion` es texto opcional; `puntadas`, `precio` e `idProveedor` se capturan como texto
 * (vacío = sin valor) y `tipo` siempre se elige. La FOTO no va en el schema: se sube/quita aparte
 * (presigned). Validación solo de UX: el backend re-valida (A1).
 */
export const esquemaArteFormulario = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(150, { error: 'El nombre no puede tener más de 150 caracteres' }),
  tipo: z.enum(TIPOS_ARTE, { error: 'El tipo debe ser BORDADO o ESTAMPADO' }),
  descripcion: z
    .string()
    .trim()
    .max(500, { error: 'La descripción no puede tener más de 500 caracteres' }),
  puntadas: numeroOpcional({
    min: 0,
    max: 1_000_000,
    mensajeNoNumero: 'Las puntadas deben ser un número',
    mensajeMin: 'Las puntadas no pueden ser negativas',
    mensajeMax: 'Las puntadas no pueden ser más de 1,000,000',
  }).describe('Número de puntadas (vacío = sin valor).'),
  precio: numeroOpcional({
    min: 0,
    mensajeNoNumero: 'El precio debe ser un número',
    mensajeMin: 'El precio no puede ser negativo',
  }).describe('Precio del arte — el que viaja a la OP (vacío = sin valor).'),
  /** Proveedor que hace el arte (NUEVO en V1-E3d). Vacío = sin proveedor. */
  idProveedor: z.string(),
});

/** Datos del formulario del arte. */
export type DatosArteFormulario = z.infer<typeof esquemaArteFormulario>;
