/* eslint-disable @typescript-eslint/no-base-to-string */
/* eslint-disable rules/restrict-template-expressions */
// https://github.com/babel-utils/babel-plugin-tester/commit/874cb1896ac96c7e803bc56d2a5886a344f925ff
/// <reference types="bun-types" />
import path from "node:path";
import fs from "node:fs";
import assert from "node:assert";
import { EOL } from "node:os";
import { Script, createContext } from "node:vm";
import { types } from "node:util";
import type * as Babel from "@babel/core";
import debugFactory from "debug";
import {
  type Options as PrettierOptions,
  format as formatWithPrettier,
  resolveConfig as resolvePrettierConfig,
} from "prettier";
import type { Class, Promisable } from "type-fest";
// The transitive dependency "pretty-format" is a dependency of Jest
import type { Plugin as SnapshotSerializer } from "pretty-format";
import { mergeWith } from "lodash";
import stripIndent from "strip-indent";
import { describe, expect, it } from "bun:test";

const { isNativeError } = types;

/**
 * A collection of possible errors and warnings.
 */
const ErrorMessage = {
  BadConfigPluginAndPreset: () =>
    "failed to validate configuration: cannot test a plugin and a preset simultaneously. Specify one set of options or the other",
  BadConfigNoPluginOrPreset: () =>
    "failed to validate configuration: must provide either `plugin` or `preset` option",
  BadConfigInvalidTitleNumbering: () =>
    "failed to validate configuration: invalid `titleNumbering` option",
  BadConfigFixturesNotString: () =>
    "failed to validate configuration: `fixtures`, if defined, must be a string",
  BadConfigInvalidTestsType: () =>
    "failed to validate configuration: `tests`, if defined, must be an array or an object",
  BadConfigInvalidTestsArrayItemType: (index: number) =>
    `failed to validate configuration: \`tests\` array item at index ${index} must be a string, TestObject, or nullish`,
  BadConfigInvalidTestsObjectProperty: (title: string) =>
    `failed to validate configuration: \`tests\` object property "${title}" must have a value of type string, TestObject, or nullish`,
  BadConfigInvalidEndOfLine: (endOfLine: unknown) =>
    `failed to validate configuration: invalid \`endOfLine\` option "${endOfLine}"`,
  BadEnvironmentVariableRange: (name: string, rangeStr: string, range?: Range) =>
    `invalid environment variable "${name}": invalid range ${rangeStr}` +
    (range ? `: ${range.start} is greater than ${range.end}` : ""),
  SetupFunctionFailed: (error: unknown) =>
    `setup function failed: ${isNativeError(error) ? error.message : error}`,
  TeardownFunctionFailed: (functionError: unknown, frameworkError?: unknown) => {
    const frameworkErrorMessage = frameworkError
      ? `\n\nAdditionally, the testing framework reported the following error: ${
          isNativeError(frameworkError) ? frameworkError.message : frameworkError
        }`
      : "";
    return `teardown function failed: ${
      isNativeError(functionError) ? functionError.message : functionError
    }${frameworkErrorMessage}`;
  },
  ExpectedBabelToThrow: () => "expected babel to throw an error, but it did not",
  // eslint-disable-next-line @typescript-eslint/ban-types
  ExpectedErrorToBeInstanceOf: (expectedError: Function | { name?: string }) =>
    `expected error to be an instance of ${expectedError.name || "the expected error"}`,
  ExpectedThrowsFunctionToReturnTrue: () =>
    "expected `throws`/`error` function to return true",
  ExpectedErrorToIncludeString: (resultString: string, expectedError: string) =>
    `expected "${resultString}" to include "${expectedError}"`,
  ExpectedErrorToMatchRegExp: (resultString: string, expectedError: RegExp) =>
    `expected "${resultString}" to match ${expectedError}`,
  BabelOutputTypeIsNotString: (rawBabelOutput: unknown) =>
    `unexpected babel output type "${typeof rawBabelOutput}" (expected string)`,
  BabelOutputUnexpectedlyEmpty: () =>
    "attempted to execute babel output but it was empty. An empty string cannot be evaluated",
  AttemptedToSnapshotUnmodifiedBabelOutput: () =>
    "code was unmodified but attempted to take a snapshot. If the code should not be modified, set `snapshot: false`",
  ExpectedOutputToEqualActual: (
    testConfig:
      | {
          [$type]: Exclude<PluginTesterTestConfig[typeof $type], "fixture-object">;
        }
      | Pick<PluginTesterTestFixtureConfig, typeof $type | "fixtureOutputBasename">
  ) =>
    `actual output does not match ${
      testConfig[$type] === "fixture-object"
        ? testConfig.fixtureOutputBasename
        : "expected output"
    }`,
  ExpectedOutputNotToChange: () => "expected output not to change, but it did",
  ValidationFailed: (title: string, message: string) =>
    `failed to validate configuration for test "${title}": ${message}`,
  InvalidHasCodeAndCodeFixture: () =>
    "`code` cannot be provided with `codeFixture` or `fixture`",
  InvalidHasOutputAndOutputFixture: () =>
    "`output` cannot be provided with `outputFixture`",
  InvalidHasExecAndExecFixture: () => "`exec` cannot be provided with `execFixture`",
  InvalidHasSnapshotAndOutput: () =>
    "neither `output` nor `outputFixture` can be provided with `snapshot` enabled",
  InvalidHasSnapshotAndExec: () =>
    "neither `exec` nor `execFixture` can be provided with `snapshot` enabled",
  InvalidHasSnapshotAndThrows: () =>
    "neither `throws` nor `error` can be provided with `snapshot` enabled",
  InvalidHasSkipAndOnly: () => "cannot enable both `skip` and `only` in the same test",
  InvalidHasThrowsAndOutput: (
    testConfig: Pick<MaybePluginTesterTestConfig, typeof $type>
  ) =>
    testConfig[$type] === "test-object"
      ? "neither `output` nor `outputFixture` can be provided with `throws` or `error`"
      : "a fixture cannot be provided with `throws` or `error` and also contain an output file",
  InvalidHasThrowsAndExec: (
    testConfig: Pick<MaybePluginTesterTestConfig, typeof $type>
  ) =>
    testConfig[$type] === "test-object"
      ? "neither `exec` nor `execFixture` can be provided with `throws` or `error`"
      : "a fixture cannot be provided with `throws` or `error` and also contain an exec file",
  InvalidMissingCodeOrExec: (
    testConfig: Pick<MaybePluginTesterTestConfig, typeof $type>
  ) =>
    /* istanbul ignore next */
    testConfig[$type] === "test-object"
      ? "a string or object with a `code`, `codeFixture`, `fixture`, `exec`, or `execFixture` must be provided"
      : "a fixture must contain either a code file or an exec file",
  InvalidHasExecAndCodeOrOutput: (
    testConfig: Pick<MaybePluginTesterTestConfig, typeof $type>
  ) =>
    testConfig[$type] === "test-object"
      ? "neither `code`, `codeFixture`, `fixture`, `output`, nor `outputFixture` can be provided with `exec` or `execFixture`"
      : "a fixture cannot contain both an exec file and a code or output file",
  InvalidHasBabelrcButNoFilename: () =>
    "`babelOptions.babelrc` is enabled but `babelOptions.filename` was not provided",
  InvalidThrowsType: () =>
    "`throws`/`error` must be a function, string, boolean, RegExp, or Error subtype",
  GenericErrorWithPath: (error: unknown, path: string | undefined) => {
    const message = `${isNativeError(error) ? error.message : error}`;
    // ? Some realms/runtimes don't include the failing path, so we make sure
    return !path || message.includes(path) ? message : `${path}: ${message}`;
  },
  PathIsNotAbsolute: /* istanbul ignore next */ (path: string) =>
    `"${path}" is not an absolute path`,
  UnableToDeriveAbsolutePath: (
    filepath: unknown,
    filepathName: string,
    basename: unknown,
    basenameName: string
  ) =>
    `unable to derive an absolute path from the provided ${filepathName} and ${basenameName}:\n\n${filepathName}: ${filepath}\n${basenameName}: ${basename}`,
};

const parseErrorStackRegExp =
  /at (?:(?<fn>\S+) )?(?:.*? )?\(?(?<path>(?:\/|file:|\w:\\).*?)(?:\)|$)/i;

const parseScriptFilepathRegExp =
  /(\/|\\)babel-plugin-tester(\/|\\)(dist|src)(\/|\\)(index|plugin-tester)\.(j|t)s$/;

const isIntegerRegExp = /^\d+$/;

const isIntegerRangeRegExp = /^(?<startStr>\d+)-(?<endStr>\d+)$/;

const noop = () => undefined;
Object.freeze(noop);

const getDebuggers = (namespace: string, parentDebugger: debugFactory.Debugger) => {
  const debug = parentDebugger.extend(namespace);

  return {
    debug,
    verbose: debug.extend("verbose"),
  };
};

const { debug: debug1, verbose: verbose1 } = getDebuggers(
  "tester",
  debugFactory("babel-plugin-tester")
);

/**
 * A unique symbol that, when included in `babelOptions.plugins`, will be
 * replaced with the plugin under test. Use this symbol to create a custom
 * plugin run order.
 *
 * @see https://npm.im/babel-plugin-tester#custom-plugin-and-preset-run-order
 */
const runPluginUnderTestHere = Symbol.for("@xunnamius/run-plugin-under-test-here");

/**
 * A unique symbol that, when included in `babelOptions.presets`, will be
 * replaced with the preset under test. Use this symbol to create a custom
 * preset run order.
 *
 * @see https://npm.im/babel-plugin-tester#custom-plugin-and-preset-run-order
 */
const runPresetUnderTestHere = Symbol.for("@xunnamius/run-preset-under-test-here");

/**
 * Valid choices for the `titleNumbering` babel-plugin-tester option.
 */
const validTitleNumberingValues = ["all", "tests-only", "fixtures-only", false] as const;

/**
 * Valid choices for the `endOfLine` babel-plugin-tester option.
 */
const validEndOfLineValues = ["lf", "crlf", "auto", "preserve", false] as const;

/**
 * Internal current test counter. Used for automatic title numbering via the
 * `titleNumbering` and `restartTitleNumbering` babel-plugin-tester options.
 */
let currentTestNumber = 1;

/**
 * This function has the same effect as calling `pluginTester` with
 * `restartTitleNumbering: true`.
 */
function restartTestTitleNumbering() {
  debug1("restarted title numbering");
  currentTestNumber = 1;
}

/**
 * An abstraction around babel to help you write tests for your babel plugin or
 * preset.
 */
