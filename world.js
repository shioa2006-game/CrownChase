// world.js
// 定数 / タイル・アイテム種別 / World
// （※ EnemyManager は enemy.js を使用）

import { manhattan, shuffleInPlace } from "./utils.js";

/*======================
  画面レイアウト
======================*/
export const GAME_AREA_WIDTH = 600;
export const PANEL_WIDTH = 200;

/*======================
  グリッド（マップサイズ）
  ★ 35x25 → 2倍の 70x50
======================*/
export const GRID_WIDTH = 70;
export const GRID_HEIGHT = 50;

/*======================
  進行パラメータ
======================*/
export const SPAWN_INTERVAL = 60; // 参照用（実際のスポーンは enemy.js）
export const MAX_ENEMIES = 18;
export const MOVE_INTERVAL = 8;

/*======================
  列挙
======================*/
export const Tile = Object.freeze({
  FLOOR: 0,
  WALL: 1,
  HOME: 3,
  GRAVE: 4,
  DOOR: 5,
  FIRE: 6,
});

export const ItemType = Object.freeze({
  COIN: "coin",
  GEM: "gem",
  SWORD: "sword",
  RING: "ring",
  CROSS: "cross",
  KEY: "key",
  SHIELD: "shield",
  CROWN: "crown",
});

/*======================
  ドロップテーブル
======================*/
const DROP_TABLE = [
  { type: null, prob: 0.3 },
  { type: ItemType.COIN, prob: 0.55 },
  { type: ItemType.GEM, prob: 0.12 },
  { type: ItemType.CROSS, prob: 0.03 },
];

/*======================
  初期追加散布（マップ全域）
  ※ 既存配置に加えてコイン/宝石を追加でばら撒く
======================*/
const EXTRA_START_COINS = 12; // 必要に応じて調整（10〜14目安）
const EXTRA_START_GEMS = 4; // 必要に応じて調整（3〜5目安）
const AVOID_GRAVE_RADIUS = 1; // 墓の8近傍(半径1)は避けてスポーン阻害を軽減

// 初期プレイヤー位置（Player.reset と一致）
const P0_X = 8;
const P0_Y = 8;

// 初期カメラ外を保証する距離（マンハッタン）
const SWORD_MIN_OFFSCREEN_MANHATTAN = 20;

export default class World {
  constructor() {
    this.base = [];
    this.wall = [];
    this.items = [];
    this.graves = [];
    this.enemyMgr = null; // injected
    this.width = GRID_WIDTH;
    this.height = GRID_HEIGHT;

    // ★クエスト部屋矩形（ランダム配置の除外に使用）
    this.questRect = null; // {x0,y0,x1,y1}
  }

  generate() {
    this.#genTerrain();
    this.#placeFixedItems(); // 剣/鍵/盾/十字架を除く固定アイテム
    this.#placeRndWalls(); // ランダム壁（アイテム上は避ける）
    this.#placeQuest(); // クエスト部屋を先に確定
    this.#placeKeyShieldCrossRandom(); // ★鍵・盾・十字架を部屋生成後にランダム配置
    this.#placeSwordRandom(); // ★剣をランダム配置（初期画面外保証）

    // 墓リストを先に収集（近傍避けで使用）
    this.#collectGraves();

    // ★コイン/Gemをマップ全域にランダム追加散布
    this.#scatterStartingLoot();

    // （墓リストは上で収集済みのため、ここでの再収集は不要）
  }

  /*---------- 地形 ----------*/
  #genTerrain() {
    this.base.length = 0;
    this.wall.length = 0;
    this.items.length = 0;
    this.questRect = null;

