import { expect, test } from '@playwright/test';

import { abrirDesplegableMenu, entrarComoAdmin } from './ayudas';

/**
 * E2E de Tallas y curvas (F1-E2, PIEZA B — D4) contra el stack real, en la estructura
 * LISTA + DETALLE (rediseño "Teal fresco"). La pantalla tiene dos pestañas (Tallas /
 * Curvas). Cubre:
 *  - Tallas: ciclo CRUD completo (crear → editar → desactivar → mostrar desactivados →
 *    reactivar → buscar);
 *  - Curvas: alta con el ARMADOR (agregar tallas EN ORDEN) y el orden reflejado en el detalle;
 *  - la regla de Gabriel: una talla usada por una curva activa NO se puede desactivar
 *    (el backend la rechaza y la UI muestra el error).
 * Usa etiquetas únicas por corrida para no chocar con datos previos.
 */
test.describe('Tallas y curvas (D4)', () => {
  test('CRUD de una talla: crear, editar, desactivar, reactivar y buscar', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const etiqueta = `T${sufijo}`;
    const etiquetaEditada = `${etiqueta}X`;

    await entrarComoAdmin(page);

    // Navega Sistema · Catálogos base → Tallas (descubrible por clic).
    await abrirDesplegableMenu(page, 'Catálogos base');
    await page
      .getByRole('navigation', { name: 'Módulos' })
      .first()
      .getByRole('link', { name: 'Tallas', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Tallas' })).toBeVisible();

    // ── Crear ─────────────────────────────────────────────────────────────────
    await page.getByTestId('nuevo-talla').click();
    const dialogoAlta = page.getByRole('dialog');
    await expect(dialogoAlta.getByRole('heading', { name: 'Nueva talla' })).toBeVisible();
    await dialogoAlta.getByLabel('Etiqueta').fill(etiqueta);
    await dialogoAlta.getByLabel('Orden de despliegue').fill('5');
    await page.getByTestId('guardar-talla').click();

    await expect(page.getByText(`Talla "${etiqueta}" creada.`)).toBeVisible();
    await page.getByTestId('buscar-talla').fill(etiqueta);
    const filaNueva = page.getByTestId('fila-talla').filter({ hasText: etiqueta });
    await expect(filaNueva).toBeVisible();
    // Tabla-first: el estado se lee en el renglón (no hay panel de detalle).
    await expect(filaNueva.getByText('Activo', { exact: true })).toBeVisible();

    // ── Editar (botón inline del renglón) ──────────────────────────────────────
    await filaNueva.getByTestId('editar-talla').click();
    const dialogoEdicion = page.getByRole('dialog');
    await expect(dialogoEdicion.getByLabel('Etiqueta')).toHaveValue(etiqueta);
    await dialogoEdicion.getByLabel('Etiqueta').fill(etiquetaEditada);
    await page.getByTestId('guardar-talla').click();

    await expect(page.getByText(`Talla "${etiquetaEditada}" actualizada.`)).toBeVisible();
    await page.getByTestId('buscar-talla').fill(etiquetaEditada);
    const filaEditada = page.getByTestId('fila-talla').filter({ hasText: etiquetaEditada });
    await expect(filaEditada).toBeVisible();

    // ── Desactivar (borrado suave) ─────────────────────────────────────────────
    await filaEditada.getByTestId('desactivar-talla').click();
    const confirmacion = page.getByRole('dialog');
    await expect(confirmacion.getByRole('heading', { name: 'Desactivar talla' })).toBeVisible();
    await page.getByTestId('confirmar-accion').click();

    await expect(page.getByText(`Talla "${etiquetaEditada}" desactivada.`)).toBeVisible();
    await expect(page.getByTestId('fila-talla').filter({ hasText: etiquetaEditada })).toHaveCount(
      0,
    );

    // ── Mostrar desactivados → reactivar ───────────────────────────────────────
    await page.getByTestId('mostrar-desactivados').click();
    const filaInactiva = page.getByTestId('fila-talla').filter({ hasText: etiquetaEditada });
    await expect(filaInactiva).toBeVisible();
    await expect(filaInactiva.getByText('Inactivo', { exact: true })).toBeVisible();

    await filaInactiva.getByTestId('activar-talla').click();
    await expect(page.getByText(`Talla "${etiquetaEditada}" activada.`)).toBeVisible();
    await expect(
      page.getByTestId('fila-talla').filter({ hasText: etiquetaEditada }).getByText('Activo', {
        exact: true,
      }),
    ).toBeVisible();

    // ── Buscar ─────────────────────────────────────────────────────────────────
    await page.getByTestId('buscar-talla').fill('zzz-no-existe-zzz');
    await expect(page.getByText('No hay tallas que coincidan con la búsqueda.')).toBeVisible();
  });

  test('crear una curva con el armador: agrega tallas en orden', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const a = `A${sufijo}`;
    const b = `B${sufijo}`;
    const nombreCurva = `Curva E2E ${sufijo}`;

    await entrarComoAdmin(page);
    await page.goto('/catalogos/tallas');
    await expect(page.getByRole('heading', { name: 'Tallas' })).toBeVisible();

    // Crea dos tallas para armar la curva.
    for (const etiqueta of [a, b]) {
      await page.getByTestId('nuevo-talla').click();
      const dlg = page.getByRole('dialog');
      await dlg.getByLabel('Etiqueta').fill(etiqueta);
      await page.getByTestId('guardar-talla').click();
      await expect(page.getByText(`Talla "${etiqueta}" creada.`)).toBeVisible();
    }

    // Cambia a la pestaña Curvas.
    await page.getByTestId('pestana-curvas').click();
    await expect(page.getByRole('heading', { name: 'Curvas' })).toBeVisible();

    // Alta de curva: nombre + armador (agrega A y luego B → ese es el orden).
    await page.getByTestId('nuevo-curva').click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo.getByRole('heading', { name: 'Nueva curva' })).toBeVisible();
    await dialogo.getByLabel('Nombre').fill(nombreCurva);
    await dialogo.getByTestId('armador-curva').getByText(a, { exact: true }).click();
    await dialogo.getByTestId('armador-curva').getByText(b, { exact: true }).click();
    // Ambas quedan en "En la curva".
    await expect(dialogo.getByTestId('armador-curva-elegidas').getByText(a)).toBeVisible();
    await expect(dialogo.getByTestId('armador-curva-elegidas').getByText(b)).toBeVisible();
    await page.getByTestId('guardar-curva').click();

    await expect(page.getByText(`Curva "${nombreCurva}" creada.`)).toBeVisible();

    // Tabla-first: en el renglón de la curva, las tallas se ven en orden (A antes que B).
    await page.getByTestId('buscar-curva').fill(nombreCurva);
    const filaCurva = page.getByTestId('fila-curva').filter({ hasText: nombreCurva });
    await expect(filaCurva).toBeVisible();
    const tallasDetalle = filaCurva.getByTestId('detalle-curva-tallas');
    await expect(tallasDetalle.getByText(a, { exact: true })).toBeVisible();
    await expect(tallasDetalle.getByText(b, { exact: true })).toBeVisible();
  });

  test('una talla usada por una curva activa NO se puede desactivar', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const etiqueta = `U${sufijo}`;
    const nombreCurva = `Curva uso ${sufijo}`;

    await entrarComoAdmin(page);
    await page.goto('/catalogos/tallas');
    await expect(page.getByRole('heading', { name: 'Tallas' })).toBeVisible();

    // Crea una talla.
    await page.getByTestId('nuevo-talla').click();
    const dlgTalla = page.getByRole('dialog');
    await dlgTalla.getByLabel('Etiqueta').fill(etiqueta);
    await page.getByTestId('guardar-talla').click();
    await expect(page.getByText(`Talla "${etiqueta}" creada.`)).toBeVisible();

    // Crea una curva que la usa.
    await page.getByTestId('pestana-curvas').click();
    await page.getByTestId('nuevo-curva').click();
    const dlgCurva = page.getByRole('dialog');
    await dlgCurva.getByLabel('Nombre').fill(nombreCurva);
    await dlgCurva.getByTestId('armador-curva').getByText(etiqueta, { exact: true }).click();
    await page.getByTestId('guardar-curva').click();
    await expect(page.getByText(`Curva "${nombreCurva}" creada.`)).toBeVisible();

    // Vuelve a Tallas e intenta desactivar la talla en uso (botón inline del renglón).
    await page.getByTestId('pestana-tallas').click();
    await page.getByTestId('buscar-talla').fill(etiqueta);
    const filaTalla = page.getByTestId('fila-talla').filter({ hasText: etiqueta });
    await expect(filaTalla).toBeVisible();
    await filaTalla.getByTestId('desactivar-talla').click();
    await page.getByTestId('confirmar-accion').click();

    // El backend la rechaza (la usa una curva activa); la UI muestra el error y la talla
    // sigue activa (el renglón la marca Activo).
    await expect(page.getByText(/No se puede desactivar la talla/)).toBeVisible();
    await expect(
      page.getByTestId('fila-talla').filter({ hasText: etiqueta }).getByText('Activo', {
        exact: true,
      }),
    ).toBeVisible();
  });
});
