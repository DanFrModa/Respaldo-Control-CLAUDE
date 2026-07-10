import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/** Password de los usuarios de prueba (misma política que `administracion.spec`). */
const PASSWORD_PRUEBA = 'Prueba.2026!';

/**
 * E2E de la PALETA DE COMANDOS ⌘K (rediseño R1→R2, pendiente (e) de R1): abrir, teclear y navegar
 * a una pantalla; y el filtrado por PERMISOS (A4) — un usuario restringido NO ve en la paleta las
 * pantallas vetadas ni el grupo de órdenes (la paleta absorbió el buscador de datos en R2).
 */
test.describe('Paleta de comandos ⌘K', () => {
  test('abre con el botón y con Ctrl+K, filtra pantallas y navega', async ({ page }) => {
    await entrarComoAdmin(page);

    // Abrir con el botón de la topbar (el disparador visible).
    await page.getByTestId('abrir-paleta').click();
    await expect(page.getByTestId('paleta-input')).toBeVisible();

    // ⌘K ve el CATÁLOGO COMPLETO, no el riel podado: encuentra pantallas que NO están en el menú
    // lateral (aquí "Tablero WIP", que salió del riel de Producción). Así nada queda inaccesible.
    await page.getByTestId('paleta-input').fill('Tablero WIP');
    await expect(page.getByTestId('paleta-resultados').getByText('Tablero WIP')).toBeVisible();
    await page.getByTestId('paleta-input').clear();

    // Teclear filtra pantallas: "Ruta" → Ruta Crítica (hoja directa a Mis pendientes, R4).
    await page.getByTestId('paleta-input').fill('Ruta Crítica');
    const opcionRc = page
      .getByTestId('paleta-resultados')
      .getByText('Ruta Crítica', { exact: true })
      .first();
    await expect(opcionRc).toBeVisible();
    await opcionRc.click();
    await expect(page).toHaveURL(/\/ruta-critica\/pendientes$/);
    await expect(page.getByRole('heading', { name: 'Mis pendientes' })).toBeVisible();

    // Reabrir con el atajo de teclado Ctrl+K (toggle).
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('paleta-input')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('paleta-input')).toHaveCount(0);
  });

  test('un usuario sin permisos NO ve las pantallas vetadas ni la búsqueda de órdenes', async ({
    page,
  }) => {
    const sufijo = Date.now().toString().slice(-6);
    const username = `e2e_paleta_${sufijo}`;

    // ── Como admin: crear un usuario con el rol "Basico" (sin permisos) ─────────
    await entrarComoAdmin(page);
    await page.goto('/administracion/usuarios');
    await expect(page.getByRole('heading', { name: 'Usuarios' })).toBeVisible();
    await page.getByTestId('nuevo-usuario').click();
    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Usuario').fill(username);
    await dialogo.getByLabel('Nombre').fill('Usuario Paleta E2E');
    await dialogo.getByLabel('Contraseña').fill(PASSWORD_PRUEBA);
    await dialogo.getByRole('checkbox', { name: 'Basico' }).check();
    await page.getByTestId('guardar-usuario').click();
    await expect(page.getByText(`Usuario "${username}" creado.`)).toBeVisible();

    // ── ANCLA: como ADMIN la paleta SÍ lista la pantalla (misma consulta que la
    //    aserción negativa de abajo — si el título cambiara, esta ancla truena primero
    //    y la negativa no queda vacua). ─────────────────────────────────────────────
    await page.getByTestId('abrir-paleta').click();
    await page.getByTestId('paleta-input').fill('Panel de administración');
    await expect(
      page.getByTestId('paleta-resultados').getByText('Panel de administración'),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('paleta-input')).toHaveCount(0);

    // ── Entrar como el restringido ──────────────────────────────────────────────
    await page.getByTestId('menu-usuario').click();
    await page.getByTestId('cerrar-sesion').click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('Usuario').fill(username);
    await page.getByLabel('Contraseña').fill(PASSWORD_PRUEBA);
    await page.getByRole('button', { name: 'Entrar' }).click();
    // Entró al Resumen operativo (R9) con la sesión del restringido (la identidad se
    // verifica en el menú de usuario; el saludo por nombre ya no existe).
    await expect(page.getByRole('heading', { name: 'Resumen operativo' })).toBeVisible();
    await expect(page.getByTestId('menu-usuario')).toContainText('Usuario Paleta E2E');

    // ── La paleta NO lista la pantalla vetada (A4) ──────────────────────────────
    await page.getByTestId('abrir-paleta').click();
    await page.getByTestId('paleta-input').fill('Panel de administración');
    await expect(
      page.getByTestId('paleta-resultados').getByText('Panel de administración'),
    ).toHaveCount(0);

    // Sin `ordenes.ver` tampoco hay grupo de Órdenes al teclear un folio numérico.
    await page.getByTestId('paleta-input').fill('1');
    await expect(page.getByTestId('paleta-orden')).toHaveCount(0);
  });
});
