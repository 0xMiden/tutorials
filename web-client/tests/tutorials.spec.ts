import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const tutorialTimeoutMs = 10 * 60 * 1000;

type RequiredLog = string | RegExp;

const tutorials: ReadonlyArray<{
  name: string;
  testId: string;
  requiredLogs: ReadonlyArray<RequiredLog>;
}> = [
  {
    name: "createMintConsume",
    testId: "tutorial-createMintConsume",
    requiredLogs: ["Tokens sent successfully!"],
  },
  {
    name: "multiSendWithDelegatedProver",
    testId: "tutorial-multiSendWithDelegatedProver",
    requiredLogs: ["All notes created ✅"],
  },
  {
    name: "incrementCounterContract",
    testId: "tutorial-incrementCounterContract",
    requiredLogs: [/Count:\s+1\b/],
  },
  {
    name: "unauthenticatedNoteTransfer",
    testId: "tutorial-unauthenticatedNoteTransfer",
    requiredLogs: ["Asset transfer chain completed ✅"],
  },
  {
    name: "foreignProcedureInvocation",
    testId: "tutorial-foreignProcedureInvocation",
    requiredLogs: [
      /Count copied via Foreign Procedure Invocation:\s+1\b/,
      "Foreign Procedure Invocation Transaction completed!",
    ],
  },
] as const;

const runTutorial = async (
  page: Page,
  tutorialName: string,
  testId: string,
  requiredLogs: ReadonlyArray<RequiredLog>,
) => {
  const consoleErrors: string[] = [];
  const consoleLogs: string[] = [];

  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error") {
      consoleErrors.push(`[console.error] ${text}`);
    } else {
      consoleLogs.push(text);
    }
  });
  page.on("pageerror", (err) => {
    consoleErrors.push(`[pageerror] ${err.message}`);
  });

  await page.goto("/");
  await page.getByTestId(testId).click();

  await page.waitForFunction(
    (name) => {
      const status = (window as Window & {
        __tutorialStatus?: Record<string, { state: string; error?: string }>;
      }).__tutorialStatus?.[name];
      return status?.state === "passed" || status?.state === "failed";
    },
    tutorialName,
    { timeout: tutorialTimeoutMs },
  );

  const status = await page.evaluate((name) => {
    const win = window as Window & {
      __tutorialStatus?: Record<string, { state: string; error?: string }>;
    };
    return win.__tutorialStatus?.[name] ?? null;
  }, tutorialName);

  if (consoleErrors.length > 0) {
    throw new Error(
      `Console errors detected during ${tutorialName}:\n${consoleErrors.join(
        "\n",
      )}`,
    );
  }

  expect(status).not.toBeNull();
  if (status?.state === "failed") {
    throw new Error(
      `Tutorial ${tutorialName} failed: ${status.error ?? "unknown error"}`,
    );
  }
  expect(status?.state).toBe("passed");

  for (const required of requiredLogs) {
    const matched = consoleLogs.some((line) =>
      typeof required === "string"
        ? line.includes(required)
        : required.test(line),
    );
    if (!matched) {
      throw new Error(
        `Tutorial ${tutorialName} did not emit required log ${required.toString()}.\nCaptured logs:\n${consoleLogs.join(
          "\n",
        )}`,
      );
    }
  }
};

for (const tutorial of tutorials) {
  test(tutorial.name, async ({ page }) => {
    test.setTimeout(tutorialTimeoutMs);
    await runTutorial(
      page,
      tutorial.name,
      tutorial.testId,
      tutorial.requiredLogs,
    );
  });
}
