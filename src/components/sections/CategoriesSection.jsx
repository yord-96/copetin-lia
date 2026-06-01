import { useEffect, useMemo, useState } from 'react';

const settingsTabs = ['Empresa', 'Inventario', 'Transporte', 'Documentos', 'Notificaciones', 'Seguridad', 'Sistema'];

const buildSettingsDraft = (settings) => ({
  companyName: settings.companyName ?? '',
  taxId: settings.taxId ?? '',
  address: settings.address ?? '',
  phone: settings.phone ?? '',
  email: settings.email ?? '',
  website: settings.website ?? '',
  timezone: settings.timezone ?? 'America/Argentina/Buenos_Aires',
  dateFormat: settings.dateFormat ?? 'DD/MM/YYYY',
  timeFormat: settings.timeFormat ?? '24h',
  language: settings.language ?? 'es',
  currency: settings.currency ?? 'BOB',
  fiscalCondition: settings.fiscalCondition ?? 'Responsable Inscripto',
  activityStartDate: settings.activityStartDate ?? '',
  contractCancellationPenaltyPercent: Number(settings.contractCancellationPenaltyPercent ?? 20),
  numbering: {
    serviceOrderPrefix: settings.numbering?.serviceOrderPrefix ?? 'OS-',
    serviceOrderNext: settings.numbering?.serviceOrderNext ?? 1,
    deliveryPrefix: settings.numbering?.deliveryPrefix ?? 'ENT-',
    deliveryNext: settings.numbering?.deliveryNext ?? 1,
    adjustmentPrefix: settings.numbering?.adjustmentPrefix ?? 'AJ-',
    adjustmentNext: settings.numbering?.adjustmentNext ?? 1,
    movementPrefix: settings.numbering?.movementPrefix ?? 'MOV-',
    movementNext: settings.numbering?.movementNext ?? 1,
  },
  backupMode: settings.backupMode ?? 'automatico',
});

function SettingsIcon({ kind }) {
  if (kind === 'gear') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" d="m12 3 2 2.1 2.9-.2.8 2.7 2.6 1.2-1 2.7 1 2.7-2.6 1.2-.8 2.7-2.9-.2L12 21l-2.1-2.1-2.9.2-.8-2.7-2.6-1.2 1-2.7-1-2.7 2.6-1.2.8-2.7 2.9.2L12 3Z" />
        <circle cx="12" cy="12" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.9" />
      </svg>
    );
  }
  if (kind === 'office') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" d="M4 20h16M7 20V6l5-2v16m0-12h5v12h-5" />
        <path fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" d="M9 9h.01M9 12h.01M9 15h.01M14 10h.01M14 13h.01" />
      </svg>
    );
  }
  if (kind === 'clock') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.9" />
        <path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" d="M12 8v4.5l3 2" />
      </svg>
    );
  }
  if (kind === 'database') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <ellipse cx="12" cy="6" rx="6.5" ry="2.8" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" d="M5.5 6v4c0 1.5 2.9 2.8 6.5 2.8s6.5-1.3 6.5-2.8V6m-13 4v4c0 1.5 2.9 2.8 6.5 2.8s6.5-1.3 6.5-2.8v-4" />
      </svg>
    );
  }
  return null;
}

