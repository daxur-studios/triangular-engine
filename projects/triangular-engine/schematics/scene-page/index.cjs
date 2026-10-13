// @ts-check

const { SchematicsException } = require('@angular-devkit/schematics');
const {
  addLazyRoute,
  componentSource,
  componentStyles,
  componentTemplate,
  getAppRoot,
  resolveProjectName,
  validateRelativePath,
} = require('../shared/index.cjs');

/** @typedef {{ name: string, project?: string, route?: boolean, routePath?: string }} ScenePageOptions */
/** @typedef {{ projectType?: string, root: string, sourceRoot?: string }} AngularProject */
/** @typedef {{ projects?: Record<string, AngularProject> }} AngularWorkspace */

/** @param {ScenePageOptions} options @returns {import('@angular-devkit/schematics').Rule} */
function scenePage(options) {
  return tree => {
    const workspacePath = '/angular.json';
    const workspaceContent = tree.read(workspacePath);
    if (!workspaceContent) throw new SchematicsException('Could not find angular.json at the workspace root.');
    const workspace = /** @type {AngularWorkspace} */ (JSON.parse(workspaceContent.toString()));
    const projectName = resolveProjectName(workspace, options.project);
    const project = workspace.projects?.[projectName];
    if (!project) throw new SchematicsException(`Application project "${projectName}" was not found.`);

    const name = normalizeName(options.name);
    const appRoot = getAppRoot(project);
    const componentRoot = name.path ? `${appRoot}/${name.path}` : appRoot;
    const componentBase = `${componentRoot}/${name.fileName}`;
    const files = [
      `${componentBase}.component.ts`,
      `${componentBase}.component.html`,
      `${componentBase}.component.scss`,
    ];
    const existingFiles = files.filter(file => tree.exists(file));
    if (existingFiles.length) {
      throw new SchematicsException(`Cannot generate scene page because these files already exist: ${existingFiles.join(', ')}.`);
    }

    let routesPath;
    let routePath;
    if (options.route) {
      routesPath = `${appRoot}/app.routes.ts`;
      if (!tree.exists(routesPath)) {
        throw new SchematicsException(`Could not find ${routesPath}. Scene page route generation requires a standalone app.routes.ts; pass --route=false to generate the component only.`);
      }
      routePath = validateRelativePath(options.routePath || name.fileName, 'route path');
      // Validate and insert the route before creating files, so malformed routes and collisions are atomic.
      addLazyRoute(tree, routesPath, routePath, `./${name.path ? `${name.path}/` : ''}${name.fileName}.component`, name.className);
    }

    tree.create(files[0], componentSource({
      selector: `app-${name.fileName}`,
      className: name.className,
      templateFile: `${name.fileName}.component`,
    }));
    tree.create(files[1], componentTemplate());
    tree.create(files[2], componentStyles());
    return tree;
  };
}

/** @param {string} rawName */
function normalizeName(rawName) {
  if (!rawName) throw new SchematicsException('Provide a scene page name, for example pages/world.');
  const normalized = rawName.replace(/\\/g, '/');
  const segments = validateRelativePath(normalized, 'scene page name').split('/').map(toKebabCase);
  const fileName = segments.pop();
  if (!fileName || !/[a-z0-9]/.test(fileName)) {
    throw new SchematicsException('The scene page name must end with a component name containing a letter or number.');
  }
  const classBase = fileName.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  const className = `${/^\d/.test(classBase) ? 'Scene' : ''}${classBase}Component`;
  if (!/^[$A-Z_a-z][$\w]*$/.test(className)) {
    throw new SchematicsException(`Cannot form a valid TypeScript component class from "${rawName}".`);
  }
  return { path: segments.join('/'), fileName, className };
}

/** @param {string} value */
function toKebabCase(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase();
}

exports.scenePage = scenePage;
