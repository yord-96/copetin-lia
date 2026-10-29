import { useState } from 'react';
import { contractServiceAppliesToGroup, selectedLincolnContractServices } from '../../../shared/lincolnContractServices.js';
import './styles/lincoln-contract-services.css';

export default function ContractServicesEditor({ services, groups, onChange, onToggle }) {
  const [editing, setEditing] = useState(null);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const open = line => { setEditing(line || { id: '', isNew: true }); setDescription(line?.description || ''); setCategory(line?.category || 'OTROS'); };
  const save = event => {
    event.preventDefault();
    if (!description.trim()) return;
    const patch = { description: description.trim(), category: category.trim().toUpperCase() || 'OTROS' };
    onChange(editing.isNew
      ? [...services, { id: `service-${crypto.randomUUID()}`, ...patch, selected: true, variantIds: groups.map(group => String(group.variantId)), custom: true }]
      : services.map(line => line.id === editing.id ? { ...line, ...patch } : line));
    setEditing(null);
  };
  return <article className="lincoln-contract-choice-table lincoln-contract-services-editor">
    <header><div><h4>Servicios incluidos</h4><p>Marca qué recibe cada nivel. Los cambios se guardan en este contrato.</p></div>
      <div className="lincoln-contract-services-actions"><span>{selectedLincolnContractServices(services, groups).length} activos</span><button type="button" onClick={() => open(null)}>+ Añadir servicio</button></div></header>
    {editing ? <form className="lincoln-contract-service-form" onSubmit={save}>
      <h5>{editing.isNew ? 'Nuevo servicio' : 'Editar servicio'}</h5>
      <label>Categoría<input value={category} maxLength={100} onChange={event => setCategory(event.target.value)} /></label>
      <label>Descripción<textarea value={description} maxLength={3000} required onChange={event => setDescription(event.target.value)} /></label>
      <div><button type="submit">Guardar servicio</button><button type="button" className="is-secondary" onClick={() => setEditing(null)}>Cancelar</button></div>
    </form> : null}
    {groups.length ? <div className="lincoln-contract-choice-head" style={{ '--choice-groups': groups.length }}><strong>Servicio</strong>{groups.map(group => <b key={group.id}>{group.name}</b>)}</div> : null}
    {services.length ? services.map(line => <div className="lincoln-contract-choice-row" style={{ '--choice-groups': groups.length }} key={line.id}>
      <span><b>{line.category}</b><strong>{line.description}</strong><button type="button" className="is-secondary lincoln-contract-service-edit" onClick={() => open(line)} aria-label={`Editar servicio: ${line.description}`}>Editar</button></span>
      {groups.map(group => <label key={group.id} title={`${line.description} · ${group.name}`}><input type="checkbox" checked={contractServiceAppliesToGroup(line, group)} onChange={() => onToggle(line.id, group.variantId)} /><i>✓</i></label>)}
    </div>) : <p className="is-empty">No hay servicios. Puedes añadir uno para este contrato.</p>}
  </article>;
}
