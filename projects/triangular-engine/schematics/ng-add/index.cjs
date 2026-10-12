// @ts-check

const ts = require('typescript');
const { SchematicsException } = require('@angular-devkit/schematics');

/** @typedef {import('@angular-devkit/schematics').Tree} Tree */
/** @typedef {{ project?: string, route?: boolean }} NgAddOptions */
/** @typedef {{ projectType?: string, root: string, sourceRoot?: string }} AngularProject */
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
  return (/** @type {Tree} */ tree) => {
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
    const sourceRoot = project.sourceRoot || `${project.root}/src`;
    const appRoot = `${sourceRoot}/app`;
    const componentRoot = `${appRoot}/${COMPONENT_FOLDER}`;
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
      addSceneRoute(tree, routesPath);
    }

    return tree;
  };
}

/** @param {AngularWorkspace} workspace @param {string | undefined} requestedName */
function resolveProjectName(workspace, requestedName) {
  if (requestedName) {
    const project = workspace.projects?.[requestedName];
    if (!project || project.projectType !== 'application') {
      throw new SchematicsException(`Application project "${requestedName}" was not found.`);
    }
    return requestedName;
  }

  const applications = Object.entries(workspace.projects || {}).filter(
    ([, project]) => project.projectType === 'application',
  );
  if (applications.length !== 1) {
    throw new SchematicsException(
      `Found ${applications.length} application projects. Pass --project <name> to choose one.`,
    );
  }
  return applications[0][0];
}

/** @param {Tree} tree @param {string} routesPath */
function addSceneRoute(tree, routesPath) {
  const routeContent = tree.read(routesPath);
  if (!routeContent) {
    throw new SchematicsException(`Could not read ${routesPath}.`);
  }
  const sourceText = routeContent.toString();
  const sourceFile = ts.createSourceFile(routesPath, sourceText, ts.ScriptTarget.Latest, true);
  const routesDeclaration = sourceFile.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 'routes');
  const routesArray = routesDeclaration?.initializer;

  if (!routesArray || !ts.isArrayLiteralExpression(routesArray)) {
    throw new SchematicsException(
      `Could not find an exported routes array in ${routesPath}. Add the sample route manually or pass --route=false.`,
    );
  }

  if (routesArray.elements.some((element) => routeHasPath(element, ROUTE_PATH))) {
    return;
  }

  const closeBracket = routesArray.getEnd() - 1;
  const beforeClose = sourceText.slice(routesArray.getStart() + 1, closeBracket);
  const hasElements = routesArray.elements.length > 0;
  const hasTrailingComma = beforeClose.trimEnd().endsWith(',');
  const prefix = hasElements && !hasTrailingComma ? ',' : '';
  const routeText = `${prefix}\n  ${sceneRoute()}\n`;
  const recorder = tree.beginUpdate(routesPath);
  recorder.insertLeft(closeBracket, routeText);
  tree.commitUpdate(recorder);
}

/** @param {ts.Expression} element @param {string} path */
function routeHasPath(element, path) {
  if (!ts.isObjectLiteralExpression(element)) return false;
  return element.properties.some(
    (property) =>
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === 'path' &&
      ts.isStringLiteral(property.initializer) &&
      property.initializer.text === path,
  );
}

function sceneRoute() {
  return `{
    path: '${ROUTE_PATH}',
    loadComponent: () =>
      import('./${COMPONENT_FOLDER}/engine-scene.component').then(
        ({ EngineSceneComponent }) => EngineSceneComponent,
      ),
  },`;
}

function componentSource() {
  return `import { Component } from '@angular/core';
import { EngineModule, EngineService } from 'triangular-engine';

@Component({
  selector: 'app-engine-scene',
  standalone: true,
  host: { class: 'flex-page' },
  imports: [EngineModule],
  templateUrl: './engine-scene.component.html',
  styleUrl: './engine-scene.component.scss',
  providers: [EngineService.provide({ showFPS: true })],
})
export class EngineSceneComponent {}
`;
}

function componentTemplate() {
  return `<scene [showFps]="true">
  <orbitControls [cameraPosition]="[0, 3, 6]" [target]="[0, 0, 0]" />
  <ambientLight [intensity]="0.7" />
  <directionalLight [position]="[4, 6, 3]" [intensity]="2" />

  <mesh>
    <boxGeometry [params]="[1, 1, 1]" />
    <meshNormalMaterial />
  </mesh>
</scene>
`;
}

function componentStyles() {
  return `:host {
  display: flex;
  flex-direction: column;
  flex: 1 1;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100vh;
}

scene {
  display: flex;
  flex-direction: column;
  flex: 1 1;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
}
`;
}

exports.ngAdd = ngAdd;
