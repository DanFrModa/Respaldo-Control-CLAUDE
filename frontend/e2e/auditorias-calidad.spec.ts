import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E de las AUDITORÍAS de calidad (F6-E2) contra el stack real. El flujo transaccional completo
 * (alta con folio/muestra/favoritos automáticos → captura de fallas → resultado MANUAL → sugerencia
 * por nivel → integración con la RC → reclasificación de kardex) está cubierto a fondo por los tests
 * de INTEGRACIÓN (`backend/src/dominio/calidad/auditorias.int.test.ts` y `src/api/auditorias.int.test`,
 * Postgres efímero en CI). Ese flujo punta-a-punta por la UI exige sembrar una orden COMPLETA con
 * matriz, encadenarla a un maquilero y a un proceso de RC, lo que lo haría frágil y dependiente del
 * estado (misma decisión que el E2E de recibos de maquila). Por eso aquí se verifica, contra el stack
 * real, que las pantallas cargan, exigen sesión y wirean sus controles principales:
 *  • Alta de auditoría: la pantalla carga desde el menú de Calidad y muestra el selector de orden.
 *  • Captura de resultados: la ruta resuelve y maneja con gracia una auditoría inexistente.
 *
 * Asume el admin sembrado (todos los permisos, incluidos `calidad.generar-auditorias`/
 * `calidad.actualizar-auditorias`).
 */
test.describe('Auditorías de calidad (F6-E2)', () => {
  test('la pantalla de alta carga desde el menú y wirea el selector de orden', async ({ page }) => {
    await entrarComoAdmin(page);

    // Navega Operación · Calidad → Alta de auditoría (desplegable del rediseño).
    await page
      .getByRole('navigation', { name: 'Módulos' })
      .first()
      .getByRole('button', { name: 'Calidad', exact: true })
      .click();
    await page
      .getByRole('navigation', { name: 'Módulos' })
      .first()
      .getByRole('link', { name: 'Alta de auditoría' })
      .click();

    await expect(page.getByRole('heading', { name: 'Alta de auditoría' })).toBeVisible();
    // El selector de orden está presente (la auditoría arranca eligiendo una orden).
    await expect(page.getByTestId('auditoria-selector-orden')).toBeVisible();
  });

  test('la ruta de captura resuelve y maneja una auditoría inexistente con gracia', async ({
    page,
  }) => {
    await entrarComoAdmin(page);

    await page.goto('/calidad/auditorias/99999999');
    // No crashea: muestra un estado de error (no se pudo cargar) en vez de pantalla en blanco.
    await expect(page.getByRole('alert')).toBeVisible();
  });
});

/**
 * E2E de la CONSULTA de auditorías (F6-E3) contra el stack real. Como en F6-E2, el flujo transaccional
 * completo (alta → captura → impreso → modificar/cancelar) vive en los tests de INTEGRACIÓN (Postgres
 * efímero): sembrar por la UI una orden COMPLETA + maquilero + auditoría sería frágil. Aquí se verifica
 * que las nuevas pantallas cargan desde la portada de Calidad y wirean sus controles principales.
 */
test.describe('Consulta de auditorías (F6-E3)', () => {
  test('la consulta carga desde la portada con sus filtros', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/calidad');
    await page.getByTestId('calidad-consulta-auditorias').click();

    await expect(page.getByRole('heading', { name: 'Consulta de auditorías' })).toBeVisible();
    // Filtros de servidor presentes (maquilero + resultado).
    await expect(page.getByTestId('filtro-maquilero-auditoria')).toBeVisible();
    await expect(page.getByTestId('filtro-resultado-auditoria')).toBeVisible();
  });

  test('el historial por maquilero carga y wirea el selector', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/calidad');
    await page.getByTestId('calidad-historial-maquilero').click();

    await expect(page.getByRole('heading', { name: 'Auditorías por maquilero' })).toBeVisible();
    await expect(page.getByTestId('historial-maquilero')).toBeVisible();
    // Sin maquilero elegido, invita a seleccionar uno.
    await expect(page.getByText(/Selecciona un maquilero/i)).toBeVisible();
  });
});
