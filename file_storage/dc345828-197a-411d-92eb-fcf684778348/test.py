import math
import pandas as pd
from telegram import Update
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes

# Create dataset
def get_df():
    return pd.DataFrame({
        "numbers": [10, 20, 30, 40, 50]
    })

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Math Bot ready.\nCommands:\n"
        "/data - show pandas table\n"
        "/calc <number> - calculate square, sqrt, log"
    )

async def data(update: Update, context: ContextTypes.DEFAULT_TYPE):
    df = get_df()
    df["square"] = df["numbers"] ** 2
    df["sqrt"] = df["numbers"].apply(math.sqrt)
    df["log"] = df["numbers"].apply(math.log)

    await update.message.reply_text(df.to_string())

async def calc(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        n = float(context.args[0])
        msg = (
            f"Number: {n}\n"
            f"Square: {n ** 2}\n"
            f"Sqrt: {math.sqrt(n)}\n"
            f"Log: {math.log(n)}"
        )
        await update.message.reply_text(msg)

    except:
        await update.message.reply_text("Send like: /calc 25")

def main():
    app = ApplicationBuilder().token("YOUR_BOT_TOKEN_HERE").build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("data", data))
    app.add_handler(CommandHandler("calc", calc))

    print("Bot is running...")
    app.run_polling()

if __name__ == "__main__":
    main()
