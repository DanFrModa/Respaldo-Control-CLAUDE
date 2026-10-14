import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import type { ServicioArchivos } from '../../comun/archivos.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { ErrorPermiso } from '../../comun/errores.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { definirRoles, PERFILES_EDITABLES } from '../../../prisma/seed.js';

import { exigirEditarArteModelo, exigirEditarFotosArteOrden } from './acceso-arte.js';
import * as moduloArte from './arte-modelo.js';
import * as moduloFotosArteOrden from '../produccion/fotos-arte-orden.js';
import {
  actualizarArte,
  copiarArteDeOtroModelo,
  crearArte,
  eliminarArte,
  marcarArtePrincipal,
  quitarFotoArte,
  solicitarSubidaFotoArte,
} from './arte-modelo.js';
import { aceptarAviosFavoritos } from './avios-favoritos.js';
import { copiarBom, reemplazarAviosBom, reemplazarTelasBom } from './bom-modelo.js';
import { asignarCurvaDesdeOrdenes } from './curva-desde-ordenes.js';
import {
  actualizarFoto,
  marcarFotoPrincipal,
  quitarFoto,
  solicitarSubidaFoto,
} from './fotos-modelo.js';
import { guardarMedidasAvio } from './medidas-avio-talla.js';
import {
  actualizarModelo,
  crearModelo,
  descontinuarModelo,
  pasarModeloAProduccion,
  reactivarModelo,
} from './modelos.js';
import {
  mostrarFotoArteEnOrden,
  ocultarFotoArteEnOrden,
  quitarFotoArteOrden,
  solicitarSubidaFotoArteOrden,
} from '../produccion/fotos-arte-orden.js';

/**
 * ⭐⭐ Fila 0.235 (§Post-F9.247(c)) — LA REJA DEL DOMINIO entre `modelos.arte`,
 * `modelos.administrar` y `desarrollo.administrar`, probada SIN base de datos.
 *
 * Daniel, sobre Diseño Gráfico: *«desarrolla todos los artes, define quién es el proveedor y cotiza
 * cuánto cuesta cada uno»*. Lo que se fija aquí, operación por operación:
 *  • las SIETE del arte del MODELO pasan con SÓLO `modelos.arte`, y siguen pasando con SÓLO
 *    `modelos.administrar` (que la implica);
 *  • las CUATRO de las fotos de arte de la ORDEN pasan con SÓLO `modelos.arte`, y siguen pasando con
 *    SÓLO `desarrollo.administrar` — pero NO con `modelos.administrar`, que nunca tocó la orden;
 *  • TODO lo demás que escribe el modelo (ficha, telas, avíos, medidas, favoritos, curva, fotos del
 *    modelo, copiar la receta entera, pasar a producción) se NIEGA con sólo `modelos.arte`;
 *  • sin ninguna llave, todo se niega (deny-by-default, A4).
 *
 * 🔑 Cómo se sabe que la reja DEJÓ PASAR sin una base: la «base» es una transacción-trampa que lanza
 * {@link PasoLaReja} al primer acceso (mismo molde que `catalogos/acceso-clientes.test.ts`). Las
 * entradas del arte son VÁLIDAS a propósito, para que lo que se vea sea la trampa y no un
 * `ErrorValidacion`.
 *
 * 🔑 Y el inventario NO se mide a sí mismo: se cruza contra los exports REALES de los dos módulos del
 * arte y contra el CÓDIGO de `dominio/modelos/` (toda función que exige `modelos.administrar`).
 */

/** Lo que lanza la transacción-trampa: la operación cruzó la reja y fue a buscar datos. */
class PasoLaReja extends Error {
  constructor() {
    super('cruzó la reja de permisos y tocó la base');
  }
}

/** Una transacción en la que CUALQUIER acceso lanza. */
function bdTrampa(): ContextoBd {
  const tx = new Proxy(
    {},
    {
      get() {
        throw new PasoLaReja();
      },
    },
  ) as Tx;
  return { tx };
}

/** Un servicio de archivos que no se debe tocar nunca (la trampa salta antes). */
const archivosTrampa = new Proxy(
  {},
  {
    get() {
      throw new PasoLaReja();
    },
  },
) as ServicioArchivos;

type Sesion = ReturnType<typeof sesionDePrueba>;
type Operacion = (sesion: Sesion, bd: ContextoBd) => Promise<unknown>;

const FOTO = { nombreOriginal: 'logo.png', tipoMime: 'image/png', tamanoBytes: 1024 };

