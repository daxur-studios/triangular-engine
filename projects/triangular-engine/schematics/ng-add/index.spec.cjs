const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ts = require('typescript');
const { Tree } = require('@angular-devkit/schematics');
const { SchematicTestRunner } = require('@angular-devkit/schematics/testing');
const enginePackage = require('../../package.json');

function fixture(builder = '@angular/build:application') {
  const tree = Tree.empty();
  tree.create('/angular.json', JSON.stringify({ projects: { game: {
    projectType: 'application', root: '', sourceRoot: 'src',
    architect: { build: { builder, options: {
      assets: [{ glob: '**/*', input: 'public' }],
      externalDependencies: ['existing-external'],
    } } },
  } } }));
  tree.create('/package.json', JSON.stringify({ dependencies: {} }));
  tree.create('/src/app/app.routes.ts', 'export const routes = [];\n');
  return tree;
}

function runner() {
  return new SchematicTestRunner('triangular-engine', path.join(__dirname, '../collection.json'));
}

function buildOptions(tree) {
  return JSON.parse(tree.readContent('/angular.json')).projects.game.architect.build.options;
}

test('base setup supplies decoder/texture assets without opting into physics', async () => {
  const result = await runner().runSchematic('ng-add', {}, fixture());
  const options = buildOptions(result);
  assert.equal(options.assets.length, 3);
  assert(options.assets.some(asset => asset.output === 'draco/'));
  assert(options.assets.some(asset => asset.output === 'triangular-engine/'));
  assert.deepEqual(options.externalDependencies, ['existing-external']);
  assert.deepEqual(JSON.parse(result.readContent('/package.json')).dependencies, {});
  assert(result.readContent('/src/app/triangular-engine/engine-scene.component.ts').includes("class: 'flex-page'"));
});

test('Jolt setup installs its declared peer and configures only the selected build', async () => {
  const instance = runner();
  const result = await instance.runSchematic('ng-add', { physics: 'jolt' }, fixture());
  assert.equal(JSON.parse(result.readContent('/package.json')).dependencies['jolt-physics'], enginePackage.peerDependencies['jolt-physics']);
  assert.deepEqual(buildOptions(result).externalDependencies, ['existing-external', 'module', 'node:module']);
  assert.equal(instance.tasks.length, 1);
});

test('rerunning preserves edits and does not duplicate routes, assets, externals, or installs', async () => {
  const initial = await runner().runSchematic('ng-add', { physics: 'jolt' }, fixture());
  const template = '/src/app/triangular-engine/engine-scene.component.html';
  initial.overwrite(template, initial.readContent(template) + '<!-- owned edit -->\n');
  const instance = runner();
  const result = await instance.runSchematic('ng-add', { physics: 'jolt' }, initial);
  assert(result.readContent(template).includes('owned edit'));
  assert.equal((result.readContent('/src/app/app.routes.ts').match(/path: 'triangular-engine'/g) || []).length, 1);
  assert.equal(buildOptions(result).assets.length, 3);
  assert.deepEqual(buildOptions(result).externalDependencies, ['existing-external', 'module', 'node:module']);
  assert.equal(instance.tasks.length, 0);
});

test('existing decoder mappings and an explicit Jolt package selection are retained', async () => {
  const source = fixture();
  const workspace = JSON.parse(source.read('/angular.json').toString());
  workspace.projects.game.architect.build.options.assets.push({ glob: '**/*', input: 'custom-decoders', output: '/draco/' });
  source.overwrite('/angular.json', JSON.stringify(workspace));
  source.overwrite('/package.json', JSON.stringify({ dependencies: { 'jolt-physics': '1.0.1' } }));
  const instance = runner();
  const result = await instance.runSchematic('ng-add', { physics: 'jolt' }, source);
  assert.equal(buildOptions(result).assets.filter(asset => (asset.output || '').replace(/^\/+|\/+$/g, '') === 'draco').length, 1);
  assert(buildOptions(result).assets.some(asset => asset.input === 'custom-decoders'));
  assert.equal(JSON.parse(result.readContent('/package.json')).dependencies['jolt-physics'], '1.0.1');
  assert.equal(instance.tasks.length, 0);
});

test('unsupported Jolt builders fail with an actionable setup error', async () => {
  await assert.rejects(runner().runSchematic('ng-add', { physics: 'jolt' }, fixture('@angular-devkit/build-angular:browser')), /application\/esbuild builder/);
});

test('custom scene paths register before a wildcard route', async () => {
  const source = fixture();
  source.overwrite('/src/app/app.routes.ts', "export const routes = [{ path: '**', redirectTo: 'play' }];\n");
  const result = await runner().runSchematic('ng-add', { path: 'features/play/pages', routePath: 'play' }, source);
  assert(result.exists('/src/app/features/play/pages/engine-scene.component.ts'));
  const routes = result.readContent('/src/app/app.routes.ts');
  assert(routes.includes("import('./features/play/pages/engine-scene.component')"));
  assert(routes.indexOf("path: 'play'") < routes.indexOf("path: '**'"));
  assert.equal(ts.createSourceFile('app.routes.ts', routes, ts.ScriptTarget.Latest).parseDiagnostics.length, 0);
});

test('unsafe component paths and route collisions are rejected', async () => {
  await assert.rejects(runner().runSchematic('ng-add', { path: '../outside' }, fixture()), /relative slash-separated/);
  const source = fixture();
  source.overwrite('/src/app/app.routes.ts', "export const routes = [{ 'path': 'play', component: ExistingPage }];\n");
  await assert.rejects(runner().runSchematic('ng-add', { routePath: 'play' }, source), /already exists with another component/);
});
