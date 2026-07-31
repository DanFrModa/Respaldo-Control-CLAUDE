import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E del tablero de gestión "ANÁLISIS RC" (rediseño R7) contra el stack real, en el estándar visual.
 * Es una consulta gerencial de SOLO LECTURA: se verifica que la pantalla vive y es operable (KPIs +
 * las tablas de triage / alertas / riesgo / cuellos cargan, vacías o con datos, sin que la BD de e2e
 * tenga que tener órdenes con RC viva), que la tarjeta de DESEMPEÑO (management) aparece para el admin
 * y que su "Generar evaluación semanal" ofrece el binario Excel. El segundo test lo verifica en móvil.
 *
 * El contenido (salud, forward pass, scoring) lo cubren los tests de integración del backend
 * (`analisisRc.int.test.ts`); aquí basta con que el tablero cargue y navegue.
 */
test.describe('Análisis RC — tablero de gestión (R7)', () => {
  test('carga los KPIs, las tablas y el desempeño con su export Excel', async ({ page }) => {
    await entrarComoAdmin(page);

    // Se llega por URL directa (y por el menú, grupo ANÁLISIS).
    await page.goto('/analisis-rc');
    await expect(page.getByRole('heading', { name: 'Análisis de Ruta Crítica' })).toBeVisible();

    // Termina de cargar (deja de mostrar "Cargando análisis…").
    await expect(page.getByTestId('analisis-cargando')).toHaveCount(0);

    // Los 5 KPIs de salud están presentes.
    await expect(page.getByTestId('kpi-activas')).toBeVisible();
    await expect(page.getByTestId('kpi-cumplimiento')).toBeVisible();

    // Las tarjetas del tablero (triage / alertas / riesgo / cuellos) tienen su encabezado.
    await expect(page.getByText('Órdenes que requieren atención')).toBeVisible();
    await expect(page.getByText('Alertas predictivas — van a atrasarse')).toBeVisible();
    await expect(page.getByText('Riesgo por cliente')).toBeVisible();
    await expect(page.getByText('Cuellos de botella por proceso')).toBeVisible();
    await expect(page.getByText('Entrega al cliente y tiempo de ciclo')).toBeVisible();

    // El admin tiene rc.programar → ve el desempeño del equipo + su export a Excel.
    await expect(page.getByText('Desempeño del equipo (RC)')).toBeVisible();
    const descargaPromesa = page.waitForEvent('download');
    await page.getByTestId('desempeno-excel').click();
    const descarga = await descargaPromesa;
    expect(descarga.suggestedFilename()).toMatch(/\.xlsx$/);
  });

  test('el tablero funciona en viewport móvil', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrarComoAdmin(page);

    await page.goto('/analisis-rc');
    await expect(page.getByRole('heading', { name: 'Análisis de Ruta Crítica' })).toBeVisible();
    await expect(page.getByTestId('analisis-cargando')).toHaveCount(0);
    // Los KPIs se ven sin que la página se desborde horizontalmente.
    await expect(page.getByTestId('kpi-activas')).toBeVisible();
  });
});
