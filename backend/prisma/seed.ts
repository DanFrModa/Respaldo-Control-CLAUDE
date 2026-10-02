/**
 * Seed de la fundación (F0) — IDEMPOTENTE: se puede correr N veces sin duplicar
 * (todo son upserts/sincronizaciones por clave natural). Se ejecuta con
 * `npm run db:seed` (= `prisma db seed`, configurado en prisma.config.ts).
 *
 * Siembra:
 *  1. La empresa "FR Moda" (favorita) con su configuración — datos reales de
 *     `Respaldo CLAUDE/TABLAS/Empresas.csv` y `Propiedades.csv`.
 *  2. El catálogo de permisos de `src/contrato` (sincronización por `clave`, A4).
 *  3. Los roles predefinidos que absorben los NIVELES del sistema viejo
 *     (doc 00-Arranque-Login-y-Menu.md §2) con una asignación de permisos APROXIMADA
 *     que Daniel validará en la pantalla de roles (ver mapeo abajo).
 *  4. El usuario `admin` con contraseña temporal y rol Administrador.
 *  5. La plantilla de importación de C&A (formato `pdf-cya`, 7% de sobre-pedido) SI el cliente
 *     ya existe — §Post-F9.70 punto 2: sin ella el 7% de Daniel no operaba.
 *  6. El ORDEN canónico de las tallas ya cargadas (V1-E3r, §Post-F9.81): repara el `orden = 0`
 *     que dejó el ETL, sin pisar nunca un orden que puso una persona.
 */
import { pathToFileURL } from 'node:url';

import { hashPassword } from 'better-auth/crypto';

import { CATALOGO_PERMISOS, CLAVES_PERMISO, type ClavePermiso } from '../src/contrato/index.js';
import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';
import { CLAVES_GOBIERNO } from '../src/dominio/admin/guard-administradores.js';
import { deducirOrdenTalla, ORDEN_SIN_ASIGNAR } from '../src/dominio/catalogos/orden-de-tallas.js';
import {
  CAMPOS_VARIABLES_DEFAULT_CYA,
  esNombreDeCya,
  PORCENTAJE_ADICIONAL_CYA,
} from '../src/dominio/pedidos/plantilla-cya.js';

import { sembrarCalidad } from './seed-calidad.js';
import { sembrarRutaCritica } from './seed-ruta-critica.js';
import { sembrarRutaCriticaPlantillas } from './seed-ruta-critica-plantillas.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Empresa FR Moda + configuración (ex-`Propiedades`, ahora POR empresa — plan §4)
// ─────────────────────────────────────────────────────────────────────────────

