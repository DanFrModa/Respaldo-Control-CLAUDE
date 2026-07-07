import { zodResolver } from '@hookform/resolvers/zod';
import { Shirt } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate } from 'react-router-dom';

import { AlternadorTema } from '@/AlternadorTema';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authClient, traducirErrorAuth } from '@/lib/auth-client';
import { type DatosLogin, esquemaLogin } from '@/api/esquemas';
import { useSesion } from '@/sesion/useSesion';

/**
 * Pantalla de inicio de sesion de CONTROL v2 (rediseño R1 verde): dos columnas
 * en escritorio (panel de marca verde-oscuro, como el riel, + formulario denso)
 * y una columna en movil. Reproduce la entrada del sistema viejo (form
 * `USUARIOS`, doc 00 §1.1) modernizada:
 *
 *  - Valida la captura con el esquema Zod (`esquemaLogin`) — solo UX; el servidor
 *    re-valida y decide (A1).
 *  - Inicia sesion con el cliente de better-auth (`signIn.username`).
 *  - Exito -> refresca la sesion y entra a la app.
 *  - Credenciales malas -> error en español (traducido del codigo de better-auth).
 *  - **Bloqueo / cuenta desactivada** -> el mensaje del servidor se muestra TAL
 *    CUAL (el bloqueo a 5 intentos vive en el backend; el front solo lo presenta).
 *
 * Si el usuario ya tiene sesion, no hay nada que hacer aqui: se redirige a la app.
 */
export function Login(): React.JSX.Element {
  const navigate = useNavigate();
  const { sesion, cargando, refrescar } = useSesion();
  const [errorServidor, setErrorServidor] = useState<string | null>(null);

  const formulario = useForm<DatosLogin>({
    resolver: zodResolver(esquemaLogin),
    defaultValues: { username: '', password: '' },
  });

  // Si ya hay sesion (p. ej. se navego a /login estando dentro), entra a la app.
  if (!cargando && sesion !== null) {
    return <Navigate to="/" replace />;
  }

  const enviar = formulario.handleSubmit(async (datos) => {
    setErrorServidor(null);
    const { error } = await authClient.signIn.username({
      username: datos.username,
      password: datos.password,
    });
    if (error) {
      setErrorServidor(traducirErrorAuth(error));
      return;
    }
    await refrescar();
    // navigate() es asincrono en React Router 7; no necesitamos esperarlo.
    void navigate('/', { replace: true });
  });

  const { errors, isSubmitting } = formulario.formState;

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      {/* Panel de marca — verde muy oscuro, como el riel (ancla de marca).
          Solo escritorio: da la bienvenida y "llama a entrar". */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-rail p-10 text-rail-fg lg:flex">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary-bright to-primary text-primary-foreground shadow-sm"
          >
            <Shirt className="size-5" aria-hidden />
          </span>
          <span className="text-lg font-semibold tracking-tight text-rail-fg-strong">
            Control <span className="text-rail-active-fg">v2</span>
          </span>
        </div>

        <div className="max-w-md">
          <h2 className="text-3xl font-semibold tracking-tight text-balance text-rail-fg-strong">
            El control de tu producción textil, en un solo lugar.
          </h2>
          <p className="mt-4 text-sm text-rail-fg">
            Modelos, pedidos, producción y costos de FR Moda — claros, ordenados y siempre a la
            mano. Inicia sesión para continuar.
          </p>
        </div>

        <p className="text-xs tracking-wider text-rail-fg/70 uppercase">FR Moda</p>
      </aside>

      {/* Formulario */}
      <main className="relative flex items-center justify-center bg-background p-6">
        <div className="absolute top-4 right-4">
          <AlternadorTema />
        </div>

        <div className="w-full max-w-sm">
          {/* Marca en movil (en escritorio ya esta en el panel lateral). */}
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <span
              aria-hidden
              className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary-bright to-primary text-primary-foreground shadow-sm"
            >
              <Shirt className="size-4.5" aria-hidden />
            </span>
            <span className="text-lg font-semibold tracking-tight">
              Control <span className="text-primary">v2</span>
            </span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">Control v2</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Iniciar sesión — entra con tu usuario y contraseña.
          </p>

          <form onSubmit={(e) => void enviar(e)} noValidate className="mt-8">
            <FieldGroup>
              <Field data-invalid={Boolean(errors.username)}>
                <FieldLabel htmlFor="username">Usuario</FieldLabel>
                <Input
                  id="username"
                  autoComplete="username"
                  autoFocus
                  aria-invalid={Boolean(errors.username)}
                  disabled={isSubmitting}
                  {...formulario.register('username')}
                />
                <FieldError errors={[errors.username]} />
              </Field>
              <Field data-invalid={Boolean(errors.password)}>
                <FieldLabel htmlFor="password">Contraseña</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  aria-invalid={Boolean(errors.password)}
                  disabled={isSubmitting}
                  {...formulario.register('password')}
                />
                <FieldError errors={[errors.password]} />
              </Field>
              {errorServidor ? (
                <p
                  role="alert"
                  data-testid="error-login"
                  className="text-sm font-medium text-destructive"
                >
                  {errorServidor}
                </p>
              ) : null}
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? 'Entrando…' : 'Entrar'}
              </Button>
            </FieldGroup>
          </form>
        </div>
      </main>
    </div>
  );
}
