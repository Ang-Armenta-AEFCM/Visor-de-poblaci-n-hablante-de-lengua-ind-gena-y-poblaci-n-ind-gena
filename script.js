const DATA = {
  base: 'data/base_cct.json',
  siieweb: 'data/indigenas_siieweb.json',
  source911: 'data/hablantes_911.json',
  alcaldias: 'data/alcaldias.json',
  inmuebles: 'data/inmuebles_oficiales.json'
};

let baseRows = [];
let siRows = [];
let source911Rows = [];
let groupCatalog = [];
let meta = {};
let alcaldiasGeo = null;
let officialInmuebles = [];
let siByCct = new Map();
let source911ByCct = new Map();
let baseByCct = new Map();
let filteredCcts = [];
let visibleSites = [];
let siteByKey = new Map();
let dark = false;
let legendSelection = new Set();

const map = L.map('map', {zoomControl: false, preferCanvas: true}).setView([19.35, -99.13], 10);
map.createPane('schoolPane');
map.getPane('schoolPane').style.zIndex = 560;
const schoolRenderer = L.canvas({padding:0.5, pane:'schoolPane'});
L.control.zoom({position: 'topleft'}).addTo(map);
const schoolLayer = L.layerGroup().addTo(map);
const alcaldiaLayer = L.layerGroup().addTo(map);
const lightTiles = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19,
  attribution: 'Tiles &copy; Esri'
}).addTo(map);
const darkTiles = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 16,
  attribution: 'Tiles &copy; Esri'
});

