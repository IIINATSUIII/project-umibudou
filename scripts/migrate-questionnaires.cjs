// Offline migration: never edits a live sheet or the source file.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const source = path.join(__dirname, '../src/lib/questionnaireSchema.ts')
const schema = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: schema })
const [input, output] = process.argv.slice(2)
if (!input) throw new Error('Usage: node scripts/migrate-questionnaires.cjs input.json [NEW-output.json]')
const raw = JSON.parse(fs.readFileSync(input, 'utf8'))
const migrated = Array.isArray(raw) && (raw.length === 0 || !Array.isArray(raw[0]))
  ? raw.map(schema.normalizeQuestionnaireRecord)
  : schema.migrateQuestionnaireTable(Array.isArray(raw) ? raw : raw.values)
console.log(JSON.stringify({ mode: output ? 'write-new-file' : 'dry-run', rows: migrated.length, sourceUnchanged: true }))
if (output) fs.writeFileSync(output, JSON.stringify(migrated, null, 2) + '\n', { flag: 'wx' })
