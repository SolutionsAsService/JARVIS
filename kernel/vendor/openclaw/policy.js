// Copyright (c) 2026 OpenClaw Foundation. MIT; see LICENSE and ledger.json.
// Node24 type stripping; replace only original relative import with an in-package shim.
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const original=readFileSync(new URL('./glob-pattern.ts',import.meta.url),'utf8');
const regexp=stripTypeScriptTypes(readFileSync(new URL('./regexp.ts',import.meta.url),'utf8'));
const source=stripTypeScriptTypes(original.replace('import { escapeRegExp } from "../shared/regexp.js";',()=>regexp));
const imported=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
export const {compileGlobPatterns,matchesAnyGlobPattern,mayMatchGlobWithPrefix}=imported;
