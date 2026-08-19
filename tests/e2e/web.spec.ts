import { expect, test } from "@playwright/test";

const MINT = "11111111111111111111111111111111";

test("runs a basic preflight and exposes evidence", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-write"], {
    origin: "http://127.0.0.1:4173",
  });
  await page.route("**/v1/preflight", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: "1.0",
        engineVersion: "0.1.0",
        generatedAt: "2026-08-19T00:00:00.000Z",
        cluster: "devnet",
        input: { mint: MINT },
        tokenProgram: "token-2022",
        mint: {
          address: MINT,
          decimals: 6,
          supplyRaw: "1",
          mintAuthority: null,
          freezeAuthority: null,
          extensions: ["PermanentDelegate"],
        },
        overallStatus: "WARNING",
        findings: [
          {
            id: "permanent-delegate",
            status: "WARNING",
            category: "authority",
            title: "Permanent delegate is active",
            summary: "The delegate can transfer or burn tokens.",
            requiredActions: [],
            evidence: [
              {
                account: MINT,
                accountKind: "mint",
                field: "extensions.PermanentDelegate.delegate",
                value: MINT,
              },
            ],
          },
        ],
        limitations: ["No transaction simulation is performed."],
      }),
    });
  });

  await page.goto("/");
  const mintInput = page.getByLabel("Mint address");
  await mintInput.focus();
  await expect(mintInput).toHaveCSS("outline-style", "none");
  await mintInput.fill(MINT);
  await page.getByLabel("Cluster").selectOption("devnet");
  await page.getByRole("button", { name: "Run preflight" }).click();

  await expect(
    page.getByRole("heading", { name: "Permanent delegate is active" }),
  ).toBeVisible();
  await page.getByText("Evidence", { exact: true }).click();
  await expect(
    page.getByText("extensions.PermanentDelegate.delegate", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/token22 inspect/)).toContainText(
    `token22 inspect ${MINT} --cluster devnet`,
  );
  await page.getByRole("button", { name: "Copy CLI command" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
});
