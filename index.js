require('dotenv').config();
const TreasureIslandBot = require('./src/bot');

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('Error: BOT_TOKEN is not defined in .env file');
  process.exit(1);
}

const bot = new TreasureIslandBot(token);
bot.launch();
