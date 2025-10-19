// player.js
// Player – movement / battle / inventory（emoji依存なし）

import {
  GRID_WIDTH,
  GRID_HEIGHT,
  MOVE_INTERVAL,
  Tile,
  ItemType,
} from "./world.js";

/* ===== HP回復レート（家でZ：1Gold → 20HP） ===== */
const HP_PER_GOLD = 20;

/* ===== shared FX objects ===== */
export const fxBattle = { active: false, x: 0, y: 0, timer: 0, enemy: null };
export const fxEnemyInfo = { active: false, enemy: null, timer: 0 };
export const fxEnemyHits = [];

/* ===== Item service ===== */
class ItemService {
  constructor(world, player) {
    this.w = world;
    this.p = player;
  }

  tryPickup(item) {
    const idx = this.w.items.indexOf(item);
    if (idx === -1) return false;

    let success = false;
    switch (item.type) {
      case ItemType.COIN:
        this.p.gold++;
        success = true;
        break;
      case ItemType.SWORD:
        this.p.hasWeapon = true;
        success = true;
        break;
      case ItemType.RING:
        success = this.#equip("hasRing", "ring");
        break;
      case ItemType.CROSS:
        success = this.#equip("hasCross", "cross");
        break;
      case ItemType.GEM:
        success = this.#equip(null, "gem");
        break;
      case ItemType.KEY:
        success = this.#equip("hasKey", "key");
        break;
      case ItemType.SHIELD:
        success = this.#equip("hasShield", "shield");
        break;
      case ItemType.CROWN:
        success = this.#equip("hasCrown", "crown");
        break;
      default:
        return false;
    }

    if (success) this.w.items.splice(idx, 1);
    return success;
  }

  #equip(flagName, equipKey) {
    if (this.p.equipment) return false;
    if (flagName) this.p[flagName] = true;
    this.p.equipment = equipKey;
    return true;
  }
}

/* ===== Player class ===== */
export default class Player {
  constructor(world, enemyList, game) {
    this.w = world;
    this.en = enemyList;
    this.game = game;

    this.itemSvc = new ItemService(world, this);
    this.reset();
  }

  reset() {
    this.x = 8;
    this.y = 8;
    this.hp = this.maxHp = 20;
    this.level = 1;
    this.totalExp = this.currentExp = 0;
    this.expToNext = 5;
    this.baseStr = 0;
    this.bonusHp = 0; // 互換のため残すが、Gold→最大HPは廃止（未使用）
    this.gold = 0;
    this.killCount = 0;

    this.equipment = null;
    this.hasWeapon =
      this.hasRing =
      this.hasCross =
      this.hasKey =
      this.hasShield =
      this.hasCrown =
        false;

    this.isCarryWall = false;
    this.carryX = this.carryY = -1;

    this.moveTimer = 0;
    this.lastDir = { x: 0, y: 1 };
    this.autoAtk = { on: false, dir: { x: 0, y: 0 }, tgt: null };
  }

  attack() {
    return this.hasWeapon ? 4 + this.baseStr : 0;
  }
  defense() {
    return this.totalExp;
  }

