import {createHash} from 'node:crypto';
import {compileGlobPatterns,matchesAnyGlobPattern} from './vendor/openclaw/policy.js';
export const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
export function fail(code,message,status=400){throw Object.assign(new Error(message),{code,status});}
export function scope(actor,tenant,workspace){if(!actor||actor.tenant!==tenant||!actor.workspaces.includes(workspace))fail('forbidden','Scope denied',403);}
export function authorize(actor,capability){const normalize=v=>v.trim().toLowerCase();const denied=compileGlobPatterns({raw:actor?.deniedCapabilities??[],normalize});const allowed=compileGlobPatterns({raw:actor?.capabilities??[],normalize});if(matchesAnyGlobPattern(capability,denied)||!matchesAnyGlobPattern(capability,allowed))fail('capability_denied','Capability denied: '+capability,403);}
export const terminal=new Set(['succeeded','failed','blocked','cancelled','timed_out']);
