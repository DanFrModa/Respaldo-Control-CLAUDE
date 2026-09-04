/**
 * Tests de integración del seed de fundación contra Postgres real (el efímero de
 * testcontainers, migrado por entorno-global.ts). Verifican el requisito clave del
 * plan §4/A4: seed IDEMPOTENTE y catálogo de permisos/roles bien sembrado.
 *
 * Limpia la base antes de sembrar para que los conteos sean deterministas
 * (las suites de integración comparten el contenedor y corren en serie).
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { definirRoles, PERFILES_ACCESO_TOTAL, sembrar } from '../../prisma/seed.js';
import { CATALOGO_PERMISOS, CLAVES_PERMISO } from '../contrato/index.js';
import { limpiarBaseDatos } from '../pruebas/contexto.js';
import { crearClientePrisma, type PrismaClient } from './index.js';

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = crearClientePrisma(inject('urlBaseDatosPruebas'));
  await limpiarBaseDatos(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function conteos() {
  const [
    empresas,
    configuraciones,
    permisos,
    roles,
    rolesPermisos,
    usuarios,
    cuentas,
    usuariosRoles,
  ] = await Promise.all([
    prisma.empresa.count(),
    prisma.configuracionEmpresa.count(),
    prisma.permiso.count(),
    prisma.rol.count(),
    prisma.rolPermiso.count(),
    prisma.usuario.count(),
    prisma.cuenta.count(),
    prisma.usuarioRol.count(),
  ]);
  return {
    empresas,
    configuraciones,
    permisos,
    roles,
    rolesPermisos,
    usuarios,
    cuentas,
    usuariosRoles,
  };
}

describe('seed de fundación', () => {
  it('es idempotente: correrlo dos veces deja exactamente lo mismo', async () => {
    await sembrar(prisma);
    const primera = await conteos();
    await sembrar(prisma);
    const segunda = await conteos();

    expect(segunda).toEqual(primera);
    expect(primera.permisos).toBe(CATALOGO_PERMISOS.length);
    // 9 roles de sistema (niveles viejos absorbidos) + 17 roles funcionales de la RC
    // (F5-E1, desde RC_TipoUsuarios; "Administrador" se reutiliza, no se duplica) = 26.
    expect(primera.roles).toBe(26);
    expect(primera.empresas).toBeGreaterThanOrEqual(1);
  });

  it('siembra la empresa FR Moda favorita con su configuración (datos de Propiedades.csv)', async () => {
    const empresa = await prisma.empresa.findUniqueOrThrow({
      where: { nombre: 'FR Moda' },
      include: { configuracion: true },
    });
    expect(empresa.favorita).toBe(true);
    expect(empresa.paraIpt).toBe(true);
    expect(empresa.paraEdr).toBe(true);
    expect(empresa.configuracion?.utilidadSugerida?.toNumber()).toBe(50);
    expect(empresa.configuracion?.regaliasBase?.toNumber()).toBe(10);
    expect(empresa.configuracion?.colchonCostura).toBe(1);
  });

  it('la BD queda sincronizada con el catálogo de permisos de src/contrato', async () => {
    const claves = await prisma.permiso.findMany({ select: { clave: true } });
    expect(claves.map((p) => p.clave).sort()).toEqual([...CLAVES_PERMISO].sort());
  });

  it('siembra los roles de proveedor base (F1-E1B, R15) de forma idempotente', async () => {
    const roles = await prisma.rolProveedor.findMany({ select: { codigo: true } });
    const codigos = roles.map((r) => r.codigo).sort();
    // Fusión de terceros (D12/R15): el seed siembra 10 roles de servicio. `estampado` y
    // `aplicacion` se sembraron por separado (el viejo `estampado-aplicacion` ya NO se
    // siembra; en BD fresca de CI no existe, así que no va en la lista esperada).
    // fila 0.114: entró `empaque` — Daniel: *«y una maquila de empaque también»*. La lista se
    // mantiene ESCRITA A MANO a propósito (no se compara contra la constante del seed): así,
    // agregar un rol obliga a decirlo aquí en vez de que la prueba se auto-apruebe sola.
    expect(codigos).toEqual(
      [
        'maquila-costura',
        'corte',
        'empaque',
        'estampado',
        'bordado',
        'lavado',
        'aplicacion',
        'vende-telas',
        'vende-avios',
        'otros-servicios',
      ].sort(),
    );
  });

  /**
   * Fila 0.137 — el guard `exigirAlmacenDelTipo` exige que el almacén sea del tipo del artículo, y
   * los avíos se mueven en cuatro flujos (ajuste, traspaso, recepción de compra y notas de salida).
   * El catálogo NO tenía ni un almacén de tipo AVIO —el viejo no los tenía y por eso ni el seed ni
   * el ETL creaban uno—, así que sin esta siembra esos cuatro flujos rechazarían siempre.
   *
   * Ojo con la idempotencia: el almacén es GLOBAL (`idEmpresa = null`) y el `@@unique` de almacenes
   * es `(idEmpresa, nombre)`, que en Postgres NO atrapa los NULL. Si el seed no verificara a mano
   * antes de crear, la segunda corrida dejaría DOS y el dominio no sabría de cuál sacar.
   */
  it('siembra UN almacén global de AVÍOS y no lo duplica al re-sembrar (fila 0.137)', async () => {
    // `sembrar` ya corrió DOS veces en el primer test de este describe.
    const avios = await prisma.almacen.findMany({ where: { tipo: 'AVIO' } });
    expect(avios).toHaveLength(1);
    expect(avios[0]).toMatchObject({
      nombre: 'Almacén de avíos',
      tipo: 'AVIO',
      idEmpresa: null,
      activo: true,
      esTransitoProceso: false,
    });

    // Una tercera corrida tampoco lo duplica (idempotencia explícita, no heredada del test 1).
    await sembrar(prisma);
    expect(await prisma.almacen.count({ where: { tipo: 'AVIO' } })).toBe(1);
    // Y los de PT siguen siendo los 3 de siempre (el bloque nuevo no tocó el existente).
    expect(await prisma.almacen.count({ where: { tipo: 'PT' } })).toBe(3);
  });

  it('siembra los 8 géneros base (F1-E4) de forma idempotente', async () => {
    const generos = await prisma.genero.findMany({ select: { nombre: true } });
    const nombres = generos.map((g) => g.nombre).sort();
    // Los 8 géneros del sistema viejo (doc 01-Modelos §3, lista de precios por género).
    expect(nombres).toEqual(
      [
        'Caballero',
        'Dama',
        'Niño Infantil',
        'Niña Infantil',
        'Niño Juvenil',
        'Niña Juvenil',
        'Bebo',
        'Beba',
      ].sort(),
    );
  });

  it('el admin queda con cuenta credential (hash, nunca texto plano) y rol Administrador completo', async () => {
    const admin = await prisma.usuario.findUniqueOrThrow({
      where: { username: 'admin' },
      include: { cuentas: true, roles: { include: { rol: true } } },
    });
    expect(admin.activo).toBe(true);
    expect(admin.bloqueado).toBe(false);

    const credencial = admin.cuentas.find((c) => c.providerId === 'credential');
    expect(credencial?.accountId).toBe(admin.id);
    // Hash scrypt de better-auth ("salt:hash"); jamás la contraseña en claro (doc 10 §6.3).
    expect(credencial?.password).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);

    expect(admin.roles.map((r) => r.rol.nombre)).toContain('Administrador');
    const rolAdmin = await prisma.rol.findUniqueOrThrow({
      where: { nombre: 'Administrador' },
      include: { _count: { select: { permisos: true } } },
    });
    expect(rolAdmin.esSistema).toBe(true);
    expect(rolAdmin._count.permisos).toBe(CATALOGO_PERMISOS.length);
  });

  // ⛔ AQUÍ ESTABA «la cascada de roles respeta el orden de niveles del sistema viejo», que exigía
  // `logistica < ventas < gerencial < directivo < admin` y `Asistente === Logistica ===
  // Secretarial`, por CONTEO. Se sustituye el 3-sep-2026, y no por gusto: **ese anidamiento es
  // exactamente la invariante que Daniel abolió** al mandar quitar los permisos por cascada
  // (*"puede haber alguien que tenga el permiso A pero no el B, y otra persona que tenga el B pero
  // no el A"*). Pasaba sólo porque los conjuntos siguen anidados HOY; el día que se armen los
  // perfiles con los puestos reales de los 23 usuarios, esta prueba se habría puesto roja **por
  // tener razón**, y el arreglo obvio —relajarla— habría dejado el seed sin prueba de integración.
  //
  // Lo que va en su lugar es más fuerte y no opina sobre la FORMA del reparto: que el seed escriba
  // en la base EXACTAMENTE lo que dice `definirRoles()`, rol por rol y clave por clave. Si mañana
  // Ventas y Logística se cruzan sin contenerse, esto sigue valiendo.
  it('cada rol de sistema queda en la BD con EXACTAMENTE lo que dice definirRoles()', async () => {
    const definicion = definirRoles();
    const filas = await prisma.rol.findMany({
      where: { nombre: { in: definicion.map((rol) => rol.nombre) } },
      select: {
        nombre: true,
        esSistema: true,
        permisos: { select: { permiso: { select: { clave: true } } } },
      },
    });

    expect(filas, 'faltan roles de sistema en la BD').toHaveLength(definicion.length);
    const porNombre = new Map(filas.map((fila) => [fila.nombre, fila]));
    for (const rol of definicion) {
      const fila = porNombre.get(rol.nombre);
      expect(fila, `no se sembró el rol ${rol.nombre}`).toBeDefined();
      expect(fila?.esSistema, `${rol.nombre} tiene que quedar marcado como de sistema`).toBe(true);
      // Igualdad EXACTA, y se puede: este archivo arranca de `limpiarBaseDatos`, así que no hay
      // rastro previo. (`sembrarRoles` tiene una excepción documentada —nunca REVOCA las claves de
      // gobierno—, pero eso sólo puede dejar de MÁS lo que alguien hubiera otorgado antes, y aquí
      // no hubo antes. Si algún día esto falla con `usuarios.administrar`/`roles.administrar` de
      // sobra en un rol, es esa excepción, no un defecto.)
      const enBd = (fila?.permisos ?? []).map((rp) => rp.permiso.clave).sort();
      expect(enBd, `${rol.nombre}: la BD no coincide con definirRoles()`).toEqual(
        [...rol.permisos].sort(),
      );
    }
  });

  /**
   * ⭐ FILA 0.128 — **LA PREGUNTA QUE DECIDE SI HACE FALTA UNA MIGRACIÓN DE DATOS.**
   *
   * Daniel mandó quitarle a los perfiles operativos el permiso de validar cargos de maquila
   * (§Post-F9.192(1): *«la validación sólo la doy yo»*). Quitarlo del seed sólo sirve si el seed
   * **REVOCA**; si nada más agregara, `prueba` se quedaría con la liga vieja para siempre y el
   * recorte necesitaría un `DELETE` a mano en una migración.
   *
   * Aquí se mide justo eso, con el caso peor: se le vuelve a PONER la liga a mano al rol (como la
   * tiene hoy `prueba`, sembrada por la versión anterior) y se re-siembra. La liga tiene que
   * desaparecer sola. Es lo que hace que `SEED_ON_START=true` baste como plan de despliegue.
   *
   * ⚠️ Sin esta prueba, `seed.int.test.ts` no lo cubría: su comprobación de roles arranca de
   * `limpiarBaseDatos`, así que nunca hay una liga previa que sobre — y la excepción documentada de
   * `sembrarRoles` (nunca revoca las claves de GOBIERNO) demuestra que "revocar o no" es una
   * decisión real del código, no un accidente.
   */
  it('⭐ REVOCA lo que sobra: una liga rol-permiso puesta a mano desaparece al re-sembrar', async () => {
    const gerencial = await prisma.rol.findUniqueOrThrow({
      where: { nombre: 'Gerencial' },
      select: { id: true },
    });
    const validar = await prisma.permiso.findUniqueOrThrow({
      where: { clave: 'esma.cargo-validar' },
      select: { id: true },
    });

    // Estado de partida: el rol NO lo tiene (el reparto de la 0.128 se lo quitó)…
    const antes = await prisma.rolPermiso.count({
      where: { idRol: gerencial.id, idPermiso: validar.id },
    });
    expect(antes, 'Gerencial ya no debe validar cargos de maquila (fila 0.128)').toBe(0);

    // …se le pone a mano, como está hoy en la base de `prueba`, y se re-siembra.
    await prisma.rolPermiso.create({
      data: { idRol: gerencial.id, idPermiso: validar.id },
    });
    await sembrar(prisma);

    const despues = await prisma.rolPermiso.count({
      where: { idRol: gerencial.id, idPermiso: validar.id },
    });
    expect(
      despues,
      'el seed SINCRONIZA los roles de sistema: lo que ya no está en definirRoles() se borra',
    ).toBe(0);
  });

  it('⭐ …y la contraparte: el permiso NUEVO de validar sí aterriza en el círculo del dueño', async () => {
    // `esma.revisar` (fila 0.128) nace en esta versión: si el seed no lo sembrara, la pantalla se
    // quedaría sin nadie que pueda autorizar partidas y el estado de cuenta se congelaría.
    const conElPermiso = await prisma.rol.findMany({
      where: { permisos: { some: { permiso: { clave: 'esma.revisar' } } } },
      select: { nombre: true },
    });
    expect(conElPermiso.map((r) => r.nombre).sort()).toEqual([
      'AdministracionDireccion',
      'Administrador',
      'Directivo',
    ]);
  });

  it('los dos perfiles de acceso total llevan el catálogo COMPLETO, y Basico va en cero', async () => {
    // Los extremos, dichos aparte: son los dos que un reparto mal editado rompe primero, y ninguno
    // de los dos depende de que los perfiles de en medio estén anidados.
    const roles = await prisma.rol.findMany({
      where: { nombre: { in: [...PERFILES_ACCESO_TOTAL, 'Basico'] } },
      select: { nombre: true, permisos: { select: { permiso: { select: { clave: true } } } } },
    });
    const porNombre = new Map(roles.map((fila) => [fila.nombre, fila]));

    for (const nombre of PERFILES_ACCESO_TOTAL) {
      const claves = (porNombre.get(nombre)?.permisos ?? []).map((rp) => rp.permiso.clave).sort();
      expect(claves, `${nombre} tiene que llevar el catálogo completo`).toEqual(
        [...CLAVES_PERMISO].sort(),
      );
    }
    expect(
      porNombre.get('Basico')?.permisos ?? ['(falta el rol Basico)'],
      'Basico existe para NO tener permisos',
    ).toEqual([]);
  });
});