/** El arte del MODELO: `modelos.arte` o `modelos.administrar`. */
const DEL_ARTE_MODELO: readonly (readonly [string, Operacion])[] = [
  ['crearArte', (s, bd) => crearArte(s, 1, { descripcion: 'Logo', idTipoArte: 3 }, bd)],
  ['actualizarArte', (s, bd) => actualizarArte(s, 1, { id: 2, precio: 12.5 }, bd)],
  ['eliminarArte', (s, bd) => eliminarArte(s, 1, 2, bd, archivosTrampa)],
  ['marcarArtePrincipal', (s, bd) => marcarArtePrincipal(s, 1, 2, bd)],
  ['copiarArteDeOtroModelo', (s, bd) => copiarArteDeOtroModelo(s, 1, { idArteOrigen: 9 }, bd)],
  [
    'solicitarSubidaFotoArte',
    (s, bd) => solicitarSubidaFotoArte(s, 1, 2, FOTO, bd, archivosTrampa),
  ],
  ['quitarFotoArte', (s, bd) => quitarFotoArte(s, 1, 2, 3, bd, archivosTrampa)],
];

/** Las fotos de arte de la ORDEN: `modelos.arte` o `desarrollo.administrar`. */
const DE_FOTOS_ARTE_ORDEN: readonly (readonly [string, Operacion])[] = [
  [
    'ocultarFotoArteEnOrden',
    (s, bd) => ocultarFotoArteEnOrden(s, 1, 2, { idModeloArteFoto: 3 }, bd),
  ],
  ['mostrarFotoArteEnOrden', (s, bd) => mostrarFotoArteEnOrden(s, 1, 2, 3, bd)],
  [
    'solicitarSubidaFotoArteOrden',
    (s, bd) => solicitarSubidaFotoArteOrden(s, 1, 2, FOTO, bd, archivosTrampa),
  ],
  ['quitarFotoArteOrden', (s, bd) => quitarFotoArteOrden(s, 1, 2, 3, bd, archivosTrampa)],
];

/**
 * Lo que es SÓLO de `modelos.administrar`: la ficha, la receta de telas y avíos, las medidas, la
 * curva, las fotos del modelo y copiar la receta entera (que también trae telas y avíos). Las
 * entradas son de relleno: la reja es la primera línea de cada una, así que lo que se mide es si el
 * error es de PERMISO o de otra cosa.
 */
const SOLO_ADMINISTRAR: readonly (readonly [string, Operacion])[] = [
  ['crearModelo', (s, bd) => crearModelo(s, {} as never, bd)],
  ['actualizarModelo', (s, bd) => actualizarModelo(s, {} as never, bd)],
  ['descontinuarModelo', (s, bd) => descontinuarModelo(s, 1, bd)],
  ['reactivarModelo', (s, bd) => reactivarModelo(s, 1, bd)],
  ['pasarModeloAProduccion', (s, bd) => pasarModeloAProduccion(s, 1, {}, bd)],
  ['asignarCurvaDesdeOrdenes', (s, bd) => asignarCurvaDesdeOrdenes(s, 1, [1], bd)],
  ['reemplazarTelasBom', (s, bd) => reemplazarTelasBom(s, 1, [], bd)],
  ['reemplazarAviosBom', (s, bd) => reemplazarAviosBom(s, 1, [], bd)],
  ['guardarMedidasAvio', (s, bd) => guardarMedidasAvio(s, 1, 2, {} as never, bd)],
  ['aceptarAviosFavoritos', (s, bd) => aceptarAviosFavoritos(s, 1, bd)],
  ['copiarBom', (s, bd) => copiarBom(s, 1, {} as never, bd, archivosTrampa)],
  ['solicitarSubidaFoto', (s, bd) => solicitarSubidaFoto(s, 1, FOTO, bd, archivosTrampa)],
  ['actualizarFoto', (s, bd) => actualizarFoto(s, 1, 2, {}, bd)],
  ['marcarFotoPrincipal', (s, bd) => marcarFotoPrincipal(s, 1, 2, bd, archivosTrampa)],
  ['quitarFoto', (s, bd) => quitarFoto(s, 1, 2, bd, archivosTrampa)],
];

function con(...permisos: ClavePermiso[]): Sesion {
  return sesionDePrueba({
    permisos: ['modelos.ver', 'ordenes.ver', ...permisos],
    idEmpresaActiva: 1,
  });
}