function pluginTester(options: PluginTesterOptions = {}) {
  debug1("executing main babel-plugin-tester function");

  debug1("global context check succeeded");

  let hasTests = false;
  const baseConfig = resolveBaseConfig();
  const envConfig = resolveConfigFromEnvironmentVariables();
  const normalizedTests = normalizeTests();

  verbose1("base configuration: %O", baseConfig);
  verbose1("environment-derived config: %O", envConfig);
  verbose1("normalized test blocks: %O", normalizedTests);

  if (!hasTests) {
    debug1("terminated early: no valid tests provided");
    return;
  }

  registerTestsWithTestingFramework(normalizedTests);

  debug1("finished registering all test blocks with testing framework");
  debug1("finished executing main babel-plugin-tester function");

  function resolveBaseConfig(): PluginTesterBaseConfig {
    const { debug: debug2, verbose: verbose2 } = getDebuggers("resolve-base", debug1);

    debug2("resolving base configuration");

    const rawBaseConfig = mergeWith(
      {
        babelOptions: {
          parserOpts: {},
          generatorOpts: {},
          babelrc: false,
          configFile: false,
        },
        titleNumbering: "all" as string | false,
        endOfLine: "lf",
        // eslint-disable-next-line @typescript-eslint/require-await
        formatResult: (async r => r) as ResultFormatter,
        snapshot: false,
        fixtureOutputName: "output",
        setup: noop,
        teardown: noop,
      },
      options,
      mergeCustomizer
    );

    verbose2("raw base configuration: %O", rawBaseConfig);

    if (
      (rawBaseConfig.plugin &&
        (rawBaseConfig.preset ||
          rawBaseConfig.presetName ||
          rawBaseConfig.presetOptions)) ||
      (rawBaseConfig.preset &&
        (rawBaseConfig.plugin || rawBaseConfig.pluginName || rawBaseConfig.pluginOptions))
    ) {
      throw new TypeError(ErrorMessage.BadConfigPluginAndPreset());
    }

    if (!validTitleNumberingValues.includes(rawBaseConfig.titleNumbering)) {
      throw new TypeError(ErrorMessage.BadConfigInvalidTitleNumbering());
    }

    const baseConfig: PartialPluginTesterBaseConfig = {
      babel: rawBaseConfig.babel || require("@babel/core"),
      baseBabelOptions: rawBaseConfig.babelOptions,
      titleNumbering: rawBaseConfig.titleNumbering,
      filepath: rawBaseConfig.filepath || rawBaseConfig.filename || tryInferFilepath(),
      endOfLine: rawBaseConfig.endOfLine,
      baseSetup: rawBaseConfig.setup,
      baseTeardown: rawBaseConfig.teardown,
      baseFormatResult: rawBaseConfig.formatResult,
      baseSnapshot: rawBaseConfig.snapshot,
      baseFixtureOutputName: rawBaseConfig.fixtureOutputName,
      baseFixtureOutputExt: rawBaseConfig.fixtureOutputExt,
      fixtures: rawBaseConfig.fixtures,
      tests: rawBaseConfig.tests || [],
    };

    verbose2("partially constructed base configuration: %O", baseConfig);

    if (baseConfig.fixtures !== undefined && typeof baseConfig.fixtures != "string") {
      throw new TypeError(ErrorMessage.BadConfigFixturesNotString());
    }

    if (
      baseConfig.tests !== undefined &&
      !Array.isArray(baseConfig.tests) &&
      (!baseConfig.tests || typeof baseConfig.tests != "object")
    ) {
      throw new TypeError(ErrorMessage.BadConfigInvalidTestsType());
    }

    baseConfig.tests = Array.isArray(baseConfig.tests)
      ? baseConfig.tests.filter((test, ndx) => {
          if (
            Array.isArray(test) ||
            (typeof test != "string" &&
              test !== null &&
              test !== undefined &&
              typeof test != "object")
          ) {
            throw new TypeError(ErrorMessage.BadConfigInvalidTestsArrayItemType(ndx));
          }

          const result = typeof test == "string" || Boolean(test);

          if (!result) {
            debug2(`test item \`%O\` at index ${ndx} was skipped`, test);
          }

          return result;
        })
      : Object.fromEntries(
          Object.entries(baseConfig.tests).filter(([title, test]) => {
            if (
              Array.isArray(test) ||
              (typeof test != "string" &&
                test !== null &&
                test !== undefined &&
                typeof test != "object")
            ) {
              throw new TypeError(
                ErrorMessage.BadConfigInvalidTestsObjectProperty(title)
              );
            }

            const result = typeof test == "string" || Boolean(test);

            if (!result) {
              debug2(`test property "${title}" with value \`%O\` was skipped`, test);
            }

            return result;
          })
        );

    if (rawBaseConfig.plugin) {
      debug2("running in plugin mode");

      baseConfig.plugin = rawBaseConfig.plugin;
      baseConfig.pluginName =
        rawBaseConfig.pluginName || tryInferPluginName() || "unknown plugin";
      baseConfig.basePluginOptions = rawBaseConfig.pluginOptions || {};
    } else if (rawBaseConfig.preset) {
      debug2("running in preset mode");

      baseConfig.preset = rawBaseConfig.preset;
      baseConfig.presetName = rawBaseConfig.presetName || "unknown preset";
      baseConfig.basePresetOptions = rawBaseConfig.presetOptions;
    } else {
      throw new TypeError(ErrorMessage.BadConfigNoPluginOrPreset());
    }

    baseConfig.describeBlockTitle =
      rawBaseConfig.title === false
        ? false
        : rawBaseConfig.title ||
          baseConfig.pluginName ||
          baseConfig.presetName ||
          /* istanbul ignore next */
          undefined;

    debug2("describe block title: %O", baseConfig.describeBlockTitle);

    if (rawBaseConfig.restartTitleNumbering) {
      restartTestTitleNumbering();
    }

    return baseConfig as PluginTesterBaseConfig;

    function tryInferPluginName() {
      debug2("attempting to infer plugin name");

      try {
        // * https://xunn.at/babel-helper-plugin-utils-src
        const { name } = rawBaseConfig.plugin!(
          {
            assertVersion: noop,
            targets: noop,
            assumption: noop,
          },
          {},
          process.cwd()
        );

        debug2("plugin name inference result: %O", name);
        return name;
      } catch {
        debug2("plugin name inference failed");
        return undefined;
      }
    }

    function tryInferFilepath() {
      // ? Allow the end user to unset filepath by setting it to undefined
      if ("filepath" in rawBaseConfig || "filename" in rawBaseConfig) {
        debug2("filepath was manually unset");
        return undefined;
      }

      debug2("attempting to infer filepath");

      const oldStackTraceLimit = Error.stackTraceLimit;
      Error.stackTraceLimit = Number.POSITIVE_INFINITY;

      try {
        let inferredFilepath: string | undefined = undefined;
        // ? Turn the V8 call stack into function names and file paths
        const reversedCallStack = (
          new Error("faux error").stack
            ?.split("\n")
            .map(line => {
              const { fn: functionName, path: filePath } =
                line.match(parseErrorStackRegExp)?.groups || {};

              return filePath
                ? {
                    functionName,
                    // ? Just in case the script name/path has colons
                    filePath: filePath
                      .split(`file://${process.platform === "win32" ? "/" : ""}`)
                      .at(-1)!
                      .split(":")
                      .slice(0, -2)
                      .join(":"),
                  }
                : undefined;
            })
            .filter(<T>(o: T): o is NonNullable<T> => Boolean(o)) ||
          /* istanbul ignore next */ []
        ).reverse();

        verbose2("reversed call stack: %O", reversedCallStack);

        if (reversedCallStack?.length) {
          const referenceIndex = findReferenceStackIndex(reversedCallStack);
          verbose2("reference index: %O", referenceIndex);

          if (referenceIndex) {
            inferredFilepath = reversedCallStack.at(referenceIndex - 1)?.filePath;
          }
        }

        debug2("inferred filepath: %O", inferredFilepath);
        return inferredFilepath;
      } finally {
        Error.stackTraceLimit = oldStackTraceLimit;
      }

      function findReferenceStackIndex(
        reversedCallStack: { functionName: string; filePath: string }[]
      ) {
        // ? Different realms might have slightly different stacks depending on
        // ? which file was imported. Return the first one found.
        return [
          reversedCallStack.findIndex(
            ({ functionName, filePath }) =>
              functionName === "defaultPluginTester" &&
              parseScriptFilepathRegExp.test(filePath)
          ),
          reversedCallStack.findIndex(
            ({ functionName, filePath }) =>
              functionName === "pluginTester" &&
              /* istanbul ignore next */ parseScriptFilepathRegExp.test(filePath)
          ),
          reversedCallStack.findIndex(
            ({ functionName, filePath }) =>
              functionName === "resolveBaseConfig" &&
              parseScriptFilepathRegExp.test(filePath)
          ),
        ].find(ndx => ndx !== -1);
      }
    }
  }

  function resolveConfigFromEnvironmentVariables() {
    const { debug: debug2 } = getDebuggers("resolve-env", debug1);

    debug2("resolving environment variable configuration");

    return {
      skipTestsByRegExp: stringToRegExp(process.env.TEST_SKIP),
      onlyTestsByRegExp: stringToRegExp(process.env.TEST_ONLY),
      skipTestsByRange: stringToRanges("TEST_NUM_SKIP", process.env.TEST_NUM_SKIP),
      onlyTestsByRange: stringToRanges("TEST_NUM_ONLY", process.env.TEST_NUM_ONLY),
    };

    function stringToRegExp(str: string | undefined) {
      return str === undefined ? undefined : new RegExp(str, "u");
    }

    function stringToRanges(name: string, str: string | undefined): (number | Range)[] {
      if (typeof str != "string") {
        return [];
      }

      return str
        .split(",")
        .map(s => {
          s = s.trim();

          if (s) {
            if (isIntegerRegExp.test(s)) {
              return Number(s);
            }

            const { startStr, endStr } = s.match(isIntegerRangeRegExp)?.groups || {};

            if (startStr && endStr) {
              const start = Number(startStr);
              const end = Number(endStr);
              const range = { start, end };

              if (start > end) {
                throw new TypeError(
                  ErrorMessage.BadEnvironmentVariableRange(name, s, range)
                );
              } else if (start === end) {
                return start;
              }

              return range;
            }

            throw new TypeError(ErrorMessage.BadEnvironmentVariableRange(name, s));
          }
        })
        .filter((s): s is NonNullable<typeof s> => Boolean(s));
    }
  }

  function normalizeTests() {
    const { debug: debug2 } = getDebuggers("normalize", debug1);

    debug2("normalizing test items into test objects");

    const { describeBlockTitle, filepath, tests, fixtures } = baseConfig;
    const testsIsArray = Array.isArray(tests);
    const fixturesAbsolutePath = getAbsolutePathUsingFilepathDirname(filepath, fixtures);
    const testConfigs: PluginTesterTestConfig[] = [];

    const useFixtureTitleNumbering =
      baseConfig.titleNumbering === "all" ||
      baseConfig.titleNumbering === "fixtures-only";

    const useTestObjectTitleNumbering =
      baseConfig.titleNumbering === "all" || baseConfig.titleNumbering === "tests-only";

    if (fixturesAbsolutePath) {
      debug2(
        "potentially generating test objects from fixtures path: %O",
        fixturesAbsolutePath
      );

      if (fs.statSync(fixturesAbsolutePath).isDirectory()) {
        debug2("generating test objects from fixtures path");

        const describeBlock =
          typeof describeBlockTitle == "string"
            ? createAndPushDescribeConfig(`${describeBlockTitle} fixtures`)
            : undefined;

        if (describeBlock === undefined) {
          debug2("skipped creating describe block");
        }

        createAndPushFixtureConfigs({
          fixturesDirectory: fixturesAbsolutePath,
          parentDescribeConfig: describeBlock,
        });
      } else {
        debug2("not generating test objects from fixtures path: path is not a directory");
      }
    } else if (typeof fixtures == "string") {
      throw new TypeError(
        ErrorMessage.UnableToDeriveAbsolutePath(
          filepath,
          "`filepath`",
          fixtures,
          "`fixtures`"
        )
      );
    } else {
      debug2("skipped loading fixtures: no fixtures path provided");
    }

    if (tests && (!testsIsArray || tests.length)) {
      debug2("generating test objects from tests");

      const describeBlock =
        typeof describeBlockTitle == "string"
          ? createAndPushDescribeConfig(describeBlockTitle)
          : undefined;

      if (describeBlock === undefined) {
        debug2("skipped creating describe block");
      }

      if (testsIsArray) {
        debug2(`${tests.length} tests were provided via an array`);
        (describeBlock?.tests || testConfigs).push(
          ...tests.map(test => createTestConfig(test))
        );
      } else {
        const entries = Object.entries(tests);
        debug2(`${entries.length} tests were provided via an object`);
        (describeBlock?.tests || testConfigs).push(
          ...entries.map(([title, test]) =>
            createTestConfig({
              title,
              ...(typeof test == "string" ? { code: test } : test),
            })
          )
        );
      }
    } else {
      debug2(
        "skipped loading test objects from tests: no tests object or array provided"
      );
    }

    debug2("finished normalizing tests");
    return testConfigs;

    function createAndPushDescribeConfig(
      describeBlockTitle: PluginTesterTestDescribeConfig["describeBlockTitle"],
      parentDescribeConfig?: PluginTesterTestDescribeConfig
    ) {
      const { debug: debug3 } = getDebuggers("create-desc", debug2);

      debug3("generating new describe block: %O", describeBlockTitle);

      const describeConfig: PluginTesterTestDescribeConfig = {
        [$type]: "describe-block",
        describeBlockTitle,
        tests: [],
      };

      (parentDescribeConfig?.tests || testConfigs).push(describeConfig);
      return describeConfig;
    }

    function createAndPushFixtureConfigs({
      fixturesDirectory,
      fixtureOptions = {},
      parentDescribeConfig,
    }: {
      fixturesDirectory: string;
      fixtureOptions?: FixtureOptions;
      parentDescribeConfig?: PluginTesterTestDescribeConfig;
    }) {
      const { debug: debug3, verbose: verbose3 } = getDebuggers("create-fix", debug2);

      debug3(
        "potentially generating test objects from fixture at path %O",
        fixturesDirectory
      );

      /* istanbul ignore next */
      if (!fs.statSync(fixturesDirectory).isDirectory()) {
        debug3("test objects generation skipped: path is not a directory");
        return;
      }

      const rootOptions = mergeWith(
        { setup: noop, teardown: noop } as object,
        fixtureOptions,
        readFixtureOptions(fixturesDirectory),
        mergeCustomizer
      );

      verbose3("root options: %O", rootOptions);

      fs.readdirSync(fixturesDirectory).forEach(filename => {
        const fixtureSubdir = path.join(fixturesDirectory, filename);

        debug3(
          "potentially generating new test object from fixture at subpath %O",
          fixtureSubdir
        );

        if (!fs.statSync(fixtureSubdir).isDirectory()) {
          debug3("test object generation skipped: subpath is not a directory");
          return;
        }

        const blockTitle = filename.split("-").join(" ");
        const localOptions = mergeWith(
          {},
          rootOptions,
          readFixtureOptions(fixtureSubdir),
          mergeCustomizer
        );

        verbose3("localOptions: %O", localOptions);

        const directoryFiles = fs
          .readdirSync(fixtureSubdir, { withFileTypes: true })
          .filter(file => file.isFile());

        const { name: codeFilename } =
          directoryFiles.find(file => file.name.startsWith("code.")) || {};

        const { name: execFilename } =
          directoryFiles.find(file => file.name.startsWith("exec.")) || {};

        verbose3("code filename: %O", codeFilename);
        verbose3("exec filename: %O", execFilename);

        // ! Code in the else branch is relying specifically on this check
        if (!codeFilename && !execFilename) {
          debug3(
            "no code or exec file found in subpath. Skipped generating test object. Subpath will be scanned for nested fixtures"
          );

          createAndPushFixtureConfigs({
            fixturesDirectory: fixtureSubdir,
            fixtureOptions: localOptions,
            parentDescribeConfig: createAndPushDescribeConfig(
              blockTitle,
              parentDescribeConfig
            ),
          });
        } else {
          debug3(
            "code or exec file found in subpath. Skipped scanning for nested fixtures. Test object will be generated"
          );

          const codePath = codeFilename
            ? path.join(fixtureSubdir, codeFilename)
            : undefined;

          const execPath = execFilename
            ? path.join(fixtureSubdir, execFilename)
            : undefined;

          const hasBabelrc = [
            ".babelrc",
            ".babelrc.json",
            ".babelrc.js",
            ".babelrc.cjs",
            ".babelrc.mjs",
          ].some(p => fs.existsSync(path.join(fixtureSubdir, p)));

          const {
            plugin,
            basePluginOptions,
            preset,
            basePresetOptions,
            baseBabelOptions,
            endOfLine,
            baseFormatResult,
            baseFixtureOutputExt,
            baseFixtureOutputName,
          } = baseConfig;

          const {
            babelOptions,
            pluginOptions,
            presetOptions,
            title,
            only,
            skip,
            throws,
            error,
            setup,
            teardown,
            formatResult,
            fixtureOutputName,
            fixtureOutputExt,
          } = localOptions;

          // ? trimAndFixLineEndings is called later on the babel output instead
          const code = readCode(codePath);

          // ? trimAndFixLineEndings is called later on the babel output instead
          const exec = readCode(execPath);

          const outputExtension = (
            fixtureOutputExt ||
            baseFixtureOutputExt ||
            // ? It is impossible for any of the following to be undefined
            (codeFilename || execFilename)!.split(".").pop()!
          ).replace(/^\./, "");

          const fixtureOutputBasename = `${
            fixtureOutputName || baseFixtureOutputName
          }.${outputExtension}`;

          const outputPath = path.join(fixtureSubdir, fixtureOutputBasename);

          const hasOutputFile = outputPath && fs.existsSync(outputPath);

          const output = hasOutputFile
            ? trimAndFixLineEndings(readCode(outputPath), endOfLine, code)
            : undefined;

          const testConfig: MaybePluginTesterTestFixtureConfig = mergeWith(
            { [$type]: "fixture-object" } as const,
            // ! Keep the # of source objects to <=4 to get type inference
            { babelOptions: baseBabelOptions },
            {
              babelOptions: {
                // ? It is impossible for the following to be undefined
                filename: (codePath || execPath) as string,
                // ? If they have a babelrc, then we'll let them use that
                babelrc: hasBabelrc,
              },
            },
            { babelOptions: babelOptions || {} },
            {
              // ? This is last to ensure plugins/presets babelOptions are
              // ? always arrays
              babelOptions: { plugins: [], presets: [] },
              testBlockTitle: (() => {
                const titleString = title || blockTitle;
                if (useFixtureTitleNumbering) {
                  const numericPrefix = currentTestNumber++;
                  return {
                    numericPrefix,
                    titleString,
                    fullString: `${numericPrefix}. ${titleString}`,
                  };
                } else {
                  return {
                    numericPrefix: undefined,
                    titleString,
                    fullString: titleString,
                  };
                }
              })(),
              only,
              skip,
              expectedError: throws ?? error,
              testSetup: setup || /* istanbul ignore next */ noop,
              testTeardown: teardown || noop,
              formatResult: formatResult || baseFormatResult,
              fixtureOutputBasename,
              code,
              codeFixture: codePath,
              output,
              outputFixture: outputPath,
              exec,
              execFixture: execPath,
            },
            mergeCustomizer
          );

          verbose3("partially constructed fixture-based test object: %O", testConfig);

          if (plugin) {
            testConfig.babelOptions.plugins.push([
              plugin,
              mergeWith({}, basePluginOptions, pluginOptions, mergeCustomizer),
            ]);
          } else {
            testConfig.babelOptions.presets.unshift([
              preset,
              mergeWith({}, basePresetOptions, presetOptions, mergeCustomizer),
            ]);
          }

          finalizePluginAndPresetRunOrder(testConfig.babelOptions);
          verbose3("finalized fixture-based test object: %O", testConfig);

          validateTestConfig(testConfig);
          hasTests = true;

          (parentDescribeConfig?.tests || testConfigs).push(testConfig);
        }
      });
    }

    function createTestConfig(testObject: string | TestObject) {
      const { verbose: verbose3 } = getDebuggers("create-obj", debug2);

      verbose3("generating new test object");

      if (typeof testObject === "string") {
        testObject = { code: testObject };
      }

      verbose3("raw test object: %O", testObject);

      const {
        plugin,
        pluginName,
        basePluginOptions,
        preset,
        presetName,
        basePresetOptions,
        baseBabelOptions,
        endOfLine,
        baseFormatResult,
        baseSnapshot,
      } = baseConfig;

      const {
        babelOptions,
        pluginOptions,
        presetOptions,
        title,
        only,
        skip,
        throws,
        error,
        setup,
        teardown,
        formatResult,
        snapshot,
        code: rawCode,
        output: rawOutput,
        exec: rawExec,
        fixture,
        codeFixture: rawCodeFixture,
        outputFixture,
        execFixture: rawExecFixture,
      } = mergeWith(
        {
          setup: noop,
          teardown: noop,
        } as object,
        testObject,
        mergeCustomizer
      );

      const codeFixture = getAbsolutePathUsingFilepathDirname(
        filepath,
        rawCodeFixture ?? fixture
      );

      const execFixture = getAbsolutePathUsingFilepathDirname(filepath, rawExecFixture);

      const code = rawCode !== undefined ? stripIndent(rawCode) : readCode(codeFixture);

      const output =
        rawOutput !== undefined
          ? stripIndent(rawOutput)
          : readCode(filepath, outputFixture);

      const exec = rawExec ?? readCode(execFixture);

      const testConfig: MaybePluginTesterTestObjectConfig = mergeWith(
        { [$type]: "test-object" } as const,
        // ! Keep the # of source objects to <=4 to get type inference
        { babelOptions: baseBabelOptions },
        {
          babelOptions: {
            filename: codeFixture || execFixture || filepath || baseBabelOptions.filename,
          },
        },
        { babelOptions: babelOptions || {} },
        {
          // ? This is last to ensure plugins/presets babelOptions are always
          // ? arrays
          babelOptions: { plugins: [], presets: [] },
          snapshot: snapshot ?? baseSnapshot,
          testBlockTitle: (() => {
            const titleString = (title || pluginName || presetName) as string;
            if (useTestObjectTitleNumbering) {
              const numericPrefix = currentTestNumber++;
              return {
                numericPrefix,
                titleString,
                fullString: `${numericPrefix}. ${titleString}`,
              };
            } else {
              return {
                numericPrefix: undefined,
                titleString,
                fullString: titleString,
              };
            }
          })(),
          only,
          skip,
          expectedError: throws ?? error,
          testSetup: setup || /* istanbul ignore next */ noop,
          testTeardown: teardown || noop,
          formatResult: formatResult || baseFormatResult,
          // ? trimAndFixLineEndings is called later on the babel output instead
          code,
          codeFixture,
          output:
            output !== undefined
              ? trimAndFixLineEndings(output, endOfLine, code)
              : undefined,
          outputFixture,
          exec,
          execFixture:
            exec !== undefined
              ? execFixture || filepath || baseBabelOptions.filename || undefined
              : undefined,
        },
        mergeCustomizer
      );

      verbose3("partially constructed test object: %O", testConfig);

      if (plugin) {
        testConfig.babelOptions.plugins.push([
          plugin,
          mergeWith({}, basePluginOptions, pluginOptions, mergeCustomizer),
        ]);
      } else {
        testConfig.babelOptions.presets.unshift([
          preset,
          mergeWith({}, basePresetOptions, presetOptions, mergeCustomizer),
        ]);
      }

      finalizePluginAndPresetRunOrder(testConfig.babelOptions);
      verbose3("finalized test object: %O", testConfig);

      validateTestConfig(testConfig, {
        hasCodeAndCodeFixture: !!(rawCode && codeFixture),
        hasOutputAndOutputFixture: !!(rawOutput && outputFixture),
        hasExecAndExecFixture: !!(rawExec && execFixture),
      });

      hasTests = true;
      return testConfig;
    }
  }

  function registerTestsWithTestingFramework(tests: PluginTesterTestConfig[]) {
    const { debug: debug2 } = getDebuggers("register", debug1);

    debug2(`registering ${tests.length} blocks with testing framework`);

    tests.forEach(testConfig => {
      if (testConfig[$type] === "describe-block") {
        debug2(
          `registering describe block "${testConfig.describeBlockTitle}" and its sub-blocks`
        );
        describe(testConfig.describeBlockTitle, () => {
          registerTestsWithTestingFramework(testConfig.tests);
        });
      } else {
        const {
          skip,
          only,
          testBlockTitle: { numericPrefix, titleString, fullString },
        } = testConfig;

        let method: "skip" | "only" | undefined = undefined;

        if (
          envConfig.skipTestsByRegExp?.test(titleString) ||
          numericPrefixInRanges(numericPrefix, envConfig.skipTestsByRange)
        ) {
          method = "skip";
          debug2(
            `registering test block "${fullString}" (with \`skip\` property enabled via environment variable)`
          );
        } else if (
          envConfig.onlyTestsByRegExp?.test(titleString) ||
          numericPrefixInRanges(numericPrefix, envConfig.onlyTestsByRange)
        ) {
          method = "only";
          debug2(
            `registering test block "${fullString}" (with \`only\` property enabled via environment variable)`
          );
        } else if (skip) {
          method = "skip";
          debug2(
            `registering test block "${fullString}" (with \`skip\` property enabled)`
          );
        } else if (only) {
          method = "only";
          debug2(
            `registering test block "${fullString}" (with \`only\` property enabled)`
          );
        } else {
          debug2(`registering test block "${fullString}"`);
        }

        (method ? it[method] : it)(fullString, frameworkTestWrapper(testConfig));
      }
    });
  }

  function frameworkTestWrapper(
    testConfig: PluginTesterTestObjectConfig | PluginTesterTestFixtureConfig
  ) {
    const { verbose: verbose2 } = getDebuggers("wrapper", debug1);

    return async () => {
      const { baseSetup, baseTeardown } = baseConfig;
      const { testSetup, testTeardown } = testConfig;
      const setupFunctions = [baseSetup, testSetup];
      const teardownFunctions = [testTeardown, baseTeardown];

      for (const [index, setupFn] of setupFunctions.entries()) {
        verbose2(
          `running setup function #${index + 1}${setupFn === noop ? " (noop)" : ""}`
        );

        try {
          // eslint-disable-next-line no-await-in-loop
          const maybeTeardownFn = await setupFn();

          if (typeof maybeTeardownFn === "function") {
            verbose2(
              `registered teardown function returned from setup function #${index + 1}`
            );
            teardownFunctions.splice(index - 1, 0, maybeTeardownFn);
          }
        } catch (error) {
          const message = ErrorMessage.SetupFunctionFailed(error);
          verbose2(message);
          throw new Error(message, { cause: error });
        }
      }

      let frameworkError: unknown;

      try {
        await frameworkTest(testConfig);
      } catch (error) {
        frameworkError = error;
        verbose2("caught framework test failure");
      } finally {
        for (const [index, teardownFn] of teardownFunctions.entries()) {
          verbose2(
            `running teardown function #${index + 1}${
              teardownFn === noop ? " (noop)" : ""
            }`
          );

          try {
            // eslint-disable-next-line no-await-in-loop
            await teardownFn();
          } catch (error) {
            // ? Ensure we don't swallow any errors from frameworkTest
            const message = ErrorMessage.TeardownFunctionFailed(error, frameworkError);
            verbose2(message);
            // eslint-disable-next-line no-unsafe-finally
            throw new Error(message, { cause: { error, frameworkError } });
          }
        }

        // ? Ensure we don't swallow any errors from frameworkTest
        if (frameworkError) {
          verbose2("rethrowing framework test failure");
          // eslint-disable-next-line no-unsafe-finally
          throw frameworkError;
        }
      }
    };
  }

  async function frameworkTest(
    testConfig: PluginTesterTestObjectConfig | PluginTesterTestFixtureConfig
  ) {
    const { debug: debug2, verbose: verbose2 } = getDebuggers("test", debug1);

    const { babel, endOfLine, filepath } = baseConfig;
    const {
      babelOptions,
      testBlockTitle,
      expectedError,
      formatResult,
      code,
      codeFixture,
      output,
      outputFixture,
      exec,
      execFixture,
    } = testConfig;

    debug2(`test framework has triggered test "${testBlockTitle.fullString}"`);

    let errored = false;

    const rawBabelOutput = await (async () => {
      try {
        const transformer = babel.transformAsync || babel.transform;
        const parameters = [code ?? exec, babelOptions] as const;
        verbose2(
          `calling babel transform function (${transformer.name}) with parameters: %O`,
          parameters
        );
        return (await transformer(...parameters))?.code;
      } catch (error) {
        verbose2(`babel transformation failed with error: ${error}`);
        if (expectedError) {
          errored = true;
          return error;
        } else {
          throw error;
        }
      }
    })();

    try {
      if (expectedError) {
        debug2("expecting babel transform function to fail with error");
        assert(errored, ErrorMessage.ExpectedBabelToThrow());

        if (typeof expectedError === "function") {
          if (expectedError === Error || expectedError.prototype instanceof Error) {
            assert(
              rawBabelOutput instanceof expectedError,
              ErrorMessage.ExpectedErrorToBeInstanceOf(expectedError)
            );
          } else if (
            (expectedError as Exclude<typeof expectedError, Class<Error>>)(
              rawBabelOutput
            ) !== true
          ) {
            assert.fail(ErrorMessage.ExpectedThrowsFunctionToReturnTrue());
          }
        } else {
          const resultString = isNativeError(rawBabelOutput)
            ? rawBabelOutput.message
            : String(rawBabelOutput);

          if (typeof expectedError === "string") {
            assert(
              resultString.includes(expectedError),
              ErrorMessage.ExpectedErrorToIncludeString(resultString, expectedError)
            );
          } else if (expectedError instanceof RegExp) {
            assert(
              expectedError.test(resultString),
              ErrorMessage.ExpectedErrorToMatchRegExp(resultString, expectedError)
            );
          } // ? Else condition is handled by the typeof === 'function' branch
        }
      } else if (typeof rawBabelOutput !== "string") {
        throw new TypeError(ErrorMessage.BabelOutputTypeIsNotString(rawBabelOutput));
      } else {
        debug2("expecting babel transform function to succeed");
        const formatResultFilepath = codeFixture || execFixture || filepath;

        // ? We split rawBabelOutput and result into two steps to ensure
        // ? exceptions thrown by trimAndFixLineEndings and formatResult are not
        // ? erroneously captured when we only really care about errors thrown by
        // ? babel
        const result = trimAndFixLineEndings(
          await formatResult(rawBabelOutput || "", {
            cwd: formatResultFilepath ? path.dirname(formatResultFilepath) : undefined,
            filepath: formatResultFilepath,
            filename: formatResultFilepath,
          }),
          endOfLine,
          code
        );

        if (exec !== undefined) {
          debug2("executing output from babel transform function");

          assert(result.length > 0, ErrorMessage.BabelOutputUnexpectedlyEmpty());

          const fakeModule = { exports: {} };
          const context = createContext({
            ...globalThis,
            module: fakeModule,
            exports: fakeModule.exports,
            require,
            __dirname: path.dirname(execFixture),
            __filename: execFixture,
          });

          new Script(result, { filename: execFixture }).runInContext(context, {
            displayErrors: true,
            breakOnSigint: true,
            // @ts-expect-error: not sure from the docs if this is a type error
            microtaskMode: "afterEvaluate",
          });
        } else if (testConfig[$type] === "test-object" && testConfig.snapshot) {
          debug2("expecting output from babel transform function to match snapshot");

          assert(
            result !== code,
            ErrorMessage.AttemptedToSnapshotUnmodifiedBabelOutput()
          );

          const separator = "\n\n      ↓ ↓ ↓ ↓ ↓ ↓\n\n";
          const formattedOutput = [code, separator, result].join("");

          expect(`\n${formattedOutput}\n`).toMatchSnapshot(testBlockTitle.fullString);
        } else if (output !== undefined) {
          debug2(
            "expecting output from babel transform function to match expected output"
          );

          assert.equal(
            result,
            output,
            ErrorMessage.ExpectedOutputToEqualActual(testConfig)
          );
        } else if (testConfig[$type] === "fixture-object" && outputFixture) {
          debug2("writing output from babel transform function to new output file");
          fs.writeFileSync(outputFixture, result);
        } else {
          debug2("expecting output from babel transform function to match input");
          assert.equal(
            result,
            trimAndFixLineEndings(code, endOfLine),
            ErrorMessage.ExpectedOutputNotToChange()
          );
        }
      }
    } catch (error) {
      verbose2(`test failed: ${error}`);
      throw error;
    }
  }

  function validateTestConfig<
    T extends MaybePluginTesterTestObjectConfig | MaybePluginTesterTestFixtureConfig,
  >(
    testConfig: T,
    knownViolations?: {
      hasCodeAndCodeFixture: boolean;
      hasOutputAndOutputFixture: boolean;
      hasExecAndExecFixture: boolean;
    }
  ): // * See: https://stackoverflow.com/a/71741336/1367414
  // @ts-expect-error: encountering the limits of type inference as of 4.9.4
  asserts testConfig is T extends MaybePluginTesterTestObjectConfig
    ? PluginTesterTestObjectConfig
    : PluginTesterTestFixtureConfig {
    const { verbose: verbose2 } = getDebuggers("validate", debug1);
    verbose2("known violations: %O", knownViolations);

    const {
      testBlockTitle,
      skip,
      only,
      code,
      exec,
      output,
      babelOptions,
      expectedError,
    } = testConfig;

    if (knownViolations) {
      const { hasCodeAndCodeFixture, hasOutputAndOutputFixture, hasExecAndExecFixture } =
        knownViolations;

      if (hasCodeAndCodeFixture) {
        throwTypeErrorWithDebugOutput(ErrorMessage.InvalidHasCodeAndCodeFixture());
      }

      if (hasOutputAndOutputFixture) {
        throwTypeErrorWithDebugOutput(ErrorMessage.InvalidHasOutputAndOutputFixture());
      }

      if (hasExecAndExecFixture) {
        throwTypeErrorWithDebugOutput(ErrorMessage.InvalidHasExecAndExecFixture());
      }
    }

    if (testConfig[$type] === "test-object" && testConfig.snapshot) {
      if (output !== undefined) {
        throwTypeErrorWithDebugOutput(ErrorMessage.InvalidHasSnapshotAndOutput());
      }

      if (exec !== undefined) {
        throwTypeErrorWithDebugOutput(ErrorMessage.InvalidHasSnapshotAndExec());
      }

      if (expectedError !== undefined) {
        throwTypeErrorWithDebugOutput(ErrorMessage.InvalidHasSnapshotAndThrows());
      }
    }

    if (skip && only) {
      throwTypeErrorWithDebugOutput(ErrorMessage.InvalidHasSkipAndOnly());
    }

    if (output !== undefined && expectedError !== undefined) {
      throwTypeErrorWithDebugOutput(ErrorMessage.InvalidHasThrowsAndOutput(testConfig));
    }

    if (exec !== undefined && expectedError !== undefined) {
      throwTypeErrorWithDebugOutput(ErrorMessage.InvalidHasThrowsAndExec(testConfig));
    }

    if (code === undefined && exec === undefined) {
      throwTypeErrorWithDebugOutput(ErrorMessage.InvalidMissingCodeOrExec(testConfig));
    }

    if ((code !== undefined || output !== undefined) && exec !== undefined) {
      throwTypeErrorWithDebugOutput(
        ErrorMessage.InvalidHasExecAndCodeOrOutput(testConfig)
      );
    }

    if (babelOptions.babelrc && !babelOptions.filename) {
      throwTypeErrorWithDebugOutput(ErrorMessage.InvalidHasBabelrcButNoFilename());
    }

    if (
      expectedError !== undefined &&
      !(
        ["function", "boolean", "string"].includes(typeof expectedError) ||
        expectedError instanceof RegExp
      )
    ) {
      throwTypeErrorWithDebugOutput(ErrorMessage.InvalidThrowsType());
    }

    function throwTypeErrorWithDebugOutput(message: string): never {
      const finalMessage = ErrorMessage.ValidationFailed(
        testBlockTitle.fullString,
        message
      );

      verbose2(finalMessage);
      throw new TypeError(finalMessage);
    }
  }
}