  /* movement + battle trigger */
  updateMovement(keys) {
    if (this.moveTimer > 0) this.moveTimer--;

    // fire damage
    if (this.w.base[this.y][this.x] === Tile.FIRE && !this.hasShield) {
      this.#damage(100);
      if (this.hp <= 0) return false;
    }

    // auto-attack
    if (this.autoAtk.on) {
      const cancel =
        (keys.left && this.autoAtk.dir.x !== -1) ||
        (keys.right && this.autoAtk.dir.x !== 1) ||
        (keys.up && this.autoAtk.dir.y !== -1) ||
        (keys.down && this.autoAtk.dir.y !== 1);
      if (cancel) this.autoAtk.on = false;
      else if (this.autoAtk.tgt && this.en.includes(this.autoAtk.tgt)) {
        // ★ 十字架所持でも、プレイヤーは攻撃可能（AIのみ抑制）
        this.hasWeapon
          ? this.#combat(this.autoAtk.tgt)
          : this.#unarmed(this.autoAtk.tgt);
        return true;
      } else {
        this.autoAtk.on = false;
      }
    }

    if (this.moveTimer > 0) return false;

    // input → move dir
    let dx = 0,
      dy = 0;
    if (keys.left) dx = -1;
    else if (keys.right) dx = 1;
    else if (keys.up) dy = -1;
    else if (keys.down) dy = 1;
    if (!dx && !dy) return false;

    this.lastDir = { x: dx, y: dy };
    const nx = this.x + dx,
      ny = this.y + dy;
    if (nx < 0 || ny < 0 || nx >= GRID_WIDTH || ny >= GRID_HEIGHT) return false;
    if (this.#blocks(nx, ny)) return false;

    // enemy on destination? → 戦闘開始（十字架所持でも可）
    const foe = this.en.find((e) => e.x === nx && e.y === ny);
    if (foe) {
      this.hasWeapon ? this.#combat(foe) : this.#unarmed(foe);
      if (this.en.includes(foe))
        this.autoAtk = { on: true, dir: { x: dx, y: dy }, tgt: foe };
      return true;
    }

    // walk
    this.x = nx;
    this.y = ny;
    // ★ HOME 踏破時の自動全回復は廃止（Goldを使ってZで回復する仕様へ）
    // if (this.w.base[ny][nx] === Tile.HOME) this.hp = this.maxHp;

    this.moveTimer = MOVE_INTERVAL;
    return true;
  }

  onZ() {
    const hereItem = this.w.items.find((i) => i.x === this.x && i.y === this.y);
    const tile = this.w.base[this.y][this.x];

    // coin auto
    if (hereItem && hereItem.type === ItemType.COIN) {
      this.itemSvc.tryPickup(hereItem);
      return;
    }

    // wall ops
    if (this.hasRing && this.isCarryWall && this.#dropWall()) return;
    if (this.hasRing && !this.isCarryWall && this.#pickupWall()) return;

    // home deposit（Gold→HP回復 / Gem預入 / Crown納品）
    if (tile === Tile.HOME) {
      this.#deposit();
      return;
    }

    // item pick
    if (hereItem) {
      this.itemSvc.tryPickup(hereItem);
      return;
    }

    // unequip / drop
    if (this.equipment && !["ring", "cross"].includes(this.equipment))
      this.#dropItem();
    else if (this.equipment === "ring") this.#takeOffRing();
    else if (this.equipment === "cross") this.#takeOffCross();
  }

  #blocks(x, y) {
    if (this.w.base[y][x] === Tile.DOOR) {
      if (this.hasKey) {
        this.w.base[y][x] = Tile.FLOOR;
        this.hasKey = false;
        return false;
      }
      return true;
    }
    return this.w.base[y][x] === Tile.WALL || this.w.wall[y][x] === 1;
  }

  #battleStart(en) {
    fxBattle.active = true;
    fxBattle.x = this.x;
    fxBattle.y = this.y;
    fxBattle.timer = 6;
    fxBattle.enemy = en;

    fxEnemyInfo.active = true;
    fxEnemyInfo.enemy = en;
    fxEnemyInfo.timer = -1; // 敵が死んだ時点から180f表示（updateFxで制御）
  }
  #combat(en) {
    this.#battleStart(en);
    en.hp -= Math.max(1, this.attack() - en.def);
    fxEnemyHits.push({ x: en.x, y: en.y, timer: 10 });

    if (en.hp <= 0) {
      if (en.kind === "dragon") this.w.clearAllFire();
      this.en.splice(this.en.indexOf(en), 1);
      this.w.spawnDrop(en.x, en.y);
      this.killCount++;
      this.#gainExp(en.expReward);
      this.autoAtk.on = false;
    } else {
      this.#damage(Math.max(1, en.str - this.defense()));
    }
  }
  #unarmed(en) {
    this.#battleStart(en);
    this.#damage(Math.max(1, en.str));
  }
  #damage(d) {
    this.hp = Math.max(0, this.hp - d);
  }

  #gainExp(xp) {
    this.totalExp += xp;
    this.currentExp += xp;
    while (this.currentExp >= this.expToNext) {
      this.currentExp -= this.expToNext;
      this.level++;
      this.expToNext = Math.floor(this.level * 1.5) + 3;
      this.maxHp += 8; // レベルアップのみで最大HP上昇
      // レベルアップでは回復しない（家のみ回復）
      if (this.hp > this.maxHp) this.hp = this.maxHp; // 念のためクランプ
    }
  }

  #canDrop() {
    // 判定式は isCellFree と完全同一（挙動不変）
    return this.w.isCellFree(this.x, this.y);
  }
  #dropItem() {
    if (!this.equipment || !this.#canDrop()) return false;
    if (["ring", "cross"].includes(this.equipment)) return false;
    this.w.items.push({ type: this.equipment, x: this.x, y: this.y });
    if (this.equipment === "key") this.hasKey = false;
    if (this.equipment === "shield") this.hasShield = false;
    if (this.equipment === "crown") this.hasCrown = false;
    this.equipment = null;
    return true;
  }
  #takeOffCross() {
    if (this.equipment !== "cross" || !this.hasCross || !this.#canDrop())
      return false;
    this.w.items.push({ type: ItemType.CROSS, x: this.x, y: this.y });
    this.hasCross = false;
    this.equipment = null;
    return true;
  }
  #takeOffRing() {
    if (this.equipment !== "ring" || !this.hasRing || !this.#canDrop())
      return false;
    if (this.isCarryWall && this.#placeWall(this.x, this.y)) {
      this.isCarryWall = false;
      this.carryX = this.carryY = -1;
      this.#afterDrop();
    }
    this.w.items.push({ type: ItemType.RING, x: this.x, y: this.y });
    this.hasRing = false;
    this.equipment = null;
    return true;
  }

  #deposit() {
    // --- Gold→HP回復（1Gold=10HP）、最大HPはレベルのみで上昇 ---
    const missing = this.maxHp - this.hp;
    if (missing > 0 && this.gold > 0) {
      const need = Math.ceil(missing / HP_PER_GOLD);
      const use = Math.min(this.gold, need);
      this.gold -= use;
      this.hp = Math.min(this.maxHp, this.hp + use * HP_PER_GOLD);
    }

    // Gem 預け：攻撃力+1（装備解除）
    if (this.equipment === "gem") {
      this.baseStr++;
      this.equipment = null;
    }

    // Crown 納品：勝利
    if (this.equipment === "crown") {
      this.equipment = null;
      this.hasCrown = false;
      this.game.win = true;
      return;
    }

    // 旧仕様の「Gold→最大HP増」「預け入れで全回復」は廃止
  }

  #validWall(x, y) {
    return x > 0 && y > 0 && x < GRID_WIDTH - 1 && y < GRID_HEIGHT - 1;
  }
  #placeWall(x, y) {
    if (!this.#validWall(x, y)) return false;
    if (this.w.base[y][x] !== Tile.FLOOR) return false;
    if (this.w.wall[y][x] !== 0) return false;
    if (this.en.some((e) => e.x === x && e.y === y)) return false;
    if (this.w.items.some((i) => i.x === x && i.y === y)) return false;
    this.w.wall[y][x] = 1;
    return true;
  }
  #pickupWall() {
    const order = [
      [this.lastDir.x, this.lastDir.y],
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    for (const [dx, dy] of order) {
      const wx = this.x + dx,
        wy = this.y + dy;
      if (!this.#validWall(wx, wy)) continue;
      if (this.w.wall[wy][wx] === 1) {
        this.w.wall[wy][wx] = 0;
        this.isCarryWall = true;
        this.carryX = wx;
        this.carryY = wy;
        return true;
      }
    }
    return false;
  }
  #dropWall() {
    if (!this.isCarryWall) return false;
    if (!this.#placeWall(this.x, this.y)) return false;
    this.isCarryWall = false;
    this.carryX = this.carryY = -1;
    this.#afterDrop();
    return true;
  }
  #afterDrop() {
    const dirs8 = [
      [-1, -1],
      [0, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
      [1, 1],
    ];
    for (const [dx, dy] of dirs8) {
      const nx = this.x + dx,
        ny = this.y + dy;
      if (nx < 0 || ny < 0 || nx >= GRID_WIDTH || ny >= GRID_HEIGHT) continue;
      if (this.#blocks(nx, ny)) continue;
      if (this.en.some((e) => e.x === nx && e.y === ny)) continue;
      this.x = nx;
      this.y = ny;
      return;
    }
  }

  updateFx() {
    if (fxBattle.active && --fxBattle.timer <= 0) fxBattle.active = false;
    if (fxEnemyInfo.active) {
      if (fxEnemyInfo.timer > 0 && --fxEnemyInfo.timer <= 0)
        fxEnemyInfo.active = false;
      else if (fxEnemyInfo.timer === -1 && !this.en.includes(fxEnemyInfo.enemy))
        fxEnemyInfo.timer = 180;
    }
    for (let i = fxEnemyHits.length - 1; i >= 0; i--)
      if (--fxEnemyHits[i].timer <= 0) fxEnemyHits.splice(i, 1);
  }
}
