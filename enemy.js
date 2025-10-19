// enemy.js
// 敵の生成・移動管理
// ・移動は「優先軸の1歩のみ」→塞がれていたらそのターンは動かない（リトライなし）
// ・十字架の恐怖は半径4のみ（FEAR_RADIUS=4）
// ・強モンスターは段階解禁（ハードゲート）＋時間スロープは緩やか（ソフトウェイト）

import { SPAWN_INTERVAL, MAX_ENEMIES } from "./world.js"; // cap は world 側の定数を参照
import { DIRS8, manhattan, shuffleInPlace } from "./utils.js";

/* ==== 基本設定 ==== */
const CAP_WITHOUT_SWORD = 8;
const FEAR_RADIUS = 4;

/* 敵テンプレート（元の強さ） */
const ENEMY_TABLE = [
  { kind: "bat", hp: 8, str: 5, def: 1, exp: 2, weight: 100 },
  { kind: "slime", hp: 12, str: 10, def: 2, exp: 3, weight: 0 },
  { kind: "goblin", hp: 18, str: 15, def: 4, exp: 4, weight: 0 },
  { kind: "wizard", hp: 25, str: 20, def: 6, exp: 5, weight: 0 },
  { kind: "skull", hp: 35, str: 25, def: 9, exp: 6, weight: 0 },
  { kind: "knight", hp: 50, str: 30, def: 12, exp: 8, weight: 0 },
  { kind: "lizardman", hp: 70, str: 35, def: 16, exp: 10, weight: 0 },
  { kind: "ogre", hp: 85, str: 40, def: 18, exp: 12, weight: 0 },
];

/* ---- ハードゲート（段階解禁） ---- */
const HARD_GATES = [
  { needSword: false }, // 0: bat（常時）
  { needSword: false, minLevel: 2, minKills: 3 }, // 1: slime（序盤からOK）
  { needSword: true, minLevel: 3, minKills: 8 }, // 2: goblin
  { needSword: true, minLevel: 4, minKills: 15 }, // 3: wizard
  { needSword: true, minLevel: 5, minKills: 25 }, // 4: skull
  { needSword: true, minLevel: 6, minKills: 30 }, // 5: knight
  { needSword: true, minLevel: 7, minKills: 35 }, // 6: lizardman
  { needSword: true, minLevel: 8, minKills: 40 }, // 7: ogre
];

/* 一撃で倒されそう・反撃が通らないなら逃走（元仕様） */
function shouldFleeByPower(player, e) {
  if (!player?.hasWeapon) return false;
  const oneHitKill = player.attack() - e.def >= e.hp;
  const enemyCantHurt = player.defense() >= e.str;
  return player.hp >= player.maxHp && oneHitKill && enemyCantHurt;
}

export class EnemyManager {
  constructor(world, player) {
    this.w = world;
    this.p = player; // Game 側から後で注入される
    this.all = [];
    this.spawnTimer = 0;
    this.turnCount = 0;
  }

  reset() {
    this.all.length = 0;
    this.spawnTimer = 0;
    this.turnCount = 0;

    // boss: dragon（固定配置）
    const dx = this.w.width - 3;
    const dy = this.w.height - 4;
    this.all.push({
      x: dx,
      y: dy,
      kind: "dragon",
      hp: 120,
      maxHp: 120,
      str: 44,
      def: 21,
      exp: 30,
      expReward: 30,
      immobile: true,
    });
  }

  onWorldPhase() {
    this.#updateWeights();
    this.#spawnFromGraves();
    this.turnCount++;
  }

  /* ==== スポーン ==== */
  #spawnFromGraves() {
    if (++this.spawnTimer < SPAWN_INTERVAL) return;
    this.spawnTimer = 0;

    const cap = this.#maxCap();
    if (this.all.length >= cap) return;

    // 各墓につき 8 近傍の FLOOR のみ（半径2は禁止）＋ プレイヤーから距離>=6
    let spawnedThisTick = 0;
    const tickCap = this.p?.hasWeapon ? 4 : 2;

    // ランダムに墓を巡る（偏り防止）
    const graves = this.w.graves.slice();
    shuffleInPlace(graves);

    for (const g of graves) {
      if (this.all.length >= cap) break;
      if (spawnedThisTick >= tickCap) break;
      if (this.#spawnAtGrave(g.x, g.y)) spawnedThisTick++;
    }
  }

