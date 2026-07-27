import { useEffect, useMemo, useState } from 'react';

const UPDATE_NOTICE_STORAGE_KEY = 'copetin-update-notice-state-v1';

const readNoticeState = () => {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(UPDATE_NOTICE_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
};

const writeNoticeState = (state) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(UPDATE_NOTICE_STORAGE_KEY, JSON.stringify(state));
};

const hasBlockingWorkOpen = () => {
  if (typeof document === 'undefined') return false;
  const blockingSelectors = [
    '[role="dialog"]',
    '.reset-modal',
    '.orders-contract-modal',
    '.orders-wizard-modal',
    '.inventory-product-modal',
    '.inventory-combo-modal',
    '.system-reset-panel',
  ];
  if (blockingSelectors.some((selector) => document.querySelector(selector))) return true;
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName?.toLowerCase();
  if (!['input', 'textarea', 'select'].includes(tag)) return false;
  return !['search', 'date', 'button', 'checkbox', 'radio'].includes(String(active.type ?? '').toLowerCase());
};

function UpdateMascot() {
  return (
    <span className="update-mascot" aria-hidden="true">
      <span className="update-mascot-shadow" />
      <span className="update-mascot-cap" />
      <span className="update-mascot-hair" />
      <span className="update-mascot-face">
        <i />
        <i />
        <em />
        <em />
        <b />
      </span>
      <span className="update-mascot-body">EC</span>
      <span className="update-mascot-arm update-mascot-arm-left" />
      <span className="update-mascot-arm update-mascot-arm-right" />
      <span className="update-mascot-hand" />
    </span>
  );
}

function GlobalUpdateNotice({ notice }) {
  const [localState, setLocalState] = useState(readNoticeState);
  const [reloadBlocked, setReloadBlocked] = useState(false);
  const version = String(notice?.version ?? '').trim();
  const message = String(notice?.message ?? 'Hay nuevas mejoras. Te recomiendo actualizar.').trim();

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const timeoutId = window.setTimeout(() => {
      setReloadBlocked(false);
      setLocalState(readNoticeState());
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [version]);

  const displayMode = useMemo(() => {
    if (!version || notice?.status !== 'active') return 'hidden';
    const stored = localState?.[version];
    if (stored === 'updated') return 'hidden';
    if (stored === 'minimized') return 'minimized';
    return 'full';
  }, [localState, notice?.status, version]);

  const remember = (status) => {
    const next = { ...readNoticeState(), [version]: status };
    writeNoticeState(next);
    setLocalState(next);
  };

  const handleUpdateNow = () => {
    if (hasBlockingWorkOpen()) {
      setReloadBlocked(true);
      return;
    }
    remember('updated');
    window.location.reload();
  };

  const handleLater = () => {
    remember('minimized');
  };

  if (displayMode === 'hidden') return null;

  if (displayMode === 'minimized') {
    return (
      <button type="button" className="update-notice-mini" onClick={() => remember('open')} title={message}>
        <UpdateMascot />
        <span>Mejoras listas</span>
      </button>
    );
  }

  return (
    <aside className="update-notice-card" aria-live="polite">
      <UpdateMascot />
      <div className="update-notice-sign">
        <span>Hay nuevas mejoras</span>
        <strong>{message}</strong>
        {reloadBlocked ? (
          <p>Guarda o cierra el formulario abierto antes de actualizar.</p>
        ) : null}
        <div>
          <button type="button" onClick={handleUpdateNow}>Actualizar ahora</button>
          <button type="button" onClick={handleLater}>Más tarde</button>
        </div>
      </div>
    </aside>
  );
}

export default GlobalUpdateNotice;
