const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function cleanNumber(value) {
  if (value === null || value === undefined) return null;

  const text = String(value)
    .replace(/[,\.\s]/g, "")
    .replace(/[^\d]/g, "");

  if (!text) return null;

  const number = Number(text);

  return Number.isFinite(number) ? number : null;
}

async function getStats(page) {
  await page.waitForTimeout(8000);

  const bodyText = await page.locator("body").innerText();

  console.log("PAGE URL:", page.url());
  console.log("PAGE TITLE:", await page.title());

  // =========================
  // Views
  // =========================

  let views = null;

  let match = bodyText.match(
    /Views[\s\S]{0,100}?([\d,]+(?:\.\d+)?)/i
  );

  if (match) {
    views = cleanNumber(match[1]);
  }

  // =========================
  // Actions
  // =========================

  let actions = null;

  const actionMatch = bodyText.match(
    /Actions[\s\S]{0,150}?([\d,]+(?:\.\d+)?)/i
  );

  if (actionMatch) {
    actions = cleanNumber(actionMatch[1]);
  }

  // =========================
  // محاولة إضافية للـ Views
  // =========================

  if (views === null) {
    const viewsLocator = page
      .getByText("Views", { exact: true })
      .first();

    if (await viewsLocator.count()) {
      try {
        const parentText = await viewsLocator
          .locator("..")
          .innerText();

        const numbers = parentText.match(/[\d,]+/g);

        if (numbers && numbers.length) {
          for (const number of numbers) {
            const value = cleanNumber(number);

            if (value !== null) {
              views = value;
              break;
            }
          }
        }
      } catch (error) {
        console.log(
          "Views element extraction failed:",
          error.message
        );
      }
    }
  }

  // =========================
  // محاولة إضافية للـ Actions
  // =========================

  if (actions === null) {
    const actionLocator = page
      .getByText("Actions", { exact: true })
      .first();

    if (await actionLocator.count()) {
      try {
        const parentText = await actionLocator
          .locator("..")
          .innerText();

        const numbers = parentText.match(/[\d,]+/g);

        if (numbers && numbers.length) {
          for (const number of numbers) {
            const value = cleanNumber(number);

            if (value !== null) {
              actions = value;
              break;
            }
          }
        }
      } catch (error) {
        console.log(
          "Actions element extraction failed:",
          error.message
        );
      }
    }
  }

  console.log("VIEWS:", views);
  console.log("ACTIONS:", actions);

  return {
    views,
    actions
  };
}

async function main() {

  const {
    data: campaigns,
    error
  } = await supabase
    .from("campaigns")
    .select(
      "id, campaign_name, report_code, stats_url, impressions, actions"
    )
    .not("stats_url", "is", null);

  if (error) {
    throw new Error(error.message);
  }

  if (!campaigns || campaigns.length === 0) {
    console.log(
      "No campaigns with stats_url."
    );
    return;
  }

  console.log(
    `Found ${campaigns.length} campaign(s).`
  );

  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    viewport: {
      width: 1280,
      height: 900
    },

    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"
  });

  const page = await context.newPage();

  for (const campaign of campaigns) {

    console.log(
      "--------------------------------"
    );

    console.log(
      "Campaign:",
      campaign.campaign_name
    );

    console.log(
      "Report:",
      campaign.report_code
    );

    console.log(
      "URL:",
      campaign.stats_url
    );

    console.log(
      "Old impressions:",
      campaign.impressions
    );

    console.log(
      "Old actions:",
      campaign.actions
    );

    try {

      await page.goto(
        campaign.stats_url,
        {
          waitUntil: "networkidle",
          timeout: 90000
        }
      );

      console.log(
        "Telegram page loaded."
      );

      const {
        views,
        actions
      } = await getStats(page);

      // =========================
      // لو مفيش Views
      // =========================

      if (views === null) {

        console.log(
          `Views NOT FOUND for ${
            campaign.report_code ||
            campaign.id
          }`
        );

        await page.screenshot({
          path:
            `telegram-${campaign.id}.png`,
          fullPage: true
        });

        continue;
      }

      console.log(
        "REAL VIEWS:",
        views
      );

      console.log(
        "REAL ACTIONS:",
        actions
      );

      // =========================
      // تحديث Supabase
      // =========================

      const updateData = {
        impressions: views,
        last_updated:
          new Date().toISOString()
      };

      if (actions !== null) {
        updateData.actions = actions;
      }

      const {
        error: updateError
      } = await supabase
        .from("campaigns")
        .update(updateData)
        .eq("id", campaign.id);

      if (updateError) {

        console.error(
          "Supabase update error:",
          updateError.message
        );

      } else {

        console.log(
          `UPDATED SUCCESSFULLY: ${
            campaign.campaign_name
          }`
        );

        console.log(
          `Views = ${views}`
        );

        console.log(
          `Actions = ${actions}`
        );
      }

    } catch (error) {

      console.error(
        `FAILED ${
          campaign.campaign_name
        }:`,
        error.message
      );
    }
  }

  await browser.close();

  console.log(
    "--------------------------------"
  );

  console.log(
    "Telegram Ads update finished."
  );
}

main().catch((error) => {

  console.error(error);

  process.exit(1);

});
