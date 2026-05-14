import { useState } from 'react';

function LoginIcon({ kind }) {
  if (kind === 'user') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M5.5 19c0-3.4 2.7-5.4 6.5-5.4s6.5 2 6.5 5.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === 'lock') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="6" y="10" width="12" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8.5 10V7.7a3.5 3.5 0 0 1 7 0V10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === 'eye') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3.8 12s3-5 8.2-5 8.2 5 8.2 5-3 5-8.2 5-8.2-5-8.2-5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }

  if (kind === 'eye-off') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m4 4 16 16M9.7 6.4A8.7 8.7 0 0 1 12 6c5.2 0 8.2 6 8.2 6a13.2 13.2 0 0 1-2.1 2.9M6.6 8.5A13.8 13.8 0 0 0 3.8 12s3 6 8.2 6c.9 0 1.7-.2 2.5-.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (kind === 'chair') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 4h10v8H7zM8 12v8M16 12v8M6 20h12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (kind === 'glass') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 4h8l-1 7a3 3 0 0 1-6 0L8 4Zm4 10v6M9 20h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (kind === 'cloth') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 9h14l-2 11H7L5 9Zm2-4h10l2 4H5l2-4Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (kind === 'tent') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 18 12 5l8 13H4Zm8-13v13M8.5 18v-4.5h7V18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (kind === 'login') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10 7V5h8v14h-8v-2M4 12h9m0 0-3-3m3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 19 7v5.8c0 4-2.7 6.7-7 8.2-4.3-1.5-7-4.2-7-8.2V7l7-4Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="m9 12 2 2 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LoginScreen({ authReady, error, onLogin }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLocalError('');
    setIsSubmitting(true);
    try {
      await onLogin?.({ username, password });
    } catch (requestError) {
      setLocalError(requestError.message || 'No se pudo iniciar sesion.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="login-shell">
      <span className="login-orbit login-orbit-top" aria-hidden="true" />
      <span className="login-orbit login-orbit-bottom" aria-hidden="true" />
      <section className="login-card">
        <aside className="login-showcase">
          <div className="login-showcase-bg" aria-hidden="true" />
          <div className="login-showcase-content">
            <div className="login-brand">
              <span className="login-brand-mark" aria-hidden="true">
                <svg viewBox="0 0 42 42">
                  <path d="M9 7h24L22 20v12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M15 35h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  <path d="M12 9c2.8 1.4 5.8 2.1 9 2.1S27.2 10.4 30 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </span>
              <div>
                <h1>El Copetin</h1>
                <p>Panel administrativo</p>
              </div>
            </div>

            <div className="login-copy">
              <h2>Transformamos momentos en experiencias inolvidables.</h2>
              <span />
              <p>Alquiler de mobiliario, cristaleria, manteleria y todo lo necesario para tu evento.</p>
            </div>

            <div className="login-service-grid" aria-label="Servicios principales">
              {[
                ['chair', 'Mobiliario'],
                ['glass', 'Cristaleria'],
                ['cloth', 'Manteleria'],
                ['tent', 'Eventos'],
              ].map(([icon, label]) => (
                <div key={label} className="login-service-tile">
                  <LoginIcon kind={icon} />
                  <strong>{label}</strong>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-form-head">
            <h2>Bienvenido de nuevo</h2>
            <p>Ingresa tus credenciales para continuar</p>
            <div className="login-divider" aria-hidden="true">
              <span />
              <i>
                <svg viewBox="0 0 42 42">
                  <path d="M9 7h24L22 20v12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M15 35h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </i>
              <span />
            </div>
          </div>

          <div className="login-fields">
            <label>
              Usuario
              <span className="login-input-shell">
                <LoginIcon kind="user" />
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="admin"
                  autoComplete="username"
                  disabled={!authReady || isSubmitting}
                  autoFocus
                />
              </span>
            </label>

            <label>
              Contrasena
              <span className="login-input-shell">
                <LoginIcon kind="lock" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="admin123"
                  autoComplete="current-password"
                  disabled={!authReady || isSubmitting}
                />
                <button
                  type="button"
                  className="login-password-toggle"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? 'Ocultar contrasena' : 'Mostrar contrasena'}
                  disabled={!authReady || isSubmitting}
                >
                  <LoginIcon kind={showPassword ? 'eye-off' : 'eye'} />
                </button>
              </span>
            </label>
          </div>

          {(localError || error) ? <p className="login-error">{localError || error}</p> : null}

          <button type="submit" className="primary-button login-submit" disabled={!authReady || isSubmitting}>
            <LoginIcon kind="login" />
            {isSubmitting ? 'Ingresando...' : 'Ingresar al sistema'}
          </button>

          <div className="login-secure-note">
            <LoginIcon kind="shield" />
            <span>
              <strong>Acceso seguro y protegido</strong>
              <small>Solo personal autorizado</small>
            </span>
          </div>
        </form>
      </section>
    </main>
  );
}

export default LoginScreen;