    for (let y = 0; y < this.height; y++) {
      this.base[y] = [];
      this.wall[y] = [];
      for (let x = 0; x < this.width; x++) {
        this.wall[y][x] = 0;
        this.base[y][x] =
          x === 0 || y === 0 || x === this.width - 1 || y === this.height - 1
            ? Tile.WALL
            : x === P0_X && y === P0_Y
            ? Tile.HOME
            : x % 8 === 0 && y % 8 === 0
            ? Tile.GRAVE
            : Tile.FLOOR;
      }
    }
  }

  /*---------- 固定アイテム（剣/鍵/盾/十字架 以外） ----------*/
  #placeFixedItems() {
    const L = [
      [ItemType.COIN, 12, 12],
      [ItemType.COIN, 18, 8],
      [ItemType.COIN, 22, 15],
      [ItemType.COIN, 26, 6],
      [ItemType.COIN, 15, 20],
      [ItemType.COIN, 30, 18],
      [ItemType.COIN, 10, 22],
      [ItemType.COIN, 25, 10],
      [ItemType.GEM, 14, 18],
      [ItemType.GEM, 24, 8],
      [ItemType.GEM, 31, 14],
      [ItemType.GEM, 19, 20],
      // [ItemType.SWORD, 32, 6],  // ← 剣はランダム化のため配置しない
      [ItemType.RING, 16, 22],
      // [ItemType.CROSS, 10, 10], // ← ランダム化
      // [ItemType.KEY, 5, 5],     // ← ランダム化
      // [ItemType.SHIELD, 10, 5], // ← ランダム化
    ];
    L.forEach(([type, x, y]) => {
      if (this.isCellFree(x, y)) this.items.push({ type, x, y });
    });
  }

  /*---------- ランダム壁 ----------*/
  #placeRndWalls() {
    for (let y = 1; y < this.height - 1; y++) {
      for (let x = 1; x < this.width - 1; x++) {
        if (this.isCellFree(x, y) && Math.random() < 0.08) this.wall[y][x] = 1;
      }
    }
  }

  /*---------- クエスト部屋（右下） ----------*/
  #placeQuest() {
    const sx = this.width - 4,
      sy = this.height - 6;
    const W = Tile.WALL,
      D = Tile.DOOR,
      F = Tile.FIRE;

    const layout = [
      [W, D, W],
      [W, F, W],
      [W, "dragon", W],
      [W, "crown", W],
      [W, W, W],
    ];
    layout.forEach((row, iy) => {
      row.forEach((cell, ix) => {
        const x = sx + ix,
          y = sy + iy;
        this.wall[y][x] = 0;
        if (cell === W) this.base[y][x] = Tile.WALL;
        else if (cell === D) this.base[y][x] = Tile.DOOR;
        else if (cell === F) this.base[y][x] = Tile.FIRE;
        else if (cell === "crown") {
          this.base[y][x] = Tile.FLOOR;
          this.items.push({ type: ItemType.CROWN, x, y });
        } else if (cell === "dragon") {
          this.base[y][x] = Tile.FLOOR;
        }
      });
    });

    // ★部屋矩形（3x5）を記録：この範囲はランダム配置の候補から除外
    this.questRect = { x0: sx, y0: sy, x1: sx + 2, y1: sy + 4 };
  }

  /*---------- 鍵・盾・十字架のランダム配置（部屋外 & 空きマス） ----------*/
  #placeKeyShieldCrossRandom() {
    const inQuestRect = (x, y) => {
      if (!this.questRect) return false;
      const { x0, y0, x1, y1 } = this.questRect;
      return x >= x0 && x <= x1 && y >= y0 && y <= y1;
    };

    // 既存アイテム座標を禁止集合に
    const forbid = new Set(this.items.map((it) => `${it.x},${it.y}`));

    const randFreeCell = (
      maxTries = Math.max(2000, this.width * this.height * 2)
    ) => {
      for (let t = 0; t < maxTries; t++) {
        const x = 1 + Math.floor(Math.random() * (this.width - 2));
        const y = 1 + Math.floor(Math.random() * (this.height - 2));
        if (inQuestRect(x, y)) continue; // 部屋内除外（壁・炎・王冠・ドラゴン周り）
        if (!this.isCellFree(x, y)) continue; // FLOOR & 壁/既存アイテムなし
        if (forbid.has(`${x},${y}`)) continue;
        return { x, y };
      }
      // フォールバック：部屋外の最初に見つかる空きマス
      for (let yy = 1; yy < this.height - 1; yy++) {
        for (let xx = 1; xx < this.width - 1; xx++) {
          if (
            !inQuestRect(xx, yy) &&
            this.isCellFree(xx, yy) &&
            !forbid.has(`${xx},${yy}`)
          ) {
            return { x: xx, y: yy };
          }
        }
      }
      return null;
    };

    const place = (type) => {
      const p = randFreeCell();
      if (p) {
        this.items.push({ type, x: p.x, y: p.y });
        forbid.add(`${p.x},${p.y}`);
      }
    };

    place(ItemType.KEY);
    place(ItemType.SHIELD);
    place(ItemType.CROSS);
  }

  /*---------- 剣のランダム配置（部屋と初期画面外を保証） ----------*/
  #placeSwordRandom() {
    const inQuestRect = (x, y, margin = 0) => {
      if (!this.questRect) return false;
      const { x0, y0, x1, y1 } = this.questRect;
      return (
        x >= x0 - margin &&
        x <= x1 + margin &&
        y >= y0 - margin &&
        y <= y1 + margin
      );
    };

    const candidates = [];
    for (let y = 1; y < this.height - 1; y++) {
      for (let x = 1; x < this.width - 1; x++) {
        // FLOOR / 壁・設置ブロック・他アイテムなし
        if (!this.isCellFree(x, y)) continue;
        // 初期位置から十分離す（初期カメラ外）
        if (manhattan(x, y, P0_X, P0_Y) < SWORD_MIN_OFFSCREEN_MANHATTAN)
          continue;
        // ★クエスト部屋（壁・内部ふくむ）を除外
        if (inQuestRect(x, y, 0)) continue;

        candidates.push({ x, y });
      }
    }

    let pos = null;
    if (candidates.length > 0) {
      pos = candidates[Math.floor(Math.random() * candidates.length)];
    } else {
      // 念のためのフォールバック：従来の座標 or 最遠点（部屋外）
      const fallback = { x: 32, y: 6 };
      if (
        this.isCellFree(fallback.x, fallback.y) &&
        !inQuestRect(fallback.x, fallback.y)
      )
        pos = fallback;
      else {
        // 最遠のFLOOR（部屋外）を探す
        let best = null;
        let bestD = -1;
        for (let y = 1; y < this.height - 1; y++) {
          for (let x = 1; x < this.width - 1; x++) {
            if (!this.isCellFree(x, y)) continue;
            if (inQuestRect(x, y)) continue;
            const d = manhattan(x, y, P0_X, P0_Y);
            if (d > bestD) {
              bestD = d;
              best = { x, y };
            }
          }
        }
        pos = best;
      }
    }

    if (pos) this.items.push({ type: ItemType.SWORD, x: pos.x, y: pos.y });
  }

  /*---------- util ----------*/
  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  isCellFree(x, y) {
    if (this.base[y][x] !== Tile.FLOOR) return false;
    if (this.wall[y][x] !== 0) return false;
    if (this.items.some((it) => it.x === x && it.y === y)) return false;
    return true;
  }

  tileBlocks(x, y) {
    return (
      this.base[y][x] === Tile.WALL ||
      this.base[y][x] === Tile.DOOR ||
      this.wall[y][x] === 1
    );
  }

  // ★追加：アイテム存在チェック
  hasItem(x, y, type) {
    return this.items.some((i) => i.x === x && i.y === y && i.type === type);
  }

  // ★敵専用の通行判定（落ちている十字架を障害物扱い）
  tileBlocksForEnemy(x, y) {
    if (this.tileBlocks(x, y)) return true;
    return this.hasItem(x, y, ItemType.CROSS);
  }

  /*---- 🔥 boss 死亡で火消し ----*/
  clearAllFire() {
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++)
        if (this.base[y][x] === Tile.FIRE) this.base[y][x] = Tile.FLOOR;
  }

  /*---- 墓地収集 ----*/
  #collectGraves() {
    this.graves.length = 0;
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++)
        if (this.base[y][x] === Tile.GRAVE) this.graves.push({ x, y });
  }

  /*---- ドロップ ----*/
  spawnDrop(cx, cy) {
    /* lottery */
    const r = Math.random();
    let acc = 0,
      type = null;
    for (const e of DROP_TABLE) {
      acc += e.prob;
      if (r < acc) {
        type = e.type;
        break;
      }
    }
    if (!type) return;

    const tryPut = (x, y) => {
      if (!this.inBounds(x, y) || !this.isCellFree(x, y)) return false;
      this.items.push({ type, x, y });
      return true;
    };

    if (tryPut(cx, cy)) return;

    for (let rad = 1; rad <= 3; rad++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const dy = rad - Math.abs(dx);
        if (tryPut(cx + dx, cy + dy)) return;
        if (dy !== 0 && tryPut(cx + dx, cy - dy)) return;
      }
    }
  }

  /*======================
    追加：初期散布（マップ全域）
  ======================*/
  #scatterStartingLoot() {
    if (EXTRA_START_COINS <= 0 && EXTRA_START_GEMS <= 0) return;

    // 既存アイテム座標を禁止集合に
    const forbid = new Set(this.items.map((it) => `${it.x},${it.y}`));

    // コイン配置
    const coinCells = this.#pickRandomFreeCells(EXTRA_START_COINS, {
      avoidGraveR: AVOID_GRAVE_RADIUS,
      forbid,
    });
    for (const p of coinCells) {
      this.items.push({ type: ItemType.COIN, x: p.x, y: p.y });
      forbid.add(`${p.x},${p.y}`);
    }

    // Gem配置
    const gemCells = this.#pickRandomFreeCells(EXTRA_START_GEMS, {
      avoidGraveR: AVOID_GRAVE_RADIUS,
      forbid,
    });
    for (const p of gemCells) {
      this.items.push({ type: ItemType.GEM, x: p.x, y: p.y });
      forbid.add(`${p.x},${p.y}`);
    }
  }

  // 自由マス候補からランダム抽出
  #pickRandomFreeCells(count, { avoidGraveR = 0, forbid = new Set() } = {}) {
    if (count <= 0) return [];

    const cand = [];
    const qr = this.questRect;

    const isInQuestRect = (x, y) =>
      qr && x >= qr.x0 && x <= qr.x1 && y >= qr.y0 && y <= qr.y1;

    const isNearGrave = (x, y) => {
      if (avoidGraveR <= 0) return false;
      for (const g of this.graves) {
        if (manhattan(x, y, g.x, g.y) <= avoidGraveR) return true;
      }
      return false;
    };

    for (let y = 1; y < this.height - 1; y++) {
      for (let x = 1; x < this.width - 1; x++) {
        if (!this.isCellFree(x, y)) continue;
        if (isInQuestRect(x, y)) continue;
        if (isNearGrave(x, y)) continue;
        if (forbid.has(`${x},${y}`)) continue;
        cand.push({ x, y });
      }
    }

    shuffleInPlace(cand);
    return cand.slice(0, Math.min(count, cand.length));
  }
}