const $ = id => document.getElementById(id);
const clean = v => v === null || v === undefined ? '' : String(v).trim();
const n = v => {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const norm = v => clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const normTurn = v => norm(v);
const fmt = v => v === null || v === undefined || v === '' ? '0' : Number(v).toLocaleString('es-MX');
const fmtPct = v => v === null || !Number.isFinite(v) ? 'Sin registro' : `${v.toLocaleString('es-MX',{maximumFractionDigits:1})}%`;
const esc = s => clean(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const uniq = arr => [...new Set(arr.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));

async function fetchJson(path){
  const r = await fetch(path,{cache:'no-store'});
  if(!r.ok) throw new Error(`No se pudo cargar ${path}`);
  return r.json();
}

function indexRows(rows){
  const m = new Map();
  rows.forEach(r => {
    if(!m.has(r.cct)) m.set(r.cct,[]);
    m.get(r.cct).push(r);
  });
  return m;
}

async function init(){
  bindUI();
  restoreTheme();
  try{
    const [base,si,s911,alc,inmuebles] = await Promise.all(Object.values(DATA).map(fetchJson));
    meta = base.meta || {};
    baseRows = base.registros || [];
    siRows = si.registros || [];
    source911Rows = s911.registros || [];
    const groupTotals=new Map();
    siRows.forEach(r=>Object.entries(r.grupos||{}).forEach(([g,v])=>groupTotals.set(g,(groupTotals.get(g)||0)+(n(v)||0))));
    groupCatalog = (si.grupos || []).filter(g=>(groupTotals.get(g)||0)>0);
    alcaldiasGeo = alc;
    officialInmuebles = Array.isArray(inmuebles) ? inmuebles : [];
    baseByCct = new Map(baseRows.map(r => [r.cct,r]));
    siByCct = indexRows(siRows);
    source911ByCct = indexRows(source911Rows);
    (si.matricula_fallback || []).forEach(r => {
      if(!siByCct.has(r.cct)) siByCct.set(r.cct,[]);
      siByCct.get(r.cct).push({...r,total_pertenecientes:null,grupos:{},fallback_matricula:true});
    });
    populateFilters();
    drawAlcaldias();
    applyFilters(true);
    setStatus('');
  }catch(err){
    console.error(err);
    setStatus('No fue posible cargar la información. Abre el visor desde GitHub Pages o un servidor web.',true);
  }
}

document.addEventListener('DOMContentLoaded',init);

function bindUI(){
  $('fuenteIndicador').addEventListener('change',()=>{
    legendSelection.clear();
    syncSourceUI();
    applyFilters(false);
  });
  ['grupoIndigena','filtroNivel','filtroSostenimiento','filtroTurno','filtroEstado'].forEach(id => $(id).addEventListener('change',()=>{
    syncSourceUI();
    applyFilters(false);
  }));
  $('filtroAlcaldia').addEventListener('change',()=>{
    syncSourceUI(); applyFilters(false); fitFilteredBounds();
  });
  $('buscar').addEventListener('input',()=>applyFilters(false));
  $('btnLimpiar').addEventListener('click',()=>{
    $('fuenteIndicador').value='siieweb';
    $('grupoIndigena').value='';
    ['filtroAlcaldia','filtroNivel','filtroSostenimiento','filtroTurno','filtroEstado'].forEach(id=>$(id).value='');
    $('buscar').value='';
    legendSelection.clear();
    syncSourceUI(); applyFilters(true);
  });
  $('toggleDark').addEventListener('click',toggleTheme);
  $('toggleFullscreen').addEventListener('click',()=>{
    const el=document.querySelector('.maparea');
    if(!document.fullscreenElement) el.requestFullscreen?.(); else document.exitFullscreen?.();
  });
  $('toggleSidebar').addEventListener('click',()=>{
    $('layout').classList.add('sidebar-hidden'); $('showSidebar').classList.remove('hidden'); setTimeout(()=>map.invalidateSize(),220);
  });
  $('showSidebar').addEventListener('click',()=>{
    $('layout').classList.remove('sidebar-hidden'); $('showSidebar').classList.add('hidden'); setTimeout(()=>map.invalidateSize(),220);
  });
  $('toggleLegend').addEventListener('click',()=>{
    const body=$('legendBody'); const hidden=body.classList.toggle('hidden'); $('toggleLegend').textContent=hidden?'+':'−';
  });
  $('closeDetail').addEventListener('click',closeDetail);
  $('rangeClear').addEventListener('click',()=>{ legendSelection.clear(); renderMap(); updateStats(); renderRangeSelector(); });
  map.on('zoomend',renderMap);
  document.addEventListener('fullscreenchange',()=>setTimeout(()=>map.invalidateSize(),100));
}

function populateFilters(){
  fillSelect('filtroAlcaldia',uniq(baseRows.map(r=>r.alcaldia)),'Todas');
  fillSelect('filtroNivel',uniq(baseRows.map(r=>r.nivel)),'Todos');
  fillSelect('filtroSostenimiento',uniq(baseRows.map(r=>r.sostenimiento)),'Todos');
  fillSelect('filtroTurno',uniq(baseRows.flatMap(r=>r.turnos || [])),'Todos');
  $('grupoIndigena').innerHTML='<option value="">Todos los grupos</option>'+groupCatalog.map(g=>`<option value="${esc(g)}">${esc(g)}</option>`).join('');
  syncSourceUI();
}
function fillSelect(id,values,first){
  $(id).innerHTML=`<option value="">${first}</option>`+values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
}
function syncSourceUI(){
  const isSi=$('fuenteIndicador').value==='siieweb';
  $('grupoIndigena').disabled=!isSi;
  $('grupoHint').style.opacity=isSi?'1':'.45';
  if(!isSi){ $('grupoIndigena').value=''; }
  const groupActive=isSi && !!$('grupoIndigena').value;
  [...$('filtroEstado').options].forEach(o=>{
    if(o.value==='cero') o.disabled=groupActive;
  });
  if(groupActive && $('filtroEstado').value==='cero') $('filtroEstado').value='casos';
  $('kpiIndicadorLabel').textContent=isSi?'Pertenecientes (SIIEWEB)':'Niños indígenas / hablantes (911)';
}

function sourceRowsFor(cct,source,turno){
  const rows=(source==='siieweb'?siByCct:source911ByCct).get(cct)||[];
  if(!turno) return rows;
  return rows.filter(r=>normTurn(r.turno)===normTurn(turno));
}
function metricFor(base,source,turno,group){
  const rows=sourceRowsFor(base.cct,source,turno);
  const indicatorRows=source==='siieweb'?rows.filter(r=>!r.fallback_matricula):rows;
  const hasRecord=indicatorRows.length>0;
  let value=0;
  let matricula=null;
  if(source==='siieweb'){
    indicatorRows.forEach(r=>{
      if(group) value += n(r.grupos?.[group]) || 0;
      else value += n(r.total_pertenecientes) || 0;
    });
    const mvals=rows.map(r=>n(r.matricula)).filter(v=>v!==null);
    matricula=mvals.length?mvals.reduce((a,b)=>a+b,0):null;
  }else{
    indicatorRows.forEach(r=>value += n(r.total)||0);
  }
  return {rows:indicatorRows,allRows:rows,hasRecord,value,matricula};
}

function applyFilters(resetView=false){
  const source=$('fuenteIndicador').value;
  const group=$('grupoIndigena').value;
  const alcaldia=$('filtroAlcaldia').value;
  const nivel=$('filtroNivel').value;
  const sost=$('filtroSostenimiento').value;
  const turno=$('filtroTurno').value;
  const estado=$('filtroEstado').value;
  const term=norm($('buscar').value);

  filteredCcts=baseRows.filter(b=>{
    if(alcaldia && b.alcaldia!==alcaldia) return false;
    if(nivel && b.nivel!==nivel) return false;
    if(sost && b.sostenimiento!==sost) return false;
    if(turno && !(b.turnos||[]).some(t=>normTurn(t)===normTurn(turno))) return false;
    if(term && !norm(`${b.cct} ${b.nombre}`).includes(term)) return false;
    const m=metricFor(b,source,turno,group);
    if(group && m.value<=0) return false;
    if(estado==='casos' && m.value<=0) return false;
    if(estado==='registro' && !m.hasRecord) return false;
    if(estado==='cero' && m.value!==0) return false;
    b.__metric=m;
    return true;
  });
  buildSites();
  updateStats();
  renderMap();
  renderRangeSelector();
  renderLegend();
  if(resetView && alcaldiasGeo){
    const tmp=L.geoJSON(alcaldiasGeo); if(tmp.getBounds().isValid()) map.fitBounds(tmp.getBounds(),{padding:[10,10]});
  }
}

function siteKey(b){
  if(b.inmueble) return `I:${b.inmueble}`;
  if(b.op_asig) return `O:${b.op_asig}`;
  // Sin identificador de inmueble no se agrupa solo por coordenada: dos planteles distintos
  // pueden compartir el mismo punto y deben seguir siendo seleccionables por separado.
  return `N:${b.cct}`;
}
function buildSites(){
  siteByKey=new Map();
  // Se construyen los puntos a partir del resultado de los filtros generales.
  // La selección de rangos se aplica después; usar effectiveCcts() aquí dejaba
  // el mapa vacío en la primera carga porque visibleSites todavía no existía.
  filteredCcts.forEach(b=>{
    const key=siteKey(b);
    if(!siteByKey.has(key)) siteByKey.set(key,{key,ccts:[],lat:b.lat,lon:b.lon,alcaldia:b.alcaldia});
    const s=siteByKey.get(key); s.ccts.push(b);
    if((s.lat===null||s.lat===undefined) && Number.isFinite(b.lat)) {s.lat=b.lat;s.lon=b.lon;}
  });
  visibleSites=[...siteByKey.values()];
}
function fitFilteredBounds(){
  const pts=effectiveSites().filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)).map(s=>[s.lat,s.lon]);
  if(!pts.length) return;
  if(pts.length===1) map.setView(pts[0],15);
  else map.fitBounds(L.latLngBounds(pts),{padding:[35,35],maxZoom:15});
}