/**
 * Custom lodash merge customizer that causes source arrays to be concatenated
 * and successive `undefined` values to unset (delete) the property if it
 * exists.
 *
 * @see https://lodash.com/docs/4.17.15#mergeWith
 */
function mergeCustomizer(
  objValue: unknown,
  srcValue: unknown,
  key: string,
  object: Record<string, unknown>,
  source: Record<string, unknown>
) {
  if (object && srcValue === undefined && key in source) {
    delete object[key];
  } else if (Array.isArray(objValue)) {
    return objValue.concat(srcValue);
  }

  return undefined;
}

/**
 * Take the dirname of `filepath` and join `basename` to it, creating an
 * absolute path. If `basename` is already absolute, it will be returned as is.
 * If either `basename` is falsy or `filepath` is falsy and `basename` is not
 * absolute, `undefined` is returned instead.
 */
function getAbsolutePathUsingFilepathDirname(filepath?: string, basename?: string) {
  const { verbose: verbose2 } = getDebuggers("to-abs-path", debug1);

  const result = !basename
    ? undefined
    : path.isAbsolute(basename)
    ? basename
    : filepath
    ? path.join(path.dirname(filepath), basename)
    : undefined;

  verbose2(`dirname(${filepath}) + ${basename} => ${result}`);
  return result;
}

