import { expect, test } from '@playwright/test';

import { CREDENCIALES_ADMIN, entrarComoAdmin } from './ayudas';

/**
 * E2E de Administración contra el stack real (frontend + backend + postgres).
 *
 * Flujo clave de la ficha F1-E1 (la prueba que da sentido al RBAC, A4): el admin
 * **crea un usuario con un rol SIN permisos de catálogos** (el rol `Basico` del
 * seed no otorga ninguno), cierra sesión, entra como ese usuario y comprueba que
 *  1. la portada de Catálogos NO ofrece ningún sub-catálogo (la pantalla esconde
 *     lo que el usuario no puede ver), y
 *  2. entrar por URL DIRECTA a un catálogo responde "prohibido" (el servidor
 *     decide: corta con 403 y su mensaje en español).
 *
 * Esto prueba de punta a punta que un usuario recién creado con un rol acotado
 * queda efectivamente limitado, tanto en la navegación como en el acceso directo.
 *
 * NOTA (no ejecutar aquí): este spec se deja ESCRITO; corre en CI con el stack
 * levantado por docker compose (job e2e), no en la máquina del coder.
 */

/** Contraseña del usuario de prueba (≥8, como exige el backend). */
const PASSWORD_PRUEBA = 'Prueba.2026!';

test.describe('Administración — Usuarios y RBAC', () => {
  test('un usuario con rol sin permisos de catálogos no ve ni accede a Catálogos', async ({
    page,
  }) => {
    // Username único por corrida para no chocar con datos previos.
    const sufijo = Date.now().toString().slice(-6);
    const username = `e2e_basico_${sufijo}`;

    // ── 1) Como admin: crear el usuario con el rol `Basico` ─────────────────────
    await entrarComoAdmin(page);

    await page
      .getByRole('navigation', { name: 'Módulos' })
      .first()
      .getByRole('link', { name: 'Administración' })
      .click();
    await page.getByTestId('administracion-usuarios').click();
    await expect(page.getByRole('heading', { name: 'Usuarios' })).toBeVisible();

    await page.getByTestId('nuevo-usuario').click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo.getByRole('heading', { name: 'Nuevo usuario' })).toBeVisible();
    await dialogo.getByLabel('Usuario').fill(username);
    await dialogo.getByLabel('Nombre').fill('Usuario Básico E2E');
    await dialogo.getByLabel('Contraseña').fill(PASSWORD_PRUEBA);
    // Marca el rol "Básico" (sin permisos de catálogos) en el selector de roles.
    await dialogo.getByRole('checkbox', { name: 'Basico' }).check();
    await page.getByTestId('guardar-usuario').click();

    await expect(page.getByText(`Usuario "${username}" creado.`)).toBeVisible();
    await expect(page.getByTestId('fila-usuario').filter({ hasText: username })).toBeVisible();

    // ── 2) Cerrar sesión del admin ──────────────────────────────────────────────
    await page.getByTestId('menu-usuario').click();
    await page.getByTestId('cerrar-sesion').click();
    await expect(page).toHaveURL(/\/login$/);

    // ── 3) Entrar como el usuario recién creado ─────────────────────────────────
    await page.getByLabel('Usuario').fill(username);
    await page.getByLabel('Contraseña').fill(PASSWORD_PRUEBA);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('heading', { name: /Hola, Usuario Básico E2E/ })).toBeVisible();

    // No es admin: no debería ver el módulo de Administración en el menú.
    await expect(
      page
        .getByRole('navigation', { name: 'Módulos' })
        .first()
        .getByRole('link', { name: 'Administración' }),
    ).toHaveCount(0);

    // ── 4) La portada de Catálogos no ofrece ningún sub-catálogo ────────────────
    // (El módulo Catálogos es "autenticado", así que el link existe; pero dentro
    // no hay tarjetas porque el rol no tiene ningún permiso `.ver`.)
    await page.goto('/catalogos');
    await expect(page.getByRole('heading', { name: 'Catálogos' })).toBeVisible();
    await expect(page.getByTestId('catalogo-almacenes')).toHaveCount(0);
    await expect(page.getByTestId('catalogo-proveedores')).toHaveCount(0);

    // ── 5) Entrar por URL directa a un catálogo responde "prohibido" ────────────
    // El backend corta con 403 y su mensaje en español; la pantalla lo muestra en
    // el estado de error de la tabla (con botón de reintento).
    await page.goto('/catalogos/almacenes');
    await expect(page.getByRole('heading', { name: 'Almacenes' })).toBeVisible();
    await expect(page.getByText(/permiso/i)).toBeVisible();
    await expect(page.getByTestId('nuevo-almacen')).toHaveCount(0);
  });

  test('el admin sí ve las secciones de Administración', async ({ page }) => {
    await entrarComoAdmin(page);
    await expect(page.getByTestId('empresa-activa')).toHaveText(CREDENCIALES_ADMIN.empresa);

    await page.goto('/administracion');
    await expect(page.getByRole('heading', { name: 'Administración' })).toBeVisible();
    // Con todos los permisos, las dos secciones construidas son tarjetas-enlace.
    await expect(page.getByTestId('administracion-usuarios')).toBeVisible();
    await expect(page.getByTestId('administracion-empresas')).toBeVisible();
  });
});
