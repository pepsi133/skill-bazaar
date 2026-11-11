// Runs against ../board.html. Run: node fmt-test.js
const fs=require('fs');const page=fs.readFileSync(__dirname+'/../board.html','utf8');
function slice(a,b){const i=page.indexOf(a),j=page.indexOf(b,i);if(i<0||j<0)throw new Error('marker not found: '+a+' / '+b);return page.slice(i,j);}
eval(slice('  var LABEL =','  // ---- cards')+';global.fmtText=fmtText');
const q='from:(noreply@example.com) '+'subject:(invitation OR "collaborator" OR repo) '.repeat(4)+'-label:x'; 
const T={
plain:'gitleaks reads a commit before it exists. It matters for every push.\nSecond line of the same paragraph.\n\nSecond paragraph.',
rich:'### Filter\nBefore: `from:a&b <script>alert(1)</script>`\nNow: **blocked**\nYour answer: pick one\n\n- one fact\n- two <b>facts</b>\n\nTail & end',
long:'Query: `'+q.slice(0,200)+'`'};
for(const k in T){console.log('== '+k+' ('+T[k].length+' chars)\nIN:  '+JSON.stringify(T[k])+'\nOUT: '+fmtText(T[k]))}
const o=fmtText(T.rich);console.log('raw <script> present:',/<script/i.test(o),'| escaped present:',o.includes('&lt;script&gt;'),'| raw <b> present:',o.includes('<b>'));
console.log('long code length:',T.long.length-9);
