// sketch.js
// p5 entry point + Game loop / camera

import World, { GAME_AREA_WIDTH } from "./world.js";
import { EnemyManager } from "./enemy.js";
import Player from "./player.js";
import { initRender, drawScene, gridToIso } from "./render.js";

/*=============================
  Game singleton
==============================*/
class Game {
  constructor() {
    // world & enemies
    this.world = new World();
    this.enemyMgr = new EnemyManager(this.world, null);

    // player
    this.player = new Player(this.world, this.enemyMgr.all, this);
    this.enemies = this.enemyMgr.all;

    // mutual refs
    this.enemyMgr.p = this.player;
    this.world.enemyMgr = this.enemyMgr;

    // state
    this.phase = "PLAYER"; // PLAYER → ENEMY → WORLD
    this.keys = { left: false, right: false, up: false, down: false };
    this.title = true;
    this.over = false;
    this.win = false;

    // camera (iso offset)
    this.camera = { x: 0, y: 0 };
  }

  init() {
    this.world.generate();
    this.player.reset();
    this.enemyMgr.reset();

    this.phase = "PLAYER";
    this.keys = { left: false, right: false, up: false, down: false };
    this.title = true;
    this.over = false;
    this.win = false;
  }

  tick() {
    if (this.title || this.over || this.win) {
      this.updateCamera();
      return;
    }

    if (this.phase === "ENEMY") {
      this.enemyMgr.moveAll();
      this.phase = "WORLD";
    } else if (this.phase === "WORLD") {
      this.enemyMgr.onWorldPhase();
      // 押しっぱなし連続移動のためキーをリセットしない
      this.phase = "PLAYER";
    }
    if (this.phase === "PLAYER") {
      if (this.player.updateMovement(this.keys)) this.phase = "ENEMY";
    }

    this.player.updateFx();
    if (this.player.hp <= 0) this.over = true;

    this.updateCamera();
  }

  updateCamera() {
    // プレイヤーを「マップ表示領域の中央」に固定
    const pIso = gridToIso(this.player.x + 0.5, this.player.y + 0.5);
    const centerX = GAME_AREA_WIDTH / 2;
    const centerY = height / 2;
    this.camera.x = centerX - pIso.x;
    this.camera.y = centerY - pIso.y;
  }

  draw() {
    drawScene(this);
  }

  onKeyDown(e) {
    const k = (e.key || "").toLowerCase();
    if (this.title) {
      this.title = false;
      return;
    }
    if ((this.over || this.win) && k === "r") {
      this.init();
      return;
    }

    if (k === "a" || e.code === "ArrowLeft") this.keys.left = true;
    if (k === "d" || e.code === "ArrowRight") this.keys.right = true;
    if (k === "w" || e.code === "ArrowUp") this.keys.up = true;
    if (k === "s" || e.code === "ArrowDown") this.keys.down = true;
    if (k === "z") this.player.onZ();
  }
  onKeyUp(e) {
    const k = (e.key || "").toLowerCase();
    if (k === "a" || e.code === "ArrowLeft") this.keys.left = false;
    if (k === "d" || e.code === "ArrowRight") this.keys.right = false;
    if (k === "w" || e.code === "ArrowUp") this.keys.up = false;
    if (k === "s" || e.code === "ArrowDown") this.keys.down = false;
  }
}

/*=============================
  p5 glue
==============================*/
export const game = new Game();

window.setup = () => {
  const c = createCanvas(800, 600);
  c.parent("gameContainer");

  textAlign(CENTER, CENTER);
  rectMode(CORNER);

  initRender();
  game.init(); // start at title
};

window.draw = () => {
  background(17);
  game.tick();
  game.draw();
};

window.keyPressed = (e) => game.onKeyDown(e);
window.keyReleased = (e) => game.onKeyUp(e);