function drawAlcaldias(){
  alcaldiaLayer.clearLayers();
  if(!alcaldiasGeo) return;
  L.geoJSON(alcaldiasGeo,{
    interactive:false,
    style:{color:'#0f4c75',weight:2,opacity:.8,fillColor:'#0f6b78',fillOpacity:.02}
  }).addTo(alcaldiaLayer);
  if(!map.hasLayer(alcaldiaLayer)) alcaldiaLayer.addTo(map);
}

function renderMap(){
  schoolLayer.clearLayers();
  drawSiteMarkers();
}
function drawSummaryBubbles(){
  const byAlc=new Map();
  effectiveSites().filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)).forEach(site=>{
    const k=site.alcaldia||'Sin registro';
    if(!byAlc.has(k)) byAlc.set(k,{rows:[],sites:[],lat:0,lon:0});
    const a=byAlc.get(k); a.sites.push(site); a.rows.push(...site.ccts); a.lat+=site.lat; a.lon+=site.lon;
  });
  byAlc.forEach((a,name)=>{
    const count=a.rows.length, siteCount=a.sites.length, lat=a.lat/siteCount, lon=a.lon/siteCount;
    const metric=a.rows.reduce((s,b)=>s+(b.__metric?.value||0),0);
    const size=Math.max(36,Math.min(70,34+Math.log10(count+1)*16));
    const icon=L.divIcon({className:'',html:`<div class="summary-bubble" style="width:${size}px;height:${size}px">${count.toLocaleString('es-MX')}</div>`,iconSize:[size,size]});
    L.marker([lat,lon],{icon}).bindTooltip(`<strong>${esc(name)}</strong><br>${count.toLocaleString('es-MX')} CCT<br>Indicador: ${metric.toLocaleString('es-MX')}`).on('click',()=>map.setView([lat,lon],12)).addTo(schoolLayer);
  });
}
function siteMetricInfo(site){
  const hasRecord=site.ccts.some(b=>b.__metric?.hasRecord);
  const value=site.ccts.reduce((s,b)=>s+(b.__metric?.value||0),0);
  const vals=site.ccts.map(b=>b.__metric?.matricula).filter(v=>v!==null&&v!==undefined);
  const matricula=vals.length?vals.reduce((a,b)=>a+b,0):null;
  return {hasRecord,value,matricula};
}
function displayedValue(info){ return info.value; }
function legendCategories(){
  return [
    {id:'cero',label:'0 estudiantes',color:'#94a3b8',border:'#64748b',test:i=>i.value===0},
    {id:'q1',label:'1 estudiante',color:'#dbeafe',border:'#2563eb',test:i=>i.value===1},
    {id:'q25',label:'2–5 estudiantes',color:'#7dd3fc',border:'#0369a1',test:i=>i.value>=2&&i.value<=5},
    {id:'q610',label:'6–10 estudiantes',color:'#38bdf8',border:'#075985',test:i=>i.value>=6&&i.value<=10},
    {id:'q1125',label:'11–25 estudiantes',color:'#0284c7',border:'#0c4a6e',test:i=>i.value>=11&&i.value<=25},
    {id:'qgt25',label:'Más de 25 estudiantes',color:'#4c1d95',border:'#2e1065',test:i=>i.value>25}
  ];
}
function legendCategoryForInfo(info){
  return legendCategories().find(c=>c.test(info)) || legendCategories()[0];
}
function sitePassesLegend(site){
  if(!legendSelection.size) return true;
  return legendSelection.has(legendCategoryForInfo(siteMetricInfo(site)).id);
}
function effectiveSites(){ return visibleSites.filter(sitePassesLegend); }
function effectiveCcts(){ return effectiveSites().flatMap(s=>s.ccts); }
function drawSiteMarkers(){
  const coordGroups=new Map();
  effectiveSites().filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)).forEach(s=>{
    const k=`${s.lat.toFixed(7)}|${s.lon.toFixed(7)}`;
    if(!coordGroups.has(k)) coordGroups.set(k,[]); coordGroups.get(k).push(s);
  });
  effectiveSites().filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)).forEach(site=>{
    const group=coordGroups.get(`${site.lat.toFixed(7)}|${site.lon.toFixed(7)}`);
    const idx=group.indexOf(site), angle=2*Math.PI*idx/group.length, radius=group.length>1?0.00007:0;
    const lat=site.lat+Math.sin(angle)*radius, lon=site.lon+Math.cos(angle)*radius;
    const info=siteMetricInfo(site);
    const display=displayedValue(info);
    const cat=legendCategoryForInfo(info);
    const marker=L.circleMarker([lat,lon],{
      renderer:schoolRenderer, pane:'schoolPane',
      radius:markerRadius(display), color:cat.border||'#334155', weight:2.2,
      fillColor:cat.color, fillOpacity:0.94, opacity:1
    });
    marker.bindPopup(buildPopup(site),{maxWidth:380,minWidth:290,autoPan:true});
    marker.on('popupopen',()=>bindPopup(site,marker));
    marker.addTo(schoolLayer);
  });
}
function markerRadius(v){
  if(!v || v<=0) return 6.5;
  return Math.max(7,Math.min(15,7+Math.log10(v+1)*3.8));
}
function metricColor(v,repr,raw,hasRecord=true){ return legendCategoryForInfo({hasRecord,value:raw}).color; }