function CategoriesSection({ settingsBundle, categoryItemCount, onUpdateSettings }) {
  const settings = settingsBundle?.settings ?? null;
  const categories = settingsBundle?.categories ?? [];
  const [form, setForm] = useState(null);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (!settings) return;
    if (isDirty) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(buildSettingsDraft(settings));
  }, [isDirty, settings]);

  const cards = useMemo(() => {
    return [
      { tone: 'lilac', icon: 'gear', value: String(settingsTabs.length + 1), label: 'Secciones configuradas', link: 'Ver todas' },
      { tone: 'sky', icon: 'office', value: form?.companyName || 'Empresa', label: 'Empresa activa', link: 'Ver perfil de empresa' },
      { tone: 'mint', icon: 'clock', value: form?.timezone === 'America/La_Paz' ? 'UTC -4' : 'UTC -3', label: 'Zona horaria', link: 'Cambiar zona horaria' },
      { tone: 'peach', icon: 'database', value: form?.backupMode === 'manual' ? 'Manual' : 'Automatico', label: 'Backups programados', link: 'Gestionar backups' },
    ];
  }, [form]);

  if (!form) {
    return null;
  }

  const setField = (key, value) => {
    setIsDirty(true);
    setForm((current) => ({ ...current, [key]: value }));
  };
  const setNumbering = (key, value) => {
    setIsDirty(true);
    setForm((current) => ({
      ...current,
      numbering: { ...current.numbering, [key]: value },
    }));
  };

  const handleSave = async () => {
    await onUpdateSettings?.({
      companyName: form.companyName,
      taxId: form.taxId,
      address: form.address,
      phone: form.phone,
      email: form.email,
      website: form.website,
      timezone: form.timezone,
      dateFormat: form.dateFormat,
      timeFormat: form.timeFormat,
      language: form.language,
      currency: form.currency,
      fiscalCondition: form.fiscalCondition,
      activityStartDate: form.activityStartDate,
      contractCancellationPenaltyPercent: Number(form.contractCancellationPenaltyPercent),
      backupMode: form.backupMode,
      numbering: {
        serviceOrderPrefix: form.numbering.serviceOrderPrefix,
        serviceOrderNext: Number(form.numbering.serviceOrderNext),
        deliveryPrefix: form.numbering.deliveryPrefix,
        deliveryNext: Number(form.numbering.deliveryNext),
        adjustmentPrefix: form.numbering.adjustmentPrefix,
        adjustmentNext: Number(form.numbering.adjustmentNext),
        movementPrefix: form.numbering.movementPrefix,
        movementNext: Number(form.numbering.movementNext),
      },
    });
    setIsDirty(false);
  };

  return (
    <section className="panel settings-view">
      <div className="settings-kpi-grid">
        {cards.map((card) => (
          <article key={card.label} className={`settings-kpi-card ${card.tone}`}>
            <span className={`settings-kpi-icon ${card.tone}`}>
              <SettingsIcon kind={card.icon} />
            </span>
            <strong>{card.value}</strong>
            <p>{card.label}</p>
            <button type="button" className={`settings-kpi-link ${card.tone}`}>
              {card.link} {'->'}
            </button>
          </article>
        ))}
      </div>

      <div className="settings-tabs-row">
        <div className="settings-tabs">
          {settingsTabs.map((tab) => (
            <button key={tab} type="button" className={`settings-tab ${tab === 'Empresa' ? 'active' : ''}`}>
              {tab}
            </button>
          ))}
        </div>
        <button type="button" className="primary-button settings-save-button" onClick={handleSave}>
          Guardar Cambios
        </button>
      </div>

      <div className="settings-layout">
        <div className="settings-main-column">
          <article className="settings-card">
            <h3>Informacion de la Empresa</h3>
            <div className="settings-form-grid">
              <label>
                Nombre de la Empresa
                <input value={form.companyName} onChange={(event) => setField('companyName', event.target.value)} />
              </label>
              <label>
                CUIT
                <input value={form.taxId} onChange={(event) => setField('taxId', event.target.value)} />
              </label>
              <label>
                Direccion
                <input value={form.address} onChange={(event) => setField('address', event.target.value)} />
              </label>
              <label>
                Telefono
                <input value={form.phone} onChange={(event) => setField('phone', event.target.value)} />
              </label>
              <label>
                Email
                <input value={form.email} onChange={(event) => setField('email', event.target.value)} />
              </label>
              <label>
                Sitio Web
                <input value={form.website} onChange={(event) => setField('website', event.target.value)} />
              </label>

              <div className="settings-logo-zone full-width">
                <div className="settings-logo-label">Logo de la Empresa</div>
                <div className="settings-logo-row">
                  <div className="settings-logo-preview">
                    <strong>Copetin</strong>
                  </div>
                  <button type="button" className="settings-upload-button">
                    <span>Subir nuevo logo</span>
                    <small>JPG, PNG o SVG. Max 2MB</small>
                  </button>
                </div>
              </div>

              <label className="settings-currency full-width">
                Moneda Predeterminada
                <select value={form.currency} onChange={(event) => setField('currency', event.target.value)}>
                  <option value="ARS">Peso Argentino (ARS) - $</option>
                  <option value="USD">Dolar (USD) - $</option>
                  <option value="BOB">Boliviano (BOB) - Bs</option>
                </select>
              </label>
            </div>
          </article>

          <article className="settings-card">
            <h3>Categorias Operativas</h3>
            <div className="settings-numbering-wrap">
              <table className="settings-numbering-table">
                <thead>
                  <tr>
                    <th>Categoria</th>
                    <th>Items</th>
                    <th>Creada</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{categoryItemCount?.[row.name] ?? 0}</td>
                      <td>{String(row.createdAt ?? '').slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </div>

        <div className="settings-side-column">
          <article className="settings-card">
            <h3>Configuracion Regional</h3>
            <div className="settings-side-grid">
              <label>
                Zona Horaria
                <select value={form.timezone} onChange={(event) => setField('timezone', event.target.value)}>
                  <option value="America/Argentina/Buenos_Aires">(UTC-03:00) Buenos Aires</option>
                  <option value="America/La_Paz">(UTC-04:00) La Paz</option>
                </select>
              </label>
              <label>
                Formato de Fecha
                <select value={form.dateFormat} onChange={(event) => setField('dateFormat', event.target.value)}>
                  <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                  <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                </select>
              </label>
              <label>
                Formato de Hora
                <select value={form.timeFormat} onChange={(event) => setField('timeFormat', event.target.value)}>
                  <option value="24h">24 horas (14:30)</option>
                  <option value="12h">12 horas (02:30 PM)</option>
                </select>
              </label>
              <label>
                Idioma
                <select value={form.language} onChange={(event) => setField('language', event.target.value)}>
                  <option value="es">Espanol</option>
                  <option value="en">Ingles</option>
                </select>
              </label>
              <label>
                Penalidad por anulacion (%)
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={form.contractCancellationPenaltyPercent}
                  onChange={(event) => setField('contractCancellationPenaltyPercent', event.target.value)}
                />
              </label>
            </div>
          </article>

          <article className="settings-card">
            <h3>Numeracion</h3>
            <p className="settings-help">Define los prefijos y la numeracion automatica de los documentos.</p>
            <div className="settings-numbering-wrap">
              <table className="settings-numbering-table">
                <thead>
                  <tr>
                    <th>Documento</th>
                    <th>Prefijo</th>
                    <th>Proximo Numero</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Orden de Servicio</td>
                    <td><input value={form.numbering.serviceOrderPrefix} onChange={(event) => setNumbering('serviceOrderPrefix', event.target.value)} /></td>
                    <td><input value={form.numbering.serviceOrderNext} onChange={(event) => setNumbering('serviceOrderNext', event.target.value)} /></td>
                  </tr>
                  <tr>
                    <td>Entrega</td>
                    <td><input value={form.numbering.deliveryPrefix} onChange={(event) => setNumbering('deliveryPrefix', event.target.value)} /></td>
                    <td><input value={form.numbering.deliveryNext} onChange={(event) => setNumbering('deliveryNext', event.target.value)} /></td>
                  </tr>
                  <tr>
                    <td>Ajuste de Stock</td>
                    <td><input value={form.numbering.adjustmentPrefix} onChange={(event) => setNumbering('adjustmentPrefix', event.target.value)} /></td>
                    <td><input value={form.numbering.adjustmentNext} onChange={(event) => setNumbering('adjustmentNext', event.target.value)} /></td>
                  </tr>
                  <tr>
                    <td>Movimiento</td>
                    <td><input value={form.numbering.movementPrefix} onChange={(event) => setNumbering('movementPrefix', event.target.value)} /></td>
                    <td><input value={form.numbering.movementNext} onChange={(event) => setNumbering('movementNext', event.target.value)} /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

export default CategoriesSection;
