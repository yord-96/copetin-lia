import { useEffect, useMemo, useRef, useState } from 'react';
import './public-quote-mobile.css';
import {
  ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, Download,
  Minus, PackageSearch, Phone, Plus, Search, ShoppingBag, Sparkles, Trash2, X,
} from 'lucide-react';

const money = (value) => `Bs ${Number(value ?? 0).toLocaleString('es-BO', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

const todayKey = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const normalizeText = (value) => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();


const PUBLIC_API_BASE = '/__copetin_db/public';

const readJsonResponse = async (response, fallbackMessage) => {
  const contentType = String(response.headers.get('content-type') ?? '').toLowerCase();
  const text = await response.text();
  if (!contentType.includes('application/json')) {
    throw new Error(fallbackMessage);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(fallbackMessage);
  }
};

const whatsappNumber = (phone) => {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length === 8 ? `591${digits}` : digits;
};

function ProductImage({ item }) {
  const [failed, setFailed] = useState(false);
  if (!item.imageUrl || failed) {
    return <div className="public-quote-product-placeholder"><PackageSearch size={30} /><span>El Copetín</span></div>;
  }
  return <img src={item.imageUrl} alt={item.name} loading="lazy" onError={() => setFailed(true)} />;
}

export default function PublicQuoteBuilder() {
  const [step, setStep] = useState(1);
  const [catalog, setCatalog] = useState({ products: [], areas: [], categories: [], contactPhones: [] });
  const [form, setForm] = useState({
    customerName: '', customerPhone: '', eventDate: '', eventTime: '12:00',
    eventType: 'Social', address: '', observations: '',
  });
  const [availability, setAvailability] = useState(new Map());
  const [cart, setCart] = useState({});
  const [query, setQuery] = useState('');
  const [area, setArea] = useState('all');
  const [category, setCategory] = useState('all');
  const [visibleCount, setVisibleCount] = useState(90);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);
  const cartRef = useRef(null);
  const errorRef = useRef(null);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [step]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  useEffect(() => {
    if (!cartOpen) return undefined;
    const mobile = window.matchMedia('(max-width: 760px)');
    if (!mobile.matches) return undefined;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cartRef.current?.querySelector('button')?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setCartOpen(false);
      if (event.key !== 'Tab') return;
      const controls = [...cartRef.current.querySelectorAll('button:not(:disabled), input, a[href]')];
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    };
    const onResize = () => { if (!mobile.matches) setCartOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    mobile.addEventListener('change', onResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      mobile.removeEventListener('change', onResize);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [cartOpen]);

  useEffect(() => {
    let active = true;
    fetch(`${PUBLIC_API_BASE}/catalog`, { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const payload = await readJsonResponse(response, 'No se pudo cargar el catálogo público.');
        if (!response.ok) throw new Error(payload.error || 'No se pudo cargar el catálogo.');
        const products = Array.isArray(payload.products) ? payload.products.filter((item) => item.kind !== 'combo') : [];
        if (active) setCatalog({
          products,
          areas: Array.isArray(payload.areas) ? payload.areas.filter((entry) => entry.id !== 'combos') : [],
          categories: [...new Set(products.map((item) => item.category).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'es')),
          contactPhones: Array.isArray(payload.contactPhones) ? payload.contactPhones : [],
        });
      })
      .catch((loadError) => active && setError(loadError.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!form.eventDate) {
      setAvailability(new Map());
      return undefined;
    }
    const controller = new AbortController();
    setChecking(true);
    setError('');
    fetch(`${PUBLIC_API_BASE}/availability?date=${encodeURIComponent(form.eventDate)}&time=${encodeURIComponent(form.eventTime)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        const payload = await readJsonResponse(response, 'No se pudo consultar la disponibilidad del catálogo.');
        if (!response.ok) throw new Error(payload.error || 'No se pudo consultar la disponibilidad.');
        setAvailability(new Map((payload.items ?? []).map((entry) => [String(entry.itemId), entry])));
        if (Array.isArray(payload.contactPhones)) {
          setCatalog((current) => ({ ...current, contactPhones: payload.contactPhones }));
        }
      })
      .catch((loadError) => {
        if (loadError.name !== 'AbortError') setError(loadError.message);
      })
      .finally(() => setChecking(false));
    return () => controller.abort();
  }, [form.eventDate, form.eventTime]);

  const cartLines = useMemo(() => catalog.products
    .filter((item) => Number(cart[item.id] ?? 0) > 0)
    .map((item) => ({ ...item, quantity: Number(cart[item.id]) })), [cart, catalog.products]);
  const total = useMemo(() => cartLines.reduce(
    (sum, item) => sum + item.quantity * Number(item.rentalPriceBs ?? 0), 0,
  ), [cartLines]);
  const filtered = useMemo(() => {
    const tokens = normalizeText(query).split(/\s+/).filter(Boolean);
    return catalog.products.filter((item) => {
      if (area !== 'all' && item.area !== area) return false;
      if (category !== 'all' && item.category !== category) return false;
      return tokens.every((token) => (item.searchText || normalizeText([
        item.name, item.category, item.color, item.material, item.sku,
      ].join(' '))).includes(token));
    });
  }, [area, catalog.products, category, query]);

  useEffect(() => setVisibleCount(90), [area, category, query]);
  const visibleProducts = filtered.slice(0, visibleCount);

  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const quantityFor = (id) => Number(cart[id] ?? 0);
  const availableFor = (id) => Math.max(0, Number(availability.get(String(id))?.availableConfirmed ?? 0));
  const changeQuantity = (item, nextValue) => {
    if (!form.eventDate) {
      setError('Primero selecciona la fecha de tu evento para conocer la disponibilidad real.');
      setStep(1);
      return;
    }
    const next = Math.max(0, Math.min(availableFor(item.id), Math.trunc(Number(nextValue) || 0)));
    setCart((current) => ({ ...current, [item.id]: next }));
  };

  const continueFromDetails = () => {
    setError('');
    if (form.customerName.trim().length < 3) return setError('Escribe tu nombre completo.');
    if (String(form.customerPhone).replace(/\D/g, '').length < 8) return setError('Escribe un número de celular válido.');
    if (!form.eventDate || form.eventDate < todayKey()) return setError('Selecciona una fecha válida para tu evento.');
    setStep(2);
  };

  const submitQuote = async () => {
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`${PUBLIC_API_BASE}/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          ...form,
          items: cartLines.map((item) => ({ itemId: item.id, quantity: item.quantity })),
        }),
      });
      const payload = await readJsonResponse(response, 'No se pudo registrar la cotización en este momento.');
      if (!response.ok) throw new Error(payload.error || 'No se pudo registrar la cotización.');
      setResult(payload);
      setStep(4);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  };

  const phones = result?.contactPhones?.length ? result.contactPhones : catalog.contactPhones;

  return (
    <main className="public-quote-page" data-step={step}>
      <header className="public-quote-topbar">
        <a href="/catalogo" className="public-quote-back"><ArrowLeft size={18} /> Volver al catálogo</a>
        <div className="public-quote-brand"><span>EL COPETÍN</span><small>Cotización en línea</small></div>
        <div className="public-quote-contact-mini"><Phone size={15} /> {phones[0] || '67402818'}</div>
      </header>

      <section className="public-quote-hero">
        <div>
          <span className="public-quote-eyebrow"><Sparkles size={15} /> Cotiza sin esperar</span>
          <h1>Arma tu evento.<br /><em>Nosotros lo hacemos posible.</em></h1>
          <p>Selecciona la fecha, descubre la disponibilidad y prepara una solicitud con productos reales de El Copetín.</p>
        </div>
        <div className="public-quote-hero-trust">
          <strong>Precios transparentes</strong><span>Disponibilidad por fecha</span>
          <span>PDF listo para descargar</span><span>Atención personal después de enviar</span>
        </div>
      </section>

      <nav className="public-quote-steps" aria-label="Pasos de la cotización">
        {[[1, 'Tu evento'], [2, 'Elige productos'], [3, 'Revisa y envía'], [4, 'Cotización lista']].map(([number, label]) => (
          <div key={number} aria-current={step === number ? 'step' : undefined} className={`${step === number ? 'is-active' : ''} ${step > number ? 'is-done' : ''}`}>
            <span>{step > number ? <Check size={16} /> : number}</span><strong>{label}</strong><small>{['Evento', 'Productos', 'Revisión', 'Lista'][number - 1]}</small>
          </div>
        ))}
      </nav>

      {error ? <div className="public-quote-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</div> : null}

      {step === 1 ? (
        <section className="public-quote-panel public-quote-details">
          <div className="public-quote-section-heading"><span>01</span><div><h2>Cuéntanos sobre tu evento</h2><p>Con estos datos calculamos la ocupación y podremos contactarte.</p></div></div>
          <div className="public-quote-form-grid">
            <label className="wide"><span>Nombre completo *</span><input value={form.customerName} onChange={(event) => setField('customerName', event.target.value)} placeholder="¿A nombre de quién cotizamos?" autoComplete="name" /></label>
            <label><span>Celular / WhatsApp *</span><input value={form.customerPhone} onChange={(event) => setField('customerPhone', event.target.value)} placeholder="Ej. 67402818" inputMode="tel" autoComplete="tel" /></label>
            <label><span>Tipo de evento</span><select value={form.eventType} onChange={(event) => setField('eventType', event.target.value)}><option>Social</option><option>Boda</option><option>Cumpleaños</option><option>Corporativo</option><option>Graduación</option><option>Otro</option></select></label>
            <label className="public-quote-date-field"><span>Fecha del evento *</span><input type="date" min={todayKey()} value={form.eventDate} onChange={(event) => setField('eventDate', event.target.value)} /></label>
            <label className="public-quote-time-field"><span>Hora aproximada</span><input type="time" value={form.eventTime} onChange={(event) => setField('eventTime', event.target.value)} /></label>
            <label className="wide"><span>Lugar o zona del evento</span><input value={form.address} onChange={(event) => setField('address', event.target.value)} placeholder="Salón, dirección o zona (puedes confirmarla después)" /></label>
          </div>
          <div className="public-quote-date-note"><CalendarDays size={22} /><div><strong>{checking ? 'Calculando ocupación…' : form.eventDate ? 'Fecha lista para cotizar' : 'La fecha hace la diferencia'}</strong><span>Las cantidades disponibles se calculan según las reservas confirmadas para ese día. Otras cotizaciones se muestran como solicitudes y no bloquean inventario.</span></div></div>
          <div className="public-quote-actions"><a href="/catalogo">Cancelar</a><button type="button" onClick={continueFromDetails}>Buscar productos <ArrowRight size={18} /></button></div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="public-quote-shop-layout">
          <div className="public-quote-panel public-quote-products">
            <div className="public-quote-section-heading compact"><span>02</span><div><h2>Elige lo que necesitas</h2><p>Disponibilidad calculada para {form.eventDate}.</p></div></div>
            <div className="public-quote-filters">
              <label><Search size={18} /><input type="search" aria-label="Buscar productos" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar productos…" /></label>
              <select aria-label="Área" value={area} onChange={(event) => setArea(event.target.value)}><option value="all">Todas las áreas</option>{catalog.areas.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select>
              <select aria-label="Categoría" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">Categorías</option>{catalog.categories.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select>
            </div>
            {loading ? <div className="public-quote-empty" role="status">Cargando catálogo…</div> : !filtered.length ? <div className="public-quote-empty" role="status">No encontramos productos con esos filtros.</div> : (
              <div className="public-quote-product-grid">
                {visibleProducts.map((item) => {
                  const available = availableFor(item.id);
                  const requested = Number(availability.get(String(item.id))?.requestedInQuotes ?? 0);
                  const quantity = quantityFor(item.id);
                  return (
                    <article key={item.id} className={quantity ? 'is-selected' : ''}>
                      <div className="public-quote-product-image"><ProductImage item={item} />{quantity ? <span><Check size={13} /> Elegido</span> : null}</div>
                      <div className="public-quote-product-body"><small>{item.category}</small><h3>{item.name}</h3>
                        <div className="public-quote-stock"><strong>{available.toLocaleString('es-BO')} disponibles</strong>{requested > 0 ? <span>{requested.toLocaleString('es-BO')} solicitados en cotizaciones</span> : <span>Sin otras solicitudes</span>}</div>
                        <div className="public-quote-product-footer"><strong>{money(item.rentalPriceBs)} <small>/ u.</small></strong>
                          {quantity ? <div className="public-quote-quantity"><button type="button" aria-label={`Reducir ${item.name}`} onClick={() => changeQuantity(item, quantity - 1)}><Minus size={15} /></button><input aria-label={`Cantidad de ${item.name}`} type="number" inputMode="numeric" min="0" max={available} value={quantity} onChange={(event) => changeQuantity(item, event.target.value)} /><button type="button" aria-label={`Aumentar ${item.name}`} onClick={() => changeQuantity(item, quantity + 1)} disabled={quantity >= available}><Plus size={15} /></button></div> : <button type="button" aria-label={`Agregar ${item.name}`} onClick={() => changeQuantity(item, 1)} disabled={!available}>Agregar</button>}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            {visibleCount < filtered.length ? <button type="button" className="public-quote-load-more" onClick={() => setVisibleCount((current) => current + 90)}>Ver más productos ({filtered.length - visibleCount})</button> : null}
          </div>
          {cartOpen ? <button className="public-quote-cart-backdrop" type="button" tabIndex={-1} aria-label="Cerrar selección" onClick={() => setCartOpen(false)} /> : null}
          <aside id="quote-selection" ref={cartRef} className={`public-quote-cart ${cartOpen ? 'is-open' : ''}`} role={cartOpen ? 'dialog' : undefined} aria-modal={cartOpen ? true : undefined} aria-label="Tu selección">
            <button type="button" className="public-quote-cart-close" aria-label="Cerrar selección" onClick={() => setCartOpen(false)}><X size={20} /></button>
            <div><span><ShoppingBag size={18} /> Tu selección</span><strong>{cartLines.length} producto(s)</strong></div>
            <div className="public-quote-cart-lines">{cartLines.length ? cartLines.map((item) => <div key={item.id}><div><strong>{item.quantity}× {item.name}</strong><span>{money(item.quantity * item.rentalPriceBs)}</span></div><button type="button" onClick={() => changeQuantity(item, 0)} title="Quitar"><Trash2 size={15} /></button></div>) : <p>Aún no agregaste productos.</p>}</div>
            <div className="public-quote-cart-total"><span>Total referencial</span><strong>{money(total)}</strong></div>
            <small>Logística y garantía se confirman al contactarte.</small>
            <button type="button" disabled={!cartLines.length} onClick={() => { setCartOpen(false); setError(''); setStep(3); }}>Revisar cotización <ArrowRight size={17} /></button>
            <button type="button" className="secondary" onClick={() => { setCartOpen(false); setStep(1); }}><ArrowLeft size={16} /> Cambiar fecha o datos</button>
          </aside>
          <div className="public-quote-mobile-dock">
            <button type="button" className="public-quote-selection-toggle" aria-expanded={cartOpen} aria-controls="quote-selection" onClick={() => setCartOpen(true)}><span><ShoppingBag size={18} /> {cartLines.length} productos</span><strong>{money(total)}</strong></button>
            <button type="button" disabled={!cartLines.length} onClick={() => { setError(''); setStep(3); }}>Revisar <ArrowRight size={18} /></button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="public-quote-panel public-quote-review">
          <div className="public-quote-section-heading"><span>03</span><div><h2>Todo listo para enviar</h2><p>Revisa la información. El equipo de El Copetín se comunicará contigo para confirmar los detalles.</p></div></div>
          <div className="public-quote-review-grid"><div className="public-quote-review-card"><small>CLIENTE</small><strong>{form.customerName}</strong><span>{form.customerPhone}</span></div><div className="public-quote-review-card"><small>EVENTO</small><strong>{form.eventType} · {form.eventDate}</strong><span>{form.eventTime} · {form.address || 'Lugar por confirmar'}</span></div></div>
          <div className="public-quote-review-lines">{cartLines.map((item) => <div key={item.id}><span><strong>{item.quantity}×</strong> {item.name}</span><strong>{money(item.quantity * item.rentalPriceBs)}</strong></div>)}</div>
          <label className="public-quote-observations"><span>¿Algo más que debamos saber?</span><textarea rows="4" value={form.observations} onChange={(event) => setField('observations', event.target.value)} placeholder="Colores, horarios, características del evento o cualquier detalle especial…" /></label>
          <div className="public-quote-final-total"><div><span>Total referencial</span><small>Sin logística ni garantía</small></div><strong>{money(total)}</strong></div>
          <div className="public-quote-disclaimer">Enviar esta solicitud no reserva automáticamente los productos. Nuestro equipo confirmará disponibilidad, logística, garantía y condiciones finales contigo.</div>
          <div className="public-quote-actions"><button type="button" className="secondary" onClick={() => setStep(2)}><ArrowLeft size={18} /> Volver</button><button type="button" onClick={submitQuote} disabled={submitting}>{submitting ? 'Creando cotización…' : 'Enviar y generar PDF'} <ArrowRight size={18} /></button></div>
        </section>
      ) : null}

      {step === 4 && result ? (
        <section className="public-quote-panel public-quote-success">
          <div className="public-quote-success-icon"><CheckCircle2 size={42} /></div><span>Solicitud recibida</span><h2>Tu cotización {result.quote.quoteCode} está lista</h2>
          <p>Recibimos tu solicitud. Nuestro equipo te contactará al <strong>{form.customerPhone}</strong> para confirmar disponibilidad y los detalles de tu evento.</p>
          <div className="public-quote-success-summary"><div><small>Evento</small><strong>{result.quote.eventDate}</strong></div><div><small>Total referencial</small><strong>{money(result.quote.totalBs)}</strong></div></div>
          <a className="public-quote-download" href={result.pdfUrl} download><Download size={20} /> Descargar cotización PDF</a>
          <div className="public-quote-phone-list"><span>¿Prefieres hablarnos ahora?</span>{phones.map((phone) => <a key={phone} href={`https://wa.me/${whatsappNumber(phone)}`} target="_blank" rel="noreferrer"><Phone size={16} /> {phone}</a>)}</div>
          <a className="public-quote-home" href="/catalogo">Volver al catálogo</a>
        </section>
      ) : null}
    </main>
  );
}
