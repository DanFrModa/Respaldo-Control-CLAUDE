/**
 * ⛔ EL REPARTO DE PERMISOS: que nadie herede por silencio, y que nada quede sin dueño.
 *
 * Daniel, 3-sep-2026, mandando quitar la cascada del seed:
 *
 * > *«Los permisos por cascada no son funcionales. Así lo hice en la primera versión que hice en
 * > Access, y luego lo modifiqué por **permisos concretos**… puede haber alguien que tenga el
 * > permiso A pero no el B, y otra persona que tenga el B pero no el A. Si se hace por cascada nos
 * > vamos a tener que conformar con que **algunas personas accedan a cosas que no deberían**.»*
 *
 * El defecto era un guardián AL REVÉS: **el silencio OTORGABA**. Un permiso nuevo entraba al
 * catálogo, caía en `todos` y —si nadie se acordaba de restárselo a alguien— bajaba solo por la
 * cadena `sin(…)` hasta `Secretarial`. Así aterrizó `esma.cargo-validar` en un perfil clerical sin
 * que nadie lo decidiera.
 *
 * Este archivo tiene TRES baterías, y hacen cosas distintas a propósito:
 *
 * | Batería | Qué caza | Cuándo debe fallar |
 * |---|---|---|
 * | **ATRIBUCIÓN** | que ninguna clave quede sin dueño, y que ningún perfil nombre claves fantasma | al agregar un permiso al catálogo y no repartirlo · al dejar en un perfil una clave que el catálogo ya no tiene |
 * | **EQUIVALENCIA** | que nadie se mueva de sitio salvo por un retiro DECLARADO | al mover de perfil cualquiera de las 122 claves del 3-sep-2026 sin escribirlo en {@link RETIRADOS_DESDE_LA_FOTO} |
 * | **LO NACIDO DESPUÉS** | que un permiso posterior a la foto también cueste una decisión escrita | al agregar un permiso al catálogo sin declararlo en {@link NUEVOS_DESDE_LA_FOTO} |
 *
 * 🔑 Las dos listas declarativas son simétricas y contestan la misma pregunta por los dos lados:
 * {@link NUEVOS_DESDE_LA_FOTO} dice **a quién se le DIO** un permiso nuevo y por qué;
 * {@link RETIRADOS_DESDE_LA_FOTO} dice **a quién se le QUITÓ** uno viejo y por qué. Sin la segunda,
 * recortar el reparto obligaba a reescribir la foto —o sea, a borrar la evidencia del cambio—.
 *
 * ⚠️ La de EQUIVALENCIA es una FOTO del 3-sep-2026 y **no se retoca**: es el registro de lo que
 * había ese día. Cuando el reparto cambie de verdad, el cambio se escribe ENCIMA de ella —en
 * {@link RETIRADOS_DESDE_LA_FOTO}—, que es lo que hace que cambiar quién puede qué **cueste una
 * decisión visible** sin borrar la evidencia de cómo estaba antes. Habla SÓLO de las 122 claves que
 * existían ese día: un permiso posterior no le incumbe (de ése se encargan la de ATRIBUCIÓN y la de
 * LO NACIDO DESPUÉS), para que agregar permisos no obligue a retocar la foto y acabe volviéndola un
 * trámite que alguien borra.
 *
 * Está escrita en la forma VIEJA (un catálogo congelado menos cuatro listas de recortes), que es
 * como estaba el seed antes de voltearlo; el seed hoy lo dice al revés (listas explícitas de lo que
 * cada perfil TIENE). Que las dos formas coincidan es la prueba de que la transcripción fue fiel.
 *
 * Es PURA (`definirRoles` no toca la base), así que corre en el proyecto `unit`, sin Docker.
 *
 * 🔴 **EL HUECO QUE ESO DEJABA, Y CÓMO SE CIERRA.** Medido por el reviewer el 3-sep: con sólo las
 * dos primeras baterías, agregar `nomina.ver-sueldos` al catálogo y dárselo **únicamente a
 * `Secretarial`** pasaba en verde, y dárselo a **`Basico`** —el perfil cuyo significado entero es
 * *no tener acceso*— también. La atribución sólo pregunta *«¿tiene UN dueño?»*, nunca *«¿es el
 * dueño correcto?»*, y la foto no puede opinar porque la clave no es una de sus 122. Por eso la
 * tercera batería: un permiso nacido después **se declara en {@link NUEVOS_DESDE_LA_FOTO} con su
 * `razon` obligatoria por el tipo** —el mismo patrón de `SOLO_ADMINISTRADOR`—, y `Basico` se fija
 * aparte **en CERO permisos**, que es su definición y no depende de ninguna foto.
 *
 * 📌 Lo que esta prueba NO hace: juzgar si el reparto de hoy es el bueno. No lo es —76 de los 122
 * permisos nunca se le restaron a nadie, así que `Secretarial` arrastra cosas como
 * `compras.autorizar` o `notas.cancelar`—. Daniel decidió armar los perfiles concretos AL FINAL,
 * con los puestos reales de sus 23 usuarios; esta prueba es la que hace que ese recorte se note
 * renglón por renglón. El primero ya se hizo: `esma.cargo-validar` (fila 0.128), que era
 * precisamente el ejemplo con el que arriba se explica el defecto de la cascada.
 */
