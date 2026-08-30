const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");
const fs = require("fs");

// =====================================
// SUPABASE
// =====================================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// =====================================
// SETTINGS
// =====================================

const DELAY_BETWEEN_CAMPAIGNS_MS = 4000;
const MAX_RETRIES = 2;
const NAV_TIMEOUT_MS = 60000;

// =====================================
// SLEEP
// =====================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =====================================
// CLEAN NUMBER
// =====================================

function cleanNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  let text = String(value)
    .trim()
    .replace(/^"|"$/g, "")
    .replace(/\s/g, "");

  if (!text) {
    return null;
  }

  text = text.replace(/[^\d.-]/g, "");

  if (!text) {
    return null;
  }

  const number = Number(text);

  if (!Number.isFinite(number)) {
    return null;
  }

  return number;
}

// =====================================
// DETECT CSV DELIMITER
// =====================================

function detectDelimiter(line) {
  const delimiters = [",", "\t", ";"];

  let bestDelimiter = ",";
  let bestCount = 0;

  for (const delimiter of delimiters) {
    const count =
      line.split(delimiter).length - 1;

    if (count > bestCount) {
      bestCount = count;
      bestDelimiter = delimiter;
    }
  }

  return bestDelimiter;
}

// =====================================
// SPLIT CSV LINE
// =====================================

function splitCSVLine(line, delimiter) {
  const result = [];

  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      insideQuotes = !insideQuotes;
      current += char;
      continue;
    }

    if (
      char === delimiter &&
      !insideQuotes
    ) {
      result.push(
        current
          .replace(/^"|"$/g, "")
          .trim()
      );

      current = "";

      continue;
    }

    current += char;
  }

  result.push(
    current
      .replace(/^"|"$/g, "")
      .trim()
  );

  return result;
}

// =====================================
// GET VIEWS
// =====================================

async function getViews(page) {
  const bodyText =
    await page.locator("body").innerText();

  console.log(
    "PAGE URL:",
    page.url()
  );

  console.log(
    "PAGE TITLE:",
    await page.title()
  );

  // =================================
  // METHOD 1
  // =================================

  let match =
    bodyText.match(
      /Views[\s\S]{0,100}?([\d,]+)/i
    );

  if (match) {
    const views =
      cleanNumber(match[1]);

    if (views !== null) {
      console.log(
        "Views found from body:",
        views
      );

      return views;
    }
  }

  // =================================
  // METHOD 2
  // =================================

  try {
    const viewsLocator =
      page
        .getByText(
          "Views",
          {
            exact: true
          }
        )
        .first();

    if (
      await viewsLocator.count()
    ) {
      const parentText =
        await viewsLocator
          .locator("..")
          .innerText();

      console.log(
        "Views parent:",
        parentText
      );

      const numbers =
        parentText.match(
          /[\d,]+/g
        );

      if (numbers) {
        for (
          const number of numbers
        ) {
          const value =
            cleanNumber(number);

          if (
            value !== null
          ) {
            console.log(
              "Views found from element:",
              value
            );

            return value;
          }
        }
      }
    }

  } catch (error) {

    console.log(
      "Views element error:",
      error.message
    );

  }

  return null;
}

// =====================================
// GET STARTED BOT FROM CSV
// =====================================

