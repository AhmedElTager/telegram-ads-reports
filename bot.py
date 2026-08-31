import os
import logging
import asyncio

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
)

from supabase import create_client


# =========================
# SETTINGS
# =========================

BOT_TOKEN = os.getenv("BOT_TOKEN")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")


if not BOT_TOKEN:
    raise RuntimeError("BOT_TOKEN غير موجود")

if not SUPABASE_URL:
    raise RuntimeError("SUPABASE_URL غير موجود")

if not SUPABASE_KEY:
    raise RuntimeError("SUPABASE_KEY غير موجود")


supabase = create_client(
    SUPABASE_URL,
    SUPABASE_KEY
)


# =========================
# LOGGING
# =========================

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO
)


# =========================
# START
# =========================

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):

    user = update.effective_user

    telegram_id = user.id

    name = (
        user.full_name
        or user.username
        or "عميل Telegram"
    )


    try:

        # البحث عن العميل
        result = (
            supabase
            .table("clients")
            .select("id,name,telegram_user_id")
            .eq(
                "telegram_user_id",
                telegram_id
            )
            .limit(1)
            .execute()
        )


        client = None

        if result.data:

            client = result.data[0]


        # إنشاء العميل إذا لم يكن موجودًا
        if not client:

            insert_result = (
                supabase
                .table("clients")
                .insert({
                    "name": name,
                    "telegram_user_id": telegram_id
                })
                .execute()
            )


            if insert_result.data:

                client = insert_result.data[0]


        # رابط التقرير العام
        report_url = (
            "https://ahmedeltager.github.io/"
            "telegram-ads-reports/"
        )


        keyboard = [

            [
                InlineKeyboardButton(
                    "📊 فتح تقارير إعلاناتي",
                    url=report_url
                )
            ]

        ]


        await update.message.reply_text(

            f"مرحبًا {name} 👋\n\n"

            "أهلاً بك في El Tager · Ads\n\n"

            "من خلال الموقع يمكنك متابعة "
            "تقارير حملاتك الإعلانية "
            "والإحصائيات الخاصة بك.\n\n"

            "اضغط على الزر بالأسفل لفتح التقارير.",

            reply_markup=InlineKeyboardMarkup(
                keyboard
            )

        )


    except Exception as e:

        logging.exception(
            "Database error"
        )

        await update.message.reply_text(
            "❌ حدث خطأ أثناء تسجيل حسابك. "
            "حاولي مرة أخرى."
        )


# =========================
# HELP
# =========================

async def help_command(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE
):

    await update.message.reply_text(

        "📊 El Tager · Ads\n\n"

        "/start - فتح التقارير\n"
        "/help - المساعدة"

    )


# =========================
# MAIN
# =========================

def main():

    application = (
        Application.builder()
        .token(BOT_TOKEN)
        .build()
    )


    application.add_handler(
        CommandHandler(
            "start",
            start
        )
    )


    application.add_handler(
        CommandHandler(
            "help",
            help_command
        )
    )


    print(
        "ElTagerReportsBot يعمل الآن..."
    )


    application.run_polling(
        drop_pending_updates=True
    )


if __name__ == "__main__":
    main()
