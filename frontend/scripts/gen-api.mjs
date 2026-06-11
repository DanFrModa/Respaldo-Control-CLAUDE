// Regenera el cliente tipado del API desde el contrato OpenAPI del backend.
//
// Hace DOS cosas, en orden:
//   1. Copia `../backend/openapi.json` a `openapi.json` (junto a este frontend).
//      Esa copia es la que se versiona y la que usa el build de Docker: la
//      imagen del frontend NO puede alcanzar `../backend` en build (contexto
//      propio), así que el contrato viaja DENTRO de la carpeta del frontend.
//   2. Genera `src/api/esquema.gen.ts` (tipos `paths`/`components`) con
//      openapi-typescript a partir de esa copia, y lo formatea con Prettier.
//
// Se ejecuta con `npm run gen:api` cada vez que cambia el contrato del backend.
// Tanto la copia (`openapi.json`) como los tipos (`src/api/esquema.gen.ts`) se
// COMMITEAN, para que `npm run build` y la imagen Docker sean autónomos.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const raizFrontend = resolve(aqui, '..');
const require = createRequire(import.meta.url);

const contratoBackend = resolve(raizFrontend, '..', 'backend', 'openapi.json');
const contratoLocal = resolve(raizFrontend, 'openapi.json');
const salidaTipos = resolve(raizFrontend, 'src', 'api', 'esquema.gen.ts');

if (!existsSync(contratoBackend)) {
  console.error(
    `No se encontró el contrato del backend en ${contratoBackend}.\n` +
      'Genera primero el OpenAPI del backend (npm run build en backend/).',
  );
  process.exit(1);
}

// 1. Copia versionada del contrato (autonomía del build de Docker).
copyFileSync(contratoBackend, contratoLocal);
console.log(`Copiado ${contratoBackend} -> ${contratoLocal}`);

// 2. Generación de tipos desde la copia local + formateo. Se invocan los `bin`
//    de cada paquete con `node` (no por shell): así es portable a Windows y a la
//    imagen Linux de Docker sin depender de `npx.cmd`.
const ejecutarBin = (paquete, binRelativo, args) => {
  const rutaBin = resolve(dirname(require.resolve(`${paquete}/package.json`)), binRelativo);
  execFileSync(process.execPath, [rutaBin, ...args], { cwd: raizFrontend, stdio: 'inherit' });
};

ejecutarBin('openapi-typescript', 'bin/cli.js', [contratoLocal, '-o', salidaTipos]);
ejecutarBin('prettier', 'bin/prettier.cjs', ['--write', salidaTipos]);
console.log(`Generado ${salidaTipos}`);
