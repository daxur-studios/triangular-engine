// @ts-check

const { SchematicsException } = require('@angular-devkit/schematics');
const { NodePackageInstallTask } = require('@angular-devkit/schematics/tasks');
const {
  addLazyRoute,
  componentSource,
  componentStyles,
  componentTemplate,
  getAppRoot,
  resolveProjectName,
  validateRelativePath,
} = require('../shared/index.cjs');

/** @typedef {import('@angular-devkit/schematics').Tree} Tree */
/** @typedef {{ project?: string, route?: boolean, physics?: 'none' | 'jolt', path?: string, routePath?: string }} NgAddOptions */
/** @typedef {string | { glob: string, input: string, output?: string }} AssetPattern */
/** @typedef {{ assets?: AssetPattern[], externalDependencies?: string[] }} BuildOptions */
/** @typedef {{ builder?: string, options?: BuildOptions }} BuildTarget */
/** @typedef {{ projectType?: string, root: string, sourceRoot?: string, architect?: { build?: BuildTarget }, targets?: { build?: BuildTarget } }} AngularProject */
/** @typedef {{ projects?: Record<string, AngularProject> }} AngularWorkspace */

const ROUTE_PATH = 'triangular-engine';
const COMPONENT_FOLDER = 'triangular-engine';

/**
 * Adds a runnable starter scene to a standalone Angular application.
 *
 * Value: turns `ng add triangular-engine` into a verified first scene instead of a package-only install.
 */
/** @param {NgAddOptions} options @returns {import('@angular-devkit/schematics').Rule} */
function ngAdd(options) {
  return (/** @type {Tree} */ tree, /** @type {import('@angular-devkit/schematics').SchematicContext} */ context) => {
    const workspacePath = '/angular.json';
    if (!tree.exists(workspacePath)) {
      throw new SchematicsException('Could not find angular.json at the workspace root.');
    }

    const workspaceContent = tree.read(workspacePath);
    if (!workspaceContent) {
      throw new SchematicsException('Could not read angular.json at the workspace root.');
    }
    const workspace = /** @type {AngularWorkspace} */ (JSON.parse(workspaceContent.toString()));
    const projectName = resolveProjectName(workspace, options.project);
    const project = workspace.projects?.[projectName];
    if (!project) {
      throw new SchematicsException(`Application project "${projectName}" was not found.`);
    }
    const componentFolder = validateRelativePath(options.path ?? COMPONENT_FOLDER, 'component path');
    const routePath = validateRelativePath(options.routePath ?? ROUTE_PATH, 'route path');
    configureBuild(tree, workspacePath, workspace, project, options.physics === 'jolt');
    if (options.physics === 'jolt') {
      installJolt(tree, context);
    }
    const appRoot = getAppRoot(project);
    const componentRoot = `${appRoot}/${componentFolder}`;
    const componentPath = `${componentRoot}/engine-scene.component.ts`;
    const templatePath = `${componentRoot}/engine-scene.component.html`;
    const stylePath = `${componentRoot}/engine-scene.component.scss`;

    if (!tree.exists(componentPath)) {
      tree.create(componentPath, componentSource());
      tree.create(templatePath, componentTemplate());
      tree.create(stylePath, componentStyles());
    }

    if (options.route !== false) {
      const routesPath = `${appRoot}/app.routes.ts`;
      if (!tree.exists(routesPath)) {
        throw new SchematicsException(
          `Could not find ${routesPath}. This starter currently requires a standalone Angular app with app.routes.ts; pass --route=false to install the scene without adding a route.`,
        );
      }
      addLazyRoute(tree, routesPath, routePath, `./${componentFolder}/engine-scene.component`, 'EngineSceneComponent');
    }

    return tree;
  };
}

/**
 * Makes packaged textures and Draco decoders available at the engine's documented URLs.
 * Jolt's Node-only branches stay external in browser builds when physics is selected.
 *
 * @param {Tree} tree
 * @param {string} workspacePath
 * @param {AngularWorkspace} workspace
 * @param {AngularProject} project
 * @param {boolean} withJolt
 */
function configureBuild(tree, workspacePath, workspace, project, withJolt) {
  const build = project.architect?.build ?? project.targets?.build;
  if (!build) throw new SchematicsException('The selected application needs a build target for engine assets.');
  if (withJolt && !['@angular/build:application', '@angular-devkit/build-angular:application', '@angular-devkit/build-angular:browser-esbuild'].includes(build.builder || '')) {
    throw new SchematicsException('Jolt setup requires an Angular application/esbuild builder.');
  }
  const buildOptions = build.options ?? (build.options = {});
  const assets = buildOptions.assets ?? (buildOptions.assets = []);
  const requiredAssets = [
    { glob: '**/*', input: 'node_modules/three/examples/jsm/libs/draco/gltf', output: 'draco/' },
    { glob: '**/*', input: 'node_modules/triangular-engine/assets', output: 'triangular-engine/' },
  ];
  for (const asset of requiredAssets) {
    const destination = asset.output.replace(/^\/+|\/+$/g, '');
    if (!assets.some(entry => typeof entry !== 'string' && (entry.output || '').replace(/^\/+|\/+$/g, '') === destination)) assets.push(asset);
  }
  if (withJolt) {
    buildOptions.externalDependencies = [...new Set([...(buildOptions.externalDependencies || []), 'module', 'node:module'])];
  }
  tree.overwrite(workspacePath, `${JSON.stringify(workspace, null, 2)}\n`);
}

/**
 * Installs the optional Jolt peer without changing an application's existing selection.
 *
 * @param {Tree} tree
 * @param {import('@angular-devkit/schematics').SchematicContext} context
 */
function installJolt(tree, context) {
  const manifest = tree.read('/package.json');
  if (!manifest) throw new SchematicsException('Could not read package.json for Jolt setup.');
  const packageJson = /** @type {{ dependencies?: Record<string, string>, devDependencies?: Record<string, string> }} */ (JSON.parse(manifest.toString()));
  if (packageJson.dependencies?.['jolt-physics'] || packageJson.devDependencies?.['jolt-physics']) return;
  const enginePackage = /** @type {{ peerDependencies: Record<string, string> }} */ (require('../../package.json'));
  (packageJson.dependencies ?? (packageJson.dependencies = {}))['jolt-physics'] = enginePackage.peerDependencies['jolt-physics'];
  tree.overwrite('/package.json', `${JSON.stringify(packageJson, null, 2)}\n`);
  context.addTask(new NodePackageInstallTask());
}

exports.ngAdd = ngAdd;
