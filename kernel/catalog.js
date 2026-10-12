// Independently authored JARVIS workflow policies; no duplicated upstream skill install.
export function workflowCatalog(actor, workspace, extraCapabilities = []) {
 return [{id:'jarvis.bounded-work', body:'Work only on the admitted goal. Inspect, change, verify, and finish once. Preserve original data. Never reopen a terminal task. Do not infer permission to install tools or publish. Record a blocker when the finite budget is exhausted.',tenant:actor.tenant,workspace,license:'MIT',platforms:['linux','darwin','win32'],permissions:[],capabilities:['text.digest','mcp.fixture.echo',...extraCapabilities],triggers:['verify','bounded'],exclusive:[],dependencies:[]}];
}
// AOS stack catalog (layers, components, task paths). Shared with the frontend; data only.
export {layers as aosLayers,components as aosComponents,flows as aosFlows,statuses as aosStatuses,stackSummary as aosSummary} from '../src/aos-stack.js';
