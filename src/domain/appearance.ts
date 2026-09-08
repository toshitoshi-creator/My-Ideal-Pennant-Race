/**
 * 選手の見た目に関する入口。
 *
 * 二つの世代を並べて持つ。
 *
 *   v1（PHASE 4.5）… playerAppearance.ts
 *       その場で描くSVGの設計図。素材が無くても必ず描ける
 *
 *   v2（PHASE 4.6）… visualProfile.ts
 *       外部の画像生成AIで作った素材を組み合わせるための設計図
 *
 * どちらも player.id だけから決まり、ゲームの乱数を読まない・進めない。
 * v2 は v1 を内側に持っているので、素材が欠けたときは自動的に v1 へ落ちる。
 */
export * from './playerAppearance';
export * from './visualProfile';
