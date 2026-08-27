const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getViews(text) {
  const match = text.match(
    /(?:^|\n|\s)Views\s*\n?\s*([\d,.\s]+)/i
  );

  if (!match) return null;

  const views = Number(
    match[1].replace(/[,. \s]/g, "")
  );

  return Number.isFinite(views) ? views : null;
}

async function main() {
  const { data: campaigns, error } = await supabase
    .from("campaigns")
    .select("id, report_code, stats_url, impressions")
    .not("stats_url", "is", null);

  if (error) {
    throw new Error(error.message);
  }

  if (!campaigns?.length) {
    console.log("No campaigns with stats_url.");
    return;
  }

  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

  for (const campaign of campaigns) {
    try {
      console.log(
        `Checking ${campaign.report_code || campaign.id}`
      );

      await page.goto(campaign.stats_url, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      });

      await page.waitForTimeout(5000);

      const text = await page.locator("body").innerText();

      const views = getViews(text);

      if (views === null) {
        console.log(
          `Views not found: ${campaign.report_code}`
        );
        continue;
      }

      const { error: updateError } = await supabase
        .from("campaigns")
        .update({
          impressions: views,
          last_updated: new Date().toISOString()
        })
        .eq("id", campaign.id);

      if (updateError) {
        console.error(updateError.message);
      } else {
        console.log(
          `UPDATED ${campaign.report_code}: ${views}`
        );
      }

    } catch (error) {
      console.error(
        `FAILED ${campaign.report_code}:`,
        error.message
      );
    }
  }

  await browser.close();
}

main();
