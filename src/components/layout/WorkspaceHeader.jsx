function WorkspaceHeader({ subtitleText, onRefresh }) {
  return (
    <header className="app-header app-header-modern">
      <div>
        <p className="app-header-kicker">Dashboard</p>
        <h1>¡Buenos días, Maria!</h1>
        <p>{subtitleText || 'Aquí tienes un resumen de tu operación hoy.'}</p>
      </div>
      <button type="button" className="ghost-button header-refresh-button" onClick={onRefresh}>
        Actualizar
      </button>
    </header>
  );
}

export default WorkspaceHeader;

