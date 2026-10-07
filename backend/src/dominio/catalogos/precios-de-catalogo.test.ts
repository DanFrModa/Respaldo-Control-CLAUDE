/**
 * ⭐ La regla de QUIÉN VE LOS PRECIOS de telas y avíos (fila 0.249 parte B), en pruebas puras.
 *
 * Dos cosas se fijan aquí:
 *  1. La regla: las llaves de VOCABULARIO (`telas.ver`, `avios.ver`) solas NO dejan ver un precio;
 *     cada llave de la lista, sola, sí.
 *  2. 🔑 **La invariante que impide que un formulario PISE un precio**: toda llave que ESCRIBE un
 *     precio de estos catálogos DESDE UN FORMULARIO está en la lista de lectura (las copias que hace
 *     el propio servidor, como `fusionarColores`, no pasan por un formulario y no cuentan). Se comprueba contra el CÓDIGO (se lee
 *     el `verificarPermiso` de cada función que escribe), no contra una lista copiada a mano: si
 *     mañana alguien cambia la llave de un escritor sin tocar la regla, esto se pone rojo.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { definirRoles, PERFILES_EDITABLES } from '../../../prisma/seed.js';
import type { ClavePermiso } from '../../contrato/index.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  LLAVES_PRECIO_AVIO,
  LLAVES_PRECIO_TELA,
  puedeVerPreciosDeAvio,
  puedeVerPreciosDeTela,
} from './precios-de-catalogo.js';

/** Lee un archivo del dominio relativo a `src/dominio/`. */
function fuente(ruta: string): string {
  return readFileSync(fileURLToPath(new URL(`../${ruta}`, import.meta.url)), 'utf8');
}

/**
 * El CUERPO de `export async function <nombre>(` dentro de `texto`: desde su firma hasta la llave
 * que la cierra, que es la primera `}` en la columna 0 (el estilo del repo lo garantiza: prettier
 * sangra todo lo que está adentro). ⚠️ Buscar hasta el FINAL DEL ARCHIVO era el defecto que cazó el
 * reviewer: si un escritor dejaba de verificar, la prueba leía la llave de la función de ABAJO y
 * seguía en verde.
 */
function cuerpoDe(texto: string, nombre: string): string | null {
  const inicio = texto.indexOf(`export async function ${nombre}(`);
  if (inicio < 0) return null;
  const resto = texto.slice(inicio);
  // El cierre de la función: la primera `}` en columna 0 después de la firma.
  const cierre = resto.search(/\n\}/);
  return cierre < 0 ? resto : resto.slice(0, cierre + 2);
}

/**
 * La llave que exige la PRIMERA `verificarPermiso` DENTRO del cuerpo de la función. Falla en voz
 * alta si la función no existe o no verifica nada en SU cuerpo: una prueba que no encuentra lo que
 * busca y pasa en verde sería un adorno.
 */
function llaveEnTexto(texto: string, nombre: string, donde: string): string {
  const cuerpo = cuerpoDe(texto, nombre);
  expect(cuerpo, `${donde}: no existe la función ${nombre}`).not.toBeNull();
  const coincidencia = /verificarPermiso\(sesion, '([a-z0-9.-]+)'\)/.exec(cuerpo ?? '');
  expect(
    coincidencia,
    `${donde}: ${nombre} no llama a verificarPermiso en SU cuerpo`,
  ).not.toBeNull();
  return coincidencia?.[1] ?? '';
}

function llaveDe(ruta: string, nombre: string): string {
  return llaveEnTexto(fuente(ruta), nombre, ruta);
}

/**
 * Todas las funciones que ESCRIBEN un precio de tela o de avío (medido con un `grep` de las
 * escrituras a `tela`, `telaColor`, `telaProveedor(Color)`, `avio`, `avioProveedor` y `avioMedida`
 * en `src/dominio`). Las de migración (`crearTelaMigracion`, `reconciliarColoresTelaMigracion`) van
 * también: comparten la llave del alta normal.
 */
