#!/usr/bin/env tsx
/**
 * «Escribir y luego negar», a mano: `npm run verificar:eco` desde `backend/`.
 *
 * Sale 0 si el dominio está limpio y 1 con el detalle si no. **No hace falta acordarse de correrlo**
 * —lo ejecuta el CI por `src/pruebas/eco-sin-reja.test.ts`, en el proyecto `unit` del job `backend`—
 * pero tenerlo a mano ahorra un ciclo de 45 minutos cuando se está escribiendo la función.
 *
 * La explicación del defecto que vigila, del modelo de permisos y de lo que NO cubre está en
 * `src/pruebas/eco-sin-reja.ts`.
 *
 * Acepta opcionalmente la raíz a analizar (por omisión, la carpeta `backend/` desde la que se
 * invoca). Sirve para medirlo contra otro árbol, por ejemplo uno exportado con
 * `git archive <commit> backend/src | tar -x -C /tmp/arbol`.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

import { analizar, informe } from '../src/pruebas/eco-sin-reja.js';

function raizBackend(): string {
  const pedida = process.argv[2];
  if (pedida !== undefined) return resolve(pedida);
  let directorio = process.cwd();
  for (;;) {
    if (existsSync(join(directorio, 'src', 'dominio'))) return directorio;
    const padre = dirname(directorio);
    if (padre === directorio) {
      throw new Error(`No encontré la raíz de backend/ subiendo desde ${process.cwd()}`);
    }
    directorio = padre;
  }
}

const raiz = raizBackend();
const resultado = analizar(raiz);
const decir = (linea: string): void => void process.stdout.write(`${linea}\n`);

decir(
  `Analizadas ${resultado.rutasAnalizadas} rutas y ${resultado.funcionesIndexadas} funciones de ${raiz}.`,
);
decir(
  `${resultado.exoneradas} sitios recorridos y exonerados (la reja que piden DESPUÉS del commit sí la ` +
    `cubre quien escribe: puertas OR y rutas con los dos permisos encadenados).`,
);

const texto = informe(resultado);
if (texto === '') {
  decir('✅ Nadie escribe y luego niega: ningún sitio pide, después del commit, un permiso que');
  decir('   quien escribe pueda no traer.');
  process.exit(0);
}
decir('');
decir(texto);
process.exit(1);
