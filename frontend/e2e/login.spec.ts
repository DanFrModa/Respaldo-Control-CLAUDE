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

  test('el admin entra y ve el layout con todos sus módulos', async ({ page }) => {
    await entrarComoAdmin(page);

    // Entró a la app (inicio).
    await expect(page).toHaveURL(/\/$|\/$/);
    await expect(page.getByRole('heading', { name: /Hola, Administrador/ })).toBeVisible();

    // El admin (todos los permisos) ve el menú completo. NO se fija un número exacto de links: cada
    // fase suma módulos/sub-vistas y un `toHaveCount` exacto se rompería en cada etapa. Se valida un
    // PISO razonable y la presencia de módulos representativos de varias áreas.
    const navegacion = page.getByRole('navigation', { name: 'Módulos' }).first();
    const links = navegacion.getByRole('link');
    expect(await links.count()).toBeGreaterThanOrEqual(20);
    for (const modulo of [
      'Catálogos',
      'Producción',
      'Inventarios',
      'Ruta Crítica',
      // Sub-vista del concentrado (F5-E7): aparece como enlace del menú con su permiso.
      'Concentrado planeado vs real',
      // Calidad (F6-E1): módulo + sub-vista de defectos.
      'Calidad',
      'Administración',
    ]) {
      await expect(links.filter({ hasText: modulo }).first()).toBeVisible();
    }
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
