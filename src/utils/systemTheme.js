export const THEME_STORAGE_KEY = 'copetin-theme-v1';
export const readTheme = (storage) => {
  try { return storage?.getItem(THEME_STORAGE_KEY)==='dark'?'dark':'light'; } catch { return 'light'; }
};
// Adapt legacy fixed colors by their role, keeping semantic hues and images.
export function darkColor(value, role) {
  const match=value.match(/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i);
  if (!match) return value;
  let hex=match[1];if(hex.length===3)hex=[...hex].map(c=>c+c).join('');
  const rgb=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255);
  const max=Math.max(...rgb),min=Math.min(...rgb),light=(max+min)/2;
  const saturation=max-min;
  if(role==='background'&&light<0.28)return value;
  if(role==='foreground'&&light>0.87&&saturation<0.12)return value;
  let target;
  if(role==='background') {
    const tint=saturation>0.13?0.18:0.12;
    target=rgb.map((v,i)=>Math.round((tint+(v-light)*0.22+[0,0.018,0.045][i])*255));
  } else if(role==='border') target=rgb.map(v=>Math.round((0.24+(v-light)*0.28)*255));
  else {
    if(light>0.65)return value;
    target=rgb.map(v=>Math.round((0.84+(v-light)*(saturation>0.18?0.55:0.3))*255));
  }
  return '#'+target.map(v=>Math.max(0,Math.min(255,v)).toString(16).padStart(2,'0')).join('')+hex.slice(6);
}
export function themedDeclaration(property,value) {
  const role=/^background/.test(property)?'background':/^(border|outline)/.test(property)?'border':/^(color|fill|stroke|text-decoration-color)$/.test(property)?'foreground':null;
  if(!role||/url\(/i.test(value))return null;
  // CSSOM normalizes hexadecimal colors to rgb(). Alpha is preserved.
  const result=value.replace(/\bwhite\b|\bblack\b|#[\da-f]{3,8}\b|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*[\d.]+)?\s*\)/gi,token=>{
    if(/^(white|black)$/i.test(token))return darkColor(token.toLowerCase()==='white'?'#ffffff':'#000000',role);
    if(token[0]==='#')return darkColor(token,role);
    const numbers=token.match(/[\d.]+/g).map(Number);
    const hex='#'+numbers.slice(0,3).map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
    const transformed=darkColor(hex,role);
    if(numbers.length<4)return transformed;
    const channels=[1,3,5].map(i=>parseInt(transformed.slice(i,i+2),16));
    return `rgba(${channels.join(',')},${numbers[3]})`;
  });
  return result!==value?result:null;
}
const splitSelectors = selector => {
  const result=[];let depth=0,start=0,quote='';
  for(let i=0;i<selector.length;i++){
    const c=selector[i];if(quote){if(c===quote&&selector[i-1]!=='\\')quote='';continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if(c==='('||c==='[')depth++;if(c===')'||c===']')depth--;
    if(c===','&&depth===0){result.push(selector.slice(start,i));start=i+1;}
  }
  result.push(selector.slice(start));return result;
};
const scope = selector => splitSelectors(selector).map(part=>{
  const s=part.trim();
  return /^(html|:root)(?=\s|[.:#]|\[|$)/.test(s)?s.replace(/^(html|:root)/,'html[data-theme="dark"]'):`html[data-theme="dark"] ${s}`;
}).join(',');
export function compileDarkRules(rules, resolveVariable = () => '') {
  let output='';
  for(const rule of rules) {
    if(rule.selectorText&&rule.style) {
      const declarations=[];
      for(const property of rule.style) {
        const original=rule.style.getPropertyValue(property);
        const resolved=original.replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g,(match,name,fallback)=>resolveVariable(name)||fallback||match);
        const eligible=/^(background|border|outline|color$|fill$|stroke$|text-decoration-color$)/.test(property);
        const value=themedDeclaration(property,resolved)||(eligible&&resolved!==original?resolved:null);
        if(value)declarations.push(`${property}:${value}${rule.style.getPropertyPriority(property)?'!important':''}`);
      }
      if(declarations.length)output+=`${scope(rule.selectorText)}{${declarations.join(';')}}`;
    } else if(rule.cssRules&&rule.conditionText&&!rule.name) {
      if(/\bprint\b/.test(rule.conditionText))continue;
      const name=rule.cssText.startsWith('@supports')?'supports':'media';
      output+=`@${name} ${rule.conditionText}{${compileDarkRules(rule.cssRules,resolveVariable)}}`;
    }
  }
  return output;
}
export function initializeSystemTheme() {
  let theme='light',timer;
  try { theme=readTheme(window.localStorage); } catch { /* Storage can be unavailable. */ }
  const style=document.createElement('style');style.id='copetin-dark-theme';document.head.append(style);
  const base=`html[data-theme="dark"]{color-scheme:dark;background:#141b25;color:#e3ebf5;--ink-900:#e3ebf5;--ink-800:#d5dfef;--ink-700:#c2cee1;--ink-500:#9bacc4;--line:#364255;--line-strong:#526078;--sky-050:#1b2533;--sky-100:#263346}
  html[data-theme="dark"] body{background:#141b25;color:#e3ebf5}
  html[data-theme="dark"] input::placeholder,html[data-theme="dark"] textarea::placeholder{color:#91a1b8}
  html[data-theme="dark"] input,html[data-theme="dark"] select,html[data-theme="dark"] textarea{color-scheme:dark}
  html[data-theme="dark"] .topbar,html[data-theme="dark"] .user-pill{background:#1c2532;color:#e3ebf5}`;
  const rebuild=()=>{
    if(theme!=='dark'){style.textContent='';return;}
    let css='';
    const rootStyle=getComputedStyle(document.documentElement),variables=new Map();
    const resolveVariable=name=>{if(!variables.has(name))variables.set(name,rootStyle.getPropertyValue(name).trim());return variables.get(name);};
    for(const sheet of document.styleSheets) {
      if(sheet.ownerNode===style)continue;
      try{css+=compileDarkRules(sheet.cssRules,resolveVariable);}catch{/* External font stylesheets are inaccessible. */}
    }
    style.textContent=`@media screen{${css}${base}}`;
  };
  const setTheme=value=>{
    theme=value==='dark'?'dark':'light';document.documentElement.dataset.theme=theme;
    try{window.localStorage.setItem(THEME_STORAGE_KEY,theme);}catch{/* Private browsing can disable storage. */}
    rebuild();window.dispatchEvent(new CustomEvent('copetin-theme-change',{detail:theme}));
  };
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(rebuild,50);};
  const observer=new MutationObserver(records=>{
    if(records.some(r=>r.target!==style&&(r.target.tagName==='STYLE'||r.target.parentNode?.tagName==='STYLE'&&r.target.parentNode!==style
      || [...r.addedNodes].some(n=>n!==style&&(n.tagName==='STYLE'||n.tagName==='LINK')))))schedule();
  });
  observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  document.addEventListener('load',event=>{if(event.target.tagName==='LINK')schedule();},true);
  window.addEventListener('storage',event=>{if(event.key===THEME_STORAGE_KEY)setTheme(event.newValue);});
  window.addEventListener('copetin-theme-request',event=>setTheme(event.detail));
  setTheme(theme);
  return {setTheme};
}
