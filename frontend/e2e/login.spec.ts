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

    // El riel muestra SOLO la estructura de Daniel (§3.1): EXACTAMENTE 7 padres desplegables
    // (Desarrollo, Producción, Calidad, Telas, Compras / MRP, Clientes, Catálogos base), ni uno más.
    // «Telas» pasó a desplegable en la etapa A2 (pedido de Daniel, 6-ago-2026: el catálogo de
    // telas tenía que verse en el menú) y «Compras / MRP» el 11-ago-2026 (mismo motivo: la
    // recepción de compras no tenía ningún enlace).
    const padres = navegacion.getByRole('button');
    expect(await padres.count()).toBe(7);
    // "Producción" arranca EXPANDIDA por default (fidelidad R9, como el prototipo):
    // sus DOS hijos aprobados se ven SIN clic, y NADA de las 14 sub-vistas legadas
    // (corte/envíos/recibos/WIP…), que ahora se alcanzan por ⌘K o URL directa.
    await expect(navegacion.getByRole('link', { name: 'Órdenes (OP)' })).toBeVisible();
    await expect(
      navegacion.getByRole('link', { name: 'Notas de salida', exact: true }),
    ).toBeVisible();
    await expect(navegacion.getByRole('link', { name: 'Tablero WIP' })).toHaveCount(0);
    // El padre sigue siendo desplegable: un clic la cierra y otro la reabre.
    await navegacion.getByRole('button', { name: 'Producción' }).click();
    await expect(navegacion.getByRole('link', { name: 'Órdenes (OP)' })).toHaveCount(0);
    await navegacion.getByRole('button', { name: 'Producción' }).click();
    await expect(navegacion.getByRole('link', { name: 'Órdenes (OP)' })).toBeVisible();
    // «Telas» (A2) arranca CERRADA: al desplegarla se ven sus 5 hijos curados — la nueva
    // Existencias por color (principal), el Catálogo de telas (el pedido de Daniel), las entradas
    // por factura (B1), la salida a orden y el ajuste por color. El resto (traspaso/kardex/vistas
    // por lote) va por ⌘K.
    await expect(navegacion.getByRole('link', { name: 'Existencias de telas' })).toHaveCount(0);
    await navegacion.getByRole('button', { name: 'Telas' }).click();
    for (const hijoTelas of [
      'Existencias de telas',
      'Catálogo de telas',
      'Entradas de tela por factura',
      'Salida de tela a orden',
      'Ajuste de telas por color',
    ]) {
      await expect(navegacion.getByRole('link', { name: hijoTelas, exact: true })).toBeVisible();
    }
    await expect(navegacion.getByRole('link', { name: 'Traspaso de telas por color' })).toHaveCount(
      0,
    );
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