async function getStartedBotFromCSV(page) {

  console.log(
    "Trying to read Started bot from CSV..."
  );

  try {

    // =================================
    // FIND STARTED BOT
    // =================================

    const startedBot =
      page
        .getByText(
          "Started bot",
          {
            exact: true
          }
        )
        .first();

    if (
      !(await startedBot.count())
    ) {

      console.log(
        "Started bot element NOT FOUND."
      );

      return null;
    }

    console.log(
      "Started bot element found."
    );

    // =================================
    // CLICK
    // =================================

    try {

      await startedBot
        .scrollIntoViewIfNeeded();

      await startedBot.click({
        force: true
      });

    } catch (error) {

      console.log(
        "Started bot click retry..."
      );

      await startedBot.evaluate(
        (el) => el.click()
      );

    }

    console.log(
      "Started bot selected."
    );

    await page.waitForTimeout(
      1500
    );

    // =================================
    // FIND CSV
    // =================================

    const csvLinks =
      page.getByText(
        "CSV",
        {
          exact: true
        }
      );

    const csvCount =
      await csvLinks.count();

    console.log(
      "CSV buttons found:",
      csvCount
    );

    if (
      csvCount === 0
    ) {

      console.log(
        "CSV button NOT FOUND."
      );

      return null;
    }

    // =================================
    // CSV BUTTON
    // =================================

    const csvButton =
      csvLinks.first();

    await csvButton
      .scrollIntoViewIfNeeded();

    // =================================
    // DOWNLOAD
    // =================================

    const downloadPromise =
      page.waitForEvent(
        "download",
        {
          timeout: 20000
        }
      );

    try {

      await csvButton.click({
        force: true
      });

    } catch (error) {

      console.log(
        "CSV click retry..."
      );

      await csvButton.evaluate(
        (el) => el.click()
      );

    }

    const download =
      await downloadPromise;

    console.log(
      "CSV download started."
    );

    // =================================
    // CSV PATH
    // =================================

    const csvPath =
      await download.path();

    if (!csvPath) {

      console.log(
        "CSV path unavailable."
      );

      return null;
    }

    let csvText =
      fs.readFileSync(
        csvPath,
        "utf8"
      );

    // =================================
    // REMOVE BOM
    // =================================

    csvText =
      csvText.replace(
        /^\uFEFF/,
        ""
      );

    console.log(
      "CSV content preview:"
    );

    console.log(
      csvText.substring(
        0,
        1200
      )
    );

    // =================================
    // LINES
    // =================================

    const lines =
      csvText
        .split(/\r?\n/)
        .map(
          (line) =>
            line.trim()
        )
        .filter(
          (line) =>
            line.length > 0
        );

    if (
      lines.length < 2
    ) {

      console.log(
        "CSV contains no data."
      );

      return 0;
    }

    // =================================
    // DELIMITER
    // =================================

    const delimiter =
      detectDelimiter(
        lines[0]
      );

    console.log(
      "CSV delimiter:",
      JSON.stringify(
        delimiter
      )
    );

    // =================================
    // HEADERS
    // =================================

    const headers =
      splitCSVLine(
        lines[0],
        delimiter
      ).map(
        (header) =>
          header
            .replace(
              /^"|"$/g,
              ""
            )
            .trim()
            .toLowerCase()
        );

    console.log(
      "CSV HEADERS:",
      headers
    );

    // =================================
    // FIND STARTED BOT COLUMN
    // =================================

    let startedBotColumn =
      headers.findIndex(
        (header) =>
          header
            .replace(
              /\s+/g,
              " "
            )
            .includes(
              "started bot"
            )
      );

    if (
      startedBotColumn === -1
    ) {

      startedBotColumn =
        headers.findIndex(
          (header) => {

            const normalized =
              header
                .replace(
                  /[_-]/g,
                  " "
                )
                .replace(
                  /\s+/g,
                  " "
                )
                .trim();

            return (
              normalized ===
                "started bot" ||
              normalized.includes(
                "started bot"
              )
            );

          }
        );

    }

    console.log(
      "Started bot column:",
      startedBotColumn
    );

    if (
      startedBotColumn === -1
    ) {

      console.log(
        "STARTED BOT COLUMN NOT FOUND."
      );

      return null;
    }

    // =================================
    // TOTAL STARTED BOT
    // =================================

    let totalStartedBot = 0;

    let rowsWithValue = 0;

    for (
      let i = 1;
      i < lines.length;
      i++
    ) {

      const columns =
        splitCSVLine(
          lines[i],
          delimiter
        );

      if (
        columns.length <=
        startedBotColumn
      ) {
        continue;
      }

      const rawValue =
        columns[
          startedBotColumn
        ];

      const value =
        cleanNumber(
          rawValue
        );

      if (
        value !== null
      ) {

        totalStartedBot +=
          value;

        rowsWithValue++;

      }

    }

    console.log(
      "Rows with Started bot:",
      rowsWithValue
    );

    console.log(
      "TOTAL STARTED BOT:",
      totalStartedBot
    );

    return totalStartedBot;

  } catch (error) {

    console.log(
      "Started bot CSV error:",
      error.message
    );

    return null;

  }
}

// =====================================
// SAVE HISTORY
// =====================================

async function saveViewsHistory(
  campaignId,
  views
) {

  console.log(
    "Saving views history..."
  );

  const {
    error
  } =
    await supabase
      .from(
        "campaign_stats_history"
      )
      .insert({
        campaign_id:
          campaignId,

        impressions:
          views,

        recorded_at:
          new Date().toISOString()
      });

  if (error) {

    console.error(
      "History insert error:",
      error.message
    );

    return false;
  }

  console.log(
    "VIEWS HISTORY SAVED"
  );

  return true;
}

// =====================================
// PROCESS CAMPAIGN
// =====================================