import { describe, expect, it } from 'vitest';

import { definirRoles, PERFILES_ACCESO_TOTAL, SOLO_ADMINISTRADOR } from '../../prisma/seed.js';
import { CLAVES_PERMISO, type ClavePermiso } from '../contrato/index.js';

/** Los perfiles que declaran permisos uno por uno (todos menos los dos de acceso total). */
function perfilesExplicitos(): { nombre: string; permisos: ClavePermiso[] }[] {
  const total: readonly string[] = PERFILES_ACCESO_TOTAL;
  return definirRoles().filter((rol) => !total.includes(rol.nombre));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. ATRIBUCIÓN — nada sin dueño, y nadie nombrando fantasmas
// ─────────────────────────────────────────────────────────────────────────────

describe('⛔ atribución de permisos: el silencio NIEGA (Daniel, 3-sep-2026)', () => {
  it('⭐ NINGUNA clave del catálogo se queda sin dueño', () => {
    // Se excluye a Administrador/AdministracionDireccion A PROPÓSITO: llevan el catálogo entero,
    // así que si contaran, la unión sería siempre todo y esta prueba no podría fallar jamás.
    const conDueno = new Set<string>(perfilesExplicitos().flatMap((rol) => rol.permisos));
    for (const entrada of SOLO_ADMINISTRADOR) {
      conDueno.add(entrada.clave);
    }
    const huerfanas = CLAVES_PERMISO.filter((clave) => !conDueno.has(clave));

    expect(
      huerfanas,
      `Estas claves del catálogo no las otorga NINGÚN perfil y tampoco están declaradas en ` +
        `SOLO_ADMINISTRADOR: ${huerfanas.join(', ')}.\n` +
        `Un permiso nuevo NO nace en nadie: decide en prisma/seed.ts a qué perfiles pertenece, o ` +
        `déjalo sólo para el administrador agregándolo a SOLO_ADMINISTRADOR con su razón escrita.`,
    ).toEqual([]);
  });

  it('⭐ …y a la inversa: ningún perfil nombra una clave que el catálogo ya no tiene', () => {
    // La rama gemela, y la que se olvida: al borrar o renombrar un permiso en src/contrato, la
    // clave vieja se queda en el seed sin que nada la mire (el `throw` de `sembrarRoles` sólo
    // aparece corriendo el seed contra una base de verdad, o sea en el deploy).
    const catalogo = new Set<string>(CLAVES_PERMISO);
    const nombradas = new Set<string>([
      ...perfilesExplicitos().flatMap((rol) => rol.permisos as string[]),
      ...SOLO_ADMINISTRADOR.map((entrada) => entrada.clave as string),
    ]);
    const fantasmas = [...nombradas].filter((clave) => !catalogo.has(clave)).sort();

    expect(
      fantasmas,
      `El seed reparte claves que YA NO EXISTEN en el catálogo de src/contrato: ` +
        `${fantasmas.join(', ')}.\nQuítalas de su perfil (o de SOLO_ADMINISTRADOR): el seed ` +
        `reventaría al sembrarlas.`,
    ).toEqual([]);
  });

  it('cada clave de SOLO_ADMINISTRADOR trae su razón escrita, y sólo aparece una vez', () => {
    // La razón es lo que separa «decidimos que es sólo del administrador» de «se nos olvidó
    // repartirlo». Sin ella, la lista se convierte en el basurero donde muere lo no decidido.
    for (const entrada of SOLO_ADMINISTRADOR) {
      expect(entrada.razon.trim().length, `${entrada.clave} sin razón`).toBeGreaterThan(20);
    }
    const claves = SOLO_ADMINISTRADOR.map((entrada) => entrada.clave);
    expect(claves.length, 'hay claves repetidas en SOLO_ADMINISTRADOR').toBe(new Set(claves).size);
  });

  it('lo declarado SOLO_ADMINISTRADOR no se cuela por la puerta de atrás en un perfil', () => {
    // Si una clave está en las dos listas, la declaración miente: el permiso sí lo tiene alguien
    // más y la razón escrita ya no describe la realidad.
    const soloAdmin = new Set<string>(SOLO_ADMINISTRADOR.map((entrada) => entrada.clave));
    for (const perfil of perfilesExplicitos()) {
      const contradicciones = perfil.permisos.filter((clave) => soloAdmin.has(clave));
      expect(
        contradicciones,
        `${perfil.nombre} otorga claves declaradas SOLO_ADMINISTRADOR`,
      ).toEqual([]);
    }
  });

  it('los dos perfiles de acceso total sí llevan el catálogo COMPLETO', () => {
    // Es la premisa que justifica excluirlos de la prueba de huérfanas: si alguno dejara de
    // llevarlo todo, excluirlo abriría un agujero silencioso.
    for (const nombre of PERFILES_ACCESO_TOTAL) {
      const rol = definirRoles().find((r) => r.nombre === nombre);
      expect(rol, `no existe el perfil "${nombre}"`).toBeDefined();
      expect([...(rol?.permisos ?? [])].sort(), nombre).toEqual([...CLAVES_PERMISO].sort());
    }
  });

  it('ningún perfil repite una clave (una lista literal invita a duplicar sin darse cuenta)', () => {
    for (const rol of definirRoles()) {
      const repetidas = rol.permisos.filter((clave, i) => rol.permisos.indexOf(clave) !== i);
      expect(repetidas, `${rol.nombre} repite claves`).toEqual([]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. EQUIVALENCIA — la foto del reparto al voltear el seed (3-sep-2026)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El catálogo COMPLETO tal como estaba el 3-sep-2026 (122 claves), congelado a mano.
 *
 * ⚠️ NO se lee de `CLAVES_PERMISO` a propósito: si la foto creciera sola con el catálogo, un
 * permiso nuevo aparecería como «esperado» en cinco perfiles y la prueba de equivalencia
 * bendeciría exactamente la herencia por silencio que este cambio vino a matar.
 */
const CATALOGO_AL_3_SEP: readonly string[] = [
  'admin.ver-bitacora',
  'almacenes.administrar',
  'almacenes.ver',
  'avios.administrar',
  'avios.ver',
  'calidad.actualizar-auditorias',
  'calidad.administrar-catalogo',
  'calidad.generar-auditorias',
  'calidad.modificar-auditorias',
  'calidad.ver',
  'clientes.administrar',
  'clientes.modificar',
  'clientes.ver',
  'colores.administrar',
  'colores.ver',
  'compras.administrar',
  'compras.autorizar',
  'compras.cancelar',
  'compras.desautorizar',
  'compras.recibir',
  'compras.ver',
  'concepto-costo.administrar',
  'concepto-costo.ver',
  'consultas.ver-importes',
  'costos.capturar',
  'costos.ver',
  'cxc.administrar',
  'cxc.ver',
  'cxp.administrar',
  'cxp.ver',
  'desarrollo.administrar',
  'desarrollo.precostear',
  'desarrollo.ver',
  'edr.capturar',
  'edr.ver',
  'empresas.administrar',
  'esma.cargo-validar',
  'esma.modificar',
  'esma.ver-pagos',
  'estado-lista.administrar',
  'estado-lista.ver',
  'etiquetas-marca.administrar',
  'etiquetas-marca.ver',
  'etiquetas.modificar',
  'indicadores.almacen-productividad',
  'indicadores.ciclicos-alta',
  'indicadores.ciclicos-consulta',
  'indicadores.ciclicos-conteo',
  'indicadores.fecha-libre',
  'indicadores.ip-confiabilidad',
  'indicadores.ip-muestrarios',
  'indicadores.ip-productividad',
  'indicadores.ver',
  'inventario-avios.mover',
  'inventario-avios.ver',
  'inventario-pt.mover',
  'inventario-pt.ver',
  'inventario-telas.mover',
  'inventario-telas.ver',
  'ipt.cantidades-negativas',
  'ipt.clasificar-modelos',
  'ipt.consultar-existencias',
  'ipt.fecha-libre',
  'ipt.modificar-movimientos',
  'listas.administrar',
  'listas.aprobar',
  'listas.negociar',
  'listas.ver',
  'modelos.administrar',
  'modelos.aprobar-receta',
  'modelos.ver',
  'notas.administrar',
  'notas.cancelar',
  'notas.ver',
  'ordenes.administrar',
  'ordenes.cancelar',
  'ordenes.habilitacion',
  'ordenes.modificar',
  'ordenes.precio-maquila',
  'ordenes.ver',
  'ordenes.ver-costos',
  'ordenes.ver-precio-real-maquila',
  'pedidos-reales.administrar',
  'pedidos.administrar',
  'pedidos.importes',
  'pedidos.modificar',
  'pedidos.modificar-reales',
  'pedidos.ver',
  'precostos.consultar',
  'produccion.cancelar',
  'produccion.corte',
  'produccion.corte-salidas',
  'produccion.empaque',
  'produccion.entradas-maquila',
  'produccion.entrega',
  'produccion.envio',
  'produccion.recibo',
  'produccion.wip-ver',
  'proveedores.administrar',
  'proveedores.modificar',
  'proveedores.ver',
  'rc.capturar',
  'rc.catalogo-administrar',
  'rc.catalogo-ver',
  'rc.fecha-libre-cumplimiento',
  'rc.fechas-retraso',
  'rc.programar',
  'rc.ruta-ver',
  'rc.ver-botones',
  'roles.administrar',
  'tallas.administrar',
  'tallas.ver',
  'telas.administrar',
  'telas.ver',
  'telas.ver-totales',
  'temporadas.administrar',
  'temporadas.ver',
  'terceros.administrar',
  'terceros.fiscal',
  'terceros.ver',
  'tipos-proceso.administrar',
  'tipos-proceso.ver',
  'usuarios.administrar',
];

/** Lo que la cascada le restaba al nivel 30 (quedaba sólo en Administrador/AdministracionDireccion). */
const RESTA_DIRECTIVO: readonly string[] = [
  'almacenes.administrar',
  'avios.administrar',
  'calidad.administrar-catalogo',
  'clientes.administrar',
  'colores.administrar',
  'compras.desautorizar',
  'concepto-costo.administrar',
  'cxc.administrar',
  'cxp.administrar',
  'empresas.administrar',
  'estado-lista.administrar',
  'etiquetas-marca.administrar',
  'proveedores.administrar',
  'rc.catalogo-administrar',
  'roles.administrar',
  'tallas.administrar',
  'telas.administrar',
  'temporadas.administrar',
  'terceros.administrar',
  'terceros.fiscal',
  'tipos-proceso.administrar',
  'usuarios.administrar',
];

/** Lo que la cascada le restaba al nivel 40 sobre Directivo: el RESULTADO del negocio. */
const RESTA_GERENCIAL: readonly string[] = [
  'costos.capturar',
  'costos.ver',
  'edr.capturar',
  'edr.ver',
  'listas.aprobar',
  'ordenes.ver-costos',
];

/** Lo que la cascada le restaba al nivel 45 sobre Gerencial: importes, finanzas y desarrollo. */
const RESTA_VENTAS: readonly string[] = [
  'consultas.ver-importes',
  'cxc.ver',
  'cxp.ver',
  'indicadores.ver',
  'listas.negociar',
  'modelos.administrar',
  'modelos.aprobar-receta',
  'pedidos.importes',
  'terceros.ver',
];

/** Lo que la cascada le restaba al nivel 47 sobre Ventas: órdenes y pre-venta. */
const RESTA_LOGISTICA: readonly string[] = [
  'desarrollo.administrar',
  'desarrollo.precostear',
  'listas.administrar',
  'ordenes.administrar',
  'ordenes.cancelar',
  'ordenes.modificar',
  'ordenes.precio-maquila',
  'ordenes.ver-precio-real-maquila',
  'precostos.consultar',
];

/**
 * ✂️ **RETIROS deliberados POSTERIORES a la foto** — el otro lado de {@link NUEVOS_DESDE_LA_FOTO}.
 *
 * La foto del 3-sep-2026 dice qué tenía cada perfil ESE DÍA, y se compara contra ella justamente
 * para que mover a alguien de sitio **cueste una decisión visible**. Pero «visible» no puede querer
 * decir «reescribe la foto y ya»: si se editaran las listas de resta —que describen lo que hacía la
 * cascada, un hecho histórico— la foto empezaría a mentir sobre el pasado y dejaría de poder
 * distinguir un recorte decidido de un accidente.
 *
 * Por eso los recortes viven aquí, **encima** de la foto: la foto sigue diciendo la verdad de aquel
 * día, y esta lista dice qué se le quitó a quién DESPUÉS, con su razón escrita (obligatoria por el
 * tipo, igual que en `SOLO_ADMINISTRADOR`). Quitarle un permiso a un perfil sin declararlo aquí
 * hace fallar la equivalencia; declarar un retiro que el seed no hizo hace fallar la coherencia.
 */
const RETIRADOS_DESDE_LA_FOTO: readonly {
  clave: ClavePermiso;
  perfiles: readonly string[];
  razon: string;
}[] = [
  {
    clave: 'esma.cargo-validar',
    perfiles: ['Gerencial', 'Ventas', 'Logistica', 'Asistente', 'Secretarial'],
    razon:
      'Fila 0.128 — DANIEL, 4-sep-2026 (§Post-F9.192(1)): *«La entrada la da la persona ' +
      'responsable de recibos o de producción. Pero la validación sólo la doy yo.»* Validar el ' +
      'cargo es fijar la cantidad y el precio REALES que se le van a pagar al maquilero. Queda en ' +
      'el administrador y en Directivo (el círculo del dueño). Era, además, el ejemplo con el que ' +
      'se explicaba el defecto de la cascada: aterrizó en un perfil clerical sin que nadie lo ' +
      'decidiera, y aquí se decide lo contrario.',
  },
];

/** Reconstruye la foto restando, que es como estaba escrito el seed antes de voltearlo. */
function fotoDel3DeSeptiembre(): Record<string, string[]> {
  const menos = (base: readonly string[], quitar: readonly string[]): string[] =>
    base.filter((clave) => !quitar.includes(clave)).sort();
  const directivo = menos(CATALOGO_AL_3_SEP, RESTA_DIRECTIVO);
  const gerencial = menos(directivo, RESTA_GERENCIAL);
  const ventas = menos(gerencial, RESTA_VENTAS);
  const logistica = menos(ventas, RESTA_LOGISTICA);
  return {
    Administrador: [...CATALOGO_AL_3_SEP].sort(),
    AdministracionDireccion: [...CATALOGO_AL_3_SEP].sort(),
    Directivo: directivo,
    Gerencial: gerencial,
    Ventas: ventas,
    Logistica: logistica,
    Asistente: [...logistica],
    Secretarial: [...logistica],
    Basico: [],
  };
}

/**
 * La foto de aquel día MENOS los retiros decididos después: contra esto se compara el seed de hoy.
 * (La foto se deja intacta a propósito — es el registro del pasado, no la expectativa de hoy.)
 */
function repartoEsperadoHoy(): Record<string, string[]> {
  const esperado = fotoDel3DeSeptiembre();
  for (const retiro of RETIRADOS_DESDE_LA_FOTO) {
    for (const perfil of retiro.perfiles) {
      esperado[perfil] = (esperado[perfil] ?? []).filter((clave) => clave !== retiro.clave);
    }
  }
  return esperado;
}

describe('📸 equivalencia: nadie se mueve de sitio salvo por un retiro DECLARADO', () => {
  const foto = repartoEsperadoHoy();

  it('los 9 perfiles siguen existiendo, con su nombre exacto', () => {
    expect(definirRoles().map((rol) => rol.nombre)).toEqual(Object.keys(foto));
  });

  it.each(Object.keys(foto))('%s conserva EXACTAMENTE los permisos que tenía', (nombre) => {
    const rol = definirRoles().find((r) => r.nombre === nombre);
    expect(rol, `no existe el perfil "${nombre}"`).toBeDefined();
    // ⚠️ Se compara SÓLO sobre las 122 claves que existían el 3-sep-2026 (por eso la
    // intersección). Un permiso que nazca DESPUÉS no es asunto de la foto —la foto no puede
    // opinar sobre algo que no vio—: quien lo vigila es la batería de ATRIBUCIÓN, que exige
    // nombrarle dueño. Sin este recorte, cada permiso nuevo rompería la foto de los nueve
    // perfiles a la vez y el arreglo sería «actualízala», que es como se mata una prueba.
    const congeladas = new Set<string>(CATALOGO_AL_3_SEP);
    const ahora: string[] = [...(rol?.permisos ?? [])]
      .filter((clave) => congeladas.has(clave))
      .sort();
    const esperado = foto[nombre] ?? [];
    // Se nombran las diferencias en los dos sentidos: un `toEqual` de 100 claves no se lee.
    expect(
      ahora.filter((clave) => !esperado.includes(clave)),
      `${nombre} GANÓ permisos que no tenía el 3-sep-2026 (ni están declarados como retiro)`,
    ).toEqual([]);
    expect(
      esperado.filter((clave) => !ahora.includes(clave)),
      `${nombre} PERDIÓ permisos que sí tenía el 3-sep-2026.\nSi el recorte es a propósito, ` +
        `decláralo en RETIRADOS_DESDE_LA_FOTO con su razón: quitarle un permiso a un perfil tiene ` +
        `que costar una decisión escrita, igual que dárselo.`,
    ).toEqual([]);
    expect(ahora.length, `${nombre}: cambió el CONTEO de permisos`).toBe(esperado.length);
  });

  it('✂️ cada RETIRO declarado es real: la clave existe, estaba en la foto y el seed ya no la da', () => {
    // Las tres formas en que esta lista podría pudrirse, y las tres se cazan aquí:
    //  (1) declarar el retiro de un permiso que ya no existe → la lista habla de un fantasma;
    //  (2) declarar como retiro algo que la foto nunca dio → el retiro no retira nada;
    //  (3) declararlo y NO quitarlo del seed → la razón escrita miente y el permiso sigue puesto.
    const catalogo = new Set<string>(CLAVES_PERMISO);
    const fotoOriginal = fotoDel3DeSeptiembre();
    for (const retiro of RETIRADOS_DESDE_LA_FOTO) {
      expect(catalogo.has(retiro.clave), `${retiro.clave} ya no está en el catálogo`).toBe(true);
      expect(retiro.razon.trim().length, `${retiro.clave} sin razón`).toBeGreaterThan(20);
      expect(retiro.perfiles.length, `${retiro.clave} sin perfiles`).toBeGreaterThan(0);
      for (const nombre of retiro.perfiles) {
        const rol = definirRoles().find((r) => r.nombre === nombre);
        expect(rol, `el retiro nombra un perfil que no existe: "${nombre}"`).toBeDefined();
        expect(
          fotoOriginal[nombre] ?? [],
          `${nombre} NO tenía ${retiro.clave} el 3-sep-2026: no hay nada que retirarle`,
        ).toContain(retiro.clave);
        expect(
          rol?.permisos ?? [],
          `${retiro.clave} está declarado como RETIRADO de ${nombre}, pero el seed se lo sigue dando`,
        ).not.toContain(retiro.clave);
      }
    }
  });

  it('la foto sigue hablando del catálogo de hoy (ninguna de sus claves desapareció)', () => {
    // Si un permiso se borra o se renombra en src/contrato, la foto queda hablando de un sistema
    // que ya no existe y sus comparaciones dejan de significar nada. Fallar aquí es la señal de
    // «actualiza la foto a mano», no un defecto del catálogo.
    const catalogo = new Set<string>(CLAVES_PERMISO);
    const desaparecidas = CATALOGO_AL_3_SEP.filter((clave) => !catalogo.has(clave));
    expect(
      desaparecidas,
      `La foto del 3-sep-2026 nombra claves que el catálogo ya no tiene: ` +
        `${desaparecidas.join(', ')}. Actualiza CATALOGO_AL_3_SEP y las listas de resta.`,
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. LO NACIDO DESPUÉS DE LA FOTO — que un permiso nuevo también cueste una decisión
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Permisos que **nacieron después del 3-sep-2026** y por eso la foto no puede opinar sobre ellos.
 *
 * 🔴 **Para qué existe esta lista.** La foto se compara sólo sobre sus 122 claves —a propósito: una
 * foto que crece sola con el catálogo bendice justo la herencia por silencio que este cambio vino a
 * matar—. Pero eso dejaba una rendija medida y real: agregar un permiso al catálogo y dárselo a
 * `Secretarial`, o incluso a `Basico`, pasaba en verde con sólo decir que *alguien* lo tenía. Aquí
 * el permiso nuevo vuelve a costar lo mismo que costaba antes: **escribir a quién se le dio y por
 * qué**. La `razon` es obligatoria por el tipo, igual que en `SOLO_ADMINISTRADOR`.
 *
 * ✍️ **Cómo se llena.** Una entrada por clave nueva, y la razón dice **a qué perfiles se le dio y
 * por qué a ésos** (p. ej. *«sólo Directivo y Gerencial: es la nómina, y de Ventas para abajo nadie
 * ve sueldos»*). Si además es exclusiva del administrador, va TAMBIÉN en `SOLO_ADMINISTRADOR` del
 * seed — son preguntas distintas: aquélla dice *quién la tiene*, ésta dice *que se decidió*.
 *
 */
const NUEVOS_DESDE_LA_FOTO: readonly { clave: ClavePermiso; razon: string }[] = [
  // ── «Validar es de Daniel» (fila 0.128, §Post-F9.192(1)) ───────────────────────────────────
  {
    clave: 'esma.revisar',
    razon:
      'SÓLO el administrador y Directivo (el círculo del dueño). DANIEL, 4-sep-2026: *«La entrada ' +
      'la da la persona responsable de recibos o de producción. Pero la validación sólo la doy ' +
      'yo. O sea, es un permiso para meter lo recibido y otro para validarlo.»* Revisar una ' +
      'partida es lo que la mete al saldo (desde la 0.115 sólo lo revisado suma), o sea es el ' +
      'acto de convertirla en deuda o en pago REAL. NO baja a Gerencial ni de ahí para abajo: ' +
      'ellos capturan con `esma.modificar`, que se queda repartido como estaba — capturar no es ' +
      'validar, y ése es el punto entero de la fila.',
  },
  // ── La corrida semanal de pagos (fila 0.113) y su catálogo (0.125), §Post-F9.189(g) ────────
  {
    clave: 'pagos.corrida-armar',
    razon:
      'SÓLO el administrador (va también en SOLO_ADMINISTRADOR del seed). Daniel lo pidió para ' +
      'él: armar la corrida es DECIDIR a quién se le paga y cuánto — *«yo voy decidiendo los ' +
      'montos a pagar de cada uno. Manualmente»*. Es la decisión más cara del sistema.',
  },
  {
    clave: 'pagos.corrida-ver',
    razon:
      'Directivo y Gerencial, los mismos que ya llevan `cxp.ver` y `esma.ver-pagos`: es la ' +
      'consulta de la relación (finanzas la lee para hacer las transferencias). NO baja a Ventas ' +
      'ni de ahí para abajo — la relación es la nómina de proveedores de la semana.',
  },
  {
    clave: 'conceptos-pago.ver',
    razon:
      'Directivo y Gerencial, los mismos que ven la corrida: los conceptos son renglones de esa ' +
      'relación y sin verlos la pantalla queda coja.',
  },
  {
    clave: 'conceptos-pago.administrar',
    razon:
      'SÓLO el administrador (va también en SOLO_ADMINISTRADOR del seed): es un catálogo MAESTRO ' +
      'y dar de alta un concepto es dar de alta A DÓNDE puede salir dinero fuera del padrón de ' +
      'proveedores.',
  },
  // ── ⭐⭐ Cerrar la orden y CONGELAR su costo (fila 0.061), §Post-F9.154(c) ──────────────────
  {
    clave: 'ordenes.cerrar',
    razon:
      'Administrador, Administración/Dirección y Directivo — el mismo círculo que ya cierra ' +
      'dinero (`costos.capturar`, `edr.*`). Cerrar una orden CONGELA su costo unitario y la deja ' +
      'en solo lectura (ninguna etapa, ningún costo, ninguna cancelación), y REABRIRLA va con el ' +
      'MISMO permiso: quien puede congelar el costo es quien puede descongelarlo. NO baja a ' +
      'producción ni a Ventas — el piso captura, no decide que una orden terminó. Default del ' +
      'lead; Daniel confirma.',
  },
];

describe('🆕 lo nacido DESPUÉS de la foto también se decide por escrito', () => {
  it('⭐ un permiso que no estaba en la foto tiene que estar declarado aquí', () => {
    const enLaFoto = new Set<string>(CATALOGO_AL_3_SEP);
    const declarados = new Set<string>(NUEVOS_DESDE_LA_FOTO.map((entrada) => entrada.clave));
    const sinDeclarar = CLAVES_PERMISO.filter(
      (clave) => !enLaFoto.has(clave) && !declarados.has(clave),
    );

    expect(
      sinDeclarar,
      `Estas claves nacieron después de la foto del 3-sep-2026 y nadie escribió a quién se le ` +
        `dieron: ${sinDeclarar.join(', ')}.\n` +
        `La foto no las vigila (no son de sus 122) y la batería de ATRIBUCIÓN sólo comprueba que ` +
        `TENGAN dueño, no que sea el dueño correcto — así se le puede colar un permiso a ` +
        `Secretarial sin que nadie lo note. Agrégalas a NUEVOS_DESDE_LA_FOTO diciendo a qué ` +
        `perfiles se les dio y por qué.`,
    ).toEqual([]);
  });

  it('⭐ BASICO no lleva NINGÚN permiso: es su definición entera, no una foto', () => {
    // La foto sólo puede decir que Basico no tiene ninguna de las 122 congeladas; una clave nueva
    // se le colaba sin que nada chistara. Y `Basico` es precisamente el perfil que significa «sin
    // acceso» (nivel 100 del viejo: sus accesos se activaban uno por uno POR USUARIO).
    const basico = definirRoles().find((rol) => rol.nombre === 'Basico');
    expect(basico, 'no existe el perfil "Basico"').toBeDefined();
    expect(
      basico?.permisos ?? ['(falta el rol)'],
      'Basico tiene permisos: ese perfil existe para NO tener ninguno',
    ).toEqual([]);
  });

  it('la lista declarada es coherente: sin fantasmas, sin repetidos, sin invadir la foto', () => {
    const catalogo = new Set<string>(CLAVES_PERMISO);
    const enLaFoto = new Set<string>(CATALOGO_AL_3_SEP);
    for (const entrada of NUEVOS_DESDE_LA_FOTO) {
      expect(catalogo.has(entrada.clave), `${entrada.clave} ya no está en el catálogo`).toBe(true);
      // Declarar como «nueva» una de las 122 escondería un cambio de reparto de la foto.
      expect(enLaFoto.has(entrada.clave), `${entrada.clave} SÍ estaba en la foto`).toBe(false);
      expect(entrada.razon.trim().length, `${entrada.clave} sin razón`).toBeGreaterThan(20);
    }
    const claves = NUEVOS_DESDE_LA_FOTO.map((entrada) => entrada.clave);
    expect(claves.length, 'hay claves repetidas en NUEVOS_DESDE_LA_FOTO').toBe(
      new Set(claves).size,
    );
  });
});
