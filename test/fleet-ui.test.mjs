import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { AgentWorkspaceController, admissionLabels, viewLabels } from '../dist/agent-workspace-controller.js';
import { paneList, fitsLayout } from '../dist/workspace-layout.js';

// DOM adapter test, explicitly not a browser/visual verification.
test('actual fleet handlers keep textarea nodes and drafts stable across polling, split, tab changes and submit', async () => {
  let doc, resize;
  class Node {
    constructor(tag='div',text=''){this.tagName=tag.toUpperCase();this.textContent=text;this.children=[];this.attrs={};this.dataset={};this.style={};this.value='';this.className='';this.hidden=false;this.disabled=false;this.clientWidth=1600;this.clientHeight=900;this.classList={toggle(){}};}
    append(...nodes){for(const n of nodes){if(n.parent)n.parent.children=n.parent.children.filter(x=>x!==n);n.parent=this;this.children.push(n);}}
    replaceChildren(...nodes){for(const n of this.children)n.parent=undefined;this.children=[];this.append(...nodes);}
    get firstChild(){return this.children[0];} get options(){return this.children;} get isConnected(){return !!this.parent;}
    setAttribute(k,v){this.attrs[k]=v;} addEventListener(){} focus(){doc.activeElement=this;}setSelectionRange(){} showModal(){this.open=true;}close(){this.open=false;}
    click(){if(!this.disabled)this.onclick?.();}
  }
  const root=new Node(), storage=new Map(); doc={getElementById:()=>root,createElement:t=>new Node(t),activeElement:null,querySelector:()=>new Node()};
  let c;
  const a=crypto.randomUUID(),b=crypto.randomUUID(), jobs=new Map();
  const client={
    async getAgentOverview(){return {scopeId:'owner-host',maxConcurrent:2,personaSources:{defaultSourceId:'local',sources:[{id:'local',label:'Local'}]},agents:[a,b].map((id,i)=>({profile:{id,name:i?'B':'A',paused:true},admission:'paused',jobs:[...jobs.values()].filter(j=>j.agentId===id)}))};},
    async getAgentJob(agent,id){return jobs.get(id);},
    async enqueueAgentJob(agentId,{input,requestId}){const j={id:crypto.randomUUID(),agentId,input,requestId,status:'queued',latestText:'',activity:[]};jobs.set(j.id,j);return j;},
  };
  const context={document:doc,AgentWorkspaceController:class extends AgentWorkspaceController{constructor(client,options){super(client,{...options,pollMs:0});c=this;}},admissionLabels,viewLabels,paneList,fitsLayout,ResizeObserver:class{constructor(fn){resize=fn;}observe(){}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},window:{},Date,JSON,Map,Promise};
  runInNewContext(readFileSync(new URL('../examples/web/fleet.js',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace('export function createFleet','function createFleet')+'\nthis.createFleet=createFleet;',context);
  const ui=context.createFleet({client}); await ui.connect();
  const all=(node=root)=>[node,...node.children.flatMap(n=>all(n))];
  const buttons=label=>all().filter(n=>n.tagName==='BUTTON'&&n.textContent===label);
  const panes=()=>all().filter(n=>n.className==='fleet-pane');
  const field=(node,label)=>all(node).find(n=>n.attrs['aria-label']===label);
  const first=panes()[0], select=field(first,'에이전트 선택');select.value=a;select.onchange();await c.refresh();
  const draft=field(first,'이 패널의 작업 지시');draft.value='A private draft';draft.oninput();doc.activeElement=draft;
  buttons('좌우 분할')[0].click();assert.equal(panes().length,2);
  const second=panes()[1], selectB=field(second,'에이전트 선택');selectB.value=b;selectB.onchange();await c.refresh();
  const draftB=field(second,'이 패널의 작업 지시');draftB.value='B request';draftB.oninput();
  await c.refresh(); assert.equal(field(panes()[0],'이 패널의 작업 지시'),draft);assert.equal(draft.value,'A private draft');
  second.children.find(n=>n.tagName==='FORM').onsubmit({preventDefault(){}});
  while(c.isBusy(second.dataset.pane))await new Promise(r=>setTimeout(r,0));
  assert.equal([...jobs.values()][0].agentId,b);assert.equal(draft.value,'A private draft');assert.equal(draftB.value,'');
  buttons('+ 탭')[0].click();assert.equal(panes().length,1);buttons('작업 1')[0].click();assert.equal(panes().length,2);assert.equal(field(panes()[0],'이 패널의 작업 지시'),draft);
  assert.equal([...storage.values()].some(v=>v.includes('private draft')),false);
  ui.reset();assert.equal(root.children.find(n=>n.className==='fleet-stage').children.length,0);
});
