import { z } from 'zod';

/**
 * Numero OPCIONAL capturado en un `<input type="number">` (texto; vacio = sin valor).
 * Copia local del patron `numeroOpcional` de `@/api/esquemas` (que no se exporta) para
 * mantener la pieza de avios autocontenida sin tocar el archivo compartido. Valida, con
 * mensaje propio, que si hay algo sea un numero ≥ `min`. Entrada y salida son `string`; la
 * conversion a `number` la hace `numeroOpcionalACuerpo` (sí exportado) en el dialogo.
 */
function numeroOpcional(opciones: {
  min: number;
  mensajeNoNumero: string;
  mensajeMin: string;
}): z.ZodString {
  return z
    .string()
    .refine((valor) => valor.trim() === '' || Number.isFinite(Number(valor)), {
      error: opciones.mensajeNoNumero,
    })
    .refine((valor) => valor.trim() === '' || Number(valor) >= opciones.min, {
      error: opciones.mensajeMin,
    });
}

/**
 * Esquema Zod de captura del formulario de AVIO (F1-E3, R1). Vive en el modulo de avios
 * (no en el `api/esquemas.ts` compartido) para mantener la pieza autocontenida. Refleja
 * las reglas del backend pero es SOLO UX: el servidor re-valida y es la autoridad (A1).
 *
 * Diferencia clave de captura (ADR-0009): en BD `unidad`/`presentacion` son NULLABLE (para
 * que el ETL de E6 cargue 629 historicos sin esos datos), PERO en ALTAS NUEVAS por UI son
 * OBLIGATORIAS — esa obligatoriedad la pone ESTE Zod del formulario, no el dominio. Como el
 * mismo formulario sirve a alta y edicion, ambos campos se modelan obligatorios aqui (en
 * edicion el avio ya los trae, o el usuario los completa). favorito ⇒ cantFav (>0), igual
 * que el backend, con un `.refine()`.
 *
 * `cantFav`/`precioReferencia` se capturan como TEXTO (patron `numeroOpcional`: un
 * `<input type="number">` siempre entrega string; vacio = sin valor); la conversion a
 * number la hace `aCuerpo` del dialogo. Los proveedores (con su precio/condiciones) los
 * gestiona el `SelectorProveedoresAvio` como estado aparte (no son texto del schema).
 */
export const esquemaAvioFormulario = z
  .object({
    clave: z
      .string({ error: 'La clave es obligatoria' })
      .trim()
      .min(1, { error: 'La clave es obligatoria' })
      .max(50, { error: 'La clave no puede tener más de 50 caracteres' }),
    descripcion: z
      .string({ error: 'La descripción es obligatoria' })
      .trim()
      .min(1, { error: 'La descripción es obligatoria' })
      .max(300, { error: 'La descripción no puede tener más de 300 caracteres' }),
    // Obligatorias en altas nuevas por UI (ADR-0009): el form las exige aunque la BD las
    // acepte null para los migrados de E6.
    unidad: z
      .string({ error: 'La unidad es obligatoria' })
      .trim()
      .min(1, { error: 'La unidad es obligatoria' })
      .max(50, { error: 'La unidad no puede tener más de 50 caracteres' }),
    presentacion: z
      .string({ error: 'La presentación es obligatoria' })
      .trim()
      .min(1, { error: 'La presentación es obligatoria' })
      .max(50, { error: 'La presentación no puede tener más de 50 caracteres' }),
    favorito: z.boolean(),
    cantFav: numeroOpcional({
      min: 0,
      mensajeNoNumero: 'La cantidad preestablecida debe ser un número',
      mensajeMin: 'La cantidad preestablecida no puede ser negativa',
    }).describe('Cantidad preestablecida (requerida si es favorito).'),
    esGenerico: z.boolean(),
    precioReferencia: numeroOpcional({
      min: 0,
      mensajeNoNumero: 'El precio de referencia debe ser un número',
      mensajeMin: 'El precio de referencia no puede ser negativo',
    }).describe('Precio de referencia (vacío = sin precio).'),
  })
  .refine(
    // Regla de captura (espejo del backend): si es favorito, exige cantFav > 0.
    (datos) => !datos.favorito || (datos.cantFav.trim() !== '' && Number(datos.cantFav) > 0),
    {
      error: 'Si el avío es favorito, captura la cantidad preestablecida (mayor a 0)',
      path: ['cantFav'],
    },
  );

/** Datos del formulario de avío. */
export type DatosAvioFormulario = z.infer<typeof esquemaAvioFormulario>;

/**
 * Presentaciones/empaques sugeridos para el combobox (lista + texto libre). El usuario
 * puede elegir una o escribir la suya (el `<input list>` no restringe). Espejo de la
 * lista pedida en F1-E3.
 */
export const PRESENTACIONES_SUGERIDAS = [
  'PIEZA',
  'METRO',
  'KILOGRAMO',
  'PAR',
  'ROLLO',
  'CONO',
  'GRUESA',
  'JUEGO',
  'YARDA',
  'CAJA',
] as const;
