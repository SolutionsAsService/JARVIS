// Minimal JSON Schema (draft 2020-12 subset) validator for the vendored Autheo v1 schemas.
// Independently authored, MIT. The schema files themselves are copied unchanged from
// SolutionsAsService/autheo-agent-environment@68bfb5550925efadd2fdfaafff5273f63475f219 (MIT);
// see kernel/vendor/autheo/ledger.json. Only the keywords those schemas use are implemented;
// loading a schema with any other keyword throws, so an upstream schema change cannot be
// silently half-validated.
import {readFileSync,readdirSync} from 'node:fs';

export const AUTHEO_SCHEMA_REVISION='68bfb5550925efadd2fdfaafff5273f63475f219';
const KEYWORDS=new Set(['$id','$schema','$defs','title','description','default','type','enum','const','pattern','minimum','maximum','minLength','maxLength','minItems','maxItems','items','properties','required','additionalProperties','anyOf','allOf','$ref']);
const dir=new URL('../vendor/autheo/schemas/',import.meta.url);

function audit(schema,path){
 if(typeof schema==='boolean')return;
 if(!schema||typeof schema!=='object'||Array.isArray(schema))throw new Error('Invalid schema at '+path);
 for(const [k,v] of Object.entries(schema)){
  if(!KEYWORDS.has(k))throw new Error('Unsupported JSON Schema keyword '+k+' at '+path);
  if(k==='properties'||k==='$defs')for(const [name,sub] of Object.entries(v))audit(sub,path+'/'+k+'/'+name);
  else if(k==='items'||k==='additionalProperties')audit(v,path+'/'+k);
  else if(k==='anyOf'||k==='allOf')v.forEach((sub,i)=>audit(sub,path+'/'+k+'/'+i));
  else if(k==='$ref'&&!/^#\/\$defs\/[A-Za-z0-9_]+$/.test(v))throw new Error('Only local $defs references are supported at '+path);
 }
}

export const AUTHEO_SCHEMAS=Object.freeze(Object.fromEntries(readdirSync(dir).filter(f=>f.endsWith('.v1.schema.json')).sort().map(f=>{const schema=JSON.parse(readFileSync(new URL(f,dir),'utf8'));audit(schema,f);return [f.slice(0,-'.v1.schema.json'.length),Object.freeze(schema)];})));

const typeOf=v=>v===null?'null':Array.isArray(v)?'array':typeof v==='number'?(Number.isInteger(v)?'integer':'number'):typeof v;
const typeMatches=(value,type)=>{const t=typeOf(value);return t===type||(type==='number'&&t==='integer');};
const deepEqual=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const patterns=new Map();
const regex=p=>{if(!patterns.has(p))patterns.set(p,new RegExp(p,'u'));return patterns.get(p);};

function check(schema,value,root,path,errors){
 if(schema===true)return;if(schema===false){errors.push(path+': not allowed');return;}
 if(schema.$ref)check(root.$defs[schema.$ref.slice('#/$defs/'.length)],value,root,path,errors);
 if(schema.type!==undefined){const types=Array.isArray(schema.type)?schema.type:[schema.type];if(!types.some(t=>typeMatches(value,t))){errors.push(path+': expected '+types.join('|'));return;}}
 if(schema.const!==undefined&&!deepEqual(schema.const,value))errors.push(path+': must equal '+JSON.stringify(schema.const));
 if(schema.enum&&!schema.enum.some(e=>deepEqual(e,value)))errors.push(path+': not in enum');
 if(typeof value==='string'){const n=[...value].length;if(schema.minLength!==undefined&&n<schema.minLength)errors.push(path+': too short');if(schema.maxLength!==undefined&&n>schema.maxLength)errors.push(path+': too long');if(schema.pattern!==undefined&&!regex(schema.pattern).test(value))errors.push(path+': pattern mismatch');}
 if(typeof value==='number'){if(schema.minimum!==undefined&&value<schema.minimum)errors.push(path+': below minimum');if(schema.maximum!==undefined&&value>schema.maximum)errors.push(path+': above maximum');}
 if(Array.isArray(value)){if(schema.minItems!==undefined&&value.length<schema.minItems)errors.push(path+': too few items');if(schema.maxItems!==undefined&&value.length>schema.maxItems)errors.push(path+': too many items');if(schema.items!==undefined)value.forEach((v,i)=>check(schema.items,v,root,path+'/'+i,errors));}
 if(typeOf(value)==='object'){
  for(const key of schema.required??[])if(!Object.hasOwn(value,key))errors.push(path+': missing '+key);
  for(const [key,v] of Object.entries(value)){if(schema.properties&&Object.hasOwn(schema.properties,key))check(schema.properties[key],v,root,path+'/'+key,errors);else if(schema.additionalProperties!==undefined)check(schema.additionalProperties,v,root,path+'/'+key,errors);}
 }
 if(schema.allOf)for(const sub of schema.allOf)check(sub,value,root,path,errors);
 if(schema.anyOf&&!schema.anyOf.some(sub=>{const e=[];check(sub,value,root,path,e);return e.length===0;}))errors.push(path+': no anyOf branch matched');
}

// Returns a list of error strings (empty = valid). name is the schema file stem, e.g. "receipt".
export function validateAutheoSchema(name,value){const schema=AUTHEO_SCHEMAS[name];if(!schema)throw new Error('Unknown Autheo schema '+name);const errors=[];check(schema,value,schema,'',errors);return errors;}
