// spriteKeys.js
// アイテム → スプライトキーの対応を一元化（描画・UIで共用）

import { ItemType } from "./world.js";

export const ITEM_TO_SPRITE = {
  [ItemType.COIN]: "itemCoin",
  [ItemType.GEM]: "itemGem",
  [ItemType.SWORD]: "itemSword",
  [ItemType.RING]: "itemRing",
  [ItemType.CROSS]: "itemCross",
  [ItemType.KEY]: "itemKey",
  [ItemType.SHIELD]: "itemShield",
  [ItemType.CROWN]: "itemCrown",
};
