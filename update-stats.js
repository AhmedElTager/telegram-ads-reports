const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");
const fs = require("fs");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ===============================
// SETTINGS
// ===============================

const DELAY_BETWEEN_CAMPAIGNS_MS = 4000;
const MAX_RETRIES = 2;
const NAV_TIMEOUT_MS = 60000;

// ===============================
// SLEEP
// ===============================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ===============================
// CLEAN METRIC NUMBER
// مهم:
// لا نحول التاريخ أو النص إلى رقم
// ===============================

function cleanMetricNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  let text = String(value)
    .trim()
    .replace(/^"|"$/g, "")
    .trim();

  if (!text) {
    return null;
  }

  // إزالة الفواصل والمسافات فقط
  text = text.replace(/,/g, "").replace(/\s/g, "");

  // لازم يكون رقم فقط
  if (!/^\d+(?:\.\d+)?$/.test(text)) {
    return null;
  }

  const number = Number(text);

  if (!Number.isFinite(number)) {
    return null;
  }

  return number;
}

// ===============================
// NORMALIZE HEADER
// ===============================

function normalizeHeader(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .replace(/^"|"$/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ===============================
// DETECT CSV DELIMITER
// ===============================

function detectDelimiter(line) {
  const delimiters = [",", "\t", ";"];

  let bestDelimiter = null;
  let bestScore = -1;

  for (const delimiter of delimiters) {
    const columns = splitCSVLine(line, delimiter);

    const normalized = columns.map(normalizeHeader);

    let score = 0;

    for (const header of normalized) {
      if (header === "date" || header.includes("date")) {
        score += 2;
      }

      if (header === "views" || header.includes("views")) {
        score += 3;
      }

      if (header === "clicks" || header.includes("clicks")) {
        score += 2;
      }

      if (
        header === "started bot" ||
        header.includes("started bot")
      ) {
        score += 5;
      }
    }

    // عدد الأعمدة يساعد في حالة التعادل
    score += columns.length / 100;

    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delimiter;
    }
  }

  // لو مفيش فاصل واضح
  if (!bestDelimiter) {
    return ",";
  }

  return bestDelimiter;
}

// ===============================
// SPLIT CSV LINE
// ===============================

function splitCSVLine(line, delimiter) {
  const result = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      // التعامل مع ""
      if (
        insideQuotes &&
        line[i + 1] === '"'
      ) {
        current += '"';
        i++;
        continue;
      }

      insideQuotes = !insideQuotes;
      continue;
    }

    if (
      char === delimiter &&
      !insideQuotes
    ) {
      result.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current.trim());

  return result;
}

// ===============================
// READ VIEWS
// ===============================

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

  // --------------------------------
  // الطريقة الأولى
  // --------------------------------

  let match =
    bodyText.match(
      /Views[\s\S]{0,100}?([\d,]+)/i
    );

  if (match) {
    const views =
      cleanMetricNumber(match[1]);

    if (views !== null) {
      console.log(
        "Views found from body:",
        views
      );

      return views;
    }
  }

  // --------------------------------
  // الطريقة الثانية
  // --------------------------------

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
        for (const n of numbers) {
          const value =
            cleanMetricNumber(n);

          if (value !== null) {
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

// ===============================
// READ STARTED BOT FROM CSV
// ===============================

async function getStartedBotFromCSV(page) {
  console.log(
    "Trying to read Started bot from CSV..."
  );

  try {
    // --------------------------------
    // البحث عن Started bot
    // --------------------------------

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

    // --------------------------------
    // اختيار Started bot
    // --------------------------------

    try {
      await startedBot.scrollIntoViewIfNeeded();

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

    await page.waitForTimeout(1500);

    // --------------------------------
    // CSV buttons
    // --------------------------------

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

    if (csvCount === 0) {
      console.log(
        "CSV button NOT FOUND."
      );

      return null;
    }

    // أول CSV الخاص بالإحصائيات
    const csvButton =
      csvLinks.first();

    await csvButton.scrollIntoViewIfNeeded();

    // --------------------------------
    // Download
    // --------------------------------

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

    // --------------------------------
    // CSV PATH
    // --------------------------------

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

    // إزالة BOM
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
        1500
      )
    );

    // --------------------------------
    // LINES
    // --------------------------------

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

    // --------------------------------
    // DELIMITER
    // --------------------------------

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

    // --------------------------------
    // HEADERS
    // --------------------------------

    const headers =
      splitCSVLine(
        lines[0],
        delimiter
      ).map(
        normalizeHeader
      );

    console.log(
      "CSV HEADERS:",
      headers
    );

    // --------------------------------
    // البحث الدقيق عن Started bot
    // --------------------------------

    let startedBotColumn =
      headers.findIndex(
        (header) =>
          header === "started bot"
      );

    // --------------------------------
    // البحث الاحتياطي
    // --------------------------------

    if (
      startedBotColumn === -1
    ) {
      startedBotColumn =
        headers.findIndex(
          (header) =>
            header.includes(
              "started bot"
            )
        );
    }

    console.log(
      "Started bot column:",
      startedBotColumn
    );

    // --------------------------------
    // حماية مهمة جدًا
    // لو العمود غير موجود لا نقرأ أي حاجة
    // --------------------------------

    if (
      startedBotColumn === -1
    ) {
      console.log(
        "STARTED BOT COLUMN NOT FOUND."
      );

      console.log(
        "Headers detected:",
        headers
      );

      return null;
    }

    // --------------------------------
    // تأكيد أن العمود فعلًا Started bot
    // --------------------------------

    const selectedHeader =
      headers[startedBotColumn];

    if (
      !selectedHeader.includes(
        "started bot"
      )
    ) {
      console.log(
        "SAFETY CHECK FAILED."
      );

      console.log(
        "Selected header:",
        selectedHeader
      );

      return null;
    }

    console.log(
      "Confirmed Started bot column:",
      selectedHeader
    );

    // --------------------------------
    // جمع Started bot
    // --------------------------------

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

      console.log(
        `CSV row ${i}: Started bot raw =`,
        JSON.stringify(rawValue)
      );

      const value =
        cleanMetricNumber(
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

// ===============================
// PROCESS CAMPAIGN
// ===============================

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

      // --------------------------------
      // فتح الصفحة
      // --------------------------------

      page =
        await context.newPage();

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

      // --------------------------------
      // انتظار Views
      // --------------------------------

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

      // --------------------------------
      // VIEWS
      // --------------------------------

      const views =
        await getViews(page);

      // --------------------------------
      // STARTED BOT
      // --------------------------------

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

      // --------------------------------
      // Views غير موجودة
      // --------------------------------

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

      // --------------------------------
      // UPDATE DATA
      // --------------------------------

      const updateData = {
        impressions:
          views,

        last_updated:
          new Date().toISOString()
      };

      // --------------------------------
      // Started bot
      // --------------------------------

      if (
        actions !== null
      ) {
        updateData.actions =
          actions;
      }

      // --------------------------------
      // SUPABASE UPDATE
      // --------------------------------

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

// ===============================
// MAIN
// ===============================

async function main() {

  // --------------------------------
  // قراءة الحملات من Supabase
  // --------------------------------

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

  // --------------------------------
  // Browser
  // --------------------------------

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

  // --------------------------------
  // الحملات
  // --------------------------------

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

  await browser.close();

  console.log(
    "================================"
  );

  console.log(
    "Telegram Ads update finished."
  );
}

// ===============================
// START
// ===============================

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
