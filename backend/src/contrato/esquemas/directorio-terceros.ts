import { z } from 'zod';

/**
 * Esquemas del DIRECTORIO HISTÓRICO DE TERCEROS del sistema viejo (§Post-F9.28).
 *
 * Daniel (10-ago-2026): *"¿qué hacemos con la información de ellos si quisiera encontrar algún
 * teléfono o nombre?… ¿Podríamos guardarlo en algún otro repositorio que no sea el catálogo de
 * proveedores?"*
 *
 * SOLO LECTURA. No hay alta, edición ni "convertir en proveedor": si un taller vuelve, se da de alta
 * limpio en el catálogo copiando de aquí lo que sirva. Que no se pueda escribir es justo lo que
 * impide que los ~897 terceros depurados se cuelen de vuelta al catálogo por la puerta de atrás.
 */

/** Filtros del buscador de la libreta. */
export const esquemaDirectorioTercerosQuery = z.object({
  pagina: z.coerce.number().int().positive().default(1),
  porPagina: z.coerce.number().int().positive().max(200).default(50),
  ordenarPor: z.enum(['nombre', 'ultimaActividad', 'documentos']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
  /** Texto libre contra nombre, clave corta, razón social, contacto y teléfono. */
  busqueda: z.string().trim().max(120).optional(),
  /** Acota a un servicio ("Costura", "Corte", "Estampado", "Vende telas"…). */
  servicio: z.string().trim().max(40).optional(),
  /**
   * `solo-fuera` deja únicamente a los que NO están en el catálogo depurado — que son la razón de
   * ser de esta pantalla. `solo-catalogo`, al revés. Por defecto se ven todos.
   */
  enCatalogo: z.enum(['todos', 'solo-catalogo', 'solo-fuera']).default('todos'),
});

export type DatosDirectorioTercerosQuery = z.infer<typeof esquemaDirectorioTercerosQuery>;

/** Un renglón de la libreta. */
export const esquemaDirectorioTercero = z.object({
  id: z.number().int(),
  fuente: z.string().describe('Catálogo del viejo del que salió (Proveedores, Maquileros…).'),
  nombre: z.string(),
  corto: z.string().nullable(),
  razonSocial: z.string().nullable(),
  telefono: z.string().nullable(),
  contacto: z.string().nullable(),
  direccion: z.string().nullable(),
  notas: z.string().nullable(),
  servicios: z.string().nullable(),
  ultimaActividad: z.string().nullable().describe('Último movimiento suyo en el viejo, o null.'),
  documentos: z.number().int(),
  enCatalogo: z.boolean().describe('Si además existe en el catálogo de proveedores de v2.'),
});

export const esquemaDirectorioTercerosPagina = z.object({
  datos: z.array(esquemaDirectorioTercero),
  total: z.number().int(),
  pagina: z.number().int(),
  porPagina: z.number().int(),
});

export type DirectorioTercero = z.infer<typeof esquemaDirectorioTercero>;
export type DirectorioTercerosPagina = z.infer<typeof esquemaDirectorioTercerosPagina>;
