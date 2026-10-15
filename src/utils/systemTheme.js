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
  const hslSaturation=saturation/(1-Math.abs(2*light-1)||1);
  const warmPaper=light>0.9&&saturation<0.08&&rgb[0]>=rgb[1]&&rgb[1]>=rgb[2];
  const colorful=!warmPaper&&saturation>0.025&&hslSaturation>0.25;
  const hue=rgb.map(v=>saturation?(v-min)/saturation:0);
  if(role==='background'&&light<0.28)return value;
  if(role==='foreground'&&light>0.87&&saturation<0.12)return value;
  let target;
  if(role==='background') {
    if(colorful) {
      const accent=light<0.72&&hslSaturation>0.65?0.46:0.16;
      target=hue.map((v,i)=>Math.round(([0.07,0.09,0.12][i]+v*accent)*255));
    } else target=rgb.map((v,i)=>Math.round((0.115+(1-light)*0.45+[0,0.025,0.065][i])*255));
  } else if(role==='border') target=rgb.map(v=>Math.round((0.25+(v-light)*(colorful?0.7:0.28))*255));
  else {
    if(light>0.65)return value;
    const navy=rgb[2]>rgb[0]&&light<0.35;
    target=colorful&&!navy?hue.map(v=>Math.round((0.38+v*0.55)*255)): [215,226,242];
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
  html[data-theme="dark"] .topbar,html[data-theme="dark"] .user-pill{background:#131e2d;color:#e3ebf5}
  html[data-theme="dark"] *{text-shadow:none!important}
  html[data-theme="dark"] .app-sidebar{background:linear-gradient(180deg,#172337,#101a2b)!important;border-right:1px solid #304157!important}
  html[data-theme="dark"] .app-sidebar .tab-item.active,html[data-theme="dark"] .app-sidebar .tab-subitem.active{background:linear-gradient(110deg,#cc4a0b,#a4380b)!important;color:#fff!important;box-shadow:0 3px 14px #e65b0c26}
  html[data-theme="dark"] .system-theme-toggle{background:#223148!important;border-color:#52617a!important;color:#ffc36b!important}
  html[data-theme="dark"] .system-theme-toggle:hover{background:#31435e!important}
  html[data-theme="dark"] .primary-button{background:linear-gradient(135deg,#e56a14,#c4490a)!important;color:#fff!important;border-color:#ef853e!important;box-shadow:0 4px 14px #e56a1420}
  html[data-theme="dark"] .primary-button:hover:not(:disabled){background:linear-gradient(135deg,#f37a23,#d65510)!important}
  html[data-theme="dark"] .primary-button:disabled{opacity:.5}
  html[data-theme="dark"] .suppliers-v2{--sup-border:#34435b;--sup-soft:#1c293b;--sup-text:#dce7f7;--sup-muted:#9eafc6;--sup-orange:#ff984a;--sup-orange-soft:#3b291e}
  html[data-theme="dark"] .suppliers-v2 .suppliers-compact-kpis strong,html[data-theme="dark"] .suppliers-v2 .suppliers-tab-count,html[data-theme="dark"] .suppliers-v2 .suppliers-detail-metrics strong,html[data-theme="dark"] .suppliers-v2 .suppliers-view-tabs button.active{color:#a9cdff}
  html[data-theme="dark"] input:focus,html[data-theme="dark"] select:focus,html[data-theme="dark"] textarea:focus{outline-color:#ff984a;border-color:#ff984a;box-shadow:0 0 0 3px #ff984a20}
  html[data-theme="dark"] .presence-strip .presence-session-list > span{background:#1b2b3c!important;border-color:color-mix(in srgb,var(--presence-color) 55%,#34445b)!important}
  html[data-theme="dark"] .presence-strip .presence-session-list > span.active{background:color-mix(in srgb,var(--presence-color) 12%,#182638)!important}
  html[data-theme="dark"] .presence-strip .presence-session-list b{color:#edf3fc!important}
  html[data-theme="dark"] .presence-strip .presence-session-list em{color:#ffb47d!important}
  html[data-theme="dark"] .presence-strip .presence-session-list span > small{background:#2a3e55!important;color:#e2edfc!important;box-shadow:inset 0 0 0 1px #465d78}
  html[data-theme="dark"] .presence-strip .presence-session-list span > small:last-of-type{background:color-mix(in srgb,var(--presence-color) 18%,#172b36)!important;color:#effbff!important}
  html[data-theme="dark"] .developer-company-backdrop{background:radial-gradient(circle at 50% 38%,#31446155,transparent 34rem),#080f1dcc!important}
  html[data-theme="dark"] .developer-company-modal{background:#172334!important;border-color:#3a4c65!important;box-shadow:0 30px 90px #0008}
  html[data-theme="dark"] .developer-company-header{background:linear-gradient(135deg,#23334a,#182538)!important;border-color:#3a4c65!important}
  html[data-theme="dark"] .developer-company-brand strong,html[data-theme="dark"] .developer-company-modal h2,html[data-theme="dark"] .developer-company-card > strong{color:#f0f5ff!important}
  html[data-theme="dark"] .developer-company-brand span:not(.developer-company-brand-mark),html[data-theme="dark"] .developer-company-footer span{color:#ffb47d!important}
  html[data-theme="dark"] .developer-company-modal p,html[data-theme="dark"] .developer-company-description,html[data-theme="dark"] .developer-company-footer strong{color:#b8c8dd!important}
  html[data-theme="dark"] .developer-company-card{background:linear-gradient(150deg,#26364b,#1d2b3d)!important;border-color:#435570!important;color:#e3ebf5!important}
  html[data-theme="dark"] .developer-company-card:hover{background:linear-gradient(150deg,#304058,#243247)!important;border-color:#ff984a!important}
  html[data-theme="dark"] .developer-company-card--salon:hover{border-color:#57d6b3!important}
  html[data-theme="dark"] .developer-company-icon,html[data-theme="dark"] .developer-company-eyebrow{background:#3e2b23!important;color:#ffb47d!important;border-color:#865137!important}
  html[data-theme="dark"] .developer-company-action{color:#ffb47d!important}
  html[data-theme="dark"] .developer-company-card--salon .developer-company-icon,html[data-theme="dark"] .developer-company-card--salon .developer-company-eyebrow{background:#173f3c!important;color:#8ce7cd!important;border-color:#33786c!important}
  html[data-theme="dark"] .developer-company-card--salon .developer-company-action{color:#8ce7cd!important}
  html[data-theme="dark"] .developer-company-tags em{background:#172435!important;color:#c7d7eb!important;border-color:#455a75!important}
  html[data-theme="dark"] .developer-company-footer{background:#131e2e!important;border-color:#3a4c65!important}`;
  const rebuild=()=>{
    if(theme!=='dark'){style.textContent='';return;}
    let css='';
    const rootStyle=getComputedStyle(document.documentElement),variables=new Map();
    const localVariables=new Map();
    const collect=rules=>{for(const rule of rules){if(rule.style)for(const property of rule.style){if(property.startsWith('--'))localVariables.set(property,rule.style.getPropertyValue(property).trim());}else if(rule.cssRules)collect(rule.cssRules);}};
    for(const sheet of document.styleSheets){if(sheet.ownerNode===style)continue;try{collect(sheet.cssRules);}catch{/* Cross-origin fonts. */}}
    const resolveVariable=name=>{if(!variables.has(name))variables.set(name,rootStyle.getPropertyValue(name).trim()||localVariables.get(name)||'');return variables.get(name);};
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
      || [...r.addedNodes].some(n=>n!==style&&(n.tagName==='STYLE'||n.tagName==='LINK'||n.querySelector?.('style,link[rel="stylesheet"]'))))))schedule();
  });
  observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  document.addEventListener('load',event=>{if(event.target.tagName==='LINK')schedule();},true);
  window.addEventListener('storage',event=>{if(event.key===THEME_STORAGE_KEY)setTheme(event.newValue);});
  window.addEventListener('copetin-theme-request',event=>setTheme(event.detail));
  setTheme(theme);
  return {setTheme};
}
