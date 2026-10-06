const DATA={base:'data/base_cct.json',siieweb:'data/indigenas_siieweb.json',s911:'data/hablantes_911.json'};
const fmt=v=>Number(v||0).toLocaleString('es-MX');
Promise.all(Object.values(DATA).map(p=>fetch(p,{cache:'no-store'}).then(r=>r.json()))).then(([base,si,s911])=>{
 const meta=base.meta||{}, rows=base.registros||[]; const baseMap=new Map(rows.map(r=>[r.cct,r]));
 document.getElementById('statsKpis').innerHTML=[
  ['CCT universo',meta.universo_cct],['CCT con coordenadas',meta.cct_con_coordenadas],['Pertenecientes (SIIEWEB)',meta.total_pertenecientes_siieweb],['Niños indígenas / hablantes (911)',meta.total_911]
 ].map(([l,v])=>`<div class="card"><strong>${fmt(v)}</strong><span>${l}</span></div>`).join('');
 const gt=new Map(); (si.registros||[]).forEach(r=>Object.entries(r.grupos||{}).forEach(([g,v])=>gt.set(g,(gt.get(g)||0)+Number(v||0))));
 const top=[...gt.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15), max=top[0]?.[1]||1;
 document.getElementById('topGroups').innerHTML=top.map(([g,v])=>`<div class="bar-row"><div><div>${g}</div><div class="bar"><i style="width:${v/max*100}%"></i></div></div><strong>${fmt(v)}</strong></div>`).join('');
 const alc=new Map(); rows.forEach(r=>{if(!alc.has(r.alcaldia))alc.set(r.alcaldia,{cct:0,si:0,s911:0});alc.get(r.alcaldia).cct++});
 (si.registros||[]).forEach(r=>{const b=baseMap.get(r.cct);if(b&&alc.has(b.alcaldia))alc.get(b.alcaldia).si+=Number(r.total_pertenecientes||0)});
 (s911.registros||[]).forEach(r=>{const b=baseMap.get(r.cct);if(b&&alc.has(b.alcaldia))alc.get(b.alcaldia).s911+=Number(r.total||0)});
 document.getElementById('alcTable').innerHTML=[...alc.entries()].sort((a,b)=>a[0].localeCompare(b[0],'es')).map(([a,v])=>`<tr><td>${a}</td><td>${fmt(v.cct)}</td><td>${fmt(v.si)}</td><td>${fmt(v.s911)}</td></tr>`).join('');
}).catch(e=>{document.body.innerHTML='<p style="padding:30px">No fue posible cargar las estadísticas.</p>';console.error(e)});