async function processCampaign(
  context,
  campaign
) {

  let lastError = null;

  for (
    let attempt = 1;
    attempt <= MAX_RETRIES + 1;
    attempt++
  ) {

    let page = null;

    try {

      console.log(
        `Attempt ${attempt} for campaign: ${campaign.campaign_name}`
      );

      // =================================
      // NEW PAGE
      // =================================

      page =
        await context.newPage();

      // =================================
      // OPEN TELEGRAM STATS
      // =================================

      await page.goto(
        campaign.stats_url,
        {
          waitUntil:
            "domcontentloaded",

          timeout:
            NAV_TIMEOUT_MS
        }
      );

      console.log(
        "Telegram page loaded."
      );

      // =================================
      // WAIT VIEWS
      // =================================

      try {

        await page.waitForSelector(
          "text=Views",
          {
            timeout: 15000
          }
        );

      } catch (_) {

        console.log(
          "Views selector timeout."
        );

      }

      await page.waitForTimeout(
        2000
      );

      // =================================
      // GET VIEWS
      // =================================

      const views =
        await getViews(
          page
        );

      // =================================
      // GET STARTED BOT
      // =================================

      const actions =
        await getStartedBotFromCSV(
          page
        );

      console.log(
        "================================"
      );

      console.log(
        "REAL VIEWS:",
        views
      );

      console.log(
        "REAL STARTED BOT:",
        actions
      );

      // =================================
      // VIEWS NOT FOUND
      // =================================

      if (
        views === null
      ) {

        console.log(
          "Views NOT FOUND."
        );

        try {

          await page.screenshot({
            path:
              `telegram-${campaign.id}.png`,

            fullPage:
              true
          });

        } catch (_) {}

        await page.close();

        return;
      }

      // =================================
      // UPDATE CAMPAIGN
      // =================================

      const updateData = {

        impressions:
          views,

        last_updated:
          new Date().toISOString()

      };

      if (
        actions !== null
      ) {

        updateData.actions =
          actions;

      }

      const {
        error: updateError
      } =
        await supabase
          .from(
            "campaigns"
          )
          .update(
            updateData
          )
          .eq(
            "id",
            campaign.id
          );

      if (
        updateError
      ) {

        console.error(
          "Supabase update error:",
          updateError.message
        );

      } else {

        console.log(
          "UPDATED SUCCESSFULLY"
        );

        console.log(
          "Campaign:",
          campaign.campaign_name
        );

        console.log(
          "Views:",
          views
        );

        console.log(
          "Started bot:",
          actions
        );


        // =================================
        // SAVE HISTORY
        // =================================

        await saveViewsHistory(
          campaign.id,
          views
        );

      }

      await page.close();

      return;

    } catch (error) {

      lastError =
        error;

      console.error(
        `FAILED attempt ${attempt}:`,
        error.message
      );

      if (page) {

        try {

          await page.close();

        } catch (_) {}

      }

      if (
        attempt <=
        MAX_RETRIES
      ) {

        console.log(
          "Retrying..."
        );

        await sleep(
          3000
        );

      }

    }

  }

  console.error(
    "ALL ATTEMPTS FAILED:",
    lastError
      ? lastError.message
      : "unknown error"
  );

}

// =====================================
// MAIN
// =====================================

async function main() {

  console.log(
    "================================"
  );

  console.log(
    "Telegram Ads updater started."
  );

  // =================================
  // GET CAMPAIGNS
  // =================================

  const {
    data: campaigns,
    error
  } =
    await supabase
      .from(
        "campaigns"
      )
      .select(
        `
        id,
        campaign_name,
        report_code,
        stats_url,
        impressions,
        actions
        `
      )
      .not(
        "stats_url",
        "is",
        null
      );

  if (error) {

    throw new Error(
      error.message
    );

  }

  if (
    !campaigns ||
    campaigns.length === 0
  ) {

    console.log(
      "No campaigns with stats_url."
    );

    return;

  }

  console.log(
    `Found ${campaigns.length} campaign(s).`
  );

  // =================================
  // BROWSER
  // =================================

  const browser =
    await chromium.launch({
      headless:
        true
    });

  const context =
    await browser.newContext({

      viewport: {
        width: 1280,
        height: 900
      },

      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"

    });

  // =================================
  // PROCESS CAMPAIGNS
  // =================================

  for (
    const campaign of campaigns
  ) {

    console.log(
      "================================"
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
      "Old Views:",
      campaign.impressions
    );

    console.log(
      "Old Actions:",
      campaign.actions
    );

    await processCampaign(
      context,
      campaign
    );

    await sleep(
      DELAY_BETWEEN_CAMPAIGNS_MS
    );

  }

  // =================================
  // CLOSE
  // =================================

  await browser.close();

  console.log(
    "================================"
  );

  console.log(
    "Telegram Ads update finished."
  );

}

// =====================================
// START
// =====================================

main()
  .catch(
    (error) => {

      console.error(
        error
      );

      process.exit(
        1
      );

    }
  );
