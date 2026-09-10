/**
 * ⭐ V1-E7b — EL REPARTO de `modelos.aprobar-receta`, y su TENSIÓN con `listas.aprobar`.
 *
 * Daniel dejó dos aprobaciones que se parecen y NO son la misma, y avisó de lo que pasa si se
 * juntan por descuido (§Post-F9.110 (b)):
 *
 * | Aprobación | Qué compromete | Quién |
 * |---|---|---|
 * | La **RECETA** (`modelos.aprobar-receta`) | que el modelo quede técnicamente bien | Daniel **y Aurora** |
 * | El **PRECIO** (`listas.aprobar`, F8-E4 (h)) | lo que se le cobra al cliente | **sólo el dueño** |
 *
 * *"Si se juntaran por descuido, Aurora acabaría aprobando precios sin que nadie lo hubiera
 * decidido."* Aurora es **Gerencial**.
 *
 * ⚠️ NOTA DEL 3-sep-2026: el seed ya NO reparte por cascada (`sin(…)` desapareció; cada perfil
 * declara lo que TIENE, ver `prisma/seed.ts`). Estas pruebas siguen valiendo TAL CUAL —y ahora
 * valen más—: nombran QUÉ perfil puede QUÉ, que es lo único que el reparto nuevo no deduce solo.
 * Donde abajo se habla de «la cascada» y de `sin()` se está contando cómo estaba escrito el seed
 * entonces, no cómo está hoy.
 *
 * ⚠️ **POR QUÉ ESTE ARCHIVO EXISTE APARTE — tres archivos, tres preguntas DISTINTAS.** Ninguno
 * cubre al otro, y el que las confunde acaba borrando el que hace falta:
 *
 * | Archivo | La pregunta que contesta |
 * |---|---|
 * | **este** (`roles-reparto.test.ts`) | **¿QUÉ perfil puede QUÉ, por decisión de Daniel?** La INTENCIÓN, nombrada permiso por permiso |
 * | `reparto-de-permisos.test.ts` | ¿el reparto **se movió** respecto a la foto del 3-sep?, ¿queda alguna clave **sin dueño**?, ¿lo nacido después **se decidió por escrito**? |
 * | `seed.int.test.ts` (integración) | ¿la **BASE DE DATOS** recibe exactamente lo que dice `definirRoles()`? Pura MECÁNICA del sembrado |
 *
 * 🔑 **El que jamás puede sustituir a éste es el de integración**, y no por lo que compara sino por
 * contra qué: compara la BD **contra la propia definición**, así que si la definición le regala
 * `listas.aprobar` a Ventas, la BD lo recibe, coinciden y **pasa en verde**. Con una excepción que
 * conviene tener presente: de los **extremos** sí opina, porque los ancla a fuentes independientes
 * —`Administrador`/`AdministracionDireccion` contra el catálogo entero, `Basico` contra cero—. De
 * los **seis perfiles de en medio**, que son donde vive el reparto de verdad, no opina nada. Lo que
 * Daniel fijó es a QUIÉN le toca cada permiso, y eso hay que escribirlo; se escribe aquí.
 *
 * *(Hasta el 3-sep-2026 esa prueba comparaba CONTEOS y exigía que la cascada «bajara»; en esta
 * misma fila se cambió a conjuntos exactos de claves. El párrafo que decía eso quedó falso y por eso
 * se reescribió: no cambia la conclusión, cambia el motivo.)*
 *
 * Además es PURA (`definirRoles` no toca la base), así que corre en el proyecto `unit` sin Docker.
 */
import { describe, expect, it } from 'vitest';

import { definirRoles } from '../../prisma/seed.js';

/** Los permisos de un rol por su nombre (falla claro si el rol se renombra). */
function permisosDe(nombre: string): string[] {
  const rol = definirRoles().find((r) => r.nombre === nombre);
  expect(rol, `no existe el rol "${nombre}" en el seed`).toBeDefined();
  return rol?.permisos ?? [];
}

