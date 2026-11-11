// Runs against ../board.html. Run: node sliders-test.js
const fs=require('fs');const page=fs.readFileSync(__dirname+'/../board.html','utf8');
function slice(a,b){const i=page.indexOf(a),j=page.indexOf(b,i);if(i<0||j<0)throw new Error('marker not found: '+a+' / '+b);return page.slice(i,j);}
// minimal DOM stub: enough for renderSeg / setSwitch
function el(){const a={},k=[];return{children:k,attrs:a,setAttribute(n,v){a[n]=String(v)},getAttribute(n){return a[n]===undefined?null:a[n]},
 set textContent(v){k.length=0},append(c){k.push(c)},addEventListener(t,fn){(this.l=this.l||{})[t]=fn},focus(){},tabIndex:0,click(){this.l.click()}}}
global.h=(tag,at)=>{const e=el();for(const n in at)if(n!=='text')e.setAttribute(n,at[n]);e.label=at.text;return e};
global.Array=Array;
Array.prototype.indexOf; 
eval(slice('  var PRIO_OPTIONS =','  function render()')+';global.R={renderSeg,setSwitch,areaOptions,PRIO_OPTIONS}');
const f={area:'',prio:'',hide:true,closed:false};
const areas=['drive','github','gmail','vm'];
const abox=el(),pbox=el();
const show=b=>b.children.map(c=>c.label+(c.attrs['aria-checked']==='true'?'*':'')+'/ti'+c.tabIndex).join(' ');
R.renderSeg(abox,R.areaOptions(areas),f.area,v=>f.area=v);
R.renderSeg(pbox,R.PRIO_OPTIONS,f.prio,v=>f.prio=v);
console.log('area initial   :',show(abox));console.log('prio initial   :',show(pbox));
abox.children[3].click();pbox.children[2].click();
R.renderSeg(abox,R.areaOptions(areas),f.area,v=>f.area=v);R.renderSeg(pbox,R.PRIO_OPTIONS,f.prio,v=>f.prio=v);
console.log('after pick     :',JSON.stringify(f),'\n  area',show(abox),'\n  prio',show(pbox));
const before=abox.children[0];R.renderSeg(abox,R.areaOptions(areas),f.area,v=>f.area=v);
console.log('same options keep nodes:',abox.children[0]===before);
R.renderSeg(abox,R.areaOptions(areas.concat('plan')),f.area,v=>f.area=v);
console.log('new area rebuilds:',show(abox));
f.area='gone';R.renderSeg(abox,R.areaOptions(areas),f.area,v=>f.area=v);
console.log('unknown value falls back to All:',show(abox));
const sw=el();sw.addEventListener('click',()=>{f.hide=!f.hide;R.setSwitch(sw,f.hide)});
R.setSwitch(sw,f.hide);console.log('switch start',sw.attrs['aria-checked']);sw.click();console.log('after click',sw.attrs['aria-checked'],f.hide);sw.click();console.log('after 2nd click',sw.attrs['aria-checked'],f.hide);
