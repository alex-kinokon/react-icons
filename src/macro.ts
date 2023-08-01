import { createMacro } from "babel-plugin-macros";
import type { NodePath } from "@babel/core";
import type { Program, ImportSpecifier } from "@babel/types";

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

  for (const referencePath of defaultImport) {
    const parent = referencePath.parent;
    if (!t.isJSXOpeningElement(parent)) return;

    parent.name = t.jsxIdentifier(iconComponent);
    for (const attr of parent.attributes) {
      if (
        t.isJSXAttribute(attr) &&
        t.isJSXIdentifier(attr.name, { name: "icon" }) &&
        t.isStringLiteral(attr.value)
      ) {
        const newId = programPath.scope.generateUid(attr.value.value);
        specs.push(
          t.importSpecifier(t.identifier(newId), t.identifier(attr.value.value))
        );
        attr.value = t.jsxExpressionContainer(t.identifier(newId));
      }
    }
  }
});