async function sembrarEmpresa(prisma: PrismaClient): Promise<number> {
  // Datos reales de Empresas.csv (IdEmpresas=8: la favorita, Importancia=1).
  const empresa = await prisma.empresa.upsert({
    where: { nombre: 'FR Moda' },
    // No se pisa nada si ya existe: la empresa es DATO del negocio, no catálogo de código.
    update: {},
    create: {
      nombre: 'FR Moda',
      razonSocial: 'FR Moda, S.A. De C.V.',
      identificador: 'FR',
      favorita: true,
      paraIpt: true,
      paraEdr: true,
      activa: true,
    },
  });

  // Valores vigentes de Propiedades.csv: UtilidadSujerida=50, Regalias=10, ColchonCostura=1.
  // Las fechas de inventario físico y el almacén PT por defecto los traerá la migración (F10).
  await prisma.configuracionEmpresa.upsert({
    where: { idEmpresa: empresa.id },
    update: {},
    create: {
      idEmpresa: empresa.id,
      utilidadSugerida: 50,
      regaliasBase: 10,
      colchonCostura: 1,
    },
  });

  return empresa.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Permisos: la BD se sincroniza con el catálogo tipado de src/contrato
// ─────────────────────────────────────────────────────────────────────────────

async function sembrarPermisos(prisma: PrismaClient): Promise<Map<ClavePermiso, number>> {
  const idPorClave = new Map<ClavePermiso, number>();
  for (const permiso of CATALOGO_PERMISOS) {
    const fila = await prisma.permiso.upsert({
      where: { clave: permiso.clave },
      update: { descripcion: permiso.descripcion, modulo: permiso.modulo },
      create: {
        clave: permiso.clave,
        descripcion: permiso.descripcion,
        modulo: permiso.modulo,
      },
    });
    idPorClave.set(permiso.clave, fila.id);
  }

  // Un permiso en BD que ya no está en el catálogo es señal de catálogo desactualizado:
  // se avisa pero NO se borra (podría tener asignaciones; lo decide una migración expresa).
  const huerfanos = await prisma.permiso.findMany({
    where: { clave: { notIn: [...CLAVES_PERMISO] } },
    select: { clave: true },
  });
  for (const huerfano of huerfanos) {
    console.warn(`⚠ Permiso en BD fuera del catálogo de src/contrato: ${huerfano.clave}`);
  }

  return idPorClave;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Perfiles predefinidos — CADA UNO DECLARA LO QUE TIENE (A4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⛔ AQUÍ YA NO HAY CASCADA, Y ES A PROPÓSITO (DANIEL, 3-sep-2026).
 *
 * Hasta hoy los perfiles se derivaban por RESTA encadenada (`sin(todos, …)` → directivo →
 * gerencial → … → secretarial). Daniel lo mandó quitar con el argumento de quien ya lo vivió:
 *
 * > *«Los permisos por cascada no son funcionales. Así lo hice en la primera versión que hice en
 * > Access, y luego lo modifiqué por **permisos concretos**… puede haber alguien que tenga el
 * > permiso A pero no el B, y otra persona que tenga el B pero no el A. Si se hace por cascada nos
 * > vamos a tener que conformar con que **algunas personas accedan a cosas que no deberían**.»*
 *
 * 🔑 **El defecto que esto cierra: era un guardián AL REVÉS — el silencio OTORGABA.** Un permiso
 * nuevo se agregaba al catálogo de `src/contrato`, entraba a `todos` y, si nadie se acordaba de
 * restárselo a alguien, **bajaba solo hasta Secretarial**. Así aterrizó `esma.cargo-validar` en un
 * perfil clerical sin que nadie lo decidiera (y así se quedó hasta la fila 0.128, que se lo quitó a
 * los cinco perfiles operativos porque *«la validación sólo la doy yo»*). Con la forma de SUMA, un
 * permiso nuevo **no nace en NADIE** hasta que se le nombra dueño aquí, y
 * `reparto-de-permisos.test.ts` truena si se queda sin dueño (o si aquí queda una clave fantasma
 * que el catálogo ya no tiene).
 *
 * ⚠️ El MOTOR nunca fue cascada y no se tocó: `RolPermiso`/`UsuarioRol` son N:M y los permisos
 * efectivos son la UNIÓN de los roles del usuario (`comun/permisos.ts`). La cascada vivía sólo en
 * este archivo, al REPARTIR. Por eso este cambio no lleva migración ni permisos nuevos.
 *
 * ## Cómo se edita esto
 *
 * Cada perfil es una lista literal ordenada alfabéticamente (que es tanto como decir agrupada por
 * módulo, porque la clave es `modulo.accion`). Se le agrega o se le quita **a ese perfil y a nadie
 * más**: dos perfiles pueden cruzarse sin contenerse, que es justo lo que Daniel pidió. Añadir un
 * permiso al catálogo obliga a decidir aquí quién lo tiene — o a listarlo en
 * {@link SOLO_ADMINISTRADOR} con su razón.
 *
 * ## ⚠️ Lo que estas seis listas SON hoy, y lo que TODAVÍA NO son
 *
 * Nacieron siendo **exactamente** el reparto que producía la cascada el 3-sep-2026, transcrito: el
 * cambio de aquel día fue de FORMA, no de contenido (lo fija la prueba de EQUIVALENCIA). Eso quiere
 * decir que siguen arrastrando lo que la cascada regalaba: **76 de los 122 permisos no se le
 * restaban a nadie**, así que `Secretarial` conserva hoy cosas tan gordas como `compras.autorizar`,
 * `pedidos.modificar`, `notas.cancelar`, `inventario-pt.mover`, `telas.ver-totales` o
 * `calidad.modificar-auditorias`. **Recortarlas en bloque no era trabajo de aquel cambio**: Daniel
 * decidió armar los perfiles concretos AL FINAL, con los puestos reales de sus 23 usuarios. Esta
 * forma es la que hace que ese recorte sea posible sin efectos colaterales.
 *
 * ✂️ **PRIMER RECORTE REAL (fila 0.128, 4-sep-2026): VALIDAR ES DE DANIEL.** *«La entrada la da la
 * persona responsable de recibos o de producción. Pero la validación sólo la doy yo»*
 * (§Post-F9.192(1)). Los dos permisos de validar —`esma.cargo-validar` (fijar cantidad y precio
 * reales del cargo) y `esma.revisar` (autorizar la partida para que entre al saldo)— quedan sólo en
 * el administrador y en `Directivo`. Se los quitó a `Gerencial`, `Ventas`, `Logistica`, `Asistente`
 * y `Secretarial`, que es donde la cascada los había dejado sin que nadie lo decidiera. La lista
 * `RETIRADOS_DESDE_LA_FOTO` de `reparto-de-permisos.test.ts` lo deja escrito renglón por renglón.
 *
 * ⭐ **Y «AL FINAL» YA LLEGÓ: los perfiles por puesto real EXISTEN** — {@link PERFILES_DE_PUESTO}.
 * Eso NO recorta estas seis listas (los 9 heredados siguen igual, con su foto y su equivalencia:
 * son los que tienen los usuarios de hoy); lo que hace es dar el sitio donde el reparto por puesto
 * vive de verdad, sin que el seed lo pise en cada deploy.
 *
 * ⚠️ **Y esto se APLICA SOLO en `prueba` con `SEED_ON_START=true`**, sin migración de datos:
 * {@link sembrarRoles} SINCRONIZA los 10 roles de sistema (borra lo que sobra), no sólo agrega.
 */

/**
 * Claves que **ningún ROL DE SISTEMA reparte**: de los de {@link definirRoles} sólo las llevan los
 * de {@link PERFILES_ACCESO_TOTAL}, que se llevan el catálogo entero.
 *
 * No es una lista de descarte: es la **atribución explícita** de esas claves. Está aquí —y no
 * simplemente ausente de los perfiles— para que la prueba de atribución pueda distinguir
 * «decidimos que es sólo del administrador, y por esto» de «a nadie se le ocurrió repartirlo». La
 * `razon` es obligatoria por el tipo, no por convención.
 *
 * ⚠️ **PERO OCHO DE ELLAS SÍ LAS REPARTE UN PERFIL DE PUESTO, y hay que leerlo bien.** Los 15
 * perfiles de {@link PERFILES_DE_PUESTO} **no son roles de sistema** (nacen `esSistema: false`, el
 * seed no los re-sincroniza y el dueño los edita desde la pantalla de Roles), así que no entran en
 * esta lista ni en la prueba de atribución — pero el seed **los crea con esas llaves dentro**:
 *
 *  • `telas.administrar` y `avios.administrar` → «Desarrollo de Producto» (los avíos, también
 *    «Compras»);
 *  • `proveedores.administrar`, `terceros.administrar`, `terceros.fiscal`, `cxp.administrar`,
 *    `cxc.administrar` y `conceptos-pago.administrar` → «Administración y Finanzas».
 *
 * Las ocho eran **defaults del lead** («catálogo maestro: el `.ver` sí baja, el alta no»), no
 * reservas que Daniel hubiera pedido para sí. De las que él reservó con nombre y apellido
 * —`salida-material.registrar`, `pagos.corrida-armar`, `compras.desautorizar`, los cuatro poderes de
 * la fila 0.120 y el gobierno de usuarios/roles— **ningún perfil de puesto lleva ninguna** salvo el
 * del propio dueño ({@link PERFIL_DIRECTOR_GENERAL}, que lleva el catálogo completo).
 */
export const SOLO_ADMINISTRADOR: readonly { clave: ClavePermiso; razon: string }[] = [
  // ── Administración del propio sistema (en el viejo, botón exclusivo de nivel ≤20, doc 00 §3.1) ──
  {
    clave: 'usuarios.administrar',
    razon: 'Dar de alta gente y repartir roles es gobierno del sistema (llave anti-lockout).',
  },
  {
    clave: 'roles.administrar',
    razon: 'Decidir qué otorga cada rol es gobierno del sistema (llave anti-lockout).',
  },
  {
    clave: 'empresas.administrar',
    razon: 'La empresa y su configuración son los cimientos multi-empresa (A9).',
  },
  // ── Catálogos MAESTROS: el `.ver` lo lleva casi todo perfil; el alta, no (F1-E1, ADR-0007) ──
  { clave: 'almacenes.administrar', razon: 'Catálogo maestro: el `.ver` sí baja, el alta no.' },
  {
    clave: 'proveedores.administrar',
    // 🤝 También lo lleva el perfil de puesto «Administración y Finanzas» (ver la nota ⚠️ de la
    // cabecera de esta lista): eso es un rol EDITABLE del negocio, no un rol de sistema.
    razon: 'Catálogo maestro; además absorbió maquileros y cortadores (D12/R15).',
  },
  { clave: 'temporadas.administrar', razon: 'Catálogo maestro (ADR-0007).' },
  { clave: 'etiquetas-marca.administrar', razon: 'Catálogo maestro (ADR-0007).' },
  { clave: 'colores.administrar', razon: 'Catálogo maestro (ADR-0007).' },
  { clave: 'tallas.administrar', razon: 'Catálogo maestro estructurado (F1-E2).' },
  { clave: 'clientes.administrar', razon: 'Catálogo maestro estructurado (F1-E2).' },
  // 🤝 `telas.administrar` y `avios.administrar` los lleva además «Desarrollo de Producto» (y los
  // avíos, también «Compras») — perfiles de puesto EDITABLES, no roles de sistema.
  { clave: 'telas.administrar', razon: 'Catálogo maestro de materiales (F1-E3).' },
  { clave: 'avios.administrar', razon: 'Catálogo maestro de materiales (F1-E3).' },
  { clave: 'tipos-proceso.administrar', razon: 'Catálogo maestro de producción (F3-E1).' },
  {
    clave: 'calidad.administrar-catalogo',
    razon: 'Defectos, tipos de producto y planes AQL son catálogo maestro (F6-E1).',
  },
  {
    clave: 'concepto-costo.administrar',
    razon: 'Catálogo de configuración de costeo (F8-E1, R19).',
  },
  { clave: 'estado-lista.administrar', razon: 'Catálogo de configuración de listas (F8-E1, R20).' },
  {
    clave: 'rc.catalogo-administrar',
    razon:
      'Procesos, plantillas, reglas y calendario de la Ruta Crítica: mueve la planeación entera ' +
      '(fix de pentest — antes se colaba a roles clericales).',
  },
  // ── Finanzas: capturar/cancelar dinero y la vista fiscal (F9, D12/D15) ──
  //
  // 🤝 Las CINCO las lleva además el perfil de puesto «Administración y Finanzas» (Daniel): el área
  // que lleva la cuenta corriente es la que la captura. Siguen aquí porque esta lista habla de los
  // ROLES DE SISTEMA, y un perfil de puesto no es uno (ver la nota ⚠️ de la cabecera). Lo que NO se
  // movió es lo que Daniel reservó por su nombre: `pagos.corrida-armar`, abajo.
  {
    clave: 'terceros.administrar',
    razon: 'Capturar y cancelar movimientos de cuenta corriente mueve saldos reales (F9-E1).',
  },
  { clave: 'terceros.fiscal', razon: 'La vista fiscal es material del contador (F9-E1).' },
  {
    clave: 'cxp.administrar',
    razon: 'Capturar y cancelar cuentas por pagar mueve dinero (F9-E2).',
  },
  {
    clave: 'cxc.administrar',
    razon: 'Capturar y cancelar cuentas por cobrar e importar CFDI de venta (F9-E4).',
  },
  {
    clave: 'conceptos-pago.administrar',
    razon:
      'Catálogo maestro (ADR-0007): dar de alta un concepto de pago es dar de alta A DÓNDE puede ' +
      'salir dinero fuera del padrón de proveedores (fila 0.125).',
  },
  {
    clave: 'pagos.corrida-armar',
    razon:
      'Daniel la pidió para él (§Post-F9.189(g)): armar la corrida es decidir a quién se le paga y ' +
      'cuánto. *«Yo voy decidiendo los montos a pagar de cada uno. Manualmente.»* Ver la relación ' +
      'sí se reparte (`pagos.corrida-ver`); armarla no.',
  },
  // ── ⭐ La salida de material que NO va a una orden (fila 0.104) ──
  {
    clave: 'salida-material.registrar',
    razon:
      'Daniel la pidió para él y con esas palabras (§Post-F9.193 resp. 12, 3-sep-2026): *"sí debe ' +
      'existir una salida por otro medio que sólo ajuste de inventario… siempre autorizada sólo ' +
      'por mí. Nadie más"*. Sacar tela o avíos SIN orden (devolución al proveedor, venta de ' +
      'material que ya no se usa) es la única salida de material que no deja rastro en ninguna OP, ' +
      'así que NO puede ir con el `inventario-telas.mover`/`inventario-avios.mover` que hoy lleva ' +
      'medio organigrama. Gobierna también CANCELARLAS: el inverso devuelve el material al ' +
      'inventario, o sea deshace la misma decisión.',
  },
  // ── ⭐⭐ LOS CINCO PODERES QUE COLGABAN DE `roles.administrar` (fila 0.120) ──
  //
  // Hasta la 0.120 cinco facultades de negocio preguntaban por `roles.administrar` como marcador
  // de «es admin». Ahora cada una tiene su llave; van AQUÍ —y no en un perfil— porque la fila se
  // comprometió a **conservar el comportamiento de hoy**: quien podía, sigue pudiendo. Y quien
  // podía era exactamente el que tenía `roles.administrar`, que es esta misma lista
  // (`Administrador` + `AdministracionDireccion`, los dos de acceso total).
  //
  // 🔑 Que estén las cuatro aquí NO las vuelve la misma cosa: son cuatro renglones separados
  // precisamente para que Daniel pueda dar una y no las otras cuando arme los perfiles por puesto.
  // Antes eso era imposible —eran un solo interruptor con otro nombre—; ahora es quitar una línea.
  {
    clave: 'rc.capturar-cualquiera',
    razon:
      'Saltarse el filtro de responsabilidad de la Ruta Crítica (capturar el avance de un proceso ' +
      'que NO es de mis roles). Hereda el reparto que tenía colgado de `roles.administrar` hasta ' +
      'la fila 0.120; se reparte por puesto cuando Daniel arme los perfiles reales.',
  },
  {
    clave: 'rc.bandeja-completa',
    razon:
      'Ver la bandeja de la Ruta Crítica SIN filtro de responsabilidad (las tareas de todos, por ' +
      'defecto). Es facultad de supervisión y va aparte de `rc.capturar-cualquiera`: se puede ' +
      'querer ver todo sin poder capturar nada. Hereda el reparto de `roles.administrar` (0.120).',
  },
  {
    clave: 'compras.editar-autorizada',
    razon:
      'Modificar una orden de compra YA firmada sin quitarle el sello. Es la hermana callada de ' +
      '`compras.desautorizar` —que Daniel reservó para sí (§Post-F9.79)— y por eso vive en el ' +
      'mismo sitio. Hereda el reparto que tenía bajo `roles.administrar` hasta la fila 0.120.',
  },
  {
    clave: 'tipos-proceso.marcar-entrada-pt',
    razon:
      'Mover la bandera que decide si RECIBIR de un tipo de proceso mete prenda al inventario de ' +
      'producto terminado: es tocar el kardex desde la configuración, no editar un catálogo. ' +
      'Hereda el reparto que tenía bajo `roles.administrar` hasta la fila 0.120.',
  },
  // ── La marcha atrás de la firma de compra ──
  {
    clave: 'compras.desautorizar',
    razon:
      'Daniel la pidió para su perfil (§Post-F9.79): *"es indispensable tener un botón para ' +
      'desautorizar las órdenes, que solo yo tenga acceso"*. Autorizar sí se reparte; ' +
      'des-autorizar no.',
  },
];

/**
 * Los perfiles que llevan el catálogo COMPLETO. Se nombran aparte porque la prueba de atribución
 * tiene que EXCLUIRLOS: si contara sus permisos, la unión sería siempre el catálogo entero y la
 * prueba no podría fallar nunca.
 *
 * Son los dos niveles 1 y 20 del sistema viejo **y `Director General`**, el perfil de puesto del
 * dueño ({@link PERFIL_DIRECTOR_GENERAL}): Daniel lo definió con *«todos los permisos»*, así que lleva
 * el catálogo entero por derivación, igual que los otros dos. Entra aquí por eso y no por rango:
 * esta lista significa «tiene TODO el catálogo», no «es jefe».
 */
export const PERFILES_ACCESO_TOTAL = [
  'Administrador',
  'AdministracionDireccion',
  'Director General',
] as const;

/**
 * **Directivo** (nivel 30 del viejo) — dirige el negocio, no administra el sistema.
 *
 * Tiene todo salvo {@link SOLO_ADMINISTRADOR}: consulta los catálogos (`*.ver`) pero no los
 * administra, y no toca usuarios, roles ni empresas.
 */
const DIRECTIVO: readonly ClavePermiso[] = [
  'admin.ver-bitacora',
  'almacenes.ver',
  'avios.ver',
  'calidad.actualizar-auditorias',
  'calidad.generar-auditorias',
  'calidad.modificar-auditorias',
  'calidad.ver',
  'clientes.modificar',
  'clientes.ver',
  'colores.ver',
  'compras.administrar',
  'compras.autorizar',
  'compras.cancelar',
  'compras.recibir',
  'compras.ver',
  'concepto-costo.ver',
  'conceptos-pago.ver',
  'consultas.ver-importes',
  'costos.capturar',
  'costos.ver',
  'cxc.ver',
  'cxp.ver',
  'desarrollo.administrar',
  'desarrollo.precostear',
  'desarrollo.ver',
  'edr.capturar',
  'edr.ver',
  'esma.cargo-validar',
  'esma.modificar',
  'esma.revisar',
  'esma.ver-pagos',
  'estado-lista.ver',
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
  // ⭐ 0.061: cerrar la orden CONGELA su costo ⇒ va al círculo que ya cierra dinero. `Administrador`
  // y `AdministracionDireccion` lo toman solos ([...CLAVES_PERMISO]); aquí se le da al `Directivo`.
  // Default del lead — Daniel confirma.
  'ordenes.cerrar',
  'ordenes.habilitacion',
  'ordenes.modificar',
  'ordenes.precio-maquila',
  'ordenes.ver',
  'ordenes.ver-costos',
  'ordenes.ver-precio-real-maquila',
  'pagos.corrida-ver',
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
  'proveedores.modificar',
  'proveedores.ver',
  'rc.capturar',
  'rc.catalogo-ver',
  'rc.fecha-libre-cumplimiento',
  'rc.fechas-retraso',
  'rc.programar',
  'rc.ruta-ver',
  'rc.ver-botones',
  'tallas.ver',
  'telas.ver',
  'telas.ver-totales',
  'temporadas.ver',
  'terceros.ver',
  'tipos-proceso.ver',
];

/**
 * **Gerencial** (nivel 40) — gerencia sin el RESULTADO del negocio.
 *
 * La línea que trazó Daniel (§Post-F9.123): ve **EL PLAN** (lo que va a costar), no **EL
 * RESULTADO** (cómo terminamos). Por eso conserva `precostos.consultar`, `consultas.ver-importes`,
 * `modelos.administrar` y `modelos.aprobar-receta` —Aurora lleva Desarrollo entero— y NO lleva
 * `costos.*`, `edr.*` ni `ordenes.ver-costos`.
 *
 * ⚠️ Y el precio sigue siendo del dueño: lleva `listas.negociar` (arma y manda la cotización) pero
 * NO `listas.aprobar` (F8-E4 (h)), que desde V1-E8b es además la reja de los cuatro factores
 * —margen, descuentos, regalías, costo de ventas— (§Post-F9.125). Aprobar la RECETA y aprobar el
 * PRECIO son permisos distintos a propósito (§Post-F9.110 (b)): si se juntaran por descuido, Aurora
 * acabaría aprobando precios sin que nadie lo hubiera decidido.
 */
const GERENCIAL: readonly ClavePermiso[] = [
  'admin.ver-bitacora',
  'almacenes.ver',
  'avios.ver',
  'calidad.actualizar-auditorias',
  'calidad.generar-auditorias',
  'calidad.modificar-auditorias',
  'calidad.ver',
  'clientes.modificar',
  'clientes.ver',
  'colores.ver',
  'compras.administrar',
  'compras.autorizar',
  'compras.cancelar',
  'compras.recibir',
  'compras.ver',
  'concepto-costo.ver',
  'conceptos-pago.ver',
  'consultas.ver-importes',
  'cxc.ver',
  'cxp.ver',
  'desarrollo.administrar',
  'desarrollo.precostear',
  'desarrollo.ver',
  'esma.modificar',
  'esma.ver-pagos',
  'estado-lista.ver',
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
  'ordenes.ver-precio-real-maquila',
  'pagos.corrida-ver',
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
  'proveedores.modificar',
  'proveedores.ver',
  'rc.capturar',
  'rc.catalogo-ver',
  'rc.fecha-libre-cumplimiento',
  'rc.fechas-retraso',
  'rc.programar',
  'rc.ruta-ver',
  'rc.ver-botones',
  'tallas.ver',
  'telas.ver',
  'telas.ver-totales',
  'temporadas.ver',
  'terceros.ver',
  'tipos-proceso.ver',
];

/**
 * **Ventas** (nivel 45) — vende sin ver el dinero de la casa.
 *
 * Captura pedidos, pero sin importes (`pedidos.importes`, `consultas.ver-importes`), sin los
 * tableros directivos (`indicadores.ver`) y sin la cuenta corriente ni las carteras
 * (`terceros.ver`, `cxp.ver`, `cxc.ver`, F9). Tampoco administra ni aprueba modelos: eso es trabajo
 * de Desarrollo y se queda en Gerencial (§Post-F9.123 y §Post-F9.110 (b)).
 */
const VENTAS: readonly ClavePermiso[] = [
  'admin.ver-bitacora',
  'almacenes.ver',
  'avios.ver',
  'calidad.actualizar-auditorias',
  'calidad.generar-auditorias',
  'calidad.modificar-auditorias',
  'calidad.ver',
  'clientes.modificar',
  'clientes.ver',
  'colores.ver',
  'compras.administrar',
  'compras.autorizar',
  'compras.cancelar',
  'compras.recibir',
  'compras.ver',
  'concepto-costo.ver',
  'desarrollo.administrar',
  'desarrollo.precostear',
  'desarrollo.ver',
  'esma.modificar',
  'esma.ver-pagos',
  'estado-lista.ver',
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
  'listas.ver',
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
  'ordenes.ver-precio-real-maquila',
  'pedidos-reales.administrar',
  'pedidos.administrar',
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
  'proveedores.modificar',
  'proveedores.ver',
  'rc.capturar',
  'rc.catalogo-ver',
  'rc.fecha-libre-cumplimiento',
  'rc.fechas-retraso',
  'rc.programar',
  'rc.ruta-ver',
  'rc.ver-botones',
  'tallas.ver',
  'telas.ver',
  'telas.ver-totales',
  'temporadas.ver',
  'tipos-proceso.ver',
];

/**
 * **Logística** (nivel 47) — mueve mercancía; no crea ni modifica órdenes ni ve el pre-costo.
 *
 * Conserva `ordenes.ver` (consulta) pero no `ordenes.administrar`/`.modificar`/`.cancelar` ni los
 * precios de maquila. La pre-venta (armar proyectos, precostear, administrar listas) es de
 * Directivo/Gerencial/Ventas: aquí sólo queda la CONSULTA (`desarrollo.ver`, `listas.ver`).
 */
const LOGISTICA: readonly ClavePermiso[] = [
  'admin.ver-bitacora',
  'almacenes.ver',
  'avios.ver',
  'calidad.actualizar-auditorias',
  'calidad.generar-auditorias',
  'calidad.modificar-auditorias',
  'calidad.ver',
  'clientes.modificar',
  'clientes.ver',
  'colores.ver',
  'compras.administrar',
  'compras.autorizar',
  'compras.cancelar',
  'compras.recibir',
  'compras.ver',
  'concepto-costo.ver',
  'desarrollo.ver',
  'esma.modificar',
  'esma.ver-pagos',
  'estado-lista.ver',
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
  'listas.ver',
  'modelos.ver',
  'notas.administrar',
  'notas.cancelar',
  'notas.ver',
  'ordenes.habilitacion',
  'ordenes.ver',
  'pedidos-reales.administrar',
  'pedidos.administrar',
  'pedidos.modificar',
  'pedidos.modificar-reales',
  'pedidos.ver',
  'produccion.cancelar',
  'produccion.corte',
  'produccion.corte-salidas',
  'produccion.empaque',
  'produccion.entradas-maquila',
  'produccion.entrega',
  'produccion.envio',
  'produccion.recibo',
  'produccion.wip-ver',
  'proveedores.modificar',
  'proveedores.ver',
  'rc.capturar',
  'rc.catalogo-ver',
  'rc.fecha-libre-cumplimiento',
  'rc.fechas-retraso',
  'rc.programar',
  'rc.ruta-ver',
  'rc.ver-botones',
  'tallas.ver',
  'telas.ver',
  'telas.ver-totales',
  'temporadas.ver',
  'tipos-proceso.ver',
];

/**
 * **Asistente** (nivel 50) — asistente de dirección.
 *
 * Hoy su lista es idéntica a la de Logística (la única diferencia del viejo era el MENÚ de
 * catálogos de la RC, que nunca fue un acceso granular). Se escribe COMPLETA, y no como copia de
 * Logística, precisamente para que se le pueda quitar o dar algo sin arrastrar al otro perfil.
 */
const ASISTENTE: readonly ClavePermiso[] = [
  'admin.ver-bitacora',
  'almacenes.ver',
  'avios.ver',
  'calidad.actualizar-auditorias',
  'calidad.generar-auditorias',
  'calidad.modificar-auditorias',
  'calidad.ver',
  'clientes.modificar',
  'clientes.ver',
  'colores.ver',
  'compras.administrar',
  'compras.autorizar',
  'compras.cancelar',
  'compras.recibir',
  'compras.ver',
  'concepto-costo.ver',
  'desarrollo.ver',
  'esma.modificar',
  'esma.ver-pagos',
  'estado-lista.ver',
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
  'listas.ver',
  'modelos.ver',
  'notas.administrar',
  'notas.cancelar',
  'notas.ver',
  'ordenes.habilitacion',
  'ordenes.ver',
  'pedidos-reales.administrar',
  'pedidos.administrar',
  'pedidos.modificar',
  'pedidos.modificar-reales',
  'pedidos.ver',
  'produccion.cancelar',
  'produccion.corte',
  'produccion.corte-salidas',
  'produccion.empaque',
  'produccion.entradas-maquila',
  'produccion.entrega',
  'produccion.envio',
  'produccion.recibo',
  'produccion.wip-ver',
  'proveedores.modificar',
  'proveedores.ver',
  'rc.capturar',
  'rc.catalogo-ver',
  'rc.fecha-libre-cumplimiento',
  'rc.fechas-retraso',
  'rc.programar',
  'rc.ruta-ver',
  'rc.ver-botones',
  'tallas.ver',
  'telas.ver',
  'telas.ver-totales',
  'temporadas.ver',
  'tipos-proceso.ver',
];

/**
 * **Secretarial** (nivel 60) — captura.
 *
 * Hoy su lista es idéntica a la de Asistente (la restricción vieja —no modificar el precio de
 * maquila— ya se pierde en Logística). ⚠️ Es el perfil donde más se nota la herencia de la
 * cascada: conserva `compras.autorizar`, `pedidos.modificar`, `notas.cancelar`,
 * `inventario-pt.mover`, `telas.ver-totales` y `calidad.modificar-auditorias` porque **nadie se los
 * restó nunca**, no porque alguien lo decidiera. Cuando Daniel arme los perfiles por puesto real,
 * éste es el primero que hay que mirar.
 *
 * ✂️ Ya perdió `esma.cargo-validar` (fila 0.128): validar los cargos de maquila es de Daniel, no de
 * un perfil clerical. Era el ejemplo con el que se explicaba el defecto de la cascada — y el
 * primero en corregirse.
 */
const SECRETARIAL: readonly ClavePermiso[] = [
  'admin.ver-bitacora',
  'almacenes.ver',
  'avios.ver',
  'calidad.actualizar-auditorias',
  'calidad.generar-auditorias',
  'calidad.modificar-auditorias',
  'calidad.ver',
  'clientes.modificar',
  'clientes.ver',
  'colores.ver',
  'compras.administrar',
  'compras.autorizar',
  'compras.cancelar',
  'compras.recibir',
  'compras.ver',
  'concepto-costo.ver',
  'desarrollo.ver',
  'esma.modificar',
  'esma.ver-pagos',
  'estado-lista.ver',
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
  'listas.ver',
  'modelos.ver',
  'notas.administrar',
  'notas.cancelar',
  'notas.ver',
  'ordenes.habilitacion',
  'ordenes.ver',
  'pedidos-reales.administrar',
  'pedidos.administrar',
  'pedidos.modificar',
  'pedidos.modificar-reales',
  'pedidos.ver',
  'produccion.cancelar',
  'produccion.corte',
  'produccion.corte-salidas',
  'produccion.empaque',
  'produccion.entradas-maquila',
  'produccion.entrega',
  'produccion.envio',
  'produccion.recibo',
  'produccion.wip-ver',
  'proveedores.modificar',
  'proveedores.ver',
  'rc.capturar',
  'rc.catalogo-ver',
  'rc.fecha-libre-cumplimiento',
  'rc.fechas-retraso',
  'rc.programar',
  'rc.ruta-ver',
  'rc.ver-botones',
  'tallas.ver',
  'telas.ver',
  'telas.ver-totales',
  'temporadas.ver',
  'tipos-proceso.ver',
];

/**
 * ⭐⭐ LOS 16 PERFILES DE PUESTO REALES (decisión de Daniel) — el reparto por PUESTO, al fin.
 *
 * Esto es lo que las seis listas de arriba estaban esperando. Al quitar la cascada (3-sep-2026)
 * quedó escrito que *«Daniel decidió armar los perfiles concretos AL FINAL, con los puestos reales
 * de sus 23 usuarios»*: éstos son esos perfiles, con los nombres con los que él los revisó y las
 * llaves que él palomeó, puesto por puesto.
 *
 * **306 asignaciones**: las 134 del catálogo para `Director General` y 172 repartidas entre los
 * otros 15. Los nombres y las llaves son su decisión y NO se "mejoran" aquí: cambiarlas es cambiar
 * quién puede qué en la empresa, y eso se pide y se escribe, no se deduce.
 *
 * ## 🔴 LOS 16 SE SIEMBRAN POR DOS CAMINOS DISTINTOS, Y LA DIFERENCIA ES EL PUNTO
 *
 * | | Quién | Cómo se siembra | `esSistema` | ¿El deploy lo pisa? |
 * |---|---|---|---|---|
 * | {@link PERFIL_DIRECTOR_GENERAL} | el dueño | por {@link definirRoles} → {@link sembrarRoles} | `true` | **sí**, se re-sincroniza en cada arranque |
 * | estos 15 | los demás puestos | por {@link sembrarPerfilesDePuesto} | `false` | **no**: crear-si-no-existe |
 *
 * **Por qué no van los 16 juntos.** `sembrarRoles` SINCRONIZA (su `deleteMany({ notIn })` borra lo
 * que la definición no nombre) y `SEED_ON_START=true` está encendido **permanentemente** en
 * `prueba` ⇒ todo lo que pase por ahí se reescribe en CADA despliegue, en silencio. En
 * `Director General` eso es justo lo que se quiere: significa «todos los permisos», se deriva del
 * catálogo y no hay nada que afinar. En los otros 15 sería destructivo: el dueño va a ajustarlos
 * desde Administración › Roles en cuanto arranquen las pruebas —y `asignarPermisos`
 * (`dominio/admin/roles.ts`) **se lo permite, no distingue `esSistema`**—, así que pasarlos por
 * `sembrarRoles` le **borraría ese trabajo** en el siguiente deploy sin avisarle.
 *
 * ## Qué NO hace este bloque
 *
 * **No toca los 9 perfiles heredados** (`Administrador` … `Basico`): se agrega ADEMÁS. Los 9 siguen
 * siendo la transcripción de los niveles del viejo —con su foto del 3-sep y sus pruebas de
 * equivalencia— porque son los que tienen los usuarios de hoy. Ningún nombre nuevo choca con uno de
 * esos 9 (lo mide `roles-perfiles-puesto.test.ts`).
 *
 * ## ⭐ DOS NOMBRES COMPARTEN FILA CON UN ROL DE LA RUTA CRÍTICA — y está bien
 *
 * `Rol.nombre` es ÚNICO y los roles funcionales de la RC viven en la MISMA tabla
 * (`ROLES_FUNCIONALES_RC`, `prisma/seed-ruta-critica.ts`). **«Habilitaciones» y «Entregas»** están en
 * las dos listas, al carácter ⇒ el perfil de puesto y el rol de la RC **son la misma fila**.
 *
 * 🔑 **Y eso es lo correcto, no un choque que haya que deshacer:** **17 de los 18** roles funcionales
 * de la RC nacen `esSistema: false` y **con CERO permisos** —son cascarones para colgarles la
 * responsabilidad de un proceso (`ProcesoDefRol`)—, así que «Entregas» el rol de la RC y «Entregas» el
 * puesto son **la misma persona**. *(El 18.º es `Ventas`, que además es uno de los 9 heredados: el
 * upsert de la RC lleva `update: {}`, así que se queda `esSistema: true` con sus 85 permisos. No
 * afecta: ningún perfil de puesto se llama `Ventas`.)* {@link sembrarPerfilesDePuesto} llena el cascarón (sólo los permisos; no toca
 * `nombre`, `descripcion` ni `esSistema`) y el resultado es el mismo en una base limpia y en `prueba`:
 * la fila queda **con los permisos del puesto** y además sigue siendo responsable de su proceso de la
 * RC. Es puramente aditivo.
 *
 * ⚠️ **Lo que sí sigue siendo decisión del dueño** son los dos nombres que se distinguen de uno de la
 * RC **sólo por el ACENTO**: `Producción`/`Produccion` y `Diseño Gráfico`/`Diseño Grafico`. **NO** son
 * colisión (la columna distingue acentos) ⇒ son filas SEPARADAS, y se van a ver juntas y confusas en
 * Administración › Roles. No se tocan desde el código: renombrar un rol de la RC crearía una fila
 * nueva y dejaría huérfanas sus referencias.
 *
 * Las pruebas que fijan las colisiones —para que no se olviden ni crezcan en silencio— están en
 * `roles-perfiles-puesto.test.ts` y en `seed.int.test.ts`.
 *
 * ## El `slug`
 *
 * Es la llave con la que Daniel los revisó y **no viaja a la base de datos** (`Rol` no tiene esa
 * columna; se siembran por `nombre`). Se conserva aquí porque es lo que ata cada renglón a su
 * decisión, y porque las pruebas lo usan para nombrar el perfil sin depender de la redacción del
 * `nombre`.
 */
export type PerfilDePuesto = {
  slug: string;
  nombre: string;
  descripcion: string;
  permisos: readonly ClavePermiso[];
};

/**
 * ⭐ El perfil de puesto del DUEÑO — y el ÚNICO de los 16 que es rol de sistema.
 *
 * Daniel lo definió con *«todos los permisos»*, así que se **DERIVA de {@link CLAVES_PERMISO}** y
 * nunca se escribe a mano: un permiso que nazca mañana en `src/contrato/permisos.ts` tiene que
 * llegarle solo. Una lista literal de 134 claves quedaría obsoleta en el siguiente `clave:` que
 * alguien agregue — y nadie se enteraría, porque el seed no se queja de lo que NO reparte.
 *
 * Va por {@link definirRoles} (`esSistema: true`, re-sincronizado en cada arranque) a propósito: es
 * el único de los 16 en el que la re-sincronización es lo deseable, porque no hay nada que afinar.
 * Entra también en {@link PERFILES_ACCESO_TOTAL} por eso mismo.
 */
export const PERFIL_DIRECTOR_GENERAL: PerfilDePuesto = {
  slug: 'director',
  nombre: 'Director General',
  descripcion: 'Dirección general: lleva el catálogo de permisos COMPLETO',
  // ⭐ DERIVADO, NUNCA una lista literal — el porqué, arriba. Es el mismo `[...CLAVES_PERMISO]` con
  // el que se definen `Administrador` y `AdministracionDireccion`.
  permisos: [...CLAVES_PERMISO],
};

/**
 * ⭐⭐ Los otros **15 perfiles de puesto**: catálogo del NEGOCIO, no roles de sistema.
 *
 * Nacen `esSistema: false` y se siembran **crear-si-no-existe** ({@link sembrarPerfilesDePuesto}): el
 * seed los pone la primera vez y después **no los vuelve a tocar mientras les quede al menos un
 * permiso** (un rol en CERO es un cascarón, y ésos sí se llenan — el porqué, allí). Los reparte
 * Daniel y los afina él desde Administración › Roles: sus ajustes tienen que sobrevivir al
 * despliegue.
 *
 * ⚠️ `esSistema: false` **no es un detalle**: en `dominio/admin/roles.ts`, `eliminarRol` prohíbe
 * BORRAR un rol de sistema y `actualizarRol` prohíbe RENOMBRARLO. Si estos 15 nacieran en `true`, el
 * dueño se quedaría con 15 perfiles que no podría ni borrar ni corregirles el nombre.
 *
 * El orden es el que él revisó (ver {@link PERFILES_DE_PUESTO_TODOS} para la lista completa de 16).
 */
export const PERFILES_DE_PUESTO: readonly PerfilDePuesto[] = [
  {
    slug: 'ventas',
    nombre: 'Gerente de Ventas',
    descripcion:
      'Gerencia de ventas: clientes, pedidos y listas de precios, con los importes del pedido',
    permisos: [
      'avios.ver',
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
    descripcion:
      'Desarrollo de producto: modelos y su receta, catálogo de materiales y precosteo de proyectos',
    permisos: [
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
    descripcion:
      'Administración y finanzas: cuenta corriente de terceros, cuentas por pagar y por cobrar, y la vista fiscal',
    permisos: [
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
    descripcion:
      'Producción: corte, envío y recibo de maquila, empaque y captura de la Ruta Crítica',
    permisos: [
      'compras.recibir',
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
    descripcion: 'Compras: órdenes de compra y catálogo de avíos, con los datos de los proveedores',
    permisos: [
      'almacenes.ver',
      'avios.administrar',
      'avios.ver',
      'compras.administrar',
      'compras.ver',
      'inventario-avios.ver',
      'inventario-telas.ver',
      'modelos.ver',
      'notas.ver',
      'ordenes.ver',
      'proveedores.modificar',
      'proveedores.ver',
      'telas.ver',
    ],
  },
  {
    slug: 'habilitaciones',
    nombre: 'Habilitaciones',
    descripcion: 'Habilitaciones: notas de salida de avíos y movimientos del inventario de avíos',
    permisos: [
      'almacenes.ver',
      'avios.ver',
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
    descripcion: 'Encargado de telas: inventario de telas y recepción del material comprado',
    permisos: [
      'almacenes.ver',
      'compras.recibir',
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
    descripcion: 'Encargado de corte: captura del corte y de sus salidas de tela',
    permisos: [
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
    descripcion:
      'Almacén de producto terminado: movimientos, existencias, conteos cíclicos y recibo de maquila',
    permisos: [
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
      'produccion.recibo',
    ],
  },
  {
    slug: 'entregas',
    nombre: 'Entregas',
    descripcion: 'Entregas: entrega de producto terminado al cliente y consulta de existencias',
    permisos: [
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
    descripcion: 'Líder de calidad: genera y actualiza las auditorías de calidad',
    permisos: [
      'calidad.actualizar-auditorias',
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
    descripcion: 'Supervisor de calidad: actualiza las auditorías de calidad ya generadas',
    permisos: [
      'calidad.actualizar-auditorias',
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
    descripcion: 'Gestión técnica: administra la ficha de los modelos y consulta el desarrollo',
    permisos: [
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
    descripcion: 'Diseño gráfico: consulta de modelos y órdenes, y captura de datos de proveedores',
    permisos: ['modelos.ver', 'ordenes.ver', 'proveedores.modificar', 'proveedores.ver'],
  },
  {
    slug: 'auxiliar',
    nombre: 'Auxiliar',
    descripcion:
      'Auxiliar: consulta de modelos, órdenes, avance de producción y existencias de producto terminado',
    permisos: ['inventario-pt.ver', 'modelos.ver', 'ordenes.ver', 'produccion.wip-ver'],
  },
];

/**
 * Los **16 perfiles de puesto** de Daniel, juntos y en el orden en que él los revisó.
 *
 * Existe para las pruebas y para poder leer su decisión de un tirón; el seed NO itera esto, porque
 * los dos grupos se siembran por caminos distintos (ver la tabla de {@link PERFIL_DIRECTOR_GENERAL}
 * y el bloque de arriba). ⚠️ NO incluye {@link PERFIL_CONSULTA_GENERAL}: el piso de lectura **no es
 * un puesto**, y meterlo aquí falsearía las 306 marcas que él revisó.
 */
export const PERFILES_DE_PUESTO_TODOS: readonly PerfilDePuesto[] = [
  PERFIL_DIRECTOR_GENERAL,
  ...PERFILES_DE_PUESTO,
];

// ─────────────────────────────────────────────────────────────────────────────
// 3a-bis. EL PISO DE LECTURA — «casi todo lo operativo lo puede consultar cualquiera»
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⭐⭐ **LAS 16 LLAVES QUE SON DINERO.** La raya que puso el dueño, textual:
 *
 * > *«lo que sea dinero no debe estar en el piso»*
 *
 * Están aquí —con nombre y como constante— porque son **la primera de las dos exclusiones** que el
 * piso de lectura tiene que respetar para no convertirse en un agujero: los dos conjuntos tienen que
 * ser **disjuntos**. (La segunda es {@link PERMISOS_DE_SALDOS_Y_MOVIMIENTOS}, y va aparte porque es
 * otra decisión, con otra razón y otra cita.) Una lista enterrada en una prueba se borra sin que
 * nadie note que se borró la decisión; ésta tiene su razón pegada y su prueba de intersección vacía
 * (`roles-perfiles-puesto.test.ts`).
 *
 * No es «todo lo que toca dinero»: es **lo que lo DEJA VER** —precios, importes, costos, márgenes,
 * el estado de resultados, los saldos de terceros, la relación de pagos y el estado de cuenta de
 * maquileros—. Escribirlo es otra cosa y
 * ya estaba cerrado (`*.administrar`, `SOLO_ADMINISTRADOR`).
 */
export const PERMISOS_DE_DINERO: readonly ClavePermiso[] = [
  'ordenes.ver-precio-real-maquila',
  'pedidos.importes',
  'telas.ver-totales',
  'consultas.ver-importes',
  'costos.ver',
  'precostos.consultar',
  'edr.ver',
  'desarrollo.ver',
  'listas.ver',
  'terceros.ver',
  'terceros.fiscal',
  'cxp.ver',
  'cxc.ver',
  'conceptos-pago.ver',
  'pagos.corrida-ver',
  // ⚠️ `esma.ver-pagos` cierra la lista, y faltaba: *«Acceder al estado de cuenta de maquileros solo
  // para ver y registrar pagos»* es dinero de cabo a rabo. No había brecha —nunca estuvo en el piso—
  // pero la lista decía que cubría los pagos y no los cubría todos.
  'esma.ver-pagos',
];

/**
 * ⭐⭐ **LAS 4 LLAVES QUE SON SALDOS Y MOVIMIENTOS.** La segunda raya del piso, y la puso el dueño
 * mirando las existencias: *«creo que no tiene caso»*.
 *
 * No son dinero y no son vocabulario: son **el estado de hoy de un material** —existencias de
 * producto terminado, de telas y de avíos, y las notas de salida que las mueven—. **Cambian cada
 * día y responde por ellas quien las mueve**, así que no se reparten de piso: el dueño le dio cada
 * inventario exactamente a quien mueve ese material (PT a 5 puestos, telas a 4, avíos a 2, notas a
 * 3). **Nadie pierde nada**: quien las necesita ya las tiene por su puesto.
 *
 * Están aquí como constante, con su razón pegada, por el mismo motivo que {@link PERMISOS_DE_DINERO}:
 * para que una prueba pueda exigir que el piso y ellas sean **disjuntos**, y para que borrar la
 * decisión cueste borrar algo que se ve.
 */
export const PERMISOS_DE_SALDOS_Y_MOVIMIENTOS: readonly ClavePermiso[] = [
  'inventario-pt.ver',
  'inventario-telas.ver',
  'inventario-avios.ver',
  'notas.ver',
];

/**
 * ⭐⭐ **LAS 5 LLAVES OPERATIVAS QUE, DE PASO, FILTRAN UN PRECIO.** La tercera raya del piso, y la
 * decidió el dueño mirando la medición: **«Súbelo con 16 ahora»**.
 *
 * ⚠️ **NO son lo mismo que {@link PERMISOS_DE_DINERO}, y la diferencia es el criterio entero:**
 *
 * | | Qué son |
 * |---|---|
 * | {@link PERMISOS_DE_DINERO} | llaves **cuyo PROPÓSITO es** el dinero (costos, importes, saldos, EDR) |
 * | **estas cinco** | llaves **OPERATIVAS** —vocabulario del negocio puro— que **de paso devuelven un precio metido dentro de otro dato, sin taparlo** |
 *
 * Por eso no se pueden juntar: las primeras no entran al piso **nunca**; estas cinco entran **el día
 * que sus campos estén tapados**, y entonces salen de aquí.
 *
 * **Lo que filtra cada una, medido sobre el dominio y no supuesto:**
 *  • `telas.ver` → el precio sugerido, por color y por proveedor (**27 apariciones de
 *    `precioSugerido` en `dominio/catalogos/telas.ts` y CERO rejas**);
 *  • `avios.ver` → precio y precio de referencia;
 *  • `modelos.ver` → `maquilaBase`, `corteBase` y el `precioCosteo` del BOM, y el precio del arte;
 *  • `proveedores.ver` → **datos bancarios completos** (banco, CLABE, cuenta): la UI los enmascara,
 *    **el API los devuelve enteros**;
 *  • `ordenes.ver` → `maquilaReferencia`, el único campo de ese endpoint que no se tapa.
 *
 * Choca de frente con la regla del dueño (*«lo que sea dinero no debe estar en el piso»*) y con la
 * descripción del propio rol, que dice *«sin dinero»*. **El patrón para taparlo YA EXISTE**
 * (`puedeVerCostoRealDeModelo`, `consultas.ver-importes`); simplemente no se aplicó a estos campos, y
 * aplicarlo son **96 apariciones en 4 archivos del dominio y 8 pantallas** — demasiado para meterlo
 * deprisa en esta fila. Va en una fila aparte, y al cerrarse estas cinco vuelven al piso.
 *
 * 🔑 **Y POR QUÉ ESTA SALIDA CUESTA CASI NADA, que es lo que la hizo la buena:** el dueño **ya les
 * había dado estas cinco a quien las necesita**. Medido sobre sus 15 puestos: `ordenes.ver` la tienen
 * **15 de 15** (sacarla del piso **no le quita nada a nadie**), `modelos.ver` **13 de 15**,
 * `proveedores.ver` 8, `telas.ver` 7, `avios.ver` 5. Los permisos efectivos promedio por puesto
 * (su puesto ∪ el piso) bajan de **26.9 a 25.1**: menos de dos permisos. **El piso valía por las
 * llaves que él repartió POCO, y las que filtran dinero son justo las que repartió MUCHO.**
 */
export const PERMISOS_QUE_FILTRAN_PRECIO: readonly ClavePermiso[] = [
  'telas.ver',
  'avios.ver',
  'proveedores.ver',
  'modelos.ver',
  'ordenes.ver',
];

/**
 * ⭐⭐ **«Consulta general» — EL PISO DE LECTURA.** Decisión del dueño, replanteando el modelo
 * entero: **casi todo lo operativo lo puede consultar cualquiera; lo que se niega es ESCRIBIR, el
 * DINERO y los poderes de EXCEPCIÓN.**
 *
 * Nació de una medición, **re-hecha con el escáner de rutas arreglado** (el que resuelve también
 * `conAlgunPermiso` y los guards declarados en variable) y con el criterio dicho, porque sin criterio
 * no se reproduce: de las **134** claves del catálogo, **sólo 34 son de PURA LECTURA** —todas sus
 * rutas son `GET`—, **76 ESCRIBEN** (al menos una ruta no-`GET`; **24 de ésas son MIXTAS**, guardan
 * `GET` *y* no-`GET`, y **cuentan como escritura** porque tener la llave deja escribir) y **24 no
 * guardan ninguna ruta** (se verifican en el dominio o gobiernan un campo o un botón). Total 666
 * bloques `app.route`, 664 con reja. ⇒ repartir la consulta permiso por permiso, puesto por puesto,
 * era repartirla con cuentagotas. Este rol da esas 16 de una vez y **se mueve desde la pantalla**
 * (Administración › Roles), que es lo que el dueño pidió: ver y ajustar el piso, no descubrirlo
 * escondido en una regla del código. Por eso es **un rol**, no un `if` en el guard de permisos.
 *
 * ## 🔑 EL CRITERIO DE QUÉ ENTRA (la regla que gobierna esto de aquí en adelante)
 *
 * Al piso va el **VOCABULARIO DEL NEGOCIO**: catálogos, modelos, órdenes, pedidos, el avance, la
 * ruta crítica — **el idioma con el que se leen las demás pantallas**. Sin eso, media aplicación se
 * ve en blanco o con códigos en vez de nombres.
 *
 * **NO va lo que son SALDOS Y MOVIMIENTOS** ({@link PERMISOS_DE_SALDOS_Y_MOVIMIENTOS}: existencias
 * de PT, telas y avíos, y las notas de salida), porque **cambian cada día y responde por ellos quien
 * los mueve**. El dueño, de las existencias: *«creo que no tiene caso»*.
 *
 * Y **NUNCA va el DINERO** ({@link PERMISOS_DE_DINERO}). Textual: *«lo que sea dinero no debe estar
 * en el piso»*.
 *
 * ⚠️ **Y TAMPOCO —POR AHORA— las cinco llaves OPERATIVAS QUE FILTRAN UN PRECIO**
 * ({@link PERMISOS_QUE_FILTRAN_PRECIO}: `telas.ver`, `avios.ver`, `proveedores.ver`, `modelos.ver`,
 * `ordenes.ver`). Son vocabulario del negocio y **deberían** estar aquí; salen porque devuelven
 * precios metidos dentro de otros datos **sin taparlos**, y taparlos no cabía en esta fila.
 * **Volverán al piso cuando sus campos estén tapados** — lo que filtra cada una, y por qué sacarlas
 * cuesta casi nada, está en el TSDoc de esa lista.
 *
 * Las tres exclusiones son **invariantes medidas, no intenciones**: tres pruebas exigen intersección
 * vacía en `roles-perfiles-puesto.test.ts`.
 *
 * ⚠️ **UNA DE LAS 16 NO ES `GET` PURO, Y ES DELIBERADO — no la "limpies":**
 *  • **`indicadores.ver`** → su único no-GET es `POST /indicadores/refrescar`, que **encola un
 *    refresco de las vistas de KPIs**. No es dato del negocio.
 *
 * *(Eran dos: `POST /ordenes/impresos` por `ordenes.ver`, que es POST sólo porque la lista de ids
 * viaja en el cuerpo. Esa excepción desapareció sola al salir `ordenes.ver` del piso.)*
 *
 * Medido sobre las rutas, no supuesto: las 16 guardan **93 endpoints** (96 pares endpoint-llave) y
 * **exactamente ése** no es GET. Lo vigila el guardián de `roles-perfiles-puesto.test.ts`, que vuelve a escanear
 * los `*.rutas.ts` de `src/api` en cada corrida: si alguien cuelga una escritura de una llave del piso, se
 * pone rojo.
 *
 * ⭐ **Y UNA TERCERA, `ordenes.habilitacion`, que obligó a corregir el catálogo.** Gobierna **un solo
 * endpoint y es un `GET`** (`GET /ordenes/:id/habilitacion`: requerido vs. surtido por avío), así que
 * en el piso es lectura pura — pero **su descripción decía «Capturar o modificar los avíos de la
 * orden»**, heredada del acceso #31 del Access, o sea un renglón que dice *capturar* dentro de un rol
 * de **consulta**. Era falsa (ningún endpoint de escritura cuelga de esa llave) y se corrigió en
 * `src/contrato/permisos.ts` en este mismo cambio, con la nota de por qué, para que nadie la
 * restaure. ⚠️ Lo que sigue en pie: **el día que alguien cuelgue un POST de esa llave, el piso se
 * vuelve escritura para todos** — y el guardián de arriba es justo lo que lo cazará.
 *
 * ## Qué NO hace este rol
 *
 * **No adelgaza los 15 perfiles de puesto.** Siguen con las llaves que el dueño marcó aunque **12 de
 * las 16 del piso** estén también en algún puesto: los permisos efectivos son la **UNIÓN** de los
 * roles del usuario (`comun/permisos.ts`), así que la redundancia no cambia el comportamiento, las
 * 172 marcas quedan literales, y si algún día el piso encoge, el puesto que de verdad necesitaba la
 * llave la conserva.
 *
 * 🔑 **Y eso es lo que hace inocuo recortar el piso.** Las cuatro llaves de saldos y movimientos que
 * salieron de aquí (`PERMISOS_DE_SALDOS_Y_MOVIMIENTOS`) **no se le quitaron a nadie**: el dueño ya le
 * había dado cada inventario a quien mueve ese material — medido en los puestos: PT a **5**, telas a
 * **4**, avíos a **2**, notas de salida a **3**.
 *
 * Se siembra por el **mismo camino** que los 15 ({@link sembrarPerfilesDePuesto}: `esSistema: false`,
 * crear-si-no-existe, y si existe con permisos no se toca). No es un mecanismo nuevo.
 */
export const PERFIL_CONSULTA_GENERAL: PerfilDePuesto = {
  slug: 'consulta-general',
  nombre: 'Consulta general',
  descripcion:
    'Piso de lectura: consultar lo operativo (órdenes, pedidos, producción, inventarios, catálogos y calidad), sin escribir y sin dinero',
  permisos: [
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
  ],
};

/**
 * Los roles que {@link sembrarPerfilesDePuesto} siembra: los 15 perfiles de puesto **y** el piso de
 * lectura. Todos `esSistema: false`, todos crear-si-no-existe, ninguno re-sincronizado.
 *
 * Se deriva por spread a propósito: agregar un perfil a {@link PERFILES_DE_PUESTO} lo mete aquí solo,
 * sin que nadie tenga que acordarse de una segunda lista.
 */
export const PERFILES_EDITABLES: readonly PerfilDePuesto[] = [
  ...PERFILES_DE_PUESTO,
  PERFIL_CONSULTA_GENERAL,
];

/**
 * Los perfiles de sistema (`esSistema: true`), en dos bloques que NO se mezclan:
 *
 *  1. **Los 9 HEREDADOS** (`Administrador` … `Basico`), que absorben los NIVELES del viejo
 *     (doc 00 §2, A4) y son los que tienen los usuarios de hoy. Se escriben aquí, literales.
 *  2. **`Director General`** ({@link PERFIL_DIRECTOR_GENERAL}), el perfil de puesto del dueño: el
 *     ÚNICO de los 16 que es rol de sistema, porque es el único en el que re-sincronizar es lo
 *     deseable. Los otros 15 NO pasan por aquí — van por {@link sembrarPerfilesDePuesto}, que no
 *     sincroniza nada.
 *
 * Ninguno de los 9 se toca, se renombra ni se reordena.
 *
 * ⚠️ `sembrarRoles` los **re-sincroniza** en cada arranque con `SEED_ON_START=true`: lo que se
 * palomee a mano en la pantalla de Roles sobre cualquiera de ellos se pierde en el siguiente deploy
 * (salvo las llaves de gobierno, que el seed nunca revoca — ver `sembrarRoles`). La pantalla lo
 * avisa; para un permiso permanente hay que crear un perfil propio.
 */
export function definirRoles(): {
  nombre: string;
  descripcion: string;
  permisos: ClavePermiso[];
}[] {
  return [
    {
      nombre: 'Administrador',
      // Nivel 1 (Daniel): todo, incluida la administración del sistema.
      descripcion: 'Acceso total al sistema (absorbe el nivel 1 del sistema viejo)',
      permisos: [...CLAVES_PERMISO],
    },
    {
      nombre: 'AdministracionDireccion',
      // Nivel 20: "todo menos modificar la base de datos" — modificar el diseño de la BD
      // era una capacidad de Access, no de la aplicación; en v2 no existe como permiso.
      descripcion:
        'Administración y dirección: todo el sistema (absorbe el nivel 20 del sistema viejo)',
      permisos: [...CLAVES_PERMISO],
    },
    {
      nombre: 'Directivo',
      descripcion: 'Dirección del negocio sin administración del sistema (absorbe el nivel 30)',
      permisos: [...DIRECTIVO],
    },
    {
      nombre: 'Gerencial',
      descripcion: 'Gerencia sin acceso a costos (absorbe el nivel 40)',
      permisos: [...GERENCIAL],
    },
    {
      nombre: 'Ventas',
      descripcion: 'Ventas sin importes totales ni costos (absorbe el nivel 45)',
      permisos: [...VENTAS],
    },
    {
      nombre: 'Logistica',
      descripcion: 'Logística sin importes y sin modificar órdenes (absorbe el nivel 47)',
      permisos: [...LOGISTICA],
    },
    {
      nombre: 'Asistente',
      descripcion: 'Asistente de dirección (absorbe el nivel 50)',
      permisos: [...ASISTENTE],
    },
    {
      nombre: 'Secretarial',
      descripcion: 'Captura secretarial (absorbe el nivel 60)',
      permisos: [...SECRETARIAL],
    },
    {
      nombre: 'Basico',
      // Nivel 100 ("nivUltimo"): el más restringido; en el viejo, sus accesos se
      // activaban uno por uno por usuario → el rol arranca sin permisos.
      descripcion: 'Acceso básico sin permisos especiales (absorbe el nivel 100)',
      permisos: [],
    },
    // ── ⭐ Y ADEMÁS, el perfil de puesto del DUEÑO (ver PERFIL_DIRECTOR_GENERAL) ──
    //
    // Va DESPUÉS y aparte a propósito: los 9 de arriba son la transcripción de los niveles del
    // viejo —con su foto del 3-sep y sus pruebas de equivalencia— y mezclarlos obligaría a retocar
    // esa foto, que es justo lo que no se hace. Los otros 15 perfiles de puesto NO están aquí: van
    // por `sembrarPerfilesDePuesto`, que crea-si-no-existe y nunca pisa lo que el dueño ajuste.
    // El `slug` no viaja a la BD (`Rol` no tiene esa columna; se siembra por `nombre`).
    {
      nombre: PERFIL_DIRECTOR_GENERAL.nombre,
      descripcion: PERFIL_DIRECTOR_GENERAL.descripcion,
      permisos: [...PERFIL_DIRECTOR_GENERAL.permisos],
    },
  ];
}

async function sembrarRoles(
  prisma: PrismaClient,
  idPermisoPorClave: Map<ClavePermiso, number>,
): Promise<void> {
  for (const rol of definirRoles()) {
    const fila = await prisma.rol.upsert({
      where: { nombre: rol.nombre },
      update: { descripcion: rol.descripcion, esSistema: true },
      create: { nombre: rol.nombre, descripcion: rol.descripcion, esSistema: true },
    });

    const idsPermisos = rol.permisos.map((clave) => {
      const id = idPermisoPorClave.get(clave);
      if (id === undefined) {
        throw new Error(`Permiso "${clave}" del rol ${rol.nombre} no está sembrado`);
      }
      return id;
    });

    // Los roles de sistema se SINCRONIZAN con esta definición (estado conocido):
    // se quita lo que sobre y se agrega lo que falte, sin duplicar.
    //
    // ⚠️ CON UNA EXCEPCIÓN (guard anti-lockout, `src/dominio/admin/guard-administradores.ts`):
    // el seed NUNCA REVOCA una clave de GOBIERNO. Si Daniel le da `usuarios.administrar`
    // al rol Gerencial desde la pantalla de Roles —para que Aurora administre— y luego
    // se quita el suyo (el guard lo permite, y hace bien: Aurora cuenta), esta
    // sincronización se la arrancaría a Gerencial en el siguiente deploy con
    // SEED_ON_START=true y dejaría el sistema en CERO administradores. Y sería el peor
    // caso posible: no hay transacción de aplicación de por medio, así que el advisory
    // lock del guard ni se entera. El seed sigue OTORGANDO lo que dice la definición;
    // simplemente no le quita a nadie la llave de la casa.
    const idsGobierno = CLAVES_GOBIERNO.map((clave) => idPermisoPorClave.get(clave)).filter(
      (id): id is number => id !== undefined,
    );
    await prisma.rolPermiso.deleteMany({
      where: { idRol: fila.id, idPermiso: { notIn: [...idsPermisos, ...idsGobierno] } },
    });
    await prisma.rolPermiso.createMany({
      data: idsPermisos.map((idPermiso) => ({ idRol: fila.id, idPermiso })),
      skipDuplicates: true,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3a-ter. Siembra de los roles EDITABLES (15 puestos + el piso) — CREAR-SI-NO-EXISTE, nunca sincroniza
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Siembra los roles EDITABLES del negocio —{@link PERFILES_EDITABLES}: los 15 perfiles de puesto de
 * {@link PERFILES_DE_PUESTO} **más** el piso de lectura {@link PERFIL_CONSULTA_GENERAL}— con
 * `esSistema: false` y **sin sincronizar nunca**. Son TRES casos y conviene leerlos juntos, porque el
 * de en medio es el que protege al dueño:
 *
 * | Estado del rol (por `nombre`) | Qué hace |
 * |---|---|
 * | **no existe** | lo CREA (`esSistema: false`) con sus permisos |
 * | **existe y tiene ≥1 permiso** | ⛔ **se SALTA intacto**: ni descripción, ni permisos, ni bandera |
 * | **existe con CERO permisos** | le asigna los permisos del perfil (**sólo** eso) |
 *
 * 🔴 **POR QUÉ NO SINCRONIZA, Y POR QUÉ NO PASA POR {@link definirRoles}.** Son catálogo del
 * NEGOCIO: el dueño los va a afinar desde Administración › Roles en cuanto arranquen las pruebas, y
 * sus ajustes tienen que sobrevivir al despliegue. {@link sembrarRoles} hace lo contrario —su
 * `deleteMany({ notIn })` devuelve el rol a la definición del código— y `SEED_ON_START=true` está
 * encendido **permanentemente** en `prueba`, así que pasarlos por ahí le borraría el trabajo en cada
 * deploy, **en silencio**: `asignarPermisos` (`dominio/admin/roles.ts`) le deja editarlos sin
 * mirar `esSistema`, así que nada le avisaría de que lo que palomeó tiene fecha de caducidad. Por eso
 * un rol que YA tiene permisos no se toca ni para "completar" lo que falte: un permiso que el dueño
 * quitó a mano es una decisión suya.
 *
 * ⭐ **POR QUÉ EL CASO DE LOS CERO PERMISOS SÍ SE LLENA.** Porque **un rol sin un solo permiso no es
 * una decisión del dueño, es un cascarón** — y es exactamente lo que la Ruta Crítica siembra
 * (`seed-ruta-critica.ts`: **17 de sus 18** roles funcionales nacen `esSistema: false` y **vacíos** —el
 * otro es `Ventas`, que ya es rol de sistema—, sólo para
 * colgarles la responsabilidad de un proceso con `ProcesoDefRol`). Dos de esos nombres son también
 * perfiles de puesto —**«Habilitaciones»** y **«Entregas»**— y `Rol.nombre` es ÚNICO, así que son la
 * MISMA fila… que es correcto, porque son la misma persona. Si esta función se saltara cualquier rol
 * existente, en `prueba` —donde los roles de la RC ya están sembrados— esos dos perfiles se quedarían
 * **sin permisos y en silencio**, que es el peor resultado posible. Llenar el cascarón **no pisa nada
 * de nadie**: es puramente aditivo.
 *
 * ⚠️ **El filo de ese caso, dicho para que nadie se sorprenda:** si alguien vacía un perfil de puesto
 * del TODO desde la pantalla, el siguiente arranque se lo vuelve a llenar. Dejarle un solo permiso
 * sí se respeta. Es el precio de no poder distinguir «cascarón de la RC» de «lo vacié a propósito», y
 * se eligió a favor de no dejar un perfil mudo sin avisar.
 *
 * ⚠️ `esSistema: false` tampoco es cosmético: `eliminarRol` prohíbe BORRAR un rol de sistema y
 * `actualizarRol` prohíbe RENOMBRARLO, así que en `true` el dueño se quedaría con 15 perfiles que no
 * podría ni quitar ni corregir.
 *
 * La VALIDACIÓN de que toda clave exista en el catálogo se mantiene igual que en `sembrarRoles`
 * (lanza con el nombre del perfil y de la clave): un `createMany` contra un permiso inexistente
 * truena igual, y más tarde y peor.
 */
async function sembrarPerfilesDePuesto(
  prisma: PrismaClient,
  idPermisoPorClave: Map<ClavePermiso, number>,
): Promise<void> {
  for (const perfil of PERFILES_EDITABLES) {
    const existente = await prisma.rol.findUnique({
      where: { nombre: perfil.nombre },
      select: { id: true, _count: { select: { permisos: true } } },
    });

    // ⛔ Ya existe Y TIENE PERMISOS: se deja INTACTO y se sigue. Es la garantía que protege lo que
    // el dueño afine en la pantalla, y no se relaja. No hay rama de actualización, a propósito.
    if (existente !== null && existente._count.permisos > 0) continue;

    // La clave se resuelve ANTES de tocar el rol: si falta, el seed truena sin dejar a medias un
    // rol vacío que luego parecería "el perfil que el dueño ya editó".
    const idsPermisos = perfil.permisos.map((clave) => {
      const id = idPermisoPorClave.get(clave);
      if (id === undefined) {
        throw new Error(
          `Permiso "${clave}" del perfil de puesto ${perfil.nombre} no está sembrado`,
        );
      }
      return id;
    });

    // Del cascarón sólo se LLENAN los permisos: ni `nombre`, ni `descripcion`, ni `esSistema`, ni se
    // borra nada (`skipDuplicates` cubre la carrera). Si no existía, se crea completo.
    const idRol =
      existente?.id ??
      (
        await prisma.rol.create({
          data: { nombre: perfil.nombre, descripcion: perfil.descripcion, esSistema: false },
        })
      ).id;

    await prisma.rolPermiso.createMany({
      data: idsPermisos.map((idPermiso) => ({ idRol, idPermiso })),
      skipDuplicates: true,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3b. Roles de proveedor (F1-E1B, R15 §4.1) — catálogo base, idempotente
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Roles/servicios base de proveedor (R15 §4.1 —
 * `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md`). Catálogo administrable:
 * Gabriel puede agregar/desactivar más desde la UI; estos son el punto de partida.
 * Se siembran por `codigo` (clave natural estable), sin pisar el `nombre` si ya
 * existe (pudo editarse). NO se borran los que no estén aquí (podrían estar en uso).
 */
const ROLES_PROVEEDOR_BASE: { codigo: string; nombre: string }[] = [
  // Servicios de producción (cubren a los antiguos Maquilero y Cortador — fusión de
  // terceros, D12/R15): un taller marca con casillas qué servicios presta.
  { codigo: 'maquila-costura', nombre: 'Maquila (costura)' },
  { codigo: 'corte', nombre: 'Corte' },
  // ⭐ 0.114 — Daniel: *«y una maquila de empaque también»*. El empacador es un proveedor de
  // servicio como el cortador: se le carga desde la orden y sale en el estado de cuenta de maquila.
  // Rol NUEVO: `prueba` necesita `SEED_ON_START=true` para que aparezca (el upsert es idempotente).
  { codigo: 'empaque', nombre: 'Empaque' },
  // Nombres como los pide Daniel (§Post-F9.54 punto 1, 16-ago-2026): *"Yo cambiaría el nombre a
  // Estampador, Bordador… El vende telas y vende avíos lo dejaría solo como Telas y Avíos, le
  // quitaría el «Vende»."* Solo cambia el NOMBRE visible; el `codigo` es la clave estable.
  //
  // ⚠️ Esto de aquí SOLO cubre una base recién creada: el `upsert` de abajo usa `update: {}`, que
  // NO pisa el nombre de un rol que ya existe. En una base con datos (p. ej. `prueba`) los cuatro
  // renombres los hace la MIGRACIÓN `20260818140000_proveedores_como_daniel_los_usa`, por código.
  // Los dos caminos coinciden a propósito. (La nota vieja de §Post-F9.54 decía que bastaba
  // `SEED_ON_START=true`: era FALSO, y ya está corregida en el documento.)
  { codigo: 'estampado', nombre: 'Estampador' },
  { codigo: 'bordado', nombre: 'Bordador' },
  { codigo: 'lavado', nombre: 'Lavado' },
  { codigo: 'aplicacion', nombre: 'Aplicación' },
  // Venta de materiales (proveedores comerciales).
  { codigo: 'vende-telas', nombre: 'Telas' },
  { codigo: 'vende-avios', nombre: 'Avíos' },
  { codigo: 'otros-servicios', nombre: 'Otros servicios' },
];

/**
 * Roles de proveedor OBSOLETOS que sembrados antiguos pudieron dejar en `prueba` y que
 * la fusión de terceros (D12/R15) reemplazó. Se DESACTIVAN (no se borran: pudieron
 * quedar asignados a algún proveedor de prueba; el borrado suave evita dejar pares
 * colgando). `estampado-aplicacion` se separó en `estampado` + `aplicacion`.
 */
const ROLES_PROVEEDOR_OBSOLETOS: string[] = ['estampado-aplicacion'];

async function sembrarRolesProveedor(prisma: PrismaClient): Promise<void> {
  for (const rol of ROLES_PROVEEDOR_BASE) {
    await prisma.rolProveedor.upsert({
      where: { codigo: rol.codigo },
      // No se pisa el nombre/activo si ya existe (pudo editarse en producción).
      update: {},
      create: { codigo: rol.codigo, nombre: rol.nombre },
    });
  }
  // Desactiva los roles obsoletos si existen (idempotente; no falla si no están).
  await prisma.rolProveedor.updateMany({
    where: { codigo: { in: ROLES_PROVEEDOR_OBSOLETOS }, activo: true },
    data: { activo: false },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3c. Tipos de proceso de maquila (F1-E2) — catálogo base, idempotente
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tipos de proceso de maquila base (maquila unificada — PLANMAESTRO §4;
 * doc `03-Produccion.md`: M = costura, A = estampado/aplicación, y §324 lista
 * bordado/lavado como tipos a parametrizar). Catálogo administrable: el ABM fino
 * queda diferido (como los roles-proveedor en E1B), pero estos son el punto de
 * partida. Se siembran por `codigo` (clave natural estable), sin pisar el `nombre`
 * si ya existe (pudo editarse). NO se borran los que no estén aquí (podrían estar en uso).
 */
// F3-E1: cada tipo nace con su bandera `generaEntradaPt` (decisión (e), DECISIONES.md / ADR-0010):
// SOLO costura deja prenda terminada → su recibo mete a inventario PT; estampado/aplicación,
// bordado y lavado = false. Es el DEFAULT inicial; cambiarlo luego es dato (UI de admin), no
// migración. `update` NO pisa la bandera si el tipo ya existe (pudo ajustarse en producción).
// V1-E3f (§Post-F9.58/.59): este catálogo es AHORA también el de TIPOS DE ARTE — Daniel:
// *"De acuerdo. Y un solo catálogo."*. `esArte` marca cuáles se ofrecen como arte (bordado,
// estampado, aplicación —*"Aplicación también es arte"*— y lavado; la costura NO, es la única
// diferencia real entre las dos listas que se fusionaron), y `usaPuntadas` cuáles muestran el
// campo de puntadas (solo bordado, §Post-F9.52 punto 6).
//
// ⚠️ El `update: {}` de abajo NO pisa las banderas de un tipo que YA existe: en una base con
// datos (p. ej. `prueba`) las marca la MIGRACIÓN `20260818120000_catalogo_unico_de_arte`, por
// código. Esto de aquí solo cubre la base recién creada. Los dos caminos coinciden a propósito.
const TIPOS_PROCESO_BASE: {
  codigo: string;
  nombre: string;
  generaEntradaPt: boolean;
  esArte: boolean;
  usaPuntadas: boolean;
}[] = [
  {
    codigo: 'costura',
    nombre: 'Costura',
    generaEntradaPt: true,
    esArte: false,
    usaPuntadas: false,
  },
  {
    codigo: 'estampado',
    nombre: 'Estampado',
    generaEntradaPt: false,
    esArte: true,
    usaPuntadas: false,
  },
  { codigo: 'bordado', nombre: 'Bordado', generaEntradaPt: false, esArte: true, usaPuntadas: true },
  { codigo: 'lavado', nombre: 'Lavado', generaEntradaPt: false, esArte: true, usaPuntadas: false },
  {
    codigo: 'aplicacion',
    nombre: 'Aplicación',
    generaEntradaPt: false,
    esArte: true,
    usaPuntadas: false,
  },
];

async function sembrarTiposProceso(prisma: PrismaClient): Promise<void> {
  for (const tipo of TIPOS_PROCESO_BASE) {
    await prisma.tipoProceso.upsert({
      where: { codigo: tipo.codigo },
      // No se pisa nombre/activo/banderas si ya existe (pudo editarse en producción).
      update: {},
      create: {
        codigo: tipo.codigo,
        nombre: tipo.nombre,
        generaEntradaPt: tipo.generaEntradaPt,
        esArte: tipo.esArte,
        usaPuntadas: tipo.usaPuntadas,
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3d. Géneros de modelo (F1-E4) — catálogo base, idempotente
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Géneros de modelo del sistema viejo (doc `01-Modelos.md` §3, lista de precios por
 * género). Catálogo selector: se siembran + se expone solo `GET /api/generos`; el ABM
 * fino se DIFIERE (mismo patrón que `RolProveedor`/`TipoProceso`). Se siembran por
 * `nombre` (clave natural), sin pisar `activo` si ya existe. NO se borran los que no
 * estén aquí (podrían estar en uso una vez que el ETL E7 pueble `Modelo.idGenero`).
 */
/**
 * Géneros base con su DÍGITO de la nomenclatura de producción (§Post-F9.34, V1-E3n): es el 2º
 * dígito del código de 5 (`71001` → `1` = Caballero). `alterno` es el dígito de CONTINUACIÓN
 * cuando la serie se agota: sólo Caballero lo tiene (1 → 5), porque su serie `x1` ya llegó a 999
 * en el Access y Daniel abrió la `x5`. El 8 no se usa.
 */
const GENEROS_BASE: { nombre: string; digito: number; alterno?: number }[] = [
  { nombre: 'Caballero', digito: 1, alterno: 5 },
  { nombre: 'Dama', digito: 2 },
  { nombre: 'Niño Infantil', digito: 4 },
  { nombre: 'Niña Infantil', digito: 6 },
  { nombre: 'Niño Juvenil', digito: 3 },
  { nombre: 'Niña Juvenil', digito: 7 },
  { nombre: 'Bebo', digito: 0 },
  { nombre: 'Beba', digito: 9 },
];

async function sembrarGeneros(prisma: PrismaClient): Promise<void> {
  for (const { nombre, digito, alterno } of GENEROS_BASE) {
    await prisma.genero.upsert({
      where: { nombre },
      // No se pisa el activo si ya existe (pudo editarse/desactivarse en producción), pero el
      // dígito SÍ se re-siembra: es la tabla de Daniel, no una preferencia editable.
      update: { digitoNomenclatura: digito, digitoAlterno: alterno ?? null },
      create: { nombre, digitoNomenclatura: digito, digitoAlterno: alterno ?? null },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3e. Tipos de movimiento de inventario (F3-E1) — ex `IPT_TiposMov`, idempotente
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los 19 tipos de movimiento de inventario del sistema viejo (`IPT_TiposMov.csv`,
 * doc 04-Inventarios §A.2) con su DIRECCIÓN (ex `TipoEnSa`: 1=entrada, 2=salida, 3=traspaso),
 * que el kardex usa para el signo de la existencia (D3, ADR-0010). Cada uno con un `codigo`
 * estable kebab-case para referenciarlo en código sin atarlo al texto.
 *
 * Es la lista CANÓNICA (fuente de verdad del seed), transcrita de `IPT_TiposMov.csv`. El CSV se
 * lee en CP850 (CLAUDE.md §4 / `migracion/comun/csv.ts`) SOLO para VERIFICAR esta lista contra el
 * dump cuando el archivo está disponible (local/CI) — `verificarTiposMovimientoContraCsv`; en el
 * deploy (donde el CSV no viaja en la imagen del backend) la verificación se omite sin fallar.
 *
 * Se siembran por `codigo`; `update` NO pisa nombre/activo/dirección si ya existen (idempotente).
 */
// ⛔ Fila 0.171 — de esta lista, CINCO no se pueden capturar a mano (`entrada-maquila`,
// `entrega-cliente`, `error-entrada`/`error-salida` —los rótulos de una CANCELACIÓN— y
// `merma-incompletas`). Son parte de los DOCE reservados al sistema; los otros siete están en las
// listas de abajo (las dos patas del traspaso, los dos del cíclico, la recepción, la salida a orden
// y la salida por nota). La lista completa y su rechazo: `src/dominio/inventarios/tipos-reservados.ts`.
const TIPOS_MOVIMIENTO_BASE: {
  codigo: string;
  nombre: string;
  direccion: 'entrada' | 'salida' | 'traspaso';
}[] = [
  { codigo: 'inventario-inicial', nombre: 'Inventario Inicial', direccion: 'entrada' },
  { codigo: 'entrada-maquila', nombre: 'Entrada de Maquila', direccion: 'entrada' },
  { codigo: 'entrada-aplicacion', nombre: 'Entrada de Aplicación', direccion: 'entrada' },
  {
    codigo: 'devolucion-nota-credito',
    nombre: 'Devolución / Notas de Crédito',
    direccion: 'entrada',
  },
  { codigo: 'entrega-cliente', nombre: 'Entrega a Cliente', direccion: 'salida' },
  { codigo: 'salida-aplicacion', nombre: 'Salida a Aplicación', direccion: 'salida' },
  { codigo: 'muestrario-ventas', nombre: 'Muestrario Ventas', direccion: 'salida' },
  { codigo: 'salida-maquilero', nombre: 'Salida a Maquilero', direccion: 'salida' },
  {
    codigo: 'transferencia-almacenes',
    nombre: 'Transferencia entre almacenes',
    direccion: 'traspaso',
  },
  { codigo: 'recibo-muestrario', nombre: 'Recibo de Muestrario', direccion: 'entrada' },
  { codigo: 'error-entrada', nombre: 'Error de Entrada', direccion: 'salida' },
  { codigo: 'error-salida', nombre: 'Error de Salida', direccion: 'entrada' },
  { codigo: 'venta-mostrador', nombre: 'Venta de Mostrador', direccion: 'salida' },
  { codigo: 'ajuste-entrada', nombre: 'Ajuste de Inventario (Entrada)', direccion: 'entrada' },
  { codigo: 'ajuste-salida', nombre: 'Ajuste de Inventario (Salida)', direccion: 'salida' },
  { codigo: 'salida-laboratorio', nombre: 'Salida a Laboratorio', direccion: 'salida' },
  { codigo: 'salida-composturas', nombre: 'Salida a Composturas', direccion: 'salida' },
  { codigo: 'otras-salidas', nombre: 'Otras Salidas', direccion: 'salida' },
  { codigo: 'otras-entradas', nombre: 'Otras Entradas', direccion: 'entrada' },
  // ⭐ 0.061 (§Post-F9.154(a), DANIEL): la prenda INCOMPLETA sale sola del almacén de TRÁNSITO al
  // registrar el recibo. Hasta hoy se quedaba ahí para siempre (nadie la iba a devolver) y sólo
  // salía con un movimiento manual que nadie hacía. NO se inventaría en ningún lado: es merma.
  // Lo mueve `dominio/produccion/transito.ts::darSalidaMermaIncompletas`, nunca a mano — y desde la
  // fila 0.171 eso ya no es sólo un comentario: el dominio RECHAZA capturarlo (`tipos-reservados.ts`).
  { codigo: 'merma-incompletas', nombre: 'Merma por prendas incompletas', direccion: 'salida' },
];

/** `IPT_TiposMov.TipoEnSa` → dirección de v2 (1=entrada, 2=salida, 3=traspaso). */
function direccionDesdeTipoEnSa(valor: string): 'entrada' | 'salida' | 'traspaso' | null {
  if (valor === '1') return 'entrada';
  if (valor === '2') return 'salida';
  if (valor === '3') return 'traspaso';
  return null;
}

/**
 * VERIFICA que {@link TIPOS_MOVIMIENTO_BASE} tenga las 19 entradas del dump viejo con su dirección
 * (nit #5: el CSV se lee en CP850). Best-effort: si el CSV no está disponible (deploy), avisa y
 * sigue. Si está pero NO cuadra (conteo o dirección por TipoEnSa), LANZA — el seed canónico no
 * debe divergir del viejo en silencio.
 */
async function verificarTiposMovimientoContraCsv(): Promise<void> {
  let leerCsv: (nombre: string) => Record<string, string>[];
  try {
    ({ leerCsv } = await import('../migracion/comun/csv.js'));
  } catch {
    return; // el ETL/csv no está disponible en este contexto: se omite la verificación
  }
  let filas: Record<string, string>[];
  try {
    filas = leerCsv('IPT_TiposMov.csv');
  } catch {
    console.warn(
      '⚠ IPT_TiposMov.csv no disponible: se omite la verificación (seed canónico igual se aplica).',
    );
    return;
  }
  if (filas.length !== TIPOS_MOVIMIENTO_BASE.length) {
    throw new Error(
      `IPT_TiposMov.csv trae ${String(filas.length)} tipos; el seed canónico tiene ${String(TIPOS_MOVIMIENTO_BASE.length)}.`,
    );
  }
  // El orden del CSV coincide 1:1 con el de la lista canónica (IdIPT_TiposMov 1..19).
  filas.forEach((fila, i) => {
    const esperada = TIPOS_MOVIMIENTO_BASE[i];
    const direccionCsv = direccionDesdeTipoEnSa(String(fila.TipoEnSa ?? '').trim());
    if (esperada === undefined || direccionCsv !== esperada.direccion) {
      throw new Error(
        `IPT_TiposMov.csv fila ${String(i + 1)} ("${String(fila.TipoMov)}") tiene dirección ${String(direccionCsv)}, ` +
          `pero el seed espera ${esperada?.direccion ?? '(ninguna)'} para "${esperada?.nombre ?? ''}".`,
      );
    }
  });
}

/**
 * Tipos de movimiento NUEVOS de v2 que NO vienen del CSV viejo (F3-E3). El viejo modelaba la
 * "Transferencia entre almacenes" con UN tipo de dirección `traspaso`; v2 la materializa como DOS
 * patas (salida del origen + entrada al destino) para que la vista `existencia_pt` sume +1/−1 por
 * almacén (ADR-0010 §1/§5). El traspaso de dominio resuelve estas patas POR `codigo`. NO entran en
 * {@link TIPOS_MOVIMIENTO_BASE} (esa es la lista canónica verificada 1:1 contra el CSV de 19); el
 * tipo viejo `transferencia-almacenes` (dirección `traspaso`) se conserva y NO se usa como pata.
 */
const TIPOS_MOVIMIENTO_V2: {
  codigo: string;
  nombre: string;
  direccion: 'entrada' | 'salida' | 'traspaso';
}[] = [
  {
    codigo: 'transferencia-salida',
    nombre: 'Transferencia entre Almacenes (Salida)',
    direccion: 'salida',
  },
  {
    codigo: 'transferencia-entrada',
    nombre: 'Transferencia entre Almacenes (Entrada)',
    direccion: 'entrada',
  },
];

/**
 * Tipos de movimiento NUEVOS de F4-E1 (kardex de telas y avíos). El viejo registraba las entradas
 * de tela con factura, las salidas ligadas a la orden (`Salidas.IdOrdenes`) y los consumos por nota
 * en tablas SEPARADAS sin un tipo de movimiento explícito; v2 los modela como tipos de kardex con su
 * dirección (D3, ADR-0010). El traspaso reusa `transferencia-salida`/`-entrada` (ya sembrados en
 * F3-E3) y el ajuste reusa `ajuste-entrada`/`-salida` (de los 19 canónicos): NO se duplican aquí.
 *  • `entrada-recepcion` — entrada de tela/avío por recepción de compra (E3, con factor de
 *    conversión y costo por unidad de consumo). Dirección entrada.
 *  • `salida-a-orden` — salida de TELA hacia una orden de producción (`Salidas.IdOrdenes`, E1). Es
 *    LA única vía que descuenta tela hacia una orden; la nota (E5) la referencia sin segundo
 *    movimiento. Dirección salida.
 *  • `salida-por-nota` — salida de AVÍO por una nota de salida a maquilero (E5: el consumo de avíos
 *    va ligado a las notas, R4). Dirección salida.
 */
const TIPOS_MOVIMIENTO_F4: {
  codigo: string;
  nombre: string;
  direccion: 'entrada' | 'salida' | 'traspaso';
}[] = [
  { codigo: 'entrada-recepcion', nombre: 'Entrada por Recepción de Compra', direccion: 'entrada' },
  { codigo: 'salida-a-orden', nombre: 'Salida de Tela a Orden', direccion: 'salida' },
  { codigo: 'salida-por-nota', nombre: 'Salida de Avío por Nota', direccion: 'salida' },
];

/**
 * Tipos de movimiento NUEVOS de F7-E5 (ajuste por inventario CÍCLICO). El ajuste que reconcilia el
 * conteo físico contra el kardex se aplica como MOVIMIENTO (D3, nunca editando un saldo); se usan
 * tipos DEDICADOS (en vez del `ajuste-entrada`/`-salida` genérico) para poder rastrear en el kardex
 * qué diferencias vinieron de un cíclico. Entra por SEED (no por migración) → el deploy a `prueba`
 * requiere SEED_ON_START=true.
 */
const TIPOS_MOVIMIENTO_F7: {
  codigo: string;
  nombre: string;
  direccion: 'entrada' | 'salida' | 'traspaso';
}[] = [
  {
    codigo: 'ajuste-ciclico-entrada',
    nombre: 'Ajuste por Cíclico (Entrada)',
    direccion: 'entrada',
  },
  { codigo: 'ajuste-ciclico-salida', nombre: 'Ajuste por Cíclico (Salida)', direccion: 'salida' },
];

/**
 * ⭐ Tipos de movimiento NUEVOS de la fila **0.104** — LA SALIDA QUE NO ES POR OP.
 *
 * DANIEL (§Post-F9.193 resp. 12): *«debería de haber manera de sacar por ejemplo una devolución, o
 * una venta de avíos que ya no se usen… que no sea mediante la descarga o aplicación a una OP…
 * Lo mismo en telas»*.
 *
 * 🔑 **Por qué DEDICADOS y no un `ajuste-salida` con el motivo en prosa:** el kardex es la ventana
 * por la que se pregunta «¿a dónde se fue esta tela?», y ahí sólo se ve el NOMBRE del tipo. Con el
 * ajuste genérico, una devolución y una venta quedarían indistinguibles entre sí y revueltas con
 * las correcciones de conteo. Mismo criterio (y mismas palabras) con que F7-E5 estrenó
 * `ajuste-ciclico-*`. El tercer concepto de la fila —«otra causa»— NO estrena tipo: reusa el
 * `otras-salidas` que ya venía en los 19 canónicos del sistema viejo.
 *
 * Entran por SEED (no por migración) y sirven a las DOS dimensiones (tela y avío).
 */
const TIPOS_MOVIMIENTO_SALIDA_SIN_ORDEN: {
  codigo: string;
  nombre: string;
  direccion: 'entrada' | 'salida' | 'traspaso';
}[] = [
  { codigo: 'devolucion-proveedor', nombre: 'Devolución a Proveedor', direccion: 'salida' },
  { codigo: 'venta-material', nombre: 'Venta de Material', direccion: 'salida' },
];

/**
 * TODOS los tipos de movimiento que el seed siembra: los 19 canónicos del CSV viejo + los 2 de
 * F3-E3 (patas del traspaso) + los 3 de F4-E1 (kardex de telas y avíos) + los 2 de F7-E5 (ajuste
 * por cíclico) + los 2 de la fila 0.104 (salida sin orden).
 *
 * ⛔ **Fila 0.171 — DOCE de estos tipos NO los puede capturar una persona**: los escribe sólo el
 * código, como efecto de otra operación (las dos patas de un traspaso, los dos rótulos de una
 * cancelación, los dos del ajuste por cíclico, la recepción de compra, la salida de tela a una
 * orden, la salida de avío por nota, el recibo de maquila, la entrega a cliente y la merma por
 * prendas incompletas). Otros DOS están reservados a la dirección (fila 0.104). La lista, el
 * criterio y el rechazo viven en `src/dominio/inventarios/tipos-reservados.ts`, y su prueba cruza
 * esa lista contra ÉSTA: un código mal escrito allá dejaría la reserva muda.
 *
 * 🔴 **Está EXPORTADA para que se pueda cruzar a máquina con lo que el dominio EXIGE.** Un flujo
 * que resuelve su tipo por `codigo` y no lo encuentra sembrado nace muerto en `prueba`, y el
 * defecto no lo caza ninguna prueba de dominio: la cicatriz del proyecto es una fila rechazada
 * **por el despliegue, no por el código**, porque la siembra no creaba algo que la guarda pedía.
 * `dominio/inventarios/salida-sin-orden.test.ts` compara esta lista contra
 * `CODIGO_TIPO_MOV_POR_CONCEPTO` y truena si falta uno.
 */
export const TIPOS_MOVIMIENTO_A_SEMBRAR: readonly {
  codigo: string;
  nombre: string;
  direccion: 'entrada' | 'salida' | 'traspaso';
}[] = [
  ...TIPOS_MOVIMIENTO_BASE,
  ...TIPOS_MOVIMIENTO_V2,
  ...TIPOS_MOVIMIENTO_F4,
  ...TIPOS_MOVIMIENTO_F7,
  ...TIPOS_MOVIMIENTO_SALIDA_SIN_ORDEN,
];

async function sembrarTiposMovimiento(prisma: PrismaClient): Promise<void> {
  await verificarTiposMovimientoContraCsv();
  // Idempotente: el `update: {}` no pisa nombre/dirección/activo si ya existen (pudieron editarse
  // en producción).
  for (const tipo of TIPOS_MOVIMIENTO_A_SEMBRAR) {
    await prisma.tipoMovimientoInventario.upsert({
      where: { codigo: tipo.codigo },
      update: {},
      create: { codigo: tipo.codigo, nombre: tipo.nombre, direccion: tipo.direccion },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3f. Almacenes de PT (F3-E1) — ex `IPT_Almacenes` (Primeras/Segundas/Tránsito)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los 3 almacenes de PT del sistema viejo (`IPT_Almacenes.csv`: Primeras/Segundas/Tránsito). Son
 * GLOBALES (`idEmpresa = null`, como crea el dominio de almacenes para los compartidos). Se
 * siembran de forma idempotente: si ya existe un almacén PT con ese nombre (global), NO se
 * duplica. El kardex de PT (E3) y el recibo de costura (E4) los usan como destino.
 */
const ALMACENES_PT_BASE: string[] = ['Primeras', 'Segundas', 'Tránsito'];

/**
 * Nombre del almacén de PT que hace de TRÁNSITO A PROCESO EXTERNO (V1-E4b, §Post-F9.61). El nombre
 * solo se usa AQUÍ, para saber a cuál ponerle la bandera la primera vez; de ahí en adelante el
 * dominio lo resuelve SIEMPRE por `esTransitoProceso` (renombrar el almacén no rompe nada).
 */
const NOMBRE_ALMACEN_TRANSITO = 'Tránsito';

async function sembrarAlmacenesPt(prisma: PrismaClient): Promise<void> {
  for (const nombre of ALMACENES_PT_BASE) {
    // Idempotente por (nombre, tipo PT, global): si ya existe NO se crea otro (el @@unique de
    // almacenes es (idEmpresa, nombre), pero los globales tienen idEmpresa null, que Postgres
    // trata como distinto en el unique → se verifica a mano antes de crear).
    const existente = await prisma.almacen.findFirst({
      where: { nombre, tipo: 'PT', idEmpresa: null },
      select: { id: true },
    });
    if (existente === null) {
      await prisma.almacen.create({
        data: {
          nombre,
          tipo: 'PT',
          idEmpresa: null,
          esTransitoProceso: nombre === NOMBRE_ALMACEN_TRANSITO,
        },
      });
    }
  }

  // V1-E4b: enciende la bandera del tránsito en las bases que YA tenían el almacén sembrado (F3-E1).
  // Solo si NINGUNO la trae: si alguien la movió a otro almacén a propósito, el seed no se la quita.
  const yaHayTransito = await prisma.almacen.count({ where: { esTransitoProceso: true } });
  if (yaHayTransito === 0) {
    const transito = await prisma.almacen.findFirst({
      where: { nombre: NOMBRE_ALMACEN_TRANSITO, tipo: 'PT', idEmpresa: null },
      select: { id: true },
    });
    if (transito !== null) {
      await prisma.almacen.update({
        where: { id: transito.id },
        data: { esTransitoProceso: true },
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3f-bis. Los almacenes ÚNICOS de AVÍOS (fila 0.137) y de TELAS (fila 0.099)
// ─────────────────────────────────────────────────────────────────────────────

/** Nombre con el que NACE el almacén único de avíos (fila 0.137). Renombrable desde el catálogo. */
const ALMACEN_AVIOS_BASE = 'Almacén de avíos';
/** Nombre con el que NACE el almacén único de telas (fila 0.099). Renombrable desde el catálogo. */
const ALMACEN_TELAS_BASE = 'Almacén de telas';

/**
 * Siembra **UN** almacén GLOBAL del tipo dado, si el catálogo no tiene ya ninguno de ese tipo.
 *
 * ⚠️ **POR QUÉ EXISTEN ESTOS DOS SEEDS.** Desde la fila 0.137 el dominio exige que el tipo del
 * almacén case con el del artículo que se mueve (`comun/almacenes.ts` → `exigirAlmacenDelTipo`), y
 * el catálogo base **no tenía ninguno** ni de AVIO ni de TELA: el seed sembraba tres de producto
 * terminado y el ETL de Access mapea los almacenes viejos a PT y TELA — o sea que los avíos no
 * tenían dónde caer nunca, y las telas sólo si alguien corría el ETL. Sin esta siembra, los flujos
 * de avíos (ajuste, traspaso, recepción de compra, notas de salida) y el **inventario cíclico de
 * telas** —la pantalla del ARRANQUE— rechazan contra cualquier almacén del catálogo, o directamente
 * no tienen ninguno que ofrecer.
 *
 * ⭐ **LA LLAVE DE IDEMPOTENCIA ES EL TIPO, NO EL NOMBRE** (decisión del lead en la revisión de la
 * fila 0.099, `DECISIONES.md` §Post-F9.202). Antes se buscaba por `(nombre, tipo, global)`, y eso
 * convertía un renombre en un duplicado silencioso: el catálogo **permite renombrar** un almacén (y
 * el historial de versiones se lo dice a Daniel), el `@@unique (idEmpresa, nombre)` **no atrapa los
 * NULL** de los globales, y `SEED_ON_START=true` está **permanente** en `prueba` ⇒ el siguiente
 * arranque habría creado un SEGUNDO almacén global del mismo tipo, partiendo el inventario en dos
 * — el daño exacto que la fila 0.137 vino a evitar. Preguntando por el TIPO, renombrar es inocuo.
 *
 * Lo que este seed NO hace: no toca el almacén que ya exista (ni su nombre, ni su estado), y no
 * cuenta los de EMPRESA — un almacén global es el piso del catálogo, no un almacén de nadie.
 */
async function sembrarAlmacenUnicoGlobal(
  prisma: PrismaClient,
  tipo: 'AVIO' | 'TELA',
  nombre: string,
): Promise<void> {
  const existente = await prisma.almacen.findFirst({
    where: { tipo, idEmpresa: null },
    select: { id: true },
  });
  if (existente === null) {
    await prisma.almacen.create({ data: { nombre, tipo, idEmpresa: null } });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3g. Reactivos del checklist de FICHAS CONFIABLES (F7-E4) — los 8 fijos del viejo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los 8 reactivos fijos del checklist de confiabilidad de la ficha técnica del sistema viejo
 * (`IP_InfConf`, doc 05 §A.2): eran columnas booleanas; en v2 son FILAS configurables (A6). Se
 * siembran de forma idempotente por `clave`; se pueden agregar más sin migración. El `orden`
 * respeta la secuencia del formulario viejo.
 */
const REACTIVOS_FICHA_BASE: { clave: string; etiqueta: string; orden: number }[] = [
  { clave: 'InfGeneral', etiqueta: 'Información general', orden: 1 },
  { clave: 'InfTela', etiqueta: 'Información de tela', orden: 2 },
  { clave: 'InfHab', etiqueta: 'Información de avíos', orden: 3 },
  { clave: 'Medidas', etiqueta: 'Medidas de avíos', orden: 4 },
  { clave: 'Dibujo', etiqueta: 'Dibujo', orden: 5 },
  { clave: 'InfEtiqueta', etiqueta: 'Información de etiqueta', orden: 6 },
  { clave: 'EspCostura', etiqueta: 'Especificaciones de costura', orden: 7 },
  { clave: 'MedidasPrendas', etiqueta: 'Medidas en prenda', orden: 8 },
];

async function sembrarReactivosFicha(prisma: PrismaClient): Promise<void> {
  for (const reactivo of REACTIVOS_FICHA_BASE) {
    await prisma.checklistFichaDef.upsert({
      where: { clave: reactivo.clave },
      // Idempotente: no pisa etiqueta/orden/activo si ya existe (pudieron editarse en producción).
      update: {},
      create: { clave: reactivo.clave, etiqueta: reactivo.etiqueta, orden: reactivo.orden },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3h. Conceptos de costo (F8-E1, R19) — catálogo base, idempotente
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Conceptos de costo del precosto (F8-E1, R19 — propuesta §3/§7-C). Catálogo que gobierna por DATO
 * los renglones del precosto (como `TipoProceso` gobierna el kardex). `fijo=true` (tela/avíos/
 * maquila) ⇒ NO desactivable (lo exige el dominio de admin). El resto son ampliables. La REGALÍA NO
 * es concepto (D2: va sobre la venta — factor de la lista, E4). Se siembran por `codigo`; `update`
 * NO pisa nombre/orden/fijo/activo si ya existe (idempotente; pudo editarse en producción).
 */
const CONCEPTOS_COSTO_BASE: { codigo: string; nombre: string; orden: number; fijo: boolean }[] = [
  { codigo: 'tela', nombre: 'Tela', orden: 1, fijo: true },
  { codigo: 'avios', nombre: 'Avíos', orden: 2, fijo: true },
  { codigo: 'maquila', nombre: 'Maquila', orden: 3, fijo: true },
  { codigo: 'estampado', nombre: 'Estampado', orden: 4, fijo: false },
  { codigo: 'bordado', nombre: 'Bordado', orden: 5, fijo: false },
  { codigo: 'otros-procesos', nombre: 'Otros procesos', orden: 6, fijo: false },
  { codigo: 'otros', nombre: 'Otros', orden: 7, fijo: false },
  // Corte (rediseño R5, B8): costo fijo por prenda SEPARADO de la maquila (decisión Daniel). El
  // precosto crea su renglón fijo auto (`lineaCorte`). REQUIERE re-seed en `prueba` (SEED_ON_START):
  // sin este concepto, `generarPrecosto` truena ("falta el concepto de costo base corte").
  { codigo: 'corte', nombre: 'Corte', orden: 8, fijo: true },
  // ⭐ V1-E8w (§Post-F9.153): EMPAQUE, la TERCERA ancla fija junto a maquila y corte. Daniel:
  // *"nos falto meter el costo del empaque. Es un campo adicional…. como si fuera corte"*. El
  // precosto crea su renglón fijo auto (`lineaEmpaque`) con el default de `ConfiguracionEmpresa`.
  // REQUIERE re-seed en `prueba` (SEED_ON_START): sin este concepto, `generarPrecosto` truena
  // ("falta el concepto de costo base empaque"), igual que pasó con `corte`.
  { codigo: 'empaque', nombre: 'Empaque', orden: 9, fijo: true },
];

async function sembrarConceptosCosto(prisma: PrismaClient): Promise<void> {
  for (const concepto of CONCEPTOS_COSTO_BASE) {
    await prisma.conceptoCosto.upsert({
      where: { codigo: concepto.codigo },
      update: {},
      create: {
        codigo: concepto.codigo,
        nombre: concepto.nombre,
        orden: concepto.orden,
        fijo: concepto.fijo,
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3i. Estados de lista de precios (F8-E1, R20) — catálogo base, idempotente
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estados de una lista de precios (F8-E1, R20 — propuesta §4). Catálogo configurable (ampliable,
 * decisión de Daniel). `esCierre=true` (cerrada/ya-pedida) bloquea nuevas rondas de negociación
 * (regla de dominio, E5). Se siembran por `codigo`; `update` NO pisa nombre/orden/esCierre/activo.
 */
const ESTADOS_LISTA_BASE: { codigo: string; nombre: string; orden: number; esCierre: boolean }[] = [
  { codigo: 'abierta', nombre: 'Abierta', orden: 1, esCierre: false },
  { codigo: 'en-negociacion', nombre: 'En negociación', orden: 2, esCierre: false },
  { codigo: 'cerrada', nombre: 'Cerrada', orden: 3, esCierre: true },
  { codigo: 'ya-pedida', nombre: 'Ya pedida', orden: 4, esCierre: true },
];

async function sembrarEstadosLista(prisma: PrismaClient): Promise<void> {
  for (const estado of ESTADOS_LISTA_BASE) {
    await prisma.estadoLista.upsert({
      where: { codigo: estado.codigo },
      update: {},
      create: {
        codigo: estado.codigo,
        nombre: estado.nombre,
        orden: estado.orden,
        esCierre: estado.esCierre,
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3.bis Plantilla de importación de C&A (formato pdf-cya, 7% de sobre-pedido)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⭐ §Post-F9.70 punto 2 — SIEMBRA LA PLANTILLA DE C&A para que el 7% de sobre-pedido (§Post-F9.2)
 * OPERE DE VERDAD. Sin ninguna `PlantillaImportacion`, `leerConfigPlantillaPdf` caía a
 * `porcentajeAdicional: 0` y las OPs nacían con las cantidades EXACTAS del cliente en vez de las que
 * se fabrican.
 *
 * **Decisión (lead, V1-E3i): va en el SEED y no "que alguien la dé de alta desde la pantalla".** Una
 * plantilla que hay que acordarse de crear es una plantilla que NO existe el día que se necesita — y
 * el día que se necesita es el día que se importa la primera OC, cuando ya nadie se acuerda. Sigue
 * siendo editable desde la pantalla del importador (guardar ahí crea una versión nueva que deja a
 * ésta fuera de vigencia).
 *
 * Dos cuidados, ambos deliberados:
 *  • El CLIENTE lo trae el ETL de Access, no el seed: aquí se BUSCA por nombre ({@link esNombreDeCya})
 *    y NO se inventa. Si no aparece, se dice en la salida del seed en vez de callarse (D3).
 *  • Sólo se siembra si el cliente NO tiene NINGUNA plantilla. Si ya tiene una (aunque sea `excel`,
 *    o una que alguien editó), NO se toca: el seed no pisa lo que un humano configuró.
 */
async function sembrarPlantillaImportacionCya(prisma: PrismaClient): Promise<void> {
  const clientes = await prisma.cliente.findMany({ select: { id: true, nombre: true } });
  const cya = clientes.filter((c) => esNombreDeCya(c.nombre));
  if (cya.length === 0) {
    console.log(
      'Seed: no hay ningún cliente que se llame C&A todavía (lo carga el ETL), así que no se ' +
        'sembró su plantilla de importación. Cuando exista, se siembra al volver a correr el seed ' +
        '(o se da de alta desde el importador de OC).',
    );
    return;
  }
  for (const cliente of cya) {
    const yaTiene = await prisma.plantillaImportacion.count({ where: { idCliente: cliente.id } });
    if (yaTiene > 0) {
      console.log(
        `Seed: el cliente "${cliente.nombre}" ya tiene plantilla de importación configurada; no se ` +
          'toca (el % adicional se ajusta desde el importador de OC).',
      );
      continue;
    }
    await prisma.plantillaImportacion.create({
      data: {
        idCliente: cliente.id,
        nombre: 'OC en PDF (C&A) v1',
        version: 1,
        vigente: true,
        formato: 'pdf-cya',
        // `pdf-cya` no mapea columnas (el extractor es código); la config viva son los campos
        // variables + el %.
        mapeo: [],
        camposVariables: CAMPOS_VARIABLES_DEFAULT_CYA,
        porcentajeAdicional: PORCENTAJE_ADICIONAL_CYA,
      },
    });
    console.log(
      `Seed: plantilla pdf-cya sembrada para "${cliente.nombre}" con ` +
        `${String(PORCENTAJE_ADICIONAL_CYA)}% de sobre-pedido (§Post-F9.2).`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3.ter Orden canónico de las tallas ya cargadas (V1-E3r, §Post-F9.81)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⭐ §Post-F9.81 — REPARA EL ORDEN DE LAS TALLAS MIGRADAS.
 *
 * El ETL creó las 94 tallas del Access con `crearTalla(sesion, { etiqueta })`, sin `orden`, así que
 * todas se quedaron en el `@default(0)` de la base y el desempate cayó en la etiqueta: la matriz
 * salía *CH, G, M, XG* en vez de *CH, M, G, XG*. Desde esta etapa `crearTalla` DEDUCE el orden, lo
 * que arregla lo que nazca de hoy en adelante; esto arregla lo que YA está cargado.
 *
 * Va en el seed y no en una migración SQL por dos razones: la escala vive en TypeScript
 * (`deducirOrdenTalla`, con su medición documentada) y duplicarla en SQL la condenaría a divergir; y
 * el seed ya corre en cada arranque de `prueba` con `SEED_ON_START=true`, que es exactamente cuando
 * hace falta.
 *
 * 🔑 **Idempotente y NO destructivo:** sólo toca las filas que siguen en el sentinela `orden = 0`.
 * Un orden que capturó una persona (el contrato lo obliga a ser ≥1 desde V1-E3r) NUNCA se pisa —
 * correr el seed diez veces deja el mismo resultado que correrlo una. Las etiquetas que la escala no
 * reconoce se quedan en 0 y se REPORTAN en la salida, en vez de recibir una posición inventada (D3).
 */
async function sembrarOrdenDeTallas(prisma: PrismaClient): Promise<void> {
  // Sólo el sentinela: lo que alguien ya ordenó a mano no se toca.
  const pendientes = await prisma.talla.findMany({
    where: { orden: ORDEN_SIN_ASIGNAR },
    select: { id: true, etiqueta: true },
  });
  if (pendientes.length === 0) {
    return;
  }

  const reparadas = pendientes
    .map((t) => ({ id: t.id, orden: deducirOrdenTalla(t.etiqueta) }))
    .filter((t): t is { id: number; orden: number } => t.orden !== null);

  // Se agrupan por `orden` para escribir con UN `updateMany` por valor distinto en vez de uno por
  // talla: son decenas de filas, pero la regla del proyecto es escribir por LOTES, no 1×1.
  const porOrden = new Map<number, number[]>();
  for (const t of reparadas) {
    porOrden.set(t.orden, [...(porOrden.get(t.orden) ?? []), t.id]);
  }
  for (const [orden, ids] of porOrden) {
    await prisma.talla.updateMany({
      where: { id: { in: ids }, orden: ORDEN_SIN_ASIGNAR },
      data: { orden },
    });
  }

  const sinEscala = pendientes.length - reparadas.length;
  console.log(
    `Seed: orden canónico sembrado en ${String(reparadas.length)} talla(s) que estaban en 0.` +
      (sinEscala === 0
        ? ''
        : ` Quedaron ${String(sinEscala)} etiqueta(s) que la escala no reconoce (se dejan en 0 a ` +
          'propósito; ordénalas a mano desde Catálogos › Tallas si hace falta).'),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Usuario admin (contraseña TEMPORAL — cambiarla en el primer inicio de sesión)
// ─────────────────────────────────────────────────────────────────────────────

const PASSWORD_TEMPORAL_ADMIN = 'Control.2026!';

async function sembrarAdmin(prisma: PrismaClient): Promise<void> {
  const admin = await prisma.usuario.upsert({
    where: { username: 'admin' },
    // No se pisan nombre/estado si ya existe (pudo editarse en producción).
    update: {},
    create: {
      username: 'admin',
      displayUsername: 'admin',
      nombre: 'Administrador',
      // Email sintético: better-auth lo exige, el negocio no lo usa (doc 10 §4).
      email: 'admin@control.local',
      emailVerified: true,
      activo: true,
    },
  });

  // Cuenta de credenciales de better-auth: providerId "credential" y accountId = id del
  // usuario (convención de better-auth). El hash es scrypt de better-auth/crypto — el
  // MISMO formato que better-auth verifica en el login (E3, ADR-0003).
  // update: {} a propósito — re-correr el seed JAMÁS restablece una contraseña cambiada.
  await prisma.cuenta.upsert({
    where: {
      providerId_accountId: { providerId: 'credential', accountId: admin.id },
    },
    update: {},
    create: {
      providerId: 'credential',
      accountId: admin.id,
      userId: admin.id,
      password: await hashPassword(PASSWORD_TEMPORAL_ADMIN),
    },
  });

  const rolAdministrador = await prisma.rol.findUniqueOrThrow({
    where: { nombre: 'Administrador' },
    select: { id: true },
  });
  await prisma.usuarioRol.upsert({
    where: { idUsuario_idRol: { idUsuario: admin.id, idRol: rolAdministrador.id } },
    update: {},
    create: { idUsuario: admin.id, idRol: rolAdministrador.id },
  });
}

// ─────────────────────────────────────────────────────────────────────────────

/** Corre el seed completo contra el cliente dado (lo reutilizan los tests). */
export async function sembrar(prisma: PrismaClient): Promise<void> {
  await sembrarEmpresa(prisma);
  const idPermisoPorClave = await sembrarPermisos(prisma);
  await sembrarRoles(prisma, idPermisoPorClave);
  // Después de los de sistema y aparte de ellos: crear-si-no-existe, nunca sincronizar.
  await sembrarPerfilesDePuesto(prisma, idPermisoPorClave);
  await sembrarRolesProveedor(prisma);
  await sembrarTiposProceso(prisma);
  await sembrarGeneros(prisma);
  await sembrarTiposMovimiento(prisma);
  await sembrarAlmacenesPt(prisma);
  // Fila 0.137: el almacén de AVÍOS base. Sin él, el guard de tipo dejaría los cuatro flujos de
  // avíos sin un solo almacén válido que elegir (el viejo no tenía almacenes de avíos).
  await sembrarAlmacenUnicoGlobal(prisma, 'AVIO', ALMACEN_AVIOS_BASE);
  // Fila 0.099: el almacén de TELAS base, por la misma razón — el seed no sembraba ninguno de tipo
  // TELA (sólo el ETL los creaba) y el cíclico de telas, que es la pantalla del ARRANQUE, se
  // quedaba sin almacén que elegir.
  await sembrarAlmacenUnicoGlobal(prisma, 'TELA', ALMACEN_TELAS_BASE);
  // Fichas confiables (F7-E4): los 8 reactivos fijos del checklist del viejo (IP_InfConf), ahora
  // filas configurables (A6). Idempotente por clave.
  await sembrarReactivosFicha(prisma);
  // Desarrollo/Cotización (F8-E1): conceptos de costo (R19; tela/avíos/maquila fijos) y estados de
  // lista (R20; cerrada/ya-pedida son de cierre). Idempotentes por `codigo`. Entran por SEED (no por
  // migración) → el deploy a `prueba` requiere SEED_ON_START=true.
  await sembrarConceptosCosto(prisma);
  await sembrarEstadosLista(prisma);
  // Importador de OC por PDF (§Post-F9.70 punto 2): la plantilla de C&A con su 7% de
  // sobre-pedido. Depende de que el cliente exista (lo carga el ETL): si no está, avisa y sigue.
  await sembrarPlantillaImportacionCya(prisma);
  await sembrarOrdenDeTallas(prisma);
  await sembrarAdmin(prisma);
  // Ruta Crítica (F5-E1): roles funcionales + 26 procesos reales + roles N:M + dependencias +
  // checklist de IP de ejemplo. Después de los roles base de F0 (reúsa "Administrador").
  await sembrarRutaCritica(prisma);
  // Ruta Crítica (F5-E2): familias/artículos + reglas de duración (cantidad/tela/aplicación) +
  // 2 plantillas reales (1/6 y 6/6) con su encadenamiento propio + calendario L–V y festivos MX
  // de la empresa favorita. Después de F5-E1 (necesita los procesos) y de la empresa favorita.
  await sembrarRutaCriticaPlantillas(prisma);
  // Calidad (F6-E1): tipos de producto base (lista corta editable, decisión (d)) + UN plan de
  // muestreo AQL default (ISO 2859 nivel general II, AQL 1.0/2.5/10) como DATOS. Idempotente; no
  // siembra defectos (los carga el ETL de F6-E6).
  await sembrarCalidad(prisma);

  await avisarSiNoQuedanAdministradores(prisma);
}

/**
 * Red de seguridad del guard anti-lockout: al terminar el seed, comprueba que
 * exista al menos UN usuario activo y no bloqueado con cada clave de gobierno.
 *
 * El guard del dominio cierra las cinco puertas que pasan por la aplicación, pero
 * no puede ver lo que se toque por fuera (el propio seed, un ETL, una consulta a
 * mano en la base). Esto no arregla nada — solo GRITA, y ese grito sale en los
 * logs del arranque de Railway, que es donde alguien lo va a ver a tiempo.
 */
async function avisarSiNoQuedanAdministradores(prisma: PrismaClient): Promise<void> {
  for (const clave of CLAVES_GOBIERNO) {
    const vivos = await prisma.usuario.count({
      where: {
        activo: true,
        bloqueado: false,
        roles: { some: { rol: { permisos: { some: { permiso: { clave } } } } } },
      },
    });
    if (vivos === 0) {
      console.warn(
        `⚠⚠ NADIE puede «${clave}»: no hay ningún usuario activo y no bloqueado con ese ` +
          `permiso. El sistema está cerrado por dentro para esa función — asígnale a alguien ` +
          `un rol que la otorgue (hoy solo se puede desde la base de datos).`,
      );
    }
  }
}

// Punto de entrada al ejecutarse como script (`prisma db seed` → `tsx prisma/seed.ts`).
const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  const prisma = crearClientePrisma(url);
  try {
    await sembrar(prisma);
    console.log('Seed de fundación aplicado (idempotente).');
  } finally {
    await prisma.$disconnect();
  }
}
