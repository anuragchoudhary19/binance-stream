require("dotenv").config();
const OS = require("os");
process.env.UV_THREADPOOL_SIZE = OS.cpus().length;
const express = require("express");
const axios = require("axios");
const { Server } = require("socket.io");
const morgan = require("morgan");
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
  // APIKEY: API_KEY,
  // APISECRET: SECRET_KEY,
  recvWindow: 60000,
  useServerTime: true,
  verbose: true,
  reconnect: true,
  family: 4,
});
let PORT = process.env.PORT || 3003;
let server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
let subscribe;
let chart = {};
let endpoints = {};

//Start socket server
const io = new Server(server, {
  cors: {
    origin: process.env.ORIGIN,
    credentials: true,
    maxHttpBufferSize: 1e8,
  },
});
io.on("connection", (socket) => {
  socket.on("subscribe", () => {
    if (subscribe) clearInterval(subscribe);
    subscribe = setInterval(() => {
      let data = { chart };
      socket.emit("chart", data);
    }, 5000);
  });
});

const setChart = (symbol, interval, data) => {
  if (Object.keys(data).length === 0 || data === undefined) return;
  if (chart[symbol] === undefined) chart[symbol] = {};
  chart[symbol][interval] = data;
};
const stream = async (symbols, interval) => {
  try {
    let id = await binance.futuresChart(symbols, interval, setChart, 500);
    endpoints[interval] = id;
  } catch (error) {
    console.log("stream error", error);
  }
};

let blacklist = ["USDCUSDT", "TRXUSDT"];
let highVolCoins = [];
async function startKlineStream() {
  try {
    let futures = await binance.futuresDaily();
    highVolCoins = Object.values(futures)
      .filter((t) => t.symbol.endsWith("USDT")) // Only USDT pairs
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume)) // Sort by volume (highest first)
      .slice(0, 50)
      .map((coin) => coin.symbol)
      .sort((a, b) => a.charCodeAt(0) - b.charCodeAt(0)); // Get top `limit` coins
    console.log(highVolCoins);
    let timeframes = ["5m", "15m", "1h", "4h", "1d"];
    timeframes.forEach((t) => {
      stream(highVolCoins, t);
    });
  } catch (error) {
    console.log("error", error);
  }
}
startKlineStream();
setIntervalAsync(() => {
  let subscriptions = binance.futuresSubscriptions();
  for (let interval in endpoints) {
    if (!subscriptions[endpoints[interval]]) {
      stream(highVolCoins, interval);
    }
  }
}, 1000 * 5);