/** Corre la operación y devuelve el error con el que terminó (o `null` si no lanzó). */
async function errorDe(operacion: Operacion, sesion: Sesion): Promise<unknown> {
  try {
    await operacion(sesion, bdTrampa());
    return null;
  } catch (e) {
    return e;
  }
}

// ── El inventario, contra el código ────────────────────────────────────────────

/** Las funciones exportadas de un módulo que ESCRIBEN (toda función menos las de lectura/ayuda). */
function escrituras(modulo: Record<string, unknown>, lecturas: RegExp): string[] {
  return Object.entries(modulo)
    .filter(([nombre, valor]) => typeof valor === 'function' && !lecturas.test(nombre))
    .map(([nombre]) => nombre)
    .sort();
}

/**
 * Las funciones exportadas de `src/dominio/modelos/*.ts` (sin pruebas, sin `migracion.ts`, que es el
 * ETL) cuyo CUERPO exige `modelos.administrar`. Se lee el texto: así una operación que deje de
 * exigirla —p. ej. que pase a aceptar `modelos.arte`— DESAPARECE de aquí y la igualdad de abajo se
 * pone roja.
 */
function exigenAdministrarEnElCodigo(): string[] {
  const carpeta = fileURLToPath(new URL('.', import.meta.url));
  const nombres: string[] = [];
  for (const archivo of readdirSync(carpeta)) {
    if (!archivo.endsWith('.ts') || archivo.endsWith('.test.ts') || archivo === 'migracion.ts') {
      continue;
    }
    const texto = readFileSync(`${carpeta}${archivo}`, 'utf8');
    for (const firma of texto.matchAll(/\nexport async function (\w+)[(<]/g)) {
      const resto = texto.slice(firma.index + 1);
      const cierre = resto.search(/\n\}/);
      const cuerpo = cierre < 0 ? resto : resto.slice(0, cierre);
      if (cuerpo.includes("verificarPermiso(sesion, 'modelos.administrar')")) {
        nombres.push(firma[1] ?? '');
      }
    }
  }
  return nombres.sort();
}

describe('0.235 — el inventario es el del CÓDIGO, no el de esta prueba', () => {
  it('las 7 del arte del modelo son EXACTAMENTE las escrituras que exporta `arte-modelo.ts`', () => {
    const lecturas =
      /^(listar|leer|galeria|ocultarPrecio|datosArte|borrarArchivoSiQuedoHuerfano|esquema)/;
    expect(DEL_ARTE_MODELO.map(([n]) => n).sort()).toEqual(
      escrituras(moduloArte as Record<string, unknown>, lecturas),
    );
    expect(DEL_ARTE_MODELO).toHaveLength(7);
  });

  it('las 4 de las fotos de arte de la orden son EXACTAMENTE las escrituras de su módulo', () => {
    expect(DE_FOTOS_ARTE_ORDEN.map(([n]) => n).sort()).toEqual(
      escrituras(moduloFotosArteOrden as Record<string, unknown>, /^(listar|leer)/),
    );
    expect(DE_FOTOS_ARTE_ORDEN).toHaveLength(4);
  });

  it('las de SÓLO `modelos.administrar` son EXACTAMENTE las que exigen esa llave en el código', () => {
    expect(SOLO_ADMINISTRAR.map(([n]) => n).sort()).toEqual(exigenAdministrarEnElCodigo());
  });
});

