import { createMacro } from "babel-plugin-macros";
import type { NodePath } from "@babel/core";
import type {
  Program,
  ImportSpecifier,
  Expression,
  StringLiteral,
  JSXOpeningElement,
} from "@babel/types";

const { name } = [require][0]("./package.json") as { name: string };

export default createMacro(({ references, babel: { types: t } }) => {
  const { default: defaultImport = [] } = references;

  if (!defaultImport.length) return;
  const programPath = defaultImport[0].findParent(t =>
    t.isProgram()
  ) as NodePath<Program>;

  const iconComponent = programPath.scope.generateUid("Icon");
  const specs: ImportSpecifier[] = [];
  programPath.node.body.unshift(
    t.importDeclaration(
      [t.importSpecifier(t.identifier(iconComponent), t.identifier("Icon"))],
      t.stringLiteral(name)
    ),
    t.importDeclaration(specs, t.stringLiteral(`${name}/icons`))
  );

  function replaceLiteral(string: StringLiteral) {
    const newId = programPath.scope.generateUid(string.value);
    specs.push(t.importSpecifier(t.identifier(newId), t.identifier(string.value)));
    return t.identifier(newId);
  }

  function check(exp: Expression): Expression {
    if (t.isConditionalExpression(exp)) {
      exp.consequent = check(exp.consequent);
      exp.alternate = check(exp.alternate);
    } else if (t.isStringLiteral(exp)) {
      return replaceLiteral(exp);
    }
    return exp;
  }

  function handle(parent: JSXOpeningElement) {
    for (const attr of parent.attributes) {
      if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name, { name: "icon" })) {
        const value = attr.value;
        if (t.isJSXExpressionContainer(value)) {
          value.expression = check(value.expression as Expression);
        } else if (t.isStringLiteral(value)) {
          attr.value = t.jsxExpressionContainer(replaceLiteral(value));
        }
      }
    }
  }

  for (const referencePath of defaultImport) {
    const grandparent = referencePath.parentPath?.parentPath;
    const parent = referencePath.parent;
    if (
      t.isMemberExpression(parent) &&
      t.isIdentifier(parent.property, { name: "of" }) &&
      grandparent &&
      t.isCallExpression(grandparent.node) &&
      grandparent.node.arguments.length === 1 &&
      t.isStringLiteral(grandparent.node.arguments[0])
    ) {
      const props = t.identifier("props");
      grandparent.replaceWith(
        t.arrowFunctionExpression(
          [props],
          t.jsxElement(
            t.jsxOpeningElement(
              t.jsxIdentifier(iconComponent),
              [
                t.jsxAttribute(
                  t.jsxIdentifier("icon"),
                  t.jsxExpressionContainer(replaceLiteral(grandparent.node.arguments[0]))
                ),
                t.jsxSpreadAttribute(props),
              ],
              true
            ),
            null,
            [],
            true
          )
        )
      );
    } else if (
      t.isCallExpression(parent) &&
      t.isIdentifier(parent.callee, { name: "styled" }) &&
      parent.arguments[0] === referencePath.node &&
      grandparent != null &&
      t.isVariableDeclarator(grandparent.node) &&
      t.isIdentifier(grandparent.node.id)
    ) {
      parent.arguments[0] = t.identifier(iconComponent);
      const id = grandparent.node.id.name;
      grandparent.scope.bindings[id].referencePaths
        .map(path => path.parentPath)
        .filter(path => t.isJSXOpeningElement(path?.node))
        .forEach(path => handle(path!.node as JSXOpeningElement));
    } else if (t.isJSXOpeningElement(parent)) {
      parent.name = t.jsxIdentifier(iconComponent);
      handle(parent);
    } else {
      throw new Error("Unexpected usage of icon macro");
    }
  }
});
