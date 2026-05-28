import { useMemo, useState } from 'react';
import {
  ROLE_OPTIONS,
  getUserRoleDefinitions,
  getUserRoleIds,
  isDeveloper,
  normalizeRoleIds,
} from '../../utils/permissions';

const roleTone = (role) => {
  const value = String(role ?? '').toLowerCase();
  if (value.includes('admin')) return 'admin';
  if (value.includes('super')) return 'supervisor';
  if (value.includes('chofer')) return 'chofer';
  if (value.includes('oper')) return 'operador';
  return 'viewer';
};

const statusTone = (status) => {
  const value = String(status ?? '').toLowerCase();
  if (value.includes('suspend')) return 'suspended';
  if (value.includes('invite')) return 'invited';
  return 'active';
};

const EMPTY_USER_FORM = {
  id: '',
  fullName: '',
  username: '',
  password: '',
  roleIds: ['ventas'],
  phone: '',
  status: 'active',
};

const initialsFromName = (name) =>
  String(name ?? '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

function UserIcon({ kind }) {
  if (kind === 'users') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="9" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.9" />
        <circle cx="16.3" cy="10.2" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.9" />
        <path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" d="M4.5 18c0-2.6 2.3-4.2 5-4.2S14.5 15.4 14.5 18" />
        <path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" d="M14 15.7c.7-.4 1.5-.6 2.4-.6 1.9 0 3.4 1 3.4 2.9" />
      </svg>
    );
  }
  if (kind === 'invite') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.9" />
        <path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" d="M4.8 18c0-2.7 2.5-4.4 5.2-4.4" />
        <path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" d="M16 10v8M12 14h8" />
      </svg>
    );
  }
  if (kind === 'shield') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" d="M12 4 19 7v5.7c0 4.1-2.8 6.8-7 8.3-4.2-1.5-7-4.2-7-8.3V7l7-3Z" />
        <path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" d="m9 12 2 2 4-4" />
      </svg>
    );
  }
  if (kind === 'lock') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="6" y="10" width="12" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.9" />
        <path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
      </svg>
    );
  }
  if (kind === 'edit') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M14.5 6.5 17.5 9.5M8.8 17.2l-2.3.3.3-2.3 7-7a2.1 2.1 0 0 1 3 3l-8 8Z" />
      </svg>
    );
  }
  if (kind === 'send') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" d="M4 12 20 4l-4.5 16-4-6-7.5-2Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="6" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="18" r="1.4" fill="currentColor" />
    </svg>
  );
}

