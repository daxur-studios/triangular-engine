const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ts = require('typescript');
const { Tree } = require('@angular-devkit/schematics');
const { SchematicTestRunner } = require('@angular-devkit/schematics/testing');

function fixture(projects = { game: { projectType: 'application', root: '', sourceRoot: 'src' } }) {
  const tree = Tree.empty();
  tree.create('/angular.json', JSON.stringify({ projects: Object.fromEntries(
    Object.entries(projects).map(([name, project]) => [name, {
      ...project,
      architect: { build: { builder: '@angular/build:application', options: {} } },
    }]),
  ) }));
  tree.create('/src/app/app.routes.ts', 'export const routes = [] as const;\n');
  return tree;
}

function runner() {
  return new SchematicTestRunner('triangular-engine', path.join(__dirname, '../collection.json'));
}

test('generates conventional standalone page files with shared core scene and flex contract', async () => {
  const sourceTree = fixture();
  const originalRoutes = sourceTree.read('/src/app/app.routes.ts').toString();
  const originalWorkspace = sourceTree.read('/angular.json').toString();
  const instance = runner();
  const result = await instance.runSchematic('scene-page', { name: 'features/play/pages/world' }, sourceTree);
  const base = '/src/app/features/play/pages/world.component';
  const source = result.readContent(`${base}.ts`);
  assert(source.includes("selector: 'app-world'"));
  assert(!source.includes('standalone:'));
  assert(source.includes("host: { class: 'flex-page' }"));
  assert(source.includes("providers: [EngineService.provide({ showFPS: true })]"));
  assert(source.includes('export class WorldComponent {}'));
  assert(result.readContent(`${base}.html`).includes('<scene [showFps]="true">'));
  assert(result.readContent(`${base}.html`).includes('<orbitControls'));
  assert(result.readContent(`${base}.scss`).includes('display: flex'));
  assert.equal(result.readContent('/src/app/app.routes.ts'), originalRoutes);
  assert.equal(result.readContent('/angular.json'), originalWorkspace);
  assert.equal(instance.tasks.length, 0);
});

test('normalizes Pascal and underscore names to kebab files and valid TypeScript identifiers', async () => {
  const result = await runner().runSchematic('scene-page', { name: 'Admin/UserWorld' }, fixture());
  assert(result.exists('/src/app/admin/user-world.component.ts'));
  assert(result.readContent('/src/app/admin/user-world.component.ts').includes('class UserWorldComponent {}'));
  const digitName = await runner().runSchematic('scene-page', { name: '3d-world' }, fixture());
  assert(digitName.readContent('/src/app/3d-world.component.ts').includes('class Scene3dWorldComponent {}'));
});

test('route generation is opt-in and inserts a lazy route before wildcard fallback', async () => {
  const source = fixture();
  source.overwrite('/src/app/app.routes.ts', "export const routes = [{ path: '**', redirectTo: 'home' }];\n");
  const result = await runner().runSchematic('scene-page', {
    name: 'features/play/pages/world', route: true, routePath: 'play/world',
  }, source);
  const routes = result.readContent('/src/app/app.routes.ts');
  assert(routes.includes("import('./features/play/pages/world.component')"));
  assert(routes.includes('WorldComponent'));
  assert(routes.indexOf("path: 'play/world'") < routes.indexOf("path: '**'"));
  assert.equal(ts.createSourceFile('app.routes.ts', routes, ts.ScriptTarget.Latest).parseDiagnostics.length, 0);
});

test('supports an explicit app project and route generation gives actionable missing-file errors', async () => {
  const multi = fixture({ first: { projectType: 'application', root: 'apps/first', sourceRoot: 'apps/first/src' }, second: { projectType: 'application', root: 'apps/second', sourceRoot: 'apps/second/src' } });
  multi.create('/apps/second/src/app/app.routes.ts', 'export const routes = [];\n');
  const result = await runner().runSchematic('scene-page', { name: 'world', project: 'second' }, multi);
  assert(result.exists('/apps/second/src/app/world.component.ts'));
  const missingRoutes = fixture();
  missingRoutes.delete('/src/app/app.routes.ts');
  await assert.rejects(runner().runSchematic('scene-page', { name: 'world', route: true }, missingRoutes), /requires a standalone app\.routes\.ts/);
  await assert.rejects(runner().runSchematic('scene-page', { name: 'world' }, fixture({})), /Found 0 application projects/);
  await assert.rejects(runner().runSchematic('scene-page', { name: 'world' }, multi), /Found 2 application projects/);
});

test('rejects each generated-file conflict before modifying routes', async () => {
  for (const extension of ['ts', 'html', 'scss']) {
    const source = fixture();
    source.create(`/src/app/world.component.${extension}`, 'user-owned');
    const beforeRoutes = source.read('/src/app/app.routes.ts').toString();
    await assert.rejects(runner().runSchematic('scene-page', { name: 'world', route: true }, source), /files already exist/);
    assert.equal(source.read('/src/app/app.routes.ts').toString(), beforeRoutes);
  }
});

test('rejects unsafe names, separator-only names, and route collisions', async () => {
  for (const name of ['../outside', '/absolute', '-', '__']) {
    await assert.rejects(runner().runSchematic('scene-page', { name }, fixture()));
  }
  const source = fixture();
  source.overwrite('/src/app/app.routes.ts', "export const routes = [{ path: 'world', component: ExistingPage }];\n");
  await assert.rejects(runner().runSchematic('scene-page', { name: 'world', route: true }, source), /already exists with another component/);
  assert(!source.exists('/src/app/world.component.ts'));
});
