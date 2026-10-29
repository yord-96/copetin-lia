import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function GuaranteeRefundWarningModal({ message, onClose }) {
  const button = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const root = document.getElementById('root');
    const previousInert = root?.inert;
    if (root) root.inert = true;
    button.current?.focus();
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onClose(); }
      if (event.key === 'Tab') { event.preventDefault(); event.stopImmediatePropagation(); button.current?.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (root) root.inert = previousInert;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onClose]);
  return createPortal(
    <div className="orders-modal-backdrop guarantee-refund-warning-backdrop" onClick={onClose}>
      <div className="orders-confirm-modal guarantee-refund-warning-modal" role="alertdialog" aria-modal="true"
        aria-labelledby="guarantee-refund-warning-title" aria-describedby="guarantee-refund-warning-message" onClick={event => event.stopPropagation()}>
        <header><span className="orders-confirm-icon" aria-hidden="true">!</span><div><h3 id="guarantee-refund-warning-title">No se puede devolver la garantía</h3></div></header>
        <p id="guarantee-refund-warning-message">{message}</p>
        <footer><button ref={button} type="button" className="primary-button" onClick={onClose}>Entendido</button></footer>
      </div>
    </div>, document.body,
  );
}
