const fs=require('fs');
const html=fs.readFileSync(process.argv[2],'utf8');
const ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>({id:m[1],i:m.index}));
const wanted=new Set(['runsheet-h','how-h','step-0','step-1','step-2','step-3','step-4','q-adds','plate','questions','reference','q-goal','q-goal-compact','q-ask','q-prompt','q-early','q-cheat','q-auto','q-crash','q-cost','q-codex','q-file']);
const secs=ids.filter(x=>wanted.has(x.id));
const text=html.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
for(const q of process.argv.slice(3)){
  const out=[];let k=0;
  // search in raw html with entities decoded mapping approx: search raw first
  let re=new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g');
  for(const m of html.matchAll(re)){const s=secs.filter(x=>x.i<m.index).pop();out.push(s?s.id:'top');}
  console.log(q.padEnd(50),'|',[...new Set(out)].join(', ')||'-');
}
