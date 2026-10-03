/**
 * ⭐⭐ LOS 16 PERFILES DE PUESTO DE DANIEL — que estén completos, que nadie los recorte sin querer,
 * y que el del dueño siga DERIVÁNDOSE del catálogo.
 *
 * Esto es la decisión de Daniel transcrita a código, y lo que se mide aquí es la transcripción, no
 * si la decisión es buena: **317 asignaciones** —las 134 del catálogo para `Director General` y 183
 * repartidas entre los otros 15—, con sus nombres y su orden. *(Eran 306 = 134 + 172; las 11 de más
 * son las que Daniel aceptó en §Post-F9.260, fila 0.250 — batería 9, al final.)*
 *
 * ## ⚠️ POR QUÉ ESTE ARCHIVO EXISTE APARTE (hay otros tres que hablan de roles)
 *
 * | Archivo | La pregunta que contesta |
 * |---|---|
 * | **este** | ¿los 16 perfiles de PUESTO están completos y bien transcritos? ¿el del dueño se DERIVA? |
 * | `roles-reparto.test.ts` | ¿qué perfil de SISTEMA puede qué, por decisión de Daniel? |
 * | `reparto-de-permisos.test.ts` | ¿se movió el reparto de los 9 heredados respecto a la foto del 3-sep? |
 * | `seed.int.test.ts` | ¿la BASE DE DATOS recibe lo que dicen las definiciones? (y que a los 15 **no** se los pise) |
 *
 * 🔑 Ninguno de los otros tres ve esto: los dos primeros leen `definirRoles()`, que de los 16 sólo
 * contiene a `Director General`; el de integración mide la mecánica del sembrado, no si la lista
 * está completa. Si alguien borrara media lista de permisos de «Producción», los tres pasarían en
 * verde.
 *
 * Es PURA (no toca la base), así que corre en el proyecto `unit` sin Docker.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  definirRoles,
  PERFIL_CONSULTA_GENERAL,
  PERFIL_DIRECTOR_GENERAL,
  PERFILES_ACCESO_TOTAL,
  PERFILES_DE_PUESTO,
  PERFILES_DE_PUESTO_TODOS,
  PERFILES_EDITABLES,
  PERMISOS_DE_DINERO,
  PERMISOS_DE_SALDOS_Y_MOVIMIENTOS,
  PERMISOS_QUE_FILTRAN_PRECIO,
  SOLO_ADMINISTRADOR,
} from '../../prisma/seed.js';
import { ROLES_FUNCIONALES_RC } from '../../prisma/seed-ruta-critica.js';
import { CATALOGO_PERMISOS, CLAVES_PERMISO } from '../contrato/index.js';

/**
 * La FOTO de la decisión de Daniel: `slug` → `nombre` → **QUÉ llaves palomeó, una por una**, en el
 * orden en que revisó los puestos.
 *
 * ⚠️ Se escribe a mano A PROPÓSITO (no se deriva de `PERFILES_DE_PUESTO`): es la contraparte
 * independiente contra la que se compara el código. Si se calculara, recortar un perfil ajustaría
 * "lo esperado" solo y la prueba no podría fallar nunca — el mismo motivo por el que la foto de
 * `reparto-de-permisos.test.ts` tampoco se lee de `CLAVES_PERMISO`.
 *
 * 🔑 **Son LISTAS, no conteos, y es la diferencia entre medir y adornar.** Hasta la fila 0.250 esta
 * foto guardaba sólo cuántas llaves tenía cada puesto, y un reviewer midió que no bastaba: cambiar
 * en «Líder de Calidad» `rc.ruta-ver` por `temporadas.ver` deja el mismo conteo y pasaba en verde.
 * Con la lista entera, cualquier llave que se quite, se agregue o se cambie por otra rompe aquí.
 *
 * El `director` va con `null`: su lista no se escribe, es «el catálogo entero» (ver la batería de
 * derivación más abajo).
 *
 * Las listas incluyen las 11 llaves que Daniel aceptó en §Post-F9.260 (fila 0.250): Ventas +1,
 * Producción +2, Compras +2, Habilitaciones +2, Telas +1, Almacén de PT +1 y cada Calidad +1. Cuáles
 * son las de esa decisión, separadas del resto, lo fija la batería 9.
 */
const DECISION_DE_DANIEL: readonly {
  slug: string;
  nombre: string;
  llaves: readonly string[] | null;
}[] = [
  { slug: 'director', nombre: 'Director General', llaves: null },
  {
    slug: 'ventas',
    nombre: 'Gerente de Ventas',
    llaves: [
      'avios.ver',
      'clientes.administrar',
      'clientes.modificar',
      'clientes.ver',
      'colores.ver',
      'consultas.ver-importes',
      'desarrollo.precostear',
      'desarrollo.ver',
      'etiquetas-marca.ver',
      'indicadores.ver',
      'listas.administrar',
      'listas.ver',
      'modelos.ver',
      'ordenes.ver',
      'ordenes.ver-precio-real-maquila',
      'pedidos.importes',
      'pedidos.modificar-reales',
      'pedidos.ver',
      'precostos.consultar',
      'produccion.wip-ver',
      'proveedores.ver',
      'tallas.ver',
      'telas.ver',
      'telas.ver-totales',
      'temporadas.ver',
    ],
  },
  {
    slug: 'desarrollo',
    nombre: 'Desarrollo de Producto',
    llaves: [
      'avios.administrar',
      'avios.ver',
      'colores.ver',
      'desarrollo.administrar',
      'desarrollo.precostear',
      'desarrollo.ver',
      'etiquetas-marca.ver',
      'etiquetas.modificar',
      'modelos.administrar',
      'modelos.aprobar-receta',
      'modelos.ver',
      'ordenes.ver',
      'precostos.consultar',
      'tallas.ver',
      'telas.administrar',
      'telas.ver',
      'temporadas.ver',
    ],
  },
  {
    slug: 'finanzas',
    nombre: 'Administración y Finanzas',
    llaves: [
      'clientes.ver',
      'conceptos-pago.administrar',
      'conceptos-pago.ver',
      'cxc.administrar',
      'cxc.ver',
      'cxp.administrar',
      'cxp.ver',
      'esma.revisar',
      'esma.ver-pagos',
      'inventario-pt.ver',
      'ordenes.ver',
      'pagos.corrida-ver',
      'produccion.wip-ver',
      'proveedores.administrar',
      'proveedores.modificar',
      'proveedores.ver',
      'terceros.administrar',
      'terceros.fiscal',
      'terceros.ver',
    ],
  },
  {
    slug: 'produccion',
    nombre: 'Producción',
    llaves: [
      'compras.recibir',
      'compras.ver',
      'inventario-pt.ver',
      'inventario-telas.mover',
      'inventario-telas.ver',
      'modelos.ver',
      'ordenes.modificar',
      'ordenes.precio-maquila',
      'ordenes.ver',
      'produccion.cancelar',
      'produccion.corte',
      'produccion.corte-salidas',
      'produccion.empaque',
      'produccion.entradas-maquila',
      'produccion.envio',
      'produccion.recibo',
      'produccion.wip-ver',
      'rc.bandeja-completa',
      'rc.capturar',
      'rc.fechas-retraso',
      'rc.ruta-ver',
      'rc.ver-botones',
      'telas.ver',
    ],
  },
  {
    slug: 'compras',
    nombre: 'Compras',
    llaves: [
      'almacenes.ver',
      'avios.administrar',
      'avios.ver',
      'compras.administrar',
      'compras.cancelar',
      'compras.ver',
      'inventario-avios.ver',
      'inventario-telas.ver',
      'modelos.ver',
      'notas.ver',
      'ordenes.ver',
      'proveedores.administrar',
      'proveedores.modificar',
      'proveedores.ver',
      'telas.ver',
    ],
  },
  {
    slug: 'habilitaciones',
    nombre: 'Habilitaciones',
    llaves: [
      'almacenes.ver',
      'avios.ver',
      'compras.recibir',
      'compras.ver',
      'inventario-avios.mover',
      'inventario-avios.ver',
      'modelos.ver',
      'notas.administrar',
      'notas.cancelar',
      'notas.ver',
      'ordenes.habilitacion',
      'ordenes.ver',
      'proveedores.ver',
    ],
  },
  {
    slug: 'telas',
    nombre: 'Encargado de Telas',
    llaves: [
      'almacenes.ver',
      'compras.recibir',
      'compras.ver',
      'inventario-telas.mover',
      'inventario-telas.ver',
      'modelos.ver',
      'notas.ver',
      'ordenes.ver',
      'proveedores.ver',
      'telas.ver',
    ],
  },
  {
    slug: 'corte',
    nombre: 'Encargado de Corte',
    llaves: [
      'inventario-telas.ver',
      'modelos.ver',
      'ordenes.ver',
      'produccion.corte',
      'produccion.corte-salidas',
      'produccion.wip-ver',
      'rc.ruta-ver',
      'telas.ver',
    ],
  },
  {
    slug: 'almacen-pt',
    nombre: 'Almacén de Producto Terminado',
    llaves: [
      'almacenes.ver',
      'indicadores.almacen-productividad',
      'indicadores.ciclicos-alta',
      'indicadores.ciclicos-consulta',
      'indicadores.ciclicos-conteo',
      'inventario-pt.mover',
      'inventario-pt.ver',
      'ipt.consultar-existencias',
      'modelos.ver',
      'ordenes.ver',
      'produccion.empaque',
      'produccion.recibo',
    ],
  },
  {
    slug: 'entregas',
    nombre: 'Entregas',
    llaves: [
      'almacenes.ver',
      'clientes.ver',
      'inventario-pt.ver',
      'ipt.consultar-existencias',
      'ordenes.ver',
      'pedidos.ver',
      'produccion.entrega',
      'produccion.wip-ver',
      'rc.ruta-ver',
    ],
  },
  {
    slug: 'calidad-lider',
    nombre: 'Líder de Calidad',
    llaves: [
      'calidad.actualizar-auditorias',
      'calidad.administrar-catalogo',
      'calidad.generar-auditorias',
      'calidad.ver',
      'modelos.ver',
      'ordenes.ver',
      'produccion.wip-ver',
      'proveedores.ver',
      'rc.ruta-ver',
    ],
  },
  {
    slug: 'calidad-sup',
    nombre: 'Supervisor de Calidad',
    llaves: [
      'calidad.actualizar-auditorias',
      'calidad.generar-auditorias',
      'calidad.ver',
      'modelos.ver',
      'ordenes.ver',
      'produccion.wip-ver',
      'proveedores.ver',
    ],
  },
  {
    slug: 'tecnica',
    nombre: 'Gestión Técnica',
    llaves: [
      'avios.ver',
      'colores.ver',
      'desarrollo.ver',
      'modelos.administrar',
      'modelos.ver',
      'ordenes.ver',
      'tallas.ver',
      'telas.ver',
    ],
  },
  {
    slug: 'grafico',
    nombre: 'Diseño Gráfico',
    llaves: ['modelos.ver', 'ordenes.ver', 'proveedores.modificar', 'proveedores.ver'],
  },
  {
    slug: 'auxiliar',
    nombre: 'Auxiliar',
    llaves: ['inventario-pt.ver', 'modelos.ver', 'ordenes.ver', 'produccion.wip-ver'],
  },
];