describe('reparto de las DOS aprobaciones (§Post-F9.110 (b) + F8-E4 (h))', () => {
  it('⭐ GERENCIAL aprueba la RECETA pero NO los precios (es toda la decisión de Daniel)', () => {
    const gerencial = permisosDe('Gerencial');
    expect(gerencial).toContain('modelos.aprobar-receta');
    // La otra mitad, y la que duele si alguien "unifica" los dos permisos:
    expect(gerencial).not.toContain('listas.aprobar');
  });

  it('⭐ VENTAS no aprueba recetas: ahí se corta', () => {
    expect(permisosDe('Ventas')).not.toContain('modelos.aprobar-receta');
  });

  it('el dueño y la dirección sí aprueban receta (y también precios)', () => {
    for (const rol of ['Administrador', 'AdministracionDireccion', 'Directivo']) {
      expect(permisosDe(rol), rol).toContain('modelos.aprobar-receta');
      expect(permisosDe(rol), rol).toContain('listas.aprobar');
    }
  });

  it('⭐ Gerencial SÍ administra modelos: es su trabajo diario, no un catálogo maestro', () => {
    // ⚠️ ESTA PRUEBA AFIRMABA LO CONTRARIO hasta el 26-ago-2026, y se INVIERTE a propósito
    // (§Post-F9.123). No se borró: la afirmación vieja —«Aurora no administra modelos»— era
    // correcta bajo la regla de entonces («administrar catálogos es de Administración/Dirección»)
    // y se conserva su rastro aquí porque explica por qué el sistema llegó a ese estado.
    //
    // Lo que cambió es el criterio, no el código: **un modelo NO es un catálogo como los demás.**
    // Una tela o un color son datos maestros que se dan de alta una vez; un modelo es el TRABAJO
    // DIARIO de Desarrollo. Daniel lo destapó al reportar que Aurora —que lleva Desarrollo
    // entero— no podía dar de alta un modelo, que es justo por donde arranca todo lo demás que
    // ella sí podía hacer (proyectos, precosteo, listas, negociar, emitir cotizaciones).
    const gerencial = permisosDe('Gerencial');
    expect(gerencial).toContain('modelos.aprobar-receta');
    expect(gerencial).toContain('modelos.administrar');
  });

  it('⭐ ALCANCE: administrar modelos NO baja de Gerencial (Ventas y abajo, jamás)', () => {
    // 🔴 LA PRUEBA QUE FALTABA, y la que habría matado el defecto de la primera versión de
    // §Post-F9.123: aquélla devolvía `modelos.administrar` con un `.concat` sobre el resultado de
    // `sin(directivo, …)`, y como Ventas deriva de Gerencial —y Logística/Asistente/Secretarial de
    // Ventas— el permiso se coló a los CUATRO. Es la misma fuga que ya se había corregido en
    // `rc.catalogo-administrar` ("antes se colaba a roles clericales", seed.ts): administrar el
    // catálogo de modelos abre el CRUD del modelo, la receta/BOM y copiar BOM, las fotos, el arte,
    // las medidas de avío por talla, los avíos favoritos, la curva desde órdenes y el alta de
    // desarrollo con modelo nuevo. Nada de eso es de un rol clerical.
    //
    // Por eso NO basta con afirmar que Gerencial lo tiene (arriba): hay que fijar dónde TERMINA.
    //
    // ⚠️ Y aquí hay que ser exacto, porque la primera redacción de este comentario (3-sep-2026)
    // decía que «ninguna de las otras dos pruebas lo ve» y **era falsa**: la foto de
    // `reparto-de-permisos.test.ts` SÍ caza esta fuga —de hecho el reviewer la metió y murieron las
    // dos pruebas—, porque `modelos.administrar` está entre las 122 claves congeladas. Lo cierto es
    // esto, y sostiene mejor el argumento:
    //
    //  • `seed.int.test.ts` no la ve NUNCA: compara la BD contra la propia `definirRoles()`, así
    //    que una fuga metida EN LA DEFINICIÓN se siembra tal cual y coincide.
    //  • La foto sí la vería… pero **sólo por casualidad de la fecha**: cubre las claves que
    //    existían el 3-sep-2026. Un permiso nacido después se le escapa, y entonces no quedaría
    //    nadie mirando.
    //
    // Lo que NO depende de la fecha es nombrarlo aquí, rol por rol.
    for (const rol of ['Ventas', 'Logistica', 'Asistente', 'Secretarial']) {
      expect(permisosDe(rol), rol).not.toContain('modelos.administrar');
    }
  });

  it('⭐ ALCANCE hacia arriba: Directivo y Gerencial SÍ lo tienen (y Secretarial no)', () => {
    // El otro síntoma del `.concat`: dejaba a Directivo SIN el permiso y a Secretarial CON él, al
    // revés de la regla que el seed documentaba entonces ("menor nivel ⊃ mayor nivel", `sin()`).
    // Desde el 3-sep-2026 ya no hay tal regla —cada perfil lista lo suyo—, así que el reparto de
    // este permiso deja de estar garantizado por la forma y pasa a estar garantizado por ESTO.
    for (const rol of ['Administrador', 'AdministracionDireccion', 'Directivo', 'Gerencial']) {
      expect(permisosDe(rol), rol).toContain('modelos.administrar');
    }
  });

  it('⭐ …pero eso NO le abre los costos REALES ni el estado de resultados', () => {
    // La línea que trazó Daniel: ve **EL PLAN** (lo que va a costar), no **EL RESULTADO**
    // (cómo terminamos). Administrar modelos no puede arrastrar lo de después.
    const gerencial = permisosDe('Gerencial');
    // El plan: sí.
    expect(gerencial).toContain('precostos.consultar');
    expect(gerencial).toContain('consultas.ver-importes');
    // El resultado: no.
    for (const permiso of [
      'costos.ver',
      'costos.capturar',
      'ordenes.ver-costos',
      'edr.ver',
      'edr.capturar',
    ]) {
      expect(gerencial, permiso).not.toContain(permiso);
    }
    // Y el precio sigue siendo del dueño: ella arma y manda la cotización, él lo aprueba.
    expect(gerencial).toContain('listas.negociar');
    expect(gerencial).not.toContain('listas.aprobar');
  });
});