/**
 * Synchronously `require()` the first available options file within a fixture.
 * Any errors will be passed up to the calling function.
 */
function readFixtureOptions(baseDirectory: string) {
  const { verbose: verbose2 } = getDebuggers("read-opts", debug1);

  const optionsPath = [
    path.join(baseDirectory, "options.js"),
    path.join(baseDirectory, "options.json"),
  ].find(p => fs.existsSync(p));

  try {
    if (optionsPath) {
      verbose2(`requiring options file ${optionsPath}`);
      return require(optionsPath) as FixtureOptions;
    } else {
      verbose2("attempt to require options file ignored: no such file exists");
      return {};
    }
  } catch (error) {
    const message = ErrorMessage.GenericErrorWithPath(error, optionsPath);
    verbose2(`attempt to require options file failed: ${message}`);
    throw new Error(message);
  }
}

/**
 * Synchronously read in the file at `filepath` after transforming the path into
 * an absolute path if it is not one already. If `filepath` is `undefined`,
 * `undefined` is returned.
 */
function readCode<T extends string | undefined>(filepath: T): T;
/**
 * Synchronously read in the file at the path created by taking the dirname of
 * `filepath` and joining `basename` to it, yielding an absolute path. If
 * `basename` is already an absolute path, it will be read in as-is. If either
 * `basename` is falsy or `filepath` is falsy and `basename` is not absolute,
 * `undefined` is returned instead.
 */
