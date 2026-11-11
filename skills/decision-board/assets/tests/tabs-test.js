// Runs against ../board.html. Run: node tabs-test.js
const fs=require('fs');const page=fs.readFileSync(__dirname+'/../board.html','utf8');
function slice(a,b){const i=page.indexOf(a),j=page.indexOf(b,i);if(i<0||j<0)throw new Error('marker not found: '+a+' / '+b);return page.slice(i,j);}
let src=slice('  var TABS =','  function visibleBase');
eval(src+';global.T={TABS,itemSource,inTab,tabCounts}');
const resp=new Map([['c',{sent:true}]]);
const f={hide:true,closed:false,area:'',prio:''};
const base=it=>{const r=resp.get(it.id);if(it.status==='closed'&&!f.closed)return false;if(f.hide&&(it.status==='answered'||(r&&r.sent===true)))return false;return true;};
const items=[
{id:'a',area:'gmail',status:'open'},
{id:'b',area:'github',status:'open'},
{id:'c',area:'gmail',status:'open'},          // sent response: hidden
{id:'d',area:'vm',status:'open'},
{id:'e',area:'vm',source:'github',status:'open'}, // explicit source wins
{id:'f',area:'gmail',source:'other',status:'open'},
{id:'g',area:'github',status:'answered'},       // hidden
{id:'h',area:'plan',source:'bogus',status:'open'}, // invalid source -> area derive
{id:'i',area:'gmail',status:'closed'}];          // hidden
items.forEach(i=>console.log(i.id,i.area,i.source||'-','->',T.itemSource(i)));
console.log('counts hide on :',JSON.stringify(T.tabCounts(items,base)));
f.hide=false;f.closed=true;
console.log('counts all shown:',JSON.stringify(T.tabCounts(items,base)));
