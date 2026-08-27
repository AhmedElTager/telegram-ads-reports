const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* =========================
   Helpers
========================= */

function cleanNumber(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") return null;

  const cleaned = value
    .replace(/[,\s]/g, "")
    .replace(/[^\d]/g, "");

  if (!cleaned) return null;

  const number = Number(cleaned);

  return Number.isFinite(number) ? number : null;
}

/* =========================
   Find views in normal text
========================= */

function findViewsInText(text) {
  if (!text) return null;

  const patterns = [
    /overall\s*views[\s:]*([\d,.\s]+)/i,
    /total\s*views[\s:]*([\d,.\s]+)/i,
    /views[\s:]*([\d,.\s]+)/i,
    /views\s*\n\s*([\d,.\s]+)/i,
    /impressions[\s:]*([\d,.\s]+)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match) {
      const value = cleanNumber(match[1]);

      if (value !== null) {
        return value;
      }
    }
  }

  return null;
}

/* =========================
   Find views inside JSON
========================= */

function findViewsInObject(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findViewsInObject(item);

      if (result !== null) {
        return result;
      }
    }

    return null;
  }

  if (typeof value !== "object") {
    return null;
  }

  const keys = Object.keys(value);

  const preferredKeys = [
    "overall_views",
    "overallViews",
    "total_views",
    "totalViews",
    "views",
    "impressions",
    "total_impressions",
    "totalImpressions"
  ];

  for (const key of preferredKeys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const number = cleanNumber(value[key]);

      if (number !== null) {
        return number;
      }
    }
  }

  for (const key of keys) {
    const result = findViewsInObject(value[key]);

    if (result !== null) {
      return result;
    }
  }

  return null;
}

/* =========================
   Main
========================= */

async function main() {
  console.log("Starting Telegram Ads statistics updater...");

  const { data: campaigns, error } = await supabase
    .from("campaigns")
    .select(
      "id, report_code, stats_url, impressions, status, campaign_name"
    )
    .not("stats_url", "is", null);

  if (error) {
    throw new Error(
      `Supabase error while loading campaigns: ${error.message}`
    );
  }

  if (!campaigns || campaigns.length === 0) {
    console.log("No campaigns with stats_url found.");
    return;
  }

  console.log(`Found ${campaigns.length} campaign(s).`);

  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    viewport: {
      width: 1365,
      height: 900
    },
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });

  const page = await context.newPage();

  for (const campaign of campaigns) {
    console.log("");
    console.log("======================================");
    console.log(
      `Checking campaign: ${
        campaign.report_code || campaign.campaign_name || campaign.id
      }`
    );
    console.log(`Stats URL: ${campaign.stats_url}`);

    let networkViews = null;

    try {
      /* =========================
         Capture Telegram responses
      ========================= */

      page.removeAllListeners("response");

      page.on("response", async (response) => {
        try {
          const url = response.url();

          if (
            !url.includes("telegram.org") &&
            !url.includes("ads.telegram.org")
          ) {
            return;
          }

          const contentType =
            response.headers()["content-type"] || "";

          if (
            !contentType.includes("json") &&
            !contentType.includes("javascript") &&
            !contentType.includes("text")
          ) {
            return;
          }

          let body = "";

          try {
            body = await response.text();
          } catch {
            return;
          }

          if (!body) return;

          /* Try JSON */
          try {
            const json = JSON.parse(body);

            const found = findViewsInObject(json);

            if (found !== null) {
              networkViews = found;

              console.log(
                `Views found from network response: ${found}`
              );
            }
          } catch {
            /* Not JSON */
          }

          /* Try plain text */
          if (networkViews === null) {
            const found = findViewsInText(body);

            if (found !== null) {
              networkViews = found;

              console.log(
                `Views found from network text: ${found}`
              );
            }
          }
        } catch {
          /* Ignore individual response errors */
        }
      });

      /* =========================
         Open stats page
      ========================= */

      await page.goto(campaign.stats_url, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      });

      console.log("Telegram stats page opened.");

      /* Give Telegram time to load the statistics */
      await page.waitForTimeout(8000);

      /* Additional wait for network activity */
      try {
        await page.waitForLoadState("networkidle", {
          timeout: 15000
        });
      } catch {
        /* networkidle is not required */
      }

      await page.waitForTimeout(3000);

      /* =========================
         Read page text
      ========================= */

      const bodyText = await page.locator("body").innerText();

      console.log(
        "Page text length:",
        bodyText.length
      );

      let views = networkViews;

      /* =========================
         Try normal page text
      ========================= */

      if (views === null) {
        views = findViewsInText(bodyText);

        if (views !== null) {
          console.log(
            `Views found in page text: ${views}`
          );
        }
      }

      /* =========================
         Try HTML
      ========================= */

      if (views === null) {
        const html = await page.content();

        views = findViewsInText(html);

        if (views !== null) {
          console.log(
            `Views found in page HTML: ${views}`
          );
        }
      }

      /* =========================
         Try aria labels / titles
      ========================= */

      if (views === null) {
        const accessibilityText = await page.locator(
          "[aria-label], [title]"
        ).evaluateAll((elements) =>
          elements
            .map((el) => {
              return (
                el.getAttribute("aria-label") ||
                el.getAttribute("title") ||
                ""
              );
            })
            .join("\n")
        );

        views = findViewsInText(accessibilityText);

        if (views !== null) {
          console.log(
            `Views found in accessibility data: ${views}`
          );
        }
      }

      /* =========================
         Try script contents
      ========================= */

      if (views === null) {
        const scripts = await page.locator("script").allTextContents();

        for (const script of scripts) {
          const found = findViewsInText(script);

          if (found !== null) {
            views = found;

            console.log(
              `Views found inside script: ${views}`
            );

            break;
          }

          try {
            const json = JSON.parse(script);

            const jsonViews = findViewsInObject(json);

            if (jsonViews !== null) {
              views = jsonViews;

              console.log(
                `Views found inside JSON script: ${views}`
              );

              break;
            }
          } catch {
            /* Ignore */
          }
        }
      }

      /* =========================
         Nothing found
      ========================= */

      if (views === null) {
        console.log(
          `Views NOT FOUND for ${
            campaign.report_code || campaign.id
          }`
        );

        console.log(
          "Page title:",
          await page.title()
        );

        continue;
      }

      /* =========================
         Update Supabase
      ========================= */

      const { error: updateError } = await supabase
        .from("campaigns")
        .update({
          impressions: views,
          last_updated: new Date().toISOString()
        })
        .eq("id", campaign.id);

      if (updateError) {
        console.error(
          `Supabase update failed for ${
            campaign.report_code || campaign.id
          }:`,
          updateError.message
        );

        continue;
      }

      console.log(
        `UPDATED ${
          campaign.report_code || campaign.id
        } => ${views} impressions`
      );
    } catch (error) {
      console.error(
        `FAILED ${
          campaign.report_code || campaign.id
        }: ${error.message}`
      );
    }
  }

  await context.close();
  await browser.close();

  console.log("");
  console.log("======================================");
  console.log("Telegram Ads statistics updater finished.");
  console.log("======================================");
}

main().catch((error) => {
  console.error("FATAL ERROR:");
  console.error(error);
  process.exit(1);
});