function readCode(
  filepath: string | undefined,
  basename: string | undefined
): string | undefined;
function readCode(filepath: string | undefined, basename?: string): string | undefined {
  const { verbose: verbose2 } = getDebuggers("read-code", debug1);

  const codePath =
    arguments.length === 1
      ? filepath
      : getAbsolutePathUsingFilepathDirname(filepath, basename);

  if (!codePath) {
    verbose2(
      `attempt to read in contents from file ignored: no absolute path derivable from filepath "${filepath}" and basename "${basename}"`
    );
    return undefined;
  }

  /* istanbul ignore next */
  if (!path.isAbsolute(codePath)) {
    const message = ErrorMessage.PathIsNotAbsolute(codePath);
    verbose2(`attempt to read in contents from file failed: ${message}`);
    throw new Error(message);
  }

  try {
    verbose2(`reading in contents from file ${codePath}`);
    return fs.readFileSync(codePath, "utf8");
  } catch (error) {
    const message = ErrorMessage.GenericErrorWithPath(error, codePath);
    verbose2(`attempt to read in contents from file failed: ${message}`);
    throw new Error(message);
  }
}

/**
 * Trim a string and normalize any line ending characters.
 */
function trimAndFixLineEndings(
  source: string,
  endOfLine: NonNullable<PluginTesterOptions["endOfLine"]>,
  input = source
) {
  const { verbose: verbose2 } = getDebuggers("eol", debug1);
  source = source.trim();

  if (endOfLine === false) {
    verbose2("no EOL fix applied: EOL conversion disabled");
    return source;
  }

  verbose2(`applying EOL fix "${endOfLine}": all EOL will be replaced`);
  verbose2(
    "input (trimmed) with original EOL: %O",
    source.replaceAll("\r", "\\r").replaceAll("\n", "\\n")
  );

  const output = source.replaceAll(/\r?\n/g, getReplacement()).trim();

  verbose2(
    "output (trimmed) with EOL fix applied: %O",
    output.replaceAll("\r", "\\r").replaceAll("\n", "\\n")
  );

  return output;

  function getReplacement() {
    switch (endOfLine) {
      case "lf": {
        return "\n";
      }
      case "crlf": {
        return "\r\n";
      }
      case "auto": {
        return EOL;
      }
      case "preserve": {
        const match = input.match(/\r?\n/);
        if (match === null) {
          return EOL;
        }
        return match[0];
      }
      default: {
        verbose2(`encountered invalid EOL option "${endOfLine}"`);
        throw new TypeError(ErrorMessage.BadConfigInvalidEndOfLine(endOfLine));
      }
    }
  }
}

/**
 * Clears out nullish plugin/preset values and replaces symbols with their
 * proper values.
 */
function finalizePluginAndPresetRunOrder(
  babelOptions: PluginTesterOptions["babelOptions"]
) {
  const { verbose: verbose2 } = getDebuggers("finalize", debug1);

  if (babelOptions?.plugins) {
    babelOptions.plugins = babelOptions.plugins.filter(p => {
      const result = Boolean(p);

      /* istanbul ignore next */
      if (!result) {
        verbose2("a falsy `babelOptions.plugins` item was filtered out");
      }

      return result;
    });

    if (babelOptions.plugins.includes(runPluginUnderTestHere)) {
      verbose2(
        "replacing `runPluginUnderTestHere` symbol in `babelOptions.plugins` with plugin under test"
      );

      babelOptions.plugins.splice(
        babelOptions.plugins.indexOf(runPluginUnderTestHere),
        1,
        babelOptions.plugins.pop()!
      );
    }
  }

  if (babelOptions?.presets) {
    babelOptions.presets = babelOptions.presets.filter(p => {
      const result = Boolean(p);

      /* istanbul ignore next */
      if (!result) {
        verbose2("a falsy `babelOptions.presets` item was filtered out");
      }

      return result;
    });

    if (babelOptions.presets.includes(runPresetUnderTestHere)) {
      verbose2(
        "replacing `runPresetUnderTestHere` symbol in `babelOptions.presets` with preset under test"
      );

      babelOptions.presets.splice(
        // ? -1 because we're shifting an element off the beginning afterwards
        babelOptions.presets.indexOf(runPresetUnderTestHere) - 1,
        1,
        babelOptions.presets.shift()!
      );
    }
  }

  verbose2("finalized test object plugin and preset run order");
}

/**
 * Determines if `numericPrefix` equals at least one number or is covered by at
 * least one range Range in the `ranges` array.
 */
function numericPrefixInRanges(
  numericPrefix: number | undefined,
  ranges: (number | Range)[]
) {
  if (typeof numericPrefix == "number") {
    return ranges.some(range =>
      typeof range == "number"
        ? numericPrefix === range
        : numericPrefix >= range.start && numericPrefix <= range.end
    );
  }

  return false;
}

/**
 * An internal symbol representing the type of a normalized test configuration.
 */
