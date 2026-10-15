import {useEffect,useState} from 'react';
import {Sun,Moon} from 'lucide-react';
export default function ThemeToggle() {
  const [theme,setTheme]=useState(()=>document.documentElement.dataset.theme??'light');
  useEffect(()=>{const listener=event=>setTheme(event.detail);window.addEventListener('copetin-theme-change',listener);return()=>window.removeEventListener('copetin-theme-change',listener);},[]);
  const label=theme==='dark'?'Cambiar a tema claro':'Cambiar a tema oscuro';
  return <button type="button" className="system-theme-toggle" title={label} aria-label={label} aria-pressed={theme==='dark'} onClick={()=>window.dispatchEvent(new CustomEvent('copetin-theme-request',{detail:theme==='dark'?'light':'dark'}))}>{theme==='dark'?<Sun size={18} strokeWidth={1.8}/>:<Moon size={18} strokeWidth={1.8}/>}</button>;
}
