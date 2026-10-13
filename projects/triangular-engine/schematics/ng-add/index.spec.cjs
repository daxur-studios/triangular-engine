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

function assertFlexPageStyles(styles) {
  assert.match(styles, /:host\s*\{\s*position:\s*relative;/);
  assert.doesNotMatch(styles, /\b(?:width|height)\s*:/i);
  assert.doesNotMatch(styles, /\b100(?:vh|vw)\b/i);
  assert.doesNotMatch(styles, /\bscene\s*\{/i);
  assert.doesNotMatch(styles, /display\s*:\s*block/i);
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
  assert(!result.readContent('/src/app/triangular-engine/engine-scene.component.ts').includes('standalone:'));
  assertFlexPageStyles(result.readContent('/src/app/triangular-engine/engine-scene.component.scss'));
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
  source.overwrite('/src/app/app.routes.ts', "export const routes = [{ path: '**', redirectTo: 'game' }];\n");
  const result = await runner().runSchematic('ng-add', { path: 'pages/game', routePath: 'game' }, source);
  assert(result.exists('/src/app/pages/game/engine-scene.component.ts'));
  assertFlexPageStyles(result.readContent('/src/app/pages/game/engine-scene.component.scss'));
  const routes = result.readContent('/src/app/app.routes.ts');
  assert(routes.includes("import('./pages/game/engine-scene.component')"));
  assert(routes.indexOf("path: 'game'") < routes.indexOf("path: '**'"));
  assert.equal(ts.createSourceFile('app.routes.ts', routes, ts.ScriptTarget.Latest).parseDiagnostics.length, 0);
});

test('unsafe component paths and route collisions are rejected', async () => {
  await assert.rejects(runner().runSchematic('ng-add', { path: '../outside' }, fixture()), /relative slash-separated/);
  const source = fixture();
  source.overwrite('/src/app/app.routes.ts', "export const routes = [{ 'path': 'play', component: ExistingPage }];\n");
  await assert.rejects(runner().runSchematic('ng-add', { routePath: 'play' }, source), /already exists with another component/);
});