const ESCRITORES_TELA: readonly (readonly [string, string])[] = [
  ['catalogos/telas.ts', 'crearTela'],
  ['catalogos/telas.ts', 'crearTelaMigracion'],
  ['catalogos/telas.ts', 'actualizarTela'],
  ['catalogos/telas.ts', 'reconciliarColoresTelaMigracion'],
  ['catalogos/telas.ts', 'agregarColorATela'],
  ['catalogos/tela-proveedores.ts', 'crearTelaProveedor'],
  ['catalogos/tela-proveedores.ts', 'actualizarTelaProveedor'],
  ['compras/color-de-la-tela.ts', 'fijarPrecioDeColor'],
];
const ESCRITORES_AVIO: readonly (readonly [string, string])[] = [
  ['catalogos/avios.ts', 'crearAvio'],
  ['catalogos/avios.ts', 'actualizarAvio'],
  ['catalogos/avio-medidas.ts', 'reemplazarMedidasAvio'],
  ['catalogos/proveedores.ts', 'asignarAvioProveedor'],
];

describe('quién ve los precios del catálogo de telas (fila 0.249 parte B)', () => {
  it('con sólo telas.ver NO los ve', () => {
    expect(puedeVerPreciosDeTela(sesionDePrueba({ permisos: ['telas.ver'] }))).toBe(false);
  });

  it.each(LLAVES_PRECIO_TELA)('con %s (sola) los ve', (llave) => {
    expect(puedeVerPreciosDeTela(sesionDePrueba({ permisos: [llave] }))).toBe(true);
  });

  it('las llaves de otros catálogos no abren los de tela (avíos ni proveedores)', () => {
    const sesion = sesionDePrueba({ permisos: ['telas.ver', 'avios.administrar'] });
    expect(puedeVerPreciosDeTela(sesion)).toBe(false);
  });

  it.each(ESCRITORES_TELA)('%s · %s escribe con una llave que también LEE el precio', (r, f) => {
    expect(LLAVES_PRECIO_TELA).toContain(llaveDe(r, f) as ClavePermiso);
  });
});

describe('quién ve los precios del catálogo de avíos (fila 0.249 parte B)', () => {
  it('con sólo avios.ver (ni con proveedores.ver) NO los ve', () => {
    const sesion = sesionDePrueba({ permisos: ['avios.ver', 'proveedores.ver'] });
    expect(puedeVerPreciosDeAvio(sesion)).toBe(false);
  });

  it.each(LLAVES_PRECIO_AVIO)('con %s (sola) los ve', (llave) => {
    expect(puedeVerPreciosDeAvio(sesionDePrueba({ permisos: [llave] }))).toBe(true);
  });

  it('telas.administrar no abre los precios de avíos', () => {
    const sesion = sesionDePrueba({ permisos: ['avios.ver', 'telas.administrar'] });
    expect(puedeVerPreciosDeAvio(sesion)).toBe(false);
  });

  it.each(ESCRITORES_AVIO)('%s · %s escribe con una llave que también LEE el precio', (r, f) => {
    expect(LLAVES_PRECIO_AVIO).toContain(llaveDe(r, f) as ClavePermiso);
  });
});

describe('quien ARMA LA RECETA ve los precios con los que elige el amarre', () => {
  // Decisión del lead (revisión de la parte B): Gestión Técnica edita el BOM con
  // `modelos.administrar` y elige el amarre proveedor–tela/avío por su precio; esos precios ya los ve
  // en el BOM. Escrita aparte y con la llave a mano: si alguien la quita de la regla, esto lo dice.
  it('con modelos.administrar (sola) ve los precios de tela y de avío', () => {
    const sesion = sesionDePrueba({ permisos: ['modelos.administrar'] });
    expect(puedeVerPreciosDeTela(sesion)).toBe(true);
    expect(puedeVerPreciosDeAvio(sesion)).toBe(true);
  });

  it('con modelos.ver (sola) NO: ver el catálogo de modelos no abre el del material', () => {
    const sesion = sesionDePrueba({ permisos: ['modelos.ver'] });
    expect(puedeVerPreciosDeTela(sesion)).toBe(false);
    expect(puedeVerPreciosDeAvio(sesion)).toBe(false);
  });
});