const $type = Symbol.for("@xunnamius/test-object-type");

const debugFormatter = debugFactory("babel-plugin-tester:formatter");

type MaybePrettierOptions = PrettierOptions | null;
const configDirectoryCache: Record<string, MaybePrettierOptions> = Object.create(null);

const getCachedConfig = async (filepath: string) => {
  if (!(filepath in configDirectoryCache)) {
    configDirectoryCache[filepath] = await resolvePrettierConfig(filepath);
    debugFormatter(
      `caching prettier configuration resolved from ${filepath}: %O`,
      configDirectoryCache[filepath]
    );
  } else {
    debugFormatter(`using cached prettier configuration resolved from ${filepath}`);
  }

  return configDirectoryCache[filepath];
};

/**
 * A prettier-based formatter used to normalize babel output.
 *
 * If no `filepath` is given, it will be set to `${cwd}/dummy.js` by
 * default. This is useful to leverage prettier's extension-based parser
 * inference (which usually ends up triggering babel).
 *
 * @see https://prettier.io/docs/en/options.html#file-path
 */
const prettierFormatter: ResultFormatter<{
  /**
   * Options passed directly to prettier, allowing you to override the defaults.
   */
  prettierOptions: MaybePrettierOptions;
  /**
   * If this deprecated parameter is given as an argument, treat it as the value
   * of `prettierOptions`. Otherwise, it should not be used.
   *
   * @deprecated Use `prettierOptions` instead.
   */
  config: MaybePrettierOptions;
}> = async (
  code,
  {
    cwd = process.cwd(),
    filename,
    filepath = filename || path.join(cwd, "dummy.js"),
    config,
    prettierOptions = config,
  } = {}
) => {
  prettierOptions ??= await getCachedConfig(filepath);
  const finalPrettierOptions = {
    filepath,
    ...prettierOptions,
  };

  debugFormatter("cwd: %O", cwd);
  debugFormatter("filepath: %O", filepath);
  debugFormatter("prettier options: %O", finalPrettierOptions);
  debugFormatter("original code: %O", code);

  const formattedCode = formatWithPrettier(code, finalPrettierOptions);
  debugFormatter("formatted code: %O", code);

  return formattedCode;
};

const debugSerializer = debugFactory("babel-plugin-tester:serializer");

/**
 * If you're using jest and snapshots, then the snapshot output could have a
 * bunch of bothersome `\"` to escape quotes because when Jest serializes a
 * string, it will wrap everything in double quotes.
 *
 * This snapshot serializer removes these quotes.
 */
const unstringSnapshotSerializer: SnapshotSerializer = {
  test: (value: unknown) => {
    const isTriggered = typeof value === "string";

    debugSerializer(`unstring serializer is triggered: ${isTriggered ? "yes" : "no"}`);
    return isTriggered;
  },
  print: (value: unknown) => {
    debugSerializer("original   value: %O", value);

    const serializedValue = String(value);
    debugSerializer("serialized value: %O", serializedValue);

    return serializedValue;
  },
};

const debugIndex = debugFactory("babel-plugin-tester:index");

if (typeof (expect as any)?.addSnapshotSerializer == "function") {
  debugIndex(
    "added unstring snapshot serializer globally; all snapshots after this point will be affected"
  );
  // (expect as any).addSnapshotSerializer(unstringSnapshotSerializer);
} else {
  /* istanbul ignore next */
  debugIndex(
    "unable to add unstring snapshot serializer: global expect object is missing or unsupported"
  );
}

/**
 * An abstraction around babel to help you write tests for your babel plugin or
 * preset.
 */
function defaultPluginTester(options?: PluginTesterOptions) {
  return pluginTester({ formatResult: prettierFormatter, ...options });
}

export { defaultPluginTester as pluginTester };

/**
 * The shape of the Babel API.
 *
 * @see https://npm.im/babel-plugin-tester#babel
 */
type BabelType = typeof Babel;

/**
 * The shape of a `throws` (or `error`) test object or fixture option.
 *
 * @see https://npm.im/babel-plugin-tester#throws
 */
type ErrorExpectation =
  | boolean
  | string
  | RegExp
  | Error
  | Class<Error>
  | ((error: unknown) => boolean);

/**
 * The shape of a `setup` test object or fixture option.
 *
 * @see https://npm.im/babel-plugin-tester#setup
 */
type SetupFunction = () => Promisable<void | TeardownFunction>;

/**
 * The shape of a `teardown` test object or fixture option.
 *
 * @see https://npm.im/babel-plugin-tester#teardown
 */
type TeardownFunction = () => Promisable<void>;

/**
 * Options passed as parameters to the `pluginTester` function.
 *
 * @see https://npm.im/babel-plugin-tester#options
 */
export interface PluginTesterOptions {
  /**
   * This is a `pluginTester` option used to provide the babel plugin under
   * test.
   *
   * @see https://npm.im/babel-plugin-tester#plugin
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugin?: (...args: any[]) => Babel.PluginObj<any>;
  /**
   * This is a `pluginTester` option used as the describe block name and in your
   * tests' names. If `pluginName` can be inferred from the `plugin`'s name,
   * then it will be and you don't need to provide this option. If it cannot be
   * inferred for whatever reason, `pluginName` defaults to `"unknown plugin"`.
   *
   * @see https://npm.im/babel-plugin-tester#pluginName
   */
  pluginName?: string;
  /**
   * This is a `pluginTester` option used to pass options into your plugin at
   * transform time. This option can be overwritten in a test object or fixture
   * options.
   *
   * @see https://npm.im/babel-plugin-tester#pluginOptions
   */
  pluginOptions?: Babel.PluginOptions;
  /**
   * This is a `pluginTester` option used to provide the babel preset under
   * test.
   *
   * @see https://npm.im/babel-plugin-tester#preset
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  preset?: (...args: any[]) => Babel.TransformOptions;
  /**
   * This is a `pluginTester` option used as the describe block name and in your
   * tests' names. Defaults to `"unknown preset"`.
   *
   * @see https://npm.im/babel-plugin-tester#presetName
   * @default "unknown preset"
   */
  presetName?: string;
  /**
   * This is a `pluginTester` option used to pass options into your preset at
   * transform time. This option can be overwritten using test object properties
   * or fixture options.
   *
   * @see https://npm.im/babel-plugin-tester#presetOptions
   */
  presetOptions?: Babel.PluginOptions;
  /**
   * This is a `pluginTester` option used to provide your own implementation of
   * babel. This is particularly useful if you want to use a different version
   * of babel than what's included in this package.
   *
   * @see https://npm.im/babel-plugin-tester#babel
   */
  babel?: {
    transform: BabelType["transform"];
    transformAsync?: BabelType["transformAsync"];
  };
  /**
   * This is a `pluginTester` option used to configure babel.
   *
   * Note that `babelOptions.babelrc` and `babelOptions.configFile` are set to
   * `false` by default, which disables automatic babel configuration loading.
   *
   * @see https://npm.im/babel-plugin-tester#babelOptions
   */
  babelOptions?: Omit<Babel.TransformOptions, "plugins" | "presets"> & {
    plugins?:
      | (
          | NonNullable<Babel.TransformOptions["plugins"]>[number]
          | typeof runPluginUnderTestHere
        )[]
      | null;
    presets?:
      | (
          | NonNullable<Babel.TransformOptions["presets"]>[number]
          | typeof runPresetUnderTestHere
        )[]
      | null;
  };
  /**
   * This is a `pluginTester` option used to specify a custom title for the
   * describe block (overriding everything else). Set to `false` to prevent the
   * creation of such an enclosing describe block. Otherwise, the title defaults
   * to `pluginName`.
   *
   * @see https://npm.im/babel-plugin-tester#title
   */
  title?: string | false;
  /**
   * This is a `pluginTester` option used to resolve relative paths provided by
   * the `fixtures` option and the two test object properties `codeFixture` and
   * `outputFixture`. If these are not absolute paths, they will be
   * `path.join`'d with the directory name of `filepath`.
   *
   * `filepath` is also passed to `formatResult` (fixture option) and
   * `formatResult` (test object property).
   *
   * Defaults to the absolute path of the file that invoked the `pluginTester`
   * function.
   *
   * @see https://npm.im/babel-plugin-tester#filepath
   */
  filepath?: string;
  /**
   * @deprecated Use `filepath` instead.
   * @see https://npm.im/babel-plugin-tester#filepath
   */
  filename?: string;
  /**
   * This is a `pluginTester` option used to control which line endings both the
   * actual output from babel and the expected output will be converted to.
   * Defaults to `"lf"`.
   *
   * | Options      | Description                             |
   * | ------------ | --------------------------------------- |
   * | `"lf"`       | Unix                                    |
   * | `"crlf"`     | Windows                                 |
   * | `"auto"`     | Use the system default                  |
   * | `"preserve"` | Use the line ending from the input      |
   * | `false`      | Disable line ending conversion entirely |
   *
   * @default "lf"
   * @see https://npm.im/babel-plugin-tester#endOfLine
   */
  endOfLine?: (typeof validEndOfLineValues)[number];
  /**
   * This is a `pluginTester` option to provide a setup function run before each
   * test runs. It can return a function which will be treated as a `teardown`
   * function. It can also return a promise. If that promise resolves to a
   * function, that will be treated as a `teardown` function.
   *
   * @see https://npm.im/babel-plugin-tester#setup
   */
  setup?: SetupFunction;
  /**
   * This is a `pluginTester` option to provide a teardown function run after
   * each test runs. Use this function to clean up after tests finish running.
   * You can either define this as its own property, or you can return it from
   * the `setup` function. This can likewise return a promise if it's
   * asynchronous.
   *
   * @see https://npm.im/babel-plugin-tester#teardown
   */
  teardown?: TeardownFunction;
  /**
   * This is a `pluginTester` option used to provide a function that formats
   * actual babel outputs before they are compared to expected outputs, and
   * defaults to a function using prettier. If you have prettier configured,
   * then it will use your configuration. If you don't, then it will use a
   * default prettier configuration.
   *
   * @see https://npm.im/babel-plugin-tester#formatResult
   */
  formatResult?: ResultFormatter;
  /**
   * This is a `pluginTester` option for when you prefer to take a snapshot of
   * all test object outputs rather than compare it to something you hard-code.
   * When `true`, a snapshot containing both the source code and the output will
   * be generated for all test object tests.
   *
   * @see https://npm.im/babel-plugin-tester#snapshot
   */
  snapshot?: TestObject["snapshot"];
  /**
   * This is a `pluginTester` option used to provide a new default output file
   * name for all fixtures. Defaults to `"output"`.
   *
   * @see https://npm.im/babel-plugin-tester#fixtureOutputName
   * @default "output"
   */
  fixtureOutputName?: FixtureOptions["fixtureOutputName"];
  /**
   * This is a `pluginTester` option used to provide a new default output file
   * extension for all fixtures. This is particularly useful if you are testing
   * TypeScript input. If omitted, the fixture's input file extension (e.g. the
   * `js` in `code.js`) will be used instead.
   *
   * @see https://npm.im/babel-plugin-tester#fixtureOutputExt
   */
  fixtureOutputExt?: FixtureOptions["fixtureOutputExt"];
  /**
   * This is a `pluginTester` option used to determines which test titles are
   * prefixed with a number when output. Defaults to `"all"`.
   *
   * | Options           | Description                                         |
   * | ----------------- | --------------------------------------------------- |
   * | `"all"`           | All test object and fixtures tests will be numbered |
   * | `"tests-only"`    | Only test object tests will be numbered             |
   * | `"fixtures-only"` | Only fixtures tests will be numbered                |
   * | `false`           | Disable automatic numbering in titles entirely      |
   *
   * @default "all"
   * @see https://npm.im/babel-plugin-tester#titleNumbering
   */
  titleNumbering?: (typeof validTitleNumberingValues)[number];
  /**
   * This is a `pluginTester` option used to restart test title numbering. Set
   * this value to `true` to restart automatic title numbering at 1.
   *
   * @default false
   * @see https://npm.im/babel-plugin-tester#restartTitleNumbering
   */
  restartTitleNumbering?: boolean;
  /**
   * This is a `pluginTester` option used to specify a path to a directory
   * containing tests.
   *
   * @see https://npm.im/babel-plugin-tester#fixtures
   */
  fixtures?: string;
  /**
   * This is a `pluginTester` option used to create tests.
   *
   * @see https://npm.im/babel-plugin-tester#tests
   */
  tests?: (TestObject | string)[] | Record<string, TestObject | string>;
}