// ── ⭐ V1-E8b (§Post-F9.125): `listas.aprobar` es AHORA la reja de los FACTORES ─────

/**
 * Desde V1-E8b, `listas.aprobar` ya no gobierna sólo la firma del precio renglón por renglón:
 * también decide **quién mueve y quién VE los cuatro factores** (margen · descuentos · regalías ·
 * costo de ventas), en la lista y en el catálogo del cliente. Daniel, 26-ago-2026: *"los factores
 * sólo yo los puedo mover y no son visibles para nadie más"*.
 *
 * Por eso su reparto pasa de ser una regla del módulo de listas a ser LA reja del precio de venta,
 * y se fija aquí sobre los roles REALES —no leyendo el seed a ojo—: ya hubo una fuga en este
 * archivo por un `.concat` que coló un permiso a cuatro roles derivados.
 */
describe('⭐ V1-E8b — `listas.aprobar` es la reja de los FACTORES (§Post-F9.125)', () => {
  it('lo tienen EXACTAMENTE los tres roles del dueño y la dirección, y nadie más', () => {
    const conElPermiso = definirRoles()
      .filter((r) => r.permisos.includes('listas.aprobar'))
      .map((r) => r.nombre)
      .sort();
    expect(conElPermiso).toEqual(['AdministracionDireccion', 'Administrador', 'Directivo']);
  });

  it('⭐ los roles que SÍ administran listas (pero no aprueban) quedan fuera de los factores', () => {
    // La trampa que esta etapa cierra: `listas.administrar` llega hasta VENTAS, y con él se movían
    // los factores. Que un rol administre la lista NO puede implicar que mueva el precio.
    for (const nombre of ['Gerencial', 'Ventas']) {
      const permisos = permisosDe(nombre);
      expect(permisos, nombre).toContain('listas.administrar');
      expect(permisos, nombre).not.toContain('listas.aprobar');
    }
  });

  it('⭐ y `consultas.ver-importes` NO alcanza para ver los factores (Gerencial lo tiene)', () => {
    // El otro permiso que servía de reja hasta V1-E8b. Aurora lo tiene y lo necesita —ve costos,
    // arma precostos, manda cotizaciones—: por eso nunca pudo ser la reja del margen.
    const gerencial = permisosDe('Gerencial');
    expect(gerencial).toContain('consultas.ver-importes');
    expect(gerencial).not.toContain('listas.aprobar');
  });
});

