import { createMacro } from "babel-plugin-macros";
import { memoize } from "lodash";
import type { NodePath } from "@babel/core";
import type {
  CallExpression,
  Expression,
  ImportSpecifier,
  JSXOpeningElement,
  ObjectProperty,
  Program,
  StringLiteral,
} from "@babel/types";
import { iconMap } from "./iconList";

const name = process.env.PACKAGE_NAME!;

export default createMacro(({ references, babel: { types: t } }) => {
  const { default: defaultImport = [] } = references;

  if (!defaultImport.length) return;
  const programPath = defaultImport[0].findParent(t =>
    t.isProgram()
  ) as NodePath<Program>;

  const iconComponent = programPath.scope.generateUid("Icon");

  const getImportDeclarations = memoize((category: string) => {
    const specs: ImportSpecifier[] = [];
    programPath.node.body.unshift(
      t.importDeclaration(
        [t.importSpecifier(t.identifier(iconComponent), t.identifier("Icon"))],
        t.stringLiteral(name)
      ),
      t.importDeclaration(specs, t.stringLiteral(`${name}/icons/${category}`))
    );
    return specs;
  });

  const importIcon = memoize((string: StringLiteral) => {
    const prefix = iconMap.get(string.value);
    const specs = getImportDeclarations(prefix ?? "icons");
    const newId = programPath.scope.generateUid(string.value);
    specs.push(t.importSpecifier(t.identifier(newId), t.identifier(string.value)));
    return t.identifier(newId);
  });

  function replaceExpression(exp: Expression): Expression {
    if (t.isConditionalExpression(exp)) {
      exp.consequent = replaceExpression(exp.consequent);
      exp.alternate = replaceExpression(exp.alternate);
    } else if (t.isStringLiteral(exp)) {
      return t.cloneNode(importIcon(exp));
    }
    return exp;
  }

  function replaceIconAttribute(parent: JSXOpeningElement) {
    for (const attr of parent.attributes) {
      if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name, { name: "icon" })) {
        const value = attr.value;
        if (t.isJSXExpressionContainer(value)) {
          value.expression = replaceExpression(value.expression as Expression);
        } else if (t.isStringLiteral(value)) {
          attr.value = t.jsxExpressionContainer(t.cloneNode(importIcon(value)));
        }
      }
    }
  }

  for (const referencePath of defaultImport) {
    const grandparent = referencePath.parentPath?.parentPath;
    const parent = referencePath.parent;
    let args: CallExpression["arguments"];

    if (
      t.isMemberExpression(parent) &&
      t.isIdentifier(parent.property, { name: "of" }) &&
      grandparent &&
      t.isCallExpression(grandparent.node) &&
      ((args = grandparent.node.arguments).length === 1 || args.length === 2) &&
      t.isStringLiteral(args[0])
    ) {
      const props = t.identifier("props");
      const [arg0, arg1] = args;
      const attributes: JSXOpeningElement["attributes"] = [
        t.jsxAttribute(
          t.jsxIdentifier("icon"),
          t.jsxExpressionContainer(t.cloneNode(importIcon(arg0)))
        ),
      ];
      if (args.length === 2) {
        // Common case: the second argument is a plain object literal
        if (
          t.isObjectExpression(arg1) &&
          arg1.properties.every(
            prop =>
              t.isObjectProperty(prop) &&
              (t.isIdentifier(prop.key) || t.isStringLiteral(prop.key)) &&
              t.isExpression(prop.value)
          )
        ) {
          for (const { key, value } of arg1.properties as ObjectProperty[]) {
            attributes.push(
              t.jsxAttribute(
                t.jsxIdentifier(
                  t.isIdentifier(key) ? key.name : (key as StringLiteral).value
                ),
                t.isStringLiteral(value)
                  ? value
                  : t.jsxExpressionContainer(value as Expression)
              )
            );
          }
        } else {
          attributes.push(t.jsxSpreadAttribute(arg1 as Expression));
        }
      }
      attributes.push(t.jsxSpreadAttribute(props));

      grandparent.replaceWith(
        t.arrowFunctionExpression(
          [props],
          t.jsxElement(
            t.jsxOpeningElement(t.jsxIdentifier(iconComponent), attributes, true),
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
        .forEach(path => replaceIconAttribute(path!.node as JSXOpeningElement));
    } else if (t.isJSXOpeningElement(parent)) {
      parent.name = t.jsxIdentifier(iconComponent);
      replaceIconAttribute(parent);
    } else {
      throw new Error("Unexpected usage of icon macro");
    }
  }
});
