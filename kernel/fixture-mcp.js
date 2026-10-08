import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
const server=new McpServer({name:'jarvis-owned-fixture',version:'0.1.0'});
server.registerTool('echo',{description:'Owned deterministic bounded fixture; not an installed external server',inputSchema:{text:z.string().max(4096),delayMs:z.number().int().min(0).max(500).optional()}},async({text,delayMs=0},extra)=>{await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,delayMs);extra.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('Cancelled'));},{once:true});});return {content:[{type:'text',text}]};});
await server.connect(new StdioServerTransport());