function buildPopup(site){
  const first=site.ccts[0];
  const source=$('fuenteIndicador').value;
  const group=$('grupoIndigena').value;
  const info=siteMetricInfo(site); const val=info.value; const mat=info.matricula;
  const metricLabel=source==='siieweb'?(group?`${group} (SIIEWEB)`:'Número de estudiantes pertenecientes a un grupo indígena por CCT (SIIEWEB)'):'Número de niños indígenas o hablantes de alguna lengua indígena (Estadística 911)';
  return `<div class="school-popup">
    <h3>${esc(first.nombre)}${site.ccts.length>1?` <small>+${site.ccts.length-1} CCT</small>`:''}</h3>
    <div class="popup-meta">${esc(first.alcaldia)} · ${esc(first.nivel)}<br>${site.ccts.map(x=>esc(x.cct)).join(' · ')}</div>
    <div class="popup-metric"><span>${esc(metricLabel)}</span><br><strong>${val.toLocaleString('es-MX')}</strong></div>
    <button class="popup-open" type="button" data-open-detail>Abrir ficha</button>
  </div>`;
}
function bindPopup(site,marker){
  setTimeout(()=>{
    const el=marker.getPopup()?.getElement();
    const btn=el?.querySelector('[data-open-detail]');
    if(btn) btn.onclick=()=>openDetail(site);
  },0);
}

