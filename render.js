// render.js
// アイソメ描画＆UI。ワールドの実寸（world.width/height）を使用

import {
  GAME_AREA_WIDTH,
  PANEL_WIDTH,
  GRID_WIDTH,
  GRID_HEIGHT,
  Tile,
  ItemType,
  MAX_ENEMIES,
} from "./world.js";
import { buildSpriteAtlas } from "./sprites.js";
import { fxBattle, fxEnemyInfo, fxEnemyHits } from "./player.js";
import { ITEM_TO_SPRITE } from "./spriteKeys.js";

/*======================
    ISO tile parameters
  ======================*/
export const FRAME_SIZE = 64;
export const ISO_TILE_W = FRAME_SIZE;
export const ISO_TILE_H = FRAME_SIZE / 2;
const HALF_W = ISO_TILE_W / 2;
const HALF_H = ISO_TILE_H / 2;

/* 右パネルのスプライトは常に 40px 固定 */
const PANEL_ICON = 40;

export function gridToIso(gx, gy) {
  return { x: (gx - gy) * HALF_W, y: (gx + gy) * HALF_H };
}

/*======================
    Sprite Atlas
  ======================*/
let atlasImg = null;
let atlasRect = null;

export function initRender() {
  const atlas = buildSpriteAtlas({ dotSize: 5, frameSize: FRAME_SIZE });
  atlasImg = atlas.image;
  atlasRect = atlas.rects;
}

function drawAtlas(key, x, y, size = FRAME_SIZE) {
  const r = atlasRect[key];
  if (!r) return;
  image(atlasImg, x, y, size, size, r.x, r.y, r.w, r.h);
}

/*======================
    Helpers
  ======================*/
