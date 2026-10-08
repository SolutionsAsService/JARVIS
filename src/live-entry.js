import {mountKernelPanel} from './kernel-client.js';
// Explicit opt-in only. Never alter demo's storage/state or auto-contact endpoints.
if(new URLSearchParams(location.search).get('kernel')==='local'&&location.hostname==='127.0.0.1'){const panel=document.createElement('aside');panel.id='live-kernel';document.body.append(panel);mountKernelPanel(panel);}