function openDetail(site){
  const panel=$('detailPanel');
  $('detailTitle').textContent=site.ccts.length>1?'Ficha del plantel / punto':'Ficha del CCT';
  const chooser=site.ccts.length>1?`<div class="cct-chooser">${site.ccts.map((b,i)=>`<button type="button" class="${i===0?'active':''}" data-cct-choice="${esc(b.cct)}">${esc(b.cct)}</button>`).join('')}</div>`:'';
  $('detailContent').innerHTML=chooser+detailHtml(site.ccts[0]);
  panel.classList.add('open'); panel.setAttribute('aria-hidden','false');
  panel.querySelectorAll('[data-cct-choice]').forEach(btn=>btn.onclick=()=>{
    panel.querySelectorAll('[data-cct-choice]').forEach(x=>x.classList.remove('active')); btn.classList.add('active');
    const b=site.ccts.find(x=>x.cct===btn.dataset.cctChoice); const chooserEl=panel.querySelector('.cct-chooser');
    const temp=document.createElement('div'); temp.innerHTML=detailHtml(b); while(chooserEl.nextSibling) chooserEl.nextSibling.remove(); [...temp.childNodes].forEach(n=>panel.appendChild(n));
  });
}
function closeDetail(){ $('detailPanel').classList.remove('open'); $('detailPanel').setAttribute('aria-hidden','true'); }

