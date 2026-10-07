import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
export default function EconomicMovementActions({row,onEdit,onDelete}) {
  const [position,setPosition]=useState(null);
  const trigger=useRef(null),menu=useRef(null);
  useEffect(()=>{
    if(!position) return;
    menu.current?.querySelector('button')?.focus();
    const close=event=>{if(!menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) setPosition(null);};
    const escape=event=>{if(event.key==='Escape'){setPosition(null);trigger.current?.focus();}};
    const scroll=()=>setPosition(null);
    document.addEventListener('mousedown',close);document.addEventListener('keydown',escape);window.addEventListener('scroll',scroll,true);window.addEventListener('resize',scroll);
    return()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',escape);window.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',scroll);};
  },[position]);
  const act=callback=>{setPosition(null);callback(row);};
  return <><button ref={trigger} type="button" className="lincoln-economic-dots" aria-label={`Acciones del movimiento ${row.code}`} aria-haspopup="menu" aria-expanded={!!position} onClick={event=>{event.stopPropagation();const box=event.currentTarget.getBoundingClientRect();setPosition(position?null:{top:Math.min(box.bottom+6,window.innerHeight-120),left:Math.max(8,Math.min(box.right-230,window.innerWidth-238))});}}>⋮</button>{position?createPortal(<div ref={menu} style={position} className="lincoln-economic-menu" role="menu"><button type="button" role="menuitem" onClick={()=>act(onEdit)}>{row.paymentId?'Editar recibo completo':'Editar movimiento'}</button><button type="button" role="menuitem" className="is-danger" onClick={()=>act(onDelete)}>Eliminar movimiento</button></div>,document.body):null}</>;
}
