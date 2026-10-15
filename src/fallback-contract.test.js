import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DeviceState} from './device-state.js';
import {ModelRegistry} from './model-profiles.js';
const fixture=JSON.parse(await readFile(new URL('./fallback-contract-fixtures/canonical.json',import.meta.url),'utf8'));
function leaves(value,prefix='',out={}){if(value&&typeof value==='object'){for(const [key,child] of Object.entries(value))leaves(child,prefix?`${prefix}.${key}`:key,out);}else out[prefix]=value;return out;}
for(const scenario of fixture.cases)test(`JS/Dart shared contract: ${scenario.name}`,()=>{const store=new DeviceState(new ModelRegistry().resolve(scenario.model));for(const step of scenario.steps){if(step.error)assert.throws(()=>store.apply(step.payload,step.options),{code:step.error});else{const result=store.apply(step.payload,step.options);for(const [key,value]of Object.entries(step.expected??{}))assert.deepEqual(result[key],value);}const state=leaves(store.snapshot());for(const [path,value]of Object.entries(step.checks??{}))assert.deepEqual(state[path],value,path);}});