function detailHtml(b){
  const turno=$('filtroTurno').value;
  const siAll=sourceRowsFor(b.cct,'siieweb',turno);
  const si=siAll.filter(r=>!r.fallback_matricula);
  const s911=sourceRowsFor(b.cct,'911',turno);
  const siTotal=si.length?si.reduce((s,r)=>s+(n(r.total_pertenecientes)||0),0):0;
  const siMatVals=siAll.map(r=>n(r.matricula)).filter(v=>v!==null); const siMat=siMatVals.length?siMatVals.reduce((a,b)=>a+b,0):null;
  const groupTotals=new Map(); si.forEach(r=>Object.entries(r.grupos||{}).forEach(([g,v])=>groupTotals.set(g,(groupTotals.get(g)||0)+(n(v)||0))));
  const groups=[...groupTotals.entries()].filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  const h=s911.length?s911.reduce((s,r)=>s+(n(r.hombres)||0),0):0;
  const m=s911.length?s911.reduce((s,r)=>s+(n(r.mujeres)||0),0):0;
  const t=s911.length?s911.reduce((s,r)=>s+(n(r.total)||0),0):0;
  return `
    <section class="info-card"><h3>General</h3><div class="detail-grid">
      ${detailCell('CCT',b.cct)}${detailCell('Nombre',b.nombre)}${detailCell('Nivel',b.nivel)}${detailCell('Turnos',(b.turnos||[]).join(' / ')||'Sin registro')}
      ${detailCell('Sostenimiento',b.sostenimiento)}${detailCell('Alcaldía',b.alcaldia)}${detailCell('Domicilio',b.domicilio||'Sin registro')}${detailCell('Localidad / colonia',b.localidad||b.colonia||'Sin registro')}
    </div></section>
    <section class="info-card"><h3>Número de estudiantes pertenecientes a un grupo indígena por CCT (SIIEWEB)</h3>
      <div class="detail-grid">${detailCell('Total pertenecientes',fmt(siTotal))}${detailCell('Matrícula total (SIIEWEB)',fmt(siMat))}${detailCell('Turno consultado',turno||'Todos')}</div>
      <div class="group-list" style="margin-top:9px">${groups.length?groups.map(([g,v])=>`<span class="group-tag">${esc(g)}: ${v.toLocaleString('es-MX')}</span>`).join(''):'<span class="muted-box">0 estudiantes reportados.</span>'}</div>
      <p class="source-note">Fuente: SIIEWEB, actualización del 17 de julio de 2026.</p>
    </section>
    <section class="info-card"><h3>Número de niños indígenas o hablantes de alguna lengua indígena (Estadística 911)</h3>
      <div class="detail-grid">${detailCell('Hombres',fmt(h))}${detailCell('Mujeres',fmt(m))}${detailCell('Total',fmt(t))}${detailCell('Turno consultado',turno||'Todos')}</div>
      <p class="source-note">Fuente: Estadística 911. Solo preescolar, primaria y secundaria.</p>
    </section>`;
}
function detailCell(label,value){return `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`}

function countOfficialInmuebles(ccts){
  const wanted=new Set((ccts||[]).map(b=>typeof b==='string'?b:b.cct).filter(Boolean));
  if(!officialInmuebles.length) return effectiveSites().filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)).length;
  return officialInmuebles.filter(inmueble=>
    !/^(COORD-|PROGRAMA-|base-cct-)/i.test(String(inmueble.id||'')) &&
    (inmueble.ccts||[]).some(cct=>wanted.has(cct))
  ).length;
}

