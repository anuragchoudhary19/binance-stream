require("dotenv").config();
const OS = require("os");
process.env.UV_THREADPOOL_SIZE = OS.cpus().length;
const express = require("express");
const morgan = require("morgan");
const _ = require("lodash");
const Binance = require("node-binance-api");
const { setIntervalAsync, clearIntervalAsync } = require("set-interval-async");
const cors = require("cors");
let { log } = console;
const app = express();
app.use(morgan("dev"));
app.use(express.json());
app.use(cors());
app.use(express.urlencoded({ extended: true }));
const API_KEY = process.env.API_KEY;
const SECRET_KEY = process.env.SECRET_KEY;
let binance = new Binance().options({
  APIKEY: API_KEY,
  APISECRET: SECRET_KEY,
  recvWindow: 60000,
  useServerTime: true,
  verbose: true,
  reconnect: true,
  family: 4,
});
let PORT = process.env.PORT || 3003;
let server = app.listen(PORT, () => {
  console.log(`Stream app running on port ${PORT}`);
});
let chart = {};
let lastUpdatedTime = new Map();
let endpoints = {};
let timeframes = ["5m", "15m", "1h", "4h", "1d"];
let limit = 500;

const setChart = (sym, int, data) => {
  if (
    lastUpdatedTime.has(sym + int) &&
    Date.now() - lastUpdatedTime.get(sym + int) < 5000
  )
    return;
  if (data === undefined || Object.keys(data).length < limit) return;
  if (chart[sym] === undefined) chart[sym] = {};
  chart[sym][int] = data;
  lastUpdatedTime.set(sym + int, Date.now());
};
const stream = async (symbols, interval) => {
  try {
    let id = await binance.futuresChart(symbols, interval, setChart, limit);
    endpoints[interval] = id;
  } catch (error) {
    console.log("stream error", error);
  }
};
async function startKlineStream() {
  try {
    let futures = await binance.futuresDaily();
    let exchangeInfo = await binance.futuresExchangeInfo();
    let onboardDaysMoreThan500 = exchangeInfo?.symbols
      .filter((s) => Date.now() - s.onboardDate > 1000 * 60 * 60 * 24 * 500) // Only coins onboarded more than 500 days
      .filter((s) => s.status === "TRADING") // Only coins that are trading
      .filter((s) => s.symbol.endsWith("USDT")) // Only USDT pairs
      .map((s) => s.symbol);
    let highVolCoins = Object.values(futures)
      .filter((t) => onboardDaysMoreThan500.includes(t.symbol)) // Only coins onboarded more than 500 days
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume)) // Sort by volume (highest first)
      .slice(0, 50)
      .map((coin) => coin.symbol);
    // console.log(highVolCoins);
    timeframes.forEach((t) => {
      let subscriptions = binance.futuresSubscriptions();
      if (!subscriptions[endpoints[t]]) {
        stream(highVolCoins, t);
      }
    });
    // setIntervalAsync(() => {
    //   let subscriptions = binance.futuresSubscriptions();
    //   for (let interval in endpoints) {
    //     if (!subscriptions[endpoints[interval]]) {
    //       stream(highVolCoins, interval);
    //     }
    //   }
    // }, 1000 * 5);
  } catch (error) {
    console.log("error", error);
  }
}
startKlineStream();
app.get("/health", (req, res) => {
  res.send({ ok: true });
});
app.get("/stream", (req, res) => {
  try {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const sendKeepAlive = setInterval(() => {
      res.write(`: keep-alive\n\n`); // comment line to keep connection open
    }, 25000); // send every 25 seconds to avoid timeouts

    let intervalId = setInterval(() => {
      Object.keys(chart).forEach((symbol) => {
        res.write(`data: ${JSON.stringify({ [symbol]: chart[symbol] })}\n\n`);
      });
    }, 5000);

    req.on("close", () => {
      console.log("Client closed connection");
      clearInterval(sendKeepAlive);
      clearInterval(intervalId);
      res.end();
    });
  } catch (error) {
    console.error("Error in SSE:", error);
  }
});