/**
 * Options provided as properties of an `options.json` file, or returned by an
 * `options.js` file, for use with fixtures specified by the `fixtures` option.
 *
 * @see https://npm.im/babel-plugin-tester#fixtures
 */
interface FixtureOptions {
  /**
   * This is a `fixtures` option used to configure babel, overriding the
   * `babelOptions` provided to babel-plugin-tester.
   *
   * @see https://npm.im/babel-plugin-tester#babelOptions-1
   */
  babelOptions?: PluginTesterOptions["babelOptions"];
  /**
   * This is a `fixtures` option used to pass options into your plugin at
   * transform time, overriding the `pluginOptions` provided to
   * babel-plugin-tester.
   *
   * @see https://npm.im/babel-plugin-tester#pluginOptions-1
   */
  pluginOptions?: PluginTesterOptions["pluginOptions"];
  /**
   * This is a `fixtures` option used to pass options into your preset at
   * transform time, overriding the `presetOptions` provided to
   * babel-plugin-tester.
   *
   * @see https://npm.im/babel-plugin-tester#presetOptions-1
   */
  presetOptions?: PluginTesterOptions["presetOptions"];
  /**
   * This is a `fixtures` option used as the title of the test (overriding the
   * directory name).
   *
   * @see https://npm.im/babel-plugin-tester#title-1
   */
  title?: string;
  /**
   * This is a `fixtures` option used to run only the specified fixture. Useful
   * while developing to help focus on a small number of fixtures. Can be used
   * in multiple `options.json` files.
   *
   * @see https://npm.im/babel-plugin-tester#only
   */
  only?: boolean;
  /**
   * This is a `fixtures` option used to skip running the specified fixture.
   * Useful for when you're working on a feature that is not yet supported. Can
   * be used in multiple `options.json` files.
   *
   * @see https://npm.im/babel-plugin-tester#skip
   */
  skip?: boolean;
  /**
   * This is a `fixtures` option used to assert that this fixture's test should
   * throw an error during transformation. For example:
   *
   * ```JavaScript
   * {
   *   // ...
   *   throws: true,
   *   throws: 'should have this exact message',
   *   throws: /should pass this regex/,
   *   throws: SyntaxError, // Should be instance of this constructor
   *   throws: err => {
   *     if (err instanceof SyntaxError && /message/.test(err.message)) {
   *       return true; // Test will fail if this function doesn't return `true`
   *     }
   *   },
   * }
   * ```
   *
   * When using certain values, this option must be used in `options.js` instead
   * of `options.json`. Also, note that this property is ignored when using an
   * `exec.js` file.
   *
   * For backwards compatibility reasons, `error` is synonymous with `throws`.
   * They can be used interchangeably.
   *
   * @see https://npm.im/babel-plugin-tester#throws
   */
  throws?: ErrorExpectation;
  /**
   * This is a `fixtures` option used to assert that this fixture's test should
   * throw an error during transformation. For example:
   *
   * ```JavaScript
   * {
   *   // ...
   *   throws: true,
   *   throws: 'should have this exact message',
   *   throws: /should pass this regex/,
   *   throws: SyntaxError, // Should be instance of this constructor
   *   throws: err => {
   *     if (err instanceof SyntaxError && /message/.test(err.message)) {
   *       return true; // Test will fail if this function doesn't return `true`
   *     }
   *   },
   * }
   * ```
   *
   * When using certain values, this option must be used in `options.js` instead
   * of `options.json`. Also, note that this property is ignored when using an
   * `exec.js` file.
   *
   * For backwards compatibility reasons, `error` is synonymous with `throws`.
   * They can be used interchangeably.
   *
   * @see https://npm.im/babel-plugin-tester#throws
   */
  error?: ErrorExpectation;
  /**
   * This is a `fixtures` option to provide a setup function run before this
   * fixture's test. It can return a function which will be treated as a
   * `teardown` function. It can also return a promise. If that promise resolves
   * to a function, that will be treated as a `teardown` function.
   *
   * As it requires a function value, this option must be used in `options.js`
   * instead of `options.json`.
   *
   * @see https://npm.im/babel-plugin-tester#setup-1
   */
  setup?: SetupFunction;
  /**
   * This is a `fixtures` option to provide a teardown function run after this
   * fixture's test. You can either define this as its own property, or you can
   * return it from the `setup` function. This can likewise return a promise if
   * it's asynchronous.
   *
   * As it requires a function value, this option must be used in `options.js`
   * instead of `options.json`.
   *
   * @see https://npm.im/babel-plugin-tester#teardown-1
   */
  teardown?: TeardownFunction;
  /**
   * This is a `fixtures` option used to provide a function that formats the
   * babel output yielded from transforming `code.js` _before_ it is compared to
   * `output.js`. Defaults to a function that uses prettier. If you have
   * prettier configured, then it will use your configuration. If you don't,
   * then it will use a default prettier configuration.
   *
   * As it requires a function value, this option must be used in `options.js`
   * instead of `options.json`.
   *
   * @see https://npm.im/babel-plugin-tester#formatResult-1
   */
  formatResult?: ResultFormatter;
  /**
   * This is a `fixtures` option used to provide your own fixture output file
   * name. Defaults to `"output"`.
   *
   * @see https://npm.im/babel-plugin-tester#fixtureOutputName-1
   * @default "output"
   */
  fixtureOutputName?: string;
  /**
   * This is a `fixtures` option used to provide your own fixture output file
   * extension. This is particularly useful if you are testing TypeScript input.
   * If omitted, the fixture's input file extension (e.g. the `js` in `code.js`)
   * will be used instead.
   *
   * @see https://npm.im/babel-plugin-tester#fixtureOutputExt-1
   */
  fixtureOutputExt?: string;
}

/**
 * Options provided as properties of a test object for use with the `tests`
 * option.
 *
 * @see https://npm.im/babel-plugin-tester#test-objects
 */
interface TestObject {
  /**
   * This is a `tests` object option used to configure babel, overriding the
   * `babelOptions` provided to babel-plugin-tester.
   *
   * @see https://npm.im/babel-plugin-tester#babelOptions-2
   */
  babelOptions?: PluginTesterOptions["babelOptions"];
  /**
   * This is a `tests` object option used to pass options into your plugin at
   * transform time, overriding the `pluginOptions` provided to
   * babel-plugin-tester.
   *
   * @see https://npm.im/babel-plugin-tester#pluginOptions-2
   */
  pluginOptions?: PluginTesterOptions["pluginOptions"];
  /**
   * This is a `tests` object option used to pass options into your preset at
   * transform time, overriding the `presetOptions` provided to
   * babel-plugin-tester.
   *
   * @see https://npm.im/babel-plugin-tester#presetOptions-1
   */
  presetOptions?: PluginTesterOptions["presetOptions"];
  /**
   * This is a `tests` object option used as the title of the test (overriding
   * everything else).
   *
   * @see https://npm.im/babel-plugin-tester#title-1
   */
  title?: string;
  /**
   * This is a `tests` object option used to run only the specified test. Useful
   * while developing to help focus on a small number of tests. Can be used on
   * multiple tests.
   *
   * @see https://npm.im/babel-plugin-tester#only-1
   */
  only?: boolean;
  /**
   * This is a `tests` object option used to skip running the specified test.
   * Useful for when you're working on a feature that is not yet supported. Can
   * be used on multiple tests.
   *
   * @see https://npm.im/babel-plugin-tester#skip-1
   */
  skip?: boolean;
  /**
   * This is a `tests` object option used to assert that this test should throw
   * an error during transformation. For example:
   *
   * ```JavaScript
   * {
   *   // ...
   *   throws: true,
   *   throws: 'should have this exact message',
   *   throws: /should pass this regex/,
   *   throws: SyntaxError, // Should be instance of this constructor
   *   throws: err => {
   *     if (err instanceof SyntaxError && /message/.test(err.message)) {
   *       return true; // Test will fail if this function doesn't return `true`
   *     }
   *   },
   * }
   * ```
   *
   * Note that this property is ignored when using the `exec` property.
   *
   * For backwards compatibility reasons, `error` is synonymous with `throws`.
   * They can be used interchangeably.
   *
   * @see https://npm.im/babel-plugin-tester#throws-1
   */
  throws?: ErrorExpectation;
  /**
   * This is a `tests` object option used to assert that this test should throw
   * an error during transformation. For example:
   *
   * ```JavaScript
   * {
   *   // ...
   *   throws: true,
   *   throws: 'should have this exact message',
   *   throws: /should pass this regex/,
   *   throws: SyntaxError, // Should be instance of this constructor
   *   throws: err => {
   *     if (err instanceof SyntaxError && /message/.test(err.message)) {
   *       return true; // Test will fail if this function doesn't return `true`
   *     }
   *   },
   * }
   * ```
   *
   * Note that this property is ignored when using the `exec` property.
   *
   * For backwards compatibility reasons, `error` is synonymous with `throws`.
   * They can be used interchangeably.
   *
   * @see https://npm.im/babel-plugin-tester#throws-1
   */
  error?: ErrorExpectation;
  /**
   * This is a `tests` object option to provide a setup function run before this
   * test. It can return a function which will be treated as a `teardown`
   * function. It can also return a promise. If that promise resolves to a
   * function, that will be treated as a `teardown` function.
   *
   * @see https://npm.im/babel-plugin-tester#setup-2
   */
  setup?: SetupFunction;
  /**
   * This is a `tests` object option to provide a teardown function run after
   * this test. You can either define this as its own property, or you can
   * return it from the `setup` function. This can likewise return a promise if
   * it's asynchronous.
   *
   * @see https://npm.im/babel-plugin-tester#teardown-2
   */
  teardown?: TeardownFunction;
  /**
   * This is a `tests` object option used to provide a function that formats the
   * babel output yielded from transforming `code` _before_ it is compared to
   * `output`. Defaults to a function that uses prettier. If you have prettier
   * configured, then it will use your configuration. If you don't, then it will
   * use a default prettier configuration.
   *
   * @see https://npm.im/babel-plugin-tester#formatResult-2
   */
  formatResult?: ResultFormatter;
  /**
   * This is a `tests` object option for when you prefer to take a snapshot of
   * your output rather than compare it to something you hard-code. When `true`,
   * a snapshot containing both the source code and the output will be generated
   * for this test.
   *
   * @see https://npm.im/babel-plugin-tester#snapshot-1
   */
  snapshot?: boolean;
  /**
   * This is a `tests` object option providing the code that you want babel to
   * transform using your plugin or preset. This must be provided unless you're
   * using the `codeFixture` or `exec` properties instead. If you do not provide
   * the `output` or `outputFixture` properties and `snapshot` is not `true`,
   * then the assertion is that this code is unchanged by the transformation.
   *
   * @see https://npm.im/babel-plugin-tester#code
   */
  code?: string;
  /**
   * This is a `tests` object option to which the result of the babel
   * transformation will be compared. `output` will have any indentation
   * stripped and will be trimmed as a convenience for template literals.
   *
   * @see https://npm.im/babel-plugin-tester#output
   */
  output?: string;
  /**
   * This is a `tests` object option that will be transformed just like the
   * `code` property, except the output will be _evaluated_ in the same context
   * as the the test runner itself, meaning it has access to `expect`,
   * `require`, etc. Use this to make advanced assertions on the output.
   *
   * @see https://npm.im/babel-plugin-tester#exec
   */
  exec?: string;
  /**
   * This is a `tests` object option for when you'd rather put your `code` in a
   * separate file. If an absolute file path is provided here, then that's the
   * file that will be loaded. Otherwise, `codeFixture` will be `path.join`'d
   * with the directory name of `filepath`.
   *
   * If you find you're using this option more than a couple of times, consider
   * using _`fixtures`_ instead.
   *
   * @see https://npm.im/babel-plugin-tester#codeFixture
   */
  codeFixture?: string;
  /**
   * @deprecated Use `codeFixture` instead.
   * @see https://npm.im/babel-plugin-tester#codeFixture
   */
  fixture?: string;
  /**
   * This is a `tests` object option for when you'd rather put your `output` in
   * a separate file. If an absolute file path is provided here, then that's the
   * file that will be loaded. Otherwise, `outputFixture` will be `path.join`'d
   * with the directory name of `filepath`.
   *
   * If you find you're using this option more than a couple of times, consider
   * using _`fixtures`_ instead.
   *
   * @see https://npm.im/babel-plugin-tester#outputFixture
   */
  outputFixture?: string;
  /**
   * This is a `tests` object option for when you'd rather put your `exec` in a
   * separate file. If an absolute file path is provided here, then that's the
   * file that will be loaded. Otherwise, `execFixture` will be `path.join`'d
   * with the directory name of `filepath`.
   *
   * If you find you're using this option more than a couple of times, consider
   * using _`fixtures`_ instead.
   *
   * @see https://npm.im/babel-plugin-tester#execFixture
   */
  execFixture?: string;
}

