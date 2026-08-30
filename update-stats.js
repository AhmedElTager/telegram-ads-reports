const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ===============================
// تنظيف الأرقام
// ===============================

function cleanNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value)
    .replace(/[,\.\s]/g, "")
    .replace(/[^\d]/g, "");

  if (!text) {
    return null;
  }

  const number = Number(text);

  return Number.isFinite(number) ? number : null;
}

// ===============================
// قراءة Views
// ===============================

async function getViews(page) {
  await page.waitForTimeout(5000);

  const bodyText = await page.locator("body").innerText();

  console.log("PAGE URL:", page.url());
  console.log("PAGE TITLE:", await page.title());

  let match = bodyText.match(
    /Views[\s\S]{0,100}?([\d,]+(?:\.\d+)?)/i
  );

  if (match) {
    const views = cleanNumber(match[1]);

    if (views !== null) {
      console.log("Views found:", views);
      return views;
    }
  }

  // محاولة من العنصر نفسه
  try {
    const viewsLocator = page
      .getByText("Views", { exact: true })
      .first();

    if (await viewsLocator.count()) {
      const parentText = await viewsLocator
        .locator("..")
        .innerText();

      console.log("Views parent:", parentText);

      const numbers = parentText.match(/[\d,]+/g);

      if (numbers) {
        for (const n of numbers) {
          const value = cleanNumber(n);

          if (value !== null) {
            console.log("Views found from element:", value);
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
// قراءة Started bot / Actions
// ===============================

async function getActions(page) {

  await page.waitForTimeout(3000);

  console.log(
    "Trying to read Started bot..."
  );

  // --------------------------------
  // أول محاولة:
  // البحث عن Started bot في الصفحة
  // --------------------------------

  let bodyText = await page.locator("body").innerText();

  let match = bodyText.match(
    /Started\s*bot[\s\S]{0,200}?([\d,]+)/i
  );

  if (match) {

    const actions = cleanNumber(match[1]);

    if (actions !== null) {

      console.log(
        "Started bot found from body:",
        actions
      );

      return actions;
    }
  }

  // --------------------------------
  // ثاني محاولة:
  // البحث عن Actions
  // --------------------------------

  match = bodyText.match(
    /Actions[\s\S]{0,200}?([\d,]+)/i
  );

  if (match) {

    const actions = cleanNumber(match[1]);

    if (actions !== null) {

      console.log(
        "Actions found from body:",
        actions
      );

      return actions;
    }
  }

  // --------------------------------
  // ثالث محاولة:
  // الضغط على Started bot
  // --------------------------------

  try {

    const startedBot = page
      .getByText(
        "Started bot",
        {
          exact: true
        }
      )
      .first();

    if (await startedBot.count()) {

      console.log(
        "Started bot button found."
      );

      await startedBot.click();

      await page.waitForTimeout(1500);

      bodyText =
        await page.locator("body").innerText();

      console.log(
        "After Started bot click:"
      );

      console.log(
        bodyText.substring(
          Math.max(
            0,
            bodyText.indexOf("Started bot") - 300
          ),
          bodyText.indexOf("Started bot") + 700
        )
      );

      // نبحث مرة أخرى عن رقم
      match = bodyText.match(
        /Started\s*bot[\s\S]{0,300}?([\d,]+)/i
      );

      if (match) {

        const actions =
          cleanNumber(match[1]);

        if (actions !== null) {

          console.log(
            "Started bot after click:",
            actions
          );

          return actions;
        }
      }
    }

  } catch (error) {

    console.log(
      "Started bot click failed:",
      error.message
    );
  }

  // --------------------------------
  // رابع محاولة:
  // البحث داخل HTML
  // --------------------------------

  try {

    const html = await page.content();

    match = html.match(
      /Started\s*bot[\s\S]{0,1000}?([\d,]+)/i
    );

    if (match) {

      const actions =
        cleanNumber(match[1]);

      if (actions !== null) {

        console.log(
          "Started bot found from HTML:",
          actions
        );

        return actions;
      }
    }

  } catch (error) {

    console.log(
      "HTML extraction failed:",
      error.message
    );
  }

  console.log(
    "ACTIONS NOT FOUND."
  );

  return null;
}

// ===============================
// Main
// ===============================

async function main() {

  const {
    data: campaigns,
    error
  } = await supabase

    .from("campaigns")

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

  // ===============================
  // تشغيل Chromium
  // ===============================

  const browser =
    await chromium.launch({
      headless: true
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

  const page =
    await context.newPage();

  // ===============================
  // الحملات
  // ===============================

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

    try {

      // =============================
      // فتح صفحة Telegram
      // =============================

      await page.goto(
        campaign.stats_url,
        {
          waitUntil:
            "networkidle",

          timeout:
            90000
        }
      );

      console.log(
        "Telegram page loaded."
      );

      // =============================
      // Views
      // =============================

      const views =
        await getViews(page);

      // =============================
      // Actions
      // =============================

      const actions =
        await getActions(page);

      console.log(
        "--------------------------------"
      );

      console.log(
        "REAL VIEWS:",
        views
      );

      console.log(
        "REAL ACTIONS:",
        actions
      );

      // =============================
      // لو Views مش موجودة
      // =============================

      if (views === null) {

        console.log(
          "Views NOT FOUND."
        );

        await page.screenshot({

          path:
            `telegram-${campaign.id}.png`,

          fullPage: true

        });

        continue;
      }

      // =============================
      // بيانات التحديث
      // =============================

      const updateData = {

        impressions:
          views,

        last_updated:
          new Date().toISOString()

      };

      // نحفظ Actions لو اتوجدت
      if (actions !== null) {

        updateData.actions =
          actions;

      }

      // =============================
      // تحديث Supabase
      // =============================

      const {
        error: updateError
      } = await supabase

        .from("campaigns")

        .update(
          updateData
        )

        .eq(
          "id",
          campaign.id
        );

      // =============================
      // نتيجة التحديث
      // =============================

      if (updateError) {

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
          "Actions:",
          actions
        );

      }

    } catch (error) {

      console.error(
        `FAILED ${campaign.campaign_name}:`,
        error.message
      );

    }

  }

  // ===============================
  // إغلاق المتصفح
  // ===============================

  await browser.close();

  console.log(
    "================================"
  );

  console.log(
    "Telegram Ads update finished."
  );
}

// ===============================
// تشغيل
// ===============================

main()
  .catch(
    (error) => {

      console.error(
        error
      );

      process.exit(1);

    }
  );
