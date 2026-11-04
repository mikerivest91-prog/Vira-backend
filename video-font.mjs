import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
let font;
// Pango caches font paths for the lifetime of the process. Keep this small file
// outside per-export directories so later renders never refer to a deleted font.
export function videoFont(){return font??=(async()=>{const dir=await mkdtemp(path.join(tmpdir(),'olyvex-font-'));const filename=path.join(dir,'Abel.ttf');await writeFile(filename,Buffer.from((await readFile(new URL('./brand-font.base64',import.meta.url),'utf8')).trim(),'base64'));return filename;})();}
