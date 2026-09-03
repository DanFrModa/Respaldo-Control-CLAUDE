import { expect, test } from '@playwright/test';

import { CREDENCIALES_ADMIN, entrarComoAdmin } from './ayudas';

/**
 * E2E del inicio de sesion contra el stack real (frontend + backend + postgres).
 *
 * Nota sobre el BLOQUEO a 5 intentos (doc 00 §1.1): bloquear a un usuario real
 * requeriria 5 fallos sobre una cuenta existente; la unica sembrada es `admin`,
 * que las demas pruebas necesitan operativa (y los usuarios inexistentes NO se
 * bloquean: el backend no revela su ausencia). Por eso el bloqueo —y que su
 * mensaje en español se muestre TAL CUAL— se cubre de forma determinista en la
 * prueba de componente `src/paginas/Login.test.tsx` (respuesta 403 simulada).
 * Aqui se prueba el camino de credenciales invalidas, que ejercita el mismo
 * pipeline de error -> mensaje sin arriesgar la cuenta admin.
 */
test.describe('Inicio de sesión', () => {
  test('una ruta protegida sin sesión redirige a /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: /Control v2/i })).toBeVisible();
    await expect(page.getByText('Iniciar sesión')).toBeVisible();
  });

  test('credenciales inválidas muestran un error en español', async ({ page }) => {
    await page.goto('/login');
    // Usuario inexistente: el backend responde el generico sin revelar existencia
    // y SIN bloquear a nadie (no toca la cuenta admin).
    await page.getByLabel('Usuario').fill('usuario.inexistente');
    await page.getByLabel('Contraseña').fill('claveIncorrecta');
    await page.getByRole('button', { name: 'Entrar' }).click();

    await expect(page.getByTestId('error-login')).toHaveText('Usuario o contraseña incorrectos.');
    // Sigue en login (no entro).
    await expect(page).toHaveURL(/\/login$/);
  });

  test('la validación de captura impide enviar el formulario vacío', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Entrar' }).click();

    await expect(page.getByText('El usuario es obligatorio')).toBeVisible();
    await expect(page.getByText('La contraseña es obligatoria')).toBeVisible();
  });

  test('el admin entra y ve el riel con los grupos aprobados del rediseño', async ({ page }) => {
    await entrarComoAdmin(page);

    // Entró a la app (el Resumen operativo del rediseño R9).
    await expect(page).toHaveURL(/\/$|\/$/);
    await expect(page.getByRole('heading', { name: 'Resumen operativo' })).toBeVisible();

    // El admin (todos los permisos) ve el menú del rediseño R1: GRUPOS con
    // desplegables de 2 niveles (estructura aprobada por Daniel, 4-jul-2026).
    const navegacion = page.getByRole('navigation', { name: 'Módulos' }).first();

    // Los 6 rótulos de grupo (Resumen va suelto, sin rótulo).
    for (const grupo of [
      'Operación',
      'Inventarios',
      'Comercial',
      'Finanzas',
      'Análisis',
      'Sistema',
    ]) {
      await expect(navegacion.getByText(grupo, { exact: true })).toBeVisible();
    }

    // Hojas directas visibles sin desplegar nada.
    for (const hoja of ['Resumen', 'Pedidos', 'Proveedores', 'Cuentas por cobrar']) {
      await expect(navegacion.getByRole('link', { name: hoja, exact: true })).toBeVisible();
    }

    // El riel muestra SOLO la estructura de Daniel (§3.1): EXACTAMENTE 8 padres desplegables
    // (Desarrollo, Producción, Inventario PT, Telas, Avíos, Compras / MRP, Clientes, Catálogos
    // base), ni uno más. «Telas» pasó a desplegable en la etapa A2 (pedido de Daniel, 6-ago-2026:
    // el catálogo de telas tenía que verse en el menú), «Compras / MRP» el 11-ago-2026 (mismo
    // motivo: la recepción de compras no tenía entrada en el menú) e «Inventario PT» + «Avíos» el
    // 12-ago-2026 («destapa las cosas de una vez»). «Calidad» DEJÓ de ser padre el 13-ago-2026
    // (V1-E3a): como desplegable, `PadreNav` no navega y sus catálogos (defectos, tipos de
    // producto, planes AQL, auditorías por maquilero) eran inalcanzables desde toda la app → ahora
    // es HOJA a su portada-hub `/calidad`, que tiene las 7 tarjetas.
    const padres = navegacion.getByRole('button');
    expect(await padres.count()).toBe(8);
    await expect(navegacion.getByRole('link', { name: 'Calidad', exact: true })).toBeVisible();
    // "Producción" arranca EXPANDIDA por default (fidelidad R9, como el prototipo): sus SEIS hijos
    // curados se ven SIN clic (V1-E3a: antes eran solo dos y las otras 15 sub-vistas no tenían
    // entrada de menú — la ENTREGA A CLIENTE, el cierre del ciclo, no la enlazaba nada). Las demás
    // CONSULTAS siguen fuera del riel, en ⌘K y en la portada-hub /produccion.
    for (const hijoProd of [
      'Órdenes (OP)',
      'Entrega a cliente',
      'Tablero WIP',
      'En poder del maquilero',
      // «Consulta de órdenes» entra por su IMPRESIÓN EN LOTE (capacidad que no está en el Centro).
      'Consulta de órdenes',
      'Notas de salida',
    ]) {
      await expect(navegacion.getByRole('link', { name: hijoProd, exact: true })).toBeVisible();
    }
    // Las consultas que SÍ duplican lo que ya hacen el Centro o Pedidos siguen fuera del riel.
    await expect(navegacion.getByRole('link', { name: 'Órdenes incompletas' })).toHaveCount(0);
    await expect(navegacion.getByRole('link', { name: 'Corte semanal' })).toHaveCount(0);
    // Las tres pantallas del MISMO acto (corte/envío/recibo) se retiraron: se capturan en el panel
    // de avance del Centro de Órdenes (§Post-F9.36 punto 2).
    for (const retirada of ['Captura de corte', 'Envío a maquila', 'Recibo de maquila']) {
      await expect(navegacion.getByRole('link', { name: retirada, exact: true })).toHaveCount(0);
    }
    // El padre sigue siendo desplegable: un clic la cierra y otro la reabre.
    await navegacion.getByRole('button', { name: 'Producción' }).click();
    await expect(navegacion.getByRole('link', { name: 'Órdenes (OP)' })).toHaveCount(0);
    await navegacion.getByRole('button', { name: 'Producción' }).click();
    await expect(navegacion.getByRole('link', { name: 'Órdenes (OP)' })).toBeVisible();
    // ⭐ V1-E8f (§Post-F9.128): «Desarrollo» arranca CERRADA; al desplegarla, la entrada de las
    // listas se llama «Listas de precios» — el nombre que Daniel BUSCÓ y no encontró (se llamaba
    // «Cotizaciones», y reportó *"no está la opción de listas de precios en desarrollo"*). Va junto
    // a «Pre-costeos», que es donde entró por equivocación: las dos deben verse y distinguirse.
    await navegacion.getByRole('button', { name: 'Desarrollo' }).click();
    // V1-E8r (§Post-F9.140): con «Recetas por revisar» son CINCO hijos, y las dos bandejas tienen
    // que distinguirse en el riel (`exact: true` ya lo garantiza: «revisar» ≠ «liberar»).
    // V1-E9p (§Post-F9.144(b)): SEIS con «Promesas incumplidas», que `admin` ve porque tiene
    // `consultas.ver-importes` (de Ventas hacia abajo no aparece: sería un enlace muerto).
    for (const hijoDes of [
      'Modelos',
      'Recetas por revisar',
      'Promesas incumplidas',
      'Recetas por liberar',
      'Pre-costeos',
      'Listas de precios',
    ]) {
      await expect(navegacion.getByRole('link', { name: hijoDes, exact: true })).toBeVisible();
    }
    await navegacion.getByRole('button', { name: 'Desarrollo' }).click();
    // «Inventario PT» (12-ago-2026) arranca CERRADA: al desplegarla se ven sus 4 hijos (todos los
    // del catálogo). Antes era hoja plana a Existencias y Movimientos / Traspasos / Kardex PT no
    // tenían ENTRADA EN EL MENÚ (sí enlace desde Existencias PT: las pestañas de captura y el
    // botón «Kardex»).
    await expect(navegacion.getByRole('link', { name: 'Movimientos PT' })).toHaveCount(0);
    await navegacion.getByRole('button', { name: 'Inventario PT' }).click();
    for (const hijoPt of ['Existencias PT', 'Movimientos PT', 'Traspasos PT', 'Kardex PT']) {
      await expect(navegacion.getByRole('link', { name: hijoPt, exact: true })).toBeVisible();
    }
    // «Telas» (A2) arranca CERRADA: al desplegarla se ven sus 7 hijos — los seis flujos POR COLOR
    // (Existencias principal, el Catálogo de telas —el pedido de Daniel—, las entradas por factura
    // de B1, la salida a orden, el ajuste y el TRASPASO) y, al final, la vista de «materiales» que
    // sirve a las dos dimensiones (el kardex: telas por lote Y avíos, pero cuelga de este padre en
    // el catálogo, así que no puede ir bajo Avíos). El AJUSTE de materiales se fue a «Avíos» el
    // 13-ago-2026 al volverse solo-avíos, y el TRASPASO en la fila 0.098 por lo mismo. El traspaso
    // POR COLOR es el flujo vigente («El traspaso se hace por color», Daniel —
    // `DECISIONES.md §Post-F9.32`): el de lote graba `id_tela_color = NULL` y no mueve las
    // existencias del primer hijo, así que el menú no puede ofrecer sólo aquél.
    await expect(navegacion.getByRole('link', { name: 'Existencias de telas' })).toHaveCount(0);
    await navegacion.getByRole('button', { name: 'Telas' }).click();
    for (const hijoTelas of [
      'Existencias de telas',
      'Catálogo de telas',
      'Entradas de tela por factura',
      'Salida de tela a orden',
      'Ajuste de telas por color',
      'Traspaso de telas por color',
      'Kardex de materiales',
    ]) {
      await expect(navegacion.getByRole('link', { name: hijoTelas, exact: true })).toBeVisible();
    }
    // Ni el ajuste ni el traspaso cuelgan ya de Telas (se volvieron solo-avíos y se mudaron al
    // padre «Avíos»: el ajuste el 13-ago-2026, el traspaso en la fila 0.098).
    for (const mudada of ['Ajuste de avíos', 'Traspaso de avíos']) {
      await expect(navegacion.getByRole('link', { name: mudada })).toHaveCount(0);
    }
    // Lo único de Telas que sigue FUERA del riel: las dos vistas por lote LEGADAS (ya no operan).
    for (const legada of ['Existencias por lote (legado)', 'Salida a orden por lote (legado)']) {
      await expect(navegacion.getByRole('link', { name: legada, exact: true })).toHaveCount(0);
    }
    // «Avíos» (12-ago-2026) arranca CERRADA: al desplegarla se ven sus 4 hijos. Antes era hoja
    // plana a Existencias y el «Catálogo de avíos» no tenía ENTRADA EN EL MENÚ — su único enlace
    // era la tarjeta del hub /catalogos, que tampoco es entrada del riel. El tercero, «Ajuste de
    // avíos», llegó el 13-ago-2026 desde el padre «Telas» (ya no toca tela), y el cuarto,
    // «Traspaso de avíos», en la fila 0.098 por lo mismo.
    await expect(navegacion.getByRole('link', { name: 'Catálogo de avíos' })).toHaveCount(0);
    await navegacion.getByRole('button', { name: 'Avíos' }).click();
    for (const hijoAvios of [
      'Existencias de avíos',
      'Catálogo de avíos',
      'Ajuste de avíos',
      'Traspaso de avíos',
    ]) {
      await expect(navegacion.getByRole('link', { name: hijoAvios, exact: true })).toBeVisible();
    }
    // «Compras / MRP» (11-ago-2026) también arranca CERRADA: al desplegarla se ven sus 4 hijos
    // curados. Antes era hoja plana a las Órdenes de compra y la Recepción / el semáforo / la
    // explosión no tenían ENTRADA EN EL MENÚ ni enlace estable (solo ⌘K/URL; la Recepción,
    // además, el deep-link condicional de Mis pendientes de RC). La autorización de compras y
    // «Compras por orden» siguen fuera del riel.
    await expect(navegacion.getByRole('link', { name: 'Recepción de compras' })).toHaveCount(0);
    await navegacion.getByRole('button', { name: 'Compras / MRP' }).click();
    for (const hijoCompras of [
      'Órdenes de compra',
      'Recepción de compras',
      'Qué tengo / qué falta',
      'Explosión de materiales',
    ]) {
      await expect(navegacion.getByRole('link', { name: hijoCompras, exact: true })).toBeVisible();
    }
    await expect(navegacion.getByRole('link', { name: 'Autorización de compras' })).toHaveCount(0);
    // "Ruta Crítica" (la entrada estrella) es HOJA DIRECTA a Mis pendientes (R4).
    await expect(navegacion.getByRole('link', { name: 'Ruta Crítica', exact: true })).toBeVisible();
    // "Procesos y responsables" y "Usuarios y accesos" son HOJAS DIRECTAS (Daniel): su
    // configuración interna vive DENTRO de la pantalla, no como sub-menú del riel.
    await expect(
      navegacion.getByRole('link', { name: 'Procesos y responsables', exact: true }),
    ).toBeVisible();
    await expect(
      navegacion.getByRole('link', { name: 'Usuarios y accesos', exact: true }),
    ).toBeVisible();
    // El concentrado planeado-vs-real ya NO es entrada del riel (se llega por ⌘K/URL).
    await expect(
      navegacion.getByRole('link', { name: 'Concentrado planeado vs real' }),
    ).toHaveCount(0);

    // El badge de alertas RC del encabezado está montado (dato real del backend).
    await expect(page.getByTestId('badge-alertas-rc')).toBeVisible();
    // La empresa activa aparece en el encabezado.
    await expect(page.getByTestId('empresa-activa')).toHaveText(CREDENCIALES_ADMIN.empresa);
  });

  test('cerrar sesión vuelve a /login', async ({ page }) => {
    await entrarComoAdmin(page);

    await page.getByTestId('menu-usuario').click();
    await page.getByTestId('cerrar-sesion').click();

    await expect(page).toHaveURL(/\/login$/);
    // Sin sesión, volver a la app rebota a login.
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('el alternador de tema cambia entre claro y oscuro', async ({ page }) => {
    await page.goto('/login');
    const html = page.locator('html');

    // Arranca en claro (sin clase dark).
    await expect(html).not.toHaveClass(/dark/);
    await page.getByTestId('alternar-tema').click();
    await expect(html).toHaveClass(/dark/);
    await page.getByTestId('alternar-tema').click();
    await expect(html).not.toHaveClass(/dark/);
  });
});