  #maxCap() {
    // 剣未所持は控えめ、剣取得後は MAX_ENEMIES まで
    return this.p?.hasWeapon
      ? MAX_ENEMIES
      : Math.min(MAX_ENEMIES, CAP_WITHOUT_SWORD);
  }

  #spawnAtGrave(gx, gy) {
    for (const [dx, dy] of DIRS8) {
      const x = gx + dx;
      const y = gy + dy;

      if (!this.w.inBounds(x, y)) continue;
      // isCellFree は FLOOR/壁/アイテムで判定。アイテム上に湧かない（十字架含む）
      if (!this.w.isCellFree(x, y)) continue;
      // プレイヤーからの最小距離（マンハッタン）≥ 6
      if (this.p && manhattan(x, y, this.p.x, this.p.y) < 6) continue;

      const t = this.#nextType();
      this.all.push({
        x,
        y,
        kind: t.kind,
        hp: t.hp,
        maxHp: t.hp,
        str: t.str,
        def: t.def,
        exp: t.exp,
        expReward: t.exp,
        immobile: false,
      });
      return true; // その墓では1体だけ
    }
    return false;
  }

  #nextType() {
    const total = ENEMY_TABLE.reduce((s, e) => s + (e.weight || 0), 0);
    if (total <= 0) return ENEMY_TABLE[0];
    let r = Math.random() * total;
    for (const e of ENEMY_TABLE) {
      r -= e.weight || 0;
      if (r <= 0) return e;
    }
    return ENEMY_TABLE[0];
  }

  /* ==== 移動（片軸のみ、詰まったら不動） ==== */
  moveAll() {
    this.all.forEach((e) => {
      if (e.immobile) return;

      // 逃走判定：十字架の半径4 or 戦力差による恐怖
      const fearByCross =
        this.p?.hasCross &&
        manhattan(e.x, e.y, this.p.x, this.p.y) <= FEAR_RADIUS;

      const flee = fearByCross || shouldFleeByPower(this.p, e);

      // 目標（逃走ならプレイヤーと逆方向に1歩離れる目安点、追尾ならプレイヤー位置）
      const tx = flee ? e.x + Math.sign(e.x - this.p.x) : this.p.x;
      const ty = flee ? e.y + Math.sign(e.y - this.p.y) : this.p.y;

      const dx = tx - e.x;
      const dy = ty - e.y;

      // 優先軸を1つだけ動かす
      let mx = 0,
        my = 0;
      if (Math.abs(dx) > Math.abs(dy)) {
        mx = Math.sign(dx);
      } else if (Math.abs(dy) > 0) {
        my = Math.sign(dy);
      } else {
        return; // 目標と同座標
      }

      const nx = e.x + mx;
      const ny = e.y + my;

      // ブロック・重複・プレイヤー上・十字架上は不可（詰まったらそのまま）
      if (!this.w.inBounds(nx, ny)) return;
      if (this.w.tileBlocksForEnemy(nx, ny)) return; // ← DOOR/壁/置き壁/十字架を一括判定
      if (this.all.some((o) => o !== e && o.x === nx && o.y === ny)) return;
      if (nx === this.p?.x && ny === this.p?.y) return; // 戦闘は別処理

      e.x = nx;
      e.y = ny;
    });
  }

  /* ==== 出現ウェイト更新（ソフト）＋ ハードゲート適用 ==== */
  #updateWeights() {
    // 進行度を少し前倒し：時間係数を速め、剣入手で微ブースト
    const tProg = Math.min(1, this.turnCount / 1800); // 2200 → 1800
    const lProg = Math.min(1, ((this.p?.level ?? 1) - 1) / 12);
    const kProg = Math.min(1, (this.p?.killCount ?? 0) / 80);
    const swordBonus = this.p?.hasWeapon ? 0.12 : 0; // 剣取得後に押し上げ
    const prog = Math.min(
      1,
      0.55 * tProg + 0.3 * lProg + 0.15 * kProg + swordBonus
    );

    ENEMY_TABLE.forEach((e, i) => {
      // ハードゲートに未到達なら weight=0
      if (!this.#isUnlocked(i)) {
        e.weight = 0;
        return;
      }

      // 要求進行度を全体で15%前倒し
      const N = ENEMY_TABLE.length;
      const req = (i / (N - 1)) * 0.85;

      if (prog < req) {
        e.weight = 0;
      } else {
        // 解禁後は既存の比率ロジックを維持
        const over = prog - req; // 0..1
        const base = 140;
        const slope = 40;
        const rarityMul = 1 / (1 + i * 0.35);
        const w = Math.max(5, base - over * slope) * rarityMul;
        e.weight = w;
      }
    });
  }

  #isUnlocked(index) {
    const g = HARD_GATES[index] ?? { needSword: false };
    if (g.needSword && !this.p?.hasWeapon) return false;
    const lvOk = g.minLevel ? (this.p?.level ?? 1) >= g.minLevel : true;
    const kOk = g.minKills ? (this.p?.killCount ?? 0) >= g.minKills : true;
    // レベル or 撃破数のどちらか到達で解禁（剣が必要な階層は剣必須も満たす）
    return lvOk || kOk;
  }
}
