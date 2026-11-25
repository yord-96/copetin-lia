import './styles/lincoln-additional-contractors.css';

export default function LincolnAdditionalContractors({ value = [], onChange }) {
  const people = Array.isArray(value) ? value : [];
  const update = (index, key, next) => onChange(people.map((person, position) => position === index ? { ...person, [key]: next } : person));
  return <section className="lincoln-additional-contractors">
    <header><div><strong>Responsables adicionales</strong><small>Se incluyen en los datos y firmas del contrato.</small></div><button type="button" onClick={() => onChange([...people, { name: '', ci: '', phone: '' }])}>+ Añadir responsable</button></header>
    {people.map((person, index) => <article key={index}>
      <strong>Responsable {index + 3}</strong>
      <label><span>Nombre completo</span><input required value={person.name || ''} onChange={event => update(index, 'name', event.target.value)} /></label>
      <label><span>C.I.</span><input value={person.ci || ''} onChange={event => update(index, 'ci', event.target.value)} /></label>
      <label><span>Celular</span><input inputMode="tel" value={person.phone || ''} onChange={event => update(index, 'phone', event.target.value)} /></label>
      <button type="button" onClick={() => onChange(people.filter((_, position) => position !== index))}>Quitar responsable {index + 3}</button>
    </article>)}
  </section>;
}