/**
 * The shape of a code formatter used to normalize the results of a babel
 * transformation.
 *
 * @see https://npm.im/babel-plugin-tester#prettier-formatter
 */
type ResultFormatter<
  AdditionalOptions extends Record<string, unknown> = Record<string, unknown>,
> = (
  /**
   * The result of a babel transformation that should be formatted.
   */
  code: string,
  /**
   * Options expected by the ResultFormatter interface.
   */
  options?: {
    /**
     * A directory path used to generate a default value for `filepath`. There
     * is no need to provide a `cwd` if you provide a `filepath` explicitly.
     *
     * Note that this path may not actually exist.
     */
    cwd?: string;
    /**
     * A path representing the file containing the original source that was
     * transformed into `code` by babel.
     *
     * Note that this file might not actually exist and, even if it does, it
     * might not contain the original source of `code`.
     */
    filepath?: string;
    /**
     * If this deprecated parameter is given as an argument, treat it as the
     * value of `filepath`. Otherwise, it should not be used.
     *
     * @deprecated Use `filepath` instead.
     */
    filename?: string;
  } & Partial<AdditionalOptions>
) => Promise<string>;

/**
 * An internal type describing a resolved base configuration.
 */
type PluginTesterBaseConfig = (
  | {
      plugin: NonNullable<PluginTesterOptions["plugin"]>;
      pluginName: NonNullable<PluginTesterOptions["pluginName"]>;
      basePluginOptions: NonNullable<PluginTesterOptions["pluginOptions"]>;
      preset: undefined;
      presetName: undefined;
      basePresetOptions: undefined;
    }
  | {
      plugin: undefined;
      pluginName: undefined;
      basePluginOptions: undefined;
      preset: NonNullable<PluginTesterOptions["preset"]>;
      presetName: PluginTesterOptions["presetName"];
      basePresetOptions: NonNullable<PluginTesterOptions["presetOptions"]>;
    }
) & {
  babel: NonNullable<PluginTesterOptions["babel"]>;
  baseBabelOptions: NonNullable<PluginTesterOptions["babelOptions"]>;
  titleNumbering: NonNullable<PluginTesterOptions["titleNumbering"]>;
  describeBlockTitle: NonNullable<PluginTesterOptions["title"]>;
  filepath: PluginTesterOptions["filepath"];
  endOfLine: NonNullable<PluginTesterOptions["endOfLine"]>;
  baseSetup: NonNullable<PluginTesterOptions["setup"]>;
  baseTeardown: NonNullable<PluginTesterOptions["teardown"]>;
  baseFormatResult: NonNullable<PluginTesterOptions["formatResult"]>;
  baseSnapshot: NonNullable<PluginTesterOptions["snapshot"]>;
  baseFixtureOutputName: NonNullable<PluginTesterOptions["fixtureOutputName"]>;
  baseFixtureOutputExt: PluginTesterOptions["fixtureOutputExt"];
  fixtures: PluginTesterOptions["fixtures"];
  tests: NonNullable<PluginTesterOptions["tests"]>;
};

type DynamicProperties =
  | "plugin"
  | "pluginName"
  | "basePluginOptions"
  | "preset"
  | "presetName"
  | "basePresetOptions"
  | "describeBlockTitle";

/**
 * An internal type describing a partially-resolved base configuration.
 */
type PartialPluginTesterBaseConfig = Omit<PluginTesterBaseConfig, DynamicProperties> &
  Partial<Pick<PluginTesterBaseConfig, DynamicProperties>>;

type PluginTesterSharedTestConfigProperties = {
  babelOptions: Omit<Babel.TransformOptions, "plugins" | "presets"> & {
    plugins: NonNullable<Babel.TransformOptions["plugins"]>;
    presets: NonNullable<Babel.TransformOptions["presets"]>;
  };
  testBlockTitle: {
    numericPrefix: number | undefined;
    titleString: string;
    fullString: string;
  };
  only?: TestObject["only"];
  skip?: TestObject["skip"];
  expectedError?: TestObject["throws"];
  testSetup: NonNullable<PluginTesterOptions["setup"]>;
  testTeardown: NonNullable<PluginTesterOptions["teardown"]>;
  formatResult: NonNullable<PluginTesterOptions["formatResult"]>;
};

/**
 * An internal type describing a resolved describe-block configuration.
 */
type PluginTesterTestDescribeConfig = {
  [$type]: "describe-block";
  describeBlockTitle: NonNullable<TestObject["title"]>;
  tests: PluginTesterTestConfig[];
};

/**
 * An internal type describing an unverified test-object configuration.
 */
type MaybePluginTesterTestObjectConfig = {
  [$type]: "test-object";
  snapshot: NonNullable<TestObject["snapshot"]>;
} & PluginTesterSharedTestConfigProperties & {
    code: TestObject["code"];
    codeFixture: TestObject["codeFixture"];
    output: TestObject["output"];
    outputFixture: TestObject["outputFixture"];
    exec: TestObject["exec"];
    execFixture: TestObject["execFixture"];
  };

/**
 * An internal type describing a resolved test-object configuration.
 */
type PluginTesterTestObjectConfig = {
  [$type]: "test-object";
  snapshot: NonNullable<TestObject["snapshot"]>;
} & PluginTesterSharedTestConfigProperties &
  (
    | {
        code: NonNullable<TestObject["code"]>;
        codeFixture: TestObject["codeFixture"];
        output: TestObject["output"];
        outputFixture: TestObject["outputFixture"];
        exec: undefined;
        execFixture: undefined;
      }
    | {
        code: undefined;
        codeFixture: undefined;
        output: undefined;
        outputFixture: undefined;
        exec: NonNullable<TestObject["exec"]>;
        execFixture: NonNullable<TestObject["execFixture"]>;
      }
  );

/**
 * An internal type describing an unverified fixture-object configuration.
 */
type MaybePluginTesterTestFixtureConfig = {
  [$type]: "fixture-object";
} & PluginTesterSharedTestConfigProperties & {
    fixtureOutputBasename: string | undefined;
    code: TestObject["code"];
    codeFixture: TestObject["codeFixture"];
    output: TestObject["output"];
    outputFixture: TestObject["outputFixture"];
    exec: TestObject["exec"];
    execFixture: TestObject["execFixture"];
  };

/**
 * An internal type describing a resolved fixture-object configuration.
 */
type PluginTesterTestFixtureConfig = {
  [$type]: "fixture-object";
} & PluginTesterSharedTestConfigProperties &
  (
    | {
        fixtureOutputBasename: string;
        code: NonNullable<TestObject["code"]>;
        codeFixture: NonNullable<TestObject["codeFixture"]>;
        output: TestObject["output"];
        outputFixture: NonNullable<TestObject["outputFixture"]>;
        exec: undefined;
        execFixture: undefined;
      }
    | {
        fixtureOutputBasename: undefined;
        code: undefined;
        codeFixture: undefined;
        output: undefined;
        outputFixture: undefined;
        exec: NonNullable<TestObject["exec"]>;
        execFixture: NonNullable<TestObject["execFixture"]>;
      }
  );

/**
 * An internal type describing a resolved configuration.
 */
type PluginTesterTestConfig =
  | PluginTesterTestDescribeConfig
  | PluginTesterTestObjectConfig
  | PluginTesterTestFixtureConfig;

/**
 * An internal type describing an unresolved configuration.
 */
type MaybePluginTesterTestConfig =
  | MaybePluginTesterTestFixtureConfig
  | MaybePluginTesterTestObjectConfig;

/**
 * An internal type describing an inclusive range of numbers.
 */
type Range = {
  start: number;
  end: number;
};
