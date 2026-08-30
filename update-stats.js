const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");
const fs = require("fs");

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

async function getViews(page) {
  await page.waitForTimeout(8000);

  const bodyText = await page.locator("body").innerText();

  console.log("PAGE URL:", page.url());
  console.log("PAGE TITLE:", await page.title());

  let match = bodyText.match(
    /Views[\s\S]{0,100}?([\d,]+(?:\.\d+)?)/i
  );

  if (match) {
    const views = cleanNumber(match[1]);

    if (views !== null) {
      console.log("Views found from body:", views);
      return views;
    }
  }

  const viewsLocator = page
    .getByText("Views", { exact: true })
    .first();

  if (await viewsLocator.count()) {
    try {
      const parentText = await viewsLocator
        .locator("..")
        .innerText();

      console.log("Views parent text:", parentText);

      const numbers = parentText.match(/[\d,]+/g);

      if (numbers && numbers.length) {
        for (const number of numbers) {
          const views = cleanNumber(number);

          if (views !== null) {
            console.log(
              "Views found from element:",
              views
            );

            return views;
          }
        }
      }
    } catch (error) {
      console.log(
        "Element extraction failed:",
        error.message
      );
    }
  }

  const html = await page.content();

  match = html.match(
    /Views[\s\S]{0,500}?([\d,]+(?:\.\d+)?)/i
  );

  if (match) {
    const views = cleanNumber(match[1]);

    if (views !== null) {
      console.log(
        "Views found from HTML:",
        views
      );

      return views;
    }
  }

  return null;
}

/*
  محاولة استخراج Actions من صفحة Telegram Ads
*/
async function getActions(page) {
  await page.waitForTimeout(3000);

  const bodyText = await page.locator("body").innerText();

  console.log("Searching for actions...");

  /*
    Telegram يعرض أنواع الإجراءات مثل:
    Started bot
    Joined channel
    Join
  */

  const patterns = [
    /Started bot[\s\S]{0,100}?([\d,]+)/i,
    /Joined channel[\s\S]{0,100}?([\d,]+)/i,
    /Join[\s\S]{0,100}?([\d,]+)/i,
    /Actions[\s\S]{0,100}?([\d,]+)/i
  ];

  for (const pattern of patterns) {
    const match = bodyText.match(pattern);

    if (match) {
      const actions = cleanNumber(match[1]);

      if (actions !== null) {
        console.log(
          "Actions found:",
          actions
        );

        return actions;
      }
    }
  }

  /*
    نحاول البحث عن عناصر Actions / Started bot
  */
  const labels = [
    "Started bot",
    "Joined channel",
    "Actions"
  ];

  for (const label of labels) {
    const locator = page
      .getByText(label, { exact: true })
      .first();

    if (await locator.count()) {
      try {
        const parentText = await locator
          .locator("..")
          .innerText();

        console.log(
          `${label} parent:`,
          parentText
        );

        const numbers =
          parentText.match(/[\d,]+/g);

        if (numbers && numbers.length) {
          for (const number of numbers) {
            const actions = cleanNumber(number);

            if (actions !== null) {
              console.log(
                `Actions found from ${label}:`,
                actions
              );

              return actions;
            }
          }
        }
      } catch (error) {
        console.log(
          `${label} extraction failed:`,
          error.message
        );
      }
    }
  }

  console.log("Actions NOT FOUND.");

  return null;
}

async function main() {
  const { data: campaigns, error } = await supabase
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
    console.log("--------------------------------");

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

      const views =
        await getViews(page);

      const actions =
        await getActions(page);

      console.log(
        "REAL VIEWS:",
        views
      );

      console.log(
        "REAL ACTIONS:",
        actions
      );

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

      /*
        لو Actions مش موجودة،
        نحافظ على القيمة القديمة
      */
      const finalActions =
        actions !== null
          ? actions
          : campaign.actions || 0;

      const { error: updateError } =
        await supabase
          .from("campaigns")
          .update({
            impressions: views,

            actions: finalActions,

            last_updated:
              new Date().toISOString()
          })
          .eq(
            "id",
            campaign.id
          );

      if (updateError) {
        console.error(
          "Supabase update error:",
          updateError.message
        );
      } else {
        console.log(
          `UPDATED SUCCESSFULLY: ${campaign.campaign_name}`
        );

        console.log(
          `Views = ${views}`
        );

        console.log(
          `Actions = ${finalActions}`
        );
      }

    } catch (error) {
      console.error(
        `FAILED ${campaign.campaign_name}:`,
        error.message
      );
    }
  }

  await browser.close();

  console.log("--------------------------------");

  console.log(
    "Telegram Ads update finished."
  );
}

main().catch((error) => {
  console.error(error);

  process.exit(1);
});