/**
 * ⭐ §Post-F9.70 punto 2 (V1-E3i) — la plantilla de C&A con su 7%. El agujero real era que NO EXISTÍA
 * ninguna `PlantillaImportacion`, así que `leerConfigPlantillaPdf` caía a 0% y las OPs nacían con las
 * cantidades exactas del cliente. Aquí se prueba las cuatro cosas que hacen que la siembra sirva: que
 * la cree, que la cree BIEN (7% + campos variables + vigente), que no se duplique al re-sembrar y que
 * NO pise lo que un humano ya configuró.
 */
describe('seed — plantilla de importación de C&A (§Post-F9.70)', () => {
  beforeAll(async () => {
    // Punto de partida limpio para esta batería (el archivo comparte base con las de arriba).
    await prisma.plantillaImportacion.deleteMany();
    await prisma.cliente.deleteMany();
  });

  it('sin el cliente C&A no inventa nada (el cliente lo carga el ETL, no el seed)', async () => {
    await sembrar(prisma);
    expect(await prisma.plantillaImportacion.count()).toBe(0);
  });

  it('con el cliente dado de alta le siembra la plantilla pdf-cya con el 7% de Daniel', async () => {
    // "C & A" con espacios: el seed compara el nombre NORMALIZADO, no letra por letra.
    const cya = await prisma.cliente.create({ data: { nombre: 'C & A' } });
    await sembrar(prisma);

    const plantilla = await prisma.plantillaImportacion.findFirstOrThrow({
      where: { idCliente: cya.id },
    });
    expect(plantilla.formato).toBe('pdf-cya');
    expect(plantilla.vigente).toBe(true);
    expect(plantilla.porcentajeAdicional.toNumber()).toBe(7);
    // Los campos variables llegan sembrados y con el NÚMERO DE ORDEN primero (§Post-F9.2: es la
    // referencia principal del cliente, la que sale como "Pedido cliente").
    const campos = plantilla.camposVariables as { campo: string }[] | null;
    expect(campos?.[0]?.campo).toBe('numeroOrden');
    expect(campos?.length).toBeGreaterThan(1);
  });

  it('re-sembrar no la duplica ni la revive (idempotente)', async () => {
    await sembrar(prisma);
    await sembrar(prisma);
    expect(await prisma.plantillaImportacion.count()).toBe(1);
  });

  it('NO toca al cliente que ya tiene plantilla configurada por una persona', async () => {
    const otro = await prisma.cliente.create({ data: { nombre: 'CYA' } });
    await prisma.plantillaImportacion.create({
      data: {
        idCliente: otro.id,
        nombre: 'La que configuró alguien',
        version: 1,
        vigente: true,
        formato: 'excel',
        mapeo: [{ indice: 0, columna: 'A', rol: 'modeloCliente' }],
        porcentajeAdicional: 3,
      },
    });
    await sembrar(prisma);

    const suyas = await prisma.plantillaImportacion.findMany({ where: { idCliente: otro.id } });
    expect(suyas).toHaveLength(1);
    expect(suyas[0]?.formato).toBe('excel');
    expect(suyas[0]?.porcentajeAdicional.toNumber()).toBe(3);
  });
});