describe('la prueba del invariante NO es un adorno (controles de `llaveDe`)', () => {
  const MUESTRA = [
    'export async function escritorSinReja(sesion: SesionUsuario): Promise<void> {',
    "  if (!tienePermiso(sesion, 'avios.administrar')) return;",
    '  await escribir();',
    '}',
    '',
    'export async function vecinaConReja(sesion: SesionUsuario): Promise<void> {',
    "  verificarPermiso(sesion, 'avios.administrar');",
    '}',
    '',
  ].join('\n');

  it('una función que NO verifica en su cuerpo se pone ROJA aunque la de abajo sí verifique', () => {
    // Es exactamente la mutación del reviewer: `actualizarAvio` cambiado a `tienePermiso`, y la
    // prueba vieja leía la llave de `desactivarAvio`, que viene después.
    expect(() => llaveEnTexto(MUESTRA, 'escritorSinReja', 'muestra')).toThrow(
      /no llama a verificarPermiso en SU cuerpo/,
    );
  });

  it('y la que sí verifica se lee bien (control del control)', () => {
    expect(llaveEnTexto(MUESTRA, 'vecinaConReja', 'muestra')).toBe('avios.administrar');
  });
});

describe('ninguna llave de VOCABULARIO se coló en la regla', () => {
  it('ni telas.ver, ni avios.ver, ni proveedores.ver abren precios de catálogo', () => {
    const vocabulario: ClavePermiso[] = ['telas.ver', 'avios.ver', 'proveedores.ver'];
    for (const llave of vocabulario) {
      expect(LLAVES_PRECIO_TELA).not.toContain(llave);
      expect(LLAVES_PRECIO_AVIO).not.toContain(llave);
    }
  });

  // ⚠️ Esta prueba decía «ni compras.ver abre precios» y era FALSO: `compras.ver` es la llave de
  // la explosión y de `GET /ordenes/:id/colores-tela`, que entregan precios de tela y avío por SU
  // cuenta. No está en ESTA regla porque no es de catálogo — y por eso va en PERMISOS_DE_DINERO
  // (`prisma/seed.ts`), fuera del piso para siempre.
  it('compras.ver NO está en la regla de catálogo (tiene sus propios precios: es llave de dinero)', () => {
    expect(LLAVES_PRECIO_TELA).not.toContain('compras.ver');
    expect(LLAVES_PRECIO_AVIO).not.toContain('compras.ver');
  });
});

/**
 * 🔒 LA BITÁCORA GUARDA ESTOS PRECIOS (`{ de, a }` de `precioSugerido`, `precioReferencia`, el
 * precio de cada color y de cada proveedor…). No se tapan ahí —decisión aparte, fila 0.255—, así
 * que la única forma de que no sea una puerta lateral es que **quien lee la bitácora ya pueda ver
 * esos precios**. Hoy se cumple para todos los roles sembrados; esta prueba es la que avisa el día
 * que alguien le dé `admin.ver-bitacora` a un puesto sin llave de precio.
 */
describe('🔒 quien lee la BITÁCORA ya puede ver los precios que ella guarda', () => {
  const roles = [
    ...definirRoles().map((r) => ({ nombre: r.nombre, permisos: r.permisos })),
    ...PERFILES_EDITABLES.map((p) => ({
      nombre: p.nombre,
      permisos: p.permisos,
    })),
  ];
  const lectores = roles.filter((r) => r.permisos.includes('admin.ver-bitacora'));

  it('hay lectores de bitácora que revisar (si no, la prueba de abajo no mediría nada)', () => {
    expect(lectores.length).toBeGreaterThan(0);
  });

  it.each(lectores.map((r) => [r.nombre, r] as const))(
    '%s lee la bitácora y ve precios de tela y de avío',
    (_nombre, rol) => {
      const sesion = sesionDePrueba({ permisos: [...rol.permisos] as ClavePermiso[] });
      expect(puedeVerPreciosDeTela(sesion), 'precios de tela').toBe(true);
      expect(puedeVerPreciosDeAvio(sesion), 'precios de avío').toBe(true);
    },
  );
});