/** Los 9 roles que ya existían antes de los perfiles de puesto, en su orden exacto. */
const LOS_NUEVE_HEREDADOS: readonly string[] = [
  'Administrador',
  'AdministracionDireccion',
  'Directivo',
  'Gerencial',
  'Ventas',
  'Logistica',
  'Asistente',
  'Secretarial',
  'Basico',
];

// ─────────────────────────────────────────────────────────────────────────────
// 1. LA TRANSCRIPCIÓN — los 16, con su nombre, su orden y sus llaves exactas
// ─────────────────────────────────────────────────────────────────────────────

describe('⭐ los 16 perfiles de puesto están completos y en el orden que Daniel los revisó', () => {
  it('son 16, con el mismo slug y el mismo nombre, en el mismo orden', () => {
    expect(
      PERFILES_DE_PUESTO_TODOS.map((perfil) => ({ slug: perfil.slug, nombre: perfil.nombre })),
      'cambió la lista de perfiles de puesto: son los nombres con los que Daniel los revisó',
    ).toEqual(DECISION_DE_DANIEL.map(({ slug, nombre }) => ({ slug, nombre })));
  });

  it('⭐ cada perfil lleva EXACTAMENTE las llaves que él palomeó — las mismas, no sólo las mismas en número', () => {
    for (const esperado of DECISION_DE_DANIEL) {
      const perfil = PERFILES_DE_PUESTO_TODOS.find((p) => p.slug === esperado.slug);
      expect(perfil, `falta el perfil "${esperado.slug}"`).toBeDefined();
      if (esperado.llaves === null) {
        // El dueño: su lista es el catálogo entero (la batería 3 mide además que se DERIVE).
        expect(perfil?.permisos.length, `${esperado.nombre} tiene que llevar el catálogo`).toBe(
          CLAVES_PERMISO.length,
        );
        continue;
      }
      // Como conjuntos ordenados: el orden de la lista en el seed no es la decisión, el contenido sí.
      expect(
        [...(perfil?.permisos ?? [])].sort(),
        `${esperado.nombre} (${esperado.slug}) ya no lleva las llaves que Daniel palomeó`,
      ).toEqual([...esperado.llaves].sort());
    }
  });

  it('⭐ y en total son 317 asignaciones: 134 del dueño + 183 de los otros 15', () => {
    // El número que Daniel revisó. Partido en dos porque las dos mitades se rompen distinto: la
    // primera si alguien deja de derivar el catálogo, la segunda si alguien recorta un perfil.
    const delDueno = PERFIL_DIRECTOR_GENERAL.permisos.length;
    const deLosQuince = PERFILES_DE_PUESTO.reduce((suma, p) => suma + p.permisos.length, 0);
    expect(delDueno, 'el dueño tiene que llevar el catálogo entero').toBe(134);
    expect(deLosQuince, 'los otros 15 suman 183 asignaciones (172 + las 11 de §Post-F9.260)').toBe(
      183,
    );
    expect(delDueno + deLosQuince).toBe(317);
  });

  it('ningún perfil repite una llave, y ningún slug ni nombre está duplicado', () => {
    for (const perfil of PERFILES_DE_PUESTO_TODOS) {
      const repetidas = perfil.permisos.filter((clave, i) => perfil.permisos.indexOf(clave) !== i);
      expect(repetidas, `${perfil.nombre} repite llaves`).toEqual([]);
    }
    const slugs = PERFILES_DE_PUESTO_TODOS.map((p) => p.slug);
    const nombres = PERFILES_DE_PUESTO_TODOS.map((p) => p.nombre);
    expect(new Set(slugs).size, 'hay slugs repetidos').toBe(slugs.length);
    expect(new Set(nombres).size, 'hay nombres repetidos').toBe(nombres.length);
  });

  it('cada perfil trae una descripción de verdad (es lo que se lee en la pantalla de Roles)', () => {
    for (const perfil of PERFILES_DE_PUESTO_TODOS) {
      expect(perfil.descripcion.trim().length, `${perfil.nombre} sin descripción`).toBeGreaterThan(
        15,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. LA REJA DEL ARRANQUE — ninguna llave inventada
// ─────────────────────────────────────────────────────────────────────────────

describe('⭐ ninguna llave de ningún perfil está fuera del catálogo', () => {
  it('⭐ si una lo estuviera, el seed TUMBARÍA el arranque: por eso se mide aquí y no allá', () => {
    // `sembrarRoles`/`sembrarPerfilesDePuesto` lanzan `Permiso "X" … no está sembrado` al resolver
    // la clave, y eso sólo se ve corriendo el seed contra una base de verdad — o sea, en el
    // despliegue, con el contenedor cayéndose. Esta prueba lo adelanta a los milisegundos.
    const catalogo = new Set<string>(CLAVES_PERMISO);
    const fantasmas = PERFILES_DE_PUESTO_TODOS.flatMap((perfil) =>
      perfil.permisos
        .filter((clave) => !catalogo.has(clave))
        .map((clave) => `${perfil.nombre} → ${clave}`),
    );
    expect(
      fantasmas,
      `Estos perfiles reparten llaves que NO existen en src/contrato/permisos.ts: ` +
        `${fantasmas.join(', ')}. El seed reventaría al sembrarlas y el backend no arrancaría.`,
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. EL DUEÑO SE DERIVA DEL CATÁLOGO — nunca una lista literal
// ─────────────────────────────────────────────────────────────────────────────

describe('⭐⭐ `Director General` DERIVA sus permisos del catálogo, no los lleva escritos', () => {
  it('⭐ son las mismas claves Y EN EL MISMO ORDEN que `CLAVES_PERMISO`', () => {
    // 🔑 La comparación va SIN ordenar, y ahí está el filo: el catálogo está agrupado por módulo
    // (`ordenes.*` primero), NO alfabéticamente. Una lista escrita a mano —que es como se escriben,
    // en orden alfabético, igual que los otros 15— no coincide con este orden, así que esta
    // aserción muere en cuanto alguien sustituya la derivación por un literal.
    expect(
      [...PERFIL_DIRECTOR_GENERAL.permisos],
      'el dueño tiene que derivar CLAVES_PERMISO tal cual: un literal se queda obsoleto en el ' +
        'siguiente permiso que alguien agregue al catálogo, y nadie se enteraría',
    ).toEqual([...CLAVES_PERMISO]);
  });

  it('⭐ y no le falta ninguna: Daniel dijo «tiene todos los permisos»', () => {
    // La misma afirmación por conjuntos, que es la que se lee cuando la de arriba falla por orden.
    expect([...PERFIL_DIRECTOR_GENERAL.permisos].sort()).toEqual([...CLAVES_PERMISO].sort());
  });

  it('va por `definirRoles()` y está en `PERFILES_ACCESO_TOTAL` (es rol de SISTEMA)', () => {
    // Es el único de los 16 que conviene re-sincronizar en cada arranque: significa «todos los
    // permisos» y no hay nada que afinar. Y si entrara en esa lista SIN llevar el catálogo entero,
    // abriría un agujero silencioso en la prueba de huérfanas de `reparto-de-permisos.test.ts`
    // (que excluye a los de acceso total precisamente porque lo llevan todo).
    const nombres = definirRoles().map((rol) => rol.nombre);
    expect(nombres, 'el dueño tiene que ser rol de sistema').toContain('Director General');
    expect([...PERFILES_ACCESO_TOTAL]).toContain('Director General');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. LOS 15 NO SON ROLES DE SISTEMA — el diseño entero depende de esto
// ─────────────────────────────────────────────────────────────────────────────

describe('⭐⭐ los OTROS 15 no pasan por `definirRoles()`, y ésa es la decisión', () => {
  it('⭐ ninguno de los 15 aparece en `definirRoles()`', () => {
    // 🔴 POR QUÉ IMPORTA TANTO: todo lo que pasa por `definirRoles()` lo SINCRONIZA `sembrarRoles`
    // (su `deleteMany({ notIn })`), y `SEED_ON_START=true` está encendido PERMANENTEMENTE en
    // `prueba` ⇒ cada deploy devolvería esos roles a lo que diga el código. El dueño va a afinar
    // estos 15 desde Administración › Roles —y `asignarPermisos` se lo permite, no mira
    // `esSistema`—, así que meterlos ahí le borraría el trabajo en cada despliegue, en silencio.
    //
    // La contraparte (que la BD los reciba con `esSistema: false` y que un perfil ya editado
    // sobreviva a re-sembrar) la mide `seed.int.test.ts`; aquí se fija la mitad que es pura.
    const deSistema = new Set(definirRoles().map((rol) => rol.nombre));
    const colados = PERFILES_DE_PUESTO.filter((perfil) => deSistema.has(perfil.nombre)).map(
      (perfil) => perfil.nombre,
    );
    expect(
      colados,
      `Estos perfiles de puesto se colaron a definirRoles(): ${colados.join(', ')}. Ahí los ` +
        `SINCRONIZA el seed en cada deploy y le borraría al dueño los permisos que ajuste a mano.`,
    ).toEqual([]);
  });

  it('`definirRoles()` son los 9 heredados + el dueño, y nadie más', () => {
    expect(definirRoles().map((rol) => rol.nombre)).toEqual([
      ...LOS_NUEVE_HEREDADOS,
      'Director General',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. LOS 9 HEREDADOS SIGUEN INTACTOS
// ─────────────────────────────────────────────────────────────────────────────

describe('los 9 perfiles heredados no se tocaron', () => {
  it('siguen a la cabeza, con su nombre exacto y en su orden', () => {
    expect(
      definirRoles()
        .slice(0, 9)
        .map((rol) => rol.nombre),
    ).toEqual(LOS_NUEVE_HEREDADOS);
  });

  it('⭐ y ningún nombre de perfil de puesto choca con uno de ellos', () => {
    const heredados = new Set<string>(LOS_NUEVE_HEREDADOS);
    const choques = PERFILES_DE_PUESTO_TODOS.filter((perfil) => heredados.has(perfil.nombre)).map(
      (perfil) => perfil.nombre,
    );
    expect(
      choques,
      `${choques.join(', ')}: ese nombre ya es un rol HEREDADO, y Rol.nombre es único — el perfil ` +
        `de puesto se fundiría con él en vez de crearse.`,
    ).toEqual([]);
  });

  it('los dos de acceso total siguen llevando el catálogo entero', () => {
    for (const nombre of ['Administrador', 'AdministracionDireccion']) {
      const rol = definirRoles().find((r) => r.nombre === nombre);
      expect([...(rol?.permisos ?? [])].sort(), nombre).toEqual([...CLAVES_PERMISO].sort());
    }
  });

  it('`Basico` sigue en cero permisos (es su definición entera)', () => {
    expect(definirRoles().find((rol) => rol.nombre === 'Basico')?.permisos).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. ⚠️ LAS COLISIONES CON LOS ROLES FUNCIONALES DE LA RUTA CRÍTICA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⭐ **DOS NOMBRES COMPARTEN FILA CON UN ROL DE LA RUTA CRÍTICA, y es lo correcto.**
 *
 * `Rol.nombre` es ÚNICO y los roles funcionales de la RC viven en la misma tabla
 * (`ROLES_FUNCIONALES_RC`, `prisma/seed-ruta-critica.ts`). «Habilitaciones» y «Entregas» coinciden al
 * carácter ⇒ el perfil de puesto y el rol de la RC **son la misma fila**… que es correcto, porque son
 * **la misma persona**: **17 de los 18** roles de la RC nacen `esSistema: false` y **con cero
 * permisos**, son cascarones para colgarles la responsabilidad de un proceso (`ProcesoDefRol`). (El
 * 18.º es `Ventas`, que además es rol de sistema y conserva sus 85 permisos; no afecta, porque ningún
 * perfil de puesto se llama así.)
 * `sembrarPerfilesDePuesto` llena el cascarón (sólo los permisos) ⇒ la fila queda con los permisos
 * del puesto **y** sigue siendo responsable de su proceso. Lo mide `seed.int.test.ts`.
 *
 * 🔑 Lo que esta batería hace es **fijar la lista**: una colisión NUEVA puede no ser tan inocente (si
 * el nombre choca con un rol que YA tiene permisos, el perfil se saltaría entero), así que se calcula
 * y se exige que sean exactamente estas dos.
 */
describe('⚠️ colisiones de nombre con los roles funcionales de la Ruta Crítica', () => {
  it('⭐ son EXACTAMENTE dos, y éstas: una tercera rompe esta prueba', () => {
    const choques = PERFILES_DE_PUESTO_TODOS.map((perfil) => perfil.nombre).filter((nombre) =>
      ROLES_FUNCIONALES_RC.includes(nombre),
    );
    expect(
      choques,
      `Colisión de nombre NUEVA entre un perfil de puesto y un rol funcional de la RC. Rol.nombre ` +
        `es único: el perfil NO se crea aparte, se funde con el rol de la RC. Para las dos de ` +
        `siempre eso es correcto (son cascarones vacíos y la misma persona, y el seed los llena), ` +
        `pero una colisión nueva hay que MIRARLA: si el rol ya tuviera permisos, el perfil se ` +
        `saltaría entero y nacería mudo.`,
    ).toEqual(['Habilitaciones', 'Entregas']);
  });

  it('⚠️ y hay dos nombres que sólo se distinguen por el ACENTO (confunden en pantalla)', () => {
    // No son colisión —la columna es sensible a acentos, así que son filas distintas— pero el dueño
    // va a ver «Producción» y «Produccion» juntos en Administración › Roles y no hay forma de saber
    // cuál es cuál. Queda medido para que la decisión de nombres los tenga en cuenta.
    const sinAcento = (texto: string): string =>
      texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const parecidos = PERFILES_DE_PUESTO_TODOS.map((perfil) => perfil.nombre)
      .filter((nombre) =>
        ROLES_FUNCIONALES_RC.some((rc) => rc !== nombre && sinAcento(rc) === sinAcento(nombre)),
      )
      .sort();
    expect(parecidos).toEqual(['Diseño Gráfico', 'Producción']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. ⚠️ LO QUE ESTOS PERFILES CAMBIAN RESPECTO A DECISIONES ANTERIORES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ **DOS SITIOS DONDE EL REPARTO POR PUESTO CONTRADICE ALGO QUE YA ESTABA ESCRITO.**
 *
 * No se "arreglaron" aquí —las llaves son decisión de Daniel y no se discuten— pero tampoco pueden
 * quedar enterradas: un reparto que contradice una decisión anterior **sin que nadie lo nombre** es
 * exactamente cómo se cuela un permiso que no se decidió. Se nombran, y si alguien los retira, estas
 * pruebas lo cuentan.
 *
 * ⚠️ Ninguna de las dos es una fuga por cascada: los perfiles de puesto **declaran** lo que tienen,
 * uno por uno. Son decisiones nuevas, posteriores, que hay que confirmar.
 */
describe('⚠️ lo que los perfiles de puesto cambian respecto a decisiones anteriores', () => {
  it('⭐ «Administración y Finanzas» REVISA pero no VALIDA: son dos llaves, y la 0.128 queda intacta', () => {
    // 🔑 A primera vista esto parece contradecir la fila 0.128 (§Post-F9.192(1)), que recogió a
    // Daniel textual —*«la validación sólo la doy yo»*— y le quitó las llaves de validar a los cinco
    // perfiles operativos de SISTEMA (ahí siguen quitadas: lo mide `roles-reparto.test.ts`). **No la
    // contradice, y la diferencia es exactamente de qué llave hablamos:**
    //
    //  • `esma.revisar` = AUTORIZAR una partida capturada (abono/descuento/pago) para que entre al
    //    saldo. Ésta SÍ se la dio al área que lleva la cuenta corriente. Confirmado por él.
    //  • `esma.cargo-validar` = fijar la CANTIDAD y el PRECIO reales que se le pagan al maquilero.
    //    Ésta la reservó para sí, y **no se movió**. Es la que su frase protege.
    //
    // Las dos mitades van en la misma prueba a propósito: si algún día alguien "unifica" los dos
    // permisos o le pasa el de validar a este perfil, esta prueba dice en una línea qué se rompió.
    const conRevisar = PERFILES_DE_PUESTO.filter((p) => p.permisos.includes('esma.revisar')).map(
      (p) => p.nombre,
    );
    expect(conRevisar, 'revisar: el área de la cuenta corriente').toEqual([
      'Administración y Finanzas',
    ]);

    const conCargoValidar = PERFILES_DE_PUESTO.filter((p) =>
      p.permisos.includes('esma.cargo-validar'),
    ).map((p) => p.nombre);
    expect(
      conCargoValidar,
      'validar el cargo de maquila es del dueño: ningún perfil de puesto puede llevarlo',
    ).toEqual([]);
  });

  it('⚠️ once llaves declaradas `SOLO_ADMINISTRADOR` las lleva un perfil de puesto', () => {
    // `SOLO_ADMINISTRADOR` dice «ningún perfil reparte esta llave», y para los roles de SISTEMA
    // sigue siendo verdad (lo mide `reparto-de-permisos.test.ts`, que sólo ve `definirRoles()`).
    // Para los perfiles de PUESTO no lo es, y es decisión de Daniel: el área que administra un
    // catálogo maestro lo administra. Las ocho primeras eran DEFAULTS DEL LEAD («catálogo maestro:
    // el `.ver` sí baja, el alta no»), no llaves que él hubiera reservado para sí. Las tres de más
    // —`calidad.administrar-catalogo` (Líder de Calidad), `clientes.administrar` (Gerente de Ventas)
    // y `rc.bandeja-completa` (Producción)— las decidió él en §Post-F9.260 (fila 0.250).
    const soloAdmin = new Set<string>(SOLO_ADMINISTRADOR.map((entrada) => entrada.clave));
    const cruces = PERFILES_DE_PUESTO.flatMap((perfil) =>
      perfil.permisos.filter((clave) => soloAdmin.has(clave)).map((clave) => `${clave}`),
    );
    expect([...new Set(cruces)].sort()).toEqual([
      'avios.administrar',
      'calidad.administrar-catalogo',
      'clientes.administrar',
      'conceptos-pago.administrar',
      'cxc.administrar',
      'cxp.administrar',
      'proveedores.administrar',
      'rc.bandeja-completa',
      'telas.administrar',
      'terceros.administrar',
      'terceros.fiscal',
    ]);
  });

  it('⭐ «Producción» captura la RC SIN la llave de fecha libre: la ventana por fin cierra', () => {
    // 🔑 **Es el primer rol del sistema al que la ventana de captura de la RC le cierra de verdad.**
    // Hasta ahora, los OCHO perfiles heredados que llevan `rc.capturar` llevaban TAMBIÉN
    // `rc.fecha-libre-cumplimiento` (herencia de la cascada), así que la guarda de
    // `dominio/ruta-critica/cumplimiento.ts` no le cerraba a nadie: el mecanismo existía sin morder.
    //
    // ⚠️ Y hay un detalle que conviene tener a la vista, no escondido: Daniel le dio
    // `rc.fechas-retraso`, que es la clave gemela que **NO GOBIERNA NADA** (fila 0.175: el catálogo
    // viejo traía la misma capacidad descrita dos veces y sólo `rc.fecha-libre-cumplimiento` tiene
    // efecto). ✅ **Ya no es una duda: Daniel RECHAZÓ darle `rc.fecha-libre-cumplimiento`**
    // (§Post-F9.260(d), con la explicación delante, incluida la de que `rc.fechas-retraso` no
    // gobierna nada) ⇒ Producción captura la RC sólo dentro de la ventana —los últimos 2 días, nunca
    // a futuro—, y es lo que él quiso. Esta prueba lo fija para que un cambio sea decisión visible.
    const produccion = PERFILES_DE_PUESTO.find((p) => p.nombre === 'Producción');
    expect(produccion, 'falta el perfil Producción').toBeDefined();
    expect(produccion?.permisos as string[]).toContain('rc.capturar');
    expect(produccion?.permisos as string[]).not.toContain('rc.fecha-libre-cumplimiento');
    expect(produccion?.permisos as string[]).toContain('rc.fechas-retraso');

    // Y que siga siendo el ÚNICO en esa situación, para que la afirmación no envejezca sola.
    const capturanSinLlave = [...definirRoles(), ...PERFILES_DE_PUESTO_TODOS]
      .filter(
        (rol) =>
          (rol.permisos as string[]).includes('rc.capturar') &&
          !(rol.permisos as string[]).includes('rc.fecha-libre-cumplimiento'),
      )
      .map((rol) => rol.nombre);
    expect(capturanSinLlave).toEqual(['Producción']);
  });

  it('⭐ …pero NINGUNA de las que Daniel reservó CON SU NOMBRE se movió', () => {
    // Ésta es la otra mitad, y la que de verdad protege algo: lo que él pidió para sí —con cita
    // textual en `SOLO_ADMINISTRADOR`— sigue sólo en su perfil. Si una de éstas apareciera en un
    // perfil de puesto, sería una fuga de verdad, no una decisión nueva.
    const RESERVADAS_CON_SU_NOMBRE = [
      'usuarios.administrar',
      'roles.administrar',
      'empresas.administrar',
      'salida-material.registrar',
      'pagos.corrida-armar',
      'compras.desautorizar',
      // Tres de los cuatro poderes que la fila 0.120 sacó de debajo de `roles.administrar`. El
      // cuarto, `rc.bandeja-completa`, ya NO está aquí: Daniel se lo dio a «Producción» en
      // §Post-F9.260 (fila 0.250) — lo fija la prueba de abajo, y la batería 9.
      'rc.capturar-cualquiera',
      'compras.editar-autorizada',
      'tipos-proceso.marcar-entrada-pt',
    ];
    const fugas = RESERVADAS_CON_SU_NOMBRE.flatMap((clave) =>
      PERFILES_DE_PUESTO.filter((perfil) => (perfil.permisos as string[]).includes(clave)).map(
        (perfil) => `${perfil.nombre} → ${clave}`,
      ),
    );
    expect(
      fugas,
      `Daniel reservó estas llaves para sí, con cita textual en SOLO_ADMINISTRADOR: ${fugas.join(', ')}`,
    ).toEqual([]);

    // Y el dueño sí las lleva todas (por derivación del catálogo): si no, nadie podría.
    for (const clave of RESERVADAS_CON_SU_NOMBRE) {
      expect(PERFIL_DIRECTOR_GENERAL.permisos as string[], clave).toContain(clave);
    }
  });

  it('⭐ `rc.bandeja-completa` salió de las reservadas: la lleva «Producción», y SÓLO ella', () => {
    // Decisión de Daniel (§Post-F9.260): la bandeja de Producción salía VACÍA —no parcial— porque un
    // puesto nace sin roles funcionales de la RC. Es exactamente para lo que la fila 0.120 separó los
    // cuatro poderes en renglones distintos: dar uno sin los otros. Que sea SÓLO Producción es lo
    // que hay que fijar: si se le colara a otro puesto, nadie lo habría decidido.
    const conBandejaCompleta = PERFILES_DE_PUESTO.filter((perfil) =>
      (perfil.permisos as string[]).includes('rc.bandeja-completa'),
    ).map((perfil) => perfil.nombre);
    expect(conBandejaCompleta).toEqual(['Producción']);
    // …y ver la bandeja de todos NO le da capturar por otros: son dos llaves distintas.
    const produccion = PERFILES_DE_PUESTO.find((p) => p.nombre === 'Producción');
    expect(produccion?.permisos as string[]).not.toContain('rc.capturar-cualquiera');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. ⭐⭐ EL PISO DE LECTURA — «Consulta general»
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La FOTO exacta de las 16 llaves del piso, escrita a mano.
 *
 * ⚠️ No se deriva de {@link PERFIL_CONSULTA_GENERAL} a propósito: si se calculara, quitarle o
 * agregarle una llave ajustaría «lo esperado» solo y la prueba no podría fallar nunca. El piso es una
 * decisión del dueño, y una decisión se escribe dos veces para poder cruzarla.
 */
const PISO_DE_LECTURA: readonly string[] = [
  'ordenes.habilitacion',
  'pedidos.ver',
  'rc.catalogo-ver',
  'rc.ruta-ver',
  'calidad.ver',
  'indicadores.ver',
  'almacenes.ver',
  'temporadas.ver',
  'etiquetas-marca.ver',
  'colores.ver',
  'tallas.ver',
  'clientes.ver',
  'tipos-proceso.ver',
  'concepto-costo.ver',
  'estado-lista.ver',
  'produccion.wip-ver',
];

describe('⭐⭐ «Consulta general»: el piso de lectura', () => {
  it('⭐ lleva EXACTAMENTE las 16 llaves que decidió el dueño, en su orden', () => {
    expect(PERFIL_CONSULTA_GENERAL.nombre).toBe('Consulta general');
    expect(PERFIL_CONSULTA_GENERAL.slug).toBe('consulta-general');
    expect(
      [...PERFIL_CONSULTA_GENERAL.permisos],
      'el piso de lectura cambió: son las llaves que el dueño marcó, una por una',
    ).toEqual(PISO_DE_LECTURA);
    expect(PERFIL_CONSULTA_GENERAL.permisos).toHaveLength(16);
  });

  it('todas sus llaves existen en el catálogo, y ninguna repetida', () => {
    const catalogo = new Set<string>(CLAVES_PERMISO);
    const fantasmas = PERFIL_CONSULTA_GENERAL.permisos.filter((clave) => !catalogo.has(clave));
    expect(fantasmas, `el seed reventaría al sembrarlas: ${fantasmas.join(', ')}`).toEqual([]);
    expect(new Set(PERFIL_CONSULTA_GENERAL.permisos).size).toBe(
      PERFIL_CONSULTA_GENERAL.permisos.length,
    );
  });

  it('se siembra por el MISMO camino que los puestos, y NO es rol de sistema', () => {
    // Va en `PERFILES_EDITABLES` (lo que itera `sembrarPerfilesDePuesto`) y NO en `definirRoles()`:
    // si entrara ahí, el deploy se lo re-sincronizaría y el dueño no podría moverlo — que es
    // exactamente lo contrario de lo que pidió («quiero verlo y moverlo desde la pantalla»).
    expect(PERFILES_EDITABLES.map((p) => p.nombre)).toContain('Consulta general');
    expect(PERFILES_EDITABLES).toHaveLength(PERFILES_DE_PUESTO.length + 1);
    expect(definirRoles().map((rol) => rol.nombre)).not.toContain('Consulta general');
  });

  it('su nombre no choca con ningún otro rol que siembre el sistema', () => {
    // Calculado, no a ojo: así se cazó la colisión de «Habilitaciones»/«Entregas».
    const todos = [
      ...definirRoles().map((r) => r.nombre),
      ...PERFILES_DE_PUESTO.map((p) => p.nombre),
      ...ROLES_FUNCIONALES_RC,
    ];
    expect(
      todos.filter((n) => n === 'Consulta general'),
      '«Consulta general» ya existe como otro rol: Rol.nombre es único, se fundiría con él',
    ).toEqual([]);
  });

  it('⭐ NO adelgaza los puestos: las llaves repetidas siguen en su perfil', () => {
    // Los permisos efectivos son la UNIÓN de los roles del usuario, así que la redundancia no cambia
    // el comportamiento — y conservar las marcas del dueño literales es lo que hace que, si el piso
    // encoge, el puesto que de verdad necesitaba la llave la conserve.
    //
    // Medido: 12 de las 16 ya las llevaba algún puesto. Se fija el número para que un "adelgazamiento"
    // silencioso de los perfiles rompa esto.
    const enAlgunPuesto = PISO_DE_LECTURA.filter((clave) =>
      PERFILES_DE_PUESTO.some((p) => (p.permisos as string[]).includes(clave)),
    );
    expect(enAlgunPuesto).toHaveLength(12);
    // Y el total del dueño sigue intacto: el piso NO entra en sus 317 marcas.
    expect(PERFILES_DE_PUESTO_TODOS.map((p) => p.nombre)).not.toContain('Consulta general');
    expect(
      PERFILES_DE_PUESTO.reduce((suma, p) => suma + p.permisos.length, 0),
      'el piso no puede haber recortado las 183 marcas de los puestos',
    ).toBe(183);
  });
});

/**
 * 🔴🔴 **LA INVARIANTE DEL PISO, Y LA ÚNICA QUE DE VERDAD IMPORTA.** El dueño, textual:
 *
 * > *«lo que sea dinero no debe estar en el piso»*
 *
 * El piso reparte consulta a todo el mundo, así que si una llave de DINERO se cuela, el margen, los
 * costos, los saldos de terceros o lo que se le cobra a un cliente quedan a la vista de cualquiera —
 * y no por una decisión, sino por un copiar-y-pegar. Los dos conjuntos tienen que ser **disjuntos**.
 */
describe('🔴 el PISO y el DINERO son conjuntos disjuntos (regla del dueño)', () => {
  it('⭐⭐ ninguna llave de dinero está en el piso de lectura', () => {
    const piso = new Set<string>(PERFIL_CONSULTA_GENERAL.permisos);
    const colados = PERMISOS_DE_DINERO.filter((clave) => piso.has(clave));
    expect(
      colados,
      `DINERO EN EL PISO: ${colados.join(', ')}. El dueño fue explícito —«lo que sea dinero no debe ` +
        `estar en el piso»— y el piso lo ve TODO el mundo: quitar estas llaves de «Consulta ` +
        `general», o sacarlas de PERMISOS_DE_DINERO si de verdad dejaron de serlo (y eso se pregunta).`,
    ).toEqual([]);
  });

  it('la lista de dinero es coherente: existe en el catálogo, sin repetidos y no está vacía', () => {
    // Si PERMISOS_DE_DINERO se vaciara o se llenara de fantasmas, la prueba de arriba pasaría
    // comparando nada contra nada: ésta es la que impide que la invariante se apague en silencio.
    const catalogo = new Set<string>(CLAVES_PERMISO);
    const fantasmas = PERMISOS_DE_DINERO.filter((clave) => !catalogo.has(clave));
    expect(
      fantasmas,
      `PERMISOS_DE_DINERO nombra claves que ya no existen: ${fantasmas.join(', ')}`,
    ).toEqual([]);
    expect(new Set(PERMISOS_DE_DINERO).size).toBe(PERMISOS_DE_DINERO.length);
    expect(PERMISOS_DE_DINERO).toHaveLength(16);
  });

  it('⭐ y el dinero sigue teniendo dueño: lo reparten los puestos que deben, no el piso', () => {
    // La otra mitad: que sacarlo del piso no lo deje sin nadie. Cada llave de dinero la tiene al
    // menos el perfil del dueño (que lleva el catálogo entero).
    for (const clave of PERMISOS_DE_DINERO) {
      expect(PERFIL_DIRECTOR_GENERAL.permisos as string[], clave).toContain(clave);
    }
  });
});

/**
 * 🔴🔴 **LA SEGUNDA RAYA DEL PISO: SALDOS Y MOVIMIENTOS TAMPOCO.** El dueño, de las existencias:
 *
 * > *«creo que no tiene caso»*
 *
 * No son dinero ni son vocabulario del negocio: son **el estado de hoy de un material**, cambian
 * cada día y **responde por ellos quien los mueve**. Por eso van por PUESTO y no de piso — y es
 * inocuo, porque el dueño ya le había dado cada inventario a quien mueve ese material.
 *
 * 🔑 Es una prueba aparte de la del dinero **a propósito**: son dos decisiones distintas, con dos
 * razones distintas y dos citas distintas. Juntarlas en una lista «cosas que no van al piso» haría
 * que borrar una borrara la otra sin que se notara.
 */
describe('🔴 el PISO y los SALDOS Y MOVIMIENTOS son conjuntos disjuntos (regla del dueño)', () => {
  it('⭐⭐ ninguna llave de saldos ni de movimientos está en el piso de lectura', () => {
    const piso = new Set<string>(PERFIL_CONSULTA_GENERAL.permisos);
    const colados = PERMISOS_DE_SALDOS_Y_MOVIMIENTOS.filter((clave) => piso.has(clave));
    expect(
      colados,
      `SALDOS/MOVIMIENTOS EN EL PISO: ${colados.join(', ')}. Existencias de PT, telas y avíos y las ` +
        `notas de salida cambian cada día y responde por ellas QUIEN LAS MUEVE, así que van por ` +
        `puesto, no de piso («creo que no tiene caso», dijo el dueño de las existencias). Si de ` +
        `verdad cambió de opinión, se pregunta y se mueven las dos listas, no una.`,
    ).toEqual([]);
  });

  it('la lista de saldos es coherente: existe en el catálogo, sin repetidos y no está vacía', () => {
    // El gemelo de la de dinero: si la lista se vaciara, la prueba de arriba pasaría comparando nada
    // contra nada y la decisión quedaría apagada en silencio.
    const catalogo = new Set<string>(CLAVES_PERMISO);
    const fantasmas = PERMISOS_DE_SALDOS_Y_MOVIMIENTOS.filter((clave) => !catalogo.has(clave));
    expect(fantasmas, `nombra claves que ya no existen: ${fantasmas.join(', ')}`).toEqual([]);
    expect(new Set(PERMISOS_DE_SALDOS_Y_MOVIMIENTOS).size).toBe(
      PERMISOS_DE_SALDOS_Y_MOVIMIENTOS.length,
    );
    expect(PERMISOS_DE_SALDOS_Y_MOVIMIENTOS).toHaveLength(4);
  });

  it('⭐ y NADIE PIERDE NADA: cada inventario lo sigue llevando quien mueve ese material', () => {
    // Ésta es la mitad que hace inocuo el recorte, y la que hay que medir: si sacar las cuatro del
    // piso dejara un inventario sin ningún puesto que lo vea, la pantalla se quedaría muda para la
    // persona que la usa todos los días. Los conteos son los del reparto del dueño, medidos.
    const cuantosPuestos = (clave: string): number =>
      PERFILES_DE_PUESTO.filter((p) => (p.permisos as string[]).includes(clave)).length;
    expect(cuantosPuestos('inventario-pt.ver'), 'existencias de PT').toBe(5);
    expect(cuantosPuestos('inventario-telas.ver'), 'existencias de telas').toBe(4);
    expect(cuantosPuestos('inventario-avios.ver'), 'existencias de avíos').toBe(2);
    expect(cuantosPuestos('notas.ver'), 'notas de salida').toBe(3);
  });
});

/**
 * 🔴🔴 **LA TERCERA RAYA DEL PISO: las cinco OPERATIVAS QUE FILTRAN UN PRECIO.**
 *
 * El dueño, al cerrarlo: **«Súbelo con 16 ahora»** — después de que el revisor midiera que
 * `telas.ver`, `avios.ver`, `proveedores.ver`, `modelos.ver` y `ordenes.ver` devuelven precios (y
 * datos bancarios) metidos dentro de otros datos, **sin taparlos**.
 *
 * ⚠️ **Es una raya DISTINTA de la del dinero, y por eso es una lista aparte:** las de
 * `PERMISOS_DE_DINERO` son llaves **cuyo propósito es** el dinero y **no entran nunca**; estas cinco
 * son **vocabulario del negocio** que de paso filtra, y **entran el día que sus campos estén
 * tapados**. Juntarlas en una sola lista «cosas que no van al piso» borraría esa diferencia — y con
 * ella, el hecho de que estas cinco tienen una fila pendiente y las otras no.
 */
describe('🔴 el PISO y las cinco que FILTRAN PRECIO son disjuntos (decisión del dueño)', () => {
  it('⭐⭐ ninguna de las cinco está en el piso de lectura', () => {
    const piso = new Set<string>(PERFIL_CONSULTA_GENERAL.permisos);
    const colados = PERMISOS_QUE_FILTRAN_PRECIO.filter((clave) => piso.has(clave));
    expect(
      colados,
      `FILTRAN PRECIO Y ESTÁN EN EL PISO: ${colados.join(', ')}. El piso lo lleva todo el mundo, así ` +
        `que esto pone a la vista de cualquiera el precio sugerido de las telas, el de los avíos, el ` +
        `maquilaBase/corteBase/precioCosteo del modelo, el maquilaReferencia de la orden o los datos ` +
        `bancarios del proveedor — contra la regla del dueño («lo que sea dinero no debe estar en el ` +
        `piso»). Para que vuelvan al piso hay que TAPAR sus campos primero (el patrón existe: ` +
        `puedeVerCostoRealDeModelo, consultas.ver-importes); entonces salen de esta lista.`,
    ).toEqual([]);
  });

  it('la lista es coherente: existe en el catálogo, sin repetidos y no está vacía', () => {
    // El gemelo de las otras dos: si se vaciara, la prueba de arriba pasaría comparando nada contra
    // nada y la decisión del dueño quedaría apagada en silencio.
    const catalogo = new Set<string>(CLAVES_PERMISO);
    const fantasmas = PERMISOS_QUE_FILTRAN_PRECIO.filter((clave) => !catalogo.has(clave));
    expect(fantasmas, `nombra claves que ya no existen: ${fantasmas.join(', ')}`).toEqual([]);
    expect(new Set(PERMISOS_QUE_FILTRAN_PRECIO).size).toBe(PERMISOS_QUE_FILTRAN_PRECIO.length);
    expect(PERMISOS_QUE_FILTRAN_PRECIO).toHaveLength(5);
  });

  it('⭐ y NO son las mismas que las de DINERO: las dos listas no se solapan', () => {
    // Si alguien "unificara" las dos listas, esta prueba dice en una línea qué se perdió: que estas
    // cinco tienen una fila pendiente (tapar los campos) y las de dinero no.
    const dinero = new Set<string>(PERMISOS_DE_DINERO);
    const enLasDos = PERMISOS_QUE_FILTRAN_PRECIO.filter((clave) => dinero.has(clave));
    expect(enLasDos, 'una clave no puede ser a la vez «es dinero» y «de paso filtra»').toEqual([]);
  });

  it('⭐ y SACARLAS no le quitó nada a nadie: cada una ya la tienen los puestos que la usan', () => {
    // 🔑 Esto es lo que hizo que la salida del dueño costara casi nada, y hay que medirlo: si alguna
    // de las cinco NO estuviera repartida por puesto, sacarla del piso dejaría muda una pantalla.
    // `ordenes.ver` la tienen los 15 de 15: sacarla del piso es literalmente inocuo.
    const cuantosPuestos = (clave: string): number =>
      PERFILES_DE_PUESTO.filter((p) => (p.permisos as string[]).includes(clave)).length;
    expect(cuantosPuestos('ordenes.ver'), 'ordenes.ver').toBe(15);
    expect(cuantosPuestos('modelos.ver'), 'modelos.ver').toBe(13);
    expect(cuantosPuestos('proveedores.ver'), 'proveedores.ver').toBe(8);
    expect(cuantosPuestos('telas.ver'), 'telas.ver').toBe(7);
    expect(cuantosPuestos('avios.ver'), 'avios.ver').toBe(5);
  });
});

/**
 * ⭐⭐ **EL GUARDIÁN DEL PISO: que ninguna de sus 16 llaves abra una ESCRITURA.**
 *
 * El piso se reparte a todo el mundo, así que su promesa —«sólo lectura»— no puede quedarse en la
 * intención: el día que alguien cuelgue un `POST`/`PUT`/`PATCH`/`DELETE` de una llave del piso,
 * **todo el mundo podrá escribir eso** y nadie lo habrá decidido. El caso más probable tiene nombre:
 * `ordenes.habilitacion`, cuya descripción en el catálogo *prometía* «Capturar o modificar los avíos
 * de la orden» —herencia del Access— cuando sólo gobierna un `GET`. Ese texto ya se corrigió (y lo fija
 * la última prueba de esta batería), pero la llave sigue invitando a colgarle una escritura.
 *
 * Escanea los `*.rutas.ts` de `src/api` y mide, no supone. Es **una red, no un teorema**: reparte por
 * bloque `app.route({…})` y de ahí saca el `method:` y las claves de su `preHandler:`. Si el día de
 * mañana se declara una ruta de otra forma, esta red no la ve — pero cubre los **666** bloques
 * `app.route` que hay hoy (664 llevan reja de permiso; los 2 restantes no, y son de sesión).
 *
 * 🔴 **Y la red nació ANGOSTA: esto es la segunda versión.** La primera buscaba
 * `conPermiso\('clave'\)` con una regex de una línea, y por ahí se le escapaban DOS formas que el
 * repo usa hoy — con lo que un `POST` escrito así pasaba en verde:
 *
 *  • **`app.conAlgunPermiso('a', 'b')`**, que ni contiene la cadena `conPermiso(` ni cabe en una
 *    línea cuando lleva tres o cuatro claves (14 usos hoy);
 *  • **el guard declarado en variable** —`const captura = app.conAlgunPermiso(…)` y luego
 *    `preHandler: captura`— donde en el bloque de la ruta no hay ninguna clave que leer.
 *
 * Ahora equilibra paréntesis (`clavesDeLlamada`), acepta `con(Algun)?Permiso` y resuelve las
 * variables del archivo. Las dos formas están probadas por mutación, no por inspección.
 */
describe('⭐⭐ guardián: el piso de lectura NO abre ninguna escritura', () => {
  /** `src/` del backend: este archivo vive en `src/datos/`, así que es un nivel arriba. */
  const RAIZ_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  /**
   * El ÚNICO no-GET aceptado, con su razón. Cualquier otro pone esta batería en rojo.
   *
   * ⚠️ Eran DOS: `POST /ordenes/impresos` por `ordenes.ver` (POST sólo porque la lista de ids viaja
   * en el cuerpo). Esa excepción **se retiró al salir `ordenes.ver` del piso**, no por gusto: una
   * excepción que ya no excluye nada es sitio donde alguien mete la siguiente sin pensarlo — y la
   * última prueba de esta batería exige que cada entrada siga siendo de una llave DEL piso.
   */
  const NO_GET_ACEPTADOS: readonly { metodo: string; url: string; clave: string; razon: string }[] =
    [
      {
        metodo: 'POST',
        url: '/indicadores/refrescar',
        clave: 'indicadores.ver',
        razon: 'Encola un refresco de las vistas de KPIs. No es dato del negocio.',
      },
    ];

  function archivosDeRutas(carpeta: string, acumulado: string[] = []): string[] {
    for (const entrada of readdirSync(carpeta)) {
      const completa = path.join(carpeta, entrada);
      if (statSync(completa).isDirectory()) archivosDeRutas(completa, acumulado);
      else if (entrada.endsWith('.rutas.ts')) acumulado.push(completa);
    }
    return acumulado;
  }

  /**
   * Desde el `(` de una llamada, devuelve sus claves entrecomilladas y dónde cierra.
   *
   * Equilibra paréntesis en vez de confiar en una regex de una línea: `conAlgunPermiso` se escribe
   * MULTILÍNEA cuando lleva tres o cuatro claves, y ahí una regex angosta no ve ninguna.
   */
  function clavesDeLlamada(texto: string, inicio: number): { claves: string[]; fin: number } {
    let profundidad = 0;
    let i = inicio;
    for (; i < texto.length; i++) {
      const c = texto[i];
      if (c === '(') profundidad++;
      else if (c === ')') {
        profundidad--;
        if (profundidad === 0) break;
      }
    }
    const cuerpo = texto.slice(inicio + 1, i);
    return { claves: [...cuerpo.matchAll(/'([a-z0-9.-]+)'/g)].map((m) => m[1] ?? ''), fin: i + 1 };
  }

  /** Todas las claves de todas las llamadas `con(Algun)?Permiso(…)` de un fragmento. */
  function clavesDeLasLlamadas(fragmento: string): string[] {
    const claves: string[] = [];
    const re = /\bcon(?:Algun)?Permiso\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(fragmento)) !== null) {
      const { claves: ks, fin } = clavesDeLlamada(fragmento, m.index + m[0].length - 1);
      claves.push(...ks);
      re.lastIndex = fin;
    }
    return claves;
  }

  /** El VALOR de `preHandler:` (hasta la coma de su mismo nivel): una llamada, un id o un arreglo. */
  function valorPreHandler(trozo: string): string {
    const m = /\bpreHandler\s*:/.exec(trozo);
    if (m === null) return '';
    const desde = m.index + m[0].length;
    let profundidad = 0;
    let i = desde;
    for (; i < trozo.length; i++) {
      const c = trozo[i];
      if (c === '(' || c === '[' || c === '{') profundidad++;
      else if (c === ')' || c === ']' || c === '}') {
        if (profundidad === 0) break;
        profundidad--;
      } else if (c === ',' && profundidad === 0) break;
    }
    return trozo.slice(desde, i);
  }

  /** `url:` resuelta: literal, plantilla o constante del archivo (`url: BASE`). */
  function urlDelTrozo(trozo: string, constantes: Map<string, string>): string {
    const m = /url:\s*([^\n]*)/.exec(trozo);
    if (m === null) return '(sin url)';
    const bruto = (m[1] ?? '').trim().replace(/,$/, '');
    if (/^'[^']*'$/.test(bruto)) return bruto.slice(1, -1);
    const plantilla = bruto
      .replace(/^`|`$/g, '')
      .replace(/\$\{([A-Za-z_$][\w$]*)\}/g, (_todo, n: string) => constantes.get(n) ?? `\${${n}}`);
    return constantes.get(plantilla) ?? plantilla;
  }

  /** Cada endpoint que una llave del piso guarda: {método, url, clave}. */
  function endpointsDelPiso(): { metodo: string; url: string; clave: string }[] {
    const piso = new Set<string>(PERFIL_CONSULTA_GENERAL.permisos);
    const hallazgos: { metodo: string; url: string; clave: string }[] = [];
    for (const archivo of archivosDeRutas(path.join(RAIZ_SRC, 'api'))) {
      const texto = readFileSync(archivo, 'utf8');

      // (a) Guards declarados en VARIABLE: `const captura = app.conAlgunPermiso(…)`, y luego
      //     `preHandler: captura`. Sin resolverlos, esas rutas quedan sin ninguna clave.
      const porVariable = new Map<string, string[]>();
      const reVar =
        /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*app\.con(?:Algun)?Permiso\s*\(/g;
      let mv: RegExpExecArray | null;
      while ((mv = reVar.exec(texto)) !== null) {
        const { claves, fin } = clavesDeLlamada(texto, reVar.lastIndex - 1);
        porVariable.set(mv[1] ?? '', claves);
        reVar.lastIndex = fin;
      }
      // (b) Constantes de texto, para que `url: BASE` se lea en el mensaje de error.
      const constantes = new Map<string, string>(
        [...texto.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*'([^']*)'/g)].map((m) => [
          m[1] ?? '',
          m[2] ?? '',
        ]),
      );

      for (const trozo of texto.split(/app\.route\(\{/).slice(1)) {
        const metodo = /method:\s*'([A-Z]+)'/.exec(trozo)?.[1] ?? '(sin method)';
        const url = urlDelTrozo(trozo, constantes);
        const preHandler = valorPreHandler(trozo);
        const claves = new Set<string>(clavesDeLasLlamadas(preHandler));
        for (const [nombre, ks] of porVariable) {
          if (new RegExp(`\\b${nombre}\\b`).test(preHandler)) for (const k of ks) claves.add(k);
        }
        for (const clave of claves) {
          if (piso.has(clave)) hallazgos.push({ metodo, url, clave });
        }
      }
    }
    return hallazgos;
  }

  it('⭐⭐ todo endpoint guardado por una llave del piso es GET, salvo el ÚNICO declarado', () => {
    const noGet = endpointsDelPiso()
      .filter((e) => e.metodo !== 'GET')
      .map((e) => `${e.metodo} ${e.url} [${e.clave}]`)
      .sort();
    const esperados = NO_GET_ACEPTADOS.map((e) => `${e.metodo} ${e.url} [${e.clave}]`).sort();

    expect(
      noGet,
      `Una llave del PISO DE LECTURA guarda una ESCRITURA. El piso lo lleva todo el mundo, así que ` +
        `esto le da esa escritura a todo el mundo sin que nadie lo haya decidido. O el endpoint va ` +
        `con otro permiso, o la llave sale del piso, o —si de verdad no muta nada— se declara en ` +
        `NO_GET_ACEPTADOS con su razón escrita.`,
    ).toEqual(esperados);
  });

  it('la red mide algo: encuentra los 93 endpoints del piso y ninguna llave queda muerta', () => {
    // Sin esto, un escaneo que dejara de encontrar rutas (un cambio de forma en los routers, una
    // carpeta movida) pasaría en verde comparando listas vacías — y el guardián de arriba quedaría
    // de adorno, que es la cicatriz del localizador laxo del 7-sep.
    //
    // 🔴 **Y ESTE CANARIO YA SE QUEDÓ CORTO UNA VEZ, por eso son DOS cifras.** La primera versión
    // de la red buscaba `conPermiso\('clave'\)` con una regex de una línea: no veía
    // `conAlgunPermiso` —que se escribe multilínea cuando lleva tres claves— ni los guards
    // declarados en variable, y el canario anclado a ese número **bendecía su propio punto ciego**:
    // un `POST` escrito con `conAlgunPermiso` pasaba en verde. Desde el arreglo se fijan las DOS
    // cifras: los endpoints distintos dicen cuánto abre el piso, y los pares cazan que la red deje
    // de resolver una de las formas (los pares bajan y los distintos no, o al revés).
    //
    // Medido con el piso de 16: **93 endpoints distintos** y **96 pares (endpoint, clave)**.
    const hallazgos = endpointsDelPiso();
    const endpointsDistintos = new Set(hallazgos.map((e) => `${e.metodo} ${e.url}`));
    expect(endpointsDistintos.size, 'el escaneo dejó de encontrar rutas: revisa la red').toBe(93);
    expect(
      hallazgos.length,
      'cambió el número de pares (endpoint, clave): si bajó, la red dejó de resolver una forma de guard',
    ).toBe(96);
    const conRuta = new Set(hallazgos.map((e) => e.clave));
    const muertas = PISO_DE_LECTURA.filter((clave) => !conRuta.has(clave));
    expect(
      muertas,
      `llaves del piso que no guardan ningún endpoint: ${muertas.join(', ')}`,
    ).toEqual([]);
  });

  it('⭐⭐ la red ve TODAS las rutas: 666 bloques y 664 con reja de permiso', () => {
    // 🔴 **ESTO ES LO QUE CONVIERTE LA RED EN REJA.** Las pruebas de arriba miran sólo las rutas del
    // PISO: si la red dejara de reconocer una forma de declarar el guard, esas rutas desaparecerían
    // de su vista y el guardián se pondría **verde por ceguera** — exactamente lo que pasó con
    // `conAlgunPermiso`. Aquí se cuenta sobre el TOTAL: cualquier forma que la red no vea saca
    // bloques de los 664 y esto se pone **rojo en vez de callarse**.
    //
    // Medido: **666** bloques `app.route`, **664** con al menos una clave de permiso y **2** sin
    // ninguna (de sesión). Si el total cambia porque se agregaron rutas, se actualiza; si cambia la
    // PROPORCIÓN sin que nadie haya tocado rutas, es que la red dejó de ver algo.
    let bloques = 0;
    let conReja = 0;
    for (const archivo of archivosDeRutas(path.join(RAIZ_SRC, 'api'))) {
      const texto = readFileSync(archivo, 'utf8');
      const porVariable = new Map<string, string[]>();
      const reVar =
        /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*app\.con(?:Algun)?Permiso\s*\(/g;
      let mv: RegExpExecArray | null;
      while ((mv = reVar.exec(texto)) !== null) {
        const { claves, fin } = clavesDeLlamada(texto, reVar.lastIndex - 1);
        porVariable.set(mv[1] ?? '', claves);
        reVar.lastIndex = fin;
      }
      for (const trozo of texto.split(/app\.route\(\{/).slice(1)) {
        bloques++;
        const preHandler = valorPreHandler(trozo);
        const tieneReja =
          clavesDeLasLlamadas(preHandler).length > 0 ||
          [...porVariable].some(
            ([nombre, ks]) => ks.length > 0 && new RegExp(`\\b${nombre}\\b`).test(preHandler),
          );
        if (tieneReja) conReja++;
      }
    }
    expect(bloques, 'cambió el número de rutas del API').toBe(666);
    expect(
      conReja,
      'bajó el número de rutas con reja de permiso: o alguien le quitó el guard a una ruta, o la ' +
        'red dejó de reconocer una forma de declararlo (y entonces el guardián del piso está ciego)',
    ).toBe(664);
  });

  it('⭐ y lo que el dueño LEE tampoco promete escritura: la descripción de cada llave del piso', () => {
    // 🔑 **La otra mitad del guardián, y la que vive donde se toma la decisión.** El de arriba mide
    // las RUTAS; ésta mide el TEXTO que la pantalla de Roles pinta al lado de la casilla. `prueba`
    // puede tener las rutas perfectas y, aun así, un renglón que dice *«Capturar o modificar…»*
    // dentro de un rol llamado «Consulta general» lleva a una decisión mal tomada — y nadie lee el
    // catálogo antes de palomear una casilla, lee la casilla.
    //
    // ⚠️ El caso real: `ordenes.habilitacion` tenía exactamente ese texto, transcrito del acceso #31
    // del Access, prometiendo una escritura que en v2 nunca existió. Se corrigió en
    // `src/contrato/permisos.ts` con su nota; esto impide que vuelva.
    const VERBOS_DE_ESCRITURA =
      /\b(capturar|modificar|administrar|dar de alta|cancelar|borrar|autorizar|aprobar)\b/i;
    const piso = new Set<string>(PERFIL_CONSULTA_GENERAL.permisos);
    const prometenEscribir = CATALOGO_PERMISOS.filter(
      (permiso) => piso.has(permiso.clave) && VERBOS_DE_ESCRITURA.test(permiso.descripcion),
    ).map((permiso) => `${permiso.clave}: "${permiso.descripcion}"`);

    expect(
      prometenEscribir,
      `Una llave del PISO DE LECTURA se describe con un verbo de ESCRITURA, y ese texto es lo que el ` +
        `dueño lee al palomear la casilla en Administración › Roles — dentro de un rol que se llama ` +
        `«Consulta general». O la descripción miente (corrígela, como se hizo con ` +
        `ordenes.habilitacion) o la llave no es de lectura y no va en el piso.`,
    ).toEqual([]);
  });

  it('cada no-GET aceptado trae su razón escrita (y no son un basurero)', () => {
    for (const entrada of NO_GET_ACEPTADOS) {
      expect(entrada.razon.trim().length, `${entrada.url} sin razón`).toBeGreaterThan(20);
      expect(
        PERFIL_CONSULTA_GENERAL.permisos as string[],
        `${entrada.clave} ya no está en el piso: sobra su excepción`,
      ).toContain(entrada.clave);
    }
    expect(NO_GET_ACEPTADOS).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. ⭐⭐ LAS 17 DECISIONES DE DANIEL SOBRE EL REPARTO (§Post-F9.260, fila 0.250)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Las **11 llaves que ACEPTÓ**, puesto por puesto, escritas a mano.
 *
 * ⚠️ No se derivan de {@link PERFILES_DE_PUESTO} por el mismo motivo que la foto de arriba: es la
 * contraparte independiente. La foto de la batería 1 dice qué lleva HOY cada puesto; esta lista dice
 * cuáles de esas llaves son las de ESTA decisión — si mañana Daniel mueve un puesto en otra fila, la
 * foto cambia, pero lo que él aceptó y rechazó aquí sigue escrito y medido.
 */
const ACEPTADAS_EN_POST_F9_260: readonly { puesto: string; clave: string }[] = [
  { puesto: 'Encargado de Telas', clave: 'compras.ver' },
  { puesto: 'Producción', clave: 'compras.ver' },
  { puesto: 'Producción', clave: 'rc.bandeja-completa' },
  { puesto: 'Supervisor de Calidad', clave: 'calidad.generar-auditorias' },
  { puesto: 'Habilitaciones', clave: 'compras.recibir' },
  { puesto: 'Habilitaciones', clave: 'compras.ver' },
  { puesto: 'Líder de Calidad', clave: 'calidad.administrar-catalogo' },
  { puesto: 'Gerente de Ventas', clave: 'clientes.administrar' },
  { puesto: 'Compras', clave: 'proveedores.administrar' },
  { puesto: 'Compras', clave: 'compras.cancelar' },
  { puesto: 'Almacén de Producto Terminado', clave: 'produccion.empaque' },
];

/**
 * Las **6 que RECHAZÓ**. Que no estén es tan decisión suya como que las otras sí: una recomendación
 * rechazada que reaparece en un perfil es un permiso que nadie dio.
 */
const RECHAZADAS_EN_POST_F9_260: readonly { puesto: string; clave: string }[] = [
  // Le advertí que son de OPERAR los indicadores de Ingeniería de Producto, no de verlos.
  { puesto: 'Desarrollo de Producto', clave: 'indicadores.ip-productividad' },
  { puesto: 'Desarrollo de Producto', clave: 'indicadores.ip-confiabilidad' },
  { puesto: 'Desarrollo de Producto', clave: 'indicadores.ip-muestrarios' },
  // Su regla del dinero. ⚠️ El efecto colateral de `edr.ver` (Administración se queda sin la
  // pantalla de facturación) es la fila 0.251, no un motivo para dársela aquí.
  { puesto: 'Administración y Finanzas', clave: 'costos.ver' },
  { puesto: 'Administración y Finanzas', clave: 'edr.ver' },
  // Producción captura la RC sólo dentro de la ventana (§Post-F9.260(d)).
  { puesto: 'Producción', clave: 'rc.fecha-libre-cumplimiento' },
];

describe('⭐⭐ las 17 decisiones de Daniel sobre el reparto (§Post-F9.260)', () => {
  const perfilDe = (nombre: string): readonly string[] => {
    const perfil = PERFILES_DE_PUESTO.find((p) => p.nombre === nombre);
    expect(perfil, `falta el perfil de puesto «${nombre}»`).toBeDefined();
    return perfil?.permisos ?? [];
  };

  it('son 11 aceptadas y 6 rechazadas, todas del catálogo y ninguna en las dos listas', () => {
    // Sanidad de las dos listas: si se vaciaran o nombraran fantasmas, las pruebas de abajo
    // pasarían comparando nada contra nada.
    expect(ACEPTADAS_EN_POST_F9_260).toHaveLength(11);
    expect(RECHAZADAS_EN_POST_F9_260).toHaveLength(6);
    const catalogo = new Set<string>(CLAVES_PERMISO);
    const todas = [...ACEPTADAS_EN_POST_F9_260, ...RECHAZADAS_EN_POST_F9_260];
    const fantasmas = todas.filter((d) => !catalogo.has(d.clave)).map((d) => d.clave);
    expect(fantasmas, `claves que ya no existen: ${fantasmas.join(', ')}`).toEqual([]);
    const llave = (d: { puesto: string; clave: string }): string => `${d.puesto} → ${d.clave}`;
    const aceptadas = new Set(ACEPTADAS_EN_POST_F9_260.map(llave));
    expect(RECHAZADAS_EN_POST_F9_260.map(llave).filter((k) => aceptadas.has(k))).toEqual([]);
    expect(aceptadas.size, 'hay una aceptada repetida').toBe(11);
  });

  it.each(ACEPTADAS_EN_POST_F9_260)('✅ $puesto lleva $clave (la aceptó)', ({ puesto, clave }) => {
    expect(
      perfilDe(puesto),
      `Daniel aceptó darle ${clave} a «${puesto}» (§Post-F9.260) y el perfil no la lleva`,
    ).toContain(clave);
  });

  it.each(RECHAZADAS_EN_POST_F9_260)(
    '⛔ $puesto NO lleva $clave (la rechazó)',
    ({ puesto, clave }) => {
      expect(
        perfilDe(puesto),
        `Daniel RECHAZÓ darle ${clave} a «${puesto}» (§Post-F9.260): que esté es un permiso que ` +
          `nadie dio`,
      ).not.toContain(clave);
    },
  );

  it('las llaves muertas que Ventas y Compras ya tenían siguen ahí (quitarlas es la fila 0.244)', () => {
    // `clientes.modificar` y `proveedores.modificar` no gobiernan nada —por eso Daniel les dio la
    // `.administrar`—, pero retirarlas es OTRA fila y OTRA decisión. Esta prueba mide SÓLO esas dos
    // llaves; que agregar las 11 no le quitó NADA a ningún puesto lo mide la foto completa de la
    // batería 1 (`DECISION_DE_DANIEL`), llave por llave.
    expect(perfilDe('Gerente de Ventas')).toContain('clientes.modificar');
    expect(perfilDe('Compras')).toContain('proveedores.modificar');
  });
});
