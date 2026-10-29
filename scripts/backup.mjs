import {Store} from '../server/store.mjs';import {resolve} from 'node:path';
const data=resolve(process.env.DATA_DIR||'data'),store=new Store(data);
try{const name=store.backup();console.log(name?'Consistent database backup: '+data+'/backups/'+name:'No imported books to back up yet.');}finally{store.close();}
