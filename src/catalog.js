export const integrations = [
  { id: 'openclaw', name: 'OpenClaw', symbol: 'OC', role: 'Gateway & orchestration', description: 'Sessions, channels, permissions and model routing. One durable owner for each task.', color: 'orange', state: 'Adapter planned', source: 'https://github.com/openclaw/openclaw' },
  { id: 'gm', name: 'gm', symbol: 'gm', role: 'Bounded development', description: 'Inspect, change, verify, finish. A workflow policy — not a second task orchestrator.', color: 'lime', state: 'Policy modeled', source: 'https://github.com/SolutionsAsService/gm' },
  { id: 'freddie', name: 'Freddie', symbol: 'ƒ', role: 'Plugin execution', description: 'An optional execution adapter with explicit ownership. Never a nested assistant loop.', color: 'purple', state: 'Adapter planned', source: 'https://github.com/SolutionsAsService/freddie' },
  { id: 'mcp', name: 'MCP', symbol: '⌘', role: 'Tools & resources', description: 'Reviewed servers, scoped permissions and explicit install plans. No silent setup.', color: 'blue', state: 'Planner only', source: 'https://modelcontextprotocol.io/' },
];
export const skills = [
  { id:'gm', name:'gm', vendor:'SolutionsAsService', category:'Development', capabilities:['repo.change','repo.verify'], description:'The canonical, bounded path from scoped change to verified result.', preferred:true },
  { id:'legacy-dev', name:'Legacy dev workflow', vendor:'Example imported skill', category:'Development', capabilities:['repo.change','repo.verify'], description:'Sample overlap included to demonstrate conflict resolution. No installed skill was scanned.' },
  { id:'research', name:'Source-first research', vendor:'JARVIS sample', category:'Knowledge', capabilities:['research.verify'], description:'Trace claims to evidence and retain uncertainty.' },
  { id:'browser', name:'Browser verification', vendor:'JARVIS sample', category:'Quality', capabilities:['ui.verify'], description:'Verify the delivered interaction, not just a build or screenshot.' },
  { id:'mcp-review', name:'MCP review', vendor:'JARVIS sample', category:'Tools', capabilities:['mcp.plan'], description:'Generate a permission-scoped installation proposal. No execution.' },
  { id:'handoff', name:'DevHub handoff', vendor:'JARVIS sample', category:'Delivery', capabilities:['devhub.handoff'], description:'Export a versioned handoff for the future DevHub adapter.' },
];
export const servers = [
  { id:'filesystem', name:'Workspace files', transport:'stdio', scope:'Explicit workspace path', permissions:['read selected workspace'], description:'Plan a workspace-scoped file connector. No server/package is installed in this preview.' },
  { id:'github', name:'GitHub', transport:'streamable-http', scope:'Selected repositories', permissions:['read repository metadata'], description:'Plan a repository connector. Authentication and write consent belong on the backend.' },
  { id:'docs', name:'Documentation', transport:'streamable-http', scope:'Allowed documentation origins', permissions:['read approved documentation'], description:'A documentation lookup boundary, not unrestricted network access.' },
];
export const milestones = [
  { stage:'00', title:'A single front door', status:'Available now', body:'Deployable frontend, local task simulation, capability conflict planning, configuration export.', done:true },
  { stage:'01', title:'One owner. One task.', status:'Next', body:'Authenticated backend, durable task records, real process handles, deadlines, cancellation and approval gates.' },
  { stage:'02', title:'Connect the engines', status:'Planned', body:'Version-pinned OpenClaw and Freddie adapters. gm stays policy; MCP stays tool transport.' },
  { stage:'03', title:'A clean capability registry', status:'Planned', body:'Import installed manifests, verify provenance, propose duplicates, confirm migrations and preserve rollback.' },
  { stage:'04', title:'Meet DevHub', status:'Contract needed', body:'Agree on identity, project/task schema and delivery acknowledgement. Then test a real end-to-end handoff.' },
];
