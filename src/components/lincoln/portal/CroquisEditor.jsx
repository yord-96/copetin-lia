import { useRef, useState } from 'react';
import { shapeTypes } from './portalModel';

export default function CroquisEditor({ layout, onChange }) {
  const [selectedId, setSelectedId] = useState('');
  const svg = useRef(null);
  const drag = useRef(null);
  const selected = layout.objects.find((item) => item.id === selectedId);
  const update = (patch) => onChange({ ...layout, objects: layout.objects.map((item) => item.id === selectedId ? { ...item, ...patch } : item) });
  const add = (type) => {
    const definition = shapeTypes[type];
    const id = crypto.randomUUID();
    const columns = Math.max(1, Math.floor(layout.width / 250));
    const rows = Math.max(1, Math.floor(layout.height / 220));
    const slot = layout.objects.length % (columns * rows);
    const x = (slot % columns + 0.5) * layout.width / columns;
    const y = (Math.floor(slot / columns) + 0.5) * layout.height / rows;
    onChange({ ...layout, objects: [...layout.objects, { id, type, label: `${definition.label} ${layout.objects.filter((item) => item.type === type).length + 1}`, x, y, width: definition.width, height: definition.height, seats: definition.seats, rotation: 0 }] });
    setSelectedId(id);
  };
  const point = (event) => {
    const pt = svg.current.createSVGPoint(); pt.x = event.clientX; pt.y = event.clientY;
    return pt.matrixTransform(svg.current.getScreenCTM().inverse());
  };
  const move = (event) => {
    if (!drag.current) return;
    const pt = point(event);
    const item = layout.objects.find((row) => row.id === drag.current.id);
    if (!item) return;
    const radius = Math.hypot(item.width, item.height) / 2;
    const x = Math.round(Math.min(layout.width - radius, Math.max(radius, pt.x - drag.current.dx)) / 5) * 5;
    const y = Math.round(Math.min(layout.height - radius, Math.max(radius, pt.y - drag.current.dy)) / 5) * 5;
    onChange({ ...layout, objects: layout.objects.map((row) => row.id === item.id ? { ...row, x, y } : row) });
  };
  const exportSvg = () => {
    const copy = svg.current.cloneNode(true);
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.querySelectorAll('[data-selection]').forEach((item) => item.remove());
    const blob = new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'croquis-evento.svg'; link.click(); URL.revokeObjectURL(url);
  };
  return <div className="lp-croquis">
    <aside className="lp-palette"><h3>Elementos del salón</h3><p>Agrega una figura y arrástrala para ubicarla.</p>
      {Object.entries(shapeTypes).map(([type, item]) => <button type="button" key={type} onClick={() => add(type)} disabled={layout.objects.length >= 500}>+ {item.label}</button>)}
      <label>Ancho del plano<input type="number" min="400" max="3000" value={layout.width} onChange={(e) => onChange({ ...layout, width: Math.max(400, Math.min(3000, Number(e.target.value))) })} /></label>
      <label>Alto del plano<input type="number" min="300" max="2000" value={layout.height} onChange={(e) => onChange({ ...layout, height: Math.max(300, Math.min(2000, Number(e.target.value))) })} /></label>
      <button type="button" onClick={exportSvg}>Descargar croquis SVG</button>
    </aside>
    <div className="lp-plan-area"><div className="lp-plan-summary"><span>{layout.objects.length} elementos</span><span>{layout.objects.reduce((sum, item) => sum + Number(item.seats || 0), 0)} plazas previstas</span><span>Plano orientativo · unidades de dibujo</span></div>
      <svg ref={svg} className="lp-plan" viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label="Croquis del evento" onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onPointerDown={(e) => { if (e.target === svg.current) setSelectedId(''); }}>
        <defs><pattern id="lp-grid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M 25 0 L 0 0 0 25" fill="none" stroke="#e4eae7" strokeWidth="1" /></pattern></defs>
        <rect width={layout.width} height={layout.height} fill="#fff" /><rect width={layout.width} height={layout.height} fill="url(#lp-grid)" pointerEvents="none" />
        {layout.objects.map((item) => {
          const rounded = ['round', 'cocktail'].includes(item.type);
          const table = ['round', 'rectangle', 'square', 'cocktail', 'main'].includes(item.type);
          const stroke = ['stage', 'dance'].includes(item.type) ? '#921725' : '#24534e';
          return <g key={item.id} transform={`translate(${item.x} ${item.y}) rotate(${item.rotation})`} role="button" tabIndex="0" aria-label={item.label} onFocus={() => setSelectedId(item.id)} onKeyDown={(e) => {
            const steps = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, -5], ArrowDown: [0, 5] };
            if (steps[e.key]) { e.preventDefault(); const [dx, dy] = steps[e.key]; onChange({ ...layout, objects: layout.objects.map((row) => row.id === item.id ? { ...row, x: Math.min(layout.width - item.width / 2, Math.max(item.width / 2, row.x + dx)), y: Math.min(layout.height - item.height / 2, Math.max(item.height / 2, row.y + dy)) } : row) }); }
          }} onPointerDown={(e) => { e.stopPropagation(); setSelectedId(item.id); const pt = point(e); drag.current = { id: item.id, dx: pt.x - item.x, dy: pt.y - item.y }; svg.current.setPointerCapture(e.pointerId); }} style={{ cursor: 'grab' }}>
            {table ? Array.from({ length: Math.min(Number(item.seats) || 0, 30) }, (_, i) => {
              const angle = (i * 2 * Math.PI / Math.min(Number(item.seats), 30));
              const x = Math.cos(angle) * (item.width / 2 + 13), y = Math.sin(angle) * (item.height / 2 + 13);
              return <rect key={i} x={x - 7} y={y - 7} width="14" height="14" rx="3" fill="#fff" stroke={stroke} strokeWidth="1.5" transform={`rotate(${angle * 180 / Math.PI + 90} ${x} ${y})`} />;
            }) : null}
            {rounded ? <ellipse rx={item.width / 2} ry={item.height / 2} fill="#f3f8f6" stroke={stroke} strokeWidth="2" /> : <rect x={-item.width / 2} y={-item.height / 2} width={item.width} height={item.height} rx={item.type === 'chair' ? 4 : 2} fill={item.type === 'dance' ? '#fff5f3' : '#f3f8f6'} stroke={stroke} strokeWidth="2" />}
            {item.type === 'chair' ? <path d={`M${-item.width / 2 + 3},${-item.height / 2 + 7}h${item.width - 6}`} stroke={stroke} fill="none" /> : <text textAnchor="middle" dominantBaseline="middle" fontFamily="Arial, sans-serif" fontSize="11" fill="#203c38" pointerEvents="none">{item.label.slice(0, 26)}</text>}
            {selectedId === item.id ? <rect data-selection="true" x={-item.width / 2 - 21} y={-item.height / 2 - 21} width={item.width + 42} height={item.height + 42} fill="none" stroke="#ca971f" strokeDasharray="5 4" strokeWidth="2" pointerEvents="none" /> : null}
          </g>;
        })}
      </svg>
      <p className="lp-hint">Puedes mover las figuras con el mouse, el dedo o las flechas del teclado. Guarda la ficha para conservar el croquis.</p>
    </div>
    <aside className="lp-properties"><h3>{selected ? 'Editar elemento' : 'Selecciona una figura'}</h3>{selected ? <>
      <label>Nombre<input maxLength="80" value={selected.label} onChange={(e) => update({ label: e.target.value })} /></label>
      {[['width', 'Ancho', 15, 500], ['height', 'Alto', 15, 500], ['rotation', 'Rotación (°)', 0, 360], ['seats', 'Plazas', 0, 100]].map(([key, label, min, max]) => <label key={key}>{label}<input type="number" min={min} max={max} value={selected[key]} onChange={(e) => update({ [key]: Math.min(max, Math.max(min, Number(e.target.value))) })} /></label>)}
      <button type="button" onClick={() => { const id = crypto.randomUUID(); onChange({ ...layout, objects: [...layout.objects, { ...selected, id, x: Math.min(layout.width - selected.width / 2, selected.x + 30), y: Math.min(layout.height - selected.height / 2, selected.y + 30) }] }); setSelectedId(id); }} disabled={layout.objects.length >= 500}>Duplicar</button>
      <button type="button" className="lp-danger" onClick={() => { onChange({ ...layout, objects: layout.objects.filter((item) => item.id !== selectedId) }); setSelectedId(''); }}>Eliminar elemento</button>
    </> : <p>Cambia el nombre, tamaño, orientación y número de plazas.</p>}</aside>
  </div>;
}
