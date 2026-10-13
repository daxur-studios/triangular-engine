// @ts-check

const ts = require('typescript');
const { SchematicsException } = require('@angular-devkit/schematics');

/** @typedef {import('@angular-devkit/schematics').Tree} Tree */
/** @typedef {{ projects?: Record<string, { projectType?: string, root: string, sourceRoot?: string }> }} AngularWorkspace */

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

/** @param {string} value @param {string} label */
function validateRelativePath(value, label) {
  if (!value || !value.split('/').every(segment => /^[a-zA-Z0-9_-]+$/.test(segment))) {
    throw new SchematicsException(`The ${label} must contain relative slash-separated names, without dot segments or absolute paths.`);
  }
  return value;
}

/** @param {{ root: string, sourceRoot?: string }} project */
function getAppRoot(project) {
  const sourceRoot = project.sourceRoot || `${project.root}/src`;
  return `${sourceRoot.replace(/\/$/, '')}/app`;
}

/** @param {{ selector?: string, className?: string, templateFile?: string }} options */
function componentSource(options = {}) {
  const selector = options.selector || 'app-engine-scene';
  const className = options.className || 'EngineSceneComponent';
  const templateFile = options.templateFile || 'engine-scene.component';
  return `import { Component } from '@angular/core';
import { EngineModule, EngineService } from 'triangular-engine';

@Component({
  selector: '${selector}',
  host: { class: 'flex-page' },
  imports: [EngineModule],
  templateUrl: './${templateFile}.html',
  styleUrl: './${templateFile}.scss',
  providers: [EngineService.provide({ showFPS: true })],
})
export class ${className} {}
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

/** @param {Tree} tree @param {string} routesPath @param {string} routePath @param {string} componentImport @param {string} className */
function addLazyRoute(tree, routesPath, routePath, componentImport, className) {
  const routeContent = tree.read(routesPath);
  if (!routeContent) throw new SchematicsException(`Could not read ${routesPath}.`);
  const sourceText = routeContent.toString();
  const sourceFile = ts.createSourceFile(routesPath, sourceText, ts.ScriptTarget.Latest, true);
  const routesDeclaration = sourceFile.statements
    .filter(ts.isVariableStatement)
    .flatMap(statement => [...statement.declarationList.declarations])
    .find(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === 'routes');
  const routesArray = routesDeclaration?.initializer;
  if (!routesArray || !ts.isArrayLiteralExpression(routesArray)) {
    throw new SchematicsException(`Could not find an exported routes array in ${routesPath}. Add the sample route manually or disable route generation.`);
  }

  const existingRoute = routesArray.elements.find(element => routeHasPath(element, routePath));
  if (existingRoute) {
    if (!existingRoute.getText(sourceFile).includes(componentImport)) {
      throw new SchematicsException(`Route "${routePath}" already exists with another component. Choose a different --route-path or disable route generation.`);
    }
    return;
  }

  const wildcard = routesArray.elements.find(element => routeHasPath(element, '**'));
  const closeBracket = routesArray.getEnd() - 1;
  const beforeClose = sourceText.slice(routesArray.getStart() + 1, closeBracket);
  const hasElements = routesArray.elements.length > 0;
  const hasTrailingComma = beforeClose.trimEnd().endsWith(',');
  const prefix = hasElements && !hasTrailingComma ? ',' : '';
  const routeText = `${wildcard ? '' : prefix}\n  ${lazyRoute(routePath, componentImport, className)}\n`;
  const recorder = tree.beginUpdate(routesPath);
  recorder.insertLeft(wildcard?.getFullStart() ?? closeBracket, routeText);
  tree.commitUpdate(recorder);
}

/** @param {ts.Expression} element @param {string} path */
function routeHasPath(element, path) {
  if (!ts.isObjectLiteralExpression(element)) return false;
  return element.properties.some(property => ts.isPropertyAssignment(property) &&
    (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === 'path' &&
    ts.isStringLiteral(property.initializer) && property.initializer.text === path);
}

/** @param {string} routePath @param {string} componentImport @param {string} className */
function lazyRoute(routePath, componentImport, className) {
  return `{
    path: '${routePath}',
    loadComponent: () =>
      import('${componentImport}').then(
        ({ ${className} }) => ${className},
      ),
  },`;
}

exports.addLazyRoute = addLazyRoute;
exports.componentSource = componentSource;
exports.componentStyles = componentStyles;
exports.componentTemplate = componentTemplate;
exports.getAppRoot = getAppRoot;
exports.resolveProjectName = resolveProjectName;
exports.validateRelativePath = validateRelativePath;