/**
 * ⭐ FILA 0.128 — **VALIDAR ES DE DANIEL; CAPTURAR LO RECIBIDO ES DE QUIEN RECIBE.**
 *
 * Daniel, 4-sep-2026 (§Post-F9.192(1)), textual:
 *
 * > *«La entrada la da la persona responsable de recibos o de producción. Pero **la validación
 * > sólo la doy yo**. O sea, es **un permiso para meter lo recibido y otro para validarlo**.»*
 *
 * Son TRES permisos y hay que no confundirlos, porque dos se parecen mucho y el tercero es el que
 * se colaba:
 *
 * | Permiso | Qué acto es | Quién |
 * |---|---|---|
 * | `produccion.recibo` | METER lo recibido de maquila (y proponer el cargo) | quien recibe: producción / almacén |
 * | `esma.cargo-validar` | fijar la CANTIDAD y el PRECIO reales de ese cargo | **sólo el dueño y su círculo** |
 * | `esma.revisar` | AUTORIZAR una partida capturada (abono/descuento/pago) para que entre al saldo | **sólo el dueño y su círculo** |
 *
 * 🔑 **Lo que hacía falta medir aquí, y no lo mide ningún otro archivo:** que `esma.modificar` —el
 * permiso de CAPTURAR abonos y descuentos— siga bajando a los perfiles operativos **y que eso ya no
 * les dé de regalo el poder de autorizarlos**. Hasta la 0.127 revisar exigía `esma.modificar`: quien
 * capturaba se auto-autorizaba. Y desde la 0.115 sólo lo revisado suma al saldo, así que autorizar
 * es exactamente el acto de convertir un renglón en deuda —o en pago— real.
 */
describe('⭐ fila 0.128 — validar es de Daniel; capturar lo recibido es de quien recibe', () => {
  /** Los tres perfiles del dueño y la dirección: el "círculo" al que Daniel deja validar. */
  const CIRCULO = ['AdministracionDireccion', 'Administrador', 'Directivo'];
  /** Los perfiles operativos: capturan, no validan. */
  const OPERATIVOS = ['Gerencial', 'Ventas', 'Logistica', 'Asistente', 'Secretarial'];

  it.each(['esma.cargo-validar', 'esma.revisar'])(
    '`%s` lo tienen EXACTAMENTE los tres roles del círculo, y nadie más',
    (clave) => {
      const conElPermiso = definirRoles()
        .filter((r) => (r.permisos as string[]).includes(clave))
        .map((r) => r.nombre)
        .sort();
      expect(conElPermiso).toEqual(CIRCULO);
    },
  );

  it('⭐ los operativos SÍ capturan (`esma.modificar`) pero YA NO autorizan lo que capturan', () => {
    // Las dos mitades juntas, que es lo que hace legible la decisión: si algún día alguien
    // "simplifica" volviendo a un solo permiso, esta prueba dice en una línea qué se rompió.
    for (const nombre of OPERATIVOS) {
      const permisos = permisosDe(nombre);
      expect(permisos, `${nombre} tiene que poder capturar abonos/descuentos`).toContain(
        'esma.modificar',
      );
      expect(permisos, `${nombre} NO puede autorizar partidas`).not.toContain('esma.revisar');
      expect(permisos, `${nombre} NO puede validar cargos de maquila`).not.toContain(
        'esma.cargo-validar',
      );
    }
  });

  it('⭐ la ENTRADA no se tocó: quien recibe de maquila sigue siendo operativo', () => {
    // La otra mitad de la frase de Daniel. Si al cerrar la validación se hubiera cerrado también
    // la captura del recibo, el almacén se quedaría sin poder registrar lo que llega — que es
    // exactamente lo contrario de lo que pidió.
    for (const nombre of OPERATIVOS) {
      expect(permisosDe(nombre), nombre).toContain('produccion.recibo');
    }
  });
});
