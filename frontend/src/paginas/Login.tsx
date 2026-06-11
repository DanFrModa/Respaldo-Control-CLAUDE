import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate } from 'react-router-dom';

import { AlternadorTema } from '@/AlternadorTema';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authClient, traducirErrorAuth } from '@/lib/auth-client';
import { type DatosLogin, esquemaLogin } from '@/api/esquemas';
import { useSesion } from '@/sesion/useSesion';

/**
 * Pantalla de inicio de sesion de CONTROL v2. Reproduce la entrada del sistema
 * viejo (form `USUARIOS`, doc 00 §1.1) modernizada:
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
    <div className="relative flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <div className="absolute top-4 right-4">
        <AlternadorTema />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold tracking-tight">
            CONTROL <span className="text-muted-foreground">v2</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">ERP textil Marilyn / MJD</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Iniciar sesión</CardTitle>
            <CardDescription>Entra con tu usuario y contraseña.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void enviar(e)} noValidate>
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
