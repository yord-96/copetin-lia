import { useMemo, useState } from 'react';

const LEVEL_LABELS = {
  safe: 'Limpieza rapida',
  validation: 'Limpieza de pruebas',
  critical: 'Reset critico',
};

const RISK_LABELS = {
  bajo: 'Bajo',
  medio: 'Medio',
  alto: 'Alto',
  critico: 'Critico',
};

function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result ?? '{}')));
      } catch {
        reject(new Error('El archivo seleccionado no es un JSON valido.'));
      }
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo seleccionado.'));
    reader.readAsText(file);
  });
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function SystemResetPanel({ onClose, onVerify, onAnalyze, onExecute, onExportDatabase, onImportDatabase }) {
  const [code, setCode] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [modules, setModules] = useState([]);
  const [selectedModules, setSelectedModules] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [result, setResult] = useState(null);
  const [dbTransferResult, setDbTransferResult] = useState(null);
  const [importFile, setImportFile] = useState(null);
  const [importConfirmation, setImportConfirmation] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [observations, setObservations] = useState('');
  const [error, setError] = useState('');
  const [loadingAction, setLoadingAction] = useState('');

  const groupedModules = useMemo(() => {
    const groups = { safe: [], validation: [], critical: [] };
    modules.forEach((module) => {
      const level = groups[module.level] ? module.level : 'validation';
      groups[level].push(module);
    });
    return Object.fromEntries(Object.entries(groups).filter(([, rows]) => rows.length > 0));
  }, [modules]);

  const selectedSet = useMemo(() => new Set(selectedModules), [selectedModules]);
  const requiresResetWord = selectedSet.has('factory_reset');

  const toggleModule = (moduleId) => {
    setSelectedModules((current) =>
      current.includes(moduleId)
        ? current.filter((entry) => entry !== moduleId)
        : [...current, moduleId],
    );
    setAnalysis(null);
    setResult(null);
    setConfirmation('');
  };

  const handleVerify = async (event) => {
    event.preventDefault();
    setError('');
    setLoadingAction('verify');
    try {
      const response = await onVerify?.({ code });
      const availableModules = response?.modules ?? [];
      setModules(availableModules);
      setSelectedModules([]);
      setIsUnlocked(true);
      setDbTransferResult(null);
    } catch (requestError) {
      setError(requestError.message || 'No se pudo validar la contrasena.');
    } finally {
      setLoadingAction('');
    }
  };

  const handleAnalyze = async () => {
    setError('');
    setResult(null);
    setConfirmation('');
    setLoadingAction('analyze');
    try {
      const response = await onAnalyze?.({ code, modules: selectedModules });
      setAnalysis(response);
    } catch (requestError) {
      setError(requestError.message || 'No se pudo analizar el impacto.');
    } finally {
      setLoadingAction('');
    }
  };

  const handleExecute = async () => {
    setError('');
    setLoadingAction('execute');
    try {
      const response = await onExecute?.({
        code,
        modules: selectedModules,
        confirmation,
        observations,
      });
      setResult(response);
      setAnalysis(response?.analysis ?? null);
      setConfirmation('');
    } catch (requestError) {
      setError(requestError.message || 'No se pudo ejecutar el reset.');
    } finally {
      setLoadingAction('');
    }
  };

  const handleExportDatabase = async () => {
    setError('');
    setDbTransferResult(null);
    setLoadingAction('export');
    try {
      const response = await onExportDatabase?.({ code, observations });
      const exportedAt = String(response?.exportedAt ?? new Date().toISOString()).replace(/[:.]/g, '-');
      downloadJson(response, `copetin-base-datos-${exportedAt}.json`);
      setDbTransferResult({
        tone: 'success',
        title: 'Base descargada',
        message: `Registros incluidos: ${response?.summary?.total ?? 0}. Usa este archivo para importarlo en tu sistema local.`,
      });
    } catch (requestError) {
      setError(requestError.message || 'No se pudo descargar la base de datos.');
    } finally {
      setLoadingAction('');
    }
  };

  const handleImportDatabase = async () => {
    setError('');
    setDbTransferResult(null);
    if (!importFile) {
      setError('Selecciona primero un archivo JSON de base de datos.');
      return;
    }
    setLoadingAction('import');
    try {
      const backup = await readJsonFile(importFile);
      const response = await onImportDatabase?.({
        code,
        backup,
        confirmation: importConfirmation,
        observations,
      });
      setDbTransferResult({
        tone: 'success',
        title: 'Base importada',
        message: `${response?.message ?? 'Importacion completa.'} Registros activos: ${response?.summary?.total ?? 0}.`,
      });
      setImportConfirmation('');
      setImportFile(null);
    } catch (requestError) {
      setError(requestError.message || 'No se pudo importar la base de datos.');
    } finally {
      setLoadingAction('');
    }
  };

  const canExecute = analysis?.canExecute && (
    requiresResetWord
      ? confirmation.trim().toUpperCase() === 'RESET'
      : ['CONFIRMAR', 'RESET'].includes(confirmation.trim().toUpperCase())
  );
  const canImportDatabase = importFile && importConfirmation.trim().toUpperCase() === 'IMPORTAR';

  return (
    <div className="reset-modal-backdrop" onClick={onClose}>
      <section className="reset-modal system-reset-panel" onClick={(event) => event.stopPropagation()}>
        <header className="system-reset-head">
          <div>
            <span>Herramienta developer</span>
            <h3>Panel de Limpieza</h3>
            <p>Limpia datos de prueba sin borrar inventario, clientes, personal ni usuarios.</p>
          </div>
          <button type="button" className="orders-modal-close" onClick={onClose}>x</button>
        </header>

        {!isUnlocked ? (
          <form className="system-reset-lock" onSubmit={handleVerify}>
            <div className="system-reset-danger">
              <strong>Acceso restringido</strong>
              <p>Solo el rol developer puede ver y ejecutar esta herramienta. La contrasena habilita el panel, no ejecuta borrados.</p>
            </div>
            <label>
              Contrasena de seguridad
              <input
                type="password"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="****"
                autoFocus
                required
              />
            </label>
            {error ? <p className="status error reset-modal-error">{error}</p> : null}
            <div className="reset-modal-actions">
              <button type="button" className="ghost-button" onClick={onClose} disabled={Boolean(loadingAction)}>
                Cancelar
              </button>
              <button type="submit" className="danger-button" disabled={loadingAction === 'verify'}>
                {loadingAction === 'verify' ? 'Validando...' : 'Entrar al panel'}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="system-reset-danger">
              <strong>Zona critica</strong>
              <p>El backend volvera a validar rol, contrasena y confirmacion antes de borrar. Esta limpieza conserva catalogo de inventario, clientes, personal, usuarios y auditoria.</p>
            </div>

            <section className="system-database-panel">
              <div className="system-database-copy">
                <span>Base de datos developer</span>
                <strong>Exportar e importar respaldo completo</strong>
                <p>Descarga una copia antes de limpiar. La importacion reemplaza la base activa y conserva el developer actual para no perder acceso.</p>
              </div>
              <div className="system-database-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={handleExportDatabase}
                  disabled={loadingAction === 'export' || loadingAction === 'import'}
                >
                  {loadingAction === 'export' ? 'Descargando...' : 'Descargar base'}
                </button>
                <label className="system-database-file">
                  <input
                    type="file"
                    accept="application/json,.json"
                    onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
                    disabled={loadingAction === 'import'}
                  />
                  <span>{importFile?.name ?? 'Seleccionar JSON'}</span>
                </label>
                <input
                  value={importConfirmation}
                  onChange={(event) => setImportConfirmation(event.target.value)}
                  placeholder="Escribe IMPORTAR"
                  disabled={loadingAction === 'import'}
                />
                <button
                  type="button"
                  className="danger-button"
                  onClick={handleImportDatabase}
                  disabled={!canImportDatabase || loadingAction === 'import'}
                >
                  {loadingAction === 'import' ? 'Importando...' : 'Importar base'}
                </button>
              </div>
              {dbTransferResult ? (
                <div className={`system-database-result ${dbTransferResult.tone}`}>
                  <strong>{dbTransferResult.title}</strong>
                  <p>{dbTransferResult.message}</p>
                </div>
              ) : null}
            </section>

            <div className="system-reset-layout">
              <div className="system-reset-modules">
                {Object.entries(groupedModules).map(([level, rows]) => (
                  <section key={level} className="system-reset-group">
                    <h4>{LEVEL_LABELS[level] ?? level}</h4>
                    <div className="system-reset-module-grid">
                      {rows.map((module) => (
                        <label key={module.id} className={`system-reset-card risk-${module.risk}`}>
                          <input
                            type="checkbox"
                            checked={selectedSet.has(module.id)}
                            onChange={() => toggleModule(module.id)}
                          />
                          <span>
                            <strong>{module.name}</strong>
                            <small>{RISK_LABELS[module.risk] ?? module.risk}</small>
                          </span>
                          <p>{module.description}</p>
                          {module.warnings?.[0] ? <em>{module.warnings[0]}</em> : null}
                        </label>
                      ))}
                    </div>
                  </section>
                ))}
              </div>

              <aside className="system-reset-impact">
                <h4>Impacto</h4>
                <div className="system-reset-summary">
                  <span>Total</span>
                  <strong>{analysis?.summary?.total ?? 0}</strong>
                  <span>Puede borrar</span>
                  <strong>{analysis?.summary?.deletable ?? 0}</strong>
                  <span>Bloqueado</span>
                  <strong>{analysis?.summary?.blocked ?? 0}</strong>
                </div>
                {analysis?.modules?.length ? (
                  <div className="system-reset-impact-list">
                    {analysis.modules.map((module) => (
                      <article key={module.id}>
                        <header>
                          <strong>{module.name}</strong>
                          <span>{module.deleteCount} / {module.total}</span>
                        </header>
                        {module.dependencies.slice(0, 4).map((dependency) => (
                          <p key={dependency}>{dependency}</p>
                        ))}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="system-reset-muted">Selecciona la limpieza y analiza el impacto antes de ejecutar.</p>
                )}
              </aside>
            </div>

            <div className="system-reset-confirm">
              <label>
                Observaciones de auditoria
                <textarea
                  value={observations}
                  onChange={(event) => setObservations(event.target.value)}
                  placeholder="Motivo o alcance de la limpieza..."
                  rows={2}
                />
              </label>
              <label>
                Confirmacion final
                <input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder={requiresResetWord ? 'Escribe RESET' : 'Escribe CONFIRMAR o RESET'}
                />
              </label>
            </div>

            {result ? (
              <div className="system-reset-result">
                <strong>Limpieza ejecutada</strong>
                <p>Registros eliminados: {result.deletedTotal ?? 0}. Auditoria: {result.log?.id ?? 'registrada'}.</p>
              </div>
            ) : null}
            {error ? <p className="status error reset-modal-error">{error}</p> : null}

            <div className="reset-modal-actions">
              <button type="button" className="ghost-button" onClick={onClose} disabled={Boolean(loadingAction)}>
                Cerrar
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={handleAnalyze}
                disabled={loadingAction === 'analyze' || selectedModules.length === 0}
              >
                {loadingAction === 'analyze' ? 'Analizando...' : 'Analizar impacto'}
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={handleExecute}
                disabled={!canExecute || loadingAction === 'execute'}
              >
                {loadingAction === 'execute' ? 'Ejecutando...' : 'Ejecutar limpieza'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default SystemResetPanel;