function updateStats(){
  const source=$('fuenteIndicador').value;
  const group=$('grupoIndigena').value;
  const rows=effectiveCcts();
  const metric=rows.reduce((s,b)=>s+(b.__metric?.value||0),0);
  const sites=countOfficialInmuebles(rows);
  const matricula=rows.reduce((s,b)=>{
    const rs=sourceRowsFor(b.cct,'siieweb',$('filtroTurno').value);
    const vals=rs.map(r=>n(r.matricula)).filter(v=>v!==null); return s+(vals.length?vals.reduce((a,c)=>a+c,0):0);
  },0);
  $('kpiCct').textContent=rows.length.toLocaleString('es-MX');
  $('kpiPlanteles').textContent=sites.toLocaleString('es-MX');
  $('kpiIndicador').textContent=metric.toLocaleString('es-MX');
  $('kpiMatricula').textContent=matricula.toLocaleString('es-MX');
  const withCoords=rows.filter(b=>Number.isFinite(b.lat)&&Number.isFinite(b.lon)).length;
  let note=`${withCoords.toLocaleString('es-MX')} CCT visibles en mapa; ${(rows.length-withCoords).toLocaleString('es-MX')} sin coordenadas.`;
  if(legendSelection.size) note+=` Rangos activos: ${legendSelection.size}.`;
  if(source==='siieweb'){
    const top=topGroup(rows,$('filtroTurno').value);
    if(top) note+=` Grupo con mayor registro: ${top[0]} (${top[1].toLocaleString('es-MX')}).`;
    if(group) note+=` Filtro activo: ${group}.`;
  }
  $('summaryNote').textContent=note;
}
function topGroup(rows,turno){
  const totals=new Map();
  rows.forEach(b=>sourceRowsFor(b.cct,'siieweb',turno).forEach(r=>Object.entries(r.grupos||{}).forEach(([g,v])=>totals.set(g,(totals.get(g)||0)+(n(v)||0)))));
  return [...totals.entries()].sort((a,b)=>b[1]-a[1])[0]||null;
}

function renderRangeSelector(){
  const cats=legendCategories();
  $('rangeSelector').innerHTML=cats.map(c=>`<button type="button" class="range-option ${legendSelection.has(c.id)?'active':''}" data-range-id="${c.id}"><span class="range-check">${legendSelection.has(c.id)?'✓':''}</span><span class="legend-dot" style="background:${c.color};border-color:${c.border}"></span><span>${c.label}</span></button>`).join('');
  $('rangeSelector').querySelectorAll('[data-range-id]').forEach(btn=>btn.onclick=()=>{
    const id=btn.dataset.rangeId;
    if(legendSelection.has(id)) legendSelection.delete(id); else legendSelection.add(id);
    renderMap(); updateStats(); renderRangeSelector();
  });
}

function renderLegend(){
  const source=$('fuenteIndicador').value;
  const group=$('grupoIndigena').value;
  $('legendTitle').textContent=source==='siieweb'?(group?`${group} (SIIEWEB)`:'Pertenencia a grupo indígena (SIIEWEB)'):'Niños indígenas / hablantes (Estadística 911)';
  const cats=legendCategories();
  $('legendBody').innerHTML=`<div class="legend-help">La simbología representa el número de estudiantes para el indicador seleccionado; los CCT sin registro se muestran como 0.</div>`+
    cats.map(c=>`<div class="legend-row"><span class="legend-dot" style="background:${c.color};border-color:${c.border}"></span><span>${c.label}</span></div>`).join('')+
    `<div class="legend-scale-note">El tamaño del punto aumenta con la cantidad de estudiantes.</div>`;
}


function toggleTheme(){
  dark=!dark; document.body.classList.toggle('dark-mode',dark);
  if(dark){map.removeLayer(lightTiles);darkTiles.addTo(map);}else{map.removeLayer(darkTiles);lightTiles.addTo(map);}
  localStorage.setItem('visor-indigenas-dark',dark?'1':'0');
}
function restoreTheme(){
  dark=localStorage.getItem('visor-indigenas-dark')==='1';
  document.body.classList.toggle('dark-mode',dark);
  if(dark){map.removeLayer(lightTiles);darkTiles.addTo(map);}
}
function setStatus(text,error=false){
  const el=$('mapStatus'); if(!text){el.classList.add('hidden');return;} el.textContent=text; el.classList.remove('hidden'); if(error) el.style.color='#991b1b';
}

