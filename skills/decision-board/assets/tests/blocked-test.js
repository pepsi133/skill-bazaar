// Runs against ../board.html. Run: node blocked-test.js
const fs=require('fs');const page=fs.readFileSync(__dirname+'/../board.html','utf8');
function slice(a,b){const i=page.indexOf(a),j=page.indexOf(b,i);if(i<0||j<0)throw new Error('marker not found: '+a+' / '+b);return page.slice(i,j);}
const h=page;
function grab(start,endMarker){const a=h.indexOf(start);const b=h.indexOf(endMarker,a);return h.slice(a,b);}
const code=grab('  function kindOf','  function sortedItems')+grab('  function shownByRules','  function visible')
 .replace(/^[\s\S]*$/,x=>x)+grab('  function sortedItems','  function unsentCount');
const pre='var PRI={now:0,soon:1,later:2};var items=new Map(),resp=new Map();var f={hide:true,closed:false};function isPending(){return false}\n';
// shownByRules sits after visibleBase; grab it up to the next function
const sbr=h.slice(h.indexOf('  function shownByRules'),h.indexOf('  function visible(it)'));
eval(pre+grab('  function kindOf','  function sortedItems').replace(/function sortedItems[\s\S]*/,'')+sbr+grab('  function sortedItems','  function unsentCount')+';global.X={items,resp,f,kindOf,blocksOf,blockedList,sortedItems,shownByRules}');
const L=[
{id:'a',title:'later action',priority:'later',blocks:'mail filters',kind:'action',status:'open',area:'gmail',created:'1'},
{id:'b',title:'now decision',priority:'now',blocks:'backfill',status:'open',area:'vm',created:'2'},
{id:'c',title:'no blocks',priority:'now',status:'open',area:'vm',created:'3'},
{id:'d',title:'blank blocks',priority:'now',blocks:'   ',kind:'action',status:'open',area:'vm',created:'4'},
{id:'e',title:'closed blocker',priority:'now',blocks:'x',status:'closed',area:'vm',created:'5'},
{id:'f',title:'sent blocker',priority:'soon',blocks:'y',status:'open',area:'github',created:'6'},
{id:'g',title:'soon action',priority:'soon',blocks:'phone proof',kind:'action',status:'open',area:'github',created:'7'},
{id:'h',title:'bad kind',priority:'soon',blocks:'z',kind:'weird',status:'open',area:'vm',created:'8'}];
L.forEach(i=>X.items.set(i.id,i));X.resp.set('f',{sent:true});
const show=()=>X.blockedList(X.sortedItems(),X.shownByRules).map(i=>i.id+':'+i.priority+':'+X.kindOf(i)+':'+X.blocksOf(i));
console.log('default      :',show().join(' | '));
X.f.closed=true;console.log('show closed  :',show().join(' | '));
X.f.closed=false;X.f.hide=false;console.log('hide off     :',show().join(' | '));
X.items.clear();console.log('empty list   :',JSON.stringify(show()));