describe('0.235 — `modelos.arte` captura el arte; la ficha, las telas y los avíos son de `administrar`', () => {
  it.each(DEL_ARTE_MODELO)('⭐ %s pasa con SÓLO `modelos.arte`', async (_n, operacion) => {
    expect(await errorDe(operacion, con('modelos.arte'))).toBeInstanceOf(PasoLaReja);
  });

  it.each(DEL_ARTE_MODELO)(
    '✅ %s sigue pasando con SÓLO `modelos.administrar` (la implica)',
    async (_n, operacion) => {
      expect(await errorDe(operacion, con('modelos.administrar'))).toBeInstanceOf(PasoLaReja);
    },
  );

  it.each(DEL_ARTE_MODELO)(
    '⛔ %s NO pasa con `desarrollo.administrar` (esa llave es de la ORDEN, no del modelo)',
    async (_n, operacion) => {
      expect(await errorDe(operacion, con('desarrollo.administrar'))).toBeInstanceOf(ErrorPermiso);
    },
  );

  it.each(DE_FOTOS_ARTE_ORDEN)('⭐ %s pasa con SÓLO `modelos.arte`', async (_n, operacion) => {
    expect(await errorDe(operacion, con('modelos.arte'))).toBeInstanceOf(PasoLaReja);
  });

  it.each(DE_FOTOS_ARTE_ORDEN)(
    '✅ %s sigue pasando con SÓLO `desarrollo.administrar` (nadie que ya lo hacía lo pierde)',
    async (_n, operacion) => {
      expect(await errorDe(operacion, con('desarrollo.administrar'))).toBeInstanceOf(PasoLaReja);
    },
  );

  it.each(DE_FOTOS_ARTE_ORDEN)(
    '⛔ %s NO pasa con `modelos.administrar` (nunca tocó la orden)',
    async (_n, operacion) => {
      expect(await errorDe(operacion, con('modelos.administrar'))).toBeInstanceOf(ErrorPermiso);
    },
  );

  it.each(SOLO_ADMINISTRAR)(
    '⛔ %s NO pasa con sólo `modelos.arte` (ni con `desarrollo.administrar` encima)',
    async (_n, operacion) => {
      expect(await errorDe(operacion, con('modelos.arte'))).toBeInstanceOf(ErrorPermiso);
      expect(
        await errorDe(operacion, con('modelos.arte', 'desarrollo.administrar')),
      ).toBeInstanceOf(ErrorPermiso);
    },
  );

  it.each(SOLO_ADMINISTRAR)(
    '✅ %s cruza la reja con `modelos.administrar` (lo que truene después no es de permiso)',
    async (_n, operacion) => {
      expect(await errorDe(operacion, con('modelos.administrar'))).not.toBeInstanceOf(ErrorPermiso);
    },
  );

  it.each([...DEL_ARTE_MODELO, ...DE_FOTOS_ARTE_ORDEN, ...SOLO_ADMINISTRAR])(
    '⛔ %s se niega sin ninguna llave',
    async (_n, operacion) => {
      expect(await errorDe(operacion, con())).toBeInstanceOf(ErrorPermiso);
    },
  );

  it('las dos rejas nombran `modelos.arte`, que es la llave que hay que dar', () => {
    for (const reja of [exigirEditarArteModelo, exigirEditarFotosArteOrden]) {
      let error: unknown;
      try {
        reja(con());
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ErrorPermiso);
      expect((error as ErrorPermiso).permiso).toBe('modelos.arte');
    }
  });
});

describe('0.235 — el reparto del seed: `modelos.arte` no le abre a nadie lo que no tenía', () => {
  const todos = [
    ...definirRoles().map((r) => ({ nombre: r.nombre, permisos: r.permisos })),
    ...PERFILES_EDITABLES.map((p) => ({ nombre: p.nombre, permisos: [...p.permisos] as string[] })),
  ];

  it('«Diseño Gráfico» lleva `modelos.arte` y NO `modelos.administrar` ni `desarrollo.administrar`', () => {
    const grafico = todos.find((r) => r.nombre === 'Diseño Gráfico');
    expect(grafico?.permisos).toContain('modelos.arte');
    // Sin `tipos-proceso.ver` el selector de TIPO del diálogo de arte sale vacío: tendría la llave y
    // no podría usarla (`GET /tipos-proceso?soloArte=true`, `api/tipos-proceso.ts::useTiposArte`).
    expect(grafico?.permisos).toContain('tipos-proceso.ver');
    expect(grafico?.permisos).not.toContain('modelos.administrar');
    expect(grafico?.permisos).not.toContain('desarrollo.administrar');
  });

  it('todo OTRO rol que lleva `modelos.arte` ya llevaba las dos llaves que la implican', () => {
    const conArte = todos.filter(
      (r) => r.nombre !== 'Diseño Gráfico' && r.permisos.includes('modelos.arte'),
    );
    expect(conArte.map((r) => r.nombre).sort()).toEqual(
      [
        'AdministracionDireccion',
        'Administrador',
        'Directivo',
        'Director General',
        'Gerencial',
      ].sort(),
    );
    for (const rol of conArte) {
      expect(rol.permisos, rol.nombre).toContain('modelos.administrar');
      expect(rol.permisos, rol.nombre).toContain('desarrollo.administrar');
    }
  });

  it('todo rol de sistema con `modelos.administrar` Y `desarrollo.administrar` la enseña palomeada', () => {
    for (const rol of definirRoles()) {
      const p = rol.permisos as string[];
      if (p.includes('modelos.administrar') && p.includes('desarrollo.administrar')) {
        expect(p, rol.nombre).toContain('modelos.arte');
      }
    }
  });
});