function playerFacingKey(player) {
  const dir =
    player.lastDir.x > 0
      ? "Right"
      : player.lastDir.x < 0
      ? "Left"
      : player.lastDir.y < 0
      ? "Up"
      : "Down";
  const base =
    player.isCarryWall || !player.hasWeapon ? "playerPlain" : "playerSword";
  return `${base}${dir}`;
}
function enemyKeyByKind(kind) {
  return `enemy${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
}
function itemKeyByType(t) {
  // 二重管理を排除（挙動は同一）
  return ITEM_TO_SPRITE[t] ?? null;
}
function drawIsoDiamond(cx, cy, w, h) {
  beginShape();
  vertex(cx, cy - h / 2);
  vertex(cx + w / 2, cy);
  vertex(cx, cy + h / 2);
  vertex(cx - w / 2, cy);
  endShape(CLOSE);
}

/*======================
    Main draw
  ======================*/
export function drawScene(game) {
  const { world, player, enemies } = game;

  // タイトル
  if (game.title) {
    background(17);
    textAlign(CENTER, CENTER);
    fill("#64B5F6");
    textSize(48);
    text("CROWN  CHASE", width / 2, height / 2 - 80);
    fill("#fff");
    textSize(24);
    text("Move: Arrow / WASD", width / 2, height / 2 - 10);
    text("Z:  Pick-up / Action", width / 2, height / 2 + 25);
    text("Press any key to start", width / 2, height / 2 + 80);
    return;
  }

  // 左のマップ領域
  noStroke();
  fill(17);
  rect(0, 0, GAME_AREA_WIDTH, height);

  // 実際のワールド寸法
  const W = world?.width ?? GRID_WIDTH;
  const H = world?.height ?? GRID_HEIGHT;

  // 床の格子
  stroke(48);
  strokeWeight(1);
  noFill();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const iso = gridToIso(x + 0.5, y + 0.5);
      const sx = iso.x + game.camera.x;
      const sy = iso.y + game.camera.y;
      if (sx < -ISO_TILE_W || sx > GAME_AREA_WIDTH + ISO_TILE_W) continue;
      if (sy < -ISO_TILE_H || sy > height + ISO_TILE_H) continue;

      beginShape();
      vertex(sx, sy - HALF_H);
      vertex(sx + HALF_W, sy);
      vertex(sx, sy + HALF_H);
      vertex(sx - HALF_W, sy);
      endShape(CLOSE);
    }
  }

  // 奥行き描画順
  const cmds = [];

  // タイル & 壁
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const baseId = world.base[y][x];
      if (baseId !== 0) {
        const key =
          baseId === Tile.WALL
            ? "wall"
            : baseId === Tile.HOME
            ? "home"
            : baseId === Tile.DOOR
            ? "door"
            : baseId === Tile.FIRE
            ? "fire"
            : baseId === Tile.GRAVE
            ? "grave"
            : null;
        if (key) {
          const d = gridToIso(x + 0.5, y + 0.5).y;
          cmds.push({
            depth: d,
            draw: () => {
              const p = gridToIso(x + 0.5, y + 0.5);
              drawAtlas(
                key,
                p.x + game.camera.x - FRAME_SIZE / 2,
                p.y + game.camera.y - FRAME_SIZE / 2
              );
            },
          });
        }
      }
      if (world.wall[y][x] === 1) {
        const d = gridToIso(x + 0.5, y + 0.5).y + 0.1;
        cmds.push({
          depth: d,
          draw: () => {
            const p = gridToIso(x + 0.5, y + 0.5);
            drawAtlas(
              "wall",
              p.x + game.camera.x - FRAME_SIZE / 2,
              p.y + game.camera.y - FRAME_SIZE / 2
            );
          },
        });
      }
    }
  }

  // アイテム
  world.items.forEach((it) => {
    const key = itemKeyByType(it.type);
    if (!key) return;
    const d = gridToIso(it.x + 0.5, it.y + 0.5).y + 0.05;
    cmds.push({
      depth: d,
      draw: () => {
        const p = gridToIso(it.x + 0.5, it.y + 0.5);
        drawAtlas(
          key,
          p.x + game.camera.x - FRAME_SIZE / 2,
          p.y + game.camera.y - FRAME_SIZE / 2
        );
      },
    });
  });

  // 敵
  enemies.forEach((e) => {
    const key = enemyKeyByKind(e.kind || "bat");
    const d = gridToIso(e.x + 0.5, e.y + 0.5).y + 0.2;
    cmds.push({
      depth: d,
      draw: () => {
        const p = gridToIso(e.x + 0.5, e.y + 0.5);
        drawAtlas(
          key,
          p.x + game.camera.x - FRAME_SIZE / 2,
          p.y + game.camera.y - FRAME_SIZE / 2
        );
      },
    });
  });

  // プレイヤー（ブロック運搬時は plain スプライト）
  {
    const key = playerFacingKey(player);
    const d = gridToIso(player.x + 0.5, player.y + 0.5).y + 0.3;
    cmds.push({
      depth: d,
      draw: () => {
        const p = gridToIso(player.x + 0.5, player.y + 0.5);
        drawAtlas(
          key,
          p.x + game.camera.x - FRAME_SIZE / 2,
          p.y + game.camera.y - FRAME_SIZE / 2
        );

        if (player.isCarryWall) {
          const wc = gridToIso(player.carryX + 0.5, player.carryY + 0.5);
          stroke(255, 255, 0);
          strokeWeight(2);
          line(
            p.x + game.camera.x,
            p.y + game.camera.y,
            wc.x + game.camera.x,
            wc.y + game.camera.y
          );
          noStroke();
          drawAtlas(
            "wall",
            wc.x + game.camera.x - FRAME_SIZE / 2,
            wc.y + game.camera.y - FRAME_SIZE / 2
          );
        }
      },
    });
  }

  // FX
  if (fxBattle.active && Math.floor(fxBattle.timer / 3) % 2 === 0) {
    const p = gridToIso(fxBattle.x + 0.5, fxBattle.y + 0.5);
    noStroke();
    fill(255, 0, 0, 120);
    drawIsoDiamond(
      p.x + game.camera.x,
      p.y + game.camera.y,
      ISO_TILE_W,
      ISO_TILE_H
    );
  }
  fxEnemyHits.forEach((ef) => {
    if (Math.floor(ef.timer / 2) % 2 === 0) {
      const p = gridToIso(ef.x + 0.5, ef.y + 0.5);
      noStroke();
      fill(255, 0, 0, 140);
      drawIsoDiamond(
        p.x + game.camera.x,
        p.y + game.camera.y,
        ISO_TILE_W,
        ISO_TILE_H
      );
    }
  });

  // 描画
  cmds.sort((a, b) => a.depth - b.depth);
  cmds.forEach((c) => c.draw());

  // パネル
  drawPanel(game);

  // 終了/勝利
  if (game.over) drawGameOver(game);
  else if (game.win) drawWin(game);
}

/*======================
    Panel
  ======================*/
function drawPanel(game) {
  const { player, enemies } = game;

  noStroke();
  fill("#282828");
  rect(GAME_AREA_WIDTH, 0, PANEL_WIDTH, height);
  stroke("#444");
  line(GAME_AREA_WIDTH, 0, GAME_AREA_WIDTH, height);

  let px = GAME_AREA_WIDTH + 10,
    y = 20,
    lh = 23;

  fill("#64B5F6");
  textSize(18);
  textAlign(LEFT, TOP);
  text("STATUS", px, y);
  y += lh + 10;

  fill("#fff");
  textSize(16);
  text(`Level: ${player.level}`, px, y);
  y += lh;

  fill(
    player.hp <= player.maxHp * 0.3
      ? "#FF6464"
      : player.hp <= player.maxHp * 0.6
      ? "#FFFF64"
      : "#64FF64"
  );
  text(`HP: ${player.hp}/${player.maxHp}`, px, y);
  y += lh;

  fill("#fff");
  text(
    `EXP: ${player.expToNext - player.currentExp} / ${player.totalExp}`,
    px,
    y
  );
  y += lh;

  fill(player.hasWeapon ? "#FFD700" : "#999");
  text(`STR: ${player.attack()}`, px, y);
  y += lh;

  fill("#FFD700");
  text(`GOLD: ${player.gold}`, px, y);
  y += lh + 5;

  fill("#fff");
  text("Equipment:", px, y);
  y += lh;

  const eqMap = {
    ring: "itemRing",
    gem: "itemGem",
    cross: "itemCross",
    sword: "itemSword",
    key: "itemKey",
    shield: "itemShield",
    crown: "itemCrown",
  };
  const ekey = eqMap[player.equipment] || null;
  if (ekey) drawAtlas(ekey, px, y - 8, PANEL_ICON);
  y += lh + 10;

  fill("#fff");
  text(`Kills: ${player.killCount}`, px, y);
  y += lh;
  text(`Enemies: ${enemies.length}/${MAX_ENEMIES}`, px, y);
  y += lh + 16;

  // Battle info: Enemy vs Player（ドット絵）
  if (fxBattle.active || fxEnemyInfo.active) {
    const de = fxEnemyInfo.active ? fxEnemyInfo.enemy : fxBattle.enemy;
    if (de) {
      fill("#fff");
      textSize(14);
      text("Battle:", px, y - 6);

      const enemyKey = enemyKeyByKind(de.kind || "bat");
      const playerKey = playerFacingKey(game.player);

      // ▼ レイアウト微調整：アイコンを少し下げ、"vs" をやや左へ
      const iconYOffset = 6; // ドット絵を下げる量（px）
      const vsXOffset = -2; // "vs" を左にずらす量（px）

      drawAtlas(enemyKey, px, y + 2 + iconYOffset, PANEL_ICON);
      fill("#ccc");
      text("vs", px + PANEL_ICON + 6 + vsXOffset, y + 14 + iconYOffset);
      drawAtlas(
        playerKey,
        px + PANEL_ICON + 24,
        y + 2 + iconYOffset,
        PANEL_ICON
      );

      y += PANEL_ICON + 8;

      fill("#64FF64");
      textSize(14);
      text(`Enemy: ${de.hp}/${de.maxHp}`, px, y);
      y += lh;
    }
  }

  if (game.win) {
    fill("#FFD700");
    textSize(18);
    textAlign(CENTER, TOP);
    text("CROWN DELIVERED!", GAME_AREA_WIDTH + PANEL_WIDTH / 2, height - 40);
  }
}

/*======================
    Overlays
  ======================*/
function drawGameOver(game) {
  noStroke();
  fill(0, 0, 0, 200);
  rect(0, 0, width, height);
  fill("#FF6464");
  textSize(62);
  textAlign(CENTER, CENTER);
  text("GAME OVER", width / 2, height / 2 - 60);
  const p = game.player;
  fill("#fff");
  textSize(26);
  text(`Kills: ${p.killCount}`, width / 2, height / 2);
  text(`Level: ${p.level}`, width / 2, height / 2 + 30);
  text(`EXP: ${p.totalExp}`, width / 2, height / 2 + 60);
  fill("#CCC");
  textSize(21);
  text("Press R to restart", width / 2, height / 2 + 100);
}
function drawWin(game) {
  noStroke();
  fill(0, 0, 0, 200);
  rect(0, 0, width, height);
  fill("#FFF200");
  textSize(72);
  textAlign(CENTER, CENTER);
  text("YOU  WIN!", width / 2, height / 2 - 60);
  const p = game.player;
  fill("#fff");
  textSize(26);
  text(`Kills: ${p.killCount}`, width / 2, height / 2 + 10);
  text(`Level: ${p.level}`, width / 2, height / 2 + 40);
  text(`EXP: ${p.totalExp}`, width / 2, height / 2 + 70);
  fill("#CCC");
  textSize(22);
  text("Press R to restart", width / 2, height / 2 + 110);
}