function UsersSection({ users = [], currentUser = null, formatDateTime, onCreateUser, onUpdateUser, onRemoveUser }) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_USER_FORM);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [openActionsUserId, setOpenActionsUserId] = useState(null);

  const canManageUsers = isDeveloper(currentUser);

  const filteredRows = useMemo(() => {
    const text = String(query ?? '').trim().toLowerCase();
    return users.filter((user) => {
      const role = String(user.role ?? '');
      const roleIds = getUserRoleIds(user);
      const status = String(user.status ?? '');
      const statusMatch = statusFilter === 'all' || status === statusFilter;
      const roleMatch = roleFilter === 'all' || roleIds.includes(roleFilter);
      if (!statusMatch || !roleMatch) return false;
      if (!text) return true;
      return (
        String(user.fullName).toLowerCase().includes(text)
        || String(user.username).toLowerCase().includes(text)
        || String(role).toLowerCase().includes(text)
      );
    });
  }, [query, roleFilter, statusFilter, users]);

  const cards = useMemo(() => {
    const active = users.filter((user) => user.status === 'active').length;
    const invited = users.filter((user) => user.status === 'invited').length;
    const suspended = users.filter((user) => user.status === 'suspended').length;
    const roles = new Set(users.flatMap((user) => getUserRoleIds(user))).size;
    return [
      { tone: 'lilac', icon: 'users', value: String(active), label: 'Usuarios activos', link: 'Ver todos' },
      { tone: 'peach', icon: 'invite', value: String(invited), label: 'Usuarios pendientes', link: 'Ver pendientes' },
      { tone: 'mint', icon: 'shield', value: String(roles), label: 'Roles definidos', link: 'Gestionar roles' },
      { tone: 'rose', icon: 'lock', value: String(suspended), label: 'Usuario suspendido', link: 'Ver detalles' },
    ];
  }, [users]);

  const availableRoles = ROLE_OPTIONS;

  const openCreateUser = () => {
    setForm(EMPTY_USER_FORM);
    setFormError('');
    setIsModalOpen(true);
  };

  const openEditUser = (user) => {
    setForm({
      id: user.id,
      fullName: user.fullName ?? '',
      username: user.username ?? '',
      password: '',
      roleIds: getUserRoleIds(user),
      phone: user.phone ?? '',
      status: user.status ?? 'active',
    });
    setFormError('');
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (isSubmitting) return;
    setIsModalOpen(false);
    setFormError('');
    setForm(EMPTY_USER_FORM);
  };

  const handleToggleStatus = async (user) => {
    if (!canManageUsers) return;
    const nextStatus = user.status === 'active' ? 'suspended' : 'active';
    await onUpdateUser?.({ id: user.id, status: nextStatus });
    setOpenActionsUserId(null);
  };

  const handleRemoveUser = async (user) => {
    if (!canManageUsers || user?.id === currentUser?.id) return;
    if (!window.confirm(`Eliminar el usuario de ${user.fullName}?`)) return;
    await onRemoveUser?.({ id: user.id });
    setOpenActionsUserId(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canManageUsers) return;
    setFormError('');

    if (!form.fullName.trim()) {
      setFormError('Ingresa el nombre del usuario.');
      return;
    }
    if (!form.username.trim()) {
      setFormError('Ingresa el usuario de acceso.');
      return;
    }
    if (!form.id && form.password.trim().length < 4) {
      setFormError('La contrasena debe tener al menos 4 caracteres.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        id: form.id || undefined,
        fullName: form.fullName.trim(),
        username: form.username.trim(),
        roleIds: normalizeRoleIds(form.roleIds),
        phone: form.phone.trim(),
        status: form.status,
      };
      if (form.password.trim()) payload.password = form.password.trim();

      if (form.id) {
        await onUpdateUser?.(payload);
      } else {
        await onCreateUser?.(payload);
      }
      closeModal();
    } catch (requestError) {
      setFormError(requestError.message || 'No se pudo guardar el usuario.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderUserModal = () => {
    if (!isModalOpen) return null;
    const selectedRoleIds = normalizeRoleIds(form.roleIds);
    const selectedRoles = selectedRoleIds.map((roleId) => ROLE_OPTIONS.find((option) => option.id === roleId)).filter(Boolean);
    const toggleRole = (roleId) => {
      setForm((current) => {
        const currentRoleIds = normalizeRoleIds(current.roleIds);
        const nextRoleIds = currentRoleIds.includes(roleId)
          ? currentRoleIds.filter((entry) => entry !== roleId)
          : [...currentRoleIds, roleId];
        return {
          ...current,
          roleIds: nextRoleIds.length > 0 ? nextRoleIds : [roleId],
        };
      });
    };
    return (
      <div className="orders-modal-backdrop" onClick={closeModal}>
        <form className="orders-modal user-editor-modal" onSubmit={handleSubmit} onClick={(event) => event.stopPropagation()}>
          <header className="orders-modal-head">
            <div>
              <h3>{form.id ? 'Editar usuario' : 'Nuevo usuario'}</h3>
              <p>Define su usuario, contrasena y las areas operativas permitidas.</p>
            </div>
            <button type="button" className="orders-modal-close" onClick={closeModal}>x</button>
          </header>

          <div className="user-editor-grid">
            <label>
              Nombre completo
              <input value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} />
            </label>
            <label>
              Usuario
              <input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} placeholder="ej: ventas1" />
            </label>
            <label>
              Contrasena
              <input
                type="password"
                value={form.password}
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                placeholder={form.id ? 'Dejar vacia para mantener' : 'Minimo 4 caracteres'}
              />
            </label>
            <label>
              Telefono
              <input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
            </label>
            <fieldset className="user-access-picker">
              <legend>Accesos operativos</legend>
              <div className="user-access-options">
                {ROLE_OPTIONS.map((option) => (
                  <label key={option.id} className="user-access-option">
                    <input
                      type="checkbox"
                      checked={selectedRoleIds.includes(option.id)}
                      onChange={() => toggleRole(option.id)}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label>
              Estado
              <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
                <option value="active">Activo</option>
                <option value="suspended">Suspendido</option>
              </select>
            </label>
            <article className="user-role-preview">
              <strong>{selectedRoles.map((role) => role.label).join(' + ')}</strong>
              <span>Este usuario podra entrar a las vistas combinadas de las areas seleccionadas.</span>
            </article>
            {formError ? <p className="status error user-editor-error">{formError}</p> : null}
          </div>

          <footer className="orders-modal-foot">
            <button type="button" className="ghost-button" onClick={closeModal} disabled={isSubmitting}>Cancelar</button>
            <button type="submit" className="primary-button" disabled={isSubmitting}>
              {isSubmitting ? 'Guardando...' : 'Guardar usuario'}
            </button>
          </footer>
        </form>
      </div>
    );
  };

  return (
    <section className="panel users-view">
      <header className="users-header">
        <div>
          <h2>Usuarios</h2>
          <p>Gestiona los usuarios y permisos del sistema.</p>
        </div>
        <button type="button" className="primary-button users-new-button" onClick={openCreateUser} disabled={!canManageUsers}>
          + Nuevo Usuario
        </button>
      </header>

      <div className="users-kpi-grid">
        {cards.map((card) => (
          <article key={card.label} className={`users-kpi-card ${card.tone}`}>
            <span className={`users-kpi-icon ${card.tone}`}>
              <UserIcon kind={card.icon} />
            </span>
            <strong>{card.value}</strong>
            <p>{card.label}</p>
            <button type="button" className={`users-kpi-link ${card.tone}`}>
              {card.link} {'->'}
            </button>
          </article>
        ))}
      </div>

      <article className="users-table-card">
        <header className="users-toolbar">
          <label className="users-search">
            <input
              type="search"
              placeholder="Buscar por nombre, usuario o rol..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button type="button" className="ghost-button users-filter-button">Filtros</button>
          <button
            type="button"
            className="link-button users-clear-button"
            onClick={() => {
              setQuery('');
              setStatusFilter('all');
              setRoleFilter('all');
            }}
          >
            Limpiar filtros
          </button>
        </header>

        <div className="users-filter-row">
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">Estado: Todos</option>
            <option value="active">Activo</option>
            <option value="suspended">Suspendido</option>
            <option value="invited">Invitacion enviada</option>
          </select>
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="all">Rol: Todos</option>
            {availableRoles.map((role) => (
              <option key={role.id} value={role.id}>{role.label}</option>
            ))}
          </select>
          <select defaultValue="all">
            <option value="all">Ultimo acceso: Todos</option>
          </select>
        </div>

        <div className="users-table-wrap">
          <table className="users-table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Acceso</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Ultimo Acceso</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, index) => (
                <tr key={row.id}>
                  <td>
                    <div className="users-user-cell">
                      <span className={`users-avatar ${['violet', 'blue', 'sand', 'peach', 'orange', 'purple', 'green', 'mint'][index % 8]}`}>
                        {initialsFromName(row.fullName)}
                      </span>
                      <div className="users-user-meta">
                        <strong>{row.fullName}</strong>
                        {row.isCurrentUser ? <span className="users-you-chip">Tu</span> : null}
                      </div>
                    </div>
                  </td>
                  <td>{row.username}</td>
                  <td>
                    <div className="users-role-list">
                      {getUserRoleDefinitions(row).map((role) => (
                        <span key={role.label} className={`users-role-chip ${roleTone(role.label)}`}>{role.label}</span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <span className={`users-status-chip ${statusTone(row.status)}`}>
                      {row.status === 'invited' ? 'Invitacion enviada' : row.status === 'suspended' ? 'Suspendido' : 'Activo'}
                    </span>
                  </td>
                  <td>{row.lastAccessAt ? formatDateTime(row.lastAccessAt) : row.invitedAt ? `Invitado ${formatDateTime(row.invitedAt)}` : '-'}</td>
                  <td>
                    <div className="users-actions-cell">
                      <div className="users-actions-menu-wrap">
                        <button
                          type="button"
                          className="users-icon-button"
                          aria-label={`Acciones de ${row.fullName}`}
                          aria-expanded={openActionsUserId === row.id}
                          onClick={() => setOpenActionsUserId((current) => (current === row.id ? null : row.id))}
                          disabled={!canManageUsers}
                        >
                          <UserIcon kind="dots" />
                        </button>
                        {openActionsUserId === row.id ? (
                          <div className="users-actions-menu">
                            <button type="button" onClick={() => { setOpenActionsUserId(null); openEditUser(row); }}>
                              Editar usuario
                            </button>
                            <button type="button" onClick={() => handleToggleStatus(row)}>
                              {row.status === 'active' ? 'Suspender usuario' : 'Activar usuario'}
                            </button>
                            <button type="button" className="danger" onClick={() => handleRemoveUser(row)} disabled={row.id === currentUser?.id}>
                              Eliminar usuario
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <p className="status">No hay usuarios con esos filtros.</p>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <footer className="users-footer">
          <span>Mostrando {filteredRows.length} de {users.length} usuarios</span>
          <div className="users-pagination">
            <button type="button">{'<'}</button>
            <button type="button" className="active">1</button>
            <button type="button">{'>'}</button>
            <button type="button" className="users-page-size">10 por pagina</button>
          </div>
        </footer>
      </article>
      {renderUserModal()}
    </section>
  );
}

export default UsersSection;
