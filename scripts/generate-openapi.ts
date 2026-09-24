import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { buildOpenApiDocument } from '../src/openapi/document';

const outDir = path.join(process.cwd(), 'openapi');
mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'openapi.json');
const doc = buildOpenApiDocument();
writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
console.log(`Wrote ${outPath}`);
